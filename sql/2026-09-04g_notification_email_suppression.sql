-- =====================================================================
-- Notification par courriel au président (ou à l'approbateur désigné)
-- dès qu'une demande de suppression est créée
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois), APRÈS le script
-- 2026-09-04f_approbation_suppressions_et_probation_secours.sql.
--
-- CE QUE CE SCRIPT AJOUTE :
--   Dès qu'une ligne est créée dans `deletion_requests` (c'est-à-dire dès
--   qu'un membre du bureau qui n'est PAS l'approbateur désigné essaie de
--   supprimer une transaction financière), un courriel est envoyé
--   automatiquement à l'adresse de connexion de l'approbateur désigné de
--   l'association concernée, avec la description de la transaction visée
--   et un lien vers l'onglet « Demandes de suppression ».
--
-- AVANT D'EXÉCUTER CE SCRIPT, IL FAUT :
--   1. Créer un compte gratuit sur https://resend.com (utilisez l'adresse
--      courriel du président, ex. tsagleo@outlook.fr — voir la note plus
--      bas sur pourquoi).
--   2. Dans Resend, aller dans « API Keys » → « Create API Key » et copier
--      la clé générée (elle commence par « re_ »).
--   3. Remplacer 're_VOTRE_CLE_ICI' ci-dessous par cette clé avant de
--      lancer le script.
--
-- NOTE IMPORTANTE SUR LES DESTINATAIRES (mode d'essai Resend) : tant
-- qu'aucun nom de domaine n'est vérifié dans Resend, vous ne pouvez
-- envoyer des courriels qu'à l'adresse qui a servi à créer le compte
-- Resend. C'est pourquoi il faut créer ce compte avec l'adresse du
-- président (l'approbateur) — ça fonctionne très bien pour une seule
-- association. Si un jour plusieurs associations ont chacune leur propre
-- président avec une adresse différente, il faudra vérifier un domaine
-- dans Resend (Domains → Add Domain) pour lever cette limite.
-- =====================================================================

-- 1) Active l'extension qui permet à la base de données d'envoyer des
--    requêtes web (nécessaire pour appeler l'API de Resend).
create extension if not exists pg_net;

-- 2) Stocke la clé API Resend de façon chiffrée dans le coffre-fort
--    intégré de Supabase (jamais en clair dans une table ordinaire).
--    ⚠️ REMPLACEZ 're_VOTRE_CLE_ICI' PAR VOTRE VRAIE CLÉ AVANT D'EXÉCUTER.
select vault.create_secret(
  're_VOTRE_CLE_ICI',
  'resend_api_key',
  'Clé API Resend — notifications de demandes de suppression'
);

-- 3) Fonction + déclencheur : à chaque nouvelle ligne dans
--    `deletion_requests`, retrouve l'adresse courriel de l'approbateur
--    désigné de l'association concernée et lui envoie un courriel via
--    l'API de Resend.
create or replace function public.notify_deletion_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  approver_id uuid;
  approver_email text;
  assoc_nom text;
begin
  select a.approbateur_suppression_id, a.nom
    into approver_id, assoc_nom
    from public.associations a
    where a.id = new.association_id;

  -- Pas d'approbateur désigné pour cette association : rien à notifier
  -- (la suppression a d'ailleurs eu lieu immédiatement dans ce cas, donc
  -- cette ligne ne devrait normalement même pas exister).
  if approver_id is null then
    return new;
  end if;

  select u.email into approver_email
    from auth.users u
    where u.id = approver_id;

  if approver_email is null then
    return new;
  end if;

  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  -- Clé API pas encore configurée : on n'échoue pas la transaction, on
  -- se contente de ne pas envoyer de courriel.
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
      'to', jsonb_build_array(approver_email),
      'subject', '[' || coalesce(assoc_nom, 'AREM') || '] Nouvelle demande de suppression à approuver',
      'html',
        '<p>Bonjour,</p>' ||
        '<p><strong>' || coalesce(new.requested_by_nom, 'Un membre du bureau') ||
        '</strong> a demandé la suppression suivante, qui nécessite votre approbation :</p>' ||
        '<p style="padding:12px;background:#f5f5f5;border-radius:6px;">' || new.description || '</p>' ||
        '<p>Connectez-vous à la plateforme et allez dans l''onglet « Demandes de suppression » pour approuver ou rejeter cette demande.</p>'
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_deletion_request on public.deletion_requests;
create trigger trg_notify_deletion_request
  after insert on public.deletion_requests
  for each row
  execute function public.notify_deletion_request();

-- =====================================================================
-- Vérification rapide après exécution :
--   select name, created_at from vault.decrypted_secrets where name = 'resend_api_key';
--   -- doit afficher une ligne (confirme que la clé est bien enregistrée)
--   select tgname from pg_trigger where tgname = 'trg_notify_deletion_request';
--   -- doit afficher une ligne (confirme que le déclencheur est bien créé)
-- =====================================================================
