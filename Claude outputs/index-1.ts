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

    if (memberId) {
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
      async function logTransaction(type: string, montant: number, periode: string | null) {
        const { error } = await supabaseAdmin.from("payment_transactions").insert({
          association_id: member.association_id,
          member_id: memberId,
          type,
          periode,
          montant,
          methode: "stripe",
          reference: session.id,
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
      } else {
        console.error("Type de paiement inconnu ou métadonnée manquante :", metadata);
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
