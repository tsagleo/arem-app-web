-- =====================================================================
-- Correctif urgent : l'ordre du jour d'une réunion refusait de se
-- téléverser ("Une des valeurs saisies n'est pas valide pour ce champ"),
-- signalé par l'utilisateur en conditions réelles (2026-10-06).
-- =====================================================================
-- CAUSE : la table `documents` a une contrainte CHECK sur sa colonne
-- `rubrique` qui liste explicitement les catégories autorisées. Le
-- procès-verbal réutilisait la catégorie "pv_reunion", déjà présente
-- dans cette liste — mais "ordre_du_jour_reunion" (ajoutée ce même jour
-- dans DOC_CATEGORY_KEY_MAP, App.jsx, côté application seulement) n'a
-- jamais été ajoutée à la contrainte côté base de données. Résultat :
-- l'application proposait bien la nouvelle catégorie, mais la base la
-- rejetait systématiquement à l'enregistrement.
--
-- CORRECTIF : retrouve dynamiquement la contrainte CHECK existante sur
-- documents.rubrique (quel que soit son nom exact, jamais vu dans les
-- scripts conservés localement) et la remplace par une version à jour,
-- incluant explicitement TOUTES les catégories utilisées par
-- l'application aujourd'hui — y compris "piece_identite_adhesion" et
-- "preuve_paiement_adhesion" (ajoutées le même jour, jamais testées en
-- conditions réelles à ce stade : corrigées ici par précaution, avant
-- qu'elles ne causent le même problème).
-- =====================================================================

do $$
declare
  conname text;
begin
  for conname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
    where rel.relname = 'documents' and att.attname = 'rubrique' and con.contype = 'c'
  loop
    execute format('alter table public.documents drop constraint %I', conname);
  end loop;
end $$;

alter table public.documents add constraint documents_rubrique_check check (rubrique in (
  'general', 'pv_reunion', 'gouvernance',
  'inscription', 'tontine', 'collation', 'fonds_urgence', 'fonds_secours',
  'piece_identite_adhesion', 'preuve_paiement_adhesion',
  'ordre_du_jour_reunion',
  'finances', 'vie_associative', 'projets', 'evenements', 'dons', 'emprunts',
  'autre'
));

-- =====================================================================
-- Vérification rapide après exécution :
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.documents'::regclass and contype = 'c';
--   -- doit afficher "documents_rubrique_check" avec les 18 valeurs listées
--
-- Pour tester : retournez dans Réunions & webinaires → réunion à venir →
-- « Joindre l'ordre du jour » → choisir un fichier. Doit réussir sans
-- afficher d'erreur.
-- =====================================================================
