-- =====================================================================
-- Reçus authentiques : numérotation séquentielle + signataires
-- =====================================================================
-- Suite 50 (2026-09-10), à la demande de l'utilisateur : rendre les reçus
-- téléchargeables depuis « Mon espace » plus officiels — un numéro de
-- reçu permanent par paiement, et une ou deux lignes de signature portant
-- un nom et un titre configurables par l'association (le logo, lui,
-- utilise le champ associations.logo_url déjà en place — voir la
-- configuration « Image de marque »).
--
-- 1) Numérotation : une colonne numero_recu, entier croissant, unique,
--    attribué UNE SEULE FOIS à chaque ligne du registre et qui ne change
--    plus jamais ensuite (contrairement à une numérotation recalculée à
--    chaque impression, qui ferait porter un numéro différent au même
--    paiement d'une fois à l'autre — inutilisable pour un audit). Les
--    lignes déjà existantes sont numérotées ici dans l'ordre chronologique
--    (created_at) ; toute nouvelle ligne reçoit automatiquement le numéro
--    suivant via une séquence.
--    Note : la numérotation est globale à l'application (toutes
--    associations confondues), pas remise à zéro par association — plus
--    simple à garantir sans collision, au prix de numéros non contigus
--    pour une association en particulier. Dites-le si une numérotation
--    strictement propre à chaque association est nécessaire : cela
--    demande une séquence par association, réalisable dans une migration
--    séparée.
-- 2) Signataires : deux couples nom/titre en texte libre sur
--    "associations", modifiables depuis Configuration → « Signataires des
--    reçus ». Champs texte plutôt qu'une référence vers un profil du
--    bureau : le nom affiché sur un reçu doit rester stable même si la
--    personne qui occupe le poste change entretemps, et reste modifiable
--    sans dépendre de qui est actuellement connecté.
-- =====================================================================

-- ---------- 1) Numérotation séquentielle des reçus ----------
alter table public.payment_transactions add column if not exists numero_recu bigint;

create sequence if not exists public.payment_transactions_numero_recu_seq;

with numbered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.payment_transactions
  where numero_recu is null
)
update public.payment_transactions pt
set numero_recu = numbered.rn
from numbered
where pt.id = numbered.id;

select setval('public.payment_transactions_numero_recu_seq', (select coalesce(max(numero_recu), 0) from public.payment_transactions));

alter table public.payment_transactions alter column numero_recu set default nextval('public.payment_transactions_numero_recu_seq');
alter table public.payment_transactions alter column numero_recu set not null;

create unique index if not exists payment_transactions_numero_recu_idx on public.payment_transactions (numero_recu);

comment on column public.payment_transactions.numero_recu is
  'Numéro de reçu permanent, attribué une seule fois (jamais recalculé) — affiché sur le reçu imprimable dans Mon espace. Séquence globale (toutes associations), voir suite 50.';

-- ---------- 2) Signataires des reçus ----------
alter table public.associations add column if not exists signataire1_nom text;
alter table public.associations add column if not exists signataire1_titre text;
alter table public.associations add column if not exists signataire2_nom text;
alter table public.associations add column if not exists signataire2_titre text;

comment on column public.associations.signataire1_nom is 'Nom affiché sur la première ligne de signature des reçus de paiement (vide = titre générique seul).';
comment on column public.associations.signataire2_nom is 'Nom affiché sur la deuxième ligne de signature des reçus de paiement (vide = titre générique seul).';
