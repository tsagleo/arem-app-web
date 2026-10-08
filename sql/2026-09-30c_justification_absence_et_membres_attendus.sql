-- =====================================================================
-- Présences — justification (excuse) d'une absence + tous les adhérents
-- inscrits comptent comme « attendus » (2026-09-30, complément c)
-- =====================================================================
-- À exécuter APRÈS sql/2026-09-30b_justification_retard_depart.sql.
--
-- Deux problèmes signalés par l'utilisateur en testant la fiche unifiée
-- sur le terrain (séance « Reunion Test ») :
--
--   1) « Sur cette fiche, je ne vois que deux adhérents, alors que
--      j'en ai plus. » — cloturer_session() (et la fiche côté client)
--      ne considéraient comme « attendu » qu'un adhérent au statut
--      exactement 'Actif'. Un adhérent 'Inactif' (par exemple en
--      attente de paiement de cotisation, sans lien avec sa présence
--      aux séances) n'apparaissait donc jamais sur la fiche, n'était
--      jamais marqué absent, et ne pouvait jamais être sanctionné.
--      Correction : tout adhérent NON SUPPRIMÉ compte désormais comme
--      « attendu » par défaut (sauf liste restreinte explicite créée
--      par le Bureau, comportement inchangé pour ce cas-là).
--
--   2) « Je ne vois toujours pas le bouton d'exemption pour les
--      absences excusées. » — le complément précédent (2026-09-30b)
--      ajoutait un mécanisme d'exemption pour le retard et le départ
--      anticipé, mais PAS pour l'absence marquée automatiquement à la
--      clôture (seule la déclaration à l'AVANCE par l'adhérent lui-même
--      était couverte). Correction : justifier_presence() accepte
--      désormais p_type = 'absence' en plus de 'retard'/'depart', et
--      cloturer_session() lie chaque amende d'absence automatique à sa
--      ligne de présence (attendance_record_id) pour permettre de la
--      retrouver et de l'annuler précisément, exactement comme pour le
--      retard/départ.
--
-- ⚠️ Comme pour le complément précédent, la liaison attendance_record_id
-- n'existe que pour les absences marquées à la clôture APRÈS l'exécution
-- de ce script — une amende d'absence déjà créée avant reste annulable
-- seulement à la main (bouton « Annuler » existant de Sanctions.jsx).
-- =====================================================================

-- ---------------------------------------------------------------------
-- cloturer_session() — remplacée : « attendu » = tout adhérent non
-- supprimé (au lieu de statut = 'Actif' strictement), et chaque amende
-- d'absence automatique est désormais liée à sa ligne de présence.
-- Signature de retour INCHANGÉE — pas de DROP nécessaire.
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
  v_record_id uuid;
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

  -- « Attendu » = tout adhérent non supprimé de l'association (Actif OU
  -- Inactif — un statut Inactif n'a pas de rapport avec la présence aux
  -- séances, contrairement à Supprimé), sauf liste restreinte explicite.
  for v_member in
    select m.id, m.nom from public.members m
    where m.association_id = v_session.association_id
      and m.statut <> 'Supprimé'
      and (v_session.attendus_member_ids is null or m.id = any(v_session.attendus_member_ids))
      and not exists (select 1 from public.attendance_records ar where ar.session_id = p_session_id and ar.member_id = m.id)
  loop
    insert into public.attendance_records (session_id, association_id, member_id, member_nom, heure_arrivee, statut, absence_justifiee, absence_source, methode)
    values (p_session_id, v_session.association_id, v_member.id, v_member.nom, null, 'absent', false, 'auto', 'absent')
    returning id into v_record_id;
    v_nb_absents := v_nb_absents + 1;

    if coalesce(v_assoc.presence_absence_actif, false) then
      insert into public.sanctions (association_id, member_id, type, categorie_nom, montant, motif, statut, paye, proposee_par, proposee_par_nom, validee_par, validee_par_nom, date_validation, attendance_record_id)
      values (
        v_session.association_id, v_member.id, 'amende', 'Absence non justifiée (pointage automatique)',
        coalesce(v_assoc.presence_absence_montant, 15),
        'Absence non justifiée à la séance « ' || v_session.titre || ' » du ' || to_char(v_session.date_seance, 'DD/MM/YYYY'),
        'validee', false, auth.uid(), v_pointeur_nom, auth.uid(), v_pointeur_nom, v_now, v_record_id
      );
      v_nb_sanctions := v_nb_sanctions + 1;
    end if;
  end loop;

  update public.attendance_sessions set cloturee = true, cloturee_le = v_now where id = p_session_id;

  return query select 'session_fermee'::text, v_nb_absents, v_nb_sanctions;
end;
$fn$;

comment on function public.cloturer_session(uuid) is
  'Clôture une séance de pointage : marque automatiquement ''absent'' (non justifié) tout adhérent attendu (tout adhérent non supprimé de l''association, ou attendus_member_ids si restreint) sans ligne de présence/absence déjà enregistrée, et applique l''amende d''absence configurée (associations.presence_absence_actif/montant), liée à sa ligne via attendance_record_id — même patron ''toujours immédiate'' que les amendes de retard/départ. Garde is_bureau() interne.';

grant execute on function public.cloturer_session(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- justifier_presence() — remplacée : accepte désormais p_type = 'absence'
-- en plus de 'retard'/'depart', pour excuser après coup une absence
-- marquée automatiquement à la clôture (avec motif, et annulation de
-- l'amende correspondante si elle existe encore).
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
  if p_type not in ('retard', 'depart', 'absence') then
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
  elsif p_type = 'depart' then
    update public.attendance_records set depart_justifie = true, depart_motif_justification = p_motif where id = p_record_id;
    update public.sanctions set statut = 'annulee'
      where attendance_record_id = p_record_id and categorie_nom = 'Départ anticipé (pointage automatique)' and statut = 'validee';
  else -- 'absence'
    if v_record.statut <> 'absent' then
      return query select 'pas_absent'::text;
      return;
    end if;
    update public.attendance_records set
      absence_justifiee = true, absence_motif = p_motif, absence_source = 'declaree_bureau'
      where id = p_record_id;
    update public.sanctions set statut = 'annulee'
      where attendance_record_id = p_record_id and categorie_nom = 'Absence non justifiée (pointage automatique)' and statut = 'validee';
  end if;

  return query select 'justifie'::text;
end;
$fn$;

comment on function public.justifier_presence(uuid, text, text) is
  'Le Bureau excuse après coup un retard (p_type=''retard''), un départ anticipé (p_type=''depart'') ou une absence marquée automatiquement (p_type=''absence'') déjà enregistrés sur la ligne p_record_id, avec un motif parmi medical/familial/professionnel/force_majeure/autre — annule automatiquement l''amende de pointage correspondante si elle existe encore et n''a pas déjà été traitée autrement (payée, déjà annulée...). Garde is_bureau() interne. Codes retournés : non_autorise, type_invalide, motif_invalide, introuvable, pas_absent, justifie.';

grant execute on function public.justifier_presence(uuid, text, text) to authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select proname from pg_proc where proname in ('cloturer_session','justifier_presence'); -- 2 lignes
--   -- Sur une nouvelle clôture de séance, vérifier que les amendes
--   -- d'absence portent bien un attendance_record_id :
--   select attendance_record_id from public.sanctions where categorie_nom = 'Absence non justifiée (pointage automatique)' order by created_at desc limit 3;
-- =====================================================================
