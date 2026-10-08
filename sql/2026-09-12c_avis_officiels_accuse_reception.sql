-- =====================================================================
-- Avis officiels avec accusé de réception (Annonces)
-- =====================================================================
-- Suite 64 (2026-09-12), suite à la demande de l'utilisateur « une
-- option d'avoir les avis », précisée (AskUserQuestion) comme incluant
-- des avis/notices officiels qui nécessitent un accusé de réception —
-- différent d'une simple annonce, où le Bureau doit pouvoir vérifier qui
-- a bien pris connaissance. Réutilise le module Annonces déjà en place
-- plutôt que d'en créer un nouveau : une annonce peut désormais être
-- marquée "avis officiel" (accusé de réception requis), et chaque
-- adhérent doit cliquer "J'ai pris connaissance" — le Bureau voit qui l'a
-- fait et qui ne l'a pas encore fait.
-- =====================================================================

alter table public.announcements
  add column if not exists accuse_reception_requis boolean not null default false;

comment on column public.announcements.accuse_reception_requis is
  'true = cette annonce est un avis officiel : chaque adhérent doit explicitement accuser réception (voir announcement_acks), le Bureau peut suivre qui l''a fait. Suite 64 (2026-09-12).';

create table if not exists public.announcement_acks (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_profile_id uuid not null references public.profiles(id),
  member_nom text,
  acked_at timestamptz not null default now(),
  unique (announcement_id, member_profile_id)
);

comment on table public.announcement_acks is
  'Accusé de réception d''un adhérent pour un avis officiel (announcements.accuse_reception_requis = true). Un seul accusé par adhérent et par avis. Suite 64 (2026-09-12).';

create index if not exists announcement_acks_announcement_idx on public.announcement_acks (announcement_id);

alter table public.announcement_acks enable row level security;

drop policy if exists "announcement_acks select" on public.announcement_acks;
drop policy if exists "announcement_acks insert" on public.announcement_acks;

create policy "announcement_acks select" on public.announcement_acks for select to authenticated
  using (association_id = public.current_association_id());
create policy "announcement_acks insert" on public.announcement_acks for insert to authenticated
  with check (association_id = public.current_association_id() and member_profile_id = auth.uid());

-- Un accusé de réception ne se modifie ni ne se supprime une fois donné
-- (c'est la preuve elle-même) — aucune policy update/delete créée
-- volontairement.
