-- =====================================================================
-- Achats groupés : le membre est prévenu du retrait de sa part
-- (2026-10-10, demandé par l'utilisateur : « une fois la marchandise
-- retirée, ça doit être précisé dans les comptes correspondants »)
-- =====================================================================
create or replace function public.achats_trg_retrait() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare p uuid; v_titre text; v_unite text;
begin
  if new.remis_le is null or old.remis_le is not null then return null; end if;
  select titre, unite into v_titre, v_unite from public.achats_groupes where id = new.achat_id;
  for p in select pr.id from public.profiles pr where pr.member_id = new.member_id loop
    begin
      perform public.notify_profile(new.association_id, p, 'Part retirée — ' || left(coalesce(v_titre, ''), 60),
        to_char(new.quantite_attribuee, 'FM999990.###') || ' ' || coalesce(v_unite, '') || ' remis le ' || to_char(new.remis_le at time zone 'America/Moncton', 'DD/MM à HH24"h"MI')
        || case new.remise_mode when 'procuration' then ' (récupéré par ' || coalesce(new.remis_a_nom, '') || ')' when 'scan' then ' (scan de votre carte)' else '' end || '.');
    exception when others then null;
    end;
  end loop;
  return null;
end;
$fn$;
drop trigger if exists trg_achats_retrait on public.achats_souscriptions;
create trigger trg_achats_retrait after update of remis_le on public.achats_souscriptions
  for each row execute function public.achats_trg_retrait();
