-- =====================================================================
-- Registre des transactions : l'octroi du prêt lui-même
-- =====================================================================
-- Suite 50 (2026-09-10), à la demande de l'utilisateur : le détail « Prêt »
-- ne montrait jusqu'ici que les remboursements (via confirmInteracClaim),
-- jamais le montant prêté en commun ni sa date — pourtant l'événement le
-- plus important de cette rubrique. Ce script ajoute une ligne « Octroi
-- du prêt » au registre payment_transactions :
--   - pour tous les prêts déjà existants (rattrapage, une seule fois) ;
--   - pour tout nouveau prêt, automatiquement, via un déclencheur —
--     nécessaire car aucune fonction de l'application n'insère de ligne
--     dans "loans" : l'octroi d'un prêt est actuellement fait directement
--     en base par le bureau (Table Editor de Supabase), pas via un
--     formulaire de l'appli. Un déclencheur garantit que ce sera couvert
--     quelle que soit la façon dont un prêt est créé à l'avenir (y
--     compris si un formulaire dédié est ajouté plus tard côté appli).
--
-- "periode" porte la valeur fixe 'octroi' (plutôt qu'une date ou un
-- numéro) — c'est un simple repère que l'application traduit à
-- l'affichage ("Octroi du prêt" / "Loan disbursement"), distinct de
-- "null" qui reste réservé aux lignes de remboursement.
--
-- Un index unique partiel sur (reference) où methode = 'manuel' est
-- ajouté ici — il manquait jusqu'à présent (seuls 'stripe' et 'interac'
-- en avaient un depuis 2026-09-10g) — pour empêcher tout doublon sur les
-- lignes manuelles, y compris celles du rattrapage précédent
-- (legacy-inscription-/legacy-fu-/legacy-fs-/legacy-cotisation-/
-- legacy-collation-) et celles créées par ce script.
-- =====================================================================

create unique index if not exists payment_transactions_manuel_ref_idx
  on public.payment_transactions (reference)
  where methode = 'manuel' and reference is not null;

-- ---------- Rattrapage : prêts déjà existants ----------
insert into public.payment_transactions (association_id, member_id, type, periode, montant, methode, reference, created_at)
select
  l.association_id, l.member_id, 'pret', 'octroi', l.montant_pret, 'manuel',
  'loan-grant-' || l.id,
  coalesce(l.date_pret::timestamptz, l.created_at, now())
from public.loans l
where coalesce(l.montant_pret, 0) > 0
  and not exists (select 1 from public.payment_transactions pt where pt.reference = 'loan-grant-' || l.id);

-- ---------- Déclencheur : tout nouveau prêt, désormais et automatiquement ----------
create or replace function public.log_loan_grant_to_payment_transactions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.payment_transactions (association_id, member_id, type, periode, montant, methode, reference, created_at)
  values (
    new.association_id, new.member_id, 'pret', 'octroi', new.montant_pret, 'manuel',
    'loan-grant-' || new.id,
    coalesce(new.date_pret::timestamptz, new.created_at, now())
  );
  return new;
exception when unique_violation then
  -- Déjà enregistré (rejeu improbable) : ne bloque jamais la création du prêt.
  return new;
end;
$$;

drop trigger if exists trg_log_loan_grant on public.loans;
create trigger trg_log_loan_grant
  after insert on public.loans
  for each row execute function public.log_loan_grant_to_payment_transactions();
