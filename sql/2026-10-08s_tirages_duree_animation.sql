-- =====================================================================
-- Tirages au sort — durée de l'animation de chaque numéro (2026-10-08)
-- (suite de 2026-10-08r_tirages_au_sort.sql)
-- =====================================================================
-- Demande de l'utilisateur : choisir combien de temps les noms défilent
-- avant que chaque numéro se pose — instantané, 5, 10, 15, 20, 30, 40 s
-- ou 1 minute. C'est uniquement de la mise en scène : l'ordre est fixé
-- par le serveur au lancement et ne dépend pas de cette durée. Le bureau
-- peut donc la changer à tout moment avant la fin, même en plein direct.
-- La valeur est stockée sur le tirage pour que TOUS les écrans
-- jouent la même durée. Ré-exécutable sans risque.
-- =====================================================================

alter table public.tirages
  add column if not exists duree_animation int not null default 5;

alter table public.tirages drop constraint if exists tirages_duree_animation_check;
alter table public.tirages add constraint tirages_duree_animation_check
  check (duree_animation in (0, 5, 10, 15, 20, 30, 40, 60));

comment on column public.tirages.duree_animation is
  'Durée (secondes) du défilement des noms avant chaque numéro dévoilé en direct. Mise en scène seulement, sans effet sur le résultat.';

create or replace function public.definir_duree_tirage(p_id uuid, p_duree int) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_t public.tirages;
begin
  select * into v_t from public.tirages where id = p_id for update;
  if v_t.id is null or v_t.association_id <> public.current_association_id() or not public.is_bureau() then
    raise exception 'Non autorisé.';
  end if;
  if v_t.statut not in ('prepare', 'en_cours') then raise exception 'Ce tirage est terminé ou annulé.'; end if;
  if p_duree not in (0, 5, 10, 15, 20, 30, 40, 60) then raise exception 'Durée invalide.'; end if;
  update public.tirages set duree_animation = p_duree where id = p_id;
end;
$fn$;

grant execute on function public.definir_duree_tirage(uuid, int) to authenticated;
