-- =====================================================================
-- Approbation des suppressions financières + période de probation
-- (fonds de secours)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois), APRÈS le script
-- 2026-09-04e_multi_tenant_rls.sql (celui-ci réutilise les fonctions
-- current_association_id()/is_bureau() qu'il définit).
--
-- CE QUE CE SCRIPT AJOUTE :
--   1. Deux nouveaux réglages sur `associations` :
--      - approbateur_suppression_id : la personne du bureau désignée pour
--        approuver la suppression d'une transaction financière déjà
--        enregistrée. NULL par défaut = aucune approbation requise
--        (comportement actuel, suppression immédiate).
--      - periode_probation_secours_jours : nombre de jours de probation,
--        comptés depuis la date d'adhésion, avant qu'un adhérent ne soit
--        soumis au recouvrement d'une dépense du FONDS DE SECOURS
--        uniquement (le fonds d'urgence n'est pas concerné). NULL/0 par
--        défaut = pas de probation : le recouvrement démarre dès que
--        l'adhérent a payé son fonds de secours.
--   2. Une nouvelle table `deletion_requests` : quand quelqu'un d'autre
--      que la personne désignée supprime une dépense de fonds, un don, un
--      prêt, ou une séance de tontine/collation, l'application crée une
--      ligne ici au lieu de supprimer immédiatement — visible dans le
--      nouvel onglet "Demandes de suppression", que seule la personne
--      désignée peut approuver (ce qui déclenche alors la vraie
--      suppression) ou rejeter.
--
-- Ce script ne supprime ni ne modifie aucune donnée existante. Les deux
-- nouveaux réglages sont NULL pour toutes les associations existantes —
-- rien ne change tant que vous ne les configurez pas dans l'onglet
-- Configuration.
-- =====================================================================

alter table associations add column if not exists approbateur_suppression_id uuid references profiles(id);
alter table associations add column if not exists periode_probation_secours_jours integer;

create table if not exists deletion_requests (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id),
  table_name text not null,
  record_id uuid not null,
  contexte jsonb,
  description text not null,
  requested_by uuid not null references profiles(id),
  requested_by_nom text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'approuvee', 'rejetee')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  motif_rejet text,
  created_at timestamptz not null default now()
);

alter table deletion_requests enable row level security;

drop policy if exists "deletion_requests select" on deletion_requests;
drop policy if exists "deletion_requests insert" on deletion_requests;
drop policy if exists "deletion_requests update" on deletion_requests;
drop policy if exists "deletion_requests delete" on deletion_requests;

-- Tout le bureau de l'association voit la file (transparence), même si
-- seule la personne désignée peut approuver/rejeter.
create policy "deletion_requests select" on deletion_requests for select to authenticated
  using (association_id = current_association_id() and is_bureau());

create policy "deletion_requests insert" on deletion_requests for insert to authenticated
  with check (association_id = current_association_id() and is_bureau() and requested_by = auth.uid());

-- Seule la personne désignée comme approbateur pour cette association peut
-- faire passer une demande de "en_attente" à "approuvee"/"rejetee".
create policy "deletion_requests update" on deletion_requests for update to authenticated
  using (
    association_id = current_association_id() and is_bureau()
    and exists (select 1 from associations a where a.id = deletion_requests.association_id and a.approbateur_suppression_id = auth.uid())
  )
  with check (
    association_id = current_association_id() and is_bureau()
    and exists (select 1 from associations a where a.id = deletion_requests.association_id and a.approbateur_suppression_id = auth.uid())
  );

-- Permet à l'auteur d'une demande encore en attente de la retirer, ou à
-- l'approbateur désigné de nettoyer la liste.
create policy "deletion_requests delete" on deletion_requests for delete to authenticated
  using (
    association_id = current_association_id() and is_bureau()
    and (
      (requested_by = auth.uid() and statut = 'en_attente')
      or exists (select 1 from associations a where a.id = deletion_requests.association_id and a.approbateur_suppression_id = auth.uid())
    )
  );

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns where table_name = 'associations' and column_name in ('approbateur_suppression_id', 'periode_probation_secours_jours');
--   select tablename, policyname, cmd from pg_policies where tablename = 'deletion_requests' order by cmd;
-- Les deux doivent lister respectivement 2 colonnes et 4 politiques.
-- =====================================================================
