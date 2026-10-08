-- =====================================================================
-- Présences — heures de début/fin, type de séance, sanctions automatiques
-- pour retard et départ anticipé (2026-09-29, complément)
-- =====================================================================
-- À exécuter APRÈS sql/2026-09-29_presences_pointage.sql (dépend des
-- tables attendance_sessions/attendance_records et de la fonction
-- checkin_member() qu'il crée).
--
-- Demande directe de l'utilisateur, cadrée par AskUserQuestion :
--   • Ajout d'une heure de début et d'une heure de fin prévues par séance.
--   • Un nouveau menu « Type de séance » (Rencontre, Assemblée générale,
--     Comité exécutif, Conseil d'administration, Formation, Collecte de
--     fonds, Activité sociale, Autre).
--   • Sanction automatique de retard : configurable par association
--     (actif/inactif, tolérance en minutes), montant PAR PALIER DE
--     SÉVÉRITÉ (0-15 min de retard / 15-30 min / plus de 30 min) —
--     réponse explicite de l'utilisateur, DIFFÉRENT du système de
--     paliers de récidive déjà utilisé par sanctions_baremes (paliers
--     1er/2e/3e manquement) : volontairement NON raccordé à ce système
--     pour éviter toute confusion de sens entre les deux, voir plus bas.
--   • Sanction automatique de départ avant l'heure de fin prévue : même
--     principe (actif/inactif, tolérance, 3 paliers de sévérité).
--   • Toujours immédiate (pas de double validation) — une amende
--     automatique découle d'un fait objectif (l'heure), pas d'une
--     appréciation du Bureau : elle est donc enregistrée "validee"
--     directement, comme si le Bureau l'avait lui-même immédiatement
--     validée (proposee_par = validee_par = la personne qui pointe).
--   • Les deux s'écrivent directement dans la table `sanctions`
--     existante (motif explicite, categorie_nom dédié), visibles au
--     Bureau ET à l'adhérent concerné (RLS déjà en place sur sanctions).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) attendance_sessions — heures prévues + type de séance
-- ---------------------------------------------------------------------
alter table public.attendance_sessions
  add column if not exists heure_debut_prevue timestamptz,
  add column if not exists heure_fin_prevue timestamptz,
  add column if not exists type_seance text not null default 'rencontre';

alter table public.attendance_sessions drop constraint if exists attendance_sessions_type_seance_check;
alter table public.attendance_sessions add constraint attendance_sessions_type_seance_check
  check (type_seance in ('rencontre', 'assemblee_generale', 'comite_executif', 'conseil_administration', 'formation', 'collecte_fonds', 'activite_sociale', 'autre'));

comment on column public.attendance_sessions.heure_debut_prevue is
  'Heure de début prévue de la séance (distincte de heure_arrivee, propre à chaque présence). Sert de référence pour détecter un retard. Nullable : une séance créée sans heure précise ne déclenche simplement aucune détection de retard. Complément « heures + sanctions » (2026-09-29).';
comment on column public.attendance_sessions.heure_fin_prevue is
  'Heure de fin prévue de la séance. Sert de référence pour détecter un départ anticipé (uniquement si suivre_depart est aussi actif — sans pointage de départ, rien à comparer). Complément « heures + sanctions » (2026-09-29).';
comment on column public.attendance_sessions.type_seance is
  'Catégorie de la séance, pour le classement/l''affichage (aucun impact sur le pointage ou les sanctions).';

-- ---------------------------------------------------------------------
-- 2) associations — réglages des sanctions automatiques de présence
-- ---------------------------------------------------------------------
alter table public.associations
  add column if not exists presence_retard_actif boolean not null default false,
  add column if not exists presence_retard_tolerance_minutes integer not null default 5,
  add column if not exists presence_retard_montant_0_15 numeric not null default 5,
  add column if not exists presence_retard_montant_15_30 numeric not null default 10,
  add column if not exists presence_retard_montant_30_plus numeric not null default 20,
  add column if not exists presence_depart_anticipe_actif boolean not null default false,
  add column if not exists presence_depart_tolerance_minutes integer not null default 5,
  add column if not exists presence_depart_montant_0_15 numeric not null default 5,
  add column if not exists presence_depart_montant_15_30 numeric not null default 10,
  add column if not exists presence_depart_montant_30_plus numeric not null default 20;

comment on column public.associations.presence_retard_actif is
  'Si vrai, checkin_member() sanctionne automatiquement (table sanctions) tout adhérent qui pointe son arrivée plus de presence_retard_tolerance_minutes après attendance_sessions.heure_debut_prevue de la séance. Complément « heures + sanctions » (2026-09-29).';
comment on column public.associations.presence_retard_montant_0_15 is
  'Montant de l''amende automatique quand le retard constaté est de 0 à 15 minutes (au-delà de la tolérance). ATTENTION : ce n''est PAS un palier de récidive comme sanctions_baremes.palier_1/2/3 — c''est un palier de SÉVÉRITÉ du retard lui-même, indépendant du nombre de fois où l''adhérent a déjà été en retard.';
comment on column public.associations.presence_depart_anticipe_actif is
  'Si vrai, checkin_member() sanctionne automatiquement tout adhérent qui pointe son départ plus de presence_depart_tolerance_minutes avant attendance_sessions.heure_fin_prevue (uniquement si la séance suit aussi les départs, suivre_depart = true). Complément « heures + sanctions » (2026-09-29).';

-- ---------------------------------------------------------------------
-- 3) checkin_member() — remplacé : ajoute la détection automatique de
--    retard/départ anticipé et l'écriture de la sanction correspondante.
--    Le type de retour change (nouvelles colonnes) : DROP obligatoire
--    avant de recréer (Postgres ne permet pas de changer le type de
--    retour d'une fonction avec CREATE OR REPLACE).
-- ---------------------------------------------------------------------
drop function if exists public.checkin_member(uuid, text, uuid, uuid);

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
    if v_existing is null then
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
  if v_existing is not null then
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

  insert into public.attendance_records (session_id, association_id, member_id, member_nom, heure_arrivee, pointe_par_profile_id, pointe_par_nom, methode)
  values (p_session_id, v_session.association_id, v_member.id, v_member.nom, v_now, auth.uid(), v_pointeur_nom, case when p_token is not null then 'scan' else 'manuel' end);

  return query select 'arrivee_enregistree'::text, v_member.id, v_member.nom, v_now, null::timestamptz, v_retard_min, null::integer, v_montant;
end;
$fn$;

comment on function public.checkin_member(uuid, text, uuid, uuid) is
  'Pointage d''une présence par scan (p_token = members.verification_token) ou recherche manuelle (p_member_id). p_action = ''arrivee'' (défaut) ou ''depart''. Garde is_bureau() interne obligatoire (security definer). Détecte automatiquement un retard (vs heure_debut_prevue) ou un départ anticipé (vs heure_fin_prevue) et, si activé côté association, écrit directement une amende dans la table sanctions (immédiate, sans double validation). Codes de statut retournés : non_autorise, session_introuvable, session_fermee, carte_invalide, deja_present, arrivee_enregistree, depart_non_suivi, aucune_arrivee, depart_deja_enregistre, depart_enregistre.';

grant execute on function public.checkin_member(uuid, text, uuid, uuid) to authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select heure_debut_prevue, heure_fin_prevue, type_seance from public.attendance_sessions limit 1;
--   select presence_retard_actif, presence_depart_anticipe_actif from public.associations limit 1;
--   select proname from pg_proc where proname = 'checkin_member'; -- 1 ligne
-- =====================================================================
