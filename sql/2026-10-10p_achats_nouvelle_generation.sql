-- =====================================================================
-- Achats groupés — nouvelle génération (2026-10-10, demandé par
-- l'utilisateur : « tout en même temps »)
-- =====================================================================
-- 1. Pilotage : notification du bureau dès qu'un paiement ou un bilan
--    attend la validation d'un AUTRE membre ; détection et fusion des
--    fiches adhérents en double ; remise par procuration.
-- 2. Argent : paiement de sa part par carte (Stripe, via la fonction
--    create-checkout-session), date limite de paiement avec rappels
--    automatiques et libération des parts impayées, facture du
--    fournisseur jointe au bilan.
-- 3. Coopérative : sondage d'intérêt avant l'ouverture, comparaison de
--    devis avec vote des membres, créneaux et points de retrait, suivi
--    d'expédition (colis, conteneur), avis sur le fournisseur.
-- Prérequis : sql/2026-10-09e_achats_groupes.sql. Ré-exécutable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Colonnes et statut « sondage »
-- ---------------------------------------------------------------------
alter table public.achats_groupes drop constraint if exists achats_groupes_statut_check;
alter table public.achats_groupes add constraint achats_groupes_statut_check
  check (statut in ('sondage', 'propose', 'refuse', 'ouvert', 'confirme', 'commande', 'livre', 'cloture', 'annule'));
alter table public.achats_groupes
  add column if not exists date_limite_paiement timestamptz,
  add column if not exists facture_path text,
  add column if not exists suivi_numero text,
  add column if not exists suivi_transporteur text;
alter table public.achats_souscriptions
  add column if not exists creneau_id uuid,
  add column if not exists remis_a_nom text,
  add column if not exists rappel_paiement_le date;
alter table public.achats_mouvements drop constraint if exists achats_mouvements_reference_stripe_key;
create unique index if not exists achats_mouvements_stripe_ref on public.achats_mouvements (reference) where mode = 'stripe';

-- ---------------------------------------------------------------------
-- 1) Nouvelles tables
-- ---------------------------------------------------------------------
create table if not exists public.achats_interets (
  achat_id uuid not null references public.achats_groupes(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  member_nom text,
  quantite numeric(12,3) not null check (quantite > 0),
  created_at timestamptz not null default now(),
  primary key (achat_id, member_id)
);
create table if not exists public.achats_devis (
  id uuid primary key default gen_random_uuid(),
  achat_id uuid not null references public.achats_groupes(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  fournisseur text not null check (length(trim(fournisseur)) between 1 and 200),
  prix_unitaire numeric(12,2) not null check (prix_unitaire > 0),
  frais numeric(12,2) not null default 0 check (frais >= 0),
  delai text,
  note text,
  retenu boolean not null default false,
  cree_par_nom text,
  created_at timestamptz not null default now()
);
create table if not exists public.achats_devis_votes (
  devis_id uuid not null references public.achats_devis(id) on delete cascade,
  achat_id uuid not null references public.achats_groupes(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (achat_id, member_id)
);
create table if not exists public.achats_creneaux (
  id uuid primary key default gen_random_uuid(),
  achat_id uuid not null references public.achats_groupes(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  lieu text not null check (length(trim(lieu)) between 1 and 200),
  debut timestamptz not null,
  fin timestamptz not null,
  capacite int check (capacite is null or capacite > 0),
  check (fin > debut)
);
create table if not exists public.achats_suivi (
  id uuid primary key default gen_random_uuid(),
  achat_id uuid not null references public.achats_groupes(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  etape text not null check (length(trim(etape)) between 1 and 200),
  lieu text,
  note text,
  auteur_nom text,
  created_at timestamptz not null default now()
);
create table if not exists public.achats_avis (
  achat_id uuid not null references public.achats_groupes(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  member_nom text,
  fournisseur text,
  note_qualite int not null check (note_qualite between 1 and 5),
  note_delai int not null check (note_delai between 1 and 5),
  commentaire text check (commentaire is null or length(commentaire) <= 1000),
  created_at timestamptz not null default now(),
  primary key (achat_id, member_id)
);

do $$
declare t text;
begin
  foreach t in array array['achats_interets', 'achats_devis', 'achats_devis_votes', 'achats_creneaux', 'achats_suivi', 'achats_avis'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s lecture" on public.%I', t, t);
    execute format('create policy "%s lecture" on public.%I for select to authenticated using (association_id = public.current_association_id())', t, t);
  end loop;
end $$;
-- Les intérêts nominatifs ne sont visibles que du membre lui-même et des gestionnaires.
drop policy if exists "achats_interets lecture" on public.achats_interets;
create policy "achats_interets lecture" on public.achats_interets for select to authenticated
  using (association_id = public.current_association_id()
         and (member_id = public.current_member_id() or public.is_bureau() or public.achats_est_gestionnaire(achat_id)));

create or replace function public.achats_interets_totaux() returns table (achat_id uuid, nb int, total numeric)
language sql stable security definer set search_path = '' as $fn$
  select i.achat_id, count(*)::int, sum(i.quantite) from public.achats_interets i
   where i.association_id = public.current_association_id() group by i.achat_id
$fn$;
grant execute on function public.achats_interets_totaux() to authenticated;

-- ---------------------------------------------------------------------
-- 2) Sondage d'intérêt
-- ---------------------------------------------------------------------
create or replace function public.achats_passer_en_sondage(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_a.statut not in ('propose', 'ouvert') or exists (select 1 from public.achats_souscriptions where achat_id = p_id and statut <> 'retire') then
    raise exception 'Le sondage n''est possible qu''avant toute souscription.';
  end if;
  update public.achats_groupes set statut = 'sondage', valide_par = auth.uid() where id = p_id;
  perform public.achats_notifier(p_id, 'Sondage d''intérêt', v_a.titre || ' — seriez-vous intéressé(e) ? Indiquez une quantité, sans engagement.', true);
end;
$fn$;

create or replace function public.achats_declarer_interet(p_id uuid, p_quantite numeric) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; v_m uuid := public.current_member_id();
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or v_m is null then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'sondage' then raise exception 'Ce sondage est terminé.'; end if;
  if coalesce(p_quantite, 0) <= 0 then
    delete from public.achats_interets where achat_id = p_id and member_id = v_m;
  else
    insert into public.achats_interets (achat_id, association_id, member_id, member_nom, quantite)
    values (p_id, v_a.association_id, v_m, (select nom from public.members where id = v_m), p_quantite)
    on conflict (achat_id, member_id) do update set quantite = excluded.quantite, created_at = now();
  end if;
end;
$fn$;

create or replace function public.achats_ouvrir_souscriptions(p_id uuid, p_date_limite timestamptz) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; p uuid;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'sondage' then raise exception 'Cet achat n''est pas en sondage.'; end if;
  if p_date_limite is null or p_date_limite <= now() then raise exception 'La date limite doit être dans le futur.'; end if;
  update public.achats_groupes set statut = 'ouvert', date_limite = p_date_limite where id = p_id;
  for p in select pr.id from public.profiles pr join public.achats_interets i on i.member_id = pr.member_id where i.achat_id = p_id loop
    begin
      perform public.notify_profile(v_a.association_id, p, 'Souscriptions ouvertes : ' || left(v_a.titre, 80),
        'Vous aviez marqué votre intérêt : souscrivez avant la date limite pour confirmer.');
    exception when others then null;
    end;
  end loop;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 3) Devis et vote
-- ---------------------------------------------------------------------
create or replace function public.achats_ajouter_devis(p_id uuid, p_fournisseur text, p_prix numeric, p_frais numeric, p_delai text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; v_id uuid;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not (public.is_bureau() or public.achats_est_gestionnaire(p_id)) then raise exception 'Non autorisé.'; end if;
  if v_a.statut not in ('sondage', 'propose', 'ouvert') then raise exception 'Les devis se comparent avant la clôture des souscriptions.'; end if;
  insert into public.achats_devis (achat_id, association_id, fournisseur, prix_unitaire, frais, delai, note, cree_par_nom)
  values (p_id, v_a.association_id, trim(p_fournisseur), p_prix, coalesce(p_frais, 0), nullif(trim(coalesce(p_delai, '')), ''), nullif(trim(coalesce(p_note, '')), ''), public.achats_nom_courant())
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.achats_supprimer_devis(p_devis uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_d public.achats_devis;
begin
  select * into v_d from public.achats_devis where id = p_devis;
  if v_d.id is null or v_d.association_id <> public.current_association_id() or not (public.is_bureau() or public.achats_est_gestionnaire(v_d.achat_id)) then raise exception 'Non autorisé.'; end if;
  delete from public.achats_devis where id = p_devis;
end;
$fn$;

create or replace function public.achats_voter_devis(p_devis uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_d public.achats_devis; v_m uuid := public.current_member_id();
begin
  select * into v_d from public.achats_devis where id = p_devis;
  if v_d.id is null or v_d.association_id <> public.current_association_id() or v_m is null then raise exception 'Non autorisé.'; end if;
  if exists (select 1 from public.achats_devis_votes where achat_id = v_d.achat_id and member_id = v_m and devis_id = p_devis) then
    delete from public.achats_devis_votes where achat_id = v_d.achat_id and member_id = v_m;
  else
    insert into public.achats_devis_votes (devis_id, achat_id, association_id, member_id) values (p_devis, v_d.achat_id, v_d.association_id, v_m)
    on conflict (achat_id, member_id) do update set devis_id = excluded.devis_id, created_at = now();
  end if;
end;
$fn$;

-- Le devis retenu devient le prix de l'achat (avant toute souscription).
create or replace function public.achats_retenir_devis(p_devis uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_d public.achats_devis; v_a public.achats_groupes;
begin
  select * into v_d from public.achats_devis where id = p_devis;
  select * into v_a from public.achats_groupes where id = v_d.achat_id for update;
  if v_d.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if not (v_a.statut in ('sondage', 'propose') or (v_a.statut = 'ouvert' and not exists (select 1 from public.achats_souscriptions where achat_id = v_a.id and statut <> 'retire'))) then
    raise exception 'Le prix ne peut plus changer : des membres ont déjà souscrit.';
  end if;
  update public.achats_devis set retenu = (id = p_devis) where achat_id = v_a.id;
  update public.achats_groupes set fournisseur = v_d.fournisseur, prix_unitaire = v_d.prix_unitaire, frais_estimes = v_d.frais where id = v_a.id;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 4) Créneaux et points de retrait
-- ---------------------------------------------------------------------
create or replace function public.achats_ajouter_creneau(p_id uuid, p_lieu text, p_debut timestamptz, p_fin timestamptz, p_capacite int) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; v_id uuid;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not (public.is_bureau() or public.achats_est_gestionnaire(p_id)) then raise exception 'Non autorisé.'; end if;
  insert into public.achats_creneaux (achat_id, association_id, lieu, debut, fin, capacite) values (p_id, v_a.association_id, trim(p_lieu), p_debut, p_fin, nullif(p_capacite, 0))
  returning id into v_id;
  perform public.achats_notifier(p_id, 'Créneau de retrait', trim(p_lieu) || ' — choisissez votre créneau dans la fiche de l''achat.', false);
  return v_id;
end;
$fn$;

create or replace function public.achats_supprimer_creneau(p_creneau uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_c public.achats_creneaux;
begin
  select * into v_c from public.achats_creneaux where id = p_creneau;
  if v_c.id is null or v_c.association_id <> public.current_association_id() or not (public.is_bureau() or public.achats_est_gestionnaire(v_c.achat_id)) then raise exception 'Non autorisé.'; end if;
  update public.achats_souscriptions set creneau_id = null where creneau_id = p_creneau;
  delete from public.achats_creneaux where id = p_creneau;
end;
$fn$;

create or replace function public.achats_choisir_creneau(p_id uuid, p_creneau uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_c public.achats_creneaux; v_m uuid := public.current_member_id(); v_n int;
begin
  if not exists (select 1 from public.achats_souscriptions where achat_id = p_id and member_id = v_m and statut = 'retenu') then
    raise exception 'Vous n''avez pas de part dans cet achat.';
  end if;
  if p_creneau is not null then
    select * into v_c from public.achats_creneaux where id = p_creneau and achat_id = p_id;
    if v_c.id is null then raise exception 'Créneau introuvable.'; end if;
    if v_c.capacite is not null then
      select count(*) into v_n from public.achats_souscriptions where creneau_id = p_creneau and member_id <> v_m;
      if v_n >= v_c.capacite then raise exception 'Ce créneau est complet.'; end if;
    end if;
  end if;
  update public.achats_souscriptions set creneau_id = p_creneau, updated_at = now() where achat_id = p_id and member_id = v_m;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 5) Suivi d'expédition
-- ---------------------------------------------------------------------
create or replace function public.achats_ajouter_suivi(p_id uuid, p_etape text, p_lieu text, p_note text, p_numero text default null, p_transporteur text default null) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not (public.is_bureau() or public.achats_est_gestionnaire(p_id)) then raise exception 'Non autorisé.'; end if;
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

-- ---------------------------------------------------------------------
-- 6) Avis sur le fournisseur
-- ---------------------------------------------------------------------
create or replace function public.achats_donner_avis(p_id uuid, p_qualite int, p_delai int, p_commentaire text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; v_m uuid := public.current_member_id();
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() then raise exception 'Non autorisé.'; end if;
  if v_a.statut not in ('livre', 'cloture') then raise exception 'L''avis se donne après la livraison.'; end if;
  if not exists (select 1 from public.achats_souscriptions where achat_id = p_id and member_id = v_m and statut = 'retenu') then
    raise exception 'Seuls les membres qui ont reçu une part peuvent donner leur avis.';
  end if;
  insert into public.achats_avis (achat_id, association_id, member_id, member_nom, fournisseur, note_qualite, note_delai, commentaire)
  values (p_id, v_a.association_id, v_m, (select nom from public.members where id = v_m), v_a.fournisseur, p_qualite, p_delai, nullif(trim(coalesce(p_commentaire, '')), ''))
  on conflict (achat_id, member_id) do update set note_qualite = excluded.note_qualite, note_delai = excluded.note_delai, commentaire = excluded.commentaire, created_at = now();
end;
$fn$;

-- ---------------------------------------------------------------------
-- 7) Remise : procuration, photo du membre
-- ---------------------------------------------------------------------
create or replace function public.achats_remettre_plus(p_id uuid, p_token uuid default null, p_sous uuid default null, p_procuration text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v_res jsonb; v_photo text;
begin
  v_res := public.achats_remettre(p_id, p_token, p_sous);
  if (v_res->>'ok')::boolean then
    if not (v_res->>'deja_remis')::boolean and coalesce(trim(p_procuration), '') <> '' then
      update public.achats_souscriptions set remis_a_nom = trim(p_procuration) where id = (v_res->>'souscription_id')::uuid;
    end if;
    select m.photo_url into v_photo from public.members m join public.achats_souscriptions s on s.member_id = m.id where s.id = (v_res->>'souscription_id')::uuid;
    v_res := v_res || jsonb_build_object('photo_url', v_photo,
      'remis_a_nom', (select remis_a_nom from public.achats_souscriptions where id = (v_res->>'souscription_id')::uuid));
  end if;
  return v_res;
end;
$fn$;
grant execute on function public.achats_remettre_plus(uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8) Facture jointe au bilan, date limite de paiement
-- ---------------------------------------------------------------------
create or replace function public.achats_joindre_facture(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not (public.is_bureau() or public.achats_est_gestionnaire(p_id)) then raise exception 'Non autorisé.'; end if;
  update public.achats_groupes set facture_path = p_path where id = p_id;
end;
$fn$;

create or replace function public.achats_fixer_limite_paiement(p_id uuid, p_date timestamptz) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not (public.is_bureau() or public.achats_est_gestionnaire(p_id)) then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'confirme' then raise exception 'La date limite de paiement se fixe une fois l''achat confirmé.'; end if;
  update public.achats_groupes set date_limite_paiement = p_date where id = p_id;
  perform public.achats_notifier(p_id, 'Date limite de paiement', v_a.titre || ' — payez votre part avant le ' || to_char(p_date at time zone 'America/Moncton', 'DD/MM à HH24"h"MI') || '.', false);
end;
$fn$;

insert into storage.buckets (id, name, public) values ('achats-factures', 'achats-factures', false) on conflict (id) do nothing;
drop policy if exists "achats factures select" on storage.objects;
drop policy if exists "achats factures insert" on storage.objects;
create policy "achats factures select" on storage.objects for select to authenticated
  using (bucket_id = 'achats-factures' and (storage.foldername(name))[1] = public.current_association_id()::text);
create policy "achats factures insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'achats-factures' and (storage.foldername(name))[1] = public.current_association_id()::text);

-- Rappels quotidiens et libération des parts impayées après la date limite.
create or replace function public.achats_rappels_paiement() returns void
language plpgsql security definer set search_path = '' as $fn$
declare r record; v_restant numeric; v_attente numeric; p uuid;
begin
  for r in
    select s.id as sous_id, s.member_id, s.member_nom, s.rappel_paiement_le, a.id as achat_id, a.titre, a.association_id, a.date_limite_paiement, a.porteur_member_id
      from public.achats_souscriptions s join public.achats_groupes a on a.id = s.achat_id
     where a.statut = 'confirme' and s.statut = 'retenu' and a.date_limite_paiement is not null
  loop
    v_restant := -public.achats_solde(r.achat_id, r.member_id);
    select coalesce(sum(montant), 0) into v_attente from public.achats_mouvements
     where achat_id = r.achat_id and member_id = r.member_id and sens = 'entree' and statut in ('declare', 'recu');
    continue when v_restant - v_attente <= 0;
    if r.date_limite_paiement < now() then
      -- Part non payée à temps : libérée (aucun paiement en cours de vérification).
      continue when v_attente > 0;
      update public.achats_souscriptions set statut = 'desiste', quantite_attribuee = 0, montant_du = 0,
             motif = 'Part non payée à la date limite', updated_at = now() where id = r.sous_id;
      perform public.achats_recalculer(r.achat_id);
      for p in select pr.id from public.profiles pr where pr.member_id in (r.member_id, r.porteur_member_id) loop
        begin
          perform public.notify_profile(r.association_id, p, 'Part libérée : ' || left(r.titre, 70), coalesce(r.member_nom, '') || ' — part non payée à la date limite.');
        exception when others then null;
        end;
      end loop;
    elsif r.date_limite_paiement < now() + interval '3 days' and r.rappel_paiement_le is distinct from current_date then
      for p in select pr.id from public.profiles pr where pr.member_id = r.member_id loop
        begin
          perform public.notify_profile(r.association_id, p, 'Rappel : votre part de « ' || left(r.titre, 60) || ' »',
            'Reste à payer : ' || to_char(v_restant - v_attente, 'FM999990.00') || ' $ avant le ' || to_char(r.date_limite_paiement at time zone 'America/Moncton', 'DD/MM') || '.');
        exception when others then null;
        end;
      end loop;
      update public.achats_souscriptions set rappel_paiement_le = current_date where id = r.sous_id;
    end if;
  end loop;
end;
$fn$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'achats-rappels-paiement';
    perform cron.schedule('achats-rappels-paiement', '0 14 * * *', 'select public.achats_rappels_paiement()');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9) Le bureau est prévenu quand sa validation est attendue
-- ---------------------------------------------------------------------
create or replace function public.achats_trg_a_valider() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare p uuid; v_titre text; v_assoc uuid; v_exclu uuid; v_msg text;
begin
  if tg_table_name = 'achats_mouvements' then
    if not (new.statut = 'recu' and (tg_op = 'INSERT' or old.statut is distinct from 'recu')) then return null; end if;
    select titre into v_titre from public.achats_groupes where id = new.achat_id;
    v_assoc := new.association_id; v_exclu := new.recu_par;
    v_msg := coalesce(new.member_nom, '') || ' — ' || to_char(new.montant, 'FM999990.00') || ' $ à valider (' || coalesce(v_titre, 'achat groupé') || ')';
  else
    if not (new.bilan_saisi_le is not null and (tg_op = 'INSERT' or old.bilan_saisi_le is null)) then return null; end if;
    v_assoc := new.association_id; v_exclu := new.bilan_saisi_par;
    v_msg := 'Bilan de « ' || new.titre || ' » à valider (double contrôle).';
  end if;
  for p in select pr.id from public.profiles pr
            where pr.association_id = v_assoc and pr.role in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier')
              and pr.id is distinct from v_exclu
  loop
    begin
      perform public.notify_profile(v_assoc, p, 'Validation attendue — achats groupés', v_msg);
    exception when others then null;
    end;
  end loop;
  return null;
end;
$fn$;
drop trigger if exists trg_achats_mvt_a_valider on public.achats_mouvements;
create trigger trg_achats_mvt_a_valider after insert or update of statut on public.achats_mouvements
  for each row execute function public.achats_trg_a_valider();
drop trigger if exists trg_achats_bilan_a_valider on public.achats_groupes;
create trigger trg_achats_bilan_a_valider after update of bilan_saisi_le on public.achats_groupes
  for each row execute function public.achats_trg_a_valider();

-- ---------------------------------------------------------------------
-- 10) Fiches adhérents en double : détection et fusion (bureau)
-- ---------------------------------------------------------------------
create or replace function public.membres_doublons() returns table (id_a uuid, nom_a text, email_a text, cree_a timestamptz, id_b uuid, nom_b text, email_b text, cree_b timestamptz, raison text)
language sql stable security definer set search_path = '' as $fn$
  select a.id, a.nom, a.email, a.created_at, b.id, b.nom, b.email, b.created_at,
         case when lower(trim(a.nom)) = lower(trim(b.nom)) then 'nom'
              when a.email is not null and lower(a.email) = lower(b.email) then 'courriel'
              else 'telephone' end
    from public.members a join public.members b on b.association_id = a.association_id and a.id < b.id
   where a.association_id = public.current_association_id() and public.is_bureau()
     and a.statut <> 'Supprimé' and b.statut <> 'Supprimé'
     and (lower(trim(a.nom)) = lower(trim(b.nom))
          or (a.email is not null and lower(a.email) = lower(b.email))
          or (length(regexp_replace(coalesce(a.telephone, ''), '\D', '', 'g')) >= 7
              and regexp_replace(a.telephone, '\D', '', 'g') = regexp_replace(coalesce(b.telephone, ''), '\D', '', 'g')))
$fn$;
grant execute on function public.membres_doublons() to authenticated;

create or replace function public.fusionner_fiches_membres(p_garder uuid, p_retirer uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_g public.members; v_r public.members; r record; k record; n_avant int; n_apres int; v_res jsonb := '[]'::jsonb;
begin
  if not public.is_bureau() then raise exception 'Réservé au bureau.'; end if;
  select * into v_g from public.members where id = p_garder;
  select * into v_r from public.members where id = p_retirer;
  if v_g.id is null or v_r.id is null or p_garder = p_retirer
     or v_g.association_id <> public.current_association_id() or v_r.association_id <> v_g.association_id then
    raise exception 'Fiches invalides.';
  end if;
  -- Une seule carte : celle de la fiche gardée.
  if exists (select 1 from public.member_card_tokens where member_id = p_garder) then
    delete from public.member_card_tokens where member_id = p_retirer;
  end if;
  for r in
    select kcu.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
     where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public' and ccu.table_name = 'members' and ccu.column_name = 'id'
       and kcu.table_name <> 'members'
  loop
    execute format('select count(*) from public.%I where %I = %L', r.table_name, r.column_name, p_retirer) into n_avant;
    continue when n_avant = 0;
    begin
      execute format('update public.%I set %I = %L where %I = %L', r.table_name, r.column_name, p_garder, r.column_name, p_retirer);
    exception when others then
      for k in execute format('select ctid from public.%I where %I = %L', r.table_name, r.column_name, p_retirer) loop
        begin
          execute format('update public.%I set %I = %L where ctid = %L', r.table_name, r.column_name, p_garder, k.ctid);
        exception when others then null;
        end;
      end loop;
    end;
    execute format('select count(*) from public.%I where %I = %L', r.table_name, r.column_name, p_retirer) into n_apres;
    v_res := v_res || jsonb_build_object('table', r.table_name, 'transferes', n_avant - n_apres, 'doublons', n_apres);
  end loop;
  update public.members set
    email = coalesce(v_g.email, v_r.email), telephone = coalesce(v_g.telephone, v_r.telephone), photo_url = coalesce(v_g.photo_url, v_r.photo_url),
    date_adhesion = least(v_g.date_adhesion, v_r.date_adhesion),
    inscription_paye = greatest(coalesce(v_g.inscription_paye, 0), coalesce(v_r.inscription_paye, 0)),
    fonds_urgence_paye = greatest(coalesce(v_g.fonds_urgence_paye, 0), coalesce(v_r.fonds_urgence_paye, 0)),
    fonds_secours_paye = greatest(coalesce(v_g.fonds_secours_paye, 0), coalesce(v_r.fonds_secours_paye, 0))
   where id = p_garder;
  update public.members set statut = 'Supprimé', motif_desactivation = 'Fusionnée avec la fiche ' || v_g.nom || ' (doublon)', date_desactivation = current_date, email = null
   where id = p_retirer;
  return v_res;
end;
$fn$;
grant execute on function public.fusionner_fiches_membres(uuid, uuid) to authenticated;

-- Vérification :
--   select proname from pg_proc where proname in ('achats_passer_en_sondage','achats_retenir_devis','achats_remettre_plus','fusionner_fiches_membres','achats_rappels_paiement');  -- 5 lignes
