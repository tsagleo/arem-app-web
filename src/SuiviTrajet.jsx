// =====================================================================
// SuiviTrajet.jsx — Page publique de suivi d'un trajet de covoiturage
// (?suivi=<jeton>), accessible SANS connexion, sur le même patron que
// PublicShowcase.jsx (?verify=<jeton>) : une fonction SQL publique et
// minimale (consulter_partage_trajet, voir
// sql/2026-10-07_covoiturage_dispatch_sophistique.sql) ne révèle jamais
// les coordonnées (téléphone/courriel) du conducteur ou du passager —
// uniquement le statut de la course, les points de départ/arrivée, le
// prénom du conducteur, et sa position en direct pendant la course
// active (en_route/a_bord). Rafraîchissement silencieux toutes les 8
// secondes (même choix que Covoiturage.jsx, voir ce fichier pour le
// détail du compromis technique).
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import { Car, MapPin, Radio, Landmark } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Container, Card, useLang, LanguageSwitcher, TextSizeControl, BG, TEAL, TEAL_LIGHT, RED } from "./shared";

function livePositionEmbedUrl(lat, lng) { return `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`; }
function minutesAgo(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function SuiviHeader() {
  const { t } = useLang();
  return (
    <div style={{ background: "linear-gradient(150deg,#1F3864,#152645)", padding: "18px 0" }}>
      <Container style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Car size={17} color="white" />
          </div>
          <span style={{ color: "white", fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 16 }}>{t("suivi_title")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TextSizeControl />
          <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 6 }}><LanguageSwitcher /></div>
        </div>
      </Container>
    </div>
  );
}

function statutColor(statut) {
  if (statut === "acceptee") return { color: "#8A5A00", bg: "#FDF3DF" };
  if (statut === "terminee") return { color: TEAL, bg: TEAL_LIGHT };
  if (statut === "en_route" || statut === "a_bord") return { color: TEAL, bg: TEAL_LIGHT };
  return { color: "#8A8F98", bg: "#F1F2F4" };
}

export default function SuiviTrajet({ token }) {
  const { t } = useLang();
  const [result, setResult] = useState(undefined); // undefined = chargement, null = introuvable

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("consulter_partage_trajet", { p_token: token });
    const row = Array.isArray(data) ? data[0] : data;
    setResult(row || null);
  }, [token]);

  useEffect(() => { load(); }, [load]);
  // Rafraîchissement silencieux périodique — permet à la personne qui
  // suit le trajet de voir la position et le statut évoluer sans
  // recharger la page (même compromis technique que Covoiturage.jsx :
  // sondage toutes les 8s plutôt qu'une souscription temps réel).
  useEffect(() => {
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  const enCours = result && (result.statut === "en_route" || result.statut === "a_bord");
  const sc = result ? statutColor(result.statut) : null;

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "Inter, sans-serif", display: "flex", flexDirection: "column" }}>
      <SuiviHeader />
      <Container style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
        <Card style={{ maxWidth: 420, width: "100%", padding: 28 }}>
          {result === undefined ? (
            <p style={{ color: "#9AA2B5", textAlign: "center" }}>{t("load_generic")}</p>
          ) : result === null ? (
            <p style={{ color: RED, fontWeight: 600, textAlign: "center" }}>{t("suivi_not_found")}</p>
          ) : (
            <>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--primary,#1F3864)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                  <Landmark size={24} />
                </div>
                <div style={{ fontSize: 13, color: "#8A8F98", marginBottom: 4 }}>{t("suivi_driver_label")}</div>
                <h3 style={{ fontSize: 17, margin: 0 }}>{result.conducteur_prenom || "—"}</h3>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14, fontWeight: 600, margin: "10px 0" }}>
                <MapPin size={14} color={TEAL} /> {result.point_depart} → {result.point_arrivee}
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                <span style={{ display: "inline-flex", alignItems: "center", fontSize: 12.5, fontWeight: 700, color: sc.color, background: sc.bg, borderRadius: 999, padding: "5px 14px" }}>
                  {t("cov_booking_statut_" + result.statut)}
                </span>
              </div>
              {enCours && (
                <div style={{ background: "#F6F8FA", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: TEAL, display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}><Radio size={12} /> {t("suivi_position_title")}</div>
                  {result.lat != null && result.lng != null ? (
                    <>
                      <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #DCE0E8", height: 220, marginBottom: 6 }}>
                        <iframe title="position" src={livePositionEmbedUrl(result.lat, result.lng)} width="100%" height="100%" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                      </div>
                      <div style={{ fontSize: 11, color: "#8A8F98" }}>
                        {minutesAgo(result.position_maj_a) === 0 ? t("cov_live_position_updated_now") : t("cov_live_position_updated").replace("{min}", minutesAgo(result.position_maj_a))}
                      </div>
                    </>
                  ) : (
                    <p style={{ fontSize: 12, color: "#8A8F98", margin: 0 }}>{t("suivi_no_position")}</p>
                  )}
                </div>
              )}
              <p style={{ fontSize: 10.5, color: "#9AA2B5", textAlign: "center", marginTop: 16, marginBottom: 0 }}>{t("suivi_footer_note")}</p>
            </>
          )}
        </Card>
      </Container>
    </div>
  );
}
