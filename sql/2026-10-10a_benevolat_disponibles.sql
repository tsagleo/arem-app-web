-- =====================================================================
-- 2026-10-10a — Bénévolat : relier les tâches des événements aux membres
-- « disponibles pour du bénévolat » (members.disponible_benevolat)
-- =====================================================================
-- Jusqu'ici la case « Disponible pour du bénévolat » de la fiche adhérent
-- n'était reliée à rien : les tâches de bénévolat d'un événement
-- (event_volunteer_tasks) ne se remplissaient que par l'inscription
-- volontaire de chacun (se_porter_volontaire_evenement).
--
-- Ce script ajoute deux fonctions réservées au Bureau :
--   1) inscrire_benevole_evenement(tâche, membre) : le Bureau inscrit
--      directement un membre à une tâche, en respectant le nombre de places
--      (même vérification que se_porter_volontaire_evenement) ;
--   2) prevenir_benevoles_disponibles(tâche, membre facultatif) : envoie une
--      notification push (Edge Function send-push-notification, même patron
--      que les autres notifications) soit à UN membre, soit à TOUS les
--      membres disponibles pour du bénévolat qui ne sont pas déjà inscrits.
--      Retourne le nombre de comptes visés (-1 si les notifications push ne
--      sont pas configurées) ; l'application propose alors le partage
--      WhatsApp en complément.
--
-- Ré-exécutable sans risque (create or replace / if not exists).
-- Prérequis : sql/2026-09-30_evenements_modernisation.sql et
-- sql/2026-10-06_demande_adhesion_complete.sql (colonnes competences et
-- disponible_benevolat) — la colonne est recréée ici au besoin.
-- =====================================================================

alter table public.members
  add column if not exists disponible_benevolat boolean not null default false;
alter table public.members
  add column if not exists competences text;

create index if not exists members_disponible_benevolat_idx
  on public.members (association_id) where disponible_benevolat;

-- ---------------------------------------------------------------------
-- 1) Inscription directe d'un membre par le Bureau
-- ---------------------------------------------------------------------
create or replace function public.inscrire_benevole_evenement(p_task_id uuid, p_member_id uuid)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_task record;
  v_nb integer;
begin
  if v_assoc is null or not public.is_bureau() then
    return query select 'non_autorise'::text; return;
  end if;
  -- Verrou sur la tâche : deux inscriptions simultanées ne peuvent pas
  -- dépasser le nombre de places.
  select * into v_task from public.event_volunteer_tasks t
   where t.id = p_task_id and t.association_id = v_assoc
   for update;
  if v_task is null then
    return query select 'introuvable'::text; return;
  end if;
  if not exists (select 1 from public.members m where m.id = p_member_id and m.association_id = v_assoc) then
    return query select 'introuvable'::text; return;
  end if;
  if exists (select 1 from public.event_volunteer_signups s where s.task_id = p_task_id and s.member_id = p_member_id) then
    return query select 'deja_inscrit'::text; return;
  end if;
  select count(*) into v_nb from public.event_volunteer_signups s where s.task_id = p_task_id;
  if v_nb >= v_task.membres_requis then
    return query select 'complet'::text; return;
  end if;
  insert into public.event_volunteer_signups (association_id, task_id, member_id)
  values (v_assoc, p_task_id, p_member_id)
  on conflict do nothing;
  return query select 'inscrit'::text;
end;
$fn$;

comment on function public.inscrire_benevole_evenement(uuid, uuid) is
  'Bureau uniquement : inscrit directement un membre à une tâche de bénévolat d''un événement, en respectant membres_requis. Codes : non_autorise, introuvable, deja_inscrit, complet, inscrit.';

revoke all on function public.inscrire_benevole_evenement(uuid, uuid) from public, anon;
grant execute on function public.inscrire_benevole_evenement(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Prévenir un membre (ou tous les membres disponibles) d'une tâche
-- ---------------------------------------------------------------------
create or replace function public.prevenir_benevoles_disponibles(p_task_id uuid, p_member_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_task record;
  v_event record;
  v_secret text;
  v_nom_assoc text;
  v_logo text;
  v_profiles uuid[];
  v_nb integer;
begin
  if v_assoc is null or not public.is_bureau() then
    raise exception 'Réservé au Bureau.';
  end if;
  select * into v_task from public.event_volunteer_tasks t
   where t.id = p_task_id and t.association_id = v_assoc;
  if v_task is null then
    raise exception 'Tâche introuvable.';
  end if;
  select e.titre, e.date_debut into v_event from public.events e where e.id = v_task.event_id;

  -- Comptes (profils) visés : le membre demandé, ou tous les membres
  -- disponibles pour du bénévolat qui ne sont pas encore inscrits.
  select array_agg(p.id) into v_profiles
    from public.profiles p
    join public.members m on m.id = p.member_id
   where m.association_id = v_assoc
     and (
       (p_member_id is not null and m.id = p_member_id)
       or (p_member_id is null and m.disponible_benevolat
           and not exists (select 1 from public.event_volunteer_signups s
                            where s.task_id = p_task_id and s.member_id = m.id))
     );
  v_nb := coalesce(array_length(v_profiles, 1), 0);
  -- Liste vide : surtout ne pas appeler l'Edge Function sans profile_ids
  -- (elle enverrait alors à toute l'association).
  if v_nb = 0 then return 0; end if;

  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_internal_secret';
    if v_secret is null then return -1; end if;
    select s.nom, s.logo_url into v_nom_assoc, v_logo from public.associations s where s.id = v_assoc;
    perform net.http_post(
      url := 'https://hqqvkwvobmesgwbdjdko.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
      body := jsonb_build_object(
        'association_id', v_assoc,
        'title', '🙋 ' || coalesce(v_nom_assoc, 'Bénévolat') || ' — Besoin de bénévoles',
        'body', v_task.titre || coalesce(' · ' || v_event.titre, '')
                || coalesce(' (' || to_char(v_event.date_debut, 'DD/MM/YYYY') || ')', ''),
        'icon', v_logo,
        'url', '/',
        'profile_ids', to_jsonb(v_profiles)
      )
    );
  exception when others then
    -- pg_net absent, secret manquant, etc. : pas de notification push.
    return -1;
  end;
  return v_nb;
end;
$fn$;

comment on function public.prevenir_benevoles_disponibles(uuid, uuid) is
  'Bureau uniquement : notification push au membre indiqué, ou (p_member_id null) à tous les membres disponibles pour du bénévolat non encore inscrits à la tâche. Retourne le nombre de comptes visés, 0 si aucun, -1 si les notifications push ne sont pas configurées.';

revoke all on function public.prevenir_benevoles_disponibles(uuid, uuid) from public, anon;
grant execute on function public.prevenir_benevoles_disponibles(uuid, uuid) to authenticated;
