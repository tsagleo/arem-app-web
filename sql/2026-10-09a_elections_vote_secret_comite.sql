-- =====================================================================
-- Élections — COMITÉ ÉLECTORAL et processus électoral complet (2026-10-09)
-- (suite de 2026-10-09a_elections_vote_secret.sql, À EXÉCUTER APRÈS LUI,
--  et après les scripts Tirages 2026-10-08r / s / t)
-- =====================================================================
-- Demande de l'utilisateur : des élections « professionnelles », sur le
-- modèle d'une vraie assemblée générale :
--   • un COMITÉ ÉLECTORAL par élection (un président d'élection + 2 à 4
--     scrutateurs), désigné par le bureau ; ses membres ne peuvent PAS
--     être candidats (bloqué ici, en base, dans les deux sens) ;
--   • un CALENDRIER en étapes, visible de tous : appel à candidatures →
--     validation d'éligibilité → campagne → scrutin → dépouillement →
--     proclamation + délai de recours ;
--   • un scrutin PAR POSTE, avec éligibilité automatique des électeurs et
--     des candidats (membre Actif, à jour de cotisation si demandé,
--     ancienneté minimale paramétrable) ;
--   • des candidatures avec profession de foi, VALIDÉES PAR LE COMITÉ ;
--   • des PROCURATIONS encadrées (une seule par mandataire, déclarée
--     avant le scrutin, validée par le comité) ;
--   • quorum et participation en direct, AUCUN résultat avant la clôture ;
--   • en cas d'égalité, un DÉPARTAGE par tirage au sort vérifiable
--     (rubrique Tirages, type 'libre') ;
--   • une PROCLAMATION par le président d'élection, qui fige le résultat.
--
-- Secret du vote : inchangé (voir 2026-10-09a). Les bulletins restent
-- illisibles ; le décompte n'est visible qu'après la clôture, d'abord du
-- comité et du bureau (dépouillement), puis de tous après proclamation.
--
-- Toute action sensible passe par des fonctions security definer ; les
-- tables nouvelles n'ont qu'une politique de LECTURE (transparence) sauf
-- election_comite, que le bureau gère directement.
-- Ré-exécutable sans risque.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Paramètres et calendrier de l'élection
-- ---------------------------------------------------------------------
-- Les élections déjà closes avant ce script sont considérées comme
-- proclamées à leur date de fin : leurs résultats restent visibles de
-- tous, comme avant. Fait UNE SEULE FOIS (au premier ajout de la colonne
-- proclame_le), pour ne jamais proclamer en douce une élection plus récente
-- si le script est relancé.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'elections' and column_name = 'proclame_le') then
    alter table public.elections add column proclame_le timestamptz;
    alter table public.elections add column if not exists delai_recours_jours int not null default 7;
    update public.elections
       set proclame_le = coalesce(date_fin, now()), delai_recours_jours = 0
     where statut <> 'ouverte' or (date_fin is not null and date_fin < now());
  end if;
end $$;

alter table public.elections add column if not exists postes text[] not null default '{}';
alter table public.elections add column if not exists candidatures_debut timestamptz;
alter table public.elections add column if not exists candidatures_fin timestamptz;
alter table public.elections add column if not exists validation_fin timestamptz;   -- fin de la vérification d'éligibilité ; la campagne suit jusqu'au scrutin
alter table public.elections add column if not exists delai_recours_jours int not null default 7;
alter table public.elections add column if not exists anciennete_min_mois int not null default 0;
alter table public.elections add column if not exists exiger_cotisation boolean not null default false;
alter table public.elections add column if not exists quorum_pct numeric;           -- null = pas de quorum exigé
alter table public.elections add column if not exists procurations_autorisees boolean not null default true;
alter table public.elections add column if not exists proclame_par_nom text;
alter table public.elections add column if not exists inscrits_cloture int;         -- nombre d'électeurs figé à la proclamation (pour le PV)

alter table public.elections drop constraint if exists elections_params_check;
alter table public.elections add constraint elections_params_check check (
  delai_recours_jours between 0 and 90
  and anciennete_min_mois between 0 and 240
  and (quorum_pct is null or quorum_pct between 0 and 100)
);

-- Étape courante, calculée (jamais stockée, donc toujours juste).
-- Même règle que etapeElection() dans src/Elections.jsx.
create or replace function public.election_etape(e public.elections) returns text
language sql stable set search_path = '' as $fn$
  select case
    when e.proclame_le is not null and now() < e.proclame_le + make_interval(days => coalesce(e.delai_recours_jours, 0)) then 'recours'
    when e.proclame_le is not null then 'terminee'
    when e.statut <> 'ouverte' or (e.date_fin is not null and now() > e.date_fin) then 'depouillement'
    when e.date_debut is null or now() >= e.date_debut then 'scrutin'
    when e.candidatures_debut is not null and now() < e.candidatures_debut then 'preparation'
    when e.candidatures_fin is not null and now() < e.candidatures_fin then 'candidatures'
    when e.validation_fin is not null and now() < e.validation_fin then 'validation'
    when e.candidatures_fin is null then 'candidatures'   -- pas de calendrier détaillé : candidatures ouvertes jusqu'au scrutin
    else 'campagne'
  end
$fn$;

grant execute on function public.election_etape(public.elections) to authenticated;

-- Avant le scrutin = on peut encore modifier candidatures, comité, procurations.
create or replace function public.election_avant_scrutin(e public.elections) returns boolean
language sql stable set search_path = '' as $fn$
  select public.election_etape(e) in ('preparation', 'candidatures', 'validation', 'campagne')
$fn$;

-- Ordre chronologique des dates (saisie incohérente refusée).
create or replace function public.elections_verifier_dates() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if new.candidatures_debut is not null and new.candidatures_fin is not null and new.candidatures_fin <= new.candidatures_debut then
    raise exception 'La fin des candidatures doit suivre leur ouverture.';
  end if;
  if new.candidatures_fin is not null and new.validation_fin is not null and new.validation_fin < new.candidatures_fin then
    raise exception 'La validation des candidatures doit suivre leur clôture.';
  end if;
  if new.date_debut is not null and greatest(new.candidatures_fin, new.validation_fin) > new.date_debut then
    raise exception 'Le scrutin doit commencer après les candidatures et leur validation.';
  end if;
  if new.date_debut is not null and new.date_fin is not null and new.date_fin <= new.date_debut then
    raise exception 'La clôture du scrutin doit suivre son ouverture.';
  end if;
  -- Une élection proclamée est figée : seuls le statut et le délai de
  -- recours restent modifiables (et la proclamation passe par proclamer_election).
  if tg_op = 'UPDATE' and old.proclame_le is not null and (
       new.date_debut is distinct from old.date_debut or new.date_fin is distinct from old.date_fin
       or new.postes is distinct from old.postes) then
    raise exception 'Élection déjà proclamée : calendrier et postes ne sont plus modifiables.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_elections_verifier_dates on public.elections;
create trigger trg_elections_verifier_dates before insert or update on public.elections
for each row execute function public.elections_verifier_dates();

-- La proclamation ne se fait que par proclamer_election() : on empêche
-- qu'une simple mise à jour (politique « elections update » du bureau)
-- ne l'écrive ou ne l'efface.
create or replace function public.elections_garder_proclamation() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if coalesce(current_setting('unia.proclamation', true), '') <> 'oui' and (
       new.proclame_le is distinct from old.proclame_le
       or new.proclame_par_nom is distinct from old.proclame_par_nom
       or new.inscrits_cloture is distinct from old.inscrits_cloture) then
    raise exception 'La proclamation se fait uniquement par le président d''élection.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_elections_garder_proclamation on public.elections;
create trigger trg_elections_garder_proclamation before update on public.elections
for each row execute function public.elections_garder_proclamation();

-- ---------------------------------------------------------------------
-- 2) Candidatures : profession de foi, validation par le comité
-- ---------------------------------------------------------------------
-- Les candidatures déjà existantes sont réputées validées (default
-- 'validee' au moment de l'ajout de la colonne) ; les nouvelles partent
-- « en attente » de la décision du comité.
alter table public.election_candidats add column if not exists statut_candidature text not null default 'validee';
alter table public.election_candidats alter column statut_candidature set default 'en_attente';
alter table public.election_candidats add column if not exists profession_foi text;
alter table public.election_candidats add column if not exists motif_rejet text;
alter table public.election_candidats add column if not exists decide_par_nom text;
alter table public.election_candidats add column if not exists decide_le timestamptz;
alter table public.election_candidats add column if not exists depose_le timestamptz default now();

alter table public.election_candidats drop constraint if exists election_candidats_statut_check;
alter table public.election_candidats add constraint election_candidats_statut_check
  check (statut_candidature in ('en_attente', 'validee', 'rejetee'));

-- ---------------------------------------------------------------------
-- 3) Comité électoral
-- ---------------------------------------------------------------------
create table if not exists public.election_comite (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  election_id uuid not null references public.elections(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  role text not null check (role in ('president', 'scrutateur')),
  designe_le timestamptz not null default now(),
  unique (election_id, member_id)
);

comment on table public.election_comite is
  'Comité électoral d''une élection : 1 président d''élection + 2 à 4 scrutateurs, désignés par le bureau. Un membre du comité ne peut pas être candidat à la même élection.';

create unique index if not exists election_comite_un_president
  on public.election_comite (election_id) where role = 'president';

alter table public.election_comite enable row level security;

drop policy if exists "election_comite select" on public.election_comite;
create policy "election_comite select" on public.election_comite for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "election_comite insert" on public.election_comite;
create policy "election_comite insert" on public.election_comite for insert to authenticated
  with check (public.is_bureau() and association_id = public.current_association_id()
    and exists (select 1 from public.elections e where e.id = election_id and e.association_id = public.current_association_id()));
drop policy if exists "election_comite delete" on public.election_comite;
create policy "election_comite delete" on public.election_comite for delete to authenticated
  using (public.is_bureau() and association_id = public.current_association_id());

-- Le membre connecté fait-il partie du comité de cette élection ?
create or replace function public.est_comite_election(p_election_id uuid, p_role text default null) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.election_comite c
     where c.election_id = p_election_id
       and c.member_id = public.current_member_id()
       and (p_role is null or c.role = p_role)
  )
$fn$;

grant execute on function public.est_comite_election(uuid, text) to authenticated;

-- Gardes du comité : pas candidat, au plus 4 scrutateurs, même
-- association, membre actif, et figé une fois l'élection proclamée.
create or replace function public.election_comite_garde() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_el public.elections;
begin
  select * into v_el from public.elections where id = coalesce(new.election_id, old.election_id);
  if tg_op = 'DELETE' and coalesce(current_setting('unia.suppression_election', true), '') = 'oui' then return old; end if;
  if v_el.proclame_le is not null then
    raise exception 'Élection déjà proclamée : le comité ne peut plus changer.';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if new.association_id <> v_el.association_id then raise exception 'Élection d''une autre association.'; end if;
  if not exists (select 1 from public.members m where m.id = new.member_id and m.association_id = v_el.association_id and m.statut = 'Actif') then
    raise exception 'Le comité électoral se compose de membres actifs.';
  end if;
  if exists (select 1 from public.election_candidats c
              where c.election_id = new.election_id and c.member_id = new.member_id and c.statut_candidature <> 'rejetee') then
    raise exception 'Ce membre est candidat à cette élection : il ne peut pas siéger au comité électoral.';
  end if;
  if new.role = 'scrutateur' and (
       select count(*) from public.election_comite c
        where c.election_id = new.election_id and c.role = 'scrutateur' and c.id <> new.id) >= 4 then
    raise exception 'Le comité compte déjà 4 scrutateurs (maximum).';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_election_comite_garde on public.election_comite;
create trigger trg_election_comite_garde before insert or update or delete on public.election_comite
for each row execute function public.election_comite_garde();

drop trigger if exists trg_log_election_comite on public.election_comite;
create trigger trg_log_election_comite after insert or delete on public.election_comite
for each row execute function public.log_activity();

-- ---------------------------------------------------------------------
-- 4) Éligibilité automatique
-- ---------------------------------------------------------------------
-- Renvoie NULL si le membre peut VOTER, sinon un code de motif :
--   'non_membre' | 'inactif' | 'anciennete' | 'cotisation'
-- Ancienneté : comptée à la date d'ouverture du scrutin ; une date
-- d'adhésion inconnue ne bloque pas (l'information n'existe pas).
-- Cotisation : seulement si l'élection l'exige ; « à jour » = droit
-- d'inscription payé (members.inscription_paye ≥ montant de l'association,
-- 25 par défaut comme dans l'application).
create or replace function public.election_motif_electeur(p_election_id uuid, p_member_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_el public.elections;
  v_m public.members;
  v_montant numeric;
begin
  select * into v_el from public.elections where id = p_election_id;
  select * into v_m from public.members where id = p_member_id;
  if v_el.id is null or v_m.id is null or v_m.association_id <> v_el.association_id then return 'non_membre'; end if;
  if v_m.statut is distinct from 'Actif' then return 'inactif'; end if;
  if v_el.anciennete_min_mois > 0 and nullif(v_m.date_adhesion::text, '') is not null
     and nullif(v_m.date_adhesion::text, '')::date >(coalesce(v_el.date_debut, now()) - make_interval(months => v_el.anciennete_min_mois))::date then
    return 'anciennete';
  end if;
  if v_el.exiger_cotisation then
    select coalesce(a.inscription_montant, 25) into v_montant from public.associations a where a.id = v_el.association_id;
    if coalesce(v_m.inscription_paye, 0) < v_montant then return 'cotisation'; end if;
  end if;
  return null;
end;
$fn$;

-- Idem pour être CANDIDAT : électeur éligible ET hors comité électoral.
create or replace function public.election_motif_candidat(p_election_id uuid, p_member_id uuid) returns text
language sql stable security definer set search_path = '' as $fn$
  select coalesce(
    public.election_motif_electeur(p_election_id, p_member_id),
    case when exists (select 1 from public.election_comite c where c.election_id = p_election_id and c.member_id = p_member_id)
         then 'comite' end
  )
$fn$;

revoke all on function public.election_motif_electeur(uuid, uuid) from public, anon;
revoke all on function public.election_motif_candidat(uuid, uuid) from public, anon;

-- Liste d'éligibilité de tous les membres pour une élection (affichage :
-- choix d'un mandataire, ajout d'un candidat, « ma situation »).
create or replace function public.eligibilites_election(p_election_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'member_id', m.id,
           'electeur', public.election_motif_electeur(p_election_id, m.id),
           'candidat', public.election_motif_candidat(p_election_id, m.id)
         )), '[]'::jsonb)
    from public.members m
    join public.elections e on e.id = p_election_id and e.association_id = m.association_id
   where e.association_id = public.current_association_id()
     and m.statut is distinct from 'Supprimé'
$fn$;

grant execute on function public.eligibilites_election(uuid) to authenticated;

-- Garde des candidatures (ajout par le bureau OU dépôt par le membre) :
-- éligibilité, incompatibilité avec le comité, poste prévu, avant scrutin.
-- Et une fois le scrutin commencé, un candidat ne peut plus être retiré
-- ni changer de poste (ses bulletins seraient effacés ou déplacés).
create or replace function public.election_candidats_garde() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_el public.elections;
  v_motif text;
begin
  select * into v_el from public.elections where id = coalesce(new.election_id, old.election_id);

  if tg_op = 'DELETE' then
    if coalesce(current_setting('unia.suppression_election', true), '') = 'oui' then return old; end if;
    if v_el.id is not null and not public.election_avant_scrutin(v_el) then
      raise exception 'Le scrutin a commencé : un candidat ne peut plus être retiré.';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.member_id is distinct from old.member_id or new.poste_vise is distinct from old.poste_vise
                           or new.election_id is distinct from old.election_id)
     and not public.election_avant_scrutin(v_el) then
    raise exception 'Le scrutin a commencé : la candidature n''est plus modifiable.';
  end if;

  if tg_op = 'INSERT' or new.member_id is distinct from old.member_id or new.poste_vise is distinct from old.poste_vise then
    if not public.election_avant_scrutin(v_el) then
      raise exception 'Les candidatures sont closes : le scrutin a commencé.';
    end if;
    v_motif := public.election_motif_candidat(new.election_id, new.member_id);
    if v_motif = 'comite' then raise exception 'Ce membre siège au comité électoral : il ne peut pas être candidat.'; end if;
    if v_motif is not null then raise exception 'Ce membre n''est pas éligible comme candidat (%).', v_motif; end if;
    if coalesce(array_length(v_el.postes, 1), 0) > 0 and not (coalesce(new.poste_vise, '') = any(v_el.postes)) then
      raise exception 'Poste inconnu pour cette élection.';
    end if;
    if exists (select 1 from public.election_candidats c
                where c.election_id = new.election_id and c.member_id = new.member_id
                  and coalesce(c.poste_vise, '') = coalesce(new.poste_vise, '')
                  and c.statut_candidature <> 'rejetee' and c.id <> new.id) then
      raise exception 'Ce membre est déjà candidat à ce poste.';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_election_candidats_garde on public.election_candidats;
create trigger trg_election_candidats_garde before insert or update or delete on public.election_candidats
for each row execute function public.election_candidats_garde();

-- Dépôt de sa propre candidature (pendant l'appel à candidatures).
create or replace function public.deposer_candidature(p_election_id uuid, p_poste text, p_profession_foi text) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_member uuid := public.current_member_id();
  v_el public.elections;
  v_id uuid;
begin
  if v_member is null then raise exception 'Votre compte n''est pas relié à une fiche de membre.'; end if;
  select * into v_el from public.elections where id = p_election_id;
  if v_el.id is null or v_el.association_id <> public.current_association_id() then raise exception 'Élection introuvable.'; end if;
  if public.election_etape(v_el) <> 'candidatures' then raise exception 'L''appel à candidatures n''est pas ouvert.'; end if;
  insert into public.election_candidats (election_id, member_id, poste_vise, profession_foi, statut_candidature, depose_le)
  values (p_election_id, v_member, coalesce(trim(p_poste), ''), nullif(trim(coalesce(p_profession_foi, '')), ''), 'en_attente', now())
  returning id into v_id;
  return v_id;
end;
$fn$;

-- Le candidat modifie sa profession de foi, ou retire sa candidature,
-- tant que le scrutin n'a pas commencé.
create or replace function public.modifier_candidature(p_candidat_id uuid, p_profession_foi text, p_retirer boolean default false) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_c public.election_candidats;
  v_el public.elections;
begin
  select * into v_c from public.election_candidats where id = p_candidat_id;
  select * into v_el from public.elections where id = v_c.election_id;
  if v_c.id is null or v_el.association_id <> public.current_association_id()
     or v_c.member_id is distinct from public.current_member_id() then
    raise exception 'Non autorisé.';
  end if;
  if not public.election_avant_scrutin(v_el) then raise exception 'Le scrutin a commencé : candidature figée.'; end if;
  if p_retirer then
    delete from public.election_candidats where id = p_candidat_id;
  else
    update public.election_candidats set profession_foi = nullif(trim(coalesce(p_profession_foi, '')), '') where id = p_candidat_id;
  end if;
end;
$fn$;

-- Décision du comité sur une candidature.
create or replace function public.statuer_candidature(p_candidat_id uuid, p_decision text, p_motif text default null) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_c public.election_candidats;
  v_el public.elections;
  v_motif text;
  v_nom text;
begin
  select * into v_c from public.election_candidats where id = p_candidat_id;
  select * into v_el from public.elections where id = v_c.election_id;
  if v_c.id is null or v_el.association_id <> public.current_association_id()
     or not public.est_comite_election(v_el.id) then
    raise exception 'Seul le comité électoral peut statuer sur une candidature.';
  end if;
  if not public.election_avant_scrutin(v_el) then raise exception 'Le scrutin a commencé : les candidatures sont figées.'; end if;
  if p_decision not in ('validee', 'rejetee', 'en_attente') then raise exception 'Décision invalide.'; end if;
  if p_decision = 'rejetee' and coalesce(trim(p_motif), '') = '' then raise exception 'Motif du rejet requis.'; end if;
  if p_decision = 'validee' then
    v_motif := public.election_motif_candidat(v_el.id, v_c.member_id);
    if v_motif is not null then raise exception 'Candidat non éligible (%) : validation impossible.', v_motif; end if;
  end if;
  select m.nom into v_nom from public.members m where m.id = public.current_member_id();
  update public.election_candidats
     set statut_candidature = p_decision,
         motif_rejet = case when p_decision = 'rejetee' then trim(p_motif) end,
         decide_par_nom = v_nom, decide_le = now()
   where id = p_candidat_id;
end;
$fn$;

grant execute on function public.deposer_candidature(uuid, text, text) to authenticated;
grant execute on function public.modifier_candidature(uuid, text, boolean) to authenticated;
grant execute on function public.statuer_candidature(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Procurations
-- ---------------------------------------------------------------------
-- Règles : déclarée par le mandant AVANT le scrutin ; mandant et
-- mandataire électeurs éligibles ; un mandataire ne porte qu'UNE
-- procuration et ne peut pas lui-même en avoir donné une ; validée par
-- le comité. Pendant le scrutin, le mandataire vote une fois pour lui et
-- une fois pour son mandant ; l'émargement du mandant indique « par
-- procuration » (jamais le choix).
create table if not exists public.election_procurations (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  election_id uuid not null references public.elections(id) on delete cascade,
  mandant_id uuid not null references public.members(id) on delete cascade,
  mandataire_id uuid not null references public.members(id) on delete cascade,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'validee', 'refusee', 'annulee')),
  declaree_le timestamptz not null default now(),
  decide_par_nom text,
  decide_le timestamptz,
  check (mandant_id <> mandataire_id)
);

comment on table public.election_procurations is
  'Procurations de vote : une par mandataire au plus, déclarée avant le scrutin, validée par le comité électoral. Écriture uniquement via declarer_procuration / annuler_procuration / statuer_procuration.';

create unique index if not exists election_procurations_un_mandant
  on public.election_procurations (election_id, mandant_id) where statut in ('en_attente', 'validee');
create unique index if not exists election_procurations_un_mandataire
  on public.election_procurations (election_id, mandataire_id) where statut in ('en_attente', 'validee');

alter table public.election_procurations enable row level security;
drop policy if exists "election_procurations select" on public.election_procurations;
create policy "election_procurations select" on public.election_procurations for select to authenticated
  using (association_id = public.current_association_id());

drop trigger if exists trg_log_election_procurations on public.election_procurations;
create trigger trg_log_election_procurations after insert or update of statut on public.election_procurations
for each row execute function public.log_activity();

create or replace function public.declarer_procuration(p_election_id uuid, p_mandataire_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_member uuid := public.current_member_id();
  v_el public.elections;
  v_id uuid;
begin
  if v_member is null then raise exception 'Votre compte n''est pas relié à une fiche de membre.'; end if;
  select * into v_el from public.elections where id = p_election_id;
  if v_el.id is null or v_el.association_id <> public.current_association_id() then raise exception 'Élection introuvable.'; end if;
  if not v_el.procurations_autorisees then raise exception 'Les procurations ne sont pas autorisées pour cette élection.'; end if;
  if not public.election_avant_scrutin(v_el) then raise exception 'Une procuration se déclare avant l''ouverture du scrutin.'; end if;
  if p_mandataire_id = v_member then raise exception 'Vous ne pouvez pas vous donner procuration.'; end if;
  if public.election_motif_electeur(p_election_id, v_member) is not null then raise exception 'Vous n''êtes pas électeur pour cette élection.'; end if;
  if public.election_motif_electeur(p_election_id, p_mandataire_id) is not null then raise exception 'Ce mandataire n''est pas électeur pour cette élection.'; end if;
  if exists (select 1 from public.election_procurations p where p.election_id = p_election_id and p.mandant_id = p_mandataire_id and p.statut in ('en_attente', 'validee')) then
    raise exception 'Ce membre a lui-même donné procuration : il ne peut pas en recevoir.';
  end if;
  if exists (select 1 from public.election_procurations p where p.election_id = p_election_id and p.mandataire_id = v_member and p.statut in ('en_attente', 'validee')) then
    raise exception 'Vous portez déjà une procuration : vous ne pouvez pas en donner une.';
  end if;
  begin
    insert into public.election_procurations (association_id, election_id, mandant_id, mandataire_id)
    values (v_el.association_id, p_election_id, v_member, p_mandataire_id) returning id into v_id;
  exception when unique_violation then
    raise exception 'Procuration impossible : vous en avez déjà donné une, ou ce mandataire en porte déjà une.';
  end;
  return v_id;
end;
$fn$;

create or replace function public.annuler_procuration(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_p public.election_procurations;
  v_el public.elections;
begin
  select * into v_p from public.election_procurations where id = p_id;
  select * into v_el from public.elections where id = v_p.election_id;
  if v_p.id is null or v_p.association_id <> public.current_association_id()
     or v_p.mandant_id is distinct from public.current_member_id() then
    raise exception 'Non autorisé.';
  end if;
  if not public.election_avant_scrutin(v_el) then raise exception 'Le scrutin a commencé : la procuration ne peut plus être annulée.'; end if;
  update public.election_procurations set statut = 'annulee' where id = p_id and statut in ('en_attente', 'validee');
end;
$fn$;

create or replace function public.statuer_procuration(p_id uuid, p_decision text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_p public.election_procurations;
  v_el public.elections;
  v_nom text;
begin
  select * into v_p from public.election_procurations where id = p_id;
  select * into v_el from public.elections where id = v_p.election_id;
  if v_p.id is null or v_p.association_id <> public.current_association_id() or not public.est_comite_election(v_el.id) then
    raise exception 'Seul le comité électoral peut statuer sur une procuration.';
  end if;
  if not public.election_avant_scrutin(v_el) then raise exception 'Le scrutin a commencé : les procurations sont figées.'; end if;
  if p_decision not in ('validee', 'refusee') then raise exception 'Décision invalide.'; end if;
  if v_p.statut not in ('en_attente', 'validee', 'refusee') then raise exception 'Procuration annulée par le mandant.'; end if;
  select m.nom into v_nom from public.members m where m.id = public.current_member_id();
  update public.election_procurations set statut = p_decision, decide_par_nom = v_nom, decide_le = now() where id = p_id;
end;
$fn$;

grant execute on function public.declarer_procuration(uuid, uuid) to authenticated;
grant execute on function public.annuler_procuration(uuid) to authenticated;
grant execute on function public.statuer_procuration(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Voter (avec procuration éventuelle)
-- ---------------------------------------------------------------------
-- L'émargement note éventuellement le mandataire (vote_par) : cela dit
-- QUI a voté pour le mandant, jamais POUR QUI.
alter table public.election_emargements add column if not exists vote_par uuid references public.members(id) on delete set null;

create or replace function public.voter_scrutin(p_election_id uuid, p_candidat_id uuid, p_mandant_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_votant uuid := public.current_member_id();
  v_pour uuid;
  v_el public.elections;
  v_poste text;
  v_motif text;
begin
  if v_votant is null then raise exception 'Votre compte n''est pas relié à une fiche de membre.'; end if;
  v_pour := coalesce(p_mandant_id, v_votant);

  select * into v_el from public.elections where id = p_election_id;
  if v_el.id is null or v_el.association_id <> public.current_association_id() then raise exception 'Élection introuvable.'; end if;
  if public.election_etape(v_el) <> 'scrutin' then raise exception 'Le scrutin n''est pas ouvert.'; end if;

  if public.election_motif_electeur(p_election_id, v_votant) is not null then
    raise exception 'Vous n''êtes pas électeur pour cette élection.';
  end if;
  if p_mandant_id is not null then
    if not exists (select 1 from public.election_procurations p
                    where p.election_id = p_election_id and p.mandant_id = p_mandant_id
                      and p.mandataire_id = v_votant and p.statut = 'validee') then
      raise exception 'Aucune procuration validée ne vous permet de voter pour ce membre.';
    end if;
    v_motif := public.election_motif_electeur(p_election_id, p_mandant_id);
    if v_motif is not null then raise exception 'Votre mandant n''est plus électeur (%).', v_motif; end if;
  end if;

  select coalesce(c.poste_vise, '') into v_poste
    from public.election_candidats c
   where c.id = p_candidat_id and c.election_id = p_election_id and c.statut_candidature = 'validee';
  if not found then raise exception 'Candidat introuvable ou non validé pour cette élection.'; end if;

  begin
    insert into public.election_emargements (election_id, poste, member_id, vote_par)
    values (p_election_id, v_poste, v_pour, case when p_mandant_id is not null then v_votant end);
  exception when unique_violation then
    raise exception 'Vous avez déjà voté pour ce poste.';
  end;
  insert into public.election_bulletins (election_id, poste, candidat_id) values (p_election_id, v_poste, p_candidat_id);
end;
$fn$;

grant execute on function public.voter_scrutin(uuid, uuid, uuid) to authenticated;

-- L'ancienne entrée (2026-10-09a) passe désormais par les mêmes contrôles.
create or replace function public.voter_election(p_election_id uuid, p_candidat_id uuid) returns void
language sql security definer set search_path = '' as $fn$
  select public.voter_scrutin(p_election_id, p_candidat_id, null)
$fn$;

grant execute on function public.voter_election(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7) État des élections : étape, participation, quorum en direct ;
--    voix au comité/bureau dès la clôture, à tous après proclamation
-- ---------------------------------------------------------------------
create or replace function public.etat_elections() returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'election_id', x.id,
      'etape', x.etape,
      'close', x.etape in ('depouillement', 'recours', 'terminee'),
      'inscrits', x.inscrits,
      'votants', x.votants,
      'votants_par_procuration', x.par_procuration,
      'votants_par_poste', x.par_poste,
      'quorum_requis', x.quorum_requis,
      'quorum_atteint', case when x.quorum_requis is null then null else x.votants >= x.quorum_requis end,
      'voix', case when x.etape in ('depouillement', 'recours', 'terminee')
                    and (x.proclame_le is not null or public.is_bureau() or public.est_comite_election(x.id)) then (
        select coalesce(jsonb_object_agg(v.candidat_id, v.n), '{}'::jsonb)
          from (select b.candidat_id, count(*) as n from public.election_bulletins b where b.election_id = x.id group by b.candidat_id) v
      ) else null end
    )), '[]'::jsonb)
  from (
    select e.id, e.proclame_le, public.election_etape(e) as etape,
           i.inscrits,
           (select count(distinct em.member_id) from public.election_emargements em where em.election_id = e.id) as votants,
           (select count(distinct em.member_id) from public.election_emargements em where em.election_id = e.id and em.vote_par is not null) as par_procuration,
           (select coalesce(jsonb_object_agg(p.poste, p.n), '{}'::jsonb)
              from (select em.poste, count(*) as n from public.election_emargements em where em.election_id = e.id group by em.poste) p) as par_poste,
           case when e.quorum_pct is null then null else ceil(i.inscrits * e.quorum_pct / 100.0)::int end as quorum_requis
      from public.elections e
      cross join lateral (
        select coalesce(e.inscrits_cloture, (
          select count(*)::int from public.members m
           where m.association_id = e.association_id
             and public.election_motif_electeur(e.id, m.id) is null
        )) as inscrits
      ) i
     where e.association_id = public.current_association_id()
  ) x
$fn$;

grant execute on function public.etat_elections() to authenticated;

-- ---------------------------------------------------------------------
-- 8) Départage d'une égalité par tirage au sort vérifiable
-- ---------------------------------------------------------------------
create table if not exists public.election_departages (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  election_id uuid not null references public.elections(id) on delete cascade,
  poste text not null default '',
  tirage_id uuid not null references public.tirages(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (election_id, poste)
);

comment on table public.election_departages is
  'Égalité en tête d''un poste : tirage au sort (rubrique Tirages, type libre, 1 gagnant) entre les candidats à égalité. Le gagnant du tirage est élu.';

alter table public.election_departages enable row level security;
drop policy if exists "election_departages select" on public.election_departages;
create policy "election_departages select" on public.election_departages for select to authenticated
  using (association_id = public.current_association_id());

-- Candidats à égalité en tête d'un poste (vide s'il n'y a pas d'égalité).
create or replace function public.election_ex_aequo(p_election_id uuid, p_poste text) returns uuid[]
language sql stable security definer set search_path = '' as $fn$
  with v as (
    select c.id, c.member_id, (select count(*) from public.election_bulletins b where b.candidat_id = c.id) as n
      from public.election_candidats c
     where c.election_id = p_election_id and coalesce(c.poste_vise, '') = coalesce(p_poste, '')
       and c.statut_candidature = 'validee'
  ), m as (select max(n) as mx from v)
  select case when (select count(*) from v, m where v.n = m.mx and m.mx > 0) > 1
              then (select array_agg(v.member_id order by v.member_id) from v, m where v.n = m.mx) else '{}'::uuid[] end
$fn$;

revoke all on function public.election_ex_aequo(uuid, text) from public, anon, authenticated;

create or replace function public.departager_election(p_election_id uuid, p_poste text) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_el public.elections;
  v_ids uuid[];
  v_tirage uuid;
begin
  select * into v_el from public.elections where id = p_election_id;
  if v_el.id is null or v_el.association_id <> public.current_association_id() or not public.is_bureau() then
    raise exception 'Non autorisé.';
  end if;
  if public.election_etape(v_el) <> 'depouillement' then raise exception 'Le départage se fait pendant le dépouillement.'; end if;
  v_ids := public.election_ex_aequo(p_election_id, p_poste);
  if coalesce(array_length(v_ids, 1), 0) < 2 then raise exception 'Aucune égalité à départager pour ce poste.'; end if;
  if exists (select 1 from public.election_departages d join public.tirages t on t.id = d.tirage_id
              where d.election_id = p_election_id and d.poste = coalesce(p_poste, '') and t.statut <> 'annule') then
    raise exception 'Un tirage de départage existe déjà pour ce poste.';
  end if;

  v_tirage := public.preparer_tirage(
    'Départage — ' || v_el.titre || coalesce(' — ' || nullif(p_poste, ''), ''), 'libre', v_ids, 1);

  insert into public.election_departages (association_id, election_id, poste, tirage_id)
  values (v_el.association_id, p_election_id, coalesce(p_poste, ''), v_tirage)
  on conflict (election_id, poste) do update set tirage_id = excluded.tirage_id, created_at = now();
  return v_tirage;
end;
$fn$;

grant execute on function public.departager_election(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 9) Proclamation par le président d'élection
-- ---------------------------------------------------------------------
-- Conditions : dépouillement en cours, comité complet (1 président,
-- 2 à 4 scrutateurs), toute égalité départagée par un tirage terminé.
-- Fige le nombre d'inscrits et ouvre le délai de recours.
create or replace function public.proclamer_election(p_election_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_el public.elections;
  v_nb_scrut int;
  v_poste text;
  v_ids uuid[];
  v_nom text;
  v_inscrits int;
begin
  select * into v_el from public.elections where id = p_election_id for update;
  if v_el.id is null or v_el.association_id <> public.current_association_id()
     or not public.est_comite_election(p_election_id, 'president') then
    raise exception 'Seul le président d''élection peut proclamer les résultats.';
  end if;
  if public.election_etape(v_el) <> 'depouillement' then raise exception 'La proclamation suit la clôture du scrutin.'; end if;

  select count(*) into v_nb_scrut from public.election_comite where election_id = p_election_id and role = 'scrutateur';
  if v_nb_scrut < 2 then raise exception 'Le comité doit compter au moins 2 scrutateurs.'; end if;

  for v_poste in select distinct coalesce(c.poste_vise, '') from public.election_candidats c where c.election_id = p_election_id loop
    v_ids := public.election_ex_aequo(p_election_id, v_poste);
    if coalesce(array_length(v_ids, 1), 0) > 1 and not exists (
         select 1 from public.election_departages d join public.tirages t on t.id = d.tirage_id
          where d.election_id = p_election_id and d.poste = v_poste and t.statut = 'termine') then
      raise exception 'Égalité non départagée pour le poste « % » : lancez d''abord le tirage au sort.', nullif(v_poste, '');
    end if;
  end loop;

  select count(*)::int into v_inscrits from public.members m
   where m.association_id = v_el.association_id and public.election_motif_electeur(p_election_id, m.id) is null;
  select m.nom into v_nom from public.members m where m.id = public.current_member_id();

  perform set_config('unia.proclamation', 'oui', true);
  update public.elections
     set proclame_le = now(), proclame_par_nom = v_nom, inscrits_cloture = v_inscrits,
         statut = case when statut = 'ouverte' then 'fermée' else statut end
   where id = p_election_id;
  perform set_config('unia.proclamation', '', true);
end;
$fn$;

grant execute on function public.proclamer_election(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9 bis) Suppression d'une élection entière (bureau)
-- ---------------------------------------------------------------------
-- Les gardes ci-dessus empêchent de retirer un candidat ou un membre du
-- comité une fois le scrutin commencé / l'élection proclamée. Supprimer
-- TOUTE l'élection (ex. élection de test) reste une décision du bureau :
-- cette fonction lève ces gardes le temps de la suppression (émargements,
-- bulletins, comité, procurations et départages partent avec elle).
create or replace function public.supprimer_election(p_election_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  if not public.is_bureau() or not exists (
       select 1 from public.elections e where e.id = p_election_id and e.association_id = public.current_association_id()) then
    raise exception 'Non autorisé.';
  end if;
  perform set_config('unia.suppression_election', 'oui', true);
  delete from public.election_candidats where election_id = p_election_id;
  delete from public.elections where id = p_election_id;
  perform set_config('unia.suppression_election', '', true);
end;
$fn$;

grant execute on function public.supprimer_election(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 10) Temps réel : participation et décisions du comité en direct.
--     (Les bulletins ne sont JAMAIS publiés.)
-- ---------------------------------------------------------------------
do $$
declare v_t text;
begin
  foreach v_t in array array['elections', 'election_emargements', 'election_candidats', 'election_comite', 'election_procurations', 'election_departages'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_t) then
      execute format('alter publication supabase_realtime add table public.%I', v_t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select public.etat_elections();
--   select proname from pg_proc where proname in ('deposer_candidature','statuer_candidature','declarer_procuration',
--     'statuer_procuration','voter_scrutin','departager_election','proclamer_election','eligibilites_election');
-- ---------------------------------------------------------------------
