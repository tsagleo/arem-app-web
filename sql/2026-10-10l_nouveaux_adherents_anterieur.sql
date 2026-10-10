-- =====================================================================
-- Nouveaux adhérents : payer ou non ce qui précède leur adhésion
-- (2026-10-10, demandé par l'utilisateur)
-- =====================================================================
-- Réglage propre à chaque association (Configuration → Adhésion &
-- cotisations) :
--   • true (par défaut, comportement inchangé) : un nouvel adhérent doit
--     toutes les séances de Présence (ex-« Collation ») de l'année et les
--     recouvrements de fonds d'urgence / de secours, même antérieurs à son
--     adhésion ;
--   • false : il part sur les bases normales à sa date d'adhésion — seules
--     les séances de Présence à partir de son adhésion et les recouvrements
--     des dépenses datées de son adhésion ou après lui sont demandés.
-- Le calcul s'appuie sur members.date_adhesion (renseignez-la sur la fiche).
-- Ré-exécutable sans risque.
-- =====================================================================
alter table public.associations add column if not exists nouveaux_payent_anterieur boolean not null default true;

-- Vérification :
--   select nom, nouveaux_payent_anterieur from public.associations;
