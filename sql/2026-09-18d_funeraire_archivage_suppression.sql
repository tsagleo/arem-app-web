-- =====================================================================
-- Archivage des inscriptions funéraires supprimées + motif de suppression
-- =====================================================================
-- Suite 70 (complément #4, 2026-09-18). Demande directe de l'utilisateur :
-- « Ajouter les motifs de suppression et puis constituer un archivage
-- après suppression pour consultation future au besoin. »
--
-- Jusqu'ici, supprimer une ligne de funeraire_inscriptions l'effaçait
-- réellement (delete). Ce script ajoute un statut supplémentaire
-- « supprime » (soft delete), avec motif et date, suivant exactement le
-- même principe déjà en place pour les adhérents (members.statut =
-- 'Supprimé' + motif_desactivation + date_desactivation, voir App.jsx :
-- handleDeleteMember/reactivateMember/permanentlyDeleteMember). La ligne
-- reste donc consultable dans un onglet « archives » (restaurable), et
-- n'est effacée pour de bon que si le Bureau choisit explicitement
-- « Supprimer définitivement » depuis cette vue d'archive.
-- =====================================================================

alter table public.funeraire_inscriptions
  drop constraint if exists funeraire_inscriptions_statut_check;

alter table public.funeraire_inscriptions
  add constraint funeraire_inscriptions_statut_check
    check (statut in ('actif', 'retire', 'transfere', 'supprime'));

alter table public.funeraire_inscriptions
  add column if not exists motif_suppression text,
  add column if not exists date_suppression date;

comment on column public.funeraire_inscriptions.motif_suppression is
  'Motif choisi par le Bureau lors de la suppression (archivage) de cette inscription : test, erreur_saisie, doublon, demande_adherent, autre. Suite 70 (complément #4).';
comment on column public.funeraire_inscriptions.date_suppression is
  'Date à laquelle l''inscription a été archivée (statut = supprime). Suite 70 (complément #4).';

-- Rappel : l'index unique partiel posé en 2026-09-18c
-- (funeraire_inscriptions_un_actif_par_membre, sur statut = 'actif')
-- n'est pas affecté par ce script — une ligne archivée (statut =
-- 'supprime') n'entre jamais en conflit avec une réinscription.
