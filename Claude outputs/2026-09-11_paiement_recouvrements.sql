-- =====================================================================
-- Paiement en ligne des recouvrements (quotes-parts Fonds urgence/secours)
-- =====================================================================
-- Suite 51 (2026-09-11), à la demande de l'utilisateur : jusqu'ici, les
-- quotes-parts de recouvrement affichées dans « Mon espace » (tableau
-- « Recouvrements à ma charge ») n'étaient payables qu'en personne auprès
-- du bureau, qui les marquait payées manuellement (bouton "Payé" côté
-- Fonds urgence/secours). Ce script étend les deux mécanismes de paiement
-- déjà en place (carte via Stripe, virement Interac avec preuve) à ce
-- type de paiement, en réutilisant exactement la même architecture que
-- pour Inscription/Cotisation/Collation/Fonds urgence/Fonds secours/Don/
-- Prêt (voir sql/2026-09-10g/i, sql/2026-09-10b/e) plutôt que d'en créer
-- une nouvelle.
--
-- Particularité du recouvrement par rapport aux autres rubriques : il n'y
-- a pas de "montant dû" unique par membre, mais potentiellement plusieurs
-- lignes fonds_recouvrements indépendantes (une par dépense de fonds),
-- chacune avec sa propre quote-part et son propre statut payé/non payé.
-- Le paiement se fait donc ligne par ligne, identifiée par
-- recouvrement_id (id de la ligne fonds_recouvrements concernée) plutôt
-- que par un montant recalculé à la volée.
-- =====================================================================

-- ---------- 1) payment_transactions : ajouter 'recouvrement' au type ----------
alter table public.payment_transactions
  drop constraint if exists payment_transactions_type_check;

alter table public.payment_transactions
  add constraint payment_transactions_type_check
  check (type in ('inscription', 'fonds_urgence', 'fonds_secours', 'cotisation', 'collation', 'don', 'pret', 'recouvrement'));

comment on column public.payment_transactions.periode is
  'Numéro de séance (cotisation), libellé de mois/période (collation), ou fonds concerné (''urgence''/''secours'' pour un recouvrement) — NULL pour les autres rubriques.';

-- ---------- 2) interac_payment_claims : ajouter 'recouvrement' au type + colonne recouvrement_id ----------
alter table public.interac_payment_claims
  drop constraint if exists interac_payment_claims_type_check;

alter table public.interac_payment_claims
  add constraint interac_payment_claims_type_check
  check (type in ('inscription', 'fonds_urgence', 'fonds_secours', 'cotisation', 'collation', 'don', 'pret', 'recouvrement'));

alter table public.interac_payment_claims
  add column if not exists recouvrement_id uuid references public.fonds_recouvrements(id) on delete set null;

comment on column public.interac_payment_claims.recouvrement_id is
  'Renseigné uniquement pour type = ''recouvrement'' : la ligne fonds_recouvrements (quote-part) que ce versement règle.';
