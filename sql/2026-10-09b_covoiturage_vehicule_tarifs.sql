-- =====================================================================
-- Covoiturage professionnel — véhicule, conducteur identifié, grille
-- tarifaire par tranches de minutes, prix figé, paiement entre membres,
-- rappels (2026-10-09)
-- =====================================================================
-- Script RÉ-EXÉCUTABLE (à lancer dans Supabase → SQL Editor). Prérequis :
-- tous les scripts covoiturage précédents (2026-10-06 → 2026-10-08l).
--
-- Contenu :
--   1) Grille tarifaire par tranches de MINUTES, paramétrée par le bureau,
--      VERSIONNÉE (chaque enregistrement crée une nouvelle version ; les
--      anciennes restent consultables pour l'historique des réservations).
--   2) Fiche véhicule (+ plaque dans une table à part, visible seulement
--      du conducteur, du bureau et des passagers CONFIRMÉS).
--   3) Documents du conducteur (permis, assurance, immatriculation) :
--      optionnels, à la demande du bureau, dans un bucket PRIVÉ, avec date
--      d'expiration et rappel 30 jours avant.
--   4) Prix : calculé sur la durée ESTIMÉE du trajet, PAR PASSAGER, FIGÉ
--      à la réservation. Le conducteur peut baisser ou offrir, JAMAIS
--      dépasser la grille (contrôlé ici, en base).
--   5) Options : frais d'attente, tarif solidaire, frais réels déclarés.
--   6) Paiement entre membres (espèces/Interac) : l'application enregistre
--      seulement payé / non payé + rappels. L'association ne détient
--      jamais l'argent : c'est une « contribution aux frais de carburant »,
--      pas un revenu.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Petit utilitaire : distance à vol d'oiseau (km), sans PostGIS
-- ---------------------------------------------------------------------
create or replace function public.covoiturage_distance_km(p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $fn$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ));
$fn$;
comment on function public.covoiturage_distance_km(double precision, double precision, double precision, double precision) is
  'Distance à vol d''oiseau en km (formule de haversine) — sert à vérifier qu''une durée estimée envoyée par l''application reste plausible.';

-- ---------------------------------------------------------------------
-- 1) Grille tarifaire (versionnée)
-- ---------------------------------------------------------------------
create table if not exists public.carpool_tarif_grilles (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  version integer not null default 1,
  actif boolean not null default true,
  -- Tranches : [{ "de": 0, "a": 15, "montant": 3 }, { "de": 15, "a": 30, "montant": 5 }, ...]
  -- Une durée de m minutes tombe dans la tranche où de < m <= a (la
  -- première tranche inclut 0). Sans trou ni chevauchement (vérifié par
  -- enregistrer_grille_tarifaire_covoiturage).
  tranches jsonb not null,
  -- Dernière tranche « au-delà » OBLIGATOIRE : au-delà de la dernière
  -- borne, au_dela_montant, puis + au_dela_montant_par_tranche toutes les
  -- au_dela_par_min minutes supplémentaires.
  au_dela_montant numeric not null check (au_dela_montant >= 0),
  au_dela_par_min integer not null check (au_dela_par_min >= 1),
  au_dela_montant_par_tranche numeric not null default 0 check (au_dela_montant_par_tranche >= 0),
  -- Options activables par l'association
  attente_actif boolean not null default false,
  attente_franchise_min integer not null default 5 check (attente_franchise_min >= 0),
  attente_montant_par_min numeric not null default 0 check (attente_montant_par_min >= 0),
  attente_plafond numeric check (attente_plafond is null or attente_plafond >= 0),
  solidaire_actif boolean not null default false,
  solidaire_pct numeric not null default 0 check (solidaire_pct between 0 and 100),
  solidaire_etudiants boolean not null default true,
  solidaire_aines boolean not null default true,
  solidaire_evenements boolean not null default true,
  frais_reels_actif boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists carpool_tarif_grilles_assoc_idx on public.carpool_tarif_grilles(association_id);
drop index if exists carpool_tarif_grilles_une_active;
create unique index carpool_tarif_grilles_une_active on public.carpool_tarif_grilles(association_id) where actif;
comment on table public.carpool_tarif_grilles is
  'Grille tarifaire du covoiturage (contribution aux frais de carburant), par tranches de minutes de trajet ESTIMÉ — une seule version active par association ; les versions précédentes sont conservées pour l''historique (chaque réservation pointe vers la version appliquée).';

alter table public.carpool_tarif_grilles enable row level security;
drop policy if exists "carpool_tarif_grilles select" on public.carpool_tarif_grilles;
create policy "carpool_tarif_grilles select" on public.carpool_tarif_grilles for select to authenticated
  using (association_id = public.current_association_id());
-- Aucune policy d'écriture directe : tout passe par les fonctions ci-dessous.

-- Calcul du prix (par passager) pour une durée donnée — renvoie le détail
-- de la tranche appliquée, enregistré tel quel sur la réservation.
create or replace function public.covoiturage_prix_grille(p_grille_id uuid, p_minutes numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  g record;
  tr jsonb;
  v_m numeric := greatest(0, ceil(coalesce(p_minutes, 0)));
  v_last numeric := 0;
  v_n integer;
begin
  select * into g from public.carpool_tarif_grilles where id = p_grille_id;
  if g is null then
    return null;
  end if;
  for tr in select value from jsonb_array_elements(g.tranches) order by (value->>'de')::numeric loop
    if v_m <= (tr->>'a')::numeric then
      return jsonb_build_object(
        'grille_id', g.id, 'version', g.version, 'minutes', v_m,
        'de', (tr->>'de')::numeric, 'a', (tr->>'a')::numeric, 'au_dela', false,
        'montant', round((tr->>'montant')::numeric, 2)
      );
    end if;
    v_last := (tr->>'a')::numeric;
  end loop;
  v_n := floor((v_m - v_last) / g.au_dela_par_min);
  return jsonb_build_object(
    'grille_id', g.id, 'version', g.version, 'minutes', v_m,
    'de', v_last, 'a', null, 'au_dela', true, 'tranches_sup', v_n,
    'montant', round(g.au_dela_montant + v_n * g.au_dela_montant_par_tranche, 2)
  );
end;
$fn$;
grant execute on function public.covoiturage_prix_grille(uuid, numeric) to authenticated;
comment on function public.covoiturage_prix_grille(uuid, numeric) is
  'Prix par passager selon une version de grille et une durée estimée (minutes, arrondies à la minute supérieure) — renvoie aussi la tranche appliquée (jsonb).';

-- Enregistrer une nouvelle version de la grille (bureau uniquement).
create or replace function public.enregistrer_grille_tarifaire_covoiturage(
  p_tranches jsonb,
  p_au_dela_montant numeric,
  p_au_dela_par_min integer,
  p_au_dela_montant_par_tranche numeric,
  p_options jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_prev_a numeric := 0;
  v_count integer := 0;
  v_version integer;
  v_id uuid;
  tr jsonb;
  v_sorted jsonb;
begin
  if not public.is_bureau() then
    raise exception 'Seul le bureau peut modifier la grille tarifaire du covoiturage.';
  end if;
  if p_tranches is null or jsonb_typeof(p_tranches) <> 'array' or jsonb_array_length(p_tranches) = 0 then
    raise exception 'La grille doit contenir au moins une tranche.';
  end if;
  select jsonb_agg(value order by (value->>'de')::numeric) into v_sorted from jsonb_array_elements(p_tranches);
  for tr in select value from jsonb_array_elements(v_sorted) loop
    v_count := v_count + 1;
    if (tr->>'de') is null or (tr->>'a') is null or (tr->>'montant') is null then
      raise exception 'Tranche % incomplète (de, à et montant sont obligatoires).', v_count;
    end if;
    if (tr->>'de')::numeric <> v_prev_a then
      if v_count = 1 then
        raise exception 'La première tranche doit commencer à 0 minute.';
      end if;
      raise exception 'Trou ou chevauchement entre les tranches : la tranche % commence à % min au lieu de % min.', v_count, (tr->>'de'), v_prev_a;
    end if;
    if (tr->>'a')::numeric <= (tr->>'de')::numeric then
      raise exception 'Tranche % : la borne de fin doit être supérieure à la borne de début.', v_count;
    end if;
    if (tr->>'montant')::numeric < 0 then
      raise exception 'Tranche % : le montant ne peut pas être négatif.', v_count;
    end if;
    v_prev_a := (tr->>'a')::numeric;
  end loop;
  if p_au_dela_montant is null or p_au_dela_montant < 0 then
    raise exception 'La tranche « au-delà » est obligatoire (montant positif ou nul).';
  end if;
  if p_au_dela_par_min is null or p_au_dela_par_min < 1 then
    raise exception 'Tranche « au-delà » : la durée de chaque tranche supplémentaire doit être d''au moins 1 minute.';
  end if;
  if coalesce(p_au_dela_montant_par_tranche, 0) < 0 then
    raise exception 'Tranche « au-delà » : le montant supplémentaire ne peut pas être négatif.';
  end if;
  if coalesce((p_options->>'solidaire_pct')::numeric, 0) not between 0 and 100 then
    raise exception 'Le tarif solidaire doit être un pourcentage entre 0 et 100.';
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.carpool_tarif_grilles where association_id = v_assoc;
  update public.carpool_tarif_grilles set actif = false where association_id = v_assoc and actif;

  insert into public.carpool_tarif_grilles (
    association_id, version, actif, tranches, au_dela_montant, au_dela_par_min, au_dela_montant_par_tranche,
    attente_actif, attente_franchise_min, attente_montant_par_min, attente_plafond,
    solidaire_actif, solidaire_pct, solidaire_etudiants, solidaire_aines, solidaire_evenements,
    frais_reels_actif, created_by
  ) values (
    v_assoc, v_version, true, v_sorted, p_au_dela_montant, p_au_dela_par_min, coalesce(p_au_dela_montant_par_tranche, 0),
    coalesce((p_options->>'attente_actif')::boolean, false),
    coalesce((p_options->>'attente_franchise_min')::integer, 5),
    coalesce((p_options->>'attente_montant_par_min')::numeric, 0),
    nullif(p_options->>'attente_plafond', '')::numeric,
    coalesce((p_options->>'solidaire_actif')::boolean, false),
    coalesce((p_options->>'solidaire_pct')::numeric, 0),
    coalesce((p_options->>'solidaire_etudiants')::boolean, true),
    coalesce((p_options->>'solidaire_aines')::boolean, true),
    coalesce((p_options->>'solidaire_evenements')::boolean, true),
    coalesce((p_options->>'frais_reels_actif')::boolean, false),
    auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$fn$;
grant execute on function public.enregistrer_grille_tarifaire_covoiturage(jsonb, numeric, integer, numeric, jsonb) to authenticated;
comment on function public.enregistrer_grille_tarifaire_covoiturage(jsonb, numeric, integer, numeric, jsonb) is
  'Bureau : enregistre une NOUVELLE version de la grille tarifaire (validation : départ à 0, ni trou ni chevauchement, tranche « au-delà » obligatoire) et désactive la précédente, qui reste conservée pour l''historique.';

create or replace function public.desactiver_grille_tarifaire_covoiturage()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_bureau() then
    raise exception 'Seul le bureau peut désactiver la grille tarifaire du covoiturage.';
  end if;
  update public.carpool_tarif_grilles set actif = false
    where association_id = public.current_association_id() and actif;
end;
$fn$;
grant execute on function public.desactiver_grille_tarifaire_covoiturage() to authenticated;
comment on function public.desactiver_grille_tarifaire_covoiturage() is
  'Bureau : désactive la grille (retour au prix libre fixé par le conducteur). Les versions restent dans l''historique.';

drop trigger if exists trg_log_carpool_tarif_grilles on public.carpool_tarif_grilles;
create trigger trg_log_carpool_tarif_grilles after insert on public.carpool_tarif_grilles
for each row execute function public.log_activity();

-- ---------------------------------------------------------------------
-- 2) Véhicules + plaques (plaque visible seulement des passagers confirmés)
-- ---------------------------------------------------------------------
create table if not exists public.carpool_vehicules (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  marque text not null,
  modele text not null,
  couleur text not null,
  annee integer check (annee is null or annee between 1950 and 2100),
  places integer not null default 4 check (places between 1 and 8),
  photo_path text,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists carpool_vehicules_member_idx on public.carpool_vehicules(member_id);
comment on table public.carpool_vehicules is
  'Fiche véhicule d''un conducteur (marque, modèle, couleur, année, places, photo dans le bucket privé carpool-vehicules). La plaque est rangée à part (carpool_vehicule_plaques) pour n''être montrée qu''aux passagers confirmés.';

alter table public.carpool_vehicules enable row level security;
drop policy if exists "carpool_vehicules select" on public.carpool_vehicules;
create policy "carpool_vehicules select" on public.carpool_vehicules for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "carpool_vehicules insert own" on public.carpool_vehicules;
create policy "carpool_vehicules insert own" on public.carpool_vehicules for insert to authenticated
  with check (association_id = public.current_association_id() and member_id = public.current_member_id());
drop policy if exists "carpool_vehicules update own" on public.carpool_vehicules;
create policy "carpool_vehicules update own" on public.carpool_vehicules for update to authenticated
  using (association_id = public.current_association_id() and member_id = public.current_member_id())
  with check (association_id = public.current_association_id() and member_id = public.current_member_id());
drop policy if exists "carpool_vehicules delete own" on public.carpool_vehicules;
create policy "carpool_vehicules delete own" on public.carpool_vehicules for delete to authenticated
  using (association_id = public.current_association_id() and (member_id = public.current_member_id() or public.is_bureau()));

create table if not exists public.carpool_vehicule_plaques (
  vehicule_id uuid primary key references public.carpool_vehicules(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  plaque text not null
);
comment on table public.carpool_vehicule_plaques is
  'Plaque d''immatriculation d''un véhicule de covoiturage — lisible seulement par le conducteur, le bureau et les passagers dont la réservation est confirmée (acceptée ou en cours/terminée).';

alter table public.carpool_vehicule_plaques enable row level security;
drop policy if exists "carpool_vehicule_plaques select" on public.carpool_vehicule_plaques;
create policy "carpool_vehicule_plaques select" on public.carpool_vehicule_plaques for select to authenticated
  using (
    association_id = public.current_association_id()
    and (
      public.is_bureau()
      or exists (select 1 from public.carpool_vehicules v where v.id = vehicule_id and v.member_id = public.current_member_id())
      or exists (
        select 1 from public.carpool_bookings b
        join public.carpool_offers o on o.id = b.offer_id
        where o.vehicule_id = carpool_vehicule_plaques.vehicule_id
          and b.passenger_member_id = public.current_member_id()
          and b.statut in ('acceptee', 'en_route', 'arrivee', 'a_bord', 'terminee')
      )
    )
  );
drop policy if exists "carpool_vehicule_plaques write own" on public.carpool_vehicule_plaques;
create policy "carpool_vehicule_plaques write own" on public.carpool_vehicule_plaques for all to authenticated
  using (association_id = public.current_association_id()
    and exists (select 1 from public.carpool_vehicules v where v.id = vehicule_id and v.member_id = public.current_member_id()))
  with check (association_id = public.current_association_id()
    and exists (select 1 from public.carpool_vehicules v where v.id = vehicule_id and v.member_id = public.current_member_id()));

-- Photo de profil et téléphone du conducteur : un membre ordinaire ne
-- peut pas modifier sa propre fiche « members » (réservé au bureau), d'où
-- cette fonction limitée à ces deux champs et à sa propre fiche.
create or replace function public.maj_profil_conducteur_covoiturage(p_photo_url text default null, p_telephone text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid := public.current_member_id();
begin
  if v_member_id is null then
    raise exception 'Aucune fiche membre liée à ce compte.';
  end if;
  update public.members set
    photo_url = coalesce(nullif(trim(p_photo_url), ''), photo_url),
    telephone = coalesce(nullif(trim(p_telephone), ''), telephone)
  where id = v_member_id;
end;
$fn$;
grant execute on function public.maj_profil_conducteur_covoiturage(text, text) to authenticated;
comment on function public.maj_profil_conducteur_covoiturage(text, text) is
  'Le membre met à jour SA photo de profil et/ou SON téléphone (obligatoires pour publier une offre de covoiturage) — aucun autre champ modifiable.';

-- Bucket privé des photos de véhicules : lisible par les membres de
-- l'association, écrit par le propriétaire. Chemin : <association_id>/<member_id>/<fichier>
insert into storage.buckets (id, name, public)
values ('carpool-vehicules', 'carpool-vehicules', false)
on conflict (id) do nothing;

drop policy if exists "carpool vehicules storage select" on storage.objects;
drop policy if exists "carpool vehicules storage insert" on storage.objects;
drop policy if exists "carpool vehicules storage delete" on storage.objects;
create policy "carpool vehicules storage select" on storage.objects for select to authenticated
  using (bucket_id = 'carpool-vehicules' and (storage.foldername(name))[1] = public.current_association_id()::text);
create policy "carpool vehicules storage insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'carpool-vehicules'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and (storage.foldername(name))[2] = public.current_member_id()::text
  );
create policy "carpool vehicules storage delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'carpool-vehicules'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and ((storage.foldername(name))[2] = public.current_member_id()::text or public.is_bureau())
  );

-- ---------------------------------------------------------------------
-- 3) Documents du conducteur (optionnels, à la demande, bucket PRIVÉ)
-- ---------------------------------------------------------------------
create table if not exists public.carpool_documents_conducteur (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  type text not null check (type in ('permis', 'assurance', 'immatriculation')),
  statut text not null default 'soumis' check (statut in ('demande', 'soumis', 'valide', 'refuse')),
  fichier_path text,
  fichier_nom text,
  expire_le date,
  rappel_envoye_le timestamptz,
  demande_par uuid references public.profiles(id) on delete set null,
  demande_le timestamptz,
  verifie_par uuid references public.profiles(id) on delete set null,
  verifie_le timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists carpool_documents_member_idx on public.carpool_documents_conducteur(member_id);
comment on table public.carpool_documents_conducteur is
  'Documents FACULTATIFS du conducteur (permis, assurance, immatriculation), fournis à la demande du bureau — fichiers dans le bucket privé carpool-documents, visibles seulement du conducteur et du bureau. Rappel automatique 30 jours avant expiration.';

alter table public.carpool_documents_conducteur enable row level security;
drop policy if exists "carpool_documents select" on public.carpool_documents_conducteur;
create policy "carpool_documents select" on public.carpool_documents_conducteur for select to authenticated
  using (association_id = public.current_association_id() and (member_id = public.current_member_id() or public.is_bureau()));
drop policy if exists "carpool_documents insert" on public.carpool_documents_conducteur;
create policy "carpool_documents insert" on public.carpool_documents_conducteur for insert to authenticated
  with check (association_id = public.current_association_id() and (member_id = public.current_member_id() or public.is_bureau()));
drop policy if exists "carpool_documents update" on public.carpool_documents_conducteur;
create policy "carpool_documents update" on public.carpool_documents_conducteur for update to authenticated
  using (association_id = public.current_association_id() and (member_id = public.current_member_id() or public.is_bureau()))
  with check (association_id = public.current_association_id() and (member_id = public.current_member_id() or public.is_bureau()));
drop policy if exists "carpool_documents delete" on public.carpool_documents_conducteur;
create policy "carpool_documents delete" on public.carpool_documents_conducteur for delete to authenticated
  using (association_id = public.current_association_id() and (member_id = public.current_member_id() or public.is_bureau()));

-- Garde-fou : seul le bureau valide/refuse ; un nouveau fichier repasse
-- le document en « soumis » et réarme le rappel d'expiration.
create or replace function public.covoiturage_document_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_bureau() then
    if tg_op = 'INSERT' then
      new.statut := 'soumis';
      new.verifie_par := null; new.verifie_le := null;
    elsif new.statut is distinct from old.statut and new.statut in ('valide', 'refuse') then
      raise exception 'Seul le bureau peut valider ou refuser un document.';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.fichier_path is distinct from old.fichier_path and new.fichier_path is not null then
      if not public.is_bureau() then
        new.statut := 'soumis';
        new.verifie_par := null; new.verifie_le := null;
      end if;
      new.rappel_envoye_le := null;
    end if;
    if new.expire_le is distinct from old.expire_le then
      new.rappel_envoye_le := null;
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_covoiturage_document_garde on public.carpool_documents_conducteur;
create trigger trg_covoiturage_document_garde before insert or update on public.carpool_documents_conducteur
for each row execute function public.covoiturage_document_garde();

drop trigger if exists trg_log_carpool_documents on public.carpool_documents_conducteur;
create trigger trg_log_carpool_documents after insert or update of statut on public.carpool_documents_conducteur
for each row execute function public.log_activity();

create or replace function public.demander_documents_covoiturage(p_member_id uuid, p_types text[], p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_type text;
  v_n integer := 0;
  v_profile_id uuid;
begin
  if not public.is_bureau() then
    raise exception 'Seul le bureau peut demander des documents.';
  end if;
  if not exists (select 1 from public.members where id = p_member_id and association_id = v_assoc) then
    raise exception 'Membre introuvable.';
  end if;
  foreach v_type in array coalesce(p_types, array[]::text[]) loop
    if v_type not in ('permis', 'assurance', 'immatriculation') then
      continue;
    end if;
    if not exists (
      select 1 from public.carpool_documents_conducteur
      where member_id = p_member_id and type = v_type and statut in ('demande', 'soumis', 'valide')
    ) then
      insert into public.carpool_documents_conducteur (association_id, member_id, type, statut, demande_par, demande_le, note)
      values (v_assoc, p_member_id, v_type, 'demande', auth.uid(), now(), p_note);
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    select p.id into v_profile_id from public.profiles p where p.member_id = p_member_id;
    perform public.notify_profile(v_assoc, v_profile_id, '📄 Covoiturage : documents demandés',
      'Le bureau vous demande de fournir ' || v_n || ' document(s) (Covoiturage → Ma fiche conducteur). C''est facultatif mais nécessaire pour le badge « Conducteur vérifié ».');
  end if;
  return v_n;
end;
$fn$;
grant execute on function public.demander_documents_covoiturage(uuid, text[], text) to authenticated;
comment on function public.demander_documents_covoiturage(uuid, text[], text) is
  'Bureau : demande à un conducteur de fournir un ou plusieurs documents (permis/assurance/immatriculation) — crée des lignes « demande » et notifie le membre.';

create or replace function public.valider_document_covoiturage(p_document_id uuid, p_valide boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_doc record;
  v_profile_id uuid;
begin
  if not public.is_bureau() then
    raise exception 'Seul le bureau peut valider un document.';
  end if;
  update public.carpool_documents_conducteur set
    statut = case when p_valide then 'valide' else 'refuse' end,
    verifie_par = auth.uid(), verifie_le = now(),
    note = coalesce(p_note, note)
  where id = p_document_id and association_id = public.current_association_id()
  returning * into v_doc;
  if v_doc is null then
    raise exception 'Document introuvable.';
  end if;
  select p.id into v_profile_id from public.profiles p where p.member_id = v_doc.member_id;
  perform public.notify_profile(v_doc.association_id, v_profile_id,
    case when p_valide then '✅ Document validé' else '⚠️ Document refusé' end,
    'Votre document (' || v_doc.type || ') a été ' || case when p_valide then 'validé' else 'refusé' end || ' par le bureau.'
      || case when p_note is not null and p_note <> '' then ' Note : ' || p_note else '' end);
end;
$fn$;
grant execute on function public.valider_document_covoiturage(uuid, boolean, text) to authenticated;

-- Bucket privé des documents : conducteur + bureau seulement.
-- Chemin : <association_id>/<member_id>/<fichier>
insert into storage.buckets (id, name, public)
values ('carpool-documents', 'carpool-documents', false)
on conflict (id) do nothing;

drop policy if exists "carpool documents storage select" on storage.objects;
drop policy if exists "carpool documents storage insert" on storage.objects;
drop policy if exists "carpool documents storage delete" on storage.objects;
create policy "carpool documents storage select" on storage.objects for select to authenticated
  using (
    bucket_id = 'carpool-documents'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and ((storage.foldername(name))[2] = public.current_member_id()::text or public.is_bureau())
  );
create policy "carpool documents storage insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'carpool-documents'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and (storage.foldername(name))[2] = public.current_member_id()::text
  );
create policy "carpool documents storage delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'carpool-documents'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and ((storage.foldername(name))[2] = public.current_member_id()::text or public.is_bureau())
  );

-- ---------------------------------------------------------------------
-- 4) Offres : véhicule, durée estimée, prix plafonné par la grille
-- ---------------------------------------------------------------------
alter table public.carpool_offers add column if not exists vehicule_id uuid references public.carpool_vehicules(id) on delete set null;
alter table public.carpool_offers add column if not exists duree_estimee_min numeric;
alter table public.carpool_offers add column if not exists distance_estimee_m numeric;
alter table public.carpool_offers add column if not exists grille_id uuid references public.carpool_tarif_grilles(id) on delete set null;
alter table public.carpool_offers add column if not exists prix_grille numeric;
alter table public.carpool_offers add column if not exists tranche_appliquee jsonb;
comment on column public.carpool_offers.duree_estimee_min is 'Durée de trajet ESTIMÉE (minutes, itinéraire routier OSRM ou estimation) — base du calcul de prix selon la grille.';
comment on column public.carpool_offers.prix_grille is 'Prix maximal par passager selon la grille active au moment de la publication — prix_place ne peut jamais le dépasser.';

alter table public.carpool_offers drop constraint if exists carpool_offers_prix_max_grille;
alter table public.carpool_offers add constraint carpool_offers_prix_max_grille
  check (prix_place is null or prix_grille is null or (prix_place >= 0 and prix_place <= prix_grille));

create or replace function public.covoiturage_offre_tarif()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_grille record;
  v_prix jsonb;
  v_km double precision;
  v_recalc boolean;
begin
  -- Photo de profil obligatoire pour publier une offre (pas pour le job
  -- planifié de régénération des trajets récurrents, sans utilisateur).
  if tg_op = 'INSERT' and auth.uid() is not null then
    if not exists (select 1 from public.members m where m.id = new.member_id and coalesce(trim(m.photo_url), '') <> '') then
      raise exception 'Une photo de profil est obligatoire pour publier une offre de covoiturage (Covoiturage → Ma fiche conducteur).';
    end if;
  end if;
  if new.vehicule_id is not null and not exists (
    select 1 from public.carpool_vehicules v where v.id = new.vehicule_id and v.member_id = new.member_id
  ) then
    raise exception 'Ce véhicule n''appartient pas au conducteur de l''offre.';
  end if;

  -- Durée plausible : jamais plus que ~15 km/h en ligne droite + 15 min.
  if new.duree_estimee_min is not null then
    if new.depart_lat is null or new.arrivee_lat is null or new.duree_estimee_min < 0 then
      new.duree_estimee_min := null;
    else
      v_km := public.covoiturage_distance_km(new.depart_lat, new.depart_lng, new.arrivee_lat, new.arrivee_lng);
      if new.duree_estimee_min > v_km * 4 + 15 then
        new.duree_estimee_min := ceil(v_km * 4 + 15);
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_recalc := true;
  else
    v_recalc := new.duree_estimee_min is distinct from old.duree_estimee_min
      or new.prix_place is distinct from old.prix_place;
  end if;
  if not v_recalc then
    return new;
  end if;

  select * into v_grille from public.carpool_tarif_grilles where association_id = new.association_id and actif;
  if v_grille is null then
    new.grille_id := null; new.prix_grille := null; new.tranche_appliquee := null;
    return new;
  end if;
  if new.duree_estimee_min is null then
    if tg_op = 'UPDATE' then
      if new.prix_place is not distinct from old.prix_place
         or (old.prix_place is not null and new.prix_place is not null and new.prix_place <= old.prix_place) then
        return new; -- ancienne offre sans durée : seule une baisse de prix est permise
      end if;
    end if;
    if auth.uid() is null then
      return new;
    end if;
    raise exception 'Durée estimée introuvable : choisissez une adresse suggérée ou placez l''épingle sur la carte pour le départ et l''arrivée (nécessaire au calcul selon la grille de l''association).';
  end if;

  v_prix := public.covoiturage_prix_grille(v_grille.id, new.duree_estimee_min);
  new.grille_id := v_grille.id;
  new.prix_grille := (v_prix->>'montant')::numeric;
  new.tranche_appliquee := v_prix;
  if new.prix_place is null then
    new.prix_place := new.prix_grille;
  elsif new.prix_place > new.prix_grille then
    if auth.uid() is null then
      new.prix_place := new.prix_grille; -- job planifié : on plafonne sans bloquer
    else
      raise exception 'Le prix (% $) dépasse la grille de l''association (% $ pour % min estimées). Vous pouvez baisser ou offrir le trajet, jamais dépasser la grille.',
        new.prix_place, new.prix_grille, new.duree_estimee_min;
    end if;
  elsif new.prix_place < 0 then
    raise exception 'Le prix ne peut pas être négatif.';
  end if;
  return new;
end;
$fn$;
comment on function public.covoiturage_offre_tarif() is
  'Déclencheur sur carpool_offers : photo de profil obligatoire à la publication, durée estimée plausible, prix par passager calculé selon la grille active et JAMAIS au-dessus.';
drop trigger if exists trg_covoiturage_offre_tarif on public.carpool_offers;
create trigger trg_covoiturage_offre_tarif before insert or update on public.carpool_offers
for each row execute function public.covoiturage_offre_tarif();

-- Régénération des trajets récurrents (sql/2026-10-08f) : recopie aussi
-- véhicule et durée estimée (le prix est recalculé par le déclencheur
-- avec la grille active du moment).
create or replace function public.regenerer_offres_recurrentes()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_offer record;
  v_next timestamptz;
begin
  for v_offer in
    select * from public.carpool_offers
    where recurrence in ('hebdomadaire', 'quotidien_ouvrable')
      and statut = 'active'
      and date_heure < now()
  loop
    v_next := case v_offer.recurrence
      when 'hebdomadaire' then v_offer.date_heure + interval '7 days'
      else v_offer.date_heure + interval '1 day'
    end;
    if v_offer.recurrence = 'quotidien_ouvrable' then
      while extract(isodow from v_next) in (6, 7) loop
        v_next := v_next + interval '1 day';
      end loop;
    end if;
    if exists (select 1 from public.associations a where a.id = v_offer.association_id and a.covoiturage_module_actif)
       and not exists (select 1 from public.members m where m.id = v_offer.member_id and m.covoiturage_suspendu) then
      insert into public.carpool_offers (
        association_id, member_id, member_nom, point_depart, point_arrivee, date_heure, recurrence,
        places_disponibles, prix_place, event_id, notes, statut,
        depart_lat, depart_lng, arrivee_lat, arrivee_lng,
        pref_non_fumeur, pref_musique, pref_animaux,
        vehicule_id, duree_estimee_min, distance_estimee_m
      ) values (
        v_offer.association_id, v_offer.member_id, v_offer.member_nom, v_offer.point_depart, v_offer.point_arrivee, v_next, v_offer.recurrence,
        v_offer.places_disponibles, v_offer.prix_place, v_offer.event_id, v_offer.notes, 'active',
        v_offer.depart_lat, v_offer.depart_lng, v_offer.arrivee_lat, v_offer.arrivee_lng,
        v_offer.pref_non_fumeur, v_offer.pref_musique, v_offer.pref_animaux,
        v_offer.vehicule_id, v_offer.duree_estimee_min, v_offer.distance_estimee_m
      );
    end if;
    update public.carpool_offers set statut = 'complete' where id = v_offer.id;
  end loop;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 5) Réservations : prix FIGÉ, options, paiement
-- ---------------------------------------------------------------------
alter table public.carpool_bookings add column if not exists grille_id uuid references public.carpool_tarif_grilles(id) on delete set null;
alter table public.carpool_bookings add column if not exists tranche_appliquee jsonb;
alter table public.carpool_bookings add column if not exists duree_estimee_min numeric;
alter table public.carpool_bookings add column if not exists distance_estimee_m numeric;
alter table public.carpool_bookings add column if not exists prix_grille_unitaire numeric;
alter table public.carpool_bookings add column if not exists prix_unitaire numeric;
alter table public.carpool_bookings add column if not exists montant numeric;
alter table public.carpool_bookings add column if not exists tarif_solidaire_pct numeric;
alter table public.carpool_bookings add column if not exists tarif_solidaire_motif text;
alter table public.carpool_bookings add column if not exists frais_attente numeric not null default 0;
alter table public.carpool_bookings add column if not exists frais_reels numeric not null default 0;
alter table public.carpool_bookings add column if not exists frais_reels_description text;
alter table public.carpool_bookings add column if not exists paiement_statut text not null default 'non_paye';
alter table public.carpool_bookings add column if not exists paiement_mode text;
alter table public.carpool_bookings add column if not exists paye_le timestamptz;
alter table public.carpool_bookings add column if not exists rappel_paiement_le timestamptz;
alter table public.carpool_bookings add column if not exists montant_du numeric
  generated always as (coalesce(montant, 0) + coalesce(frais_attente, 0) + coalesce(frais_reels, 0)) stored;

alter table public.carpool_bookings drop constraint if exists carpool_bookings_paiement_statut_check;
alter table public.carpool_bookings add constraint carpool_bookings_paiement_statut_check
  check (paiement_statut in ('non_paye', 'declare_paye', 'paye', 'offert'));
alter table public.carpool_bookings drop constraint if exists carpool_bookings_paiement_mode_check;
alter table public.carpool_bookings add constraint carpool_bookings_paiement_mode_check
  check (paiement_mode is null or paiement_mode in ('especes', 'interac'));
alter table public.carpool_bookings drop constraint if exists carpool_bookings_prix_max_grille;
alter table public.carpool_bookings add constraint carpool_bookings_prix_max_grille
  check (prix_unitaire is null or prix_grille_unitaire is null or (prix_unitaire >= 0 and prix_unitaire <= prix_grille_unitaire));
alter table public.carpool_bookings drop constraint if exists carpool_bookings_frais_positifs;
alter table public.carpool_bookings add constraint carpool_bookings_frais_positifs
  check (frais_attente >= 0 and frais_reels >= 0);

comment on column public.carpool_bookings.prix_unitaire is 'Contribution aux frais de carburant PAR PASSAGER, FIGÉE à la réservation (tarif solidaire déjà déduit) — le conducteur peut la baisser, jamais dépasser prix_grille_unitaire.';
comment on column public.carpool_bookings.montant_du is 'Total dû par le passager = montant (prix × places) + frais d''attente + frais réels déclarés. Payé de membre à membre (espèces/Interac) : l''association ne détient jamais l''argent.';

-- Figer le prix à la création de la réservation (quel que soit le
-- chemin : réservation, acceptation directe d'une demande, dispatch).
create or replace function public.covoiturage_reservation_tarif()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_offer record;
  v_grille record;
  v_unit numeric;
  v_motif text := nullif(current_setting('unia.cov_solidaire', true), '');
begin
  select * into v_offer from public.carpool_offers where id = new.offer_id;
  if v_offer is null then
    return new;
  end if;
  new.duree_estimee_min := v_offer.duree_estimee_min;
  new.distance_estimee_m := v_offer.distance_estimee_m;
  new.grille_id := v_offer.grille_id;
  new.tranche_appliquee := v_offer.tranche_appliquee;
  new.prix_grille_unitaire := v_offer.prix_grille;
  v_unit := v_offer.prix_place;
  if v_offer.grille_id is not null then
    select * into v_grille from public.carpool_tarif_grilles where id = v_offer.grille_id;
  end if;
  new.tarif_solidaire_pct := null;
  new.tarif_solidaire_motif := null;
  if v_unit is not null and v_grille is not null and v_grille.solidaire_actif and v_grille.solidaire_pct > 0 then
    if v_offer.event_id is not null and v_grille.solidaire_evenements then
      v_motif := 'evenement';
    end if;
    if (v_motif = 'etudiant' and v_grille.solidaire_etudiants)
       or (v_motif = 'aine' and v_grille.solidaire_aines)
       or (v_motif = 'evenement' and v_grille.solidaire_evenements) then
      v_unit := round(v_unit * (1 - v_grille.solidaire_pct / 100), 2);
      new.tarif_solidaire_pct := v_grille.solidaire_pct;
      new.tarif_solidaire_motif := v_motif;
    end if;
  end if;
  new.prix_unitaire := v_unit;
  new.montant := case when v_unit is null then null else round(v_unit * greatest(1, new.seats_reserved), 2) end;
  new.frais_attente := 0;
  new.frais_reels := 0;
  new.paiement_statut := case when v_unit = 0 then 'offert' else 'non_paye' end;
  new.paiement_mode := null;
  new.paye_le := null;
  return new;
end;
$fn$;
drop trigger if exists trg_covoiturage_reservation_tarif on public.carpool_bookings;
create trigger trg_covoiturage_reservation_tarif before insert on public.carpool_bookings
for each row execute function public.covoiturage_reservation_tarif();

-- Garde-fou sur les mises à jour : les champs de prix/paiement ne
-- changent QUE par les fonctions dédiées ci-dessous (la policy de mise à
-- jour existante laisse passager et conducteur modifier leur ligne).
-- Calcule aussi les frais d'attente quand le passager monte à bord.
create or replace function public.covoiturage_reservation_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_grille record;
  v_attente_min numeric;
  v_frais numeric;
begin
  if coalesce(current_setting('unia.cov_tarif_rpc', true), '') <> 'on' and (
       new.prix_unitaire is distinct from old.prix_unitaire
    or new.prix_grille_unitaire is distinct from old.prix_grille_unitaire
    or new.montant is distinct from old.montant
    or new.grille_id is distinct from old.grille_id
    or new.tranche_appliquee is distinct from old.tranche_appliquee
    or new.duree_estimee_min is distinct from old.duree_estimee_min
    or new.tarif_solidaire_pct is distinct from old.tarif_solidaire_pct
    or new.frais_attente is distinct from old.frais_attente
    or new.frais_reels is distinct from old.frais_reels
    or new.paiement_statut is distinct from old.paiement_statut
    or new.paye_le is distinct from old.paye_le
  ) then
    raise exception 'Les montants et le paiement d''un covoiturage ne se modifient que par les boutons prévus (prix figé à la réservation).';
  end if;

  if new.a_bord_at is not null and old.a_bord_at is null and new.arrivee_at is not null and new.grille_id is not null then
    select * into v_grille from public.carpool_tarif_grilles where id = new.grille_id;
    if v_grille is not null and v_grille.attente_actif and v_grille.attente_montant_par_min > 0 then
      v_attente_min := floor(extract(epoch from (new.a_bord_at - new.arrivee_at)) / 60);
      if v_attente_min > v_grille.attente_franchise_min then
        v_frais := round((v_attente_min - v_grille.attente_franchise_min) * v_grille.attente_montant_par_min, 2);
        if v_grille.attente_plafond is not null then
          v_frais := least(v_frais, v_grille.attente_plafond);
        end if;
        new.frais_attente := v_frais;
      end if;
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_covoiturage_reservation_garde on public.carpool_bookings;
create trigger trg_covoiturage_reservation_garde before update on public.carpool_bookings
for each row execute function public.covoiturage_reservation_garde();

-- Réserver avec tarif (motif solidaire facultatif : 'etudiant' | 'aine').
-- Réutilise reserver_trajet_covoiturage (sql/2026-10-06b) sans le dupliquer.
create or replace function public.reserver_trajet_covoiturage_tarif(
  p_offer_id uuid,
  p_seats integer default 1,
  p_message text default null,
  p_request_id uuid default null,
  p_solidaire_motif text default null
)
returns table(status text)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform set_config('unia.cov_solidaire',
    case when p_solidaire_motif in ('etudiant', 'aine') then p_solidaire_motif else '' end, true);
  return query select r.status from public.reserver_trajet_covoiturage(p_offer_id, p_seats, p_message, p_request_id) r;
  perform set_config('unia.cov_solidaire', '', true);
end;
$fn$;
grant execute on function public.reserver_trajet_covoiturage_tarif(uuid, integer, text, uuid, text) to authenticated;
comment on function public.reserver_trajet_covoiturage_tarif(uuid, integer, text, uuid, text) is
  'Réserve une offre en figeant le prix (grille + tarif solidaire déclaré : étudiant/aîné ; événement de l''association appliqué automatiquement).';

-- Le conducteur baisse (ou offre) le prix d'une réservation — jamais au-dessus de la grille.
create or replace function public.ajuster_prix_covoiturage(p_booking_id uuid, p_prix_unitaire numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_b record;
  v_owner uuid;
begin
  select * into v_b from public.carpool_bookings where id = p_booking_id and association_id = public.current_association_id();
  if v_b is null then
    raise exception 'Réservation introuvable.';
  end if;
  select member_id into v_owner from public.carpool_offers where id = v_b.offer_id;
  if v_owner is distinct from public.current_member_id() then
    raise exception 'Seul le conducteur peut ajuster le prix.';
  end if;
  if v_b.paiement_statut = 'paye' then
    raise exception 'Cette réservation est déjà payée.';
  end if;
  if p_prix_unitaire is null or p_prix_unitaire < 0 then
    raise exception 'Prix invalide.';
  end if;
  if v_b.prix_grille_unitaire is not null and p_prix_unitaire > v_b.prix_grille_unitaire then
    raise exception 'Impossible de dépasser la grille de l''association (% $ par passager).', v_b.prix_grille_unitaire;
  end if;
  if v_b.prix_grille_unitaire is null and v_b.prix_unitaire is not null and p_prix_unitaire > v_b.prix_unitaire then
    raise exception 'Le prix ne peut être que baissé.';
  end if;
  perform set_config('unia.cov_tarif_rpc', 'on', true);
  update public.carpool_bookings set
    prix_unitaire = p_prix_unitaire,
    montant = round(p_prix_unitaire * seats_reserved, 2),
    paiement_statut = case when p_prix_unitaire = 0 and frais_attente = 0 and frais_reels = 0 then 'offert'
                           when paiement_statut = 'offert' then 'non_paye' else paiement_statut end
  where id = p_booking_id;
  perform set_config('unia.cov_tarif_rpc', '', true);
end;
$fn$;
grant execute on function public.ajuster_prix_covoiturage(uuid, numeric) to authenticated;

-- Frais réels (péage, stationnement) déclarés par le conducteur.
create or replace function public.declarer_frais_reels_covoiturage(p_booking_id uuid, p_montant numeric, p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_b record;
  v_owner uuid;
  v_actif boolean;
begin
  select * into v_b from public.carpool_bookings where id = p_booking_id and association_id = public.current_association_id();
  if v_b is null then
    raise exception 'Réservation introuvable.';
  end if;
  select member_id into v_owner from public.carpool_offers where id = v_b.offer_id;
  if v_owner is distinct from public.current_member_id() then
    raise exception 'Seul le conducteur peut déclarer des frais réels.';
  end if;
  select g.frais_reels_actif into v_actif from public.carpool_tarif_grilles g
    where g.id = v_b.grille_id or (v_b.grille_id is null and g.association_id = v_b.association_id and g.actif)
    order by (g.id = v_b.grille_id) desc limit 1;
  if not coalesce(v_actif, false) then
    raise exception 'Les frais réels ne sont pas activés par votre association.';
  end if;
  if v_b.paiement_statut = 'paye' then
    raise exception 'Cette réservation est déjà payée.';
  end if;
  if p_montant is null or p_montant < 0 then
    raise exception 'Montant invalide.';
  end if;
  if p_montant > 0 and coalesce(trim(p_description), '') = '' then
    raise exception 'Précisez la nature des frais (péage, stationnement…).';
  end if;
  perform set_config('unia.cov_tarif_rpc', 'on', true);
  update public.carpool_bookings set
    frais_reels = round(p_montant, 2),
    frais_reels_description = nullif(trim(p_description), ''),
    paiement_statut = case when paiement_statut = 'offert' and p_montant > 0 then 'non_paye' else paiement_statut end
  where id = p_booking_id;
  perform set_config('unia.cov_tarif_rpc', '', true);
end;
$fn$;
grant execute on function public.declarer_frais_reels_covoiturage(uuid, numeric, text) to authenticated;

-- Paiement : le passager peut DÉCLARER avoir payé ; le conducteur (ou le
-- bureau) confirme « payé » ou remet « non payé ». Aucun argent ne
-- transite par l'application ni par l'association.
create or replace function public.marquer_paiement_covoiturage(p_booking_id uuid, p_statut text, p_mode text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_b record;
  v_owner uuid;
  v_me uuid := public.current_member_id();
  v_profile_id uuid;
begin
  select * into v_b from public.carpool_bookings where id = p_booking_id and association_id = public.current_association_id();
  if v_b is null then
    raise exception 'Réservation introuvable.';
  end if;
  if p_statut not in ('non_paye', 'declare_paye', 'paye') then
    raise exception 'Statut de paiement invalide.';
  end if;
  if p_mode is not null and p_mode not in ('especes', 'interac') then
    raise exception 'Mode de paiement invalide.';
  end if;
  select member_id into v_owner from public.carpool_offers where id = v_b.offer_id;
  if p_statut = 'declare_paye' then
    if v_b.passenger_member_id is distinct from v_me then
      raise exception 'Seul le passager peut déclarer avoir payé.';
    end if;
  elsif v_owner is distinct from v_me and not public.is_bureau() then
    raise exception 'Seul le conducteur (ou le bureau) peut confirmer le paiement.';
  end if;
  perform set_config('unia.cov_tarif_rpc', 'on', true);
  update public.carpool_bookings set
    paiement_statut = p_statut,
    paiement_mode = coalesce(p_mode, paiement_mode),
    paye_le = case when p_statut = 'paye' then now() when p_statut = 'non_paye' then null else paye_le end
  where id = p_booking_id;
  perform set_config('unia.cov_tarif_rpc', '', true);
  if p_statut = 'declare_paye' then
    select p.id into v_profile_id from public.profiles p where p.member_id = v_owner;
    perform public.notify_profile(v_b.association_id, v_profile_id, '💵 Paiement déclaré',
      coalesce(v_b.passenger_nom, 'Un passager') || ' indique avoir réglé sa contribution (' || v_b.montant_du || ' $). Confirmez la réception dans Covoiturage → Réservations.');
  end if;
end;
$fn$;
grant execute on function public.marquer_paiement_covoiturage(uuid, text, text) to authenticated;

-- Rappel de paiement envoyé manuellement par le conducteur.
create or replace function public.rappeler_paiement_covoiturage(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_b record;
  v_owner uuid;
  v_profile_id uuid;
begin
  select * into v_b from public.carpool_bookings where id = p_booking_id and association_id = public.current_association_id();
  if v_b is null then
    raise exception 'Réservation introuvable.';
  end if;
  select member_id into v_owner from public.carpool_offers where id = v_b.offer_id;
  if v_owner is distinct from public.current_member_id() and not public.is_bureau() then
    raise exception 'Seul le conducteur (ou le bureau) peut envoyer un rappel.';
  end if;
  if v_b.paiement_statut in ('paye', 'offert') then
    return;
  end if;
  select p.id into v_profile_id from public.profiles p where p.member_id = v_b.passenger_member_id;
  perform public.notify_profile(v_b.association_id, v_profile_id, '🔔 Rappel : contribution covoiturage',
    'Il reste ' || v_b.montant_du || ' $ à régler à votre conducteur (espèces ou Interac), contribution aux frais de carburant.');
  perform set_config('unia.cov_tarif_rpc', 'on', true);
  update public.carpool_bookings set rappel_paiement_le = now() where id = p_booking_id;
  perform set_config('unia.cov_tarif_rpc', '', true);
end;
$fn$;
grant execute on function public.rappeler_paiement_covoiturage(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Rappels automatiques quotidiens (documents + paiements)
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

create or replace function public.covoiturage_rappels_quotidiens()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_doc record;
  v_b record;
  v_profile_id uuid;
  v_bureau record;
  v_nom text;
begin
  -- a) Documents qui expirent dans 30 jours ou moins (un seul rappel)
  for v_doc in
    select * from public.carpool_documents_conducteur
    where expire_le is not null and statut in ('soumis', 'valide')
      and expire_le <= current_date + 30 and rappel_envoye_le is null
  loop
    select p.id into v_profile_id from public.profiles p where p.member_id = v_doc.member_id;
    perform public.notify_profile(v_doc.association_id, v_profile_id, '📄 Document bientôt expiré',
      'Votre document de covoiturage (' || v_doc.type || ') expire le ' || to_char(v_doc.expire_le, 'DD/MM/YYYY') || '. Pensez à le renouveler dans Covoiturage → Ma fiche conducteur.');
    select nom into v_nom from public.members where id = v_doc.member_id;
    for v_bureau in
      select id from public.profiles
      where association_id = v_doc.association_id and role in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier')
    loop
      perform public.notify_profile(v_doc.association_id, v_bureau.id, '📄 Covoiturage : document à renouveler',
        'Le document ' || v_doc.type || ' de ' || coalesce(v_nom, 'un conducteur') || ' expire le ' || to_char(v_doc.expire_le, 'DD/MM/YYYY') || '.');
    end loop;
    update public.carpool_documents_conducteur set rappel_envoye_le = now() where id = v_doc.id;
  end loop;

  -- b) Contributions non payées 24 h après le trajet (au plus tous les 3 jours, 3 rappels max sur 10 jours)
  perform set_config('unia.cov_tarif_rpc', 'on', true);
  for v_b in
    select * from public.carpool_bookings
    where statut = 'terminee' and paiement_statut in ('non_paye', 'declare_paye')
      and montant_du > 0 and terminee_at < now() - interval '1 day' and terminee_at > now() - interval '10 days'
      and (rappel_paiement_le is null or rappel_paiement_le < now() - interval '3 days')
  loop
    if v_b.paiement_statut = 'non_paye' then
      select p.id into v_profile_id from public.profiles p where p.member_id = v_b.passenger_member_id;
      perform public.notify_profile(v_b.association_id, v_profile_id, '🔔 Rappel : contribution covoiturage',
        'Il reste ' || v_b.montant_du || ' $ à régler à votre conducteur (espèces ou Interac).');
    else
      select p.id into v_profile_id from public.profiles p
        join public.carpool_offers o on o.member_id = p.member_id where o.id = v_b.offer_id;
      perform public.notify_profile(v_b.association_id, v_profile_id, '💵 Paiement à confirmer',
        coalesce(v_b.passenger_nom, 'Un passager') || ' a déclaré avoir payé ' || v_b.montant_du || ' $. Confirmez la réception dans Covoiturage → Réservations.');
    end if;
    update public.carpool_bookings set rappel_paiement_le = now() where id = v_b.id;
  end loop;
  perform set_config('unia.cov_tarif_rpc', '', true);
end;
$fn$;
comment on function public.covoiturage_rappels_quotidiens() is
  'Job quotidien : rappel 30 jours avant l''expiration d''un document conducteur (au conducteur et au bureau) + rappels de paiement des contributions non réglées.';

select cron.schedule(
  'covoiturage-rappels-quotidiens',
  '0 13 * * *',
  $$select public.covoiturage_rappels_quotidiens();$$
);

-- =====================================================================
-- Vérification rapide après exécution :
--   select tablename from pg_tables where tablename in
--     ('carpool_tarif_grilles','carpool_vehicules','carpool_vehicule_plaques','carpool_documents_conducteur');
--   -- doit afficher 4 lignes
--   select id from storage.buckets where id in ('carpool-vehicules','carpool-documents');
--   -- doit afficher 2 lignes
--   select jobname from cron.job where jobname = 'covoiturage-rappels-quotidiens';
--   -- doit afficher 1 ligne
-- =====================================================================
