-- =====================================================================
-- Projets — modernisation (collaboration + automatisation) et bloc
-- différenciant associatif (bénévolat, badges, dons ciblés, rapport
-- d'impact, suivi public) — 2026-09-30
-- =====================================================================
-- Suite de claude/projets-modernisation-proposition.md. Arbitrage retenu
-- par l'utilisateur (AskUserQuestion, 2 questions) :
--   Axe standards : collaboration sur les tâches (sous-tâches, commen-
--     taires + @mentions, historique) + automatisation (modèles de
--     projet, tâches récurrentes, charge de travail, export PDF).
--   Axe associatif : bénévolat + reconnaissance (appels au bénévolat +
--     badges automatiques) + traçabilité don → projet + rapport
--     d'impact à la clôture + page de suivi public par projet.
--   NON retenu cette vague : registre de risques, pièces jointes,
--     alertes de dépassement configurables (« Phase 3 » laissée de côté
--     à nouveau — voir claude/incubateur-projets-proposition.md).
--
-- Principes de sécurité repris de l'existant (jamais réinventés) :
--   - `projects`/`project_tasks` restent strictement réservés au Bureau
--     en lecture/écriture directe (RLS déjà en place, INCHANGÉE ici).
--   - Tout accès d'un adhérent simple (bénévolat, mes tâches, commenter
--     ma tâche) passe par une RPC `security definer` dédiée qui valide
--     elle-même la portée (association, tâche qui lui est assignée) —
--     même patron que `checkin_member()`/`declarer_absence()`
--     (Présences) : aucune policy RLS élargie sur les tables existantes.
--   - Les nouvelles tables (sous-tâches, commentaires, badges) suivent
--     le même patron RLS "association_id = current_association_id()"
--     déjà utilisé partout.
--   - Les @mentions dans les commentaires de tâche réutilisent tel quel
--     `notify_mentions()` (Vie associative, 2026-09-29b) — fonction déjà
--     générique, aucune modification nécessaire, seul un nouveau trigger
--     wrapper est ajouté.
--   - La page de suivi public reprend le patron exact de la vitrine
--     publique (`sql/2026-09-28i_vitrine_publique.sql`) : une VUE qui ne
--     projette que des colonnes sûres, jamais un accès direct aux
--     tables, activée uniquement si `associations.vitrine_active` ET le
--     projet a explicitement `public_suivi = true` (choix du Bureau,
--     projet par projet — jamais public par défaut).
--   - Le lien don → projet reste **purement informatif** (nouvelle
--     colonne `donations.projet_id` nullable) — aucune écriture dans le
--     grand livre réel, cohérent avec la décision déjà prise pour le
--     budget de projet lui-même (suivi indépendant, 2026-09-11).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Colonnes nouvelles sur les tables existantes
-- ---------------------------------------------------------------------
alter table public.projects
  add column if not exists est_modele boolean not null default false,
  add column if not exists public_suivi boolean not null default false;

comment on column public.projects.est_modele is
  'Vrai si ce projet sert de modèle réutilisable (dupliquer_projet_depuis_modele()) plutôt qu''un projet actif à suivre au quotidien.';
comment on column public.projects.public_suivi is
  'Vrai si ce projet a une page de suivi public (progression + jalons, sans détail budgétaire ni liste de tâches) accessible via ?projet_public=<id> — nécessite aussi associations.vitrine_active. Choix du Bureau, projet par projet, jamais public par défaut.';

alter table public.project_tasks add column if not exists recurrence text;
alter table public.project_tasks drop constraint if exists project_tasks_recurrence_check;
alter table public.project_tasks add constraint project_tasks_recurrence_check
  check (recurrence is null or recurrence in ('hebdomadaire', 'mensuel'));

comment on column public.project_tasks.recurrence is
  'Si définie, marquer cette tâche "Terminé" recrée automatiquement une nouvelle occurrence (échéance +7 jours ou +1 mois), déclenché côté client (Projets.jsx) au moment de l''action Bureau — aucune planification serveur.';

alter table public.associations add column if not exists projet_pilier_seuil_taches integer not null default 3;

comment on column public.associations.projet_pilier_seuil_taches is
  'Nombre de tâches complétées par un même bénévole sur un même projet à partir duquel le badge "Pilier du projet" (member_badges) lui est attribué automatiquement.';

alter table public.donations add column if not exists projet_id uuid references public.projects(id) on delete set null;

comment on column public.donations.projet_id is
  'Projet financé par ce don, le cas échéant (don ciblé) — NULL pour un don générique à la trésorerie de l''association. Purement informatif : n''affecte aucun solde réel (même principe que le budget de projet, indépendant du grand livre). Complément « modernisation Projets » (2026-09-30).';

-- ---------------------------------------------------------------------
-- 2) Sous-tâches (checklist) — réservées au Bureau, même patron RLS que
--    project_tasks (aucun accès adhérent : la décomposition d'une tâche
--    reste une prérogative du Bureau, contrairement au fait de la
--    prendre en charge ou de la commenter).
-- ---------------------------------------------------------------------
create table if not exists public.project_task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  texte text not null,
  complete boolean not null default false,
  ordre integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.project_task_checklist_items enable row level security;

drop policy if exists "project_task_checklist_items select" on public.project_task_checklist_items;
create policy "project_task_checklist_items select" on public.project_task_checklist_items for select to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());
drop policy if exists "project_task_checklist_items insert" on public.project_task_checklist_items;
create policy "project_task_checklist_items insert" on public.project_task_checklist_items for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_bureau());
drop policy if exists "project_task_checklist_items update" on public.project_task_checklist_items;
create policy "project_task_checklist_items update" on public.project_task_checklist_items for update to authenticated
  using (association_id = public.current_association_id() and public.is_bureau())
  with check (association_id = public.current_association_id() and public.is_bureau());
drop policy if exists "project_task_checklist_items delete" on public.project_task_checklist_items;
create policy "project_task_checklist_items delete" on public.project_task_checklist_items for delete to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());

-- ---------------------------------------------------------------------
-- 3) Commentaires de tâche — Bureau en accès direct (RLS) ; un adhérent
--    simple ne peut lire/écrire que sur SA PROPRE tâche assignée, via
--    les RPC commentaires_de_ma_tache()/commenter_ma_tache() plus bas
--    (aucune policy RLS élargie sur la table elle-même).
-- ---------------------------------------------------------------------
create table if not exists public.project_task_comments (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  auteur_id uuid references public.profiles(id) on delete set null,
  auteur_nom text,
  contenu text not null,
  created_at timestamptz not null default now()
);

alter table public.project_task_comments enable row level security;

drop policy if exists "project_task_comments select bureau" on public.project_task_comments;
create policy "project_task_comments select bureau" on public.project_task_comments for select to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());
drop policy if exists "project_task_comments insert bureau" on public.project_task_comments;
create policy "project_task_comments insert bureau" on public.project_task_comments for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_bureau());
drop policy if exists "project_task_comments delete bureau" on public.project_task_comments;
create policy "project_task_comments delete bureau" on public.project_task_comments for delete to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());

-- Réutilise notify_mentions() telle quelle (Vie associative, 2026-09-29
-- 3e vague) — seul ce trigger wrapper est nouveau.
create or replace function public.trg_notify_task_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.notify_mentions(new.contenu, new.association_id, new.auteur_id, new.auteur_nom, ' vous a mentionné dans une tâche de projet');
  return new;
end;
$fn$;

drop trigger if exists trg_notify_task_comment_mentions on public.project_task_comments;
create trigger trg_notify_task_comment_mentions
  after insert on public.project_task_comments
  for each row execute function public.trg_notify_task_comment_mentions();

-- ---------------------------------------------------------------------
-- 4) Badges de reconnaissance — nouveau, rien à réutiliser (aucun
--    système de badges de membre n'existait avant ce complément). Un
--    seul type cette vague : "pilier_projet" (bénévole ayant complété
--    au moins associations.projet_pilier_seuil_taches tâches sur un même
--    projet). projet_nom dénormalisé pour que l'adhérent puisse voir ses
--    propres badges sans avoir besoin d'un accès en lecture à `projects`
--    (réservée au Bureau).
-- ---------------------------------------------------------------------
create table if not exists public.member_badges (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  badge_code text not null check (badge_code in ('pilier_projet')),
  projet_id uuid references public.projects(id) on delete cascade,
  projet_nom text,
  attribue_le timestamptz not null default now(),
  unique (member_id, badge_code, projet_id)
);

alter table public.member_badges enable row level security;

drop policy if exists "member_badges select bureau" on public.member_badges;
create policy "member_badges select bureau" on public.member_badges for select to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());
drop policy if exists "member_badges select self" on public.member_badges;
create policy "member_badges select self" on public.member_badges for select to authenticated
  using (association_id = public.current_association_id() and member_id = public.current_member_id());

comment on table public.member_badges is
  'Reconnaissance automatique des bénévoles. Aucune policy insert/update/delete : seul le trigger trg_verifier_badge_pilier (security definer) y écrit.';

-- Attribution automatique : se déclenche quand une tâche passe à
-- "termine" avec un assigné, peu importe le chemin (Bureau via le
-- Kanban, ou un adhérent via marquer_ma_tache_terminee() plus bas) —
-- centralisé ici plutôt que dupliqué dans chaque point d'entrée.
create or replace function public.trg_verifier_badge_pilier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_projet record;
  v_seuil integer;
  v_nb_terminees integer;
  v_deja boolean;
begin
  if new.colonne = 'termine' and coalesce(old.colonne, '') is distinct from 'termine' and new.assigne_id is not null then
    select * into v_projet from public.projects where id = new.project_id;
    if v_projet is null then return new; end if;

    select coalesce(projet_pilier_seuil_taches, 3) into v_seuil from public.associations where id = new.association_id;
    select count(*) into v_nb_terminees from public.project_tasks
      where project_id = new.project_id and assigne_id = new.assigne_id and colonne = 'termine';

    if v_nb_terminees >= v_seuil then
      select exists(
        select 1 from public.member_badges
        where member_id = new.assigne_id and badge_code = 'pilier_projet' and projet_id = new.project_id
      ) into v_deja;
      if not v_deja then
        insert into public.member_badges (association_id, member_id, badge_code, projet_id, projet_nom)
        values (new.association_id, new.assigne_id, 'pilier_projet', new.project_id, v_projet.nom);
      end if;
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_project_task_badge_pilier on public.project_tasks;
create trigger trg_project_task_badge_pilier
  after update on public.project_tasks
  for each row execute function public.trg_verifier_badge_pilier();

-- ---------------------------------------------------------------------
-- 5) Modèles de projet — dupliquer_projet_depuis_modele() : copie le
--    projet, ses lignes budgétaires, ses jalons et ses tâches (avec
--    remappage des dépendances entre tâches), réservée au Bureau.
-- ---------------------------------------------------------------------
create or replace function public.dupliquer_projet_depuis_modele(
  p_modele_id uuid,
  p_nouveau_nom text
)
returns table(status text, nouveau_projet_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_modele record;
  v_nouveau_id uuid;
  v_line record;
  v_milestone record;
  v_task record;
  v_new_task_id uuid;
  v_id_map jsonb := '{}'::jsonb;
  v_new_deps uuid[];
  v_dep uuid;
begin
  if not public.is_bureau() then
    return query select 'non_autorise'::text, null::uuid;
    return;
  end if;

  select * into v_modele from public.projects p where p.id = p_modele_id and p.association_id = public.current_association_id();
  if v_modele is null then
    return query select 'introuvable'::text, null::uuid;
    return;
  end if;
  if not coalesce(v_modele.est_modele, false) then
    return query select 'pas_un_modele'::text, null::uuid;
    return;
  end if;
  if p_nouveau_nom is null or length(trim(p_nouveau_nom)) = 0 then
    return query select 'nom_requis'::text, null::uuid;
    return;
  end if;

  insert into public.projects (association_id, nom, description, responsable_id, categorie, priorite, statut, sponsor, notes, budget_prevu)
  values (v_modele.association_id, trim(p_nouveau_nom), v_modele.description, v_modele.responsable_id, v_modele.categorie, v_modele.priorite, 'actif', v_modele.sponsor, v_modele.notes, 0)
  returning id into v_nouveau_id;

  for v_line in select * from public.project_budget_lines where project_id = p_modele_id order by ordre loop
    insert into public.project_budget_lines (association_id, project_id, categorie, libelle, montant_prevu, ordre)
    values (v_modele.association_id, v_nouveau_id, v_line.categorie, v_line.libelle, v_line.montant_prevu, v_line.ordre);
  end loop;

  for v_milestone in select * from public.project_milestones where project_id = p_modele_id order by ordre loop
    insert into public.project_milestones (association_id, project_id, titre, date_cible, statut, ordre)
    values (v_modele.association_id, v_nouveau_id, v_milestone.titre, null, 'a_venir', v_milestone.ordre);
  end loop;

  -- Première passe : crée chaque tâche (sans dépendances) et retient la
  -- correspondance ancien id -> nouvel id.
  for v_task in select * from public.project_tasks where project_id = p_modele_id order by created_at loop
    insert into public.project_tasks (association_id, project_id, titre, assigne_id, date_debut, echeance, colonne, pourcentage, dependances, recurrence)
    values (v_modele.association_id, v_nouveau_id, v_task.titre, null, null, null, 'a_faire', 0, '{}', v_task.recurrence)
    returning id into v_new_task_id;
    v_id_map := v_id_map || jsonb_build_object(v_task.id::text, v_new_task_id::text);
  end loop;

  -- Deuxième passe : remappe les dépendances maintenant que tous les
  -- nouveaux id existent.
  for v_task in select * from public.project_tasks where project_id = p_modele_id and dependances is not null and array_length(dependances, 1) > 0 loop
    v_new_deps := '{}';
    foreach v_dep in array v_task.dependances loop
      if v_id_map ? v_dep::text then
        v_new_deps := array_append(v_new_deps, (v_id_map ->> v_dep::text)::uuid);
      end if;
    end loop;
    if array_length(v_new_deps, 1) > 0 then
      update public.project_tasks set dependances = v_new_deps
        where id = (v_id_map ->> v_task.id::text)::uuid;
    end if;
  end loop;

  return query select 'cree'::text, v_nouveau_id;
end;
$fn$;

comment on function public.dupliquer_projet_depuis_modele(uuid, text) is
  'Crée un nouveau projet actif à partir d''un projet marqué est_modele=true : copie les lignes budgétaires, les jalons (dates réinitialisées) et les tâches (assignations réinitialisées, dépendances remappées). Réservé au Bureau. Codes retournés : non_autorise, introuvable, pas_un_modele, nom_requis, cree.';

grant execute on function public.dupliquer_projet_depuis_modele(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Bénévolat en libre-service — un adhérent ne peut ni lire ni écrire
--    project_tasks directement (RLS Bureau uniquement, inchangée), mais
--    ces RPC lui donnent un accès étroit et contrôlé : voir les tâches
--    non assignées d'un projet actif, voir SES tâches, se porter
--    volontaire pour une tâche libre, marquer SA tâche terminée.
-- ---------------------------------------------------------------------
create or replace function public.taches_disponibles_benevolat()
returns table(task_id uuid, titre text, echeance date, projet_id uuid, projet_nom text)
language sql
security definer
stable
set search_path = ''
as $fn$
  select pt.id, pt.titre, pt.echeance, pt.project_id, p.nom
  from public.project_tasks pt
  join public.projects p on p.id = pt.project_id
  where pt.association_id = public.current_association_id()
    and pt.assigne_id is null
    and pt.colonne <> 'termine'
    and p.statut = 'actif'
  order by pt.echeance nulls last;
$fn$;

comment on function public.taches_disponibles_benevolat() is
  'Tâches non assignées, sur un projet actif, de l''association de l''adhérent connecté — visibles par n''importe quel adhérent comme occasions de bénévolat (aucun accès direct à project_tasks nécessaire).';

grant execute on function public.taches_disponibles_benevolat() to authenticated;

create or replace function public.mes_taches_projet()
returns table(task_id uuid, titre text, echeance date, date_debut date, pourcentage integer, colonne text, projet_id uuid, projet_nom text)
language sql
security definer
stable
set search_path = ''
as $fn$
  select pt.id, pt.titre, pt.echeance, pt.date_debut, pt.pourcentage, pt.colonne, pt.project_id, p.nom
  from public.project_tasks pt
  join public.projects p on p.id = pt.project_id
  where pt.assigne_id = public.current_member_id()
    and pt.association_id = public.current_association_id()
  order by pt.echeance nulls last;
$fn$;

grant execute on function public.mes_taches_projet() to authenticated;

create or replace function public.se_porter_volontaire(p_task_id uuid)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_task record;
  v_projet record;
begin
  if v_member_id is null then
    return query select 'non_autorise'::text; return;
  end if;

  select * into v_task from public.project_tasks where id = p_task_id and association_id = public.current_association_id();
  if v_task is null then
    return query select 'introuvable'::text; return;
  end if;

  select * into v_projet from public.projects where id = v_task.project_id;
  if v_projet is null or v_projet.statut <> 'actif' then
    return query select 'projet_inactif'::text; return;
  end if;

  update public.project_tasks set assigne_id = v_member_id
    where id = p_task_id and assigne_id is null;
  if not found then
    return query select 'deja_prise'::text; return;
  end if;

  return query select 'inscrit'::text;
end;
$fn$;

comment on function public.se_porter_volontaire(uuid) is
  'Un adhérent se porte volontaire pour une tâche non assignée (WHERE assigne_id is null protège contre une prise simultanée par deux personnes). Codes retournés : non_autorise, introuvable, projet_inactif, deja_prise, inscrit.';

grant execute on function public.se_porter_volontaire(uuid) to authenticated;

create or replace function public.marquer_ma_tache_terminee(p_task_id uuid)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_task record;
begin
  if v_member_id is null then
    return query select 'non_autorise'::text; return;
  end if;

  select * into v_task from public.project_tasks
    where id = p_task_id and association_id = public.current_association_id() and assigne_id = v_member_id;
  if v_task is null then
    return query select 'introuvable'::text; return;
  end if;
  if v_task.colonne = 'termine' then
    return query select 'deja_termine'::text; return;
  end if;

  update public.project_tasks set colonne = 'termine', pourcentage = 100 where id = p_task_id;
  return query select 'termine'::text;
end;
$fn$;

comment on function public.marquer_ma_tache_terminee(uuid) is
  'Un adhérent marque comme terminée une tâche qui lui est assignée — déclenche normalement trg_project_task_badge_pilier (même trigger qu''un changement fait par le Bureau). Codes retournés : non_autorise, introuvable, deja_termine, termine.';

grant execute on function public.marquer_ma_tache_terminee(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7) Commentaires d'un adhérent sur SA tâche (le Bureau utilise l'accès
--    direct à project_task_comments — voir section 3 — ces deux RPC sont
--    la seule porte d'entrée pour un adhérent simple).
-- ---------------------------------------------------------------------
create or replace function public.commentaires_de_ma_tache(p_task_id uuid)
returns table(id uuid, auteur_nom text, contenu text, created_at timestamptz, est_moi boolean)
language sql
security definer
stable
set search_path = ''
as $fn$
  select c.id, c.auteur_nom, c.contenu, c.created_at, (c.auteur_id = auth.uid()) as est_moi
  from public.project_task_comments c
  join public.project_tasks pt on pt.id = c.task_id
  where c.task_id = p_task_id
    and pt.association_id = public.current_association_id()
    and pt.assigne_id = public.current_member_id()
  order by c.created_at;
$fn$;

grant execute on function public.commentaires_de_ma_tache(uuid) to authenticated;

create or replace function public.commenter_ma_tache(p_task_id uuid, p_contenu text)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_task record;
  v_nom text;
begin
  if v_member_id is null then
    return query select 'non_autorise'::text; return;
  end if;
  if p_contenu is null or length(trim(p_contenu)) = 0 then
    return query select 'vide'::text; return;
  end if;

  select * into v_task from public.project_tasks
    where id = p_task_id and association_id = public.current_association_id() and assigne_id = v_member_id;
  if v_task is null then
    return query select 'introuvable'::text; return;
  end if;

  select nom into v_nom from public.members where id = v_member_id;
  insert into public.project_task_comments (association_id, task_id, auteur_id, auteur_nom, contenu)
  values (public.current_association_id(), p_task_id, auth.uid(), v_nom, trim(p_contenu));

  return query select 'ajoute'::text; return;
end;
$fn$;

comment on function public.commenter_ma_tache(uuid, text) is
  'Un adhérent commente une tâche qui lui est assignée (déclenche notify_mentions() via trg_notify_task_comment_mentions si le texte contient "@Nom"). Codes retournés : non_autorise, vide, introuvable, ajoute.';

grant execute on function public.commenter_ma_tache(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8) Page de suivi public par projet — même patron exact que la vitrine
--    publique (sql/2026-09-28i_vitrine_publique.sql) : vues ne projetant
--    que des colonnes sûres, jamais de détail budgétaire ni de liste de
--    tâches. Double condition : associations.vitrine_active ET
--    projects.public_suivi — les deux doivent être vrais.
-- ---------------------------------------------------------------------
create or replace view public.public_project_progress as
select
  p.id as project_id,
  p.nom,
  p.description,
  p.statut,
  p.date_debut,
  p.date_fin_prevue,
  p.date_fin_reelle,
  coalesce((select round(avg(pt.pourcentage))::integer from public.project_tasks pt where pt.project_id = p.id), 0) as avancement,
  a.nom as association_nom,
  a.logo_url as association_logo_url,
  a.devise_texte as association_devise_texte
from public.projects p
join public.associations a on a.id = p.association_id
where a.vitrine_active = true and a.slug_public is not null and p.public_suivi = true;

create or replace view public.public_project_milestones as
select
  pm.project_id,
  pm.titre,
  pm.date_cible,
  pm.statut,
  pm.ordre
from public.project_milestones pm
join public.projects p on p.id = pm.project_id
join public.associations a on a.id = p.association_id
where a.vitrine_active = true and a.slug_public is not null and p.public_suivi = true;

grant select on public.public_project_progress to anon, authenticated;
grant select on public.public_project_milestones to anon, authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select est_modele, public_suivi from public.projects limit 1;
--   select recurrence from public.project_tasks limit 1;
--   select projet_pilier_seuil_taches from public.associations limit 1;
--   select projet_id from public.donations limit 1;
--   select proname from pg_proc where proname in (
--     'dupliquer_projet_depuis_modele','taches_disponibles_benevolat',
--     'mes_taches_projet','se_porter_volontaire','marquer_ma_tache_terminee',
--     'commentaires_de_ma_tache','commenter_ma_tache','trg_verifier_badge_pilier',
--     'trg_notify_task_comment_mentions'
--   ); -- 9 lignes
--   select viewname from pg_views where viewname in ('public_project_progress','public_project_milestones'); -- 2 lignes
-- =====================================================================
