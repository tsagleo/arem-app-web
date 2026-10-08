-- =====================================================================
-- Covoiturage — Phase C : tableau de bord d'impact collectif
-- =====================================================================
-- Suite de claude/covoiturage-haut-de-gamme-proposition.md. Ajoute la
-- distance réelle d'un trajet TERMINÉ, calculée côté base (ST_Distance
-- sur depart_geo/arrivee_geo de l'offre, déjà générés depuis sql/2026-
-- 10-07_covoiturage_dispatch_sophistique.sql — aucun nouvel appel OSRM
-- nécessaire, le calcul est fait une seule fois, au moment où le trajet
-- se termine, puis reste figé). Le cumul (km partagés, CO2 estimé évité)
-- se calcule ensuite côté client (Covoiturage.jsx) à partir des
-- réservations déjà chargées, comme les statistiques de timing
-- existantes — pas besoin de fonction d'agrégation dédiée.
--
-- Facteur CO2 assumé (0,2 kg/km évité par place occupée) : estimation
-- indicative courante pour un trajet automobile partagé, affichée avec
-- la mention "estimation" dans l'interface — pas un chiffre audité
-- comme le rapport d'impact de BlaBlaCar, mais le même esprit : rendre
-- l'impact collectif visible pour l'association (AG, rapport annuel).
-- =====================================================================

alter table public.carpool_bookings add column if not exists distance_m numeric;
comment on column public.carpool_bookings.distance_m is
  'Distance du trajet (mètres), calculée via ST_Distance sur les points depart/arrivee de l''offre au moment où la réservation passe à "terminee" (avancer_etape_covoiturage) — alimente le tableau de bord d''impact collectif côté client. Reste nul si l''offre n''avait pas de coordonnées géocodées.';

-- avancer_etape_covoiturage (déjà redéfinie dans sql/2026-10-08c pour
-- ajouter terminee_at) — redéfinie à nouveau pour ajouter distance_m,
-- corps par ailleurs identique.
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
  if p_etape not in ('en_route', 'a_bord', 'terminee') then
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
     or (p_etape = 'a_bord' and v_booking.statut <> 'en_route')
     or (p_etape = 'terminee' and v_booking.statut <> 'a_bord') then
    return query select 'etape_invalide'::text; return;
  end if;

  update public.carpool_bookings set
    statut = p_etape,
    en_route_at = case when p_etape = 'en_route' then now() else en_route_at end,
    a_bord_at = case when p_etape = 'a_bord' then now() else a_bord_at end,
    terminee_at = case when p_etape = 'terminee' then now() else terminee_at end,
    distance_m = case when p_etape = 'terminee' and v_offer.depart_geo is not null and v_offer.arrivee_geo is not null
      then extensions.ST_Distance(v_offer.depart_geo, v_offer.arrivee_geo) else distance_m end
  where id = p_booking_id;

  select p.id into v_profile_id from public.profiles p where p.member_id = v_booking.passenger_member_id;
  perform public.notify_profile(
    v_booking.association_id, v_profile_id,
    case p_etape when 'en_route' then '🚗 Votre conducteur est en route'
                 when 'a_bord' then '🚗 Trajet commencé'
                 else '🏁 Trajet terminé' end,
    case p_etape when 'en_route' then 'Votre conducteur se dirige vers le point de départ.'
                 when 'a_bord' then 'Le trajet est commencé — bon voyage !'
                 else 'Le trajet est terminé. Vous pouvez maintenant noter votre conducteur.' end
  );
  return query select 'ok'::text;
end;
$fn$;
comment on function public.avancer_etape_covoiturage(uuid, text) is
  'Le conducteur fait progresser une réservation acceptée dans le cycle de vie de la course : en_route → a_bord → terminee, avec notification au passager à chaque étape, horodatage de chaque étape (en_route_at, a_bord_at, terminee_at) et calcul de la distance réelle du trajet (distance_m) à la clôture — alimente les statistiques de timing ET le tableau de bord d''impact collectif.';
grant execute on function public.avancer_etape_covoiturage(uuid, text) to authenticated;

-- Rattrapage : calcule distance_m pour les réservations déjà "terminee"
-- avant ce script, quand l'offre liée a des coordonnées exploitables —
-- sinon le tableau de bord d'impact sous-compterait les trajets déjà
-- effectués avant ce déploiement.
update public.carpool_bookings b
set distance_m = extensions.ST_Distance(o.depart_geo, o.arrivee_geo)
from public.carpool_offers o
where b.offer_id = o.id and b.statut = 'terminee' and b.distance_m is null
  and o.depart_geo is not null and o.arrivee_geo is not null;

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns
--   where table_name = 'carpool_bookings' and column_name = 'distance_m';
--   -- doit afficher 1 ligne
--   select count(*) from public.carpool_bookings where statut = 'terminee' and distance_m is not null;
--   -- doit être > 0 s'il existe déjà des trajets terminés avec coordonnées
-- =====================================================================
