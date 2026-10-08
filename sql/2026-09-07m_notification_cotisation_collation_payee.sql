-- =====================================================================
-- Courriel de confirmation au membre à chaque versement de Cotisation
-- (ex-Tontine) ou de Collation enregistré pour une séance/période
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Phase 2 de
-- claude/feuille-de-route.md — extension de « Confirmation de paiement
-- reçu » (suite 40) à la Cotisation et à la Collation.
--
-- CE QUE CE SCRIPT AJOUTE :
--   Dès qu'un montant est saisi pour la première fois pour un membre sur
--   une séance de Cotisation (`tontine_presences`) ou une période de
--   Collation (`collation_presences`), un courriel de confirmation est
--   envoyé à ce membre, à l'adresse enregistrée sur sa fiche
--   (`members.email`).
--
--   ATTENTION — volume de courriels : ces deux fiches sont saisies très
--   régulièrement (à chaque séance/mois, pour chaque membre). Si votre
--   association suit de nombreux membres à un rythme rapproché (ex.
--   chaque semaine), ce script peut générer beaucoup de courriels. Vous
--   pouvez désactiver l'un des deux déclencheurs sans toucher à l'autre
--   (voir la note à la fin du script) si un seul des deux est souhaité.
--
--   Le courriel ne part qu'au moment précis où le montant passe de
--   zéro/vide à un montant positif pour cette séance/période précise
--   (pas de renvoi si le montant est ensuite corrigé, tant qu'il reste
--   positif).
--
-- RÉUTILISE LA MÊME CLÉ API RESEND que les scripts précédents (secret
-- `resend_api_key`) — pas besoin de la reconfigurer. Sans clé configurée,
-- ces courriels ne partent simplement pas, comme les autres notifications.
-- =====================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- 1) Cotisation (ex-Tontine) — `tontine_presences`
-- ---------------------------------------------------------------------
create or replace function public.notify_tontine_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  rec record;
begin
  select m.email, m.nom, m.statut, a.nom as assoc_nom
    into rec
    from public.members m
    join public.associations a on a.id = m.association_id
    where m.id = new.member_id;

  if rec.email is null or rec.statut = 'Supprimé' then
    return new;
  end if;

  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  if api_key is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key
    ),
    body := jsonb_build_object(
      'from', 'onboarding@resend.dev',
      'to', jsonb_build_array(rec.email),
      'subject', '[' || coalesce(rec.assoc_nom, 'Association') || '] Confirmation : cotisation reçue',
      'html',
        '<p>Bonjour ' || coalesce(rec.nom, '') || ',</p>' ||
        '<p>Nous confirmons la réception de votre cotisation pour la séance n° ' || new.seance || ' :</p>' ||
        '<p style="padding:12px;background:#EAF7F1;border-left:4px solid #2E8B74;border-radius:6px;">' ||
        'Montant reçu : <strong>' || to_char(new.montant, 'FM999999990.00') || ' $</strong>' ||
        '</p>' ||
        '<p>Merci de votre confiance !</p>'
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_tontine_payment_insert on public.tontine_presences;
create trigger trg_notify_tontine_payment_insert
  after insert on public.tontine_presences
  for each row
  when (new.montant > 0)
  execute function public.notify_tontine_payment();

drop trigger if exists trg_notify_tontine_payment_update on public.tontine_presences;
create trigger trg_notify_tontine_payment_update
  after update on public.tontine_presences
  for each row
  when (new.montant > 0 and coalesce(old.montant, 0) <= 0)
  execute function public.notify_tontine_payment();

-- ---------------------------------------------------------------------
-- 2) Collation — `collation_presences`
-- ---------------------------------------------------------------------
create or replace function public.notify_collation_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  rec record;
begin
  select m.email, m.nom, m.statut, a.nom as assoc_nom
    into rec
    from public.members m
    join public.associations a on a.id = m.association_id
    where m.id = new.member_id;

  if rec.email is null or rec.statut = 'Supprimé' then
    return new;
  end if;

  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  if api_key is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key
    ),
    body := jsonb_build_object(
      'from', 'onboarding@resend.dev',
      'to', jsonb_build_array(rec.email),
      'subject', '[' || coalesce(rec.assoc_nom, 'Association') || '] Confirmation : collation reçue',
      'html',
        '<p>Bonjour ' || coalesce(rec.nom, '') || ',</p>' ||
        '<p>Nous confirmons la réception de votre contribution à la collation pour « ' || new.mois || ' » :</p>' ||
        '<p style="padding:12px;background:#EAF7F1;border-left:4px solid #2E8B74;border-radius:6px;">' ||
        'Montant reçu : <strong>' || to_char(new.montant, 'FM999999990.00') || ' $</strong>' ||
        '</p>' ||
        '<p>Merci de votre confiance !</p>'
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_collation_payment_insert on public.collation_presences;
create trigger trg_notify_collation_payment_insert
  after insert on public.collation_presences
  for each row
  when (new.montant > 0)
  execute function public.notify_collation_payment();

drop trigger if exists trg_notify_collation_payment_update on public.collation_presences;
create trigger trg_notify_collation_payment_update
  after update on public.collation_presences
  for each row
  when (new.montant > 0 and coalesce(old.montant, 0) <= 0)
  execute function public.notify_collation_payment();

-- =====================================================================
-- Pour désactiver l'une des deux notifications sans toucher à l'autre
-- (si le volume de courriels est trop élevé pour l'une d'elles) :
--   drop trigger trg_notify_tontine_payment_insert on public.tontine_presences;
--   drop trigger trg_notify_tontine_payment_update on public.tontine_presences;
--   -- (remplacer "tontine" par "collation" pour désactiver l'autre)
--
-- Vérification rapide après exécution :
--   select tgname from pg_trigger where tgname like 'trg_notify_tontine_payment%' or tgname like 'trg_notify_collation_payment%';
--   -- doit afficher 4 lignes
-- =====================================================================
