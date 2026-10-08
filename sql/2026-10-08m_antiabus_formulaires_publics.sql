-- =====================================================================
-- Anti-abus des formulaires publics anonymes (suite 2026-10-08, plan
-- qualité technique et produit point 4.1)
-- =====================================================================
-- Constat : deux tables acceptent une insertion anonyme sans aucune
-- limite — membership_requests (demande d'adhésion, vitrine publique) et
-- event_public_registrations (inscription publique à un événement). Rien
-- n'empêche aujourd'hui un robot de les remplir en boucle.
--
-- Choix (le moins coûteux, zéro dépendance externe, zéro compte tiers) :
--   1) un champ « piège » invisible à l'oeil humain (le formulaire
--      l'affiche hors écran) — un robot qui remplit tous les champs le
--      remplit aussi, ce qui trahit son passage ;
--   2) un délai minimum de remplissage — le client enregistre l'instant
--      où le formulaire s'est affiché (formulaire_debute_le) et on
--      refuse toute soumission arrivée moins de 3 secondes après (aucun
--      humain ne remplit nom+courriel plus vite), ou plus d'une heure
--      après (probablement une valeur rejouée/périmée plutôt qu'une vraie
--      session de remplissage).
--
-- Les deux contrôles sont ajoutés directement dans la clause "with check"
-- de la politique RLS d'insertion déjà en place — pas de nouvelle fonction
-- ni de trigger : la ligne est simplement rejetée (comme n'importe quelle
-- autre violation RLS) si l'un des deux indices de robot est présent.
-- Bloque la grande majorité des robots simples ; si un abus réel subsiste
-- malgré ça, l'étape suivante (non faite ici) serait Cloudflare Turnstile.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) membership_requests
-- ---------------------------------------------------------------------
alter table public.membership_requests
  add column if not exists piege text,
  add column if not exists formulaire_debute_le timestamptz;

comment on column public.membership_requests.piege is
  'Champ piège anti-robot : toujours vide pour un humain (champ masqué à l''écran dans le formulaire public). Une valeur non vide signale un robot et fait rejeter l''insertion par la politique RLS.';
comment on column public.membership_requests.formulaire_debute_le is
  'Horodatage côté client de l''affichage du formulaire (pas de l''envoi) — sert à rejeter une soumission trop rapide (robot) ou implausiblement tardive (valeur rejouée) via la politique RLS d''insertion.';

drop policy if exists "membership_requests insert public" on public.membership_requests;
create policy "membership_requests insert public" on public.membership_requests
  for insert to anon, authenticated
  with check (
    exists (select 1 from public.associations a where a.id = association_id and a.vitrine_active = true)
    and (piege is null or piege = '')
    and formulaire_debute_le is not null
    and now() - formulaire_debute_le > interval '3 seconds'
    and now() - formulaire_debute_le < interval '1 hour'
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
  'Horodatage côté client de l''affichage du formulaire (pas de l''envoi) — sert à rejeter une soumission trop rapide (robot) ou implausiblement tardive (valeur rejouée) via la politique RLS d''insertion.';

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
    and now() - formulaire_debute_le < interval '1 hour'
  );
