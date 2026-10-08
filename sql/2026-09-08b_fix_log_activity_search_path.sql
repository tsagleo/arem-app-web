-- =====================================================================
-- Correctif : log_activity() ne fixait pas son search_path
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- CONTEXTE (découvert en testant les rappels de retard, suite 46) :
-- log_activity() est le déclencheur générique qui alimente le Journal
-- d'activité sur ~24 tables depuis les tout premiers scripts du projet.
-- Elle est SECURITY DEFINER mais, contrairement à toutes les fonctions
-- écrites depuis, elle ne fixait PAS explicitement son search_path et
-- lisait `profiles` sans préfixe de schéma.
--
-- Tant qu'elle était déclenchée depuis une session normale (l'app, ou un
-- appel direct dans le SQL Editor), le search_path ambiant contenait
-- "public" et tout fonctionnait. Mais nos fonctions de notification
-- (Resend/pg_net) fixent volontairement `set search_path = ''` par
-- sécurité (bonne pratique recommandée par Postgres pour toute fonction
-- SECURITY DEFINER, afin qu'une table malveillante de même nom dans un
-- autre schéma ne puisse jamais être substituée à la vraie table).
--
-- Résultat : dès qu'une de nos fonctions de notification fait un UPDATE
-- sur une table journalisée (ex. `send_overdue_inscription_reminders()`
-- qui met à jour `members.rappel_inscription_envoye`), le déclencheur
-- `log_activity()` s'exécute PENDANT que le search_path est encore vide
-- (hérité de la fonction appelante) → erreur
-- "relation "profiles" does not exist".
--
-- CE QUE CE SCRIPT CORRIGE : ajoute `set search_path = ''` à
-- log_activity() elle-même (comme sur toutes nos autres fonctions) et
-- préfixe ses deux références de table (`public.profiles`,
-- `public.activity_log`). Aucun changement de comportement — seulement
-- une résolution de schéma fiable, quel que soit le contexte d'appel.
-- Les ~24 déclencheurs qui utilisent déjà cette fonction n'ont pas
-- besoin d'être recréés : ils appellent la fonction par son nom, qui
-- pointera automatiquement vers cette nouvelle version.
-- =====================================================================

create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_nom text;
  v_assoc uuid;
begin
  select nom_complet, association_id into v_nom, v_assoc from public.profiles where id = v_user;
  insert into public.activity_log (association_id, user_id, user_nom, action, table_name, record_id, details)
  values (
    v_assoc,
    v_user, v_nom, TG_OP, TG_TABLE_NAME,
    case when TG_OP = 'DELETE' then old.id else new.id end,
    case
      when TG_OP = 'INSERT' then jsonb_build_object('nouveau', to_jsonb(new))
      when TG_OP = 'UPDATE' then jsonb_build_object('ancien', to_jsonb(old), 'nouveau', to_jsonb(new))
      when TG_OP = 'DELETE' then jsonb_build_object('ancien', to_jsonb(old))
    end
  );
  return coalesce(new, old);
end;
$function$;

-- =====================================================================
-- Vérification rapide après exécution :
--   select prosecdef, proconfig from pg_proc where proname = 'log_activity';
--   -- prosecdef doit être "true" ; proconfig doit contenir "search_path="
-- =====================================================================
