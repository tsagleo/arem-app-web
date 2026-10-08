-- =====================================================================
-- Demande d'adhésion complète (code d'invitation) : fiche + pièce
-- d'identité + preuve de paiement de l'inscription
-- =====================================================================
-- Demandé par l'utilisateur le 2026-10-06, en complément direct du
-- rattachement par code d'invitation (sql/2026-09-07b_rejoindre_
-- association.sql) : pour qu'une fois le bureau prêt à confirmer, il n'ait
-- plus RIEN à saisir, c'est maintenant la personne qui rejoint qui
-- remplit sa fiche adhérent complète (comme "Ajouter un adhérent", App.jsx)
-- ET joint une pièce d'identité ET une preuve de paiement de son
-- inscription (ou, à défaut de preuve, une simple déclaration — espèces ou
-- autre moyen) au moment même de sa demande, pas après.
--
-- CE QUE CE SCRIPT AJOUTE :
--   1. De nouvelles colonnes sur member_link_requests (déjà créée par
--      2026-09-07b) : la fiche complète + les informations de paiement +
--      les chemins de stockage des 2 fichiers.
--   2. join_association_with_code() est remplacée par une version étendue,
--      avec tous les nouveaux paramètres en DEFAULT (donc rétrocompatible :
--      un appel avec seulement p_code/p_nom_complet continue de fonctionner
--      exactement comme avant).
--   3. Le bucket de stockage privé "member-join-documents" (même esprit que
--      "interac-proofs", 2026-09-10b) + ses policies : le nouveau compte
--      (pas encore de profil/association au moment de l'upload) ne peut
--      déposer que dans son propre dossier (clé = auth.uid(), pas
--      association_id/member_id puisqu'aucun des deux n'existe encore à cet
--      instant) ; le bureau de l'association où la demande a atterri peut
--      consulter les fichiers déposés pour CETTE demande une fois créée.
--
-- Volontairement hors scope : la pièce d'identité n'est pas "validée"
-- automatiquement (aucune vérification d'authenticité) — le bureau la
-- consulte visuellement avant de confirmer, exactement comme il le ferait
-- en personne. Le montant/mode de paiement déclaré n'est pas non plus
-- vérifié automatiquement : il est simplement prérempli dans la fiche
-- adhérent au moment de la confirmation, le bureau peut le corriger avant
-- de valider s'il constate une erreur ou un désaccord.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Nouvelles colonnes sur member_link_requests
-- ---------------------------------------------------------------------
alter table public.member_link_requests
  add column if not exists courriel text,
  add column if not exists telephone text,
  add column if not exists sexe text,
  add column if not exists date_naissance date,
  add column if not exists quartier text,
  add column if not exists competences text,
  add column if not exists disponible_benevolat boolean not null default false,
  add column if not exists piece_identite_path text,
  add column if not exists piece_identite_nom text,
  add column if not exists preuve_paiement_mode text,
  add column if not exists preuve_paiement_path text,
  add column if not exists preuve_paiement_nom text,
  add column if not exists preuve_paiement_montant numeric,
  add column if not exists preuve_paiement_note text;

alter table public.member_link_requests drop constraint if exists member_link_requests_preuve_paiement_mode_check;
alter table public.member_link_requests
  add constraint member_link_requests_preuve_paiement_mode_check
    check (preuve_paiement_mode is null or preuve_paiement_mode in ('fichier', 'especes', 'autre', 'non_paye'));

comment on column public.member_link_requests.piece_identite_path is
  'Chemin dans le bucket de stockage privé "member-join-documents" — pièce d''identité jointe par la personne au moment de sa demande (2026-10-06). Jamais rendue publique.';
comment on column public.member_link_requests.preuve_paiement_mode is
  '''fichier'' (preuve_paiement_path renseigné), ''especes'' ou ''autre'' (déclaration sans preuve, preuve_paiement_note peut préciser), ''non_paye'' (inscription pas encore réglée).';

-- ---------------------------------------------------------------------
-- 2) join_association_with_code() étendue (rétrocompatible : tous les
--    nouveaux paramètres ont une valeur par défaut).
-- ---------------------------------------------------------------------
create or replace function public.join_association_with_code(
  p_code text,
  p_nom_complet text,
  p_courriel text default null,
  p_telephone text default null,
  p_sexe text default null,
  p_date_naissance date default null,
  p_quartier text default null,
  p_competences text default null,
  p_disponible_benevolat boolean default false,
  p_piece_identite_path text default null,
  p_piece_identite_nom text default null,
  p_preuve_paiement_mode text default null,
  p_preuve_paiement_path text default null,
  p_preuve_paiement_nom text default null,
  p_preuve_paiement_montant numeric default null,
  p_preuve_paiement_note text default null
)
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

  insert into public.member_link_requests (
    association_id, profile_id, suggested_member_id, statut,
    courriel, telephone, sexe, date_naissance, quartier, competences, disponible_benevolat,
    piece_identite_path, piece_identite_nom,
    preuve_paiement_mode, preuve_paiement_path, preuve_paiement_nom, preuve_paiement_montant, preuve_paiement_note
  )
  values (
    v_assoc_id, auth.uid(), v_member_id, 'en_attente',
    coalesce(p_courriel, v_email), p_telephone, p_sexe, p_date_naissance, p_quartier, p_competences, coalesce(p_disponible_benevolat, false),
    p_piece_identite_path, p_piece_identite_nom,
    p_preuve_paiement_mode, p_preuve_paiement_path, p_preuve_paiement_nom, p_preuve_paiement_montant, p_preuve_paiement_note
  )
  returning id into v_request_id;

  return json_build_object('association_id', v_assoc_id, 'request_id', v_request_id, 'suggested_member_id', v_member_id);
end;
$$;
grant execute on function public.join_association_with_code(
  text, text, text, text, text, date, text, text, boolean, text, text, text, text, text, numeric, text
) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Bucket de stockage "member-join-documents" (privé)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('member-join-documents', 'member-join-documents', false)
on conflict (id) do nothing;

drop policy if exists "member join docs storage insert" on storage.objects;
drop policy if exists "member join docs storage select" on storage.objects;

-- Chemin attendu : "<auth.uid()>/<identite|paiement>_<horodatage>_<nom_fichier>".
-- Au moment du dépôt, le compte n'a encore ni association_id ni member_id
-- (le profil n'existe pas tant que join_association_with_code() n'a pas
-- été appelée) — la seule clé fiable est donc auth.uid() lui-même.
create policy "member join docs storage insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'member-join-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Consultation : la personne elle-même, ou un membre du bureau de
-- l'association où sa demande a atterri (une fois member_link_requests
-- créée par join_association_with_code() ci-dessus).
create policy "member join docs storage select" on storage.objects for select to authenticated
  using (
    bucket_id = 'member-join-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.member_link_requests r
        where r.profile_id::text = (storage.foldername(name))[1]
          and r.association_id = public.current_association_id()
          and public.is_staff()
      )
    )
  );

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns
--   where table_name = 'member_link_requests' and table_schema = 'public'
--   order by column_name;
--   -- doit inclure toutes les nouvelles colonnes ci-dessus
--
--   select proname, pronargs from pg_proc
--   where proname = 'join_association_with_code';
--   -- doit afficher pronargs = 16
--
--   select id, public from storage.buckets where id = 'member-join-documents';
--   -- doit afficher public = false
-- =====================================================================
