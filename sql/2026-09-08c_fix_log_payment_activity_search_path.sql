-- =====================================================================
-- Correctif : log_payment_activity() ne fixait pas son search_path
-- (même défaut que log_activity(), corrigé juste avant dans
-- sql/2026-09-08b_fix_log_activity_search_path.sql)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- CONTEXTE (suite 46, en testant les rappels de retard) : même famille
-- de bug que log_activity(). log_payment_activity() est le déclencheur
-- d'audit dédié aux tables de paiement (fonds_recouvrements, loans,
-- loan_repayments, donations) — SECURITY DEFINER sans search_path fixé,
-- et référence `profiles`, `loans`, `activity_log` sans préfixe de
-- schéma. Exposé cette fois par
-- `send_overdue_quotepart_reminders()` (sql/2026-09-07j), qui met à
-- jour `fonds_recouvrements.rappel_envoye` depuis une fonction dont le
-- search_path est vide — ce qui casse la résolution de schéma du
-- déclencheur.
--
-- CE QUE CE SCRIPT CORRIGE : ajoute `set search_path = ''` et préfixe
-- `public.profiles`, `public.loans`, `public.activity_log`. Aucun
-- changement de comportement.
-- =====================================================================

create or replace function public.log_payment_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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
      select nom_complet into v_user_nom from public.profiles where id = v_user_id;
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
    select member_id into v_member_id from public.loans where id = coalesce(NEW.loan_id, OLD.loan_id);
  else
    -- donations : donateur externe, pas nécessairement lié à un adhérent
    v_member_id := null;
  end if;

  insert into public.activity_log (table_name, record_id, action, details, user_id, user_nom, created_at)
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
$function$;

-- =====================================================================
-- Vérification rapide après exécution :
--   select prosecdef, proconfig from pg_proc where proname = 'log_payment_activity';
--   -- prosecdef doit être "true" ; proconfig doit contenir "search_path="
-- =====================================================================
