-- =====================================================================
-- Notifications push web (navigateur) — annonces urgentes
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois). Suite du plan
-- « internationalisation » (voir claude/internationalisation-universelle.md,
-- point 4 de la liste priorisée — deuxième moitié, après le bouton de
-- partage WhatsApp de la suite 81).
--
-- CE QUE CE SCRIPT AJOUTE :
--   1. Une table `push_subscriptions` : chaque appareil/navigateur où un
--      membre ou un membre du Bureau a activé les notifications push
--      (bouton 🔔 dans l'en-tête de l'application) y enregistre son
--      abonnement push (fourni par le navigateur, pas par vous).
--   2. Un secret partagé (`push_internal_secret`) dans le coffre-fort
--      Supabase Vault — sert uniquement à autoriser CETTE base de
--      données à appeler l'Edge Function `send-push-notification`
--      (livrée séparément, voir plus bas). Généré aléatoirement pour
--      vous, aucune action nécessaire sur ce point précis.
--   3. Une fonction + 2 déclencheurs qui envoient une notification push
--      à tous les appareils abonnés de l'association dès qu'une annonce
--      urgente est publiée — exactement le même déclencheur que le
--      courriel déjà en place (sql/2026-09-07h), en complément et non en
--      remplacement : les deux s'envoient indépendamment.
--
-- CE QUI RESTE À FAIRE DE VOTRE CÔTÉ, EN DEHORS DE CE SCRIPT SQL (une
-- notification push a besoin d'un vrai serveur capable de chiffrer le
-- message selon le protocole Web Push — ce n'est pas possible en SQL
-- pur, contrairement à un simple appel HTTP vers Resend) :
--   a) Déployer la nouvelle Edge Function `send-push-notification`
--      (fournie séparément dans supabase/functions/send-push-notification/) :
--        supabase functions deploy send-push-notification --no-verify-jwt
--      (--no-verify-jwt est nécessaire : cette fonction est appelée par
--      Postgres, pas par un membre connecté — même raison que pour
--      stripe-webhook.)
--   b) Configurer ses secrets (une seule fois, remplacez les valeurs) :
--        supabase secrets set VAPID_PUBLIC_KEY=BMBp71MSNmcDyhb6ANUCTSv5TnvVyeR0C1DQRaZ_H6gWJ4qFRrUnAvGFGB6_5cCkMShzBAGWz5PdVNKwr89ZV-4
--        supabase secrets set VAPID_PRIVATE_KEY=zWVbBzvi8s1RJ7rUTEI2U6SXMB-xaF6P29buiWI6Q34
--        supabase secrets set VAPID_SUBJECT=mailto:votre-adresse@example.com
--        supabase secrets set PUSH_INTERNAL_SECRET=5OCzcedkFzqiWugvRVYa6tqOTlqvyr0nExg5h8JPcNg
--      (Les clés VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ci-dessus sont une
--      vraie paire déjà générée pour vous — vous pouvez les utiliser
--      telles quelles, ce sont vos clés à vous, propres à AREM, pas des
--      clés de test partagées. PUSH_INTERNAL_SECRET est la MÊME valeur
--      que celle stockée dans le Vault par ce script plus bas — ne la
--      changez pas d'un côté sans la changer de l'autre.)
--   c) `public/sw.js` (le "service worker" qui reçoit les notifications
--      dans le navigateur) doit être présent dans votre projet — livré
--      séparément, déjà écrit dans votre dossier `public/`.
-- =====================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- 1) Table des abonnements push.
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

comment on table public.push_subscriptions is
  'Abonnements aux notifications push web (un par appareil/navigateur où un utilisateur a cliqué sur 🔔 Activer les notifications). Alimentée par le navigateur, jamais saisie à la main.';

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using (profile_id = auth.uid());

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert with check (profile_id = auth.uid() and association_id = public.current_association_id());

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and association_id = public.current_association_id());

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete using (profile_id = auth.uid());

-- Note : aucune policy "le Bureau peut tout lire" n'est nécessaire ici —
-- l'Edge Function qui envoie les notifications utilise la clé de
-- service Supabase (contourne RLS), exactement comme stripe-webhook.

-- ---------------------------------------------------------------------
-- 2) Secret partagé pour autoriser cette base à appeler l'Edge Function.
--    Généré aléatoirement pour vous — aucune valeur à choisir. La MÊME
--    valeur doit être configurée comme secret PUSH_INTERNAL_SECRET de
--    l'Edge Function (étape b ci-dessus).
-- ---------------------------------------------------------------------
select vault.create_secret(
  '5OCzcedkFzqiWugvRVYa6tqOTlqvyr0nExg5h8JPcNg',
  'push_internal_secret',
  'Secret partagé — autorise cette base à appeler l''Edge Function send-push-notification'
);

-- ---------------------------------------------------------------------
-- 3) Annonce urgente → notification push (complément du courriel déjà
--    envoyé par sql/2026-09-07h, indépendant de lui).
--    ⚠️ REMPLACEZ l'URL ci-dessous par celle de VOTRE projet Supabase si
--    elle diffère (visible dans src/supabaseClient.js, SUPABASE_URL) —
--    déjà pré-remplie avec celle d'AREM.
-- ---------------------------------------------------------------------
create or replace function public.notify_urgent_announcement_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  internal_secret text;
  assoc_nom text;
  assoc_logo text;
begin
  if new.urgent is not true then
    return new;
  end if;

  select decrypted_secret into internal_secret
    from vault.decrypted_secrets
    where name = 'push_internal_secret';

  if internal_secret is null then
    return new;
  end if;

  select a.nom, a.logo_url into assoc_nom, assoc_logo
    from public.associations a where a.id = new.association_id;

  perform net.http_post(
    url := 'https://hqqvkwvobmesgwbdjdko.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', internal_secret
    ),
    body := jsonb_build_object(
      'association_id', new.association_id,
      'title', '🔴 ' || coalesce(assoc_nom, 'Annonce urgente') || ' — ' || new.titre,
      'body', coalesce(new.message, ''),
      'icon', assoc_logo,
      'url', '/'
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_urgent_announcement_push on public.announcements;
create trigger trg_notify_urgent_announcement_push
  after insert on public.announcements
  for each row
  when (new.urgent is true)
  execute function public.notify_urgent_announcement_push();

drop trigger if exists trg_notify_urgent_announcement_push_update on public.announcements;
create trigger trg_notify_urgent_announcement_push_update
  after update on public.announcements
  for each row
  when (new.urgent is true and old.urgent is distinct from true)
  execute function public.notify_urgent_announcement_push();

-- =====================================================================
-- Vérification rapide après exécution :
--   select tgname from pg_trigger where tgname like 'trg_notify_urgent_announcement_push%';
--   -- doit afficher 2 lignes
--   select name from vault.decrypted_secrets where name = 'push_internal_secret';
--   -- doit afficher une ligne
--
-- Test réel (une fois l'Edge Function déployée ET ses secrets configurés,
-- étapes a/b/c ci-dessus, ET après avoir cliqué sur 🔔 dans l'en-tête de
-- l'application pour vous abonner vous-même) :
--   publier une annonce en cochant « urgente » → une notification push
--   devrait apparaître sur votre appareil dans les secondes qui suivent,
--   en plus du courriel déjà envoyé.
--
-- Si rien n'apparaît, dans l'ordre le plus probable :
--   1. L'Edge Function n'est pas encore déployée ou ses secrets ne sont
--      pas configurés (étapes a/b ci-dessus).
--   2. Vous n'êtes abonné sur AUCUN appareil (bouton 🔔 jamais cliqué,
--      ou permission refusée dans le navigateur).
--   3. Consultez le journal des réponses HTTP de pg_net (table interne
--      de l'extension, ex. `net._http_response` selon la version) pour
--      voir le code de statut exact renvoyé par l'Edge Function (401 =
--      secret interne incorrect, 500 = erreur côté fonction — consultez
--      alors ses logs via `supabase functions logs send-push-notification`).
-- =====================================================================
