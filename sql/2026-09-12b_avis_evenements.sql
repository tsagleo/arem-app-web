-- =====================================================================
-- Avis sur les événements passés
-- =====================================================================
-- Suite 63 (2026-09-12), à la demande de l'utilisateur : « une option
-- d'avoir les avis » — précisé ensuite (AskUserQuestion) : avis notés
-- (étoiles) + commentaire sur un événement déjà passé, un seul avis par
-- adhérent et par événement (modifiable), visible par tous, supprimable
-- par son auteur ou par le Bureau (modération).
-- =====================================================================

create table if not exists public.event_reviews (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_profile_id uuid not null references public.profiles(id),
  member_nom text,
  note integer not null check (note between 1 and 5),
  commentaire text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, member_profile_id)
);

comment on table public.event_reviews is
  'Avis (note 1-5 + commentaire) laissé par un adhérent sur un événement déjà passé. Un seul avis par adhérent et par événement — le soumettre à nouveau met à jour le précédent. Suite 63 (2026-09-12).';

create index if not exists event_reviews_event_idx on public.event_reviews (event_id);

alter table public.event_reviews enable row level security;

drop policy if exists "event_reviews select" on public.event_reviews;
drop policy if exists "event_reviews insert" on public.event_reviews;
drop policy if exists "event_reviews update" on public.event_reviews;
drop policy if exists "event_reviews delete" on public.event_reviews;

create policy "event_reviews select" on public.event_reviews for select to authenticated
  using (association_id = public.current_association_id());
create policy "event_reviews insert" on public.event_reviews for insert to authenticated
  with check (association_id = public.current_association_id() and member_profile_id = auth.uid());
create policy "event_reviews update" on public.event_reviews for update to authenticated
  using (association_id = public.current_association_id() and member_profile_id = auth.uid())
  with check (association_id = public.current_association_id() and member_profile_id = auth.uid());
create policy "event_reviews delete" on public.event_reviews for delete to authenticated
  using (association_id = public.current_association_id() and (member_profile_id = auth.uid() or public.is_bureau()));
