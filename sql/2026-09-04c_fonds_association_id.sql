-- =====================================================================
-- Fonds urgence / Fonds secours : colonne association_id manquante
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- Même problème que pour tontine_seances (voir 2026-09-04_tontine_
-- seances_association_id.sql) : les tables fonds_depenses et
-- fonds_recouvrements n'ont jamais eu de colonne association_id, alors
-- que le code de l'application l'envoie à chaque enregistrement d'une
-- nouvelle dépense (Fonds urgence / Fonds secours). D'où l'erreur :
-- "Could not find the 'association_id' column of 'fonds_depenses' in
-- the schema cache".
--
-- Ce script ajoute la colonne sur les deux tables et tente un backfill
-- automatique des lignes existantes uniquement si une seule association
-- existe dans le système (cas du compte de test AREM). Il ne supprime
-- ni ne modifie aucune autre donnée existante.
-- =====================================================================

alter table fonds_depenses add column if not exists association_id uuid references associations(id);
alter table fonds_recouvrements add column if not exists association_id uuid references associations(id);

-- Backfill uniquement si une seule association existe (sans risque d'affecter la mauvaise association)
update fonds_depenses
set association_id = (select id from associations limit 1)
where association_id is null and (select count(*) from associations) = 1;

update fonds_recouvrements
set association_id = (select id from associations limit 1)
where association_id is null and (select count(*) from associations) = 1;

-- Vérification : doit afficher 0 ligne sans association_id (si une seule association existe)
select count(*) as depenses_sans_association from fonds_depenses where association_id is null;
select count(*) as recouvrements_sans_association from fonds_recouvrements where association_id is null;
