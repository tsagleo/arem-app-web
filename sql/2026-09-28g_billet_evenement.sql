-- =====================================================================
-- Billet d'événement payant en ligne (Stripe + preuve Interac)
-- =====================================================================
-- Chantier « application complète » (2026-09-28), section A du document
-- claude/proposition-application-complete.md : dernier point réellement
-- ouvert de la Phase 3 (paiements en ligne) — les autres (cotisation,
-- fonds urgence/secours, collation, recouvrement, Interac par preuve)
-- étaient déjà construits et testés depuis les suites 48 à 51, mais
-- feuille-de-route.md n'avait jamais été mis à jour pour le refléter
-- (corrigé le même jour).
--
-- Réutilise exactement l'architecture déjà en place pour les 6 types de
-- paiement existants (sql/2026-09-10g, 2026-09-10b/e, 2026-09-11) plutôt
-- que d'en créer une nouvelle :
--   1. Carte (Stripe Checkout) — create-checkout-session/stripe-webhook,
--      étendus séparément dans ce même chantier.
--   2. Virement Interac avec preuve — le membre téléverse une capture
--      d'écran/reçu, le Bureau confirme manuellement depuis l'onglet
--      Événements (PAS l'onglet "Paiements Interac" générique de Mon
--      espace : la gestion des billets reste à côté de l'événement
--      concerné plutôt que mélangée à la file d'attente générale — choix
--      délibéré pour éviter d'alourdir App.jsx, qui ne charge aujourd'hui
--      ni events ni event_rsvps).
--
-- Un événement gratuit (prix = 0) n'est PAS concerné par ce script : le
-- flux de confirmation instantanée existant (rsvpToEvent) reste inchangé.
--
-- Ce script est SANS DANGER à exécuter plusieurs fois (idempotent) :
-- `on conflict do nothing`, `add column if not exists`, `or replace`,
-- `drop ... if exists`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. payment_transactions et interac_payment_claims : ajouter le type
--    'billet_evenement' + colonne event_id sur interac_payment_claims
--    (même patron que recouvrement_id, suite 51).
-- ---------------------------------------------------------------------
alter table public.payment_transactions
  drop constraint if exists payment_transactions_type_check;

alter table public.payment_transactions
  add constraint payment_transactions_type_check
  check (type in ('inscription', 'fonds_urgence', 'fonds_secours', 'cotisation', 'collation', 'don', 'pret', 'recouvrement', 'billet_evenement'));

alter table public.interac_payment_claims
  drop constraint if exists interac_payment_claims_type_check;

alter table public.interac_payment_claims
  add constraint interac_payment_claims_type_check
  check (type in ('inscription', 'fonds_urgence', 'fonds_secours', 'cotisation', 'collation', 'don', 'pret', 'recouvrement', 'billet_evenement'));

alter table public.interac_payment_claims
  add column if not exists event_id uuid references public.events(id) on delete set null;

comment on column public.interac_payment_claims.event_id is
  'Renseigné uniquement pour type = ''billet_evenement'' : l''événement (events.id) dont ce versement règle la place.';

create index if not exists interac_payment_claims_event_idx on public.interac_payment_claims (event_id);

-- ---------------------------------------------------------------------
-- 2. Comptabilité — nouveau compte produit, réutilisant le patron déjà
--    en place pour les amendes (suite 87) : l'argent réellement reçu
--    pour un billet d'événement doit apparaître dans le système
--    comptable, pas seulement dans le registre payment_transactions.
-- ---------------------------------------------------------------------
insert into public.comptes_comptables (code, nom, type, ordre) values
  ('4700', 'Billets d''événements perçus', 'produit', 66)
on conflict (code) do nothing;

-- L'écriture est déclenchée par la transition de event_rsvps.statut vers
-- 'confirme' (INSERT déjà confirmé, comme le fait le webhook Stripe et
-- la confirmation Interac ci-dessous — OU UPDATE si une ligne existait
-- déjà) plutôt que par payment_transactions, pour rester cohérent avec
-- le patron déjà en place ailleurs dans ce système (ex. fonds_recouvrements.paye,
-- pas un journal séparé). Un événement gratuit (prix = 0) ne génère
-- jamais d'écriture. Idempotent via une vérification directe sur
-- ecritures_comptables (source_table/source_id) plutôt que de dépendre
-- de la logique de transition OLD/NEW, pour rester fiable même si la
-- ligne event_rsvps est créée déjà confirmée (cas normal ici).
create or replace function public.ecr_trg_event_tickets() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prix numeric;
  v_assoc uuid;
  v_titre text;
begin
  if NEW.statut <> 'confirme' then return NEW; end if;
  select prix, association_id, titre into v_prix, v_assoc, v_titre
    from public.events where id = NEW.event_id;
  if v_assoc is null or not (coalesce(v_prix, 0) > 0) then return NEW; end if;
  if exists (select 1 from public.ecritures_comptables where source_table = 'event_rsvps' and source_id = NEW.id) then
    return NEW;
  end if;
  perform public.poster_ecriture_signee(
    v_assoc, current_date, '1000', '4700', 'general',
    v_prix, 'Billet — ' || coalesce(v_titre, ''), 'event_rsvps', NEW.id
  );
  return NEW;
end;
$$;
drop trigger if exists trg_ecr_event_tickets on public.event_rsvps;
create trigger trg_ecr_event_tickets after insert or update of statut on public.event_rsvps
for each row execute function public.ecr_trg_event_tickets();

-- Suppression (le Bureau retire un participant, ou supprime l'événement
-- en cascade) : réutilise le déclencheur générique déjà en place pour
-- toutes les autres tables sources plutôt que d'en écrire un nouveau —
-- retire proprement l'écriture liée si elle existait.
drop trigger if exists trg_ecr_event_tickets_del on public.event_rsvps;
create trigger trg_ecr_event_tickets_del after delete on public.event_rsvps
for each row execute function public.ecr_trg_delete_generic();
