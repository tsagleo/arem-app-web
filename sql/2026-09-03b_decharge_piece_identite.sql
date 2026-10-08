-- =====================================================================
-- Décharge de tontine : numéro de pièce d'identité du bénéficiaire
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- Ajoute une colonne texte pour enregistrer le numéro de permis de
-- conduire ou de carte d'identité du bénéficiaire, saisi directement
-- dans la fenêtre "Décharge" de l'onglet Tontine.
-- =====================================================================

alter table tontine_seances add column if not exists beneficiaire_piece_identite text;
