-- =====================================================================
-- Paiements Interac — confirmation manuelle avec preuve de paiement
-- =====================================================================
-- Suite 49 (2026-09-10). Comme il n'existe pas d'API "paiement instantané"
-- Interac accessible à une petite association (il faudrait un vrai
-- partenariat "Interac pour entreprises" avec un processeur comme
-- Moneris/Bambora), l'option Interac proposée aux membres dans "Mon
-- espace" reste manuelle : le membre envoie lui-même le virement depuis
-- son application bancaire, puis téléverse une preuve (capture d'écran ou
-- reçu) dans l'application. Le bureau vérifie visuellement cette preuve
-- depuis le nouvel onglet "Paiements Interac" et confirme ou rejette —
-- une confirmation applique exactement la même écriture en base que le
-- webhook Stripe (montant plein sur members.*_paye, ou upsert
-- tontine_presences/collation_presences), ce qui déclenche au passage les
-- mêmes courriels de confirmation déjà construits en Phase 2.
--
-- Ce script :
--   1. Crée la table interac_payment_claims (une ligne par preuve envoyée).
--   2. Active RLS dessus (membre : ses propres demandes ; bureau : toutes
--      celles de son association).
--   3. Crée le bucket de stockage privé "interac-proofs" et ses policies
--      (membre : dépose/consulte ses propres fichiers ; bureau : consulte
--      tous les fichiers de son association).
--
-- Réutilise les fonctions utilitaires déjà en place (current_association_id,
-- current_member_id, is_staff — voir sql/2026-09-04e_multi_tenant_rls.sql)
-- plutôt que de dupliquer cette logique.
-- =====================================================================

-- ---------- 1) Table ----------
create table if not exists public.interac_payment_claims (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  type text not null check (type in ('inscription', 'fonds_urgence', 'fonds_secours', 'cotisation', 'collation')),
  montant numeric not null check (montant > 0),
  fichier_path text not null,
  fichier_nom text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'confirme', 'rejete')),
  commentaire_bureau text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id)
);

comment on table public.interac_payment_claims is
  'Preuves de virement Interac envoyées par les membres, en attente (ou non) de confirmation manuelle par le bureau. Voir claude/resume-arem-app.md, suite 49.';

create index if not exists interac_payment_claims_association_idx on public.interac_payment_claims (association_id, statut);
create index if not exists interac_payment_claims_member_idx on public.interac_payment_claims (member_id);

-- ---------- 2) RLS sur la table ----------
alter table public.interac_payment_claims enable row level security;

drop policy if exists "interac_claims select" on public.interac_payment_claims;
drop policy if exists "interac_claims insert" on public.interac_payment_claims;
drop policy if exists "interac_claims update" on public.interac_payment_claims;

-- Un membre voit ses propres demandes ; le bureau voit toutes celles de
-- son association.
create policy "interac_claims select" on public.interac_payment_claims for select to authenticated
  using (association_id = public.current_association_id() and (member_id = public.current_member_id() or public.is_staff()));

-- Un membre ne peut créer une demande que pour lui-même (jamais au nom
-- d'un autre membre), dans sa propre association.
create policy "interac_claims insert" on public.interac_payment_claims for insert to authenticated
  with check (association_id = public.current_association_id() and member_id = public.current_member_id());

-- Seul le bureau peut mettre à jour une demande (confirmer/rejeter).
create policy "interac_claims update" on public.interac_payment_claims for update to authenticated
  using (association_id = public.current_association_id() and public.is_staff())
  with check (association_id = public.current_association_id() and public.is_staff());

-- Pas de policy delete : les demandes sont conservées indéfiniment comme
-- trace d'audit, à l'image du Journal d'activité.

-- ---------- 3) Bucket de stockage "interac-proofs" ----------
insert into storage.buckets (id, name, public)
values ('interac-proofs', 'interac-proofs', false)
on conflict (id) do nothing;

drop policy if exists "interac proofs storage select" on storage.objects;
drop policy if exists "interac proofs storage insert" on storage.objects;

-- Chemin attendu : "<association_id>/<member_id>/<horodatage>_<nom_fichier>"
-- (storage.foldername(name))[1] = association_id, [2] = member_id.
create policy "interac proofs storage select" on storage.objects for select to authenticated
  using (
    bucket_id = 'interac-proofs'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and ((storage.foldername(name))[2] = public.current_member_id()::text or public.is_staff())
  );

create policy "interac proofs storage insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'interac-proofs'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and (storage.foldername(name))[2] = public.current_member_id()::text
  );
