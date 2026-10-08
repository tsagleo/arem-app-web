-- =====================================================================
-- Comptabilité professionnelle — Correctif du bilan d'ouverture (fonds)
-- Suite 86 (correctif), 2026-09-28. À exécuter APRÈS sql/2026-09-28c_
-- comptabilite_fondations.sql, une seule fois.
-- =====================================================================
--
-- BUG TROUVÉ lors de la première validation en conditions réelles (capture
-- d'écran fournie par l'utilisateur, comparaison Bilan / Bilan simplifié) :
-- dans le bloc de bilan d'ouverture du script précédent, TOUTE l'encaisse
-- d'ouverture était comptabilisée sous le fonds « general », y compris la
-- part qui provient des contributions initiales aux fonds d'urgence et de
-- secours (`members.fonds_urgence_paye`/`fonds_secours_paye`). Résultat
-- observé : l'Actif net par fonds affichait Fonds d'urgence = -15,00 $ et
-- Fonds de secours = -47,00 $ (négatifs, ce qui n'a pas de sens), alors que
-- l'ancien Bilan simplifié donnait 65,00 $ et 553,00 $. Écart exact :
-- -15 + 80 (contribution urgence) = 65 ; -47 + 600 (contribution secours)
-- = 553 — confirme que la contrepartie en encaisse de ces contributions
-- avait été comptée dans le mauvais fonds (le TOTAL du Bilan, lui, restait
-- juste — seule la RÉPARTITION par fonds était fausse).
--
-- Autre écart normal, PAS un bug : le nouveau Bilan inclut désormais aussi
-- les encaissements de Cotisation et Collation dans l'encaisse — l'ancien
-- « Bilan simplifié » (formule JS du tableau de bord) ne les a jamais
-- inclus dans son « Fonds général », un angle mort déjà existant avant ce
-- chantier. Le nouveau Bilan est donc plus complet, pas plus grand par
-- erreur — c'est attendu si votre association a des séances de
-- Cotisation/Collation déjà réglées.
--
-- CORRECTIF : sql/2026-09-28c_comptabilite_fondations.sql a été mis à jour
-- sur votre ordinateur avec la même correction (pour toute association
-- future qui n'aurait pas encore d'écritures) — mais comme le grand livre
-- de votre association existe déjà (généré une première fois avec le
-- bug), ce script-ci (1) l'efface pour repartir de zéro, puis (2) le
-- régénère avec le calcul corrigé, par fonds. Sans danger : le grand livre
-- est entièrement RE-DÉRIVÉ à partir de vos données réelles (adhérents,
-- dons, prêts, dépenses...), rien de ces données réelles n'est touché ni
-- perdu — seul le grand livre comptable (une reconstruction) est effacé
-- puis reconstruit. Peut être relancé sans risque si besoin.

delete from public.ecritures_comptables;

do $$
declare
  v_assoc record;
  v_date_depart date := '2026-01-01';
  v_lignes jsonb;
  v_row record;
  v_montant_inscription numeric;
  v_montant_urgence numeric;
  v_montant_secours numeric;
  v_montant_tontine numeric;
  v_montant_collation numeric;
  v_dons_avant numeric;
  v_prets_avant numeric;
  v_remb_avant numeric;
  v_dep_urgence_avant numeric;
  v_dep_secours_avant numeric;
  v_rec_urgence_avant numeric;
  v_rec_secours_avant numeric;
  v_net_general numeric;
  v_net_urgence numeric;
  v_net_secours numeric;
begin
  for v_assoc in select id from public.associations loop
    continue when exists (select 1 from public.ecritures_comptables where association_id = v_assoc.id);

    select coalesce(sum(inscription_paye), 0), coalesce(sum(fonds_urgence_paye), 0), coalesce(sum(fonds_secours_paye), 0)
      into v_montant_inscription, v_montant_urgence, v_montant_secours
      from public.members where association_id = v_assoc.id;

    select coalesce(sum(tp.montant), 0) into v_montant_tontine
      from public.tontine_presences tp join public.members m on m.id = tp.member_id
      where m.association_id = v_assoc.id;

    select coalesce(sum(cp.montant), 0) into v_montant_collation
      from public.collation_presences cp join public.members m on m.id = cp.member_id
      where m.association_id = v_assoc.id;

    select coalesce(sum(montant), 0) into v_dons_avant from public.donations
      where association_id = v_assoc.id and date < v_date_depart;
    select coalesce(sum(montant_pret), 0) into v_prets_avant from public.loans
      where association_id = v_assoc.id and date_pret < v_date_depart;
    select coalesce(sum(montant), 0) into v_remb_avant from public.loan_repayments
      where association_id = v_assoc.id and date < v_date_depart;
    select coalesce(sum(montant), 0) into v_dep_urgence_avant from public.fonds_depenses
      where association_id = v_assoc.id and fonds = 'urgence' and date < v_date_depart;
    select coalesce(sum(montant), 0) into v_dep_secours_avant from public.fonds_depenses
      where association_id = v_assoc.id and fonds = 'secours' and date < v_date_depart;
    select coalesce(sum(fr.quote_part), 0) into v_rec_urgence_avant
      from public.fonds_recouvrements fr join public.fonds_depenses fd on fd.id = fr.depense_id
      where fr.association_id = v_assoc.id and fd.fonds = 'urgence' and fr.paye = true and fr.date_paiement < v_date_depart;
    select coalesce(sum(fr.quote_part), 0) into v_rec_secours_avant
      from public.fonds_recouvrements fr join public.fonds_depenses fd on fd.id = fr.depense_id
      where fr.association_id = v_assoc.id and fd.fonds = 'secours' and fr.paye = true and fr.date_paiement < v_date_depart;

    -- Encaisse d'ouverture, calculée SÉPARÉMENT par fonds (et non globalement
    -- puis étiquetée "general") : chaque dollar d'encaisse doit porter le
    -- même fonds que sa contrepartie produit/charge, sinon l'Actif net par
    -- fonds (l'écran Bilan) ne reflète plus le vrai patrimoine de chaque
    -- fonds — bug identifié le 2026-09-28 lors de la première validation en
    -- conditions réelles (voir sql/2026-09-28d_comptabilite_correctif_fonds_ouverture.sql).
    v_net_general := v_montant_inscription + v_montant_tontine + v_montant_collation
      + v_dons_avant + v_remb_avant - v_prets_avant;
    v_net_urgence := v_montant_urgence + v_rec_urgence_avant - v_dep_urgence_avant;
    v_net_secours := v_montant_secours + v_rec_secours_avant - v_dep_secours_avant;

    v_lignes := '[]'::jsonb;
    -- Actifs d'ouverture
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '1200', 'fonds', 'general',
      'debit', greatest(v_prets_avant - v_remb_avant, 0), 'credit', 0));
    -- Équilibre : Encaisse = tout ce qui est entré moins tout ce qui est sorti avant le 1er janvier 2026,
    -- une ligne par fonds (general/urgence/secours) pour que chaque fonds porte sa propre part d'encaisse.
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '1000', 'fonds', 'general',
      'debit', greatest(v_net_general, 0), 'credit', greatest(-v_net_general, 0)));
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '1000', 'fonds', 'urgence',
      'debit', greatest(v_net_urgence, 0), 'credit', greatest(-v_net_urgence, 0)));
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '1000', 'fonds', 'secours',
      'debit', greatest(v_net_secours, 0), 'credit', greatest(-v_net_secours, 0)));
    -- Produits/charges d'ouverture (contrepartie)
    if v_montant_inscription <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4000', 'fonds', 'general', 'debit', 0, 'credit', v_montant_inscription)); end if;
    if v_montant_urgence <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4400', 'fonds', 'urgence', 'debit', 0, 'credit', v_montant_urgence)); end if;
    if v_montant_secours <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4500', 'fonds', 'secours', 'debit', 0, 'credit', v_montant_secours)); end if;
    if v_montant_tontine <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4100', 'fonds', 'general', 'debit', 0, 'credit', v_montant_tontine)); end if;
    if v_montant_collation <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4200', 'fonds', 'general', 'debit', 0, 'credit', v_montant_collation)); end if;
    if v_dons_avant <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4300', 'fonds', 'general', 'debit', 0, 'credit', v_dons_avant)); end if;
    if v_rec_urgence_avant <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4410', 'fonds', 'urgence', 'debit', 0, 'credit', v_rec_urgence_avant)); end if;
    if v_rec_secours_avant <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '4510', 'fonds', 'secours', 'debit', 0, 'credit', v_rec_secours_avant)); end if;
    if v_dep_urgence_avant <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '5400', 'fonds', 'urgence', 'debit', v_dep_urgence_avant, 'credit', 0)); end if;
    if v_dep_secours_avant <> 0 then v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', '5500', 'fonds', 'secours', 'debit', v_dep_secours_avant, 'credit', 0)); end if;

    perform public.poster_ecriture(v_assoc.id, v_date_depart, v_lignes,
      'Bilan d''ouverture au 1er janvier 2026', 'bilan_ouverture', v_assoc.id);

    -- Rejeu des transactions DATÉES déjà enregistrées à partir du 1er
    -- janvier 2026 (avec leur vraie date, pour un Bilan et un futur État
    -- des résultats 2026 précis dès le premier exercice).
    for v_row in select * from public.donations where association_id = v_assoc.id and date >= v_date_depart loop
      perform public.poster_ecriture_signee(v_assoc.id, v_row.date, '1000', '4300', 'general',
        v_row.montant, 'Don reçu — ' || coalesce(v_row.donateur_nom, '—'), 'donations', v_row.id);
    end loop;
    for v_row in select * from public.loans where association_id = v_assoc.id and date_pret >= v_date_depart loop
      perform public.poster_ecriture_signee(v_assoc.id, v_row.date_pret, '1200', '1000', 'general',
        v_row.montant_pret, 'Prêt accordé', 'loans', v_row.id);
    end loop;
    for v_row in select * from public.loan_repayments where association_id = v_assoc.id and date >= v_date_depart loop
      perform public.poster_ecriture_signee(v_assoc.id, v_row.date, '1000', '1200', 'general',
        v_row.montant, 'Remboursement de prêt reçu', 'loan_repayments', v_row.id);
    end loop;
    for v_row in select * from public.fonds_depenses where association_id = v_assoc.id and date >= v_date_depart loop
      perform public.poster_ecriture_signee(v_assoc.id, v_row.date,
        case when v_row.fonds = 'urgence' then '5400' else '5500' end, '1000', v_row.fonds,
        v_row.montant, 'Dépense — ' || coalesce(v_row.description, v_row.fonds), 'fonds_depenses', v_row.id);
    end loop;
    for v_row in
      select fr.*, fd.fonds as fonds_type from public.fonds_recouvrements fr
      join public.fonds_depenses fd on fd.id = fr.depense_id
      where fr.association_id = v_assoc.id and fr.paye = true and fr.date_paiement >= v_date_depart
    loop
      perform public.poster_ecriture_signee(v_assoc.id, v_row.date_paiement, '1000',
        case when v_row.fonds_type = 'urgence' then '4410' else '4510' end, v_row.fonds_type,
        v_row.quote_part, 'Quote-part réglée — Fonds ' || v_row.fonds_type, 'fonds_recouvrements', v_row.id);
    end loop;
  end loop;
end;
$$;
