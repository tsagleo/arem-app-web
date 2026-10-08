-- =====================================================================
-- Nouveau volet Sanctions — barème configurable par association (paliers
-- optionnels), sanctions proposées/appliquées avec validation à deux pour
-- les plus lourdes (réutilise le mécanisme d'approbateur désigné déjà en
-- place pour les suppressions, associations.approbateur_suppression_id).
-- =====================================================================
-- Demande directe de l'utilisateur (2026-09-21), cadrée par
-- AskUserQuestion (format des montants, escalade, catégories par
-- défaut) puis par une précision de l'utilisateur (paliers optionnels,
-- actifs par défaut) — voir le document de projet
-- « proposition-funeraire-sanctions.md », section « Volet Sanctions ».
--
-- Types de sanctions : avertissement (immédiat, sans validation), amende
-- (immédiate sous le seuil de validation, sinon soumise), suspension et
-- exclusion (toujours soumises à validation si un approbateur est
-- désigné et distinct du proposant — sinon, comme pour les suppressions,
-- effectives immédiatement).
--
-- Barème : chaque association définit ses propres catégories de motifs
-- et ses propres montants (sanctions_baremes). Les paliers de récidive
-- (1er/2e/3e manquement et plus) sont ACTIFS PAR DÉFAUT
-- (sanctions_paliers_actifs = true) ; une association peut les désactiver
-- pour revenir à un montant unique par catégorie (palier_1), sans perdre
-- les valeurs déjà saisies dans les paliers 2/3 si elle les réactive plus
-- tard.
-- =====================================================================

-- ---------- Réglages association ----------

alter table public.associations
  add column if not exists sanctions_paliers_actifs boolean not null default true,
  add column if not exists sanctions_seuil_validation numeric not null default 25;

comment on column public.associations.sanctions_paliers_actifs is
  'Si vrai (par défaut), le barème de sanctions distingue 3 paliers de récidive par catégorie (palier_1/2/3) et le Bureau choisit manuellement le palier applicable à chaque sanction. Si faux, un seul montant par catégorie (palier_1) est utilisé, sans notion de récidive. Volet Sanctions.';
comment on column public.associations.sanctions_seuil_validation is
  'Montant d''amende (en dollars) à partir duquel une double validation est exigée (si un approbateur est désigné, associations.approbateur_suppression_id, et distinct du proposant). En dessous, l''amende est effective immédiatement. Les suspensions et exclusions passent toujours par la validation, indépendamment de ce seuil. Volet Sanctions.';

-- ---------- Barème de sanctions (configurable par association) ----------

create table if not exists public.sanctions_baremes (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  categorie text not null,
  palier_1 numeric not null default 0,
  palier_2 numeric not null default 0,
  palier_3 numeric not null default 0,
  ordre integer not null default 0,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.sanctions_baremes is
  'Barème de sanctions propre à chaque association : catégories de motifs et montants par palier de récidive (palier_1 = 1er manquement, etc. — palier_1 sert aussi de montant unique quand sanctions_paliers_actifs est faux). Entièrement configurable par le Bureau. Volet Sanctions, 2026-09-21.';

create index if not exists idx_sanctions_baremes_association on public.sanctions_baremes(association_id, actif, ordre);

alter table public.sanctions_baremes enable row level security;
drop policy if exists "sanctions_baremes select" on sanctions_baremes;
drop policy if exists "sanctions_baremes insert" on sanctions_baremes;
drop policy if exists "sanctions_baremes update" on sanctions_baremes;
drop policy if exists "sanctions_baremes delete" on sanctions_baremes;
create policy "sanctions_baremes select" on sanctions_baremes for select to authenticated
  using (association_id = current_association_id());
create policy "sanctions_baremes insert" on sanctions_baremes for insert to authenticated
  with check (association_id = current_association_id() and is_staff());
create policy "sanctions_baremes update" on sanctions_baremes for update to authenticated
  using (association_id = current_association_id() and is_staff())
  with check (association_id = current_association_id() and is_staff());
create policy "sanctions_baremes delete" on sanctions_baremes for delete to authenticated
  using (association_id = current_association_id() and is_staff());

-- Barème par défaut, raisonnable et universel (proposé à l'utilisateur et
-- validé) : le 1er manquement reste toujours un avertissement sans frais,
-- les montants augmentent ensuite par palier. Seed pour toutes les
-- associations existantes.
insert into public.sanctions_baremes (association_id, categorie, palier_1, palier_2, palier_3, ordre)
select a.id, v.categorie, v.palier_1, v.palier_2, v.palier_3, v.ordre
from public.associations a
cross join (values
  ('Retard de paiement de cotisation', 0, 10, 25, 1),
  ('Absence non justifiée aux assemblées', 0, 15, 30, 2),
  ('Manquement au règlement intérieur', 0, 20, 50, 3),
  ('Comportement inapproprié', 0, 30, 75, 4)
) as v(categorie, palier_1, palier_2, palier_3, ordre)
where not exists (
  select 1 from public.sanctions_baremes b where b.association_id = a.id
);

-- Seed automatique du même barème par défaut pour toute NOUVELLE
-- association créée après ce script, sans dépendre du code applicatif.
create or replace function public.seed_default_sanctions_baremes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sanctions_baremes (association_id, categorie, palier_1, palier_2, palier_3, ordre)
  values
    (new.id, 'Retard de paiement de cotisation', 0, 10, 25, 1),
    (new.id, 'Absence non justifiée aux assemblées', 0, 15, 30, 2),
    (new.id, 'Manquement au règlement intérieur', 0, 20, 50, 3),
    (new.id, 'Comportement inapproprié', 0, 30, 75, 4);
  return new;
end;
$$;

drop trigger if exists trg_seed_sanctions_baremes on public.associations;
create trigger trg_seed_sanctions_baremes
  after insert on public.associations
  for each row execute function public.seed_default_sanctions_baremes();

-- ---------- Sanctions appliquées ----------

create table if not exists public.sanctions (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  type text not null check (type in ('avertissement', 'amende', 'suspension', 'exclusion')),
  bareme_id uuid references public.sanctions_baremes(id) on delete set null,
  categorie_nom text,
  palier integer check (palier in (1, 2, 3)),
  montant numeric,
  motif text not null,
  date_debut date,
  date_fin date,
  statut text not null default 'validee' check (statut in ('proposee', 'validee', 'rejetee', 'annulee')),
  paye boolean not null default false,
  date_paiement date,
  proposee_par uuid references public.profiles(id) on delete set null,
  proposee_par_nom text,
  validee_par uuid references public.profiles(id) on delete set null,
  validee_par_nom text,
  motif_rejet text,
  date_proposition timestamptz not null default now(),
  date_validation timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.sanctions is
  'Sanctions disciplinaires appliquées ou proposées à un adhérent. categorie_nom capture le nom de la catégorie au moment de la sanction (indépendamment d''une modification ultérieure du barème). Une amende validée constitue une obligation de paiement (paye/date_paiement). Volet Sanctions, 2026-09-21.';

create index if not exists idx_sanctions_association on public.sanctions(association_id, member_id);
create index if not exists idx_sanctions_statut on public.sanctions(association_id, statut);

alter table public.sanctions enable row level security;
drop policy if exists "sanctions select" on sanctions;
drop policy if exists "sanctions insert" on sanctions;
drop policy if exists "sanctions update" on sanctions;
drop policy if exists "sanctions delete" on sanctions;
create policy "sanctions select" on sanctions for select to authenticated
  using (association_id = current_association_id() and (is_staff() or member_id = current_member_id()));
create policy "sanctions insert" on sanctions for insert to authenticated
  with check (association_id = current_association_id() and is_staff());
create policy "sanctions update" on sanctions for update to authenticated
  using (association_id = current_association_id() and is_staff())
  with check (association_id = current_association_id() and is_staff());
create policy "sanctions delete" on sanctions for delete to authenticated
  using (association_id = current_association_id() and is_staff());
