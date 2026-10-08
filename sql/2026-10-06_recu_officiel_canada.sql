-- =====================================================================
-- Reçu officiel de don conforme (Canada, règles de l'Agence du revenu du
-- Canada — ARC/CRA). Deuxième juridiction du chantier "reçu fiscal
-- conforme", après la France (CERFA 2041-RD, voir
-- sql/2026-10-06_recu_fiscal_cerfa.sql). Recherche préalable sur les
-- mentions obligatoires exactes (pages officielles canada.ca) — voir
-- claude/resume-arem-app.md pour le détail (règle des 80 %, seuil de
-- minimis 75 $/10 %, juste valeur marchande, numéro d'enregistrement
-- RRxxxx, etc.).
--
-- Ce script est additif uniquement (ALTER TABLE ... ADD COLUMN IF NOT
-- EXISTS, valeurs par défaut neutres) : aucune association existante
-- n'est affectée tant que personne ne renseigne
-- `recu_numero_organisme_bienfaisance`. Les associations françaises déjà
-- configurées pour le CERFA, et celles qui n'émettent aucun reçu fiscal
-- conforme, continuent de fonctionner à l'identique.
--
-- Réutilise volontairement l'infrastructure déjà posée pour la France :
-- - `nature_don = 'nature'` sert aussi de marqueur "don en nature" ici
--   (pas de nouvelle colonne pour cette distinction) ;
-- - `assign_recu_numero()` (déjà créée) attribue le numéro de série
--   unique exigé par l'ARC exactement comme le "numéro d'ordre" français
--   — même fonction, même compteur par association, aucun changement.
-- =====================================================================

-- ---------- associations : identité requise par l'ARC ----------
alter table public.associations
  add column if not exists recu_numero_organisme_bienfaisance text;

alter table public.associations drop constraint if exists associations_numero_organisme_bienfaisance_check;
alter table public.associations
  add constraint associations_numero_organisme_bienfaisance_check
    check (recu_numero_organisme_bienfaisance is null or recu_numero_organisme_bienfaisance ~ '^[0-9]{9}RR[0-9]{4}$');

comment on column public.associations.recu_numero_organisme_bienfaisance is
  'Numéro d''enregistrement d''organisme de bienfaisance attribué par l''ARC, format exact NNNNNNNNNRR0001 (9 chiffres + RR + 4 chiffres). Présence de ce champ = active le reçu officiel conforme Canada sur DonReceiptModal (FinancesElargies.jsx). NULL = non renseigné (association hors Canada, ou pas encore configuré).';

-- ---------- donations : mentions propres au reçu canadien ----------
-- (donateur_adresse, numero_recu, nature_don déjà ajoutés par le script
-- France — réutilisés ici tels quels, voir le commentaire d'en-tête.)
alter table public.donations
  add column if not exists lieu_delivrance text,
  add column if not exists valeur_avantage numeric,
  add column if not exists description_avantage text,
  add column if not exists avantage_type_exclu boolean not null default false,
  add column if not exists description_bien_nature text,
  add column if not exists evaluateur_nom text,
  add column if not exists evaluateur_adresse text;

comment on column public.donations.valeur_avantage is
  'Juste valeur marchande de tout avantage reçu par le donateur en contrepartie du don (ex. repas d''un événement-bénéfice) — règle du "reçu fractionné" de l''ARC. NULL/0 = aucun avantage.';
comment on column public.donations.avantage_type_exclu is
  'true si l''avantage est une quasi-espèce (carte-cadeau) ou un élément d''événement-bénéfice (repas, droits de green) : ces avantages doivent TOUJOURS être soustraits du montant admissible, même sous le seuil de minimis de l''ARC (75 $ ou 10 % de la JVM du don, le moindre des deux). false = le seuil de minimis s''applique normalement.';
comment on column public.donations.description_bien_nature is
  'Description du bien donné, exigée par l''ARC sur un reçu officiel pour un don en nature (nature_don = ''nature''). Distincte de `message` (mot du donateur, facultatif, sans valeur légale).';
comment on column public.donations.evaluateur_nom is
  'Nom du tiers évaluateur indépendant de la juste valeur marchande — exigé sur le reçu par l''ARC lorsque la JVM d''un don en nature dépasse 1 000 $ (en dessous, l''auto-évaluation par un membre compétent de l''organisme suffit).';
