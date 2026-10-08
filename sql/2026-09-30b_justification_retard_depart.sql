-- =====================================================================
-- Présences — justification (excuse) d'un retard ou d'un départ anticipé
-- (2026-09-30, complément)
-- =====================================================================
-- À exécuter APRÈS sql/2026-09-30_absences_fiche_unifiee_paiement.sql.
--
-- Signalé par l'utilisateur en testant la fiche unifiée : l'absence a un
-- mécanisme d'exemption (déclaration à l'avance, toujours justifiée),
-- mais le retard et le départ anticipé n'en avaient aucun — une amende
-- automatique de retard/départ était toujours définitive, même pour un
-- adhérent qui s'était valablement excusé auprès du Bureau. Ce script
-- ajoute la même logique d'exemption pour ces deux cas :
--   • Deux nouveaux drapeaux sur attendance_records (retard_justifie,
--     depart_justifie) + le motif choisi (même liste courte que pour les
--     absences), pour que la fiche affiche clairement « Retard justifié »
--     plutôt que de simplement faire disparaître l'amende sans trace.
--   • Une nouvelle colonne sanctions.attendance_record_id, remplie par
--     checkin_member() au moment de créer l'amende automatique — lien
--     direct et fiable (plutôt qu'un rapprochement approximatif par texte
--     de motif/date) permettant de retrouver PRÉCISÉMENT l'amende à
--     annuler quand le Bureau justifie après coup.
--   • checkin_member() réordonné : la ligne attendance_records est
--     désormais écrite AVANT l'amende automatique (au lieu d'après), pour
--     que son id existe déjà au moment de l'insertion de la sanction.
--     Signature de retour INCHANGÉE — pas de DROP nécessaire.
--   • Nouvelle RPC justifier_presence(p_record_id, p_type, p_motif) :
--     marque le retard OU le départ de cette ligne comme justifié et
--     annule (statut = 'annulee') l'amende automatique correspondante,
--     si elle existe encore et n'a pas déjà été traitée autrement.
--     Réservée au Bureau (is_bureau()).
-- =====================================================================

alter table public.attendance_records
  add column if not exists retard_justifie boolean not null default false,
  add column if not exists retard_motif_justification text,
  add column if not exists depart_justifie boolean not null default false,
  add column if not exists depart_motif_justification text;

alter table public.attendance_records drop constraint if exists attendance_records_retard_motif_check;
alter table public.attendance_records add constraint attendance_records_retard_motif_check
  check (retard_motif_justification is null or retard_motif_justification in ('medical', 'familial', 'professionnel', 'force_majeure', 'autre'));

alter table public.attendance_records drop constraint if exists attendance_records_depart_motif_check;
alter table public.attendance_records add constraint attendance_records_depart_motif_check
  check (depart_motif_justification is null or depart_motif_justification in ('medical', 'familial', 'professionnel', 'force_majeure', 'autre'));

comment on column public.attendance_records.retard_justifie is
  'Vrai si le Bureau a excusé ce retard après coup (justifier_presence()) — l''amende automatique correspondante est alors annulée. La fiche affiche le retard, mais marqué justifié plutôt que sanctionné.';

alter table public.sanctions add column if not exists attendance_record_id uuid references public.attendance_records(id) on delete set null;

comment on column public.sanctions.attendance_record_id is
  'Ligne de présence à l''origine d''une amende automatique de retard/départ anticipé (pointage) — permet à justifier_presence() de retrouver et annuler précisément cette amende. NULL pour toute sanction manuelle ou pour les amendes d''absence.';

-- ---------------------------------------------------------------------
-- checkin_member() — remplacé : écrit la ligne de présence avant
-- l'amende automatique (pour lier attendance_record_id), sinon
-- comportement identique. Signature de retour inchangée.
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
  v_record_id uuid;
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
        insert into public.sanctions (association_id, member_id, type, categorie_nom, montant, motif, statut, paye, proposee_par, proposee_par_nom, validee_par, validee_par_nom, date_validation, attendance_record_id)
        values (
          v_session.association_id, v_member.id, 'amende', 'Départ anticipé (pointage automatique)', v_montant,
          'Départ ' || v_avance_min || ' minute(s) avant la fin prévue de la séance « ' || v_session.titre || ' » du ' || to_char(v_session.date_seance, 'DD/MM/YYYY'),
          'validee', false, auth.uid(), v_pointeur_nom, auth.uid(), v_pointeur_nom, v_now, v_existing.id
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

  -- La ligne de présence est écrite EN PREMIER (avant l'amende
  -- automatique) pour que son id soit connu et puisse être lié à la
  -- sanction via attendance_record_id (complément « justification »,
  -- 2026-09-30).
  if v_existing is not null then
    update public.attendance_records set
      statut = 'present', heure_arrivee = v_now, heure_depart = null,
      absence_motif = null, absence_justifiee = null, absence_source = null, absence_declaree_le = null,
      pointe_par_profile_id = auth.uid(), pointe_par_nom = v_pointeur_nom,
      methode = case when p_token is not null then 'scan' else 'manuel' end
      where id = v_existing.id
      returning id into v_record_id;
  else
    insert into public.attendance_records (session_id, association_id, member_id, member_nom, heure_arrivee, statut, pointe_par_profile_id, pointe_par_nom, methode)
    values (p_session_id, v_session.association_id, v_member.id, v_member.nom, v_now, 'present', auth.uid(), v_pointeur_nom, case when p_token is not null then 'scan' else 'manuel' end)
    returning id into v_record_id;
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
      insert into public.sanctions (association_id, member_id, type, categorie_nom, montant, motif, statut, paye, proposee_par, proposee_par_nom, validee_par, validee_par_nom, date_validation, attendance_record_id)
      values (
        v_session.association_id, v_member.id, 'amende', 'Retard (pointage automatique)', v_montant,
        'Retard de ' || v_retard_min || ' minute(s) à la séance « ' || v_session.titre || ' » du ' || to_char(v_session.date_seance, 'DD/MM/YYYY'),
        'validee', false, auth.uid(), v_pointeur_nom, auth.uid(), v_pointeur_nom, v_now, v_record_id
      );
    end if;
  end if;

  return query select 'arrivee_enregistree'::text, v_member.id, v_member.nom, v_now, null::timestamptz, v_retard_min, null::integer, v_montant;
end;
$fn$;

comment on function public.checkin_member(uuid, text, uuid, uuid) is
  'Pointage d''une présence par scan (p_token) ou recherche manuelle (p_member_id). p_action = ''arrivee'' (défaut) ou ''depart''. Écrit la ligne de présence avant l''amende automatique de retard/départ (pour lier sanctions.attendance_record_id). Si le membre avait une absence déclarée/marquée, l''arrivée la remplace. Codes retournés : non_autorise, session_introuvable, session_fermee, carte_invalide, deja_present, arrivee_enregistree, depart_non_suivi, aucune_arrivee, depart_deja_enregistre, depart_enregistre.';

grant execute on function public.checkin_member(uuid, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- justifier_presence() — le Bureau excuse après coup un retard ou un
-- départ anticipé déjà pointé : marque la ligne comme justifiée et
-- annule l'amende automatique correspondante si elle existe encore.
-- ---------------------------------------------------------------------
create or replace function public.justifier_presence(
  p_record_id uuid,
  p_type text,
  p_motif text
)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_record record;
begin
  if not public.is_bureau() then
    return query select 'non_autorise'::text;
    return;
  end if;
  if p_type not in ('retard', 'depart') then
    return query select 'type_invalide'::text;
    return;
  end if;
  if p_motif is null or p_motif not in ('medical', 'familial', 'professionnel', 'force_majeure', 'autre') then
    return query select 'motif_invalide'::text;
    return;
  end if;

  select * into v_record from public.attendance_records ar where ar.id = p_record_id;
  if v_record is null or v_record.association_id <> public.current_association_id() then
    return query select 'introuvable'::text;
    return;
  end if;

  if p_type = 'retard' then
    update public.attendance_records set retard_justifie = true, retard_motif_justification = p_motif where id = p_record_id;
    update public.sanctions set statut = 'annulee'
      where attendance_record_id = p_record_id and categorie_nom = 'Retard (pointage automatique)' and statut = 'validee';
  else
    update public.attendance_records set depart_justifie = true, depart_motif_justification = p_motif where id = p_record_id;
    update public.sanctions set statut = 'annulee'
      where attendance_record_id = p_record_id and categorie_nom = 'Départ anticipé (pointage automatique)' and statut = 'validee';
  end if;

  return query select 'justifie'::text;
end;
$fn$;

comment on function public.justifier_presence(uuid, text, text) is
  'Le Bureau excuse après coup un retard (p_type=''retard'') ou un départ anticipé (p_type=''depart'') déjà pointé sur la ligne p_record_id, avec un motif parmi medical/familial/professionnel/force_majeure/autre — annule automatiquement l''amende de pointage correspondante si elle existe encore et n''a pas déjà été traitée autrement (payée, déjà annulée...). Garde is_bureau() interne. Codes retournés : non_autorise, type_invalide, motif_invalide, introuvable, justifie.';

grant execute on function public.justifier_presence(uuid, text, text) to authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select retard_justifie, depart_justifie from public.attendance_records limit 1;
--   select attendance_record_id from public.sanctions limit 1;
--   select proname from pg_proc where proname in ('checkin_member','justifier_presence'); -- 2 lignes
-- =====================================================================
