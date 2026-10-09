-- =====================================================================
-- Comité restreint — notifications (2026-10-10)
-- (à exécuter APRÈS 2026-10-09d_comite_restreint.sql)
-- =====================================================================
-- Demande de l'utilisateur : prévenir automatiquement
--   1. les membres du comité quand une décision est mise au vote ;
--   2. ceux qui n'ont pas encore voté, par un rappel 2 jours après
--      l'ouverture si le vote est toujours en cours ;
--   3. les membres du comité du résultat, à la clôture ;
--   4. le reste du bureau quand une décision lui est communiquée
--      (vote clos + « À communiquer au bureau »).
-- Les notifications ne contiennent que le titre et le résultat — jamais
-- qui a voté quoi. Envoi par notify_profile() (notifications de
-- l'application), sans effet si les notifications ne sont pas configurées.
-- Ré-exécutable sans risque.
-- =====================================================================

alter table public.comite_decisions add column if not exists rappel_le timestamptz;

create or replace function public.comite_libelle_resultat(p_statut text) returns text
language sql immutable set search_path = '' as $fn$
  select case p_statut when 'adoptee' then 'adoptée' when 'rejetee' then 'rejetée'
                       when 'sans_quorum' then 'quorum non atteint' else 'vote en cours' end
$fn$;

create or replace function public.comite_decisions_notifier() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_p uuid;
  v_clos_avant boolean;
  v_clos_apres boolean;
begin
  -- 1. Nouvelle décision au vote : membres du comité (sauf l'auteur).
  if tg_op = 'INSERT' and new.statut = 'en_vote' then
    for v_p in select e.profile_id from public.comite_effectif(new.association_id) e where e.profile_id is distinct from new.auteur_id loop
      perform public.notify_profile(new.association_id, v_p, '🗳️ Comité restreint : vote ouvert',
        '« ' || new.titre || ' » — votez dans Gouvernance → Comité restreint → Décisions.');
    end loop;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_clos_avant := old.statut <> 'en_vote';
    v_clos_apres := new.statut <> 'en_vote';

    -- 3. Clôture : résultat aux membres du comité.
    if v_clos_apres and not v_clos_avant then
      for v_p in select e.profile_id from public.comite_effectif(new.association_id) e loop
        perform public.notify_profile(new.association_id, v_p, '🗳️ Comité restreint : vote clos',
          '« ' || new.titre || ' » : ' || public.comite_libelle_resultat(new.statut) || ' (pour ' || new.pour || ', contre ' || new.contre || ', abstention ' || new.abstention || ').');
      end loop;
    end if;

    -- 4. Décision désormais communiquée au bureau (close + diffusion bureau).
    if v_clos_apres and new.diffusion = 'bureau' and not (v_clos_avant and old.diffusion = 'bureau') then
      for v_p in
        select p.id from public.profiles p
         where p.association_id = new.association_id
           and p.role in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier', 'bureau_custom')
           and not exists (select 1 from public.comite_effectif(new.association_id) e where e.profile_id = p.id)
      loop
        perform public.notify_profile(new.association_id, v_p, '📢 Décision du comité restreint',
          '« ' || new.titre || ' » : ' || public.comite_libelle_resultat(new.statut) || '. À lire dans Gouvernance → Comité restreint.');
      end loop;
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_comite_decisions_notifier on public.comite_decisions;
create trigger trg_comite_decisions_notifier after insert or update of statut, diffusion on public.comite_decisions
for each row execute function public.comite_decisions_notifier();

-- 2. Rappel quotidien : votes ouverts depuis plus de 2 jours, aux membres
--    qui n'ont pas encore voté (un seul rappel par décision).
create or replace function public.comite_rappels_votes() returns integer
language plpgsql security definer set search_path = '' as $fn$
declare
  v_d record;
  v_p uuid;
  v_n integer := 0;
begin
  for v_d in
    select * from public.comite_decisions d
     where d.statut = 'en_vote' and d.rappel_le is null and d.created_at < now() - interval '2 days'
  loop
    for v_p in
      select e.profile_id from public.comite_effectif(v_d.association_id) e
       where not exists (select 1 from public.comite_votes v where v.decision_id = v_d.id and v.profile_id = e.profile_id)
    loop
      perform public.notify_profile(v_d.association_id, v_p, '⏰ Comité restreint : votre vote est attendu',
        '« ' || v_d.titre || ' » est au vote depuis plus de 2 jours.');
      v_n := v_n + 1;
    end loop;
    update public.comite_decisions set rappel_le = now() where id = v_d.id;
  end loop;
  return v_n;
end;
$fn$;
revoke all on function public.comite_rappels_votes() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('comite-rappels-votes', '0 14 * * *', 'select public.comite_rappels_votes();');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Vérification (à lancer après) :
--   select tgname from pg_trigger where tgname = 'trg_comite_decisions_notifier';   -- 1 ligne
-- ---------------------------------------------------------------------
