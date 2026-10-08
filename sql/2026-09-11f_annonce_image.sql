-- =====================================================================
-- Image sur une annonce (module Annonces)
-- =====================================================================
-- Suite 57 (2026-09-11), à la demande de l'utilisateur : « Dans le fil
-- d'actualité, j'aimerais que tu fasses une sorte de fiche avec l'image...
-- une annonce de campagne, de recrutement, de nouveaux adhérents... Cette
-- fiche devra être mise dans les annonces. »
--
-- Le module Annonces (table `announcements`) ne stockait jusqu'ici que
-- titre/message/urgent. Ce script ajoute une colonne `image_url` (simple
-- URL texte, comme `associations.logo_url` ou `members.photo_url`) pour
-- permettre au bureau de joindre une image à une annonce — affichée à la
-- fois dans l'onglet Annonces et dans l'encadré « Nouvelles » du fil
-- d'actualité (VieAssociative.jsx).
--
-- Stockage : réutilise le bucket "avatars" déjà en place (public, déjà
-- utilisé pour les photos de membres et le logo de l'association — voir
-- sql/2026-09-04e_multi_tenant_rls.sql, note en tête : ce bucket n'est pas
-- cloisonné par association, choix déjà fait précédemment), sous un
-- dossier "announcements/<association_id>/...". Aucune nouvelle politique
-- de stockage nécessaire.
-- =====================================================================

alter table public.announcements
  add column if not exists image_url text;

comment on column public.announcements.image_url is
  'URL publique (bucket de stockage "avatars", dossier announcements/<association_id>/...) de l''image jointe à l''annonce. NULL = pas d''image. Suite 57 (2026-09-11).';

-- Aucune modification de politique RLS nécessaire : announcements est déjà
-- couverte par les politiques existantes (association_id =
-- current_association_id(), écriture réservée au bureau — voir
-- sql/2026-09-04e_multi_tenant_rls.sql), qui s'appliquent à toutes les
-- colonnes de la ligne, y compris cette nouvelle colonne.
