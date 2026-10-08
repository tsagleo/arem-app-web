-- =====================================================================
-- Révocation complète d'un accès (bloquer un compte)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- Dernier point ouvert de la Phase 1 (voir claude/feuille-de-route.md) :
-- jusqu'ici, « Gestion des accès » permettait de changer le rôle d'un
-- compte mais pas de lui couper complètement l'accès.
--
-- Approche retenue (choisie avec l'utilisateur, alternative à une Edge
-- Function Supabase avec rôle de service) : un compte « bloqué » peut
-- techniquement encore s'authentifier (son mot de passe reste valide),
-- mais n'a plus accès à AUCUNE donnée de son association — tout est
-- verrouillé au niveau de la base de données, pas seulement de
-- l'interface. Ne nécessite aucune configuration Supabase supplémentaire
-- (pas d'Edge Function, pas de clé de service), juste ce script SQL.
--
-- Mécanisme : `current_association_id()` — la fonction que TOUTES les
-- politiques RLS de l'application utilisent pour scoper l'accès à une
-- association (suite 31) — renvoie désormais NULL pour un compte
-- bloqué, quel que soit son rôle. Comme la quasi-totalité des tables
-- (members, finances, documents, événements, votes, etc.) filtrent par
-- `association_id = current_association_id()`, un compte bloqué se
-- retrouve sans accès à absolument rien, y compris en écriture — sans
-- qu'aucune des ~24 politiques RLS existantes n'ait besoin d'être
-- modifiée une par une.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Nouvelle colonne
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists compte_bloque boolean not null default false;

-- ---------------------------------------------------------------------
-- 2) current_association_id() ignore désormais un compte bloqué
-- ---------------------------------------------------------------------
-- Remplace la version de la suite 31 : identique, sauf qu'un profil
-- avec compte_bloque = true ne « matche » plus la condition where, donc
-- la fonction renvoie NULL pour ce compte — exactement comme si son
-- profil n'existait pas, du point de vue de toutes les politiques RLS.
create or replace function current_association_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select association_id from profiles where id = auth.uid() and coalesce(compte_bloque, false) = false;
$$;

-- Note : `current_user_role()` n'est PAS modifiée (reste le rôle réel du
-- compte, bloqué ou non) — nécessaire pour que le président puisse se
-- débloquer lui-même s'il se bloque par erreur (voir point 3), et pour
-- que le déclencheur ci-dessous identifie correctement qui essaie de
-- changer le statut de blocage.

-- ---------------------------------------------------------------------
-- 3) Changer compte_bloque (comme le rôle) est réservé au président
-- ---------------------------------------------------------------------
-- Remplace la fonction du déclencheur livré en suite 36
-- (sql/2026-09-07e_durcissement_rls_president.sql) : même mécanisme,
-- étendu à la nouvelle colonne `compte_bloque`. Le déclencheur
-- `trg_president_only_role_change` existe déjà sur `profiles` et pointe
-- vers cette fonction — aucune modification du déclencheur lui-même
-- n'est nécessaire.
create or replace function enforce_president_only_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_user_role();
begin
  if new.role is distinct from old.role or new.compte_bloque is distinct from old.compte_bloque then
    if v_role <> 'bureau_president' and v_role <> 'super_admin' then
      raise exception 'Seul(e) le/la président(e) peut modifier le rôle ou le statut de blocage d''un compte.';
    end if;
  end if;
  return new;
end;
$$;

-- =====================================================================
-- Vérification rapide après exécution :
--   1. En président(e), bloquer un compte de test depuis « Gestion des
--      accès ». Se reconnecter avec ce compte : il doit voir un écran
--      « Compte bloqué » et n'avoir accès à aucune donnée.
--   2. Débloquer ce même compte depuis « Gestion des accès » (président)
--      → l'accès doit revenir normalement à la reconnexion.
--   3. Un compte non-président ne doit pas pouvoir bloquer/débloquer un
--      compte (bouton grisé dans l'interface, et refusé côté base de
--      données si contourné techniquement).
-- =====================================================================
