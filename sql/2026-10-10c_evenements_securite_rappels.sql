-- =====================================================================
-- Événements — codes QR protégés, rappel aux bénévoles, page publique
-- (2026-10-10, à exécuter APRÈS 2026-10-10b_evenements_benevolat_cartes.sql)
-- =====================================================================
-- 1. FAILLE CORRIGÉE — codes QR lisibles par les autres membres
--    Le code de la carte de membre (members.verification_token) et celui
--    du billet (event_rsvps.billet_token) étaient lisibles par TOUS les
--    membres de l'association (les politiques de lecture portent sur la
--    ligne entière). Un membre un peu technique pouvait donc afficher le
--    QR d'un autre.
--    • Le vrai code de chaque carte part dans member_card_tokens, lisible
--      seulement par la personne elle-même et par le bureau. Les cartes
--      déjà distribuées gardent LEUR code (recopié tel quel) : elles
--      restent valables.
--    • L'ancienne colonne members.verification_token reçoit une valeur
--      aléatoire sans usage : la lire ne sert plus à rien.
--    • Toutes les fonctions qui reconnaissaient une carte (vérification
--      publique, pointage des présences, remise des achats groupés,
--      entrée des événements) sont réécrites automatiquement pour lire
--      la table protégée.
--    • Le billet par événement n'est plus accepté seul : l'entrée se fait
--      avec la carte de membre (qui vérifie l'inscription). Le code du
--      billet, toujours lisible, ne permet donc plus rien.
-- 2. RAPPEL AUX BÉNÉVOLES 2 jours avant l'événement (tâche quotidienne).
-- 3. PAGE PUBLIQUE de l'événement : mentions légales et couleur de
--    l'association exposées pour le programme en PDF (aucune donnée
--    personnelle).
-- Ré-exécutable sans risque.
-- ATTENTION : ne pas relancer ensuite les anciens scripts qui redéfinissent
-- verify_member_card, checkin_member ou achats_remettre (2026-09-28i,
-- 2026-09-29…, 2026-09-30…, 2026-10-09e) sans relancer CE script après.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Codes des cartes de membre, protégés
-- ---------------------------------------------------------------------
create table if not exists public.member_card_tokens (
  member_id uuid primary key references public.members(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  emis_le timestamptz not null default now()
);

comment on table public.member_card_tokens is
  'Code secret de la carte de membre (QR). Lisible seulement par le membre lui-même et par le bureau. Remplace members.verification_token, qui était lisible par tous les membres.';

alter table public.member_card_tokens enable row level security;
drop policy if exists "member_card_tokens select" on public.member_card_tokens;
create policy "member_card_tokens select" on public.member_card_tokens for select to authenticated
  using (association_id = public.current_association_id()
         and (member_id = public.current_member_id() or public.is_bureau()));

-- Reprise des codes existants (cartes déjà distribuées), puis l'ancienne
-- colonne reçoit une valeur sans usage. Une seule fois par membre.
insert into public.member_card_tokens (member_id, association_id, token)
select m.id, m.association_id, m.verification_token from public.members m
on conflict (member_id) do nothing;

update public.members m set verification_token = gen_random_uuid()
  from public.member_card_tokens c
 where c.member_id = m.id and c.token = m.verification_token;

-- Nouveaux membres : un code est créé automatiquement.
create or replace function public.member_card_token_creer() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  insert into public.member_card_tokens (member_id, association_id) values (new.id, new.association_id)
  on conflict (member_id) do nothing;
  return new;
end;
$fn$;
drop trigger if exists trg_member_card_token_creer on public.members;
create trigger trg_member_card_token_creer after insert on public.members
for each row execute function public.member_card_token_creer();

-- Membre correspondant à un code de carte (usage interne des fonctions).
create or replace function public.membre_par_jeton(p_token uuid) returns uuid
language sql stable security definer set search_path = '' as $fn$
  select c.member_id from public.member_card_tokens c where c.token = p_token
$fn$;
revoke all on function public.membre_par_jeton(uuid) from public, anon, authenticated;

-- Mon propre code (affichage de ma carte / de mon badge).
create or replace function public.mon_jeton_carte() returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_member uuid := public.current_member_id();
  v_token uuid;
begin
  if v_member is null then return null; end if;
  select token into v_token from public.member_card_tokens where member_id = v_member;
  if v_token is null then
    insert into public.member_card_tokens (member_id, association_id)
    select m.id, m.association_id from public.members m where m.id = v_member
    on conflict (member_id) do nothing
    returning token into v_token;
  end if;
  return v_token;
end;
$fn$;
grant execute on function public.mon_jeton_carte() to authenticated;

-- Carte perdue : nouveau code (l'ancien cesse aussitôt de fonctionner).
create or replace function public.regenerer_jeton_carte(p_member_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_member uuid := coalesce(p_member_id, public.current_member_id());
  v_token uuid;
begin
  if v_member is null or not exists (select 1 from public.members m where m.id = v_member and m.association_id = public.current_association_id())
     or (v_member is distinct from public.current_member_id() and not public.is_bureau()) then
    raise exception 'Non autorisé.';
  end if;
  insert into public.member_card_tokens (member_id, association_id, token, emis_le)
  select m.id, m.association_id, gen_random_uuid(), now() from public.members m where m.id = v_member
  on conflict (member_id) do update set token = excluded.token, emis_le = now()
  returning token into v_token;
  return v_token;
end;
$fn$;
grant execute on function public.regenerer_jeton_carte(uuid) to authenticated;

-- Réécriture automatique de TOUTES les fonctions qui reconnaissaient une
-- carte par l'ancienne colonne (version actuellement installée, quelle
-- qu'elle soit) : « m.verification_token = p_token » devient
-- « m.id = public.membre_par_jeton(p_token) ». Sans effet au 2e passage.
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.prosrc like '%m.verification_token = p_token%'
  loop
    v_def := replace(pg_get_functiondef(r.oid), 'm.verification_token = p_token', 'm.id = public.membre_par_jeton(p_token)');
    execute v_def;
  end loop;
end $$;

-- Le billet seul n'ouvre plus l'entrée (son code reste lisible par les
-- membres) : seul le pointage par carte, qui vérifie l'inscription,
-- l'appelle désormais en interne.
revoke execute on function public.checkin_event_ticket(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) Rappel aux bénévoles 2 jours avant l'événement
-- ---------------------------------------------------------------------
alter table public.event_volunteer_signups add column if not exists rappel_le timestamptz;

create or replace function public.rappels_benevoles() returns integer
language plpgsql security definer set search_path = '' as $fn$
declare
  v record;
  v_profile uuid;
  v_n integer := 0;
begin
  -- Tâche quotidienne : événements qui commencent dans 36 à 60 heures,
  -- soit un seul rappel par engagement confirmé (~2 jours avant).
  for v in
    select s.id, s.member_id, s.association_id, t.titre as tache, e.titre as evenement, e.date_debut, e.lieu
      from public.event_volunteer_signups s
      join public.event_volunteer_tasks t on t.id = s.task_id
      join public.events e on e.id = t.event_id
     where s.statut in ('confirme', 'retrait_demande') and s.rappel_le is null
       and coalesce(e.annule, false) = false
       and e.date_debut between now() + interval '36 hours' and now() + interval '60 hours'
  loop
    select p.id into v_profile from public.profiles p where p.member_id = v.member_id;
    perform public.notify_profile(v.association_id, v_profile, '🙋 Rappel : vous êtes bénévole',
      '« ' || v.tache || ' » — ' || v.evenement || ', le ' || to_char(v.date_debut at time zone 'America/Moncton', 'DD/MM à HH24"h"MI')
      || coalesce(' (' || v.lieu || ')', '') || '. Un empêchement ? Prévenez le bureau dans Mon espace.');
    update public.event_volunteer_signups set rappel_le = now() where id = v.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;
revoke all on function public.rappels_benevoles() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('benevoles-rappels-quotidiens', '0 13 * * *', 'select public.rappels_benevoles();');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3) Page publique : mentions légales et couleur pour le programme PDF
-- ---------------------------------------------------------------------
-- (mêmes colonnes qu'avant, 4 ajoutées à la fin)
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
  a.devise_monetaire as association_devise_monetaire,
  a.statut_juridique as association_statut_juridique,
  a.numero_enregistrement as association_numero_enregistrement,
  a.adresse as association_adresse,
  a.couleur_primaire as association_couleur_primaire
from public.events e
join public.associations a on a.id = e.association_id
where a.vitrine_active = true and a.slug_public is not null
  and e.public_inscription = true and e.annule = false;

grant select on public.public_event_detail to anon, authenticated;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select count(*) from public.member_card_tokens;                          -- = nombre de membres
--   select count(*) from pg_proc where prosrc like '%m.verification_token = p_token%';   -- doit être 0
-- ---------------------------------------------------------------------
