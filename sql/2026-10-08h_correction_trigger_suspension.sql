-- =====================================================================
-- Covoiturage — Correction : trigger de suspension cassait la publication
-- =====================================================================
-- Régression introduite par sql/2026-10-08e_covoiturage_phase_a_confiance.sql.
-- empecher_covoiturage_si_suspendu() était une SEULE fonction attachée aux
-- trois tables carpool_offers / carpool_requests / carpool_bookings, avec :
--   v_member_id := case when tg_table_name = 'carpool_bookings'
--                       then new.passenger_member_id else new.member_id end;
-- Or carpool_offers et carpool_requests n'ont PAS de colonne
-- passenger_member_id (seule carpool_bookings l'a). PL/pgSQL résout
-- NEW.<champ> par rapport au type de ligne réel de la table qui a déclenché
-- le trigger, et échoue dès la résolution du champ — même dans une branche
-- CASE qui ne s'exécuterait jamais pour cette table. Résultat : toute
-- insertion dans carpool_offers ou carpool_requests (donc toute publication
-- d'une offre ou d'une demande de trajet) échouait avec :
--   record "new" has no field "passenger_member_id"
--
-- Correction : deux fonctions distinctes, chacune référencant uniquement
-- la colonne qui existe réellement sur sa table — plus de CASE sur tg_table_name.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Pour carpool_offers / carpool_requests (colonne member_id)
-- ---------------------------------------------------------------------
create or replace function public.empecher_covoiturage_si_suspendu_trajet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if exists (select 1 from public.members where id = new.member_id and covoiturage_suspendu) then
    raise exception 'Votre accès au module Covoiturage a été suspendu par le bureau de votre association.';
  end if;
  return new;
end;
$fn$;
comment on function public.empecher_covoiturage_si_suspendu_trajet() is
  'Déclencheur : bloque toute nouvelle offre/demande d''un membre suspendu du covoiturage (voir suspendre_covoiturage) — carpool_offers/carpool_requests (colonne member_id).';

-- ---------------------------------------------------------------------
-- 2) Pour carpool_bookings (colonne passenger_member_id)
-- ---------------------------------------------------------------------
create or replace function public.empecher_covoiturage_si_suspendu_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if exists (select 1 from public.members where id = new.passenger_member_id and covoiturage_suspendu) then
    raise exception 'Votre accès au module Covoiturage a été suspendu par le bureau de votre association.';
  end if;
  return new;
end;
$fn$;
comment on function public.empecher_covoiturage_si_suspendu_reservation() is
  'Déclencheur : bloque toute nouvelle réservation d''un membre suspendu du covoiturage (voir suspendre_covoiturage) — carpool_bookings (colonne passenger_member_id).';

-- ---------------------------------------------------------------------
-- 3) Repointer les trois triggers vers la bonne fonction par table
-- ---------------------------------------------------------------------
drop trigger if exists trg_covoiturage_suspendu_offers on public.carpool_offers;
create trigger trg_covoiturage_suspendu_offers
  before insert on public.carpool_offers
  for each row execute function public.empecher_covoiturage_si_suspendu_trajet();

drop trigger if exists trg_covoiturage_suspendu_requests on public.carpool_requests;
create trigger trg_covoiturage_suspendu_requests
  before insert on public.carpool_requests
  for each row execute function public.empecher_covoiturage_si_suspendu_trajet();

drop trigger if exists trg_covoiturage_suspendu_bookings on public.carpool_bookings;
create trigger trg_covoiturage_suspendu_bookings
  before insert on public.carpool_bookings
  for each row execute function public.empecher_covoiturage_si_suspendu_reservation();

-- ---------------------------------------------------------------------
-- 4) Supprimer l'ancienne fonction cassée — plus aucun trigger n'y pointe
-- ---------------------------------------------------------------------
drop function if exists public.empecher_covoiturage_si_suspendu();

-- =====================================================================
-- Vérification rapide après exécution :
--   select tgname, p.proname from pg_trigger t
--   join pg_proc p on p.oid = t.tgfunction
--   where tgname like 'trg_covoiturage_suspendu_%';
--   -- doit afficher 3 lignes :
--   --   trg_covoiturage_suspendu_offers    | empecher_covoiturage_si_suspendu_trajet
--   --   trg_covoiturage_suspendu_requests  | empecher_covoiturage_si_suspendu_trajet
--   --   trg_covoiturage_suspendu_bookings  | empecher_covoiturage_si_suspendu_reservation
--   select proname from pg_proc where proname = 'empecher_covoiturage_si_suspendu';
--   -- doit n'afficher AUCUNE ligne (fonction supprimée)
--
-- Test ensuite dans l'app : publier une nouvelle offre ou demande de
-- trajet dans Covoiturage doit fonctionner sans erreur.
-- =====================================================================
