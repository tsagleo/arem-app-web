-- =====================================================================
-- Compte personnel lié (bascule rapide bureau → compte personnel)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- LE CONTEXTE : à la demande de l'utilisateur, on abandonne l'idée de
-- fusionner "Mon espace" dans le compte bureau (risque de succession —
-- si quelqu'un d'autre reprend un rôle de bureau plus tard, il ne doit
-- jamais hériter de l'accès aux informations personnelles de la personne
-- précédente). À la place : un membre du bureau/responsable qui a AUSSI
-- un compte adhérent séparé (autre adresse courriel) peut enregistrer
-- cette adresse sur SON compte bureau précis, pour y basculer vite depuis
-- le menu (bouton juste avant "Déconnexion"). Chaque bascule redemande le
-- mot de passe du compte personnel — aucune session ni mot de passe
-- n'est stocké, seulement cette adresse de confort.
--
-- CE QUE FAIT CE SCRIPT : ajoute une seule colonne, vide par défaut, sans
-- aucun effet sur les données existantes. Sans danger à exécuter
-- plusieurs fois (IF NOT EXISTS).
-- =====================================================================

alter table public.profiles
  add column if not exists compte_personnel_email text;

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'profiles'
--     and column_name = 'compte_personnel_email';
--   -- doit renvoyer une ligne
-- =====================================================================
