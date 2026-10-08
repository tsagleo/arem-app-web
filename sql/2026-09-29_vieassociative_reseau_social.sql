-- =====================================================================
-- Vie associative — fil d'actualité façon « réseau social interne »
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Suite « refonte
-- Vie associative » (2026-09-29), à la demande de l'utilisateur : réactions
-- enrichies, publications épinglées, sondages intégrés aux publications, et
-- un repère de nouveauté (badge) réutilisant l'infrastructure déjà livrée
-- pour les autres rubriques (voir claude/badges-notifications-non-lues-
-- proposition.md — « Vie associative... candidat plausible pour une 2e
-- vague », c'est cette 2e vague).
--
-- CE QUE CE SCRIPT AJOUTE :
--   1. Réactions enrichies : la contrainte sur post_reactions.emoji
--      n'acceptait que 👍/❤️ — élargie à 6 emojis (👍 ❤️ 😂 😮 😢 🙏).
--   2. Publications épinglées : colonne posts.epingle (le Bureau peut
--      épingler n'importe quelle publication en haut du fil).
--   3. Sondages intégrés à une publication (distinct du module "Sondages"
--      existant, qui reste réservé au Bureau — ici, l'auteur d'une
--      publication peut y joindre un sondage, comme sur un réseau social).
--   4. Un compteur dédié (get_vieassociative_unread_count) pour savoir si
--      quelqu'un a réagi ou commenté sur MES publications depuis ma
--      dernière visite — réutilise la table section_views déjà en place,
--      AUCUNE nouvelle table de suivi de lecture nécessaire. Câblé côté
--      interface sur le badge de menu (pas sur le badge automatique des 6
--      autres rubriques, pour ne pas marquer "vu" avant l'ouverture réelle
--      du fil — voir le commentaire dans VieAssociative.jsx).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Réactions enrichies (👍 ❤️ 😂 😮 😢 🙏)
-- ---------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'post_reactions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%emoji%'
  loop
    execute format('alter table public.post_reactions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.post_reactions
  add constraint post_reactions_emoji_check
  check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🙏'));

-- ---------------------------------------------------------------------
-- 2) Publications épinglées
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists epingle boolean not null default false;

comment on column public.posts.epingle is
  'Publication épinglée en haut du fil d''actualité (Vie associative) — réservé au Bureau côté interface. Suite « refonte Vie associative » (2026-09-29).';

-- ---------------------------------------------------------------------
-- 3) Sondages intégrés à une publication
-- ---------------------------------------------------------------------
create table if not exists public.post_polls (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  question text not null,
  closed boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.post_polls is
  'Sondage joint à une publication du fil d''actualité (Vie associative) — distinct du module "Sondages" (public.polls), réservé lui au Bureau. Ici, l''auteur de la publication crée le sondage en même temps que son message. Suite « refonte Vie associative » (2026-09-29).';

create table if not exists public.post_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.post_polls(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  texte text not null,
  position integer not null default 0
);

create table if not exists public.post_poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.post_polls(id) on delete cascade,
  option_id uuid not null references public.post_poll_options(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (poll_id, member_profile_id)
);

comment on table public.post_poll_votes is
  'Un seul vote par adhérent et par sondage de publication (contrainte unique) — voter à nouveau change l''option choisie ; le vote peut aussi être retiré (suppression de la ligne). Suite « refonte Vie associative » (2026-09-29).';

create index if not exists post_polls_post_idx on public.post_polls (post_id);
create index if not exists post_poll_options_poll_idx on public.post_poll_options (poll_id);
create index if not exists post_poll_votes_poll_idx on public.post_poll_votes (poll_id);
create index if not exists post_poll_votes_option_idx on public.post_poll_votes (option_id);

alter table public.post_polls enable row level security;
alter table public.post_poll_options enable row level security;
alter table public.post_poll_votes enable row level security;

drop policy if exists "post_polls select" on public.post_polls;
drop policy if exists "post_polls insert" on public.post_polls;
drop policy if exists "post_polls update" on public.post_polls;
drop policy if exists "post_polls delete" on public.post_polls;

create policy "post_polls select" on public.post_polls for select to authenticated
  using (association_id = public.current_association_id());

create policy "post_polls insert" on public.post_polls for insert to authenticated
  with check (
    association_id = public.current_association_id()
    and exists (select 1 from public.posts p where p.id = post_id and p.auteur_id = auth.uid())
  );

create policy "post_polls update" on public.post_polls for update to authenticated
  using (
    association_id = public.current_association_id()
    and (public.is_bureau() or exists (select 1 from public.posts p where p.id = post_id and p.auteur_id = auth.uid()))
  )
  with check (
    association_id = public.current_association_id()
    and (public.is_bureau() or exists (select 1 from public.posts p where p.id = post_id and p.auteur_id = auth.uid()))
  );

create policy "post_polls delete" on public.post_polls for delete to authenticated
  using (
    association_id = public.current_association_id()
    and (public.is_bureau() or exists (select 1 from public.posts p where p.id = post_id and p.auteur_id = auth.uid()))
  );

drop policy if exists "post_poll_options select" on public.post_poll_options;
drop policy if exists "post_poll_options insert" on public.post_poll_options;
drop policy if exists "post_poll_options delete" on public.post_poll_options;

create policy "post_poll_options select" on public.post_poll_options for select to authenticated
  using (association_id = public.current_association_id());

create policy "post_poll_options insert" on public.post_poll_options for insert to authenticated
  with check (
    association_id = public.current_association_id()
    and exists (
      select 1 from public.post_polls pp join public.posts p on p.id = pp.post_id
      where pp.id = poll_id and p.auteur_id = auth.uid()
    )
  );

create policy "post_poll_options delete" on public.post_poll_options for delete to authenticated
  using (
    association_id = public.current_association_id()
    and exists (
      select 1 from public.post_polls pp join public.posts p on p.id = pp.post_id
      where pp.id = poll_id and (p.auteur_id = auth.uid() or public.is_bureau())
    )
  );

drop policy if exists "post_poll_votes select" on public.post_poll_votes;
drop policy if exists "post_poll_votes insert" on public.post_poll_votes;
drop policy if exists "post_poll_votes update" on public.post_poll_votes;
drop policy if exists "post_poll_votes delete" on public.post_poll_votes;

create policy "post_poll_votes select" on public.post_poll_votes for select to authenticated
  using (association_id = public.current_association_id());

create policy "post_poll_votes insert" on public.post_poll_votes for insert to authenticated
  with check (
    association_id = public.current_association_id()
    and member_profile_id = auth.uid()
    and exists (select 1 from public.post_polls pp where pp.id = poll_id and not pp.closed)
  );

create policy "post_poll_votes update" on public.post_poll_votes for update to authenticated
  using (association_id = public.current_association_id() and member_profile_id = auth.uid())
  with check (
    association_id = public.current_association_id()
    and member_profile_id = auth.uid()
    and exists (select 1 from public.post_polls pp where pp.id = poll_id and not pp.closed)
  );

create policy "post_poll_votes delete" on public.post_poll_votes for delete to authenticated
  using (association_id = public.current_association_id() and member_profile_id = auth.uid());

-- ---------------------------------------------------------------------
-- 4) Repère de nouveauté — engagement sur MES publications depuis ma
--    dernière visite du fil. Réutilise section_views (déjà en place pour
--    les 6 autres rubriques badgées) avec section = 'vieassociative'.
--    N'écrit rien elle-même : c'est mark_section_viewed('vieassociative'),
--    déjà existante, appelée côté interface, qui avance le repère.
-- ---------------------------------------------------------------------
create or replace function public.get_vieassociative_unread_count()
returns integer
language sql
security invoker
stable
set search_path = public
as $$
  select count(*)::int from (
    select pc.id from public.post_comments pc
    join public.posts p on p.id = pc.post_id
    where p.auteur_id = auth.uid()
      and pc.auteur_id is distinct from auth.uid()
      and p.association_id = public.current_association_id()
      and pc.created_at > coalesce(
        (select sv.last_viewed_at from public.section_views sv
         where sv.profile_id = auth.uid() and sv.section = 'vieassociative'),
        'epoch'::timestamptz
      )
    union all
    select pr.id from public.post_reactions pr
    join public.posts p on p.id = pr.post_id
    where p.auteur_id = auth.uid()
      and pr.member_profile_id is distinct from auth.uid()
      and p.association_id = public.current_association_id()
      and pr.created_at > coalesce(
        (select sv.last_viewed_at from public.section_views sv
         where sv.profile_id = auth.uid() and sv.section = 'vieassociative'),
        'epoch'::timestamptz
      )
  ) engagement;
$$;

grant execute on function public.get_vieassociative_unread_count() to authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select conname from pg_constraint where conrelid = 'public.post_reactions'::regclass and contype = 'c';
--   -- doit inclure post_reactions_emoji_check avec les 6 emojis
--   select column_name from information_schema.columns where table_name = 'posts' and column_name = 'epingle';
--   select proname from pg_proc where proname = 'get_vieassociative_unread_count';
-- =====================================================================
