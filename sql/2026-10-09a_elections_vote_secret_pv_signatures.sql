-- =====================================================================
-- Élections — SIGNATURE ÉLECTRONIQUE et VERSEMENT du procès-verbal (2026-10-09)
-- (suite de 2026-10-09a_elections_vote_secret_comite.sql, À EXÉCUTER APRÈS LUI)
-- =====================================================================
-- Demande de l'utilisateur : que le PV puisse être signé directement dans
-- l'application, chaque membre du comité électoral depuis SON propre
-- compte, puis versé (téléversé) dans la rubrique Documents — sans avoir
-- à l'imprimer et à le faire circuler.
--
--   • election_pv_signatures : une signature par membre du comité, datée,
--     liée à son compte, avec l'EMPREINTE (SHA-256) des résultats signés.
--     Si un chiffre changeait, l'empreinte ne correspondrait plus.
--   • signer_pv_election()   : réservé aux membres du comité, après la
--     proclamation (les résultats sont alors figés).
--   • verser_pv_election()   : le président d'élection (ou le bureau)
--     enregistre le PV dans Documents (rubrique « Gouvernance ») :
--       - version électronique : seulement quand TOUT le comité a signé ;
--       - ou scan d'un PV signé à la main : possible à tout moment après
--         la proclamation.
--   • Stockage : les membres du comité (souvent de simples adhérents)
--     peuvent déposer un fichier, mais uniquement dans le dossier de LEUR
--     élection : <association>/elections/<election_id>/…
-- Ré-exécutable sans risque.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1) Signatures
-- ---------------------------------------------------------------------
create table if not exists public.election_pv_signatures (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  election_id uuid not null references public.elections(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  role text not null,
  nom text not null,
  empreinte text not null,
  signe_le timestamptz not null default now(),
  unique (election_id, member_id)
);

comment on table public.election_pv_signatures is
  'Signatures électroniques du PV par les membres du comité électoral, chacun depuis son compte. Écriture uniquement via signer_pv_election().';

alter table public.election_pv_signatures enable row level security;
drop policy if exists "election_pv_signatures select" on public.election_pv_signatures;
create policy "election_pv_signatures select" on public.election_pv_signatures for select to authenticated
  using (association_id = public.current_association_id());

drop trigger if exists trg_log_election_pv_signatures on public.election_pv_signatures;
create trigger trg_log_election_pv_signatures after insert on public.election_pv_signatures
for each row execute function public.log_activity();

-- Empreinte des résultats proclamés : ce que chaque signataire atteste.
-- (Agrégats seulement — jamais de lien votant / bulletin.)
create or replace function public.empreinte_pv_election(p_election_id uuid) returns text
language sql stable security definer set search_path = '' as $fn$
  select encode(extensions.digest(jsonb_build_object(
    'election', e.id,
    'titre', e.titre,
    'proclame_le', e.proclame_le,
    'inscrits', e.inscrits_cloture,
    'votants', (select count(distinct em.member_id) from public.election_emargements em where em.election_id = e.id),
    'voix', (select coalesce(jsonb_object_agg(v.candidat_id, v.n), '{}'::jsonb)
               from (select b.candidat_id, count(*) as n from public.election_bulletins b where b.election_id = e.id group by b.candidat_id) v)
  )::text, 'sha256'), 'hex')
  from public.elections e
  where e.id = p_election_id and e.association_id = public.current_association_id()
$fn$;

grant execute on function public.empreinte_pv_election(uuid) to authenticated;

create or replace function public.signer_pv_election(p_election_id uuid) returns text
language plpgsql security definer set search_path = '' as $fn$
declare
  v_el public.elections;
  v_member uuid := public.current_member_id();
  v_role text;
  v_nom text;
  v_empreinte text;
begin
  select * into v_el from public.elections where id = p_election_id;
  if v_el.id is null or v_el.association_id <> public.current_association_id() then raise exception 'Élection introuvable.'; end if;
  select c.role into v_role from public.election_comite c where c.election_id = p_election_id and c.member_id = v_member;
  if v_member is null or v_role is null then raise exception 'Seuls les membres du comité électoral signent le procès-verbal.'; end if;
  if v_el.proclame_le is null then raise exception 'Le procès-verbal se signe après la proclamation des résultats.'; end if;

  select m.nom into v_nom from public.members m where m.id = v_member;
  v_empreinte := public.empreinte_pv_election(p_election_id);
  begin
    insert into public.election_pv_signatures (association_id, election_id, member_id, profile_id, role, nom, empreinte)
    values (v_el.association_id, p_election_id, v_member, auth.uid(), v_role, coalesce(v_nom, ''), v_empreinte);
  exception when unique_violation then
    raise exception 'Vous avez déjà signé ce procès-verbal.';
  end;
  return v_empreinte;
end;
$fn$;

grant execute on function public.signer_pv_election(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Versement aux Documents
-- ---------------------------------------------------------------------
alter table public.elections add column if not exists pv_document_id uuid references public.documents(id) on delete set null;
alter table public.elections add column if not exists pv_verse_le timestamptz;
alter table public.elections add column if not exists pv_verse_par_nom text;
alter table public.elections add column if not exists pv_signe_main boolean;

create or replace function public.verser_pv_election(p_election_id uuid, p_path text, p_nom text, p_signe_main boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_el public.elections;
  v_doc uuid;
  v_nom text;
  v_manquants int;
begin
  select * into v_el from public.elections where id = p_election_id for update;
  if v_el.id is null or v_el.association_id <> public.current_association_id()
     or not (public.is_bureau() or public.est_comite_election(p_election_id, 'president')) then
    raise exception 'Seuls le président d''élection et le bureau versent le procès-verbal.';
  end if;
  if v_el.proclame_le is null then raise exception 'Le procès-verbal se verse après la proclamation des résultats.'; end if;
  if p_path is null or p_path not like v_el.association_id::text || '/elections/' || p_election_id::text || '/%' then
    raise exception 'Emplacement de fichier invalide.';
  end if;
  if not coalesce(p_signe_main, false) then
    select count(*) into v_manquants from public.election_comite c
     where c.election_id = p_election_id
       and not exists (select 1 from public.election_pv_signatures s where s.election_id = p_election_id and s.member_id = c.member_id);
    if v_manquants > 0 then
      raise exception 'Il manque encore % signature(s) du comité.', v_manquants;
    end if;
  end if;

  insert into public.documents (association_id, nom, storage_path, rubrique, uploaded_by)
  values (v_el.association_id, coalesce(nullif(trim(p_nom), ''), 'PV élection.pdf'), p_path, 'gouvernance', auth.uid())
  returning id into v_doc;

  select coalesce(m.nom, p.nom_complet) into v_nom
    from public.profiles p left join public.members m on m.id = p.member_id
   where p.id = auth.uid();

  update public.elections
     set pv_document_id = v_doc, pv_verse_le = now(), pv_verse_par_nom = v_nom, pv_signe_main = coalesce(p_signe_main, false)
   where id = p_election_id;
  return v_doc;
end;
$fn$;

grant execute on function public.verser_pv_election(uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Stockage : dépôt du PV par le comité, dans le dossier de l'élection
-- ---------------------------------------------------------------------
-- Les politiques existantes réservent le dépôt dans le bucket « documents »
-- au personnel (is_staff). On ajoute un accès ÉTROIT : un membre du comité
-- peut déposer, uniquement sous <association>/elections/<son élection>/.
create or replace function public.peut_deposer_pv(p_nom_fichier text) returns boolean
language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_dossiers text[] := storage.foldername(p_nom_fichier);
begin
  if coalesce(array_length(v_dossiers, 1), 0) < 3
     or v_dossiers[1] <> public.current_association_id()::text
     or v_dossiers[2] <> 'elections'
     or v_dossiers[3] !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return public.is_bureau() or public.est_comite_election(v_dossiers[3]::uuid);
end;
$fn$;

grant execute on function public.peut_deposer_pv(text) to authenticated;

drop policy if exists "documents storage insert pv election" on storage.objects;
create policy "documents storage insert pv election" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.peut_deposer_pv(name));

-- ---------------------------------------------------------------------
-- 4) Temps réel : chacun voit les signatures arriver
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'election_pv_signatures') then
    alter publication supabase_realtime add table public.election_pv_signatures;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select proname from pg_proc where proname in ('signer_pv_election','verser_pv_election','empreinte_pv_election','peut_deposer_pv');
-- ---------------------------------------------------------------------
