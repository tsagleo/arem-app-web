-- =====================================================================
-- Fil d'actualité : messages vocaux + vidéos (publications ET commentaires)
-- =====================================================================
-- Suite 59 (2026-09-11), à la demande de l'utilisateur : « est-ce qu'il
-- est possible de faire un message vocal et également d'envoyer une
-- vidéo ? » Portée confirmée avec l'utilisateur (AskUserQuestion) :
-- message vocal (2 minutes maximum) et envoi de vidéo, disponibles sur
-- les publications ET les commentaires.
--
-- Les fichiers audio/vidéo sont nettement plus volumineux que les
-- images déjà prises en charge (suite 58) — plutôt que de les mêler au
-- bucket "avatars" (petits fichiers, aucune limite de taille définie),
-- ce script crée un bucket dédié "posts-media" avec une limite de
-- taille explicite (30 Mo par fichier) et une liste de types autorisés,
-- pour éviter qu'une association ne remplisse l'espace de stockage avec
-- de longues vidéos.
-- =====================================================================

-- ---------- 1) Colonnes vidéo/audio ----------
alter table public.posts
  add column if not exists video_url text,
  add column if not exists audio_url text,
  add column if not exists audio_duration integer;

comment on column public.posts.video_url is
  'URL publique (bucket "posts-media") de la vidéo jointe à la publication. Suite 59 (2026-09-11).';
comment on column public.posts.audio_url is
  'URL publique (bucket "posts-media") du message vocal joint à la publication (2 minutes maximum, appliqué côté application). Suite 59 (2026-09-11).';
comment on column public.posts.audio_duration is
  'Durée du message vocal en secondes (affichage uniquement).';

alter table public.post_comments
  add column if not exists video_url text,
  add column if not exists audio_url text,
  add column if not exists audio_duration integer;

comment on column public.post_comments.video_url is
  'URL publique (bucket "posts-media") de la vidéo jointe au commentaire. Suite 59 (2026-09-11).';
comment on column public.post_comments.audio_url is
  'URL publique (bucket "posts-media") du message vocal joint au commentaire. Suite 59 (2026-09-11).';
comment on column public.post_comments.audio_duration is
  'Durée du message vocal en secondes (affichage uniquement).';

-- ---------- 2) Bucket de stockage dédié "posts-media" ----------
-- 30 Mo par fichier (le message vocal est plafonné à 2 minutes côté
-- application, très en-dessous de cette limite ; la limite sert surtout
-- à borner la taille des vidéos).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'posts-media', 'posts-media', true, 31457280,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'video/webm', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = excluded.public;

drop policy if exists "posts media storage select" on storage.objects;
drop policy if exists "posts media storage insert" on storage.objects;
drop policy if exists "posts media storage delete" on storage.objects;

-- Chemin attendu : "<association_id>/..." (comme le bucket "avatars"
-- pour les images du fil, suite 58) — lecture et dépôt ouverts à tout
-- membre de l'association (cohérent avec l'ouverture de la publication
-- à tous en suite 58), suppression réservée au Bureau (modération).
create policy "posts media storage select" on storage.objects for select to authenticated
  using (
    bucket_id = 'posts-media'
    and (storage.foldername(name))[1] = public.current_association_id()::text
  );

create policy "posts media storage insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'posts-media'
    and (storage.foldername(name))[1] = public.current_association_id()::text
  );

create policy "posts media storage delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'posts-media'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and public.is_bureau()
  );
