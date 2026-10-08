-- =====================================================================
-- Script de TEST — rattacher votre compte à une deuxième association
-- (2026-10-06)
--
-- Objectif : ajouter une ligne dans association_memberships pour que
-- votre compte de connexion apparaisse membre de DEUX associations à la
-- fois (ex. votre association principale + "ACA"). C'est ce qui fait
-- apparaître le sélecteur d'association dans la sidebar — il reste
-- invisible tant qu'il n'y a qu'une seule ligne par compte, par design
-- (voir claude/architecture-multi-association.md, section 8).
--
-- Sans danger : ce script n'ajoute qu'une ligne de données de test, ne
-- touche à aucune table/politique, et peut être annulé en supprimant
-- cette seule ligne (requête de nettoyage tout en bas).
--
-- MODE D'EMPLOI :
--   1. Exécutez d'abord la PARTIE 1 (lecture seule) pour retrouver :
--      - l'adresse courriel du compte avec lequel vous vous connectez,
--      - le nom exact de la deuxième association ("ACA" ou autre).
--   2. Remplacez les deux valeurs marquées <-- à remplacer dans la
--      PARTIE 2 par ces vraies valeurs.
--   3. Exécutez la PARTIE 2, puis rechargez l'application connecté avec
--      ce compte : le sélecteur doit apparaître sous le nom de
--      l'association dans la sidebar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PARTIE 1 — Lecture seule : identifiez votre compte et vos associations
-- ---------------------------------------------------------------------
select u.email, p.id as profile_id, p.role, p.association_id as association_actuelle,
       a.nom as nom_association_actuelle
from auth.users u
join public.profiles p on p.id = u.id
left join public.associations a on a.id = p.association_id
order by u.email;

select id as association_id, nom from public.associations order by nom;

-- ---------------------------------------------------------------------
-- PARTIE 2 — Insertion : remplissez les deux valeurs ci-dessous avec les
-- résultats de la PARTIE 1, puis exécutez.
-- ---------------------------------------------------------------------
insert into public.association_memberships (profile_id, association_id, role)
select u.id, a.id, 'bureau_president'  -- rôle à appliquer pour CETTE association ; changez si besoin
from auth.users u, public.associations a
where u.email = 'EMAIL_DE_VOTRE_COMPTE'        -- <-- à remplacer
  and a.nom = 'NOM_DE_LA_DEUXIEME_ASSOCIATION' -- <-- à remplacer (ex. 'ACA')
on conflict (profile_id, association_id) do nothing
returning *;

-- Une ligne renvoyée = c'est fait. Rien renvoyé = soit l'email ou le nom
-- d'association ne correspond à rien (revérifiez l'orthographe exacte
-- via la PARTIE 1 ci-dessus), soit la ligne existe déjà.

-- ---------------------------------------------------------------------
-- NETTOYAGE (optionnel, à garder pour plus tard) — pour retirer cette
-- appartenance de test une fois les essais terminés, si vous le
-- souhaitez. Ne pas exécuter maintenant.
-- ---------------------------------------------------------------------
-- delete from public.association_memberships
-- using auth.users u, public.associations a
-- where association_memberships.profile_id = u.id
--   and association_memberships.association_id = a.id
--   and u.email = 'EMAIL_DE_VOTRE_COMPTE'
--   and a.nom = 'NOM_DE_LA_DEUXIEME_ASSOCIATION';

-- Fin du script.
