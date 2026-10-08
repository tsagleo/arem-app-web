-- =====================================================================
-- Multi-association par utilisateur — 2026-10-06
-- Voir claude/architecture-multi-association.md, section 8, pour la
-- décision et le contexte complet. Résumé : aujourd'hui, profiles porte
-- UN SEUL association_id et UN SEUL role par compte. Ce script introduit
-- la relation plusieurs-à-plusieurs (un compte peut appartenir à
-- plusieurs associations, avec un rôle propre à chacune) SANS RIEN
-- CASSER pour une association existante avec un seul membre par compte :
-- profiles.association_id/role deviennent "l'association actuellement
-- affichée" plutôt que "la seule association possible", mais continuent
-- de fonctionner exactement pareil pour le RLS (current_association_id()
-- lit toujours profiles.association_id, inchangé).
--
-- CE SCRIPT TOUCHE LA SÉCURITÉ (RLS) D'UNE APPLICATION DÉJÀ UTILISÉE EN
-- PRODUCTION. Comme pour le chantier RLS du 2026-09-04 :
--   1. Exécutez-le vous-même dans Supabase → SQL Editor (jamais exécuté
--      automatiquement par un assistant).
--   2. Après exécution, vérifiez que l'application fonctionne EXACTEMENT
--      comme avant pour votre association existante (connexion, tous les
--      onglets, aucun changement visible) — rien ne doit changer tant que
--      personne n'a une deuxième ligne dans association_memberships.
--   3. Confirmez-le avant qu'on considère ce chantier "en place" — l'étape
--      suivante (câblage du sélecteur dans l'interface) part du principe
--      que ce script tourne déjà sans erreur chez vous.
--
-- Idempotent : peut être ré-exécuté sans dupliquer les lignes de
-- migration ni recréer deux fois les objets.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Table association_memberships — une ligne par appartenance.
-- ---------------------------------------------------------------------
create table if not exists public.association_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, association_id)
);

create index if not exists idx_association_memberships_profile on public.association_memberships(profile_id);
create index if not exists idx_association_memberships_association on public.association_memberships(association_id);

alter table public.association_memberships enable row level security;

-- Lecture : chacun voit UNIQUEMENT ses propres appartenances (sert à
-- peupler le sélecteur d'association dans l'interface) — jamais celles
-- des autres comptes, même au sein de la même association.
drop policy if exists "association_memberships_select_own" on public.association_memberships;
create policy "association_memberships_select_own" on public.association_memberships
  for select
  using (profile_id = auth.uid());

-- Pas de politique d'écriture cliente : toute création/suppression de
-- ligne passe par des fonctions SECURITY DEFINER (switch_association
-- ci-dessous pour l'usage immédiat ; une future fonction "rejoindre une
-- deuxième association" suivra le même principe que
-- join_association_with_code — voir section 8 de l'architecture, point
-- "Provisioning"). Sans politique insert/update/delete, RLS bloque par
-- défaut ces opérations pour le rôle "authenticated".

-- ---------------------------------------------------------------------
-- 2) Migration des données existantes : chaque profil actuel reçoit une
--    ligne correspondant à son association_id/role actuel. Zéro impact
--    fonctionnel — une seule appartenance par profil, comme avant.
-- ---------------------------------------------------------------------
insert into public.association_memberships (profile_id, association_id, role)
select p.id, p.association_id, p.role
from public.profiles p
where p.association_id is not null
on conflict (profile_id, association_id) do nothing;

-- ---------------------------------------------------------------------
-- 3) switch_association(p_association_id) — change l'association/le rôle
--    COURAMMENT AFFICHÉS pour le compte connecté, en respectant l'ordre
--    de permission suivant : la ligne doit exister dans
--    association_memberships (vérifié ici, avant toute écriture) — le
--    rôle appliqué est TOUJOURS celui de cette ligne, jamais un
--    paramètre libre, donc aucune auto-promotion possible par cet appel.
--
--    Note technique : le déclencheur enforce_president_only_role_change
--    (suite 2026-09-07e, voir resume-arem-app.md) empêche normalement un
--    compte non-président de modifier profiles.role — protection voulue
--    contre une auto-promotion AU SEIN d'une même association, mais qui
--    bloquerait aussi ce changement de CONTEXTE légitime (le rôle ici
--    vient de association_memberships, déjà vérifié ci-dessus, jamais
--    choisi librement par l'appelant). On le désactive donc le temps
--    strict de cette seule instruction, puis on le réactive
--    systématiquement — y compris si l'UPDATE échoue — et on le retrouve
--    par le nom réel de la fonction à laquelle il est rattaché plutôt que
--    par un nom de déclencheur codé en dur, au cas où il aurait été
--    renommé depuis son introduction. Si vous avez modifié cette fonction
--    de déclencheur depuis le 2026-09-07, revérifiez ce point avec moi
--    avant d'exécuter ce script.
-- ---------------------------------------------------------------------
create or replace function public.switch_association(p_association_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_trigger_name text;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié.';
  end if;

  select role into v_role
  from public.association_memberships
  where profile_id = auth.uid() and association_id = p_association_id;

  if v_role is null then
    raise exception 'Vous n''appartenez pas à cette association.';
  end if;

  select tgname into v_trigger_name
  from pg_trigger
  where tgrelid = 'public.profiles'::regclass
    and tgfoid = 'public.enforce_president_only_role_change'::regproc
  limit 1;

  if v_trigger_name is not null then
    execute format('alter table public.profiles disable trigger %I', v_trigger_name);
  end if;

  begin
    update public.profiles
    set association_id = p_association_id, role = v_role
    where id = auth.uid();
  exception when others then
    if v_trigger_name is not null then
      execute format('alter table public.profiles enable trigger %I', v_trigger_name);
    end if;
    raise;
  end;

  if v_trigger_name is not null then
    execute format('alter table public.profiles enable trigger %I', v_trigger_name);
  end if;
end;
$$;

-- Fin du script. Prochaine étape (côté application, une fois ceci
-- exécuté et confirmé) : le sélecteur d'association dans la sidebar
-- n'affiche ses options que si association_memberships contient plus
-- d'une ligne pour le compte connecté — pour AREM aujourd'hui (une seule
-- association), il n'apparaîtra donc toujours pas, ce qui est le
-- comportement attendu tant que personne n'a de deuxième appartenance.
