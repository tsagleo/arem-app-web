-- =====================================================================
-- Légendes enrichies de la galerie (titre + description + lien) — 2026-10-06
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Idempotent.
--
-- LE CONTEXTE : la table association_photos avait déjà une colonne
-- "legende" (voir sql/2026-10-06_galerie_photos_association.sql) mais
-- AUCUN écran ne permettait de la renseigner — le diaporama l'affichait
-- déjà (en surimpression en bas de l'image) mais elle restait toujours
-- vide en pratique. À la demande de l'utilisateur : chaque photo peut
-- maintenant avoir un texte de présentation complet (ce qu'elle montre,
-- quel événement...), affiché dans un nouveau panneau latéral du
-- diaporama plutôt qu'en simple surimpression. Conçu dès maintenant pour
-- rester utile si l'association veut aussi s'en servir plus tard pour
-- présenter un produit ou une entreprise membre (texte + lien "En savoir
-- plus") — sans construire un module de promotion séparé pour l'instant,
-- seulement les deux colonnes qui le permettront le jour venu.
--
-- CE QUE FAIT CE SCRIPT : ajoute trois colonnes, toutes vides par défaut,
-- sans aucun effet sur les photos déjà en place.
-- =====================================================================

alter table public.association_photos
  add column if not exists description text,
  add column if not exists lien_url text,
  add column if not exists lien_label text;

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'association_photos'
--     and column_name in ('description', 'lien_url', 'lien_label');
--   -- doit renvoyer 3 lignes
-- =====================================================================
