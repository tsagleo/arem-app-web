-- =====================================================================
-- Adhésion par code d'invitation : accès SEULEMENT après validation du
-- bureau (2026-10-10, signalé par l'utilisateur : « il a directement eu
-- accès à son espace sans approbation du bureau »).
-- =====================================================================
-- Jusqu'ici, join_association_with_code() créait le profil avec le rôle
-- « adherent » ET une demande de rattachement en attente : la demande
-- arrivait bien au bureau (Gestion des accès), mais le compte voyait déjà
-- tout l'espace de l'association.
--
-- Désormais :
--   • un compte qui rejoint par code est « en attente » (nouvelle colonne
--     profiles.acces_en_attente) ;
--   • current_association_id() — utilisée par TOUTES les politiques RLS —
--     renvoie NULL pour un compte en attente, comme pour un compte bloqué
--     (sql/2026-09-07f_revocation_acces.sql) : aucune donnée accessible,
--     verrouillage au niveau de la base, pas seulement de l'écran ;
--   • quand le bureau CONFIRME la demande (Gestion des accès), l'accès
--     s'ouvre automatiquement et la personne reçoit une notification ;
--   • si le bureau attribue directement un rôle du bureau, l'accès s'ouvre
--     aussi ;
--   • le compte ne peut pas se débloquer lui-même.
-- Les comptes déjà inscrits dont la demande est encore en attente sont
-- placés en attente eux aussi (rattrapage en fin de script).
-- Ré-exécutable sans risque.
-- =====================================================================

-- 1) Nouvelle colonne
alter table public.profiles add column if not exists acces_en_attente boolean not null default false;

-- 2) current_association_id() ignore aussi un compte en attente
create or replace function current_association_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select association_id from profiles
  where id = auth.uid()
    and coalesce(compte_bloque, false) = false
    and coalesce(acces_en_attente, false) = false;
$$;

-- 3) Garde : personne ne lève sa propre attente ; le bureau (ou la
--    validation de la demande) seulement. Attribuer un rôle du bureau
--    ouvre l'accès.
create or replace function public.profiles_garde_acces()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and new.role <> 'adherent' then
    new.acces_en_attente := false;
  end if;
  if new.acces_en_attente is distinct from old.acces_en_attente
     and auth.uid() is not null
     and coalesce(current_setting('unia.acces_valide', true), '') <> 'oui'
     and coalesce(public.current_user_role(), '') not in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier', 'super_admin') then
    raise exception 'Seul le bureau peut valider l''accès d''un nouvel adhérent.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_profiles_garde_acces on public.profiles;
create trigger trg_profiles_garde_acces before update on public.profiles
  for each row execute function public.profiles_garde_acces();

-- 4) Nouvelle demande par code → compte en attente
--    (seul join_association_with_code() crée des demandes, juste après le
--    profil, dans la même transaction).
create or replace function public.demande_adhesion_mettre_en_attente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.statut = 'en_attente' then
    perform set_config('unia.acces_valide', 'oui', true);
    update public.profiles set acces_en_attente = true
     where id = new.profile_id and role = 'adherent' and member_id is null;
    perform set_config('unia.acces_valide', '', true);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_demande_adhesion_attente on public.member_link_requests;
create trigger trg_demande_adhesion_attente after insert on public.member_link_requests
  for each row execute function public.demande_adhesion_mettre_en_attente();

-- 5) Demande confirmée par le bureau → accès ouvert + notification
create or replace function public.demande_adhesion_ouvrir_acces()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.statut = 'confirme' and old.statut is distinct from 'confirme' then
    perform set_config('unia.acces_valide', 'oui', true);
    update public.profiles set acces_en_attente = false where id = new.profile_id and acces_en_attente;
    perform set_config('unia.acces_valide', '', true);
    begin
      perform public.notify_profile(new.association_id, new.profile_id,
        'Adhésion validée',
        'Le bureau a validé votre demande : vous avez maintenant accès à l''espace de l''association.');
    exception when others then null; -- notifications non installées : sans effet
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_demande_adhesion_ouvrir on public.member_link_requests;
create trigger trg_demande_adhesion_ouvrir after update on public.member_link_requests
  for each row execute function public.demande_adhesion_ouvrir_acces();

-- 6) Statut de sa propre demande (lisible même en attente, car les
--    politiques RLS ne voient plus l'association de ce compte)
create or replace function public.mon_statut_adhesion()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'association', (select a.nom from public.associations a where a.id = p.association_id),
    'statut', (select r.statut from public.member_link_requests r where r.profile_id = p.id order by r.created_at desc limit 1),
    'en_attente', p.acces_en_attente
  )
  from public.profiles p where p.id = auth.uid();
$$;
grant execute on function public.mon_statut_adhesion() to authenticated;

-- 7) Rattrapage : comptes déjà inscrits par code, demande encore en attente
select set_config('unia.acces_valide', 'oui', false);
update public.profiles p set acces_en_attente = true
 where p.role = 'adherent' and p.member_id is null and not p.acces_en_attente
   and exists (select 1 from public.member_link_requests r where r.profile_id = p.id and r.statut = 'en_attente');
select set_config('unia.acces_valide', '', false);

-- Vérification :
--   select nom_complet, role, acces_en_attente from public.profiles order by acces_en_attente desc, nom_complet;
