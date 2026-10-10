-- =====================================================================
-- Achats groupés : personne ne valide son propre paiement (2026-10-10,
-- constaté pendant les tests : un membre du bureau avait validé son
-- propre versement Interac).
-- =====================================================================
-- achats_valider_mouvement() reprise de sql/2026-10-09e ; ajout d'un seul
-- contrôle : le valideur ne peut pas être le membre concerné par le
-- mouvement (en plus de ne pas être celui qui l'a reçu).
-- Ré-exécutable sans risque.
-- =====================================================================
create or replace function public.achats_valider_mouvement(p_mvt uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_m public.achats_mouvements;
  v_titre text;
begin
  select * into v_m from public.achats_mouvements where id = p_mvt for update;
  if v_m.id is null or v_m.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_m.statut <> 'recu' then raise exception 'Ce mouvement doit d''abord être confirmé « reçu » par le porteur.'; end if;
  -- 2026-10-10 : on ne valide jamais son propre paiement.
  if v_m.member_id = public.current_member_id() then
    raise exception 'Conflit d''intérêts : vous ne pouvez pas valider votre propre paiement. Un autre membre du bureau doit le faire.';
  end if;
  if v_m.recu_par = auth.uid() then
    raise exception 'Double contrôle : la validation doit être faite par un autre membre du bureau que celui qui a reçu l''argent.';
  end if;

  update public.achats_mouvements set statut = 'valide', valide_par = auth.uid(), valide_par_nom = public.achats_nom_courant(), valide_le = now()
   where id = p_mvt;

  select a.titre into v_titre from public.achats_groupes a where a.id = v_m.achat_id;
  if v_m.sens = 'entree' and v_m.mode <> 'avoir' then
    perform public.poster_ecriture_signee(v_m.association_id, current_date, '1050', '2100', 'general', v_m.montant,
      'Achat groupé « ' || coalesce(v_titre, '') || ' » — versement de ' || coalesce(v_m.member_nom, ''), 'achats_mouvements', v_m.id);
  elsif v_m.sens = 'sortie' then
    perform public.poster_ecriture_signee(v_m.association_id, current_date, '2100', '1050', 'general', v_m.montant,
      'Achat groupé « ' || coalesce(v_titre, '') || ' » — remboursement à ' || coalesce(v_m.member_nom, ''), 'achats_mouvements', v_m.id);
  end if;
end;
$fn$;

-- Vérification :
--   select prosrc like '%Conflit d%' from pg_proc where proname = 'achats_valider_mouvement';  -- true
