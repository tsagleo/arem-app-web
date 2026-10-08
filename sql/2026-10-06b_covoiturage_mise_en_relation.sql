-- =====================================================================
-- Covoiturage — mise en relation complète (réservation formelle,
-- révélation des coordonnées, suggestions automatiques, notation)
-- =====================================================================
-- Suite directe de sql/2026-10-06_covoiturage.sql (à exécuter en premier
-- si ce n'est pas déjà fait). L'utilisateur a demandé explicitement une
-- vraie mise en relation ("avec toutes les options, sans nul autre
-- pareil, en t'inspirant des concurrents") plutôt que le simple
-- "signaler mon intérêt" de la première vague — et un système de
-- navigation intégré pour s'y rendre.
--
-- CE QUI CHANGE PAR RAPPORT À LA PREMIÈRE VAGUE :
--   - Les OFFRES deviennent RÉSERVABLES (comme BlaBlaCar/Klaxit/Karos) :
--     un membre réserve N places, le conducteur accepte ou refuse, les
--     places disponibles se décomptent automatiquement.
--   - Dès qu'une réservation est ACCEPTÉE, les coordonnées (téléphone,
--     courriel) des deux personnes deviennent visibles l'une à l'autre
--     dans l'application — plus besoin d'échange manuel une fois l'accord
--     donné. Avant l'acceptation, rien n'est révélé.
--   - Les DEMANDES gardent leur bouton "Signaler mon intérêt" (symétrique,
--     informel) MAIS affichent désormais aussi des OFFRES CORRESPONDANTES
--     suggérées automatiquement (comparaison texte du trajet + proximité
--     de date, calculée côté client) — le demandeur peut réserver
--     directement sur une offre existante plutôt que d'attendre une
--     réponse manuelle.
--   - Un trajet réservé qui se termine (l'offre est marquée "Terminé")
--     ouvre la possibilité de NOTER l'autre personne (1 à 5, commentaire
--     facultatif) — devient possible maintenant qu'il existe un vrai
--     flux de réservation (contrairement à la première vague, où cette
--     fonctionnalité avait été explicitement exclue pour cette raison).
--
-- SIMPLIFICATIONS ASSUMÉES (inchangées ou nouvelles, à ajuster sur
-- demande) :
--   - Toujours pas de carte interactive embarquée avec tracé routier réel
--     (nécessiterait une clé API payante à ce volume) : la "navigation
--     intégrée" côté application ouvre les applications de navigation
--     existantes (Google Maps, Waze, Apple Maps, OpenStreetMap) avec le
--     départ/l'arrivée déjà remplis, en un clic, et affiche un aperçu
--     cartographique intégré (iframe Google Maps en mode "embed", sans
--     clé API) directement dans la fiche du trajet.
--   - Pas de messagerie interne : la révélation des coordonnées après
--     acceptation remplace le besoin d'une messagerie — les deux
--     personnes se contactent ensuite par téléphone/courriel, comme pour
--     n'importe quel autre contact dans l'application.
--   - Pas de paiement automatisé du partage des frais (le calculateur
--     reste indicatif, le paiement réel se fait entre les deux personnes
--     par leurs propres moyens, hors application).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) carpool_bookings — réservation formelle d'une offre
-- ---------------------------------------------------------------------
create table if not exists public.carpool_bookings (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  offer_id uuid not null references public.carpool_offers(id) on delete cascade,
  passenger_member_id uuid not null references public.members(id) on delete cascade,
  passenger_nom text,
  seats_reserved integer not null default 1 check (seats_reserved > 0),
  statut text not null default 'en_attente',
  message text,
  fulfilled_request_id uuid references public.carpool_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
alter table public.carpool_bookings drop constraint if exists carpool_bookings_statut_check;
alter table public.carpool_bookings add constraint carpool_bookings_statut_check
  check (statut in ('en_attente', 'acceptee', 'refusee', 'annulee', 'terminee'));

create index if not exists carpool_bookings_assoc_idx on public.carpool_bookings(association_id);
create index if not exists carpool_bookings_offer_idx on public.carpool_bookings(offer_id);
create index if not exists carpool_bookings_passenger_idx on public.carpool_bookings(passenger_member_id);
-- Empêche une double réservation active (en attente ou acceptée) du même membre sur la même offre.
drop index if exists carpool_bookings_unique_active;
create unique index carpool_bookings_unique_active on public.carpool_bookings(offer_id, passenger_member_id)
  where (statut in ('en_attente', 'acceptee'));

comment on table public.carpool_bookings is
  'Réservation formelle d''une offre de covoiturage (mise en relation réelle, suite de carpool_offers) — remplace le simple "signaler intérêt" pour les offres.';

-- ---------------------------------------------------------------------
-- 2) carpool_ratings — notation post-trajet (1 à 5), une fois la
--    réservation au statut "terminee"
-- ---------------------------------------------------------------------
create table if not exists public.carpool_ratings (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  booking_id uuid not null references public.carpool_bookings(id) on delete cascade,
  rater_member_id uuid not null references public.members(id) on delete cascade,
  rated_member_id uuid not null references public.members(id) on delete cascade,
  note smallint not null check (note between 1 and 5),
  commentaire text,
  created_at timestamptz not null default now()
);
drop index if exists carpool_ratings_unique_per_rater;
create unique index carpool_ratings_unique_per_rater on public.carpool_ratings(booking_id, rater_member_id);
create index if not exists carpool_ratings_rated_idx on public.carpool_ratings(rated_member_id);

comment on table public.carpool_ratings is
  'Notation mutuelle (conducteur ↔ passager) après un trajet de covoiturage terminé — 1 note par personne et par réservation.';

-- ---------------------------------------------------------------------
-- 3) RLS
-- ---------------------------------------------------------------------
alter table public.carpool_bookings enable row level security;
alter table public.carpool_ratings enable row level security;

drop policy if exists "carpool_bookings select" on public.carpool_bookings;
create policy "carpool_bookings select" on public.carpool_bookings for select to authenticated
  using (
    association_id = public.current_association_id()
    and (
      public.is_bureau()
      or passenger_member_id = public.current_member_id()
      or offer_id in (select id from public.carpool_offers where member_id = public.current_member_id())
    )
  );
-- Les transitions d'état (créer/accepter/refuser/annuler) passent toutes
-- par des fonctions security definer ci-dessous, qui appliquent elles-
-- mêmes les règles métier (places disponibles, propriétaire, etc.).
-- Ces policies directes ne sont qu'une sécurité de repli.
drop policy if exists "carpool_bookings insert self" on public.carpool_bookings;
create policy "carpool_bookings insert self" on public.carpool_bookings for insert to authenticated
  with check (association_id = public.current_association_id() and passenger_member_id = public.current_member_id());
drop policy if exists "carpool_bookings update involved" on public.carpool_bookings;
create policy "carpool_bookings update involved" on public.carpool_bookings for update to authenticated
  using (
    association_id = public.current_association_id()
    and (
      public.is_bureau()
      or passenger_member_id = public.current_member_id()
      or offer_id in (select id from public.carpool_offers where member_id = public.current_member_id())
    )
  );

drop policy if exists "carpool_ratings select" on public.carpool_ratings;
create policy "carpool_ratings select" on public.carpool_ratings for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "carpool_ratings insert self" on public.carpool_ratings;
create policy "carpool_ratings insert self" on public.carpool_ratings for insert to authenticated
  with check (association_id = public.current_association_id() and rater_member_id = public.current_member_id());

-- ---------------------------------------------------------------------
-- 4) Réserver une offre (remplace "signaler intérêt" côté offres)
-- ---------------------------------------------------------------------
create or replace function public.reserver_trajet_covoiturage(
  p_offer_id uuid,
  p_seats integer default 1,
  p_message text default null,
  p_request_id uuid default null
)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_member_nom text;
  v_offer record;
  v_profile_id uuid;
  v_booking_id uuid;
begin
  if v_member_id is null then
    return query select 'non_autorise'::text; return;
  end if;
  select * into v_offer from public.carpool_offers o
    where o.id = p_offer_id and o.association_id = public.current_association_id()
    for update;
  if v_offer is null then
    return query select 'introuvable'::text; return;
  end if;
  if v_offer.member_id = v_member_id then
    return query select 'propre_offre'::text; return;
  end if;
  if v_offer.statut <> 'active' or v_offer.places_disponibles < greatest(1, p_seats) then
    return query select 'places_insuffisantes'::text; return;
  end if;
  if exists (
    select 1 from public.carpool_bookings b
    where b.offer_id = p_offer_id and b.passenger_member_id = v_member_id and b.statut in ('en_attente', 'acceptee')
  ) then
    return query select 'deja_reserve'::text; return;
  end if;

  select nom into v_member_nom from public.members where id = v_member_id;
  insert into public.carpool_bookings (association_id, offer_id, passenger_member_id, passenger_nom, seats_reserved, message, fulfilled_request_id)
  values (v_offer.association_id, p_offer_id, v_member_id, v_member_nom, greatest(1, p_seats), p_message, p_request_id)
  returning id into v_booking_id;

  select p.id into v_profile_id from public.profiles p where p.member_id = v_offer.member_id;
  perform public.notify_profile(
    v_offer.association_id, v_profile_id,
    '🚗 Nouvelle demande de réservation',
    coalesce(v_member_nom, 'Un membre') || ' souhaite réserver ' || greatest(1, p_seats) || ' place(s) sur votre trajet (' || v_offer.point_depart || ' → ' || v_offer.point_arrivee || ').'
  );
  return query select 'ok'::text;
end;
$fn$;
comment on function public.reserver_trajet_covoiturage(uuid, integer, text, uuid) is
  'Réserve N places sur une offre de covoiturage (mise en relation réelle) — crée une réservation "en_attente", notifie le conducteur.';
grant execute on function public.reserver_trajet_covoiturage(uuid, integer, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Accepter / refuser une réservation (le conducteur)
-- ---------------------------------------------------------------------
create or replace function public.repondre_reservation_covoiturage(p_booking_id uuid, p_accepter boolean)
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
  if v_offer is null or (v_offer.member_id <> v_member_id and not public.is_bureau()) then
    return query select 'non_autorise'::text; return;
  end if;
  if v_booking.statut <> 'en_attente' then
    return query select 'deja_traitee'::text; return;
  end if;

  select p.id into v_profile_id from public.profiles p where p.member_id = v_booking.passenger_member_id;

  if p_accepter then
    if v_offer.places_disponibles < v_booking.seats_reserved then
      return query select 'places_insuffisantes'::text; return;
    end if;
    update public.carpool_bookings set statut = 'acceptee', responded_at = now() where id = p_booking_id;
    update public.carpool_offers
      set places_disponibles = places_disponibles - v_booking.seats_reserved,
          statut = case when places_disponibles - v_booking.seats_reserved <= 0 then 'complete' else statut end
      where id = v_offer.id;
    if v_booking.fulfilled_request_id is not null then
      update public.carpool_requests set statut = 'comblee' where id = v_booking.fulfilled_request_id and statut = 'active';
    end if;
    perform public.notify_profile(
      v_booking.association_id, v_profile_id,
      '✅ Réservation acceptée',
      'Votre réservation (' || v_offer.point_depart || ' → ' || v_offer.point_arrivee || ') a été acceptée — les coordonnées sont maintenant visibles.'
    );
  else
    update public.carpool_bookings set statut = 'refusee', responded_at = now() where id = p_booking_id;
    perform public.notify_profile(
      v_booking.association_id, v_profile_id,
      '✗ Réservation refusée',
      'Votre réservation (' || v_offer.point_depart || ' → ' || v_offer.point_arrivee || ') a été refusée par le conducteur.'
    );
  end if;
  return query select 'ok'::text;
end;
$fn$;
comment on function public.repondre_reservation_covoiturage(uuid, boolean) is
  'Le conducteur accepte ou refuse une réservation — décompte les places et notifie le passager à l''acceptation.';
grant execute on function public.repondre_reservation_covoiturage(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Annuler une réservation (passager, conducteur, ou bureau)
-- ---------------------------------------------------------------------
create or replace function public.annuler_reservation_covoiturage(p_booking_id uuid)
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
  v_was_accepted boolean;
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
  if v_booking.passenger_member_id <> v_member_id and (v_offer is null or v_offer.member_id <> v_member_id) and not public.is_bureau() then
    return query select 'non_autorise'::text; return;
  end if;
  if v_booking.statut in ('annulee', 'refusee', 'terminee') then
    return query select 'deja_annulee'::text; return;
  end if;

  v_was_accepted := v_booking.statut = 'acceptee';
  update public.carpool_bookings set statut = 'annulee', responded_at = now() where id = p_booking_id;
  if v_was_accepted and v_offer is not null then
    update public.carpool_offers
      set places_disponibles = places_disponibles + v_booking.seats_reserved,
          statut = case when statut = 'complete' then 'active' else statut end
      where id = v_offer.id;
  end if;

  -- Notifie l'autre partie (celle qui n'a pas annulé elle-même).
  if v_member_id = v_booking.passenger_member_id then
    select p.id into v_profile_id from public.profiles p where p.member_id = v_offer.member_id;
  else
    select p.id into v_profile_id from public.profiles p where p.member_id = v_booking.passenger_member_id;
  end if;
  perform public.notify_profile(
    v_booking.association_id, v_profile_id,
    '🚫 Réservation annulée',
    'Une réservation de covoiturage a été annulée' || case when v_offer is not null then ' (' || v_offer.point_depart || ' → ' || v_offer.point_arrivee || ')' else '' end || '.'
  );
  return query select 'ok'::text;
end;
$fn$;
comment on function public.annuler_reservation_covoiturage(uuid) is
  'Annule une réservation (par le passager, le conducteur, ou le bureau) — restitue les places si elle était acceptée.';
grant execute on function public.annuler_reservation_covoiturage(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7) Cascade automatique : quand une offre passe à "complete" (bouton
--    "Marquer terminé", mise à jour directe par le client), toutes ses
--    réservations "acceptee" passent à "terminee" — ce qui ouvre le
--    droit de notation. Ne s'applique PAS quand l'offre devient
--    "complete" simplement parce que les places sont épuisées par une
--    acceptation (le trajet n'a pas encore eu lieu) : on ne distingue
--    cependant pas les deux cas côté base — c'est le conducteur qui,
--    dans l'application, utilise explicitement "Marquer terminé" une
--    fois le trajet effectivement passé, plutôt qu'un passage automatique
--    piloté par l'épuisement des places (qui met plutôt le statut à
--    'complete' - voir repondre_reservation_covoiturage - mais la
--    notation n'est de toute façon proposée dans l'interface qu'une fois
--    la date du trajet passée, en plus de ce déclencheur).
-- ---------------------------------------------------------------------
create or replace function public.trg_carpool_offer_terminee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.statut = 'complete' and old.statut <> 'complete' and new.date_heure < now() then
    update public.carpool_bookings set statut = 'terminee' where offer_id = new.id and statut = 'acceptee';
  end if;
  return new;
end;
$fn$;
drop trigger if exists carpool_offer_terminee_trigger on public.carpool_offers;
create trigger carpool_offer_terminee_trigger
  after update on public.carpool_offers
  for each row execute function public.trg_carpool_offer_terminee();

-- ---------------------------------------------------------------------
-- 8) Noter l'autre partie après un trajet terminé
-- ---------------------------------------------------------------------
create or replace function public.noter_covoiturage(p_booking_id uuid, p_note integer, p_commentaire text default null)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_booking record;
  v_offer record;
  v_rated_id uuid;
begin
  if v_member_id is null then
    return query select 'non_autorise'::text; return;
  end if;
  if p_note < 1 or p_note > 5 then
    return query select 'note_invalide'::text; return;
  end if;
  select * into v_booking from public.carpool_bookings b
    where b.id = p_booking_id and b.association_id = public.current_association_id();
  if v_booking is null then
    return query select 'introuvable'::text; return;
  end if;
  select * into v_offer from public.carpool_offers o where o.id = v_booking.offer_id;
  if v_booking.passenger_member_id <> v_member_id and (v_offer is null or v_offer.member_id <> v_member_id) then
    return query select 'non_autorise'::text; return;
  end if;
  if v_booking.statut <> 'terminee' then
    return query select 'pas_termine'::text; return;
  end if;
  if exists (select 1 from public.carpool_ratings where booking_id = p_booking_id and rater_member_id = v_member_id) then
    return query select 'deja_note'::text; return;
  end if;

  v_rated_id := case when v_member_id = v_booking.passenger_member_id then v_offer.member_id else v_booking.passenger_member_id end;
  insert into public.carpool_ratings (association_id, booking_id, rater_member_id, rated_member_id, note, commentaire)
  values (v_booking.association_id, p_booking_id, v_member_id, v_rated_id, p_note, p_commentaire);
  return query select 'ok'::text;
end;
$fn$;
comment on function public.noter_covoiturage(uuid, integer, text) is
  'Note l''autre partie (1 à 5 + commentaire facultatif) après un trajet de covoiturage terminé.';
grant execute on function public.noter_covoiturage(uuid, integer, text) to authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select table_name from information_schema.tables
--   where table_schema = 'public' and table_name in ('carpool_bookings', 'carpool_ratings');
--   -- doit afficher 2 lignes
--   select proname from pg_proc
--   where proname in ('reserver_trajet_covoiturage', 'repondre_reservation_covoiturage',
--                      'annuler_reservation_covoiturage', 'noter_covoiturage');
--   -- doit afficher 4 lignes
-- =====================================================================
