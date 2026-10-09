-- =====================================================================
-- Sanctions — refonte « nouvelle génération » (2026-10-10)
-- (à exécuter APRÈS 2026-09-21d_sanctions.sql et les scripts de pointage)
-- =====================================================================
-- Demande de l'utilisateur : réorganisation complète et professionnelle
-- du volet disciplinaire. Ajouts :
--   1. FAILLE CORRIGÉE — la double validation n'était contrôlée qu'à
--      l'écran : un membre du bureau pouvait enregistrer directement une
--      mesure « validée » sans l'approbateur. La base l'impose désormais.
--   2. DROIT DE RECOURS : l'adhérent peut contester une mesure dans un
--      délai réglable (15 jours par défaut) ; le bureau statue (maintenue,
--      réduite, annulée) et l'adhérent est prévenu.
--   3. ÉCHÉANCE DE PAIEMENT des amendes (30 jours par défaut), rappels
--      automatiques en cas de retard (au plus un par semaine).
--   4. PRESCRIPTION : au-delà d'un délai réglable (12 mois par défaut),
--      une mesure ne compte plus dans la récidive (affichée « prescrite »).
--   5. NOTIFICATIONS : l'approbateur quand une mesure lui est soumise,
--      l'adhérent quand une mesure le concerne devient effective.
-- Les amendes automatiques du pointage (retard, absence, départ
-- anticipé) appliquent le barème voté : elles restent effectives
-- immédiatement.
-- Ré-exécutable sans risque.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Réglages de l'association
-- ---------------------------------------------------------------------
alter table public.associations add column if not exists sanctions_delai_recours_jours integer not null default 15;
alter table public.associations add column if not exists sanctions_delai_paiement_jours integer not null default 30;
alter table public.associations add column if not exists sanctions_prescription_mois integer not null default 12;

-- ---------------------------------------------------------------------
-- 2) Colonnes des mesures
-- ---------------------------------------------------------------------
alter table public.sanctions add column if not exists echeance date;
alter table public.sanctions add column if not exists montant_initial numeric;
alter table public.sanctions add column if not exists recours_statut text;
alter table public.sanctions add column if not exists recours_motif text;
alter table public.sanctions add column if not exists recours_le timestamptz;
alter table public.sanctions add column if not exists recours_decision text;
alter table public.sanctions add column if not exists recours_decide_par_nom text;
alter table public.sanctions add column if not exists recours_decide_le timestamptz;
alter table public.sanctions add column if not exists rappel_paiement_le timestamptz;
alter table public.sanctions drop constraint if exists sanctions_recours_statut_check;
alter table public.sanctions add constraint sanctions_recours_statut_check
  check (recours_statut is null or recours_statut in ('en_cours', 'maintenue', 'reduite', 'annulee'));

-- Échéance des amendes déjà validées et non payées.
update public.sanctions s
   set echeance = (coalesce(s.date_validation, s.date_proposition)::date + coalesce(a.sanctions_delai_paiement_jours, 30))
  from public.associations a
 where a.id = s.association_id and s.type = 'amende' and s.statut = 'validee' and s.echeance is null;

-- ---------------------------------------------------------------------
-- 3) Garde : double validation imposée par la base, échéance automatique
-- ---------------------------------------------------------------------
create or replace function public.sanctions_garde() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.associations;
  v_auto boolean := (to_jsonb(new) ->> 'attendance_record_id') is not null;
  v_besoin boolean;
begin
  select * into v_a from public.associations where id = new.association_id;

  -- Une mesure soumise à validation ne peut pas être enregistrée
  -- « validée » par quelqu'un d'autre que l'approbateur désigné.
  v_besoin := v_a.approbateur_suppression_id is not null
              and v_a.approbateur_suppression_id is distinct from auth.uid()
              and auth.uid() is not null and not v_auto
              and (new.type in ('suspension', 'exclusion')
                   or (new.type = 'amende' and coalesce(new.montant, 0) >= coalesce(v_a.sanctions_seuil_validation, 25)));

  if tg_op = 'INSERT' then
    if v_besoin and new.statut = 'validee' then
      new.statut := 'proposee'; new.validee_par := null; new.validee_par_nom := null; new.date_validation := null;
    end if;
  else
    -- Validation / rejet d'une mesure soumise : réservé à l'approbateur.
    if old.statut = 'proposee' and new.statut in ('validee', 'rejetee') and v_besoin then
      raise exception 'Seul l''approbateur désigné peut valider ou rejeter cette mesure.';
    end if;
    -- Le montant d'une amende effective ne se modifie que par un recours.
    if old.statut = 'validee' and new.montant is distinct from old.montant
       and coalesce(current_setting('unia.recours', true), '') <> 'oui' then
      raise exception 'Le montant d''une mesure effective ne se modifie que par la décision sur un recours.';
    end if;
  end if;

  if new.type = 'amende' and new.statut = 'validee' and new.echeance is null then
    new.echeance := current_date + coalesce(v_a.sanctions_delai_paiement_jours, 30);
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_sanctions_garde on public.sanctions;
create trigger trg_sanctions_garde before insert or update on public.sanctions
for each row execute function public.sanctions_garde();

-- ---------------------------------------------------------------------
-- 4) Notifications
-- ---------------------------------------------------------------------
create or replace function public.sanctions_notifier() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.associations;
  v_profile uuid;
  v_type text := case new.type when 'avertissement' then 'Avertissement' when 'amende' then 'Amende'
                               when 'suspension' then 'Suspension' else 'Exclusion' end;
begin
  select * into v_a from public.associations where id = new.association_id;
  -- Soumise à l'approbateur.
  if new.statut = 'proposee' and (tg_op = 'INSERT' or old.statut is distinct from 'proposee') then
    perform public.notify_profile(new.association_id, v_a.approbateur_suppression_id, '⚖️ Mesure à valider',
      v_type || coalesce(' de ' || new.montant || ' $', '') || ' proposée par ' || coalesce(new.proposee_par_nom, 'le bureau') || '. À traiter dans Sanctions.');
  end if;
  -- Devenue effective : l'adhérent est informé (et de son droit de recours).
  if new.statut = 'validee' and (tg_op = 'INSERT' or old.statut is distinct from 'validee') then
    select p.id into v_profile from public.profiles p where p.member_id = new.member_id;
    perform public.notify_profile(new.association_id, v_profile, '⚖️ Mesure disciplinaire : ' || v_type,
      coalesce(new.categorie_nom || ' — ', '') || left(new.motif, 120)
      || case when new.type = 'amende' then ' — ' || new.montant || ' $ à régler avant le ' || to_char(new.echeance, 'DD/MM/YYYY') else '' end
      || '. Recours possible sous ' || coalesce(v_a.sanctions_delai_recours_jours, 15) || ' jours (Sanctions).');
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_sanctions_notifier on public.sanctions;
create trigger trg_sanctions_notifier after insert or update of statut on public.sanctions
for each row execute function public.sanctions_notifier();

-- ---------------------------------------------------------------------
-- 5) Recours
-- ---------------------------------------------------------------------
create or replace function public.contester_sanction(p_id uuid, p_motif text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_s public.sanctions;
  v_a public.associations;
  v_p uuid;
begin
  select * into v_s from public.sanctions where id = p_id for update;
  if v_s.id is null or v_s.member_id is distinct from public.current_member_id() then raise exception 'Non autorisé.'; end if;
  select * into v_a from public.associations where id = v_s.association_id;
  if v_s.statut <> 'validee' then raise exception 'Seule une mesure effective peut être contestée.'; end if;
  if v_s.recours_statut is not null then raise exception 'Un recours a déjà été déposé pour cette mesure.'; end if;
  if v_s.paye then raise exception 'Cette amende est déjà réglée.'; end if;
  if coalesce(v_s.date_validation, v_s.date_proposition) + make_interval(days => coalesce(v_a.sanctions_delai_recours_jours, 15)) < now() then
    raise exception 'Le délai de recours (% jours) est dépassé.', coalesce(v_a.sanctions_delai_recours_jours, 15);
  end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Expliquez le motif de votre recours.'; end if;
  update public.sanctions set recours_statut = 'en_cours', recours_motif = trim(p_motif), recours_le = now() where id = p_id;
  for v_p in select p.id from public.profiles p where p.association_id = v_s.association_id
               and p.role in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier') loop
    perform public.notify_profile(v_s.association_id, v_p, '⚖️ Recours déposé',
      'Un adhérent conteste une mesure (' || coalesce(v_s.categorie_nom, v_s.type) || '). À examiner dans Sanctions → À traiter.');
  end loop;
end;
$fn$;
grant execute on function public.contester_sanction(uuid, text) to authenticated;

create or replace function public.statuer_recours_sanction(p_id uuid, p_decision text, p_montant numeric default null, p_commentaire text default null) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_s public.sanctions;
  v_nom text;
  v_profile uuid;
begin
  select * into v_s from public.sanctions where id = p_id for update;
  if v_s.id is null or v_s.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_s.recours_statut is distinct from 'en_cours' then raise exception 'Aucun recours en cours sur cette mesure.'; end if;
  if p_decision not in ('maintenue', 'reduite', 'annulee') then raise exception 'Décision invalide.'; end if;
  if p_decision = 'reduite' and (v_s.type <> 'amende' or p_montant is null or p_montant < 0 or p_montant >= coalesce(v_s.montant, 0)) then
    raise exception 'Indiquez un montant réduit, inférieur au montant actuel.';
  end if;
  select coalesce(m.nom, p.nom_complet) into v_nom from public.profiles p left join public.members m on m.id = p.member_id where p.id = auth.uid();
  perform set_config('unia.recours', 'oui', true);
  update public.sanctions
     set recours_statut = p_decision, recours_decision = nullif(trim(coalesce(p_commentaire, '')), ''),
         recours_decide_par_nom = v_nom, recours_decide_le = now(),
         montant_initial = case when p_decision = 'reduite' then coalesce(montant_initial, montant) else montant_initial end,
         montant = case when p_decision = 'reduite' then p_montant else montant end,
         statut = case when p_decision = 'annulee' then 'annulee' else statut end
   where id = p_id;
  perform set_config('unia.recours', '', true);
  select p.id into v_profile from public.profiles p where p.member_id = v_s.member_id;
  perform public.notify_profile(v_s.association_id, v_profile, '⚖️ Décision sur votre recours',
    case p_decision when 'maintenue' then 'La mesure est maintenue.' when 'reduite' then 'Le montant est réduit à ' || p_montant || ' $.'
                    else 'La mesure est annulée.' end || coalesce(' ' || nullif(trim(coalesce(p_commentaire, '')), ''), ''));
end;
$fn$;
grant execute on function public.statuer_recours_sanction(uuid, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Rappel des amendes en retard (au plus une fois par semaine)
-- ---------------------------------------------------------------------
create or replace function public.rappels_amendes_retard() returns integer
language plpgsql security definer set search_path = '' as $fn$
declare
  v record;
  v_profile uuid;
  v_n integer := 0;
begin
  for v in
    select s.* from public.sanctions s
     where s.type = 'amende' and s.statut = 'validee' and not s.paye and s.echeance < current_date
       and coalesce(s.recours_statut, '') <> 'en_cours'
       and (s.rappel_paiement_le is null or s.rappel_paiement_le < now() - interval '7 days')
  loop
    select p.id into v_profile from public.profiles p where p.member_id = v.member_id;
    perform public.notify_profile(v.association_id, v_profile, '⏰ Amende en retard',
      coalesce(v.categorie_nom, 'Amende') || ' : ' || v.montant || ' $ à régler depuis le ' || to_char(v.echeance, 'DD/MM/YYYY') || '. Paiement en ligne dans Sanctions.');
    update public.sanctions set rappel_paiement_le = now() where id = v.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;
revoke all on function public.rappels_amendes_retard() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sanctions-rappels-retard', '0 14 * * *', 'select public.rappels_amendes_retard();');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select proname from pg_proc where proname in ('contester_sanction','statuer_recours_sanction','sanctions_garde');   -- 3 lignes
-- ---------------------------------------------------------------------
