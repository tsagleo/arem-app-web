-- =====================================================================
-- Événements — bénévolat encadré, carte de membre à l'entrée, failles
-- corrigées (2026-10-10)
-- (à exécuter APRÈS 2026-10-10a_benevolat_disponibles.sql)
-- =====================================================================
-- Demandes de l'utilisateur :
--   1. BÉNÉVOLAT ENCADRÉ
--      • une tâche prise par un adhérent est « en attente » jusqu'à la
--        validation du bureau (le bureau peut aussi refuser) ;
--      • délai de prévenance réglable par événement (72 h par défaut) :
--        avant ce délai, on se retire librement ; APRÈS, on ne fait
--        qu'une « demande de retrait » : la personne reste engagée tant
--        que le bureau n'a pas accepté (le temps de trouver un remplaçant),
--        le bureau et les membres disponibles sont prévenus ;
--      • le membre est prévenu quand le bureau valide ou refuse.
--   2. CARTE DE MEMBRE = BADGE D'ENTRÉE
--      La carte de membre existante (members.verification_token, QR
--      ?verify=…) sert aussi à l'entrée des événements :
--      pointer_carte_membre_evenement() pointe le membre SEULEMENT s'il
--      est inscrit (inscription confirmée) à CET événement ; sinon
--      « non inscrit » (le bureau peut l'inscrire sur place). La photo
--      est renvoyée pour que la personne à l'entrée vérifie l'identité.
--   3. FAILLES CORRIGÉES (audit du volet Événements)
--      • un adhérent pouvait se marquer « confirmé » à un événement
--        PAYANT sans payer, ou dépasser la capacité, par un simple appel
--        direct à la base (contrôles faits seulement à l'écran) ;
--      • un adhérent pouvait se pointer lui-même « arrivé » (checkin_le)
--        ou changer le jeton de son billet ;
--      • un adhérent pouvait supprimer directement son engagement de
--        bénévole, même la veille de l'événement.
-- Ré-exécutable sans risque.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Bénévolat : statut, délai de prévenance
-- ---------------------------------------------------------------------
alter table public.events add column if not exists benevolat_delai_heures integer not null default 72;
alter table public.events drop constraint if exists events_benevolat_delai_check;
alter table public.events add constraint events_benevolat_delai_check check (benevolat_delai_heures between 0 and 720);

-- Les engagements déjà pris avant ce script sont réputés confirmés
-- (default 'confirme' à l'ajout de la colonne) ; les nouveaux partent
-- « en attente » de la validation du bureau.
alter table public.event_volunteer_signups add column if not exists statut text not null default 'confirme';
alter table public.event_volunteer_signups alter column statut set default 'en_attente';
alter table public.event_volunteer_signups add column if not exists valide_le timestamptz;
alter table public.event_volunteer_signups add column if not exists valide_par_nom text;
alter table public.event_volunteer_signups add column if not exists retrait_motif text;
alter table public.event_volunteer_signups add column if not exists retrait_demande_le timestamptz;
alter table public.event_volunteer_signups drop constraint if exists event_volunteer_signups_statut_check;
alter table public.event_volunteer_signups add constraint event_volunteer_signups_statut_check
  check (statut in ('en_attente', 'confirme', 'retrait_demande'));

-- Plus de suppression directe par l'adhérent : le retrait passe par
-- se_retirer_benevolat() (qui applique le délai de prévenance).
drop policy if exists "event_volunteer_signups delete self" on public.event_volunteer_signups;
drop policy if exists "event_volunteer_signups delete bureau" on public.event_volunteer_signups;
create policy "event_volunteer_signups delete bureau" on public.event_volunteer_signups for delete to authenticated
  using (association_id = public.current_association_id() and public.is_bureau());

-- Profils (comptes) du bureau d'une association, pour les notifications.
create or replace function public.profils_bureau(p_association_id uuid) returns setof uuid
language sql stable security definer set search_path = '' as $fn$
  select p.id from public.profiles p
   where p.association_id = p_association_id
     and p.role in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier')
$fn$;
revoke all on function public.profils_bureau(uuid) from public, anon, authenticated;

-- L'adhérent se porte volontaire : place réservée, EN ATTENTE du bureau.
create or replace function public.se_porter_volontaire_evenement(p_task_id uuid)
returns table(status text)
language plpgsql security definer set search_path = '' as $fn$
declare
  v_member_id uuid := public.current_member_id();
  v_task record;
  v_event record;
  v_nb integer;
  v_nom text;
  v_p uuid;
begin
  if v_member_id is null then return query select 'non_autorise'::text; return; end if;
  select * into v_task from public.event_volunteer_tasks t
   where t.id = p_task_id and t.association_id = public.current_association_id() for update;
  if v_task is null then return query select 'introuvable'::text; return; end if;
  select count(*) into v_nb from public.event_volunteer_signups s where s.task_id = p_task_id;
  if v_nb >= v_task.membres_requis then return query select 'complet'::text; return; end if;
  insert into public.event_volunteer_signups (association_id, task_id, member_id, statut)
  values (public.current_association_id(), p_task_id, v_member_id, 'en_attente')
  on conflict do nothing;

  select e.titre into v_event from public.events e where e.id = v_task.event_id;
  select m.nom into v_nom from public.members m where m.id = v_member_id;
  for v_p in select public.profils_bureau(v_task.association_id) loop
    perform public.notify_profile(v_task.association_id, v_p, '🙋 Bénévole à valider',
      coalesce(v_nom, 'Un membre') || ' se propose pour « ' || v_task.titre || ' » (' || coalesce(v_event.titre, '') || ').');
  end loop;
  return query select 'inscrit'::text;
end;
$fn$;
grant execute on function public.se_porter_volontaire_evenement(uuid) to authenticated;

-- Le bureau inscrit directement un membre : engagement CONFIRMÉ d'emblée.
create or replace function public.inscrire_benevole_evenement(p_task_id uuid, p_member_id uuid)
returns table(status text)
language plpgsql security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_task record;
  v_nb integer;
begin
  if v_assoc is null or not public.is_bureau() then return query select 'non_autorise'::text; return; end if;
  select * into v_task from public.event_volunteer_tasks t where t.id = p_task_id and t.association_id = v_assoc for update;
  if v_task is null then return query select 'introuvable'::text; return; end if;
  if not exists (select 1 from public.members m where m.id = p_member_id and m.association_id = v_assoc) then
    return query select 'introuvable'::text; return;
  end if;
  if exists (select 1 from public.event_volunteer_signups s where s.task_id = p_task_id and s.member_id = p_member_id) then
    return query select 'deja_inscrit'::text; return;
  end if;
  select count(*) into v_nb from public.event_volunteer_signups s where s.task_id = p_task_id;
  if v_nb >= v_task.membres_requis then return query select 'complet'::text; return; end if;
  insert into public.event_volunteer_signups (association_id, task_id, member_id, statut, valide_le, valide_par_nom)
  values (v_assoc, p_task_id, p_member_id, 'confirme', now(),
          (select coalesce(m.nom, p.nom_complet) from public.profiles p left join public.members m on m.id = p.member_id where p.id = auth.uid()))
  on conflict do nothing;
  return query select 'inscrit'::text;
end;
$fn$;
grant execute on function public.inscrire_benevole_evenement(uuid, uuid) to authenticated;

-- Décision du bureau sur une proposition « en attente ».
create or replace function public.valider_benevole(p_signup_id uuid, p_accepter boolean) returns text
language plpgsql security definer set search_path = '' as $fn$
declare
  v_s record;
  v_task record;
  v_profile uuid;
begin
  select * into v_s from public.event_volunteer_signups where id = p_signup_id for update;
  if v_s.id is null or v_s.association_id <> public.current_association_id() or not public.is_bureau() then
    raise exception 'Non autorisé.';
  end if;
  select * into v_task from public.event_volunteer_tasks where id = v_s.task_id;
  select p.id into v_profile from public.profiles p where p.member_id = v_s.member_id;
  if p_accepter then
    update public.event_volunteer_signups
       set statut = 'confirme', valide_le = now(),
           valide_par_nom = (select coalesce(m.nom, p.nom_complet) from public.profiles p left join public.members m on m.id = p.member_id where p.id = auth.uid())
     where id = p_signup_id;
    perform public.notify_profile(v_s.association_id, v_profile, '✅ Bénévolat confirmé',
      'Le bureau confirme votre engagement : « ' || v_task.titre || ' ». Merci !');
    return 'confirme';
  end if;
  delete from public.event_volunteer_signups where id = p_signup_id;
  perform public.notify_profile(v_s.association_id, v_profile, 'Bénévolat',
    'Le bureau n''a pas retenu votre proposition pour « ' || v_task.titre || ' ». Merci de votre disponibilité.');
  return 'refuse';
end;
$fn$;
grant execute on function public.valider_benevole(uuid, boolean) to authenticated;

-- Retrait par le bénévole lui-même, selon le délai de prévenance.
create or replace function public.se_retirer_benevolat(p_signup_id uuid, p_motif text default null) returns text
language plpgsql security definer set search_path = '' as $fn$
declare
  v_s record;
  v_task record;
  v_event record;
  v_nom text;
  v_p uuid;
begin
  select * into v_s from public.event_volunteer_signups where id = p_signup_id for update;
  if v_s.id is null or v_s.member_id is distinct from public.current_member_id() then raise exception 'Non autorisé.'; end if;
  select * into v_task from public.event_volunteer_tasks where id = v_s.task_id;
  select * into v_event from public.events where id = v_task.event_id;

  -- Proposition pas encore validée, ou délai de prévenance respecté :
  -- retrait libre (le bureau est simplement prévenu).
  if v_s.statut = 'en_attente'
     or v_event.date_debut is null
     or now() < v_event.date_debut - make_interval(hours => coalesce(v_event.benevolat_delai_heures, 72)) then
    delete from public.event_volunteer_signups where id = p_signup_id;
    if v_s.statut <> 'en_attente' then
      select m.nom into v_nom from public.members m where m.id = v_s.member_id;
      for v_p in select public.profils_bureau(v_s.association_id) loop
        perform public.notify_profile(v_s.association_id, v_p, 'Bénévolat : place libérée',
          coalesce(v_nom, 'Un membre') || ' s''est retiré(e) de « ' || v_task.titre || ' » (' || v_event.titre || ').');
      end loop;
    end if;
    return 'retire';
  end if;

  -- Trop près de l'événement : demande de retrait, la personne reste
  -- engagée tant que le bureau n'a pas trouvé un remplaçant.
  if v_s.statut = 'retrait_demande' then return 'retrait_demande'; end if;
  update public.event_volunteer_signups
     set statut = 'retrait_demande', retrait_motif = nullif(trim(coalesce(p_motif, '')), ''), retrait_demande_le = now()
   where id = p_signup_id;
  select m.nom into v_nom from public.members m where m.id = v_s.member_id;
  for v_p in select public.profils_bureau(v_s.association_id) loop
    perform public.notify_profile(v_s.association_id, v_p, '⚠️ Demande de retrait d''un bénévole',
      coalesce(v_nom, 'Un membre') || ' demande à se retirer de « ' || v_task.titre || ' » (' || v_event.titre || ') : trouvez un remplaçant.');
  end loop;
  -- Les membres disponibles (et non encore engagés sur la tâche) sont
  -- prévenus tout de suite qu'une place risque de se libérer.
  for v_p in
    select p.id from public.profiles p join public.members m on m.id = p.member_id
     where m.association_id = v_s.association_id and m.disponible_benevolat and m.id <> v_s.member_id
       and not exists (select 1 from public.event_volunteer_signups s2 where s2.task_id = v_s.task_id and s2.member_id = m.id)
  loop
    perform public.notify_profile(v_s.association_id, v_p, '🙋 Remplaçant(e) recherché(e)',
      '« ' || v_task.titre || ' » — ' || v_event.titre || ' : un(e) bénévole cherche un remplaçant. Proposez-vous dans Événements.');
  end loop;
  return 'retrait_demande';
end;
$fn$;
grant execute on function public.se_retirer_benevolat(uuid, text) to authenticated;

-- Le bénévole renonce à sa demande de retrait.
create or replace function public.annuler_retrait_benevolat(p_signup_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.event_volunteer_signups
     set statut = 'confirme', retrait_motif = null, retrait_demande_le = null
   where id = p_signup_id and member_id = public.current_member_id() and statut = 'retrait_demande';
end;
$fn$;
grant execute on function public.annuler_retrait_benevolat(uuid) to authenticated;

-- Le bureau accepte le retrait (remplaçant trouvé) ou retire un bénévole.
create or replace function public.accepter_retrait_benevole(p_signup_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_s record;
  v_task record;
  v_profile uuid;
begin
  select * into v_s from public.event_volunteer_signups where id = p_signup_id;
  if v_s.id is null or v_s.association_id <> public.current_association_id() or not public.is_bureau() then
    raise exception 'Non autorisé.';
  end if;
  select * into v_task from public.event_volunteer_tasks where id = v_s.task_id;
  delete from public.event_volunteer_signups where id = p_signup_id;
  select p.id into v_profile from public.profiles p where p.member_id = v_s.member_id;
  perform public.notify_profile(v_s.association_id, v_profile, 'Bénévolat',
    'Le bureau a enregistré votre retrait de « ' || v_task.titre || ' ».');
end;
$fn$;
grant execute on function public.accepter_retrait_benevole(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Carte de membre = badge d'entrée (seulement si inscrit)
-- ---------------------------------------------------------------------
create or replace function public.pointer_carte_membre_evenement(p_token uuid, p_event_id uuid)
returns table(status text, member_id uuid, member_nom text, photo_url text, event_titre text, checkin_le timestamptz)
language plpgsql security definer set search_path = '' as $fn$
declare
  v_m record;
  v_event record;
  v_rsvp record;
  v_res record;
begin
  if not public.is_bureau() then
    return query select 'non_autorise'::text, null::uuid, null::text, null::text, null::text, null::timestamptz; return;
  end if;
  select * into v_m from public.members m where m.verification_token = p_token and m.association_id = public.current_association_id();
  if v_m.id is null then
    return query select 'introuvable'::text, null::uuid, null::text, null::text, null::text, null::timestamptz; return;
  end if;
  select * into v_event from public.events e where e.id = p_event_id and e.association_id = public.current_association_id();
  if v_m.statut is distinct from 'Actif' then
    return query select 'inactif'::text, v_m.id, v_m.nom, v_m.photo_url, v_event.titre, null::timestamptz; return;
  end if;
  select * into v_rsvp from public.event_rsvps r where r.event_id = p_event_id and r.member_id = v_m.id;
  if v_rsvp.id is null or v_rsvp.statut <> 'confirme' then
    return query select 'non_inscrit'::text, v_m.id, v_m.nom, v_m.photo_url, v_event.titre, null::timestamptz; return;
  end if;
  if v_rsvp.checkin_le is not null then
    return query select 'deja_valide'::text, v_m.id, v_m.nom, v_m.photo_url, v_event.titre, v_rsvp.checkin_le; return;
  end if;
  -- Même pointage que le billet (et présence liée si configurée).
  select * into v_res from public.checkin_event_ticket(v_rsvp.billet_token);
  return query select v_res.status, v_m.id, v_m.nom, v_m.photo_url, v_event.titre, now();
end;
$fn$;
grant execute on function public.pointer_carte_membre_evenement(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Garde des inscriptions (faille : contrôles seulement à l'écran)
-- ---------------------------------------------------------------------
-- S'applique aux actions d'un ADHÉRENT. Laissées libres : le bureau, les
-- traitements serveur sans utilisateur (paiement par carte confirmé par
-- Stripe) et les insertions faites par un autre déclencheur (promotion
-- automatique depuis la liste d'attente).
create or replace function public.event_rsvps_garde() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_event record;
  v_nb integer;
begin
  if auth.uid() is null or public.is_bureau() or pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.checkin_le is distinct from old.checkin_le
                           or new.checkin_par is distinct from old.checkin_par
                           or new.billet_token is distinct from old.billet_token
                           or new.event_id is distinct from old.event_id
                           or new.member_id is distinct from old.member_id) then
    raise exception 'Modification réservée au bureau.';
  end if;
  if new.statut = 'confirme' and (tg_op = 'INSERT' or old.statut is distinct from 'confirme') then
    select * into v_event from public.events e where e.id = new.event_id;
    if coalesce(v_event.annule, false) then raise exception 'Cet événement est annulé.'; end if;
    if coalesce(v_event.prix_membre, v_event.prix, 0) > 0 then
      raise exception 'Événement payant : la place est confirmée automatiquement après le paiement.';
    end if;
    if v_event.capacite_max is not null then
      select count(*) into v_nb from public.event_rsvps r
       where r.event_id = new.event_id and r.statut = 'confirme' and r.id is distinct from new.id;
      if v_nb >= v_event.capacite_max then raise exception 'Événement complet : inscrivez-vous sur la liste d''attente.'; end if;
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_event_rsvps_garde on public.event_rsvps;
create trigger trg_event_rsvps_garde before insert or update on public.event_rsvps
for each row execute function public.event_rsvps_garde();

-- ---------------------------------------------------------------------
-- 4) Temps réel : le bureau voit les propositions et retraits arriver
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_volunteer_signups') then
    alter publication supabase_realtime add table public.event_volunteer_signups;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select proname from pg_proc where proname in ('valider_benevole','se_retirer_benevolat',
--     'annuler_retrait_benevolat','accepter_retrait_benevole','pointer_carte_membre_evenement','event_rsvps_garde');
-- ---------------------------------------------------------------------
