-- =====================================================================
-- Événements — modernisation (standards + bloc différenciant
-- communautaire) — 2026-09-30
-- =====================================================================
-- Suite de claude/evenements-modernisation-proposition.md. Arbitrage
-- retenu par l'utilisateur (AskUserQuestion, 2 questions, tout
-- sélectionné des deux côtés) :
--   Axe standards : structure et flexibilité (programme multi-sessions,
--     événements récurrents, catégories/recherche, liste d'attente),
--     billetterie enrichie (tarif membre/non-membre, remboursement à
--     l'annulation, billets nominatifs QR), le jour même (check-in,
--     export participants), communication et suivi (rappel push, sondage
--     de satisfaction, rapport de bilan).
--   Axe communautaire : bénévolat lié à l'événement, covoiturage entre
--     membres, page publique dédiée par événement, check-in connecté aux
--     présences.
--
-- SIMPLIFICATIONS ASSUMÉES (voir claude/evenements-modernisation-
-- proposition.md, section 4, pour le détail des arbitrages) :
--   - Le programme multi-sessions (event_sessions) est un AGENDA
--     INFORMATIF affiché sur la fiche événement — pas de RSVP séparé par
--     session cette vague : le RSVP global continue de gérer la
--     capacité, exactement comme aujourd'hui.
--   - La récurrence (events.recurrence) suit le même patron que les
--     tâches de projet (2026-09-30, modernisation Projets) :
--     déclenchée CÔTÉ CLIENT par une action Bureau (« Dupliquer pour la
--     prochaine occurrence »), aucune planification serveur.
--   - Le remboursement à l'annulation NE TOUCHE JAMAIS payment_
--     transactions, qui reste un registre immuable par conception (voir
--     sql/2026-09-10g_payment_transactions.sql, section 2 : « aucune
--     policy update/delete »). annuler_evenement() se contente de
--     constituer une liste de rappel (event_refund_queue) des paiements
--     concernés, que le Bureau traite manuellement hors app (remboursement
--     Stripe/Interac réel), exactement comme il traite déjà une demande
--     Interac à la main.
--   - Le sondage de satisfaction n'est PAS automatique/planifié : un
--     bouton « Créer un sondage de satisfaction » (Bureau, sur un
--     événement passé) pré-remplit un nouveau sondage via le mécanisme
--     normal du module Sondages (aucune nouvelle table/RPC nécessaire ici,
--     polls/poll_options existent déjà et leur RLS Bureau suffit).
--   - L'inscription publique (non-adhérent) sur la page dédiée d'un
--     événement est une PRISE DE COORDONNÉES, pas un paiement en ligne —
--     même patron que membership_requests : le Bureau la traite/contacte
--     la personne pour le paiement, hors app.
--   - Le covoiturage est un tableau d'offres/demandes SANS mise en
--     relation automatique — un bouton « Je suis intéressé(e) » notifie
--     l'offreur par push ; les coordonnées de contact ne transitent
--     jamais par cette fonctionnalité (les deux personnes se contactent
--     ensuite par leurs propres moyens).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Petit utilitaire réutilisable : notifier UN profil par push (même
-- patron pg_net + secret Vault que notify_mentions()/notify_urgent_
-- announcement_push(), mais ciblé sur un seul destinataire plutôt qu'une
-- association entière ou une liste de mentions). Évite de dupliquer le
-- boilerplate pg_net dans chacune des nouvelles fonctions ci-dessous.
-- ---------------------------------------------------------------------
create or replace function public.notify_profile(
  p_association_id uuid,
  p_profile_id uuid,
  p_title text,
  p_body text
) returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  internal_secret text;
begin
  if p_profile_id is null then
    return;
  end if;

  select decrypted_secret into internal_secret
    from vault.decrypted_secrets
    where name = 'push_internal_secret';
  if internal_secret is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://hqqvkwvobmesgwbdjdko.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', internal_secret
    ),
    body := jsonb_build_object(
      'association_id', p_association_id,
      'profile_ids', to_jsonb(array[p_profile_id]),
      'title', p_title,
      'body', p_body,
      'url', '/'
    )
  );
end;
$fn$;

comment on function public.notify_profile(uuid, uuid, text, text) is
  'Envoie une notification push à UN SEUL profil (même Edge Function/secret que notify_mentions), pour toute fonctionnalité qui ne cible qu''une personne (promotion de liste d''attente, intérêt covoiturage, etc.) sans dupliquer le boilerplate pg_net. Silencieux si aucune clé configurée.';

-- ---------------------------------------------------------------------
-- 1) Colonnes nouvelles sur events / event_rsvps
-- ---------------------------------------------------------------------
alter table public.events
  add column if not exists categorie text,
  add column if not exists recurrence text,
  add column if not exists prix_membre numeric,
  add column if not exists annule boolean not null default false,
  add column if not exists check_in_actif boolean not null default false,
  add column if not exists public_inscription boolean not null default false;

alter table public.events drop constraint if exists events_recurrence_check;
alter table public.events add constraint events_recurrence_check
  check (recurrence is null or recurrence in ('hebdomadaire', 'mensuel'));

comment on column public.events.categorie is 'Étiquette libre (ex. Collecte de fonds, Réunion, Social) pour le filtre/recherche côté client.';
comment on column public.events.recurrence is 'Si définie, un bouton Bureau propose de dupliquer l''événement pour la prochaine occurrence (échéance +7 jours ou +1 mois) — déclenché côté client, aucune planification serveur (même patron que project_tasks.recurrence).';
comment on column public.events.prix_membre is 'Tarif préférentiel adhérent, optionnel — si NULL, un adhérent paie le même prix (events.prix) qu''un non-membre.';
comment on column public.events.annule is 'Vrai si l''événement a été annulé via annuler_evenement() plutôt que supprimé — reste visible (grisé) avec un historique, contrairement à une suppression.';
comment on column public.events.check_in_actif is 'Vrai si le pointage à l''entrée (checkin_event_ticket) doit aussi créer une présence dans le module Présences — nécessite qu''une séance de pointage (attendance_sessions.event_id) soit liée à cet événement.';
comment on column public.events.public_inscription is 'Vrai si cet événement a une page publique dédiée avec inscription (event_public_registrations) — nécessite aussi associations.vitrine_active. Jamais public par défaut, choix du Bureau événement par événement.';

alter table public.event_rsvps
  add column if not exists billet_token uuid not null default gen_random_uuid(),
  add column if not exists checkin_le timestamptz,
  add column if not exists checkin_par uuid references public.profiles(id);

comment on column public.event_rsvps.billet_token is 'Jeton opaque du billet — sert au Bureau à retrouver/pointer une inscription à l''entrée (checkin_event_ticket), même principe que members.verification_token pour la carte de membre.';

create unique index if not exists event_rsvps_billet_token_idx on public.event_rsvps (billet_token);

-- ---------------------------------------------------------------------
-- 2) Programme multi-sessions (agenda informatif — voir note en tête de
--    fichier) — réservé au Bureau en écriture, lisible par tout adhérent
--    de l'association (même patron que event_reviews).
-- ---------------------------------------------------------------------
create table if not exists public.event_sessions (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  titre text not null,
  date_debut timestamptz,
  date_fin timestamptz,
  lieu text,
  description text,
  ordre integer not null default 0
);

alter table public.event_sessions enable row level security;

drop policy if exists "event_sessions select" on public.event_sessions;
create policy "event_sessions select" on public.event_sessions for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "event_sessions write bureau" on public.event_sessions;
create policy "event_sessions write bureau" on public.event_sessions for all to authenticated
  using (association_id = public.current_association_id() and public.is_bureau())
  with check (association_id = public.current_association_id() and public.is_bureau());

-- ---------------------------------------------------------------------
-- 3) Liste d'attente automatique — un adhérent rejoint/quitte lui-même
--    (RLS directe, même patron que event_rsvps), promotion automatique
--    à la première place libérée via trigger sur event_rsvps.
-- ---------------------------------------------------------------------
create table if not exists public.event_waitlist (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, member_id)
);

alter table public.event_waitlist enable row level security;

drop policy if exists "event_waitlist select" on public.event_waitlist;
create policy "event_waitlist select" on public.event_waitlist for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "event_waitlist insert self" on public.event_waitlist;
create policy "event_waitlist insert self" on public.event_waitlist for insert to authenticated
  with check (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()));
drop policy if exists "event_waitlist delete" on public.event_waitlist;
create policy "event_waitlist delete" on public.event_waitlist for delete to authenticated
  using (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()));

-- Se déclenche quand une inscription confirmée disparaît (suppression ou
-- passage à 'decline') : si l'événement a encore de la place et que la
-- liste d'attente n'est pas vide, promeut la personne en attente depuis
-- le plus longtemps en inscription confirmée, et la notifie par push.
create or replace function public.trg_promote_waitlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_event record;
  v_nb_confirmes integer;
  v_next record;
  v_profile_id uuid;
begin
  if (tg_op = 'DELETE' and old.statut <> 'confirme') then return old; end if;
  if (tg_op = 'UPDATE' and (old.statut <> 'confirme' or new.statut = 'confirme')) then return new; end if;

  select * into v_event from public.events e where e.id = coalesce(old.event_id, new.event_id);
  if v_event is null or v_event.capacite_max is null then
    return coalesce(new, old);
  end if;

  select count(*) into v_nb_confirmes from public.event_rsvps r where r.event_id = v_event.id and r.statut = 'confirme';
  if v_nb_confirmes >= v_event.capacite_max then
    return coalesce(new, old);
  end if;

  select * into v_next from public.event_waitlist w where w.event_id = v_event.id order by w.created_at limit 1;
  if v_next is null then
    return coalesce(new, old);
  end if;

  insert into public.event_rsvps (event_id, association_id, member_id, statut)
  values (v_event.id, v_event.association_id, v_next.member_id, 'confirme')
  on conflict do nothing;
  delete from public.event_waitlist where id = v_next.id;

  select p.id into v_profile_id from public.profiles p where p.member_id = v_next.member_id;
  perform public.notify_profile(v_event.association_id, v_profile_id, '🎟️ Une place s''est libérée', 'Vous êtes maintenant inscrit(e) à « ' || v_event.titre || ' ».');

  return coalesce(new, old);
end;
$fn$;

drop trigger if exists trg_event_rsvps_promote_waitlist on public.event_rsvps;
create trigger trg_event_rsvps_promote_waitlist
  after delete or update on public.event_rsvps
  for each row execute function public.trg_promote_waitlist();

-- ---------------------------------------------------------------------
-- 4) Check-in à l'entrée (billet nominatif) — réservé au Bureau. Si
--    events.check_in_actif est vrai et qu'une séance de pointage
--    (attendance_sessions.event_id) ouverte est liée à cet événement,
--    réutilise checkin_member() EXISTANT (Présences) plutôt que de
--    dupliquer sa logique — voir sql/2026-09-29_presences_pointage.sql.
-- ---------------------------------------------------------------------
create or replace function public.checkin_event_ticket(p_token uuid)
returns table(status text, member_nom text, event_titre text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_rsvp record;
  v_event record;
  v_member record;
  v_session record;
begin
  if not public.is_bureau() then
    return query select 'non_autorise'::text, null::text, null::text; return;
  end if;

  select * into v_rsvp from public.event_rsvps r where r.billet_token = p_token;
  if v_rsvp is null or v_rsvp.association_id <> public.current_association_id() then
    return query select 'introuvable'::text, null::text, null::text; return;
  end if;
  if v_rsvp.statut <> 'confirme' then
    return query select 'non_confirme'::text, null::text, null::text; return;
  end if;

  select * into v_event from public.events e where e.id = v_rsvp.event_id;
  select * into v_member from public.members m where m.id = v_rsvp.member_id;

  if v_rsvp.checkin_le is not null then
    return query select 'deja_valide'::text, v_member.nom, v_event.titre; return;
  end if;

  update public.event_rsvps set checkin_le = now(), checkin_par = auth.uid() where id = v_rsvp.id;

  if coalesce(v_event.check_in_actif, false) then
    select * into v_session from public.attendance_sessions s
      where s.event_id = v_event.id and s.cloturee = false
      order by s.created_at desc limit 1;
    if v_session is not null then
      perform public.checkin_member(v_session.id, 'arrivee', null, v_rsvp.member_id);
    end if;
  end if;

  return query select 'enregistre'::text, v_member.nom, v_event.titre;
end;
$fn$;

comment on function public.checkin_event_ticket(uuid) is
  'Pointe l''arrivée d''un participant à l''entrée d''un événement, à partir du jeton de son billet (event_rsvps.billet_token). Si l''événement a check_in_actif=true et qu''une séance de pointage Présences lui est liée (attendance_sessions.event_id, non close), crée aussi une présence via checkin_member() — pas de duplication de logique. Codes retournés : non_autorise, introuvable, non_confirme, deja_valide, enregistre.';

grant execute on function public.checkin_event_ticket(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Annulation d'un événement — distincte de la suppression : conserve
--    l'historique, et constitue la liste de rappel des paiements à
--    rembourser manuellement (voir note en tête de fichier — payment_
--    transactions reste immuable, jamais modifié ici).
-- ---------------------------------------------------------------------
create table if not exists public.event_refund_queue (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  member_nom text,
  montant numeric not null,
  methode text,
  reference text,
  traite boolean not null default false,
  traite_par uuid references public.profiles(id),
  traite_le timestamptz,
  created_at timestamptz not null default now()
);

alter table public.event_refund_queue enable row level security;

drop policy if exists "event_refund_queue select bureau" on public.event_refund_queue;
create policy "event_refund_queue select bureau" on public.event_refund_queue for select to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());
drop policy if exists "event_refund_queue update bureau" on public.event_refund_queue;
create policy "event_refund_queue update bureau" on public.event_refund_queue for update to authenticated
  using (association_id = public.current_association_id() and public.is_bureau())
  with check (association_id = public.current_association_id() and public.is_bureau());

comment on table public.event_refund_queue is
  'Liste de rappel des paiements à rembourser manuellement (hors app) après annulation d''un événement via annuler_evenement() — ne modifie JAMAIS payment_transactions (registre immuable). "traite" est coché à la main par le Bureau une fois le remboursement réellement effectué (virement, geste Stripe manuel, etc.).';

create or replace function public.annuler_evenement(p_event_id uuid)
returns table(status text, nb_paiements_a_rembourser integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_event record;
  v_nb integer := 0;
begin
  if not public.is_bureau() then
    return query select 'non_autorise'::text, 0; return;
  end if;

  select * into v_event from public.events e where e.id = p_event_id and e.association_id = public.current_association_id();
  if v_event is null then
    return query select 'introuvable'::text, 0; return;
  end if;
  if v_event.annule then
    return query select 'deja_annule'::text, 0; return;
  end if;

  update public.events set annule = true where id = p_event_id;

  insert into public.event_refund_queue (association_id, event_id, member_id, member_nom, montant, methode, reference)
  select pt.association_id, p_event_id, pt.member_id, m.nom, pt.montant, pt.methode, pt.reference
  from public.payment_transactions pt
  join public.members m on m.id = pt.member_id
  where pt.type = 'billet_evenement' and pt.event_id = p_event_id;
  get diagnostics v_nb = row_count;

  return query select 'annule'::text, v_nb;
end;
$fn$;

comment on function public.annuler_evenement(uuid) is
  'Annule un événement (events.annule=true, sans le supprimer) et constitue la liste des paiements de billetterie à rembourser manuellement (event_refund_queue) — ne touche jamais payment_transactions. Réservé au Bureau. Codes retournés : non_autorise, introuvable, deja_annule, annule.';

grant execute on function public.annuler_evenement(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Bénévolat lié à l'événement — mêmes principes que le bénévolat de
--    projet (modernisation Projets, 2026-09-30) : tâches visibles par
--    tout adhérent de l'association, prise en charge via RPC pour
--    éviter une double prise simultanée sur une tâche à places limitées.
-- ---------------------------------------------------------------------
create table if not exists public.event_volunteer_tasks (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  titre text not null,
  description text,
  membres_requis integer not null default 1 check (membres_requis > 0)
);

alter table public.event_volunteer_tasks enable row level security;

drop policy if exists "event_volunteer_tasks select" on public.event_volunteer_tasks;
create policy "event_volunteer_tasks select" on public.event_volunteer_tasks for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "event_volunteer_tasks write bureau" on public.event_volunteer_tasks;
create policy "event_volunteer_tasks write bureau" on public.event_volunteer_tasks for all to authenticated
  using (association_id = public.current_association_id() and public.is_bureau())
  with check (association_id = public.current_association_id() and public.is_bureau());

create table if not exists public.event_volunteer_signups (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  task_id uuid not null references public.event_volunteer_tasks(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, member_id)
);

alter table public.event_volunteer_signups enable row level security;

drop policy if exists "event_volunteer_signups select" on public.event_volunteer_signups;
create policy "event_volunteer_signups select" on public.event_volunteer_signups for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "event_volunteer_signups delete self" on public.event_volunteer_signups;
create policy "event_volunteer_signups delete self" on public.event_volunteer_signups for delete to authenticated
  using (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()));

create or replace function public.se_porter_volontaire_evenement(p_task_id uuid)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_task record;
  v_nb integer;
begin
  if v_member_id is null then
    return query select 'non_autorise'::text; return;
  end if;
  select * into v_task from public.event_volunteer_tasks t where t.id = p_task_id and t.association_id = public.current_association_id();
  if v_task is null then
    return query select 'introuvable'::text; return;
  end if;
  select count(*) into v_nb from public.event_volunteer_signups s where s.task_id = p_task_id;
  if v_nb >= v_task.membres_requis then
    return query select 'complet'::text; return;
  end if;
  insert into public.event_volunteer_signups (association_id, task_id, member_id)
  values (public.current_association_id(), p_task_id, v_member_id)
  on conflict do nothing;
  return query select 'inscrit'::text;
end;
$fn$;

comment on function public.se_porter_volontaire_evenement(uuid) is
  'Un adhérent se porte volontaire pour une tâche de bénévolat liée à un événement, avec vérification du nombre de places restantes (membres_requis) faite ici plutôt que côté client, pour éviter une double prise simultanée. Codes retournés : non_autorise, introuvable, complet, inscrit.';

grant execute on function public.se_porter_volontaire_evenement(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7) Covoiturage entre membres — tableau d'offres/demandes, sans mise en
--    relation automatique (voir note en tête de fichier).
-- ---------------------------------------------------------------------
create table if not exists public.event_carpool_offers (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  member_nom text,
  places_disponibles integer not null default 1 check (places_disponibles > 0),
  point_depart text,
  heure_depart text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.event_carpool_requests (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  member_nom text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.event_carpool_offers enable row level security;
alter table public.event_carpool_requests enable row level security;

drop policy if exists "event_carpool_offers select" on public.event_carpool_offers;
create policy "event_carpool_offers select" on public.event_carpool_offers for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "event_carpool_offers insert self" on public.event_carpool_offers;
create policy "event_carpool_offers insert self" on public.event_carpool_offers for insert to authenticated
  with check (association_id = public.current_association_id() and member_id = public.current_member_id());
drop policy if exists "event_carpool_offers delete" on public.event_carpool_offers;
create policy "event_carpool_offers delete" on public.event_carpool_offers for delete to authenticated
  using (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()));

drop policy if exists "event_carpool_requests select" on public.event_carpool_requests;
create policy "event_carpool_requests select" on public.event_carpool_requests for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "event_carpool_requests insert self" on public.event_carpool_requests;
create policy "event_carpool_requests insert self" on public.event_carpool_requests for insert to authenticated
  with check (association_id = public.current_association_id() and member_id = public.current_member_id());
drop policy if exists "event_carpool_requests delete" on public.event_carpool_requests;
create policy "event_carpool_requests delete" on public.event_carpool_requests for delete to authenticated
  using (association_id = public.current_association_id() and (public.is_bureau() or member_id = public.current_member_id()));

create or replace function public.signaler_interet_covoiturage(p_offer_id uuid, p_message text)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_member_nom text;
  v_offer record;
  v_profile_id uuid;
begin
  if v_member_id is null then
    return query select 'non_autorise'::text; return;
  end if;
  select * into v_offer from public.event_carpool_offers o where o.id = p_offer_id and o.association_id = public.current_association_id();
  if v_offer is null then
    return query select 'introuvable'::text; return;
  end if;
  select nom into v_member_nom from public.members where id = v_member_id;
  select p.id into v_profile_id from public.profiles p where p.member_id = v_offer.member_id;
  perform public.notify_profile(
    v_offer.association_id, v_profile_id,
    '🚗 Intérêt pour votre covoiturage',
    coalesce(v_member_nom, 'Un adhérent') || ' est intéressé(e) par votre offre de covoiturage.' || coalesce(' « ' || p_message || ' »', '')
  );
  return query select 'notifie'::text;
end;
$fn$;

comment on function public.signaler_interet_covoiturage(uuid, text) is
  'Notifie par push l''auteur d''une offre de covoiturage qu''un adhérent est intéressé, avec un message optionnel — aucune coordonnée de contact ne transite ici, les deux personnes se contactent ensuite par leurs propres moyens. Codes retournés : non_autorise, introuvable, notifie.';

grant execute on function public.signaler_interet_covoiturage(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8) Page publique dédiée par événement — même patron exact que la
--    vitrine publique / le suivi public de projet : vue ne projetant que
--    des colonnes sûres, double condition (vitrine_active ET
--    events.public_inscription), et une table d'intake ANONYME pour
--    l'inscription (même patron que membership_requests).
-- ---------------------------------------------------------------------
create or replace view public.public_event_detail as
select
  e.id as event_id,
  e.association_id,
  e.titre,
  e.description,
  e.lieu,
  e.date_debut,
  e.prix,
  e.categorie,
  e.capacite_max,
  case when e.capacite_max is not null
    then greatest(0, e.capacite_max - (select count(*) from public.event_rsvps r where r.event_id = e.id and r.statut = 'confirme'))
    else null end as places_restantes,
  a.nom as association_nom,
  a.logo_url as association_logo_url,
  a.devise_texte as association_devise_texte,
  a.devise_monetaire as association_devise_monetaire
from public.events e
join public.associations a on a.id = e.association_id
where a.vitrine_active = true and a.slug_public is not null
  and e.public_inscription = true and e.annule = false;

grant select on public.public_event_detail to anon, authenticated;

create or replace view public.public_event_sessions as
select es.event_id, es.titre, es.date_debut, es.date_fin, es.lieu, es.description, es.ordre
from public.event_sessions es
join public.events e on e.id = es.event_id
join public.associations a on a.id = e.association_id
where a.vitrine_active = true and a.slug_public is not null and e.public_inscription = true;

grant select on public.public_event_sessions to anon, authenticated;

create table if not exists public.event_public_registrations (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  nom text not null,
  courriel text not null,
  telephone text,
  nb_personnes integer not null default 1 check (nb_personnes > 0),
  message text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'contacte', 'annulee')),
  created_at timestamptz not null default now()
);

comment on table public.event_public_registrations is
  'Inscription soumise depuis la page publique d''un événement (sans compte) — une prise de coordonnées, pas un paiement en ligne. Le Bureau la traite/contacte la personne, même esprit que membership_requests.';

alter table public.event_public_registrations enable row level security;

drop policy if exists "event_public_registrations insert public" on public.event_public_registrations;
create policy "event_public_registrations insert public" on public.event_public_registrations
  for insert to anon, authenticated
  with check (
    exists (
      select 1 from public.events e join public.associations a on a.id = e.association_id
      where e.id = event_id and e.public_inscription = true and e.annule = false and a.vitrine_active = true
    )
  );

drop policy if exists "event_public_registrations select bureau" on public.event_public_registrations;
create policy "event_public_registrations select bureau" on public.event_public_registrations for select to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());
drop policy if exists "event_public_registrations update bureau" on public.event_public_registrations;
create policy "event_public_registrations update bureau" on public.event_public_registrations for update to authenticated
  using (association_id = public.current_association_id() and public.is_bureau())
  with check (association_id = public.current_association_id() and public.is_bureau());

-- ---------------------------------------------------------------------
-- 9) Rappel d'événement — étendu pour envoyer AUSSI une notification
--    push (en plus du courriel déjà envoyé), aux mêmes inscrits
--    confirmés. Remplace la fonction de sql/2026-09-07i_rappel_
--    evenements.sql — signature de retour inchangée, la planification
--    cron existante n'a pas besoin d'être retouchée.
-- ---------------------------------------------------------------------
create or replace function public.send_event_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  api_key text;
  internal_secret text;
  ev record;
  rsvp record;
  assoc_nom text;
  profile_ids uuid[];
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  select decrypted_secret into internal_secret from vault.decrypted_secrets where name = 'push_internal_secret';

  for ev in
    select e.*
    from public.events e
    where e.rappel_envoye = false
      and e.annule = false
      and e.date_debut::date = (current_date + interval '2 days')::date
  loop
    select a.nom into assoc_nom from public.associations a where a.id = ev.association_id;
    profile_ids := array[]::uuid[];

    if api_key is not null then
      for rsvp in
        select m.email
        from public.event_rsvps r
        join public.members m on m.id = r.member_id
        where r.event_id = ev.id and r.statut = 'confirme' and m.email is not null
      loop
        perform net.http_post(
          url := 'https://api.resend.com/emails',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || api_key),
          body := jsonb_build_object(
            'from', 'onboarding@resend.dev',
            'to', jsonb_build_array(rsvp.email),
            'subject', '[' || coalesce(assoc_nom, 'Association') || '] Rappel : ' || ev.titre || ' dans 2 jours',
            'html',
              '<p>Bonjour,</p><p>Ceci est un rappel : vous êtes inscrit(e) à l''événement suivant, qui a lieu dans 2 jours.</p>' ||
              '<p style="padding:12px;background:#f5f5f5;border-radius:6px;"><strong>' || ev.titre || '</strong><br/>' ||
              'Date : ' || to_char(ev.date_debut::date, 'DD/MM/YYYY') ||
              (case when ev.lieu is not null and ev.lieu <> '' then '<br/>Lieu : ' || ev.lieu else '' end) || '</p><p>À bientôt !</p>'
          )
        );
      end loop;
    end if;

    if internal_secret is not null then
      select array_agg(p.id) into profile_ids
        from public.event_rsvps r
        join public.members m on m.id = r.member_id
        join public.profiles p on p.member_id = m.id
        where r.event_id = ev.id and r.statut = 'confirme';
      if profile_ids is not null and array_length(profile_ids, 1) > 0 then
        perform net.http_post(
          url := 'https://hqqvkwvobmesgwbdjdko.supabase.co/functions/v1/send-push-notification',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', internal_secret),
          body := jsonb_build_object(
            'association_id', ev.association_id,
            'profile_ids', to_jsonb(profile_ids),
            'title', '📅 Rappel : ' || ev.titre,
            'body', 'Dans 2 jours' || (case when ev.lieu is not null and ev.lieu <> '' then ' · ' || ev.lieu else '' end),
            'url', '/'
          )
        );
      end if;
    end if;

    update public.events set rappel_envoye = true where id = ev.id;
  end loop;
end;
$fn$;

-- =====================================================================
-- Vérification rapide après exécution :
--   select categorie, recurrence, prix_membre, annule, check_in_actif, public_inscription from public.events limit 1;
--   select billet_token, checkin_le, checkin_par from public.event_rsvps limit 1;
--   select proname from pg_proc where proname in (
--     'notify_profile','trg_promote_waitlist','checkin_event_ticket','annuler_evenement',
--     'se_porter_volontaire_evenement','signaler_interet_covoiturage'
--   ); -- 6 lignes
--   select viewname from pg_views where viewname in ('public_event_detail','public_event_sessions'); -- 2 lignes
-- =====================================================================
