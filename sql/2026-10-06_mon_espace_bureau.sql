-- =====================================================================
-- Accès de "Mon espace" aux comptes du bureau et responsables de rubrique
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- LE CONTEXTE : "Mon espace" (reçus, historique de paiements, carte de
-- membre numérique) n'a jamais été accessible qu'aux comptes de rôle
-- "adherent" simple — un président, secrétaire, trésorier ou responsable
-- de rubrique n'a jamais eu sa propre fiche adhérent (`members`) créée ni
-- reliée à son profil (`profiles.member_id`), parce que la fonction qui
-- crée un compte lors de "Créer votre association" ne créait que
-- l'association, l'abonnement et le profil — jamais de fiche adhérent.
-- Le code de l'application (livré séparément) a été mis à jour pour
-- afficher "Mon espace" au bureau/responsable dès que leur compte a une
-- fiche adhérent reliée — ce script fournit cette fiche.
--
-- CE QUE FAIT CE SCRIPT :
--   PARTIE 1 — pour tous les comptes bureau/responsable déjà existants
--   sans fiche adhérent reliée, en crée une (nom = nom du compte, statut
--   Actif, date d'adhésion = aujourd'hui) et relie le profil à cette
--   fiche. Sans effet sur un compte qui a déjà une fiche reliée (double
--   exécution sans danger).
--   PARTIE 2 — met à jour create_association_for_new_user() pour que
--   CHAQUE NOUVELLE association créée obtienne automatiquement cette
--   fiche pour son président, sans repasser par ce script plus tard.
--
-- Ce script ne supprime ni ne modifie aucune donnée existante (seulement
-- des ajouts : nouvelles lignes `members`, et la seule colonne
-- `profiles.member_id` quand elle était vide).
-- =====================================================================

-- ---------------------------------------------------------------------
-- PARTIE 1 — Comptes bureau/responsable existants, sans fiche reliée
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_member_id uuid;
begin
  for r in
    select id, association_id, nom_complet
    from public.profiles
    where role in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier', 'responsable_rubrique')
      and member_id is null
  loop
    insert into public.members (association_id, nom, statut, date_adhesion)
    values (r.association_id, coalesce(r.nom_complet, 'Sans nom'), 'Actif', current_date)
    returning id into v_member_id;

    update public.profiles set member_id = v_member_id where id = r.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- PARTIE 2 — Nouveaux comptes : fiche adhérent créée et reliée dès la
-- création de l'association (plus besoin de ce script pour eux).
-- ---------------------------------------------------------------------
create or replace function public.create_association_for_new_user(p_nom_association text, p_nom_complet text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assoc_id uuid;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Vous devez être connecté(e) pour créer une association.';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Ce compte est déjà rattaché à une association.';
  end if;

  insert into public.associations (nom) values (p_nom_association) returning id into v_assoc_id;

  insert into public.subscriptions (association_id, plan, statut, date_fin_periode)
  values (v_assoc_id, 'essai', 'actif', (now() + interval '30 days')::date);

  -- Fiche adhérent du/de la président(e) qui crée l'association — ajouté
  -- ici (suite 2026-10-06) pour que "Mon espace" lui soit utilisable dès
  -- le premier jour, sans script manuel ni second compte.
  insert into public.members (association_id, nom, statut, date_adhesion)
  values (v_assoc_id, p_nom_complet, 'Actif', current_date)
  returning id into v_member_id;

  insert into public.profiles (id, association_id, role, nom_complet, member_id)
  values (auth.uid(), v_assoc_id, 'bureau_president', p_nom_complet, v_member_id);

  return json_build_object('association_id', v_assoc_id);
end;
$$;

grant execute on function public.create_association_for_new_user(text, text) to authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select p.nom_complet, p.role, m.nom as fiche_reliee
--   from public.profiles p left join public.members m on m.id = p.member_id
--   where p.role in ('bureau_president','bureau_secretaire','bureau_tresorier','responsable_rubrique');
--   -- chaque ligne doit maintenant avoir une "fiche_reliee" (plus de NULL)
-- =====================================================================
