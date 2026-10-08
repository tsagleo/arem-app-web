-- =====================================================================
-- Covoiturage — Nouvelle étape : arrivée effective du conducteur
-- =====================================================================
-- Demande explicite de Léo : avant « Passager à bord », matérialiser le
-- moment où le conducteur arrive réellement au point de rendez-vous —
-- jusqu'ici le cycle de vie passait directement de « en_route » à
-- « a_bord », sans distinguer le temps de conduite vers le passager du
-- temps d'attente au point de rendez-vous une fois arrivé.
--
-- Nouveau cycle de vie : acceptee → en_route → arrivee → a_bord → terminee.
-- Redéfinit avancer_etape_covoiturage (déjà redéfinie dans sql/2026-10-08c
-- puis 2026-10-08g pour terminee_at et distance_m) — corps repris dans son
-- intégralité, avec l'étape arrivee insérée dans la chaîne de validation.
-- =====================================================================

alter table public.carpool_bookings add column if not exists arrivee_at timestamptz;
comment on column public.carpool_bookings.arrivee_at is
  'Horodatage de l''arrivée effective du conducteur au point de rendez-vous (étape "arrivee", entre en_route et a_bord), posé par avancer_etape_covoiturage — distingue le temps de conduite (en_route_at → arrivee_at) du temps d''attente au point de rendez-vous (arrivee_at → a_bord_at).';

alter table public.carpool_bookings drop constraint if exists carpool_bookings_statut_check;
alter table public.carpool_bookings add constraint carpool_bookings_statut_check
  check (statut in ('en_attente', 'acceptee', 'en_route', 'arrivee', 'a_bord', 'refusee', 'annulee', 'terminee'));

create or replace function public.avancer_etape_covoiturage(p_booking_id uuid, p_etape text)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_booking record;
  v_offer record;
  v_profile_id uuid;
begin
  if v_member_id is null then
    return query select 'non_autorise'::text; return;
  end if;
  if p_etape not in ('en_route', 'arrivee', 'a_bord', 'terminee') then
    return query select 'etape_invalide'::text; return;
  end if;
  select * into v_booking from public.carpool_bookings b
    where b.id = p_booking_id and b.association_id = public.current_association_id()
    for update;
  if v_booking is null then
    return query select 'introuvable'::text; return;
  end if;
  select * into v_offer from public.carpool_offers o where o.id = v_booking.offer_id;
  if v_offer is null or (v_offer.member_id <> v_member_id and not public.is_bureau()) then
    return query select 'non_autorise'::text; return;
  end if;
  if (p_etape = 'en_route' and v_booking.statut <> 'acceptee')
     or (p_etape = 'arrivee' and v_booking.statut <> 'en_route')
     or (p_etape = 'a_bord' and v_booking.statut <> 'arrivee')
     or (p_etape = 'terminee' and v_booking.statut <> 'a_bord') then
    return query select 'etape_invalide'::text; return;
  end if;

  update public.carpool_bookings set
    statut = p_etape,
    en_route_at = case when p_etape = 'en_route' then now() else en_route_at end,
    arrivee_at = case when p_etape = 'arrivee' then now() else arrivee_at end,
    a_bord_at = case when p_etape = 'a_bord' then now() else a_bord_at end,
    terminee_at = case when p_etape = 'terminee' then now() else terminee_at end,
    distance_m = case when p_etape = 'terminee' and v_offer.depart_geo is not null and v_offer.arrivee_geo is not null
      then extensions.ST_Distance(v_offer.depart_geo, v_offer.arrivee_geo) else distance_m end
  where id = p_booking_id;

  select p.id into v_profile_id from public.profiles p where p.member_id = v_booking.passenger_member_id;
  perform public.notify_profile(
    v_booking.association_id, v_profile_id,
    case p_etape when 'en_route' then '🚗 Votre conducteur est en route'
                 when 'arrivee' then '📍 Votre conducteur est arrivé'
                 when 'a_bord' then '🚗 Trajet commencé'
                 else '🏁 Trajet terminé' end,
    case p_etape when 'en_route' then 'Votre conducteur se dirige vers le point de départ.'
                 when 'arrivee' then 'Votre conducteur est arrivé au point de rendez-vous — rejoignez-le !'
                 when 'a_bord' then 'Le trajet est commencé — bon voyage !'
                 else 'Le trajet est terminé. Vous pouvez maintenant noter votre conducteur.' end
  );
  return query select 'ok'::text;
end;
$fn$;
comment on function public.avancer_etape_covoiturage(uuid, text) is
  'Le conducteur fait progresser une réservation acceptée dans le cycle de vie de la course : en_route → arrivee → a_bord → terminee, avec notification au passager à chaque étape, horodatage de chaque étape (en_route_at, arrivee_at, a_bord_at, terminee_at) et calcul de la distance réelle du trajet (distance_m) à la clôture.';
grant execute on function public.avancer_etape_covoiturage(uuid, text) to authenticated;

-- signaler_absence_covoiturage (sql/2026-10-08e) redéfinie pour permettre
-- de signaler une absence même une fois le conducteur arrivé au point de
-- rendez-vous (étape "arrivee"), pas seulement "acceptee"/"en_route" —
-- corps par ailleurs identique.
create or replace function public.signaler_absence_covoiturage(p_booking_id uuid)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_booking record;
  v_offer record;
  v_profile_id uuid;
begin
  if v_member_id is null then
    return query select 'non_autorise'::text; return;
  end if;
  select * into v_booking from public.carpool_bookings b
    where b.id = p_booking_id and b.association_id = public.current_association_id()
    for update;
  if v_booking is null then
    return query select 'introuvable'::text; return;
  end if;
  select * into v_offer from public.carpool_offers o where o.id = v_booking.offer_id for update;
  if v_offer is null or v_offer.member_id <> v_member_id then
    return query select 'non_autorise'::text; return;
  end if;
  if v_booking.statut not in ('acceptee', 'en_route', 'arrivee') then
    return query select 'etape_invalide'::text; return;
  end if;

  update public.carpool_bookings set statut = 'annulee', no_show = true, responded_at = now() where id = p_booking_id;
  update public.carpool_offers
    set places_disponibles = places_disponibles + v_booking.seats_reserved,
        statut = case when statut = 'complete' then 'active' else statut end
    where id = v_offer.id;

  select p.id into v_profile_id from public.profiles p where p.member_id = v_booking.passenger_member_id;
  perform public.notify_profile(
    v_booking.association_id, v_profile_id,
    '⚠️ Absence signalée',
    'Le conducteur a signalé que vous ne vous êtes pas présenté(e) au point de rendez-vous convenu.'
  );
  return query select 'ok'::text;
end;
$fn$;
grant execute on function public.signaler_absence_covoiturage(uuid) to authenticated;
comment on function public.signaler_absence_covoiturage(uuid) is
  'Le conducteur signale qu''un passager ne s''est pas présenté (même une fois arrivé au point de rendez-vous) — annule la réservation, restitue la place, marque no_show=true.';

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns
--   where table_name = 'carpool_bookings' and column_name = 'arrivee_at';
--   -- doit afficher 1 ligne
--   select conname from pg_constraint where conname = 'carpool_bookings_statut_check';
--   -- doit afficher 1 ligne (contrainte recréée avec 'arrivee')
-- =====================================================================
