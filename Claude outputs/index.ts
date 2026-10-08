// =====================================================================
// Edge Function : create-checkout-session
// =====================================================================
// Première Edge Function du projet (Phase 3). Appelée depuis « Mon
// espace » quand un membre clique sur l'un des boutons « Payer en
// ligne ». Crée une session Stripe Checkout (page de paiement hébergée
// par Stripe) et retourne son URL, vers laquelle le navigateur du
// membre est ensuite redirigé.
//
// Types de paiement pris en charge (suite 48-49), passés dans le corps
// de la requête ({ type: "..." }) :
//   - "inscription"    : montant fixe, une fois par membre (suite 48).
//   - "fonds_urgence"   : montant fixe, une fois par membre — même
//                         structure que l'inscription.
//   - "fonds_secours"   : idem, pour le fonds de secours.
//   - "cotisation"      : paie automatiquement la PROCHAINE séance de
//                         Cotisation (ex-Tontine) non réglée (décision :
//                         pas de sélection manuelle, la plus simple).
//   - "collation"       : paie automatiquement le PROCHAIN mois/période
//                         de Collation non réglé, même principe.
//   - "recouvrement"    : règle une quote-part précise de recouvrement
//                         (fonds urgence/secours), identifiée par
//                         body.recouvrement_id — contrairement aux autres
//                         types, il n'y a pas de montant unique par
//                         membre : chaque dépense de fonds génère sa
//                         propre ligne fonds_recouvrements, payable
//                         indépendamment (suite 51, 2026-09-11).
//
// Portée commune à tous les types (cadrée avec l'utilisateur, suite 40) :
//   - Le membre ne peut payer que pour lui-même (identifié par son JWT
//     de session, jamais par un id transmis dans la requête).
//   - Montant complet obligatoire (pas de paiement partiel).
//   - Frais de transaction Stripe (~2,9 % + 0,30 $ CAD) ajoutés au
//     montant payé par le membre, pour que l'association reçoive le
//     montant plein dû.
//
// Sécurité : le montant n'est JAMAIS reçu du client — toujours recalculé
// ici à partir de la base de données, via un client Supabase authentifié
// avec le JWT du membre (donc soumis aux mêmes politiques RLS que le
// reste de l'application). Impossible de payer pour un autre membre ou
// de falsifier le montant depuis le navigateur.
// =====================================================================

import Stripe from "npm:stripe@17.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Doit rester synchronisé avec PERIODES_PAR_AN dans App.jsx (suite 35).
const PERIODES_PAR_AN: Record<string, number> = {
  semaine: 52,
  quinzaine: 26,
  trois_semaines: 17,
  mois: 12,
};
function nbPeriodes(frequence: string | null | undefined): number {
  return PERIODES_PAR_AN[frequence ?? "mois"] ?? 12;
}

const MOIS_ABBR = [
  "Jan", "Fév", "Mar", "Avr", "Mai", "Juin",
  "Juil", "Août", "Sept", "Oct", "Nov", "Déc",
];

// Doit rester synchronisé avec la logique periodKeys de App.jsx (suite 35).
function periodKeys(frequence: string | null | undefined): string[] {
  const freq = frequence ?? "mois";
  if (freq === "mois") return MOIS_ABBR;
  const n = nbPeriodes(freq);
  const label =
    freq === "semaine" ? "Semaine" : freq === "quinzaine" ? "Quinzaine" : "Période";
  return Array.from({ length: n }, (_, i) => `${label} ${i + 1}`);
}

type PlanResult =
  | { ok: true; montantDu: number; nom: string; description: string; metadata: Record<string, string> }
  | { ok: false; error: string; status: number };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Non authentifié." }, 401);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // Corps vide accepté : équivaut à { type: "inscription" } pour la
      // rétrocompatibilité avec le premier appel construit en suite 48.
    }
    const type = typeof body.type === "string" ? body.type : "inscription";

    // Client Supabase authentifié comme le membre appelant (pas le rôle
    // service) : toutes les lectures ci-dessous passent par RLS, exactement
    // comme le reste de l'application.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: memberId, error: memberIdError } = await supabase.rpc(
      "current_member_id"
    );
    if (memberIdError || !memberId) {
      return jsonResponse(
        { error: "Aucune fiche adhérent liée à ce compte." },
        400
      );
    }

    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, nom, email, inscription_paye, fonds_urgence_paye, fonds_secours_paye, association_id")
      .eq("id", memberId)
      .single();
    if (memberError || !member) {
      return jsonResponse({ error: "Fiche adhérent introuvable." }, 404);
    }

    const { data: association, error: assocError } = await supabase
      .from("associations")
      .select(
        "id, nom, inscription_montant, fonds_urgence_montant, fonds_secours_montant, tontine_montant_seance, collation_montant_mensuel, frequence_reunions"
      )
      .eq("id", member.association_id)
      .single();
    if (assocError || !association) {
      return jsonResponse({ error: "Association introuvable." }, 404);
    }

    let plan: PlanResult;

    if (type === "inscription") {
      const montantMax = association.inscription_montant ?? 25;
      const montantDu = montantMax - (member.inscription_paye ?? 0);
      plan =
        montantDu > 0
          ? {
              ok: true,
              montantDu,
              nom: `Inscription — ${association.nom}`,
              description: `Solde dû : ${montantDu.toFixed(2)} $ (frais de transaction inclus)`,
              metadata: { type: "inscription", member_id: member.id, association_id: association.id },
            }
          : { ok: false, error: "Votre inscription est déjà réglée en entier.", status: 400 };
    } else if (type === "fonds_urgence") {
      const montantMax = association.fonds_urgence_montant ?? 25;
      const montantDu = montantMax - (member.fonds_urgence_paye ?? 0);
      plan =
        montantDu > 0
          ? {
              ok: true,
              montantDu,
              nom: `Fonds d'urgence — ${association.nom}`,
              description: `Solde dû : ${montantDu.toFixed(2)} $ (frais de transaction inclus)`,
              metadata: { type: "fonds_urgence", member_id: member.id, association_id: association.id },
            }
          : { ok: false, error: "Votre fonds d'urgence est déjà réglé en entier.", status: 400 };
    } else if (type === "fonds_secours") {
      const montantMax = association.fonds_secours_montant ?? 200;
      const montantDu = montantMax - (member.fonds_secours_paye ?? 0);
      plan =
        montantDu > 0
          ? {
              ok: true,
              montantDu,
              nom: `Fonds de secours — ${association.nom}`,
              description: `Solde dû : ${montantDu.toFixed(2)} $ (frais de transaction inclus)`,
              metadata: { type: "fonds_secours", member_id: member.id, association_id: association.id },
            }
          : { ok: false, error: "Votre fonds de secours est déjà réglé en entier.", status: 400 };
    } else if (type === "cotisation") {
      const nb = nbPeriodes(association.frequence_reunions);
      const montantSeance = association.tontine_montant_seance ?? 100;
      const { data: presences } = await supabase
        .from("tontine_presences")
        .select("seance, montant")
        .eq("member_id", member.id);
      const payees = new Set(
        (presences ?? []).filter((p) => Number(p.montant ?? 0) > 0).map((p) => p.seance)
      );
      let prochaine: number | null = null;
      for (let s = 1; s <= nb; s++) {
        if (!payees.has(s)) { prochaine = s; break; }
      }
      plan =
        prochaine !== null
          ? {
              ok: true,
              montantDu: montantSeance,
              nom: `Cotisation — séance ${prochaine} — ${association.nom}`,
              description: `Séance n° ${prochaine} : ${montantSeance.toFixed(2)} $ (frais de transaction inclus)`,
              metadata: {
                type: "cotisation",
                member_id: member.id,
                association_id: association.id,
                seance: String(prochaine),
              },
            }
          : { ok: false, error: "Toutes les séances de cotisation de la période sont déjà réglées.", status: 400 };
    } else if (type === "collation") {
      const periodes = periodKeys(association.frequence_reunions);
      const montantPeriode = association.collation_montant_mensuel ?? 10;
      const { data: presences } = await supabase
        .from("collation_presences")
        .select("mois, montant")
        .eq("member_id", member.id);
      const payees = new Set(
        (presences ?? []).filter((p) => Number(p.montant ?? 0) > 0).map((p) => p.mois)
      );
      const prochaine = periodes.find((p) => !payees.has(p)) ?? null;
      plan =
        prochaine !== null
          ? {
              ok: true,
              montantDu: montantPeriode,
              nom: `Collation — ${prochaine} — ${association.nom}`,
              description: `${prochaine} : ${montantPeriode.toFixed(2)} $ (frais de transaction inclus)`,
              metadata: {
                type: "collation",
                member_id: member.id,
                association_id: association.id,
                mois: prochaine,
              },
            }
          : { ok: false, error: "Toutes les périodes de collation sont déjà réglées.", status: 400 };
    } else if (type === "recouvrement") {
      const recouvrementId = typeof body.recouvrement_id === "string" ? body.recouvrement_id : null;
      if (!recouvrementId) {
        plan = { ok: false, error: "Identifiant de recouvrement manquant.", status: 400 };
      } else {
        // Toujours filtré par member_id ici, en plus de la policy RLS
        // (qui autorise déjà tout le bureau ET tout membre de
        // l'association à LIRE ces lignes, cf. sql/2026-09-04e) — pour ne
        // jamais permettre de payer la quote-part d'un autre membre.
        const { data: recouvrement } = await supabase
          .from("fonds_recouvrements")
          .select("id, member_id, quote_part, paye, depense_id")
          .eq("id", recouvrementId)
          .eq("member_id", member.id)
          .maybeSingle();
        if (!recouvrement) {
          plan = { ok: false, error: "Recouvrement introuvable.", status: 404 };
        } else if (recouvrement.paye) {
          plan = { ok: false, error: "Ce recouvrement est déjà payé.", status: 400 };
        } else {
          const { data: depense } = await supabase
            .from("fonds_depenses")
            .select("description, fonds")
            .eq("id", recouvrement.depense_id)
            .maybeSingle();
          const fondsLabel = depense?.fonds === "urgence" ? "Fonds d'urgence" : "Fonds de secours";
          const montantDu = Number(recouvrement.quote_part);
          plan = {
            ok: true,
            montantDu,
            nom: `Recouvrement — ${fondsLabel} — ${association.nom}`,
            description: `${depense?.description ?? fondsLabel} : ${montantDu.toFixed(2)} $ (frais de transaction inclus)`,
            metadata: {
              type: "recouvrement",
              member_id: member.id,
              association_id: association.id,
              recouvrement_id: recouvrement.id,
              fonds: depense?.fonds ?? "",
            },
          };
        }
      }
    } else {
      plan = { ok: false, error: "Type de paiement inconnu.", status: 400 };
    }

    if (!plan.ok) {
      return jsonResponse({ error: plan.error }, plan.status);
    }

    // Frais Stripe standard (Canada) : ~2,9 % + 0,30 $ CAD par
    // transaction. On "gonfle" le montant facturé pour que l'association
    // reçoive exactement montantDu net des frais.
    const FRAIS_POURCENT = 0.029;
    const FRAIS_FIXE = 0.30;
    const montantTotal = (plan.montantDu + FRAIS_FIXE) / (1 - FRAIS_POURCENT);
    const montantTotalCents = Math.round(montantTotal * 100);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2024-11-20.acacia",
    });

    const origin = req.headers.get("origin") || "http://localhost:5174";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: member.email ?? undefined,
      line_items: [
        {
          price_data: {
            currency: "cad",
            product_data: { name: plan.nom, description: plan.description },
            unit_amount: montantTotalCents,
          },
          quantity: 1,
        },
      ],
      metadata: plan.metadata,
      success_url: `${origin}/?paiement=succes`,
      cancel_url: `${origin}/?paiement=annule`,
    });

    return jsonResponse({ url: session.url }, 200);
  } catch (err) {
    console.error(err);
    return jsonResponse(
      { error: "Erreur serveur : " + (err as Error).message },
      500
    );
  }
});
