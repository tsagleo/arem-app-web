// =====================================================================
// Edge Function : send-push-notification
// =====================================================================
// Troisième Edge Function du projet (suite 82, 2026-09-28 — chantier
// « internationalisation », notifications push web). Appelée UNIQUEMENT
// par un déclencheur PostgreSQL (via pg_net — voir
// sql/2026-09-28b_push_notifications.sql), jamais directement par un
// membre connecté : c'est pourquoi elle est authentifiée par un secret
// interne partagé (en-tête x-internal-secret) plutôt que par un JWT
// Supabase, et doit être déployée avec --no-verify-jwt — même raison et
// même patron que stripe-webhook (qui utilise la signature Stripe à la
// place d'un JWT).
//
// Ce qu'elle fait : reçoit { association_id, title, body, icon?, url?,
// profile_ids? }, retrouve les abonnements push (`push_subscriptions`)
// concernés, et envoie une notification chiffrée (protocole Web Push,
// RFC 8291/8292) à chacun via la librairie `web-push`. Un abonnement qui
// répond 404/410 (navigateur désinstallé, permission révoquée, cache
// navigateur vidé...) est silencieusement retiré plutôt que réessayé
// indéfiniment — comportement standard recommandé par la spec Web Push.
//
// profile_ids (2026-09-29, notifications de mention du fil d'actualité) :
// tableau optionnel d'ids de profils. Si présent et non vide, SEULS les
// abonnements de ces profils reçoivent la notification (mentions @Nom,
// ciblées) ; sinon (absent, comme pour les annonces urgentes) le
// comportement d'origine est inchangé : TOUS les abonnés de l'association.
//
// Utilise la clé de service Supabase (contourne RLS) pour lire TOUS les
// abonnements de l'association, pas seulement ceux de l'appelant —
// nécessaire puisque personne n'est "connecté" au sens JWT lors de cet
// appel (exactement la même justification que stripe-webhook).
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const internalSecret = req.headers.get("x-internal-secret");
    const expectedSecret = Deno.env.get("PUSH_INTERNAL_SECRET");
    if (!expectedSecret || !internalSecret || internalSecret !== expectedSecret) {
      return jsonResponse({ error: "Non autorisé." }, 401);
    }

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:contact@example.com";
    if (!vapidPublicKey || !vapidPrivateKey) {
      return jsonResponse({ error: "Clés VAPID non configurées (secrets de l'Edge Function)." }, 500);
    }
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const body = await req.json().catch(() => ({}));
    const associationId = typeof body.association_id === "string" ? body.association_id : null;
    const title = typeof body.title === "string" ? body.title : null;
    const messageBody = typeof body.body === "string" ? body.body : "";
    const icon = typeof body.icon === "string" ? body.icon : undefined;
    const url = typeof body.url === "string" ? body.url : "/";
    const profileIds = Array.isArray(body.profile_ids)
      ? body.profile_ids.filter((v: unknown) => typeof v === "string")
      : null;

    if (!associationId || !title) {
      return jsonResponse({ error: "association_id et title requis." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let subsQuery = supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("association_id", associationId);
    if (profileIds && profileIds.length > 0) {
      subsQuery = subsQuery.in("profile_id", profileIds);
    }
    const { data: subs, error } = await subsQuery;
    if (error) throw error;

    const payload = JSON.stringify({ title, body: messageBody, icon, url });

    let sent = 0;
    let removed = 0;
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Abonnement expiré ou révoqué côté navigateur : on le retire
          // plutôt que de réessayer indéfiniment (comportement recommandé
          // par la spec Web Push).
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          removed++;
        } else {
          console.error("Échec d'envoi push pour l'abonnement", sub.id, err);
        }
      }
    }

    return jsonResponse({ sent, removed, total: (subs ?? []).length }, 200);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Erreur serveur : " + (err as Error).message }, 500);
  }
});
