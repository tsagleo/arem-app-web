// =====================================================================
// Edge Function : stripe-webhook
// =====================================================================
// Deuxième Edge Function du projet (Phase 3). Stripe appelle cette URL
// automatiquement dès qu'un paiement Checkout est confirmé — c'est ce
// qui met réellement à jour la base de données (le simple retour du
// navigateur vers success_url, lui, ne garantit rien : un membre
// pourrait fermer l'onglet ou perdre sa connexion avant la redirection,
// alors que le webhook, envoyé directement par Stripe, est fiable).
//
// Sécurité : la requête est vérifiée avec la signature Stripe
// (en-tête Stripe-Signature + secret de signature du endpoint,
// STRIPE_WEBHOOK_SECRET) — impossible pour quiconque d'appeler cette
// URL et de falsifier un paiement. Aucun JWT Supabase n'est utilisé ici
// (Stripe n'en a pas) : c'est pourquoi la vérification JWT doit être
// désactivée sur cette fonction (comme sur create-checkout-session),
// remplacée par cette vérification de signature, plus stricte.
//
// Utilise la clé de service Supabase (contourne RLS, comme les
// fonctions de notification SQL utilisent SECURITY DEFINER) puisque le
// webhook n'agit pas au nom d'un membre connecté.
//
// Types de paiement gérés (suite 48-49), lus dans metadata.type — voir
// create-checkout-session pour le détail de chacun :
//   - inscription / fonds_urgence / fonds_secours : mettent à jour un
//     champ unique sur members (montant complet).
//   - cotisation : insère/complète une ligne tontine_presences pour la
//     séance indiquée dans metadata.seance.
//   - collation : insère/complète une ligne collation_presences pour le
//     mois/période indiqué dans metadata.mois.
//   - recouvrement : marque payée UNE ligne fonds_recouvrements précise
//     (metadata.recouvrement_id) — pas un champ agrégé sur members,
//     contrairement aux autres types (suite 51, 2026-09-11).
//   - billet_evenement : crée/confirme la ligne event_rsvps du membre
//     pour l'événement indiqué (metadata.event_id), statut "confirme" —
//     c'est cette même transition qui alimente automatiquement le
//     système comptable (déclencheur ecr_trg_event_tickets, voir
//     sql/2026-09-28g_billet_evenement.sql), donc aucune écriture
//     comptable séparée n'est nécessaire ici (2026-09-28, chantier
//     « application complète »).
//   - amende : marque payée UNE ligne sanctions précise
//     (metadata.sanction_id) — même principe que "recouvrement" (suite
//     « fiche unifiée présence/absence », 2026-09-30).
//   - forfait_abonnement : changement de forfait de l'ASSOCIATION
//     (metadata.association_id, pas member_id) — met à jour
//     subscriptions.plan/statut et enregistre l'abonnement Stripe
//     (stripe_subscription_id/stripe_customer_id) pour le suivi des
//     événements suivants. Voir aussi, au-delà de checkout.session.completed,
//     les événements de cycle de vie d'un abonnement récurrent gérés plus
//     bas : customer.subscription.deleted (annulation → suspension),
//     invoice.payment_failed (échec de paiement récurrent → suspension) et
//     invoice.payment_succeeded (paiement récurrent réussi après un échec →
//     réactivation) — voir
//     claude/provisioning-associations-proposition.md, section B.
// =====================================================================

import Stripe from "npm:stripe@17.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

Deno.serve(async (req: Request) => {
  const signature = req.headers.get("Stripe-Signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!signature || !webhookSecret) {
    console.error("Signature ou secret de webhook manquant.");
    return new Response("Configuration manquante.", { status: 400 });
  }

  // La vérification de signature Stripe a besoin du corps BRUT (texte),
  // jamais du JSON déjà parsé.
  const rawBody = await req.text();

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-11-20.acacia",
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret
    );
  } catch (err) {
    console.error("Signature Stripe invalide :", (err as Error).message);
    return new Response("Signature invalide.", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata ?? {};
    const memberId = metadata.member_id;

    if (metadata.type === "forfait_abonnement" && metadata.association_id) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          plan: metadata.plan,
          statut: "actif",
          stripe_subscription_id: typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
          stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
        })
        .eq("association_id", metadata.association_id);
      if (error) console.error("Échec mise à jour du forfait (abonnement) :", error);
    } else if (memberId) {
      // Client avec le rôle de service : contourne RLS, nécessaire ici
      // puisqu'aucun membre n'est authentifié dans ce contexte.
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const { data: member, error: memberError } = await supabaseAdmin
        .from("members")
        .select("id, association_id")
        .eq("id", memberId)
        .single();

      if (memberError || !member) {
        console.error("Membre introuvable pour ce paiement :", memberId, memberError);
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data: association } = await supabaseAdmin
        .from("associations")
        .select(
          "inscription_montant, fonds_urgence_montant, fonds_secours_montant, tontine_montant_seance, collation_montant_mensuel"
        )
        .eq("id", member.association_id)
        .single();

      // Montant complet obligatoire (décision Phase 3) dans tous les cas
      // ci-dessous — idempotent si Stripe renvoie le même événement deux
      // fois (retries) : une seconde écriture identique ne change rien,
      // et les déclencheurs de confirmation par courriel déjà construits
      // en Phase 2 ne se redéclenchent pas puisque le seuil est déjà
      // franchi.

      // Registre des transactions (suite 50) : une ligne par paiement
      // confirmé, en plus de la mise à jour du solde ci-dessus — c'est ce
      // qui alimente le détail ligne par ligne affiché au membre dans
      // Mon espace. L'index unique partiel sur (reference) where
      // methode='stripe' rend cet ajout idempotent lui aussi : si Stripe
      // redélivre le même événement, la seconde tentative d'insertion
      // échoue silencieusement (violation de contrainte unique) au lieu
      // de créer une ligne en double — on ignore alors cette erreur
      // précise, mais on log toute autre erreur.
      async function logTransaction(type: string, montant: number, periode: string | null, eventId: string | null = null, sanctionId: string | null = null) {
        const { error } = await supabaseAdmin.from("payment_transactions").insert({
          association_id: member.association_id,
          member_id: memberId,
          type,
          periode,
          montant,
          methode: "stripe",
          reference: session.id,
          event_id: eventId,
          sanction_id: sanctionId,
        });
        if (error && error.code !== "23505") {
          console.error("Échec de l'écriture au registre des transactions :", error);
        }
      }

      if (metadata.type === "inscription") {
        const montant = association?.inscription_montant ?? 25;
        const { error } = await supabaseAdmin
          .from("members")
          .update({ inscription_paye: montant })
          .eq("id", memberId);
        if (error) console.error("Échec mise à jour inscription :", error);
        else await logTransaction("inscription", montant, null);
      } else if (metadata.type === "fonds_urgence") {
        const montant = association?.fonds_urgence_montant ?? 25;
        const { error } = await supabaseAdmin
          .from("members")
          .update({ fonds_urgence_paye: montant })
          .eq("id", memberId);
        if (error) console.error("Échec mise à jour fonds d'urgence :", error);
        else await logTransaction("fonds_urgence", montant, null);
      } else if (metadata.type === "fonds_secours") {
        const montant = association?.fonds_secours_montant ?? 200;
        const { error } = await supabaseAdmin
          .from("members")
          .update({ fonds_secours_paye: montant })
          .eq("id", memberId);
        if (error) console.error("Échec mise à jour fonds de secours :", error);
        else await logTransaction("fonds_secours", montant, null);
      } else if (metadata.type === "cotisation" && metadata.seance) {
        const seance = Number(metadata.seance);
        const montant = association?.tontine_montant_seance ?? 100;
        const { data: existing } = await supabaseAdmin
          .from("tontine_presences")
          .select("id")
          .eq("member_id", memberId)
          .eq("seance", seance)
          .maybeSingle();
        const { error } = existing
          ? await supabaseAdmin
              .from("tontine_presences")
              .update({ montant, present: true })
              .eq("id", existing.id)
          : await supabaseAdmin
              .from("tontine_presences")
              .insert({ member_id: memberId, seance, montant, present: true });
        if (error) console.error("Échec mise à jour cotisation :", error);
        else await logTransaction("cotisation", montant, String(seance));
      } else if (metadata.type === "collation" && metadata.mois) {
        const mois = metadata.mois;
        const montant = association?.collation_montant_mensuel ?? 10;
        const { data: existing } = await supabaseAdmin
          .from("collation_presences")
          .select("id")
          .eq("member_id", memberId)
          .eq("mois", mois)
          .maybeSingle();
        const { error } = existing
          ? await supabaseAdmin
              .from("collation_presences")
              .update({ montant, present: true })
              .eq("id", existing.id)
          : await supabaseAdmin
              .from("collation_presences")
              .insert({ member_id: memberId, mois, montant, present: true });
        if (error) console.error("Échec mise à jour collation :", error);
        else await logTransaction("collation", montant, mois);
      } else if (metadata.type === "recouvrement" && metadata.recouvrement_id) {
        const { data: recouvrement } = await supabaseAdmin
          .from("fonds_recouvrements")
          .select("id, quote_part, paye")
          .eq("id", metadata.recouvrement_id)
          .maybeSingle();
        if (!recouvrement) {
          console.error("Recouvrement introuvable pour ce paiement :", metadata.recouvrement_id);
        } else {
          if (!recouvrement.paye) {
            const { error } = await supabaseAdmin
              .from("fonds_recouvrements")
              .update({ paye: true, date_paiement: new Date().toISOString().slice(0, 10) })
              .eq("id", metadata.recouvrement_id);
            if (error) console.error("Échec mise à jour recouvrement :", error);
          }
          // Idempotent malgré tout grâce à l'index unique partiel sur
          // (reference) where methode='stripe' : si Stripe redélivre le
          // même événement après que la ligne a déjà été marquée payée
          // ci-dessus lors d'un essai précédent, cette seconde tentative
          // d'écriture au registre échoue silencieusement (23505).
          await logTransaction("recouvrement", Number(recouvrement.quote_part), metadata.fonds || null);
        }
      } else if (metadata.type === "billet_evenement" && metadata.event_id) {
        // La capacité (events.capacite_max) a déjà été vérifiée par
        // create-checkout-session AVANT de créer la session Stripe.
        // Elle n'est volontairement PAS revérifiée ici : le paiement est
        // déjà encaissé à ce stade, donc refuser la place laisserait le
        // membre payant sans billet — cas limite rarissime (deux
        // paiements simultanés sur la toute dernière place), laissé au
        // Bureau à gérer manuellement si jamais rencontré, même logique
        // que les remboursements (gérés depuis le tableau de bord
        // Stripe, jamais automatiquement par l'application).
        const { data: event } = await supabaseAdmin
          .from("events")
          .select("prix, titre")
          .eq("id", metadata.event_id)
          .maybeSingle();
        if (!event) {
          console.error("Événement introuvable pour ce paiement :", metadata.event_id);
        } else {
          const montant = Number(event.prix) || 0;
          const { data: existingRsvp } = await supabaseAdmin
            .from("event_rsvps")
            .select("id")
            .eq("event_id", metadata.event_id)
            .eq("member_id", memberId)
            .maybeSingle();
          const { error } = existingRsvp
            ? await supabaseAdmin
                .from("event_rsvps")
                .update({ statut: "confirme" })
                .eq("id", existingRsvp.id)
            : await supabaseAdmin
                .from("event_rsvps")
                .insert({ event_id: metadata.event_id, association_id: member.association_id, member_id: memberId, statut: "confirme" });
          if (error) console.error("Échec de la confirmation du billet d'événement :", error);
          else await logTransaction("billet_evenement", montant, event.titre || null, metadata.event_id);
        }
      } else if (metadata.type === "amende" && metadata.sanction_id) {
        const { data: sanction } = await supabaseAdmin
          .from("sanctions")
          .select("id, montant, paye")
          .eq("id", metadata.sanction_id)
          .maybeSingle();
        if (!sanction) {
          console.error("Sanction introuvable pour ce paiement :", metadata.sanction_id);
        } else {
          if (!sanction.paye) {
            const { error } = await supabaseAdmin
              .from("sanctions")
              .update({ paye: true, date_paiement: new Date().toISOString().slice(0, 10) })
              .eq("id", metadata.sanction_id);
            if (error) console.error("Échec mise à jour amende :", error);
          }
          // Idempotent malgré tout grâce à l'index unique partiel sur
          // (reference) where methode='stripe' — voir logTransaction.
          await logTransaction("amende", Number(sanction.montant), null, null, metadata.sanction_id);
        }
      } else if (metadata.type === "achat_groupe" && metadata.achat_id) {
        // 2026-10-10 : part d'achat groupé payée par carte. Enregistrée « reçue »
        // (Stripe a encaissé) ; un membre du bureau la valide ensuite, comme
        // tout mouvement de la coopérative. Idempotent : index unique sur la
        // référence Stripe.
        const { data: achat } = await supabaseAdmin.from("achats_groupes").select("id, statut").eq("id", metadata.achat_id).maybeSingle();
        const { data: sous } = await supabaseAdmin.from("achats_souscriptions").select("member_nom").eq("achat_id", metadata.achat_id).eq("member_id", memberId).maybeSingle();
        if (!achat) {
          console.error("Achat groupé introuvable pour ce paiement :", metadata.achat_id);
        } else {
          const { error } = await supabaseAdmin.from("achats_mouvements").insert({
            association_id: member.association_id, achat_id: achat.id, member_id: memberId, member_nom: sous?.member_nom ?? null,
            sens: "entree", objet: achat.statut === "cloture" ? "complement" : "part", mode: "stripe",
            montant: Number(metadata.montant), reference: session.id, statut: "recu",
            recu_par_nom: "Stripe (paiement par carte)", recu_le: new Date().toISOString(), note: "Payé par carte en ligne",
          });
          if (error && error.code !== "23505") console.error("Échec d'enregistrement du paiement d'achat groupé :", error);
        }
      } else {
        console.error("Type de paiement inconnu ou métadonnée manquante :", metadata);
      }
    }
  } else if (event.type === "customer.subscription.deleted") {
    // L'association (ou Stripe, après plusieurs échecs de paiement) a
    // annulé l'abonnement récurrent du forfait — suspend l'accès, sans
    // jamais supprimer de données (même principe que la suspension d'un
    // essai arrivé à échéance, voir sql/2026-10-05_provisionnement_forfaits.sql).
    const subscription = event.data.object as Stripe.Subscription;
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update({ statut: "suspendu" })
      .eq("stripe_subscription_id", subscription.id);
    if (error) console.error("Échec suspension après annulation d'abonnement :", error);
  } else if (event.type === "invoice.payment_failed") {
    // Un prélèvement récurrent a échoué (carte refusée, expirée, etc.) —
    // suspend immédiatement plutôt que d'attendre que Stripe abandonne et
    // annule l'abonnement de son côté (ce qui prendrait plusieurs jours de
    // réessais selon la configuration Stripe par défaut).
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
    if (subscriptionId) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({ statut: "suspendu" })
        .eq("stripe_subscription_id", subscriptionId);
      if (error) console.error("Échec suspension après paiement récurrent refusé :", error);
    }
  } else if (event.type === "invoice.payment_succeeded") {
    // Réactivation automatique si un prélèvement reprend avec succès après
    // un échec précédent — ne touche jamais une association explicitement
    // annulée (statut 'annule', différent de 'suspendu') : seule une
    // suspension liée au paiement doit se lever automatiquement.
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
    if (subscriptionId) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({ statut: "actif" })
        .eq("stripe_subscription_id", subscriptionId)
        .eq("statut", "suspendu");
      if (error) console.error("Échec réactivation après paiement récurrent réussi :", error);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
