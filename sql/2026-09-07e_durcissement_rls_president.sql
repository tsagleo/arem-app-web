-- =====================================================================
-- Durcissement : réglages « réservé au président » protégés au niveau
-- de la base de données (pas seulement côté interface)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- Contexte : depuis la suite 33, certains réglages sont déjà grisés dans
-- l'interface pour quiconque n'est pas président(e) — l'approbateur des
-- suppressions, la période de probation du fonds de secours (suite 33),
-- le code d'invitation, et le rôle des comptes (suite 34, onglet
-- « Gestion des accès »). Mais la politique RLS sous-jacente autorisait
-- encore techniquement TOUT membre du bureau (président, secrétaire,
-- trésorier) à modifier ces colonnes via un appel API direct — l'écran
-- grisé n'empêchait qu'un clic dans l'interface, pas un appel technique.
--
-- PostgreSQL RLS ne filtre pas par colonne (seulement par ligne) : on ne
-- peut donc pas exprimer « ce rôle peut modifier la ligne, mais pas ces
-- colonnes précises » avec une simple politique RLS. La solution ici
-- est un déclencheur (trigger) `before update`, qui vérifie, en plus de
-- la politique RLS déjà en place, que ces colonnes précises ne changent
-- que si la personne connectée est bien président(e) (ou super-admin) —
-- et refuse la modification (erreur explicite) sinon.
--
-- Compatibilité : n'affecte AUCUNE lecture, ni les autres colonnes de
-- ces deux tables (montants, image de marque, couleurs, etc. restent
-- modifiables par tout le bureau, comme avant). N'affecte pas non plus
-- les fonctions déjà réservées au président (`regenerate_invite_code()`)
-- ni la création de comptes (`create_association_for_new_user()`,
-- `join_association_with_code()` insèrent un rôle, ils ne le modifient
-- pas) — ces deux fonctions restent inchangées. Un appel fait
-- directement dans le SQL Editor (hors session applicative) n'est pas
-- bloqué par ce déclencheur, par cohérence avec le comportement déjà
-- adopté par `regenerate_invite_code()`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) associations : approbateur_suppression_id / periode_probation_secours_jours
--    / code_invitation — réservés au président
-- ---------------------------------------------------------------------
create or replace function enforce_president_only_association_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_user_role();
begin
  if v_role <> 'bureau_president' and v_role <> 'super_admin' then
    if new.approbateur_suppression_id is distinct from old.approbateur_suppression_id
       or new.periode_probation_secours_jours is distinct from old.periode_probation_secours_jours
       or new.code_invitation is distinct from old.code_invitation then
      raise exception 'Seul(e) le/la président(e) peut modifier ces réglages (approbateur des suppressions, période de probation, code d''invitation).';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_president_only_association_settings on associations;
create trigger trg_president_only_association_settings
  before update on associations
  for each row
  execute function enforce_president_only_association_settings();

-- ---------------------------------------------------------------------
-- 2) profiles : rôle d'un compte — réservé au président
-- ---------------------------------------------------------------------
create or replace function enforce_president_only_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_user_role();
begin
  if new.role is distinct from old.role then
    if v_role <> 'bureau_president' and v_role <> 'super_admin' then
      raise exception 'Seul(e) le/la président(e) peut modifier le rôle d''un compte.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_president_only_role_change on profiles;
create trigger trg_president_only_role_change
  before update on profiles
  for each row
  execute function enforce_president_only_role_change();

-- =====================================================================
-- Vérification rapide après exécution (à faire avec un compte NON
-- président — ex. le compte secrétaire de test) :
--   1. Essayer de désigner un approbateur, changer la période de
--      probation, ou changer le rôle d'un compte → doit échouer avec le
--      message d'erreur ci-dessus (visible dans l'application depuis ce
--      correctif — voir App.jsx/GestionAcces.jsx).
--   2. Se reconnecter avec le compte président → les mêmes actions
--      doivent fonctionner normalement, comme avant.
--   3. Modifier d'autres réglages (montants, image de marque, couleurs,
--      fréquence des réunions) avec le compte secrétaire → doit
--      continuer à fonctionner normalement (non affecté par ce script).
-- =====================================================================
