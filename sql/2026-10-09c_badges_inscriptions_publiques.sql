-- =====================================================================
-- Événements — badge avec code QR pour les inscriptions publiques
-- (visiteurs non adhérents) — 2026-10-09
-- =====================================================================
-- Suite de sql/2026-09-30d_evenements_inscriptions_publiques_checkin.sql
-- (pointage manuel) et de sql/2026-10-08o_formulaires_publics_rls_anon.sql
-- (anti-abus des formulaires publics, INCHANGÉ ici).
--
-- Principe :
--   1) Chaque inscription publique reçoit un jeton de badge (badge_token)
--      aléatoire, TOUJOURS généré par le serveur (déclencheur) : le
--      visiteur ne peut pas le choisir.
--   2) Le visiteur anonyme n'a toujours AUCUN droit de lecture sur la
--      table. Juste après l'envoi, la page publique récupère son jeton
--      par recuperer_badge_apres_inscription(id) : l'id de l'inscription
--      est tiré au hasard par le navigateur du visiteur (122 bits
--      aléatoires, connu de lui seul) et l'appel n'est accepté que dans
--      l'heure qui suit l'inscription.
--   3) Plus tard, le lien du badge (…&badge=<jeton>) affiche le badge via
--      badge_inscription_publique(jeton) : nom, nombre de personnes,
--      événement, date, lieu, logo. Jamais le courriel ni le téléphone.
--   4) À l'entrée, le Bureau scanne le QR : pointer_badge_public(jeton)
--      (réservé au Bureau de l'association), qui refuse un 2e passage en
--      renvoyant l'heure du premier.
--   5) La table est ajoutée à la publication temps réel pour le compteur
--      « arrivés / inscrits » en direct côté Bureau (la RLS existante
--      limite toujours ces messages au Bureau).
--
-- Ré-exécutable sans risque.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Colonne badge_token
-- ---------------------------------------------------------------------
alter table public.event_public_registrations
  add column if not exists badge_token uuid;

-- Inscriptions déjà existantes : on leur donne aussi un badge.
update public.event_public_registrations
   set badge_token = gen_random_uuid()
 where badge_token is null;

alter table public.event_public_registrations
  alter column badge_token set default gen_random_uuid(),
  alter column badge_token set not null;

create unique index if not exists event_public_registrations_badge_token_idx
  on public.event_public_registrations (badge_token);

comment on column public.event_public_registrations.badge_token is
  'Jeton opaque du badge QR d''un visiteur non adhérent — toujours généré par le serveur (déclencheur), sert à afficher le badge (badge_inscription_publique) et à le pointer à l''entrée (pointer_badge_public).';

-- ---------------------------------------------------------------------
-- 2) Déclencheur : le jeton est imposé par le serveur à l'insertion
--    (même si un visiteur malveillant en envoyait un) et ne change
--    jamais ensuite.
-- ---------------------------------------------------------------------
create or replace function public.event_public_registrations_badge_token()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    new.badge_token := gen_random_uuid();
  else
    new.badge_token := old.badge_token;
  end if;
  return new;
end;
$fn$;

drop trigger if exists event_public_registrations_badge_token_trg on public.event_public_registrations;
create trigger event_public_registrations_badge_token_trg
  before insert or update on public.event_public_registrations
  for each row execute function public.event_public_registrations_badge_token();

-- ---------------------------------------------------------------------
-- 3) Récupération du jeton juste après l'inscription (visiteur anonyme)
-- ---------------------------------------------------------------------
create or replace function public.recuperer_badge_apres_inscription(p_inscription_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.badge_token
    from public.event_public_registrations r
   where r.id = p_inscription_id
     and r.created_at > now() - interval '1 hour'
$fn$;

comment on function public.recuperer_badge_apres_inscription(uuid) is
  'Renvoie le jeton de badge d''une inscription publique créée il y a moins d''une heure, à partir de son id (tiré au hasard par le navigateur du visiteur, connu de lui seul). Security definer : le visiteur anonyme n''a aucun droit de lecture sur la table.';

grant execute on function public.recuperer_badge_apres_inscription(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) Affichage du badge à partir de son jeton (lien « retrouver mon
--    badge ») — uniquement des informations sûres.
-- ---------------------------------------------------------------------
create or replace function public.badge_inscription_publique(p_token uuid)
returns table(
  inscription_id uuid,
  nom text,
  nb_personnes integer,
  statut text,
  checkin_le timestamptz,
  event_id uuid,
  event_titre text,
  event_date_debut timestamptz,
  event_lieu text,
  event_annule boolean,
  association_nom text,
  association_logo_url text,
  association_slug text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.id, r.nom, r.nb_personnes, r.statut, r.checkin_le,
         e.id, e.titre, e.date_debut, e.lieu, coalesce(e.annule, false),
         a.nom, a.logo_url, a.slug_public
    from public.event_public_registrations r
    join public.events e on e.id = r.event_id
    join public.associations a on a.id = r.association_id
   where r.badge_token = p_token
$fn$;

comment on function public.badge_inscription_publique(uuid) is
  'Badge d''un visiteur non adhérent, retrouvé par son jeton (lien personnel). Ne renvoie ni courriel ni téléphone. Security definer : aucune lecture directe de la table pour un anonyme.';

grant execute on function public.badge_inscription_publique(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) Pointage à l'entrée par scan du badge (Bureau uniquement)
--    Codes : non_autorise, introuvable, autre_evenement, annulee,
--            deja_valide (checkin_le = heure du 1er passage), enregistre.
-- ---------------------------------------------------------------------
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
  v_titre text;
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

  select e.titre into v_titre from public.events e where e.id = v_reg.event_id;

  if p_event_id is not null and v_reg.event_id <> p_event_id then
    return query select 'autre_evenement'::text, v_reg.id, v_reg.nom, v_reg.nb_personnes, v_reg.event_id, v_titre, v_reg.checkin_le;
    return;
  end if;
  if v_reg.statut = 'annulee' then
    return query select 'annulee'::text, v_reg.id, v_reg.nom, v_reg.nb_personnes, v_reg.event_id, v_titre, v_reg.checkin_le;
    return;
  end if;
  if v_reg.checkin_le is not null then
    return query select 'deja_valide'::text, v_reg.id, v_reg.nom, v_reg.nb_personnes, v_reg.event_id, v_titre, v_reg.checkin_le;
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
    return query select 'deja_valide'::text, v_reg.id, v_reg.nom, v_reg.nb_personnes, v_reg.event_id, v_titre, v_le;
    return;
  end if;

  return query select 'enregistre'::text, v_reg.id, v_reg.nom, v_reg.nb_personnes, v_reg.event_id, v_titre, v_le;
end;
$fn$;

comment on function public.pointer_badge_public(uuid, uuid) is
  'Pointe à l''entrée un visiteur non adhérent à partir du jeton de son badge QR. Réservé au Bureau de l''association. Refuse un second passage (deja_valide, avec l''heure du premier). Si p_event_id est fourni, refuse un badge d''un autre événement (autre_evenement).';

revoke execute on function public.pointer_badge_public(uuid, uuid) from public, anon;
grant execute on function public.pointer_badge_public(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Temps réel : compteur « arrivés / inscrits » en direct côté Bureau
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_public_registrations'
  ) then
    alter publication supabase_realtime add table public.event_public_registrations;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select count(*) filter (where badge_token is null) as sans_badge
--     from public.event_public_registrations;            -- doit valoir 0
--   select proname from pg_proc where proname in
--     ('recuperer_badge_apres_inscription','badge_inscription_publique','pointer_badge_public');
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename = 'event_public_registrations';
-- =====================================================================
