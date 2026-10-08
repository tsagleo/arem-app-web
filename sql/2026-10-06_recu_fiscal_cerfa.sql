-- =====================================================================
-- Reçu fiscal conforme (France, CERFA n°11580*05 / formulaire 2041-RD)
-- Demandé par l'utilisateur dans la suite "ALLER AVEC LES RECOMMANDATIONS"
-- (veille concurrentielle 2026), priorité France d'abord. Recherche
-- préalable sur les mentions obligatoires exactes (formulaire officiel
-- impots.gouv.fr, BOFiP) — voir claude/resume-arem-app.md pour le détail.
--
-- Portée : dons des PARTICULIERS (art. 200/978 du CGI), via le formulaire
-- 2041-RD. Le reçu "entreprises/mécénat" (2041-MEC-SD, art. 238 bis) n'est
-- PAS couvert par ce chantier — à construire séparément si une association
-- en a besoin (dons d'entreprises, mécénat de compétences).
--
-- Ce script est additif uniquement (ALTER TABLE ... ADD COLUMN IF NOT
-- EXISTS, valeurs par défaut neutres) : aucune association existante,
-- française ou non, n'est affectée tant que personne ne renseigne les
-- nouveaux champs. Les associations canadiennes/américaines qui émettent
-- déjà leurs propres reçus (don_receipt_* existant) continuent de
-- fonctionner à l'identique.
-- =====================================================================

-- ---------- associations : identité requise par le CERFA ----------
alter table public.associations
  add column if not exists recu_objet_social text,
  add column if not exists recu_categorie_eligibilite text,
  add column if not exists recu_dernier_numero integer not null default 0;

comment on column public.associations.recu_objet_social is
  'Objet social de l''association (texte libre), tel qu''exigé sur le reçu fiscal CERFA 2041-RD. Distinct de governance_info.mission pour ne pas dépendre d''une jointure sur le composant reçu.';
comment on column public.associations.recu_categorie_eligibilite is
  'Code de la catégorie d''éligibilité cochée sur le CERFA 2041-RD (ex. "interet_general_social", "rup" — voir RECU_CATEGORIES dans shared.jsx pour la liste complète). NULL = non renseigné (association hors France, ou pas encore configuré).';
comment on column public.associations.recu_dernier_numero is
  'Compteur du dernier numéro de reçu fiscal attribué (séquence par association). Incrémenté uniquement par assign_recu_numero(), jamais directement.';

-- ---------- donations : mentions obligatoires propres à chaque don ----------
alter table public.donations
  add column if not exists donateur_adresse text,
  add column if not exists nature_don text not null default 'numeraire',
  add column if not exists forme_don text not null default 'declaration_unilaterale',
  add column if not exists mode_versement text,
  add column if not exists base_legale text not null default 'art200',
  add column if not exists numero_recu integer;

-- drop ... if exists puis add (plutôt que ADD CONSTRAINT IF NOT EXISTS,
-- que PostgreSQL ne supporte pas pour les contraintes CHECK) : rend ce
-- script rejouable sans erreur même après un premier passage partiel —
-- corrige l'erreur 42710 rencontrée par l'utilisateur à l'exécution.
alter table public.donations drop constraint if exists donations_nature_don_check;
alter table public.donations
  add constraint donations_nature_don_check
    check (nature_don in ('numeraire', 'nature', 'abandon_frais', 'titres_cotes', 'abandon_revenus'));
alter table public.donations drop constraint if exists donations_forme_don_check;
alter table public.donations
  add constraint donations_forme_don_check
    check (forme_don in ('declaration_unilaterale', 'acte_authentique', 'acte_sous_seing_prive', 'autre'));
alter table public.donations drop constraint if exists donations_mode_versement_check;
alter table public.donations
  add constraint donations_mode_versement_check
    check (mode_versement is null or mode_versement in ('especes', 'cheque', 'virement', 'autre'));
alter table public.donations drop constraint if exists donations_base_legale_check;
alter table public.donations
  add constraint donations_base_legale_check
    check (base_legale in ('art200', 'art978'));

comment on column public.donations.numero_recu is
  'Numéro d''ordre séquentiel du reçu fiscal (mention obligatoire du CERFA 2041-RD), attribué une seule fois via assign_recu_numero() au premier affichage/impression du reçu — jamais réattribué, jamais modifiable depuis l''application.';

create unique index if not exists donations_numero_recu_assoc_unique
  on public.donations (association_id, numero_recu)
  where numero_recu is not null;

-- =====================================================================
-- assign_recu_numero : attribution atomique et définitive du numéro
-- d'ordre d'un reçu. Idempotent — un don qui a déjà un numéro le renvoie
-- simplement, sans jamais en générer un second (la mention "numéro
-- d'ordre" du CERFA doit identifier un reçu de façon stable et unique).
-- SECURITY DEFINER avec search_path vide (même patron que les autres
-- fonctions de ce projet, ex. join_association_with_code) : nécessaire
-- parce que l'incrémentation du compteur sur `associations` et l'écriture
-- sur `donations` doivent réussir ensemble, sans dépendre des politiques
-- RLS de lecture/écriture habituelles de l'appelant.
-- =====================================================================
create or replace function public.assign_recu_numero(p_donation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assoc_id uuid;
  v_existing integer;
  v_numero integer;
begin
  select association_id, numero_recu into v_assoc_id, v_existing
  from public.donations
  where id = p_donation_id;

  if v_assoc_id is null then
    raise exception 'Don introuvable.';
  end if;

  -- Seul un membre de l'association concernée (bureau ou adhérent, le reçu
  -- pouvant être consulté par le donateur lui-même) peut déclencher
  -- l'attribution — empêche qu'une requête RPC forgée depuis une autre
  -- association numérote un don qui ne lui appartient pas.
  if v_assoc_id != public.current_association_id() and not public.is_super_admin() then
    raise exception 'Ce don n''appartient pas à votre association.';
  end if;

  if v_existing is not null then
    return v_existing;
  end if;

  update public.associations
  set recu_dernier_numero = recu_dernier_numero + 1
  where id = v_assoc_id
  returning recu_dernier_numero into v_numero;

  update public.donations set numero_recu = v_numero where id = p_donation_id;

  return v_numero;
end;
$$;
grant execute on function public.assign_recu_numero(uuid) to authenticated;
