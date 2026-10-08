-- =====================================================================
-- Heures décalées avant le correctif fuseau (commits 175f41c, cafcc0b)
-- =====================================================================
-- Avant le 2026-10-08, plusieurs formulaires envoyaient l'heure saisie
-- sans fuseau ; Postgres la lisait comme de l'UTC. Résultat : l'heure
-- affichée = heure saisie − décalage du fuseau (ex. 18 h saisie → 15 h
-- affichée à Halifax, UTC−3). Formulaires concernés :
--   • Événements : création (et sessions du programme)
--   • Élections : création
--   • Covoiturage : création et modification des offres / demandes
--   • Réunions : MODIFICATION seulement (la création était correcte)
-- Les événements créés depuis le fil « Vie associative » étaient corrects.
--
-- On ne peut donc pas savoir automatiquement quelles lignes sont fausses.
-- ÉTAPE 1 (lecture seule) : lister les éléments à venir. Pour une ligne
-- fausse, la colonne « heure_saisie_probable » montre l'heure que la
-- personne avait réellement tapée.
-- ÉTAPE 2 (optionnelle) : corriger uniquement les identifiants choisis.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ÉTAPE 1 — lecture seule, ne modifie rien
-- ---------------------------------------------------------------------
select * from (
  select 'events' as table_name, e.id, e.titre as libelle,
         to_char(e.date_debut at time zone a.fuseau_horaire, 'YYYY-MM-DD HH24:MI') as heure_affichee,
         to_char(e.date_debut at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as heure_saisie_probable
  from public.events e join public.associations a on a.id = e.association_id
  where e.date_debut >= now() - interval '1 day'
  union all
  select 'event_sessions', s.id, s.titre,
         to_char(s.date_debut at time zone a.fuseau_horaire, 'YYYY-MM-DD HH24:MI'),
         to_char(s.date_debut at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
  from public.event_sessions s join public.associations a on a.id = s.association_id
  where s.date_debut >= now() - interval '1 day'
  union all
  select 'elections', el.id, el.titre,
         to_char(el.date_fin at time zone a.fuseau_horaire, 'YYYY-MM-DD HH24:MI') || ' (fermeture)',
         to_char(el.date_fin at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
  from public.elections el join public.associations a on a.id = el.association_id
  where el.date_fin >= now() - interval '1 day'
  union all
  select 'meetings', m.id, m.titre,
         to_char(m.date_heure at time zone a.fuseau_horaire, 'YYYY-MM-DD HH24:MI'),
         to_char(m.date_heure at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
  from public.meetings m join public.associations a on a.id = m.association_id
  where m.date_heure >= now() - interval '1 day'
  union all
  select 'carpool_offers', o.id, o.point_depart || ' → ' || o.point_arrivee,
         to_char(o.date_heure at time zone a.fuseau_horaire, 'YYYY-MM-DD HH24:MI'),
         to_char(o.date_heure at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
  from public.carpool_offers o join public.associations a on a.id = o.association_id
  where o.date_heure >= now() - interval '1 day'
  union all
  select 'carpool_requests', r.id, r.point_depart || ' → ' || r.point_arrivee,
         to_char(r.date_heure at time zone a.fuseau_horaire, 'YYYY-MM-DD HH24:MI'),
         to_char(r.date_heure at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
  from public.carpool_requests r join public.associations a on a.id = r.association_id
  where r.date_heure >= now() - interval '1 day'
) t
order by table_name, heure_affichee;

-- ---------------------------------------------------------------------
-- ÉTAPE 2 — correction ciblée (décommenter, remplacer les identifiants)
-- ---------------------------------------------------------------------
-- Réinterprète l'heure stockée comme l'heure locale de l'association :
-- une ligne affichée 15:00 avec « heure_saisie_probable » 18:00 repasse
-- à 18:00. À n'exécuter QU'UNE FOIS par ligne (une seconde exécution la
-- décalerait de nouveau). Exemple pour des événements :
--
-- update public.events e
--   set date_debut = (e.date_debut at time zone 'UTC') at time zone a.fuseau_horaire
--   from public.associations a
--   where a.id = e.association_id
--     and e.id in ('00000000-0000-0000-0000-000000000000');
--
-- Même modèle pour les autres tables : remplacer « events » et
-- « date_debut » par la table et la colonne voulues (elections : faire
-- date_debut ET date_fin ; meetings, carpool_* : date_heure).
