-- =====================================================================
-- Covoiturage — Facturation en tant que module optionnel (add-on)
-- =====================================================================
-- Suite de claude/covoiturage-facturation-addon-proposition.md, approuvée
-- par l'utilisateur le 2026-10-08. Découple deux décisions déjà présentes
-- séparément dans le code :
--   1) ACCÈS (sql/2026-10-08d) : covoiturage_module_actif — l'association
--      a-t-elle le module du tout ? Inchangé par ce script.
--   2) FACTURATION (nouveau, ce script) : si le module est actif, est-ce
--      inclus gratuitement dans le forfait, ou un add-on payant qui
--      augmente l'abonnement d'un montant fixé par le Super-Admin,
--      association par association ?
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Colonnes de facturation sur associations
-- ---------------------------------------------------------------------
alter table public.associations
  add column if not exists covoiturage_facturation text not null default 'inclus'
    check (covoiturage_facturation in ('inclus', 'addon_payant'));
alter table public.associations
  add column if not exists covoiturage_addon_prix_mensuel numeric not null default 0
    check (covoiturage_addon_prix_mensuel >= 0);
comment on column public.associations.covoiturage_facturation is
  'Mode de facturation du module Covoiturage pour cette association — ''inclus'' (gratuit, comportement par défaut) ou ''addon_payant'' (le prix ci-dessous s''ajoute à l''abonnement). Sans effet si covoiturage_module_actif = false. Configuré par configurer_facturation_covoiturage(), réservé au Super-Admin.';
comment on column public.associations.covoiturage_addon_prix_mensuel is
  'Montant mensuel ($CAD) de l''add-on Covoiturage lorsque covoiturage_facturation = ''addon_payant'' — utilisé par create_plan_change_request() (virement Interac) et l''edge function create-checkout-session (Stripe) pour calculer le montant réellement dû.';

-- ---------------------------------------------------------------------
-- 2) RPC de configuration — réservé au Super-Admin, notifie le bureau
--    (transparence : jamais de changement de prix silencieux).
-- ---------------------------------------------------------------------
create or replace function public.configurer_facturation_covoiturage(
  p_association_id uuid,
  p_facturation text,
  p_prix numeric default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_p record;
  v_prix numeric;
begin
  if not public.is_super_admin() then
    raise exception 'Seul le Super-Admin peut configurer la facturation du module Covoiturage.';
  end if;
  if p_facturation not in ('inclus', 'addon_payant') then
    raise exception 'Mode de facturation invalide.';
  end if;

  v_prix := case when p_facturation = 'addon_payant' then coalesce(p_prix, 0) else 0 end;
  if p_facturation = 'addon_payant' and v_prix <= 0 then
    raise exception 'Le prix de l''add-on doit être supérieur à zéro.';
  end if;

  update public.associations
    set covoiturage_facturation = p_facturation,
        covoiturage_addon_prix_mensuel = v_prix
    where id = p_association_id;
  if not found then
    raise exception 'Association introuvable.';
  end if;

  for v_p in
    select id from public.profiles
    where association_id = p_association_id and role in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier')
  loop
    perform public.notify_profile(
      p_association_id, v_p.id,
      '💰 Facturation du module Covoiturage mise à jour',
      case when p_facturation = 'addon_payant'
        then 'Le module Covoiturage est désormais un module payant : ' || v_prix || ' $/mois s''ajoutent à votre abonnement.'
        else 'Le module Covoiturage est désormais inclus gratuitement dans votre forfait.'
      end
    );
  end loop;
end;
$fn$;
grant execute on function public.configurer_facturation_covoiturage(uuid, text, numeric) to authenticated;
comment on function public.configurer_facturation_covoiturage(uuid, text, numeric) is
  'Le Super-Admin décide, association par association, si le module Covoiturage (déjà activé via activer_module_covoiturage) est inclus gratuitement ou vendu comme add-on payant — notifie le bureau du changement.';

-- ---------------------------------------------------------------------
-- 3) create_plan_change_request (sql/2026-10-05_provisionnement_forfaits)
--    redéfinie pour inclure le supplément add-on Covoiturage dans le
--    montant demandé par virement Interac — corps par ailleurs identique.
-- ---------------------------------------------------------------------
create or replace function public.create_plan_change_request(p_plan text, p_fichier_path text, p_fichier_nom text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assoc_id uuid;
  v_montant numeric;
  v_addon_covoiturage numeric;
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

  -- Supplément add-on Covoiturage, le cas échéant (sql/2026-10-08i) —
  -- reflète immédiatement le choix de facturation du Super-Admin dans le
  -- montant dû, sans dupliquer la logique ailleurs.
  select case when covoiturage_facturation = 'addon_payant' then covoiturage_addon_prix_mensuel else 0 end
    into v_addon_covoiturage
    from public.associations where id = v_assoc_id;
  v_montant := v_montant + coalesce(v_addon_covoiturage, 0);

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

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns where table_name = 'associations'
--   and column_name in ('covoiturage_facturation','covoiturage_addon_prix_mensuel');
--   -- doit afficher 2 lignes
--   select proname from pg_proc where proname = 'configurer_facturation_covoiturage';
--   -- doit afficher 1 ligne
-- =====================================================================
