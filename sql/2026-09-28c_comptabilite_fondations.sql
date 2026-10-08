-- =====================================================================
-- Comptabilité professionnelle — Phase A (Fondations + Bilan)
-- Suite 86, 2026-09-28. Voir claude/comptabilite-professionnelle-proposition.md
-- =====================================================================
-- Ce script est SANS DANGER à exécuter plusieurs fois (idempotent) :
-- les créations de table/fonction utilisent "if not exists"/"or replace",
-- et le bilan d'ouverture (tout en bas) est protégé par une vérification
-- qui empêche de le générer deux fois pour la même association.
--
-- Ce script :
--   1. Crée le plan comptable (comptes_comptables), commun à toutes les
--      associations.
--   2. Crée le grand livre (ecritures_comptables), avec RLS : lecture
--      pour tout membre authentifié de son association, AUCUNE écriture
--      directe possible depuis l'application — seules les fonctions
--      de déclenchement ci-dessous (SECURITY DEFINER) peuvent y écrire.
--      Un grand livre que personne ne peut modifier à la main est le
--      principe même d'une piste d'audit fiable.
--   3. Crée les fonctions de déclenchement qui génèrent AUTOMATIQUEMENT
--      une écriture chaque fois qu'une action déjà existante a lieu
--      (don, prêt, remboursement, dépense/quote-part de fonds,
--      inscription/contribution/cotisation/collation) — le trésorier ne
--      saisit jamais de débit/crédit à la main, exactement comme
--      activity_log se remplit déjà tout seul.
--   4. Génère UNE FOIS le bilan d'ouverture au 1er janvier 2026 pour
--      chaque association déjà existante, à partir des données déjà en
--      place, puis rejoue individuellement (avec leur vraie date) les
--      transactions déjà enregistrées depuis le 1er janvier 2026.
--
-- LIMITE ASSUMÉE ET DOCUMENTÉE (déjà rencontrée en suite 85) : les champs
-- members.inscription_paye / fonds_urgence_paye / fonds_secours_paye et
-- les tables tontine_presences / collation_presences sont des TOTAUX
-- CUMULATIFS dans le modèle de données actuel, sans date de paiement
-- individuelle. Impossible de savoir avec certitude QUAND, avant
-- aujourd'hui, chaque dollar de ces catégories a été reçu. Ces montants
-- entrent donc INTÉGRALEMENT dans le bilan d'ouverture du 1er janvier
-- 2026 plutôt que d'être répartis dans l'année — ce qui ne fausse EN
-- RIEN le Bilan (l'argent est compté une seule fois, correctement), mais
-- signifie que l'État des résultats 2026 (Phase B, à venir) sous-évaluera
-- ces catégories précises pour cette première année de transition. À
-- PARTIR DE MAINTENANT (déploiement de ce script), tout nouveau paiement
-- dans ces catégories est enregistré au jour le jour avec sa vraie date,
-- sans cette limite.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Plan comptable (commun à toutes les associations)
-- ---------------------------------------------------------------------
create table if not exists public.comptes_comptables (
  code text primary key,
  nom text not null,
  type text not null check (type in ('actif', 'passif', 'actif_net', 'produit', 'charge')),
  ordre int not null default 0
);

insert into public.comptes_comptables (code, nom, type, ordre) values
  ('1000', 'Encaisse / Banque', 'actif', 10),
  ('1100', 'Sommes à recevoir des adhérents', 'actif', 20),
  ('1200', 'Prêts aux adhérents', 'actif', 30),
  ('1900', 'Autres actifs', 'actif', 40),
  ('2000', 'Sommes reçues d''avance', 'passif', 10),
  ('2900', 'Autres dettes', 'passif', 20),
  ('3000', 'Actif net', 'actif_net', 10),
  ('4000', 'Inscriptions', 'produit', 10),
  ('4100', 'Cotisations', 'produit', 20),
  ('4200', 'Collation', 'produit', 30),
  ('4300', 'Dons', 'produit', 40),
  ('4400', 'Contributions — Fonds d''urgence', 'produit', 50),
  ('4410', 'Recouvrements — Fonds d''urgence', 'produit', 51),
  ('4500', 'Contributions — Fonds de secours', 'produit', 60),
  ('4510', 'Recouvrements — Fonds de secours', 'produit', 61),
  ('4900', 'Autres produits', 'produit', 70),
  ('5400', 'Dépenses — Fonds d''urgence', 'charge', 10),
  ('5500', 'Dépenses — Fonds de secours', 'charge', 20),
  ('5900', 'Frais généraux et autres charges', 'charge', 30)
on conflict (code) do nothing;

alter table public.comptes_comptables enable row level security;
drop policy if exists "lecture - comptes_comptables" on public.comptes_comptables;
create policy "lecture - comptes_comptables" on public.comptes_comptables
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 2. Grand livre
-- ---------------------------------------------------------------------
create table if not exists public.ecritures_comptables (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  date date not null,
  compte_code text not null references public.comptes_comptables(code),
  fonds text not null default 'general' check (fonds in ('general', 'urgence', 'secours')),
  debit numeric(12,2) not null default 0,
  credit numeric(12,2) not null default 0,
  description text,
  source_table text,
  source_id uuid,
  piece_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_ecritures_association on public.ecritures_comptables(association_id);
create index if not exists idx_ecritures_date on public.ecritures_comptables(date);
create index if not exists idx_ecritures_piece on public.ecritures_comptables(piece_id);
create index if not exists idx_ecritures_source on public.ecritures_comptables(source_table, source_id);

alter table public.ecritures_comptables enable row level security;
drop policy if exists "lecture - ecritures_comptables" on public.ecritures_comptables;
create policy "lecture - ecritures_comptables" on public.ecritures_comptables
  for select to authenticated
  using (association_id = public.current_association_id());
-- Volontairement AUCUNE politique insert/update/delete pour les rôles
-- clients : seules les fonctions SECURITY DEFINER ci-dessous (qui
-- s'exécutent avec des privilèges élevés, indépendamment de RLS) peuvent
-- écrire dans ce grand livre.

-- ---------------------------------------------------------------------
-- 3. Fonctions de comptabilisation
-- ---------------------------------------------------------------------

-- Coeur du système : reçoit un tableau de lignes {compte, fonds, debit,
-- credit} et les enregistre ensemble sous un même piece_id, APRÈS avoir
-- vérifié que la somme des débits égale la somme des crédits — le
-- principe fondamental de la partie double. Une écriture déséquilibrée
-- est un bug qu'il vaut mieux voir immédiatement (exception) que laisser
-- passer silencieusement dans un système comptable.
create or replace function public.poster_ecriture(
  p_association_id uuid, p_date date, p_lignes jsonb,
  p_description text, p_source_table text, p_source_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_piece_id uuid := gen_random_uuid();
  v_ligne jsonb;
  v_total_debit numeric(12,2) := 0;
  v_total_credit numeric(12,2) := 0;
begin
  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    v_total_debit := v_total_debit + coalesce((v_ligne->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_ligne->>'credit')::numeric, 0);
  end loop;
  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    raise exception 'Écriture comptable non équilibrée (débit % ≠ crédit %) — %', v_total_debit, v_total_credit, p_description;
  end if;
  if v_total_debit = 0 then
    return;
  end if;
  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    insert into public.ecritures_comptables
      (association_id, date, compte_code, fonds, debit, credit, description, source_table, source_id, piece_id)
    values (
      p_association_id, p_date, v_ligne->>'compte', coalesce(v_ligne->>'fonds', 'general'),
      coalesce((v_ligne->>'debit')::numeric, 0), coalesce((v_ligne->>'credit')::numeric, 0),
      p_description, p_source_table, p_source_id, v_piece_id
    );
  end loop;
end;
$$;

-- Raccourci utilisé par presque tous les déclencheurs ci-dessous : une
-- écriture à deux lignes à partir d'un seul montant SIGNÉ (delta). Si
-- delta > 0, p_compte_a est débité et p_compte_b est crédité (cas normal
-- : un paiement reçu, une dépense enregistrée...) ; si delta < 0,
-- l'écriture s'inverse automatiquement (cas d'une correction à la
-- baisse). delta = 0 ne produit aucune ligne.
create or replace function public.poster_ecriture_signee(
  p_association_id uuid, p_date date, p_compte_a text, p_compte_b text,
  p_fonds text, p_delta numeric, p_description text, p_source_table text, p_source_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_delta is null or p_delta = 0 then return; end if;
  if p_delta > 0 then
    perform public.poster_ecriture(p_association_id, p_date, jsonb_build_array(
      jsonb_build_object('compte', p_compte_a, 'fonds', p_fonds, 'debit', p_delta, 'credit', 0),
      jsonb_build_object('compte', p_compte_b, 'fonds', p_fonds, 'debit', 0, 'credit', p_delta)
    ), p_description, p_source_table, p_source_id);
  else
    perform public.poster_ecriture(p_association_id, p_date, jsonb_build_array(
      jsonb_build_object('compte', p_compte_a, 'fonds', p_fonds, 'debit', 0, 'credit', -p_delta),
      jsonb_build_object('compte', p_compte_b, 'fonds', p_fonds, 'debit', -p_delta, 'credit', 0)
    ), p_description, p_source_table, p_source_id);
  end if;
end;
$$;

-- Réutilisée sur toutes les tables sources en AFTER DELETE : retire du
-- grand livre les écritures liées à la ligne supprimée, pour que le
-- grand livre reste toujours le reflet exact des données réelles.
-- TG_TABLE_NAME fournit automatiquement le nom de la table déclenchante.
create or replace function public.ecr_trg_delete_generic() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.ecritures_comptables where source_table = TG_TABLE_NAME and source_id = OLD.id;
  return OLD;
end;
$$;

-- ---------- Dons ----------
create or replace function public.ecr_trg_donations() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.poster_ecriture_signee(
    NEW.association_id, coalesce(NEW.date, current_date), '1000', '4300', 'general',
    coalesce(NEW.montant, 0), 'Don reçu — ' || coalesce(NEW.donateur_nom, '—'), 'donations', NEW.id
  );
  return NEW;
end;
$$;
drop trigger if exists trg_ecr_donations on public.donations;
create trigger trg_ecr_donations after insert on public.donations
for each row execute function public.ecr_trg_donations();
drop trigger if exists trg_ecr_donations_del on public.donations;
create trigger trg_ecr_donations_del after delete on public.donations
for each row execute function public.ecr_trg_delete_generic();

-- ---------- Prêts accordés (actif : argent dû par l'adhérent, PAS une charge) ----------
create or replace function public.ecr_trg_loans() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.poster_ecriture_signee(
    NEW.association_id, coalesce(NEW.date_pret, current_date), '1200', '1000', 'general',
    coalesce(NEW.montant_pret, 0), 'Prêt accordé', 'loans', NEW.id
  );
  return NEW;
end;
$$;
drop trigger if exists trg_ecr_loans on public.loans;
create trigger trg_ecr_loans after insert on public.loans
for each row execute function public.ecr_trg_loans();
drop trigger if exists trg_ecr_loans_del on public.loans;
create trigger trg_ecr_loans_del after delete on public.loans
for each row execute function public.ecr_trg_delete_generic();

-- ---------- Remboursements de prêts (réduit la créance, n'est PAS un revenu) ----------
create or replace function public.ecr_trg_loan_repayments() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.poster_ecriture_signee(
    NEW.association_id, coalesce(NEW.date, current_date), '1000', '1200', 'general',
    coalesce(NEW.montant, 0), 'Remboursement de prêt reçu', 'loan_repayments', NEW.id
  );
  return NEW;
end;
$$;
drop trigger if exists trg_ecr_loan_repayments on public.loan_repayments;
create trigger trg_ecr_loan_repayments after insert on public.loan_repayments
for each row execute function public.ecr_trg_loan_repayments();
drop trigger if exists trg_ecr_loan_repayments_del on public.loan_repayments;
create trigger trg_ecr_loan_repayments_del after delete on public.loan_repayments
for each row execute function public.ecr_trg_delete_generic();

-- ---------- Dépenses de fonds (urgence/secours) — insertion ET modification ----------
create or replace function public.ecr_trg_fonds_depenses() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_compte text := case when NEW.fonds = 'urgence' then '5400' else '5500' end;
  v_delta numeric;
begin
  if TG_OP = 'INSERT' then
    v_delta := coalesce(NEW.montant, 0);
  else
    v_delta := coalesce(NEW.montant, 0) - coalesce(OLD.montant, 0);
  end if;
  perform public.poster_ecriture_signee(
    NEW.association_id, coalesce(NEW.date, current_date), v_compte, '1000', NEW.fonds,
    v_delta, 'Dépense — ' || coalesce(NEW.description, NEW.fonds), 'fonds_depenses', NEW.id
  );
  return NEW;
end;
$$;
drop trigger if exists trg_ecr_fonds_depenses on public.fonds_depenses;
create trigger trg_ecr_fonds_depenses after insert or update of montant on public.fonds_depenses
for each row execute function public.ecr_trg_fonds_depenses();
drop trigger if exists trg_ecr_fonds_depenses_del on public.fonds_depenses;
create trigger trg_ecr_fonds_depenses_del after delete on public.fonds_depenses
for each row execute function public.ecr_trg_delete_generic();

-- ---------- Quotes-parts de recouvrement réglées (urgence/secours) ----------
create or replace function public.ecr_trg_fonds_recouvrements() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_fonds text;
  v_compte text;
  v_delta numeric;
  v_old_paye boolean := coalesce(OLD.paye, false);
  v_new_paye boolean := coalesce(NEW.paye, false);
begin
  if v_old_paye = v_new_paye then return NEW; end if;
  select fonds into v_fonds from public.fonds_depenses where id = NEW.depense_id;
  if v_fonds is null then return NEW; end if;
  v_compte := case when v_fonds = 'urgence' then '4410' else '4510' end;
  v_delta := case when v_new_paye then coalesce(NEW.quote_part, 0) else -coalesce(NEW.quote_part, 0) end;
  perform public.poster_ecriture_signee(
    NEW.association_id, coalesce(NEW.date_paiement, current_date), '1000', v_compte, v_fonds,
    v_delta, 'Quote-part réglée — Fonds ' || v_fonds, 'fonds_recouvrements', NEW.id
  );
  return NEW;
end;
$$;
drop trigger if exists trg_ecr_fonds_recouvrements on public.fonds_recouvrements;
create trigger trg_ecr_fonds_recouvrements after update of paye on public.fonds_recouvrements
for each row execute function public.ecr_trg_fonds_recouvrements();
drop trigger if exists trg_ecr_fonds_recouvrements_del on public.fonds_recouvrements;
create trigger trg_ecr_fonds_recouvrements_del after delete on public.fonds_recouvrements
for each row execute function public.ecr_trg_delete_generic();

-- ---------- Fiche adhérent : inscription + contributions initiales urgence/secours ----------
-- Limite documentée en tête de fichier : ces trois champs sont des totaux
-- cumulatifs sans date de paiement individuelle — la date retenue pour
-- CE déclencheur est le jour où la modification est enregistrée dans
-- l'application (aujourd'hui, pour tout nouveau paiement à partir du
-- déploiement de ce script).
create or replace function public.ecr_trg_members_paiements() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.poster_ecriture_signee(
    NEW.association_id, current_date, '1000', '4000', 'general',
    coalesce(NEW.inscription_paye, 0) - coalesce(OLD.inscription_paye, 0),
    'Inscription — ' || coalesce(NEW.nom, '—'), 'members', NEW.id
  );
  perform public.poster_ecriture_signee(
    NEW.association_id, current_date, '1000', '4400', 'urgence',
    coalesce(NEW.fonds_urgence_paye, 0) - coalesce(OLD.fonds_urgence_paye, 0),
    'Contribution Fonds urgence — ' || coalesce(NEW.nom, '—'), 'members', NEW.id
  );
  perform public.poster_ecriture_signee(
    NEW.association_id, current_date, '1000', '4500', 'secours',
    coalesce(NEW.fonds_secours_paye, 0) - coalesce(OLD.fonds_secours_paye, 0),
    'Contribution Fonds secours — ' || coalesce(NEW.nom, '—'), 'members', NEW.id
  );
  return NEW;
end;
$$;
drop trigger if exists trg_ecr_members_paiements on public.members;
create trigger trg_ecr_members_paiements
  after update of inscription_paye, fonds_urgence_paye, fonds_secours_paye on public.members
  for each row execute function public.ecr_trg_members_paiements();

-- ---------- Cotisation (tontine_presences) et Collation (collation_presences) ----------
-- Même limite documentée : pas de date de paiement individuelle avant ce
-- script ; la date d'aujourd'hui est utilisée pour tout nouveau montant
-- à partir de maintenant. association_id est retrouvé via le membre
-- (ces deux tables n'ont pas de colonne association_id directe).
create or replace function public.ecr_trg_tontine_presences() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_assoc uuid;
begin
  select association_id into v_assoc from public.members where id = NEW.member_id;
  if v_assoc is null then return NEW; end if;
  perform public.poster_ecriture_signee(
    v_assoc, current_date, '1000', '4100', 'general',
    coalesce(NEW.montant, 0) - coalesce(OLD.montant, 0),
    'Cotisation — séance ' || coalesce(NEW.seance::text, '—'), 'tontine_presences', NEW.id
  );
  return NEW;
end;
$$;
drop trigger if exists trg_ecr_tontine_presences on public.tontine_presences;
create trigger trg_ecr_tontine_presences after insert or update of montant on public.tontine_presences
for each row execute function public.ecr_trg_tontine_presences();
drop trigger if exists trg_ecr_tontine_presences_del on public.tontine_presences;
create trigger trg_ecr_tontine_presences_del after delete on public.tontine_presences
for each row execute function public.ecr_trg_delete_generic();

create or replace function public.ecr_trg_collation_presences() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_assoc uuid;
begin
  select association_id into v_assoc from public.members where id = NEW.member_id;
  if v_assoc is null then return NEW; end if;
  perform public.poster_ecriture_signee(
    v_assoc, current_date, '1000', '4200', 'general',
    coalesce(NEW.montant, 0) - coalesce(OLD.montant, 0),
    'Collation — ' || coalesce(NEW.mois, '—'), 'collation_presences', NEW.id
  );
  return NEW;
end;
$$;
drop trigger if exists trg_ecr_collation_presences on public.collation_presences;
create trigger trg_ecr_collation_presences after insert or update of montant on public.collation_presences
for each row execute function public.ecr_trg_collation_presences();
drop trigger if exists trg_ecr_collation_presences_del on public.collation_presences;
create trigger trg_ecr_collation_presences_del after delete on public.collation_presences
for each row execute function public.ecr_trg_delete_generic();

-- ---------------------------------------------------------------------
-- 4. Bilan d'ouverture (2026-01-01) + rejeu des transactions datées déjà
--    enregistrées depuis cette date — UNE SEULE FOIS par association,
--    protégé par une vérification (si des écritures existent déjà pour
--    l'association, elle est ignorée : sans danger de relancer ce script).
-- ---------------------------------------------------------------------
do $$
declare
  v_assoc record;
  v_date_depart date := '2026-01-01';
  v_lignes jsonb;
  v_row record;
  v_montant_inscription numeric;
  v_montant_urgence numeric;
  v_montant_secours numeric;
  v_montant_tontine numeric;
  v_montant_collation numeric;
  v_dons_avant numeric;
  v_prets_avant numeric;
  v_remb_avant numeric;
  v_dep_urgence_avant numeric;
  v_dep_secours_avant numeric;
  v_rec_urgence_avant numeric;
  v_rec_secours_avant numeric;
  v_net_general numeric;
  v_net_urgence numeric;
  v_net_secours numeric;
begin
  for v_assoc in select id from public.associations loop
    continue when exists (select 1 from public.ecritures_comptables where association_id = v_assoc.id);

    select coalesce(sum(inscription_paye), 0), coalesce(sum(fonds_urgence_paye), 0), coalesce(sum(fonds_secours_paye), 0)
      into v_montant_inscription, v_montant_urgence, v_montant_secours
      from public.members where association_id = v_assoc.id;

    select coalesce(sum(tp.montant), 0) into v_montant_tontine
      from public.tontine_presences tp join public.members m on m.id = tp.member_id
      where m.association_id = v_assoc.id;

    select coalesce(sum(cp.montant), 0) into v_montant_collation
      from public.collation_presences cp join public.members m on m.id = cp.member_id
      where m.association_id = v_assoc.id;

    select coalesce(sum(montant), 0) into v_dons_avant from public.donations
      where association_id = v_assoc.id and date < v_date_depart;
    select coalesce(sum(montant_pret), 0) into v_prets_avant from public.loans
      where association_id = v_assoc.id and date_pret < v_date_depart;
    select coalesce(sum(montant), 0) into v_remb_avant from public.loan_repayments
      where association_id = v_assoc.id and date < v_date_depart;
    select coalesce(sum(montant), 0) into v_dep_urgence_avant from public.fonds_depenses
      where association_id = v_assoc.id and fonds = 'urgence' and date < v_date_depart;
    select coalesce(sum(montant), 0) into v_dep_secours_avant from public.fonds_depenses
      where association_id = v_assoc.id and fonds = 'secours' and date < v_date_depart;
    select coalesce(sum(fr.quote_part), 0) into v_rec_urgence_avant
      from public.fonds_recouvrements fr join public.fonds_depenses fd on fd.id = fr.depense_id
      where fr.association_id = v_assoc.id and fd.fonds = 'urgence' and fr.paye = true and fr.date_paiement < v_date_depart;
    select coalesce(sum(fr.quote_part), 0) into v_rec_secours_avant
      from public.fonds_recouvrements fr join public.fonds_depenses fd on fd.id = fr.depense_id
      where fr.association_id = v_assoc.id and fd.fonds = 'secours' and fr.paye = true and fr.date_paiement < v_date_depart;

    -- Encaisse d'ouverture, calculée SÉPARÉMENT par fonds (et non globalement
    -- puis étiquetée "general") : chaque dollar d'encaisse doit porter le
    -- même fonds que sa contrepartie produit/charge, sinon l'Actif net par
    -- fonds (l'écran Bilan) ne reflète plus le vrai patrimoine de chaque
    -- fonds — bug identifié le 2026-09-28 lors de la première validation en
    -- conditions réelles (voir sql/2026-09-28d_comptabilite_correctif_fonds_ouverture.sql).
    v_net_general := v_montant_inscription + v_montant_tontine + v_montant_collation
      + v_dons_avant + v_remb_avant - v_prets_avant;
    v_net_urgence := v_montant_urgence + v_rec_urgence_avant - v_dep_urgence_avant;
    v_net_secours := v_montant_secours + v_rec_secours_avant - v_dep_secours_avant;

    v_lignes := '[]'::jsonb;
    -- Actifs d'ouverture
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '1200', 'fonds', 'general',
      'debit', greatest(v_prets_avant - v_remb_avant, 0), 'credit', 0));
    -- Équilibre : Encaisse = tout ce qui est entré moins tout ce qui est sorti avant le 1er janvier 2026,
    -- une ligne par fonds (general/urgence/secours) pour que chaque fonds porte sa propre part d'encaisse.
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '1000', 'fonds', 'general',
      'debit', greatest(v_net_general, 0), 'credit', greatest(-v_net_general, 0)));
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '1000', 'fonds', 'urgence',
      'debit', greatest(v_net_urgence, 0), 'credit', greatest(-v_net_urgence, 0)));
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '1000', 'fonds', 'secours',
      'debit', greatest(v_net_secours, 0), 'credit', greatest(-v_net_secours, 0)));
    -- Produits/charges d'ouverture (contrepartie)
    if v_montant_inscription <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4000', 'fonds', 'general', 'debit', 0, 'credit', v_montant_inscription)); end if;
    if v_montant_urgence <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4400', 'fonds', 'urgence', 'debit', 0, 'credit', v_montant_urgence)); end if;
    if v_montant_secours <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4500', 'fonds', 'secours', 'debit', 0, 'credit', v_montant_secours)); end if;
    if v_montant_tontine <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4100', 'fonds', 'general', 'debit', 0, 'credit', v_montant_tontine)); end if;
    if v_montant_collation <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4200', 'fonds', 'general', 'debit', 0, 'credit', v_montant_collation)); end if;
    if v_dons_avant <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4300', 'fonds', 'general', 'debit', 0, 'credit', v_dons_avant)); end if;
    if v_rec_urgence_avant <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4410', 'fonds', 'urgence', 'debit', 0, 'credit', v_rec_urgence_avant)); end if;
    if v_rec_secours_avant <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4510', 'fonds', 'secours', 'debit', 0, 'credit', v_rec_secours_avant)); end if;
    if v_dep_urgence_avant <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '5400', 'fonds', 'urgence', 'debit', v_dep_urgence_avant, 'credit', 0)); end if;
    if v_dep_secours_avant <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '5500', 'fonds', 'secours', 'debit', v_dep_secours_avant, 'credit', 0)); end if;

    perform public.poster_ecriture(v_assoc.id, v_date_depart, v_lignes,
      'Bilan d''ouverture au 1er janvier 2026', 'bilan_ouverture', v_assoc.id);

    -- Rejeu des transactions DATÉES déjà enregistrées à partir du 1er
    -- janvier 2026 (avec leur vraie date, pour un Bilan et un futur État
    -- des résultats 2026 précis dès le premier exercice).
    for v_row in select * from public.donations where association_id = v_assoc.id and date >= v_date_depart loop
      perform public.poster_ecriture_signee(v_assoc.id, v_row.date, '1000', '4300', 'general',
        v_row.montant, 'Don reçu — ' || coalesce(v_row.donateur_nom, '—'), 'donations', v_row.id);
    end loop;
    for v_row in select * from public.loans where association_id = v_assoc.id and date_pret >= v_date_depart loop
      perform public.poster_ecriture_signee(v_assoc.id, v_row.date_pret, '1200', '1000', 'general',
        v_row.montant_pret, 'Prêt accordé', 'loans', v_row.id);
    end loop;
    for v_row in select * from public.loan_repayments where association_id = v_assoc.id and date >= v_date_depart loop
      perform public.poster_ecriture_signee(v_assoc.id, v_row.date, '1000', '1200', 'general',
        v_row.montant, 'Remboursement de prêt reçu', 'loan_repayments', v_row.id);
    end loop;
    for v_row in select * from public.fonds_depenses where association_id = v_assoc.id and date >= v_date_depart loop
      perform public.poster_ecriture_signee(v_assoc.id, v_row.date,
        case when v_row.fonds = 'urgence' then '5400' else '5500' end, '1000', v_row.fonds,
        v_row.montant, 'Dépense — ' || coalesce(v_row.description, v_row.fonds), 'fonds_depenses', v_row.id);
    end loop;
    for v_row in
      select fr.*, fd.fonds as fonds_type from public.fonds_recouvrements fr
      join public.fonds_depenses fd on fd.id = fr.depense_id
      where fr.association_id = v_assoc.id and fr.paye = true and fr.date_paiement >= v_date_depart
    loop
      perform public.poster_ecriture_signee(v_assoc.id, v_row.date_paiement, '1000',
        case when v_row.fonds_type = 'urgence' then '4410' else '4510' end, v_row.fonds_type,
        v_row.quote_part, 'Quote-part réglée — Fonds ' || v_row.fonds_type, 'fonds_recouvrements', v_row.id);
    end loop;
  end loop;
end;
$$;
