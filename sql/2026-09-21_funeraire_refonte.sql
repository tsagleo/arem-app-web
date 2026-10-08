-- =====================================================================
-- Refonte du volet Funéraire — main levée (Mode 1) et clé de répartition
-- variable (Mode 2)
-- =====================================================================
-- Demande directe de l'utilisateur (2026-09-21), cadrée par 4 questions
-- (AskUserQuestion) avant construction — voir le document de projet
-- « proposition-funeraire-sanctions.md », section « Refonte du volet
-- Funéraire ».
--
-- MODE 1 — « evenement » (géré par l'association elle-même) : la
-- quote-part obligatoire est remplacée par une collecte de solidarité
-- (main levée). Plus aucun montant n'est dû par personne :
--   - tous les adhérents de l'association peuvent contribuer (pas
--     seulement les inscrits au programme funéraire) ;
--   - le montant du dossier devient un simple montant SUGGÉRÉ, purement
--     indicatif, jamais obligatoire (colonne existante `montant`, rendue
--     nullable) ;
--   - chaque contribution est un don libre et nominatif, enregistré dans
--     la nouvelle table `funeraire_contributions` — remplace
--     `funeraire_recouvrements` pour ce mode (plus de dette/retard/
--     relance à gérer).
--
-- MODE 2 — « reserve » (organisme tiers / association mère) : conserve la
-- réserve locale déjà en place (alimentée par recharge, décaissée à
-- chaque décès, seuil d'alerte) mais le montant décaissé à chaque décès
-- (la « clé de répartition ») n'est plus une valeur unique préconfigurée
-- — elle est communiquée par l'organisme tiers et varie d'un décès à
-- l'autre, donc désormais SAISIE PAR LE BUREAU à l'ouverture de chaque
-- dossier (même colonne `montant`, simplement plus verrouillée). Le champ
-- de configuration `funeraire_montant_deces` reste disponible comme
-- valeur suggérée par défaut préremplie dans le formulaire, mais n'est
-- plus jamais appliqué automatiquement ni bloquant.
--
-- Éligibilité (Mode 2 uniquement) : seuls les adhérents inscrits ET dont
-- l'inscription est marquée payée participent désormais aux campagnes de
-- recharge — géré côté application (filtre sur `inscription_payee`),
-- aucun changement de schéma nécessaire pour ce point.
--
-- Versement à la famille : réutilise le modèle déjà en place pour la
-- cagnotte Cotisation/Collation (suite 56, `tontine_seances.versement_*`)
-- — méthode, montant, date, référence, preuve — appliqué ici aux deux
-- modes sur `funeraire_dossiers`.
-- =====================================================================

-- ---------- 1) funeraire_dossiers : montant libre + versement à la famille ----------

alter table public.funeraire_dossiers
  alter column montant drop not null;

alter table public.funeraire_dossiers
  add column if not exists versement_methode text check (versement_methode in ('interac', 'stripe', 'manuel')),
  add column if not exists versement_montant numeric,
  add column if not exists versement_date date,
  add column if not exists versement_reference text,
  add column if not exists versement_preuve_path text;

comment on column public.funeraire_dossiers.montant is
  'Mode evenement : montant SUGGÉRÉ pour la collecte de solidarité (main levée), purement indicatif, jamais obligatoire, librement modifiable. Mode reserve : clé de répartition communiquée par l''organisme tiers pour ce décès précis, saisie par le Bureau à l''ouverture du dossier (valeur suggérée par défaut : associations.funeraire_montant_deces), décaissée de la réserve locale. Refonte 2026-09-21 — remplace l''ancien modèle à montant unique verrouillé.';
comment on column public.funeraire_dossiers.versement_methode is
  'Méthode utilisée par le Bureau pour reverser les fonds (récoltés en mode evenement, ou décaissés de la réserve en mode reserve) au foyer endeuillé. Refonte 2026-09-21.';

-- ---------- 2) Nouvelle table : contributions libres (main levée, Mode 1) ----------

create table if not exists public.funeraire_contributions (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  dossier_id uuid not null references public.funeraire_dossiers(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  montant numeric not null check (montant > 0),
  methode text not null default 'manuel' check (methode in ('interac', 'stripe', 'manuel')),
  reference text,
  preuve_path text,
  date_contribution date not null default current_date,
  created_at timestamptz not null default now()
);

comment on table public.funeraire_contributions is
  'Contributions volontaires (main levée / collecte de solidarité) à un dossier de décès en mode "evenement". Remplace la quote-part obligatoire : rien n''est dû, chaque ligne est un don libre et nominatif enregistré par le Bureau. Refonte 2026-09-21.';

create index if not exists idx_funeraire_contributions_dossier on public.funeraire_contributions(dossier_id);

alter table public.funeraire_contributions enable row level security;
drop policy if exists "funeraire_contributions select" on funeraire_contributions;
drop policy if exists "funeraire_contributions insert" on funeraire_contributions;
drop policy if exists "funeraire_contributions update" on funeraire_contributions;
drop policy if exists "funeraire_contributions delete" on funeraire_contributions;
create policy "funeraire_contributions select" on funeraire_contributions for select to authenticated
  using (association_id = current_association_id());
create policy "funeraire_contributions insert" on funeraire_contributions for insert to authenticated
  with check (association_id = current_association_id() and is_staff());
create policy "funeraire_contributions update" on funeraire_contributions for update to authenticated
  using (association_id = current_association_id() and is_staff())
  with check (association_id = current_association_id() and is_staff());
create policy "funeraire_contributions delete" on funeraire_contributions for delete to authenticated
  using (association_id = current_association_id() and is_staff());
