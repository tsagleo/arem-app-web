-- =====================================================================
-- Covoiturage entre membres — rubrique complète (hors événements)
-- =====================================================================
-- Suite de claude/covoiturage-webinaires-emploi-proposition.md, demandée
-- par l'utilisateur le 2026-10-06 ("implémentation totale"). Contrairement
-- au covoiturage déjà existant (sql/2026-09-30_evenements_modernisation.sql,
-- section 7 : event_carpool_offers/event_carpool_requests, LIÉ à un
-- événement précis), cette rubrique est un tableau PERMANENT, consultable
-- en dehors de tout événement précis — un membre peut aussi, en option,
-- le relier à un événement existant (event_id).
--
-- MÊME PRINCIPE assumé que le covoiturage événementiel : AUCUNE mise en
-- relation automatique. L'offre/la demande affiche un bouton "Signaler
-- mon intérêt" qui envoie une notification push à l'auteur — les deux
-- personnes échangent ensuite leurs coordonnées par leurs propres moyens,
-- hors de l'application.
--
-- SIMPLIFICATIONS ASSUMÉES (à ajuster sur demande) :
--   - Pas de carte interactive embarquée (Leaflet/OpenStreetMap) cette
--     vague : le point de départ/arrivée reste du texte libre, avec un
--     lien "Ouvrir sur OpenStreetMap" qui pointe vers une recherche
--     Nominatim sur ce texte (aucune dépendance npm supplémentaire,
--     aucune clé API, mais pas de carte visuelle dans l'écran lui-même).
--   - Pas de système de notation/confiance cette vague : il supposerait un
--     flux de réservation/trajet "complété" qui n'existe pas encore (les
--     offres restent un tableau d'annonces, pas une réservation en bonne
--     et due forme). Peut être ajouté plus tard si un flux de réservation
--     voit le jour.
--   - Le calcul de partage des frais (distance × tarif/km, réparti entre
--     passagers) est purement côté client — aucune colonne dédiée, pas de
--     paiement réel associé.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------
create table if not exists public.carpool_offers (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  member_nom text,
  point_depart text not null,
  point_arrivee text not null,
  date_heure timestamptz not null,
  recurrence text not null default 'aucune',
  places_disponibles integer not null default 1 check (places_disponibles > 0),
  prix_place numeric,
  event_id uuid references public.events(id) on delete set null,
  notes text,
  statut text not null default 'active',
  created_at timestamptz not null default now()
);
alter table public.carpool_offers drop constraint if exists carpool_offers_recurrence_check;
alter table public.carpool_offers add constraint carpool_offers_recurrence_check
  check (recurrence in ('aucune', 'hebdomadaire', 'quotidien_ouvrable'));
alter table public.carpool_offers drop constraint if exists carpool_offers_statut_check;
alter table public.carpool_offers add constraint carpool_offers_statut_check
  check (statut in ('active', 'complete', 'annulee'));

create table if not exists public.carpool_requests (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  member_nom text,
  point_depart text not null,
  point_arrivee text not null,
  date_heure timestamptz not null,
  places_demandees integer not null default 1 check (places_demandees > 0),
  event_id uuid references public.events(id) on delete set null,
  notes text,
  statut text not null default 'active',
  created_at timestamptz not null default now()
);
alter table public.carpool_requests drop constraint if exists carpool_requests_statut_check;
alter table public.carpool_requests add constraint carpool_requests_statut_check
  check (statut in ('active', 'comblee', 'annulee'));

create index if not exists carpool_offers_assoc_idx on public.carpool_offers(association_id);
create index if not exists carpool_requests_assoc_idx on public.carpool_requests(association_id);

comment on table public.carpool_offers is
  'Rubrique Covoiturage (permanente, distincte de event_carpool_offers) — annonces d''offres de trajet entre membres, avec ou sans lien optionnel vers un événement.';
comment on table public.carpool_requests is
  'Rubrique Covoiturage — annonces de demandes de trajet entre membres, symétrique de carpool_offers.';

-- ---------------------------------------------------------------------
-- 2) RLS
-- ---------------------------------------------------------------------
alter table public.carpool_offers enable row level security;
alter table public.carpool_requests enable row level security;

drop policy if exists "carpool_offers select" on public.carpool_offers;
create policy "carpool_offers select" on public.carpool_offers for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "carpool_offers insert self" on public.carpool_offers;
create policy "carpool_offers insert self" on public.carpool_offers for insert to authenticated
  with check (association_id = public.current_association_id() and member_id = public.current_member_id());
drop policy if exists "carpool_offers update own" on public.carpool_offers;
create policy "carpool_offers update own" on public.carpool_offers for update to authenticated
  using (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()))
  with check (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()));
drop policy if exists "carpool_offers delete own" on public.carpool_offers;
create policy "carpool_offers delete own" on public.carpool_offers for delete to authenticated
  using (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()));

drop policy if exists "carpool_requests select" on public.carpool_requests;
create policy "carpool_requests select" on public.carpool_requests for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "carpool_requests insert self" on public.carpool_requests;
create policy "carpool_requests insert self" on public.carpool_requests for insert to authenticated
  with check (association_id = public.current_association_id() and member_id = public.current_member_id());
drop policy if exists "carpool_requests update own" on public.carpool_requests;
create policy "carpool_requests update own" on public.carpool_requests for update to authenticated
  using (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()))
  with check (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()));
drop policy if exists "carpool_requests delete own" on public.carpool_requests;
create policy "carpool_requests delete own" on public.carpool_requests for delete to authenticated
  using (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()));

-- ---------------------------------------------------------------------
-- 3) Signaler un intérêt (même esprit que signaler_interet_covoiturage
--    existant pour le covoiturage événementiel) — une fonction pour une
--    offre, une pour une demande.
-- ---------------------------------------------------------------------
create or replace function public.signaler_interet_offre_covoiturage(p_offer_id uuid, p_message text default null)
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
begin
  if v_member_id is null then
    return query select 'non_autorise'::text; return;
  end if;
  select * into v_offer from public.carpool_offers o where o.id = p_offer_id and o.association_id = public.current_association_id();
  if v_offer is null then
    return query select 'introuvable'::text; return;
  end if;
  if v_offer.member_id = v_member_id then
    return query select 'propre_offre'::text; return;
  end if;
  select nom into v_member_nom from public.members where id = v_member_id;
  select p.id into v_profile_id from public.profiles p where p.member_id = v_offer.member_id;
  perform public.notify_profile(
    v_offer.association_id, v_profile_id,
    '🚗 Intérêt pour votre trajet de covoiturage',
    coalesce(v_member_nom, 'Un membre') || ' est intéressé(e) par votre offre (' || v_offer.point_depart || ' → ' || v_offer.point_arrivee || ').' || coalesce(' « ' || p_message || ' »', '')
  );
  return query select 'notifie'::text;
end;
$fn$;
comment on function public.signaler_interet_offre_covoiturage(uuid, text) is
  'Notifie l''auteur d''une offre de covoiturage (rubrique permanente) qu''un membre est intéressé — sans mise en relation automatique, même principe que signaler_interet_covoiturage.';
grant execute on function public.signaler_interet_offre_covoiturage(uuid, text) to authenticated;

create or replace function public.signaler_interet_demande_covoiturage(p_request_id uuid, p_message text default null)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_member_nom text;
  v_request record;
  v_profile_id uuid;
begin
  if v_member_id is null then
    return query select 'non_autorise'::text; return;
  end if;
  select * into v_request from public.carpool_requests r where r.id = p_request_id and r.association_id = public.current_association_id();
  if v_request is null then
    return query select 'introuvable'::text; return;
  end if;
  if v_request.member_id = v_member_id then
    return query select 'propre_demande'::text; return;
  end if;
  select nom into v_member_nom from public.members where id = v_member_id;
  select p.id into v_profile_id from public.profiles p where p.member_id = v_request.member_id;
  perform public.notify_profile(
    v_request.association_id, v_profile_id,
    '🚗 Une place pourrait être disponible pour votre demande',
    coalesce(v_member_nom, 'Un membre') || ' propose une place pour votre demande de trajet (' || v_request.point_depart || ' → ' || v_request.point_arrivee || ').' || coalesce(' « ' || p_message || ' »', '')
  );
  return query select 'notifie'::text;
end;
$fn$;
comment on function public.signaler_interet_demande_covoiturage(uuid, text) is
  'Notifie l''auteur d''une demande de covoiturage qu''un membre propose une place — symétrique de signaler_interet_offre_covoiturage.';
grant execute on function public.signaler_interet_demande_covoiturage(uuid, text) to authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select table_name from information_schema.tables
--   where table_schema = 'public' and table_name in ('carpool_offers', 'carpool_requests');
--   -- doit afficher 2 lignes
--   select proname from pg_proc
--   where proname in ('signaler_interet_offre_covoiturage', 'signaler_interet_demande_covoiturage');
--   -- doit afficher 2 lignes
-- =====================================================================
