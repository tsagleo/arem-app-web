-- =====================================================================
-- Formulaires publics — correctif RLS pour les visiteurs anonymes
-- (suite de 2026-10-08n_antiabus_heure_serveur.sql)
-- =====================================================================
-- Problème corrigé : les politiques d'insertion de membership_requests et
-- event_public_registrations vérifiaient la vitrine avec
--   exists (select 1 from public.associations a where ... vitrine_active)
-- Or ce sous-select s'exécute avec les droits du visiteur : un anonyme ne
-- peut pas lire public.associations (ni public.events), donc exists()
-- renvoyait toujours faux et TOUTE demande publique était rejetée (42501),
-- affichée comme « Votre envoi n'a pas pu être accepté ». Le défaut date
-- de 2026-09-28i_vitrine_publique.sql ; les scripts m et n l'ont repris.
--
-- Correctif : deux fonctions security definer qui ne renvoient qu'un
-- booléen (aucune donnée exposée), utilisées dans les politiques. Le reste
-- de l'anti-abus (champ piège, délai 3 s – 24 h en heure serveur) est
-- inchangé.
--
-- Pré-requis : 2026-10-08n déjà exécuté (colonnes piege et
-- formulaire_debute_le). Ré-exécutable sans risque.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Fonctions de vérification, appelables sans compte
-- ---------------------------------------------------------------------
create or replace function public.vitrine_accepte_adhesion(p_association_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.associations a
    where a.id = p_association_id and a.vitrine_active = true
  )
$fn$;

comment on function public.vitrine_accepte_adhesion(uuid) is
  'Vrai si l''association a une vitrine publique active. Security definer : utilisée par la politique RLS d''insertion de membership_requests, car un visiteur anonyme ne peut pas lire public.associations.';

grant execute on function public.vitrine_accepte_adhesion(uuid) to anon, authenticated;

create or replace function public.evenement_accepte_inscription_publique(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.events e
    join public.associations a on a.id = e.association_id
    where e.id = p_event_id
      and e.public_inscription = true
      and e.annule = false
      and a.vitrine_active = true
  )
$fn$;

comment on function public.evenement_accepte_inscription_publique(uuid) is
  'Vrai si l''événement accepte les inscriptions publiques (inscription publique, non annulé, vitrine active). Security definer : utilisée par la politique RLS d''insertion de event_public_registrations, car un visiteur anonyme ne peut pas lire public.events ni public.associations.';

grant execute on function public.evenement_accepte_inscription_publique(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1) membership_requests
-- ---------------------------------------------------------------------
drop policy if exists "membership_requests insert public" on public.membership_requests;
create policy "membership_requests insert public" on public.membership_requests
  for insert to anon, authenticated
  with check (
    public.vitrine_accepte_adhesion(association_id)
    and (piege is null or piege = '')
    and formulaire_debute_le is not null
    and now() - formulaire_debute_le > interval '3 seconds'
    and now() - formulaire_debute_le < interval '24 hours'
  );

-- ---------------------------------------------------------------------
-- 2) event_public_registrations
-- ---------------------------------------------------------------------
drop policy if exists "event_public_registrations insert public" on public.event_public_registrations;
create policy "event_public_registrations insert public" on public.event_public_registrations
  for insert to anon, authenticated
  with check (
    public.evenement_accepte_inscription_publique(event_id)
    and (piege is null or piege = '')
    and formulaire_debute_le is not null
    and now() - formulaire_debute_le > interval '3 seconds'
    and now() - formulaire_debute_le < interval '24 hours'
  );

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) : doit renvoyer 2 lignes dont with_check
-- appelle les nouvelles fonctions.
-- ---------------------------------------------------------------------
-- select tablename, policyname, with_check from pg_policies
--   where policyname in ('membership_requests insert public', 'event_public_registrations insert public');
