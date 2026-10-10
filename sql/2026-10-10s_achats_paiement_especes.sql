-- =====================================================================
-- Achats groupés : le membre peut déclarer un paiement EN ESPÈCES remis
-- au porteur (2026-10-10, demandé par l'utilisateur).
-- =====================================================================
-- achats_declarer_paiement() accepte désormais le mode « especes » (sans
-- capture). Le circuit reste le double contrôle : déclaré par le membre,
-- confirmé « reçu » par le porteur, validé par un AUTRE membre du bureau.
-- Le porteur est prévenu de chaque déclaration.
-- Fonction reprise de sql/2026-10-09e ; seuls le mode et la capture changent.
-- Ré-exécutable sans risque.
-- =====================================================================
create or replace function public.achats_declarer_paiement(
  p_achat uuid, p_montant numeric, p_mode text, p_preuve_path text default null, p_reference text default null
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_member uuid := public.current_member_id();
  v_id uuid;
  v_s public.achats_souscriptions;
begin
  select * into v_a from public.achats_groupes where id = p_achat;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or v_member is null then raise exception 'Non autorisé.'; end if;
  select * into v_s from public.achats_souscriptions where achat_id = p_achat and member_id = v_member;
  if v_s.id is null or v_s.statut <> 'retenu' then raise exception 'Vous n''avez pas de part à payer pour cet achat.'; end if;
  if v_a.statut not in ('confirme', 'commande', 'livre', 'cloture') then raise exception 'Le paiement n''est pas encore ouvert.'; end if;
  if p_montant is null or p_montant <= 0 then raise exception 'Montant invalide.'; end if;
  if p_mode not in ('interac', 'avoir', 'especes') then raise exception 'Mode de paiement invalide.'; end if;

  if p_mode = 'avoir' then
    if p_montant > public.achats_avoir_disponible(v_member) then raise exception 'Avoir insuffisant.'; end if;
    insert into public.achats_mouvements (association_id, achat_id, member_id, member_nom, sens, objet, mode, montant, statut,
                                          declare_par, recu_par, recu_par_nom, recu_le, valide_par, valide_par_nom, valide_le, note)
    values (v_a.association_id, p_achat, v_member, v_s.member_nom, 'entree',
            case when v_a.statut = 'cloture' then 'complement' else 'part' end, 'avoir', p_montant, 'valide',
            auth.uid(), auth.uid(), public.achats_nom_courant(), now(), auth.uid(), public.achats_nom_courant(), now(),
            'Payé avec l''avoir du membre')
    returning id into v_id;
  else
    -- Espèces remises au porteur : déclarées par le membre, sans capture ;
    -- le porteur confirme « reçu », puis un autre membre du bureau valide.
    if p_mode = 'interac' and coalesce(p_preuve_path, '') = '' then raise exception 'Joignez la capture du virement Interac.'; end if;
    insert into public.achats_mouvements (association_id, achat_id, member_id, member_nom, sens, objet, mode, montant,
                                          preuve_path, reference, statut, declare_par)
    values (v_a.association_id, p_achat, v_member, v_s.member_nom, 'entree',
            case when v_a.statut = 'cloture' then 'complement' else 'part' end, p_mode, p_montant,
            p_preuve_path, nullif(trim(p_reference), ''), 'declare', auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end;
$fn$;

create or replace function public.achats_trg_paiement_declare() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare p uuid; v_titre text;
begin
  if new.statut <> 'declare' or new.sens <> 'entree' then return null; end if;
  select titre into v_titre from public.achats_groupes where id = new.achat_id;
  for p in select pr.id from public.profiles pr join public.achats_groupes a on a.porteur_member_id = pr.member_id where a.id = new.achat_id loop
    begin
      perform public.notify_profile(new.association_id, p, 'Paiement déclaré — ' || left(coalesce(v_titre, ''), 60),
        coalesce(new.member_nom, '') || ' : ' || to_char(new.montant, 'FM999990.00') || ' $ (' || case new.mode when 'especes' then 'espèces' else new.mode end || '). Confirmez la réception.');
    exception when others then null;
    end;
  end loop;
  return null;
end;
$fn$;
drop trigger if exists trg_achats_paiement_declare on public.achats_mouvements;
create trigger trg_achats_paiement_declare after insert on public.achats_mouvements
  for each row execute function public.achats_trg_paiement_declare();

-- Vérification :
--   select prosrc like '%especes%' from pg_proc where proname = 'achats_declarer_paiement';  -- true
