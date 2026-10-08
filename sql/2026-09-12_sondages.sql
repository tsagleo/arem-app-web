-- =====================================================================
-- Sondages
-- =====================================================================
-- Suite 62 (2026-09-12), à la demande de l'utilisateur : « une option de
-- faire des sondages ». Nouveau module autonome (nouvel onglet
-- "Sondages") : le Bureau crée une question à choix unique avec au moins
-- deux options, tous les adhérents votent une seule fois chacun (le vote
-- peut être changé tant que le sondage n'est pas clôturé), les résultats
-- (nombre de votes et pourcentage par option) sont visibles par tous.
-- =====================================================================

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  question text not null,
  created_by uuid references public.profiles(id),
  created_by_nom text,
  closes_at timestamptz,
  closed boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.polls is
  'Sondage (question à choix unique) proposé par le Bureau aux adhérents. Suite 62 (2026-09-12).';

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  texte text not null,
  position integer not null default 0
);

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (poll_id, member_profile_id)
);

comment on table public.poll_votes is
  'Un seul vote par adhérent et par sondage (contrainte unique sur poll_id/member_profile_id) — voter à nouveau change simplement l''option choisie plutôt que d''ajouter une ligne. Suite 62 (2026-09-12).';

create index if not exists poll_options_poll_idx on public.poll_options (poll_id);
create index if not exists poll_votes_poll_idx on public.poll_votes (poll_id);
create index if not exists poll_votes_option_idx on public.poll_votes (option_id);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists "polls select" on public.polls;
drop policy if exists "polls insert" on public.polls;
drop policy if exists "polls update" on public.polls;
drop policy if exists "polls delete" on public.polls;

create policy "polls select" on public.polls for select to authenticated
  using (association_id = public.current_association_id());
create policy "polls insert" on public.polls for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_bureau());
create policy "polls update" on public.polls for update to authenticated
  using (association_id = public.current_association_id() and public.is_bureau())
  with check (association_id = public.current_association_id() and public.is_bureau());
create policy "polls delete" on public.polls for delete to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());

drop policy if exists "poll_options select" on public.poll_options;
drop policy if exists "poll_options insert" on public.poll_options;
drop policy if exists "poll_options delete" on public.poll_options;

create policy "poll_options select" on public.poll_options for select to authenticated
  using (association_id = public.current_association_id());
create policy "poll_options insert" on public.poll_options for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_bureau());
create policy "poll_options delete" on public.poll_options for delete to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());

-- Votes : lecture ouverte à toute l'association (transparence des résultats),
-- écriture réservée à soi-même — et seulement si le sondage n'est pas déjà
-- clôturé (vérifié ici aussi côté base, pas seulement en cachant le bouton
-- côté interface).
drop policy if exists "poll_votes select" on public.poll_votes;
drop policy if exists "poll_votes insert" on public.poll_votes;
drop policy if exists "poll_votes update" on public.poll_votes;
drop policy if exists "poll_votes delete" on public.poll_votes;

create policy "poll_votes select" on public.poll_votes for select to authenticated
  using (association_id = public.current_association_id());
create policy "poll_votes insert" on public.poll_votes for insert to authenticated
  with check (
    association_id = public.current_association_id()
    and member_profile_id = auth.uid()
    and exists (select 1 from public.polls p where p.id = poll_id and not p.closed)
  );
create policy "poll_votes update" on public.poll_votes for update to authenticated
  using (association_id = public.current_association_id() and member_profile_id = auth.uid())
  with check (
    association_id = public.current_association_id()
    and member_profile_id = auth.uid()
    and exists (select 1 from public.polls p where p.id = poll_id and not p.closed)
  );
create policy "poll_votes delete" on public.poll_votes for delete to authenticated
  using (association_id = public.current_association_id() and member_profile_id = auth.uid());
