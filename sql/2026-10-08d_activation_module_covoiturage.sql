-- =====================================================================
-- Activation du module Covoiturage par association, réservée au Super-
-- Admin — indépendante du forfait Standard/Premium
-- =====================================================================
-- Demande explicite de l'utilisateur (2026-10-08) : « je veux que le
-- module covoiturage soit optionnel. Donc, je donne accès à l'association
-- que je veux. Je ne suis pas obligé de l'ouvrir pour toutes les
-- associations. » — en plus du verrou Premium déjà existant
-- (PREMIUM_FEATURE_IDS dans App.jsx, qui affiche « Disponible en Premium »
-- tant que subscription.plan !== 'premium'), ce script ajoute un second
-- verrou, orthogonal, que SEUL le Super-Admin contrôle : une association
-- peut être Premium et malgré tout ne pas (encore) avoir ce module, le
-- temps d'un déploiement progressif décidé par la plateforme plutôt que
-- par l'argent. Décision prise avec l'utilisateur : ce verrou est
-- totalement indépendant des forfaits (gratuit, pas un levier commercial)
-- — voir claude/resume-unia.md pour le contexte complet de cette demande
-- (qui portait initialement sur un rôle « administrateur » générique,
-- précisée ensuite par l'utilisateur comme portant spécifiquement sur le
-- module Covoiturage).
--
-- RÉTROCOMPATIBILITÉ (même principe que bureau_role_configs, sql/2026-10-
-- 07d) : la colonne est ajoutée à TRUE pour toutes les associations déjà
-- existantes — aucune association qui utilise déjà le covoiturage (y
-- compris en test) ne perd l'accès du jour au lendemain. Le défaut est
-- ensuite changé à FALSE pour la suite : une NOUVELLE association, créée
-- après ce script, n'aura PAS le module tant que le Super-Admin ne l'a
-- pas explicitement activé pour elle. C'est exactement le sens de
-- « je donne accès à l'association que je veux ».
-- =====================================================================

alter table public.associations add column if not exists covoiturage_module_actif boolean not null default true;
alter table public.associations alter column covoiturage_module_actif set default false;
comment on column public.associations.covoiturage_module_actif is
  'Active ou non le module Covoiturage pour cette association — modifiable uniquement par le Super-Admin via activer_module_covoiturage(), indépendamment du forfait Standard/Premium. Ajoutée à TRUE pour toutes les associations existantes au moment de ce script (rétrocompatibilité) ; les associations créées après ont FALSE par défaut (déploiement progressif décidé par la plateforme).';

-- ---------------------------------------------------------------------
-- 1) Activation/désactivation — réservée au Super-Admin
-- ---------------------------------------------------------------------
create or replace function public.activer_module_covoiturage(p_association_id uuid, p_actif boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_super_admin() then
    raise exception 'Seul le Super-Admin peut activer ou désactiver le module Covoiturage pour une association.';
  end if;
  update public.associations set covoiturage_module_actif = p_actif where id = p_association_id;
  if not found then
    raise exception 'Association introuvable.';
  end if;
end;
$fn$;
grant execute on function public.activer_module_covoiturage(uuid, boolean) to authenticated;
comment on function public.activer_module_covoiturage(uuid, boolean) is
  'Active ou désactive le module Covoiturage pour une association donnée — réservé au Super-Admin (vérifié ici, en plus de l''écran dédié dans SuperAdminPanel). Indépendant du forfait Standard/Premium.';

-- ---------------------------------------------------------------------
-- 2) Défense en profondeur côté base : même si le client cache déjà
--    l'onglet Covoiturage quand le module est inactif (voir
--    ModuleRestreintSuperAdmin dans App.jsx), on bloque aussi la création
--    de nouvelles offres/demandes/balises directement en base — sinon un
--    appel direct à l'API (en contournant l'interface) resterait possible
--    tant que RLS se limite à association_id = current_association_id().
--    Une seule fonction de déclencheur, réutilisée sur les trois tables
--    d'entrée du module.
-- ---------------------------------------------------------------------
create or replace function public.empecher_covoiturage_si_module_inactif()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (
    select 1 from public.associations a
    where a.id = new.association_id and a.covoiturage_module_actif
  ) then
    raise exception 'Le module Covoiturage n''est pas encore activé pour votre association. Contactez l''équipe de la plateforme.';
  end if;
  return new;
end;
$fn$;
comment on function public.empecher_covoiturage_si_module_inactif() is
  'Déclencheur de défense en profondeur : bloque toute nouvelle offre/demande/balise de covoiturage si covoiturage_module_actif est faux pour l''association concernée, même via un appel direct à l''API (le verrou côté client dans App.jsx reste la première ligne, celui-ci couvre le contournement).';

drop trigger if exists trg_covoiturage_module_actif_offers on public.carpool_offers;
create trigger trg_covoiturage_module_actif_offers
  before insert on public.carpool_offers
  for each row execute function public.empecher_covoiturage_si_module_inactif();

drop trigger if exists trg_covoiturage_module_actif_requests on public.carpool_requests;
create trigger trg_covoiturage_module_actif_requests
  before insert on public.carpool_requests
  for each row execute function public.empecher_covoiturage_si_module_inactif();

drop trigger if exists trg_covoiturage_module_actif_beacons on public.carpool_availability_beacons;
create trigger trg_covoiturage_module_actif_beacons
  before insert on public.carpool_availability_beacons
  for each row execute function public.empecher_covoiturage_si_module_inactif();

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name, column_default from information_schema.columns
--   where table_name = 'associations' and column_name = 'covoiturage_module_actif';
--   -- doit afficher 1 ligne, column_default = 'false' (les lignes déjà
--   -- existantes restent à true, posé au moment de l'ALTER ci-dessus)
--
--   select count(*) from public.associations where covoiturage_module_actif = false;
--   -- doit afficher 0 juste après exécution (aucune association existante
--   -- désactivée) ; augmentera ensuite avec les nouvelles associations
--
--   select proname from pg_proc where proname in
--     ('activer_module_covoiturage', 'empecher_covoiturage_si_module_inactif');
--   -- doit afficher 2 lignes
--
-- Pour activer le module sur une association précise (ou le désactiver) :
--   select public.activer_module_covoiturage('<id-association>', true);
-- — ou directement depuis l'écran Super-Admin, colonne « Covoiturage »
-- du tableau des associations.
-- =====================================================================
