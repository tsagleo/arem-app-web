-- =====================================================================
-- Gouvernance — documents officiels, assemblées générales, organigramme,
-- rappel de fin de mandat (2026-10-10)
-- =====================================================================
-- Demandes de l'utilisateur (suggestions retenues) :
--   1. DOCUMENTS DE GOUVERNANCE : statuts, règlement intérieur, PV
--      d'assemblée générale, chartes… avec version et date d'adoption ;
--      la version en vigueur est la plus récente de chaque type, les
--      précédentes restent consultables (historique).
--   2. ASSEMBLÉES GÉNÉRALES : préparation, convocation (notification à
--      tous les membres), feuille de présence (présent / représenté /
--      excusé), quorum, résolutions votées en séance, PV signé archivé
--      dans les documents de gouvernance.
--   3. ORGANIGRAMME sur la vitrine publique : bureau (déjà public) + au
--      choix de l'association, les responsables de rubriques.
--   4. HISTORIQUE DES BUREAUX : rien à ajouter en base (board_members garde
--      déjà les mandats passés) — affiché par mandat dans l'application.
--   5. RAPPEL AU PRÉSIDENT 60 et 30 jours avant la fin d'un mandat.
-- Ré-exécutable sans risque.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Documents de gouvernance (fichiers dans le bucket « documents »,
--    dossier <association>/gouvernance/ — politiques de stockage existantes)
-- ---------------------------------------------------------------------
create table if not exists public.gouvernance_documents (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  type text not null check (type in ('statuts', 'reglement', 'pv_ag', 'charte', 'autre')),
  titre text not null,
  version text,
  date_adoption date,
  storage_path text not null,
  nom_fichier text,
  assemblee_id uuid,
  ajoute_par uuid references public.profiles(id) on delete set null,
  ajoute_par_nom text,
  created_at timestamptz not null default now()
);
comment on table public.gouvernance_documents is
  'Documents officiels de gouvernance (statuts, règlement intérieur, PV d''AG…), avec version et date d''adoption. Lisibles par tous les membres de l''association, gérés par le bureau.';

create index if not exists gouvernance_documents_assoc_idx on public.gouvernance_documents (association_id, type, date_adoption desc);

alter table public.gouvernance_documents enable row level security;
drop policy if exists "gouvernance_documents select" on public.gouvernance_documents;
create policy "gouvernance_documents select" on public.gouvernance_documents for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "gouvernance_documents write" on public.gouvernance_documents;
create policy "gouvernance_documents write" on public.gouvernance_documents for all to authenticated
  using (association_id = public.current_association_id() and public.is_bureau())
  with check (association_id = public.current_association_id() and public.is_bureau());

drop trigger if exists trg_log_gouvernance_documents on public.gouvernance_documents;
create trigger trg_log_gouvernance_documents after insert or delete on public.gouvernance_documents
for each row execute function public.log_activity();

-- Lecture des fichiers par tous les membres : déjà permise par la politique
-- « documents storage select » (dossier de l'association). Dépôt : bureau.

-- ---------------------------------------------------------------------
-- 2) Assemblées générales
-- ---------------------------------------------------------------------
create table if not exists public.assemblees (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  titre text not null,
  type text not null default 'ordinaire' check (type in ('ordinaire', 'extraordinaire')),
  date_ag timestamptz,
  lieu text,
  lien_visio text,
  ordre_du_jour text,
  quorum_pct numeric check (quorum_pct is null or quorum_pct between 0 and 100),
  statut text not null default 'preparation' check (statut in ('preparation', 'convoquee', 'tenue', 'cloturee')),
  convoquee_le timestamptz,
  compte_rendu text,
  resolutions jsonb not null default '[]'::jsonb,   -- [{titre, pour, contre, abstention}]
  pv_document_id uuid references public.gouvernance_documents(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.assemblees is
  'Assemblées générales : préparation, convocation, présence et quorum, résolutions votées en séance, PV archivé.';

alter table public.gouvernance_documents drop constraint if exists gouvernance_documents_assemblee_fk;
alter table public.gouvernance_documents add constraint gouvernance_documents_assemblee_fk
  foreign key (assemblee_id) references public.assemblees(id) on delete set null;

create table if not exists public.assemblee_presences (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  assemblee_id uuid not null references public.assemblees(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  mode text not null check (mode in ('present', 'represente', 'excuse')),
  mandataire_id uuid references public.members(id) on delete set null,
  pointe_le timestamptz not null default now(),
  unique (assemblee_id, member_id)
);
comment on table public.assemblee_presences is
  'Feuille de présence d''une AG : présent, représenté (procuration à un mandataire) ou excusé.';

alter table public.assemblees enable row level security;
alter table public.assemblee_presences enable row level security;
drop policy if exists "assemblees select" on public.assemblees;
create policy "assemblees select" on public.assemblees for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "assemblees write" on public.assemblees;
create policy "assemblees write" on public.assemblees for all to authenticated
  using (association_id = public.current_association_id() and public.is_bureau())
  with check (association_id = public.current_association_id() and public.is_bureau());
drop policy if exists "assemblee_presences select" on public.assemblee_presences;
create policy "assemblee_presences select" on public.assemblee_presences for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "assemblee_presences write" on public.assemblee_presences;
create policy "assemblee_presences write" on public.assemblee_presences for all to authenticated
  using (association_id = public.current_association_id() and public.is_bureau())
  with check (association_id = public.current_association_id() and public.is_bureau());

drop trigger if exists trg_log_assemblees on public.assemblees;
create trigger trg_log_assemblees after insert or delete or update of statut on public.assemblees
for each row execute function public.log_activity();

-- Convocation : statut « convoquée » + notification à tous les membres
-- qui ont un compte.
create or replace function public.convoquer_assemblee(p_id uuid) returns integer
language plpgsql security definer set search_path = '' as $fn$
declare
  v_ag public.assemblees;
  v_p uuid;
  v_n integer := 0;
begin
  select * into v_ag from public.assemblees where id = p_id;
  if v_ag.id is null or v_ag.association_id <> public.current_association_id() or not public.is_bureau() then
    raise exception 'Non autorisé.';
  end if;
  if v_ag.date_ag is null then raise exception 'Indiquez d''abord la date de l''assemblée.'; end if;
  update public.assemblees set statut = 'convoquee', convoquee_le = now() where id = p_id and statut = 'preparation';
  for v_p in
    select p.id from public.profiles p join public.members m on m.id = p.member_id
     where p.association_id = v_ag.association_id and m.statut = 'Actif'
  loop
    perform public.notify_profile(v_ag.association_id, v_p, '📣 Convocation : ' || v_ag.titre,
      'Le ' || to_char(v_ag.date_ag at time zone 'America/Moncton', 'DD/MM/YYYY à HH24"h"MI') || coalesce(' — ' || v_ag.lieu, '')
      || '. Ordre du jour dans Gouvernance → Assemblées.');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;
grant execute on function public.convoquer_assemblee(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Organigramme public : responsables de rubriques (sur option)
-- ---------------------------------------------------------------------
alter table public.associations add column if not exists vitrine_responsables boolean not null default false;

create or replace view public.public_responsables as
select a.slug_public, coalesce(m.nom, p.nom_complet) as nom, m.photo_url, p.rubrique_assignee as rubrique
  from public.profiles p
  join public.associations a on a.id = p.association_id
  left join public.members m on m.id = p.member_id
 where a.vitrine_active = true and a.slug_public is not null and a.vitrine_responsables = true
   and p.role = 'responsable_rubrique' and coalesce(p.compte_bloque, false) = false;
grant select on public.public_responsables to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) Rappel au président : fin de mandat dans 60 jours, puis 30 jours
-- ---------------------------------------------------------------------
create or replace function public.rappels_fin_mandats() returns integer
language plpgsql security definer set search_path = '' as $fn$
declare
  v record;
  v_p uuid;
  v_n integer := 0;
begin
  for v in
    select bm.association_id, bm.poste, bm.mandat_fin, m.nom,
           (bm.mandat_fin - current_date) as jours
      from public.board_members bm
      join public.members m on m.id = bm.member_id
     where bm.mandat_fin in (current_date + 60, current_date + 30)
  loop
    for v_p in select p.id from public.profiles p where p.association_id = v.association_id and p.role = 'bureau_president' loop
      perform public.notify_profile(v.association_id, v_p, '🗓️ Fin de mandat dans ' || v.jours || ' jours',
        v.nom || ' (' || v.poste || ') termine son mandat le ' || to_char(v.mandat_fin, 'DD/MM/YYYY')
        || '. Pensez à organiser l''élection dans Gouvernance → Élections.');
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end;
$fn$;
revoke all on function public.rappels_fin_mandats() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('gouvernance-rappels-mandats', '0 13 * * *', 'select public.rappels_fin_mandats();');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select tablename from pg_tables where tablename in ('gouvernance_documents','assemblees','assemblee_presences');   -- 3 lignes
-- ---------------------------------------------------------------------
