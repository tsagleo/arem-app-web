-- =====================================================================
-- Extension de l'historique (activity_log) aux tables de paiements
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- Ce script AJOUTE une nouvelle fonction trigger `log_payment_activity()`
-- et l'attache aux 4 tables de paiements ci-dessous. Il ne touche PAS
-- à la fonction `log_activity()` existante ni à son trigger sur
-- `members`, pour éviter de casser ce qui fonctionne déjà.
--
-- Tables couvertes :
--   - fonds_recouvrements  (quote-part Fonds urgence/secours marquée payée)
--   - donations            (don enregistré / reçu émis)
--   - loans                (prêt accordé / statut changé)
--   - loan_repayments      (remboursement de prêt enregistré)
--
-- Chaque ligne insérée dans activity_log a la même forme que pour
-- "members" : { ancien, nouveau } dans `details`, plus un champ
-- `member_id` dans `details` pour permettre de filtrer l'historique
-- d'un adhérent précis sans modifier le schéma de activity_log.
-- =====================================================================

create or replace function log_payment_activity()
returns trigger
language plpgsql
security definer
as $$
declare
  v_member_id uuid;
  v_user_id uuid;
  v_user_nom text;
begin
  -- Utilisateur courant (peut être NULL si appelé hors contexte auth, ex: script admin)
  begin
    v_user_id := auth.uid();
  exception when others then
    v_user_id := null;
  end;

  if v_user_id is not null then
    begin
      select nom_complet into v_user_nom from profiles where id = v_user_id;
    exception when others then
      v_user_nom := null;
    end;
  end if;

  -- Résoudre l'adhérent concerné selon la table (pour filtrer l'historique par adhérent)
  if TG_TABLE_NAME = 'fonds_recouvrements' then
    v_member_id := coalesce(NEW.member_id, OLD.member_id);
  elsif TG_TABLE_NAME = 'loans' then
    v_member_id := coalesce(NEW.member_id, OLD.member_id);
  elsif TG_TABLE_NAME = 'loan_repayments' then
    select member_id into v_member_id from loans where id = coalesce(NEW.loan_id, OLD.loan_id);
  else
    -- donations : donateur externe, pas nécessairement lié à un adhérent
    v_member_id := null;
  end if;

  insert into activity_log (table_name, record_id, action, details, user_id, user_nom, created_at)
  values (
    TG_TABLE_NAME,
    coalesce(NEW.id, OLD.id),
    TG_OP,
    jsonb_build_object(
      'ancien', case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
      'nouveau', case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
      'member_id', v_member_id
    ),
    v_user_id,
    v_user_nom,
    now()
  );

  return coalesce(NEW, OLD);
end;
$$;

-- ---------------------------------------------------------------------
-- Triggers (idempotents : DROP IF EXISTS avant CREATE)
-- ---------------------------------------------------------------------

drop trigger if exists trg_log_activity_fonds_recouvrements on fonds_recouvrements;
create trigger trg_log_activity_fonds_recouvrements
after insert or update on fonds_recouvrements
for each row execute function log_payment_activity();

drop trigger if exists trg_log_activity_donations on donations;
create trigger trg_log_activity_donations
after insert or update on donations
for each row execute function log_payment_activity();

drop trigger if exists trg_log_activity_loans on loans;
create trigger trg_log_activity_loans
after insert or update on loans
for each row execute function log_payment_activity();

drop trigger if exists trg_log_activity_loan_repayments on loan_repayments;
create trigger trg_log_activity_loan_repayments
after insert or update on loan_repayments
for each row execute function log_payment_activity();

-- =====================================================================
-- Vérification rapide après exécution :
--   1. Marquer une quote-part "payée" dans l'app (Fonds urgence/secours)
--      → une ligne devrait apparaître dans activity_log avec
--        table_name = 'fonds_recouvrements'.
--   2. select * from activity_log where table_name in
--      ('fonds_recouvrements','donations','loans','loan_repayments')
--      order by created_at desc limit 20;
-- =====================================================================
