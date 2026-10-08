-- =====================================================================
-- Volet Funéraire — programme de rapatriement des dépouilles
-- =====================================================================
-- Suite 70 (2026-09-18). Demande directe de l'utilisateur, structure
-- discutée et validée par étapes (AskUserQuestion) avant construction —
-- voir le document de projet « proposition-funeraire-sanctions.md ».
--
-- Adhésion facultative, distincte de l'adhésion générale à l'association.
-- Deux modes de fonctionnement, choisis par association :
--   - 'evenement' : chaque décès ouvre un dossier, sa quote-part est
--     répartie entre les adhérents inscrits (même mécanisme que les
--     fonds d'urgence/secours, y compris la protection « photo
--     instantanée » : une quote-part payée ne bouge plus).
--   - 'reserve'   : l'inscription alimente une réserve commune ; à
--     chaque décès, une clé de répartition fixe est déduite de cette
--     réserve (pas de facturation individuelle immédiate) ; quand le
--     solde descend sous un seuil, le Bureau lance une campagne de
--     recharge répartie entre tous les adhérents inscrits (y compris le
--     foyer récemment endeuillé, qui participe comme tout le monde).
-- =====================================================================

-- ---------- Configuration au niveau de l'association ----------
alter table public.associations
  add column if not exists funeraire_mode text not null default 'evenement'
    check (funeraire_mode in ('evenement', 'reserve')),
  add column if not exists funeraire_montant_inscription numeric,
  add column if not exists funeraire_montant_deces numeric,
  add column if not exists funeraire_montant_recharge numeric,
  add column if not exists funeraire_seuil_alerte numeric;

comment on column public.associations.funeraire_mode is
  'Mode de fonctionnement du programme funéraire : evenement (répartition à chaque décès) ou reserve (réserve commune gérée par une organisation tierce, décaissée à chaque décès, rechargée par seuil). Suite 70.';

-- ---------- Inscriptions au programme ----------
create table if not exists public.funeraire_inscriptions (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  date_inscription date not null default current_date,
  montant_inscription numeric,
  inscription_payee boolean not null default false,
  date_paiement date,
  statut text not null default 'actif' check (statut in ('actif', 'retire', 'transfere')),
  transfert_association_nom text,
  created_at timestamptz not null default now(),
  unique (association_id, member_id)
);

-- ---------- Bénéficiaires couverts (membres de la famille) ----------
create table if not exists public.funeraire_beneficiaires (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  nom text not null,
  lien_parente text not null,
  date_naissance date,
  created_at timestamptz not null default now()
);

-- ---------- Dossiers de décès / rapatriement ----------
create table if not exists public.funeraire_dossiers (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  beneficiaire_id uuid references public.funeraire_beneficiaires(id) on delete set null,
  nom_defunt text not null,
  date_deces date not null,
  description text,
  mode text not null check (mode in ('evenement', 'reserve')),
  montant numeric not null,
  statut text not null default 'ouvert' check (statut in ('ouvert', 'cloture')),
  nb_actifs_snapshot integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Quotes-parts (dossier en mode événement, ou campagne de recharge en mode réserve) ----------
create table if not exists public.funeraire_recouvrements (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  dossier_id uuid references public.funeraire_dossiers(id) on delete cascade,
  recharge_id uuid,
  member_id uuid not null references public.members(id) on delete cascade,
  quote_part numeric not null,
  paye boolean not null default false,
  date_paiement date,
  created_at timestamptz not null default now()
);

-- ---------- Journal de la réserve commune (mode réserve uniquement) ----------
create table if not exists public.funeraire_reserve_mouvements (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  type text not null check (type in ('depot_inscription', 'depot_recharge', 'deduction_deces')),
  montant numeric not null,
  member_id uuid references public.members(id) on delete set null,
  dossier_id uuid references public.funeraire_dossiers(id) on delete set null,
  description text,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- RLS — même schéma que le reste de l'application : lecture ouverte à
-- l'association (transparence, comme fonds_recouvrements/documents),
-- écritures réservées au Bureau (is_staff()) sauf pour les gestes en
-- libre-service de l'adhérent sur SA PROPRE inscription et SES PROPRES
-- bénéficiaires (member_id = current_member_id()) — le marquage des
-- montants comme "payés" reste restreint côté interface au Bureau,
-- comme pour les autres rubriques financières (ex. inscription_paye).
-- =====================================================================

alter table public.funeraire_inscriptions enable row level security;
drop policy if exists "funeraire_inscriptions select" on funeraire_inscriptions;
drop policy if exists "funeraire_inscriptions insert" on funeraire_inscriptions;
drop policy if exists "funeraire_inscriptions update" on funeraire_inscriptions;
drop policy if exists "funeraire_inscriptions delete" on funeraire_inscriptions;
create policy "funeraire_inscriptions select" on funeraire_inscriptions for select to authenticated
  using (association_id = current_association_id());
create policy "funeraire_inscriptions insert" on funeraire_inscriptions for insert to authenticated
  with check (association_id = current_association_id() and (is_staff() or member_id = current_member_id()));
create policy "funeraire_inscriptions update" on funeraire_inscriptions for update to authenticated
  using (association_id = current_association_id() and (is_staff() or member_id = current_member_id()))
  with check (association_id = current_association_id() and (is_staff() or member_id = current_member_id()));
create policy "funeraire_inscriptions delete" on funeraire_inscriptions for delete to authenticated
  using (association_id = current_association_id() and is_staff());

alter table public.funeraire_beneficiaires enable row level security;
drop policy if exists "funeraire_beneficiaires select" on funeraire_beneficiaires;
drop policy if exists "funeraire_beneficiaires insert" on funeraire_beneficiaires;
drop policy if exists "funeraire_beneficiaires update" on funeraire_beneficiaires;
drop policy if exists "funeraire_beneficiaires delete" on funeraire_beneficiaires;
create policy "funeraire_beneficiaires select" on funeraire_beneficiaires for select to authenticated
  using (association_id = current_association_id());
create policy "funeraire_beneficiaires insert" on funeraire_beneficiaires for insert to authenticated
  with check (association_id = current_association_id() and (is_staff() or member_id = current_member_id()));
create policy "funeraire_beneficiaires update" on funeraire_beneficiaires for update to authenticated
  using (association_id = current_association_id() and (is_staff() or member_id = current_member_id()))
  with check (association_id = current_association_id() and (is_staff() or member_id = current_member_id()));
create policy "funeraire_beneficiaires delete" on funeraire_beneficiaires for delete to authenticated
  using (association_id = current_association_id() and (is_staff() or member_id = current_member_id()));

alter table public.funeraire_dossiers enable row level security;
drop policy if exists "funeraire_dossiers select" on funeraire_dossiers;
drop policy if exists "funeraire_dossiers insert" on funeraire_dossiers;
drop policy if exists "funeraire_dossiers update" on funeraire_dossiers;
drop policy if exists "funeraire_dossiers delete" on funeraire_dossiers;
create policy "funeraire_dossiers select" on funeraire_dossiers for select to authenticated
  using (association_id = current_association_id());
create policy "funeraire_dossiers insert" on funeraire_dossiers for insert to authenticated
  with check (association_id = current_association_id() and is_staff());
create policy "funeraire_dossiers update" on funeraire_dossiers for update to authenticated
  using (association_id = current_association_id() and is_staff())
  with check (association_id = current_association_id() and is_staff());
create policy "funeraire_dossiers delete" on funeraire_dossiers for delete to authenticated
  using (association_id = current_association_id() and is_staff());

alter table public.funeraire_recouvrements enable row level security;
drop policy if exists "funeraire_recouvrements select" on funeraire_recouvrements;
drop policy if exists "funeraire_recouvrements insert" on funeraire_recouvrements;
drop policy if exists "funeraire_recouvrements update" on funeraire_recouvrements;
drop policy if exists "funeraire_recouvrements delete" on funeraire_recouvrements;
create policy "funeraire_recouvrements select" on funeraire_recouvrements for select to authenticated
  using (association_id = current_association_id());
create policy "funeraire_recouvrements insert" on funeraire_recouvrements for insert to authenticated
  with check (association_id = current_association_id() and is_staff());
create policy "funeraire_recouvrements update" on funeraire_recouvrements for update to authenticated
  using (association_id = current_association_id() and is_staff())
  with check (association_id = current_association_id() and is_staff());
create policy "funeraire_recouvrements delete" on funeraire_recouvrements for delete to authenticated
  using (association_id = current_association_id() and is_staff());

alter table public.funeraire_reserve_mouvements enable row level security;
drop policy if exists "funeraire_reserve_mouvements select" on funeraire_reserve_mouvements;
drop policy if exists "funeraire_reserve_mouvements insert" on funeraire_reserve_mouvements;
create policy "funeraire_reserve_mouvements select" on funeraire_reserve_mouvements for select to authenticated
  using (association_id = current_association_id());
create policy "funeraire_reserve_mouvements insert" on funeraire_reserve_mouvements for insert to authenticated
  with check (association_id = current_association_id() and is_staff());
-- Pas de update/delete : le journal de la réserve est immuable, comme les
-- accusés de réception (suite 64) — « c'est la preuve elle-même ».
