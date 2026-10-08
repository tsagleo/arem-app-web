-- =====================================================================
-- Covoiturage — Messages et signalements préétablis (configurables)
-- =====================================================================
-- Suite de claude/covoiturage-registre-messages-carte-parametres-
-- proposition.md, approuvée par l'utilisateur le 2026-10-08. Jusqu'ici,
-- IncidentModal et MessageThread n'offraient qu'un champ de texte libre.
-- Inspiré des logiciels de dispatch/flotte sérieux (ex. Opter) : les
-- motifs prédéfinis sont CONFIGURABLES PAR L'ASSOCIATION (jamais figés
-- dans le code), avec repli systématique vers le texte libre. Rien n'est
-- créé par défaut : le bureau ajoute ses propres modèles depuis le
-- nouveau volet Paramètres (l'interface y suggère quelques phrases
-- courantes — embouteillage, travaux, retard… — à ajouter en un clic,
-- mais ça reste une suggestion côté interface, pas une donnée en base).
-- =====================================================================

create table if not exists public.carpool_quick_messages (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  categorie text not null check (categorie in ('signalement', 'message_rapide')),
  cible text not null check (cible in ('passager', 'chauffeur', 'les_deux')),
  texte text not null,
  actif boolean not null default true,
  ordre integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists carpool_quick_messages_assoc_idx on public.carpool_quick_messages(association_id);
comment on table public.carpool_quick_messages is
  'Modèles de phrases préétablis par l''association, utilisables en un clic dans IncidentModal (categorie=signalement, pré-remplit le texte, modifiable) et MessageThread (categorie=message_rapide, insère dans le champ de saisie) — cible indique à qui le modèle s''adresse (passager/chauffeur/les_deux). Gérés par le bureau depuis le volet Paramètres du covoiturage ; aucun modèle n''est créé par défaut.';

alter table public.carpool_quick_messages enable row level security;
drop policy if exists "carpool_quick_messages select membres" on public.carpool_quick_messages;
create policy "carpool_quick_messages select membres" on public.carpool_quick_messages for select to authenticated
  using (association_id = public.current_association_id());
drop policy if exists "carpool_quick_messages ecriture bureau" on public.carpool_quick_messages;
create policy "carpool_quick_messages ecriture bureau" on public.carpool_quick_messages for all to authenticated
  using (association_id = public.current_association_id() and public.is_bureau())
  with check (association_id = public.current_association_id() and public.is_bureau());

-- ---------------------------------------------------------------------
-- Interrupteur général (par association) — si désactivé, IncidentModal
-- et MessageThread reviennent au texte libre uniquement, quel que soit
-- le nombre de modèles configurés. Optionnel, comme demandé.
-- ---------------------------------------------------------------------
alter table public.associations add column if not exists covoiturage_messages_rapides_actif boolean not null default true;
comment on column public.associations.covoiturage_messages_rapides_actif is
  'Active ou non les messages/signalements préétablis pour cette association (modifiable par le bureau via configurer_messages_rapides_covoiturage) — désactivé, IncidentModal et MessageThread n''offrent que le texte libre.';

create or replace function public.configurer_messages_rapides_covoiturage(p_actif boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_bureau() then
    raise exception 'Seul le bureau peut configurer les messages préétablis du covoiturage.';
  end if;
  update public.associations set covoiturage_messages_rapides_actif = p_actif where id = public.current_association_id();
end;
$fn$;
grant execute on function public.configurer_messages_rapides_covoiturage(boolean) to authenticated;
comment on function public.configurer_messages_rapides_covoiturage(boolean) is
  'Le bureau active ou désactive les messages/signalements préétablis pour son association.';

-- =====================================================================
-- Vérification rapide après exécution :
--   select column_name from information_schema.columns
--   where table_name = 'carpool_quick_messages';
--   select column_name from information_schema.columns
--   where table_name = 'associations' and column_name = 'covoiturage_messages_rapides_actif';
--   -- doit afficher 1 ligne
--   select proname from pg_proc where proname = 'configurer_messages_rapides_covoiturage';
--   -- doit afficher 1 ligne
-- =====================================================================
