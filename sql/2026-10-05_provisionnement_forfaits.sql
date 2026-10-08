-- =====================================================================
-- Provisionnement des associations et gestion des forfaits (Standard /
-- Premium), mode automatique + option manuelle en parallèle permanente
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois), APRÈS tous les
-- scripts précédents, notamment 2026-09-07_correctif_auto_inscription.sql
-- et 2026-09-07b_rejoindre_association.sql (ce script modifie
-- join_association_with_code()). Voir
-- claude/provisioning-associations-proposition.md et
-- claude/tarification-standard-premium-proposition.md pour le détail des
-- décisions. Implémente les sections B et C de cette proposition.
--
-- CE QUE CE SCRIPT AJOUTE :
--   1) Essai de 30 jours : rappels automatiques par courriel (J-7 et
--      J-1) puis suspension automatique à l'échéance si aucun forfait
--      payant n'a été choisi — jusqu'ici, rien ne se passait
--      automatiquement à l'échéance de date_fin_periode.
--   2) Changement de forfait manuel (option de secours à côté du mode
--      Stripe automatique) : une association envoie une preuve de
--      virement Interac, qui apparaît dans une file d'attente au
--      Super-Admin, qui confirme ou rejette — même principe que les
--      preuves de paiement Interac des membres
--      (sql/2026-09-10b_interac_payment_claims.sql), mais ici la
--      confirmation revient à la plateforme (Super-Admin), jamais à
--      l'association elle-même.
--   3) Correctif du chemin de création manuelle par le Super-Admin :
--      jusqu'ici, createAssociation() ne créait qu'une ligne
--      associations + subscriptions, sans aucun profil président —
--      l'association restait "orpheline" (personne ne pouvait s'y
--      connecter). Ce script ajoute un mécanisme d'invitation : le
--      Super-Admin indique le nom/courriel du futur président, qui
--      reçoit un code et devient automatiquement président(e) dès sa
--      première connexion avec ce code — sans passer par la validation
--      habituelle du bureau (qui n'existe pas encore, ce qui créait un
--      verrou circulaire).
--   4) Colonnes de liaison Stripe sur subscriptions, pour le mode
--      abonnement récurrent (voir aussi les Edge Functions
--      create-checkout-session et stripe-webhook, livrées séparément).
--
-- Ce script ne supprime ni ne modifie aucune donnée existante.
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- =====================================================================
-- 1) ESSAI DE 30 JOURS — rappels + suspension automatique
-- =====================================================================

-- Deux indicateurs distincts (plutôt qu'un seul "rappel_envoye" comme
-- pour les événements) : un essai a DEUX rappels à envoyer séparément
-- (J-7 puis J-1) avant la suspension elle-même.
alter table public.subscriptions add column if not exists rappel_j7_envoye boolean not null default false;
alter table public.subscriptions add column if not exists rappel_j1_envoye boolean not null default false;

create or replace function public.process_trial_expirations()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  sub record;
  president_email text;
  assoc_nom text;
begin
  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key';

  if api_key is null then
    return;
  end if;

  -- ---- Rappel J-7 ----
  for sub in
    select s.id, s.association_id, s.date_fin_periode
    from public.subscriptions s
    where s.plan = 'essai'
      and s.statut = 'actif'
      and s.rappel_j7_envoye = false
      and s.date_fin_periode = (current_date + interval '7 days')::date
  loop
    select u.email into president_email
      from public.profiles p join auth.users u on u.id = p.id
      where p.association_id = sub.association_id and p.role = 'bureau_president'
      limit 1;
    select a.nom into assoc_nom from public.associations a where a.id = sub.association_id;

    if president_email is not null then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || api_key),
        body := jsonb_build_object(
          'from', 'onboarding@resend.dev',
          'to', jsonb_build_array(president_email),
          'subject', '[' || coalesce(assoc_nom, 'Association') || '] Votre essai gratuit se termine dans 7 jours',
          'html',
            '<p>Bonjour,</p>' ||
            '<p>L''essai gratuit de <strong>' || coalesce(assoc_nom, 'votre association') || '</strong> se termine le ' ||
            to_char(sub.date_fin_periode, 'DD/MM/YYYY') || '.</p>' ||
            '<p>Choisissez un forfait (Standard ou Premium) depuis l''onglet « Configuration » → « Votre forfait » pour continuer sans interruption. ' ||
            'Si rien n''est fait, l''accès sera automatiquement suspendu à cette date — vos données resteront conservées.</p>'
        )
      );
    end if;
    update public.subscriptions set rappel_j7_envoye = true where id = sub.id;
  end loop;

  -- ---- Rappel J-1 ----
  for sub in
    select s.id, s.association_id, s.date_fin_periode
    from public.subscriptions s
    where s.plan = 'essai'
      and s.statut = 'actif'
      and s.rappel_j1_envoye = false
      and s.date_fin_periode = (current_date + interval '1 day')::date
  loop
    select u.email into president_email
      from public.profiles p join auth.users u on u.id = p.id
      where p.association_id = sub.association_id and p.role = 'bureau_president'
      limit 1;
    select a.nom into assoc_nom from public.associations a where a.id = sub.association_id;

    if president_email is not null then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || api_key),
        body := jsonb_build_object(
          'from', 'onboarding@resend.dev',
          'to', jsonb_build_array(president_email),
          'subject', '[' || coalesce(assoc_nom, 'Association') || '] Dernier jour d''essai gratuit demain',
          'html',
            '<p>Bonjour,</p>' ||
            '<p><strong>Demain</strong>, l''essai gratuit de ' || coalesce(assoc_nom, 'votre association') ||
            ' se termine. Sans forfait choisi, l''accès sera suspendu automatiquement (vos données resteront conservées, rien n''est perdu).</p>' ||
            '<p>Choisissez un forfait dès maintenant depuis « Configuration » → « Votre forfait ».</p>'
        )
      );
    end if;
    update public.subscriptions set rappel_j1_envoye = true where id = sub.id;
  end loop;

  -- ---- Suspension automatique à l'échéance ----
  for sub in
    select s.id, s.association_id
    from public.subscriptions s
    where s.plan = 'essai'
      and s.statut = 'actif'
      and s.date_fin_periode < current_date
  loop
    update public.subscriptions set statut = 'suspendu' where id = sub.id;

    select u.email into president_email
      from public.profiles p join auth.users u on u.id = p.id
      where p.association_id = sub.association_id and p.role = 'bureau_president'
      limit 1;
    select a.nom into assoc_nom from public.associations a where a.id = sub.association_id;

    if president_email is not null then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || api_key),
        body := jsonb_build_object(
          'from', 'onboarding@resend.dev',
          'to', jsonb_build_array(president_email),
          'subject', '[' || coalesce(assoc_nom, 'Association') || '] Essai gratuit terminé — accès suspendu',
          'html',
            '<p>Bonjour,</p>' ||
            '<p>L''essai gratuit de ' || coalesce(assoc_nom, 'votre association') || ' est maintenant terminé et l''accès a été suspendu. ' ||
            'Aucune donnée n''a été supprimée.</p>' ||
            '<p>Choisissez un forfait depuis « Configuration » → « Votre forfait » pour réactiver l''accès immédiatement.</p>'
        )
      );
    end if;
  end loop;
end;
$$;

select cron.schedule(
  'traitement-essais-quotidien',
  '0 9 * * *',
  $$select public.process_trial_expirations();$$
);

-- =====================================================================
-- 2) CHANGEMENT DE FORFAIT MANUEL (virement Interac, confirmé par le
--    Super-Admin) — option de secours à côté du mode Stripe automatique
-- =====================================================================

create table if not exists public.plan_change_requests (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  demande_par uuid not null references public.profiles(id),
  plan_demande text not null check (plan_demande in ('standard', 'premium')),
  montant numeric not null,
  fichier_path text not null,
  fichier_nom text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'confirme', 'rejete')),
  commentaire_super_admin text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);

comment on table public.plan_change_requests is
  'Demandes de changement de forfait par virement Interac, en attente (ou non) de confirmation par le Super-Admin (la plateforme) — jamais par l''association elle-même. Voir claude/provisioning-associations-proposition.md, section C.';

create index if not exists plan_change_requests_statut_idx on public.plan_change_requests (statut);
create index if not exists plan_change_requests_association_idx on public.plan_change_requests (association_id);

alter table public.plan_change_requests enable row level security;

drop policy if exists "plan_change_requests select" on public.plan_change_requests;
drop policy if exists "plan_change_requests update" on public.plan_change_requests;

-- Une association voit ses propres demandes ; le Super-Admin les voit
-- toutes (nécessaire pour la file d'attente du tableau de bord).
create policy "plan_change_requests select" on public.plan_change_requests for select to authenticated
  using (association_id = public.current_association_id() or public.is_super_admin());

-- Seul le Super-Admin peut confirmer/rejeter (jamais l'association elle-même
-- — c'est tout le sens de cette option : la plateforme vérifie le virement).
create policy "plan_change_requests update" on public.plan_change_requests for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
-- Pas de policy insert directe : passe toujours par create_plan_change_request()
-- ci-dessous (SECURITY DEFINER), pour imposer le calcul serveur du montant.

insert into storage.buckets (id, name, public)
values ('plan-change-proofs', 'plan-change-proofs', false)
on conflict (id) do nothing;

drop policy if exists "plan change proofs storage select" on storage.objects;
drop policy if exists "plan change proofs storage insert" on storage.objects;

-- Chemin attendu : "<association_id>/<horodatage>_<nom_fichier>".
create policy "plan change proofs storage select" on storage.objects for select to authenticated
  using (
    bucket_id = 'plan-change-proofs'
    and ((storage.foldername(name))[1] = public.current_association_id()::text or public.is_super_admin())
  );

create policy "plan change proofs storage insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'plan-change-proofs'
    and (storage.foldername(name))[1] = public.current_association_id()::text
    and public.current_user_role() = 'bureau_president'
  );

-- Seul le président initie une demande de changement de forfait (décision
-- prise avec l'utilisateur, 2026-10-05) — jamais Léo au nom de
-- l'association, et jamais un autre rôle du bureau.
create or replace function public.create_plan_change_request(p_plan text, p_fichier_path text, p_fichier_nom text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assoc_id uuid;
  v_montant numeric;
  v_request_id uuid;
  v_assoc_nom text;
  api_key text;
  super_admin_email text;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié.';
  end if;
  if public.current_user_role() <> 'bureau_president' then
    raise exception 'Seul(e) le/la président(e) peut demander un changement de forfait.';
  end if;
  if p_plan not in ('standard', 'premium') then
    raise exception 'Forfait invalide.';
  end if;

  v_assoc_id := public.current_association_id();
  v_montant := case p_plan when 'standard' then 10 when 'premium' then 25 end;

  insert into public.plan_change_requests (association_id, demande_par, plan_demande, montant, fichier_path, fichier_nom)
  values (v_assoc_id, auth.uid(), p_plan, v_montant, p_fichier_path, p_fichier_nom)
  returning id into v_request_id;

  -- Alerte courriel à Léo (secret optionnel `super_admin_email` — sans
  -- lui, la demande reste visible via le badge du Super-Admin, juste
  -- sans courriel immédiat, comme pour les autres notifications tant
  -- qu'une clé n'est pas configurée).
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  select decrypted_secret into super_admin_email from vault.decrypted_secrets where name = 'super_admin_email';
  select a.nom into v_assoc_nom from public.associations a where a.id = v_assoc_id;

  if api_key is not null and super_admin_email is not null then
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || api_key),
      body := jsonb_build_object(
        'from', 'onboarding@resend.dev',
        'to', jsonb_build_array(super_admin_email),
        'subject', 'Nouvelle demande de changement de forfait — ' || coalesce(v_assoc_nom, 'une association'),
        'html',
          '<p>' || coalesce(v_assoc_nom, 'Une association') || ' demande à passer au forfait <strong>' || p_plan ||
          '</strong> (' || v_montant || ' $) par virement Interac.</p>' ||
          '<p>Vérifiez la preuve jointe depuis le tableau de bord Super-Admin, section « Demandes de changement de forfait en attente ».</p>'
      )
    );
  end if;

  return v_request_id;
end;
$$;
grant execute on function public.create_plan_change_request(text, text, text) to authenticated;

-- Le Super-Admin confirme ou rejette — seule fonction qui peut faire
-- évoluer subscriptions.plan par cette voie manuelle.
create or replace function public.resolve_plan_change_request(p_request_id uuid, p_approve boolean, p_commentaire text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.plan_change_requests%rowtype;
  api_key text;
  requester_email text;
  assoc_nom text;
begin
  if not public.is_super_admin() then
    raise exception 'Seul le Super-Admin peut confirmer ou rejeter une demande de changement de forfait.';
  end if;

  select * into v_req from public.plan_change_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'Demande introuvable.';
  end if;
  if v_req.statut <> 'en_attente' then
    raise exception 'Cette demande a déjà été traitée.';
  end if;

  if p_approve then
    update public.subscriptions
      set plan = v_req.plan_demande, statut = 'actif'
      where association_id = v_req.association_id;
    update public.plan_change_requests
      set statut = 'confirme', commentaire_super_admin = p_commentaire, resolved_at = now(), resolved_by = auth.uid()
      where id = p_request_id;
  else
    update public.plan_change_requests
      set statut = 'rejete', commentaire_super_admin = p_commentaire, resolved_at = now(), resolved_by = auth.uid()
      where id = p_request_id;
  end if;

  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  select u.email into requester_email from auth.users u where u.id = v_req.demande_par;
  select a.nom into assoc_nom from public.associations a where a.id = v_req.association_id;

  if api_key is not null and requester_email is not null then
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || api_key),
      body := jsonb_build_object(
        'from', 'onboarding@resend.dev',
        'to', jsonb_build_array(requester_email),
        'subject', '[' || coalesce(assoc_nom, 'Association') || '] ' ||
          (case when p_approve then 'Changement de forfait confirmé' else 'Changement de forfait refusé' end),
        'html',
          case when p_approve then
            '<p>Votre virement Interac a été vérifié : votre association est maintenant au forfait <strong>' ||
            v_req.plan_demande || '</strong>.</p>'
          else
            '<p>Votre demande de changement de forfait n''a pas pu être confirmée.' ||
            (case when p_commentaire is not null and p_commentaire <> '' then ' Motif : ' || p_commentaire else '' end) ||
            ' Vous pouvez soumettre une nouvelle preuve ou payer par carte depuis « Configuration » → « Votre forfait ».</p>'
          end
      )
    );
  end if;
end;
$$;
grant execute on function public.resolve_plan_change_request(uuid, boolean, text) to authenticated;

-- =====================================================================
-- 3) CRÉATION MANUELLE PAR LE SUPER-ADMIN — correctif de l'association
--    orpheline (aucun profil président créé jusqu'ici)
-- =====================================================================

alter table public.associations add column if not exists premier_responsable_requis boolean not null default false;
alter table public.associations add column if not exists responsable_invite_nom text;
alter table public.associations add column if not exists responsable_invite_email text;

create or replace function public.create_association_manual(p_nom_association text, p_nom_responsable text, p_email_responsable text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assoc_id uuid;
  v_code text;
  api_key text;
begin
  if not public.is_super_admin() then
    raise exception 'Seul le Super-Admin peut créer une association manuellement.';
  end if;
  if p_nom_association is null or trim(p_nom_association) = '' then
    raise exception 'Le nom de l''association est requis.';
  end if;
  if p_email_responsable is null or trim(p_email_responsable) = '' then
    raise exception 'Le courriel du/de la responsable est requis.';
  end if;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.associations where code_invitation = v_code);
  end loop;

  insert into public.associations (nom, code_invitation, premier_responsable_requis, responsable_invite_nom, responsable_invite_email)
  values (p_nom_association, v_code, true, p_nom_responsable, lower(trim(p_email_responsable)))
  returning id into v_assoc_id;

  insert into public.subscriptions (association_id, plan, statut, date_fin_periode)
  values (v_assoc_id, 'essai', 'actif', (now() + interval '30 days')::date);

  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  if api_key is not null then
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || api_key),
      body := jsonb_build_object(
        'from', 'onboarding@resend.dev',
        'to', jsonb_build_array(lower(trim(p_email_responsable))),
        'subject', 'Votre association ' || p_nom_association || ' est prête',
        'html',
          '<p>Bonjour ' || coalesce(p_nom_responsable, '') || ',</p>' ||
          '<p>Votre association <strong>' || p_nom_association || '</strong> a été créée, avec un essai gratuit de 30 jours.</p>' ||
          '<p>Pour y accéder en tant que président(e) : créez votre compte sur la plateforme, puis entrez ce code lorsqu''il vous est demandé :</p>' ||
          '<p style="font-size:20px;font-weight:700;letter-spacing:2px;padding:10px 14px;background:#f5f5f5;border-radius:6px;display:inline-block;">' ||
          v_code || '</p>' ||
          '<p>Ce code vous relie automatiquement à votre association en tant que président(e), dès votre première connexion.</p>'
      )
    );
  end if;

  return json_build_object('association_id', v_assoc_id, 'code_invitation', v_code);
end;
$$;
grant execute on function public.create_association_manual(text, text, text) to authenticated;

-- Met à jour join_association_with_code() pour reconnaître le tout premier
-- responsable invité manuellement (ci-dessus) et lui attribuer directement
-- le rôle bureau_president, sans passer par member_link_requests — aucun
-- bureau n'existe encore pour confirmer quoi que ce soit à ce stade (le
-- verrou circulaire identifié lors de l'audit du mécanisme, 2026-10-05).
-- Le reste de la fonction, pour tout autre cas, est inchangé.
create or replace function public.join_association_with_code(p_code text, p_nom_complet text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assoc_id uuid;
  v_premier_requis boolean;
  v_invite_email text;
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

  select id, premier_responsable_requis, responsable_invite_email
    into v_assoc_id, v_premier_requis, v_invite_email
    from public.associations where code_invitation = upper(trim(p_code));
  if v_assoc_id is null then
    raise exception 'Code d''invitation invalide. Vérifiez le code auprès du bureau de votre association.';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  if coalesce(v_premier_requis, false) and v_invite_email is not null and v_email is not null
     and lower(v_email) = v_invite_email then
    insert into public.profiles (id, association_id, role, nom_complet)
    values (auth.uid(), v_assoc_id, 'bureau_president', p_nom_complet);

    update public.associations
      set premier_responsable_requis = false, responsable_invite_email = null, responsable_invite_nom = null
      where id = v_assoc_id;

    return json_build_object('association_id', v_assoc_id, 'role', 'bureau_president');
  end if;

  insert into public.profiles (id, association_id, role, nom_complet)
  values (auth.uid(), v_assoc_id, 'adherent', p_nom_complet);

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

-- =====================================================================
-- 4) LIAISON STRIPE POUR LE MODE ABONNEMENT RÉCURRENT
-- =====================================================================
alter table public.subscriptions add column if not exists stripe_subscription_id text;
alter table public.subscriptions add column if not exists stripe_customer_id text;
create unique index if not exists subscriptions_stripe_subscription_id_idx
  on public.subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;

-- =====================================================================
-- Vérification rapide après exécution :
--   select jobname, schedule, active from cron.job where jobname = 'traitement-essais-quotidien';
--   select proname from pg_proc where proname in
--     ('process_trial_expirations','create_plan_change_request',
--      'resolve_plan_change_request','create_association_manual',
--      'join_association_with_code');
--   -- doit afficher 5 lignes au total avec la précédente
--
-- Pour recevoir les courriels d'alerte au Super-Admin (nouvelles demandes
-- de changement de forfait), configurez un secret Vault supplémentaire,
-- comme pour resend_api_key :
--   select vault.create_secret('votre-courriel@exemple.com', 'super_admin_email');
-- Sans ce secret, les demandes restent visibles via le badge du
-- Super-Admin, simplement sans courriel immédiat.
--
-- Pour tester sans attendre le lendemain matin :
--   select public.process_trial_expirations();
-- =====================================================================
