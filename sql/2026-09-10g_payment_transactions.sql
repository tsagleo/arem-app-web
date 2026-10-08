-- =====================================================================
-- Registre complet des transactions (carte + Interac)
-- =====================================================================
-- Suite 50 (2026-09-10), à la demande de l'utilisateur : le tableau
-- « Voir le détail des transactions » de Mon espace ne montrait jusqu'ici
-- que les demandes Interac — les paiements par carte (Stripe) ne
-- laissaient qu'un solde à jour, sans ligne datée. Ce script crée un
-- véritable registre unique alimenté par LES DEUX méthodes de paiement,
-- qui devient la seule source du détail affiché au membre.
--
-- 1) Table payment_transactions : une ligne par paiement effectivement
--    confirmé, quelle que soit la méthode. "periode" porte le numéro de
--    séance (cotisation) ou le libellé de mois/période (collation) afin
--    d'afficher la vraie date de paiement à côté du repère de période
--    (jusqu'ici, la date affichée pour une cotisation était celle de la
--    séance elle-même, pas celle du versement).
-- 2) RLS : membre voit ses propres lignes, bureau voit celles de son
--    association. Aucune policy update/delete — registre immuable, comme
--    le Journal d'activité et les demandes Interac.
-- 3) Deux index uniques partiels empêchent qu'un même paiement Stripe ou
--    une même confirmation Interac ne soit enregistré deux fois (retry
--    de webhook, double-clic).
-- 4) Rétro-remplissage : les soldes d'Inscription / Fonds d'urgence /
--    Fonds de secours déjà payés AVANT la création de ce registre (donc
--    sans ligne correspondante) reçoivent une ligne "Solde initial",
--    datée de la date de paiement déjà enregistrée sur la fiche membre
--    quand elle existe, sinon de sa date de création. Cotisation et
--    Collation n'ont pas besoin de ce rattrapage : leur détail continue
--    de s'appuyer sur tontine_presences/collation_presences, qui existent
--    déjà période par période.
-- =====================================================================

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  type text not null check (type in ('inscription', 'fonds_urgence', 'fonds_secours', 'cotisation', 'collation', 'don', 'pret')),
  periode text,
  montant numeric not null check (montant > 0),
  methode text not null check (methode in ('stripe', 'interac', 'manuel')),
  reference text,
  created_at timestamptz not null default now()
);

comment on table public.payment_transactions is
  'Registre immuable de chaque paiement confirmé (carte ou Interac) — source du détail des transactions dans Mon espace. Voir claude/resume-arem-app.md, suite 50.';
comment on column public.payment_transactions.periode is
  'Numéro de séance (cotisation) ou libellé de mois/période (collation) — NULL pour les autres rubriques.';
comment on column public.payment_transactions.reference is
  'Identifiant technique de la transaction source (id de session Stripe, ou id de la demande Interac) — sert uniquement à la déduplication, non affiché tel quel au membre.';

create index if not exists payment_transactions_member_idx on public.payment_transactions (member_id, type);
create index if not exists payment_transactions_association_idx on public.payment_transactions (association_id);

-- Empêche un doublon si le webhook Stripe redélivre le même événement,
-- ou si une confirmation Interac est rejouée.
create unique index if not exists payment_transactions_stripe_ref_idx on public.payment_transactions (reference) where methode = 'stripe';
create unique index if not exists payment_transactions_interac_ref_idx on public.payment_transactions (reference) where methode = 'interac';

alter table public.payment_transactions enable row level security;

drop policy if exists "payment_transactions select" on public.payment_transactions;
drop policy if exists "payment_transactions insert bureau" on public.payment_transactions;

create policy "payment_transactions select" on public.payment_transactions for select to authenticated
  using (association_id = public.current_association_id() and (member_id = public.current_member_id() or public.is_staff()));

-- Le webhook Stripe utilise la clé de service (contourne RLS) — cette
-- policy ne couvre que l'insertion côté client, faite par le bureau au
-- moment de confirmer une demande Interac.
create policy "payment_transactions insert bureau" on public.payment_transactions for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_staff());

-- ---------- Rétro-remplissage (Inscription / Fonds urgence / Fonds secours) ----------
-- Utilise le champ de date de paiement déjà présent sur la fiche membre
-- quand il est renseigné, sinon la date du jour (on ne suppose pas
-- l'existence d'une colonne members.created_at, non confirmée).
insert into public.payment_transactions (association_id, member_id, type, montant, methode, reference, created_at)
select m.association_id, m.id, 'inscription', m.inscription_paye, 'manuel', 'legacy-inscription-' || m.id,
       coalesce(m.inscription_date::timestamptz, now())
from public.members m
where coalesce(m.inscription_paye, 0) > 0
  and not exists (select 1 from public.payment_transactions pt where pt.reference = 'legacy-inscription-' || m.id);

insert into public.payment_transactions (association_id, member_id, type, montant, methode, reference, created_at)
select m.association_id, m.id, 'fonds_urgence', m.fonds_urgence_paye, 'manuel', 'legacy-fu-' || m.id,
       coalesce(m.fonds_urgence_date_paiement::timestamptz, now())
from public.members m
where coalesce(m.fonds_urgence_paye, 0) > 0
  and not exists (select 1 from public.payment_transactions pt where pt.reference = 'legacy-fu-' || m.id);

insert into public.payment_transactions (association_id, member_id, type, montant, methode, reference, created_at)
select m.association_id, m.id, 'fonds_secours', m.fonds_secours_paye, 'manuel', 'legacy-fs-' || m.id,
       coalesce(m.fonds_secours_date_paiement::timestamptz, now())
from public.members m
where coalesce(m.fonds_secours_paye, 0) > 0
  and not exists (select 1 from public.payment_transactions pt where pt.reference = 'legacy-fs-' || m.id);
