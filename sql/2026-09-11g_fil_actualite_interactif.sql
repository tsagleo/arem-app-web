-- =====================================================================
-- Fil d'actualité interactif : ouvert à tous, images, commentaires,
-- réactions
-- =====================================================================
-- Suite 58 (2026-09-11), à la demande de l'utilisateur : « Dans le chat
-- de fil d'actualité, est-ce qu'il est possible de téléverser des images
-- un peu de style applications WhatsApp ?... est-ce qu'on peut faire en
-- sorte que ce soit interactif ? Est-ce que ce qu'ils disent peuvent
-- commenter la publication ? » Choix confirmés avec l'utilisateur
-- (AskUserQuestion) :
--   - Qui publie : TOUS les adhérents (pas seulement le Bureau comme
--     jusqu'ici).
--   - Interactivité : commentaires sous une publication + réactions
--     rapides (👍/❤️).
--   - Images : sur les publications ET sur les commentaires.
--
-- IMPORTANT — changement de modèle : jusqu'ici, seul le Bureau pouvait
-- publier dans le fil (`sql/2026-09-04e_multi_tenant_rls.sql`, policy
-- "posts insert" avec `is_bureau()`), même si la barre de saisie était
-- affichée à tout le monde côté interface — un adhérent qui tentait de
-- publier voyait son message échouer silencieusement (même défaut que
-- celui corrigé en suite 57 sur les Annonces). Ce script ouvre
-- réellement la publication à tous les membres de l'association, tout
-- en gardant une modération : chacun peut modifier/supprimer SES PROPRES
-- publications/commentaires, le Bureau garde le pouvoir de modérer
-- N'IMPORTE LEQUEL (comme avant). La programmation d'une publication à
-- une date future reste réservée au Bureau côté interface (pas une
-- restriction de ce script, qui ne touche pas à `date_publication`).
-- =====================================================================

-- ---------- 1) Image sur une publication ----------
alter table public.posts
  add column if not exists image_url text;

comment on column public.posts.image_url is
  'URL publique (bucket de stockage "avatars", dossier posts/<association_id>/...) de l''image jointe à la publication. NULL = pas d''image. Suite 58 (2026-09-11).';

-- ---------- 2) Ouverture de la publication à tous + modération ----------
drop policy if exists "posts insert" on public.posts;
create policy "posts insert" on public.posts for insert to authenticated
  with check (association_id = public.current_association_id());

drop policy if exists "posts update" on public.posts;
create policy "posts update" on public.posts for update to authenticated
  using (association_id = public.current_association_id() and (auteur_id = auth.uid() or public.is_bureau()))
  with check (association_id = public.current_association_id() and (auteur_id = auth.uid() or public.is_bureau()));

drop policy if exists "posts delete" on public.posts;
create policy "posts delete" on public.posts for delete to authenticated
  using (association_id = public.current_association_id() and (auteur_id = auth.uid() or public.is_bureau()));

-- La policy "posts select" (lecture) ne change pas : tous les membres de
-- l'association lisent déjà tout le fil.

-- ---------- 3) Commentaires ----------
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  auteur_id uuid references public.profiles(id),
  auteur_nom text,
  contenu text,
  image_url text,
  created_at timestamptz not null default now()
);

comment on table public.post_comments is
  'Commentaires sous une publication du fil d''actualité (Vie associative). Suite 58 (2026-09-11).';

create index if not exists post_comments_post_idx on public.post_comments (post_id);
create index if not exists post_comments_association_idx on public.post_comments (association_id);

alter table public.post_comments enable row level security;

drop policy if exists "post_comments select" on public.post_comments;
drop policy if exists "post_comments insert" on public.post_comments;
drop policy if exists "post_comments update" on public.post_comments;
drop policy if exists "post_comments delete" on public.post_comments;

create policy "post_comments select" on public.post_comments for select to authenticated
  using (association_id = public.current_association_id());
create policy "post_comments insert" on public.post_comments for insert to authenticated
  with check (association_id = public.current_association_id() and auteur_id = auth.uid());
create policy "post_comments update" on public.post_comments for update to authenticated
  using (association_id = public.current_association_id() and (auteur_id = auth.uid() or public.is_bureau()))
  with check (association_id = public.current_association_id() and (auteur_id = auth.uid() or public.is_bureau()));
create policy "post_comments delete" on public.post_comments for delete to authenticated
  using (association_id = public.current_association_id() and (auteur_id = auth.uid() or public.is_bureau()));

-- ---------- 4) Réactions rapides (👍/❤️) ----------
create table if not exists public.post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_profile_id uuid not null references public.profiles(id),
  emoji text not null check (emoji in ('👍', '❤️')),
  created_at timestamptz not null default now(),
  unique (post_id, member_profile_id)
);

comment on table public.post_reactions is
  'Réaction rapide (une seule par personne et par publication, l''emoji peut être changé) sur une publication du fil d''actualité. Suite 58 (2026-09-11).';

create index if not exists post_reactions_post_idx on public.post_reactions (post_id);

alter table public.post_reactions enable row level security;

drop policy if exists "post_reactions select" on public.post_reactions;
drop policy if exists "post_reactions insert" on public.post_reactions;
drop policy if exists "post_reactions update" on public.post_reactions;
drop policy if exists "post_reactions delete" on public.post_reactions;

create policy "post_reactions select" on public.post_reactions for select to authenticated
  using (association_id = public.current_association_id());
create policy "post_reactions insert" on public.post_reactions for insert to authenticated
  with check (association_id = public.current_association_id() and member_profile_id = auth.uid());
create policy "post_reactions update" on public.post_reactions for update to authenticated
  using (association_id = public.current_association_id() and member_profile_id = auth.uid())
  with check (association_id = public.current_association_id() and member_profile_id = auth.uid());
create policy "post_reactions delete" on public.post_reactions for delete to authenticated
  using (association_id = public.current_association_id() and member_profile_id = auth.uid());

-- ---------- 5) Stockage ----------
-- Réutilise le bucket "avatars" déjà en place (public, non cloisonné par
-- association — même choix que pour les annonces en suite 57), sous
-- "posts/<association_id>/..." pour les publications et
-- "posts/<association_id>/comments/..." pour les commentaires. Aucune
-- nouvelle politique de stockage nécessaire.
