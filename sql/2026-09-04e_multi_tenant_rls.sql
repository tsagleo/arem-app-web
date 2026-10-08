-- =====================================================================
-- Cloisonnement multi-association réel (Row Level Security)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois), de préférence
-- en dehors des heures d'utilisation de l'application (il n'y a aucune
-- suppression de données, mais les règles d'accès changent d'un coup).
--
-- POURQUOI CE SCRIPT
-- Toutes les tables de l'application ont aujourd'hui une politique RLS
-- "accès complet" (using(true) with check(true), rôle "public"). La
-- base de données ne filtre donc rien par association : le cloisonnement
-- reposait entièrement sur le code de l'application qui pense à envoyer
-- le bon association_id à chaque requête — ce qui a déjà causé plusieurs
-- bugs cette session (association_id manquant sur plusieurs tables).
-- Ce script remplace TOUTES ces politiques par des règles qui vérifient
-- réellement, côté base de données, que chaque ligne appartient à
-- l'association de la personne connectée. C'est la fondation nécessaire
-- avant d'ouvrir la plateforme à plusieurs associations.
--
-- CE QUE CE SCRIPT FAIT, DANS L'ORDRE :
--   1. Ajoute la colonne association_id manquante sur `members` (jamais
--      créée jusqu'ici) + backfill si une seule association existe.
--   2. Crée des fonctions utilitaires (SECURITY DEFINER) qui déterminent,
--      pour la personne connectée : son association, son rôle.
--   3. Ajoute une colonne association_id sur `activity_log` (Journal
--      d'activité) + un déclencheur qui la déduit automatiquement du
--      contenu déjà enregistré (`details`), sans toucher au déclencheur
--      existant qui alimente cette table (que ce script ne connaît pas
--      et ne modifie donc pas) + backfill des lignes déjà existantes.
--   4. Recrée, table par table, des politiques RLS scopées par
--      association (et par rôle quand c'était déjà le comportement de
--      l'application).
--   5. Fait de même pour le bucket de stockage "documents" (les fichiers
--      y sont déjà rangés sous un dossier nommé d'après l'association :
--      <association_id>/<fichier>).
--
-- CE QUE CE SCRIPT NE FAIT PAS (limites connues, à traiter séparément) :
--   - Le bucket de stockage "avatars" (photos de profil) n'est pas
--     scopé ici : ses chemins ne contiennent pas l'association_id, une
--     règle fiable demanderait une jointure vers `members` plus délicate
--     à valider sans accès direct à la base — à traiter dans un script
--     séparé si besoin.
--   - La création d'une association reste ouverte à tout compte
--     connecté (l'auto-inscription actuelle crée une association) :
--     ce comportement changera avec le futur système "rejoindre une
--     association via un code" (choisi comme prochaine étape), pas
--     avec ce script-ci qui ne touche qu'à l'isolation des données.
--   - Les restrictions fines par rubrique (ex. un "responsable de la
--     tontine" ne devrait modifier que la tontine, pas les fonds
--     d'urgence) restent uniquement appliquées côté interface, comme
--     aujourd'hui — ce script garantit seulement qu'aucune donnée
--     d'une AUTRE association n'est accessible, pas les permissions
--     fines à l'intérieur d'une même association.
-- =====================================================================


-- =====================================================================
-- 1) Colonne association_id manquante sur `members`
-- =====================================================================
-- Comme pour tontine_seances, fonds_depenses et fonds_recouvrements
-- plus tôt cette session, `members` n'a jamais eu de colonne
-- association_id. Le code de l'application vient d'être corrigé pour
-- l'envoyer désormais à chaque nouvel adhérent ; ce script ajoute la
-- colonne et remplit les lignes déjà existantes UNIQUEMENT si une seule
-- association existe dans le système (cas du compte de test AREM) —
-- sinon, par prudence, les anciennes lignes restent à NULL et il faudra
-- les rattacher manuellement à la bonne association avant que les
-- règles ci-dessous ne s'appliquent pleinement à elles.

alter table members add column if not exists association_id uuid references associations(id);

update members
set association_id = (select id from associations limit 1)
where association_id is null and (select count(*) from associations) = 1;

-- Vérification : doit afficher 0 si une seule association existe.
select count(*) as membres_sans_association from members where association_id is null;


-- =====================================================================
-- 2) Fonctions utilitaires (déterminent qui est la personne connectée)
-- =====================================================================
-- SECURITY DEFINER : ces fonctions s'exécutent avec les droits de leur
-- propriétaire, ce qui leur permet de lire `profiles` MÊME SI les
-- politiques RLS de `profiles` (définies plus bas) ne l'autoriseraient
-- pas directement pour la personne connectée — sans ce mécanisme, les
-- politiques de `profiles` et ces fonctions se bloqueraient l'une
-- l'autre (référence circulaire).

create or replace function current_association_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select association_id from profiles where id = auth.uid();
$$;

create or replace function current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() = 'super_admin', false);
$$;

create or replace function is_bureau()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier'), false);
$$;

-- "Personnel" de l'association au sens large : bureau + responsable de
-- rubrique (les deux rôles qui peuvent, selon l'écran, enregistrer des
-- paiements/attributions pour le compte de l'association).
create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier', 'responsable_rubrique'), false);
$$;

-- member_id lié au profil connecté (utile pour les actions "en mon nom
-- propre" : s'inscrire à un événement, voter) — utilise SECURITY
-- DEFINER pour la même raison que les fonctions ci-dessus.
create or replace function current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select member_id from profiles where id = auth.uid();
$$;


-- =====================================================================
-- 3) Journal d'activité (activity_log) : colonne association_id déduite
--    automatiquement + backfill
-- =====================================================================
-- La table activity_log est alimentée par un déclencheur existant que
-- ce script ne connaît pas et ne modifie pas. On ajoute ici un SECOND
-- déclencheur, indépendant, qui s'exécute juste avant l'insertion et
-- déduit l'association_id à partir du contenu déjà capturé dans
-- `details` (qui contient toujours une copie de la ligne avant/après,
-- donc son association_id quand la table concernée en a une).

alter table activity_log add column if not exists association_id uuid;

create or replace function jrn_backfill_association_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assoc uuid;
begin
  -- 1) Cas général : la table journalisée a elle-même une colonne
  --    association_id, présente dans le "avant" ou le "après" capturé.
  v_assoc := coalesce(
    (new.details -> 'nouveau' ->> 'association_id')::uuid,
    (new.details -> 'ancien' ->> 'association_id')::uuid
  );

  -- 2) Cas particuliers : tables sans association_id propre, déduite
  --    via la table parente.
  if v_assoc is null then
    if new.table_name = 'loan_repayments' then
      select l.association_id into v_assoc from loans l
        where l.id = coalesce((new.details -> 'nouveau' ->> 'loan_id')::uuid, (new.details -> 'ancien' ->> 'loan_id')::uuid);
    elsif new.table_name in ('election_candidats', 'election_votes') then
      select e.association_id into v_assoc from elections e
        where e.id = coalesce((new.details -> 'nouveau' ->> 'election_id')::uuid, (new.details -> 'ancien' ->> 'election_id')::uuid);
    elsif new.table_name in ('tontine_presences', 'collation_presences') then
      select m.association_id into v_assoc from members m
        where m.id = coalesce((new.details -> 'nouveau' ->> 'member_id')::uuid, (new.details -> 'ancien' ->> 'member_id')::uuid);
    end if;
  end if;

  new.association_id := v_assoc;
  return new;
end;
$$;

drop trigger if exists jrn_backfill_association_id_trg on activity_log;
create trigger jrn_backfill_association_id_trg
  before insert on activity_log
  for each row execute function jrn_backfill_association_id();

-- Backfill des entrées déjà existantes (même logique, appliquée une fois).
update activity_log
set association_id = coalesce(
  (details -> 'nouveau' ->> 'association_id')::uuid,
  (details -> 'ancien' ->> 'association_id')::uuid
)
where association_id is null;

update activity_log a
set association_id = l.association_id
from loans l
where a.association_id is null and a.table_name = 'loan_repayments'
  and l.id = coalesce((a.details -> 'nouveau' ->> 'loan_id')::uuid, (a.details -> 'ancien' ->> 'loan_id')::uuid);

update activity_log a
set association_id = e.association_id
from elections e
where a.association_id is null and a.table_name in ('election_candidats', 'election_votes')
  and e.id = coalesce((a.details -> 'nouveau' ->> 'election_id')::uuid, (a.details -> 'ancien' ->> 'election_id')::uuid);

update activity_log a
set association_id = m.association_id
from members m
where a.association_id is null and a.table_name in ('tontine_presences', 'collation_presences')
  and m.id = coalesce((a.details -> 'nouveau' ->> 'member_id')::uuid, (a.details -> 'ancien' ->> 'member_id')::uuid);

-- Vérification : entrées dont l'association n'a pas pu être déduite
-- (resteront visibles au super-administrateur uniquement — voir plus bas).
select count(*) as entrees_journal_sans_association from activity_log where association_id is null;


-- =====================================================================
-- 4) Politiques RLS — remplace "accès complet" par un cloisonnement réel
-- =====================================================================
-- Convention commune à toutes les tables ci-dessous :
--   - Lecture (SELECT) : limitée à sa propre association (+ super-admin).
--   - Écriture (INSERT/UPDATE/DELETE) : limitée à sa propre association
--     ET au(x) rôle(s) qui, dans l'application, déclenchent réellement
--     ces écritures (voir commentaire par table).
--   - Rôle "public" retiré partout : seules les personnes CONNECTÉES
--     (to authenticated) ont accès — plus aucun accès anonyme.

-- ---------- associations ----------
drop policy if exists "accès complet - associations" on associations;
drop policy if exists "associations select" on associations;
drop policy if exists "associations insert" on associations;
drop policy if exists "associations update" on associations;
drop policy if exists "associations delete" on associations;
alter table associations enable row level security;

create policy "associations select" on associations for select to authenticated
  using (id = current_association_id() or is_super_admin());
-- Reste ouvert pour l'instant : l'auto-inscription actuelle crée une
-- association pour tout nouveau compte (sera restreint quand le flux
-- "rejoindre via un code" remplacera l'auto-inscription).
create policy "associations insert" on associations for insert to authenticated
  with check (true);
create policy "associations update" on associations for update to authenticated
  using ((id = current_association_id() and is_bureau()) or is_super_admin())
  with check ((id = current_association_id() and is_bureau()) or is_super_admin());
create policy "associations delete" on associations for delete to authenticated
  using (is_super_admin());

-- ---------- subscriptions (plan/statut d'abonnement) ----------
drop policy if exists "accès complet - subscriptions" on subscriptions;
drop policy if exists "subscriptions select" on subscriptions;
drop policy if exists "subscriptions insert" on subscriptions;
drop policy if exists "subscriptions update" on subscriptions;
drop policy if exists "subscriptions delete" on subscriptions;
alter table subscriptions enable row level security;

create policy "subscriptions select" on subscriptions for select to authenticated
  using (association_id = current_association_id() or is_super_admin());
-- Autorise la création de l'abonnement d'essai automatique à la création
-- d'une association (une seule ligne d'essai par association, jamais un
-- autre plan) — le passage à un plan payant reste réservé au super-admin.
create policy "subscriptions insert" on subscriptions for insert to authenticated
  with check (
    is_super_admin()
    or (plan = 'essai' and not exists (select 1 from subscriptions s where s.association_id = subscriptions.association_id))
  );
create policy "subscriptions update" on subscriptions for update to authenticated
  using (is_super_admin()) with check (is_super_admin());
create policy "subscriptions delete" on subscriptions for delete to authenticated
  using (is_super_admin());

-- ---------- profiles (comptes de connexion) ----------
drop policy if exists "accès complet - profiles" on profiles;
drop policy if exists "profiles select" on profiles;
drop policy if exists "profiles insert" on profiles;
drop policy if exists "profiles update" on profiles;
drop policy if exists "profiles delete" on profiles;
alter table profiles enable row level security;

create policy "profiles select" on profiles for select to authenticated
  using (id = auth.uid() or association_id = current_association_id() or is_super_admin());
create policy "profiles insert" on profiles for insert to authenticated
  with check (id = auth.uid());
create policy "profiles update" on profiles for update to authenticated
  using (id = auth.uid() or (association_id = current_association_id() and is_bureau()) or is_super_admin())
  with check (id = auth.uid() or (association_id = current_association_id() and is_bureau()) or is_super_admin());
create policy "profiles delete" on profiles for delete to authenticated
  using (is_super_admin());

-- ---------- members (annuaire des adhérents) ----------
drop policy if exists "accès complet - members" on members;
drop policy if exists "members select" on members;
drop policy if exists "members insert" on members;
drop policy if exists "members update" on members;
drop policy if exists "members delete" on members;
alter table members enable row level security;

create policy "members select" on members for select to authenticated
  using (association_id = current_association_id());
create policy "members insert" on members for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "members update" on members for update to authenticated
  using (association_id = current_association_id() and is_staff())
  with check (association_id = current_association_id() and is_staff());
create policy "members delete" on members for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

-- ---------- events / event_rsvps ----------
drop policy if exists "accès complet - events" on events;
drop policy if exists "events select" on events;
drop policy if exists "events insert" on events;
drop policy if exists "events update" on events;
drop policy if exists "events delete" on events;
alter table events enable row level security;

create policy "events select" on events for select to authenticated
  using (association_id = current_association_id());
create policy "events insert" on events for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "events update" on events for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "events delete" on events for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

drop policy if exists "accès complet - event_rsvps" on event_rsvps;
drop policy if exists "event_rsvps select" on event_rsvps;
drop policy if exists "event_rsvps insert" on event_rsvps;
drop policy if exists "event_rsvps update" on event_rsvps;
drop policy if exists "event_rsvps delete" on event_rsvps;
alter table event_rsvps enable row level security;

-- Un adhérent peut créer/modifier/retirer SA PROPRE inscription ; le
-- bureau peut gérer celles de tout le monde (retrait d'un participant,
-- suppression en cascade quand un événement est supprimé).
create policy "event_rsvps select" on event_rsvps for select to authenticated
  using (association_id = current_association_id());
create policy "event_rsvps insert" on event_rsvps for insert to authenticated
  with check (association_id = current_association_id() and (is_bureau() or member_id = current_member_id()));
create policy "event_rsvps update" on event_rsvps for update to authenticated
  using (association_id = current_association_id() and (is_bureau() or member_id = current_member_id()))
  with check (association_id = current_association_id() and (is_bureau() or member_id = current_member_id()));
create policy "event_rsvps delete" on event_rsvps for delete to authenticated
  using (association_id = current_association_id() and (is_bureau() or member_id = current_member_id()));

-- ---------- projects / project_tasks (Bureau uniquement) ----------
drop policy if exists "accès complet - projects" on projects;
drop policy if exists "projects select" on projects;
drop policy if exists "projects insert" on projects;
drop policy if exists "projects update" on projects;
drop policy if exists "projects delete" on projects;
alter table projects enable row level security;

create policy "projects select" on projects for select to authenticated
  using (association_id = current_association_id() and is_bureau());
create policy "projects insert" on projects for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "projects update" on projects for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "projects delete" on projects for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

drop policy if exists "accès complet - project_tasks" on project_tasks;
drop policy if exists "project_tasks select" on project_tasks;
drop policy if exists "project_tasks insert" on project_tasks;
drop policy if exists "project_tasks update" on project_tasks;
drop policy if exists "project_tasks delete" on project_tasks;
alter table project_tasks enable row level security;

create policy "project_tasks select" on project_tasks for select to authenticated
  using (association_id = current_association_id() and is_bureau());
create policy "project_tasks insert" on project_tasks for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "project_tasks update" on project_tasks for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "project_tasks delete" on project_tasks for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

-- ---------- donations / loans / loan_repayments (Bureau uniquement — États financiers) ----------
drop policy if exists "accès complet - donations" on donations;
drop policy if exists "donations select" on donations;
drop policy if exists "donations insert" on donations;
drop policy if exists "donations update" on donations;
drop policy if exists "donations delete" on donations;
alter table donations enable row level security;

create policy "donations select" on donations for select to authenticated
  using (association_id = current_association_id() and is_bureau());
create policy "donations insert" on donations for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "donations update" on donations for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "donations delete" on donations for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

drop policy if exists "accès complet - loans" on loans;
drop policy if exists "loans select" on loans;
drop policy if exists "loans insert" on loans;
drop policy if exists "loans update" on loans;
drop policy if exists "loans delete" on loans;
alter table loans enable row level security;

create policy "loans select" on loans for select to authenticated
  using (association_id = current_association_id() and is_bureau());
create policy "loans insert" on loans for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "loans update" on loans for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "loans delete" on loans for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

drop policy if exists "accès complet - loan_repayments" on loan_repayments;
drop policy if exists "loan_repayments select" on loan_repayments;
drop policy if exists "loan_repayments insert" on loan_repayments;
drop policy if exists "loan_repayments update" on loan_repayments;
drop policy if exists "loan_repayments delete" on loan_repayments;
alter table loan_repayments enable row level security;

create policy "loan_repayments select" on loan_repayments for select to authenticated
  using (is_bureau() and exists (select 1 from loans l where l.id = loan_repayments.loan_id and l.association_id = current_association_id()));
create policy "loan_repayments insert" on loan_repayments for insert to authenticated
  with check (is_bureau() and exists (select 1 from loans l where l.id = loan_repayments.loan_id and l.association_id = current_association_id()));
create policy "loan_repayments update" on loan_repayments for update to authenticated
  using (is_bureau() and exists (select 1 from loans l where l.id = loan_repayments.loan_id and l.association_id = current_association_id()))
  with check (is_bureau() and exists (select 1 from loans l where l.id = loan_repayments.loan_id and l.association_id = current_association_id()));
create policy "loan_repayments delete" on loan_repayments for delete to authenticated
  using (is_bureau() and exists (select 1 from loans l where l.id = loan_repayments.loan_id and l.association_id = current_association_id()));

-- ---------- governance_info / board_members / elections / election_candidats ----------
-- Lecture ouverte à tous les membres de l'association (Bureau + Adhérents
-- voient l'onglet Gouvernance) ; écriture réservée au Bureau.
drop policy if exists "accès complet - governance_info" on governance_info;
drop policy if exists "governance_info select" on governance_info;
drop policy if exists "governance_info insert" on governance_info;
drop policy if exists "governance_info update" on governance_info;
drop policy if exists "governance_info delete" on governance_info;
alter table governance_info enable row level security;

create policy "governance_info select" on governance_info for select to authenticated
  using (association_id = current_association_id());
create policy "governance_info insert" on governance_info for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "governance_info update" on governance_info for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "governance_info delete" on governance_info for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

drop policy if exists "accès complet - board_members" on board_members;
drop policy if exists "board_members select" on board_members;
drop policy if exists "board_members insert" on board_members;
drop policy if exists "board_members update" on board_members;
drop policy if exists "board_members delete" on board_members;
alter table board_members enable row level security;

create policy "board_members select" on board_members for select to authenticated
  using (association_id = current_association_id());
create policy "board_members insert" on board_members for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "board_members update" on board_members for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "board_members delete" on board_members for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

drop policy if exists "accès complet - elections" on elections;
drop policy if exists "elections select" on elections;
drop policy if exists "elections insert" on elections;
drop policy if exists "elections update" on elections;
drop policy if exists "elections delete" on elections;
alter table elections enable row level security;

create policy "elections select" on elections for select to authenticated
  using (association_id = current_association_id());
create policy "elections insert" on elections for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "elections update" on elections for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "elections delete" on elections for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

drop policy if exists "accès complet - election_candidats" on election_candidats;
drop policy if exists "election_candidats select" on election_candidats;
drop policy if exists "election_candidats insert" on election_candidats;
drop policy if exists "election_candidats update" on election_candidats;
drop policy if exists "election_candidats delete" on election_candidats;
alter table election_candidats enable row level security;

create policy "election_candidats select" on election_candidats for select to authenticated
  using (exists (select 1 from elections e where e.id = election_candidats.election_id and e.association_id = current_association_id()));
create policy "election_candidats insert" on election_candidats for insert to authenticated
  with check (is_bureau() and exists (select 1 from elections e where e.id = election_candidats.election_id and e.association_id = current_association_id()));
create policy "election_candidats update" on election_candidats for update to authenticated
  using (is_bureau() and exists (select 1 from elections e where e.id = election_candidats.election_id and e.association_id = current_association_id()))
  with check (is_bureau() and exists (select 1 from elections e where e.id = election_candidats.election_id and e.association_id = current_association_id()));
create policy "election_candidats delete" on election_candidats for delete to authenticated
  using (is_bureau() and exists (select 1 from elections e where e.id = election_candidats.election_id and e.association_id = current_association_id()));

-- election_votes : un adhérent vote pour lui-même (voter_member_id =
-- son propre member_id) ; la suppression (retrait d'un candidat/élection)
-- reste réservée au Bureau.
drop policy if exists "accès complet - election_votes" on election_votes;
drop policy if exists "election_votes select" on election_votes;
drop policy if exists "election_votes insert" on election_votes;
drop policy if exists "election_votes delete" on election_votes;
alter table election_votes enable row level security;

create policy "election_votes select" on election_votes for select to authenticated
  using (exists (select 1 from elections e where e.id = election_votes.election_id and e.association_id = current_association_id()));
create policy "election_votes insert" on election_votes for insert to authenticated
  with check (
    voter_member_id = current_member_id()
    and exists (select 1 from elections e where e.id = election_votes.election_id and e.association_id = current_association_id())
  );
create policy "election_votes delete" on election_votes for delete to authenticated
  using (is_bureau() and exists (select 1 from elections e where e.id = election_votes.election_id and e.association_id = current_association_id()));

-- ---------- posts (Fil d'actualité — Bureau publie, tous les membres lisent) ----------
drop policy if exists "accès complet - posts" on posts;
drop policy if exists "posts select" on posts;
drop policy if exists "posts insert" on posts;
drop policy if exists "posts update" on posts;
drop policy if exists "posts delete" on posts;
alter table posts enable row level security;

create policy "posts select" on posts for select to authenticated
  using (association_id = current_association_id());
create policy "posts insert" on posts for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "posts update" on posts for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "posts delete" on posts for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

-- ---------- tontine_seances / tontine_presences / collation_presences ----------
-- Lecture ouverte (un adhérent voit ses propres totaux dans "Mon
-- espace") ; écriture réservée au personnel (Bureau + responsable de
-- rubrique — la restriction fine à SA rubrique reste côté interface).
drop policy if exists "accès complet - tontine_seances" on tontine_seances;
drop policy if exists "tontine_seances select" on tontine_seances;
drop policy if exists "tontine_seances insert" on tontine_seances;
drop policy if exists "tontine_seances update" on tontine_seances;
drop policy if exists "tontine_seances delete" on tontine_seances;
alter table tontine_seances enable row level security;

create policy "tontine_seances select" on tontine_seances for select to authenticated
  using (association_id = current_association_id());
create policy "tontine_seances insert" on tontine_seances for insert to authenticated
  with check (association_id = current_association_id() and is_staff());
create policy "tontine_seances update" on tontine_seances for update to authenticated
  using (association_id = current_association_id() and is_staff())
  with check (association_id = current_association_id() and is_staff());
create policy "tontine_seances delete" on tontine_seances for delete to authenticated
  using (association_id = current_association_id() and is_staff());

drop policy if exists "accès complet - tontine_presences" on tontine_presences;
drop policy if exists "tontine_presences select" on tontine_presences;
drop policy if exists "tontine_presences insert" on tontine_presences;
drop policy if exists "tontine_presences update" on tontine_presences;
drop policy if exists "tontine_presences delete" on tontine_presences;
alter table tontine_presences enable row level security;

create policy "tontine_presences select" on tontine_presences for select to authenticated
  using (exists (select 1 from members m where m.id = tontine_presences.member_id and m.association_id = current_association_id()));
create policy "tontine_presences insert" on tontine_presences for insert to authenticated
  with check (is_staff() and exists (select 1 from members m where m.id = tontine_presences.member_id and m.association_id = current_association_id()));
create policy "tontine_presences update" on tontine_presences for update to authenticated
  using (is_staff() and exists (select 1 from members m where m.id = tontine_presences.member_id and m.association_id = current_association_id()))
  with check (is_staff() and exists (select 1 from members m where m.id = tontine_presences.member_id and m.association_id = current_association_id()));
create policy "tontine_presences delete" on tontine_presences for delete to authenticated
  using (is_staff() and exists (select 1 from members m where m.id = tontine_presences.member_id and m.association_id = current_association_id()));

drop policy if exists "accès complet - collation_presences" on collation_presences;
drop policy if exists "collation_presences select" on collation_presences;
drop policy if exists "collation_presences insert" on collation_presences;
drop policy if exists "collation_presences update" on collation_presences;
drop policy if exists "collation_presences delete" on collation_presences;
alter table collation_presences enable row level security;

create policy "collation_presences select" on collation_presences for select to authenticated
  using (exists (select 1 from members m where m.id = collation_presences.member_id and m.association_id = current_association_id()));
create policy "collation_presences insert" on collation_presences for insert to authenticated
  with check (is_staff() and exists (select 1 from members m where m.id = collation_presences.member_id and m.association_id = current_association_id()));
create policy "collation_presences update" on collation_presences for update to authenticated
  using (is_staff() and exists (select 1 from members m where m.id = collation_presences.member_id and m.association_id = current_association_id()))
  with check (is_staff() and exists (select 1 from members m where m.id = collation_presences.member_id and m.association_id = current_association_id()));
create policy "collation_presences delete" on collation_presences for delete to authenticated
  using (is_staff() and exists (select 1 from members m where m.id = collation_presences.member_id and m.association_id = current_association_id()));

-- ---------- fonds_depenses / fonds_recouvrements ----------
drop policy if exists "accès complet - fonds_depenses" on fonds_depenses;
drop policy if exists "fonds_depenses select" on fonds_depenses;
drop policy if exists "fonds_depenses insert" on fonds_depenses;
drop policy if exists "fonds_depenses update" on fonds_depenses;
drop policy if exists "fonds_depenses delete" on fonds_depenses;
alter table fonds_depenses enable row level security;

create policy "fonds_depenses select" on fonds_depenses for select to authenticated
  using (association_id = current_association_id());
create policy "fonds_depenses insert" on fonds_depenses for insert to authenticated
  with check (association_id = current_association_id() and is_staff());
create policy "fonds_depenses update" on fonds_depenses for update to authenticated
  using (association_id = current_association_id() and is_staff())
  with check (association_id = current_association_id() and is_staff());
create policy "fonds_depenses delete" on fonds_depenses for delete to authenticated
  using (association_id = current_association_id() and is_staff());

drop policy if exists "accès complet - fonds_recouvrements" on fonds_recouvrements;
drop policy if exists "fonds_recouvrements select" on fonds_recouvrements;
drop policy if exists "fonds_recouvrements insert" on fonds_recouvrements;
drop policy if exists "fonds_recouvrements update" on fonds_recouvrements;
drop policy if exists "fonds_recouvrements delete" on fonds_recouvrements;
alter table fonds_recouvrements enable row level security;

create policy "fonds_recouvrements select" on fonds_recouvrements for select to authenticated
  using (association_id = current_association_id());
create policy "fonds_recouvrements insert" on fonds_recouvrements for insert to authenticated
  with check (association_id = current_association_id() and is_staff());
create policy "fonds_recouvrements update" on fonds_recouvrements for update to authenticated
  using (association_id = current_association_id() and is_staff())
  with check (association_id = current_association_id() and is_staff());
create policy "fonds_recouvrements delete" on fonds_recouvrements for delete to authenticated
  using (association_id = current_association_id() and is_staff());

-- ---------- announcements ----------
drop policy if exists "accès complet - announcements" on announcements;
drop policy if exists "announcements select" on announcements;
drop policy if exists "announcements insert" on announcements;
drop policy if exists "announcements update" on announcements;
drop policy if exists "announcements delete" on announcements;
alter table announcements enable row level security;

create policy "announcements select" on announcements for select to authenticated
  using (association_id = current_association_id());
create policy "announcements insert" on announcements for insert to authenticated
  with check (association_id = current_association_id() and is_bureau());
create policy "announcements update" on announcements for update to authenticated
  using (association_id = current_association_id() and is_bureau())
  with check (association_id = current_association_id() and is_bureau());
create policy "announcements delete" on announcements for delete to authenticated
  using (association_id = current_association_id() and is_bureau());

-- ---------- documents ----------
drop policy if exists "accès complet - documents" on documents;
drop policy if exists "documents select" on documents;
drop policy if exists "documents insert" on documents;
drop policy if exists "documents update" on documents;
drop policy if exists "documents delete" on documents;
alter table documents enable row level security;

create policy "documents select" on documents for select to authenticated
  using (association_id = current_association_id());
create policy "documents insert" on documents for insert to authenticated
  with check (association_id = current_association_id() and is_staff());
create policy "documents update" on documents for update to authenticated
  using (association_id = current_association_id() and is_staff())
  with check (association_id = current_association_id() and is_staff());
create policy "documents delete" on documents for delete to authenticated
  using (association_id = current_association_id() and is_staff());

-- ---------- activity_log (Journal d'activité — Bureau uniquement) ----------
drop policy if exists "accès complet - activity_log" on activity_log;
drop policy if exists "activity_log select" on activity_log;
drop policy if exists "activity_log delete" on activity_log;
alter table activity_log enable row level security;

-- Les quelques entrées dont l'association n'a pas pu être déduite
-- automatiquement (voir section 3) restent visibles au super-admin
-- uniquement, plutôt que masquées définitivement ou exposées à tous.
-- Volontairement PAS de "or is_super_admin()" général ici : conforme à
-- la proposition d'architecture (voir doc), le super-admin n'a pas un
-- accès permanent aux données métier de chaque association — seulement
-- aux quelques entrées orphelines qu'aucune association ne réclame.
create policy "activity_log select" on activity_log for select to authenticated
  using ((association_id = current_association_id() and is_bureau()) or (association_id is null and is_super_admin()));
create policy "activity_log delete" on activity_log for delete to authenticated
  using (association_id = current_association_id() and is_bureau());
-- Pas de politique insert/update : ces lignes sont créées uniquement
-- par les déclencheurs automatiques (SECURITY DEFINER), jamais par
-- l'application elle-même.


-- =====================================================================
-- 5) Stockage (Storage) — bucket "documents"
-- =====================================================================
-- Les fichiers y sont déjà rangés sous un chemin commençant par
-- l'identifiant de l'association : <association_id>/<horodatage>_<nom>.
-- (voir handleFileUpload dans App.jsx). On peut donc s'appuyer dessus.

drop policy if exists "documents storage select" on storage.objects;
drop policy if exists "documents storage insert" on storage.objects;
drop policy if exists "documents storage update" on storage.objects;
drop policy if exists "documents storage delete" on storage.objects;

create policy "documents storage select" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = current_association_id()::text);
create policy "documents storage insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = current_association_id()::text and is_staff());
create policy "documents storage update" on storage.objects for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = current_association_id()::text and is_staff())
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = current_association_id()::text and is_staff());
create policy "documents storage delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = current_association_id()::text and is_staff());


-- =====================================================================
-- Vérifications rapides après exécution
-- =====================================================================
-- 1) Doit lister une politique par action (select/insert/update/delete)
--    pour chaque table listée ci-dessus, plus jamais de politique
--    "accès complet" nulle part :
--   select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by tablename, cmd;
--
-- 2) Rechargez l'application (F5) et vérifiez que tout fonctionne comme
--    avant pour votre compte AREM (tableau de bord, adhérents, projets,
--    événements, dons/prêts, documents, journal d'activité) : le
--    comportement pour une SEULE association ne doit pas changer.
--    Si un écran affiche soudainement "vide" ou une erreur de
--    permission, dites-le moi avec l'écran concerné — c'est probablement
--    une politique trop stricte à ajuster, pas une perte de données.
-- =====================================================================
