-- =====================================================================
-- Achats groupés : la remise par scan reconnaît les cartes de membre
-- protégées (2026-10-10, signalé par l'utilisateur : « les scans ne
-- prennent pas »).
-- =====================================================================
-- Depuis sql/2026-10-10c, le QR de la carte de membre contient le code
-- protégé de member_card_tokens ; achats_remettre() ne cherchait que
-- l'ancien members.verification_token. Elle accepte maintenant les deux.
-- Ré-exécutable sans risque.
-- =====================================================================
create or replace function public.achats_remettre(p_id uuid, p_token uuid default null, p_sous uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_s public.achats_souscriptions;
  v_member uuid;
  v_deja boolean;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_gestionnaire(p_id) then raise exception 'Non autorisé.'; end if;
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

-- Vérification : select prosrc like '%member_card_tokens%' from pg_proc where proname = 'achats_remettre';  -- true
