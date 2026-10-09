-- =====================================================================
-- Liaison directe du compte d'un membre du BUREAU à sa fiche adhérent
-- (2026-10-09)
-- =====================================================================
-- Problème constaté par l'utilisateur pendant le test des élections :
-- le président FONDATEUR (celui qui a créé l'association) n'a jamais de
-- demande de rattachement — elles ne naissent que quand quelqu'un rejoint
-- avec un code d'invitation (join_association_with_code). Son compte
-- restait donc relié à aucune fiche : impossible de voter, de siéger au
-- comité électoral, etc. La seule issue était une requête SQL à la main.
--
-- lier_mon_compte_fiche() : un membre du bureau dont le compte n'est
-- relié à AUCUNE fiche peut le relier lui-même, une seule fois, à une
-- fiche de son association qui n'est reliée à aucun autre compte (fiche
-- existante, ou fiche qu'il vient de créer depuis l'application).
--   • Les adhérents ne peuvent PAS l'utiliser : pour eux, la liaison reste
--     la confirmation par le bureau dans Gestion des accès.
--   • Une liaison existante ne se change pas ici (pas de « vol » de fiche
--     ni de changement d'identité en douce).
--   • Chaque liaison est inscrite au Journal d'activité.
--   • Une éventuelle demande de rattachement en attente pour ce compte
--     est marquée confirmée.
-- Ré-exécutable sans risque.
-- =====================================================================

create or replace function public.lier_mon_compte_fiche(p_member_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_profile public.profiles;
  v_fiche public.members;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile.id is null then raise exception 'Compte introuvable.'; end if;
  if not public.is_bureau() then
    raise exception 'Réservé aux membres du bureau. Pour un adhérent, la liaison se fait quand le bureau confirme sa demande dans Gestion des accès.';
  end if;
  if v_profile.member_id is not null then
    raise exception 'Votre compte est déjà relié à une fiche adhérent.';
  end if;

  select * into v_fiche from public.members where id = p_member_id;
  if v_fiche.id is null or v_fiche.association_id <> v_profile.association_id then
    raise exception 'Fiche adhérent introuvable dans votre association.';
  end if;
  if exists (select 1 from public.profiles p where p.member_id = p_member_id) then
    raise exception 'Cette fiche est déjà reliée à un autre compte.';
  end if;

  update public.profiles set member_id = p_member_id where id = v_profile.id;

  update public.member_link_requests
     set statut = 'confirme', suggested_member_id = p_member_id, resolved_at = now(), resolved_by = auth.uid()
   where profile_id = v_profile.id and statut = 'en_attente';

  -- Trace visible du bureau : qui a relié son compte à quelle fiche.
  insert into public.activity_log (association_id, user_id, user_nom, action, table_name, record_id, details)
  values (
    v_profile.association_id, v_profile.id, v_profile.nom_complet, 'UPDATE', 'profiles', v_profile.id,
    -- Format ancien/nouveau : le Journal affiche « Fiche reliée : — → <nom> ».
    jsonb_build_object('ancien', jsonb_build_object('fiche_reliee', null),
                       'nouveau', jsonb_build_object('fiche_reliee', v_fiche.nom, 'liaison', 'directe (membre du bureau)'))
  );
end;
$fn$;

grant execute on function public.lier_mon_compte_fiche(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select proname from pg_proc where proname = 'lier_mon_compte_fiche';
-- ---------------------------------------------------------------------
