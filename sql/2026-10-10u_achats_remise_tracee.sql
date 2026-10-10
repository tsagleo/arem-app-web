-- =====================================================================
-- Achats groupés : remise TRACÉE (2026-10-10, signalé par l'utilisateur :
-- « j'ai cliqué sur Remettre et ça a validé le retrait sans scan de
-- badge ni procuration »)
-- =====================================================================
-- Chaque remise enregistre sa façon de faire :
--   • scan        : carte de membre scannée ;
--   • manuel      : remise sans scan, identité vérifiée par le porteur ;
--   • procuration : une autre personne récupère (nom obligatoire).
-- Une remise manuelle exige la confirmation explicite du porteur (écran).
-- Ré-exécutable sans risque.
-- =====================================================================
alter table public.achats_souscriptions add column if not exists remise_mode text;
alter table public.achats_souscriptions drop constraint if exists achats_souscriptions_remise_mode_check;
alter table public.achats_souscriptions add constraint achats_souscriptions_remise_mode_check
  check (remise_mode is null or remise_mode in ('scan', 'manuel', 'procuration'));

drop function if exists public.achats_remettre_plus(uuid, uuid, uuid, text);
create or replace function public.achats_remettre_plus(p_id uuid, p_token uuid default null, p_sous uuid default null, p_procuration text default null, p_mode text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v_res jsonb; v_photo text; v_mode text;
begin
  -- Remise manuelle : jamais sans confirmation (mode indiqué par l'écran).
  if p_token is null and coalesce(p_mode, '') not in ('manuel', 'procuration') then
    raise exception 'Remise sans scan : confirmez la vérification d''identité (ou indiquez la procuration).';
  end if;
  if p_mode = 'procuration' and coalesce(trim(p_procuration), '') = '' then
    raise exception 'Procuration : indiquez le nom de la personne qui récupère.';
  end if;
  v_res := public.achats_remettre(p_id, p_token, p_sous);
  if (v_res->>'ok')::boolean then
    if not (v_res->>'deja_remis')::boolean then
      v_mode := case when coalesce(trim(p_procuration), '') <> '' then 'procuration' when p_token is not null then 'scan' else 'manuel' end;
      update public.achats_souscriptions
         set remis_a_nom = nullif(trim(coalesce(p_procuration, '')), ''), remise_mode = v_mode
       where id = (v_res->>'souscription_id')::uuid;
    end if;
    select m.photo_url into v_photo from public.members m join public.achats_souscriptions s on s.member_id = m.id where s.id = (v_res->>'souscription_id')::uuid;
    v_res := v_res || jsonb_build_object('photo_url', v_photo,
      'remis_a_nom', (select remis_a_nom from public.achats_souscriptions where id = (v_res->>'souscription_id')::uuid),
      'remise_mode', (select remise_mode from public.achats_souscriptions where id = (v_res->>'souscription_id')::uuid));
  end if;
  return v_res;
end;
$fn$;
grant execute on function public.achats_remettre_plus(uuid, uuid, uuid, text, text) to authenticated;

-- L'ancienne fonction n'est plus appelable directement depuis l'écran :
-- toute remise passe par achats_remettre_plus (et donc par sa traçabilité).
revoke execute on function public.achats_remettre(uuid, uuid, uuid) from public, anon, authenticated;

-- Vérification :
--   select column_name from information_schema.columns where table_name = 'achats_souscriptions' and column_name = 'remise_mode';  -- 1 ligne
