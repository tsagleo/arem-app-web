-- =====================================================================
-- Correctif du bug d'auto-inscription identifié en suite 33
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois), APRÈS le script
-- 2026-09-04e_multi_tenant_rls.sql.
--
-- LE PROBLÈME (rappel) : l'inscription (« Créer votre association ») fait
-- trois insertions séparées (associations, subscriptions, profiles) depuis
-- le navigateur, juste après la création du compte. Selon que la
-- confirmation de courriel est activée ou non dans Supabase, et selon
-- l'état exact de la session à ce moment précis, ces insertions peuvent
-- s'exécuter alors que l'utilisateur n'est pas encore pleinement
-- authentifié — bloquées par les règles de sécurité (RLS), ou échouant
-- silencieusement à mi-chemin (une table créée, pas les autres).
--
-- LA SOLUTION : regrouper les trois insertions en une seule fonction
-- côté base de données (« create_association_for_new_user »), exécutée
-- comme une seule transaction atomique — soit tout est créé d'un coup,
-- soit rien ne l'est (jamais d'état à moitié créé). Le code de
-- l'application (fichier App.jsx, livré séparément) a été mis à jour
-- pour appeler cette fonction, et pour patienter et réessayer
-- automatiquement à la première connexion si le compte devait d'abord
-- confirmer son courriel.
--
-- Ce script ne supprime ni ne modifie aucune donnée existante.
-- =====================================================================

create or replace function public.create_association_for_new_user(p_nom_association text, p_nom_complet text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assoc_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Vous devez être connecté(e) pour créer une association.';
  end if;

  -- Sécurité : empêche un compte déjà rattaché à une association d'en
  -- créer une seconde par erreur (ex. double-clic, nouvel essai après un
  -- échec partiel qui aurait quand même réussi à créer le profil).
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Ce compte est déjà rattaché à une association.';
  end if;

  insert into public.associations (nom) values (p_nom_association) returning id into v_assoc_id;

  insert into public.subscriptions (association_id, plan, statut, date_fin_periode)
  values (v_assoc_id, 'essai', 'actif', (now() + interval '30 days')::date);

  insert into public.profiles (id, association_id, role, nom_complet)
  values (auth.uid(), v_assoc_id, 'bureau_president', p_nom_complet);

  return json_build_object('association_id', v_assoc_id);
end;
$$;

-- Autorise tout utilisateur authentifié à appeler cette fonction (la
-- fonction elle-même vérifie qu'on ne peut créer une association que
-- pour SOI-MÊME, une seule fois — voir les gardes ci-dessus).
grant execute on function public.create_association_for_new_user(text, text) to authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select proname from pg_proc where proname = 'create_association_for_new_user';
--   -- doit afficher une ligne
-- =====================================================================
