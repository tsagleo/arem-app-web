-- =====================================================================
-- Rejoindre une association existante par code d'invitation
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois), APRÈS le script
-- 2026-09-07_correctif_auto_inscription.sql.
--
-- CE QUE CE SCRIPT MET EN PLACE :
--   1) Un code d'invitation unique par association (colonne
--      `code_invitation` sur `associations`), que le/la président(e) peut
--      générer et régénérer depuis Configuration.
--   2) Une fonction `join_association_with_code()` : un nouveau compte
--      qui saisit un code valide est rattaché à cette association (rôle
--      « adhérent » par défaut), et le système cherche automatiquement
--      une fiche membre existante (créée à l'avance par le bureau) avec
--      le même courriel.
--   3) Une table `member_link_requests` qui garde trace de cette
--      correspondance suggérée, EN ATTENTE de confirmation par le
--      bureau — rien n'est relié automatiquement sans validation
--      humaine (décision prise avec l'utilisateur le 2026-09-07).
--   4) Une fonction `resolve_member_link_request()` que le bureau
--      utilise (depuis le nouvel onglet « Gestion des accès ») pour
--      confirmer la correspondance suggérée, en choisir une autre
--      manuellement, ou la rejeter.
--
-- Ce script ne supprime ni ne modifie aucune donnée existante.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Code d'invitation par association
-- ---------------------------------------------------------------------
alter table public.associations add column if not exists code_invitation text unique;

-- Génère un code initial pour les associations existantes qui n'en ont
-- pas encore (ex. AREM), pour que le/la président(e) en ait un tout de
-- suite sans devoir cliquer sur « Générer ».
update public.associations
set code_invitation = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
where code_invitation is null;

-- ---------------------------------------------------------------------
-- 2) Table des demandes de rattachement (correspondance courriel ↔
--    fiche membre, en attente de confirmation par le bureau)
-- ---------------------------------------------------------------------
create table if not exists public.member_link_requests (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  suggested_member_id uuid references public.members(id) on delete set null,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'confirme', 'rejete')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);

alter table public.member_link_requests enable row level security;

drop policy if exists "lecture des demandes de rattachement" on public.member_link_requests;
create policy "lecture des demandes de rattachement"
on public.member_link_requests for select
to authenticated
using (
  profile_id = auth.uid()
  or (public.is_bureau() and association_id = public.current_association_id())
);
-- Aucune règle d'écriture directe n'est ajoutée : toutes les écritures
-- passent par les fonctions ci-dessous (comme pour la création
-- d'association — voir 2026-09-07_correctif_auto_inscription.sql).

-- ---------------------------------------------------------------------
-- 3) Rejoindre une association avec un code d'invitation
-- ---------------------------------------------------------------------
create or replace function public.join_association_with_code(p_code text, p_nom_complet text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assoc_id uuid;
  v_email text;
  v_member_id uuid;
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Vous devez être connecté(e) pour rejoindre une association.';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Ce compte est déjà rattaché à une association.';
  end if;

  select id into v_assoc_id from public.associations where code_invitation = upper(trim(p_code));
  if v_assoc_id is null then
    raise exception 'Code d''invitation invalide. Vérifiez le code auprès du bureau de votre association.';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into public.profiles (id, association_id, role, nom_complet)
  values (auth.uid(), v_assoc_id, 'adherent', p_nom_complet);

  -- Recherche automatique (suggestion seulement) d'une fiche membre déjà
  -- créée par le bureau avec le même courriel, pas encore reliée.
  select m.id into v_member_id
  from public.members m
  where m.association_id = v_assoc_id
    and m.email is not null
    and v_email is not null
    and lower(m.email) = lower(v_email)
    and not exists (select 1 from public.profiles p2 where p2.member_id = m.id)
  limit 1;

  insert into public.member_link_requests (association_id, profile_id, suggested_member_id, statut)
  values (v_assoc_id, auth.uid(), v_member_id, 'en_attente')
  returning id into v_request_id;

  return json_build_object('association_id', v_assoc_id, 'request_id', v_request_id, 'suggested_member_id', v_member_id);
end;
$$;
grant execute on function public.join_association_with_code(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Le bureau confirme (ou rejette) une demande de rattachement
-- ---------------------------------------------------------------------
create or replace function public.resolve_member_link_request(p_request_id uuid, p_member_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.member_link_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié.';
  end if;

  select * into v_req from public.member_link_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'Demande introuvable.';
  end if;

  if not (public.is_bureau() and public.current_association_id() = v_req.association_id) then
    raise exception 'Seul un membre du bureau peut traiter cette demande.';
  end if;

  if v_req.statut <> 'en_attente' then
    raise exception 'Cette demande a déjà été traitée.';
  end if;

  if p_action = 'confirmer' then
    if p_member_id is null then
      raise exception 'Choisissez une fiche membre à relier.';
    end if;
    if exists (select 1 from public.profiles where member_id = p_member_id) then
      raise exception 'Cette fiche membre est déjà reliée à un autre compte.';
    end if;
    if not exists (select 1 from public.members where id = p_member_id and association_id = v_req.association_id) then
      raise exception 'Fiche membre introuvable dans cette association.';
    end if;
    update public.profiles set member_id = p_member_id where id = v_req.profile_id;
    update public.member_link_requests
      set statut = 'confirme', suggested_member_id = p_member_id, resolved_at = now(), resolved_by = auth.uid()
      where id = p_request_id;
  elsif p_action = 'rejeter' then
    update public.member_link_requests
      set statut = 'rejete', resolved_at = now(), resolved_by = auth.uid()
      where id = p_request_id;
  else
    raise exception 'Action invalide.';
  end if;
end;
$$;
grant execute on function public.resolve_member_link_request(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Générer / régénérer le code d'invitation (président seulement)
-- ---------------------------------------------------------------------
create or replace function public.regenerate_invite_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assoc_id uuid;
  v_code text;
begin
  v_assoc_id := public.current_association_id();
  if v_assoc_id is null then
    raise exception 'Profil introuvable.';
  end if;
  if public.current_user_role() <> 'bureau_president' then
    raise exception 'Seul(e) le/la président(e) peut générer un code d''invitation.';
  end if;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.associations where code_invitation = v_code);
  end loop;

  update public.associations set code_invitation = v_code where id = v_assoc_id;
  return v_code;
end;
$$;
grant execute on function public.regenerate_invite_code() to authenticated;

-- =====================================================================
-- Vérification rapide après exécution :
--   select nom, code_invitation from public.associations;
--   -- chaque association doit avoir un code non vide
--   select proname from pg_proc where proname in
--     ('join_association_with_code','resolve_member_link_request','regenerate_invite_code');
--   -- doit afficher les 3 lignes
-- =====================================================================
