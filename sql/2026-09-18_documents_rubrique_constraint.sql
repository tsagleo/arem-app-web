-- =====================================================================
-- Correction de la contrainte de rubrique sur `documents`
-- =====================================================================
-- Suite 69 (2026-09-18). Bug signalé par l'utilisateur (capture d'écran
-- avec le nouveau message d'erreur, suite 68) : téléverser un document
-- dans la rubrique « Dons » (et probablement plusieurs autres, ajoutées
-- au fil des suites) échouait avec :
--
--   new row for relation "documents" violates check constraint
--   "documents_rubrique_check"
--
-- Cause : la contrainte `documents_rubrique_check`, définie très tôt
-- dans le projet, ne liste qu'un sous-ensemble des rubriques. Le menu
-- déroulant côté application (`DOC_CATEGORY_KEY_MAP` dans App.jsx) a
-- été étendu plusieurs fois depuis (Tontine, Collation, Fonds
-- d'urgence/secours, Finances, Vie associative, Projets, Événements,
-- Dons, Emprunts) sans jamais mettre à jour cette contrainte côté base
-- — d'où l'échec silencieux (désormais visible depuis la suite 68) dès
-- qu'un adhérent du Bureau choisit une rubrique ajoutée après la
-- contrainte d'origine.
--
-- Correctif : la contrainte est recréée pour couvrir exactement les 15
-- valeurs actuellement proposées par `DOC_CATEGORY_KEY_MAP`.
-- =====================================================================

alter table public.documents
  drop constraint if exists documents_rubrique_check;

alter table public.documents
  add constraint documents_rubrique_check check (
    rubrique in (
      'general', 'pv_reunion', 'gouvernance',
      'inscription', 'tontine', 'collation',
      'fonds_urgence', 'fonds_secours',
      'finances', 'vie_associative', 'projets',
      'evenements', 'dons', 'emprunts', 'autre'
    )
  );

comment on constraint documents_rubrique_check on public.documents is
  'Rubriques valides pour un document, alignées sur DOC_CATEGORY_KEY_MAP (App.jsx). Suite 69 (2026-09-18) — élargie pour couvrir toutes les rubriques ajoutées depuis la contrainte d''origine.';
