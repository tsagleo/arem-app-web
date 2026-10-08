-- =====================================================================
-- Modification, archivage/suppression et réinitialisation des dossiers
-- de décès (Programme funéraire)
-- =====================================================================
-- Suite 70 (complément #5, 2026-09-18). Demande directe de l'utilisateur :
-- « J'aimerais prévoir une option de réinitialisation de cet onglet [...]
-- une option de modifier un enregistrement fait concernant un décès [...]
-- une option de supprimer une écriture concernant l'enregistrement d'un
-- décès qui a été fait déjà et dont le rapatriement a été fait également. »
--
-- Ce script :
--   1) permet l'édition des champs descriptifs d'un dossier (personne
--      décédée, date, description) — le montant reste verrouillé sur la
--      configuration, jamais modifiable au cas par cas, comme convenu
--      lors de la conception initiale du module ;
--   2) étend le statut d'un dossier pour permettre l'archivage (« supprime »),
--      suivant exactement le même principe déjà en place pour les
--      inscriptions (voir 2026-09-18d) : la suppression n'efface rien tout
--      de suite, elle déplace le dossier dans une archive consultable et
--      restaurable, avec motif et date. Disponible même sur un dossier déjà
--      clôturé/réglé (rapatriement déjà effectué), comme demandé ;
--   3) ajoute statut_avant_suppression pour que la restauration d'un
--      dossier renvoie à son état exact d'origine (ouvert ou clôturé),
--      plutôt que de supposer « clôturé » par défaut.
--
-- La suppression permanente depuis la vue d'archive s'appuie sur la
-- contrainte déjà en place funeraire_recouvrements.dossier_id
-- ... on delete cascade : les quotes-parts liées sont effacées
-- automatiquement par la base, aucun changement nécessaire ici.
-- Aucun changement RLS : la modification/suppression d'un dossier reste
-- réservée au Bureau (is_staff()), comme à la création (suite 70, script
-- 2026-09-18b).
-- =====================================================================

alter table public.funeraire_dossiers
  drop constraint if exists funeraire_dossiers_statut_check;

alter table public.funeraire_dossiers
  add constraint funeraire_dossiers_statut_check
    check (statut in ('ouvert', 'cloture', 'supprime'));

alter table public.funeraire_dossiers
  add column if not exists motif_suppression text,
  add column if not exists date_suppression date,
  add column if not exists statut_avant_suppression text;

comment on column public.funeraire_dossiers.motif_suppression is
  'Motif choisi par le Bureau lors de la suppression (archivage) de ce dossier : test, erreur_saisie, doublon, rapatriement_annule, autre. Suite 70 (complément #5).';
comment on column public.funeraire_dossiers.date_suppression is
  'Date à laquelle le dossier a été archivé (statut = supprime). Suite 70 (complément #5).';
comment on column public.funeraire_dossiers.statut_avant_suppression is
  'Statut du dossier juste avant son archivage (ouvert ou cloture), conservé pour que la restauration renvoie à l''état exact d''origine plutôt que de supposer « cloture » par défaut. Suite 70 (complément #5).';
