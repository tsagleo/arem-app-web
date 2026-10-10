-- =====================================================================
-- Carrefour du savoir — compléments (2026-10-10, demandés par
-- l'utilisateur : « exécuter les 5 points à la fois »)
-- =====================================================================
--   1. (écran seulement) modification des ressources, parcours, classes ;
--      recherche unique avec la bibliothèque Jeunesse.
--   2. Classes : liste d'attente avec promotion automatique, supports de
--      cours réservés aux inscrits, notification de l'animateur à chaque
--      inscription, notification des membres intéressés à l'ouverture.
--   3. Parcours : quiz de validation (réponses jamais exposées aux
--      membres), badges de compétences.
--   4. Classes ouvertes au public (vitrine), profil d'apprenant enregistré
--      et notification des nouveautés selon ce profil.
--   5. Bouton « Signaler » et modération ; suivi du mentorat professionnel
--      par un responsable SEULEMENT à la demande d'une des deux parties.
-- Prérequis : sql/2026-10-10m_carrefour_savoir.sql. Ré-exécutable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2) Liste d'attente
-- ---------------------------------------------------------------------
alter table public.savoir_inscriptions drop constraint if exists savoir_inscriptions_statut_check;
alter table public.savoir_inscriptions add constraint savoir_inscriptions_statut_check check (statut in ('inscrit', 'attente', 'retire'));
alter table public.savoir_classes add column if not exists publique boolean not null default false;

create table if not exists public.savoir_inscriptions_publiques (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  classe_id uuid not null references public.savoir_classes(id) on delete cascade,
  nom text not null check (length(trim(nom)) between 1 and 120),
  courriel text not null check (length(trim(courriel)) between 3 and 200),
  telephone text,
  statut text not null default 'inscrit' check (statut in ('inscrit', 'attente', 'retire')),
  created_at timestamptz not null default now()
);

create or replace function public.savoir_places_prises(p_classe_id uuid) returns int
language sql stable security definer set search_path = '' as $fn$
  select (select count(*) from public.savoir_inscriptions where classe_id = p_classe_id and statut = 'inscrit')::int
       + (select count(*) from public.savoir_inscriptions_publiques where classe_id = p_classe_id and statut = 'inscrit')::int
$fn$;

-- Inscription : classe ouverte ; si complète, mise en liste d'attente.
create or replace function public.savoir_trg_inscription() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare v_c public.savoir_classes; v_n int;
begin
  if new.statut <> 'inscrit' then return new; end if;
  if tg_op = 'UPDATE' and old.statut = 'inscrit' then return new; end if;
  select * into v_c from public.savoir_classes where id = new.classe_id;
  if v_c.statut <> 'ouverte' then raise exception 'Les inscriptions à cette classe ne sont pas ouvertes.'; end if;
  if v_c.capacite is not null then
    v_n := public.savoir_places_prises(new.classe_id);
    if v_n >= v_c.capacite then new.statut := 'attente'; end if;
  end if;
  return new;
end;
$fn$;

-- Place libérée : le premier de la liste d'attente (membre ou public) passe inscrit.
create or replace function public.savoir_promouvoir_attente(p_classe_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_c public.savoir_classes; v_m public.savoir_inscriptions; v_p public.savoir_inscriptions_publiques;
begin
  select * into v_c from public.savoir_classes where id = p_classe_id;
  if v_c.id is null or v_c.statut <> 'ouverte' or v_c.capacite is null then return; end if;
  while public.savoir_places_prises(p_classe_id) < v_c.capacite loop
    select * into v_m from public.savoir_inscriptions where classe_id = p_classe_id and statut = 'attente' order by created_at limit 1;
    select * into v_p from public.savoir_inscriptions_publiques where classe_id = p_classe_id and statut = 'attente' order by created_at limit 1;
    if v_m.id is null and v_p.id is null then exit; end if;
    if v_p.id is null or (v_m.id is not null and v_m.created_at <= v_p.created_at) then
      update public.savoir_inscriptions set statut = 'inscrit' where id = v_m.id;
      begin
        perform public.notify_profile(v_c.association_id, v_m.profile_id, 'Place confirmée', 'Une place s''est libérée : vous êtes inscrit(e) à « ' || v_c.titre || ' ».');
      exception when others then null;
      end;
    else
      update public.savoir_inscriptions_publiques set statut = 'inscrit' where id = v_p.id;
    end if;
    v_m := null; v_p := null;
  end loop;
end;
$fn$;

create or replace function public.savoir_trg_inscription_apres() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare v_c public.savoir_classes;
begin
  select * into v_c from public.savoir_classes where id = coalesce(new.classe_id, old.classe_id);
  if tg_op = 'INSERT' and v_c.animateur_id is not null then
    begin
      perform public.notify_profile(v_c.association_id, v_c.animateur_id, 'Nouvelle inscription',
        coalesce(new.nom, 'Un membre') || case when new.statut = 'attente' then ' (liste d''attente)' else '' end || ' — « ' || v_c.titre || ' »');
    exception when others then null;
    end;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.statut = 'inscrit' and new.statut <> 'inscrit') then
    perform public.savoir_promouvoir_attente(v_c.id);
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_savoir_inscription_apres on public.savoir_inscriptions;
create trigger trg_savoir_inscription_apres after insert or update or delete on public.savoir_inscriptions
  for each row execute function public.savoir_trg_inscription_apres();
drop trigger if exists trg_savoir_inscription_pub_apres on public.savoir_inscriptions_publiques;
create trigger trg_savoir_inscription_pub_apres after insert or update or delete on public.savoir_inscriptions_publiques
  for each row execute function public.savoir_trg_inscription_apres();

-- Capacité augmentée : promotion automatique.
create or replace function public.savoir_trg_classe_apres() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare p uuid;
begin
  if new.statut = 'ouverte' and (new.capacite is distinct from old.capacite or old.statut <> 'ouverte') then
    perform public.savoir_promouvoir_attente(new.id);
  end if;
  -- Ouverture d'une classe : prévenir les membres intéressés par ce domaine.
  if new.statut = 'ouverte' and (tg_op = 'INSERT' or old.statut is distinct from 'ouverte') then
    for p in select sp.profile_id from public.savoir_profils sp
              where sp.association_id = new.association_id and sp.notifications and new.domaine = any(sp.domaines)
                and sp.profile_id is distinct from new.animateur_id
    loop
      begin
        perform public.notify_profile(new.association_id, p, 'Nouvelle classe : ' || left(new.titre, 80), 'Les inscriptions sont ouvertes dans le Carrefour du savoir.');
      exception when others then null;
      end;
    end loop;
  end if;
  return null;
end;
$fn$;

-- Supports de cours (réservés aux inscrits et à l'animateur)
create table if not exists public.savoir_supports (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  classe_id uuid not null references public.savoir_classes(id) on delete cascade,
  seance_id uuid references public.savoir_classe_seances(id) on delete cascade,
  titre text not null check (length(trim(titre)) between 1 and 200),
  url text,
  storage_path text,
  created_at timestamptz not null default now(),
  constraint savoir_supports_source check (url is not null or storage_path is not null)
);

-- ---------------------------------------------------------------------
-- 3) Quiz de validation des étapes de parcours
-- ---------------------------------------------------------------------
alter table public.savoir_parcours_etapes add column if not exists quiz_seuil int not null default 70 check (quiz_seuil between 1 and 100);
create table if not exists public.savoir_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  etape_id uuid not null references public.savoir_parcours_etapes(id) on delete cascade,
  ordre int not null default 1,
  question text not null check (length(trim(question)) between 1 and 500),
  choix text[] not null check (array_length(choix, 1) between 2 and 6),
  bonne_reponse int not null check (bonne_reponse >= 0)
);
create table if not exists public.savoir_quiz_resultats (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  etape_id uuid not null references public.savoir_parcours_etapes(id) on delete cascade,
  score int not null,
  reussi boolean not null,
  created_at timestamptz not null default now()
);

-- Questions d'une étape, SANS la bonne réponse (pour les membres).
create or replace function public.savoir_quiz(p_etape_id uuid) returns table (id uuid, ordre int, question text, choix text[])
language sql stable security definer set search_path = '' as $fn$
  select q.id, q.ordre, q.question, q.choix from public.savoir_quiz_questions q
   where q.etape_id = p_etape_id and q.association_id = public.current_association_id()
   order by q.ordre
$fn$;
grant execute on function public.savoir_quiz(uuid) to authenticated;

-- Correction côté serveur ; l'étape n'est validée que si le seuil est atteint.
create or replace function public.savoir_valider_quiz(p_etape_id uuid, p_reponses int[]) returns json
language plpgsql security definer set search_path = '' as $fn$
declare v_e public.savoir_parcours_etapes; v_total int; v_bon int := 0; v_score int; q record; i int := 0;
begin
  select * into v_e from public.savoir_parcours_etapes where id = p_etape_id and association_id = public.current_association_id();
  if v_e.id is null then raise exception 'Étape introuvable.'; end if;
  select count(*) into v_total from public.savoir_quiz_questions where etape_id = p_etape_id;
  if v_total = 0 then raise exception 'Cette étape n''a pas de quiz.'; end if;
  for q in select bonne_reponse from public.savoir_quiz_questions where etape_id = p_etape_id order by ordre, id loop
    i := i + 1;
    if p_reponses is not null and array_length(p_reponses, 1) >= i and p_reponses[i] = q.bonne_reponse then v_bon := v_bon + 1; end if;
  end loop;
  v_score := round(100.0 * v_bon / v_total);
  insert into public.savoir_quiz_resultats (association_id, profile_id, etape_id, score, reussi)
  values (v_e.association_id, auth.uid(), p_etape_id, v_score, v_score >= v_e.quiz_seuil);
  if v_score >= v_e.quiz_seuil then
    perform set_config('unia.quiz', 'oui', true);
    insert into public.savoir_progressions (association_id, profile_id, parcours_id, etape_id)
    values (v_e.association_id, auth.uid(), v_e.parcours_id, p_etape_id) on conflict do nothing;
    perform set_config('unia.quiz', '', true);
  end if;
  return json_build_object('score', v_score, 'seuil', v_e.quiz_seuil, 'reussi', v_score >= v_e.quiz_seuil, 'bonnes', v_bon, 'total', v_total);
end;
$fn$;
grant execute on function public.savoir_valider_quiz(uuid, int[]) to authenticated;

-- Une étape avec quiz ne se coche pas à la main.
create or replace function public.savoir_trg_progression() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if exists (select 1 from public.savoir_quiz_questions where etape_id = new.etape_id)
     and coalesce(current_setting('unia.quiz', true), '') <> 'oui' then
    raise exception 'Cette étape se valide en réussissant son quiz.';
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_savoir_progression on public.savoir_progressions;
create trigger trg_savoir_progression before insert on public.savoir_progressions
  for each row execute function public.savoir_trg_progression();

-- ---------------------------------------------------------------------
-- 4) Profil d'apprenant, notifications de nouveautés, vitrine publique
-- ---------------------------------------------------------------------
create table if not exists public.savoir_profils (
  association_id uuid not null references public.associations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  publics text[] not null default '{}',
  domaines text[] not null default '{}',
  notifications boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (association_id, profile_id)
);

create or replace function public.savoir_trg_ressource_notif() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare p uuid;
begin
  if new.statut = 'publiee' and (tg_op = 'INSERT' or old.statut is distinct from 'publiee') then
    for p in select sp.profile_id from public.savoir_profils sp
              where sp.association_id = new.association_id and sp.notifications
                and (new.domaine = any(sp.domaines) or new.publics && sp.publics)
                and sp.profile_id is distinct from new.depose_par
              limit 200
    loop
      begin
        perform public.notify_profile(new.association_id, p, 'Nouvelle ressource pour vous', left(new.titre, 120));
      exception when others then null;
      end;
    end loop;
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_savoir_ressource_notif on public.savoir_ressources;
-- Pas de notification pour un import en lot (pack de démarrage) : seulement
-- pour les ajouts unitaires (déclencheur par ligne, mais filtré côté écran
-- par le drapeau externe : les ressources du pack sont externes).
create trigger trg_savoir_ressource_notif after insert or update of statut on public.savoir_ressources
  for each row when (not new.externe) execute function public.savoir_trg_ressource_notif();

drop trigger if exists trg_savoir_classe_apres on public.savoir_classes;
create trigger trg_savoir_classe_apres after insert or update on public.savoir_classes
  for each row execute function public.savoir_trg_classe_apres();

-- Vitrine : classes ouvertes au public (association avec vitrine active).
create or replace view public.public_classes as
select a.slug_public, c.id, c.titre, c.description, c.domaine, c.niveau, c.mode, c.lieu, c.capacite, c.animateur_nom,
       (select min(s.debut) from public.savoir_classe_seances s where s.classe_id = c.id and s.statut = 'prevue' and s.debut >= now()) as prochaine_seance,
       (select count(*) from public.savoir_classe_seances s where s.classe_id = c.id and s.statut <> 'annulee') as nb_seances,
       public.savoir_places_prises(c.id) as places_prises
  from public.savoir_classes c
  join public.associations a on a.id = c.association_id
 where c.publique and c.statut = 'ouverte' and a.vitrine_active = true and a.slug_public is not null;
grant select on public.public_classes to anon, authenticated;

create or replace function public.savoir_inscription_publique(p_classe_id uuid, p_nom text, p_courriel text, p_telephone text, p_piege text default null)
returns text
language plpgsql security definer set search_path = '' as $fn$
declare v_c public.savoir_classes; v_statut text := 'inscrit';
begin
  if coalesce(p_piege, '') <> '' then return 'ok'; end if; -- robot : on ne dit rien
  select c.* into v_c from public.savoir_classes c join public.associations a on a.id = c.association_id
   where c.id = p_classe_id and c.publique and c.statut = 'ouverte' and a.vitrine_active;
  if v_c.id is null then raise exception 'Cette classe n''accepte pas d''inscriptions publiques.'; end if;
  if coalesce(trim(p_nom), '') = '' or coalesce(trim(p_courriel), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Nom et courriel valides requis.';
  end if;
  if exists (select 1 from public.savoir_inscriptions_publiques where classe_id = p_classe_id and lower(courriel) = lower(trim(p_courriel)) and statut <> 'retire') then
    raise exception 'Vous êtes déjà inscrit(e) à cette classe.';
  end if;
  if v_c.capacite is not null and public.savoir_places_prises(p_classe_id) >= v_c.capacite then v_statut := 'attente'; end if;
  insert into public.savoir_inscriptions_publiques (association_id, classe_id, nom, courriel, telephone, statut)
  values (v_c.association_id, p_classe_id, trim(p_nom), lower(trim(p_courriel)), nullif(trim(coalesce(p_telephone, '')), ''), v_statut);
  return v_statut;
end;
$fn$;
grant execute on function public.savoir_inscription_publique(uuid, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) Signalements ; suivi du mentorat à la demande
-- ---------------------------------------------------------------------
create table if not exists public.savoir_signalements (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  cible_type text not null check (cible_type in ('ressource', 'question', 'reponse', 'classe')),
  cible_id uuid not null,
  apercu text,
  motif text not null check (length(trim(motif)) between 1 and 500),
  auteur_id uuid references public.profiles(id) on delete set null,
  auteur_nom text,
  statut text not null default 'ouvert' check (statut in ('ouvert', 'traite', 'rejete')),
  traite_par_nom text,
  traite_le timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.savoir_trg_signalement() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare p uuid;
begin
  for p in
    select pr.id from public.profiles pr
     where pr.association_id = new.association_id and pr.role in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier')
    union select r.profile_id from public.jeunesse_responsables r where r.association_id = new.association_id
  loop
    begin
      perform public.notify_profile(new.association_id, p, 'Contenu signalé dans le Carrefour du savoir', left(coalesce(new.apercu, '') || ' — ' || new.motif, 160));
    exception when others then null;
    end;
  end loop;
  return null;
end;
$fn$;
drop trigger if exists trg_savoir_signalement on public.savoir_signalements;
create trigger trg_savoir_signalement after insert on public.savoir_signalements
  for each row execute function public.savoir_trg_signalement();

-- Mentorat : les responsables voient la LISTE des accompagnements, mais
-- les messages seulement si une des parties a demandé leur suivi.
alter table public.savoir_mentorats_pro add column if not exists suivi_demande boolean not null default false;
alter table public.savoir_mentorats_pro add column if not exists suivi_demande_par text;

create or replace function public.savoir_partie_mentorat_stricte(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.savoir_mentorats_pro x
      join public.savoir_mentors_pro m on m.id = x.mentor_id
     where x.id = p_id and x.association_id = public.current_association_id()
       and (x.mentore_id = auth.uid() or m.profile_id = auth.uid() or (x.suivi_demande and public.savoir_gestionnaire()))
  )
$fn$;

-- ---------------------------------------------------------------------
-- Sécurité (RLS) des nouvelles tables et politiques revues
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['savoir_inscriptions_publiques', 'savoir_supports', 'savoir_quiz_questions', 'savoir_quiz_resultats', 'savoir_profils', 'savoir_signalements']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s lecture" on public.%I', t, t);
    execute format('drop policy if exists "%s ecriture" on public.%I', t, t);
  end loop;
end $$;

create policy "savoir_inscriptions_publiques lecture" on public.savoir_inscriptions_publiques for select to authenticated
  using (association_id = public.current_association_id() and public.savoir_anime(classe_id));
create policy "savoir_inscriptions_publiques ecriture" on public.savoir_inscriptions_publiques for update to authenticated
  using (association_id = public.current_association_id() and public.savoir_anime(classe_id));

create policy "savoir_supports lecture" on public.savoir_supports for select to authenticated
  using (association_id = public.current_association_id() and (public.savoir_anime(classe_id)
    or exists (select 1 from public.savoir_inscriptions i where i.classe_id = savoir_supports.classe_id and i.profile_id = auth.uid() and i.statut = 'inscrit')));
create policy "savoir_supports ecriture" on public.savoir_supports for all to authenticated
  using (association_id = public.current_association_id() and public.savoir_anime(classe_id))
  with check (association_id = public.current_association_id() and public.savoir_anime(classe_id));

-- Les bonnes réponses ne sont lisibles que des gestionnaires.
create policy "savoir_quiz_questions lecture" on public.savoir_quiz_questions for select to authenticated
  using (association_id = public.current_association_id() and public.savoir_gestionnaire());
create policy "savoir_quiz_questions ecriture" on public.savoir_quiz_questions for all to authenticated
  using (association_id = public.current_association_id() and public.savoir_gestionnaire())
  with check (association_id = public.current_association_id() and public.savoir_gestionnaire());
create policy "savoir_quiz_resultats lecture" on public.savoir_quiz_resultats for select to authenticated
  using (association_id = public.current_association_id() and (profile_id = auth.uid() or public.savoir_gestionnaire()));

create policy "savoir_profils lecture" on public.savoir_profils for select to authenticated
  using (association_id = public.current_association_id() and profile_id = auth.uid());
create policy "savoir_profils ecriture" on public.savoir_profils for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid() and association_id = public.current_association_id());

create policy "savoir_signalements lecture" on public.savoir_signalements for select to authenticated
  using (association_id = public.current_association_id() and (auteur_id = auth.uid() or public.savoir_gestionnaire()));
create policy "savoir_signalements ecriture" on public.savoir_signalements for all to authenticated
  using (association_id = public.current_association_id() and public.savoir_gestionnaire())
  with check (association_id = public.current_association_id() and (auteur_id = auth.uid() or public.savoir_gestionnaire()));

-- Mentorat : messages réservés aux parties (ou au responsable appelé en suivi).
drop policy if exists "savoir_mentorat_messages lecture" on public.savoir_mentorat_messages;
drop policy if exists "savoir_mentorat_messages ecriture" on public.savoir_mentorat_messages;
create policy "savoir_mentorat_messages lecture" on public.savoir_mentorat_messages for select to authenticated
  using (public.savoir_partie_mentorat_stricte(mentorat_id));
create policy "savoir_mentorat_messages ecriture" on public.savoir_mentorat_messages for insert to authenticated
  with check (auteur_id = auth.uid() and public.savoir_partie_mentorat_stricte(mentorat_id));

-- Statistiques par ressource (gestionnaires) : vues, favoris, dernière vue.
create or replace function public.savoir_stats_ressources() returns table (ressource_id uuid, vues bigint, lecteurs bigint, favoris bigint, derniere timestamptz)
language sql stable security definer set search_path = '' as $fn$
  select r.id,
         (select count(*) from public.savoir_consultations c where c.ressource_id = r.id),
         (select count(distinct c.profile_id) from public.savoir_consultations c where c.ressource_id = r.id),
         (select count(*) from public.savoir_favoris f where f.ressource_id = r.id),
         (select max(c.created_at) from public.savoir_consultations c where c.ressource_id = r.id)
    from public.savoir_ressources r
   where r.association_id = public.current_association_id() and public.savoir_gestionnaire()
$fn$;
grant execute on function public.savoir_stats_ressources() to authenticated;

-- Vérification :
--   select count(*) from pg_tables where tablename like 'savoir_%';   -- 22
--   select proname from pg_proc where proname in ('savoir_valider_quiz', 'savoir_inscription_publique', 'savoir_promouvoir_attente');  -- 3 lignes

-- Étapes qui ont un quiz (et combien de questions), sans les réponses.
create or replace function public.savoir_etapes_avec_quiz() returns table (etape_id uuid, nb int)
language sql stable security definer set search_path = '' as $fn$
  select q.etape_id, count(*)::int from public.savoir_quiz_questions q
   where q.association_id = public.current_association_id() group by q.etape_id
$fn$;
grant execute on function public.savoir_etapes_avec_quiz() to authenticated;
