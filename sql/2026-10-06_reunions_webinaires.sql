-- =====================================================================
-- Réunions & webinaires — nouvelle rubrique (conseils, assemblées,
-- webinaires publics), avec visioconférence Jitsi Meet (libre, gratuite)
-- =====================================================================
-- Suite de claude/covoiturage-webinaires-emploi-proposition.md, demandée
-- par l'utilisateur le 2026-10-06 ("implémentation totale"). Répond
-- directement à la question « peut-on tenir des réunions dans
-- l'application » : chaque réunion planifiée ici reçoit une salle Jitsi
-- Meet générée automatiquement (serveur public meet.jit.si, aucune clé
-- API ni compte requis) — le bouton "Rejoindre" l'ouvre dans un nouvel
-- onglet, exactement comme le fait déjà events.lien_reunion pour les
-- événements (voir Evenements.jsx) : aucune nouvelle dépendance npm.
--
-- Distincte des Événements (events) : un événement est souvent public/
-- social (brunch, collecte de fonds) avec billetterie, alors qu'une
-- réunion ici est un conseil, une assemblée ou un webinaire, avec ordre
-- du jour et procès-verbal archivés dans le coffre Documents existant
-- (doc_ordre_jour_id / doc_pv_id, voir DOC_CATEGORY_KEY_MAP App.jsx).
--
-- SIMPLIFICATIONS ASSUMÉES (à ajuster sur demande) :
--   - Visioconférence : lien ouvert dans un nouvel onglet, PAS de fenêtre
--     intégrée (iframe) dans l'application cette vague — plus simple et
--     plus fiable (évite les soucis de permission caméra/micro dans une
--     iframe tierce). Une intégration "dans la fenêtre" via l'API IFrame
--     de Jitsi reste possible plus tard si souhaité.
--   - Présence : table dédiée meeting_rsvps (confirmé/décliné/présent),
--     INDÉPENDANTE du système de présences existant (Presences.jsx,
--     SEANCES de tontine/collation) pour ne rien risquer de casser sur
--     ce module déjà en place.
--   - Planification réservée au Bureau (comme events), y compris pour un
--     webinaire public.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Table meetings
-- ---------------------------------------------------------------------
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  titre text not null,
  type_reunion text not null default 'conseil',
  date_heure timestamptz not null,
  lien_visio text,
  doc_ordre_jour_id uuid references public.documents(id) on delete set null,
  doc_pv_id uuid references public.documents(id) on delete set null,
  statut text not null default 'planifiee',
  notes text,
  created_by uuid references public.members(id),
  created_at timestamptz not null default now()
);
alter table public.meetings drop constraint if exists meetings_type_reunion_check;
alter table public.meetings add constraint meetings_type_reunion_check
  check (type_reunion in ('conseil', 'assemblee_generale', 'comite', 'webinaire_public'));
alter table public.meetings drop constraint if exists meetings_statut_check;
alter table public.meetings add constraint meetings_statut_check
  check (statut in ('planifiee', 'terminee', 'annulee'));

create index if not exists meetings_assoc_idx on public.meetings(association_id);

comment on table public.meetings is
  'Réunions & webinaires (conseil, assemblée générale, comité, webinaire public) — distincte de events ; lien_visio généré côté client (salle Jitsi Meet publique).';

-- ---------------------------------------------------------------------
-- 2) Table meeting_rsvps — présence/confirmation, indépendante de
--    Presences.jsx
-- ---------------------------------------------------------------------
create table if not exists public.meeting_rsvps (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  statut text not null default 'confirme',
  updated_at timestamptz not null default now(),
  unique (meeting_id, member_id)
);
alter table public.meeting_rsvps drop constraint if exists meeting_rsvps_statut_check;
alter table public.meeting_rsvps add constraint meeting_rsvps_statut_check
  check (statut in ('confirme', 'decline', 'present'));

create index if not exists meeting_rsvps_meeting_idx on public.meeting_rsvps(meeting_id);

-- ---------------------------------------------------------------------
-- 3) RLS
-- ---------------------------------------------------------------------
alter table public.meetings enable row level security;
alter table public.meeting_rsvps enable row level security;

drop policy if exists "meetings select" on public.meetings;
create policy "meetings select" on public.meetings for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "meetings insert bureau" on public.meetings;
create policy "meetings insert bureau" on public.meetings for insert to authenticated
  with check (association_id = public.current_association_id() and public.is_bureau());
drop policy if exists "meetings update bureau" on public.meetings;
create policy "meetings update bureau" on public.meetings for update to authenticated
  using (association_id = public.current_association_id() and public.is_bureau())
  with check (association_id = public.current_association_id() and public.is_bureau());
drop policy if exists "meetings delete bureau" on public.meetings;
create policy "meetings delete bureau" on public.meetings for delete to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());

drop policy if exists "meeting_rsvps select" on public.meeting_rsvps;
create policy "meeting_rsvps select" on public.meeting_rsvps for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "meeting_rsvps upsert self" on public.meeting_rsvps;
create policy "meeting_rsvps upsert self" on public.meeting_rsvps for insert to authenticated
  with check (association_id = public.current_association_id() and member_id = public.current_member_id());
drop policy if exists "meeting_rsvps update self" on public.meeting_rsvps;
create policy "meeting_rsvps update self" on public.meeting_rsvps for update to authenticated
  using (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()))
  with check (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()));
drop policy if exists "meeting_rsvps delete self" on public.meeting_rsvps;
create policy "meeting_rsvps delete self" on public.meeting_rsvps for delete to authenticated
  using (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()));

-- =====================================================================
-- Vérification rapide après exécution :
--   select table_name from information_schema.tables
--   where table_schema = 'public' and table_name in ('meetings', 'meeting_rsvps');
--   -- doit afficher 2 lignes
-- =====================================================================
