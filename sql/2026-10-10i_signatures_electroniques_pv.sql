-- =====================================================================
-- Signatures électroniques par défaut des procès-verbaux (2026-10-10)
-- (à exécuter APRÈS 2026-10-10g_comite_pv_resolutions.sql
--  et 2026-10-10h_gouvernance_documents_ag.sql)
-- =====================================================================
-- Demande de l'utilisateur : « tous les documents générés doivent avoir
-- des signatures électroniques par défaut, la signature manuelle restant
-- possible au besoin. Pour le comité restreint, chaque membre doit pouvoir
-- donner sa décharge électronique avant que le PV ne soit consigné et
-- jugé valide. »
--   1. COMITÉ RESTREINT : chaque membre du comité (composition figée à la
--      clôture) signe électroniquement le PV de la résolution depuis son
--      compte (décharge : il atteste en avoir pris connaissance et en
--      approuver le contenu). Le PV n'est archivé — donc consigné et
--      valide — qu'une fois TOUTES les signatures réunies.
--   2. ASSEMBLÉE GÉNÉRALE : le président et le secrétaire de séance signent
--      électroniquement le PV ; la clôture et l'archivage exigent les deux.
--      Après la première signature, compte rendu et résolutions sont figés
--      (sinon le document signé ne correspondrait plus).
-- Chaque signature enregistre l'EMPREINTE (SHA-256) du contenu signé.
-- La signature manuscrite reste possible : les cadres du PDF gardent une
-- ligne « signature manuscrite (facultative) ».
-- Ré-exécutable sans risque.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1) Comité restreint
-- ---------------------------------------------------------------------
-- La composition figée à la clôture garde désormais l'identifiant de
-- compte de chaque membre (pour savoir qui doit signer).
create or replace function public.comite_cloturer(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_pour int; v_contre int; v_abst int; v_quorum int;
  v_assoc uuid;
  v_num int;
begin
  select count(*) filter (where choix = 'pour'), count(*) filter (where choix = 'contre'), count(*) filter (where choix = 'abstention')
    into v_pour, v_contre, v_abst from public.comite_votes where decision_id = p_id;
  select quorum, association_id into v_quorum, v_assoc from public.comite_decisions where id = p_id;
  select coalesce(max(d.numero), 0) + 1 into v_num
    from public.comite_decisions d
   where d.association_id = v_assoc and d.numero is not null
     and extract(year from d.cloture_le) = extract(year from now());
  update public.comite_decisions
     set pour = v_pour, contre = v_contre, abstention = v_abst, cloture_le = now(),
         statut = case when v_pour + v_contre + v_abst < v_quorum then 'sans_quorum'
                       when v_pour > v_contre then 'adoptee' else 'rejetee' end,
         numero = coalesce(numero, v_num),
         membres_cloture = coalesce(membres_cloture, (
           select jsonb_agg(jsonb_build_object('profile_id', e.profile_id, 'nom', e.nom, 'president', e.est_president) order by e.est_president desc, e.nom)
             from public.comite_effectif(v_assoc) e))
   where id = p_id;
end;
$fn$;
revoke all on function public.comite_cloturer(uuid) from public, anon, authenticated;

-- Compositions déjà figées sans identifiant : rapprochement par le nom.
update public.comite_decisions d
   set membres_cloture = (
     select jsonb_agg(m.elem || coalesce(jsonb_build_object('profile_id', (
               select p.id from public.profiles p where p.association_id = d.association_id and p.nom_complet = m.elem->>'nom' limit 1)), '{}'::jsonb))
       from jsonb_array_elements(d.membres_cloture) as m(elem))
 where d.membres_cloture is not null
   and exists (select 1 from jsonb_array_elements(d.membres_cloture) e where not (e ? 'profile_id'));

create table if not exists public.comite_pv_signatures (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  decision_id uuid not null references public.comite_decisions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  nom text,
  empreinte text not null,
  signe_le timestamptz not null default now(),
  unique (decision_id, profile_id)
);
comment on table public.comite_pv_signatures is
  'Signatures électroniques (décharges) des membres du comité restreint sur le PV d''une résolution. Écriture uniquement via signer_pv_resolution().';
alter table public.comite_pv_signatures enable row level security;
drop policy if exists "comite_pv_signatures select" on public.comite_pv_signatures;
create policy "comite_pv_signatures select" on public.comite_pv_signatures for select to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre());

-- Empreinte de ce qui est signé : résolution, résultat et votes nominatifs.
create or replace function public.comite_empreinte_decision(p_id uuid) returns text
language sql stable security definer set search_path = '' as $fn$
  select encode(extensions.digest(jsonb_build_object(
    'id', d.id, 'numero', d.numero, 'titre', d.titre, 'texte', d.texte, 'statut', d.statut,
    'pour', d.pour, 'contre', d.contre, 'abstention', d.abstention, 'cloture_le', d.cloture_le,
    'votes', (select coalesce(jsonb_agg(jsonb_build_object('votant', v.votant_nom, 'choix', v.choix) order by v.votant_nom), '[]'::jsonb)
                from public.comite_votes v where v.decision_id = d.id)
  )::text, 'sha256'), 'hex')
  from public.comite_decisions d where d.id = p_id
$fn$;
revoke all on function public.comite_empreinte_decision(uuid) from public, anon, authenticated;

-- Le membre connecté doit-il signer ce PV ? (inscrit dans la composition figée)
create or replace function public.comite_doit_signer(p_id uuid, p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.comite_decisions d, jsonb_array_elements(coalesce(d.membres_cloture, '[]'::jsonb)) e
     where d.id = p_id and (e->>'profile_id')::uuid = p_profile)
$fn$;
revoke all on function public.comite_doit_signer(uuid, uuid) from public, anon, authenticated;

create or replace function public.signer_pv_resolution(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $fn$
declare
  v_d public.comite_decisions;
  v_emp text;
begin
  select * into v_d from public.comite_decisions where id = p_id;
  if v_d.id is null or v_d.association_id <> public.current_association_id() or not public.is_comite_membre() then
    raise exception 'Non autorisé.';
  end if;
  if v_d.statut = 'en_vote' then raise exception 'Le vote n''est pas encore clos.'; end if;
  if not public.comite_doit_signer(p_id, auth.uid()) then
    raise exception 'Vous ne faisiez pas partie du comité à la clôture de ce vote.';
  end if;
  v_emp := public.comite_empreinte_decision(p_id);
  insert into public.comite_pv_signatures (association_id, decision_id, profile_id, nom, empreinte)
  values (v_d.association_id, p_id, auth.uid(), (select nom_complet from public.profiles where id = auth.uid()), v_emp)
  on conflict (decision_id, profile_id) do nothing;
  return v_emp;
end;
$fn$;
grant execute on function public.signer_pv_resolution(uuid) to authenticated;

-- Archivage (consignation) seulement quand TOUS les membres ont signé.
create or replace function public.lier_pv_resolution(p_id uuid, p_document_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $fn$
declare
  v_n int;
  v_manque int;
begin
  if not public.is_comite_membre() then raise exception 'Non autorisé.'; end if;
  select count(*) into v_manque
    from public.comite_decisions d, jsonb_array_elements(coalesce(d.membres_cloture, '[]'::jsonb)) e
   where d.id = p_id
     and not exists (select 1 from public.comite_pv_signatures s where s.decision_id = d.id and s.profile_id = (e->>'profile_id')::uuid);
  if v_manque > 0 then raise exception 'Il manque encore % signature(s) électronique(s) du comité.', v_manque; end if;
  update public.comite_decisions
     set pv_document_id = p_document_id
   where id = p_id and association_id = public.current_association_id()
     and statut <> 'en_vote' and pv_document_id is null
     and exists (select 1 from public.comite_documents c where c.id = p_document_id and c.association_id = public.current_association_id());
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;
grant execute on function public.lier_pv_resolution(uuid, uuid) to authenticated;

-- Membres prévenus qu'une signature est attendue (à la clôture).
create or replace function public.comite_demander_signatures() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  e jsonb;
begin
  if old.statut = 'en_vote' and new.statut <> 'en_vote' then
    for e in select * from jsonb_array_elements(coalesce(new.membres_cloture, '[]'::jsonb)) loop
      perform public.notify_profile(new.association_id, (e->>'profile_id')::uuid, '✍️ PV de résolution à signer',
        '« ' || new.titre || ' » : signez électroniquement le procès-verbal dans Gouvernance → Comité restreint → Décisions.');
    end loop;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_comite_demander_signatures on public.comite_decisions;
create trigger trg_comite_demander_signatures after update of statut on public.comite_decisions
for each row execute function public.comite_demander_signatures();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comite_pv_signatures') then
    alter publication supabase_realtime add table public.comite_pv_signatures;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) Assemblée générale : président et secrétaire de séance
-- ---------------------------------------------------------------------
create table if not exists public.assemblee_signatures (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  assemblee_id uuid not null references public.assemblees(id) on delete cascade,
  role text not null check (role in ('president', 'secretaire')),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  nom text,
  empreinte text not null,
  signe_le timestamptz not null default now(),
  unique (assemblee_id, role)
);
comment on table public.assemblee_signatures is
  'Signatures électroniques du PV d''une AG (président et secrétaire de séance). Écriture via signer_pv_assemblee().';
alter table public.assemblee_signatures enable row level security;
drop policy if exists "assemblee_signatures select" on public.assemblee_signatures;
create policy "assemblee_signatures select" on public.assemblee_signatures for select to authenticated
  using (association_id = public.current_association_id());

create or replace function public.assemblee_empreinte(p_id uuid) returns text
language sql stable security definer set search_path = '' as $fn$
  select encode(extensions.digest(jsonb_build_object(
    'id', a.id, 'titre', a.titre, 'date', a.date_ag, 'ordre_du_jour', a.ordre_du_jour,
    'resolutions', a.resolutions, 'compte_rendu', a.compte_rendu,
    'presences', (select coalesce(jsonb_agg(jsonb_build_object('m', p.member_id, 'mode', p.mode) order by p.member_id), '[]'::jsonb)
                    from public.assemblee_presences p where p.assemblee_id = a.id)
  )::text, 'sha256'), 'hex')
  from public.assemblees a where a.id = p_id
$fn$;
revoke all on function public.assemblee_empreinte(uuid) from public, anon, authenticated;

create or replace function public.signer_pv_assemblee(p_id uuid, p_role text) returns text
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.assemblees;
  v_emp text;
begin
  select * into v_a from public.assemblees where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'tenue' then raise exception 'Le PV se signe une fois la séance tenue, avant la clôture.'; end if;
  if p_role not in ('president', 'secretaire') then raise exception 'Rôle invalide.'; end if;
  if exists (select 1 from public.assemblee_signatures s where s.assemblee_id = p_id and s.profile_id = auth.uid() and s.role <> p_role) then
    raise exception 'Une même personne ne peut pas signer à la fois comme président et secrétaire de séance.';
  end if;
  v_emp := public.assemblee_empreinte(p_id);
  insert into public.assemblee_signatures (association_id, assemblee_id, role, profile_id, nom, empreinte)
  values (v_a.association_id, p_id, p_role, auth.uid(), (select nom_complet from public.profiles where id = auth.uid()), v_emp)
  on conflict (assemblee_id, role) do nothing;
  return v_emp;
end;
$fn$;
grant execute on function public.signer_pv_assemblee(uuid, text) to authenticated;

-- Contenu figé dès la première signature ; clôture seulement si les deux
-- signatures sont réunies.
create or replace function public.assemblees_garde_signatures() returns trigger
language plpgsql set search_path = '' as $fn$
declare
  v_n int;
begin
  select count(*) into v_n from public.assemblee_signatures s where s.assemblee_id = new.id;
  if v_n > 0 and (new.resolutions is distinct from old.resolutions or new.compte_rendu is distinct from old.compte_rendu
                  or new.ordre_du_jour is distinct from old.ordre_du_jour) then
    raise exception 'Le procès-verbal est déjà signé : son contenu ne peut plus être modifié.';
  end if;
  if new.statut = 'cloturee' and old.statut <> 'cloturee' and v_n < 2 then
    raise exception 'Clôture impossible : le président et le secrétaire de séance doivent d''abord signer le PV.';
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_assemblees_garde_signatures on public.assemblees;
create trigger trg_assemblees_garde_signatures before update on public.assemblees
for each row execute function public.assemblees_garde_signatures();

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select tablename from pg_tables where tablename in ('comite_pv_signatures','assemblee_signatures');   -- 2 lignes
-- ---------------------------------------------------------------------
