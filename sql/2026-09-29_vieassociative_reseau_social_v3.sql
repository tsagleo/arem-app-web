-- =====================================================================
-- Vie associative — fil d'actualité, 3e vague (2026-09-29)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois), EN PLUS des
-- deux scripts précédents (v1 et v2) — indépendant d'eux, ordre sans
-- importance entre les trois.
--
-- Suite à la sélection de l'utilisateur parmi les idées proposées pour
-- dynamiser encore le fil d'actualité :
--   1. Notifications push quand on est mentionné (@Nom) dans une
--      publication ou un commentaire — réutilise l'infrastructure déjà
--      en place (sql/2026-09-28b_push_notifications.sql : table
--      push_subscriptions, Edge Function send-push-notification).
--      ⚠️ ÉTAPE SUPPLÉMENTAIRE REQUISE, HORS SQL : l'Edge Function doit
--      être redéployée avec sa nouvelle version (fournie séparément dans
--      supabase/functions/send-push-notification/) pour comprendre le
--      nouveau paramètre profile_ids — sinon les triggers ci-dessous
--      n'échouent pas, mais la notification part vers TOUT LE MONDE au
--      lieu de la seule personne mentionnée (repli explicite, voir plus
--      bas). Redéployer avec :
--        supabase functions deploy send-push-notification --no-verify-jwt
--   2. Albums photo : jusqu'à 6 images par publication (post_images).
--   3. Partage/republication d'une publication avec commentaire
--      optionnel (posts.reposted_from_id).
--   4. Statuts du jour ("stories" éphémères, 24h) : member_statuses +
--      status_views (qui a vu quoi, pour l'auteur uniquement).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Notifications push pour les mentions (@Nom)
-- ---------------------------------------------------------------------
-- Repère un "@Nom complet" exactement comme le fait l'interface au moment
-- de l'insertion d'une mention (insertMention dans VieAssociative.jsx
-- insère toujours "@Nom complet " tel quel) — une simple recherche de
-- sous-chaîne suffit donc, pas besoin d'une expression régulière élaborée
-- côté base de données.
create or replace function public.notify_mentions(
  p_contenu text,
  p_association_id uuid,
  p_auteur_id uuid,
  p_auteur_nom text,
  p_excerpt_prefix text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  internal_secret text;
  mentioned_ids uuid[];
  m record;
  excerpt text;
begin
  if p_contenu is null or length(trim(p_contenu)) = 0 then
    return;
  end if;

  select decrypted_secret into internal_secret
    from vault.decrypted_secrets
    where name = 'push_internal_secret';
  if internal_secret is null then
    return;
  end if;

  mentioned_ids := array[]::uuid[];
  for m in
    select p.id as profile_id
    from public.members mb
    join public.profiles p on p.member_id = mb.id
    where mb.association_id = p_association_id
      and mb.statut is distinct from 'Supprimé'
      and p.id is distinct from p_auteur_id
      and position('@' || mb.nom in p_contenu) > 0
  loop
    mentioned_ids := array_append(mentioned_ids, m.profile_id);
  end loop;

  if array_length(mentioned_ids, 1) is null then
    return;
  end if;

  excerpt := left(p_contenu, 140);
  if length(p_contenu) > 140 then
    excerpt := excerpt || '…';
  end if;

  perform net.http_post(
    url := 'https://hqqvkwvobmesgwbdjdko.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', internal_secret
    ),
    body := jsonb_build_object(
      'association_id', p_association_id,
      'profile_ids', to_jsonb(mentioned_ids),
      'title', '💬 ' || coalesce(p_auteur_nom, 'Un adhérent') || p_excerpt_prefix,
      'body', excerpt,
      'url', '/'
    )
  );
end;
$$;

comment on function public.notify_mentions is
  'Repère les "@Nom complet" dans une publication/un commentaire du fil d''actualité et envoie une notification push aux adhérents mentionnés (jamais à l''auteur lui-même). Réutilise send-push-notification avec son nouveau paramètre profile_ids (repli sur TOUTE l''association si l''Edge Function n''a pas encore été redéployée avec cette version). Suite « refonte Vie associative » (2026-09-29, 3e vague).';

create or replace function public.trg_notify_post_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_mentions(new.contenu, new.association_id, new.auteur_id, new.auteur_nom, ' vous a mentionné');
  return new;
end;
$$;

drop trigger if exists trg_notify_post_mentions on public.posts;
create trigger trg_notify_post_mentions
  after insert on public.posts
  for each row execute function public.trg_notify_post_mentions();

create or replace function public.trg_notify_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_mentions(new.contenu, new.association_id, new.auteur_id, new.auteur_nom, ' vous a mentionné dans un commentaire');
  return new;
end;
$$;

drop trigger if exists trg_notify_comment_mentions on public.post_comments;
create trigger trg_notify_comment_mentions
  after insert on public.post_comments
  for each row execute function public.trg_notify_comment_mentions();

-- ---------------------------------------------------------------------
-- 2) Albums photo (jusqu'à 6 images par publication)
-- ---------------------------------------------------------------------
create table if not exists public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  url text not null,
  position integer not null default 0
);

comment on table public.post_images is
  'Album photo d''une publication (jusqu''à 6 images, limite appliquée côté interface). posts.image_url reste utilisée pour les publications existantes avant cette migration (repli automatique côté interface) ; les nouvelles publications avec plusieurs images passent par cette table. Suite « refonte Vie associative » (2026-09-29, 3e vague).';

create index if not exists post_images_post_idx on public.post_images (post_id);

alter table public.post_images enable row level security;

drop policy if exists "post_images select" on public.post_images;
drop policy if exists "post_images insert" on public.post_images;
drop policy if exists "post_images delete" on public.post_images;

create policy "post_images select" on public.post_images for select to authenticated
  using (association_id = public.current_association_id());

create policy "post_images insert" on public.post_images for insert to authenticated
  with check (
    association_id = public.current_association_id()
    and exists (select 1 from public.posts p where p.id = post_id and p.auteur_id = auth.uid())
  );

create policy "post_images delete" on public.post_images for delete to authenticated
  using (
    association_id = public.current_association_id()
    and exists (
      select 1 from public.posts p where p.id = post_id and (p.auteur_id = auth.uid() or public.is_bureau())
    )
  );

-- ---------------------------------------------------------------------
-- 3) Partage / republication d'une publication
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists reposted_from_id uuid references public.posts(id) on delete set null;

comment on column public.posts.reposted_from_id is
  'Publication d''origine partagée (si cette publication est un partage/republication). "on delete set null" volontaire : si la publication d''origine est supprimée, le partage reste visible (l''interface affiche alors un repli "publication d''origine indisponible") plutôt que de disparaître avec elle. Suite « refonte Vie associative » (2026-09-29, 3e vague).';

create index if not exists posts_reposted_from_idx on public.posts (reposted_from_id);

-- ---------------------------------------------------------------------
-- 4) Statuts du jour ("stories" éphémères, 24h)
-- ---------------------------------------------------------------------
create table if not exists public.member_statuses (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_profile_id uuid not null references public.profiles(id),
  auteur_nom text,
  type text not null check (type in ('texte', 'image')),
  contenu text,
  image_url text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

comment on table public.member_statuses is
  'Statuts du jour ("stories") — visibles 24h, filtrés côté interface (expires_at > now()) et par la policy de lecture ci-dessous. Suite « refonte Vie associative » (2026-09-29, 3e vague).';

create index if not exists member_statuses_assoc_idx on public.member_statuses (association_id, expires_at);

alter table public.member_statuses enable row level security;

drop policy if exists "member_statuses select" on public.member_statuses;
drop policy if exists "member_statuses insert" on public.member_statuses;
drop policy if exists "member_statuses delete" on public.member_statuses;

create policy "member_statuses select" on public.member_statuses for select to authenticated
  using (association_id = public.current_association_id() and expires_at > now());

create policy "member_statuses insert" on public.member_statuses for insert to authenticated
  with check (association_id = public.current_association_id() and member_profile_id = auth.uid());

create policy "member_statuses delete" on public.member_statuses for delete to authenticated
  using (
    association_id = public.current_association_id()
    and (member_profile_id = auth.uid() or public.is_bureau())
  );

create table if not exists public.status_views (
  id uuid primary key default gen_random_uuid(),
  status_id uuid not null references public.member_statuses(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  viewer_profile_id uuid not null references public.profiles(id),
  viewer_nom text,
  viewed_at timestamptz not null default now(),
  unique (status_id, viewer_profile_id)
);

comment on table public.status_views is
  'Qui a vu quel statut du jour — affiché uniquement à l''auteur du statut ("vu par X"). Suite « refonte Vie associative » (2026-09-29, 3e vague).';

create index if not exists status_views_status_idx on public.status_views (status_id);

alter table public.status_views enable row level security;

drop policy if exists "status_views select" on public.status_views;
drop policy if exists "status_views upsert" on public.status_views;

create policy "status_views select" on public.status_views for select to authenticated
  using (association_id = public.current_association_id());

create policy "status_views upsert" on public.status_views for insert to authenticated
  with check (association_id = public.current_association_id() and viewer_profile_id = auth.uid());

-- =====================================================================
-- Vérification rapide après exécution :
--   select tgname from pg_trigger where tgname like 'trg_notify_%mentions%'; -- 2 lignes
--   select column_name from information_schema.columns where table_name = 'posts' and column_name = 'reposted_from_id';
--   select count(*) from public.post_images; -- doit fonctionner (table vide)
--   select count(*) from public.member_statuses; -- doit fonctionner (table vide)
-- =====================================================================
