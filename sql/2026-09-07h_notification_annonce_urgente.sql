-- =====================================================================
-- Notification par courriel à tous les membres actifs dès qu'une annonce
-- est publiée avec l'option « urgente »
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Phase 2 de
-- claude/feuille-de-route.md, deuxième des événements listés à étendre
-- au mécanisme déjà construit pour les demandes de suppression.
--
-- CE QUE CE SCRIPT AJOUTE :
--   Dès qu'une annonce est créée (ou modifiée) avec la case « urgente »
--   cochée, un courriel est envoyé automatiquement à CHAQUE membre actif
--   de l'association qui a une adresse courriel enregistrée (colonne
--   `members.email` — indépendante du compte de connexion, donc ça
--   couvre aussi les membres qui n'ont pas créé de compte). Jusqu'ici,
--   une annonce urgente n'était visible que si le membre se connectait
--   lui-même à la plateforme.
--
-- RÉUTILISE LA MÊME CLÉ API RESEND que les scripts précédents (secret
-- `resend_api_key` dans le coffre-fort Supabase Vault) — pas besoin de
-- la reconfigurer ici. Vous pouvez exécuter CE script dès maintenant :
-- s'il n'existe pas encore de clé enregistrée, ce nouveau déclencheur ne
-- fait simplement rien (pas d'erreur) jusqu'à ce que la clé soit
-- configurée via sql/2026-09-04g_notification_email_suppression.sql.
--
-- LIMITE IMPORTANTE (mode d'essai Resend, comme pour les autres
-- notifications) : tant qu'aucun nom de domaine n'est vérifié dans
-- Resend, les courriels ne peuvent partir que vers l'adresse ayant
-- servi à créer le compte Resend (recommandé : l'adresse du président).
-- En pratique, tant que ce mode d'essai est actif, seul le membre dont
-- l'adresse correspond à ce compte Resend recevra réellement le
-- courriel — les autres appels échoueront silencieusement côté Resend
-- (ils sont journalisés côté Resend, pas ici). Une fois un domaine
-- vérifié (Resend → Domains → Add Domain), tous les membres recevront
-- le courriel normalement, sans changement à ce script.
-- =====================================================================

-- Au cas où ce script serait exécuté avant les autres (idempotent, ne
-- fait rien si déjà activé).
create extension if not exists pg_net;

create or replace function public.notify_urgent_announcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  assoc_nom text;
  rec record;
begin
  -- Seules les annonces marquées urgentes déclenchent un envoi.
  if new.urgent is not true then
    return new;
  end if;

  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  -- Clé API pas encore configurée : on n'échoue pas la transaction, on
  -- se contente de ne pas envoyer de courriel (voir note en haut).
  if api_key is null then
    return new;
  end if;

  select a.nom into assoc_nom from public.associations a where a.id = new.association_id;

  -- Un courriel séparé par membre (plutôt qu'un seul courriel avec tous
  -- les destinataires en copie), pour ne jamais exposer l'adresse d'un
  -- membre aux autres.
  for rec in
    select m.email
    from public.members m
    where m.association_id = new.association_id
      and m.statut = 'Actif'
      and m.email is not null
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
        'subject', '[' || coalesce(assoc_nom, 'Association') || '] Annonce urgente : ' || new.titre,
        'html',
          '<p>Bonjour,</p>' ||
          '<p>Une annonce urgente vient d''être publiée par ' || coalesce(assoc_nom, 'votre association') || ' :</p>' ||
          '<p style="padding:12px;background:#FDECEA;border-left:4px solid #C0392B;border-radius:6px;">' ||
          '<strong>' || new.titre || '</strong><br/>' ||
          coalesce(new.message, '') ||
          '</p>' ||
          '<p>Connectez-vous à la plateforme pour plus de détails.</p>'
      )
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_urgent_announcement on public.announcements;
create trigger trg_notify_urgent_announcement
  after insert on public.announcements
  for each row
  when (new.urgent is true)
  execute function public.notify_urgent_announcement();

-- Couvre aussi le cas où une annonce existante est éditée pour cocher
-- « urgente » après coup (elle ne l'était pas à sa création). Ne se
-- redéclenche pas à chaque modification tant qu'elle reste urgente,
-- pour éviter de spammer les membres à chaque petite correction de
-- texte.
drop trigger if exists trg_notify_urgent_announcement_update on public.announcements;
create trigger trg_notify_urgent_announcement_update
  after update on public.announcements
  for each row
  when (new.urgent is true and old.urgent is distinct from true)
  execute function public.notify_urgent_announcement();

-- =====================================================================
-- Vérification rapide après exécution :
--   select tgname from pg_trigger where tgname = 'trg_notify_urgent_announcement';
--   -- doit afficher une ligne (confirme que le déclencheur est bien créé)
--
-- Test réel (une fois la clé Resend configurée via l'autre script) :
--   publier une annonce en cochant « urgente » → chaque membre actif
--   avec une adresse courriel enregistrée devrait recevoir un courriel
--   (sous réserve de la limite du mode d'essai Resend décrite ci-haut).
-- =====================================================================
