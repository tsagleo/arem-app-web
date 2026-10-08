-- =====================================================================
-- Covoiturage — Phase A : la couche de confiance
-- =====================================================================
-- Suite de claude/covoiturage-haut-de-gamme-proposition.md, approuvée par
-- l'utilisateur le 2026-10-08 ("d'accord pour les phases A, B et C").
-- Cinq ajouts, chacun inspiré de la recherche concurrentielle (BlaBlaCar,
-- Poparide) mais sans AUCUN service payant (pas de vérification d'identité
-- tierce, pas de SMS payant) — cohérent avec "gratuit, pas commercial" :
--   1) Préférences de trajet (non-fumeur, musique, animaux) sur les offres.
--   2) Badge "vérifié par le bureau" — déclaratif/manuel, pas d'API d'identité.
--   3) Avis textuels (déjà possibles via carpool_ratings.commentaire,
--      simplement jamais affichés jusqu'ici) + suspension du module par le
--      bureau en cas d'abus répété (signalements/notes basses).
--   4) Politique de fiabilité : signalement d'absence (no-show) et
--      annulation tardive (<2h avant le trajet), comptabilisés pour qu'un
--      conducteur voie le passé d'un passager avant d'accepter.
--   5) Messagerie in-app liée à une réservation — permet d'échanger AVANT
--      l'acceptation (donc avant la révélation des coordonnées) sans
--      jamais exposer le numéro de téléphone tant que rien n'est accepté.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Préférences de trajet (sur l'offre — décrit le trajet du conducteur)
-- ---------------------------------------------------------------------
alter table public.carpool_offers add column if not exists pref_non_fumeur boolean not null default false;
alter table public.carpool_offers add column if not exists pref_musique boolean not null default false;
alter table public.carpool_offers add column if not exists pref_animaux boolean not null default false;
comment on column public.carpool_offers.pref_non_fumeur is 'Préférence de trajet déclarée par le conducteur : non-fumeur. false = non précisé, pas nécessairement "fumeur autorisé".';
comment on column public.carpool_offers.pref_musique is 'Préférence de trajet déclarée par le conducteur : musique bienvenue pendant le trajet.';
comment on column public.carpool_offers.pref_animaux is 'Préférence de trajet déclarée par le conducteur : animaux de compagnie acceptés.';

-- ---------------------------------------------------------------------
-- 2) Badge de vérification — déclaratif, attribué par le bureau
--    (remplace les paliers "email/téléphone/pièce d'identité" de
--    BlaBlaCar par un seul palier géré humainement, sans aucune API
--    d'identité payante : le bureau connaît ses membres).
-- ---------------------------------------------------------------------
alter table public.members add column if not exists covoiturage_verifie boolean not null default false;
alter table public.members add column if not exists covoiturage_verifie_le timestamptz;
alter table public.members add column if not exists covoiturage_verifie_par uuid references public.profiles(id) on delete set null;
comment on column public.members.covoiturage_verifie is 'Badge "vérifié par le bureau" pour le covoiturage — attribution manuelle (verifier_membre_covoiturage), pas de service de vérification d''identité tiers.';

create or replace function public.verifier_membre_covoiturage(p_member_id uuid, p_verifie boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_bureau() then
    raise exception 'Seul le bureau peut attribuer le badge de vérification covoiturage.';
  end if;
  update public.members set
    covoiturage_verifie = p_verifie,
    covoiturage_verifie_le = case when p_verifie then now() else null end,
    covoiturage_verifie_par = case when p_verifie then auth.uid() else null end
  where id = p_member_id and association_id = public.current_association_id();
  if not found then
    raise exception 'Membre introuvable.';
  end if;
end;
$fn$;
grant execute on function public.verifier_membre_covoiturage(uuid, boolean) to authenticated;
comment on function public.verifier_membre_covoiturage(uuid, boolean) is
  'Attribue ou retire le badge "vérifié par le bureau" d''un membre pour le covoiturage — réservé au bureau.';

-- ---------------------------------------------------------------------
-- 3) Modération : suspension de l'accès au covoiturage par le bureau
--    (sanction après signalements/notes répétées — carpool_incidents et
--    carpool_ratings.commentaire existent déjà depuis les scripts
--    précédents, ce qui manquait était le pouvoir d'agir dessus).
-- ---------------------------------------------------------------------
alter table public.members add column if not exists covoiturage_suspendu boolean not null default false;
alter table public.members add column if not exists covoiturage_suspendu_motif text;
comment on column public.members.covoiturage_suspendu is 'Membre suspendu du module Covoiturage par le bureau (abus signalé) — bloque toute nouvelle offre/demande/réservation (voir trg_covoiturage_suspendu_*).';

create or replace function public.suspendre_covoiturage(p_member_id uuid, p_suspendu boolean, p_motif text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_profile_id uuid;
begin
  if not public.is_bureau() then
    raise exception 'Seul le bureau peut suspendre ou réactiver l''accès au covoiturage.';
  end if;
  update public.members set
    covoiturage_suspendu = p_suspendu,
    covoiturage_suspendu_motif = case when p_suspendu then p_motif else null end
  where id = p_member_id and association_id = public.current_association_id();
  if not found then
    raise exception 'Membre introuvable.';
  end if;
  select p.id into v_profile_id from public.profiles p where p.member_id = p_member_id;
  perform public.notify_profile(
    public.current_association_id(), v_profile_id,
    case when p_suspendu then '🚫 Accès au covoiturage suspendu' else '✅ Accès au covoiturage réactivé' end,
    case when p_suspendu then ('Le bureau a suspendu votre accès au covoiturage.' || case when p_motif is not null and p_motif <> '' then ' Motif : ' || p_motif else '' end)
         else 'Votre accès au covoiturage a été réactivé par le bureau.' end
  );
end;
$fn$;
grant execute on function public.suspendre_covoiturage(uuid, boolean, text) to authenticated;
comment on function public.suspendre_covoiturage(uuid, boolean, text) is
  'Suspend ou réactive l''accès d''un membre au module Covoiturage — réservé au bureau, notifie le membre concerné.';

create or replace function public.empecher_covoiturage_si_suspendu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid;
begin
  v_member_id := case when tg_table_name = 'carpool_bookings' then new.passenger_member_id else new.member_id end;
  if exists (select 1 from public.members where id = v_member_id and covoiturage_suspendu) then
    raise exception 'Votre accès au module Covoiturage a été suspendu par le bureau de votre association.';
  end if;
  return new;
end;
$fn$;
comment on function public.empecher_covoiturage_si_suspendu() is
  'Déclencheur : bloque toute nouvelle offre/demande/réservation d''un membre suspendu du covoiturage (voir suspendre_covoiturage) — réutilisé sur les trois tables d''entrée.';

drop trigger if exists trg_covoiturage_suspendu_offers on public.carpool_offers;
create trigger trg_covoiturage_suspendu_offers
  before insert on public.carpool_offers
  for each row execute function public.empecher_covoiturage_si_suspendu();

drop trigger if exists trg_covoiturage_suspendu_requests on public.carpool_requests;
create trigger trg_covoiturage_suspendu_requests
  before insert on public.carpool_requests
  for each row execute function public.empecher_covoiturage_si_suspendu();

drop trigger if exists trg_covoiturage_suspendu_bookings on public.carpool_bookings;
create trigger trg_covoiturage_suspendu_bookings
  before insert on public.carpool_bookings
  for each row execute function public.empecher_covoiturage_si_suspendu();

-- ---------------------------------------------------------------------
-- 4) Politique de fiabilité : absence (no-show) et annulation tardive
-- ---------------------------------------------------------------------
alter table public.carpool_bookings add column if not exists no_show boolean not null default false;
alter table public.carpool_bookings add column if not exists annulation_tardive boolean not null default false;
comment on column public.carpool_bookings.no_show is 'Le conducteur a signalé que le passager ne s''est pas présenté (signaler_absence_covoiturage).';
comment on column public.carpool_bookings.annulation_tardive is 'Réservation acceptée annulée moins de 2h avant le trajet — comptabilisé dans la fiabilité du membre, sans sanction automatique.';

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
  if v_booking.statut not in ('acceptee', 'en_route') then
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
  'Le conducteur signale qu''un passager ne s''est pas présenté — annule la réservation, restitue la place, marque no_show=true (visible des futurs conducteurs avant d''accepter).';

-- annuler_reservation_covoiturage (sql/2026-10-06b) redéfinie pour
-- marquer annulation_tardive quand une réservation ACCEPTÉE est annulée
-- moins de 2h avant le trajet — reste du corps identique à l'original.
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
  v_tardive boolean;
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
  v_tardive := v_was_accepted and v_offer is not null and (v_offer.date_heure - now()) < interval '2 hours';
  update public.carpool_bookings set statut = 'annulee', responded_at = now(), annulation_tardive = v_tardive where id = p_booking_id;
  if v_was_accepted and v_offer is not null then
    update public.carpool_offers
      set places_disponibles = places_disponibles + v_booking.seats_reserved,
          statut = case when statut = 'complete' then 'active' else statut end
      where id = v_offer.id;
  end if;

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
  'Annule une réservation (par le passager, le conducteur, ou le bureau) — restitue les places si elle était acceptée, et marque annulation_tardive si l''annulation d''une réservation acceptée survient moins de 2h avant le trajet (politique de fiabilité).';
grant execute on function public.annuler_reservation_covoiturage(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Messagerie in-app liée à une réservation (avant acceptation incluse)
--    — ne révèle jamais le numéro de téléphone, contrairement à
--    ContactReveal qui ne s'active qu'après acceptation.
-- ---------------------------------------------------------------------
create table if not exists public.carpool_messages (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  booking_id uuid not null references public.carpool_bookings(id) on delete cascade,
  sender_member_id uuid not null references public.members(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists carpool_messages_booking_idx on public.carpool_messages(booking_id);
create index if not exists carpool_messages_assoc_idx on public.carpool_messages(association_id);
comment on table public.carpool_messages is
  'Messagerie in-app liée à une réservation de covoiturage — permet d''échanger avant même l''acceptation (donc avant la révélation des coordonnées), sans jamais exposer le numéro de téléphone.';

alter table public.carpool_messages enable row level security;

drop policy if exists "carpool_messages select" on public.carpool_messages;
create policy "carpool_messages select" on public.carpool_messages for select to authenticated
  using (
    association_id = public.current_association_id()
    and (
      public.is_bureau()
      or booking_id in (
        select b.id from public.carpool_bookings b
        join public.carpool_offers o on o.id = b.offer_id
        where b.passenger_member_id = public.current_member_id() or o.member_id = public.current_member_id()
      )
    )
  );
drop policy if exists "carpool_messages insert" on public.carpool_messages;
create policy "carpool_messages insert" on public.carpool_messages for insert to authenticated
  with check (
    association_id = public.current_association_id()
    and sender_member_id = public.current_member_id()
    and booking_id in (
      select b.id from public.carpool_bookings b
      join public.carpool_offers o on o.id = b.offer_id
      where (b.passenger_member_id = public.current_member_id() or o.member_id = public.current_member_id())
        and b.statut not in ('refusee', 'annulee', 'terminee')
    )
  );

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns where table_name = 'carpool_offers'
--   and column_name in ('pref_non_fumeur','pref_musique','pref_animaux');
--   -- doit afficher 3 lignes
--   select column_name from information_schema.columns where table_name = 'members'
--   and column_name in ('covoiturage_verifie','covoiturage_suspendu');
--   -- doit afficher 2 lignes
--   select column_name from information_schema.columns where table_name = 'carpool_bookings'
--   and column_name in ('no_show','annulation_tardive');
--   -- doit afficher 2 lignes
--   select table_name from information_schema.tables where table_name = 'carpool_messages';
--   -- doit afficher 1 ligne
--   select proname from pg_proc where proname in
--     ('verifier_membre_covoiturage','suspendre_covoiturage','signaler_absence_covoiturage');
--   -- doit afficher 3 lignes
-- =====================================================================
