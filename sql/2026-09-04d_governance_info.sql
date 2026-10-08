-- =====================================================================
-- Gouvernance : table "governance_info" (Vision / Mission / Valeurs)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- Le bouton "Enregistrer" de l'onglet Gouvernance utilise un "upsert"
-- (insertion ou mise à jour) basé sur la colonne association_id. Cela
-- exige une contrainte UNIQUE sur cette colonne — sans elle, Supabase
-- refuse l'enregistrement. La table n'existait pas encore du tout
-- (confirmé : Supabase a proposé de la créer sans RLS lors du premier
-- essai), d'où l'échec silencieux du bouton "Enregistrer".
--
-- Ce script :
--   1. Crée la table avec les colonnes attendues par l'application.
--   2. Ajoute la contrainte UNIQUE sur association_id (nécessaire pour
--      l'upsert), que la table soit nouvellement créée ou déjà existante.
--   3. Active la sécurité au niveau des lignes (RLS) et lui applique
--      EXACTEMENT la même règle "accès complet" déjà utilisée par
--      toutes les autres tables de cette application (confirmé via
--      pg_policies sur members et fonds_depenses : ALL / public /
--      true / true) — pour que governance_info se comporte de façon
--      cohérente avec le reste de l'app, ni plus ni moins restrictive.
--
-- Il ne supprime ni ne modifie aucune donnée existante.
--
-- ⚠️ Note de sécurité (déjà vraie pour toutes les autres tables de
-- cette application, pas une régression introduite ici) : cette règle
-- "accès complet" ne filtre pas réellement par association au niveau
-- de la base de données — le cloisonnement entre associations repose
-- entièrement sur le code de l'application, pas sur des politiques RLS
-- restrictives. Si plusieurs associations utilisent un jour cette
-- plateforme, il serait recommandé de revoir cela avec un développeur
-- pour des politiques RLS réellement scopées par association_id.
-- =====================================================================

create table if not exists governance_info (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id),
  vision text,
  mission text,
  valeurs text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'governance_info_association_id_key'
  ) then
    alter table governance_info add constraint governance_info_association_id_key unique (association_id);
  end if;
end $$;

alter table governance_info enable row level security;

drop policy if exists "accès complet - governance_info" on governance_info;
create policy "accès complet - governance_info" on governance_info
  for all
  to public
  using (true)
  with check (true);

-- Vérification : doit s'exécuter sans erreur (peut renvoyer 0 ligne si
-- c'est la première tentative d'enregistrement).
select * from governance_info;
