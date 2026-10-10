-- =====================================================================
-- Achats groupés : étapes de suivi automatiques (2026-10-10, signalé par
-- l'utilisateur : « devrait marquer livré ou arrivé sur le suivi »)
-- =====================================================================
-- Le suivi d'expédition reflète désormais les étapes de l'achat :
--   commande  → « Commande passée au fournisseur »
--   livre     → « ✅ Livré — marchandise arrivée »
--   cloture   → « Achat clôturé — bilan validé »
-- Rattrapage : les achats déjà arrivés reçoivent leur étape « Livré ».
-- Ré-exécutable sans risque.
-- =====================================================================
create or replace function public.achats_trg_suivi_auto() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare v_etape text; v_note text;
begin
  if new.statut is not distinct from old.statut then return null; end if;
  v_etape := case new.statut
    when 'commande' then 'Commande passée au fournisseur'
    when 'livre' then '✅ Livré — marchandise arrivée'
    when 'cloture' then 'Achat clôturé — bilan validé'
  end;
  if v_etape is null then return null; end if;
  v_note := case new.statut when 'commande' then nullif(trim(coalesce(new.note_commande, '')), '') end;
  if not exists (select 1 from public.achats_suivi where achat_id = new.id and etape = v_etape) then
    insert into public.achats_suivi (achat_id, association_id, etape, lieu, note, auteur_nom)
    values (new.id, new.association_id, v_etape, null, v_note, 'Automatique');
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_achats_suivi_auto on public.achats_groupes;
create trigger trg_achats_suivi_auto after update of statut on public.achats_groupes
  for each row execute function public.achats_trg_suivi_auto();

-- Rattrapage des achats déjà commandés / arrivés / clôturés.
insert into public.achats_suivi (achat_id, association_id, etape, note, auteur_nom, created_at)
select a.id, a.association_id, '✅ Livré — marchandise arrivée', null, 'Automatique', coalesce(a.livre_le, now())
  from public.achats_groupes a
 where a.statut in ('livre', 'cloture')
   and not exists (select 1 from public.achats_suivi s where s.achat_id = a.id and s.etape = '✅ Livré — marchandise arrivée');
insert into public.achats_suivi (achat_id, association_id, etape, note, auteur_nom, created_at)
select a.id, a.association_id, 'Commande passée au fournisseur', a.note_commande, 'Automatique', coalesce(a.commande_le, now())
  from public.achats_groupes a
 where a.statut in ('commande', 'livre', 'cloture')
   and not exists (select 1 from public.achats_suivi s where s.achat_id = a.id and s.etape = 'Commande passée au fournisseur');

-- Vérification :
--   select etape, created_at from public.achats_suivi order by created_at desc limit 5;
