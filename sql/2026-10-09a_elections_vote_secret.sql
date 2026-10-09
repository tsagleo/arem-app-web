-- =====================================================================
-- Élections — VOTE SECRET (2026-10-09)
-- =====================================================================
-- Problèmes corrigés (découverts le 2026-10-08) :
--   1. election_votes stockait voter_member_id + candidat_id, et la
--      politique « election_votes select » (2026-09-04e) laissait TOUS
--      les membres de l'association lire qui avait voté pour qui.
--   2. Le déclencheur du journal d'activité copiait chaque vote (votant
--      + choix) dans activity_log, lisible par le bureau.
--   3. Les résultats étaient visibles pendant le scrutin (influence sur
--      les votants restants), et un membre ne pouvait voter qu'une fois
--      par élection même quand elle comportait plusieurs postes.
--
-- Nouveau modèle, celui du vote papier :
--   • election_emargements : QUI a voté, pour quel poste (liste
--     d'émargement, lisible par l'association — participation publique).
--   • election_bulletins   : l'URNE — poste + candidat, SANS votant ni
--     horodatage. RLS activée sans AUCUNE politique : personne ne la lit
--     directement, bureau compris.
--   • voter_election()     : seul moyen de voter ; vérifie l'éligibilité
--     et écrit émargement + bulletin dans la même transaction.
--   • etat_elections()     : participation en tout temps ; décompte des
--     voix SEULEMENT une fois l'élection close.
--
-- Migration : les votes existants sont recopiés dans le nouveau modèle,
-- puis election_votes est vidée et fermée, et les entrées du journal
-- qui révélaient les choix sont caviardées (le fait qu'un vote a eu lieu
-- reste tracé, pas son contenu).
-- Ré-exécutable sans risque.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------
create table if not exists public.election_emargements (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  poste text not null default '',
  member_id uuid not null references public.members(id) on delete cascade,
  a_vote_le timestamptz not null default now(),
  unique (election_id, poste, member_id)
);

comment on table public.election_emargements is
  'Liste d''émargement : qui a voté, pour quel poste. Ne contient JAMAIS le choix du votant (voir election_bulletins).';

create table if not exists public.election_bulletins (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  poste text not null default '',
  candidat_id uuid not null references public.election_candidats(id) on delete cascade
);

comment on table public.election_bulletins is
  'Urne : un bulletin = un poste + un candidat, sans votant ni horodatage, pour qu''aucun recoupement avec l''émargement ne soit possible. RLS sans politique : lecture uniquement via etat_elections(), après la clôture.';

create index if not exists election_emargements_election_idx on public.election_emargements (election_id);
create index if not exists election_bulletins_election_idx on public.election_bulletins (election_id);

alter table public.election_emargements enable row level security;
alter table public.election_bulletins enable row level security;

drop policy if exists "election_emargements select" on public.election_emargements;
create policy "election_emargements select" on public.election_emargements for select to authenticated
  using (exists (select 1 from public.elections e where e.id = election_id and e.association_id = public.current_association_id()));

-- ---------------------------------------------------------------------
-- 2) Voter
-- ---------------------------------------------------------------------
create or replace function public.voter_election(p_election_id uuid, p_candidat_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_member uuid := public.current_member_id();
  v_el public.elections;
  v_poste text;
begin
  if v_member is null then raise exception 'Votre compte n''est pas relié à une fiche de membre.'; end if;

  select * into v_el from public.elections where id = p_election_id;
  if v_el.id is null or v_el.association_id <> public.current_association_id() then raise exception 'Élection introuvable.'; end if;
  if v_el.statut <> 'ouverte' or (v_el.date_debut is not null and now() < v_el.date_debut)
     or (v_el.date_fin is not null and now() > v_el.date_fin) then
    raise exception 'Le scrutin n''est pas ouvert.';
  end if;

  if not exists (select 1 from public.members m where m.id = v_member and m.association_id = v_el.association_id and m.statut = 'Actif') then
    raise exception 'Seuls les membres actifs peuvent voter.';
  end if;

  select coalesce(c.poste_vise, '') into v_poste
    from public.election_candidats c where c.id = p_candidat_id and c.election_id = p_election_id;
  if not found then raise exception 'Candidat introuvable pour cette élection.'; end if;

  begin
    insert into public.election_emargements (election_id, poste, member_id) values (p_election_id, v_poste, v_member);
  exception when unique_violation then
    raise exception 'Vous avez déjà voté pour ce poste.';
  end;
  insert into public.election_bulletins (election_id, poste, candidat_id) values (p_election_id, v_poste, p_candidat_id);
end;
$fn$;

grant execute on function public.voter_election(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3) État des élections : participation toujours, voix après clôture
-- ---------------------------------------------------------------------
-- Une élection est « close » si son statut n'est plus 'ouverte' ou si sa
-- date de fin est passée (même règle que effectiveStatut côté interface).
create or replace function public.etat_elections() returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
    'election_id', e.id,
    'close', (e.statut <> 'ouverte' or (e.date_fin is not null and now() > e.date_fin)),
    'inscrits', (select count(*) from public.members m where m.association_id = e.association_id and m.statut = 'Actif'),
    'votants', (select count(distinct em.member_id) from public.election_emargements em where em.election_id = e.id),
    'votants_par_poste', (
      select coalesce(jsonb_object_agg(x.poste, x.n), '{}'::jsonb)
        from (select em.poste, count(*) as n from public.election_emargements em where em.election_id = e.id group by em.poste) x
    ),
    'voix', case when (e.statut <> 'ouverte' or (e.date_fin is not null and now() > e.date_fin)) then (
      select coalesce(jsonb_object_agg(x.candidat_id, x.n), '{}'::jsonb)
        from (select b.candidat_id, count(*) as n from public.election_bulletins b where b.election_id = e.id group by b.candidat_id) x
    ) else null end
  )), '[]'::jsonb)
  from public.elections e
  where e.association_id = public.current_association_id();
$fn$;

grant execute on function public.etat_elections() to authenticated;

-- ---------------------------------------------------------------------
-- 4) Migration des votes existants, puis fermeture de election_votes
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.election_votes') is not null then
    insert into public.election_emargements (election_id, poste, member_id)
      select distinct v.election_id, coalesce(c.poste_vise, ''), v.voter_member_id
        from public.election_votes v
        join public.election_candidats c on c.id = v.candidat_id
       where v.voter_member_id is not null
    on conflict (election_id, poste, member_id) do nothing;

    insert into public.election_bulletins (election_id, poste, candidat_id)
      select v.election_id, coalesce(c.poste_vise, ''), v.candidat_id
        from public.election_votes v
        join public.election_candidats c on c.id = v.candidat_id;

    delete from public.election_votes;

    -- Plus aucune lecture ni écriture directe possible.
    drop policy if exists "election_votes select" on public.election_votes;
    drop policy if exists "election_votes insert" on public.election_votes;
    drop policy if exists "election_votes delete" on public.election_votes;
    drop policy if exists "accès complet - election_votes" on public.election_votes;
    alter table public.election_votes enable row level security;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5) Journal d'activité : retirer le contenu des votes déjà journalisés
-- ---------------------------------------------------------------------
-- Le déclencheur générique log_activity() avait copié chaque ligne de
-- election_votes (votant + candidat). On garde la trace qu'un vote a eu
-- lieu, sans son contenu.
update public.activity_log
   set details = jsonb_build_object('note', 'Vote secret — contenu retiré du journal (2026-10-09).')
 where table_name = 'election_votes';

-- Supprimer tout déclencheur encore attaché à election_votes (dont celui
-- du journal), pour qu'aucune trace future ne puisse réapparaître.
do $$
declare r record;
begin
  for r in select tgname from pg_trigger where tgrelid = 'public.election_votes'::regclass and not tgisinternal loop
    execute format('drop trigger if exists %I on public.election_votes', r.tgname);
  end loop;
exception when undefined_table then null;
end $$;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select count(*) from public.election_votes;           -- doit être 0
--   select public.etat_elections();                       -- participation / voix
-- ---------------------------------------------------------------------
