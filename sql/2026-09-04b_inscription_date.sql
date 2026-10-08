-- =====================================================================
-- Adhérents : date de paiement de l'inscription
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- Ajoute une colonne pour enregistrer la date à laquelle un adhérent a
-- payé ses frais d'inscription, distincte de la date d'adhésion
-- (`date_adhesion`, qui reste inchangée). Cette nouvelle date est
-- éditable directement dans l'onglet Inscription (à côté du montant
-- payé) et s'affiche aussi dans l'onglet Adhérents (membres actifs et
-- archivés).
--
-- Ce script ne supprime ni ne modifie aucune donnée existante.
-- =====================================================================

alter table members add column if not exists inscription_date date;
