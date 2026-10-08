-- =====================================================================
-- Sexe de l'adhérent (Masculin / Féminin)
-- =====================================================================
-- Suite 73 (2026-09-21), à la demande directe de l'utilisateur : « Partout
-- où il se doit, il faut intégrer le volet de distinction des adhérents
-- par sexe. Mettre une rubrique de choix... pour sélectionner le sexe
-- masculin ou féminin. » Même patron que le numéro de téléphone (suite 66,
-- sql/2026-09-12d_membre_telephone.sql) : champ optionnel, aucune valeur
-- par défaut imposée, pour ne rien casser sur les fiches déjà existantes.
--
-- Stocké comme deux valeurs codées ('M'/'F') plutôt qu'en texte libre, avec
-- une contrainte de vérification, pour garder un choix fermé cohérent avec
-- la demande ("sélectionner... masculin ou féminin") plutôt qu'une saisie
-- libre qui pourrait varier d'une fiche à l'autre.
-- =====================================================================

alter table public.members
  add column if not exists sexe text check (sexe in ('M', 'F'));

comment on column public.members.sexe is
  'Sexe de l''adhérent : ''M'' (masculin) ou ''F'' (féminin). Optionnel — NULL si non renseigné. Suite 73 (2026-09-21).';
