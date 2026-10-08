-- =====================================================================
-- Covoiturage — Phase B : les deux leviers de masse critique
-- =====================================================================
-- Suite de claude/covoiturage-haut-de-gamme-proposition.md. Deux volets :
--   1) Trajets récurrents RÉELLEMENT programmés à l'avance — jusqu'ici,
--      carpool_offers.recurrence (sql/2026-10-06_covoiturage.sql) n'était
--      qu'une étiquette ("hebdomadaire"/"quotidien_ouvrable") sans aucun
--      effet : une offre récurrente ne se renouvelait jamais une fois sa
--      date passée. Ce script ajoute le job qui régénère automatiquement
--      la prochaine occurrence.
--   2) Covoiturage événementiel dédié — AUCUNE nouvelle colonne nécessaire
--      ici : carpool_offers.event_id et carpool_requests.event_id existent
--      déjà (sql/2026-10-06_covoiturage.sql). Ce qui manquait était
--      uniquement l'interface (voir Covoiturage.jsx) pour créer un trajet
--      PRÉ-REMPLI depuis un événement (destination/horaire déjà fixés par
--      l'association) plutôt que de remplir event_id après coup comme une
--      case parmi d'autres — rien à ajouter côté base.
-- =====================================================================

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
-- 1) Régénération automatique des trajets récurrents
-- ---------------------------------------------------------------------
create or replace function public.regenerer_offres_recurrentes()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_offer record;
  v_next timestamptz;
begin
  for v_offer in
    select * from public.carpool_offers
    where recurrence in ('hebdomadaire', 'quotidien_ouvrable')
      and statut = 'active'
      and date_heure < now()
  loop
    v_next := case v_offer.recurrence
      when 'hebdomadaire' then v_offer.date_heure + interval '7 days'
      else v_offer.date_heure + interval '1 day'
    end;
    -- quotidien_ouvrable : saute samedi (isodow 6) et dimanche (isodow 7).
    if v_offer.recurrence = 'quotidien_ouvrable' then
      while extract(isodow from v_next) in (6, 7) loop
        v_next := v_next + interval '1 day';
      end loop;
    end if;
    -- Ne régénère que si l'offre précédente appartient encore à une
    -- association où le module est actif et où le membre n'est pas
    -- suspendu — sinon ce job recréerait silencieusement des offres pour
    -- une association/un membre volontairement bloqué (voir sql/2026-10-
    -- 08d et 2026-10-08e).
    if exists (select 1 from public.associations a where a.id = v_offer.association_id and a.covoiturage_module_actif)
       and not exists (select 1 from public.members m where m.id = v_offer.member_id and m.covoiturage_suspendu) then
      insert into public.carpool_offers (
        association_id, member_id, member_nom, point_depart, point_arrivee, date_heure, recurrence,
        places_disponibles, prix_place, event_id, notes, statut,
        depart_lat, depart_lng, arrivee_lat, arrivee_lng,
        pref_non_fumeur, pref_musique, pref_animaux
      ) values (
        v_offer.association_id, v_offer.member_id, v_offer.member_nom, v_offer.point_depart, v_offer.point_arrivee, v_next, v_offer.recurrence,
        v_offer.places_disponibles, v_offer.prix_place, v_offer.event_id, v_offer.notes, 'active',
        v_offer.depart_lat, v_offer.depart_lng, v_offer.arrivee_lat, v_offer.arrivee_lng,
        v_offer.pref_non_fumeur, v_offer.pref_musique, v_offer.pref_animaux
      );
    end if;
    -- L'occurrence passée est close (historique) qu'elle ait été
    -- régénérée ou non — une offre récurrente ne reste jamais "active"
    -- une fois sa date passée.
    update public.carpool_offers set statut = 'complete' where id = v_offer.id;
  end loop;
end;
$fn$;
comment on function public.regenerer_offres_recurrentes() is
  'Job planifié (quotidien) : pour chaque offre récurrente dont la date est passée, crée automatiquement la prochaine occurrence (hebdomadaire : +7 jours ; quotidien_ouvrable : +1 jour en sautant samedi/dimanche) et clôt l''ancienne — transforme recurrence d''une simple étiquette en un vrai mécanisme de renouvellement.';

select cron.schedule(
  'covoiturage-regenerer-recurrences',
  '0 3 * * *',
  $$select public.regenerer_offres_recurrentes();$$
);

-- =====================================================================
-- Vérification rapide après exécution :
--   select jobname, schedule from cron.job where jobname = 'covoiturage-regenerer-recurrences';
--   -- doit afficher 1 ligne
--   select proname from pg_proc where proname = 'regenerer_offres_recurrentes';
--   -- doit afficher 1 ligne
--
-- Pour tester sans attendre 3h du matin :
--   select public.regenerer_offres_recurrentes();
-- =====================================================================
