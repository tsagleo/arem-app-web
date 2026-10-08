-- =====================================================================
-- Registre des transactions : rattrapage étendu (Cotisation / Collation /
-- Don / Prêt)
-- =====================================================================
-- Suite 50 (2026-09-10), en complément de 2026-09-10g_payment_transactions.sql.
-- Cette première migration n'avait rétro-rempli que Inscription / Fonds
-- urgence / Fonds secours, en expliquant que Cotisation et Collation
-- « n'ont pas besoin de ce rattrapage » puisqu'elles s'appuyaient déjà
-- sur tontine_presences/collation_presences — mais le tableau « Détail
-- des transactions » a depuis été branché EXCLUSIVEMENT sur
-- payment_transactions (suite à la demande « ressortir tout l'historique
-- en ligne d'écriture »), donc ces deux rubriques, ainsi que Don et Prêt,
-- restaient vides pour tout paiement antérieur au déploiement de cette
-- fonctionnalité. Ce script comble ce vide.
--
-- 1) Cotisation / Collation : rétro-rempli depuis tontine_presences /
--    collation_presences. Ni l'une ni l'autre ne conserve la date exacte
--    du versement du membre (aucune colonne created_at) — on utilise donc
--    la date de la séance/attribution correspondante (tontine_seances)
--    comme meilleure approximation disponible, à défaut de mieux. Les
--    nouveaux paiements, eux, seront désormais datés avec précision
--    (webhook Stripe / confirmation Interac écrivent déjà created_at).
--    Sécurité anti-doublon : on vérifie l'ABSENCE de toute ligne
--    (peu importe sa référence) pour ce membre + cette rubrique + cette
--    période, pas seulement l'absence de la référence "legacy-*" — pour
--    ne pas dupliquer un paiement déjà journalisé en direct par le
--    webhook Stripe ou par confirmInteracClaim depuis leur mise en
--    service.
-- 2) Don / Prêt : n'ont jamais transité par Stripe (uniquement par
--    virement Interac confirmé par le bureau). On rétro-remplit donc
--    depuis les demandes Interac déjà confirmées (interac_payment_claims,
--    statut = 'confirme'), avec la même référence (l'id de la demande)
--    que celle utilisée par confirmInteracClaim en direct — ce qui rend
--    ce script naturellement idempotent avec les lignes déjà écrites en
--    direct depuis le déploiement de cette fonctionnalité, sans avoir
--    besoin d'un cas particulier.
-- =====================================================================

-- ---------- Cotisation (depuis tontine_presences) ----------
insert into public.payment_transactions (association_id, member_id, type, periode, montant, methode, reference, created_at)
select
  m.association_id,
  tp.member_id,
  'cotisation',
  tp.seance::text,
  tp.montant,
  'manuel',
  'legacy-cotisation-' || tp.id,
  coalesce(
    (select ts.date::timestamptz from public.tontine_seances ts where ts.type = 'tontine' and ts.numero = tp.seance limit 1),
    now()
  )
from public.tontine_presences tp
join public.members m on m.id = tp.member_id
where coalesce(tp.montant, 0) > 0
  and not exists (
    select 1 from public.payment_transactions pt
    where pt.member_id = tp.member_id and pt.type = 'cotisation' and pt.periode = tp.seance::text
  );

-- ---------- Collation (depuis collation_presences) ----------
insert into public.payment_transactions (association_id, member_id, type, periode, montant, methode, reference, created_at)
select
  m.association_id,
  cp.member_id,
  'collation',
  cp.mois,
  cp.montant,
  'manuel',
  'legacy-collation-' || cp.id,
  coalesce(
    (select ts.date::timestamptz from public.tontine_seances ts where ts.type = 'collation' and ts.mois = cp.mois limit 1),
    now()
  )
from public.collation_presences cp
join public.members m on m.id = cp.member_id
where coalesce(cp.montant, 0) > 0
  and not exists (
    select 1 from public.payment_transactions pt
    where pt.member_id = cp.member_id and pt.type = 'collation' and pt.periode = cp.mois
  );

-- ---------- Don (depuis les demandes Interac confirmées) ----------
insert into public.payment_transactions (association_id, member_id, type, periode, montant, methode, reference, created_at)
select
  c.association_id,
  c.member_id,
  'don',
  null,
  coalesce(c.montant_recu, c.montant),
  'interac',
  c.id::text,
  coalesce(c.confirmed_at, c.created_at, now())
from public.interac_payment_claims c
where c.type = 'don' and c.statut = 'confirme'
  and not exists (select 1 from public.payment_transactions pt where pt.reference = c.id::text and pt.methode = 'interac');

-- ---------- Prêt (depuis les demandes Interac confirmées) ----------
insert into public.payment_transactions (association_id, member_id, type, periode, montant, methode, reference, created_at)
select
  c.association_id,
  c.member_id,
  'pret',
  null,
  coalesce(c.montant_recu, c.montant),
  'interac',
  c.id::text,
  coalesce(c.confirmed_at, c.created_at, now())
from public.interac_payment_claims c
where c.type = 'pret' and c.statut = 'confirme'
  and not exists (select 1 from public.payment_transactions pt where pt.reference = c.id::text and pt.methode = 'interac');
