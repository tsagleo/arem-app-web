-- =====================================================================
-- Achats groupés — coopérative d'achat entre membres (2026-10-09)
-- =====================================================================
-- Nouvelle rubrique Premium « Achats groupés » (src/AchatsGroupes.jsx).
-- Attention au vocabulaire : il s'agit d'une COOPÉRATIVE D'ACHAT, pas
-- d'une « mutuelle » (qui désigne une assurance réglementée).
-- L'association ORGANISE l'achat ; elle ne vend rien et ne fait aucun
-- bénéfice : chaque membre paie sa part au coût réel.
--
-- Déroulement d'un achat (colonne achats_groupes.statut) :
--   propose  → un membre propose ; le bureau valide (ouvert) ou refuse ;
--   ouvert   → souscriptions (quantité + charte acceptée) jusqu'à la date
--              limite, barre de progression vers le SEUIL minimum ;
--   confirme → clôture : seuil atteint, les quantités sont attribuées
--              (stock limité : premier arrivé, prorata ou tirage au sort
--              vérifiable) et chacun paie sa part ; seuil non atteint →
--              annule, personne ne paie ;
--   commande → toutes les parts sont payées ET validées (double
--              contrôle) : la commande peut être passée. Personne
--              n'avance l'argent des autres ;
--   livre    → marchandise arrivée, remise aux membres (scan du QR de la
--              carte de membre ou liste) ;
--   cloture  → bilan validé : coût réel (dont livraison) réparti au
--              prorata des quantités ; écart remboursé ou converti en
--              avoir ; complément plafonné à 10 % sauf accord ;
--   annule / refuse.
--
-- Argent (table achats_mouvements) — DOUBLE CONTRÔLE :
--   un mouvement est d'abord « reçu » par le porteur de l'achat (ou un
--   membre du bureau), puis « validé » par un AUTRE membre du bureau.
--   Seuls les mouvements validés comptent dans les soldes et dans la
--   comptabilité. Le bilan suit la même règle (saisi par l'un, validé
--   par un autre).
--
-- Comptabilité : deux comptes DÉDIÉS, jamais mélangés avec la caisse de
-- l'association :
--   1050 « Encaisse — Achats groupés (compte séparé) »   (actif)
--   2100 « Achats groupés — fonds détenus pour les membres » (passif)
--   versement validé       : débit 1050 / crédit 2100
--   remboursement validé   : débit 2100 / crédit 1050
--   bilan validé (fournisseur, livraison) : débit 2100 / crédit 1050
--   ristourne reçue        : débit 1050 / crédit 2100 (redistribuée en avoirs)
--
-- Toute écriture passe par les fonctions ci-dessous (security definer,
-- gardées) : aucune politique INSERT/UPDATE/DELETE sur les tables.
-- Ré-exécutable sans risque.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------
create table if not exists public.achats_groupes (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  titre text not null,
  description text,
  photo_url text,
  fournisseur text,
  unite text not null default 'piece' check (unite in ('piece', 'kg', 'litre', 'm3', 'lot')),
  prix_unitaire numeric(12,2) not null check (prix_unitaire > 0),      -- prix de gros négocié
  prix_detail numeric(12,2) check (prix_detail is null or prix_detail > 0), -- prix en magasin, pour afficher l'économie
  frais_estimes numeric(12,2) not null default 0 check (frais_estimes >= 0), -- livraison / transport estimés (total)
  seuil_min numeric(12,3) not null check (seuil_min > 0),             -- quantité totale minimale
  stock_max numeric(12,3) check (stock_max is null or stock_max > 0), -- quantité disponible (null = illimitée)
  mode_repartition text not null default 'premier_arrive' check (mode_repartition in ('premier_arrive', 'prorata', 'tirage')),
  date_limite timestamptz not null,
  perissable boolean not null default false,
  chaine_froid boolean not null default false,
  statut text not null default 'propose' check (statut in ('propose', 'refuse', 'ouvert', 'confirme', 'commande', 'livre', 'cloture', 'annule')),
  porteur_member_id uuid references public.members(id) on delete set null,
  porteur_nom text,
  propose_par uuid references public.profiles(id),
  propose_par_nom text,
  valide_par uuid references public.profiles(id),
  motif text,                                   -- refus ou annulation
  tirage_id uuid references public.tirages(id) on delete set null,
  total_demande numeric(12,3) not null default 0,
  total_attribue numeric(12,3) not null default 0,
  nb_souscripteurs int not null default 0,
  note_commande text,
  commande_le timestamptz,
  livre_le timestamptz,
  -- Bilan (coût réel)
  cout_reel_produits numeric(12,2),
  frais_communs_reels numeric(12,2),
  note_bilan text,
  bilan_saisi_par uuid references public.profiles(id),
  bilan_saisi_le timestamptz,
  bilan_valide_par uuid references public.profiles(id),
  bilan_valide_le timestamptz,
  plafond_complement_pct numeric(5,2) not null default 10,
  accord_depassement text,                      -- motif de l'accord si le complément dépasse le plafond
  cloture_le timestamptz,
  annule_le timestamptz,
  created_at timestamptz not null default now(),
  -- Charte : pas de denrée périssable sans chaîne du froid.
  constraint achats_perissable_froid check (not perissable or chaine_froid),
  constraint achats_stock_seuil check (stock_max is null or stock_max >= seuil_min)
);

comment on table public.achats_groupes is
  'Achats groupés (coopérative d''achat) : fiche de chaque achat. L''association organise, ne vend pas. Écriture uniquement via les fonctions achats_*.';

create index if not exists achats_groupes_association_idx on public.achats_groupes (association_id, created_at desc);

create table if not exists public.achats_souscriptions (
  id uuid primary key default gen_random_uuid(),
  achat_id uuid not null references public.achats_groupes(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  member_nom text,
  quantite_demandee numeric(12,3) not null check (quantite_demandee > 0),
  quantite_attribuee numeric(12,3) not null default 0,
  statut text not null default 'inscrit' check (statut in ('inscrit', 'retire', 'retenu', 'non_retenu', 'desiste')),
  charte_version text not null default 'v1',
  charte_acceptee_le timestamptz not null,
  montant_du numeric(12,2) not null default 0,  -- part estimée, fixée à la clôture des souscriptions
  part_reelle numeric(12,2),                     -- part au coût réel, fixée au bilan
  remis_le timestamptz,
  remis_par uuid references public.profiles(id),
  remis_par_nom text,
  motif text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (achat_id, member_id)
);

comment on table public.achats_souscriptions is
  'Souscription d''un membre à un achat groupé : quantité demandée, quantité attribuée, part due, remise. Charte acceptée à chaque souscription.';

create index if not exists achats_souscriptions_member_idx on public.achats_souscriptions (member_id);
create index if not exists achats_souscriptions_achat_idx on public.achats_souscriptions (achat_id);

create table if not exists public.achats_mouvements (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  achat_id uuid references public.achats_groupes(id) on delete cascade, -- null pour une ristourne annuelle
  member_id uuid not null references public.members(id) on delete cascade,
  member_nom text,
  -- entree : le membre paie (sa part ou un complément) ;
  -- sortie : l'association lui rembourse un trop-perçu ;
  -- avoir  : le trop-perçu est gardé comme crédit pour un prochain achat
  --          (ou ristourne annuelle) — aucun argent ne bouge.
  sens text not null check (sens in ('entree', 'sortie', 'avoir')),
  objet text not null default 'part' check (objet in ('part', 'complement', 'remboursement', 'avoir', 'ristourne')),
  mode text not null default 'interac' check (mode in ('interac', 'especes', 'virement', 'stripe', 'avoir', 'aucun')),
  montant numeric(12,2) not null check (montant > 0),
  preuve_path text,                              -- capture Interac (bucket interac-proofs)
  reference text,
  note text,
  statut text not null default 'declare' check (statut in ('declare', 'recu', 'valide', 'rejete')),
  declare_par uuid references public.profiles(id),
  declare_le timestamptz not null default now(),
  recu_par uuid references public.profiles(id),
  recu_par_nom text,
  recu_le timestamptz,
  valide_par uuid references public.profiles(id),
  valide_par_nom text,
  valide_le timestamptz,
  motif_rejet text,
  annee_ristourne int,
  created_at timestamptz not null default now()
);

comment on table public.achats_mouvements is
  'Argent des achats groupés, séparé de la caisse. Double contrôle : reçu par le porteur (ou un membre du bureau), validé par un AUTRE membre du bureau.';

create index if not exists achats_mouvements_member_idx on public.achats_mouvements (member_id);
create index if not exists achats_mouvements_achat_idx on public.achats_mouvements (achat_id);
create index if not exists achats_mouvements_association_idx on public.achats_mouvements (association_id, statut);

-- ---------------------------------------------------------------------
-- 2) Sécurité : lecture seulement (les écritures passent par les RPC)
-- ---------------------------------------------------------------------
alter table public.achats_groupes enable row level security;
alter table public.achats_souscriptions enable row level security;
alter table public.achats_mouvements enable row level security;

-- Le porteur d'un achat (membre qui centralise l'argent et la commande)
-- peut gérer CET achat, même s'il n'est pas au bureau.
create or replace function public.achats_est_gestionnaire(p_achat uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select coalesce(public.is_bureau(), false) or exists (
    select 1 from public.achats_groupes a
     where a.id = p_achat and a.association_id = public.current_association_id()
       and a.porteur_member_id is not null and a.porteur_member_id = public.current_member_id()
  )
$fn$;

grant execute on function public.achats_est_gestionnaire(uuid) to authenticated;

-- Fiches : visibles par toute l'association (sauf une proposition pas
-- encore validée, visible seulement par le bureau et son auteur).
drop policy if exists "achats_groupes select" on public.achats_groupes;
create policy "achats_groupes select" on public.achats_groupes for select to authenticated
  using (association_id = public.current_association_id()
         and (statut not in ('propose', 'refuse') or public.is_bureau() or propose_par = auth.uid()));

-- Souscriptions et argent : chacun voit les siens ; le bureau et le
-- porteur voient ceux de l'achat (les autres membres ne voient que les
-- totaux, portés par la fiche).
drop policy if exists "achats_souscriptions select" on public.achats_souscriptions;
create policy "achats_souscriptions select" on public.achats_souscriptions for select to authenticated
  using (association_id = public.current_association_id()
         and (member_id = public.current_member_id() or public.is_staff() or public.achats_est_gestionnaire(achat_id)));

drop policy if exists "achats_mouvements select" on public.achats_mouvements;
create policy "achats_mouvements select" on public.achats_mouvements for select to authenticated
  using (association_id = public.current_association_id()
         and (member_id = public.current_member_id() or public.is_staff()
              or (achat_id is not null and public.achats_est_gestionnaire(achat_id))));

-- ---------------------------------------------------------------------
-- 3) Photos des produits (bucket public « achats-photos »)
--    Chemin : "<association_id>/<horodatage>_<nom>"
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('achats-photos', 'achats-photos', true)
on conflict (id) do nothing;

drop policy if exists "achats photos select" on storage.objects;
create policy "achats photos select" on storage.objects for select to authenticated
  using (bucket_id = 'achats-photos' and (storage.foldername(name))[1] = public.current_association_id()::text);

drop policy if exists "achats photos insert" on storage.objects;
create policy "achats photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'achats-photos' and (storage.foldername(name))[1] = public.current_association_id()::text);

drop policy if exists "achats photos delete" on storage.objects;
create policy "achats photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'achats-photos' and public.is_bureau() and (storage.foldername(name))[1] = public.current_association_id()::text);

-- ---------------------------------------------------------------------
-- 4) Comptes comptables dédiés
-- ---------------------------------------------------------------------
insert into public.comptes_comptables (code, nom, type, ordre) values
  ('1050', 'Encaisse — Achats groupés (compte séparé)', 'actif', 15),
  ('2100', 'Achats groupés — fonds détenus pour les membres', 'passif', 15)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 5) Fonctions utilitaires
-- ---------------------------------------------------------------------

-- Nom affichable de la personne connectée.
create or replace function public.achats_nom_courant() returns text
language sql stable security definer set search_path = '' as $fn$
  select nom_complet from public.profiles where id = auth.uid()
$fn$;

-- Ce que le membre doit pour une souscription : 0 si l'achat est annulé
-- ou s'il n'a pas été retenu ; sinon la part réelle (après bilan) ou, à
-- défaut, la part estimée.
create or replace function public.achats_du(p_sous public.achats_souscriptions) returns numeric
language sql stable security definer set search_path = '' as $fn$
  select case
    when p_sous.statut <> 'retenu' then 0
    when (select a.statut from public.achats_groupes a where a.id = p_sous.achat_id) in ('annule', 'refuse') then 0
    else coalesce(p_sous.part_reelle, p_sous.montant_du)
  end
$fn$;

-- Solde d'un membre pour un achat : positif = l'association lui doit de
-- l'argent ; négatif = il lui reste à payer. Seuls les mouvements
-- VALIDÉS comptent.
create or replace function public.achats_solde(p_achat uuid, p_member uuid) returns numeric
language sql stable security definer set search_path = '' as $fn$
  select coalesce((select sum(case m.sens when 'entree' then m.montant else -m.montant end)
                     from public.achats_mouvements m
                    where m.achat_id = p_achat and m.member_id = p_member and m.statut = 'valide'), 0)
       - coalesce((select public.achats_du(s) from public.achats_souscriptions s
                    where s.achat_id = p_achat and s.member_id = p_member), 0)
$fn$;

-- Avoir disponible d'un membre (crédits moins avoirs déjà utilisés ou en
-- cours d'utilisation).
create or replace function public.achats_avoir_disponible(p_member uuid) returns numeric
language sql stable security definer set search_path = '' as $fn$
  select coalesce(sum(case when m.sens = 'avoir' then m.montant
                           when m.sens = 'entree' and m.mode = 'avoir' then -m.montant
                           else 0 end), 0)
    from public.achats_mouvements m
   where m.member_id = p_member and m.statut <> 'rejete'
$fn$;

-- Remboursements enregistrés mais pas encore validés (pour ne pas
-- rembourser deux fois le même trop-perçu).
create or replace function public.achats_sorties_en_attente(p_achat uuid, p_member uuid) returns numeric
language sql stable security definer set search_path = '' as $fn$
  select coalesce(sum(m.montant), 0) from public.achats_mouvements m
   where m.achat_id = p_achat and m.member_id = p_member and m.sens = 'sortie' and m.statut in ('declare', 'recu')
$fn$;

grant execute on function public.achats_solde(uuid, uuid) to authenticated;
grant execute on function public.achats_avoir_disponible(uuid) to authenticated;

-- Totaux de la fiche (barre de progression visible par tous).
create or replace function public.achats_recalculer(p_achat uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.achats_groupes a set
    total_demande = coalesce((select sum(s.quantite_demandee) from public.achats_souscriptions s
                               where s.achat_id = p_achat and s.statut in ('inscrit', 'retenu', 'non_retenu')), 0),
    total_attribue = coalesce((select sum(s.quantite_attribuee) from public.achats_souscriptions s
                                where s.achat_id = p_achat and s.statut = 'retenu'), 0),
    nb_souscripteurs = (select count(*) from public.achats_souscriptions s
                         where s.achat_id = p_achat and s.statut in ('inscrit', 'retenu', 'non_retenu'))
   where a.id = p_achat;
end;
$fn$;

-- Notification push (Edge Function send-push-notification, même patron
-- que les autres notifications). p_tous = toute l'association ; sinon
-- les souscripteurs de l'achat. Ne bloque jamais l'action en cas d'échec.
create or replace function public.achats_notifier(p_achat uuid, p_titre text, p_corps text, p_tous boolean default false) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_secret text;
  v_assoc uuid;
  v_nom_assoc text;
  v_logo text;
  v_profiles uuid[];
begin
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_internal_secret';
    if v_secret is null then return; end if;
    select a.association_id into v_assoc from public.achats_groupes a where a.id = p_achat;
    select s.nom, s.logo_url into v_nom_assoc, v_logo from public.associations s where s.id = v_assoc;

    if not p_tous then
      select array_agg(p.id) into v_profiles
        from public.profiles p
        join public.achats_souscriptions s on s.member_id = p.member_id
       where s.achat_id = p_achat and s.statut in ('inscrit', 'retenu', 'non_retenu', 'desiste');
      -- Liste vide : surtout ne pas envoyer sans profile_ids (ce serait
      -- envoyé à toute l'association).
      if v_profiles is null or array_length(v_profiles, 1) = 0 then return; end if;
    end if;

    perform net.http_post(
      url := 'https://hqqvkwvobmesgwbdjdko.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
      body := jsonb_build_object(
        'association_id', v_assoc,
        'title', '🛒 ' || coalesce(v_nom_assoc, 'Achats groupés') || ' — ' || p_titre,
        'body', coalesce(p_corps, ''),
        'icon', v_logo,
        'url', '/'
      ) || case when p_tous then '{}'::jsonb else jsonb_build_object('profile_ids', to_jsonb(v_profiles)) end
    );
  exception when others then
    -- pg_net absent, secret manquant, etc. : la notification est perdue,
    -- mais l'action du bureau aboutit.
    return;
  end;
end;
$fn$;

revoke all on function public.achats_recalculer(uuid) from public, anon, authenticated;
revoke all on function public.achats_notifier(uuid, text, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6) Proposition et validation
-- ---------------------------------------------------------------------
-- p : {titre, description, photo_url, fournisseur, unite, prix_unitaire,
--      prix_detail, frais_estimes, seuil_min, stock_max, mode_repartition,
--      date_limite, perissable, chaine_froid, porteur_member_id}
create or replace function public.achats_proposer(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_bureau boolean := coalesce(public.is_bureau(), false);
  v_id uuid;
  v_porteur uuid;
  v_porteur_nom text;
begin
  if v_assoc is null or (not v_bureau and public.current_member_id() is null) then raise exception 'Non autorisé.'; end if;
  if coalesce(trim(p->>'titre'), '') = '' then raise exception 'Le nom du produit ou service est requis.'; end if;
  if coalesce((p->>'perissable')::boolean, false) and not coalesce((p->>'chaine_froid')::boolean, false) then
    raise exception 'Charte : pas de produit périssable sans chaîne du froid.';
  end if;
  if (p->>'date_limite')::timestamptz <= now() then raise exception 'La date limite doit être dans le futur.'; end if;

  -- Porteur : choisi par le bureau ; par défaut, l'auteur de la proposition.
  v_porteur := coalesce(nullif(p->>'porteur_member_id', '')::uuid, public.current_member_id());
  select m.nom into v_porteur_nom from public.members m where m.id = v_porteur and m.association_id = v_assoc;
  if v_porteur_nom is null then v_porteur := null; end if;

  insert into public.achats_groupes (
    association_id, titre, description, photo_url, fournisseur, unite, prix_unitaire, prix_detail,
    frais_estimes, seuil_min, stock_max, mode_repartition, date_limite, perissable, chaine_froid,
    statut, porteur_member_id, porteur_nom, propose_par, propose_par_nom, valide_par
  ) values (
    v_assoc, trim(p->>'titre'), nullif(trim(p->>'description'), ''), nullif(p->>'photo_url', ''),
    nullif(trim(p->>'fournisseur'), ''), coalesce(nullif(p->>'unite', ''), 'piece'),
    (p->>'prix_unitaire')::numeric, nullif(p->>'prix_detail', '')::numeric,
    coalesce(nullif(p->>'frais_estimes', '')::numeric, 0), (p->>'seuil_min')::numeric,
    nullif(p->>'stock_max', '')::numeric, coalesce(nullif(p->>'mode_repartition', ''), 'premier_arrive'),
    (p->>'date_limite')::timestamptz, coalesce((p->>'perissable')::boolean, false),
    coalesce((p->>'chaine_froid')::boolean, false),
    case when v_bureau then 'ouvert' else 'propose' end,
    v_porteur, v_porteur_nom, auth.uid(), public.achats_nom_courant(),
    case when v_bureau then auth.uid() end
  ) returning id into v_id;

  if v_bureau then
    perform public.achats_notifier(v_id, 'Nouvel achat groupé', trim(p->>'titre') || ' — souscriptions ouvertes.', true);
  end if;
  return v_id;
end;
$fn$;

-- Modification par le bureau tant que personne n'a été retenu (statut
-- propose ou ouvert). Mêmes champs que achats_proposer.
create or replace function public.achats_modifier(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_porteur uuid;
  v_porteur_nom text;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
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

create or replace function public.achats_valider_proposition(p_id uuid, p_ok boolean, p_motif text default null) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'propose' then raise exception 'Cette proposition a déjà été traitée.'; end if;
  if p_ok then
    if v_a.date_limite <= now() then raise exception 'La date limite est dépassée : modifiez-la avant de valider.'; end if;
    update public.achats_groupes set statut = 'ouvert', valide_par = auth.uid() where id = p_id;
    perform public.achats_notifier(p_id, 'Nouvel achat groupé', v_a.titre || ' — souscriptions ouvertes.', true);
  else
    if coalesce(trim(p_motif), '') = '' then raise exception 'Motif du refus requis.'; end if;
    update public.achats_groupes set statut = 'refuse', motif = trim(p_motif), valide_par = auth.uid() where id = p_id;
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 7) Souscription des membres
-- ---------------------------------------------------------------------
create or replace function public.achats_souscrire(p_id uuid, p_quantite numeric, p_charte boolean) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_member uuid := public.current_member_id();
  v_nom text;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or v_member is null then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'ouvert' then raise exception 'Les souscriptions sont fermées pour cet achat.'; end if;
  if v_a.date_limite <= now() then raise exception 'La date limite de souscription est dépassée.'; end if;
  if not coalesce(p_charte, false) then raise exception 'Vous devez accepter la charte des achats groupés.'; end if;
  if p_quantite is null or p_quantite <= 0 then raise exception 'Quantité invalide.'; end if;
  if v_a.unite in ('piece', 'lot') and p_quantite <> trunc(p_quantite) then raise exception 'La quantité doit être un nombre entier.'; end if;

  select m.nom into v_nom from public.members m where m.id = v_member;

  -- La charte est ré-acceptée (et horodatée) à chaque souscription ou
  -- changement de quantité.
  insert into public.achats_souscriptions as s (achat_id, association_id, member_id, member_nom, quantite_demandee, statut, charte_acceptee_le)
  values (p_id, v_a.association_id, v_member, v_nom, p_quantite, 'inscrit', now())
  on conflict (achat_id, member_id) do update
     set quantite_demandee = excluded.quantite_demandee, statut = 'inscrit',
         charte_acceptee_le = now(), updated_at = now(),
         -- Re-souscrire après un retrait : on repart de la fin de la file
         -- (« premier arrivé »).
         created_at = case when s.statut = 'retire' then now() else s.created_at end;

  perform public.achats_recalculer(p_id);
end;
$fn$;

create or replace function public.achats_retirer(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'ouvert' then raise exception 'Il n''est plus possible de se retirer : contactez le porteur de l''achat.'; end if;
  update public.achats_souscriptions set statut = 'retire', updated_at = now()
   where achat_id = p_id and member_id = public.current_member_id();
  perform public.achats_recalculer(p_id);
end;
$fn$;

-- ---------------------------------------------------------------------
-- 8) Clôture des souscriptions : seuil, répartition du stock, part due
-- ---------------------------------------------------------------------
create or replace function public.achats_lier_tirage(p_id uuid, p_tirage uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if not exists (select 1 from public.tirages t where t.id = p_tirage and t.association_id = v_a.association_id) then
    raise exception 'Tirage introuvable.';
  end if;
  update public.achats_groupes set tirage_id = p_tirage where id = p_id;
end;
$fn$;

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
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_gestionnaire(p_id) then raise exception 'Non autorisé.'; end if;
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

-- Retirer un souscripteur qui ne paie pas (avant la commande) : sa
-- quantité est libérée, ce qu'il a déjà versé lui sera remboursé.
create or replace function public.achats_retirer_souscripteur(p_sous uuid, p_motif text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_s public.achats_souscriptions;
  v_a public.achats_groupes;
begin
  select * into v_s from public.achats_souscriptions where id = p_sous for update;
  select * into v_a from public.achats_groupes where id = v_s.achat_id for update;
  if v_s.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_a.statut not in ('ouvert', 'confirme') then raise exception 'Trop tard : la commande est déjà passée.'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Motif requis.'; end if;
  update public.achats_souscriptions set statut = 'desiste', quantite_attribuee = 0, montant_du = 0, motif = trim(p_motif), updated_at = now()
   where id = p_sous;
  perform public.achats_recalculer(v_a.id);
end;
$fn$;

-- ---------------------------------------------------------------------
-- 9) Argent : déclaration, réception, validation (double contrôle)
-- ---------------------------------------------------------------------

-- Le membre déclare son propre paiement : Interac (avec capture) ou
-- paiement par son avoir (validé tout de suite, aucun argent ne bouge).
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
  if p_mode not in ('interac', 'avoir') then raise exception 'Mode de paiement invalide.'; end if;

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
    if coalesce(p_preuve_path, '') = '' then raise exception 'Joignez la capture du virement Interac.'; end if;
    insert into public.achats_mouvements (association_id, achat_id, member_id, member_nom, sens, objet, mode, montant,
                                          preuve_path, reference, statut, declare_par)
    values (v_a.association_id, p_achat, v_member, v_s.member_nom, 'entree',
            case when v_a.statut = 'cloture' then 'complement' else 'part' end, 'interac', p_montant,
            p_preuve_path, nullif(trim(p_reference), ''), 'declare', auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end;
$fn$;

-- Le porteur (ou un membre du bureau) enregistre de l'argent reçu en main
-- propre (entree) ou versé à un membre (sortie = remboursement).
-- Le mouvement est « reçu » : il reste à le faire valider par un autre
-- membre du bureau.
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
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_gestionnaire(p_achat) then raise exception 'Non autorisé.'; end if;
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

-- Premier contrôle : le porteur confirme avoir reçu le virement déclaré.
create or replace function public.achats_confirmer_reception(p_mvt uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_m public.achats_mouvements;
begin
  select * into v_m from public.achats_mouvements where id = p_mvt for update;
  if v_m.id is null or v_m.association_id <> public.current_association_id() or v_m.achat_id is null
     or not public.achats_est_gestionnaire(v_m.achat_id) then raise exception 'Non autorisé.'; end if;
  if v_m.statut <> 'declare' then raise exception 'Ce paiement a déjà été traité.'; end if;
  update public.achats_mouvements set statut = 'recu', recu_par = auth.uid(), recu_par_nom = public.achats_nom_courant(), recu_le = now()
   where id = p_mvt;
end;
$fn$;

-- Second contrôle : un AUTRE membre du bureau valide. Écriture comptable
-- sur les comptes dédiés.
create or replace function public.achats_valider_mouvement(p_mvt uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_m public.achats_mouvements;
  v_titre text;
begin
  select * into v_m from public.achats_mouvements where id = p_mvt for update;
  if v_m.id is null or v_m.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_m.statut <> 'recu' then raise exception 'Ce mouvement doit d''abord être confirmé « reçu » par le porteur.'; end if;
  if v_m.recu_par = auth.uid() then
    raise exception 'Double contrôle : la validation doit être faite par un autre membre du bureau que celui qui a reçu l''argent.';
  end if;

  update public.achats_mouvements set statut = 'valide', valide_par = auth.uid(), valide_par_nom = public.achats_nom_courant(), valide_le = now()
   where id = p_mvt;

  select a.titre into v_titre from public.achats_groupes a where a.id = v_m.achat_id;
  if v_m.sens = 'entree' and v_m.mode <> 'avoir' then
    perform public.poster_ecriture_signee(v_m.association_id, current_date, '1050', '2100', 'general', v_m.montant,
      'Achat groupé « ' || coalesce(v_titre, '') || ' » — versement de ' || coalesce(v_m.member_nom, ''), 'achats_mouvements', v_m.id);
  elsif v_m.sens = 'sortie' then
    perform public.poster_ecriture_signee(v_m.association_id, current_date, '2100', '1050', 'general', v_m.montant,
      'Achat groupé « ' || coalesce(v_titre, '') || ' » — remboursement à ' || coalesce(v_m.member_nom, ''), 'achats_mouvements', v_m.id);
  end if;
end;
$fn$;

create or replace function public.achats_rejeter_mouvement(p_mvt uuid, p_motif text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_m public.achats_mouvements;
begin
  select * into v_m from public.achats_mouvements where id = p_mvt for update;
  if v_m.id is null or v_m.association_id <> public.current_association_id() or v_m.achat_id is null
     or not public.achats_est_gestionnaire(v_m.achat_id) then raise exception 'Non autorisé.'; end if;
  if v_m.statut not in ('declare', 'recu') then raise exception 'Un mouvement validé ne peut plus être rejeté.'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Motif requis.'; end if;
  update public.achats_mouvements set statut = 'rejete', motif_rejet = trim(p_motif) where id = p_mvt;
end;
$fn$;

-- Trop-perçu converti en avoir (par le membre lui-même ou le bureau) :
-- l'argent reste sur le compte dédié, crédité au membre pour un
-- prochain achat. Aucun mouvement de banque.
create or replace function public.achats_convertir_avoir(p_achat uuid, p_member uuid, p_montant numeric) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_nom text;
begin
  select * into v_a from public.achats_groupes where id = p_achat;
  if v_a.id is null or v_a.association_id <> public.current_association_id()
     or not (public.is_bureau() or p_member = public.current_member_id()) then raise exception 'Non autorisé.'; end if;
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

-- ---------------------------------------------------------------------
-- 10) Commande, livraison, remise
-- ---------------------------------------------------------------------
create or replace function public.achats_passer_commande(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_impayes int;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
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

create or replace function public.achats_marquer_livre(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_gestionnaire(p_id) then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'commande' then raise exception 'La commande n''a pas encore été passée.'; end if;
  update public.achats_groupes set statut = 'livre', livre_le = now() where id = p_id;
  perform public.achats_notifier(p_id, v_a.titre, 'Votre commande est arrivée : présentez votre carte de membre pour la récupérer.');
end;
$fn$;

-- Remise à un membre : par le jeton de sa carte de membre (scan QR) ou
-- par sa souscription (liste). Renvoie ce qu'il faut lui remettre.
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
    select m.id into v_member from public.members m where m.verification_token = p_token and m.association_id = v_a.association_id;
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

-- ---------------------------------------------------------------------
-- 11) Bilan : coût réel, répartition, plafond du complément
-- ---------------------------------------------------------------------
create or replace function public.achats_saisir_bilan(p_id uuid, p_cout_produits numeric, p_frais_communs numeric, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.achats_est_gestionnaire(p_id) then raise exception 'Non autorisé.'; end if;
  if v_a.statut not in ('commande', 'livre') then raise exception 'Le bilan se fait après la commande.'; end if;
  if p_cout_produits is null or p_cout_produits < 0 or coalesce(p_frais_communs, 0) < 0 then raise exception 'Montants invalides.'; end if;
  update public.achats_groupes set cout_reel_produits = round(p_cout_produits, 2), frais_communs_reels = round(coalesce(p_frais_communs, 0), 2),
         note_bilan = nullif(trim(p_note), ''), bilan_saisi_par = auth.uid(), bilan_saisi_le = now()
   where id = p_id;
end;
$fn$;

create or replace function public.achats_valider_bilan(p_id uuid, p_accord text default null) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
  v_total numeric;
  v_max_depassement numeric;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_a.statut not in ('commande', 'livre') then raise exception 'Ce bilan ne peut pas être validé à ce stade.'; end if;
  if v_a.bilan_saisi_par is null then raise exception 'Le bilan n''a pas encore été saisi.'; end if;
  if v_a.bilan_saisi_par = auth.uid() then
    raise exception 'Double contrôle : le bilan doit être validé par un autre membre du bureau que celui qui l''a saisi.';
  end if;
  if v_a.total_attribue <= 0 then raise exception 'Aucune quantité attribuée.'; end if;

  v_total := v_a.cout_reel_produits + v_a.frais_communs_reels;

  -- Complément demandé à chacun, en % de sa part estimée : plafonné à
  -- 10 % sauf accord (consigné).
  select coalesce(max(case when s.montant_du > 0
                           then (round(v_total * s.quantite_attribuee / v_a.total_attribue, 2) - s.montant_du) / s.montant_du * 100
                           else 0 end), 0)
    into v_max_depassement
    from public.achats_souscriptions s where s.achat_id = p_id and s.statut = 'retenu';
  if v_max_depassement > v_a.plafond_complement_pct and coalesce(trim(p_accord), '') = '' then
    raise exception 'Le coût réel dépasse la part estimée de % %% (plafond : % %%). Indiquez l''accord obtenu des membres pour valider.',
      round(v_max_depassement, 1), v_a.plafond_complement_pct;
  end if;

  -- Coût réel (produits + frais communs) réparti au prorata des quantités.
  update public.achats_souscriptions s
     set part_reelle = round(v_total * s.quantite_attribuee / v_a.total_attribue, 2), updated_at = now()
   where s.achat_id = p_id and s.statut = 'retenu';

  update public.achats_groupes set statut = 'cloture', cloture_le = now(), bilan_valide_par = auth.uid(), bilan_valide_le = now(),
         accord_depassement = nullif(trim(p_accord), '')
   where id = p_id;

  -- Paiement du fournisseur et des frais, depuis le compte dédié.
  perform public.poster_ecriture_signee(v_a.association_id, current_date, '2100', '1050', 'general', v_total,
    'Achat groupé « ' || v_a.titre || ' » — fournisseur et frais communs (coût réel)', 'achats_groupes', v_a.id);

  perform public.achats_notifier(p_id, v_a.titre,
    'Bilan validé : consultez votre relevé (remboursement, avoir ou complément éventuel).');
end;
$fn$;

create or replace function public.achats_annuler(p_id uuid, p_motif text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_a.statut in ('cloture', 'annule', 'refuse') then raise exception 'Cet achat ne peut plus être annulé.'; end if;
  if v_a.statut in ('commande', 'livre') then raise exception 'La commande est passée : faites le bilan plutôt qu''une annulation.'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Motif requis.'; end if;
  update public.achats_groupes set statut = 'annule', motif = trim(p_motif), annule_le = now() where id = p_id;
  perform public.achats_notifier(p_id, v_a.titre, 'Achat annulé : ' || trim(p_motif) || '. Tout montant déjà versé vous sera remboursé.');
end;
$fn$;

-- ---------------------------------------------------------------------
-- 12) Ristourne annuelle : une remise reçue (fournisseur, surplus…) est
--     redistribuée en AVOIRS au prorata des achats réels de l'année.
-- ---------------------------------------------------------------------
create or replace function public.achats_ristourne(p_annee int, p_montant numeric, p_note text default null) returns int
language plpgsql security definer set search_path = '' as $fn$
declare
  v_assoc uuid := public.current_association_id();
  v_total numeric;
  v_reste numeric;
  v_part numeric;
  v_n int := 0;
  v_r record;
  v_tz text;
begin
  if v_assoc is null or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if p_montant is null or p_montant <= 0 then raise exception 'Montant invalide.'; end if;
  select coalesce(fuseau_horaire, 'America/Moncton') into v_tz from public.associations where id = v_assoc;

  select sum(x.total) into v_total from (
    select sum(s.part_reelle) as total
      from public.achats_souscriptions s
      join public.achats_groupes a on a.id = s.achat_id
     where a.association_id = v_assoc and a.statut = 'cloture' and s.statut = 'retenu' and s.part_reelle > 0
       and extract(year from a.cloture_le at time zone v_tz) = p_annee
     group by s.member_id
  ) x;
  if coalesce(v_total, 0) <= 0 then raise exception 'Aucun achat clôturé en %.', p_annee; end if;

  v_reste := round(p_montant, 2);
  for v_r in
    select s.member_id, max(s.member_nom) as member_nom, sum(s.part_reelle) as total
      from public.achats_souscriptions s
      join public.achats_groupes a on a.id = s.achat_id
     where a.association_id = v_assoc and a.statut = 'cloture' and s.statut = 'retenu' and s.part_reelle > 0
       and extract(year from a.cloture_le at time zone v_tz) = p_annee
     group by s.member_id
     order by 3 desc
  loop
    v_part := least(v_reste, round(p_montant * v_r.total / v_total, 2));
    if v_part > 0 then
      insert into public.achats_mouvements (association_id, achat_id, member_id, member_nom, sens, objet, mode, montant, statut,
                                            declare_par, recu_par, recu_par_nom, recu_le, valide_par, valide_par_nom, valide_le,
                                            note, annee_ristourne)
      values (v_assoc, null, v_r.member_id, v_r.member_nom, 'avoir', 'ristourne', 'aucun', v_part, 'valide',
              auth.uid(), auth.uid(), public.achats_nom_courant(), now(), auth.uid(), public.achats_nom_courant(), now(),
              coalesce(nullif(trim(p_note), ''), 'Ristourne annuelle ' || p_annee), p_annee);
      v_reste := v_reste - v_part;
      v_n := v_n + 1;
    end if;
  end loop;

  -- La remise reçue entre sur le compte dédié et devient dette envers
  -- les membres (leurs avoirs).
  perform public.poster_ecriture_signee(v_assoc, current_date, '1050', '2100', 'general', round(p_montant, 2) - v_reste,
    'Achats groupés — ristourne ' || p_annee || ' redistribuée en avoirs', 'achats_ristourne', null);
  return v_n;
end;
$fn$;

grant execute on function public.achats_proposer(jsonb) to authenticated;
grant execute on function public.achats_modifier(uuid, jsonb) to authenticated;
grant execute on function public.achats_valider_proposition(uuid, boolean, text) to authenticated;
grant execute on function public.achats_souscrire(uuid, numeric, boolean) to authenticated;
grant execute on function public.achats_retirer(uuid) to authenticated;
grant execute on function public.achats_lier_tirage(uuid, uuid) to authenticated;
grant execute on function public.achats_cloturer(uuid) to authenticated;
grant execute on function public.achats_retirer_souscripteur(uuid, text) to authenticated;
grant execute on function public.achats_declarer_paiement(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.achats_enregistrer_mouvement(uuid, uuid, text, numeric, text, text) to authenticated;
grant execute on function public.achats_confirmer_reception(uuid) to authenticated;
grant execute on function public.achats_valider_mouvement(uuid) to authenticated;
grant execute on function public.achats_rejeter_mouvement(uuid, text) to authenticated;
grant execute on function public.achats_convertir_avoir(uuid, uuid, numeric) to authenticated;
grant execute on function public.achats_passer_commande(uuid, text) to authenticated;
grant execute on function public.achats_marquer_livre(uuid) to authenticated;
grant execute on function public.achats_remettre(uuid, uuid, uuid) to authenticated;
grant execute on function public.achats_saisir_bilan(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.achats_valider_bilan(uuid, text) to authenticated;
grant execute on function public.achats_annuler(uuid, text) to authenticated;
grant execute on function public.achats_ristourne(int, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- 13) Journal d'activité (changements de statut seulement)
-- ---------------------------------------------------------------------
drop trigger if exists trg_log_achats_groupes on public.achats_groupes;
create trigger trg_log_achats_groupes after insert or update of statut, bilan_saisi_le on public.achats_groupes
for each row execute function public.log_activity();

drop trigger if exists trg_log_achats_souscriptions on public.achats_souscriptions;
create trigger trg_log_achats_souscriptions after insert or update of statut, remis_le on public.achats_souscriptions
for each row execute function public.log_activity();

drop trigger if exists trg_log_achats_mouvements on public.achats_mouvements;
create trigger trg_log_achats_mouvements after insert or update of statut on public.achats_mouvements
for each row execute function public.log_activity();

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) : 3 tables, 2 comptes, ~25 fonctions.
-- ---------------------------------------------------------------------
-- select tablename from pg_tables where tablename like 'achats_%';
-- select code, nom from public.comptes_comptables where code in ('1050', '2100');
-- select proname from pg_proc where proname like 'achats_%' order by 1;
