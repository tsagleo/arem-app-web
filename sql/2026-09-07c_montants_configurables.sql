-- =====================================================================
-- Montants et cotisations configurables par association
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- Jusqu'ici, les montants d'inscription (25 $), de fonds d'urgence
-- (25 $/an), de fonds de secours (200 $) et de collation (10 $/mois)
-- étaient fixés directement dans le code de l'application (pareils pour
-- toutes les associations). Ce script ajoute 4 colonnes à `associations`
-- pour que chaque association puisse fixer ses propres montants depuis
-- Configuration → « Montants et cotisations ».
--
-- Compatibilité : une valeur NULL (ou absente) continue d'utiliser
-- exactement les mêmes valeurs par défaut qu'avant (25 $ / 25 $ / 200 $ /
-- 10 $) — aucune association existante n'est affectée tant que le
-- président ne renseigne pas ces champs.
--
-- Ce script ne supprime ni ne modifie aucune donnée existante.
-- =====================================================================

alter table public.associations add column if not exists inscription_montant numeric;
alter table public.associations add column if not exists fonds_urgence_montant numeric;
alter table public.associations add column if not exists fonds_secours_montant numeric;
alter table public.associations add column if not exists collation_montant_mensuel numeric;

-- =====================================================================
-- Vérification rapide après exécution :
--   select nom, inscription_montant, fonds_urgence_montant,
--          fonds_secours_montant, collation_montant_mensuel
--   from public.associations;
--   -- les 4 colonnes doivent apparaître (valeurs NULL au départ, c'est
--   -- normal — l'application utilise alors les valeurs par défaut).
-- =====================================================================
