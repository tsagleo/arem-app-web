-- =====================================================================
-- Vie associative — fil d'actualité, 2e vague (2026-09-29)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois), EN PLUS de
-- sql/2026-09-29_vieassociative_reseau_social.sql (celui-ci ne remplace
-- pas l'autre — les deux sont indépendants, l'ordre n'a pas d'importance).
--
-- Suite à la demande de l'utilisateur de dynamiser encore le fil
-- d'actualité ("propose-moi des idées pour que ce soit la crème de la
-- crème"), après sélection des idées à retenir dans un premier temps :
--   1. Réponses aux commentaires (fil imbriqué sur un niveau, façon
--      Instagram/Facebook) — colonne post_comments.parent_comment_id.
--   2. Statut de lecture des publications ("vu par X personnes") —
--      nouvelle table post_views, sur le même principe que post_reactions
--      (une ligne par publication vue par un adhérent, mise à jour au lieu
--      de dupliquée). Le nom de l'adhérent est dénormalisé (viewer_nom),
--      comme auteur_nom sur posts/post_comments, pour rester cohérent avec
--      le reste du fichier et éviter une jointure sur profiles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Réponses aux commentaires
-- ---------------------------------------------------------------------
alter table public.post_comments
  add column if not exists parent_comment_id uuid references public.post_comments(id) on delete cascade;

comment on column public.post_comments.parent_comment_id is
  'Commentaire "racine" auquel cette réponse est rattachée (fil imbriqué sur un seul niveau : répondre à une réponse pointe toujours vers la racine, jamais de sous-réponse). Suite « refonte Vie associative » (2026-09-29, 2e vague).';

create index if not exists post_comments_parent_idx on public.post_comments (parent_comment_id);

-- ---------------------------------------------------------------------
-- 2) Statut de lecture des publications ("vu par X personnes")
-- ---------------------------------------------------------------------
create table if not exists public.post_views (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_profile_id uuid not null references public.profiles(id),
  viewer_nom text,
  viewed_at timestamptz not null default now(),
  unique (post_id, member_profile_id)
);

comment on table public.post_views is
  'Suivi léger de qui a "vu" une publication (marquée dès que le fil d''actualité est ouvert, pas un suivi précis au pixel près) — sert uniquement à afficher un compteur discret "vu par X" à l''auteur de la publication. Suite « refonte Vie associative » (2026-09-29, 2e vague).';

create index if not exists post_views_post_idx on public.post_views (post_id);

alter table public.post_views enable row level security;

drop policy if exists "post_views select" on public.post_views;
drop policy if exists "post_views upsert" on public.post_views;
drop policy if exists "post_views update" on public.post_views;

create policy "post_views select" on public.post_views for select to authenticated
  using (association_id = public.current_association_id());

create policy "post_views upsert" on public.post_views for insert to authenticated
  with check (association_id = public.current_association_id() and member_profile_id = auth.uid());

create policy "post_views update" on public.post_views for update to authenticated
  using (association_id = public.current_association_id() and member_profile_id = auth.uid())
  with check (association_id = public.current_association_id() and member_profile_id = auth.uid());

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns where table_name = 'post_comments' and column_name = 'parent_comment_id';
--   select count(*) from public.post_views; -- doit fonctionner sans erreur (table vide au départ)
-- =====================================================================
