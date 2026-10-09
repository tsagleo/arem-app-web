-- =====================================================================
-- Comité restreint du bureau (2026-10-09)
-- =====================================================================
-- Demande de l'utilisateur : au sein du bureau, un petit comité pour
-- diriger et traiter les questions ponctuelles qui n'ont pas à être
-- débattues en assemblée générale.
--
-- Qui est membre ?
--   • le président (rôle bureau_president) l'est toujours, d'office ;
--   • les autres comptes du bureau qu'il désigne (table comite_membres),
--     et lui seul peut modifier cette liste (definir_membres_comite).
--   • un membre qui perd son rôle de bureau perd aussitôt l'accès, même
--     s'il figure encore dans la liste.
--
-- Confidentialité IMPOSÉE PAR LA BASE (RLS) : toutes les tables du comité
-- ne sont lisibles que si public.is_comite_membre() est vrai. Les autres
-- membres du bureau ne voient rien — sauf les décisions closes que le
-- comité a explicitement marquées « à communiquer au bureau »
-- (diffusion = 'bureau'), en lecture seule. Les votes nominatifs, eux,
-- ne sortent jamais du comité.
--
-- Journal d'activité : VOLONTAIREMENT limité à la composition du comité
-- (comite_membres). Le journal est lisible par tout le bureau et le
-- déclencheur log_activity() y recopie la ligne entière : le brancher sur
-- les réunions, sujets, messages ou décisions ferait fuiter leur contenu.
--
-- Documents : bucket Storage privé « comite-docs », chemin
-- "<association_id>/<horodatage>_<nom_fichier>", mêmes règles d'accès.
--
-- Ré-exécutable sans risque.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------
create table if not exists public.comite_membres (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  nom text,
  ajoute_par uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (association_id, profile_id)
);
comment on table public.comite_membres is
  'Membres désignés du comité restreint (le président l''est d''office et n''y figure pas). Écriture uniquement via definir_membres_comite().';

create table if not exists public.comite_reunions (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  titre text not null,
  date_reunion timestamptz,
  lieu text,
  ordre_du_jour text,                      -- un point par ligne
  compte_rendu text,
  statut text not null default 'prevue' check (statut in ('prevue', 'tenue', 'annulee')),
  auteur_id uuid references public.profiles(id),
  auteur_nom text,
  created_at timestamptz not null default now()
);
comment on table public.comite_reunions is 'Réunions du comité restreint (ordre du jour, compte rendu). Confidentiel : lisible par le comité seulement.';

create table if not exists public.comite_sujets (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  reunion_id uuid references public.comite_reunions(id) on delete set null,
  titre text not null,
  description text,
  statut text not null default 'ouvert' check (statut in ('ouvert', 'clos')),
  auteur_id uuid references public.profiles(id),
  auteur_nom text,
  created_at timestamptz not null default now()
);
comment on table public.comite_sujets is 'Sujets traités par le comité restreint, chacun avec son fil de discussion.';

create table if not exists public.comite_messages (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  sujet_id uuid not null references public.comite_sujets(id) on delete cascade,
  contenu text not null check (length(trim(contenu)) > 0),
  auteur_id uuid references public.profiles(id),
  auteur_nom text,
  created_at timestamptz not null default now()
);
comment on table public.comite_messages is 'Fil de discussion d''un sujet du comité restreint.';

create table if not exists public.comite_documents (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  sujet_id uuid references public.comite_sujets(id) on delete set null,
  reunion_id uuid references public.comite_reunions(id) on delete set null,
  titre text not null,
  chemin text not null unique,             -- chemin dans le bucket « comite-docs »
  nom_fichier text,
  taille bigint,
  type_mime text,
  auteur_id uuid references public.profiles(id),
  auteur_nom text,
  created_at timestamptz not null default now()
);
comment on table public.comite_documents is 'Documents confidentiels du comité restreint (fichiers dans le bucket privé comite-docs).';

create table if not exists public.comite_decisions (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  reunion_id uuid references public.comite_reunions(id) on delete set null,
  sujet_id uuid references public.comite_sujets(id) on delete set null,
  titre text not null,
  texte text,
  diffusion text not null default 'comite' check (diffusion in ('comite', 'bureau')),
  statut text not null default 'en_vote' check (statut in ('en_vote', 'adoptee', 'rejetee', 'sans_quorum')),
  quorum int not null check (quorum >= 1),  -- nombre de votants requis (abstentions comprises)
  nb_membres int not null,                  -- taille du comité à l'ouverture du vote
  pour int not null default 0,
  contre int not null default 0,
  abstention int not null default 0,
  auteur_id uuid references public.profiles(id),
  auteur_nom text,
  cloture_le timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.comite_decisions is
  'Décisions du comité restreint, votées en interne. Écriture uniquement via creer_decision / voter_decision / cloturer_decision / definir_diffusion_decision. Une décision close marquée diffusion = ''bureau'' est lisible par tout le bureau.';

create table if not exists public.comite_votes (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  decision_id uuid not null references public.comite_decisions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  votant_nom text,
  choix text not null check (choix in ('pour', 'contre', 'abstention')),
  created_at timestamptz not null default now(),
  unique (decision_id, profile_id)
);
comment on table public.comite_votes is 'Votes internes (nominatifs) du comité restreint. Jamais visibles hors du comité.';

create index if not exists comite_reunions_assoc_idx on public.comite_reunions (association_id, date_reunion desc);
create index if not exists comite_sujets_assoc_idx on public.comite_sujets (association_id, created_at desc);
create index if not exists comite_messages_sujet_idx on public.comite_messages (sujet_id, created_at);
create index if not exists comite_documents_assoc_idx on public.comite_documents (association_id, created_at desc);
create index if not exists comite_decisions_assoc_idx on public.comite_decisions (association_id, created_at desc);
create index if not exists comite_votes_decision_idx on public.comite_votes (decision_id);

-- ---------------------------------------------------------------------
-- 2) Fonctions d'accès
-- ---------------------------------------------------------------------
-- Vrai si le compte connecté fait partie du comité de SON association :
-- président d'office, ou compte du bureau désigné par le président.
create or replace function public.is_comite_membre() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select coalesce((
    select p.role = 'bureau_president'
        or (p.role in ('bureau_secretaire', 'bureau_tresorier', 'bureau_custom')
            and exists (select 1 from public.comite_membres c
                         where c.association_id = p.association_id and c.profile_id = p.id))
      from public.profiles p
     where p.id = auth.uid() and p.association_id is not null
  ), false)
$fn$;

-- Bureau au sens large (y compris les rôles personnalisés « bureau_custom »).
create or replace function public.comite_est_bureau() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select coalesce((select p.role in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier', 'bureau_custom')
                     from public.profiles p where p.id = auth.uid()), false)
$fn$;

-- Composition effective du comité d'une association (usage interne).
create or replace function public.comite_effectif(p_assoc uuid)
returns table (profile_id uuid, nom text, est_president boolean)
language sql stable security definer set search_path = '' as $fn$
  select p.id, p.nom_complet, p.role = 'bureau_president'
    from public.profiles p
   where p.association_id = p_assoc
     and (p.role = 'bureau_president'
          or (p.role in ('bureau_secretaire', 'bureau_tresorier', 'bureau_custom')
              and exists (select 1 from public.comite_membres c where c.association_id = p_assoc and c.profile_id = p.id)))
$fn$;
revoke all on function public.comite_effectif(uuid) from public, anon, authenticated;

-- Ce que l'app a besoin de savoir pour afficher (ou non) la rubrique.
create or replace function public.comite_mon_acces() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_role text := public.current_user_role();
begin
  if v_assoc is null or not public.comite_est_bureau() then
    return jsonb_build_object('membre', false, 'president', false, 'communiquees', 0);
  end if;
  return jsonb_build_object(
    'membre', public.is_comite_membre(),
    'president', v_role = 'bureau_president',
    'communiquees', (select count(*) from public.comite_decisions d
                      where d.association_id = v_assoc and d.diffusion = 'bureau' and d.statut <> 'en_vote')
  );
end;
$fn$;

-- Liste des membres effectifs, lisible par le comité seulement.
create or replace function public.comite_membres_effectifs()
returns table (profile_id uuid, nom text, est_president boolean)
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.is_comite_membre() then raise exception 'Non autorisé.'; end if;
  return query select * from public.comite_effectif(public.current_association_id()) order by 3 desc, 2;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 3) Auteur et association fixés par le serveur (impossible à usurper)
-- ---------------------------------------------------------------------
create or replace function public.comite_set_auteur() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  new.association_id := public.current_association_id();
  new.auteur_id := auth.uid();
  new.auteur_nom := (select p.nom_complet from public.profiles p where p.id = auth.uid());
  return new;
end;
$fn$;

drop trigger if exists trg_comite_auteur on public.comite_reunions;
create trigger trg_comite_auteur before insert on public.comite_reunions for each row execute function public.comite_set_auteur();
drop trigger if exists trg_comite_auteur on public.comite_sujets;
create trigger trg_comite_auteur before insert on public.comite_sujets for each row execute function public.comite_set_auteur();
drop trigger if exists trg_comite_auteur on public.comite_messages;
create trigger trg_comite_auteur before insert on public.comite_messages for each row execute function public.comite_set_auteur();
drop trigger if exists trg_comite_auteur on public.comite_documents;
create trigger trg_comite_auteur before insert on public.comite_documents for each row execute function public.comite_set_auteur();

-- ---------------------------------------------------------------------
-- 4) RLS
-- ---------------------------------------------------------------------
alter table public.comite_membres enable row level security;
alter table public.comite_reunions enable row level security;
alter table public.comite_sujets enable row level security;
alter table public.comite_messages enable row level security;
alter table public.comite_documents enable row level security;
alter table public.comite_decisions enable row level security;
alter table public.comite_votes enable row level security;

-- Membres : lecture par le comité ; écriture via definir_membres_comite().
drop policy if exists "comite_membres select" on public.comite_membres;
create policy "comite_membres select" on public.comite_membres for select to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre());

-- Réunions et sujets : le comité lit, crée, modifie ; suppression par
-- l'auteur ou le président.
drop policy if exists "comite_reunions select" on public.comite_reunions;
drop policy if exists "comite_reunions insert" on public.comite_reunions;
drop policy if exists "comite_reunions update" on public.comite_reunions;
drop policy if exists "comite_reunions delete" on public.comite_reunions;
create policy "comite_reunions select" on public.comite_reunions for select to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre());
create policy "comite_reunions insert" on public.comite_reunions for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_comite_membre());
create policy "comite_reunions update" on public.comite_reunions for update to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre())
  with check (association_id = public.current_association_id() and public.is_comite_membre());
create policy "comite_reunions delete" on public.comite_reunions for delete to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre()
         and (auteur_id = auth.uid() or public.current_user_role() = 'bureau_president'));

drop policy if exists "comite_sujets select" on public.comite_sujets;
drop policy if exists "comite_sujets insert" on public.comite_sujets;
drop policy if exists "comite_sujets update" on public.comite_sujets;
drop policy if exists "comite_sujets delete" on public.comite_sujets;
create policy "comite_sujets select" on public.comite_sujets for select to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre());
create policy "comite_sujets insert" on public.comite_sujets for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_comite_membre());
create policy "comite_sujets update" on public.comite_sujets for update to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre())
  with check (association_id = public.current_association_id() and public.is_comite_membre());
create policy "comite_sujets delete" on public.comite_sujets for delete to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre()
         and (auteur_id = auth.uid() or public.current_user_role() = 'bureau_president'));

-- Messages : lecture et ajout par le comité ; chacun peut retirer le sien.
drop policy if exists "comite_messages select" on public.comite_messages;
drop policy if exists "comite_messages insert" on public.comite_messages;
drop policy if exists "comite_messages delete" on public.comite_messages;
create policy "comite_messages select" on public.comite_messages for select to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre());
create policy "comite_messages insert" on public.comite_messages for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_comite_membre()
              and exists (select 1 from public.comite_sujets s where s.id = sujet_id and s.association_id = public.current_association_id()));
create policy "comite_messages delete" on public.comite_messages for delete to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre() and auteur_id = auth.uid());

-- Documents : lecture et ajout par le comité ; retrait par l'auteur ou le président.
drop policy if exists "comite_documents select" on public.comite_documents;
drop policy if exists "comite_documents insert" on public.comite_documents;
drop policy if exists "comite_documents delete" on public.comite_documents;
create policy "comite_documents select" on public.comite_documents for select to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre());
create policy "comite_documents insert" on public.comite_documents for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_comite_membre()
              and split_part(chemin, '/', 1) = public.current_association_id()::text);
create policy "comite_documents delete" on public.comite_documents for delete to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre()
         and (auteur_id = auth.uid() or public.current_user_role() = 'bureau_president'));

-- Décisions : le comité lit tout ; le reste du bureau lit seulement les
-- décisions closes « à communiquer au bureau ». Aucune écriture directe.
drop policy if exists "comite_decisions select" on public.comite_decisions;
create policy "comite_decisions select" on public.comite_decisions for select to authenticated
  using (association_id = public.current_association_id()
         and (public.is_comite_membre()
              or (diffusion = 'bureau' and statut <> 'en_vote' and public.comite_est_bureau())));

-- Votes : lus par le comité seulement ; écriture via voter_decision().
drop policy if exists "comite_votes select" on public.comite_votes;
create policy "comite_votes select" on public.comite_votes for select to authenticated
  using (association_id = public.current_association_id() and public.is_comite_membre());

-- ---------------------------------------------------------------------
-- 5) Fonctions d'écriture
-- ---------------------------------------------------------------------
-- Le président fixe la liste complète des membres désignés.
create or replace function public.definir_membres_comite(p_profile_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_ids uuid[] := coalesce(p_profile_ids, '{}');
  v_valides int;
begin
  if v_assoc is null or public.current_user_role() <> 'bureau_president' then
    raise exception 'Seul le président peut désigner les membres du comité.';
  end if;

  select count(*) into v_valides from public.profiles p
   where p.id = any(v_ids) and p.association_id = v_assoc
     and p.role in ('bureau_secretaire', 'bureau_tresorier', 'bureau_custom');
  if v_valides <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'Seuls des comptes du bureau de l''association peuvent être désignés.';
  end if;

  delete from public.comite_membres c where c.association_id = v_assoc and not (c.profile_id = any(v_ids));
  insert into public.comite_membres (association_id, profile_id, nom, ajoute_par)
  select v_assoc, p.id, p.nom_complet, auth.uid() from public.profiles p
   where p.id = any(v_ids)
  on conflict (association_id, profile_id) do nothing;

  return v_valides;
end;
$fn$;

-- Clôture commune : décompte et résultat.
-- Règle : quorum atteint si le nombre de votants (abstentions comprises)
-- est >= quorum ; adoptée si « pour » > « contre ».
create or replace function public.comite_cloturer(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_pour int; v_contre int; v_abst int; v_quorum int;
begin
  select count(*) filter (where choix = 'pour'), count(*) filter (where choix = 'contre'), count(*) filter (where choix = 'abstention')
    into v_pour, v_contre, v_abst from public.comite_votes where decision_id = p_id;
  select quorum into v_quorum from public.comite_decisions where id = p_id;
  update public.comite_decisions
     set pour = v_pour, contre = v_contre, abstention = v_abst, cloture_le = now(),
         statut = case when v_pour + v_contre + v_abst < v_quorum then 'sans_quorum'
                       when v_pour > v_contre then 'adoptee' else 'rejetee' end
   where id = p_id;
end;
$fn$;
revoke all on function public.comite_cloturer(uuid) from public, anon, authenticated;

create or replace function public.creer_decision(
  p_titre text, p_texte text, p_reunion_id uuid default null, p_sujet_id uuid default null,
  p_diffusion text default 'comite', p_quorum int default null
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_n int;
  v_q int;
  v_id uuid;
begin
  if v_assoc is null or not public.is_comite_membre() then raise exception 'Non autorisé.'; end if;
  if coalesce(trim(p_titre), '') = '' then raise exception 'Titre requis.'; end if;
  if p_diffusion not in ('comite', 'bureau') then raise exception 'Niveau de diffusion invalide.'; end if;
  if p_reunion_id is not null and not exists (select 1 from public.comite_reunions where id = p_reunion_id and association_id = v_assoc) then
    raise exception 'Réunion inconnue.';
  end if;
  if p_sujet_id is not null and not exists (select 1 from public.comite_sujets where id = p_sujet_id and association_id = v_assoc) then
    raise exception 'Sujet inconnu.';
  end if;

  select count(*) into v_n from public.comite_effectif(v_assoc);
  -- Par défaut : majorité absolue des membres du comité.
  v_q := coalesce(p_quorum, v_n / 2 + 1);
  if v_q < 1 or v_q > v_n then raise exception 'Quorum invalide : entre 1 et % votant(s).', v_n; end if;

  insert into public.comite_decisions (association_id, reunion_id, sujet_id, titre, texte, diffusion, quorum, nb_membres, auteur_id, auteur_nom)
  values (v_assoc, p_reunion_id, p_sujet_id, trim(p_titre), nullif(trim(coalesce(p_texte, '')), ''), p_diffusion, v_q, v_n,
          auth.uid(), (select nom_complet from public.profiles where id = auth.uid()))
  returning id into v_id;
  return v_id;
end;
$fn$;

-- Vote (modifiable tant que le vote est ouvert). Clôture automatique dès
-- que tous les membres du comité ont voté.
create or replace function public.voter_decision(p_id uuid, p_choix text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_d public.comite_decisions;
  v_assoc uuid := public.current_association_id();
begin
  select * into v_d from public.comite_decisions where id = p_id for update;
  if v_d.id is null or v_d.association_id <> v_assoc or not public.is_comite_membre() then raise exception 'Non autorisé.'; end if;
  if v_d.statut <> 'en_vote' then raise exception 'Le vote sur cette décision est clos.'; end if;
  if p_choix not in ('pour', 'contre', 'abstention') then raise exception 'Choix invalide.'; end if;

  insert into public.comite_votes (association_id, decision_id, profile_id, votant_nom, choix)
  values (v_assoc, p_id, auth.uid(), (select nom_complet from public.profiles where id = auth.uid()), p_choix)
  on conflict (decision_id, profile_id) do update set choix = excluded.choix, created_at = now();

  if (select count(*) from public.comite_votes v
       where v.decision_id = p_id and v.profile_id in (select e.profile_id from public.comite_effectif(v_assoc) e))
     >= (select count(*) from public.comite_effectif(v_assoc)) then
    perform public.comite_cloturer(p_id);
  end if;
end;
$fn$;

-- Clôture manuelle : par le président ou l'auteur de la décision.
create or replace function public.cloturer_decision(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_d public.comite_decisions;
begin
  select * into v_d from public.comite_decisions where id = p_id for update;
  if v_d.id is null or v_d.association_id <> public.current_association_id() or not public.is_comite_membre()
     or (v_d.auteur_id <> auth.uid() and public.current_user_role() <> 'bureau_president') then
    raise exception 'Non autorisé.';
  end if;
  if v_d.statut <> 'en_vote' then raise exception 'Le vote sur cette décision est déjà clos.'; end if;
  perform public.comite_cloturer(p_id);
end;
$fn$;

-- Niveau de diffusion : par le président ou l'auteur, à tout moment.
create or replace function public.definir_diffusion_decision(p_id uuid, p_diffusion text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_d public.comite_decisions;
begin
  select * into v_d from public.comite_decisions where id = p_id for update;
  if v_d.id is null or v_d.association_id <> public.current_association_id() or not public.is_comite_membre()
     or (v_d.auteur_id <> auth.uid() and public.current_user_role() <> 'bureau_president') then
    raise exception 'Non autorisé.';
  end if;
  if p_diffusion not in ('comite', 'bureau') then raise exception 'Niveau de diffusion invalide.'; end if;
  update public.comite_decisions set diffusion = p_diffusion where id = p_id;
end;
$fn$;

grant execute on function public.is_comite_membre() to authenticated;
grant execute on function public.comite_est_bureau() to authenticated;
grant execute on function public.comite_mon_acces() to authenticated;
grant execute on function public.comite_membres_effectifs() to authenticated;
grant execute on function public.definir_membres_comite(uuid[]) to authenticated;
grant execute on function public.creer_decision(text, text, uuid, uuid, text, int) to authenticated;
grant execute on function public.voter_decision(uuid, text) to authenticated;
grant execute on function public.cloturer_decision(uuid) to authenticated;
grant execute on function public.definir_diffusion_decision(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Journal d'activité : composition du comité seulement (voir en-tête)
-- ---------------------------------------------------------------------
drop trigger if exists trg_log_comite_membres on public.comite_membres;
create trigger trg_log_comite_membres after insert or delete on public.comite_membres
for each row execute function public.log_activity();

-- ---------------------------------------------------------------------
-- 7) Bucket Storage privé « comite-docs » (20 Mo par fichier)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('comite-docs', 'comite-docs', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "comite docs storage select" on storage.objects;
drop policy if exists "comite docs storage insert" on storage.objects;
drop policy if exists "comite docs storage delete" on storage.objects;

-- Chemin attendu : "<association_id>/<horodatage>_<nom_fichier>".
create policy "comite docs storage select" on storage.objects for select to authenticated
  using (bucket_id = 'comite-docs'
         and (storage.foldername(name))[1] = public.current_association_id()::text
         and public.is_comite_membre());
create policy "comite docs storage insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'comite-docs'
              and (storage.foldername(name))[1] = public.current_association_id()::text
              and public.is_comite_membre());
create policy "comite docs storage delete" on storage.objects for delete to authenticated
  using (bucket_id = 'comite-docs'
         and (storage.foldername(name))[1] = public.current_association_id()::text
         and public.is_comite_membre());

-- ---------------------------------------------------------------------
-- 8) Temps réel : nouveaux messages des fils de discussion (la RLS
--    s'applique aussi au temps réel : seuls les membres les reçoivent)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comite_messages'
  ) then
    alter publication supabase_realtime add table public.comite_messages;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
-- select public.comite_mon_acces();   -- depuis l'app : {membre, president, communiquees}
-- select tablename, policyname from pg_policies where tablename like 'comite_%' order by 1;
-- select id, public from storage.buckets where id = 'comite-docs';
-- ---------------------------------------------------------------------
