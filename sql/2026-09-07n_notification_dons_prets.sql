-- =====================================================================
-- Courriel de confirmation à l'enregistrement d'un don ou d'un
-- remboursement de prêt
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Phase 2 de
-- claude/feuille-de-route.md — extension de « Confirmation de paiement
-- reçu » (suite 40) aux dons et aux remboursements de prêt.
--
-- CE QUE CE SCRIPT AJOUTE :
--   1. Don (`donations`) : dès qu'un don est enregistré avec une adresse
--      courriel de donateur renseignée, un courriel de remerciement lui
--      est envoyé. Le donateur n'est PAS forcément un membre de
--      l'association (champ texte libre `donateur_email`) — rien à voir
--      avec `members.email`.
--   2. Remboursement de prêt (`loan_repayments`) : dès qu'un versement
--      est enregistré, un courriel de confirmation est envoyé à
--      l'emprunteur (le prêt est toujours lié à un membre,
--      `loans.member_id`), avec le solde restant dû — et une mention
--      spéciale si ce versement solde le prêt en entier.
--
-- RÉUTILISE LA MÊME CLÉ API RESEND que les scripts précédents (secret
-- `resend_api_key`) — pas besoin de la reconfigurer. Sans clé configurée,
-- ces courriels ne partent simplement pas, comme les autres notifications.
-- =====================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- 1) Don reçu
-- ---------------------------------------------------------------------
create or replace function public.notify_donation_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  assoc_nom text;
begin
  if new.donateur_email is null or btrim(new.donateur_email) = '' then
    return new;
  end if;

  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  if api_key is null then
    return new;
  end if;

  select a.nom into assoc_nom from public.associations a where a.id = new.association_id;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key
    ),
    body := jsonb_build_object(
      'from', 'onboarding@resend.dev',
      'to', jsonb_build_array(new.donateur_email),
      'subject', '[' || coalesce(assoc_nom, 'Association') || '] Merci pour votre don',
      'html',
        '<p>Bonjour ' || coalesce(new.donateur_nom, '') || ',</p>' ||
        '<p>Nous confirmons la réception de votre don à ' || coalesce(assoc_nom, 'l''association') || ' :</p>' ||
        '<p style="padding:12px;background:#EAF7F1;border-left:4px solid #2E8B74;border-radius:6px;">' ||
        'Montant reçu : <strong>' || to_char(new.montant, 'FM999999990.00') || ' $</strong><br/>' ||
        'Date : ' || to_char(new.date::date, 'DD/MM/YYYY') ||
        '</p>' ||
        '<p>Merci infiniment pour votre générosité !</p>'
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_donation_received on public.donations;
create trigger trg_notify_donation_received
  after insert on public.donations
  for each row
  when (new.donateur_email is not null and btrim(new.donateur_email) <> '')
  execute function public.notify_donation_received();

-- ---------------------------------------------------------------------
-- 2) Remboursement de prêt enregistré
-- ---------------------------------------------------------------------
create or replace function public.notify_loan_repayment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  rec record;
  total_du numeric;
  total_verse numeric;
  solde numeric;
begin
  select m.email, m.nom, m.statut, a.nom as assoc_nom,
         l.montant_pret, l.taux_interet
    into rec
    from public.loans l
    join public.members m on m.id = l.member_id
    join public.associations a on a.id = l.association_id
    where l.id = new.loan_id;

  if rec.email is null or rec.statut = 'Supprimé' then
    return new;
  end if;

  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  if api_key is null then
    return new;
  end if;

  total_du := rec.montant_pret * (1 + coalesce(rec.taux_interet, 0) / 100);
  select coalesce(sum(r.montant), 0) into total_verse from public.loan_repayments r where r.loan_id = new.loan_id;
  solde := greatest(total_du - total_verse, 0);

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key
    ),
    body := jsonb_build_object(
      'from', 'onboarding@resend.dev',
      'to', jsonb_build_array(rec.email),
      'subject', '[' || coalesce(rec.assoc_nom, 'Association') || '] Confirmation : remboursement reçu',
      'html',
        '<p>Bonjour ' || coalesce(rec.nom, '') || ',</p>' ||
        '<p>Nous confirmons la réception de votre versement sur votre prêt :</p>' ||
        '<p style="padding:12px;background:#EAF7F1;border-left:4px solid #2E8B74;border-radius:6px;">' ||
        'Montant reçu : <strong>' || to_char(new.montant, 'FM999999990.00') || ' $</strong><br/>' ||
        (case
          when solde <= 0 then 'Votre prêt est désormais <strong>intégralement remboursé</strong>.'
          else 'Solde restant dû : <strong>' || to_char(solde, 'FM999999990.00') || ' $</strong>'
        end) ||
        '</p>' ||
        '<p>Merci !</p>'
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_loan_repayment on public.loan_repayments;
create trigger trg_notify_loan_repayment
  after insert on public.loan_repayments
  for each row
  execute function public.notify_loan_repayment();

-- =====================================================================
-- Vérification rapide après exécution :
--   select tgname from pg_trigger where tgname in ('trg_notify_donation_received', 'trg_notify_loan_repayment');
--   -- doit afficher 2 lignes
-- =====================================================================
