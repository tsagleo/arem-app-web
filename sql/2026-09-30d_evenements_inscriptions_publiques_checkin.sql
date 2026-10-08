-- =====================================================================
-- Événements — pointage à l'entrée des inscriptions publiques
-- (non-adhérents) — 2026-09-30
-- =====================================================================
-- Complément à sql/2026-09-30_evenements_modernisation.sql (section 8).
-- À la demande de l'utilisateur (« comment gérer les personnes qui ne
-- sont pas adhérentes ? ») : la page publique d'un événement collecte
-- déjà les inscriptions (event_public_registrations), mais rien côté
-- client ne les affichait au Bureau, et rien ne permettait de pointer un
-- visiteur non-adhérent à l'entrée le jour même. Un visiteur public n'a
-- pas de fiche membres (member_id) : il ne peut donc pas recevoir de
-- billet_token via event_rsvps/checkin_event_ticket comme un adhérent.
-- Solution volontairement simple, adaptée à la réalité d'une table
-- d'accueil associative (le Bureau reconnaît le nom sur la liste plutôt
-- que de scanner un code) : deux colonnes de pointage directement sur
-- event_public_registrations, cochées à la main depuis le nouveau
-- panneau « Inscriptions publiques » de Evenements.jsx.
-- =====================================================================

alter table public.event_public_registrations
  add column if not exists checkin_le timestamptz,
  add column if not exists checkin_par uuid references public.profiles(id);

comment on column public.event_public_registrations.checkin_le is
  'Pointage à l''entrée d''un visiteur non-adhérent inscrit via la page publique — coché manuellement par le Bureau (pas de QR : ce visiteur n''a pas de fiche membre, donc pas de billet_token comme un adhérent). NULL tant que non pointé.';

-- Aucune policy RLS supplémentaire nécessaire : la policy "event_public_
-- registrations update bureau" (sql/2026-09-30_evenements_modernisation.sql)
-- couvre déjà toute mise à jour de ligne par le Bureau, y compris ces deux
-- nouvelles colonnes.

-- =====================================================================
-- Vérification rapide après exécution :
--   select checkin_le, checkin_par from public.event_public_registrations limit 1;
-- =====================================================================
