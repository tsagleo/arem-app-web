-- =====================================================================
-- Écriture comptable des billets : appliquer le tarif adhérent
-- (corrige ecr_trg_event_tickets de 2026-09-28g_billet_evenement.sql)
-- =====================================================================
-- Problème corrigé : à la confirmation d'une inscription (event_rsvps,
-- toujours un ADHÉRENT), le déclencheur comptabilisait events.prix — le
-- plein tarif — même quand l'événement avait un tarif adhérent
-- (events.prix_membre, ajouté le 2026-09-30). Conséquences :
--   • recette surévaluée quand l'adhérent payait le tarif réduit ;
--   • recette FICTIVE au plein tarif quand le tarif adhérent était 0 $
--     (l'adhérent confirme sa participation sans rien payer).
-- Le paiement par carte (create-checkout-session) appliquait déjà
-- coalesce(prix_membre, prix) ; l'écriture suit maintenant la même règle.
--
-- Ré-exécutable sans risque. Ne corrige PAS les écritures déjà passées :
-- voir la requête de vérification en bas.
-- =====================================================================

create or replace function public.ecr_trg_event_tickets() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prix numeric;
  v_assoc uuid;
  v_titre text;
begin
  if NEW.statut <> 'confirme' then return NEW; end if;
  select coalesce(prix_membre, prix), association_id, titre into v_prix, v_assoc, v_titre
    from public.events where id = NEW.event_id;
  if v_assoc is null or not (coalesce(v_prix, 0) > 0) then return NEW; end if;
  if exists (select 1 from public.ecritures_comptables where source_table = 'event_rsvps' and source_id = NEW.id) then
    return NEW;
  end if;
  perform public.poster_ecriture_signee(
    v_assoc, current_date, '1000', '4700', 'general',
    v_prix, 'Billet — ' || coalesce(v_titre, ''), 'event_rsvps', NEW.id
  );
  return NEW;
end;
$$;

-- ---------------------------------------------------------------------
-- Vérification (lecture seule) : écritures de billets passées au plein
-- tarif alors qu'un tarif adhérent différent existait. Chaque ligne
-- listée est à corriger à la main dans la comptabilité.
-- ---------------------------------------------------------------------
-- select e.titre, e.prix, e.prix_membre, ec.*
--   from public.ecritures_comptables ec
--   join public.event_rsvps r on r.id = ec.source_id
--   join public.events e on e.id = r.event_id
--  where ec.source_table = 'event_rsvps'
--    and e.prix_membre is not null and e.prix_membre <> e.prix;
