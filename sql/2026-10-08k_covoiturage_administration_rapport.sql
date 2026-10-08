-- =====================================================================
-- Covoiturage — Cycle de vie des signalements (panneau d'administration)
-- =====================================================================
-- Suite de claude/covoiturage-administration-rapport-proposition.md,
-- approuvée par l'utilisateur le 2026-10-08. carpool_incidents (sql/2026-
-- 10-07_covoiturage_dispatch_sophistique.sql) n'était jusqu'ici qu'écrit
-- par les membres et jamais lu par personne côté interface — le bureau
-- était notifié ponctuellement mais n'avait aucun endroit où retrouver
-- un signalement ensuite. Ce script ajoute un vrai cycle de vie, inspiré
-- des pratiques des plateformes de transport/flotte sérieuses :
-- ouvert → traité, avec qui l'a traité, quand, et une note de résolution.
-- =====================================================================

alter table public.carpool_incidents add column if not exists statut text not null default 'ouvert'
  check (statut in ('ouvert', 'traite'));
alter table public.carpool_incidents add column if not exists traite_par uuid references public.profiles(id) on delete set null;
alter table public.carpool_incidents add column if not exists traite_le timestamptz;
alter table public.carpool_incidents add column if not exists note_resolution text;
comment on column public.carpool_incidents.statut is
  'Cycle de vie du signalement : ouvert (par défaut, à la création) ou traite (après action du bureau via traiter_signalement_covoiturage) — permet au panneau d''administration de toujours savoir ce qui reste à traiter.';

create or replace function public.traiter_signalement_covoiturage(p_incident_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_bureau() then
    raise exception 'Seul le bureau peut marquer un signalement comme traité.';
  end if;
  update public.carpool_incidents set
    statut = 'traite',
    traite_par = auth.uid(),
    traite_le = now(),
    note_resolution = p_note
  where id = p_incident_id and association_id = public.current_association_id();
  if not found then
    raise exception 'Signalement introuvable.';
  end if;
end;
$fn$;
grant execute on function public.traiter_signalement_covoiturage(uuid, text) to authenticated;
comment on function public.traiter_signalement_covoiturage(uuid, text) is
  'Le bureau marque un signalement covoiturage comme traité, avec une note de résolution facultative — réservé au bureau (is_bureau()).';

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns
--   where table_name = 'carpool_incidents' and column_name in ('statut','traite_par','traite_le','note_resolution');
--   -- doit afficher 4 lignes
--   select proname from pg_proc where proname = 'traiter_signalement_covoiturage';
--   -- doit afficher 1 ligne
-- =====================================================================
