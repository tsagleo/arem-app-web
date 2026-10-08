-- =====================================================================
-- Ajout : associations.interac_email
-- =====================================================================
-- Suite 49 (2026-09-10) : nouvelle option "Virement Interac" proposée aux
-- membres dans "Mon espace", en complément du paiement par carte (Stripe).
--
-- Contrairement à Stripe, il n'existe pas d'API "paiement instantané" pour
-- Interac accessible à une petite association (il faudrait un vrai
-- partenariat "Interac pour entreprises" avec un processeur comme
-- Moneris/Bambora). L'option Interac reste donc "manuelle" : l'application
-- affiche simplement le courriel de réception configuré ici, ainsi qu'un
-- message de référence suggéré — le membre envoie lui-même le virement
-- depuis son application bancaire, et le bureau confirme la réception
-- manuellement (comme c'était déjà le cas avant l'ajout du paiement en
-- ligne).
--
-- Ce champ est optionnel : tant qu'il n'est pas renseigné (NULL ou vide),
-- l'application affiche un message "Interac non configuré" à la place des
-- instructions.
-- =====================================================================

alter table public.associations
  add column if not exists interac_email text;

comment on column public.associations.interac_email is
  'Courriel Interac de l''association, utilisé pour afficher les instructions de virement manuel aux membres dans "Mon espace". Optionnel.';
