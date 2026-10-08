-- =====================================================================
-- Tirages au sort vérifiables, en direct (2026-10-08)
-- =====================================================================
-- Demande de l'utilisateur : une rubrique « Tirages au sort », d'abord
-- pour l'ORDRE DE PASSAGE DE LA TONTINE (pratique courante dans les
-- associations visées), avec un tirage vécu EN DIRECT par tous les
-- adhérents connectés. Pas de tombola payante (loterie réglementée).
--
-- Principe de confiance (« engagement / révélation ») :
--   1. preparer_tirage : le serveur génère une graine secrète (32 octets
--      aléatoires) et publie tout de suite son empreinte SHA-256
--      (« engagement »). La graine reste dans tirages_secrets, illisible
--      par quiconque, bureau compris.
--   2. lancer_tirage : l'ordre complet est calculé UNE FOIS à partir de la
--      graine — chaque participant est classé par SHA-256(graine:member_id).
--      Personne ne peut relancer jusqu'à obtenir un résultat voulu.
--   3. reveler_suivant : le bureau dévoile les numéros un par un ; chaque
--      clic met à jour `revele`, diffusé en temps réel (Supabase Realtime)
--      à tous les écrans ouverts.
--   4. À la fin, la graine est publiée : n'importe quel membre peut
--      vérifier que SHA-256(graine) = engagement et recalculer l'ordre.
--
-- Toute écriture passe par les fonctions ci-dessous (security definer,
-- gardées par is_bureau()) : aucune politique INSERT/UPDATE/DELETE sur
-- les tables. Un tirage n'est jamais supprimé — seulement annulé, avec
-- motif, et reste visible.
-- Ré-exécutable sans risque.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------
create table if not exists public.tirages (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  titre text not null,
  type text not null default 'tontine' check (type in ('tontine', 'libre')),
  nb_gagnants int not null default 1 check (nb_gagnants >= 1),
  statut text not null default 'prepare' check (statut in ('prepare', 'en_cours', 'termine', 'annule')),
  participants jsonb not null,             -- [{member_id, nom}] figés à la préparation
  engagement text not null,                -- SHA-256 hex de la graine, publié avant le tirage
  graine text,                             -- publiée seulement quand le tirage est terminé
  resultat jsonb,                          -- [{position, member_id, nom}] fixé au lancement
  revele int not null default 0,           -- nombre de positions dévoilées en direct
  cree_par uuid references public.profiles(id),
  cree_par_nom text,
  lance_le timestamptz,
  termine_le timestamptz,
  motif_annulation text,
  annule_le timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.tirages is
  'Tirages au sort vérifiables (ordre de tontine ou tirage libre), révélés en direct. Écriture uniquement via les fonctions preparer_tirage / lancer_tirage / reveler_suivant / reveler_tout / annuler_tirage.';

create index if not exists tirages_association_idx on public.tirages (association_id, created_at desc);

create table if not exists public.tirages_secrets (
  tirage_id uuid primary key references public.tirages(id) on delete cascade,
  graine text not null
);

comment on table public.tirages_secrets is
  'Graine secrète d''un tirage, jusqu''à sa révélation. RLS activée SANS aucune politique : illisible depuis l''app, seules les fonctions security definer y accèdent.';

alter table public.tirages enable row level security;
alter table public.tirages_secrets enable row level security;

drop policy if exists "tirages select" on public.tirages;
create policy "tirages select" on public.tirages for select to authenticated
  using (association_id = public.current_association_id());

-- ---------------------------------------------------------------------
-- 2) Fonctions
-- ---------------------------------------------------------------------
create or replace function public.preparer_tirage(
  p_titre text, p_type text, p_member_ids uuid[], p_nb_gagnants int default 1
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_participants jsonb;
  v_nb int;
  v_graine text;
  v_id uuid;
  v_nom text;
begin
  if v_assoc is null or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if coalesce(trim(p_titre), '') = '' then raise exception 'Titre requis.'; end if;
  if p_type not in ('tontine', 'libre') then raise exception 'Type de tirage invalide.'; end if;

  select jsonb_agg(jsonb_build_object('member_id', m.id, 'nom', m.nom) order by m.nom), count(*)
    into v_participants, v_nb
    from public.members m
   where m.id = any(p_member_ids) and m.association_id = v_assoc;

  if coalesce(v_nb, 0) < 2 then raise exception 'Il faut au moins deux participants.'; end if;
  if v_nb <> coalesce(array_length(p_member_ids, 1), 0) then raise exception 'Participant inconnu dans cette association.'; end if;

  v_graine := encode(extensions.gen_random_bytes(32), 'hex');
  select nom_complet into v_nom from public.profiles where id = auth.uid();

  insert into public.tirages (association_id, titre, type, nb_gagnants, participants, engagement, cree_par, cree_par_nom)
  values (
    v_assoc, trim(p_titre), p_type,
    case when p_type = 'tontine' then v_nb else least(greatest(coalesce(p_nb_gagnants, 1), 1), v_nb) end,
    v_participants, encode(extensions.digest(v_graine, 'sha256'), 'hex'), auth.uid(), v_nom
  ) returning id into v_id;

  insert into public.tirages_secrets (tirage_id, graine) values (v_id, v_graine);
  return v_id;
end;
$fn$;

create or replace function public.lancer_tirage(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_t public.tirages;
  v_graine text;
  v_resultat jsonb;
begin
  select * into v_t from public.tirages where id = p_id for update;
  if v_t.id is null or v_t.association_id <> public.current_association_id() or not public.is_bureau() then
    raise exception 'Non autorisé.';
  end if;
  if v_t.statut <> 'prepare' then raise exception 'Ce tirage a déjà été lancé ou annulé.'; end if;

  select graine into v_graine from public.tirages_secrets where tirage_id = p_id;

  -- Ordre = tri des participants par SHA-256(graine:member_id), en
  -- comparaison octet par octet (collation "C") — même règle que la
  -- vérification faite dans le navigateur (Tirages.jsx).
  select jsonb_agg(jsonb_build_object('position', x.rn, 'member_id', x.mid, 'nom', x.nom) order by x.rn)
    into v_resultat
    from (
      select p->>'member_id' as mid, p->>'nom' as nom,
             row_number() over (
               order by encode(extensions.digest(v_graine || ':' || (p->>'member_id'), 'sha256'), 'hex') collate "C"
             ) as rn
        from jsonb_array_elements(v_t.participants) p
    ) x;

  update public.tirages
     set statut = 'en_cours', resultat = v_resultat, revele = 0, lance_le = now()
   where id = p_id;
end;
$fn$;

-- Nombre de numéros à dévoiler en direct : tout l'ordre pour la tontine,
-- seulement les gagnants pour un tirage libre.
create or replace function public.tirage_nb_a_reveler(t public.tirages) returns int
language sql immutable set search_path = '' as $fn$
  select case when t.type = 'libre' then least(t.nb_gagnants, jsonb_array_length(t.resultat))
              else jsonb_array_length(t.resultat) end
$fn$;

-- Fin commune : publie la graine et clôt le tirage.
create or replace function public.tirage_terminer_si_complet(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_total int;
  v_revele int;
begin
  select public.tirage_nb_a_reveler(t), t.revele into v_total, v_revele from public.tirages t where t.id = p_id;
  if v_revele >= v_total then
    update public.tirages t
       set statut = 'termine', termine_le = now(),
           graine = (select s.graine from public.tirages_secrets s where s.tirage_id = p_id)
     where t.id = p_id;
  end if;
end;
$fn$;

revoke all on function public.tirage_terminer_si_complet(uuid) from public, anon, authenticated;

create or replace function public.reveler_suivant(p_id uuid) returns int
language plpgsql security definer set search_path = '' as $fn$
declare
  v_t public.tirages;
begin
  select * into v_t from public.tirages where id = p_id for update;
  if v_t.id is null or v_t.association_id <> public.current_association_id() or not public.is_bureau() then
    raise exception 'Non autorisé.';
  end if;
  if v_t.statut <> 'en_cours' then raise exception 'Ce tirage n''est pas en cours.'; end if;

  update public.tirages t set revele = least(t.revele + 1, public.tirage_nb_a_reveler(t)) where t.id = p_id;
  perform public.tirage_terminer_si_complet(p_id);
  return (select revele from public.tirages where id = p_id);
end;
$fn$;

create or replace function public.reveler_tout(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_t public.tirages;
begin
  select * into v_t from public.tirages where id = p_id for update;
  if v_t.id is null or v_t.association_id <> public.current_association_id() or not public.is_bureau() then
    raise exception 'Non autorisé.';
  end if;
  if v_t.statut <> 'en_cours' then raise exception 'Ce tirage n''est pas en cours.'; end if;

  update public.tirages t set revele = public.tirage_nb_a_reveler(t) where t.id = p_id;
  perform public.tirage_terminer_si_complet(p_id);
end;
$fn$;

create or replace function public.annuler_tirage(p_id uuid, p_motif text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_t public.tirages;
begin
  select * into v_t from public.tirages where id = p_id for update;
  if v_t.id is null or v_t.association_id <> public.current_association_id() or not public.is_bureau() then
    raise exception 'Non autorisé.';
  end if;
  if v_t.statut = 'annule' then raise exception 'Ce tirage est déjà annulé.'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Motif d''annulation requis.'; end if;

  -- La graine est publiée même en cas d'annulation : un tirage annulé
  -- après son lancement reste ainsi vérifiable par tous.
  update public.tirages t
     set statut = 'annule', motif_annulation = trim(p_motif), annule_le = now(),
         graine = case when t.statut = 'prepare' then null
                       else (select s.graine from public.tirages_secrets s where s.tirage_id = p_id) end
   where t.id = p_id;
end;
$fn$;

grant execute on function public.preparer_tirage(text, text, uuid[], int) to authenticated;
grant execute on function public.lancer_tirage(uuid) to authenticated;
grant execute on function public.reveler_suivant(uuid) to authenticated;
grant execute on function public.reveler_tout(uuid) to authenticated;
grant execute on function public.annuler_tirage(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Journal d'activité : création et changements de statut seulement
--    (pas chaque numéro dévoilé, pour ne pas inonder le journal).
-- ---------------------------------------------------------------------
drop trigger if exists trg_log_tirages on public.tirages;
create trigger trg_log_tirages after insert or update of statut on public.tirages
for each row execute function public.log_activity();

-- ---------------------------------------------------------------------
-- 4) Temps réel : diffuser chaque changement aux écrans ouverts
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tirages'
  ) then
    alter publication supabase_realtime add table public.tirages;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) : 5 fonctions, et 'tirages' dans la
-- publication temps réel.
-- ---------------------------------------------------------------------
-- select proname from pg_proc where proname in ('preparer_tirage','lancer_tirage','reveler_suivant','reveler_tout','annuler_tirage');
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tirages';
