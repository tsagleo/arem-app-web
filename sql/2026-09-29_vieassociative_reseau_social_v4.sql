-- =====================================================================
-- Vie associative — fil d'actualité, 4e vague (2026-09-29)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois), EN PLUS des
-- trois scripts précédents (v1, v2, v3) — indépendant d'eux, ordre sans
-- importance entre les quatre.
--
-- Suite à la sélection de l'utilisateur parmi les idées proposées pour
-- rapprocher encore le fil d'actualité d'un véritable réseau social
-- associatif :
--   1. Badge « Bureau » sur les publications officielles — nouvelle colonne
--      posts.auteur_est_bureau, dénormalisée à l'insertion (même principe
--      que auteur_nom).
--   2. Publication → événement en un clic — nouvelle colonne posts.event_id,
--      qui pointe vers un événement créé (par le Bureau uniquement, RLS
--      "events insert" déjà en place) au moment même de la publication.
--      Les anniversaires intégrés et les profils enrichis (autres idées
--      retenues) ne nécessitent AUCUN changement de base de données : ils
--      sont construits uniquement à partir de données déjà chargées côté
--      interface (members.date_naissance, members.*).
--   3. Bouton « signaler » un contenu (publication ou commentaire) —
--      nouvelle table post_flags, visible au Bureau uniquement.
--   4. Sauvegarde automatique de brouillon — purement côté client
--      (localStorage), aucun changement de base de données.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Badge "Bureau" sur les publications officielles
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists auteur_est_bureau boolean not null default false;

comment on column public.posts.auteur_est_bureau is
  'Capturé à l''insertion depuis le statut Bureau de l''auteur au moment de la publication (comme auteur_nom) — un changement de rôle ultérieur ne modifie pas le badge des publications passées. Suite « refonte Vie associative » (2026-09-29, 4e vague).';

-- ---------------------------------------------------------------------
-- 2) Publication → événement en un clic
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists event_id uuid references public.events(id) on delete set null;

comment on column public.posts.event_id is
  'Événement créé en même temps que cette publication (raccourci "publication → événement", Bureau uniquement — voir policy RLS "events insert" existante). "on delete set null" volontaire, comme reposted_from_id : si l''événement est supprimé depuis l''onglet Événements, la publication reste visible sans son encart RSVP. Suite « refonte Vie associative » (2026-09-29, 4e vague).';

create index if not exists posts_event_idx on public.posts (event_id);

-- ---------------------------------------------------------------------
-- 3) Bouton "signaler" un contenu (publication ou commentaire)
-- ---------------------------------------------------------------------
create table if not exists public.post_flags (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.post_comments(id) on delete cascade,
  reporter_profile_id uuid not null references public.profiles(id),
  reporter_nom text,
  raison text,
  created_at timestamptz not null default now(),
  constraint post_flags_target_check check ((post_id is not null) <> (comment_id is not null))
);

comment on table public.post_flags is
  'Signalements du fil d''actualité (publication OU commentaire, jamais les deux — voir contrainte post_flags_target_check). Visibles au Bureau uniquement ; pas de tableau de modération dédié pour ce MVP, juste un compteur affiché sur le contenu concerné. Suite « refonte Vie associative » (2026-09-29, 4e vague).';

create index if not exists post_flags_post_idx on public.post_flags (post_id);
create index if not exists post_flags_comment_idx on public.post_flags (comment_id);
-- Un même adhérent ne peut signaler qu'une fois la même publication / le
-- même commentaire (l'interface se fie à ceci pour désactiver le bouton
-- après un premier clic, même après un rechargement de page).
create unique index if not exists post_flags_post_reporter_uidx on public.post_flags (post_id, reporter_profile_id) where post_id is not null;
create unique index if not exists post_flags_comment_reporter_uidx on public.post_flags (comment_id, reporter_profile_id) where comment_id is not null;

alter table public.post_flags enable row level security;

drop policy if exists "post_flags select" on public.post_flags;
drop policy if exists "post_flags insert" on public.post_flags;
drop policy if exists "post_flags delete" on public.post_flags;

-- Le Bureau voit tous les signalements de l'association ; un adhérent ne
-- voit que les siens (pour que le bouton "Signalé" reste désactivé après
-- un rechargement de page, sans exposer les signalements des autres).
create policy "post_flags select" on public.post_flags for select to authenticated
  using (
    association_id = public.current_association_id()
    and (public.is_bureau() or reporter_profile_id = auth.uid())
  );

create policy "post_flags insert" on public.post_flags for insert to authenticated
  with check (association_id = public.current_association_id() and reporter_profile_id = auth.uid());

-- Le Bureau peut retirer un signalement une fois traité (pas d'interface
-- dédiée pour ce MVP, mais laisse la porte ouverte à un futur tableau de
-- modération sans nouvelle migration).
create policy "post_flags delete" on public.post_flags for delete to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns where table_name = 'posts' and column_name in ('auteur_est_bureau', 'event_id');
--   -- doit afficher 2 lignes
--   select count(*) from public.post_flags; -- doit fonctionner (table vide)
-- =====================================================================
