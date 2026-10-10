-- =====================================================================
-- Carrefour du savoir (2026-10-10, demandé par l'utilisateur)
-- =====================================================================
-- Prolonge « Jeunesse & tutorat » (sql/2026-10-09f) en un carrefour
-- éducatif ouvert à TOUS les membres — élèves, étudiants, universitaires,
-- travailleurs, parents, aînés, nouveaux arrivants :
--   1. Ressources par domaine (académique, professionnel, développement
--      personnel, vie pratique) et par public ; ressources externes
--      sélectionnées ; propositions des membres validées par les
--      gestionnaires ; favoris et historique de consultation.
--   2. Parcours guidés (étapes ordonnées, progression, certificat).
--   3. Boîte à questions par domaine (réponses, solution, modération).
--   4. Classes (animateur, inscriptions, séances, présences, avis,
--      attestations).
--   5. Mentorat professionnel entre adultes (cadre plus léger que pour
--      les mineurs, qui restent dans Jeunesse & tutorat).
--   6. Évaluation des séances de tutorat par la famille, rappels
--      automatiques la veille des séances (tutorat et classes).
-- Gestionnaires = bureau + responsables jeunesse
-- (public.jeunesse_est_responsable()).
-- Prérequis : sql/2026-10-09f_jeunesse_tutorat.sql.
-- Ré-exécutable sans risque.
-- =====================================================================

create or replace function public.savoir_gestionnaire() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select public.jeunesse_est_responsable()
$fn$;

-- ---------------------------------------------------------------------
-- 1) Ressources
-- ---------------------------------------------------------------------
create table if not exists public.savoir_ressources (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  titre text not null check (length(trim(titre)) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  domaine text not null check (domaine in ('academique', 'professionnel', 'personnel', 'vie_pratique')),
  theme text,
  publics text[] not null default '{tous}',
  type text not null check (type in ('pdf', 'video', 'lien', 'document', 'podcast', 'outil')),
  url text,
  storage_path text,
  externe boolean not null default false,
  langue text not null default 'fr',
  statut text not null default 'publiee' check (statut in ('publiee', 'proposee', 'refusee')),
  depose_par uuid references public.profiles(id) on delete set null,
  depose_par_nom text,
  created_at timestamptz not null default now(),
  constraint savoir_ressources_source check (url is not null or storage_path is not null)
);
create index if not exists savoir_ressources_assoc_idx on public.savoir_ressources (association_id, created_at desc);

create table if not exists public.savoir_favoris (
  association_id uuid not null references public.associations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  ressource_id uuid not null references public.savoir_ressources(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, ressource_id)
);

create table if not exists public.savoir_consultations (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  ressource_id uuid not null references public.savoir_ressources(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists savoir_consultations_res_idx on public.savoir_consultations (ressource_id);
create index if not exists savoir_consultations_profile_idx on public.savoir_consultations (profile_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2) Parcours guidés
-- ---------------------------------------------------------------------
create table if not exists public.savoir_parcours (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  titre text not null check (length(trim(titre)) between 1 and 200),
  description text,
  domaine text not null check (domaine in ('academique', 'professionnel', 'personnel', 'vie_pratique')),
  publics text[] not null default '{tous}',
  niveau text not null default 'debutant' check (niveau in ('debutant', 'intermediaire', 'avance')),
  duree_estimee text,
  statut text not null default 'publie' check (statut in ('brouillon', 'publie', 'archive')),
  cree_par uuid references public.profiles(id) on delete set null,
  cree_par_nom text,
  created_at timestamptz not null default now()
);

create table if not exists public.savoir_parcours_etapes (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  parcours_id uuid not null references public.savoir_parcours(id) on delete cascade,
  ordre int not null default 1,
  titre text not null check (length(trim(titre)) between 1 and 200),
  consigne text,
  ressource_id uuid references public.savoir_ressources(id) on delete set null,
  url text
);
create index if not exists savoir_etapes_parcours_idx on public.savoir_parcours_etapes (parcours_id, ordre);

create table if not exists public.savoir_progressions (
  association_id uuid not null references public.associations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  parcours_id uuid not null references public.savoir_parcours(id) on delete cascade,
  etape_id uuid not null references public.savoir_parcours_etapes(id) on delete cascade,
  fait_le timestamptz not null default now(),
  primary key (profile_id, etape_id)
);

-- ---------------------------------------------------------------------
-- 3) Boîte à questions
-- ---------------------------------------------------------------------
create table if not exists public.savoir_questions (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  domaine text not null check (domaine in ('academique', 'professionnel', 'personnel', 'vie_pratique')),
  titre text not null check (length(trim(titre)) between 1 and 200),
  corps text check (corps is null or length(corps) <= 3000),
  auteur_id uuid references public.profiles(id) on delete set null,
  auteur_nom text,
  resolue boolean not null default false,
  masquee boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.savoir_reponses (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  question_id uuid not null references public.savoir_questions(id) on delete cascade,
  corps text not null check (length(trim(corps)) between 1 and 3000),
  auteur_id uuid references public.profiles(id) on delete set null,
  auteur_nom text,
  est_solution boolean not null default false,
  masquee boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists savoir_reponses_q_idx on public.savoir_reponses (question_id, created_at);

-- ---------------------------------------------------------------------
-- 4) Classes
-- ---------------------------------------------------------------------
create table if not exists public.savoir_classes (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  titre text not null check (length(trim(titre)) between 1 and 200),
  description text,
  domaine text not null check (domaine in ('academique', 'professionnel', 'personnel', 'vie_pratique')),
  publics text[] not null default '{tous}',
  niveau text not null default 'debutant' check (niveau in ('debutant', 'intermediaire', 'avance')),
  animateur_id uuid references public.profiles(id) on delete set null,
  animateur_nom text,
  capacite int check (capacite is null or capacite > 0),
  mode text not null default 'distance' check (mode in ('distance', 'presentiel', 'hybride')),
  lieu text,
  lien_visio text,
  statut text not null default 'proposee' check (statut in ('proposee', 'ouverte', 'terminee', 'annulee', 'refusee')),
  cree_par uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.savoir_classe_seances (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  classe_id uuid not null references public.savoir_classes(id) on delete cascade,
  debut timestamptz not null,
  duree_min int not null default 60 check (duree_min between 15 and 480),
  sujet text,
  statut text not null default 'prevue' check (statut in ('prevue', 'realisee', 'annulee')),
  rappel_envoye boolean not null default false
);
create index if not exists savoir_seances_classe_idx on public.savoir_classe_seances (classe_id, debut);
create table if not exists public.savoir_inscriptions (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  classe_id uuid not null references public.savoir_classes(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  nom text,
  statut text not null default 'inscrit' check (statut in ('inscrit', 'retire')),
  created_at timestamptz not null default now(),
  unique (classe_id, profile_id)
);
create table if not exists public.savoir_presences (
  association_id uuid not null references public.associations(id) on delete cascade,
  seance_id uuid not null references public.savoir_classe_seances(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  present boolean not null default true,
  primary key (seance_id, profile_id)
);
create table if not exists public.savoir_avis (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  classe_id uuid not null references public.savoir_classes(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  note int not null check (note between 1 and 5),
  commentaire text check (commentaire is null or length(commentaire) <= 1000),
  created_at timestamptz not null default now(),
  unique (classe_id, profile_id)
);

-- ---------------------------------------------------------------------
-- 5) Mentorat professionnel entre adultes
-- ---------------------------------------------------------------------
create table if not exists public.savoir_mentors_pro (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  nom text not null,
  domaines text[] not null default '{}',
  presentation text check (presentation is null or length(presentation) <= 1000),
  disponibilite text,
  statut text not null default 'actif' check (statut in ('actif', 'pause')),
  created_at timestamptz not null default now(),
  unique (association_id, profile_id)
);
create table if not exists public.savoir_mentorats_pro (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  mentor_id uuid not null references public.savoir_mentors_pro(id) on delete cascade,
  mentore_id uuid not null references public.profiles(id) on delete cascade,
  mentore_nom text,
  objectif text not null check (length(trim(objectif)) between 1 and 1000),
  statut text not null default 'demande' check (statut in ('demande', 'actif', 'termine', 'refuse')),
  accepte_le timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.savoir_mentorat_messages (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  mentorat_id uuid not null references public.savoir_mentorats_pro(id) on delete cascade,
  auteur_id uuid references public.profiles(id) on delete set null,
  auteur_nom text,
  contenu text not null check (length(trim(contenu)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create or replace function public.savoir_partie_mentorat(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.savoir_mentorats_pro x
      join public.savoir_mentors_pro m on m.id = x.mentor_id
     where x.id = p_id and x.association_id = public.current_association_id()
       and (x.mentore_id = auth.uid() or m.profile_id = auth.uid() or public.savoir_gestionnaire())
  )
$fn$;

create or replace function public.savoir_anime(p_classe_id uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select public.savoir_gestionnaire() or exists (
    select 1 from public.savoir_classes c
     where c.id = p_classe_id and c.association_id = public.current_association_id() and c.animateur_id = auth.uid()
  )
$fn$;

-- ---------------------------------------------------------------------
-- 6) Évaluation des séances de tutorat, rappels
-- ---------------------------------------------------------------------
alter table public.jeunesse_seances
  add column if not exists eval_note int check (eval_note between 1 and 5),
  add column if not exists eval_commentaire text check (eval_commentaire is null or length(eval_commentaire) <= 1000),
  add column if not exists eval_par_nom text,
  add column if not exists eval_le timestamptz,
  add column if not exists rappel_envoye boolean not null default false;

create or replace function public.jeunesse_evaluer_seance(p_seance_id uuid, p_note int, p_commentaire text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_s public.jeunesse_seances; v_etu uuid;
begin
  select * into v_s from public.jeunesse_seances where id = p_seance_id and association_id = public.current_association_id();
  if v_s.id is null then raise exception 'Séance introuvable.'; end if;
  if v_s.statut <> 'realisee' then raise exception 'Seule une séance réalisée peut être évaluée.'; end if;
  select etudiant_id into v_etu from public.jeunesse_jumelages where id = v_s.jumelage_id;
  if not (public.jeunesse_est_famille(v_etu) or public.jeunesse_est_responsable()) then
    raise exception 'Seuls le jeune, son parent ou un responsable peuvent évaluer la séance.';
  end if;
  if p_note is null or p_note < 1 or p_note > 5 then raise exception 'Note entre 1 et 5.'; end if;
  update public.jeunesse_seances
     set eval_note = p_note, eval_commentaire = nullif(trim(coalesce(p_commentaire, '')), ''),
         eval_par_nom = (select nom_complet from public.profiles where id = auth.uid()), eval_le = now()
   where id = p_seance_id;
end;
$fn$;
grant execute on function public.jeunesse_evaluer_seance(uuid, int, text) to authenticated;

-- Rappels la veille (toutes les heures : séances qui commencent dans
-- 20 à 28 heures, une seule fois).
create or replace function public.savoir_rappels_seances() returns void
language plpgsql security definer set search_path = '' as $fn$
declare r record; p uuid;
begin
  -- Tutorat : mentor + parent / jeune membre
  for r in
    select s.id, s.association_id, s.debut, j.matiere, m.member_id as mentor_member, e.parent_member_id, e.member_id as etu_member, e.prenom
      from public.jeunesse_seances s
      join public.jeunesse_jumelages j on j.id = s.jumelage_id
      join public.jeunesse_mentors m on m.id = j.mentor_id
      join public.jeunesse_etudiants e on e.id = j.etudiant_id
     where s.statut = 'prevue' and not s.rappel_envoye
       and s.debut between now() + interval '20 hours' and now() + interval '28 hours'
  loop
    for p in select id from public.profiles where member_id in (r.mentor_member, r.parent_member_id, r.etu_member) loop
      begin
        perform public.notify_profile(r.association_id, p, 'Rappel : séance de tutorat demain',
          'Séance de ' || r.matiere || ' avec ' || r.prenom || ' le ' || to_char(r.debut at time zone 'America/Toronto', 'DD/MM à HH24"h"MI') || '.');
      exception when others then null;
      end;
    end loop;
    begin
      update public.jeunesse_seances set rappel_envoye = true where id = r.id;
    exception when others then null; -- jumelage suspendu entre-temps : pas de blocage du rappel suivant
    end;
  end loop;
  -- Classes : animateur + inscrits
  for r in
    select s.id, s.association_id, s.debut, c.titre, c.animateur_id, c.id as classe_id
      from public.savoir_classe_seances s
      join public.savoir_classes c on c.id = s.classe_id
     where s.statut = 'prevue' and not s.rappel_envoye and c.statut = 'ouverte'
       and s.debut between now() + interval '20 hours' and now() + interval '28 hours'
  loop
    for p in
      select r.animateur_id where r.animateur_id is not null
      union select i.profile_id from public.savoir_inscriptions i where i.classe_id = r.classe_id and i.statut = 'inscrit'
    loop
      begin
        perform public.notify_profile(r.association_id, p, 'Rappel : classe demain',
          r.titre || ' le ' || to_char(r.debut at time zone 'America/Toronto', 'DD/MM à HH24"h"MI') || '.');
      exception when others then null;
      end;
    end loop;
    update public.savoir_classe_seances set rappel_envoye = true where id = r.id;
  end loop;
end;
$fn$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'savoir-rappels-seances';
    perform cron.schedule('savoir-rappels-seances', '5 * * * *', 'select public.savoir_rappels_seances()');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Gardes (déclencheurs)
-- ---------------------------------------------------------------------
-- Une classe proposée par un membre n'est ouverte que par un gestionnaire.
create or replace function public.savoir_trg_classe() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'INSERT' then
    if not public.savoir_gestionnaire() then new.statut := 'proposee'; end if;
  elsif new.statut is distinct from old.statut and not public.savoir_gestionnaire() then
    -- L'animateur peut terminer ou annuler sa classe, jamais l'ouvrir lui-même.
    if new.statut in ('ouverte', 'refusee') or (old.statut = 'proposee' and new.statut <> 'annulee') then
      raise exception 'Seul un gestionnaire du Carrefour peut ouvrir ou refuser une classe proposée.';
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_savoir_classe on public.savoir_classes;
create trigger trg_savoir_classe before insert or update on public.savoir_classes
  for each row execute function public.savoir_trg_classe();

-- Ressource proposée par un membre : en attente de validation.
create or replace function public.savoir_trg_ressource() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if not public.savoir_gestionnaire() then
    if tg_op = 'INSERT' then new.statut := 'proposee';
    elsif new.statut is distinct from old.statut then raise exception 'Seul un gestionnaire peut publier une ressource proposée.';
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_savoir_ressource on public.savoir_ressources;
create trigger trg_savoir_ressource before insert or update on public.savoir_ressources
  for each row execute function public.savoir_trg_ressource();

-- Inscription : classe ouverte, places disponibles.
create or replace function public.savoir_trg_inscription() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare v_c public.savoir_classes; v_n int;
begin
  if new.statut <> 'inscrit' then return new; end if;
  select * into v_c from public.savoir_classes where id = new.classe_id;
  if v_c.statut <> 'ouverte' then raise exception 'Les inscriptions à cette classe ne sont pas ouvertes.'; end if;
  if v_c.capacite is not null then
    select count(*) into v_n from public.savoir_inscriptions where classe_id = new.classe_id and statut = 'inscrit' and id <> new.id;
    if v_n >= v_c.capacite then raise exception 'Cette classe est complète.'; end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_savoir_inscription on public.savoir_inscriptions;
create trigger trg_savoir_inscription before insert or update on public.savoir_inscriptions
  for each row execute function public.savoir_trg_inscription();

-- Notifications : demande de mentorat (au mentor), réponse (au mentoré),
-- nouvelle réponse à une question (à son auteur).
create or replace function public.savoir_trg_notifs() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare v_dest uuid; v_titre text;
begin
  begin
    if tg_table_name = 'savoir_mentorats_pro' then
      if tg_op = 'INSERT' then
        select profile_id into v_dest from public.savoir_mentors_pro where id = new.mentor_id;
        perform public.notify_profile(new.association_id, v_dest, 'Nouvelle demande de mentorat', coalesce(new.mentore_nom, '') || ' souhaite être accompagné(e) : ' || left(new.objectif, 120));
      elsif new.statut is distinct from old.statut and new.statut in ('actif', 'refuse') then
        perform public.notify_profile(new.association_id, new.mentore_id, 'Mentorat professionnel',
          case when new.statut = 'actif' then 'Votre demande de mentorat a été acceptée.' else 'Votre demande de mentorat n''a pas pu être acceptée.' end);
      end if;
    elsif tg_table_name = 'savoir_reponses' then
      select auteur_id, titre into v_dest, v_titre from public.savoir_questions where id = new.question_id;
      if v_dest is not null and v_dest <> coalesce(new.auteur_id, '00000000-0000-0000-0000-000000000000'::uuid) then
        perform public.notify_profile(new.association_id, v_dest, 'Nouvelle réponse à votre question', left(v_titre, 120));
      end if;
    end if;
  exception when others then null;
  end;
  return new;
end;
$fn$;
drop trigger if exists trg_savoir_mentorat_notif on public.savoir_mentorats_pro;
create trigger trg_savoir_mentorat_notif after insert or update on public.savoir_mentorats_pro
  for each row execute function public.savoir_trg_notifs();
drop trigger if exists trg_savoir_reponse_notif on public.savoir_reponses;
create trigger trg_savoir_reponse_notif after insert on public.savoir_reponses
  for each row execute function public.savoir_trg_notifs();

-- ---------------------------------------------------------------------
-- Sécurité (RLS)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['savoir_ressources', 'savoir_favoris', 'savoir_consultations', 'savoir_parcours', 'savoir_parcours_etapes',
    'savoir_progressions', 'savoir_questions', 'savoir_reponses', 'savoir_classes', 'savoir_classe_seances', 'savoir_inscriptions',
    'savoir_presences', 'savoir_avis', 'savoir_mentors_pro', 'savoir_mentorats_pro', 'savoir_mentorat_messages']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s lecture" on public.%I', t, t);
    execute format('drop policy if exists "%s ecriture" on public.%I', t, t);
  end loop;
end $$;

-- Ressources
create policy "savoir_ressources lecture" on public.savoir_ressources for select to authenticated
  using (association_id = public.current_association_id() and (statut = 'publiee' or depose_par = auth.uid() or public.savoir_gestionnaire()));
create policy "savoir_ressources ecriture" on public.savoir_ressources for all to authenticated
  using (association_id = public.current_association_id() and (public.savoir_gestionnaire() or depose_par = auth.uid()))
  with check (association_id = public.current_association_id() and (public.savoir_gestionnaire() or depose_par = auth.uid()));

-- Favoris, consultations, progressions : les siens
create policy "savoir_favoris lecture" on public.savoir_favoris for select to authenticated
  using (association_id = public.current_association_id() and profile_id = auth.uid());
create policy "savoir_favoris ecriture" on public.savoir_favoris for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid() and association_id = public.current_association_id());
create policy "savoir_consultations lecture" on public.savoir_consultations for select to authenticated
  using (association_id = public.current_association_id() and (profile_id = auth.uid() or public.savoir_gestionnaire()));
create policy "savoir_consultations ecriture" on public.savoir_consultations for insert to authenticated
  with check (profile_id = auth.uid() and association_id = public.current_association_id());
create policy "savoir_progressions lecture" on public.savoir_progressions for select to authenticated
  using (association_id = public.current_association_id() and (profile_id = auth.uid() or public.savoir_gestionnaire()));
create policy "savoir_progressions ecriture" on public.savoir_progressions for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid() and association_id = public.current_association_id());

-- Parcours : lecture de tous, écriture des gestionnaires
create policy "savoir_parcours lecture" on public.savoir_parcours for select to authenticated
  using (association_id = public.current_association_id() and (statut = 'publie' or public.savoir_gestionnaire()));
create policy "savoir_parcours ecriture" on public.savoir_parcours for all to authenticated
  using (association_id = public.current_association_id() and public.savoir_gestionnaire())
  with check (association_id = public.current_association_id() and public.savoir_gestionnaire());
create policy "savoir_parcours_etapes lecture" on public.savoir_parcours_etapes for select to authenticated
  using (association_id = public.current_association_id());
create policy "savoir_parcours_etapes ecriture" on public.savoir_parcours_etapes for all to authenticated
  using (association_id = public.current_association_id() and public.savoir_gestionnaire())
  with check (association_id = public.current_association_id() and public.savoir_gestionnaire());

-- Questions et réponses
create policy "savoir_questions lecture" on public.savoir_questions for select to authenticated
  using (association_id = public.current_association_id() and (not masquee or auteur_id = auth.uid() or public.savoir_gestionnaire()));
create policy "savoir_questions ecriture" on public.savoir_questions for all to authenticated
  using (association_id = public.current_association_id() and (auteur_id = auth.uid() or public.savoir_gestionnaire()))
  with check (association_id = public.current_association_id() and (auteur_id = auth.uid() or public.savoir_gestionnaire()));
create policy "savoir_reponses lecture" on public.savoir_reponses for select to authenticated
  using (association_id = public.current_association_id() and (not masquee or auteur_id = auth.uid() or public.savoir_gestionnaire()));
create policy "savoir_reponses ecriture" on public.savoir_reponses for all to authenticated
  using (association_id = public.current_association_id() and (auteur_id = auth.uid() or public.savoir_gestionnaire()
    or exists (select 1 from public.savoir_questions q where q.id = question_id and q.auteur_id = auth.uid())))
  with check (association_id = public.current_association_id() and (auteur_id = auth.uid() or public.savoir_gestionnaire()
    or exists (select 1 from public.savoir_questions q where q.id = question_id and q.auteur_id = auth.uid())));

-- Classes
create policy "savoir_classes lecture" on public.savoir_classes for select to authenticated
  using (association_id = public.current_association_id() and (statut in ('ouverte', 'terminee') or animateur_id = auth.uid() or cree_par = auth.uid() or public.savoir_gestionnaire()));
create policy "savoir_classes ecriture" on public.savoir_classes for all to authenticated
  using (association_id = public.current_association_id() and (public.savoir_gestionnaire() or animateur_id = auth.uid() or cree_par = auth.uid()))
  with check (association_id = public.current_association_id() and (public.savoir_gestionnaire() or animateur_id = auth.uid() or cree_par = auth.uid()));
create policy "savoir_classe_seances lecture" on public.savoir_classe_seances for select to authenticated
  using (association_id = public.current_association_id());
create policy "savoir_classe_seances ecriture" on public.savoir_classe_seances for all to authenticated
  using (association_id = public.current_association_id() and public.savoir_anime(classe_id))
  with check (association_id = public.current_association_id() and public.savoir_anime(classe_id));
create policy "savoir_inscriptions lecture" on public.savoir_inscriptions for select to authenticated
  using (association_id = public.current_association_id());
create policy "savoir_inscriptions ecriture" on public.savoir_inscriptions for all to authenticated
  using (association_id = public.current_association_id() and (profile_id = auth.uid() or public.savoir_anime(classe_id)))
  with check (association_id = public.current_association_id() and (profile_id = auth.uid() or public.savoir_anime(classe_id)));
create policy "savoir_presences lecture" on public.savoir_presences for select to authenticated
  using (association_id = public.current_association_id());
create policy "savoir_presences ecriture" on public.savoir_presences for all to authenticated
  using (association_id = public.current_association_id() and public.savoir_anime((select s.classe_id from public.savoir_classe_seances s where s.id = seance_id)))
  with check (association_id = public.current_association_id() and public.savoir_anime((select s.classe_id from public.savoir_classe_seances s where s.id = seance_id)));
create policy "savoir_avis lecture" on public.savoir_avis for select to authenticated
  using (association_id = public.current_association_id());
create policy "savoir_avis ecriture" on public.savoir_avis for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and association_id = public.current_association_id()
    and exists (select 1 from public.savoir_inscriptions i where i.classe_id = savoir_avis.classe_id and i.profile_id = auth.uid() and i.statut = 'inscrit'));

-- Mentorat professionnel
create policy "savoir_mentors_pro lecture" on public.savoir_mentors_pro for select to authenticated
  using (association_id = public.current_association_id());
create policy "savoir_mentors_pro ecriture" on public.savoir_mentors_pro for all to authenticated
  using (association_id = public.current_association_id() and (profile_id = auth.uid() or public.savoir_gestionnaire()))
  with check (association_id = public.current_association_id() and (profile_id = auth.uid() or public.savoir_gestionnaire()));
create policy "savoir_mentorats_pro lecture" on public.savoir_mentorats_pro for select to authenticated
  using (public.savoir_partie_mentorat(id));
create policy "savoir_mentorats_pro ecriture" on public.savoir_mentorats_pro for all to authenticated
  using (public.savoir_partie_mentorat(id))
  with check (association_id = public.current_association_id()
    and (mentore_id = auth.uid() or public.savoir_gestionnaire()
         or exists (select 1 from public.savoir_mentors_pro m where m.id = mentor_id and m.profile_id = auth.uid())));
create policy "savoir_mentorat_messages lecture" on public.savoir_mentorat_messages for select to authenticated
  using (public.savoir_partie_mentorat(mentorat_id));
create policy "savoir_mentorat_messages ecriture" on public.savoir_mentorat_messages for insert to authenticated
  with check (auteur_id = auth.uid() and public.savoir_partie_mentorat(mentorat_id));

-- ---------------------------------------------------------------------
-- Stockage des fichiers déposés (bucket privé « savoir-ressources »)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('savoir-ressources', 'savoir-ressources', false)
on conflict (id) do nothing;
drop policy if exists "savoir ressources storage select" on storage.objects;
drop policy if exists "savoir ressources storage insert" on storage.objects;
drop policy if exists "savoir ressources storage delete" on storage.objects;
create policy "savoir ressources storage select" on storage.objects for select to authenticated
  using (bucket_id = 'savoir-ressources' and (storage.foldername(name))[1] = public.current_association_id()::text);
create policy "savoir ressources storage insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'savoir-ressources' and (storage.foldername(name))[1] = public.current_association_id()::text);
create policy "savoir ressources storage delete" on storage.objects for delete to authenticated
  using (bucket_id = 'savoir-ressources' and (storage.foldername(name))[1] = public.current_association_id()::text
    and (public.savoir_gestionnaire() or owner = auth.uid()));

-- Vérification :
--   select count(*) from pg_tables where tablename like 'savoir_%';   -- 16
--   select proname from pg_proc where proname in ('savoir_gestionnaire', 'savoir_rappels_seances', 'jeunesse_evaluer_seance');  -- 3 lignes

-- Ressources les plus consultées de l'association (recommandations « populaires »),
-- sans exposer qui a consulté quoi.
create or replace function public.savoir_populaires() returns table (ressource_id uuid, vues bigint)
language sql stable security definer set search_path = '' as $fn$
  select c.ressource_id, count(*) from public.savoir_consultations c
   where c.association_id = public.current_association_id()
   group by c.ressource_id order by count(*) desc limit 12
$fn$;
grant execute on function public.savoir_populaires() to authenticated;
