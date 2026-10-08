-- =====================================================================
-- Notification par courriel au président dès qu'une nouvelle demande de
-- rattachement (« rejoindre une association ») est créée
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Phase 2 de
-- claude/feuille-de-route.md, premier des événements listés à étendre
-- au mécanisme déjà construit pour les demandes de suppression.
--
-- CE QUE CE SCRIPT AJOUTE :
--   Dès qu'un nouveau compte rejoint l'association avec un code
--   d'invitation (table `member_link_requests`), un courriel est envoyé
--   automatiquement au président de l'association concernée, avec le
--   nom du nouveau compte, la fiche adhérent suggérée automatiquement le
--   cas échéant, et un lien vers l'onglet « Gestion des accès ».
--   Jusqu'ici, seul un badge dans l'application signalait une demande en
--   attente — visible seulement si le bureau est déjà connecté.
--
-- RÉUTILISE LA MÊME CLÉ API RESEND que le script
-- sql/2026-09-04g_notification_email_suppression.sql (secret
-- `resend_api_key` dans le coffre-fort Supabase Vault) — pas besoin de
-- la reconfigurer ici. Vous pouvez exécuter CE script dès maintenant :
-- s'il n'existe pas encore de clé enregistrée, ce nouveau déclencheur ne
-- fait simplement rien (pas d'erreur) jusqu'à ce que la clé soit
-- configurée via l'autre script — voir Phase 2 de la feuille de route.
--
-- LIMITE IMPORTANTE (mode d'essai Resend, comme pour les suppressions) :
-- tant qu'aucun nom de domaine n'est vérifié dans Resend, les courriels
-- ne peuvent partir que vers l'adresse ayant servi à créer le compte
-- Resend. C'est pourquoi ce courriel est envoyé spécifiquement au
-- président (l'adresse recommandée pour créer ce compte Resend) plutôt
-- qu'à l'ensemble du bureau, qui peut pourtant aussi confirmer ces
-- demandes depuis « Gestion des accès ».
-- =====================================================================

-- Au cas où ce script serait exécuté avant celui des suppressions
-- (idempotent, ne fait rien si déjà activé).
create extension if not exists pg_net;

create or replace function public.notify_member_link_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  president_id uuid;
  president_email text;
  assoc_nom text;
  requester_nom text;
  requester_email text;
  suggested_nom text;
begin
  -- Président de l'association concernée (destinataire de la
  -- notification — voir la note sur la limite Resend ci-dessus).
  select id into president_id
    from public.profiles
    where association_id = new.association_id and role = 'bureau_president'
    limit 1;

  if president_id is null then
    return new;
  end if;

  select u.email into president_email from auth.users u where u.id = president_id;
  if president_email is null then
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

  select p.nom_complet, u.email into requester_nom, requester_email
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = new.profile_id;

  if new.suggested_member_id is not null then
    select m.nom into suggested_nom from public.members m where m.id = new.suggested_member_id;
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key
    ),
    body := jsonb_build_object(
      'from', 'onboarding@resend.dev',
      'to', jsonb_build_array(president_email),
      'subject', '[' || coalesce(assoc_nom, 'Association') || '] Nouvelle demande de rattachement à confirmer',
      'html',
        '<p>Bonjour,</p>' ||
        '<p><strong>' || coalesce(requester_nom, 'Un nouveau compte') ||
        '</strong>' || (case when requester_email is not null then ' (' || requester_email || ')' else '' end) ||
        ' a rejoint votre association avec le code d''invitation et attend une confirmation.</p>' ||
        (case
          when suggested_nom is not null then
            '<p>Correspondance suggérée automatiquement (même courriel) : <strong>' || suggested_nom || '</strong>.</p>'
          else
            '<p>Aucune correspondance automatique trouvée par courriel — une fiche adhérent devra être choisie manuellement.</p>'
        end) ||
        '<p>Connectez-vous à la plateforme et allez dans l''onglet « Gestion des accès » pour confirmer ou rejeter cette demande.</p>'
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_member_link_request on public.member_link_requests;
create trigger trg_notify_member_link_request
  after insert on public.member_link_requests
  for each row
  when (new.statut = 'en_attente')
  execute function public.notify_member_link_request();

-- =====================================================================
-- Vérification rapide après exécution :
--   select tgname from pg_trigger where tgname = 'trg_notify_member_link_request';
--   -- doit afficher une ligne (confirme que le déclencheur est bien créé)
--
-- Test réel (une fois la clé Resend configurée via l'autre script) :
--   faire rejoindre un compte de test avec un code d'invitation → le
--   président devrait recevoir un courriel dans les secondes qui suivent.
-- =====================================================================
