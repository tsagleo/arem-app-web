-- =====================================================================
-- Emploi & carrière — nouvelle rubrique (offres d'emploi/bénévolat,
-- candidatures, correspondance avec les compétences des membres)
-- =====================================================================
-- Suite de claude/covoiturage-webinaires-emploi-proposition.md, demandée
-- par l'utilisateur le 2026-10-06 ("implémentation totale"). Le score de
-- correspondance (% de compétences requises que le membre possède déjà)
-- est calculé CÔTÉ CLIENT à partir de members.competences (texte libre,
-- séparé par virgules) comparé à job_postings.competences_requises
-- (tableau de texte) — aucune colonne supplémentaire nécessaire.
--
-- SIMPLIFICATIONS ASSUMÉES (à ajuster sur demande) :
--   - Visibilité publique (offre consultable sans compte, comme la
--     vitrine publique ou les événements publics) : colonne `visibilite`
--     prévue pour l'avenir mais PAS construite cette vague — toutes les
--     offres restent consultables aux membres connectés uniquement. Le
--     construire demanderait une page publique dédiée, comparable en
--     ampleur à la vitrine publique déjà existante ; à faire séparément
--     si souhaité.
--   - CV/lettre de motivation : stockés dans un bucket dédié
--     "job-applications" (privé, classé par association puis par
--     membre) — PAS dans le coffre Documents existant (bucket
--     "documents"), dont le dépôt est réservé au Bureau/personnel
--     (is_staff()) : un membre ordinaire qui postule ne pourrait pas y
--     déposer son propre fichier. Le Bureau reste libre d'archiver
--     manuellement une candidature retenue dans le coffre Documents,
--     exactement comme pour les pièces jointes d'adhésion
--     (GestionAcces.jsx, archiveJoinDocument).
--   - Publication réservée au Bureau/personnel (is_staff()), y compris
--     pour une offre d'un partenaire externe (texte libre dans
--     `organisation`).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Table job_postings
-- ---------------------------------------------------------------------
create table if not exists public.job_postings (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  titre text not null,
  organisation text,
  lieu text,
  type_contrat text not null default 'cdi',
  description text,
  competences_requises text[] not null default '{}',
  visibilite text not null default 'membres',
  statut text not null default 'active',
  expire_le date,
  created_by uuid references public.members(id),
  created_at timestamptz not null default now()
);
alter table public.job_postings drop constraint if exists job_postings_type_contrat_check;
alter table public.job_postings add constraint job_postings_type_contrat_check
  check (type_contrat in ('cdi', 'cdd', 'stage', 'benevolat', 'temps_partiel'));
alter table public.job_postings drop constraint if exists job_postings_visibilite_check;
alter table public.job_postings add constraint job_postings_visibilite_check
  check (visibilite in ('membres', 'publique'));
alter table public.job_postings drop constraint if exists job_postings_statut_check;
alter table public.job_postings add constraint job_postings_statut_check
  check (statut in ('active', 'fermee'));

create index if not exists job_postings_assoc_idx on public.job_postings(association_id);

comment on table public.job_postings is
  'Offres d''emploi, de stage ou de bénévolat publiées par le Bureau pour la communauté — competences_requises comparé côté client à members.competences pour un score de correspondance.';
comment on column public.job_postings.visibilite is
  'Prévu pour une future page publique (comme la vitrine) — non exploité cette vague : toutes les offres restent réservées aux membres connectés quelle que soit cette valeur.';

-- ---------------------------------------------------------------------
-- 2) Table job_applications
-- ---------------------------------------------------------------------
create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.job_postings(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  member_nom text,
  cv_path text,
  cv_nom text,
  lettre_path text,
  lettre_nom text,
  message text,
  statut text not null default 'envoyee',
  created_at timestamptz not null default now(),
  unique (job_id, member_id)
);
alter table public.job_applications drop constraint if exists job_applications_statut_check;
alter table public.job_applications add constraint job_applications_statut_check
  check (statut in ('envoyee', 'vue', 'retenue', 'refusee'));

create index if not exists job_applications_job_idx on public.job_applications(job_id);
create index if not exists job_applications_assoc_idx on public.job_applications(association_id);

-- ---------------------------------------------------------------------
-- 3) RLS
-- ---------------------------------------------------------------------
alter table public.job_postings enable row level security;
alter table public.job_applications enable row level security;

drop policy if exists "job_postings select" on public.job_postings;
create policy "job_postings select" on public.job_postings for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "job_postings insert staff" on public.job_postings;
create policy "job_postings insert staff" on public.job_postings for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_staff());
drop policy if exists "job_postings update staff" on public.job_postings;
create policy "job_postings update staff" on public.job_postings for update to authenticated
  using (association_id = public.current_association_id() and public.is_staff())
  with check (association_id = public.current_association_id() and public.is_staff());
drop policy if exists "job_postings delete staff" on public.job_postings;
create policy "job_postings delete staff" on public.job_postings for delete to authenticated
  using (association_id = public.current_association_id() and public.is_staff());

drop policy if exists "job_applications select" on public.job_applications;
create policy "job_applications select" on public.job_applications for select to authenticated
  using (association_id = public.current_association_id() and (public.is_staff() or member_id = public.current_member_id()));
drop policy if exists "job_applications insert self" on public.job_applications;
create policy "job_applications insert self" on public.job_applications for insert to authenticated
  with check (association_id = public.current_association_id() and member_id = public.current_member_id());
drop policy if exists "job_applications update staff or self" on public.job_applications;
create policy "job_applications update staff or self" on public.job_applications for update to authenticated
  using (association_id = public.current_association_id() and (public.is_staff() or member_id = public.current_member_id()))
  with check (association_id = public.current_association_id() and (public.is_staff() or member_id = public.current_member_id()));
drop policy if exists "job_applications delete staff or self" on public.job_applications;
create policy "job_applications delete staff or self" on public.job_applications for delete to authenticated
  using (association_id = public.current_association_id() and (public.is_staff() or member_id = public.current_member_id()));

-- ---------------------------------------------------------------------
-- 4) Postuler — fonction dédiée (même esprit que les autres actions "en
--    mon nom propre" de ce projet) : insère la candidature ET notifie
--    l'auteur de l'offre, en un seul appel.
-- ---------------------------------------------------------------------
create or replace function public.postuler_offre_emploi(
  p_job_id uuid,
  p_cv_path text default null,
  p_cv_nom text default null,
  p_lettre_path text default null,
  p_lettre_nom text default null,
  p_message text default null
)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_member_nom text;
  v_job record;
  v_profile_id uuid;
begin
  if v_member_id is null then
    return query select 'non_autorise'::text; return;
  end if;
  select * into v_job from public.job_postings j where j.id = p_job_id and j.association_id = public.current_association_id();
  if v_job is null or v_job.statut <> 'active' then
    return query select 'introuvable'::text; return;
  end if;
  select nom into v_member_nom from public.members where id = v_member_id;
  insert into public.job_applications (
    job_id, association_id, member_id, member_nom, cv_path, cv_nom, lettre_path, lettre_nom, message
  ) values (
    p_job_id, v_job.association_id, v_member_id, v_member_nom, p_cv_path, p_cv_nom, p_lettre_path, p_lettre_nom, p_message
  )
  on conflict (job_id, member_id) do nothing;

  if not found then
    return query select 'deja_postule'::text; return;
  end if;

  if v_job.created_by is not null then
    select p.id into v_profile_id from public.profiles p where p.member_id = v_job.created_by;
    perform public.notify_profile(
      v_job.association_id, v_profile_id,
      '💼 Nouvelle candidature reçue',
      coalesce(v_member_nom, 'Un membre') || ' a postulé à l''offre « ' || v_job.titre || ' ».'
    );
  end if;
  return query select 'ok'::text;
end;
$fn$;
comment on function public.postuler_offre_emploi(uuid, text, text, text, text, text) is
  'Dépose une candidature (une seule par membre et par offre) et notifie l''auteur de l''offre — centralise l''action pour éviter qu''un membre ordinaire ait à écrire directement dans job_applications.';
grant execute on function public.postuler_offre_emploi(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Stockage (Storage) — bucket privé "job-applications"
--    Chemin : "<association_id>/<member_id>/<horodatage>_<cv|lettre>_<nom_fichier>"
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('job-applications', 'job-applications', false)
on conflict (id) do nothing;

drop policy if exists "job applications storage insert" on storage.objects;
drop policy if exists "job applications storage select" on storage.objects;
drop policy if exists "job applications storage delete" on storage.objects;

create policy "job applications storage insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-applications'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and (storage.foldername(name))[2] = public.current_member_id()::text
  );
create policy "job applications storage select" on storage.objects for select to authenticated
  using (
    bucket_id = 'job-applications'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and ((storage.foldername(name))[2] = public.current_member_id()::text or public.is_staff())
  );
create policy "job applications storage delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'job-applications'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and ((storage.foldername(name))[2] = public.current_member_id()::text or public.is_staff())
  );

-- =====================================================================
-- Vérification rapide après exécution :
--   select table_name from information_schema.tables
--   where table_schema = 'public' and table_name in ('job_postings', 'job_applications');
--   -- doit afficher 2 lignes
--   select proname from pg_proc where proname = 'postuler_offre_emploi'; -- 1 ligne
--   select id, public from storage.buckets where id = 'job-applications'; -- public = false
-- =====================================================================
