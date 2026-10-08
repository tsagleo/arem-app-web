-- =====================================================================
-- Présences — pointage par scan de carte de membre (2026-09-29)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois), indépendant
-- des scripts « Vie associative » du même jour.
--
-- Contexte (demande de l'utilisateur, avec décisions confirmées par
-- AskUserQuestion) : permettre à une personne du Bureau de pointer la
-- présence physique des membres en scannant leur carte de membre
-- numérique existante (le jeton members.verification_token déjà utilisé
-- pour la vitrine publique — sql/2026-09-28i_vitrine_publique.sql — et
-- déjà encodé en QR côté client dans MemberCardModal). Décisions :
--   • Portée : une séance de pointage peut être liée à un événement
--     existant OU être libre (réunion non planifiée) — event_id nullable.
--   • Départ : le suivi de l'heure de départ est OPTIONNEL et se décide
--     par séance (colonne suivre_depart), pas un comportement global fixe.
--   • Historique : chaque adhérent voit son propre historique de
--     présence dans « Mon espace » (RLS member_id = current_member_id()).
--
-- Distinction volontaire avec l'existant : tontine_presences et
-- collation_presences sont des registres de PAIEMENT (qui a payé sa
-- quote-part) — rien à voir avec une présence physique. Les tables
-- ci-dessous sont entièrement nouvelles et sans lien avec elles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) attendance_sessions — une « séance » de pointage
-- ---------------------------------------------------------------------
create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  titre text not null,
  date_seance date not null default current_date,
  suivre_depart boolean not null default false,
  cloturee boolean not null default false,
  cloturee_le timestamptz,
  created_by_profile_id uuid references public.profiles(id),
  created_by_nom text,
  created_at timestamptz not null default now()
);

comment on table public.attendance_sessions is
  'Séance de pointage de présence (Bureau uniquement). Peut être liée à un événement existant (event_id) ou libre. suivre_depart est un choix PAR séance : le départ n''est jamais pointé si ce drapeau est faux, même si le Bureau essaie. Suite « pointage de présence » (2026-09-29).';

create index if not exists attendance_sessions_association_idx on public.attendance_sessions (association_id, date_seance desc);
create index if not exists attendance_sessions_event_idx on public.attendance_sessions (event_id);

-- (La RLS de attendance_sessions est activée plus bas, après la création
-- de attendance_records — sa policy "select" a besoin que cette seconde
-- table existe déjà, voir section 3.)

-- ---------------------------------------------------------------------
-- 2) attendance_records — une présence pointée, pour un membre, dans
--    une séance
-- ---------------------------------------------------------------------
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  member_nom text,
  heure_arrivee timestamptz not null default now(),
  heure_depart timestamptz,
  pointe_par_profile_id uuid references public.profiles(id),
  pointe_par_nom text,
  methode text not null default 'scan' check (methode in ('scan', 'manuel')),
  created_at timestamptz not null default now(),
  unique (session_id, member_id)
);

comment on table public.attendance_records is
  'Présence pointée d''un membre pour une séance donnée (une ligne par membre par séance — voir contrainte unique). member_nom dénormalisé à l''insertion (même principe que posts.auteur_nom). Distinct de event_rsvps : un RSVP est une intention déclarée à l''avance, ceci est une présence physique constatée. Écrit exclusivement via la fonction checkin_member() ci-dessous. Suite « pointage de présence » (2026-09-29).';

create index if not exists attendance_records_session_idx on public.attendance_records (session_id);
create index if not exists attendance_records_member_idx on public.attendance_records (member_id);
create index if not exists attendance_records_association_idx on public.attendance_records (association_id);

alter table public.attendance_records enable row level security;

drop policy if exists "attendance_records select" on public.attendance_records;
drop policy if exists "attendance_records insert" on public.attendance_records;
drop policy if exists "attendance_records update" on public.attendance_records;
drop policy if exists "attendance_records delete" on public.attendance_records;

create policy "attendance_records select" on public.attendance_records for select to authenticated
  using (
    association_id = public.current_association_id()
    and (public.is_bureau() or member_id = public.current_member_id())
  );

-- Écritures directes réservées au Bureau (retrait d'un pointage erroné
-- par exemple) ; le chemin normal d'insertion/mise à jour passe par la
-- fonction checkin_member() (security definer, avec sa propre garde).
create policy "attendance_records insert" on public.attendance_records for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_bureau());

create policy "attendance_records update" on public.attendance_records for update to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());

create policy "attendance_records delete" on public.attendance_records for delete to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());

-- ---------------------------------------------------------------------
-- 3) RLS de attendance_sessions (activée seulement maintenant : sa
--    policy "select" référence attendance_records, créée juste au-dessus)
-- ---------------------------------------------------------------------
alter table public.attendance_sessions enable row level security;

drop policy if exists "attendance_sessions select" on public.attendance_sessions;
drop policy if exists "attendance_sessions insert" on public.attendance_sessions;
drop policy if exists "attendance_sessions update" on public.attendance_sessions;
drop policy if exists "attendance_sessions delete" on public.attendance_sessions;

-- Le Bureau voit toutes les séances de l'association ; un adhérent ne
-- voit que les séances où il a effectivement été pointé (jamais la
-- liste complète des séances passées/à venir — seulement « son »
-- historique, conformément à la demande).
create policy "attendance_sessions select" on public.attendance_sessions for select to authenticated
  using (
    association_id = public.current_association_id()
    and (
      public.is_bureau()
      or exists (
        select 1 from public.attendance_records ar
        where ar.session_id = attendance_sessions.id and ar.member_id = public.current_member_id()
      )
    )
  );

create policy "attendance_sessions insert" on public.attendance_sessions for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_bureau());

create policy "attendance_sessions update" on public.attendance_sessions for update to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());

create policy "attendance_sessions delete" on public.attendance_sessions for delete to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());

-- ---------------------------------------------------------------------
-- 4) checkin_member() — pointage (scan ou manuel), arrivée ou départ
-- ---------------------------------------------------------------------
-- security definer : contourne la RLS ci-dessus pour pouvoir insérer/
-- mettre à jour attendance_records même si l'appelant Bureau n'est pas
-- lui-même propriétaire de la ligne — garde explicite is_bureau() en
-- toute première instruction, car la RLS seule ne protège pas une
-- fonction security definer.
create or replace function public.checkin_member(
  p_session_id uuid,
  p_action text default 'arrivee',
  p_token uuid default null,
  p_member_id uuid default null
)
returns table(status text, member_id uuid, member_nom text, heure_arrivee timestamptz, heure_depart timestamptz)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_session record;
  v_member record;
  v_existing record;
  v_now timestamptz := now();
  v_pointeur_nom text;
begin
  if not public.is_bureau() then
    return query select 'non_autorise'::text, null::uuid, null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  select * into v_session from public.attendance_sessions s where s.id = p_session_id;
  if v_session is null or v_session.association_id <> public.current_association_id() then
    return query select 'session_introuvable'::text, null::uuid, null::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  if v_session.cloturee then
    return query select 'session_fermee'::text, null::uuid, null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if p_token is not null then
    select m.id, m.nom into v_member from public.members m
      where m.verification_token = p_token and m.association_id = v_session.association_id and m.statut <> 'Supprimé';
  elsif p_member_id is not null then
    select m.id, m.nom into v_member from public.members m
      where m.id = p_member_id and m.association_id = v_session.association_id and m.statut <> 'Supprimé';
  end if;

  if v_member is null then
    return query select 'carte_invalide'::text, null::uuid, null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  select * into v_existing from public.attendance_records ar where ar.session_id = p_session_id and ar.member_id = v_member.id;
  select p.nom_complet into v_pointeur_nom from public.profiles p where p.id = auth.uid();

  if p_action = 'depart' then
    if not v_session.suivre_depart then
      return query select 'depart_non_suivi'::text, v_member.id, v_member.nom, v_existing.heure_arrivee, v_existing.heure_depart;
      return;
    end if;
    if v_existing is null then
      return query select 'aucune_arrivee'::text, v_member.id, v_member.nom, null::timestamptz, null::timestamptz;
      return;
    end if;
    if v_existing.heure_depart is not null then
      return query select 'depart_deja_enregistre'::text, v_member.id, v_member.nom, v_existing.heure_arrivee, v_existing.heure_depart;
      return;
    end if;
    update public.attendance_records set heure_depart = v_now, pointe_par_profile_id = auth.uid(), pointe_par_nom = v_pointeur_nom
      where id = v_existing.id;
    return query select 'depart_enregistre'::text, v_member.id, v_member.nom, v_existing.heure_arrivee, v_now;
    return;
  end if;

  -- p_action = 'arrivee' (valeur par défaut)
  if v_existing is not null then
    return query select 'deja_present'::text, v_member.id, v_member.nom, v_existing.heure_arrivee, v_existing.heure_depart;
    return;
  end if;

  insert into public.attendance_records (session_id, association_id, member_id, member_nom, heure_arrivee, pointe_par_profile_id, pointe_par_nom, methode)
  values (p_session_id, v_session.association_id, v_member.id, v_member.nom, v_now, auth.uid(), v_pointeur_nom, case when p_token is not null then 'scan' else 'manuel' end);

  return query select 'arrivee_enregistree'::text, v_member.id, v_member.nom, v_now, null::timestamptz;
end;
$fn$;

comment on function public.checkin_member(uuid, text, uuid, uuid) is
  'Pointage d''une présence par scan (p_token = members.verification_token) ou recherche manuelle (p_member_id). p_action = ''arrivee'' (défaut) ou ''depart''. Garde is_bureau() interne obligatoire (security definer). Codes de statut retournés : non_autorise, session_introuvable, session_fermee, carte_invalide, deja_present, arrivee_enregistree, depart_non_suivi, aucune_arrivee, depart_deja_enregistre, depart_enregistre.';

grant execute on function public.checkin_member(uuid, text, uuid, uuid) to authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select count(*) from public.attendance_sessions; -- doit fonctionner (table vide)
--   select count(*) from public.attendance_records;   -- doit fonctionner (table vide)
--   select proname from pg_proc where proname = 'checkin_member';  -- 1 ligne
-- =====================================================================
