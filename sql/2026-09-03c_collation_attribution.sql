-- =====================================================================
-- Collation : même système d'attribution/décharge que la Tontine
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- La Collation fonctionne exactement comme la Tontine : la cagnotte du
-- mois collectée auprès des adhérents est remise à un membre bénéficiaire
-- pour organiser la réunion suivante, contre décharge. Ce n'est donc pas
-- un revenu de l'association (elle est retirée des États financiers).
--
-- La table `tontine_seances` sert maintenant aux deux rubriques : une
-- nouvelle colonne `type` distingue les lignes "tontine" des lignes
-- "collation", et une colonne `mois` sert de repère (au lieu du numéro
-- de séance) pour les attributions de Collation, qui sont mensuelles.
--
-- Ce script est idempotent (peut être relancé sans risque). Les lignes
-- déjà existantes (créées avant cette mise à jour) sont automatiquement
-- marquées type = 'tontine' par la valeur par défaut, donc rien n'est
-- perdu ni modifié pour vos attributions de Tontine déjà enregistrées.
-- =====================================================================

alter table tontine_seances add column if not exists type text not null default 'tontine';
alter table tontine_seances add column if not exists mois text;

-- =====================================================================
-- Vérification rapide après exécution :
--   select id, type, mois, numero, beneficiaire_id, decharge_signee from tontine_seances order by created_at;
-- =====================================================================
