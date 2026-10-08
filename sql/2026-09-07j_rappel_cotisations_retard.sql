-- =====================================================================
-- Rappels automatiques par courriel pour les paiements en retard :
-- inscription impayée et quote-part de recouvrement impayée
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois), APRÈS le
-- script sql/2026-09-07i_rappel_evenements.sql (celui-ci réutilise
-- l'extension pg_cron activée là-bas).
-- Phase 2 de claude/feuille-de-route.md, dernière des nouvelles
-- notifications de cette série.
--
-- CE QUE CE SCRIPT AJOUTE :
--   Deux rappels distincts, chacun envoyé UNE SEULE FOIS par situation
--   impayée (pas de spam répété tant que rien ne change) :
--
--   1. Inscription impayée : un membre actif dont le montant payé sur
--      la fiche « Inscription » (`members.inscription_paye`) est
--      inférieur au montant fixé pour l'association (Configuration →
--      Montants et cotisations), et dont la date d'adhésion remonte à
--      plus de 30 jours, reçoit un rappel à son adresse courriel.
--
--   2. Quote-part de recouvrement impayée : quand une dépense de fonds
--      (urgence ou secours) est répartie entre les membres actifs, la
--      part de chacun (`fonds_recouvrements`) qui reste marquée non
--      payée plus de 14 jours après la date de la dépense déclenche un
--      rappel au membre concerné.
--
--   Comme rien dans la base ne suit une date d'échéance formelle pour
--   ces deux paiements, les seuils de 30 jours et 14 jours ci-dessus
--   sont des valeurs par défaut raisonnables choisies pour ce script —
--   dites-le-moi si vous préférez d'autres délais, ce sont deux nombres
--   faciles à ajuster (voir les deux fonctions plus bas, marquées
--   « SEUIL »).
--
-- RÉUTILISE LA MÊME CLÉ API RESEND que les scripts précédents (secret
-- `resend_api_key`) — pas besoin de la reconfigurer. Sans clé configurée,
-- ces rappels ne font simplement rien, comme les autres notifications.
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Pour ne rappeler chaque situation impayée qu'une seule fois. Se remet
-- naturellement à zéro si vous re-générez une nouvelle dépense/quote-part
-- (nouvelle ligne), mais PAS si le membre reste en retard indéfiniment
-- sur la même ligne — c'est voulu, pour ne pas relancer sans fin.
alter table public.members add column if not exists rappel_inscription_envoye boolean not null default false;
alter table public.fonds_recouvrements add column if not exists rappel_envoye boolean not null default false;

-- ---------------------------------------------------------------------
-- 1) Inscription impayée
-- ---------------------------------------------------------------------
create or replace function public.send_overdue_inscription_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  seuil_jours constant int := 30; -- SEUIL : jours après l'adhésion avant le rappel
  rec record;
  assoc_nom text;
  montant_du numeric;
begin
  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  if api_key is null then
    return;
  end if;

  for rec in
    select m.id as member_id, m.email, m.nom, m.date_adhesion, m.inscription_paye,
           a.id as association_id, a.nom as assoc_nom, coalesce(a.inscription_montant, 25) as inscription_montant
    from public.members m
    join public.associations a on a.id = m.association_id
    where m.statut = 'Actif'
      and m.email is not null
      and m.date_adhesion is not null
      and m.date_adhesion <= (current_date - seuil_jours)
      and coalesce(m.inscription_paye, 0) < coalesce(a.inscription_montant, 25)
      and m.rappel_inscription_envoye = false
  loop
    montant_du := rec.inscription_montant - coalesce(rec.inscription_paye, 0);

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || api_key
      ),
      body := jsonb_build_object(
        'from', 'onboarding@resend.dev',
        'to', jsonb_build_array(rec.email),
        'subject', '[' || coalesce(rec.assoc_nom, 'Association') || '] Rappel : inscription non réglée',
        'html',
          '<p>Bonjour ' || coalesce(rec.nom, '') || ',</p>' ||
          '<p>Un solde reste dû sur votre inscription à ' || coalesce(rec.assoc_nom, 'l''association') || ' :</p>' ||
          '<p style="padding:12px;background:#f5f5f5;border-radius:6px;">' ||
          'Montant dû : <strong>' || to_char(montant_du, 'FM999999990.00') || ' $</strong>' ||
          '</p>' ||
          '<p>Merci de régulariser votre situation auprès du bureau dès que possible.</p>'
      )
    );

    update public.members set rappel_inscription_envoye = true where id = rec.member_id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Quote-part de recouvrement impayée
-- ---------------------------------------------------------------------
create or replace function public.send_overdue_quotepart_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  seuil_jours constant int := 14; -- SEUIL : jours après la dépense avant le rappel
  rec record;
begin
  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  if api_key is null then
    return;
  end if;

  for rec in
    select r.id as recouvrement_id, r.quote_part, m.email, m.nom,
           d.fonds, d.date as date_depense, d.description,
           a.nom as assoc_nom
    from public.fonds_recouvrements r
    join public.fonds_depenses d on d.id = r.depense_id
    join public.members m on m.id = r.member_id
    join public.associations a on a.id = d.association_id
    where r.paye = false
      and d.date <= (current_date - seuil_jours)
      and r.rappel_envoye = false
      and m.email is not null
      and m.statut = 'Actif'
  loop
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || api_key
      ),
      body := jsonb_build_object(
        'from', 'onboarding@resend.dev',
        'to', jsonb_build_array(rec.email),
        'subject', '[' || coalesce(rec.assoc_nom, 'Association') || '] Rappel : quote-part non réglée',
        'html',
          '<p>Bonjour ' || coalesce(rec.nom, '') || ',</p>' ||
          '<p>Une quote-part de recouvrement reste due (' ||
          (case when rec.fonds = 'urgence' then 'fonds d''urgence' else 'fonds de secours' end) ||
          (case when rec.description is not null and rec.description <> '' then ' — ' || rec.description else '' end) ||
          ') :</p>' ||
          '<p style="padding:12px;background:#f5f5f5;border-radius:6px;">' ||
          'Montant dû : <strong>' || to_char(rec.quote_part, 'FM999999990.00') || ' $</strong><br/>' ||
          'Dépense du : ' || to_char(rec.date_depense::date, 'DD/MM/YYYY') ||
          '</p>' ||
          '<p>Merci de régulariser votre situation auprès du bureau dès que possible.</p>'
      )
    );

    update public.fonds_recouvrements set rappel_envoye = true where id = rec.recouvrement_id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Planification quotidienne (décalée après le rappel d'événements
--    pour éviter que les deux tâches ne tournent à la même seconde).
-- ---------------------------------------------------------------------
select cron.schedule(
  'rappel-inscriptions-impayees-quotidien',
  '15 8 * * *',
  $$select public.send_overdue_inscription_reminders();$$
);

select cron.schedule(
  'rappel-quotes-parts-impayees-quotidien',
  '30 8 * * *',
  $$select public.send_overdue_quotepart_reminders();$$
);

-- =====================================================================
-- Vérification rapide après exécution :
--   select jobname, schedule, active from cron.job where jobname like 'rappel-%';
--   -- doit afficher les 3 tâches (événements + les deux ci-dessus), toutes active = true
--
-- Pour tester sans attendre le lendemain matin, exécutez manuellement :
--   select public.send_overdue_inscription_reminders();
--   select public.send_overdue_quotepart_reminders();
-- =====================================================================
