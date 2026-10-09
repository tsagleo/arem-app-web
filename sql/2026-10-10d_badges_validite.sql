-- =====================================================================
-- Badges / cartes de membre — validité réglée par l'association (2026-10-10)
-- (à exécuter APRÈS 2026-10-10c_evenements_securite_rappels.sql)
-- =====================================================================
-- Demande de l'utilisateur : « la durée et la date de validité du badge
-- doivent être saisies par l'association dans les paramètres ».
-- Configuration → Adhésion → « Validité des badges » :
--   • 'annee' : valable pour l'année civile en cours (comportement d'avant) ;
--   • 'date'  : valable jusqu'à une date fixe (ex. fin de l'exercice) ;
--   • 'duree' : valable N mois à partir de la remise du badge
--               (member_card_tokens.emis_le ; un nouveau badge repart à zéro).
-- Une carte périmée n'ouvre plus rien : entrée des événements (« carte
-- expirée »), pointage des présences, remise des achats, vérification
-- publique — toutes passent par membre_par_jeton().
-- Ré-exécutable sans risque.
-- =====================================================================

alter table public.associations add column if not exists badge_validite_mode text not null default 'annee';
alter table public.associations add column if not exists badge_valide_jusqu_au date;
alter table public.associations add column if not exists badge_duree_mois integer;
alter table public.associations drop constraint if exists associations_badge_validite_check;
alter table public.associations add constraint associations_badge_validite_check check (
  badge_validite_mode in ('annee', 'date', 'duree')
  and (badge_duree_mois is null or badge_duree_mois between 1 and 120)
);

-- Fin de validité de la carte d'un membre (null = pas d'échéance : mode
-- 'annee', ou réglage incomplet).
create or replace function public.carte_fin_validite(p_member_id uuid) returns date
language sql stable security definer set search_path = '' as $fn$
  select case a.badge_validite_mode
           when 'date' then a.badge_valide_jusqu_au
           when 'duree' then case when a.badge_duree_mois is null then null
                                  else (c.emis_le + make_interval(months => a.badge_duree_mois))::date end
           else null
         end
    from public.member_card_tokens c
    join public.associations a on a.id = c.association_id
   where c.member_id = p_member_id
$fn$;
grant execute on function public.carte_fin_validite(uuid) to authenticated;

-- Une carte périmée n'est plus reconnue nulle part.
create or replace function public.membre_par_jeton(p_token uuid) returns uuid
language sql stable security definer set search_path = '' as $fn$
  select c.member_id from public.member_card_tokens c
   where c.token = p_token
     and coalesce(public.carte_fin_validite(c.member_id), current_date) >= current_date
$fn$;
revoke all on function public.membre_par_jeton(uuid) from public, anon, authenticated;

-- Entrée des événements : message précis « carte expirée ».
create or replace function public.pointer_carte_membre_evenement(p_token uuid, p_event_id uuid)
returns table(status text, member_id uuid, member_nom text, photo_url text, event_titre text, checkin_le timestamptz)
language plpgsql security definer set search_path = '' as $fn$
declare
  v_m record;
  v_event record;
  v_rsvp record;
  v_res record;
  v_carte record;
begin
  if not public.is_bureau() then
    return query select 'non_autorise'::text, null::uuid, null::text, null::text, null::text, null::timestamptz; return;
  end if;
  select c.* into v_carte from public.member_card_tokens c where c.token = p_token and c.association_id = public.current_association_id();
  if v_carte.member_id is null then
    return query select 'introuvable'::text, null::uuid, null::text, null::text, null::text, null::timestamptz; return;
  end if;
  select * into v_m from public.members m where m.id = v_carte.member_id;
  select * into v_event from public.events e where e.id = p_event_id and e.association_id = public.current_association_id();
  if coalesce(public.carte_fin_validite(v_m.id), current_date) < current_date then
    return query select 'carte_expiree'::text, v_m.id, v_m.nom, v_m.photo_url, v_event.titre, null::timestamptz; return;
  end if;
  if v_m.statut is distinct from 'Actif' then
    return query select 'inactif'::text, v_m.id, v_m.nom, v_m.photo_url, v_event.titre, null::timestamptz; return;
  end if;
  select * into v_rsvp from public.event_rsvps r where r.event_id = p_event_id and r.member_id = v_m.id;
  if v_rsvp.id is null or v_rsvp.statut <> 'confirme' then
    return query select 'non_inscrit'::text, v_m.id, v_m.nom, v_m.photo_url, v_event.titre, null::timestamptz; return;
  end if;
  if v_rsvp.checkin_le is not null then
    return query select 'deja_valide'::text, v_m.id, v_m.nom, v_m.photo_url, v_event.titre, v_rsvp.checkin_le; return;
  end if;
  select * into v_res from public.checkin_event_ticket(v_rsvp.billet_token);
  return query select v_res.status, v_m.id, v_m.nom, v_m.photo_url, v_event.titre, now();
end;
$fn$;
grant execute on function public.pointer_carte_membre_evenement(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select badge_validite_mode, badge_valide_jusqu_au, badge_duree_mois from public.associations;
-- ---------------------------------------------------------------------
