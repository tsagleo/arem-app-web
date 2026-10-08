-- =====================================================================
-- Présences — fiche unifiée (présence/absence/retard/départ anticipé),
-- absences automatiques + motifs, et paiement en ligne des amendes
-- (2026-09-30)
-- =====================================================================
-- À exécuter APRÈS sql/2026-09-29_presences_pointage.sql et
-- sql/2026-09-29b_presences_heures_sanctions.sql.
--
-- Demande directe de l'utilisateur, cadrée par AskUserQuestion :
--   • Sur UNE MÊME fiche de séance : présents, absents, retardataires et
--     départs anticipés — plus de vues dissociées.
--   • Un adhérent qui n'a pas pointé à la clôture de la séance est
--     automatiquement marqué « absent ». Attendus par défaut : tous les
--     adhérents actifs, sauf si le Bureau restreint la liste à la
--     création de la séance (utile pour Comité exécutif / Conseil
--     d'administration) — colonne attendus_member_ids, NULL = tous.
--   • Motifs d'absence (liste courte, choisie par l'utilisateur) :
--     Raison médicale, Raison familiale, Obligation professionnelle,
--     Cas de force majeure, Autre.
--   • Une absence déclarée À L'AVANCE par l'adhérent avec un motif de
--     cette liste est automatiquement considérée justifiée — aucune
--     amende, aucune validation Bureau requise.
--   • Une absence SANS déclaration (marquage automatique à la clôture)
--     est non justifiée et donne droit, si l'association l'a activé, à
--     une amende automatique (montant fixe — l'absence est binaire,
--     contrairement au retard/départ qui ont des paliers de sévérité).
--   • Paiement des amendes en ligne côté adhérent : carte (Stripe) et
--     virement Interac — même infrastructure que le reste de
--     l'application (recouvrements, inscription, etc.), étendue au type
--     "amende" via sanction_id.
--
-- Fuseau horaire (demande explicite de l'utilisateur) : la correction se
-- fait côté client (Presences.jsx), pas ici — heure_debut_prevue et
-- heure_fin_prevue sont désormais envoyées via new Date(valeur).
-- toISOString(), ce qui les interprète dans le fuseau horaire LOCAL de
-- l'appareil qui pointe (exactement ce que l'utilisateur a demandé),
-- avant d'être stockées en UTC. Aucun changement nécessaire ici : les
-- comparaisons de checkin_member()/cloturer_session() se font entre
-- deux instants absolus (timestamptz), ce qui est déjà correct quel que
-- soit le fuseau, une fois l'heure de départ correctement convertie.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) attendance_sessions — liste restreinte optionnelle des attendus
-- ---------------------------------------------------------------------
alter table public.attendance_sessions
  add column if not exists attendus_member_ids uuid[];

comment on column public.attendance_sessions.attendus_member_ids is
  'Liste restreinte des adhérents attendus à cette séance (ex. Comité exécutif). NULL = tous les adhérents actifs sont attendus (comportement par défaut) — voir cloturer_session() et declarer_absence().';

-- ---------------------------------------------------------------------
-- 2) attendance_records — fiche unifiée : une ligne par membre par
--    séance, présent OU absent, avec motif/justification le cas échéant.
-- ---------------------------------------------------------------------
alter table public.attendance_records alter column heure_arrivee drop not null;
alter table public.attendance_records alter column heure_arrivee drop default;

alter table public.attendance_records
  add column if not exists statut text not null default 'present',
  add column if not exists absence_motif text,
  add column if not exists absence_justifiee boolean,
  add column if not exists absence_source text,
  add column if not exists absence_declaree_le timestamptz;

alter table public.attendance_records drop constraint if exists attendance_records_statut_check;
alter table public.attendance_records add constraint attendance_records_statut_check
  check (statut in ('present', 'absent'));

alter table public.attendance_records drop constraint if exists attendance_records_absence_motif_check;
alter table public.attendance_records add constraint attendance_records_absence_motif_check
  check (absence_motif is null or absence_motif in ('medical', 'familial', 'professionnel', 'force_majeure', 'autre'));

alter table public.attendance_records drop constraint if exists attendance_records_absence_source_check;
alter table public.attendance_records add constraint attendance_records_absence_source_check
  check (absence_source is null or absence_source in ('auto', 'declaree_membre', 'declaree_bureau'));

alter table public.attendance_records drop constraint if exists attendance_records_methode_check;
alter table public.attendance_records add constraint attendance_records_methode_check
  check (methode in ('scan', 'manuel', 'absent'));

comment on column public.attendance_records.statut is
  '''present'' (une arrivée a été pointée, éventuellement en retard) ou ''absent''. Une ligne ''absent'' n''a jamais de heure_arrivee. Complément « fiche unifiée » (2026-09-30).';
comment on column public.attendance_records.absence_source is
  '''declaree_membre'' : l''adhérent a signalé son absence à l''avance (toujours justifiée). ''auto'' : marquage automatique à la clôture de la séance, faute de pointage (non justifiée par défaut). ''declaree_bureau'' : réservé à une saisie manuelle future par le Bureau.';

-- Un membre peut désormais voir une séance À VENIR (non close) à laquelle
-- il est attendu, même sans ligne de présence encore — nécessaire pour
-- pouvoir signaler son absence à l'avance depuis « Mon espace ».
drop policy if exists "attendance_sessions select" on public.attendance_sessions;
create policy "attendance_sessions select" on public.attendance_sessions for select to authenticated
  using (
    association_id = public.current_association_id()
    and (
      public.is_bureau()
      or exists (
        select 1 from public.attendance_records ar
        where ar.session_id = attendance_sessions.id and ar.member_id = public.current_member_id()
      )
      or (
        not cloturee
        and (attendus_member_ids is null or public.current_member_id() = any(attendus_member_ids))
      )
    )
  );

-- ---------------------------------------------------------------------
-- 3) associations — réglage de l'amende d'absence non justifiée
--    (montant fixe : contrairement au retard/départ, l'absence n'a pas
--    de palier de sévérité — on est absent ou on ne l'est pas).
-- ---------------------------------------------------------------------
alter table public.associations
  add column if not exists presence_absence_actif boolean not null default false,
  add column if not exists presence_absence_montant numeric not null default 15;

comment on column public.associations.presence_absence_actif is
  'Si vrai, cloturer_session() sanctionne automatiquement (table sanctions, montant fixe presence_absence_montant) tout adhérent attendu marqué absent SANS déclaration préalable justifiée. Complément « fiche unifiée » (2026-09-30).';

-- ---------------------------------------------------------------------
-- 4) Paiement en ligne des amendes — extension du registre existant
--    (même patron que "recouvrement", identifié par sanction_id plutôt
--    que par un solde agrégé).
-- ---------------------------------------------------------------------
alter table public.payment_transactions add column if not exists sanction_id uuid references public.sanctions(id) on delete set null;
alter table public.interac_payment_claims add column if not exists sanction_id uuid references public.sanctions(id) on delete set null;

alter table public.payment_transactions drop constraint if exists payment_transactions_type_check;
alter table public.payment_transactions add constraint payment_transactions_type_check
  check (type in ('inscription', 'fonds_urgence', 'fonds_secours', 'cotisation', 'collation', 'don', 'pret', 'recouvrement', 'billet_evenement', 'amende'));

alter table public.interac_payment_claims drop constraint if exists interac_payment_claims_type_check;
alter table public.interac_payment_claims add constraint interac_payment_claims_type_check
  check (type in ('inscription', 'fonds_urgence', 'fonds_secours', 'cotisation', 'collation', 'don', 'pret', 'recouvrement', 'billet_evenement', 'amende'));

comment on column public.payment_transactions.sanction_id is
  'Amende précise réglée (type = ''amende'') — NULL pour toutes les autres rubriques. Complément « fiche unifiée + paiement » (2026-09-30).';

-- ---------------------------------------------------------------------
-- 5) checkin_member() — remplacé : une arrivée peut désormais annuler
--    une absence déjà déclarée/marquée pour ce membre (le membre se
--    présente finalement). Signature de retour INCHANGÉE : pas de DROP
--    nécessaire (à la différence de la suite précédente).
-- ---------------------------------------------------------------------
create or replace function public.checkin_member(
  p_session_id uuid,
  p_action text default 'arrivee',
  p_token uuid default null,
  p_member_id uuid default null
)
returns table(
  status text, member_id uuid, member_nom text,
  heure_arrivee timestamptz, heure_depart timestamptz,
  retard_minutes integer, avance_minutes integer, sanction_montant numeric
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_session record;
  v_member record;
  v_existing record;
  v_assoc record;
  v_now timestamptz := now();
  v_pointeur_nom text;
  v_retard_min integer;
  v_avance_min integer;
  v_montant numeric;
begin
  if not public.is_bureau() then
    return query select 'non_autorise'::text, null::uuid, null::text, null::timestamptz, null::timestamptz, null::integer, null::integer, null::numeric;
    return;
  end if;

  select * into v_session from public.attendance_sessions s where s.id = p_session_id;
  if v_session is null or v_session.association_id <> public.current_association_id() then
    return query select 'session_introuvable'::text, null::uuid, null::text, null::timestamptz, null::timestamptz, null::integer, null::integer, null::numeric;
    return;
  end if;
  if v_session.cloturee then
    return query select 'session_fermee'::text, null::uuid, null::text, null::timestamptz, null::timestamptz, null::integer, null::integer, null::numeric;
    return;
  end if;

  if p_token is not null then
    select m.id, m.nom into v_member from public.members m
      where m.verification_token = p_token and m.association_id = v_session.association_id and m.statut <> 'Supprimé';
  elsif p_member_id is not null then
    select m.id, m.nom into v_member from public.members m
      where m.id = p_member_id and m.association_id = v_session.association_id and m.statut <> 'Supprimé';
  end if;

  if v_member is null then
    return query select 'carte_invalide'::text, null::uuid, null::text, null::timestamptz, null::timestamptz, null::integer, null::integer, null::numeric;
    return;
  end if;

  select * into v_existing from public.attendance_records ar where ar.session_id = p_session_id and ar.member_id = v_member.id;
  select p.nom_complet into v_pointeur_nom from public.profiles p where p.id = auth.uid();
  select * into v_assoc from public.associations a where a.id = v_session.association_id;

  if p_action = 'depart' then
    if not v_session.suivre_depart then
      return query select 'depart_non_suivi'::text, v_member.id, v_member.nom, v_existing.heure_arrivee, v_existing.heure_depart, null::integer, null::integer, null::numeric;
      return;
    end if;
    if v_existing is null or v_existing.statut = 'absent' then
      return query select 'aucune_arrivee'::text, v_member.id, v_member.nom, null::timestamptz, null::timestamptz, null::integer, null::integer, null::numeric;
      return;
    end if;
    if v_existing.heure_depart is not null then
      return query select 'depart_deja_enregistre'::text, v_member.id, v_member.nom, v_existing.heure_arrivee, v_existing.heure_depart, null::integer, null::integer, null::numeric;
      return;
    end if;

    v_avance_min := null;
    v_montant := null;
    if v_session.heure_fin_prevue is not null then
      v_avance_min := greatest(0, ceil(extract(epoch from (v_session.heure_fin_prevue - v_now)) / 60))::integer;
      if coalesce(v_assoc.presence_depart_anticipe_actif, false) and v_avance_min > coalesce(v_assoc.presence_depart_tolerance_minutes, 5) then
        v_montant := case
          when v_avance_min <= 15 then v_assoc.presence_depart_montant_0_15
          when v_avance_min <= 30 then v_assoc.presence_depart_montant_15_30
          else v_assoc.presence_depart_montant_30_plus
        end;
        insert into public.sanctions (association_id, member_id, type, categorie_nom, montant, motif, statut, paye, proposee_par, proposee_par_nom, validee_par, validee_par_nom, date_validation)
        values (
          v_session.association_id, v_member.id, 'amende', 'Départ anticipé (pointage automatique)', v_montant,
          'Départ ' || v_avance_min || ' minute(s) avant la fin prévue de la séance « ' || v_session.titre || ' » du ' || to_char(v_session.date_seance, 'DD/MM/YYYY'),
          'validee', false, auth.uid(), v_pointeur_nom, auth.uid(), v_pointeur_nom, v_now
        );
      end if;
    end if;

    update public.attendance_records set heure_depart = v_now, pointe_par_profile_id = auth.uid(), pointe_par_nom = v_pointeur_nom
      where id = v_existing.id;
    return query select 'depart_enregistre'::text, v_member.id, v_member.nom, v_existing.heure_arrivee, v_now, null::integer, v_avance_min, v_montant;
    return;
  end if;

  -- p_action = 'arrivee' (valeur par défaut)
  if v_existing is not null and v_existing.statut = 'present' then
    return query select 'deja_present'::text, v_member.id, v_member.nom, v_existing.heure_arrivee, v_existing.heure_depart, null::integer, null::integer, null::numeric;
    return;
  end if;

  v_retard_min := null;
  v_montant := null;
  if v_session.heure_debut_prevue is not null then
    v_retard_min := greatest(0, ceil(extract(epoch from (v_now - v_session.heure_debut_prevue)) / 60))::integer;
    if coalesce(v_assoc.presence_retard_actif, false) and v_retard_min > coalesce(v_assoc.presence_retard_tolerance_minutes, 5) then
      v_montant := case
        when v_retard_min <= 15 then v_assoc.presence_retard_montant_0_15
        when v_retard_min <= 30 then v_assoc.presence_retard_montant_15_30
        else v_assoc.presence_retard_montant_30_plus
      end;
      insert into public.sanctions (association_id, member_id, type, categorie_nom, montant, motif, statut, paye, proposee_par, proposee_par_nom, validee_par, validee_par_nom, date_validation)
      values (
        v_session.association_id, v_member.id, 'amende', 'Retard (pointage automatique)', v_montant,
        'Retard de ' || v_retard_min || ' minute(s) à la séance « ' || v_session.titre || ' » du ' || to_char(v_session.date_seance, 'DD/MM/YYYY'),
        'validee', false, auth.uid(), v_pointeur_nom, auth.uid(), v_pointeur_nom, v_now
      );
    end if;
  end if;

  -- Un membre dont l'absence avait été déclarée à l'avance (ou marquée
  -- automatiquement — cas rare : session rouverte après clôture) se
  -- présente finalement : on transforme la ligne existante plutôt que
  -- d'en créer une seconde (la contrainte unique (session_id, member_id)
  -- l'interdirait de toute façon).
  if v_existing is not null then
    update public.attendance_records set
      statut = 'present', heure_arrivee = v_now, heure_depart = null,
      absence_motif = null, absence_justifiee = null, absence_source = null, absence_declaree_le = null,
      pointe_par_profile_id = auth.uid(), pointe_par_nom = v_pointeur_nom,
      methode = case when p_token is not null then 'scan' else 'manuel' end
      where id = v_existing.id;
  else
    insert into public.attendance_records (session_id, association_id, member_id, member_nom, heure_arrivee, statut, pointe_par_profile_id, pointe_par_nom, methode)
    values (p_session_id, v_session.association_id, v_member.id, v_member.nom, v_now, 'present', auth.uid(), v_pointeur_nom, case when p_token is not null then 'scan' else 'manuel' end);
  end if;

  return query select 'arrivee_enregistree'::text, v_member.id, v_member.nom, v_now, null::timestamptz, v_retard_min, null::integer, v_montant;
end;
$fn$;

comment on function public.checkin_member(uuid, text, uuid, uuid) is
  'Pointage d''une présence par scan (p_token) ou recherche manuelle (p_member_id). p_action = ''arrivee'' (défaut) ou ''depart''. Si le membre avait une absence déclarée/marquée pour cette séance, l''arrivée la remplace (fiche unifiée). Détecte retard/départ anticipé et écrit une amende automatique si activé. Codes retournés : non_autorise, session_introuvable, session_fermee, carte_invalide, deja_present, arrivee_enregistree, depart_non_suivi, aucune_arrivee, depart_deja_enregistre, depart_enregistre.';

grant execute on function public.checkin_member(uuid, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) declarer_absence() — un adhérent signale à l'avance qu'il sera
--    absent à une séance ouverte, avec un motif ; ou annule sa
--    déclaration. Toujours justifiée (aucune validation Bureau requise,
--    décision explicite de l'utilisateur).
-- ---------------------------------------------------------------------
create or replace function public.declarer_absence(
  p_session_id uuid,
  p_action text default 'declarer',
  p_motif text default null
)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_member_nom text;
  v_session record;
  v_existing record;
  v_now timestamptz := now();
begin
  if v_member_id is null then
    return query select 'non_autorise'::text;
    return;
  end if;

  select * into v_session from public.attendance_sessions s where s.id = p_session_id;
  if v_session is null or v_session.association_id <> public.current_association_id() then
    return query select 'session_introuvable'::text;
    return;
  end if;
  if v_session.cloturee then
    return query select 'session_fermee'::text;
    return;
  end if;
  if v_session.attendus_member_ids is not null and not (v_member_id = any(v_session.attendus_member_ids)) then
    return query select 'non_concerne'::text;
    return;
  end if;

  select * into v_existing from public.attendance_records ar where ar.session_id = p_session_id and ar.member_id = v_member_id;

  if p_action = 'annuler' then
    if v_existing is null or v_existing.absence_source <> 'declaree_membre' then
      return query select 'rien_a_annuler'::text;
      return;
    end if;
    delete from public.attendance_records where id = v_existing.id;
    return query select 'declaration_annulee'::text;
    return;
  end if;

  -- p_action = 'declarer' (valeur par défaut)
  if p_motif is null or p_motif not in ('medical', 'familial', 'professionnel', 'force_majeure', 'autre') then
    return query select 'motif_invalide'::text;
    return;
  end if;
  if v_existing is not null and v_existing.statut = 'present' then
    return query select 'deja_present'::text;
    return;
  end if;

  if v_existing is not null then
    update public.attendance_records set
      statut = 'absent', absence_motif = p_motif, absence_justifiee = true,
      absence_source = 'declaree_membre', absence_declaree_le = v_now,
      heure_arrivee = null, heure_depart = null, methode = 'absent'
      where id = v_existing.id;
  else
    select m.nom into v_member_nom from public.members m where m.id = v_member_id;
    insert into public.attendance_records (session_id, association_id, member_id, member_nom, heure_arrivee, statut, absence_motif, absence_justifiee, absence_source, absence_declaree_le, methode)
    values (p_session_id, v_session.association_id, v_member_id, v_member_nom, null, 'absent', p_motif, true, 'declaree_membre', v_now, 'absent');
  end if;

  return query select 'declaration_enregistree'::text;
end;
$fn$;

comment on function public.declarer_absence(uuid, text, text) is
  'Un adhérent signale (p_action=''declarer'', avec p_motif parmi medical/familial/professionnel/force_majeure/autre) ou annule (p_action=''annuler'') son absence à une séance ouverte à laquelle il est attendu. Toujours auto-justifiée, sans validation Bureau. Codes retournés : non_autorise, session_introuvable, session_fermee, non_concerne, motif_invalide, deja_present, rien_a_annuler, declaration_annulee, declaration_enregistree.';

grant execute on function public.declarer_absence(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7) cloturer_session() — clôture d'une séance : marque automatiquement
--    absent tout adhérent attendu sans ligne de présence, et applique
--    l'amende d'absence non justifiée si activée. Remplace la mise à
--    jour directe faite jusqu'ici côté client (toggleCloture).
-- ---------------------------------------------------------------------
create or replace function public.cloturer_session(p_session_id uuid)
returns table(status text, nb_absents_marques integer, nb_sanctions_creees integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_session record;
  v_assoc record;
  v_now timestamptz := now();
  v_pointeur_nom text;
  v_member record;
  v_nb_absents integer := 0;
  v_nb_sanctions integer := 0;
begin
  if not public.is_bureau() then
    return query select 'non_autorise'::text, 0, 0;
    return;
  end if;

  select * into v_session from public.attendance_sessions s where s.id = p_session_id;
  if v_session is null or v_session.association_id <> public.current_association_id() then
    return query select 'session_introuvable'::text, 0, 0;
    return;
  end if;
  if v_session.cloturee then
    return query select 'deja_fermee'::text, 0, 0;
    return;
  end if;

  select * into v_assoc from public.associations a where a.id = v_session.association_id;
  select p.nom_complet into v_pointeur_nom from public.profiles p where p.id = auth.uid();

  for v_member in
    select m.id, m.nom from public.members m
    where m.association_id = v_session.association_id
      and m.statut = 'Actif'
      and (v_session.attendus_member_ids is null or m.id = any(v_session.attendus_member_ids))
      and not exists (select 1 from public.attendance_records ar where ar.session_id = p_session_id and ar.member_id = m.id)
  loop
    insert into public.attendance_records (session_id, association_id, member_id, member_nom, heure_arrivee, statut, absence_justifiee, absence_source, methode)
    values (p_session_id, v_session.association_id, v_member.id, v_member.nom, null, 'absent', false, 'auto', 'absent');
    v_nb_absents := v_nb_absents + 1;

    if coalesce(v_assoc.presence_absence_actif, false) then
      insert into public.sanctions (association_id, member_id, type, categorie_nom, montant, motif, statut, paye, proposee_par, proposee_par_nom, validee_par, validee_par_nom, date_validation)
      values (
        v_session.association_id, v_member.id, 'amende', 'Absence non justifiée (pointage automatique)',
        coalesce(v_assoc.presence_absence_montant, 15),
        'Absence non justifiée à la séance « ' || v_session.titre || ' » du ' || to_char(v_session.date_seance, 'DD/MM/YYYY'),
        'validee', false, auth.uid(), v_pointeur_nom, auth.uid(), v_pointeur_nom, v_now
      );
      v_nb_sanctions := v_nb_sanctions + 1;
    end if;
  end loop;

  update public.attendance_sessions set cloturee = true, cloturee_le = v_now where id = p_session_id;

  return query select 'session_fermee'::text, v_nb_absents, v_nb_sanctions;
end;
$fn$;

comment on function public.cloturer_session(uuid) is
  'Clôture une séance de pointage : marque automatiquement ''absent'' (non justifié) tout adhérent attendu (tous les actifs, ou attendus_member_ids si restreint) sans ligne de présence/absence déjà enregistrée, et applique l''amende d''absence configurée (associations.presence_absence_actif/montant) — même patron ''toujours immédiate'' que les amendes de retard/départ. Garde is_bureau() interne.';

grant execute on function public.cloturer_session(uuid) to authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select attendus_member_ids from public.attendance_sessions limit 1;
--   select statut, absence_motif, absence_justifiee, absence_source from public.attendance_records limit 1;
--   select presence_absence_actif, presence_absence_montant from public.associations limit 1;
--   select sanction_id from public.payment_transactions limit 1;
--   select sanction_id from public.interac_payment_claims limit 1;
--   select proname from pg_proc where proname in ('checkin_member','declarer_absence','cloturer_session');  -- 3 lignes
-- =====================================================================
