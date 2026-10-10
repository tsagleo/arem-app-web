-- =====================================================================
-- Achats groupés : séparation des tâches (2026-10-10, revue de conformité
-- demandée par l'utilisateur)
-- =====================================================================
-- Bonne pratique de contrôle interne : celui qui OPÈRE (le porteur) ne
-- VALIDE pas. Désormais :
--   • le porteur ne valide ni les paiements ni le bilan de son achat ;
--   • personne ne valide son propre paiement (déjà en place) ;
--   • personne ne valide ce qu'il a lui-même reçu ou saisi (déjà en place) ;
--   • le nom de la personne qui a validé le bilan est conservé.
-- Fonctions reprises à l'identique de leur dernière version (10t, 09e),
-- seules les vérifications ci-dessus sont ajoutées. Ré-exécutable.
-- =====================================================================
alter table public.achats_groupes add column if not exists bilan_valide_par_nom text;

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
  -- Séparation des tâches : le porteur (qui opère l'achat) ne valide pas.
  if v_m.achat_id is not null and public.achats_est_porteur(v_m.achat_id) then
    raise exception 'Séparation des tâches : le porteur de l''achat ne valide pas les paiements. Un autre membre du bureau doit le faire.';
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

create or replace function public.achats_valider_bilan(p_id uuid, p_accord text default null) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_total numeric;
  v_max_depassement numeric;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_a.statut not in ('commande', 'livre') then raise exception 'Ce bilan ne peut pas être validé à ce stade.'; end if;
  if v_a.bilan_saisi_par is null then raise exception 'Le bilan n''a pas encore été saisi.'; end if;
  if public.achats_est_porteur(p_id) then
    raise exception 'Séparation des tâches : le porteur de l''achat ne valide pas son bilan. Un autre membre du bureau doit le faire.';
  end if;
  if v_a.bilan_saisi_par = auth.uid() then
    raise exception 'Double contrôle : le bilan doit être validé par un autre membre du bureau que celui qui l''a saisi.';
  end if;
  if v_a.total_attribue <= 0 then raise exception 'Aucune quantité attribuée.'; end if;

  v_total := v_a.cout_reel_produits + v_a.frais_communs_reels;

  -- Complément demandé à chacun, en % de sa part estimée : plafonné à
  -- 10 % sauf accord (consigné).
  select coalesce(max(case when s.montant_du > 0
                           then (round(v_total * s.quantite_attribuee / v_a.total_attribue, 2) - s.montant_du) / s.montant_du * 100
                           else 0 end), 0)
    into v_max_depassement
    from public.achats_souscriptions s where s.achat_id = p_id and s.statut = 'retenu';
  if v_max_depassement > v_a.plafond_complement_pct and coalesce(trim(p_accord), '') = '' then
    raise exception 'Le coût réel dépasse la part estimée de % %% (plafond : % %%). Indiquez l''accord obtenu des membres pour valider.',
      round(v_max_depassement, 1), v_a.plafond_complement_pct;
  end if;

  -- Coût réel (produits + frais communs) réparti au prorata des quantités.
  update public.achats_souscriptions s
     set part_reelle = round(v_total * s.quantite_attribuee / v_a.total_attribue, 2), updated_at = now()
   where s.achat_id = p_id and s.statut = 'retenu';

  update public.achats_groupes set statut = 'cloture', cloture_le = now(), bilan_valide_par = auth.uid(), bilan_valide_le = now(), bilan_valide_par_nom = public.achats_nom_courant(),
         accord_depassement = nullif(trim(p_accord), '')
   where id = p_id;

  -- Paiement du fournisseur et des frais, depuis le compte dédié.
  perform public.poster_ecriture_signee(v_a.association_id, current_date, '2100', '1050', 'general', v_total,
    'Achat groupé « ' || v_a.titre || ' » — fournisseur et frais communs (coût réel)', 'achats_groupes', v_a.id);

  perform public.achats_notifier(p_id, v_a.titre,
    'Bilan validé : consultez votre relevé (remboursement, avoir ou complément éventuel).');
end;
$fn$;

-- Vérification :
--   select count(*) from pg_proc where proname in ('achats_valider_mouvement', 'achats_valider_bilan') and prosrc like '%Séparation des tâches%';  -- 2
