-- =====================================================================
-- Courriel de confirmation au membre dès que son inscription est réglée
-- en entier
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Phase 2 de
-- claude/feuille-de-route.md, dernier des événements de notification
-- prévus pour cette phase.
--
-- CE QUE CE SCRIPT AJOUTE :
--   Dès que le montant payé sur la fiche « Inscription » d'un membre
--   (colonne `members.inscription_paye`) atteint ou dépasse le montant
--   fixé par l'association (Configuration → Montants et cotisations,
--   `associations.inscription_montant`), un courriel de confirmation est
--   envoyé automatiquement à ce membre, à l'adresse enregistrée sur sa
--   fiche (`members.email`).
--
--   Le courriel ne part qu'une seule fois : au moment précis où le
--   montant payé FRANCHIT le seuil (il était sous le montant avant cette
--   modification, il est à ou au-dessus après). Si le montant est ensuite
--   corrigé à la hausse ou à la baisse sans repasser sous le seuil, aucun
--   nouveau courriel n'est renvoyé.
--
-- RÉUTILISE LA MÊME CLÉ API RESEND que les scripts précédents (secret
-- `resend_api_key` dans le coffre-fort Supabase Vault) — pas besoin de
-- la reconfigurer. Sans clé configurée, ce courriel ne part simplement
-- pas, comme les autres notifications de cette série.
-- =====================================================================

create extension if not exists pg_net;

create or replace function public.notify_inscription_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  montant numeric;
  assoc_nom text;
begin
  -- Membre archivé : rien à confirmer.
  if new.statut = 'Supprimé' then
    return new;
  end if;

  if new.email is null then
    return new;
  end if;

  select coalesce(a.inscription_montant, 25), a.nom
    into montant, assoc_nom
    from public.associations a
    where a.id = new.association_id;

  -- Pas encore complet après cette modification : rien à envoyer.
  if coalesce(new.inscription_paye, 0) < montant then
    return new;
  end if;

  -- Déjà complet avant cette modification : le seuil n'est pas
  -- « franchi » ici, on ne renvoie pas le même courriel.
  if coalesce(old.inscription_paye, 0) >= montant then
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
      'to', jsonb_build_array(new.email),
      'subject', '[' || coalesce(assoc_nom, 'Association') || '] Confirmation : inscription réglée',
      'html',
        '<p>Bonjour ' || coalesce(new.nom, '') || ',</p>' ||
        '<p>Nous confirmons la réception de votre inscription à ' ||
        coalesce(assoc_nom, 'l''association') || ', réglée en entier :</p>' ||
        '<p style="padding:12px;background:#EAF7F1;border-left:4px solid #2E8B74;border-radius:6px;">' ||
        'Montant reçu : <strong>' || to_char(new.inscription_paye, 'FM999999990.00') || ' $</strong>' ||
        '</p>' ||
        '<p>Merci de votre confiance !</p>'
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_inscription_complete on public.members;
create trigger trg_notify_inscription_complete
  after update on public.members
  for each row
  when (new.inscription_paye is distinct from old.inscription_paye)
  execute function public.notify_inscription_complete();

-- =====================================================================
-- Vérification rapide après exécution :
--   select tgname from pg_trigger where tgname = 'trg_notify_inscription_complete';
--   -- doit afficher une ligne (confirme que le déclencheur est bien créé)
--
-- Test réel (une fois la clé Resend configurée) :
--   sur la fiche Inscription d'un membre, saisir un montant qui atteint
--   ou dépasse le montant fixé pour l'association → le membre devrait
--   recevoir un courriel de confirmation (sous réserve de la limite du
--   mode d'essai Resend déjà documentée dans les scripts précédents).
-- =====================================================================
