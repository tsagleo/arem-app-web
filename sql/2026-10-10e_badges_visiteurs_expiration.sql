-- =====================================================================
-- Badges des visiteurs (inscriptions publiques) — valables UNIQUEMENT
-- pour leur événement, et plus après (2026-10-10)
-- (à exécuter APRÈS 2026-10-09c_badges_inscriptions_publiques.sql)
-- =====================================================================
-- Demande de l'utilisateur : le badge d'un participant externe est créé
-- pour la circonstance ; une fois l'événement passé, il ne doit plus
-- être valable.
-- Avant ce script, pointer_badge_public() refusait déjà le badge d'un
-- AUTRE événement, mais acceptait encore un badge après l'événement ou
-- pour un événement annulé.
--   • Fin de l'événement = la plus tardive de : début de l'événement,
--     début/fin de sa dernière séance au programme — plus 12 heures de
--     marge (événement qui finit tard le soir, pointage tardif).
--   • Après cette fin : « badge expiré » ; événement annulé : refusé.
--   • La page du badge du visiteur indique qu'il n'est plus valable.
-- Ré-exécutable sans risque.
-- =====================================================================

create or replace function public.evenement_fin(p_event_id uuid) returns timestamptz
language sql stable security definer set search_path = '' as $fn$
  select greatest(
           e.date_debut,
           (select max(coalesce(s.date_fin, s.date_debut)) from public.event_sessions s where s.event_id = e.id)
         ) + interval '12 hours'
    from public.events e where e.id = p_event_id
$fn$;
revoke all on function public.evenement_fin(uuid) from public, anon;
grant execute on function public.evenement_fin(uuid) to authenticated;

create or replace function public.pointer_badge_public(p_token uuid, p_event_id uuid default null)
returns table(
  status text,
  inscription_id uuid,
  nom text,
  nb_personnes integer,
  event_id uuid,
  event_titre text,
  checkin_le timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_reg record;
  v_ev record;
  v_le timestamptz;
begin
  if not public.is_bureau() then
    return query select 'non_autorise'::text, null::uuid, null::text, null::integer, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  select * into v_reg from public.event_public_registrations r where r.badge_token = p_token;
  if not found or v_reg.association_id <> public.current_association_id() then
    return query select 'introuvable'::text, null::uuid, null::text, null::integer, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  select e.titre, coalesce(e.annule, false) as annule into v_ev from public.events e where e.id = v_reg.event_id;

  -- Badge créé pour UN événement : refusé ailleurs, après, ou si annulé.
  if p_event_id is not null and v_reg.event_id <> p_event_id then
    return query select 'autre_evenement'::text, v_reg.id, v_reg.nom, v_reg.nb_personnes, v_reg.event_id, v_ev.titre, v_reg.checkin_le;
    return;
  end if;
  if v_ev.annule then
    return query select 'evenement_annule'::text, v_reg.id, v_reg.nom, v_reg.nb_personnes, v_reg.event_id, v_ev.titre, v_reg.checkin_le;
    return;
  end if;
  if now() > public.evenement_fin(v_reg.event_id) then
    return query select 'expire'::text, v_reg.id, v_reg.nom, v_reg.nb_personnes, v_reg.event_id, v_ev.titre, v_reg.checkin_le;
    return;
  end if;
  if v_reg.statut = 'annulee' then
    return query select 'annulee'::text, v_reg.id, v_reg.nom, v_reg.nb_personnes, v_reg.event_id, v_ev.titre, v_reg.checkin_le;
    return;
  end if;
  if v_reg.checkin_le is not null then
    return query select 'deja_valide'::text, v_reg.id, v_reg.nom, v_reg.nb_personnes, v_reg.event_id, v_ev.titre, v_reg.checkin_le;
    return;
  end if;

  -- « checkin_le is null » dans la condition : deux scanners simultanés
  -- ne peuvent pas pointer deux fois la même personne.
  update public.event_public_registrations r
     set checkin_le = now(), checkin_par = auth.uid()
   where r.id = v_reg.id and r.checkin_le is null
  returning r.checkin_le into v_le;

  if not found then
    select r.checkin_le into v_le from public.event_public_registrations r where r.id = v_reg.id;
    return query select 'deja_valide'::text, v_reg.id, v_reg.nom, v_reg.nb_personnes, v_reg.event_id, v_ev.titre, v_le;
    return;
  end if;

  return query select 'enregistre'::text, v_reg.id, v_reg.nom, v_reg.nb_personnes, v_reg.event_id, v_ev.titre, v_le;
end;
$fn$;
grant execute on function public.pointer_badge_public(uuid, uuid) to authenticated;

-- Page du badge (visiteur anonyme) : le badge est-il encore valable ?
create or replace function public.badge_public_expire(p_token uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select now() > public.evenement_fin(r.event_id)
    from public.event_public_registrations r where r.badge_token = p_token
$fn$;
grant execute on function public.badge_public_expire(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select proname from pg_proc where proname in ('evenement_fin','badge_public_expire');   -- 2 lignes
-- ---------------------------------------------------------------------
