-- =====================================================================
-- Détail des paiements par événement (suite 90, 2026-09-28)
-- =====================================================================
-- Suite au test en conditions réelles de la suite 89 (billet d'événement
-- payant) : le registre payment_transactions est bien alimenté (webhook
-- Stripe + confirmation Interac), mais rien ne permettait de le retracer
-- de façon fiable par événement précis — seul payment_transactions.periode
-- (le TITRE de l'événement, en texte libre) existait, ce qui casse dès que
-- deux événements portent le même nom.
--
-- Ajoute payment_transactions.event_id, exactement le même patron que
-- interac_payment_claims.event_id (suite 89) : une colonne de lien fiable,
-- + un rattrapage best-effort des transactions déjà enregistrées AVANT ce
-- script (ne relie que quand une correspondance unique et sûre existe).
--
-- Ce script est SANS DANGER à exécuter plusieurs fois (idempotent) :
-- `add column if not exists`, `create index if not exists`, et le
-- rattrapage ne touche jamais une ligne déjà reliée (`event_id is null`).
-- =====================================================================

alter table public.payment_transactions
  add column if not exists event_id uuid references public.events(id) on delete set null;

comment on column public.payment_transactions.event_id is
  'Renseigné uniquement pour type = ''billet_evenement'' : l''événement (events.id) concerné par ce paiement. Alimenté directement par create-checkout-session/stripe-webhook et par la confirmation Interac (Evenements.jsx) pour toute nouvelle transaction ; les transactions antérieures à ce script sont reliées ci-dessous quand c'est possible sans ambiguïté.';

create index if not exists payment_transactions_event_idx on public.payment_transactions (event_id);

-- ---------------------------------------------------------------------
-- Rattrapage best-effort des transactions déjà enregistrées avant ce
-- script (ex. le test de la suite 89) : relie par titre d'événement,
-- uniquement quand ce titre correspond à UN SEUL événement de la même
-- association (pour ne jamais créer un lien incorrect en cas de titres
-- dupliqués — dans ce cas la ligne reste simplement non reliée, sans
-- perte d'information : periode conserve le titre tel quel).
-- ---------------------------------------------------------------------
update public.payment_transactions pt
set event_id = e.id
from public.events e
where pt.type = 'billet_evenement'
  and pt.event_id is null
  and e.association_id = pt.association_id
  and e.titre = pt.periode
  and (
    select count(*) from public.events e2
    where e2.association_id = pt.association_id and e2.titre = pt.periode
  ) = 1;
