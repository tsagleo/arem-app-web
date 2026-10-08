-- =====================================================================
-- Versement de la cagnotte au bénéficiaire (Cotisation/Collation)
-- =====================================================================
-- Suite 56 (2026-09-11), à la demande de l'utilisateur : "implémenter
-- également le système de paiement, les deux méthodes existantes, de
-- telle sorte qu'il puisse être possible de reverser ces montants aux
-- bénéficiaires à travers les transactions en ligne."
--
-- Recherche faite avant de coder (voir conversation) : ni Stripe ni
-- Interac ne permettent aujourd'hui un vrai virement automatisé vers un
-- tiers sans mise en place supplémentaire :
--   - Stripe : transférer de l'argent à quelqu'un d'autre que
--     l'association elle-même nécessite Stripe Connect — chaque
--     bénéficiaire devrait créer son propre compte connecté (vérification
--     d'identité, compte bancaire). Impossible avec le compte Stripe déjà
--     en place pour percevoir les paiements entrants (suite 47-48).
--   - Interac : l'envoi automatisé (sans passer par l'interface web
--     habituelle) nécessite un abonnement à un service tiers (ex. VoPay,
--     DCPayments) avec ses propres frais et démarches — rien d'équivalent
--     à ce qui existe pour recevoir des preuves de paiement Interac
--     (suite 50, interac_payment_claims).
--
-- L'utilisateur a choisi de construire d'abord un enregistrement manuel +
-- preuve : le bureau envoie l'argent lui-même en dehors de l'application
-- (Interac depuis son propre compte, virement, chèque, espèces...), puis
-- confirme le versement dans l'app. Les valeurs de méthode réutilisent
-- exactement le même vocabulaire que payment_transactions.methode
-- (stripe / interac / manuel), afin qu'un vrai déclenchement automatisé
-- (Stripe Connect, API Interac Business) puisse un jour écrire dans ces
-- mêmes colonnes sans changer la forme des données.
-- =====================================================================

alter table public.tontine_seances
  add column if not exists versement_methode text,
  add column if not exists versement_reference text,
  add column if not exists versement_montant numeric,
  add column if not exists versement_date date,
  add column if not exists versement_preuve_path text,
  add column if not exists versement_enregistre_par uuid references public.profiles(id);

alter table public.tontine_seances drop constraint if exists tontine_seances_versement_methode_check;
alter table public.tontine_seances add constraint tontine_seances_versement_methode_check
  check (versement_methode is null or versement_methode in ('stripe', 'interac', 'manuel'));

comment on column public.tontine_seances.versement_methode is
  'Méthode utilisée par le bureau pour reverser la cagnotte au bénéficiaire : stripe / interac / manuel (virement, chèque, espèces...). NULL = pas encore versé. Suite 56 (2026-09-11) : enregistrement du versement effectué en dehors de l''application (le bureau envoie lui-même l''argent) — voir le commentaire en tête de ce fichier pour le contexte complet.';
comment on column public.tontine_seances.versement_preuve_path is
  'Chemin du fichier de preuve dans le bucket de stockage "documents" (même bucket que l''onglet Documents, RLS déjà scopée par association + bureau) — pas de ligne créée dans la table "documents" pour ne pas encombrer la banque de documents générale.';

-- Aucune modification de politique RLS nécessaire : tontine_seances est
-- déjà couverte par les politiques update existantes (association_id =
-- current_association_id() and is_bureau(), suite 31/multi-tenant), qui
-- s'appliquent à toutes les colonnes de la ligne, y compris ces nouvelles.
-- Le bucket de stockage "documents" a lui aussi déjà les politiques
-- nécessaires (suite 31) : aucune modification de stockage requise non
-- plus.
