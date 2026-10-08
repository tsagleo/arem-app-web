// =====================================================================
// Presences.jsx — Pointage de présence par scan de carte de membre
// Suite « pointage de présence », 2026-09-29 — complétée le même jour
// (heures de début/fin, type de séance, sanctions automatiques de
// retard/départ anticipé, photos des membres, PDF enrichi). Développé
// par Omnia Trade Solutions.
// =====================================================================
// Réutilise la carte de membre numérique existante (Phase 4, suite 91 :
// members.verification_token, encodé en QR côté client dans
// MemberCardModal — App.jsx). Une personne du Bureau scanne cette même
// carte avec la caméra de son appareil pour pointer l'arrivée (et,
// optionnellement, le départ) d'un membre à une séance. Toute l'écriture
// passe par la fonction RPC checkin_member() (sql/2026-09-29_presences_
// pointage.sql + sql/2026-09-29b_presences_heures_sanctions.sql), qui
// porte sa propre garde is_bureau() côté serveur.
//
// Décisions confirmées par l'utilisateur (AskUserQuestion, deux tours) :
//  • Portée : une séance peut être liée à un événement existant OU être
//    libre — voir le sélecteur d'événement dans le formulaire de création.
//  • Départ : suivi optionnel, PAR séance (case à cocher à la création),
//    jamais un comportement global fixe.
//  • Historique : chaque adhérent voit son propre historique dans
//    « Mon espace » — voir l'export MyAttendanceHistory en bas de fichier.
//  • Sanctions automatiques (retard / départ anticipé) : montant par
//    PALIER DE SÉVÉRITÉ (0-15 min / 15-30 min / plus de 30 min de
//    retard ou d'avance), toujours immédiates (pas de double
//    validation), configurables dans le panneau « Paramètres » de cet
//    onglet — écrites directement dans le journal des sanctions existant
//    (visible au Bureau et à l'adhérent concerné).
//
// Deux exports : Presences (onglet Bureau) et MyAttendanceHistory
// (bloc en lecture seule inséré dans le "monespace" de App.jsx).
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Plus, X, Search, Trash2, Download, Printer, CalendarDays, QrCode, CheckCircle2, XCircle, Clock, LogOut, History, Settings, AlertTriangle } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, Table, td, inputStyle, useLang, friendlyError, foldText, Pill, TEAL, TEAL_LIGHT, RED, toDatetimeLocal, datetimeLocalToISO } from "./shared";

const AMBER = "#C9962A";
const AMBER_LIGHT = "#FBF3DA";

// Catégories du menu « Type de séance » — aucun impact sur le pointage ou
// les sanctions, uniquement pour le classement/l'affichage.
const TYPE_SEANCE_OPTIONS = [
  { value: "rencontre", key: "pres_type_rencontre" },
  { value: "assemblee_generale", key: "pres_type_ag" },
  { value: "comite_executif", key: "pres_type_ce" },
  { value: "conseil_administration", key: "pres_type_ca" },
  { value: "formation", key: "pres_type_formation" },
  { value: "collecte_fonds", key: "pres_type_collecte" },
  { value: "activite_sociale", key: "pres_type_social" },
  { value: "autre", key: "pres_type_autre" },
];

// Motifs d'absence — liste courte volontaire (décision utilisateur) :
// quelques catégories larges plutôt qu'une longue liste détaillée. Une
// absence déclarée à l'avance avec l'un de ces motifs est TOUJOURS
// considérée justifiée (aucune validation Bureau requise) — voir
// declarer_absence() (sql/2026-09-30_absences_fiche_unifiee_paiement.sql).
const MOTIF_OPTIONS = [
  { value: "medical", key: "pres_absence_motif_medical" },
  { value: "familial", key: "pres_absence_motif_familial" },
  { value: "professionnel", key: "pres_absence_motif_professionnel" },
  { value: "force_majeure", key: "pres_absence_motif_force_majeure" },
  { value: "autre", key: "pres_absence_motif_autre" },
];
const MOTIF_LABEL_KEY = Object.fromEntries(MOTIF_OPTIONS.map((o) => [o.value, o.key]));

function slugify(s) {
  return (s || "seance").toString().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "seance";
}

function fmtHeure(iso, lang) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(lang === "en" ? "en-CA" : "fr-CA", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(dateStr, lang) {
  if (!dateStr) return "—";
  // date_seance est une colonne "date" (sans heure) : on évite tout
  // décalage de fuseau en la parsant en pièces plutôt qu'avec new Date().
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA", { year: "numeric", month: "short", day: "numeric" });
}
// toDatetimeLocal / datetimeLocalToISO : voir shared.jsx (fuseau de
// l'appareil qui pointe/saisit, jamais un fuseau fixe — 2026-09-30).

function retardMinutesOf(heureArrivee, heureDebutPrevue) {
  if (!heureArrivee || !heureDebutPrevue) return null;
  const diff = Math.round((new Date(heureArrivee) - new Date(heureDebutPrevue)) / 60000);
  return diff > 0 ? diff : 0;
}
function avanceMinutesOf(heureDepart, heureFinPrevue) {
  if (!heureDepart || !heureFinPrevue) return null;
  const diff = Math.round((new Date(heureFinPrevue) - new Date(heureDepart)) / 60000);
  return diff > 0 ? diff : 0;
}

// Fiche unifiée : un seul calcul de statut, utilisé à la fois par le
// tableau à l'écran et par le PDF — présence (à l'heure ou en retard/
// départ anticipé), absence (justifiée ou non) et « attendu » (séance
// encore ouverte, ni présence ni absence enregistrée pour ce membre).
const BLUE = "#3B6FB0";
const BLUE_LIGHT = "#E7EEF8";
const GREY = "#9AA2B5";
const GREY_LIGHT = "#EEF0F4";
function describeRowStatus(r, t, tolRetard, tolAvance, session) {
  if (r.statut === "absent") {
    if (r.absence_justifiee) {
      const motifLabel = r.absence_motif ? t(MOTIF_LABEL_KEY[r.absence_motif]) : "";
      return { label: motifLabel ? t("pres_statut_absent_justifie").replace("{motif}", motifLabel) : t("pres_statut_absent_justifie_sans_motif"), color: BLUE, bg: BLUE_LIGHT };
    }
    return { label: t("pres_statut_absent_non_justifie"), color: RED, bg: "#FBE9E7" };
  }
  if (r.statut !== "present") {
    return { label: t("pres_statut_attendu"), color: GREY, bg: GREY_LIGHT };
  }
  const retard = retardMinutesOf(r.heure_arrivee, session?.heure_debut_prevue);
  const avance = session?.suivre_depart ? avanceMinutesOf(r.heure_depart, session?.heure_fin_prevue) : null;
  const enRetard = retard != null && retard > tolRetard;
  const enAvance = avance != null && avance > tolAvance;
  if (!enRetard && !enAvance) return { label: t("pres_statut_ok"), color: TEAL, bg: TEAL_LIGHT, enRetard, enAvance, retard, avance };

  // Un retard/départ anticipé excusé après coup (justifier_presence(), voir
  // sql/2026-09-30b_justification_retard_depart.sql) reste affiché — avec sa
  // durée — mais en bleu plutôt qu'en ambre, pour distinguer clairement
  // « en retard, sanction annulée » de « à l'heure ». Chaque partie
  // (retard / départ) est justifiée indépendamment ; s'il en reste une
  // non justifiée, l'étiquette combinée reste ambre pour signaler qu'une
  // amende est toujours active.
  const parts = [];
  let allJustified = true;
  if (enRetard) {
    if (r.retard_justifie) parts.push(t("pres_statut_retard_justifie").replace("{n}", String(retard)));
    else { parts.push(t("pres_statut_retard").replace("{n}", String(retard))); allJustified = false; }
  }
  if (enAvance) {
    if (r.depart_justifie) parts.push(t("pres_statut_anticipe_justifie").replace("{n}", String(avance)));
    else { parts.push(t("pres_statut_anticipe").replace("{n}", String(avance))); allJustified = false; }
  }
  const label = parts.join(" / ");
  return allJustified
    ? { label, color: BLUE, bg: BLUE_LIGHT, enRetard, enAvance, retard, avance }
    : { label, color: AMBER, bg: AMBER_LIGHT, enRetard, enAvance, retard, avance };
}

// Messages localisés pour chaque code de statut retourné par checkin_member().
const STATUS_KEY = {
  non_autorise: "pres_status_non_autorise",
  session_introuvable: "pres_status_session_introuvable",
  session_fermee: "pres_status_session_fermee",
  carte_invalide: "pres_status_carte_invalide",
  deja_present: "pres_status_deja_present",
  arrivee_enregistree: "pres_status_arrivee_enregistree",
  depart_non_suivi: "pres_status_depart_non_suivi",
  aucune_arrivee: "pres_status_aucune_arrivee",
  depart_deja_enregistre: "pres_status_depart_deja_enregistre",
  depart_enregistre: "pres_status_depart_enregistre",
};
const STATUS_TONE = {
  non_autorise: "err", session_introuvable: "err", carte_invalide: "err", aucune_arrivee: "err",
  session_fermee: "warn", deja_present: "warn", depart_non_suivi: "warn", depart_deja_enregistre: "warn",
  arrivee_enregistree: "ok", depart_enregistre: "ok",
};

function MemberAvatar({ photoUrl, nom, size = 28 }) {
  if (photoUrl) {
    return <img src={photoUrl} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  }
  const initiales = (nom || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "var(--primary)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.4, flexShrink: 0 }}>
      {initiales || "?"}
    </div>
  );
}

// Petit contrôle inline « Excuser » — affiche un lien discret tant que
// rien n'est en cours, puis un sélecteur de motif + boutons confirmer/
// annuler une fois cliqué (repris du même schéma que la déclaration
// d'absence à l'avance, pour rester cohérent visuellement). N'a pas de
// dépendance directe sur l'état — tout est passé en props — pour rester
// réutilisable pour le retard et pour le départ anticipé sans dupliquer
// le JSX.
function ExcuseInline({ active, motif, onMotifChange, onConfirm, onCancel, onStart, busy, startLabel, t }) {
  if (!active) {
    return (
      <button type="button" onClick={onStart} style={{ background: "none", border: "none", color: BLUE, fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>
        {startLabel}
      </button>
    );
  }
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <select style={{ ...inputStyle, maxWidth: 180, padding: "4px 8px", fontSize: 12.5 }} value={motif} onChange={(e) => onMotifChange(e.target.value)}>
        <option value="">{t("pres_declare_motif_placeholder")}</option>
        {MOTIF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
      </select>
      <Btn variant="outline" disabled={!motif || busy} onClick={onConfirm} style={{ padding: "4px 10px", fontSize: 12.5 }}>{t("pres_excuse_confirm_btn")}</Btn>
      <Btn variant="outline" disabled={busy} onClick={onCancel} style={{ padding: "4px 10px", fontSize: 12.5 }}><X size={12} /></Btn>
    </div>
  );
}

function StatusBanner({ result, t, photoUrl, tolRetard, tolAvance }) {
  if (!result) return null;
  const tone = STATUS_TONE[result.status] || "warn";
  // Un pointage "réussi" mais en retard / avec départ anticipé sanctionné
  // reste affiché en ambre plutôt qu'en teal — l'action a fonctionné,
  // mais ce n'est pas une nouvelle neutre pour l'adhérent.
  const retardSanctionne = result.status === "arrivee_enregistree" && result.retard_minutes != null && result.retard_minutes > (tolRetard ?? 5);
  const avanceSanctionnee = result.status === "depart_enregistre" && result.avance_minutes != null && result.avance_minutes > (tolAvance ?? 5);
  const effectiveTone = (retardSanctionne || avanceSanctionnee) ? "warn" : tone;
  const color = effectiveTone === "ok" ? TEAL : effectiveTone === "err" ? RED : AMBER;
  const bg = effectiveTone === "ok" ? TEAL_LIGHT : effectiveTone === "err" ? "#FBE9E7" : AMBER_LIGHT;
  const Icon = effectiveTone === "ok" ? CheckCircle2 : effectiveTone === "err" ? XCircle : Clock;
  const label = t(STATUS_KEY[result.status] || "pres_status_inconnu");
  let detail = null;
  if (retardSanctionne) detail = t("pres_status_retard_detail").replace("{n}", String(result.retard_minutes)).replace("{montant}", String(result.sanction_montant ?? "—"));
  else if (avanceSanctionnee) detail = t("pres_status_avance_detail").replace("{n}", String(result.avance_minutes)).replace("{montant}", String(result.sanction_montant ?? "—"));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: bg, color, borderRadius: 10, padding: "12px 16px", fontWeight: 600, fontSize: 14 }}>
      {result.member_nom && <MemberAvatar photoUrl={photoUrl} nom={result.member_nom} />}
      <Icon size={18} />
      <div>
        <div>{result.member_nom ? `${result.member_nom} — ${label}` : label}</div>
        {detail && <div style={{ fontWeight: 500, fontSize: 12.5, marginTop: 2 }}>{detail}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Scanner caméra (html5-qrcode, chargé dynamiquement — même principe que
// jsPDF dans RapportAnnuel.jsx : seul ce composant en a besoin, et ça
// donne un message d'erreur clair si le paquet n'est pas encore installé
// plutôt qu'un écran blanc au démarrage de toute l'application).
// ---------------------------------------------------------------------
function extractToken(decodedText) {
  try {
    const url = new URL(decodedText);
    const token = url.searchParams.get("verify");
    if (token) return token;
  } catch { /* pas une URL complète — on tente le motif brut ci-dessous */ }
  const m = /verify=([0-9a-fA-F-]{36})/.exec(decodedText || "");
  if (m) return m[1];
  if (/^[0-9a-fA-F-]{36}$/.test((decodedText || "").trim())) return decodedText.trim();
  return null;
}

function QrScanner({ active, onDecode, t }) {
  const containerRef = useRef(null);
  const scannerRef = useRef(null);
  const onDecodeRef = useRef(onDecode);
  const lastScanRef = useRef({ token: null, time: 0 });
  const [error, setError] = useState(null);

  useEffect(() => { onDecodeRef.current = onDecode; }, [onDecode]);

  // Cycle de vie de la caméra : dépend UNIQUEMENT de `active`, jamais de
  // `onDecode` (dont l'identité change à chaque rendu) — sinon la caméra
  // redémarrerait sans arrêt (voir onDecodeRef ci-dessus).
  useEffect(() => {
    if (!active) return;
    let html5QrCode;
    let cancelled = false;
    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (cancelled) return;
      html5QrCode = new Html5Qrcode("pres-qr-reader");
      scannerRef.current = html5QrCode;
      html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        (decodedText) => {
          const token = extractToken(decodedText);
          if (!token) return;
          const now = Date.now();
          // Le callback de succès se déclenche à chaque image tant que le
          // code reste dans le champ — on ignore les répétitions du même
          // jeton pendant 3 secondes plutôt que de pointer en boucle.
          if (lastScanRef.current.token === token && now - lastScanRef.current.time < 3000) return;
          lastScanRef.current = { token, time: now };
          onDecodeRef.current?.(token);
        },
        () => { /* image sans code lisible : ignoré, ce n'est pas une erreur */ }
      ).catch(() => { if (!cancelled) setError(t("pres_scan_camera_error")); });
    }).catch(() => { if (!cancelled) setError(t("pres_scan_missing_dep")); });

    return () => {
      cancelled = true;
      if (html5QrCode) {
        html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
      }
    };
  }, [active]);

  if (!active) return null;
  return (
    <div style={{ marginTop: 12 }}>
      {error ? (
        <div style={{ color: RED, fontSize: 13.5 }}>{error}</div>
      ) : (
        <div id="pres-qr-reader" ref={containerRef} style={{ maxWidth: 340, margin: "0 auto", borderRadius: 12, overflow: "hidden" }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Export PDF de la liste des présences d'une séance (jsPDF + jspdf-
// autotable, import dynamique, même patron que RapportAnnuel.jsx) —
// enrichi avec le logo de l'association et les mentions légales.
// ---------------------------------------------------------------------
async function logoToDataUrl(logoUrl) {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    // Logo distant inaccessible (CORS, hors ligne, etc.) — le PDF se
    // génère quand même, simplement sans logo.
    return null;
  }
}

async function buildSessionPdf({ t, association, session, rows, lang, tolRetard, tolAvance }) {
  let jsPDFmod, autoTableMod;
  try {
    [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  } catch {
    throw new Error(t("rap_missing_deps"));
  }
  const { jsPDF } = jsPDFmod;
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 40;
  let y = 50;

  const logoDataUrl = await logoToDataUrl(association?.logo_url);
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, marginX, y - 30, 36, 36); } catch { /* format d'image non pris en charge : ignoré */ }
  }
  const textX = logoDataUrl ? marginX + 46 : marginX;

  doc.setFontSize(18); doc.setTextColor(31, 56, 100); doc.setFont(undefined, "bold");
  doc.text(association?.nom || t("rap_org_fallback"), textX, y); y += 18;

  // Mentions légales — même sous-ligne que RapportAnnuel.jsx/les reçus
  // (statut juridique, numéro d'enregistrement, adresse), demande
  // explicite de l'utilisateur pour ce PDF aussi.
  const legalParts = [association?.statut_juridique, association?.numero_enregistrement].filter(Boolean);
  if (legalParts.length > 0) {
    doc.setFontSize(9); doc.setTextColor(102, 102, 102); doc.setFont(undefined, "normal");
    doc.text(legalParts.join(" — "), textX, y); y += 12;
  }
  if (association?.adresse) {
    doc.setFontSize(9); doc.setTextColor(102, 102, 102); doc.setFont(undefined, "normal");
    const addrLines = doc.splitTextToSize(association.adresse, 520 - textX);
    doc.text(addrLines, textX, y); y += addrLines.length * 12;
  }
  y += 12;
  doc.setDrawColor(201, 162, 39); doc.setLineWidth(1.5);
  doc.line(marginX, y - 10, marginX + 60, y - 10);
  y += 8;

  doc.setFontSize(13); doc.setTextColor(31, 56, 100); doc.setFont(undefined, "bold");
  doc.text(session.titre, marginX, y); y += 16;
  doc.setFontSize(10); doc.setTextColor(60, 60, 60); doc.setFont(undefined, "normal");
  const typeLabel = t(TYPE_SEANCE_OPTIONS.find((o) => o.value === session.type_seance)?.key || "pres_type_rencontre");
  const horaire = session.heure_debut_prevue
    ? `${fmtDate(session.date_seance, lang)} · ${fmtHeure(session.heure_debut_prevue, lang)}${session.heure_fin_prevue ? " – " + fmtHeure(session.heure_fin_prevue, lang) : ""} · ${typeLabel}`
    : `${fmtDate(session.date_seance, lang)} · ${typeLabel}`;
  doc.text(horaire, marginX, y); y += 16;

  // Résumé + rappel explicite d'une liste restreinte — demandé par
  // l'utilisateur après avoir été surpris de ne voir que 2 adhérents sur
  // un PDF, sans savoir que la séance avait été créée avec une liste
  // d'attendus restreinte (le badge existait déjà sur l'écran en direct,
  // mais pas sur le PDF/impression qu'il regardait). Complément
  // « justification absence + membres attendus » (2026-09-30c).
  const nbPresentPdf = rows.filter((r) => r.statut === "present").length;
  const nbAbsentPdf = rows.filter((r) => r.statut === "absent").length;
  const summaryParts = [t("pres_pdf_nb_total").replace("{n}", String(rows.length))];
  summaryParts.push(t("pres_count_present").replace("{n}", String(nbPresentPdf)));
  if (nbAbsentPdf > 0) summaryParts.push(t("pres_count_absent").replace("{n}", String(nbAbsentPdf)));
  if (session.attendus_member_ids) summaryParts.push(t("pres_badge_restreint"));
  doc.setFontSize(9.5); doc.setTextColor(90, 90, 90); doc.setFont(undefined, "normal");
  doc.text(summaryParts.join(" · "), marginX, y); y += 18;

  const head = session.suivre_depart
    ? [t("pres_col_nom"), t("pres_col_arrivee"), t("pres_col_depart"), t("pres_col_statut")]
    : [t("pres_col_nom"), t("pres_col_arrivee"), t("pres_col_statut")];
  const body = rows.map((r) => {
    const { label } = describeRowStatus(r, t, tolRetard, tolAvance, session);
    return session.suivre_depart
      ? [r.member_nom, fmtHeure(r.heure_arrivee, lang), fmtHeure(r.heure_depart, lang), label]
      : [r.member_nom, fmtHeure(r.heure_arrivee, lang), label];
  });

  autoTable(doc, {
    startY: y, margin: { left: marginX, right: marginX },
    head: [head], body,
    styles: { fontSize: 9.5, cellPadding: 5 },
    headStyles: { fillColor: [31, 56, 100], textColor: 255, fontSize: 9 },
    alternateRowStyles: { fillColor: [247, 248, 250] },
  });

  // Le fichier n'est plus enregistré ici : l'appelant choisit de le
  // télécharger (doc.save) ou de l'imprimer (doc.autoPrint + fenêtre),
  // demande explicite de l'utilisateur pour l'option d'impression.
  return doc;
}

// =====================================================================
// Panneau de paramètres (Bureau) — sanctions automatiques de retard et
// de départ anticipé, réglages propres à l'association.
// =====================================================================
function PresenceSettingsPanel({ association, profile, t, onAssociationChange, onClose }) {
  const [draft, setDraft] = useState({
    presence_retard_actif: association?.presence_retard_actif || false,
    presence_retard_tolerance_minutes: association?.presence_retard_tolerance_minutes ?? 5,
    presence_retard_montant_0_15: association?.presence_retard_montant_0_15 ?? 5,
    presence_retard_montant_15_30: association?.presence_retard_montant_15_30 ?? 10,
    presence_retard_montant_30_plus: association?.presence_retard_montant_30_plus ?? 20,
    presence_depart_anticipe_actif: association?.presence_depart_anticipe_actif || false,
    presence_depart_tolerance_minutes: association?.presence_depart_tolerance_minutes ?? 5,
    presence_depart_montant_0_15: association?.presence_depart_montant_0_15 ?? 5,
    presence_depart_montant_15_30: association?.presence_depart_montant_15_30 ?? 10,
    presence_depart_montant_30_plus: association?.presence_depart_montant_30_plus ?? 20,
    presence_absence_actif: association?.presence_absence_actif || false,
    presence_absence_montant: association?.presence_absence_montant ?? 15,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const payload = {
      ...draft,
      presence_retard_tolerance_minutes: Number(draft.presence_retard_tolerance_minutes) || 0,
      presence_retard_montant_0_15: Number(draft.presence_retard_montant_0_15) || 0,
      presence_retard_montant_15_30: Number(draft.presence_retard_montant_15_30) || 0,
      presence_retard_montant_30_plus: Number(draft.presence_retard_montant_30_plus) || 0,
      presence_depart_tolerance_minutes: Number(draft.presence_depart_tolerance_minutes) || 0,
      presence_depart_montant_0_15: Number(draft.presence_depart_montant_0_15) || 0,
      presence_depart_montant_15_30: Number(draft.presence_depart_montant_15_30) || 0,
      presence_depart_montant_30_plus: Number(draft.presence_depart_montant_30_plus) || 0,
      presence_absence_montant: Number(draft.presence_absence_montant) || 0,
    };
    const { data, error } = await supabase.from("associations").update(payload).eq("id", profile.association_id).select().single();
    setSaving(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onAssociationChange(data);
    onClose();
  }

  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>{t("pres_settings_title")}</h3>
        <Btn variant="outline" onClick={onClose}><X size={14} /></Btn>
      </div>
      <p style={{ color: "#5B6270", fontSize: 13, marginTop: 4 }}>{t("pres_settings_intro")}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20, marginTop: 12 }}>
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={draft.presence_retard_actif} onChange={(e) => setDraft((p) => ({ ...p, presence_retard_actif: e.target.checked }))} />
            {t("pres_settings_retard_toggle")}
          </label>
          {draft.presence_retard_actif && (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <Field label={t("pres_settings_tolerance")}>
                <input type="number" min="0" style={inputStyle} value={draft.presence_retard_tolerance_minutes} onChange={(e) => setDraft((p) => ({ ...p, presence_retard_tolerance_minutes: e.target.value }))} />
              </Field>
              <Field label={t("pres_settings_band_0_15")}>
                <input type="number" min="0" step="0.01" style={inputStyle} value={draft.presence_retard_montant_0_15} onChange={(e) => setDraft((p) => ({ ...p, presence_retard_montant_0_15: e.target.value }))} />
              </Field>
              <Field label={t("pres_settings_band_15_30")}>
                <input type="number" min="0" step="0.01" style={inputStyle} value={draft.presence_retard_montant_15_30} onChange={(e) => setDraft((p) => ({ ...p, presence_retard_montant_15_30: e.target.value }))} />
              </Field>
              <Field label={t("pres_settings_band_30_plus")}>
                <input type="number" min="0" step="0.01" style={inputStyle} value={draft.presence_retard_montant_30_plus} onChange={(e) => setDraft((p) => ({ ...p, presence_retard_montant_30_plus: e.target.value }))} />
              </Field>
            </div>
          )}
        </div>

        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={draft.presence_depart_anticipe_actif} onChange={(e) => setDraft((p) => ({ ...p, presence_depart_anticipe_actif: e.target.checked }))} />
            {t("pres_settings_depart_toggle")}
          </label>
          {draft.presence_depart_anticipe_actif && (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <Field label={t("pres_settings_tolerance")}>
                <input type="number" min="0" style={inputStyle} value={draft.presence_depart_tolerance_minutes} onChange={(e) => setDraft((p) => ({ ...p, presence_depart_tolerance_minutes: e.target.value }))} />
              </Field>
              <Field label={t("pres_settings_band_0_15")}>
                <input type="number" min="0" step="0.01" style={inputStyle} value={draft.presence_depart_montant_0_15} onChange={(e) => setDraft((p) => ({ ...p, presence_depart_montant_0_15: e.target.value }))} />
              </Field>
              <Field label={t("pres_settings_band_15_30")}>
                <input type="number" min="0" step="0.01" style={inputStyle} value={draft.presence_depart_montant_15_30} onChange={(e) => setDraft((p) => ({ ...p, presence_depart_montant_15_30: e.target.value }))} />
              </Field>
              <Field label={t("pres_settings_band_30_plus")}>
                <input type="number" min="0" step="0.01" style={inputStyle} value={draft.presence_depart_montant_30_plus} onChange={(e) => setDraft((p) => ({ ...p, presence_depart_montant_30_plus: e.target.value }))} />
              </Field>
            </div>
          )}
        </div>

        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={draft.presence_absence_actif} onChange={(e) => setDraft((p) => ({ ...p, presence_absence_actif: e.target.checked }))} />
            {t("pres_settings_absence_toggle")}
          </label>
          <p style={{ fontSize: 11.5, color: "#9AA2B5", margin: "4px 0 0" }}>{t("pres_settings_absence_hint")}</p>
          {draft.presence_absence_actif && (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <Field label={t("pres_settings_absence_montant")}>
                <input type="number" min="0" step="0.01" style={inputStyle} value={draft.presence_absence_montant} onChange={(e) => setDraft((p) => ({ ...p, presence_absence_montant: e.target.value }))} />
              </Field>
            </div>
          )}
        </div>
      </div>

      <p style={{ fontSize: 12, color: "#9AA2B5", marginTop: 14 }}>{t("pres_settings_note_immediate")}</p>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <Btn disabled={saving} onClick={save}>{saving ? t("pres_settings_saving") : t("pres_settings_save_btn")}</Btn>
        <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
      </div>
    </Card>
  );
}

// =====================================================================
// Presences — onglet Bureau
// =====================================================================
export default function Presences({ profile, isBureau, association, onAssociationChange }) {
  const { t, lang } = useLang();
  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);
  const [records, setRecords] = useState([]); // records de la séance actuellement ouverte
  const [loading, setLoading] = useState(true);
  const [openSessionId, setOpenSessionId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const emptyNewSession = { titre: "", type_seance: "rencontre", heure_debut_prevue: "", heure_fin_prevue: "", event_id: "", suivre_depart: false, restreindre_attendus: false, attendus_ids: [] };
  const [newSession, setNewSession] = useState(emptyNewSession);
  const [scanning, setScanning] = useState(false);
  const [scanAction, setScanAction] = useState("arrivee");
  const [manualQuery, setManualQuery] = useState("");
  const [members, setMembers] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [busyMemberId, setBusyMemberId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [justifyTarget, setJustifyTarget] = useState(null); // { recordId, type: "retard" | "depart" } | null
  const [justifyMotif, setJustifyMotif] = useState("");
  const [justifying, setJustifying] = useState(false);

  const membersById = useMemo(() => {
    const map = {};
    members.forEach((m) => { map[m.id] = m; });
    return map;
  }, [members]);

  const tolRetard = association?.presence_retard_tolerance_minutes ?? 5;
  const tolAvance = association?.presence_depart_tolerance_minutes ?? 5;

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: sess }, { data: ev }, { data: mem }] = await Promise.all([
      supabase.from("attendance_sessions").select("*").eq("association_id", profile.association_id).order("date_seance", { ascending: false }),
      supabase.from("events").select("id,titre,date_debut,lieu").eq("association_id", profile.association_id).order("date_debut", { ascending: false }),
      supabase.from("members").select("id,nom,photo_url,statut").order("nom"),
    ]);
    setSessions(sess || []);
    setEvents(ev || []);
    setMembers((mem || []));
    setLoading(false);
  }, [profile.association_id]);

  useEffect(() => { load(); }, [load]);

  const loadRecords = useCallback(async (sessionId) => {
    const { data } = await supabase.from("attendance_records").select("*").eq("session_id", sessionId).order("heure_arrivee");
    setRecords(data || []);
  }, []);

  function openSession(session) {
    setOpenSessionId(session.id);
    setScanning(false);
    setScanAction("arrivee");
    setManualQuery("");
    setLastResult(null);
    loadRecords(session.id);
  }
  function closePanel() {
    setOpenSessionId(null);
    setScanning(false);
    setRecords([]);
  }

  const openSessionObj = sessions.find((s) => s.id === openSessionId) || null;

  // Fiche unifiée : présents/absents déjà enregistrés (records) + membres
  // attendus sans ligne encore (statut "attendu", séance non close) — une
  // seule liste, jamais deux vues séparées (demande explicite de
  // l'utilisateur, 2026-09-30).
  // « Attendu » par défaut = tout adhérent non supprimé (Actif OU Inactif
  // — un statut Inactif n'a pas de rapport avec la présence aux séances,
  // contrairement à Supprimé), sauf liste restreinte explicite — sinon un
  // adhérent Inactif n'apparaissait jamais sur la fiche, n'était jamais
  // marqué absent et ne pouvait jamais être sanctionné (signalé par
  // l'utilisateur, 2026-09-30c). Même critère côté serveur dans
  // cloturer_session() (sql/2026-09-30c_justification_absence_et_membres_
  // attendus.sql).
  const expectedMembers = useMemo(() => {
    if (!openSessionObj) return [];
    const inscrits = members.filter((m) => m.statut !== "Supprimé");
    if (!openSessionObj.attendus_member_ids) return inscrits;
    const idSet = new Set(openSessionObj.attendus_member_ids);
    return inscrits.filter((m) => idSet.has(m.id));
  }, [openSessionObj, members]);

  const unifiedRows = useMemo(() => {
    if (!openSessionObj) return [];
    const byMember = {};
    records.forEach((r) => { byMember[r.member_id] = r; });
    const expectedIds = new Set(expectedMembers.map((m) => m.id));
    const rows = expectedMembers.map((m) => byMember[m.id] || { member_id: m.id, member_nom: m.nom, statut: "attendu", heure_arrivee: null, heure_depart: null });
    records.forEach((r) => { if (!expectedIds.has(r.member_id)) rows.push(r); });
    return rows;
  }, [openSessionObj, expectedMembers, records]);

  const nbPresent = unifiedRows.filter((r) => r.statut === "present").length;
  const nbAbsent = unifiedRows.filter((r) => r.statut === "absent").length;

  async function createSession() {
    if (!newSession.titre.trim() || !newSession.heure_debut_prevue) return;
    const dateSeance = newSession.heure_debut_prevue.slice(0, 10);
    const { data, error } = await supabase.from("attendance_sessions").insert({
      association_id: profile.association_id,
      event_id: newSession.event_id || null,
      titre: newSession.titre.trim(),
      type_seance: newSession.type_seance,
      date_seance: dateSeance,
      heure_debut_prevue: datetimeLocalToISO(newSession.heure_debut_prevue),
      heure_fin_prevue: datetimeLocalToISO(newSession.heure_fin_prevue),
      suivre_depart: newSession.suivre_depart,
      attendus_member_ids: newSession.restreindre_attendus && newSession.attendus_ids.length > 0 ? newSession.attendus_ids : null,
      created_by_profile_id: profile.id,
      created_by_nom: profile.nom_complet || null,
    }).select().single();
    if (error) { alert(t("pres_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
    setSessions((p) => [data, ...p]);
    setShowForm(false);
    setNewSession(emptyNewSession);
    openSession(data);
  }

  async function removeSession(session) {
    if (!window.confirm(t("pres_confirm_delete_session").replace("{titre}", session.titre))) return;
    const { error } = await supabase.from("attendance_sessions").delete().eq("id", session.id);
    if (error) { alert(friendlyError(error, t)); return; }
    setSessions((p) => p.filter((s) => s.id !== session.id));
    if (openSessionId === session.id) closePanel();
  }

  async function toggleCloture(session) {
    const nouvelEtat = !session.cloturee;
    if (!nouvelEtat) {
      // Réouverture : simple, sans effet de bord (ne retire jamais les
      // absences déjà marquées automatiquement — le Bureau les corrige
      // au besoin en pointant l'arrivée du membre concerné).
      const { data, error } = await supabase.from("attendance_sessions")
        .update({ cloturee: false, cloturee_le: null }).eq("id", session.id).select().single();
      if (error) { alert(friendlyError(error, t)); return; }
      setSessions((p) => p.map((s) => (s.id === session.id ? data : s)));
      return;
    }
    if (!window.confirm(t("pres_confirm_close_session"))) return;
    // La clôture marque automatiquement absent tout membre attendu sans
    // ligne de présence/absence, et applique l'amende d'absence si
    // activée — géré entièrement par cloturer_session() (fiche unifiée,
    // 2026-09-30) plutôt que par une simple mise à jour côté client.
    const { data, error } = await supabase.rpc("cloturer_session", { p_session_id: session.id });
    if (error) { alert(friendlyError(error, t)); return; }
    const res = (data || [])[0];
    if (!res || res.status === "non_autorise" || res.status === "session_introuvable") { alert(t("pres_error_generic")); return; }
    const { data: sessRow } = await supabase.from("attendance_sessions").select("*").eq("id", session.id).single();
    if (sessRow) setSessions((p) => p.map((s) => (s.id === session.id ? sessRow : s)));
    if (openSessionId === session.id) await loadRecords(session.id);
    if (res.status === "session_fermee" && res.nb_absents_marques > 0) {
      alert(t("pres_close_summary").replace("{absents}", String(res.nb_absents_marques)).replace("{sanctions}", String(res.nb_sanctions_creees)));
    }
  }

  const checkin = useCallback(async ({ token, memberId }) => {
    if (!openSessionId) return;
    const { data, error } = await supabase.rpc("checkin_member", {
      p_session_id: openSessionId, p_action: scanAction, p_token: token || null, p_member_id: memberId || null,
    });
    if (error) { alert(friendlyError(error, t)); return; }
    const res = (data || [])[0];
    if (!res) return;
    setLastResult(res);
    // On recharge depuis la base plutôt que de fusionner res localement :
    // seule la ligne réelle d'attendance_records porte un id, nécessaire
    // aux boutons « Excuser » (retard/départ justifié après coup — voir
    // sql/2026-09-30b_justification_retard_depart.sql).
    if (["arrivee_enregistree", "depart_enregistre"].includes(res.status)) await loadRecords(openSessionId);
  }, [openSessionId, scanAction, t, loadRecords]);

  async function checkinManual(member) {
    setBusyMemberId(member.id);
    await checkin({ memberId: member.id });
    setBusyMemberId(null);
  }

  function openJustify(recordId, type) {
    setJustifyTarget({ recordId, type });
    setJustifyMotif("");
  }
  function cancelJustify() {
    setJustifyTarget(null);
    setJustifyMotif("");
  }
  async function justifierPresence() {
    if (!justifyTarget || !justifyMotif) return;
    setJustifying(true);
    const { data, error } = await supabase.rpc("justifier_presence", {
      p_record_id: justifyTarget.recordId, p_type: justifyTarget.type, p_motif: justifyMotif,
    });
    setJustifying(false);
    if (error) { alert(friendlyError(error, t)); return; }
    const res = (data || [])[0];
    if (!res || res.status !== "justifie") { alert(t("pres_justify_status_" + (res?.status || "erreur")) || t("pres_error_generic")); return; }
    const { recordId, type } = justifyTarget;
    setRecords((prev) => prev.map((r) => {
      if (r.id !== recordId) return r;
      if (type === "retard") return { ...r, retard_justifie: true, retard_motif_justification: justifyMotif };
      if (type === "depart") return { ...r, depart_justifie: true, depart_motif_justification: justifyMotif };
      return { ...r, absence_justifiee: true, absence_motif: justifyMotif, absence_source: "declaree_bureau" };
    }));
    cancelJustify();
  }

  async function exportPdf(mode) {
    if (!openSessionObj) return;
    setExporting(true);
    try {
      const doc = await buildSessionPdf({ t, association, session: openSessionObj, rows: unifiedRows, lang, tolRetard, tolAvance });
      if (mode === "print") {
        doc.autoPrint();
        window.open(doc.output("bloburl"), "_blank");
      } else {
        doc.save(`presences_${slugify(openSessionObj.titre)}_${openSessionObj.date_seance}.pdf`);
      }
    } catch (e) {
      alert(e.message || t("pres_error_generic"));
    } finally {
      setExporting(false);
    }
  }

  const filteredMembers = manualQuery.trim()
    ? members.filter((m) => foldText(m.nom).includes(foldText(manualQuery)))
    : [];

  if (!isBureau) return null;
  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  const lastResultPhoto = lastResult?.member_id ? membersById[lastResult.member_id]?.photo_url : null;

  return (
    <Container><Section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0 }}>{t("nav_presences")}</h2>
          <p style={{ color: "#5B6270", margin: "4px 0 0", fontSize: 13.5 }}>{t("pres_subtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="outline" onClick={() => setShowSettings((v) => !v)}><Settings size={14} /> {t("pres_settings_btn")}</Btn>
          <Btn onClick={() => setShowForm((v) => !v)}><Plus size={14} /> {t("pres_new_session_btn")}</Btn>
        </div>
      </div>

      {showSettings && (
        <PresenceSettingsPanel association={association} profile={profile} t={t} onAssociationChange={onAssociationChange} onClose={() => setShowSettings(false)} />
      )}

      {showForm && (
        <Card style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>{t("pres_new_session_title")}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
            <Field label={t("pres_field_titre")}>
              <input style={inputStyle} value={newSession.titre} onChange={(e) => setNewSession((p) => ({ ...p, titre: e.target.value }))} />
            </Field>
            <Field label={t("pres_field_type")}>
              <select style={inputStyle} value={newSession.type_seance} onChange={(e) => setNewSession((p) => ({ ...p, type_seance: e.target.value }))}>
                {TYPE_SEANCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
              </select>
            </Field>
            <Field label={t("pres_field_debut")}>
              <input type="datetime-local" style={inputStyle} value={newSession.heure_debut_prevue} onChange={(e) => setNewSession((p) => ({ ...p, heure_debut_prevue: e.target.value }))} />
            </Field>
            <Field label={t("pres_field_fin")}>
              <input type="datetime-local" style={inputStyle} value={newSession.heure_fin_prevue} onChange={(e) => setNewSession((p) => ({ ...p, heure_fin_prevue: e.target.value }))} />
            </Field>
            <Field label={t("pres_field_event")}>
              <select style={inputStyle} value={newSession.event_id} onChange={(e) => {
                const evId = e.target.value;
                const ev = events.find((x) => x.id === evId);
                setNewSession((p) => ({ ...p, event_id: evId, titre: ev ? ev.titre : p.titre, heure_debut_prevue: ev ? toDatetimeLocal(ev.date_debut) : p.heure_debut_prevue }));
              }}>
                <option value="">{t("pres_field_event_none")}</option>
                {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.titre}</option>)}
              </select>
            </Field>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={newSession.suivre_depart} onChange={(e) => setNewSession((p) => ({ ...p, suivre_depart: e.target.checked }))} />
            {t("pres_field_suivre_depart")}
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={newSession.restreindre_attendus} onChange={(e) => setNewSession((p) => ({ ...p, restreindre_attendus: e.target.checked }))} />
            {t("pres_field_restreindre_attendus")}
          </label>
          <p style={{ fontSize: 11.5, color: "#9AA2B5", margin: "3px 0 0" }}>{t("pres_field_restreindre_attendus_hint")}</p>
          {newSession.restreindre_attendus && (
            <div style={{ display: "grid", gap: 6, marginTop: 8, maxHeight: 200, overflowY: "auto", border: "1px solid #E7E9F1", borderRadius: 8, padding: 10 }}>
              {members.filter((m) => m.statut !== "Supprimé").length === 0 && <p style={{ fontSize: 12.5, color: "#9AA2B5" }}>{t("pres_no_active_members")}</p>}
              {members.filter((m) => m.statut !== "Supprimé").map((m) => (
                <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={newSession.attendus_ids.includes(m.id)}
                    onChange={(e) => setNewSession((p) => ({
                      ...p,
                      attendus_ids: e.target.checked ? [...p.attendus_ids, m.id] : p.attendus_ids.filter((id) => id !== m.id),
                    }))}
                  />
                  <MemberAvatar photoUrl={m.photo_url} nom={m.nom} size={20} />
                  {m.nom}
                </label>
              ))}
            </div>
          )}
          {(association?.presence_retard_actif || association?.presence_depart_anticipe_actif || association?.presence_absence_actif) && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: AMBER_LIGHT, color: AMBER, borderRadius: 10, padding: "10px 14px", marginTop: 12, fontSize: 12.5 }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{t("pres_form_sanctions_active_notice")}</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <Btn onClick={createSession}>{t("pres_create_btn")}</Btn>
            <Btn variant="outline" onClick={() => setShowForm(false)}>{t("action_cancel")}</Btn>
          </div>
        </Card>
      )}

      {!openSessionObj ? (
        <div style={{ display: "grid", gap: 12 }}>
          {sessions.length === 0 && <p style={{ color: "#9AA2B5" }}>{t("pres_no_sessions")}</p>}
          {sessions.map((s) => (
            <Card key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, cursor: "pointer" }}>
              <div onClick={() => openSession(s)} style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong>{s.titre}</strong>
                  <Pill color="#5B6270" bg="#EEF0F4">{t(TYPE_SEANCE_OPTIONS.find((o) => o.value === s.type_seance)?.key || "pres_type_rencontre")}</Pill>
                  {s.cloturee && <Pill color={RED} bg="#FBE9E7">{t("pres_badge_closed")}</Pill>}
                  {s.suivre_depart && <Pill color={TEAL} bg={TEAL_LIGHT}>{t("pres_badge_depart")}</Pill>}
                </div>
                <div style={{ fontSize: 12.5, color: "#9AA2B5", marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
                  <CalendarDays size={13} /> {fmtDate(s.date_seance, lang)}
                  {s.heure_debut_prevue && ` · ${fmtHeure(s.heure_debut_prevue, lang)}${s.heure_fin_prevue ? " – " + fmtHeure(s.heure_fin_prevue, lang) : ""}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="outline" onClick={() => openSession(s)}><QrCode size={14} /> {t("pres_open_btn")}</Btn>
                <Btn variant="outline" onClick={() => removeSession(s)}><Trash2 size={14} /></Btn>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0 }}>{openSessionObj.titre}</h3>
              <div style={{ fontSize: 12.5, color: "#9AA2B5", marginTop: 3 }}>
                {fmtDate(openSessionObj.date_seance, lang)}
                {openSessionObj.heure_debut_prevue && ` · ${fmtHeure(openSessionObj.heure_debut_prevue, lang)}${openSessionObj.heure_fin_prevue ? " – " + fmtHeure(openSessionObj.heure_fin_prevue, lang) : ""}`}
                {" · "}{t("pres_count_present").replace("{n}", String(nbPresent))}
                {nbAbsent > 0 && ` · ${t("pres_count_absent").replace("{n}", String(nbAbsent))}`}
                {openSessionObj.attendus_member_ids && ` · ${t("pres_badge_restreint")}`}
              </div>
            </div>
            <Btn variant="outline" onClick={closePanel}><X size={14} /> {t("action_close")}</Btn>
          </div>

          {openSessionObj.cloturee ? (
            <div style={{ background: "#FBE9E7", color: RED, borderRadius: 10, padding: "10px 14px", fontSize: 13.5, marginBottom: 14 }}>{t("pres_session_closed_notice")}</div>
          ) : (
            <>
              {openSessionObj.suivre_depart && (
                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  <Btn variant={scanAction === "arrivee" ? "primary" : "outline"} onClick={() => setScanAction("arrivee")}>{t("pres_mode_arrivee")}</Btn>
                  <Btn variant={scanAction === "depart" ? "primary" : "outline"} onClick={() => setScanAction("depart")}><LogOut size={14} /> {t("pres_mode_depart")}</Btn>
                </div>
              )}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <Btn onClick={() => setScanning((v) => !v)}><QrCode size={14} /> {scanning ? t("pres_stop_scan_btn") : t("pres_start_scan_btn")}</Btn>
              </div>
              <QrScanner active={scanning} onDecode={(token) => checkin({ token })} t={t} />

              <StatusBanner result={lastResult} t={t} photoUrl={lastResultPhoto} tolRetard={tolRetard} tolAvance={tolAvance} />

              <div style={{ marginTop: 16 }}>
                <Field label={t("pres_manual_search_label")}>
                  <div style={{ position: "relative" }}>
                    <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "#9AA2B5" }} />
                    <input style={{ ...inputStyle, paddingLeft: 32 }} value={manualQuery} onChange={(e) => setManualQuery(e.target.value)} placeholder={t("pres_manual_search_placeholder")} />
                  </div>
                </Field>
                {filteredMembers.length > 0 && (
                  <div style={{ display: "grid", gap: 6, marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
                    {filteredMembers.slice(0, 25).map((m) => (
                      <button key={m.id} disabled={busyMemberId === m.id} onClick={() => checkinManual(m)}
                        style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: "white", border: "1px solid #E7E9F1", borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 14 }}>
                        <MemberAvatar photoUrl={m.photo_url} nom={m.nom} size={24} />
                        {m.nom}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <div style={{ marginTop: 22, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "#9AA2B5" }}>{t("pres_section_list")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="outline" disabled={exporting || unifiedRows.length === 0} onClick={() => exportPdf("download")}><Download size={14} /> {t("pres_export_pdf_btn")}</Btn>
              <Btn variant="outline" disabled={exporting || unifiedRows.length === 0} onClick={() => exportPdf("print")}><Printer size={14} /> {t("pres_print_pdf_btn")}</Btn>
              <Btn variant="outline" onClick={() => toggleCloture(openSessionObj)}>{openSessionObj.cloturee ? t("pres_reopen_btn") : t("pres_close_session_btn")}</Btn>
            </div>
          </div>

          {unifiedRows.length === 0 ? (
            <p style={{ color: "#9AA2B5", marginTop: 10 }}>{t("pres_no_records")}</p>
          ) : (
            <Table head={openSessionObj.suivre_depart ? [t("pres_col_nom"), t("pres_col_arrivee"), t("pres_col_depart"), t("pres_col_statut")] : [t("pres_col_nom"), t("pres_col_arrivee"), t("pres_col_statut")]}>
              {unifiedRows.map((r) => {
                const { label, color, bg, enRetard, enAvance } = describeRowStatus(r, t, tolRetard, tolAvance, openSessionObj);
                // Boutons « Excuser » : uniquement sur une vraie ligne
                // (r.id — jamais sur une ligne "attendu" synthétique) dont
                // le retard/départ dépasse la tolérance et n'est pas déjà
                // justifié — voir justifierPresence().
                const canExcuseRetard = !!r.id && enRetard && !r.retard_justifie;
                const canExcuseDepart = !!r.id && enAvance && !r.depart_justifie;
                // Même logique pour une absence marquée automatiquement à
                // la clôture (source "auto") : une absence déjà déclarée
                // par le membre lui-même est déjà justifiée d'office, donc
                // jamais concernée ici (signalé par l'utilisateur, 2026-09-30c).
                const canExcuseAbsence = !!r.id && r.statut === "absent" && !r.absence_justifiee;
                return (
                  <tr key={r.member_id}>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <MemberAvatar photoUrl={membersById[r.member_id]?.photo_url} nom={r.member_nom} size={24} />
                        {r.member_nom}
                      </div>
                    </td>
                    <td style={td}>{fmtHeure(r.heure_arrivee, lang)}</td>
                    {openSessionObj.suivre_depart && <td style={td}>{fmtHeure(r.heure_depart, lang)}</td>}
                    <td style={td}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                        <Pill color={color} bg={bg}>{label}</Pill>
                        {canExcuseRetard && (
                          <ExcuseInline
                            t={t} busy={justifying}
                            active={justifyTarget?.recordId === r.id && justifyTarget?.type === "retard"}
                            motif={justifyMotif} onMotifChange={setJustifyMotif}
                            onStart={() => openJustify(r.id, "retard")}
                            onConfirm={justifierPresence} onCancel={cancelJustify}
                            startLabel={t("pres_excuse_btn_retard")}
                          />
                        )}
                        {canExcuseDepart && (
                          <ExcuseInline
                            t={t} busy={justifying}
                            active={justifyTarget?.recordId === r.id && justifyTarget?.type === "depart"}
                            motif={justifyMotif} onMotifChange={setJustifyMotif}
                            onStart={() => openJustify(r.id, "depart")}
                            onConfirm={justifierPresence} onCancel={cancelJustify}
                            startLabel={t("pres_excuse_btn_depart")}
                          />
                        )}
                        {canExcuseAbsence && (
                          <ExcuseInline
                            t={t} busy={justifying}
                            active={justifyTarget?.recordId === r.id && justifyTarget?.type === "absence"}
                            motif={justifyMotif} onMotifChange={setJustifyMotif}
                            onStart={() => openJustify(r.id, "absence")}
                            onConfirm={justifierPresence} onCancel={cancelJustify}
                            startLabel={t("pres_excuse_btn_absence")}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      )}
    </Section></Container>
  );
}

// =====================================================================
// MyAttendanceHistory — bloc en lecture seule pour « Mon espace »
// (décision utilisateur : chaque adhérent voit son propre historique).
// =====================================================================
export function MyAttendanceHistory({ profile }) {
  const { t, lang } = useLang();
  const [records, setRecords] = useState([]);
  const [sessionsById, setSessionsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const loadedRef = useRef(false);

  // Séances à venir (non closes) où l'adhérent est attendu, pour pouvoir
  // signaler une absence à l'avance — toujours chargé (pas seulement
  // quand l'historique est déroulé) puisqu'il s'agit d'une action à
  // faire, pas seulement d'une consultation. La RLS d'attendance_sessions
  // ne renvoie déjà que les séances concernant ce membre (voir
  // sql/2026-09-30_absences_fiche_unifiee_paiement.sql).
  const [openSessions, setOpenSessions] = useState([]);
  const [myOpenRecords, setMyOpenRecords] = useState({});
  const [motifDraft, setMotifDraft] = useState({});
  const [declaring, setDeclaring] = useState(null);
  const declareLoadedRef = useRef(false);

  useEffect(() => {
    if (declareLoadedRef.current || !profile.member_id) return;
    declareLoadedRef.current = true;
    (async () => {
      const { data: sess } = await supabase.from("attendance_sessions")
        .select("id,titre,date_seance,heure_debut_prevue,type_seance").eq("cloturee", false).order("date_seance");
      setOpenSessions(sess || []);
      if (sess && sess.length > 0) {
        const { data: recs } = await supabase.from("attendance_records").select("*")
          .eq("member_id", profile.member_id).in("session_id", sess.map((s) => s.id));
        const map = {}; (recs || []).forEach((r) => { map[r.session_id] = r; });
        setMyOpenRecords(map);
      }
    })();
  }, [profile.member_id]);

  async function declarer(sessionId) {
    const motif = motifDraft[sessionId];
    if (!motif) return;
    setDeclaring(sessionId);
    const { data, error } = await supabase.rpc("declarer_absence", { p_session_id: sessionId, p_action: "declarer", p_motif: motif });
    setDeclaring(null);
    if (error) { alert(friendlyError(error, t)); return; }
    const res = (data || [])[0];
    if (res?.status === "declaration_enregistree") {
      setMyOpenRecords((p) => ({ ...p, [sessionId]: { session_id: sessionId, statut: "absent", absence_motif: motif, absence_justifiee: true, absence_source: "declaree_membre" } }));
    } else {
      alert(t("pres_declare_status_" + res?.status) || t("pres_error_generic"));
    }
  }
  async function annulerDeclaration(sessionId) {
    setDeclaring(sessionId);
    const { data, error } = await supabase.rpc("declarer_absence", { p_session_id: sessionId, p_action: "annuler" });
    setDeclaring(null);
    if (error) { alert(friendlyError(error, t)); return; }
    const res = (data || [])[0];
    if (res?.status === "declaration_annulee") {
      setMyOpenRecords((p) => { const next = { ...p }; delete next[sessionId]; return next; });
    }
  }

  useEffect(() => {
    if (!open || loadedRef.current || !profile.member_id) return;
    loadedRef.current = true;
    (async () => {
      setLoading(true);
      const { data: recs } = await supabase.from("attendance_records").select("*").eq("member_id", profile.member_id).order("heure_arrivee", { ascending: false });
      const { data: sess } = await supabase.from("attendance_sessions").select("id,titre,date_seance,suivre_depart,heure_debut_prevue,heure_fin_prevue");
      const map = {}; (sess || []).forEach((s) => { map[s.id] = s; });
      setSessionsById(map);
      setRecords(recs || []);
      setLoading(false);
    })();
  }, [open, profile.member_id]);

  return (
    <>
      {openSessions.length > 0 && (
        <Card style={{ marginTop: 18 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{t("pres_declare_title")}</h3>
          <p style={{ color: "#5B6270", fontSize: 12.5, margin: "4px 0 0" }}>{t("pres_declare_intro")}</p>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {openSessions.map((s) => {
              const rec = myOpenRecords[s.id];
              const declaredByMe = rec?.absence_source === "declaree_membre";
              const dejaPresent = rec?.statut === "present";
              return (
                <div key={s.id} style={{ border: "1px solid #E7E9F1", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{s.titre}</div>
                  <div style={{ fontSize: 12, color: "#9AA2B5", marginBottom: 8 }}>
                    {fmtDate(s.date_seance, lang)}{s.heure_debut_prevue ? ` · ${fmtHeure(s.heure_debut_prevue, lang)}` : ""}
                  </div>
                  {dejaPresent ? (
                    <Pill color={TEAL} bg={TEAL_LIGHT}>{t("pres_declare_already_present")}</Pill>
                  ) : declaredByMe ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Pill color="#3B6FB0" bg="#E7EEF8">{t("pres_declare_done").replace("{motif}", t(MOTIF_LABEL_KEY[rec.absence_motif]))}</Pill>
                      <Btn variant="outline" disabled={declaring === s.id} onClick={() => annulerDeclaration(s.id)}>{t("pres_declare_cancel_btn")}</Btn>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <select style={{ ...inputStyle, maxWidth: 230 }} value={motifDraft[s.id] || ""} onChange={(e) => setMotifDraft((p) => ({ ...p, [s.id]: e.target.value }))}>
                        <option value="">{t("pres_declare_motif_placeholder")}</option>
                        {MOTIF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
                      </select>
                      <Btn variant="outline" disabled={!motifDraft[s.id] || declaring === s.id} onClick={() => declarer(s.id)}>{t("pres_declare_submit_btn")}</Btn>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card style={{ marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <History size={16} />
            <h3 style={{ margin: 0, fontSize: 15 }}>{t("pres_history_title")}</h3>
          </div>
        </div>
        {open && (
          loading ? <p style={{ color: "#9AA2B5", marginTop: 10 }}>{t("loading")}</p> : (
            records.length === 0 ? <p style={{ color: "#9AA2B5", marginTop: 10 }}>{t("pres_history_empty")}</p> : (
              <Table head={[t("pres_col_seance"), t("pres_col_date"), t("pres_col_arrivee"), t("pres_col_depart"), t("pres_col_statut")]}>
                {records.map((r) => {
                  const s = sessionsById[r.session_id];
                  const { label, color, bg } = describeRowStatus(r, t, 5, 5, s);
                  return (
                    <tr key={r.id}>
                      <td style={td}>{s?.titre || "—"}</td>
                      <td style={td}>{s ? fmtDate(s.date_seance, lang) : "—"}</td>
                      <td style={td}>{fmtHeure(r.heure_arrivee, lang)}</td>
                      <td style={td}>{s?.suivre_depart ? fmtHeure(r.heure_depart, lang) : "—"}</td>
                      <td style={td}><Pill color={color} bg={bg}>{label}</Pill></td>
                    </tr>
                  );
                })}
              </Table>
            )
          )
        )}
      </Card>
    </>
  );
}
