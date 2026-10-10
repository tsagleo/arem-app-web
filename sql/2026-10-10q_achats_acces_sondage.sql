-- =====================================================================
-- Achats groupés : accès aux souscriptions après un sondage d'intérêt
-- (2026-10-10, demandé par l'utilisateur)
-- =====================================================================
-- À l'ouverture des souscriptions, le bureau choisit :
--   • « tous »     : ouvert à tous les membres ;
--   • « priorite » : réservé aux participants du sondage pendant N heures
--                    (48 par défaut), puis ouvert à tous — les autres
--                    membres sont prévenus à la fin de la priorité ;
--   • « reserve »  : réservé aux participants du sondage.
-- La règle est appliquée par la base (déclencheur sur les souscriptions).
-- Rappel automatique, la veille de la date limite, aux intéressés qui
-- n'ont pas encore souscrit.
-- Prérequis : sql/2026-10-10p_achats_nouvelle_generation.sql. Ré-exécutable.
-- =====================================================================

alter table public.achats_groupes
  add column if not exists acces_mode text not null default 'tous',
  add column if not exists priorite_jusqu_au timestamptz,
  add column if not exists priorite_fin_notifiee boolean not null default false,
  add column if not exists rappel_veille_envoye boolean not null default false;
alter table public.achats_interets
  add column if not exists tardif boolean not null default false,   -- demande de rattrapage après le sondage
  add column if not exists accepte boolean not null default true;   -- une demande tardive attend l'accord du bureau
alter table public.achats_groupes drop constraint if exists achats_groupes_acces_mode_check;
alter table public.achats_groupes add constraint achats_groupes_acces_mode_check check (acces_mode in ('tous', 'priorite', 'reserve'));

-- Nouvelle signature (mode d'accès) : l'ancienne est retirée pour éviter
-- toute ambiguïté d'appel.
drop function if exists public.achats_ouvrir_souscriptions(uuid, timestamptz);
create or replace function public.achats_ouvrir_souscriptions(p_id uuid, p_date_limite timestamptz, p_mode text default 'priorite', p_heures int default 48) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; p uuid; v_fin timestamptz;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'sondage' then raise exception 'Cet achat n''est pas en sondage.'; end if;
  if p_date_limite is null or p_date_limite <= now() then raise exception 'La date limite doit être dans le futur.'; end if;
  if coalesce(p_mode, 'tous') not in ('tous', 'priorite', 'reserve') then raise exception 'Mode d''accès invalide.'; end if;
  if p_mode in ('priorite', 'reserve') and not exists (select 1 from public.achats_interets where achat_id = p_id) then
    raise exception 'Personne n''a participé au sondage : choisissez « Ouvert à tous ».';
  end if;
  v_fin := case when p_mode = 'priorite' then least(now() + make_interval(hours => greatest(coalesce(p_heures, 48), 1)), p_date_limite) end;
  update public.achats_groupes
     set statut = 'ouvert', date_limite = p_date_limite, acces_mode = coalesce(p_mode, 'tous'), priorite_jusqu_au = v_fin,
         priorite_fin_notifiee = false, rappel_veille_envoye = false
   where id = p_id;
  -- Les intéressés en premier, avec leur quantité déjà proposée à l'écran.
  for p in select pr.id from public.profiles pr join public.achats_interets i on i.member_id = pr.member_id where i.achat_id = p_id loop
    begin
      perform public.notify_profile(v_a.association_id, p, 'Souscriptions ouvertes : ' || left(v_a.titre, 80),
        case when p_mode = 'priorite' then 'Priorité aux personnes intéressées jusqu''au ' || to_char(v_fin at time zone 'America/Moncton', 'DD/MM à HH24"h"MI') || ' : confirmez votre quantité.'
             else 'Vous aviez marqué votre intérêt : confirmez votre quantité avant la date limite.' end);
    exception when others then null;
    end;
  end loop;
  -- Ouvert à tous dès maintenant : tout le monde est prévenu.
  if p_mode = 'tous' then
    perform public.achats_notifier(p_id, 'Souscriptions ouvertes', v_a.titre || ' — souscrivez avant la date limite.', true);
  end if;
end;
$fn$;
grant execute on function public.achats_ouvrir_souscriptions(uuid, timestamptz, text, int) to authenticated;

-- Règle d'accès appliquée à toute souscription.
create or replace function public.achats_trg_acces_sondage() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  if new.statut <> 'inscrit' then return new; end if;
  if tg_op = 'UPDATE' and old.statut = 'inscrit' then return new; end if;
  select * into v_a from public.achats_groupes where id = new.achat_id;
  if v_a.acces_mode = 'reserve' or (v_a.acces_mode = 'priorite' and v_a.priorite_jusqu_au > now()) then
    if not exists (select 1 from public.achats_interets where achat_id = new.achat_id and member_id = new.member_id and accepte) then
      raise exception '%', case when v_a.acces_mode = 'reserve'
        then 'Cet achat est réservé aux membres qui ont participé au sondage d''intérêt.'
        else 'Priorité aux participants du sondage jusqu''au ' || to_char(v_a.priorite_jusqu_au at time zone 'America/Moncton', 'DD/MM à HH24"h"MI') || ' : vous pourrez souscrire ensuite.' end;
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_achats_acces_sondage on public.achats_souscriptions;
create trigger trg_achats_acces_sondage before insert or update on public.achats_souscriptions
  for each row execute function public.achats_trg_acces_sondage();

-- Fin de priorité (tous prévenus) et rappel la veille aux intéressés
-- qui n'ont pas encore souscrit. Toutes les heures.
create or replace function public.achats_rappels_sondage() returns void
language plpgsql security definer set search_path = '' as $fn$
declare r record; p uuid;
begin
  for r in select * from public.achats_groupes
            where statut = 'ouvert' and acces_mode = 'priorite' and not priorite_fin_notifiee and priorite_jusqu_au <= now()
  loop
    perform public.achats_notifier(r.id, 'Places ouvertes à tous', r.titre || ' — la période de priorité est terminée : souscrivez avant la date limite.', true);
    update public.achats_groupes set priorite_fin_notifiee = true where id = r.id;
  end loop;
  for r in select * from public.achats_groupes
            where statut = 'ouvert' and not rappel_veille_envoye and date_limite between now() + interval '20 hours' and now() + interval '28 hours'
  loop
    for p in select pr.id from public.profiles pr join public.achats_interets i on i.member_id = pr.member_id
              where i.achat_id = r.id
                and not exists (select 1 from public.achats_souscriptions s where s.achat_id = r.id and s.member_id = i.member_id and s.statut = 'inscrit')
    loop
      begin
        perform public.notify_profile(r.association_id, p, 'Dernier jour : ' || left(r.titre, 80), 'Vous aviez marqué votre intérêt mais n''avez pas encore souscrit. Date limite : demain.');
      exception when others then null;
      end;
    end loop;
    update public.achats_groupes set rappel_veille_envoye = true where id = r.id;
  end loop;
end;
$fn$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'achats-rappels-sondage';
    perform cron.schedule('achats-rappels-sondage', '15 * * * *', 'select public.achats_rappels_sondage()');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Rattrapage et retour arrière (2026-10-10, demandé par l'utilisateur :
-- « ne pas pénaliser ceux qui n'ont pas participé, leur permettre de se
-- racheter »)
-- ---------------------------------------------------------------------
-- Un membre qui n'a pas participé au sondage demande à participer ; le
-- bureau (ou le porteur) accepte ou refuse.
create or replace function public.achats_demander_participation(p_id uuid, p_quantite numeric) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; v_m uuid := public.current_member_id(); p uuid;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or v_m is null then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'ouvert' or v_a.acces_mode = 'tous' then raise exception 'Les souscriptions sont ouvertes à tous : souscrivez directement.'; end if;
  if coalesce(p_quantite, 0) <= 0 then raise exception 'Quantité invalide.'; end if;
  insert into public.achats_interets (achat_id, association_id, member_id, member_nom, quantite, tardif, accepte)
  values (p_id, v_a.association_id, v_m, (select nom from public.members where id = v_m), p_quantite, true, false)
  on conflict (achat_id, member_id) do update set quantite = excluded.quantite
   where not public.achats_interets.accepte;
  for p in select pr.id from public.profiles pr
            where pr.association_id = v_a.association_id
              and (pr.role in ('bureau_president', 'bureau_secretaire', 'bureau_tresorier') or pr.member_id = v_a.porteur_member_id)
  loop
    begin
      perform public.notify_profile(v_a.association_id, p, 'Demande de participation', (select nom from public.members where id = v_m) || ' souhaite rejoindre « ' || left(v_a.titre, 70) || ' ».');
    exception when others then null;
    end;
  end loop;
end;
$fn$;
grant execute on function public.achats_demander_participation(uuid, numeric) to authenticated;

create or replace function public.achats_statuer_participation(p_id uuid, p_member uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes; p uuid;
begin
  select * into v_a from public.achats_groupes where id = p_id;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not (public.is_bureau() or public.achats_est_gestionnaire(p_id)) then raise exception 'Non autorisé.'; end if;
  if p_ok then
    update public.achats_interets set accepte = true where achat_id = p_id and member_id = p_member;
  else
    delete from public.achats_interets where achat_id = p_id and member_id = p_member and tardif;
  end if;
  for p in select pr.id from public.profiles pr where pr.member_id = p_member loop
    begin
      perform public.notify_profile(v_a.association_id, p, left(v_a.titre, 80),
        case when p_ok then 'Votre demande est acceptée : vous pouvez souscrire.' else 'Votre demande de participation n''a pas pu être acceptée.' end);
    exception when others then null;
    end;
  end loop;
end;
$fn$;
grant execute on function public.achats_statuer_participation(uuid, uuid, boolean) to authenticated;

-- Le bureau change l'accès en cours de route (ex. « Ouvrir à tous maintenant »).
create or replace function public.achats_changer_acces(p_id uuid, p_mode text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'ouvert' then raise exception 'Les souscriptions ne sont pas ouvertes.'; end if;
  if p_mode not in ('tous', 'reserve') then raise exception 'Mode d''accès invalide.'; end if;
  update public.achats_groupes set acces_mode = p_mode, priorite_jusqu_au = null, priorite_fin_notifiee = true where id = p_id;
  if p_mode = 'tous' then
    perform public.achats_notifier(p_id, 'Places ouvertes à tous', v_a.titre || ' — tous les membres peuvent maintenant souscrire.', true);
  end if;
end;
$fn$;
grant execute on function public.achats_changer_acces(uuid, text) to authenticated;

-- Flèche de retour : revenir au sondage tant que personne n'a souscrit.
create or replace function public.achats_revenir_au_sondage(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
declare v_a public.achats_groupes;
begin
  select * into v_a from public.achats_groupes where id = p_id for update;
  if v_a.id is null or v_a.association_id <> public.current_association_id() or not public.is_bureau() then raise exception 'Non autorisé.'; end if;
  if v_a.statut <> 'ouvert' then raise exception 'Retour au sondage impossible à cette étape.'; end if;
  if exists (select 1 from public.achats_souscriptions where achat_id = p_id and statut = 'inscrit') then
    raise exception 'Des membres ont déjà souscrit : le retour au sondage n''est plus possible (utilisez « Ouvrir à tous »).';
  end if;
  update public.achats_groupes set statut = 'sondage', acces_mode = 'tous', priorite_jusqu_au = null where id = p_id;
  update public.achats_interets set tardif = false, accepte = true where achat_id = p_id;
  perform public.achats_notifier(p_id, 'Sondage rouvert', v_a.titre || ' — le sondage d''intérêt est rouvert : indiquez votre quantité.', true);
end;
$fn$;
grant execute on function public.achats_revenir_au_sondage(uuid) to authenticated;

-- Vérification :
--   select proname from pg_proc where proname in ('achats_ouvrir_souscriptions','achats_demander_participation','achats_statuer_participation','achats_changer_acces','achats_revenir_au_sondage');  -- 5 lignes
