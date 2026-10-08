-- =====================================================================
-- Comptabilité professionnelle — Phase B (Exercices financiers + État
-- des résultats). Suite 86 (Phase B), 2026-09-28.
-- Voir claude/comptabilite-professionnelle-proposition.md — à exécuter
-- APRÈS sql/2026-09-28c_comptabilite_fondations.sql (et son correctif
-- sql/2026-09-28d_...) qui doivent déjà être en place.
-- =====================================================================
-- Ce script :
--   1. Ajoute `associations.exercice_mois_debut` (1 = janvier par défaut,
--      donc année civile pour toute association existante — aucun
--      changement de comportement tant que le président ne le modifie
--      pas). Décision de l'utilisateur : l'exercice financier est
--      CONFIGURABLE par association (pas forcé à l'année civile), pour
--      les associations qui préfèrent un exercice décalé (ex. avril à
--      mars). Réservé au président (ajouté à la même protection que
--      `approbateur_suppression_id`/`periode_probation_secours_jours`/
--      `code_invitation`, suite 36).
--   2. Crée `exercices_clotures` — un exercice n'y apparaît qu'UNE FOIS
--      clôturé (pas de ligne pour un exercice en cours). Chaque ligne
--      gèle les totaux (produits/charges/excédent, par fonds) AU MOMENT
--      de la clôture — une photo officielle pour l'audit/l'assemblée
--      générale, distincte du grand livre qui continue lui d'exister
--      (aucun verrouillage des transactions passées dans le reste de
--      l'application — décision explicite de l'utilisateur : Phase B
--      ne bloque pas encore la modification de données historiques,
--      un chantier séparé et plus large s'il est demandé plus tard).
--   3. Fonction `cloturer_exercice(...)` (RPC, appelée depuis
--      l'application) : réservée au président (vérifiée dans la
--      fonction elle-même, pas seulement grisée côté interface — même
--      principe que le déclencheur de la suite 36), refuse de clôturer
--      un exercice pas encore terminé, calcule et gèle les totaux à
--      partir du grand livre, insère la ligne dans `exercices_clotures`.
--
-- Sans danger à exécuter plusieurs fois : `add column if not exists`,
-- `create table if not exists`, `create or replace function`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Mois de début de l'exercice financier, par association
-- ---------------------------------------------------------------------
alter table public.associations
  add column if not exists exercice_mois_debut int not null default 1
  check (exercice_mois_debut between 1 and 12);

-- Ajouté à la protection "réservé au président" déjà en place depuis la
-- suite 36 (recrée la fonction avec la même logique + cette colonne en
-- plus — le déclencheur existant continue de pointer vers cette même
-- fonction, il n'a pas besoin d'être recréé).
create or replace function public.enforce_president_only_association_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.current_user_role();
begin
  if v_role <> 'bureau_president' and v_role <> 'super_admin' then
    if new.approbateur_suppression_id is distinct from old.approbateur_suppression_id
       or new.periode_probation_secours_jours is distinct from old.periode_probation_secours_jours
       or new.code_invitation is distinct from old.code_invitation
       or new.exercice_mois_debut is distinct from old.exercice_mois_debut then
      raise exception 'Seul(e) le/la président(e) peut modifier ces réglages (approbateur des suppressions, période de probation, code d''invitation, mois de début de l''exercice financier).';
    end if;
  end if;
  return new;
end;
$$;
-- (Le déclencheur `trg_president_only_association_settings`, créé en
-- suite 36, exécute déjà cette fonction à chaque `update` — inchangé.)

-- ---------------------------------------------------------------------
-- 2. Exercices clôturés (une ligne = un exercice officiellement fermé)
-- ---------------------------------------------------------------------
create table if not exists public.exercices_clotures (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  date_debut date not null,
  date_fin date not null,
  cloture_le timestamptz not null default now(),
  cloture_par uuid references public.profiles(id),
  total_produits numeric(12,2) not null,
  total_charges numeric(12,2) not null,
  excedent numeric(12,2) not null,
  detail_fonds jsonb not null,
  unique (association_id, date_debut)
);

alter table public.exercices_clotures enable row level security;
drop policy if exists "lecture - exercices_clotures" on public.exercices_clotures;
create policy "lecture - exercices_clotures" on public.exercices_clotures
  for select to authenticated
  using (association_id = public.current_association_id());
-- Volontairement aucune politique insert/update/delete pour les rôles
-- clients : seule la fonction `cloturer_exercice` ci-dessous peut écrire
-- ici (et seulement pour le président, vérifié dans la fonction).

-- ---------------------------------------------------------------------
-- 3. Clôture d'un exercice — calcule et gèle les totaux depuis le
--    grand livre, réservé au président.
-- ---------------------------------------------------------------------
-- IMPORTANT (sécurité) : l'association n'est JAMAIS reçue en paramètre
-- depuis le client — elle est déduite de la session connectée via
-- `current_association_id()`, exactement comme `regenerate_invite_code()`
-- (suite 34). Une fonction qui accepterait un `p_association_id` fourni
-- par l'appelant permettrait, en théorie, au président d'une association
-- de clôturer l'exercice d'une AUTRE association simplement en changeant
-- ce paramètre dans l'appel réseau — `security definer` contourne RLS,
-- donc c'est à la fonction elle-même de garantir le bon cloisonnement.
create or replace function public.cloturer_exercice(
  p_date_debut date, p_date_fin date
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_association_id uuid := public.current_association_id();
  v_role text := public.current_user_role();
  v_total_produits numeric(12,2);
  v_total_charges numeric(12,2);
  v_detail jsonb := '{}'::jsonb;
  v_fonds text;
  v_produits_f numeric(12,2);
  v_charges_f numeric(12,2);
begin
  if v_association_id is null then
    raise exception 'Profil introuvable.';
  end if;
  if v_role <> 'bureau_president' and v_role <> 'super_admin' then
    raise exception 'Seul(e) le/la président(e) peut clôturer un exercice financier.';
  end if;
  if p_date_fin >= current_date then
    raise exception 'Impossible de clôturer un exercice qui n''est pas encore terminé (se termine le %, aujourd''hui est le %).', p_date_fin, current_date;
  end if;
  if exists (select 1 from public.exercices_clotures where association_id = v_association_id and date_debut = p_date_debut) then
    raise exception 'Cet exercice a déjà été clôturé.';
  end if;

  select coalesce(sum(e.credit - e.debit), 0) into v_total_produits
    from public.ecritures_comptables e join public.comptes_comptables c on c.code = e.compte_code
    where e.association_id = v_association_id and c.type = 'produit'
      and e.date between p_date_debut and p_date_fin;
  select coalesce(sum(e.debit - e.credit), 0) into v_total_charges
    from public.ecritures_comptables e join public.comptes_comptables c on c.code = e.compte_code
    where e.association_id = v_association_id and c.type = 'charge'
      and e.date between p_date_debut and p_date_fin;

  for v_fonds in select unnest(array['general', 'urgence', 'secours']) loop
    select coalesce(sum(e.credit - e.debit), 0) into v_produits_f
      from public.ecritures_comptables e join public.comptes_comptables c on c.code = e.compte_code
      where e.association_id = v_association_id and c.type = 'produit' and e.fonds = v_fonds
        and e.date between p_date_debut and p_date_fin;
    select coalesce(sum(e.debit - e.credit), 0) into v_charges_f
      from public.ecritures_comptables e join public.comptes_comptables c on c.code = e.compte_code
      where e.association_id = v_association_id and c.type = 'charge' and e.fonds = v_fonds
        and e.date between p_date_debut and p_date_fin;
    v_detail := v_detail || jsonb_build_object(v_fonds, jsonb_build_object(
      'produits', v_produits_f, 'charges', v_charges_f, 'excedent', v_produits_f - v_charges_f));
  end loop;

  insert into public.exercices_clotures
    (association_id, date_debut, date_fin, cloture_par, total_produits, total_charges, excedent, detail_fonds)
  values
    (v_association_id, p_date_debut, p_date_fin, auth.uid(), v_total_produits, v_total_charges,
     v_total_produits - v_total_charges, v_detail);
end;
$$;

grant execute on function public.cloturer_exercice(date, date) to authenticated;
