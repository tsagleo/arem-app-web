-- =====================================================================
-- Élargir les méthodes de paiement enregistrées manuellement, pour que
-- l'application reste utile à une association dans n'importe quel pays
-- (chantier « maximum de pays, outils gratuits », voir le document de
-- projet « internationalisation-universelle.md »).
-- =====================================================================
-- Aujourd'hui, tout paiement qui n'est ni un virement Interac ni une
-- carte Stripe (deux options nord-américaines) tombe dans un seul
-- bouchon générique « manuel », sans distinction. Ce script ajoute des
-- valeurs explicites — espèces, virement bancaire, Mobile Money, chèque,
-- autre — aux trois endroits où le Bureau choisit une méthode de
-- paiement à la main : le versement de la cagnotte Cotisation/Collation
-- à un bénéficiaire (tontine_seances), le versement à la famille dans le
-- volet Funéraire (funeraire_dossiers), et les contributions de la
-- collecte de solidarité Funéraire (funeraire_contributions).
--
-- Purement additif : aucune donnée existante n'est touchée, « manuel »
-- reste une valeur valide pour l'historique (et reste utilisée ailleurs
-- dans l'application, notamment le registre payment_transactions non
-- concerné par ce script). Rien ne casse pour AREM.
-- =====================================================================

-- ---------- 1) tontine_seances.versement_methode ----------

alter table public.tontine_seances drop constraint if exists tontine_seances_versement_methode_check;
alter table public.tontine_seances add constraint tontine_seances_versement_methode_check
  check (versement_methode is null or versement_methode in (
    'stripe', 'interac', 'manuel', 'especes', 'virement_bancaire', 'mobile_money', 'cheque', 'autre'
  ));

-- ---------- 2) funeraire_dossiers.versement_methode ----------

alter table public.funeraire_dossiers drop constraint if exists funeraire_dossiers_versement_methode_check;
alter table public.funeraire_dossiers add constraint funeraire_dossiers_versement_methode_check
  check (versement_methode is null or versement_methode in (
    'stripe', 'interac', 'manuel', 'especes', 'virement_bancaire', 'mobile_money', 'cheque', 'autre'
  ));

-- ---------- 3) funeraire_contributions.methode ----------

alter table public.funeraire_contributions drop constraint if exists funeraire_contributions_methode_check;
alter table public.funeraire_contributions add constraint funeraire_contributions_methode_check
  check (methode in (
    'stripe', 'interac', 'manuel', 'especes', 'virement_bancaire', 'mobile_money', 'cheque', 'autre'
  ));
