-- =====================================================================
-- Décharge de réception (Cotisation/Collation) authentique : numérotation
-- =====================================================================
-- Suite 55 (2026-09-11), à la demande de l'utilisateur : "numéroter et
-- rendre authentique, mettre le logo et informations de l'association"
-- sur la décharge imprimable (App.jsx, DechargeModal). Le logo et le nom
-- de l'association utilisent des champs déjà existants
-- (associations.logo_url/nom — aucun changement de base nécessaire pour
-- ce volet, seulement côté interface) ; les signatures du bureau
-- réutilisent aussi des colonnes déjà en place (signataire1/2_nom/titre,
-- suite 50). Seul ce qui suit est nouveau : un numéro de décharge
-- permanent, sur le même patron que payment_transactions.numero_recu
-- (suite 50, sql/2026-09-10j).
--
-- Contrairement aux reçus de paiement (une ligne = un paiement = un
-- numéro), une décharge ne concerne QU'UNE PARTIE des lignes de
-- tontine_seances : uniquement celles où un bénéficiaire a été désigné
-- (beneficiaire_id non nul) — c'est la seule condition sous laquelle le
-- bouton "Décharge" est même affiché dans l'application. Les autres
-- lignes (séances sans attribution) ne reçoivent donc jamais de numéro.
-- D'où un déclencheur plutôt qu'un simple "default nextval(...)" : le
-- numéro n'est attribué que si beneficiaire_id est renseigné, UNE SEULE
-- FOIS (jamais recalculé ensuite, même si la ligne est modifiée à
-- nouveau) — garantie nécessaire pour qu'un numéro reste une référence
-- fiable en cas de contrôle.
-- =====================================================================

alter table public.tontine_seances add column if not exists numero_decharge bigint;

create sequence if not exists public.tontine_seances_numero_decharge_seq;

-- Rattrapage des lignes déjà existantes qui ont un bénéficiaire (donc une
-- décharge potentiellement déjà imprimée/signée) mais pas encore de
-- numéro — numérotées dans un ordre déterministe (id) faute de colonne de
-- date de création fiable sur cette table historique.
with numbered as (
  select id, row_number() over (order by id) as rn
  from public.tontine_seances
  where beneficiaire_id is not null and numero_decharge is null
)
update public.tontine_seances ts
set numero_decharge = numbered.rn
from numbered
where ts.id = numbered.id;

select setval('public.tontine_seances_numero_decharge_seq', (select coalesce(max(numero_decharge), 0) from public.tontine_seances));

create or replace function public.assign_numero_decharge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.beneficiaire_id is not null and new.numero_decharge is null then
    new.numero_decharge := nextval('public.tontine_seances_numero_decharge_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_numero_decharge on public.tontine_seances;
create trigger trg_assign_numero_decharge
before insert or update on public.tontine_seances
for each row execute function public.assign_numero_decharge();

-- Unique uniquement parmi les lignes numérotées (les lignes sans
-- bénéficiaire restent à NULL, qui n'entre jamais en conflit avec
-- lui-même dans un index unique Postgres).
create unique index if not exists tontine_seances_numero_decharge_idx
  on public.tontine_seances (numero_decharge) where numero_decharge is not null;

comment on column public.tontine_seances.numero_decharge is
  'Numéro de décharge permanent, attribué une seule fois (jamais recalculé) dès qu''un bénéficiaire est désigné — affiché sur le document imprimable "Décharge de réception". Séquence globale (toutes associations, comme payment_transactions.numero_recu) — voir suite 55.';
