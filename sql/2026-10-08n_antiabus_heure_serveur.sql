-- =====================================================================
-- Anti-abus des formulaires publics — correctif horloge (suite de
-- 2026-10-08m_antiabus_formulaires_publics.sql, plan qualité point 4.1)
-- =====================================================================
-- Problème corrigé : formulaire_debute_le était pris sur l'horloge du
-- visiteur, puis comparé à now() côté serveur. Un PC/téléphone mal réglé
-- (quelques minutes d'avance, ou plus d'une heure de retard) voyait sa
-- demande légitime refusée. Désormais le formulaire demande l'heure au
-- serveur à son affichage (fonction heure_serveur ci-dessous) et envoie
-- cette valeur — les deux côtés de la comparaison utilisent la même
-- horloge.
--
-- Le plafond passe aussi de 1 heure à 24 heures : un visiteur qui laisse
-- l'onglet ouvert (pause repas…) avant d'envoyer ne doit pas être rejeté,
-- et ce plafond n'apporte de toute façon presque rien contre un robot.
--
-- AUTONOME : ce script reprend aussi tout le contenu de la version m
-- (colonnes + politiques). Il peut être exécuté seul, que la version m
-- ait déjà été exécutée ou non. Ré-exécutable sans risque.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Heure du serveur, appelable sans compte (vitrine publique)
-- ---------------------------------------------------------------------
create or replace function public.heure_serveur()
returns timestamptz
language sql
stable
as $$ select now() $$;

comment on function public.heure_serveur() is
  'Heure courante du serveur. Utilisée par les formulaires publics anonymes (anti-abus) pour horodater leur affichage avec la même horloge que la politique RLS d''insertion.';

grant execute on function public.heure_serveur() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1) membership_requests
-- ---------------------------------------------------------------------
alter table public.membership_requests
  add column if not exists piege text,
  add column if not exists formulaire_debute_le timestamptz;

comment on column public.membership_requests.piege is
  'Champ piège anti-robot : toujours vide pour un humain (champ masqué à l''écran dans le formulaire public). Une valeur non vide signale un robot et fait rejeter l''insertion par la politique RLS.';
comment on column public.membership_requests.formulaire_debute_le is
  'Heure SERVEUR (fonction heure_serveur) de l''affichage du formulaire — sert à rejeter une soumission trop rapide (robot) ou implausiblement tardive via la politique RLS d''insertion.';

drop policy if exists "membership_requests insert public" on public.membership_requests;
create policy "membership_requests insert public" on public.membership_requests
  for insert to anon, authenticated
  with check (
    exists (select 1 from public.associations a where a.id = association_id and a.vitrine_active = true)
    and (piege is null or piege = '')
    and formulaire_debute_le is not null
    and now() - formulaire_debute_le > interval '3 seconds'
    and now() - formulaire_debute_le < interval '24 hours'
  );

-- ---------------------------------------------------------------------
-- 2) event_public_registrations
-- ---------------------------------------------------------------------
alter table public.event_public_registrations
  add column if not exists piege text,
  add column if not exists formulaire_debute_le timestamptz;

comment on column public.event_public_registrations.piege is
  'Champ piège anti-robot : toujours vide pour un humain (champ masqué à l''écran dans le formulaire public). Une valeur non vide signale un robot et fait rejeter l''insertion par la politique RLS.';
comment on column public.event_public_registrations.formulaire_debute_le is
  'Heure SERVEUR (fonction heure_serveur) de l''affichage du formulaire — sert à rejeter une soumission trop rapide (robot) ou implausiblement tardive via la politique RLS d''insertion.';

drop policy if exists "event_public_registrations insert public" on public.event_public_registrations;
create policy "event_public_registrations insert public" on public.event_public_registrations
  for insert to anon, authenticated
  with check (
    exists (
      select 1 from public.events e join public.associations a on a.id = e.association_id
      where e.id = event_id and e.public_inscription = true and e.annule = false and a.vitrine_active = true
    )
    and (piege is null or piege = '')
    and formulaire_debute_le is not null
    and now() - formulaire_debute_le > interval '3 seconds'
    and now() - formulaire_debute_le < interval '24 hours'
  );

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) : doit renvoyer 2 lignes contenant
-- "24:00:00" dans with_check, puis une heure dans la 2e requête.
-- ---------------------------------------------------------------------
-- select tablename, policyname, with_check from pg_policies
--   where policyname in ('membership_requests insert public', 'event_public_registrations insert public');
-- select public.heure_serveur();
