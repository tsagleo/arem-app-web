-- =====================================================================
-- Vitrine publique (Phase 4, 2026-09-28)
-- =====================================================================
-- Construit tout en une fois (choix de l'utilisateur) : page publique de
-- présentation, calendrier public, formulaire de demande d'adhésion,
-- carte de membre numérique (QR). Rien de tout cela n'existait avant —
-- c'est la première zone de l'application accessible SANS connexion.
--
-- Choix de conception retenus avec l'utilisateur (AskUserQuestion) :
--   - Adresse publique : identifiant (« slug ») généré automatiquement à
--     partir du nom de l'association, modifiable ensuite dans
--     Configuration. Distinct de `code_invitation` (qui doit rester
--     semi-privé — l'exposer dans une URL publique permettrait de
--     rejoindre l'association sans validation du bureau).
--   - Suivi d'une demande d'adhésion approuvée : configurable par
--     association (`adhesion_notif_auto`) — courriel automatique avec le
--     code d'invitation, OU le bureau le transmet lui-même. Les deux
--     partagent la même mécanique ; seul le déclenchement du courriel en
--     dépend.
--   - Carte de membre (QR) : statut minimal (nom, photo, actif/inactif),
--     jamais de numéro d'adhérent ni d'autre donnée personnelle. Le QR
--     encode un jeton opaque (`members.verification_token`), jamais
--     l'identifiant réel du membre — impossible d'énumérer les membres.
--
-- Sécurité : aucune table existante n'est ouverte en lecture publique
-- (une politique RLS s'applique à TOUTE la ligne, colonnes sensibles
-- incluses). Ce script crée à la place des VUES qui ne projettent que
-- les colonnes sûres, et une fonction de vérification à sens unique
-- (par jeton, jamais listable) pour la carte de membre — même logique
-- de séparation que le reste de l'application, adaptée à un accès sans
-- authentification.
--
-- Patron de notification par courriel : identique aux 9 scripts
-- existants depuis la suite 33 (extension pg_net, secret Vault
-- `resend_api_key`, expéditeur `onboarding@resend.dev`, fonctions
-- SECURITY DEFINER avec `search_path = ''` + préfixe `public.` partout
-- — leçon retenue de la suite 42 où l'absence de ce préfixe avait cassé
-- `log_activity()`). Les littéraux de texte utilisent la notation
-- `$texte$...$texte$` (dollar-quoting) plutôt que des guillemets simples
-- échappés — élimine complètement le risque d'apostrophe mal doublée
-- rencontré en suite 90.
--
-- Ce script est conçu pour être exécuté plusieurs fois sans risque
-- (`create or replace`, `add column if not exists`, `create table if
-- not exists`, `drop trigger if exists` avant chaque `create trigger`).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Nouvelles colonnes
-- ---------------------------------------------------------------------
alter table public.associations
  add column if not exists slug_public text unique,
  add column if not exists vitrine_active boolean not null default false,
  add column if not exists adhesion_notif_auto boolean not null default true;

comment on column public.associations.slug_public is
  'Identifiant unique utilisé dans l''adresse de la vitrine publique (ex. ?pub=arem). Généré automatiquement à la première activation, modifiable ensuite dans Configuration.';
comment on column public.associations.vitrine_active is
  'Active ou désactive la vitrine publique (page de présentation, calendrier, formulaire d''adhésion, carte de membre) pour cette association.';
comment on column public.associations.adhesion_notif_auto is
  'true = un courriel avec le code d''invitation part automatiquement dès qu''une demande d''adhésion publique est approuvée. false = le bureau transmet le code lui-même.';

alter table public.members
  add column if not exists verification_token uuid not null default gen_random_uuid() unique;

comment on column public.members.verification_token is
  'Jeton opaque encodé dans le QR code de la carte de membre numérique. Volontairement distinct de members.id : ne permet de vérifier qu''UN membre à la fois (par ce jeton précis), jamais de lister l''ensemble des membres.';

-- ---------------------------------------------------------------------
-- 2) Génération de l'identifiant public (slug)
-- ---------------------------------------------------------------------
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select trim(both '-' from
    regexp_replace(
      lower(
        translate(
          coalesce(p_text, ''),
          'àâäáãåèéêëìíîïòóôõöùúûüçñÀÂÄÁÃÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑ',
          'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN'
        )
      ),
      '[^a-z0-9]+', '-', 'g'
    )
  )
$fn$;

create or replace function public.activate_public_vitrine()
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_association_id uuid := public.current_association_id();
  v_nom text;
  v_existing_slug text;
  v_base_slug text;
  v_slug text;
  v_suffix int := 1;
begin
  if v_association_id is null or not public.is_bureau() then
    raise exception 'Non autorisé.';
  end if;

  update public.associations set vitrine_active = true where id = v_association_id;

  select nom, slug_public into v_nom, v_existing_slug
  from public.associations where id = v_association_id;

  if v_existing_slug is not null then
    return v_existing_slug;
  end if;

  v_base_slug := public.slugify(v_nom);
  if v_base_slug is null or v_base_slug = '' then v_base_slug := 'association'; end if;
  v_slug := v_base_slug;

  while exists (select 1 from public.associations where slug_public = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  end loop;

  update public.associations set slug_public = v_slug where id = v_association_id;
  return v_slug;
end;
$fn$;

comment on function public.activate_public_vitrine() is
  'Active la vitrine publique de l''association du bureau appelant, et lui attribue un slug_public unique si elle n''en a pas encore (dérivé du nom, avec suffixe numérique en cas de collision). Réservé au bureau (is_bureau()).';

-- ---------------------------------------------------------------------
-- 3) Demandes d'adhésion publiques
-- ---------------------------------------------------------------------
create table if not exists public.membership_requests (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  nom text not null,
  courriel text not null,
  telephone text,
  message text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'approuve', 'rejete')),
  created_at timestamptz not null default now(),
  traite_par uuid references public.profiles(id),
  traite_le timestamptz
);

comment on table public.membership_requests is
  'Demandes d''adhésion soumises depuis la page publique (sans compte). Le bureau approuve ou rejette depuis « Gestion des accès » ; approuver ne crée pas de compte automatiquement, ça reste une demande que le bureau traite (voir associations.adhesion_notif_auto pour le courriel de suivi).';

alter table public.membership_requests enable row level security;

drop policy if exists "membership_requests insert public" on public.membership_requests;
create policy "membership_requests insert public" on public.membership_requests
  for insert to anon, authenticated
  with check (
    exists (select 1 from public.associations a where a.id = association_id and a.vitrine_active = true)
  );

drop policy if exists "membership_requests select bureau" on public.membership_requests;
create policy "membership_requests select bureau" on public.membership_requests
  for select to authenticated
  using (public.is_staff() and association_id = public.current_association_id());

drop policy if exists "membership_requests update bureau" on public.membership_requests;
create policy "membership_requests update bureau" on public.membership_requests
  for update to authenticated
  using (public.is_staff() and association_id = public.current_association_id());

-- Notification au président dès qu'une demande arrive (même patron que
-- trg_notify_member_link_request, suite 38) — sans quoi le bureau ne
-- saurait qu'une demande publique est arrivée qu'en pensant à consulter
-- l'application.
create or replace function public.notify_membership_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_president_email text;
  v_asso_nom text;
  v_api_key text;
  v_html text;
begin
  select u.email into v_president_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.association_id = new.association_id and p.role = 'bureau_president'
  limit 1;

  if v_president_email is null then
    return new;
  end if;

  select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'resend_api_key';
  if v_api_key is null then
    return new;
  end if;

  select nom into v_asso_nom from public.associations where id = new.association_id;

  v_html := $html$<p>Une nouvelle demande d'adhésion a été soumise depuis la page publique de $html$
    || coalesce(v_asso_nom, 'l''association')
    || $html$.</p><p><strong>Nom :</strong> $html$ || new.nom
    || $html$<br><strong>Courriel :</strong> $html$ || new.courriel
    || $html$<br><strong>Téléphone :</strong> $html$ || coalesce(new.telephone, '—')
    || $html$<br><strong>Message :</strong> $html$ || coalesce(new.message, '—')
    || $html$</p><p>Consultez l'onglet « Gestion des accès » pour l'approuver ou la rejeter.</p>$html$;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'AREM <onboarding@resend.dev>',
      'to', array[v_president_email],
      'subject', $texte$Nouvelle demande d'adhésion en attente$texte$,
      'html', v_html
    )
  );
  return new;
end;
$fn$;

drop trigger if exists trg_notify_membership_request on public.membership_requests;
create trigger trg_notify_membership_request
  after insert on public.membership_requests
  for each row execute function public.notify_membership_request();

-- Résolution d'une demande (approuver/rejeter), appelée depuis « Gestion
-- des accès ». Envoie le courriel de suivi avec le code d'invitation
-- uniquement si approuvée ET associations.adhesion_notif_auto = true.
create or replace function public.resolve_membership_request(p_request_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_req record;
  v_association record;
  v_api_key text;
  v_html text;
begin
  select * into v_req from public.membership_requests where id = p_request_id;
  if v_req is null then
    raise exception 'Demande introuvable.';
  end if;
  if not public.is_staff() or v_req.association_id <> public.current_association_id() then
    raise exception 'Non autorisé.';
  end if;
  if p_action not in ('approuver', 'rejeter') then
    raise exception 'Action invalide.';
  end if;
  if v_req.statut <> 'en_attente' then
    raise exception 'Cette demande a déjà été traitée.';
  end if;

  update public.membership_requests
    set statut = case when p_action = 'approuver' then 'approuve' else 'rejete' end,
        traite_par = auth.uid(),
        traite_le = now()
    where id = p_request_id;

  if p_action = 'approuver' then
    select * into v_association from public.associations where id = v_req.association_id;

    if coalesce(v_association.adhesion_notif_auto, true) then
      select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'resend_api_key';
      if v_api_key is not null then
        v_html := $html$<p>Bonjour $html$ || v_req.nom
          || $html$,</p><p>Votre demande d'adhésion à $html$ || coalesce(v_association.nom, 'l''association')
          || $html$ a été approuvée.</p><p>Utilisez le code d'invitation suivant pour créer votre compte depuis l'écran de connexion (« Rejoindre avec un code ») :</p><p style="font-size:20px;font-weight:700;letter-spacing:2px;">$html$
          || coalesce(v_association.code_invitation, '')
          || $html$</p>$html$;

        perform net.http_post(
          url := 'https://api.resend.com/emails',
          headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
          body := jsonb_build_object(
            'from', 'AREM <onboarding@resend.dev>',
            'to', array[v_req.courriel],
            'subject', $texte$Votre demande d'adhésion a été approuvée$texte$,
            'html', v_html
          )
        );
      end if;
    end if;
  end if;
end;
$fn$;

comment on function public.resolve_membership_request(uuid, text) is
  'Approuve ou rejette une demande d''adhésion publique. Réservé au bureau de l''association concernée (is_staff() + association_id = current_association_id()). En approbation, envoie un courriel avec le code d''invitation uniquement si associations.adhesion_notif_auto = true.';

-- ---------------------------------------------------------------------
-- 4) Vues publiques (colonnes sûres uniquement — jamais la ligne
-- complète d'une table existante)
-- ---------------------------------------------------------------------
create or replace view public.public_association_profile as
select
  a.id as association_id,
  a.slug_public,
  a.nom,
  a.devise_texte,
  a.devise_monetaire,
  a.logo_url,
  gi.vision,
  gi.mission,
  gi.valeurs
from public.associations a
left join public.governance_info gi on gi.association_id = a.id
where a.vitrine_active = true and a.slug_public is not null;

create or replace view public.public_board_members as
select
  a.slug_public,
  m.nom,
  m.photo_url,
  bm.poste,
  bm.mandat_debut,
  bm.mandat_fin
from public.board_members bm
join public.associations a on a.id = bm.association_id
join public.members m on m.id = bm.member_id
where a.vitrine_active = true
  and a.slug_public is not null
  and (bm.mandat_fin is null or bm.mandat_fin >= current_date);

create or replace view public.public_events as
select
  a.slug_public,
  e.id,
  e.titre,
  e.description,
  e.lieu,
  e.date_debut,
  e.prix
from public.events e
join public.associations a on a.id = e.association_id
where a.vitrine_active = true
  and a.slug_public is not null
  and e.date_debut >= now();

grant select on public.public_association_profile to anon, authenticated;
grant select on public.public_board_members to anon, authenticated;
grant select on public.public_events to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) Vérification de la carte de membre (par jeton, jamais listable)
-- ---------------------------------------------------------------------
create or replace function public.verify_member_card(p_token uuid)
returns table(nom text, photo_url text, actif boolean, association_nom text)
language sql
security definer
stable
set search_path = ''
as $fn$
  select m.nom, m.photo_url, (m.statut = 'Actif') as actif, a.nom as association_nom
  from public.members m
  join public.associations a on a.id = m.association_id
  where m.verification_token = p_token and a.vitrine_active = true
  limit 1;
$fn$;

comment on function public.verify_member_card(uuid) is
  'Vérification à sens unique d''une carte de membre par son jeton (jamais par members.id) : ne retourne qu''un statut minimal (nom, photo, actif/inactif). Impossible d''énumérer les membres avec cette fonction.';

grant execute on function public.verify_member_card(uuid) to anon, authenticated;
