-- =====================================================================
-- Achats groupés : seul le PORTEUR pilote son achat (2026-10-10,
-- demandé par l'utilisateur après analyse des droits)
-- =====================================================================
-- Avant : tout membre du bureau pouvait modifier, clôturer, commander,
-- annuler, retenir un devis, accepter des demandes (y compris la sienne)…
-- sur un achat qu'il ne porte pas.
-- Désormais :
--   • le PORTEUR de l'achat (ou, à défaut de porteur désigné, son auteur
--     ou le/la président(e)) est seul à agir : modification, sondage,
--     devis, ouverture, accès, clôture, encaissement, commande, arrivée,
--     remise, créneaux, suivi, facture, bilan, annulation ;
--   • les AUTRES membres du bureau gardent un rôle de CONTRÔLE : ils
--     voient tout et valident les paiements et le bilan (double contrôle),
--     et valident les propositions des membres ;
--   • personne ne statue sur sa propre demande de participation ;
--   • les devis sont figés dès qu'un membre a souscrit ;
--   • si le porteur est indisponible, le/la président(e) peut désigner un
--     nouveau porteur (achats_changer_porteur), avec trace au journal.
-- Chaque fonction ci-dessous est reprise À L'IDENTIQUE de sa dernière
-- version ; seule la vérification d'autorisation change.
-- Prérequis : 2026-10-09e, 10o, 10p, 10q. Ré-exécutable.
-- =====================================================================

create or replace function public.achats_est_porteur(p_achat uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.achats_groupes a
     where a.id = p_achat and a.association_id = public.current_association_id()
       and (
         (a.porteur_member_id is not null and a.porteur_member_id = public.current_member_id())
         or (a.porteur_member_id is null and (a.propose_par = auth.uid()
               or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('bureau_president', 'super_admin'))))
       )
  )
$fn$;
grant execute on function public.achats_est_porteur(uuid) to authenticated;

-- Soupape de sécurité : le/la président(e) désigne un nouveau porteur.
create or replace function public.achats_changer_porteur(p_id uuid, p_member uuid, p_motif text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; v_nom text;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id()
     or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('bureau_president', 'super_admin')) then
    raise exception 'Seul(e) le/la président(e) peut changer le porteur d''un achat.';
  end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Motif requis.'; end if;
  select nom into v_nom from public.members where id = p_member and association_id = v_a.association_id;
  if v_nom is null then raise exception 'Membre introuvable.'; end if;
  update public.achats_groupes set porteur_member_id = p_member, porteur_nom = v_nom where id = p_id;
  insert into public.activity_log (association_id, user_id, user_nom, action, table_name, record_id, details)
  values (v_a.association_id, auth.uid(), public.achats_nom_courant(), 'UPDATE', 'achats_groupes', p_id,
          jsonb_build_object('ancien', jsonb_build_object('porteur', v_a.porteur_nom), 'nouveau', jsonb_build_object('porteur', v_nom), 'motif', trim(p_motif)));
end;
$fn$;
grant execute on function public.achats_changer_porteur(uuid, uuid, text) to authenticated;

-- achats_annuler
create or replace function public.achats_annuler(p_id uuid, p_motif text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Seul le porteur de cet achat peut faire cette action.'; end if;
  if v_a.statut in ('cloture', 'annule', 'refuse') then raise exception 'Cet achat ne peut plus être annulé.'; end if;
  if v_a.statut in ('commande', 'livre') then raise exception 'La commande est passée : faites le bilan plutôt qu''une annulation.'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Motif requis.'; end if;
  update public.achats_groupes set statut = 'annule', motif = trim(p_motif), annule_le = now() where id = p_id;
  perform public.achats_notifier(p_id, v_a.titre, 'Achat annulé : ' || trim(p_motif) || '. Tout montant déjà versé vous sera remboursé.');
end;
$fn$;

-- achats_cloturer
create or replace function public.achats_cloturer(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_total numeric;
  v_stock numeric;
  v_reste numeric;
  v_entier boolean;
  v_part numeric;
  v_s record;
  v_tirage public.tirages;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'ouvert' then raise exception 'Les souscriptions de cet achat ne sont pas ouvertes.'; end if;

  select coalesce(sum(quantite_demandee), 0) into v_total
    from public.achats_souscriptions where achat_id = p_id and statut = 'inscrit';

  -- Seuil non atteint : l'achat est annulé, personne ne paie.
  if v_total < v_a.seuil_min then
    update public.achats_groupes set statut = 'annule', annule_le = now(),
           motif = 'Seuil minimum non atteint (' || v_total || ' / ' || v_a.seuil_min || ').'
     where id = p_id;
    update public.achats_souscriptions set statut = 'non_retenu', quantite_attribuee = 0, updated_at = now()
     where achat_id = p_id and statut = 'inscrit';
    perform public.achats_recalculer(p_id);
    perform public.achats_notifier(p_id, v_a.titre, 'Seuil minimum non atteint : l''achat est annulé, vous n''avez rien à payer.');
    return 'annule';
  end if;

  v_entier := v_a.unite in ('piece', 'lot');
  v_stock := coalesce(v_a.stock_max, v_total);

  if v_total <= v_stock then
    -- Assez pour tout le monde.
    update public.achats_souscriptions set quantite_attribuee = quantite_demandee, statut = 'retenu', updated_at = now()
     where achat_id = p_id and statut = 'inscrit';
  elsif v_a.mode_repartition = 'prorata' then
    -- Chacun reçoit la même proportion de sa demande (arrondie vers le
    -- bas), le reliquat va ensuite un par un dans l'ordre d'arrivée.
    update public.achats_souscriptions
       set quantite_attribuee = case when v_entier then floor(quantite_demandee * v_stock / v_total)
                                     else floor(quantite_demandee * v_stock / v_total * 1000) / 1000 end
     where achat_id = p_id and statut = 'inscrit';
    select v_stock - coalesce(sum(quantite_attribuee), 0) into v_reste
      from public.achats_souscriptions where achat_id = p_id and statut = 'inscrit';
    for v_s in select id, quantite_demandee, quantite_attribuee from public.achats_souscriptions
                where achat_id = p_id and statut = 'inscrit' order by created_at loop
      exit when v_reste <= 0;
      v_part := least(v_reste, v_s.quantite_demandee - v_s.quantite_attribuee, case when v_entier then 1 else v_reste end);
      if v_part > 0 then
        update public.achats_souscriptions set quantite_attribuee = quantite_attribuee + v_part where id = v_s.id;
        v_reste := v_reste - v_part;
      end if;
    end loop;
  else
    -- Premier arrivé, ou ordre du tirage au sort vérifiable.
    if v_a.mode_repartition = 'tirage' then
      select * into v_tirage from public.tirages where id = v_a.tirage_id;
      if (v_tirage.id is null or v_tirage.statut <> 'termine')
         and (select count(*) from public.achats_souscriptions where achat_id = p_id and statut = 'inscrit') > 1 then
        raise exception 'Stock insuffisant : faites d''abord le tirage au sort (bouton « Préparer le tirage ») et menez-le jusqu''au bout dans la rubrique Tirages au sort.';
      end if;
    end if;
    update public.achats_souscriptions set quantite_attribuee = 0 where achat_id = p_id and statut = 'inscrit';
    v_reste := v_stock;
    for v_s in
      select s.id, s.quantite_demandee
        from public.achats_souscriptions s
        left join lateral (
          select (r->>'position')::int as pos
            from jsonb_array_elements(coalesce(v_tirage.resultat, '[]'::jsonb)) r
           where r->>'member_id' = s.member_id::text
        ) t on true
       where s.achat_id = p_id and s.statut = 'inscrit'
       order by case when v_a.mode_repartition = 'tirage' then coalesce(t.pos, 1000000) else 0 end, s.created_at
    loop
      exit when v_reste <= 0;
      v_part := least(v_reste, v_s.quantite_demandee);
      update public.achats_souscriptions set quantite_attribuee = v_part where id = v_s.id;
      v_reste := v_reste - v_part;
    end loop;
  end if;

  update public.achats_souscriptions
     set statut = case when quantite_attribuee > 0 then 'retenu' else 'non_retenu' end, updated_at = now()
   where achat_id = p_id and statut = 'inscrit';

  perform public.achats_recalculer(p_id);
  select * into v_a from public.achats_groupes where id = p_id;

  -- Part estimée : prix de gros × quantité + frais estimés au prorata.
  update public.achats_souscriptions s
     set montant_du = round(s.quantite_attribuee * v_a.prix_unitaire
                            + case when v_a.total_attribue > 0 then v_a.frais_estimes * s.quantite_attribuee / v_a.total_attribue else 0 end, 2)
   where s.achat_id = p_id and s.statut = 'retenu';

  update public.achats_groupes set statut = 'confirme' where id = p_id;
  perform public.achats_notifier(p_id, v_a.titre, 'Seuil atteint : la commande est confirmée. Payez votre part pour qu''elle soit passée.');
  return 'confirme';
end;
$fn$;

-- achats_confirmer_reception
create or replace function public.achats_confirmer_reception(p_mvt uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_m public.achats_mouvements;
begin
  select * into v_m from public.achats_mouvements where id = p_mvt for update;
  if v_m.id is null or v_m.association_id <> public.current_association_id() or v_m.achat_id is null
     or not public.achats_est_porteur(v_m.achat_id) then raise exception 'Non autorisé.'; end if;
  if v_m.statut <> 'declare' then raise exception 'Ce paiement a déjà été traité.'; end if;
  update public.achats_mouvements set statut = 'recu', recu_par = auth.uid(), recu_par_nom = public.achats_nom_courant(), recu_le = now()
   where id = p_mvt;
end;
$fn$;

-- achats_enregistrer_mouvement
create or replace function public.achats_enregistrer_mouvement(
  p_achat uuid, p_member uuid, p_sens text, p_montant numeric, p_mode text, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_nom text;
  v_id uuid;
begin
  select * into v_a from public.achats_groupes where id = p_achat;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_achat) then raise exception 'Non autorisé.'; end if;
  if p_sens not in ('entree', 'sortie') then raise exception 'Sens invalide.'; end if;
  if p_mode not in ('interac', 'especes', 'virement') then raise exception 'Mode invalide.'; end if;
  if p_montant is null or p_montant <= 0 then raise exception 'Montant invalide.'; end if;
  select s.member_nom into v_nom from public.achats_souscriptions s where s.achat_id = p_achat and s.member_id = p_member;
  if v_nom is null then raise exception 'Ce membre n''a pas souscrit à cet achat.'; end if;
  if p_sens = 'sortie' and p_montant > public.achats_solde(p_achat, p_member) - public.achats_sorties_en_attente(p_achat, p_member) then
    raise exception 'Le remboursement dépasse ce que l''association doit à ce membre.';
  end if;

  insert into public.achats_mouvements (association_id, achat_id, member_id, member_nom, sens, objet, mode, montant, note,
                                        statut, declare_par, recu_par, recu_par_nom, recu_le)
  values (v_a.association_id, p_achat, p_member, v_nom, p_sens,
          case when p_sens = 'sortie' then 'remboursement' when v_a.statut = 'cloture' then 'complement' else 'part' end,
          p_mode, p_montant, nullif(trim(p_note), ''), 'recu', auth.uid(), auth.uid(), public.achats_nom_courant(), now())
  returning id into v_id;
  return v_id;
end;
$fn$;

-- achats_lier_tirage
create or replace function public.achats_lier_tirage(p_id uuid, p_tirage uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Seul le porteur de cet achat peut faire cette action.'; end if;
  if not exists (select 1 from public.tirages t where t.id = p_tirage and t.association_id = v_a.association_id) then
    raise exception 'Tirage introuvable.';
  end if;
  update public.achats_groupes set tirage_id = p_tirage where id = p_id;
end;
$fn$;

-- achats_marquer_livre
create or replace function public.achats_marquer_livre(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'commande' then raise exception 'La commande n''a pas encore été passée.'; end if;
  update public.achats_groupes set statut = 'livre', livre_le = now() where id = p_id;
  perform public.achats_notifier(p_id, v_a.titre, 'Votre commande est arrivée : présentez votre carte de membre pour la récupérer.');
end;
$fn$;

-- achats_modifier
create or replace function public.achats_modifier(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_porteur uuid;
  v_porteur_nom text;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Seul le porteur de cet achat peut faire cette action.'; end if;
  if v_a.statut not in ('propose', 'ouvert') then raise exception 'Cet achat ne peut plus être modifié.'; end if;
  if coalesce((p->>'perissable')::boolean, false) and not coalesce((p->>'chaine_froid')::boolean, false) then
    raise exception 'Charte : pas de produit périssable sans chaîne du froid.';
  end if;
  v_porteur := nullif(p->>'porteur_member_id', '')::uuid;
  select m.nom into v_porteur_nom from public.members m where m.id = v_porteur and m.association_id = v_a.association_id;
  if v_porteur_nom is null then v_porteur := null; end if;

  update public.achats_groupes set
    titre = coalesce(nullif(trim(p->>'titre'), ''), titre),
    description = nullif(trim(p->>'description'), ''),
    photo_url = nullif(p->>'photo_url', ''),
    fournisseur = nullif(trim(p->>'fournisseur'), ''),
    unite = coalesce(nullif(p->>'unite', ''), unite),
    prix_unitaire = coalesce(nullif(p->>'prix_unitaire', '')::numeric, prix_unitaire),
    prix_detail = nullif(p->>'prix_detail', '')::numeric,
    frais_estimes = coalesce(nullif(p->>'frais_estimes', '')::numeric, 0),
    seuil_min = coalesce(nullif(p->>'seuil_min', '')::numeric, seuil_min),
    stock_max = nullif(p->>'stock_max', '')::numeric,
    mode_repartition = coalesce(nullif(p->>'mode_repartition', ''), mode_repartition),
    date_limite = coalesce(nullif(p->>'date_limite', '')::timestamptz, date_limite),
    perissable = coalesce((p->>'perissable')::boolean, false),
    chaine_froid = coalesce((p->>'chaine_froid')::boolean, false),
    porteur_member_id = v_porteur, porteur_nom = v_porteur_nom
   where id = p_id;
end;
$fn$;

-- achats_passer_commande
create or replace function public.achats_passer_commande(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_impayes int;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Seul le porteur de cet achat peut faire cette action.'; end if;
  if v_a.statut <> 'confirme' then raise exception 'L''achat doit être confirmé (seuil atteint) avant la commande.'; end if;
  if v_a.total_attribue < v_a.seuil_min then
    raise exception 'Après les désistements, le seuil minimum n''est plus atteint : annulez l''achat ou trouvez d''autres souscripteurs.';
  end if;
  -- Personne n'avance l'argent des autres : toutes les parts doivent être
  -- payées ET validées (double contrôle).
  select count(*) into v_impayes from public.achats_souscriptions s
   where s.achat_id = p_id and s.statut = 'retenu' and public.achats_solde(p_id, s.member_id) < 0;
  if v_impayes > 0 then
    raise exception '% part(s) ne sont pas encore payées et validées : la commande ne peut pas être passée.', v_impayes;
  end if;
  update public.achats_groupes set statut = 'commande', commande_le = now(), note_commande = nullif(trim(p_note), '') where id = p_id;
  perform public.achats_notifier(p_id, v_a.titre, 'Toutes les parts sont payées : la commande est passée auprès du fournisseur.');
end;
$fn$;

-- achats_rejeter_mouvement
create or replace function public.achats_rejeter_mouvement(p_mvt uuid, p_motif text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_m public.achats_mouvements;
begin
  select * into v_m from public.achats_mouvements where id = p_mvt for update;
  if v_m.id is null or v_m.association_id <> public.current_association_id() or v_m.achat_id is null
     or not public.achats_est_porteur(v_m.achat_id) then raise exception 'Non autorisé.'; end if;
  if v_m.statut not in ('declare', 'recu') then raise exception 'Un mouvement validé ne peut plus être rejeté.'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Motif requis.'; end if;
  update public.achats_mouvements set statut = 'rejete', motif_rejet = trim(p_motif) where id = p_mvt;
end;
$fn$;

-- achats_retirer_souscripteur
create or replace function public.achats_retirer_souscripteur(p_sous uuid, p_motif text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_s public.achats_souscriptions;
  v_a public.achats_groupes;
begin
  select * into v_s from public.achats_souscriptions where id = p_sous for update;
  select * into v_a from public.achats_groupes where id = v_s.achat_id for update;
  if v_s.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(v_a.id) then raise exception 'Seul le porteur de cet achat peut faire cette action.'; end if;
  if v_a.statut not in ('ouvert', 'confirme') then raise exception 'Trop tard : la commande est déjà passée.'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Motif requis.'; end if;
  update public.achats_souscriptions set statut = 'desiste', quantite_attribuee = 0, montant_du = 0, motif = trim(p_motif), updated_at = now()
   where id = p_sous;
  perform public.achats_recalculer(v_a.id);
end;
$fn$;

-- achats_saisir_bilan
create or replace function public.achats_saisir_bilan(p_id uuid, p_cout_produits numeric, p_frais_communs numeric, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Non autorisé.'; end if;
  if v_a.statut not in ('commande', 'livre') then raise exception 'Le bilan se fait après la commande.'; end if;
  if p_cout_produits is null or p_cout_produits < 0 or coalesce(p_frais_communs, 0) < 0 then raise exception 'Montants invalides.'; end if;
  update public.achats_groupes set cout_reel_produits = round(p_cout_produits, 2), frais_communs_reels = round(coalesce(p_frais_communs, 0), 2),
         note_bilan = nullif(trim(p_note), ''), bilan_saisi_par = auth.uid(), bilan_saisi_le = now()
   where id = p_id;
end;
$fn$;

-- achats_convertir_avoir
create or replace function public.achats_convertir_avoir(p_achat uuid, p_member uuid, p_montant numeric) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_nom text;
begin
  select * into v_a from public.achats_groupes where id = p_achat;
  if v_a.id is null or v_a.association_id <> public.current_association_id()
     or not (public.achats_est_porteur(p_achat) or p_member = public.current_member_id()) then raise exception 'Non autorisé.'; end if;
  if v_a.statut not in ('cloture', 'annule') and not exists (
       select 1 from public.achats_souscriptions s where s.achat_id = p_achat and s.member_id = p_member and s.statut in ('desiste', 'non_retenu')) then
    raise exception 'Le trop-perçu ne peut être converti qu''après le bilan (ou l''annulation).';
  end if;
  if p_montant is null or p_montant <= 0
     or p_montant > public.achats_solde(p_achat, p_member) - public.achats_sorties_en_attente(p_achat, p_member) then
    raise exception 'Montant supérieur au trop-perçu.';
  end if;
  select s.member_nom into v_nom from public.achats_souscriptions s where s.achat_id = p_achat and s.member_id = p_member;
  insert into public.achats_mouvements (association_id, achat_id, member_id, member_nom, sens, objet, mode, montant, statut,
                                        declare_par, recu_par, recu_par_nom, recu_le, valide_par, valide_par_nom, valide_le, note)
  values (v_a.association_id, p_achat, p_member, v_nom, 'avoir', 'avoir', 'aucun', p_montant, 'valide',
          auth.uid(), auth.uid(), public.achats_nom_courant(), now(), auth.uid(), public.achats_nom_courant(), now(),
          'Trop-perçu converti en avoir');
end;
$fn$;

-- achats_remettre
create or replace function public.achats_remettre(p_id uuid, p_token uuid default null, p_sous uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_s public.achats_souscriptions;
  v_member uuid;
  v_deja boolean;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Non autorisé.'; end if;
  if v_a.statut not in ('livre', 'cloture') then raise exception 'La marchandise n''est pas encore arrivée.'; end if;

  if p_token is not null then
    -- Code protégé de la carte (member_card_tokens), sinon ancien code.
    select t.member_id into v_member from public.member_card_tokens t where t.token = p_token and t.association_id = v_a.association_id;
    if v_member is null then
      select m.id into v_member from public.members m where m.verification_token = p_token and m.association_id = v_a.association_id;
    end if;
    if v_member is null then return jsonb_build_object('ok', false, 'raison', 'carte_inconnue'); end if;
    select * into v_s from public.achats_souscriptions where achat_id = p_id and member_id = v_member for update;
  else
    select * into v_s from public.achats_souscriptions where id = p_sous and achat_id = p_id for update;
  end if;
  if v_s.id is null or v_s.statut <> 'retenu' then
    return jsonb_build_object('ok', false, 'raison', 'pas_de_part');
  end if;

  v_deja := v_s.remis_le is not null;
  if not v_deja then
    update public.achats_souscriptions set remis_le = now(), remis_par = auth.uid(), remis_par_nom = public.achats_nom_courant(), updated_at = now()
     where id = v_s.id returning * into v_s;
  end if;
  return jsonb_build_object('ok', true, 'deja_remis', v_deja, 'member_nom', v_s.member_nom,
                            'quantite', v_s.quantite_attribuee, 'unite', v_a.unite, 'remis_le', v_s.remis_le,
                            'remis_par_nom', v_s.remis_par_nom, 'souscription_id', v_s.id);
end;
$fn$;

-- achats_ajouter_creneau
create or replace function public.achats_ajouter_creneau(p_id uuid, p_lieu text, p_debut timestamptz, p_fin timestamptz, p_capacite int) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; v_id uuid;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Non autorisé.'; end if;
  insert into public.achats_creneaux (achat_id, association_id, lieu, debut, fin, capacite) values (p_id, v_a.association_id, trim(p_lieu), p_debut, p_fin, nullif(p_capacite, 0))
  returning id into v_id;
  perform public.achats_notifier(p_id, 'Créneau de retrait', trim(p_lieu) || ' — choisissez votre créneau dans la fiche de l''achat.', false);
  return v_id;
end;
$fn$;

-- achats_ajouter_devis
create or replace function public.achats_ajouter_devis(p_id uuid, p_fournisseur text, p_prix numeric, p_frais numeric, p_delai text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; v_id uuid;
begin
  if exists (select 1 from public.achats_souscriptions where achat_id = p_id and statut <> 'retire') then
    raise exception 'Des membres ont déjà souscrit : les devis sont figés.';
  end if;
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Non autorisé.'; end if;
  if v_a.statut not in ('sondage', 'propose', 'ouvert') then raise exception 'Les devis se comparent avant la clôture des souscriptions.'; end if;
  insert into public.achats_devis (achat_id, association_id, fournisseur, prix_unitaire, frais, delai, note, cree_par_nom)
  values (p_id, v_a.association_id, trim(p_fournisseur), p_prix, coalesce(p_frais, 0), nullif(trim(coalesce(p_delai, '')), ''), nullif(trim(coalesce(p_note, '')), ''), public.achats_nom_courant())
  returning id into v_id;
  return v_id;
end;
$fn$;

-- achats_ajouter_suivi
create or replace function public.achats_ajouter_suivi(p_id uuid, p_etape text, p_lieu text, p_note text, p_numero text default null, p_transporteur text default null) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Non autorisé.'; end if;
  if coalesce(trim(p_numero), '') <> '' or coalesce(trim(p_transporteur), '') <> '' then
    update public.achats_groupes set suivi_numero = coalesce(nullif(trim(p_numero), ''), suivi_numero), suivi_transporteur = coalesce(nullif(trim(p_transporteur), ''), suivi_transporteur) where id = p_id;
  end if;
  if coalesce(trim(p_etape), '') <> '' then
    insert into public.achats_suivi (achat_id, association_id, etape, lieu, note, auteur_nom)
    values (p_id, v_a.association_id, trim(p_etape), nullif(trim(coalesce(p_lieu, '')), ''), nullif(trim(coalesce(p_note, '')), ''), public.achats_nom_courant());
    perform public.achats_notifier(p_id, 'Suivi : ' || left(v_a.titre, 60), trim(p_etape) || coalesce(' — ' || nullif(trim(coalesce(p_lieu, '')), ''), ''), false);
  end if;
end;
$fn$;

-- achats_fixer_limite_paiement
create or replace function public.achats_fixer_limite_paiement(p_id uuid, p_date timestamptz) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'confirme' then raise exception 'La date limite de paiement se fixe une fois l''achat confirmé.'; end if;
  update public.achats_groupes set date_limite_paiement = p_date where id = p_id;
  perform public.achats_notifier(p_id, 'Date limite de paiement', v_a.titre || ' — payez votre part avant le ' || to_char(p_date at time zone 'America/Moncton', 'DD/MM à HH24"h"MI') || '.', false);
end;
$fn$;

-- achats_joindre_facture
create or replace function public.achats_joindre_facture(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Non autorisé.'; end if;
  update public.achats_groupes set facture_path = p_path where id = p_id;
end;
$fn$;

-- achats_supprimer_creneau
create or replace function public.achats_supprimer_creneau(p_creneau uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_c public.achats_creneaux;
begin
  select * into v_c from public.achats_creneaux where id = p_creneau;
  if v_c.id is null or v_c.association_id <> public.current_association_id() or not public.achats_est_porteur(v_c.achat_id) then raise exception 'Non autorisé.'; end if;
  update public.achats_souscriptions set creneau_id = null where creneau_id = p_creneau;
  delete from public.achats_creneaux where id = p_creneau;
end;
$fn$;

-- achats_supprimer_devis
create or replace function public.achats_supprimer_devis(p_devis uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_d public.achats_devis;
begin
  select * into v_d from public.achats_devis where id = p_devis;
  if v_d.id is null or v_d.association_id <> public.current_association_id() or not public.achats_est_porteur(v_d.achat_id) then raise exception 'Non autorisé.'; end if;
  if exists (select 1 from public.achats_souscriptions where achat_id = v_d.achat_id and statut <> 'retire') then
    raise exception 'Des membres ont déjà souscrit : les devis sont figés.';
  end if;
  delete from public.achats_devis where id = p_devis;
end;
$fn$;

-- achats_passer_en_sondage
create or replace function public.achats_passer_en_sondage(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Seul le porteur de cet achat peut faire cette action.'; end if;
  if v_a.statut not in ('propose', 'ouvert') or exists (select 1 from public.achats_souscriptions where achat_id = p_id and statut <> 'retire') then
    raise exception 'Le sondage n''est possible qu''avant toute souscription.';
  end if;
  update public.achats_groupes set statut = 'sondage', valide_par = auth.uid() where id = p_id;
  perform public.achats_notifier(p_id, 'Sondage d''intérêt', v_a.titre || ' — seriez-vous intéressé(e) ? Indiquez une quantité, sans engagement.', true);
end;
$fn$;

-- achats_retenir_devis
create or replace function public.achats_retenir_devis(p_devis uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_d public.achats_devis; v_a public.achats_groupes;
begin
  select * into v_d from public.achats_devis where id = p_devis;
  select * into v_a from public.achats_groupes where id = v_d.achat_id for update;
  if v_d.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(v_a.id) then raise exception 'Seul le porteur de cet achat peut faire cette action.'; end if;
  if not (v_a.statut in ('sondage', 'propose') or (v_a.statut = 'ouvert' and not exists (select 1 from public.achats_souscriptions where achat_id = v_a.id and statut <> 'retire'))) then
    raise exception 'Le prix ne peut plus changer : des membres ont déjà souscrit.';
  end if;
  update public.achats_devis set retenu = (id = p_devis) where achat_id = v_a.id;
  update public.achats_groupes set fournisseur = v_d.fournisseur, prix_unitaire = v_d.prix_unitaire, frais_estimes = v_d.frais where id = v_a.id;
end;
$fn$;

-- achats_ouvrir_souscriptions
create or replace function public.achats_ouvrir_souscriptions(p_id uuid, p_date_limite timestamptz, p_mode text default 'priorite', p_heures int default 48) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; p uuid; v_fin timestamptz;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Seul le porteur de cet achat peut faire cette action.'; end if;
  if v_a.statut <> 'sondage' then raise exception 'Cet achat n''est pas en sondage.'; end if;
  if p_date_limite is null or p_date_limite <= now() then raise exception 'La date limite doit être dans le futur.'; end if;
  if coalesce(p_mode, 'tous') not in ('tous', 'priorite', 'reserve') then raise exception 'Mode d''accès invalide.'; end if;
  if p_mode in ('priorite', 'reserve') and not exists (select 1 from public.achats_interets where achat_id = p_id) then
    raise exception 'Personne n''a participé au sondage : choisissez « Ouvert à tous ».';
  end if;
  v_fin := case when p_mode = 'priorite' then least(now() + make_interval(hours => greatest(coalesce(p_heures, 48), 1)), p_date_limite) end;
  update public.achats_groupes
     set statut = 'ouvert', date_limite = p_date_limite, acces_mode = coalesce(p_mode, 'tous'), priorite_jusqu_au = v_fin,
         priorite_fin_notifiee = false, rappel_veille_envoye = false
   where id = p_id;
  -- Les intéressés en premier, avec leur quantité déjà proposée à l'écran.
  for p in select pr.id from public.profiles pr join public.achats_interets i on i.member_id = pr.member_id where i.achat_id = p_id loop
    begin
      perform public.notify_profile(v_a.association_id, p, 'Souscriptions ouvertes : ' || left(v_a.titre, 80),
        case when p_mode = 'priorite' then 'Priorité aux personnes intéressées jusqu''au ' || to_char(v_fin at time zone 'America/Moncton', 'DD/MM à HH24"h"MI') || ' : confirmez votre quantité.'
             else 'Vous aviez marqué votre intérêt : confirmez votre quantité avant la date limite.' end);
    exception when others then null;
    end;
  end loop;
  -- Ouvert à tous dès maintenant : tout le monde est prévenu.
  if p_mode = 'tous' then
    perform public.achats_notifier(p_id, 'Souscriptions ouvertes', v_a.titre || ' — souscrivez avant la date limite.', true);
  end if;
end;
$fn$;

-- achats_changer_acces
create or replace function public.achats_changer_acces(p_id uuid, p_mode text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Seul le porteur de cet achat peut faire cette action.'; end if;
  if v_a.statut <> 'ouvert' then raise exception 'Les souscriptions ne sont pas ouvertes.'; end if;
  if p_mode not in ('tous', 'reserve') then raise exception 'Mode d''accès invalide.'; end if;
  update public.achats_groupes set acces_mode = p_mode, priorite_jusqu_au = null, priorite_fin_notifiee = true where id = p_id;
  if p_mode = 'tous' then
    perform public.achats_notifier(p_id, 'Places ouvertes à tous', v_a.titre || ' — tous les membres peuvent maintenant souscrire.', true);
  end if;
end;
$fn$;

-- achats_revenir_au_sondage
create or replace function public.achats_revenir_au_sondage(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Seul le porteur de cet achat peut faire cette action.'; end if;
  if v_a.statut <> 'ouvert' then raise exception 'Retour au sondage impossible à cette étape.'; end if;
  if exists (select 1 from public.achats_souscriptions where achat_id = p_id and statut = 'inscrit') then
    raise exception 'Des membres ont déjà souscrit : le retour au sondage n''est plus possible (utilisez « Ouvrir à tous »).';
  end if;
  update public.achats_groupes set statut = 'sondage', acces_mode = 'tous', priorite_jusqu_au = null where id = p_id;
  update public.achats_interets set tardif = false, accepte = true where achat_id = p_id;
  perform public.achats_notifier(p_id, 'Sondage rouvert', v_a.titre || ' — le sondage d''intérêt est rouvert : indiquez votre quantité.', true);
end;
$fn$;

-- achats_statuer_participation
create or replace function public.achats_statuer_participation(p_id uuid, p_member uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; p uuid;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_porteur(p_id) then raise exception 'Non autorisé.'; end if;
  if p_member = public.current_member_id() then raise exception 'Vous ne pouvez pas statuer sur votre propre demande.'; end if;
  if p_ok then
    update public.achats_interets set accepte = true where achat_id = p_id and member_id = p_member;
  else
    delete from public.achats_interets where achat_id = p_id and member_id = p_member and tardif;
  end if;
  for p in select pr.id from public.profiles pr where pr.member_id = p_member loop
    begin
      perform public.notify_profile(v_a.association_id, p, left(v_a.titre, 80),
        case when p_ok then 'Votre demande est acceptée : vous pouvez souscrire.' else 'Votre demande de participation n''a pas pu être acceptée.' end);
    exception when others then null;
    end;
  end loop;
end;
$fn$;

-- Vérification :
--   select count(*) from pg_proc where prosrc like '%achats_est_porteur%';  -- 27 ou plus
