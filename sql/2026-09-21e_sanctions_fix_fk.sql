-- =====================================================================
-- Correctif — Volet Sanctions : mauvaise référence sur proposee_par /
-- validee_par (script 2026-09-21d_sanctions.sql).
-- =====================================================================
-- Diagnostic : ces deux colonnes stockent l'identifiant de PROFIL
-- (profiles.id, le même que associations.approbateur_suppression_id
-- et deletion_requests.requested_by/reviewed_by) et non un identifiant
-- de la table members. Le script d'origine les avait fait référencer
-- par erreur members(id), ce qui provoque une erreur de clé étrangère
-- (23503, « élément concerné introuvable ») au moment de proposer ou
-- d'appliquer une sanction. Ce script corrige les deux contraintes
-- sans perdre aucune donnée déjà saisie.
-- =====================================================================

alter table public.sanctions drop constraint if exists sanctions_proposee_par_fkey;
alter table public.sanctions drop constraint if exists sanctions_validee_par_fkey;

alter table public.sanctions
  add constraint sanctions_proposee_par_fkey foreign key (proposee_par) references public.profiles(id) on delete set null,
  add constraint sanctions_validee_par_fkey foreign key (validee_par) references public.profiles(id) on delete set null;
