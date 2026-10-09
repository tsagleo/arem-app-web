-- =====================================================================
-- Jeunesse & tutorat — « Unia Campus » (2026-10-09)
-- =====================================================================
-- Nouvelle rubrique Premium (id de module : « jeunesse ») :
--   • bibliothèque de ressources (PDF, vidéos, liens) classées par
--     catégorie, niveau scolaire et matière ;
--   • profils étudiants (jeunes rattachés à un parent / tuteur membre, ou
--     membres eux-mêmes) et mentors bénévoles approuvés par le bureau ;
--   • jumelages mentor ↔ étudiant validés par le bureau, séances de
--     tutorat (visio Jitsi ou en personne), suivi de progression ;
--   • bourses / prix d'excellence : candidatures puis attribution par un
--     jury, ou par tirage au sort vérifiable (rubrique « Tirages »).
--
-- PROTECTION DES MINEURS — imposée par la base, pas seulement par l'écran
-- ---------------------------------------------------------------------
-- Les associations visées accueillent des enfants et des adolescents. Les
-- règles ci-dessous suivent l'esprit de la Loi 25 au Québec (Loi modernisant
-- des dispositions législatives en matière de protection des renseignements
-- personnels : consentement du titulaire de l'autorité parentale pour un
-- mineur de moins de 14 ans, minimisation, finalité déclarée, droit de
-- retrait), de la LPRPDE fédérale et des lois équivalentes des autres
-- provinces (ex. N.-B.), ainsi que les bonnes pratiques des organismes
-- jeunesse (règle des « deux adultes », vérification des antécédents) :
--
--  1. CONSENTEMENT PARENTAL OBLIGATOIRE. Un étudiant mineur doit être
--     rattaché à un parent / tuteur membre de l'association. Tant que ce
--     parent n'a pas donné son consentement (date + identité du parent +
--     mode : en ligne par le parent lui-même, ou formulaire papier saisi par
--     le bureau), AUCUNE activité n'est possible : ni jumelage, ni séance,
--     ni message, ni candidature. Des déclencheurs (triggers) le vérifient
--     à chaque écriture, quelle que soit la façon dont elle arrive. Le
--     parent peut retirer son consentement à tout moment : les jumelages
--     en cours sont alors suspendus automatiquement.
--
--  2. PAS D'ÉCHANGE PRIVÉ ADULTE ↔ MINEUR. Il n'existe pas de messagerie
--     privée dans ce module : tout échange passe par le fil d'un jumelage,
--     lisible par le mentor, l'étudiant, SON PARENT et les responsables
--     jeunesse / le bureau. Les messages ne peuvent être ni modifiés ni
--     supprimés (aucune politique UPDATE/DELETE) : traçabilité complète.
--     Les séances en personne avec un mineur exigent un lieu déclaré.
--
--  3. MENTORS APPROUVÉS UNIQUEMENT. Un membre se propose comme mentor ; il
--     ne peut être jumelé, planifier une séance ou écrire qu'une fois
--     approuvé par le bureau (avec mention de la vérification des
--     antécédents et de l'engagement signé). Une suspension coupe l'accès
--     immédiatement (déclencheurs).
--
--  4. DONNÉES MINIMALES SUR LES MINEURS. On ne stocke que le prénom,
--     l'INITIALE du nom, le niveau scolaire, les matières et un court
--     besoin facultatif : pas de date de naissance, pas d'école, pas de
--     photo, pas d'adresse ni de téléphone (on joint le parent). Les
--     profils étudiants ne sont lisibles que par le parent, l'étudiant
--     lui-même s'il est membre, ses mentors jumelés et les responsables.
--     Dans un tirage de bourse, seul « Prénom I. » apparaît.
--
-- Toute écriture passe par des fonctions security definer (aucune
-- politique INSERT/UPDATE/DELETE sur les tables, sauf lecture) ; chaque
-- fonction vérifie l'association et le rôle. Le journal d'activité trace
-- les changements, sauf le CONTENU des messages (vie privée).
-- Ré-exécutable sans risque.
-- =====================================================================

-- Prérequis : la rubrique Tirages (sql/2026-10-08r à 08t) doit déjà être
-- installée — les bourses peuvent être attribuées par tirage au sort.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------

-- Responsables jeunesse : profils désignés par le bureau (en plus du
-- bureau lui-même) pour encadrer la rubrique et relire les échanges.
create table if not exists public.jeunesse_responsables (
  association_id uuid not null references public.associations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  designe_par uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (association_id, profile_id)
);
comment on table public.jeunesse_responsables is
  'Responsables jeunesse désignés par le bureau : encadrent les jumelages et peuvent relire tous les échanges impliquant des jeunes.';

create table if not exists public.jeunesse_etudiants (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,          -- l'étudiant est lui-même membre (souvent majeur)
  parent_member_id uuid references public.members(id) on delete set null,   -- parent / tuteur (obligatoire pour un mineur)
  prenom text not null check (length(trim(prenom)) between 1 and 60),
  initiale_nom text check (initiale_nom is null or length(initiale_nom) <= 2),
  mineur boolean not null default true,
  niveau text not null check (niveau in ('primaire', 'secondaire', 'cegep', 'universite')),
  matieres text[] not null default '{}',
  besoin text check (besoin is null or length(besoin) <= 500),
  consentement_le timestamptz,
  consentement_parent_id uuid references public.members(id) on delete set null,
  consentement_mode text check (consentement_mode in ('en_ligne', 'papier')),
  consentement_saisi_par uuid references public.profiles(id) on delete set null,
  consentement_retire_le timestamptz,
  statut text not null default 'actif' check (statut in ('actif', 'archive')),
  cree_par uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint jeunesse_etudiants_mineur_parent check (not mineur or parent_member_id is not null),
  constraint jeunesse_etudiants_rattachement check (member_id is not null or parent_member_id is not null)
);
comment on table public.jeunesse_etudiants is
  'Profils étudiants. Données volontairement minimales (prénom, initiale, niveau, matières) — aucune date de naissance, école, photo ni coordonnée pour un mineur. Écriture uniquement via les fonctions jeunesse_*.';
comment on column public.jeunesse_etudiants.consentement_le is
  'Date du consentement parental. NULL = aucune activité possible pour un mineur (vérifié par déclencheurs).';
create index if not exists jeunesse_etudiants_assoc_idx on public.jeunesse_etudiants (association_id);
create index if not exists jeunesse_etudiants_parent_idx on public.jeunesse_etudiants (parent_member_id);

create table if not exists public.jeunesse_mentors (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  nom text not null,
  matieres text[] not null default '{}',
  niveaux text[] not null default '{}',
  presentation text check (presentation is null or length(presentation) <= 800),
  engagement_signe boolean not null default false,       -- code de conduite accepté par le mentor
  verification_antecedents boolean not null default false, -- vérifiée par le bureau avant approbation
  statut text not null default 'en_attente' check (statut in ('en_attente', 'approuve', 'suspendu', 'refuse')),
  statue_par uuid references public.profiles(id) on delete set null,
  statue_le timestamptz,
  motif text,
  created_at timestamptz not null default now(),
  unique (association_id, member_id)
);
comment on table public.jeunesse_mentors is
  'Mentors bénévoles. Seuls les mentors au statut « approuve » peuvent être jumelés, planifier des séances, écrire ou déposer des ressources.';

create table if not exists public.jeunesse_ressources (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  titre text not null check (length(trim(titre)) between 1 and 200),
  description text,
  type text not null check (type in ('pdf', 'video', 'lien', 'document')),
  categorie text not null check (categorie in ('cours', 'remise_niveau', 'developpement_personnel', 'orientation')),
  niveau text not null check (niveau in ('primaire', 'secondaire', 'cegep', 'universite', 'tous')),
  matiere text,
  url text,              -- lien externe (vidéo YouTube, site, etc.)
  storage_path text,     -- fichier dans le bucket « jeunesse-ressources »
  depose_par uuid references public.profiles(id) on delete set null,
  depose_par_nom text,
  created_at timestamptz not null default now(),
  constraint jeunesse_ressources_source check (url is not null or storage_path is not null)
);
create index if not exists jeunesse_ressources_assoc_idx on public.jeunesse_ressources (association_id, created_at desc);

create table if not exists public.jeunesse_jumelages (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  etudiant_id uuid not null references public.jeunesse_etudiants(id) on delete cascade,
  mentor_id uuid not null references public.jeunesse_mentors(id) on delete cascade,
  matiere text not null,
  objectifs text check (objectifs is null or length(objectifs) <= 1000),
  statut text not null default 'propose' check (statut in ('propose', 'actif', 'suspendu', 'termine', 'refuse')),
  propose_par uuid references public.profiles(id) on delete set null,
  valide_par uuid references public.profiles(id) on delete set null,
  valide_le timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists jeunesse_jumelages_assoc_idx on public.jeunesse_jumelages (association_id);
create index if not exists jeunesse_jumelages_etudiant_idx on public.jeunesse_jumelages (etudiant_id);
create index if not exists jeunesse_jumelages_mentor_idx on public.jeunesse_jumelages (mentor_id);

create table if not exists public.jeunesse_seances (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  jumelage_id uuid not null references public.jeunesse_jumelages(id) on delete cascade,
  debut timestamptz not null,
  duree_min int not null default 60 check (duree_min between 15 and 240),
  mode text not null check (mode in ('distance', 'presentiel')),
  lien_visio text,
  lieu text,
  statut text not null default 'prevue' check (statut in ('prevue', 'realisee', 'annulee')),
  compte_rendu text check (compte_rendu is null or length(compte_rendu) <= 2000),
  progression int check (progression between 1 and 5),
  cree_par uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint jeunesse_seances_mode check (
    (mode = 'distance' and lien_visio is not null) or (mode = 'presentiel' and coalesce(trim(lieu), '') <> '')
  )
);
create index if not exists jeunesse_seances_jumelage_idx on public.jeunesse_seances (jumelage_id, debut);

-- Fil d'un jumelage : messages ET points de progression. Jamais modifié
-- ni supprimé ; visible du parent et des responsables (voir en-tête).
create table if not exists public.jeunesse_messages (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  jumelage_id uuid not null references public.jeunesse_jumelages(id) on delete cascade,
  auteur_id uuid references public.profiles(id) on delete set null,
  auteur_nom text,
  auteur_role text,          -- 'mentor' | 'parent' | 'etudiant' | 'responsable'
  type text not null default 'message' check (type in ('message', 'progression')),
  contenu text not null check (length(trim(contenu)) between 1 and 2000),
  note_progression int check (note_progression between 1 and 5),
  created_at timestamptz not null default now()
);
create index if not exists jeunesse_messages_jumelage_idx on public.jeunesse_messages (jumelage_id, created_at);

create table if not exists public.jeunesse_bourses (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  titre text not null check (length(trim(titre)) between 1 and 200),
  description text,
  criteres text,
  montant numeric(12, 2),
  nb_laureats int not null default 1 check (nb_laureats >= 1),
  niveau text check (niveau in ('primaire', 'secondaire', 'cegep', 'universite', 'tous')),
  mode text not null default 'jury' check (mode in ('jury', 'tirage')),
  date_limite date,
  statut text not null default 'ouverte' check (statut in ('ouverte', 'fermee', 'attribuee', 'annulee')),
  tirage_id uuid references public.tirages(id) on delete set null,
  cree_par uuid references public.profiles(id) on delete set null,
  attribuee_le timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.jeunesse_candidatures (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  bourse_id uuid not null references public.jeunesse_bourses(id) on delete cascade,
  etudiant_id uuid not null references public.jeunesse_etudiants(id) on delete cascade,
  motivation text check (motivation is null or length(motivation) <= 3000),
  statut text not null default 'deposee' check (statut in ('deposee', 'retenue', 'laureat', 'non_retenue', 'retiree')),
  note_jury numeric(4, 1),
  commentaire_jury text,
  deposee_par uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bourse_id, etudiant_id)
);

-- ---------------------------------------------------------------------
-- 2) Fonctions d'aide (droits)
-- ---------------------------------------------------------------------
create or replace function public.jeunesse_est_responsable() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select public.is_bureau() or exists (
    select 1 from public.jeunesse_responsables r
     where r.association_id = public.current_association_id() and r.profile_id = auth.uid()
  )
$fn$;

-- Mentor approuvé correspondant au membre connecté (NULL sinon).
create or replace function public.jeunesse_mon_mentor_id() returns uuid
language sql stable security definer set search_path = '' as $fn$
  select m.id from public.jeunesse_mentors m
   where m.association_id = public.current_association_id()
     and m.member_id = public.current_member_id() and m.statut = 'approuve'
$fn$;

-- Le membre connecté est-il le parent ou l'étudiant lui-même ?
create or replace function public.jeunesse_est_famille(p_etudiant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.jeunesse_etudiants e
     where e.id = p_etudiant_id and public.current_member_id() is not null
       and (e.parent_member_id = public.current_member_id() or e.member_id = public.current_member_id())
  )
$fn$;

-- Le membre connecté est-il mentor (jumelage en cours) de cet étudiant ?
create or replace function public.jeunesse_est_mentor_de(p_etudiant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.jeunesse_jumelages j
      join public.jeunesse_mentors m on m.id = j.mentor_id
     where j.etudiant_id = p_etudiant_id and j.statut in ('propose', 'actif', 'suspendu')
       and m.member_id = public.current_member_id()
  )
$fn$;

-- Accès à un jumelage : mentor, famille, responsables.
create or replace function public.jeunesse_acces_jumelage(p_jumelage_id uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.jeunesse_jumelages j
      join public.jeunesse_mentors m on m.id = j.mentor_id
     where j.id = p_jumelage_id and j.association_id = public.current_association_id()
       and (public.jeunesse_est_responsable()
            or m.member_id = public.current_member_id()
            or public.jeunesse_est_famille(j.etudiant_id))
  )
$fn$;

-- RÈGLE CENTRALE : un mineur sans consentement parental valide ne peut
-- avoir aucune activité. Appelée par les déclencheurs ci-dessous.
create or replace function public.jeunesse_verifier_cadre(p_etudiant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_e public.jeunesse_etudiants;
begin
  select * into v_e from public.jeunesse_etudiants where id = p_etudiant_id;
  if v_e.id is null then raise exception 'Étudiant introuvable.'; end if;
  if v_e.statut <> 'actif' then raise exception 'Ce profil étudiant est archivé.'; end if;
  if v_e.mineur and (v_e.consentement_le is null or v_e.consentement_parent_id is null) then
    raise exception 'Consentement parental requis : aucune activité n''est possible pour un mineur tant que son parent ou tuteur n''a pas donné son accord.';
  end if;
end;
$fn$;

create or replace function public.jeunesse_verifier_mentor(p_mentor_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not exists (select 1 from public.jeunesse_mentors where id = p_mentor_id and statut = 'approuve') then
    raise exception 'Seuls les mentors approuvés par le bureau peuvent intervenir.';
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 3) Déclencheurs de protection (s'appliquent à TOUTE écriture)
-- ---------------------------------------------------------------------
create or replace function public.jeunesse_trg_jumelage() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  -- Un jumelage refusé, terminé ou suspendu peut toujours être clôturé.
  if new.statut in ('propose', 'actif') then
    perform public.jeunesse_verifier_cadre(new.etudiant_id);
    perform public.jeunesse_verifier_mentor(new.mentor_id);
  end if;
  return new;
end;
$fn$;

create or replace function public.jeunesse_trg_seance() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_j public.jeunesse_jumelages;
begin
  select * into v_j from public.jeunesse_jumelages where id = new.jumelage_id;
  if new.statut = 'annulee' then return new; end if;
  if v_j.statut <> 'actif' then raise exception 'Le jumelage doit être validé (actif) par le bureau.'; end if;
  perform public.jeunesse_verifier_cadre(v_j.etudiant_id);
  perform public.jeunesse_verifier_mentor(v_j.mentor_id);
  return new;
end;
$fn$;

create or replace function public.jeunesse_trg_message() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_j public.jeunesse_jumelages;
begin
  select * into v_j from public.jeunesse_jumelages where id = new.jumelage_id;
  -- Les responsables peuvent toujours écrire (ex. expliquer une suspension).
  if new.auteur_role = 'responsable' then return new; end if;
  if v_j.statut <> 'actif' then raise exception 'Les échanges ne sont possibles que dans un jumelage actif.'; end if;
  perform public.jeunesse_verifier_cadre(v_j.etudiant_id);
  if new.auteur_role = 'mentor' then perform public.jeunesse_verifier_mentor(v_j.mentor_id); end if;
  return new;
end;
$fn$;

create or replace function public.jeunesse_trg_candidature() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'INSERT' then perform public.jeunesse_verifier_cadre(new.etudiant_id); end if;
  return new;
end;
$fn$;

drop trigger if exists trg_jeunesse_jumelage_cadre on public.jeunesse_jumelages;
create trigger trg_jeunesse_jumelage_cadre before insert or update on public.jeunesse_jumelages
for each row execute function public.jeunesse_trg_jumelage();

drop trigger if exists trg_jeunesse_seance_cadre on public.jeunesse_seances;
create trigger trg_jeunesse_seance_cadre before insert or update on public.jeunesse_seances
for each row execute function public.jeunesse_trg_seance();

drop trigger if exists trg_jeunesse_message_cadre on public.jeunesse_messages;
create trigger trg_jeunesse_message_cadre before insert on public.jeunesse_messages
for each row execute function public.jeunesse_trg_message();

drop trigger if exists trg_jeunesse_candidature_cadre on public.jeunesse_candidatures;
create trigger trg_jeunesse_candidature_cadre before insert on public.jeunesse_candidatures
for each row execute function public.jeunesse_trg_candidature();

-- ---------------------------------------------------------------------
-- 4) Lecture (RLS) — aucune politique d'écriture : tout passe par les
--    fonctions de la section 5.
-- ---------------------------------------------------------------------
alter table public.jeunesse_responsables enable row level security;
alter table public.jeunesse_etudiants enable row level security;
alter table public.jeunesse_mentors enable row level security;
alter table public.jeunesse_ressources enable row level security;
alter table public.jeunesse_jumelages enable row level security;
alter table public.jeunesse_seances enable row level security;
alter table public.jeunesse_messages enable row level security;
alter table public.jeunesse_bourses enable row level security;
alter table public.jeunesse_candidatures enable row level security;

drop policy if exists "jeunesse_responsables select" on public.jeunesse_responsables;
create policy "jeunesse_responsables select" on public.jeunesse_responsables for select to authenticated
  using (association_id = public.current_association_id());

-- Profils étudiants : famille, mentors jumelés, responsables. Les autres
-- membres n'y ont pas accès.
drop policy if exists "jeunesse_etudiants select" on public.jeunesse_etudiants;
create policy "jeunesse_etudiants select" on public.jeunesse_etudiants for select to authenticated
  using (
    association_id = public.current_association_id()
    and (
      public.jeunesse_est_responsable()
      or parent_member_id = public.current_member_id()
      or member_id = public.current_member_id()
      or public.jeunesse_est_mentor_de(id)
    )
  );

-- Mentors : les mentors approuvés sont visibles de tous les membres (pour
-- que les familles sachent qui peut aider) ; les candidatures en attente
-- seulement par l'intéressé et les responsables.
drop policy if exists "jeunesse_mentors select" on public.jeunesse_mentors;
create policy "jeunesse_mentors select" on public.jeunesse_mentors for select to authenticated
  using (
    association_id = public.current_association_id()
    and (statut = 'approuve' or member_id = public.current_member_id() or public.jeunesse_est_responsable())
  );

drop policy if exists "jeunesse_ressources select" on public.jeunesse_ressources;
create policy "jeunesse_ressources select" on public.jeunesse_ressources for select to authenticated
  using (association_id = public.current_association_id());

drop policy if exists "jeunesse_jumelages select" on public.jeunesse_jumelages;
create policy "jeunesse_jumelages select" on public.jeunesse_jumelages for select to authenticated
  using (association_id = public.current_association_id() and public.jeunesse_acces_jumelage(id));

drop policy if exists "jeunesse_seances select" on public.jeunesse_seances;
create policy "jeunesse_seances select" on public.jeunesse_seances for select to authenticated
  using (association_id = public.current_association_id() and public.jeunesse_acces_jumelage(jumelage_id));

drop policy if exists "jeunesse_messages select" on public.jeunesse_messages;
create policy "jeunesse_messages select" on public.jeunesse_messages for select to authenticated
  using (association_id = public.current_association_id() and public.jeunesse_acces_jumelage(jumelage_id));

drop policy if exists "jeunesse_bourses select" on public.jeunesse_bourses;
create policy "jeunesse_bourses select" on public.jeunesse_bourses for select to authenticated
  using (association_id = public.current_association_id());

drop policy if exists "jeunesse_candidatures select" on public.jeunesse_candidatures;
create policy "jeunesse_candidatures select" on public.jeunesse_candidatures for select to authenticated
  using (
    association_id = public.current_association_id()
    and (public.jeunesse_est_responsable() or public.jeunesse_est_famille(etudiant_id))
  );

-- ---------------------------------------------------------------------
-- 5) Fonctions d'écriture
-- ---------------------------------------------------------------------

-- 5.1 Responsables jeunesse (bureau seulement)
create or replace function public.jeunesse_definir_responsable(p_profile_id uuid, p_actif boolean) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
begin
  if v_assoc is null or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and association_id = v_assoc) then
    raise exception 'Profil inconnu dans cette association.';
  end if;
  if p_actif then
    insert into public.jeunesse_responsables (association_id, profile_id, designe_par)
    values (v_assoc, p_profile_id, auth.uid()) on conflict do nothing;
  else
    delete from public.jeunesse_responsables where association_id = v_assoc and profile_id = p_profile_id;
  end if;
end;
$fn$;

-- 5.2 Profils étudiants
-- Création / modification par le parent (pour son enfant), par l'étudiant
-- membre (pour lui-même) ou par un responsable. Un parent ne peut
-- rattacher un enfant qu'à LUI-MÊME. Modifier un profil ne touche jamais
-- au consentement (fonctions dédiées plus bas).
create or replace function public.jeunesse_enregistrer_etudiant(
  p_id uuid, p_prenom text, p_initiale_nom text, p_mineur boolean, p_niveau text,
  p_matieres text[], p_besoin text, p_parent_member_id uuid, p_member_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_moi uuid := public.current_member_id();
  v_resp boolean := public.jeunesse_est_responsable();
  v_parent uuid := p_parent_member_id;
  v_membre uuid := p_member_id;
  v_id uuid;
begin
  if v_assoc is null then raise exception 'Non autorisé.'; end if;
  if not v_resp then
    -- Non-responsable : soit parent (de son propre enfant), soit soi-même.
    if p_mineur then v_parent := v_moi; v_membre := null;
    elsif v_membre is distinct from v_moi then v_parent := v_moi; v_membre := null;
    end if;
    if v_moi is null then raise exception 'Votre compte doit être lié à une fiche membre.'; end if;
  end if;
  if p_mineur and v_parent is null then raise exception 'Un mineur doit être rattaché à un parent ou tuteur membre.'; end if;
  if v_parent is not null and not exists (select 1 from public.members where id = v_parent and association_id = v_assoc) then
    raise exception 'Parent inconnu dans cette association.';
  end if;
  if v_membre is not null and not exists (select 1 from public.members where id = v_membre and association_id = v_assoc) then
    raise exception 'Membre inconnu dans cette association.';
  end if;

  if p_id is null then
    insert into public.jeunesse_etudiants (association_id, member_id, parent_member_id, prenom, initiale_nom, mineur, niveau, matieres, besoin, cree_par)
    values (v_assoc, v_membre, v_parent, trim(p_prenom), nullif(upper(left(trim(coalesce(p_initiale_nom, '')), 1)), ''),
            coalesce(p_mineur, true), p_niveau, coalesce(p_matieres, '{}'), nullif(trim(coalesce(p_besoin, '')), ''), auth.uid())
    returning id into v_id;
  else
    if not (v_resp or public.jeunesse_est_famille(p_id)) then raise exception 'Non autorisé.'; end if;
    update public.jeunesse_etudiants e
       set prenom = trim(p_prenom),
           initiale_nom = nullif(upper(left(trim(coalesce(p_initiale_nom, '')), 1)), ''),
           niveau = p_niveau, matieres = coalesce(p_matieres, '{}'),
           besoin = nullif(trim(coalesce(p_besoin, '')), ''),
           -- Changer le rattachement ou le statut mineur = responsables seulement ;
           -- passer de majeur à mineur efface tout consentement antérieur.
           mineur = case when v_resp then coalesce(p_mineur, e.mineur) else e.mineur end,
           parent_member_id = case when v_resp then v_parent else e.parent_member_id end,
           member_id = case when v_resp then v_membre else e.member_id end,
           consentement_le = case when v_resp and v_parent is distinct from e.parent_member_id then null else e.consentement_le end,
           consentement_parent_id = case when v_resp and v_parent is distinct from e.parent_member_id then null else e.consentement_parent_id end
     where e.id = p_id and e.association_id = v_assoc
    returning id into v_id;
    if v_id is null then raise exception 'Profil introuvable.'; end if;
  end if;
  return v_id;
end;
$fn$;

-- Consentement : donné en ligne par LE parent lui-même, ou saisi par un
-- responsable d'après un formulaire papier signé (mode « papier »).
create or replace function public.jeunesse_donner_consentement(p_etudiant_id uuid, p_mode text default 'en_ligne') returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_e public.jeunesse_etudiants;
begin
  select * into v_e from public.jeunesse_etudiants where id = p_etudiant_id and association_id = public.current_association_id() for update;
  if v_e.id is null then raise exception 'Profil introuvable.'; end if;
  if v_e.parent_member_id is null then raise exception 'Aucun parent rattaché à ce profil.'; end if;
  if p_mode = 'en_ligne' then
    if v_e.parent_member_id is distinct from public.current_member_id() then
      raise exception 'Seul le parent ou tuteur rattaché peut donner son consentement en ligne.';
    end if;
  elsif p_mode = 'papier' then
    if not public.jeunesse_est_responsable() then raise exception 'Non autorisé.'; end if;
  else
    raise exception 'Mode de consentement invalide.';
  end if;
  update public.jeunesse_etudiants
     set consentement_le = now(), consentement_parent_id = v_e.parent_member_id,
         consentement_mode = p_mode, consentement_saisi_par = auth.uid(), consentement_retire_le = null
   where id = p_etudiant_id;
end;
$fn$;

-- Retrait du consentement (parent ou responsable) : toute activité
-- s'arrête, les jumelages en cours sont suspendus.
create or replace function public.jeunesse_retirer_consentement(p_etudiant_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_e public.jeunesse_etudiants;
begin
  select * into v_e from public.jeunesse_etudiants where id = p_etudiant_id and association_id = public.current_association_id() for update;
  if v_e.id is null then raise exception 'Profil introuvable.'; end if;
  if not (public.jeunesse_est_responsable() or v_e.parent_member_id = public.current_member_id()) then
    raise exception 'Non autorisé.';
  end if;
  update public.jeunesse_etudiants
     set consentement_le = null, consentement_parent_id = null, consentement_mode = null, consentement_retire_le = now()
   where id = p_etudiant_id;
  update public.jeunesse_jumelages set statut = 'suspendu' where etudiant_id = p_etudiant_id and statut in ('propose', 'actif');
  update public.jeunesse_seances s set statut = 'annulee'
    from public.jeunesse_jumelages j
   where s.jumelage_id = j.id and j.etudiant_id = p_etudiant_id and s.statut = 'prevue';
end;
$fn$;

-- Archivage (fin de participation) : famille ou responsable. Les données
-- ne sont pas effacées tout de suite (traçabilité des échanges) ; la
-- suppression définitive se demande au bureau.
create or replace function public.jeunesse_archiver_etudiant(p_etudiant_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  if not (public.jeunesse_est_responsable() or public.jeunesse_est_famille(p_etudiant_id)) then raise exception 'Non autorisé.'; end if;
  update public.jeunesse_jumelages set statut = 'termine'
   where etudiant_id = p_etudiant_id and statut in ('propose', 'actif', 'suspendu');
  update public.jeunesse_etudiants set statut = 'archive'
   where id = p_etudiant_id and association_id = public.current_association_id();
end;
$fn$;

-- 5.3 Mentors
create or replace function public.jeunesse_proposer_mentor(
  p_matieres text[], p_niveaux text[], p_presentation text, p_engagement boolean
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_moi uuid := public.current_member_id();
  v_nom text;
  v_id uuid;
begin
  if v_assoc is null or v_moi is null then raise exception 'Votre compte doit être lié à une fiche membre.'; end if;
  if not coalesce(p_engagement, false) then raise exception 'Vous devez accepter le code de conduite des mentors.'; end if;
  select nom into v_nom from public.members where id = v_moi;
  insert into public.jeunesse_mentors as jm (association_id, member_id, nom, matieres, niveaux, presentation, engagement_signe)
  values (v_assoc, v_moi, coalesce(v_nom, '—'), coalesce(p_matieres, '{}'), coalesce(p_niveaux, '{}'), nullif(trim(coalesce(p_presentation, '')), ''), true)
  on conflict (association_id, member_id) do update
     set matieres = excluded.matieres, niveaux = excluded.niveaux, presentation = excluded.presentation,
         engagement_signe = true,
         -- Un mentor refusé qui se repropose repasse en attente ; un mentor
         -- suspendu reste suspendu (décision du bureau).
         statut = case when jm.statut = 'refuse' then 'en_attente' else jm.statut end
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.jeunesse_statuer_mentor(
  p_mentor_id uuid, p_statut text, p_verification boolean, p_motif text default null
) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  if not public.is_bureau() then raise exception 'Seul le bureau approuve les mentors.'; end if;
  if p_statut not in ('approuve', 'suspendu', 'refuse', 'en_attente') then raise exception 'Statut invalide.'; end if;
  if p_statut = 'approuve' and not coalesce(p_verification, false) then
    raise exception 'Confirmez la vérification des antécédents avant d''approuver un mentor.';
  end if;
  update public.jeunesse_mentors
     set statut = p_statut, verification_antecedents = coalesce(p_verification, verification_antecedents),
         statue_par = auth.uid(), statue_le = now(), motif = nullif(trim(coalesce(p_motif, '')), '')
   where id = p_mentor_id and association_id = public.current_association_id();
  if not found then raise exception 'Mentor introuvable.'; end if;
  -- Un mentor suspendu ou refusé perd immédiatement ses jumelages.
  if p_statut in ('suspendu', 'refuse') then
    update public.jeunesse_jumelages set statut = 'suspendu' where mentor_id = p_mentor_id and statut in ('propose', 'actif');
  end if;
end;
$fn$;

-- 5.4 Jumelages
-- Proposé par une famille, un mentor approuvé ou un responsable ; validé
-- (activé) uniquement par le bureau ou un responsable jeunesse.
create or replace function public.jeunesse_proposer_jumelage(
  p_etudiant_id uuid, p_mentor_id uuid, p_matiere text, p_objectifs text
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_id uuid;
begin
  if v_assoc is null then raise exception 'Non autorisé.'; end if;
  if not exists (select 1 from public.jeunesse_etudiants where id = p_etudiant_id and association_id = v_assoc) then raise exception 'Étudiant introuvable.'; end if;
  if not exists (select 1 from public.jeunesse_mentors where id = p_mentor_id and association_id = v_assoc) then raise exception 'Mentor introuvable.'; end if;
  if not (public.jeunesse_est_responsable() or public.jeunesse_est_famille(p_etudiant_id) or public.jeunesse_mon_mentor_id() = p_mentor_id) then
    raise exception 'Non autorisé.';
  end if;
  if exists (select 1 from public.jeunesse_jumelages where etudiant_id = p_etudiant_id and mentor_id = p_mentor_id and statut in ('propose', 'actif')) then
    raise exception 'Un jumelage existe déjà entre cet étudiant et ce mentor.';
  end if;
  insert into public.jeunesse_jumelages (association_id, etudiant_id, mentor_id, matiere, objectifs, propose_par)
  values (v_assoc, p_etudiant_id, p_mentor_id, coalesce(nullif(trim(p_matiere), ''), '—'), nullif(trim(coalesce(p_objectifs, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.jeunesse_statuer_jumelage(p_jumelage_id uuid, p_statut text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_j public.jeunesse_jumelages;
  v_resp boolean := public.jeunesse_est_responsable();
begin
  select * into v_j from public.jeunesse_jumelages where id = p_jumelage_id and association_id = public.current_association_id() for update;
  if v_j.id is null then raise exception 'Jumelage introuvable.'; end if;
  if p_statut not in ('actif', 'suspendu', 'termine', 'refuse') then raise exception 'Statut invalide.'; end if;
  -- Valider ou réactiver : responsables seulement. Terminer : aussi la
  -- famille ou le mentor (chacun peut mettre fin au suivi).
  if p_statut in ('actif', 'suspendu', 'refuse') and not v_resp then raise exception 'Seul le bureau ou un responsable jeunesse valide les jumelages.'; end if;
  if p_statut = 'termine' and not (v_resp or public.jeunesse_est_famille(v_j.etudiant_id) or public.jeunesse_mon_mentor_id() = v_j.mentor_id) then
    raise exception 'Non autorisé.';
  end if;
  update public.jeunesse_jumelages
     set statut = p_statut,
         valide_par = case when p_statut = 'actif' then auth.uid() else valide_par end,
         valide_le = case when p_statut = 'actif' then now() else valide_le end
   where id = p_jumelage_id;
  if p_statut <> 'actif' then
    update public.jeunesse_seances set statut = 'annulee' where jumelage_id = p_jumelage_id and statut = 'prevue';
  end if;
end;
$fn$;

-- 5.5 Séances
create or replace function public.jeunesse_planifier_seance(
  p_jumelage_id uuid, p_debut timestamptz, p_duree_min int, p_mode text, p_lien_visio text, p_lieu text
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_j public.jeunesse_jumelages;
  v_id uuid;
begin
  select * into v_j from public.jeunesse_jumelages where id = p_jumelage_id and association_id = public.current_association_id();
  if v_j.id is null then raise exception 'Jumelage introuvable.'; end if;
  if not (public.jeunesse_est_responsable() or public.jeunesse_mon_mentor_id() = v_j.mentor_id) then
    raise exception 'Seuls le mentor jumelé et les responsables planifient les séances.';
  end if;
  insert into public.jeunesse_seances (association_id, jumelage_id, debut, duree_min, mode, lien_visio, lieu, cree_par)
  values (v_j.association_id, p_jumelage_id, p_debut, coalesce(p_duree_min, 60), p_mode,
          case when p_mode = 'distance' then nullif(trim(coalesce(p_lien_visio, '')), '') end,
          case when p_mode = 'presentiel' then nullif(trim(coalesce(p_lieu, '')), '') end,
          auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.jeunesse_cloturer_seance(
  p_seance_id uuid, p_statut text, p_compte_rendu text, p_progression int
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_s public.jeunesse_seances;
  v_j public.jeunesse_jumelages;
begin
  select * into v_s from public.jeunesse_seances where id = p_seance_id and association_id = public.current_association_id() for update;
  if v_s.id is null then raise exception 'Séance introuvable.'; end if;
  select * into v_j from public.jeunesse_jumelages where id = v_s.jumelage_id;
  if p_statut not in ('realisee', 'annulee') then raise exception 'Statut invalide.'; end if;
  -- Annuler : mentor, famille ou responsable. Compte rendu : mentor ou responsable.
  if not (public.jeunesse_est_responsable() or public.jeunesse_mon_mentor_id() = v_j.mentor_id
          or (p_statut = 'annulee' and public.jeunesse_est_famille(v_j.etudiant_id))) then
    raise exception 'Non autorisé.';
  end if;
  update public.jeunesse_seances
     set statut = p_statut,
         compte_rendu = case when p_statut = 'realisee' then nullif(trim(coalesce(p_compte_rendu, '')), '') else compte_rendu end,
         progression = case when p_statut = 'realisee' then p_progression else progression end
   where id = p_seance_id;
end;
$fn$;

-- 5.6 Fil du jumelage (messages / progression)
create or replace function public.jeunesse_ecrire(
  p_jumelage_id uuid, p_contenu text, p_type text default 'message', p_note int default null
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_j public.jeunesse_jumelages;
  v_role text;
  v_nom text;
  v_id uuid;
begin
  select * into v_j from public.jeunesse_jumelages where id = p_jumelage_id and association_id = public.current_association_id();
  if v_j.id is null then raise exception 'Jumelage introuvable.'; end if;
  if public.jeunesse_mon_mentor_id() = v_j.mentor_id then v_role := 'mentor';
  elsif exists (select 1 from public.jeunesse_etudiants e where e.id = v_j.etudiant_id and e.parent_member_id = public.current_member_id()) then v_role := 'parent';
  elsif exists (select 1 from public.jeunesse_etudiants e where e.id = v_j.etudiant_id and e.member_id = public.current_member_id()) then v_role := 'etudiant';
  elsif public.jeunesse_est_responsable() then v_role := 'responsable';
  else raise exception 'Non autorisé.';
  end if;
  if p_type = 'progression' and v_role not in ('mentor', 'responsable') then
    raise exception 'Seul le mentor (ou un responsable) note la progression.';
  end if;
  select nom_complet into v_nom from public.profiles where id = auth.uid();
  insert into public.jeunesse_messages (association_id, jumelage_id, auteur_id, auteur_nom, auteur_role, type, contenu, note_progression)
  values (v_j.association_id, p_jumelage_id, auth.uid(), v_nom, v_role,
          case when p_type = 'progression' then 'progression' else 'message' end, trim(p_contenu),
          case when p_type = 'progression' then p_note end)
  returning id into v_id;
  return v_id;
end;
$fn$;

-- 5.7 Ressources (bureau / responsables et mentors approuvés)
create or replace function public.jeunesse_ajouter_ressource(
  p_titre text, p_description text, p_type text, p_categorie text, p_niveau text,
  p_matiere text, p_url text, p_storage_path text
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_nom text;
  v_id uuid;
begin
  if v_assoc is null or not (public.jeunesse_est_responsable() or public.jeunesse_mon_mentor_id() is not null) then
    raise exception 'Seuls le bureau et les mentors approuvés déposent des ressources.';
  end if;
  if p_storage_path is not null and split_part(p_storage_path, '/', 1) <> v_assoc::text then
    raise exception 'Chemin de fichier invalide.';
  end if;
  select nom_complet into v_nom from public.profiles where id = auth.uid();
  insert into public.jeunesse_ressources (association_id, titre, description, type, categorie, niveau, matiere, url, storage_path, depose_par, depose_par_nom)
  values (v_assoc, trim(p_titre), nullif(trim(coalesce(p_description, '')), ''), p_type, p_categorie, p_niveau,
          nullif(trim(coalesce(p_matiere, '')), ''), nullif(trim(coalesce(p_url, '')), ''), p_storage_path, auth.uid(), v_nom)
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.jeunesse_supprimer_ressource(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $fn$
declare
  v_r public.jeunesse_ressources;
begin
  select * into v_r from public.jeunesse_ressources where id = p_id and association_id = public.current_association_id();
  if v_r.id is null then raise exception 'Ressource introuvable.'; end if;
  if not (public.jeunesse_est_responsable() or v_r.depose_par = auth.uid()) then raise exception 'Non autorisé.'; end if;
  delete from public.jeunesse_ressources where id = p_id;
  return v_r.storage_path;  -- l'application supprime ensuite le fichier
end;
$fn$;

-- 5.8 Bourses et prix
create or replace function public.jeunesse_creer_bourse(
  p_titre text, p_description text, p_criteres text, p_montant numeric, p_nb_laureats int,
  p_niveau text, p_mode text, p_date_limite date
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_id uuid;
begin
  if not public.jeunesse_est_responsable() then raise exception 'Non autorisé.'; end if;
  insert into public.jeunesse_bourses (association_id, titre, description, criteres, montant, nb_laureats, niveau, mode, date_limite, cree_par)
  values (public.current_association_id(), trim(p_titre), nullif(trim(coalesce(p_description, '')), ''), nullif(trim(coalesce(p_criteres, '')), ''),
          p_montant, greatest(coalesce(p_nb_laureats, 1), 1), coalesce(p_niveau, 'tous'), p_mode, p_date_limite, auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.jeunesse_statuer_bourse(p_bourse_id uuid, p_statut text) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  if not public.jeunesse_est_responsable() then raise exception 'Non autorisé.'; end if;
  if p_statut not in ('ouverte', 'fermee', 'annulee') then raise exception 'Statut invalide.'; end if;
  update public.jeunesse_bourses set statut = p_statut
   where id = p_bourse_id and association_id = public.current_association_id() and statut <> 'attribuee';
  if not found then raise exception 'Bourse introuvable ou déjà attribuée.'; end if;
end;
$fn$;

-- Candidature : déposée par la famille (parent pour un mineur) ou un
-- responsable. Le déclencheur vérifie le consentement parental.
create or replace function public.jeunesse_candidater(p_bourse_id uuid, p_etudiant_id uuid, p_motivation text) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_b public.jeunesse_bourses;
  v_id uuid;
begin
  select * into v_b from public.jeunesse_bourses where id = p_bourse_id and association_id = public.current_association_id();
  if v_b.id is null then raise exception 'Bourse introuvable.'; end if;
  if v_b.statut <> 'ouverte' or (v_b.date_limite is not null and v_b.date_limite < (now() at time zone 'America/Moncton')::date) then
    raise exception 'Les candidatures sont closes.';
  end if;
  if not (public.jeunesse_est_famille(p_etudiant_id) or public.jeunesse_est_responsable()) then raise exception 'Non autorisé.'; end if;
  insert into public.jeunesse_candidatures (association_id, bourse_id, etudiant_id, motivation, deposee_par)
  values (v_b.association_id, p_bourse_id, p_etudiant_id, nullif(trim(coalesce(p_motivation, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.jeunesse_retirer_candidature(p_candidature_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_c public.jeunesse_candidatures;
begin
  select * into v_c from public.jeunesse_candidatures where id = p_candidature_id and association_id = public.current_association_id();
  if v_c.id is null then raise exception 'Candidature introuvable.'; end if;
  if not (public.jeunesse_est_famille(v_c.etudiant_id) or public.jeunesse_est_responsable()) then raise exception 'Non autorisé.'; end if;
  update public.jeunesse_candidatures set statut = 'retiree' where id = p_candidature_id and statut in ('deposee', 'retenue');
end;
$fn$;

-- Évaluation par le jury (bureau + responsables jeunesse).
create or replace function public.jeunesse_evaluer_candidature(
  p_candidature_id uuid, p_note numeric, p_commentaire text, p_retenue boolean
) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  if not public.jeunesse_est_responsable() then raise exception 'Seul le jury évalue les candidatures.'; end if;
  update public.jeunesse_candidatures
     set note_jury = p_note, commentaire_jury = nullif(trim(coalesce(p_commentaire, '')), ''),
         statut = case when p_retenue then 'retenue' else 'deposee' end
   where id = p_candidature_id and association_id = public.current_association_id() and statut in ('deposee', 'retenue');
end;
$fn$;

-- Attribution par le jury : les candidatures choisies deviennent lauréates.
create or replace function public.jeunesse_attribuer_jury(p_bourse_id uuid, p_candidature_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_b public.jeunesse_bourses;
begin
  if not public.jeunesse_est_responsable() then raise exception 'Non autorisé.'; end if;
  select * into v_b from public.jeunesse_bourses where id = p_bourse_id and association_id = public.current_association_id() for update;
  if v_b.id is null or v_b.statut in ('attribuee', 'annulee') then raise exception 'Bourse introuvable ou déjà attribuée.'; end if;
  if coalesce(array_length(p_candidature_ids, 1), 0) = 0 then raise exception 'Choisissez au moins un lauréat.'; end if;
  if array_length(p_candidature_ids, 1) > v_b.nb_laureats then raise exception 'Trop de lauréats pour cette bourse.'; end if;
  update public.jeunesse_candidatures
     set statut = case when id = any(p_candidature_ids) then 'laureat' else 'non_retenue' end
   where bourse_id = p_bourse_id and statut in ('deposee', 'retenue');
  update public.jeunesse_bourses set statut = 'attribuee', attribuee_le = now() where id = p_bourse_id;
end;
$fn$;

-- Attribution par TIRAGE AU SORT vérifiable : prépare un tirage « libre »
-- dans la rubrique Tirages (même mécanisme engagement / révélation que
-- preparer_tirage, 2026-10-08r). Les participants sont les candidatures
-- (clé = id de candidature, nom = « Prénom I. » seulement). Le bureau le
-- lance ensuite en direct depuis la rubrique Tirages, puis applique le
-- résultat ici.
create or replace function public.jeunesse_preparer_tirage_bourse(p_bourse_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_b public.jeunesse_bourses;
  v_participants jsonb;
  v_nb int;
  v_graine text;
  v_id uuid;
  v_nom text;
begin
  if not public.is_bureau() then raise exception 'Seul le bureau prépare un tirage.'; end if;
  select * into v_b from public.jeunesse_bourses where id = p_bourse_id and association_id = public.current_association_id() for update;
  if v_b.id is null or v_b.statut in ('attribuee', 'annulee') then raise exception 'Bourse introuvable ou déjà attribuée.'; end if;
  if v_b.tirage_id is not null and exists (select 1 from public.tirages where id = v_b.tirage_id and statut <> 'annule') then
    raise exception 'Un tirage est déjà préparé pour cette bourse (rubrique Tirages au sort).';
  end if;

  select jsonb_agg(jsonb_build_object('member_id', c.id, 'nom', e.prenom || coalesce(' ' || e.initiale_nom || '.', ''), 'photo_url', null) order by e.prenom), count(*)
    into v_participants, v_nb
    from public.jeunesse_candidatures c
    join public.jeunesse_etudiants e on e.id = c.etudiant_id
   where c.bourse_id = p_bourse_id and c.statut in ('deposee', 'retenue');
  if coalesce(v_nb, 0) < 2 then raise exception 'Il faut au moins deux candidatures pour un tirage.'; end if;

  v_graine := encode(extensions.gen_random_bytes(32), 'hex');
  select nom_complet into v_nom from public.profiles where id = auth.uid();
  insert into public.tirages (association_id, titre, type, nb_gagnants, participants, engagement, cree_par, cree_par_nom)
  values (v_b.association_id, 'Bourse : ' || v_b.titre, 'libre', least(v_b.nb_laureats, v_nb),
          v_participants, encode(extensions.digest(v_graine, 'sha256'), 'hex'), auth.uid(), v_nom)
  returning id into v_id;
  insert into public.tirages_secrets (tirage_id, graine) values (v_id, v_graine);

  update public.jeunesse_bourses set tirage_id = v_id, statut = 'fermee' where id = p_bourse_id;
  return v_id;
end;
$fn$;

create or replace function public.jeunesse_appliquer_tirage_bourse(p_bourse_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_b public.jeunesse_bourses;
  v_t public.tirages;
  v_gagnants uuid[];
begin
  if not public.jeunesse_est_responsable() then raise exception 'Non autorisé.'; end if;
  select * into v_b from public.jeunesse_bourses where id = p_bourse_id and association_id = public.current_association_id() for update;
  if v_b.id is null or v_b.statut = 'attribuee' then raise exception 'Bourse introuvable ou déjà attribuée.'; end if;
  select * into v_t from public.tirages where id = v_b.tirage_id;
  if v_t.id is null or v_t.statut <> 'termine' then raise exception 'Le tirage n''est pas encore terminé.'; end if;
  select array_agg((r->>'member_id')::uuid) into v_gagnants
    from jsonb_array_elements(v_t.resultat) r
   where (r->>'position')::int <= v_t.nb_gagnants;
  update public.jeunesse_candidatures
     set statut = case when id = any(v_gagnants) then 'laureat' else 'non_retenue' end
   where bourse_id = p_bourse_id and statut in ('deposee', 'retenue');
  update public.jeunesse_bourses set statut = 'attribuee', attribuee_le = now() where id = p_bourse_id;
end;
$fn$;

-- Fonctions internes : pas d'appel direct depuis l'application.
revoke all on function public.jeunesse_verifier_cadre(uuid) from public, anon, authenticated;
revoke all on function public.jeunesse_verifier_mentor(uuid) from public, anon, authenticated;
revoke all on function public.jeunesse_trg_jumelage() from public, anon, authenticated;
revoke all on function public.jeunesse_trg_seance() from public, anon, authenticated;
revoke all on function public.jeunesse_trg_message() from public, anon, authenticated;
revoke all on function public.jeunesse_trg_candidature() from public, anon, authenticated;

grant execute on function public.jeunesse_est_responsable() to authenticated;
grant execute on function public.jeunesse_mon_mentor_id() to authenticated;
grant execute on function public.jeunesse_est_famille(uuid) to authenticated;
grant execute on function public.jeunesse_est_mentor_de(uuid) to authenticated;
grant execute on function public.jeunesse_acces_jumelage(uuid) to authenticated;
grant execute on function public.jeunesse_definir_responsable(uuid, boolean) to authenticated;
grant execute on function public.jeunesse_enregistrer_etudiant(uuid, text, text, boolean, text, text[], text, uuid, uuid) to authenticated;
grant execute on function public.jeunesse_donner_consentement(uuid, text) to authenticated;
grant execute on function public.jeunesse_retirer_consentement(uuid) to authenticated;
grant execute on function public.jeunesse_archiver_etudiant(uuid) to authenticated;
grant execute on function public.jeunesse_proposer_mentor(text[], text[], text, boolean) to authenticated;
grant execute on function public.jeunesse_statuer_mentor(uuid, text, boolean, text) to authenticated;
grant execute on function public.jeunesse_proposer_jumelage(uuid, uuid, text, text) to authenticated;
grant execute on function public.jeunesse_statuer_jumelage(uuid, text) to authenticated;
grant execute on function public.jeunesse_planifier_seance(uuid, timestamptz, int, text, text, text) to authenticated;
grant execute on function public.jeunesse_cloturer_seance(uuid, text, text, int) to authenticated;
grant execute on function public.jeunesse_ecrire(uuid, text, text, int) to authenticated;
grant execute on function public.jeunesse_ajouter_ressource(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.jeunesse_supprimer_ressource(uuid) to authenticated;
grant execute on function public.jeunesse_creer_bourse(text, text, text, numeric, int, text, text, date) to authenticated;
grant execute on function public.jeunesse_statuer_bourse(uuid, text) to authenticated;
grant execute on function public.jeunesse_candidater(uuid, uuid, text) to authenticated;
grant execute on function public.jeunesse_retirer_candidature(uuid) to authenticated;
grant execute on function public.jeunesse_evaluer_candidature(uuid, numeric, text, boolean) to authenticated;
grant execute on function public.jeunesse_attribuer_jury(uuid, uuid[]) to authenticated;
grant execute on function public.jeunesse_preparer_tirage_bourse(uuid) to authenticated;
grant execute on function public.jeunesse_appliquer_tirage_bourse(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Stockage des ressources : bucket privé « jeunesse-ressources »
--    Chemin : "<association_id>/<horodatage>_<nom_fichier>".
--    Lecture : membres de l'association ; dépôt : bureau / responsables
--    jeunesse / mentors approuvés ; suppression : responsables ou auteur.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('jeunesse-ressources', 'jeunesse-ressources', false)
on conflict (id) do nothing;

drop policy if exists "jeunesse ressources storage select" on storage.objects;
drop policy if exists "jeunesse ressources storage insert" on storage.objects;
drop policy if exists "jeunesse ressources storage delete" on storage.objects;

create policy "jeunesse ressources storage select" on storage.objects for select to authenticated
  using (
    bucket_id = 'jeunesse-ressources'
    and (storage.foldername(name))[1] = public.current_association_id()::text
  );

create policy "jeunesse ressources storage insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'jeunesse-ressources'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and (public.jeunesse_est_responsable() or public.jeunesse_mon_mentor_id() is not null)
  );

create policy "jeunesse ressources storage delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'jeunesse-ressources'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and (public.jeunesse_est_responsable() or owner = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 7) Journal d'activité (sauf le contenu des messages : vie privée)
-- ---------------------------------------------------------------------
drop trigger if exists trg_log_jeunesse_etudiants on public.jeunesse_etudiants;
create trigger trg_log_jeunesse_etudiants after insert or update or delete on public.jeunesse_etudiants
for each row execute function public.log_activity();

drop trigger if exists trg_log_jeunesse_mentors on public.jeunesse_mentors;
create trigger trg_log_jeunesse_mentors after insert or update or delete on public.jeunesse_mentors
for each row execute function public.log_activity();

drop trigger if exists trg_log_jeunesse_jumelages on public.jeunesse_jumelages;
create trigger trg_log_jeunesse_jumelages after insert or update of statut on public.jeunesse_jumelages
for each row execute function public.log_activity();

drop trigger if exists trg_log_jeunesse_seances on public.jeunesse_seances;
create trigger trg_log_jeunesse_seances after insert or update of statut on public.jeunesse_seances
for each row execute function public.log_activity();

drop trigger if exists trg_log_jeunesse_ressources on public.jeunesse_ressources;
create trigger trg_log_jeunesse_ressources after insert or delete on public.jeunesse_ressources
for each row execute function public.log_activity();

drop trigger if exists trg_log_jeunesse_bourses on public.jeunesse_bourses;
create trigger trg_log_jeunesse_bourses after insert or update of statut on public.jeunesse_bourses
for each row execute function public.log_activity();

drop trigger if exists trg_log_jeunesse_candidatures on public.jeunesse_candidatures;
create trigger trg_log_jeunesse_candidatures after insert or update of statut on public.jeunesse_candidatures
for each row execute function public.log_activity();

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) : 9 tables, le bucket, et un test de la
-- règle de consentement (doit échouer avec « Consentement parental requis »
-- pour un mineur sans consentement).
-- ---------------------------------------------------------------------
-- select tablename from pg_tables where schemaname = 'public' and tablename like 'jeunesse_%';
-- select id from storage.buckets where id = 'jeunesse-ressources';
