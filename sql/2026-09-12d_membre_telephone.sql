-- =====================================================================
-- Numéro de téléphone de l'adhérent
-- =====================================================================
-- Suite 66 (2026-09-12), à la demande de l'utilisateur : « Dans la
-- rubrique adhérent, faire en sorte qu'on puisse également renseigner le
-- numéro de téléphone de l'adhérent. » Simple colonne texte (pas de
-- validation de format imposée — les numéros varient selon le pays/le
-- style de saisie), au même niveau que le courriel.
-- =====================================================================

alter table public.members
  add column if not exists telephone text;

comment on column public.members.telephone is
  'Numéro de téléphone de l''adhérent (texte libre, aucun format imposé). Suite 66 (2026-09-12).';
