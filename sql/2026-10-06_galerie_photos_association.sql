-- =====================================================================
-- Galerie de photos de l'association — 2026-10-06
-- Alimente le diaporama d'accueil et la carte "Galerie" de la nouvelle
-- maquette (sidebar/couleurs saphir & or). Nouvelle table
-- association_photos + nouveau bucket de stockage dédié
-- "association-photos" (public, comme "avatars"/"posts-media" — ces
-- photos sont affichées en grand sur la page d'accueil, pas besoin
-- d'URL signée).
--
-- Portée volontairement limitée à l'application authentifiée (tableau de
-- bord) pour cette première version : la vitrine publique
-- (PublicShowcase.jsx, visiteurs anonymes) n'est PAS câblée sur cette
-- galerie ici — ça demanderait de vérifier d'abord comment cette page
-- lit déjà les données de l'association sans authentification, pour
-- écrire une politique de lecture anonyme cohérente avec le même
-- mécanisme plutôt que d'en inventer un nouveau. Dites-le si vous voulez
-- aussi les photos sur la vitrine publique, ce sera un petit ajout
-- séparé une fois ce point vérifié.
--
-- Comme les autres scripts SQL de ce projet : à exécuter vous-même dans
-- Supabase → SQL Editor. Idempotent (peut être ré-exécuté sans erreur).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Table association_photos
-- ---------------------------------------------------------------------
create table if not exists public.association_photos (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  storage_path text not null,
  url text not null,
  legende text,
  ordre integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create index if not exists idx_association_photos_assoc on public.association_photos(association_id, ordre);

alter table public.association_photos enable row level security;

drop policy if exists "association_photos_select" on public.association_photos;
create policy "association_photos_select" on public.association_photos
  for select
  using (association_id = current_association_id());

drop policy if exists "association_photos_insert" on public.association_photos;
create policy "association_photos_insert" on public.association_photos
  for insert
  with check (association_id = current_association_id() and is_bureau());

drop policy if exists "association_photos_update" on public.association_photos;
create policy "association_photos_update" on public.association_photos
  for update
  using (association_id = current_association_id() and is_bureau());

drop policy if exists "association_photos_delete" on public.association_photos;
create policy "association_photos_delete" on public.association_photos
  for delete
  using (association_id = current_association_id() and is_bureau());

-- ---------------------------------------------------------------------
-- 2) Bucket de stockage "association-photos" (public — lecture directe
--    par URL publique, comme "avatars"/"posts-media"). Chemin utilisé par
--    l'application : "<association_id>/<horodatage>_<nom_fichier>",
--    même convention que le bucket "documents" — ce qui permet, contrairement
--    à "avatars", de scoper les écritures par association ci-dessous.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('association-photos', 'association-photos', true)
on conflict (id) do nothing;

drop policy if exists "association_photos_storage_select" on storage.objects;
create policy "association_photos_storage_select" on storage.objects
  for select
  using (bucket_id = 'association-photos');

drop policy if exists "association_photos_storage_insert" on storage.objects;
create policy "association_photos_storage_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'association-photos'
    and is_bureau()
    and (storage.foldername(name))[1] = current_association_id()::text
  );

drop policy if exists "association_photos_storage_delete" on storage.objects;
create policy "association_photos_storage_delete" on storage.objects
  for delete
  using (
    bucket_id = 'association-photos'
    and is_bureau()
    and (storage.foldername(name))[1] = current_association_id()::text
  );

-- Fin du script.
