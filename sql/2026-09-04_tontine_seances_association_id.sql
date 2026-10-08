-- =====================================================================
-- Tontine / Collation : colonne association_id manquante sur tontine_seances
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- Erreur rencontrée : « Could not find the 'association_id' column of
-- 'tontine_seances' in the schema cache » lors d'un clic sur « Attribuer »
-- (Tontine ou Collation).
--
-- Cause : contrairement à presque toutes les autres tables de
-- l'application (members, documents, announcements, donations, etc.),
-- la table `tontine_seances` n'a jamais eu de colonne `association_id`.
-- Le code de l'application envoie pourtant cette valeur à chaque
-- attribution (comme pour toutes les autres tables) — d'où l'erreur.
--
-- Ce script ajoute la colonne manquante. Il tente aussi de la remplir
-- automatiquement pour vos séances déjà existantes, mais UNIQUEMENT si
-- vous n'avez qu'une seule association enregistrée dans le système
-- (c'est le cas pour un compte de test comme AREM) — dans le cas
-- contraire, par prudence, le script ne devine pas à quelle association
-- chaque ancienne ligne appartient et les laisse à `null` (cela n'a
-- aucun impact visible : ces anciennes séances continueront de
-- s'afficher normalement).
-- =====================================================================

alter table tontine_seances add column if not exists association_id uuid references associations(id);

update tontine_seances
set association_id = (select id from associations limit 1)
where association_id is null
  and (select count(*) from associations) = 1;

-- =====================================================================
-- Vérification rapide après exécution :
--   select id, type, mois, numero, association_id from tontine_seances order by created_at;
--
-- Si l'erreur persiste après avoir exécuté ce script, rechargez la page
-- de l'application (F5) — Supabase met parfois quelques secondes à
-- rafraîchir son cache de schéma après une modification de structure.
-- =====================================================================
