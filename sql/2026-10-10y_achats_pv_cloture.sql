-- =====================================================================
-- Achats groupés : procès-verbal de clôture signé électroniquement,
-- archivé dans Documents (2026-10-10, demandé par l'utilisateur)
-- =====================================================================
--   • Le PV de clôture récapitule l'achat (fournisseur, quantités, coûts
--     estimés et réels, parts, paiements, remises) ;
--   • il est signé électroniquement par le PORTEUR et par le VALIDEUR du
--     bilan (deux personnes distinctes) ; chaque signature fige une
--     empreinte des chiffres de l'achat : si ceux-ci changeaient ensuite,
--     l'écart serait visible ;
--   • une fois les deux signatures posées, le PV (PDF) est archivé dans
--     Documents (rubrique Finances) et rattaché à l'achat.
-- Prérequis : 2026-10-10r (achats_est_porteur), 10x. Ré-exécutable.
-- =====================================================================
alter table public.achats_groupes add column if not exists pv_document_id uuid references public.documents(id) on delete set null;

create table if not exists public.achats_pv_signatures (
  achat_id uuid not null references public.achats_groupes(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  role text not null check (role in ('porteur', 'valideur')),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  nom text,
  signe_le timestamptz not null default now(),
  empreinte text not null,
  primary key (achat_id, role)
);
alter table public.achats_pv_signatures enable row level security;
drop policy if exists "achats_pv_signatures lecture" on public.achats_pv_signatures;
create policy "achats_pv_signatures lecture" on public.achats_pv_signatures for select to authenticated
  using (association_id = public.current_association_id());

-- Empreinte des chiffres de l'achat (totaux, parts, paiements validés, remises).
create or replace function public.achats_empreinte(p_id uuid) returns text
language sql stable security definer set search_path = '' as $fn$
  select md5(concat_ws('|',
    a.id, a.titre, a.fournisseur, a.prix_unitaire, a.total_attribue, a.cout_reel_produits, a.frais_communs_reels, a.bilan_valide_le,
    (select string_agg(concat_ws(':', s.member_id, s.quantite_attribuee, s.part_reelle, s.remis_le), ',' order by s.member_id)
       from public.achats_souscriptions s where s.achat_id = a.id and s.statut = 'retenu'),
    (select coalesce(sum(case m.sens when 'sortie' then -m.montant else m.montant end), 0)
       from public.achats_mouvements m where m.achat_id = a.id and m.statut = 'valide' and m.sens <> 'avoir')))
    from public.achats_groupes a where a.id = p_id
$fn$;
grant execute on function public.achats_empreinte(uuid) to authenticated;

create or replace function public.achats_signer_pv(p_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; p uuid;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'cloture' then raise exception 'Le procès-verbal se signe une fois l''achat clôturé (bilan validé).'; end if;
  if p_role = 'porteur' and not public.achats_est_porteur(p_id) then
    raise exception 'Seul le porteur de l''achat signe en qualité de porteur.';
  end if;
  if p_role = 'valideur' and v_a.bilan_valide_par is distinct from auth.uid() then
    raise exception 'Seul le membre du bureau qui a validé le bilan signe en qualité de valideur.';
  end if;
  if p_role not in ('porteur', 'valideur') then raise exception 'Rôle invalide.'; end if;
  if exists (select 1 from public.achats_pv_signatures where achat_id = p_id and role = p_role) then
    raise exception 'Ce procès-verbal est déjà signé à ce titre.';
  end if;
  if exists (select 1 from public.achats_pv_signatures where achat_id = p_id and profile_id = auth.uid()) then
    raise exception 'Le porteur et le valideur doivent être deux personnes différentes.';
  end if;
  insert into public.achats_pv_signatures (achat_id, association_id, role, profile_id, nom, empreinte)
  values (p_id, v_a.association_id, p_role, auth.uid(), public.achats_nom_courant(), public.achats_empreinte(p_id));
  -- Prévenir l'autre signataire.
  for p in
    select pr.id from public.profiles pr
     where pr.association_id = v_a.association_id and pr.id <> auth.uid()
       and ((p_role = 'porteur' and pr.id = v_a.bilan_valide_par) or (p_role = 'valideur' and pr.member_id = v_a.porteur_member_id))
  loop
    begin
      perform public.notify_profile(v_a.association_id, p, 'PV de clôture à signer', '« ' || left(v_a.titre, 70) || ' » : votre signature électronique est attendue.');
    exception when others then null;
    end;
  end loop;
end;
$fn$;
grant execute on function public.achats_signer_pv(uuid, text) to authenticated;

-- Rattache le PV archivé (une fois les deux signatures posées).
create or replace function public.achats_lier_pv(p_id uuid, p_document uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not (public.is_bureau() or public.achats_est_porteur(p_id)) then
    raise exception 'Non autorisé.';
  end if;
  if (select count(*) from public.achats_pv_signatures where achat_id = p_id) < 2 then
    raise exception 'Le procès-verbal doit être signé par le porteur et par le valideur avant d''être archivé.';
  end if;
  update public.achats_groupes set pv_document_id = p_document where id = p_id;
end;
$fn$;
grant execute on function public.achats_lier_pv(uuid, uuid) to authenticated;

-- Vérification :
--   select proname from pg_proc where proname in ('achats_signer_pv', 'achats_lier_pv', 'achats_empreinte');  -- 3 lignes
