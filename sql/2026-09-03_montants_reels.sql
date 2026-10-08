-- =====================================================================
-- Tontine et Collation : montants réels au lieu de cases à cocher
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- Ajoute une colonne `montant` (numérique) aux tables collation_presences
-- et tontine_presences. Le nouveau code de l'application enregistre
-- désormais le montant réellement payé/versé par mois/séance dans cette
-- colonne, au lieu d'une simple case à cocher (colonne `present`).
--
-- Ce script ne supprime rien : la colonne `present` reste en place
-- (elle n'est plus utilisée par l'application, mais vos anciennes
-- données n'y seront pas perdues).
--
-- Il convertit aussi automatiquement vos données existantes : si un mois
-- ou une séance était déjà coché (present = true) et qu'aucun montant
-- n'a encore été saisi, le montant habituel (10 $/mois pour la Collation,
-- 100 $/séance pour la Tontine) y est inscrit, pour que vos totaux ne
-- repartent pas à zéro. Ce script est idempotent : vous pouvez le
-- relancer sans risque, il ne touchera pas les montants déjà saisis.
-- =====================================================================

alter table collation_presences add column if not exists montant numeric default 0;
alter table tontine_presences add column if not exists montant numeric default 0;

-- Conversion des anciennes cases cochées en montants (une seule fois utile,
-- sans effet si déjà fait ou si aucun montant n'était à 0).
update collation_presences set montant = 10 where present = true and (montant is null or montant = 0);
update tontine_presences set montant = 100 where present = true and (montant is null or montant = 0);

-- =====================================================================
-- Vérification rapide après exécution :
--   select member_id, mois, montant from collation_presences order by mois limit 20;
--   select member_id, seance, montant from tontine_presences order by seance limit 20;
-- =====================================================================
