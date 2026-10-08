-- =====================================================================
-- Paiements Interac : montant réellement reçu (versements partiels)
-- =====================================================================
-- Suite 49 (2026-09-10), en réponse à une question de l'utilisateur : que
-- se passe-t-il si un membre envoie un virement Interac inférieur au
-- montant demandé (versement partiel, par erreur ou faute de fonds) ?
--
-- Jusqu'ici, la confirmation d'une demande appliquait toujours le montant
-- déclaré à la soumission (interac_payment_claims.montant), sans
-- possibilité pour le bureau de corriger ce chiffre selon ce qu'il
-- constate réellement sur son relevé bancaire.
--
-- Ce script ajoute une colonne distincte pour tracer le montant
-- effectivement confirmé par le bureau (qui peut différer du montant
-- demandé) — "montant" reste le montant demandé au membre (inchangé
-- depuis la soumission), "montant_recu" est rempli uniquement au moment
-- de la confirmation.
-- =====================================================================

alter table public.interac_payment_claims
  add column if not exists montant_recu numeric;

comment on column public.interac_payment_claims.montant_recu is
  'Montant réellement reçu, tel que confirmé par le bureau (peut différer de "montant", le montant demandé au membre, en cas de versement partiel). NULL tant que la demande n''est pas confirmée.';
