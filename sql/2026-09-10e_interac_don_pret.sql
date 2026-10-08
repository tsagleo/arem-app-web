-- =====================================================================
-- Paiements Interac : extension aux dons et remboursements de prêt
-- =====================================================================
-- Suite 49 (2026-09-10), à la demande de l'utilisateur : le même
-- mécanisme "preuve de paiement + confirmation par le bureau" déjà en
-- place pour Inscription/Cotisation/Collation/Fonds urgence/Fonds
-- secours est étendu à deux nouveaux cas, tous deux réservés aux membres
-- ayant un compte (contrairement aux dons de personnes extérieures, qui
-- restent saisis manuellement par le bureau comme aujourd'hui, sans
-- preuve jointe — un donateur externe n'a pas de compte pour se
-- connecter à "Mon espace") :
--   - "don" : le membre déclare librement un montant de don.
--   - "pret" : le membre rembourse un prêt actif dont il est
--     l'emprunteur (loans.member_id) — nécessite de savoir QUEL prêt,
--     d'où la nouvelle colonne loan_id.
--
-- Contrairement aux 5 types précédents, ces deux-là n'ont pas de "montant
-- dû" calculé automatiquement (le don est libre ; le remboursement peut
-- être partiel ou total) — le montant est saisi librement par le membre
-- au moment de la soumission, exactement comme montant_recu peut déjà
-- différer de montant pour un versement partiel sur les autres types.
-- =====================================================================

-- La contrainte CHECK sur "type" doit être recréée pour ajouter les deux
-- nouvelles valeurs (Postgres ne permet pas de modifier une contrainte
-- CHECK existante, seulement de la supprimer et d'en recréer une).
alter table public.interac_payment_claims
  drop constraint if exists interac_payment_claims_type_check;

alter table public.interac_payment_claims
  add constraint interac_payment_claims_type_check
  check (type in ('inscription', 'fonds_urgence', 'fonds_secours', 'cotisation', 'collation', 'don', 'pret'));

alter table public.interac_payment_claims
  add column if not exists loan_id uuid references public.loans(id) on delete set null;

comment on column public.interac_payment_claims.loan_id is
  'Renseigné uniquement pour type = ''pret'' : le prêt (loans.id) que ce versement rembourse.';
