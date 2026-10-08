-- =====================================================================
-- Paiements Interac : annulation par le membre d'une demande en attente
-- =====================================================================
-- Suite 49 (2026-09-10), à la demande de l'utilisateur : dans le nouveau
-- menu déroulant par rubrique de "Mon espace", un membre doit pouvoir
-- retirer lui-même une demande Interac qu'il vient de soumettre par
-- erreur (mauvais montant, mauvais fichier joint), sans devoir passer
-- par le bureau.
--
-- La migration d'origine (2026-09-10b) n'a volontairement créé aucune
-- policy DELETE sur interac_payment_claims, les demandes devant être
-- conservées indéfiniment comme trace d'audit. On respecte ce choix :
-- au lieu de supprimer la ligne, le membre peut seulement la faire
-- passer de 'en_attente' à un nouveau statut 'annule', qui reste visible
-- dans l'historique (avec un badge dédié) mais que le bureau ignore.
--
-- 1) La contrainte CHECK sur "statut" doit être recréée pour ajouter
--    cette nouvelle valeur (comme pour "type" dans 2026-09-10e).
-- 2) Une nouvelle policy UPDATE, distincte de celle du bureau, autorise
--    UNIQUEMENT la transition "propre demande, en_attente -> annule" —
--    impossible pour un membre de modifier une demande déjà traitée, de
--    changer le montant/fichier, ou d'agir sur la demande d'un autre
--    membre (le "using" borne la ligne AVANT modification, le "with
--    check" borne le résultat APRÈS modification).
-- =====================================================================

alter table public.interac_payment_claims
  drop constraint if exists interac_payment_claims_statut_check;

alter table public.interac_payment_claims
  add constraint interac_payment_claims_statut_check
  check (statut in ('en_attente', 'confirme', 'rejete', 'annule'));

drop policy if exists "interac_claims member cancel" on public.interac_payment_claims;
create policy "interac_claims member cancel" on public.interac_payment_claims for update to authenticated
  using (
    association_id = public.current_association_id()
    and member_id = public.current_member_id()
    and statut = 'en_attente'
  )
  with check (
    association_id = public.current_association_id()
    and member_id = public.current_member_id()
    and statut = 'annule'
  );
