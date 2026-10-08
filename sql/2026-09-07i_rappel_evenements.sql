-- =====================================================================
-- Rappel automatique par courriel, 2 jours avant un événement, aux
-- membres inscrits (RSVP confirmé)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Phase 2 de
-- claude/feuille-de-route.md, troisième des nouvelles notifications.
--
-- CE QUE CE SCRIPT AJOUTE :
--   Chaque jour, la base de données vérifie automatiquement s'il existe
--   des événements qui commencent dans exactement 2 jours. Pour chacun
--   d'eux, un courriel de rappel est envoyé à tous les membres dont
--   l'inscription (RSVP) est confirmée pour cet événement, à l'adresse
--   enregistrée sur leur fiche membre (`members.email`).
--
-- DIFFÉRENCE AVEC LES SCRIPTS PRÉCÉDENTS : ce rappel n'est pas déclenché
-- par une action d'un utilisateur (comme un formulaire soumis) — il doit
-- se déclencher tout seul, chaque jour, même si personne n'est connecté.
-- Ça nécessite l'extension `pg_cron` (tâches planifiées dans la base de
-- données), jamais utilisée jusqu'ici dans ce projet.
--
-- SI L'ÉTAPE 1 CI-DESSOUS ÉCHOUE (permission refusée) : passez par
-- Supabase → Database → Extensions → cherchez « pg_cron » → Enable,
-- puis relancez le reste du script (les commandes suivantes n'ont pas
-- besoin d'être exécutées via l'extension elle-même).
--
-- RÉUTILISE LA MÊME CLÉ API RESEND que les scripts précédents (secret
-- `resend_api_key`) — pas besoin de la reconfigurer. Sans clé configurée,
-- ce rappel ne fait simplement rien, comme les autres notifications.
-- =====================================================================

-- 1) Active les extensions nécessaires (idempotent).
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 2) Empêche l'envoi du même rappel plusieurs fois pour un même
--    événement si la tâche planifiée est relancée un jour où elle a déjà
--    tourné (ou après un redémarrage).
alter table public.events add column if not exists rappel_envoye boolean not null default false;

-- 3) Fonction : parcourt les événements qui commencent dans 2 jours et
--    n'ont pas encore reçu leur rappel, et envoie un courriel à chaque
--    inscrit confirmé.
create or replace function public.send_event_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  ev record;
  rsvp record;
  assoc_nom text;
  sent_any boolean;
begin
  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  -- Clé API pas encore configurée : rien à faire pour l'instant.
  if api_key is null then
    return;
  end if;

  for ev in
    select e.*
    from public.events e
    where e.rappel_envoye = false
      and e.date_debut::date = (current_date + interval '2 days')::date
  loop
    select a.nom into assoc_nom from public.associations a where a.id = ev.association_id;
    sent_any := false;

    for rsvp in
      select m.email
      from public.event_rsvps r
      join public.members m on m.id = r.member_id
      where r.event_id = ev.id
        and r.statut = 'confirme'
        and m.email is not null
    loop
      sent_any := true;
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || api_key
        ),
        body := jsonb_build_object(
          'from', 'onboarding@resend.dev',
          'to', jsonb_build_array(rsvp.email),
          'subject', '[' || coalesce(assoc_nom, 'Association') || '] Rappel : ' || ev.titre || ' dans 2 jours',
          'html',
            '<p>Bonjour,</p>' ||
            '<p>Ceci est un rappel : vous êtes inscrit(e) à l''événement suivant, qui a lieu dans 2 jours.</p>' ||
            '<p style="padding:12px;background:#f5f5f5;border-radius:6px;">' ||
            '<strong>' || ev.titre || '</strong><br/>' ||
            'Date : ' || to_char(ev.date_debut::date, 'DD/MM/YYYY') ||
            (case when ev.lieu is not null and ev.lieu <> '' then '<br/>Lieu : ' || ev.lieu else '' end) ||
            '</p>' ||
            '<p>À bientôt !</p>'
        )
      );
    end loop;

    -- Marqué comme traité même si personne n'était inscrit, pour ne pas
    -- réévaluer cet événement chaque jour une fois sa fenêtre de rappel
    -- passée.
    update public.events set rappel_envoye = true where id = ev.id;
  end loop;
end;
$$;

-- 4) Planifie l'exécution quotidienne (08h00 UTC — ajustez l'heure dans
--    l'expression cron si vous préférez un autre moment de la journée).
--    `cron.schedule` avec un nom déjà utilisé remplace la planification
--    existante, donc ce script peut être relancé sans problème.
select cron.schedule(
  'rappel-evenements-quotidien',
  '0 8 * * *',
  $$select public.send_event_reminders();$$
);

-- =====================================================================
-- Vérification rapide après exécution :
--   select jobname, schedule, active from cron.job where jobname = 'rappel-evenements-quotidien';
--   -- doit afficher une ligne avec active = true
--
-- Pour tester sans attendre le lendemain matin, exécutez manuellement :
--   select public.send_event_reminders();
--   -- envoie immédiatement les rappels pour tout événement commençant
--   -- dans exactement 2 jours (nécessite la clé Resend configurée et,
--   -- pour un vrai test, un événement avec une inscription confirmée
--   -- dont la date de début tombe dans 2 jours).
--
-- Pour consulter l'historique des exécutions de la tâche planifiée :
--   select * from cron.job_run_details order by start_time desc limit 10;
-- =====================================================================
