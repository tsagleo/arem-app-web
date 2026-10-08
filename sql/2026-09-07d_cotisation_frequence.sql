-- =====================================================================
-- Montant de la Cotisation (ex-Tontine) + fréquence des réunions,
-- configurables par association
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- Deux ajouts à `associations` :
--
-- 1. `tontine_montant_seance` — le montant par séance de Cotisation
--    (ex-Tontine), jusqu'ici fixé à 100 $ directement dans le code.
--    Une valeur NULL (par défaut) continue d'utiliser 100 $, comme
--    avant.
--
-- 2. `frequence_reunions` — la fréquence des réunions du bureau/des
--    membres : 'semaine' (52 séances/an), 'quinzaine' (26/an),
--    'trois_semaines' (17/an) ou 'mois' (12/an, valeur par défaut).
--    Ce réglage détermine combien de séances sont suivies pour la
--    Cotisation (colonnes du tableau) et pour la Collation (colonnes +
--    libellés : noms de mois si "mois", libellés génériques "Semaine
--    1", "Quinzaine 1", etc. sinon). Le montant annuel dû pour la
--    Collation reste inchangé (12 × le montant mensuel configuré) quel
--    que soit le nombre de périodes suivies.
--
-- Compatibilité : une association existante sans ces colonnes renseignées
-- (NULL) garde exactement le même comportement qu'avant ce script — 100 $
-- par séance de Cotisation, fréquence mensuelle, 12 séances/an. Aucune
-- séance déjà enregistrée n'est affectée.
--
-- Ce script ne supprime ni ne modifie aucune donnée existante.
-- =====================================================================

alter table public.associations add column if not exists tontine_montant_seance numeric;
alter table public.associations add column if not exists frequence_reunions text
  check (frequence_reunions is null or frequence_reunions in ('semaine', 'quinzaine', 'trois_semaines', 'mois'));

-- =====================================================================
-- Vérification rapide après exécution :
--   select nom, tontine_montant_seance, frequence_reunions
--   from public.associations;
--   -- les 2 colonnes doivent apparaître (valeurs NULL au départ, c'est
--   -- normal — l'application utilise alors 100 $/séance et la
--   -- fréquence mensuelle).
-- =====================================================================
