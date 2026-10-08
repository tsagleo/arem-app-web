-- =====================================================================
-- Incubateur de suivi de projets de grande envergure
-- =====================================================================
-- Suite 54 (2026-09-11), à la demande de l'utilisateur : transformer le
-- module « Projets », jusqu'ici un simple tableau Kanban, en un véritable
-- outil de suivi de projet : fiche projet enrichie (mise au point),
-- budgétisation par postes avec calculs prévu/réel/écart, jalons et
-- échéancier avec dépendances entre tâches, et tableau de bord
-- multi-projets (portefeuille).
--
-- Décisions retenues avec l'utilisateur (voir le document
-- « Incubateur de suivi de projets de grande envergure — Proposition »
-- dans le projet Claude) :
--   - Le budget de projet reste un suivi INDÉPENDANT de la comptabilité
--     générale de l'association (aucune écriture dans fonds_recouvrements,
--     donations, loans, etc. — les montants sont saisis et calculés
--     uniquement dans ce module).
--   - Échéancier avec dépendances entre tâches. Portée retenue : les
--     dépendances sont stockées et affichées (connecteurs dans la vue
--     chronologique) et une alerte est levée si la date de début d'une
--     tâche précède la date de fin de l'une de ses dépendances — il ne
--     s'agit PAS d'un moteur de replanification automatique (déplacer une
--     tâche ne décale pas ses dépendantes) : cela resterait à construire
--     en supplément si le besoin se confirme à l'usage.
--   - Les Phases 1 (fiche + budget) et 2 (jalons/échéancier + portefeuille)
--     sont livrées ensemble.
--
-- Le champ `projects.budget_reel`, présent dans le schéma d'origine mais
-- jamais alimenté par le code (confirmé par recherche dans tout le dépôt),
-- est laissé tel quel pour ne rien casser côté données existantes, mais
-- n'est plus utilisé par l'interface : il est remplacé par un total
-- calculé à la volée à partir de project_expenses (traçable poste par
-- poste, donc plus fiable).
-- =====================================================================

-- ---------- 1) projects : mise au point enrichie ----------
alter table public.projects
  add column if not exists statut text not null default 'actif',
  add column if not exists priorite text not null default 'normale',
  add column if not exists categorie text,
  add column if not exists date_debut date,
  add column if not exists date_fin_prevue date,
  add column if not exists date_fin_reelle date,
  add column if not exists sponsor text,
  add column if not exists notes text;

alter table public.projects
  drop constraint if exists projects_statut_check;
alter table public.projects
  add constraint projects_statut_check
  check (statut in ('propose', 'actif', 'en_pause', 'termine', 'annule'));

alter table public.projects
  drop constraint if exists projects_priorite_check;
alter table public.projects
  add constraint projects_priorite_check
  check (priorite in ('basse', 'normale', 'haute'));

comment on column public.projects.statut is
  'Statut du projet : propose / actif / en_pause / termine / annule.';
comment on column public.projects.priorite is
  'Priorité du projet : basse / normale / haute.';
comment on column public.projects.budget_reel is
  'Ancien champ, non alimenté par le code depuis la mise en place de project_expenses (suite 54) — conservé pour compatibilité, ne plus utiliser côté interface.';

-- ---------- 2) project_tasks : échéancier enrichi ----------
alter table public.project_tasks
  add column if not exists date_debut date,
  add column if not exists pourcentage integer not null default 0,
  add column if not exists dependances uuid[] not null default '{}';

alter table public.project_tasks
  drop constraint if exists project_tasks_pourcentage_check;
alter table public.project_tasks
  add constraint project_tasks_pourcentage_check
  check (pourcentage >= 0 and pourcentage <= 100);

comment on column public.project_tasks.dependances is
  'Liste des id de tâches prédécesseurs (fin -> début). Utilisée pour tracer les connecteurs dans la vue chronologique et avertir en cas d''incohérence de dates ; ne déclenche pas de replanification automatique.';

-- ---------- 3) project_budget_lines (nouvelle table) ----------
create table if not exists public.project_budget_lines (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  categorie text,
  libelle text not null,
  montant_prevu numeric not null default 0,
  ordre integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.project_budget_lines is
  'Postes budgétaires d''un projet (suite 54) — le budget total prévu du projet est la somme de ses lignes.';

-- ---------- 4) project_expenses (nouvelle table) ----------
create table if not exists public.project_expenses (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_line_id uuid references public.project_budget_lines(id) on delete set null,
  date_depense date not null default current_date,
  montant numeric not null,
  description text,
  created_at timestamptz not null default now()
);

comment on table public.project_expenses is
  'Dépenses réelles d''un projet (suite 54), rattachées à un poste budgétaire — suivi indépendant, sans écriture dans la comptabilité générale de l''association.';

-- ---------- 5) project_milestones (nouvelle table) ----------
create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  titre text not null,
  date_cible date,
  statut text not null default 'a_venir',
  ordre integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.project_milestones
  drop constraint if exists project_milestones_statut_check;
alter table public.project_milestones
  add constraint project_milestones_statut_check
  check (statut in ('a_venir', 'atteint', 'en_retard'));

comment on table public.project_milestones is
  'Jalons d''un projet (suite 54), affichés dans la vue chronologique aux côtés des tâches.';

-- ---------- 6) RLS : mêmes règles que projects/project_tasks (Bureau uniquement) ----------
alter table public.project_budget_lines enable row level security;
drop policy if exists "project_budget_lines select" on public.project_budget_lines;
drop policy if exists "project_budget_lines insert" on public.project_budget_lines;
drop policy if exists "project_budget_lines update" on public.project_budget_lines;
drop policy if exists "project_budget_lines delete" on public.project_budget_lines;

create policy "project_budget_lines select" on public.project_budget_lines for select to authenticated
  using (association_id = current_association_id() and is_bureau());
create policy "project_budget_lines insert" on public.project_budget_lines for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "project_budget_lines update" on public.project_budget_lines for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "project_budget_lines delete" on public.project_budget_lines for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

alter table public.project_expenses enable row level security;
drop policy if exists "project_expenses select" on public.project_expenses;
drop policy if exists "project_expenses insert" on public.project_expenses;
drop policy if exists "project_expenses update" on public.project_expenses;
drop policy if exists "project_expenses delete" on public.project_expenses;

create policy "project_expenses select" on public.project_expenses for select to authenticated
  using (association_id = current_association_id() and is_bureau());
create policy "project_expenses insert" on public.project_expenses for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "project_expenses update" on public.project_expenses for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "project_expenses delete" on public.project_expenses for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

alter table public.project_milestones enable row level security;
drop policy if exists "project_milestones select" on public.project_milestones;
drop policy if exists "project_milestones insert" on public.project_milestones;
drop policy if exists "project_milestones update" on public.project_milestones;
drop policy if exists "project_milestones delete" on public.project_milestones;

create policy "project_milestones select" on public.project_milestones for select to authenticated
  using (association_id = current_association_id() and is_bureau());
create policy "project_milestones insert" on public.project_milestones for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "project_milestones update" on public.project_milestones for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "project_milestones delete" on public.project_milestones for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

-- ---------- 7) Index utiles ----------
create index if not exists idx_project_budget_lines_project on public.project_budget_lines(project_id);
create index if not exists idx_project_expenses_project on public.project_expenses(project_id);
create index if not exists idx_project_expenses_budget_line on public.project_expenses(budget_line_id);
create index if not exists idx_project_milestones_project on public.project_milestones(project_id);
