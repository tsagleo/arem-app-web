-- =====================================================================
-- Tirages au sort — photos de profil des participants (2026-10-08)
-- (suite de 2026-10-08r et s)
-- =====================================================================
-- Demande de l'utilisateur : pendant que les noms défilent en direct, voir
-- chaque nom avec sa photo de profil. La photo (members.photo_url) est
-- copiée dans la liste des participants à la préparation, pour que TOUS
-- les écrans l'affichent, y compris ceux des adhérents qui ne lisent pas
-- la table members.
--
-- Sans effet sur l'équité : l'ordre dépend uniquement de
-- SHA-256(graine:member_id) — la photo n'entre pas dans le calcul, et la
-- vérification dans le navigateur reste identique.
-- Ré-exécutable sans risque.
-- =====================================================================

create or replace function public.preparer_tirage(
  p_titre text, p_type text, p_member_ids uuid[], p_nb_gagnants int default 1
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_participants jsonb;
  v_nb int;
  v_graine text;
  v_id uuid;
  v_nom text;
begin
  if v_assoc is null or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if coalesce(trim(p_titre), '') = '' then raise exception 'Titre requis.'; end if;
  if p_type not in ('tontine', 'libre') then raise exception 'Type de tirage invalide.'; end if;

  select jsonb_agg(jsonb_build_object('member_id', m.id, 'nom', m.nom, 'photo_url', m.photo_url) order by m.nom), count(*)
    into v_participants, v_nb
    from public.members m
   where m.id = any(p_member_ids) and m.association_id = v_assoc;

  if coalesce(v_nb, 0) < 2 then raise exception 'Il faut au moins deux participants.'; end if;
  if v_nb <> coalesce(array_length(p_member_ids, 1), 0) then raise exception 'Participant inconnu dans cette association.'; end if;

  v_graine := encode(extensions.gen_random_bytes(32), 'hex');
  select nom_complet into v_nom from public.profiles where id = auth.uid();

  insert into public.tirages (association_id, titre, type, nb_gagnants, participants, engagement, cree_par, cree_par_nom)
  values (
    v_assoc, trim(p_titre), p_type,
    case when p_type = 'tontine' then v_nb else least(greatest(coalesce(p_nb_gagnants, 1), 1), v_nb) end,
    v_participants, encode(extensions.digest(v_graine, 'sha256'), 'hex'), auth.uid(), v_nom
  ) returning id into v_id;

  insert into public.tirages_secrets (tirage_id, graine) values (v_id, v_graine);
  return v_id;
end;
$fn$;

-- Tirages déjà créés : ajoute la photo actuelle de chaque participant.
update public.tirages t
   set participants = (
     select jsonb_agg(e.p || jsonb_build_object('photo_url', m.photo_url) order by e.i)
       from jsonb_array_elements(t.participants) with ordinality as e(p, i)
       left join public.members m on m.id = (e.p->>'member_id')::uuid
   )
 where exists (select 1 from jsonb_array_elements(t.participants) p where not (p ? 'photo_url'));
