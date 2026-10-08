-- =====================================================================
-- Refonte n°2 du volet Funéraire — sous-rubriques cumulables (Main levée
-- + Organisme tiers), réserve individuelle par adhérent, alerte à deux
-- paliers avec suspension automatique, période de probation, et volet
-- d'annonces scopé au plan Organisme tiers
-- =====================================================================
-- Suite 75 (2026-09-21), demande directe de l'utilisateur, cadrée par
-- deux rounds d'AskUserQuestion — voir le document de projet
-- « proposition-funeraire-sanctions.md », section « Refonte n°2 du volet
-- Funéraire ». S'applique par-dessus sql/2026-09-21_funeraire_refonte.sql
-- (encore en attente d'exécution au moment de l'écriture de ce script —
-- aucune donnée réelle à migrer).
--
-- A) Les deux plans (Main levée / Organisme tiers) deviennent deux
--    sous-rubriques indépendantes et cumulables, plutôt qu'un choix
--    unique associations.funeraire_mode. Une association peut activer
--    l'un, l'autre, ou les deux à la fois — au moins un des deux doit
--    rester actif. Un même dossier de décès peut désormais déclencher
--    les deux plans en même temps : la colonne funeraire_dossiers.mode
--    (verrouillée sur une seule valeur) est remplacée par deux
--    indicateurs par dossier, et funeraire_dossiers.montant (une seule
--    valeur pour les deux usages) est remplacé par deux colonnes
--    distinctes (montant suggéré / clé de répartition).
--
-- B) Organisme tiers : la réserve commune partagée (un seul pot par
--    association, funeraire_reserve_mouvements) est remplacée par une
--    réserve INDIVIDUELLE par adhérent (nouvelle table
--    funeraire_reserve_individuelle_mouvements). À chaque décès, la clé
--    de répartition communiquée par l'organisme tiers est débitée du
--    solde individuel de CHAQUE adhérent inscrit, payé, hors probation
--    et non suspendu (calcul côté application, plafonné pour ne jamais
--    descendre sous zéro). L'ancienne table funeraire_reserve_mouvements
--    n'est plus alimentée par ce plan mais reste en base, intacte.
--    Jamais de solde négatif : alerte visuelle sous un seuil, puis
--    suspension automatique du plan Organisme tiers à solde zéro — la
--    suspension ne se lève qu'une fois le solde remonté AU-DESSUS DU
--    SEUIL D'ALERTE lui-même (pas simplement au-dessus de zéro), comme
--    précisé par l'utilisateur.
--
-- C) Rapports et états imprimables/transférables aux ayants droit :
--    aucun changement de schéma — réutilise le patron déjà en place
--    (Décharge, Reçus, PV : vue imprimable côté client, window.print(),
--    aucune librairie PDF).
--
-- D) Volet d'annonces spécifique à Funéraire, restreint aux adhérents
--    ayant une inscription active au plan Organisme tiers uniquement —
--    nouvelle table funeraire_annonces.
-- =====================================================================

-- ---------- A) Configuration association : deux plans indépendants ----------

alter table public.associations
  add column if not exists funeraire_main_levee_actif boolean not null default true,
  add column if not exists funeraire_organisme_tiers_actif boolean not null default false,
  add column if not exists funeraire_periode_probation_jours integer;

-- Migration douce depuis l'ancien choix unique funeraire_mode (si la colonne
-- existe déjà, script sql/2026-09-18b_funeraire.sql) : préserve le
-- comportement déjà en place pour les associations existantes plutôt que
-- d'activer silencieusement les deux plans. Sans effet si funeraire_mode
-- n'existe pas encore (l'exécution de ce script ne dépend d'aucun ordre
-- particulier vis-à-vis des scripts funéraire non encore exécutés).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'associations' and column_name = 'funeraire_mode') then
    update public.associations
      set funeraire_organisme_tiers_actif = true, funeraire_main_levee_actif = false
      where funeraire_mode = 'reserve';
  end if;
end $$;

alter table public.associations
  drop constraint if exists associations_funeraire_au_moins_un_plan_check;
alter table public.associations
  add constraint associations_funeraire_au_moins_un_plan_check
    check (funeraire_main_levee_actif or funeraire_organisme_tiers_actif);

comment on column public.associations.funeraire_main_levee_actif is
  'Sous-rubrique Main levée (collecte de solidarité, gérée par l''association elle-même) activée pour cette association. Refonte n°2, suite 75.';
comment on column public.associations.funeraire_organisme_tiers_actif is
  'Sous-rubrique Organisme tiers (association mère, réserve individuelle par adhérent) activée pour cette association. Refonte n°2, suite 75.';
comment on column public.associations.funeraire_periode_probation_jours is
  'Nombre de jours d''attente après le paiement de l''inscription au programme funéraire avant qu''un adhérent soit pleinement éligible au plan Organisme tiers (compté depuis funeraire_inscriptions.date_paiement — même convention que periode_probation_secours_jours pour le Fonds de secours). NULL ou 0 = aucune probation. Refonte n°2, suite 75.';

-- ---------- A) funeraire_dossiers : montant et mode éclatés en deux plans ----------

alter table public.funeraire_dossiers
  drop constraint if exists funeraire_dossiers_mode_check;
alter table public.funeraire_dossiers
  alter column mode drop not null;

alter table public.funeraire_dossiers
  add column if not exists montant_suggere numeric,
  add column if not exists montant_cle_repartition numeric;

comment on column public.funeraire_dossiers.mode is
  'Conservée pour compatibilité avec les dossiers créés avant la refonte n°2 (une seule valeur evenement/reserve). Plus jamais écrite par l''application depuis le 2026-09-21 : un même dossier peut désormais concerner les deux plans à la fois, voir montant_suggere/montant_cle_repartition.';
comment on column public.funeraire_dossiers.montant is
  'Conservée pour compatibilité avec les dossiers créés avant la refonte n°2. Plus jamais écrite par l''application depuis le 2026-09-21 — remplacée par montant_suggere (Main levée) et montant_cle_repartition (Organisme tiers), qui peuvent désormais coexister sur un même dossier.';
comment on column public.funeraire_dossiers.montant_suggere is
  'Plan Main levée : montant SUGGÉRÉ pour la collecte de solidarité sur ce dossier, purement indicatif, jamais obligatoire. NULL si le plan Main levée n''est pas actif pour l''association. Refonte n°2, suite 75.';
comment on column public.funeraire_dossiers.montant_cle_repartition is
  'Plan Organisme tiers : clé de répartition communiquée par l''organisme tiers pour ce décès précis, saisie par le Bureau à l''ouverture du dossier, appliquée en déduction du solde individuel de chaque adhérent inscrit/payé/hors probation/non suspendu. NULL si le plan Organisme tiers n''est pas actif pour l''association. Refonte n°2, suite 75.';

-- ---------- B) Réserve individuelle par adhérent (remplace la réserve commune) ----------

create table if not exists public.funeraire_reserve_individuelle_mouvements (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  type text not null check (type in ('depot', 'application_cle')),
  montant numeric not null,
  dossier_id uuid references public.funeraire_dossiers(id) on delete set null,
  description text,
  date_mouvement date not null default current_date,
  created_at timestamptz not null default now()
);

comment on table public.funeraire_reserve_individuelle_mouvements is
  'Journal des mouvements de la réserve individuelle de chaque adhérent inscrit au plan Organisme tiers : dépôts (recharge, montant positif, enregistrés par le Bureau) et applications de la clé de répartition à un décès (montant négatif, plafonné pour ne jamais faire descendre le solde sous zéro). Remplace funeraire_reserve_mouvements (réserve commune partagée) pour ce plan. Refonte n°2, suite 75.';

create index if not exists idx_funeraire_reserve_indiv_member on public.funeraire_reserve_individuelle_mouvements(association_id, member_id);
create index if not exists idx_funeraire_reserve_indiv_dossier on public.funeraire_reserve_individuelle_mouvements(dossier_id);

alter table public.funeraire_reserve_individuelle_mouvements enable row level security;
drop policy if exists "funeraire_reserve_individuelle_mouvements select" on funeraire_reserve_individuelle_mouvements;
drop policy if exists "funeraire_reserve_individuelle_mouvements insert" on funeraire_reserve_individuelle_mouvements;
create policy "funeraire_reserve_individuelle_mouvements select" on funeraire_reserve_individuelle_mouvements for select to authenticated
  using (association_id = current_association_id());
create policy "funeraire_reserve_individuelle_mouvements insert" on funeraire_reserve_individuelle_mouvements for insert to authenticated
  with check (association_id = current_association_id() and is_staff());
-- Pas de update/delete : journal immuable, comme funeraire_reserve_mouvements
-- — « c'est la preuve elle-même » (même principe que les accusés de
-- réception, suite 64).

-- ---------- B) Suspension du plan Organisme tiers (scopée à ce plan uniquement) ----------

alter table public.funeraire_inscriptions
  add column if not exists suspendu boolean not null default false;

comment on column public.funeraire_inscriptions.suspendu is
  'Adhérent automatiquement suspendu du plan Organisme tiers (exclu du groupe débité au prochain décès) car son solde de réserve individuel a atteint zéro. Se lève automatiquement dès que son solde remonte au-dessus du seuil d''alerte (funeraire_seuil_alerte), pas simplement au-dessus de zéro. Scopée à ce plan uniquement — distincte de profiles.compte_bloque (suite 37). Refonte n°2, suite 75.';

-- ---------- D) Volet d'annonces spécifique au plan Organisme tiers ----------

create table if not exists public.funeraire_annonces (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  titre text not null,
  contenu text not null,
  auteur_id uuid,
  auteur_nom text,
  statut text not null default 'active' check (statut in ('active', 'archivee')),
  created_at timestamptz not null default now()
);

comment on table public.funeraire_annonces is
  'Annonces propres au volet Funéraire, rédigées par le Bureau, visibles uniquement par les adhérents ayant une inscription active au plan Organisme tiers (et par le Bureau, qui gère). Demande directe de l''utilisateur : « volet de communication des annonces... uniquement accessible par ceux qui y font partie » — audience confirmée via AskUserQuestion. Refonte n°2, suite 75.';

create index if not exists idx_funeraire_annonces_association on public.funeraire_annonces(association_id, statut);

alter table public.funeraire_annonces enable row level security;
drop policy if exists "funeraire_annonces select" on funeraire_annonces;
drop policy if exists "funeraire_annonces insert" on funeraire_annonces;
drop policy if exists "funeraire_annonces update" on funeraire_annonces;
drop policy if exists "funeraire_annonces delete" on funeraire_annonces;
create policy "funeraire_annonces select" on funeraire_annonces for select to authenticated
  using (
    association_id = current_association_id()
    and (
      is_staff()
      or exists (
        select 1 from public.funeraire_inscriptions fi
        where fi.association_id = funeraire_annonces.association_id
          and fi.member_id = current_member_id()
          and fi.statut = 'actif'
      )
    )
  );
create policy "funeraire_annonces insert" on funeraire_annonces for insert to authenticated
  with check (association_id = current_association_id() and is_staff());
create policy "funeraire_annonces update" on funeraire_annonces for update to authenticated
  using (association_id = current_association_id() and is_staff())
  with check (association_id = current_association_id() and is_staff());
create policy "funeraire_annonces delete" on funeraire_annonces for delete to authenticated
  using (association_id = current_association_id() and is_staff());
