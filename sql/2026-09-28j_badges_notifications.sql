-- =====================================================================
-- Badges de notifications non lues (suite 92)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Complément
-- direct des notifications push (suite 82, sql/2026-09-28b) : un rappel
-- visuel PERSISTANT dans l'application (badges sur le menu + total sur
-- la cloche 🔔), pour ne rien manquer même sans être abonné aux
-- notifications push ou après qu'une bulle Windows/téléphone a disparu.
-- Voir claude/badges-notifications-non-lues-proposition.md pour le détail
-- de la proposition et les arbitrages confirmés avec l'utilisateur.
--
-- CE QUE CE SCRIPT AJOUTE :
--   1. Une table `section_views` : pour chaque membre, la date de sa
--      dernière visite de chaque rubrique concernée (8 rubriques —
--      Annonces, Sondages, Documents, Demandes de suppression, Demandes
--      de rattachement, Événements, Sanctions, Gouvernance). Alimentée
--      automatiquement par l'application, jamais saisie à la main.
--   2. Une fonction `mark_section_viewed(section)` — appelée par
--      l'application quand un membre ouvre un onglet concerné.
--   3. Une fonction `get_unread_counts()` — retourne en un seul appel le
--      nombre d'éléments "nouveaux" (non vus) pour les 8 rubriques,
--      selon la définition propre à chacune (voir détail plus bas).
--      Respecte automatiquement les politiques RLS existantes de chaque
--      table (aucune donnée qu'un membre ne pourrait pas déjà voir
--      n'est comptée) — pas de rôle de service, pas de contournement de
--      sécurité, juste un comptage.
--
-- DÉFINITION DU "NON LU" PAR RUBRIQUE :
--   - Annonces, Documents, Événements, Sanctions : nouveaux éléments créés
--     depuis la dernière visite de la rubrique (Annonces/Documents
--     excluent ceux créés par le membre lui-même — inutile de se notifier
--     soi-même).
--   - Sondages : sondages encore actifs auxquels le membre n'a pas encore
--     répondu (indépendant de la notion de "visite" — un sondage répondu
--     ne doit plus jamais compter, peu importe quand).
--   - Demandes de suppression / Demandes de rattachement : demandes
--     encore en attente (`reviewed_at`/`resolved_at` null) créées depuis
--     la dernière visite. Un membre sans accès à ces tables (RLS) obtient
--     naturellement 0, sans logique de rôle supplémentaire ici.
--   - Gouvernance : nouvelles élections créées depuis la dernière visite
--     (la table `governance_info` est une fiche unique éditée en place —
--     vision/mission/valeurs — sans notion naturelle de "nouveau contenu",
--     donc pas comptée ; `elections` est la vraie source d'activité de ce
--     module).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Table des dernières visites par rubrique.
-- ---------------------------------------------------------------------
create table if not exists public.section_views (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  section text not null,
  last_viewed_at timestamptz not null default now(),
  primary key (profile_id, section)
);

comment on table public.section_views is
  'Dernière visite de chaque rubrique notifiable, par membre — alimente les badges de notifications non lues (suite 92). Jamais saisie à la main.';

alter table public.section_views enable row level security;

drop policy if exists "section_views_own" on public.section_views;
create policy "section_views_own" on public.section_views
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2) Marquer une rubrique comme vue.
-- ---------------------------------------------------------------------
create or replace function public.mark_section_viewed(p_section text)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.section_views (profile_id, section, last_viewed_at)
  values (auth.uid(), p_section, now())
  on conflict (profile_id, section) do update set last_viewed_at = excluded.last_viewed_at;
$$;

grant execute on function public.mark_section_viewed(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Compteurs "non lu" des 8 rubriques, en un seul appel.
--    SECURITY INVOKER (pas DEFINER) : chaque sous-requête s'exécute avec
--    les droits du membre connecté, donc les politiques RLS existantes
--    de chaque table s'appliquent normalement — un adhérent sans accès à
--    `deletion_requests`/`member_link_requests` obtient 0 pour ces
--    rubriques sans logique de rôle dupliquée ici.
-- ---------------------------------------------------------------------
-- CORRECTIF (2026-09-28, testé en conditions réelles) : search_path = ''
-- casse la résolution de "profiles" à l'intérieur de
-- current_association_id() et/ou des politiques RLS des tables
-- interrogées ci-dessous (elles ne sont, elles, pas préfixées "public.",
-- car écrites à une époque où le search_path ambiant incluait déjà
-- public) — erreur observée : `42P01 relation "profiles" does not
-- exist`. search_path = public est sans risque ici : tout le corps de
-- cette fonction qualifie déjà explicitement "public." partout.
create or replace function public.get_unread_counts()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_association_id uuid := public.current_association_id();
  v_uid uuid := auth.uid();
  result jsonb := '{}'::jsonb;
begin
  if v_association_id is null or v_uid is null then
    return result;
  end if;

  result := result || jsonb_build_object('annonces', (
    select count(*) from public.announcements a
    where a.association_id = v_association_id
      and a.created_by is distinct from v_uid
      and a.created_at > coalesce(
        (select sv.last_viewed_at from public.section_views sv where sv.profile_id = v_uid and sv.section = 'annonces'),
        'epoch'::timestamptz)
  ));

  result := result || jsonb_build_object('sondages', (
    select count(*) from public.polls p
    where p.association_id = v_association_id
      and p.closed is not true
      and (p.closes_at is null or p.closes_at > now())
      and not exists (
        select 1 from public.poll_votes pv
        where pv.poll_id = p.id and pv.member_profile_id = v_uid
      )
  ));

  result := result || jsonb_build_object('documents', (
    select count(*) from public.documents d
    where d.association_id = v_association_id
      and d.uploaded_by is distinct from v_uid
      and d.created_at > coalesce(
        (select sv.last_viewed_at from public.section_views sv where sv.profile_id = v_uid and sv.section = 'documents'),
        'epoch'::timestamptz)
  ));

  result := result || jsonb_build_object('demandes_suppression', (
    select count(*) from public.deletion_requests dr
    where dr.association_id = v_association_id
      and dr.reviewed_at is null
      and dr.created_at > coalesce(
        (select sv.last_viewed_at from public.section_views sv where sv.profile_id = v_uid and sv.section = 'demandes_suppression'),
        'epoch'::timestamptz)
  ));

  result := result || jsonb_build_object('demandes_rattachement', (
    select count(*) from public.member_link_requests mlr
    where mlr.association_id = v_association_id
      and mlr.resolved_at is null
      and mlr.created_at > coalesce(
        (select sv.last_viewed_at from public.section_views sv where sv.profile_id = v_uid and sv.section = 'demandes_rattachement'),
        'epoch'::timestamptz)
  ));

  result := result || jsonb_build_object('evenements', (
    select count(*) from public.events e
    where e.association_id = v_association_id
      and e.created_at > coalesce(
        (select sv.last_viewed_at from public.section_views sv where sv.profile_id = v_uid and sv.section = 'evenements'),
        'epoch'::timestamptz)
  ));

  result := result || jsonb_build_object('sanctions', (
    select count(*) from public.sanctions s
    where s.association_id = v_association_id
      and s.created_at > coalesce(
        (select sv.last_viewed_at from public.section_views sv where sv.profile_id = v_uid and sv.section = 'sanctions'),
        'epoch'::timestamptz)
  ));

  -- Gouvernance : basé sur `elections` (voir note en tête de script).
  -- Non vérifié directement (table absente de la liste de colonnes
  -- fournie) — si cette section échoue à l'exécution, signale-le pour
  -- qu'on ajuste selon les vraies colonnes de `elections`.
  result := result || jsonb_build_object('gouvernance', (
    select count(*) from public.elections el
    where el.association_id = v_association_id
      and el.created_at > coalesce(
        (select sv.last_viewed_at from public.section_views sv where sv.profile_id = v_uid and sv.section = 'gouvernance'),
        'epoch'::timestamptz)
  ));

  return result;
end;
$$;

grant execute on function public.get_unread_counts() to authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select proname from pg_proc where proname in ('mark_section_viewed', 'get_unread_counts');
--   -- doit afficher 2 lignes
--
-- Test réel (une fois le script exécuté, connecté avec un compte) :
--   select get_unread_counts();
--   -- doit renvoyer un objet JSON avec les 8 clés et des nombres
--   -- (probablement tous > 0 la première fois, puisque personne n'a
--   -- encore "visité" ces rubriques au sens de cette nouvelle table)
--
-- Si la clé "gouvernance" échoue avec une erreur de colonne inexistante,
-- c'est le seul point non vérifié directement dans ce script (voir note
-- ci-dessus) — donne la vraie liste de colonnes de `elections` et on
-- corrige uniquement ce bloc.
-- =====================================================================
