-- =====================================================================
-- Événements : lien de réunion en ligne
-- =====================================================================
-- Suite 60 (2026-09-11), à la demande de l'utilisateur : « j'aimerais
-- aussi qu'il soit possible de faire des réunions en ligne. » Suggestions
-- présentées d'abord (lien externe simple / salle vidéo intégrée Jitsi /
-- solution professionnelle type Daily.co-Twilio) ; l'utilisateur a choisi
-- l'option la plus simple, recommandée en premier : un simple champ
-- « lien de réunion » sur un événement existant, où le Bureau colle un
-- lien déjà créé ailleurs (Zoom, Google Meet, Microsoft Teams, Jitsi...).
-- Aucune nouvelle table, aucun compte tiers à gérer côté application —
-- réutilise entièrement le module Événements déjà en place (échéancier,
-- RSVP, rappels).
-- =====================================================================

alter table public.events
  add column if not exists lien_reunion text;

comment on column public.events.lien_reunion is
  'URL de la réunion en ligne (Zoom, Google Meet, Teams, Jitsi, ou autre) associée à cet événement. NULL = événement en personne uniquement, pas de composante en ligne. Suite 60 (2026-09-11).';

-- Aucune modification de RLS nécessaire : "lien_reunion" est une colonne
-- de plus sur "events", déjà cloisonnée par association_id et déjà
-- modifiable uniquement par le Bureau (policy "events update" existante).
