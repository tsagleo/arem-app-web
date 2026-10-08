// =====================================================================
// Evenements.jsx — Planificateur d'événements avec RSVP
// Développé par Omnia Trade Solutions
// =====================================================================
import React, { useState, useEffect, useCallback } from "react";
import {
  CalendarDays, Plus, Users, Pencil, Trash2, X, Video, Download, Star, MessageCircle, CreditCard, Eye, ChevronDown,
  QrCode, ScanLine, Car, HeartHandshake, Ban, FileDown, Link2, Repeat, ClipboardCheck, Search,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, Table, td, inputStyle, money, useLang, friendlyError, RED, whatsappShareUrl, Pill, TEAL, TEAL_LIGHT, GOLD_LIGHT, foldText } from "./shared";

const STAR_COLOR = "#F5A623";
const AMBER = "#8A5A00";
// Même bleu marine que les écrans de connexion (App.jsx) — pas encore
// exporté de shared.jsx, repris ici tel quel pour rester cohérent avec
// l'identité visuelle existante plutôt que d'inventer une nouvelle teinte.
const NAVY = "#1F3864";
const TEAL_DARK = "#1F8A5C";

// ---------- Réaménagement Événements (2026-09-30, suite « liste + fiche
// plein écran ») : couleur d'accent stable par catégorie, sans dépendre
// de noms de catégories précis (texte libre côté Bureau) — un hachage
// simple répartit chaque catégorie sur une palette de couleurs de marque.
function categoryAccent(categorie) {
  if (!categorie) return "#8A8F98";
  const palette = [TEAL, NAVY, AMBER, STAR_COLOR];
  let hash = 0;
  for (let i = 0; i < categorie.length; i++) hash = (hash * 31 + categorie.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}
function pillFilterStyle(active) {
  return active
    ? { fontWeight: 600, fontSize: 13, color: "#fff", background: TEAL, border: "1px solid transparent", borderRadius: 999, padding: "8px 16px", cursor: "pointer" }
    : { fontWeight: 600, fontSize: 13, color: "rgba(42,42,42,.55)", background: "transparent", border: "1px solid rgba(42,42,42,.14)", borderRadius: 999, padding: "8px 16px", cursor: "pointer" };
}
function statusPillStyle(ev, full) {
  const base = { display: "inline-flex", justifyContent: "center", fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 10.5, padding: "5px 10px", borderRadius: 999, whiteSpace: "nowrap" };
  if (ev.annule) return { ...base, color: RED, background: "rgba(192,57,43,.08)" };
  if (full) return { ...base, color: "#8F6A24", background: "rgba(184,134,11,.12)" };
  return { ...base, color: TEAL_DARK, background: TEAL_LIGHT };
}
function tabBtnStyle(active) {
  return {
    display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 13.5,
    color: active ? "#fff" : "rgba(42,42,42,.55)", background: active ? TEAL : "transparent", border: "none",
    borderRadius: 11, padding: "11px 18px", cursor: "pointer", whiteSpace: "nowrap",
    boxShadow: active ? "0 8px 20px -6px rgba(46,139,116,.45), inset 0 0 0 1.5px rgba(232,206,122,.6)" : "none",
  };
}
const HERO_ICON_BTN = { width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.3)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 };

// ---------- Export calendrier (.ics) ----------
// Suite 65 (2026-09-12), à la demande de l'utilisateur : « une option de
// générer les rendez-vous » — précisée (AskUserQuestion) comme un export
// calendrier standard (Google Calendar/Outlook/Apple) pour les événements
// déjà planifiés, plutôt qu'un système de prise de rendez-vous individuel.
// Génération 100 % côté client, aucune donnée envoyée nulle part —
// aucune colonne ni table supplémentaire nécessaire.
function pad2(n) { return String(n).padStart(2, "0"); }
function toIcsDate(d) {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}
function escapeIcs(text) {
  return String(text || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function downloadEventIcs(ev, joinLabel) {
  const start = new Date(ev.date_debut);
  // Les événements n'ont pas d'heure de fin — 2 heures par défaut, une
  // durée raisonnable pour une réunion associative, modifiable ensuite
  // par l'adhérent directement dans son propre calendrier.
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const descParts = [ev.description, ev.lien_reunion ? `${joinLabel} : ${ev.lien_reunion}` : ""].filter(Boolean);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Unia//Evenements//FR", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${ev.id}@arem-app`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${escapeIcs(ev.titre)}`,
    descParts.length ? `DESCRIPTION:${escapeIcs(descParts.join("\n"))}` : "",
    ev.lieu ? `LOCATION:${escapeIcs(ev.lieu)}` : "",
    ev.lien_reunion ? `URL:${ev.lien_reunion}` : "",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean);
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${(ev.titre || "evenement").replace(/[^a-z0-9]+/gi, "_")}.ics`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Texte de partage WhatsApp d'un événement (2026-09-28, suite 81 — chantier
// « internationalisation ») : titre, date, lieu, description et lien de
// réunion s'ils existent — même contenu que l'export calendrier ci-dessus,
// mais en texte brut prêt à coller dans un message WhatsApp.
function eventShareText(ev, t, lang, joinLabel) {
  const locale = lang === "en" ? "en-CA" : "fr-CA";
  const lines = [`📅 ${ev.titre}`, new Date(ev.date_debut).toLocaleString(locale)];
  if (ev.lieu) lines.push(`📍 ${ev.lieu}`);
  if (ev.description) lines.push("", ev.description);
  if (ev.lien_reunion) lines.push("", `${joinLabel} : ${ev.lien_reunion}`);
  return lines.join("\n");
}

// =====================================================================
// Modernisation Événements (2026-09-30) — voir sql/2026-09-30_evenements_
// modernisation.sql et claude/evenements-modernisation-proposition.md
// pour le détail des arbitrages retenus.
// =====================================================================

// ---------- Récurrence (duplication déclenchée côté client, même patron
// que project_tasks.recurrence dans Projets.jsx) ----------
function addDaysToDateTime(iso, n) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}
function addMonthsToDateTime(iso, n) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString();
}
function nextOccurrence(ev) {
  if (ev.recurrence === "hebdomadaire") return addDaysToDateTime(ev.date_debut, 7);
  if (ev.recurrence === "mensuel") return addMonthsToDateTime(ev.date_debut, 1);
  return null;
}

// ---------- Billet nominatif (QR) + scanner de pointage à l'entrée ----------
// Même principe que la carte de membre (App.jsx, MemberCardModal) pour
// l'affichage du QR, et que le scanner caméra de Presences.jsx pour la
// lecture — dupliqués ici volontairement (modules autonomes).
function extractBilletToken(decodedText) {
  try {
    const url = new URL(decodedText);
    const token = url.searchParams.get("billet");
    if (token) return token;
  } catch { /* pas une URL complète — on tente le motif brut ci-dessous */ }
  const m = /billet=([0-9a-fA-F-]{36})/.exec(decodedText || "");
  if (m) return m[1];
  if (/^[0-9a-fA-F-]{36}$/.test((decodedText || "").trim())) return decodedText.trim();
  return null;
}

function EventQrScanner({ active, onDecode, t }) {
  const scannerRef = React.useRef(null);
  const onDecodeRef = React.useRef(onDecode);
  const lastScanRef = React.useRef({ token: null, time: 0 });
  const [error, setError] = useState(null);

  useEffect(() => { onDecodeRef.current = onDecode; }, [onDecode]);

  useEffect(() => {
    if (!active) return;
    let html5QrCode;
    let cancelled = false;
    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (cancelled) return;
      html5QrCode = new Html5Qrcode("ev-qr-reader");
      scannerRef.current = html5QrCode;
      html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        (decodedText) => {
          const token = extractBilletToken(decodedText);
          if (!token) return;
          const now = Date.now();
          if (lastScanRef.current.token === token && now - lastScanRef.current.time < 3000) return;
          lastScanRef.current = { token, time: now };
          onDecodeRef.current?.(token);
        },
        () => { /* image sans code lisible : ignoré */ }
      ).catch(() => { if (!cancelled) setError(t("pres_scan_camera_error")); });
    }).catch(() => { if (!cancelled) setError(t("pres_scan_missing_dep")); });

    return () => {
      cancelled = true;
      if (html5QrCode) html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
    };
  }, [active]);

  if (!active) return null;
  return (
    <div style={{ marginTop: 10 }}>
      {error ? (
        <div style={{ color: RED, fontSize: 13 }}>{error}</div>
      ) : (
        <div id="ev-qr-reader" style={{ maxWidth: 300, margin: "0 auto", borderRadius: 12, overflow: "hidden" }} />
      )}
    </div>
  );
}

function TicketModal({ ev, rsvp, association, t, lang, onClose }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const billetUrl = `${window.location.origin}/?billet=${rsvp.billet_token}`;
  useEffect(() => {
    let cancelled = false;
    import("qrcode").then((QRCode) => {
      QRCode.toDataURL(billetUrl, { width: 220, margin: 1 }).then((url) => { if (!cancelled) setQrDataUrl(url); });
    }).catch(() => { /* module QR indisponible : le billet reste affichable sans QR */ });
    return () => { cancelled = true; };
  }, [billetUrl]);

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 16, padding: 28, maxWidth: 320, width: "92%", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {association?.logo_url && <img src={association.logo_url} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", marginBottom: 8 }} />}
        <h3 style={{ fontSize: 15, margin: "0 0 2px" }}>{t("ev_ticket_title")}</h3>
        <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 16 }}>{ev.titre}</p>
        {qrDataUrl ? <img src={qrDataUrl} alt="QR" style={{ width: 180, height: 180 }} /> : <div style={{ width: 180, height: 180, margin: "0 auto", background: "#F1F2F4", borderRadius: 8 }} />}
        <p style={{ fontSize: 11.5, color: "#333", marginTop: 4 }}>{new Date(ev.date_debut).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</p>
        {rsvp.checkin_le ? (
          <p style={{ fontSize: 12, fontWeight: 700, color: TEAL, marginTop: 10 }}>{t("ev_ticket_checked_in").replace("{date}", new Date(rsvp.checkin_le).toLocaleString(lang === "en" ? "en-CA" : "fr-CA"))}</p>
        ) : (
          <p style={{ fontSize: 12, color: "#686F7D", marginTop: 10 }}>{t("ev_ticket_not_checked_in")}</p>
        )}
      </div>
    </div>
  );
}

// ---------- Export CSV des participants (100 % côté client) ----------
// En-tête d'identité (nom de l'association, mentions légales, adresse)
// ajoutée avant les données — même contenu que le composant partagé
// OrgLegalSubline (shared.jsx) utilisé sur les reçus, mais un CSV ne peut
// contenir qu'un texte brut : pas de logo (image) possible dans ce format,
// contrairement au bilan PDF (buildEventBilanPdf, ci-dessus) qui l'affiche
// (demande utilisateur, 2026-09-30). Retourne un tableau de lignes à une
// seule cellule, à préfixer aux lignes de données réelles.
function csvLegalHeaderLines(association) {
  const lines = [];
  if (association?.nom) lines.push(association.nom);
  const legalParts = [association?.statut_juridique, association?.numero_enregistrement].filter(Boolean);
  if (legalParts.length > 0) lines.push(legalParts.join(" — "));
  if (association?.adresse) lines.push(...String(association.adresse).split("\n"));
  if (lines.length > 0) lines.push(""); // ligne vide de séparation avant l'en-tête des colonnes
  return lines.map((l) => [l]);
}
function downloadParticipantsCsv(ev, confirmedList, membersList, association) {
  const header = ["Nom", "Statut", "Pointage à l'entrée"];
  const rows = confirmedList.map((r) => [
    membersList.find((m) => m.id === r.member_id)?.nom || "",
    r.statut,
    r.checkin_le ? new Date(r.checkin_le).toLocaleString("fr-CA") : "",
  ]);
  const csv = [...csvLegalHeaderLines(association), header, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${(ev.titre || "evenement").replace(/[^a-z0-9]+/gi, "_")}_participants.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Bilan PDF d'un événement passé (même patron que buildSessionPdf
// de Presences.jsx / buildImpactReportPdf de Projets.jsx) ----------
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
    return null;
  }
}

async function buildEventBilanPdf({ t, association, event, confirmedCount, revenue, avgRatingValue, nbReviews, volunteerCount, devise }) {
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
    try { doc.addImage(logoDataUrl, marginX, y - 30, 36, 36); } catch { /* format non pris en charge */ }
  }
  const textX = logoDataUrl ? marginX + 46 : marginX;

  doc.setFontSize(18); doc.setTextColor(31, 56, 100); doc.setFont(undefined, "bold");
  doc.text(association?.nom || t("rap_org_fallback"), textX, y); y += 16;

  // Mentions légales (statut juridique, n° d'enregistrement, adresse) —
  // même logique et même contenu que le composant partagé OrgLegalSubline
  // (shared.jsx) utilisé sur les autres reçus de l'app, pour que le bilan
  // PDF d'un événement porte les mêmes mentions (demande utilisateur,
  // 2026-09-30). N'affiche rien de plus si l'association n'a rien
  // configuré (Configuration → Informations légales et reçus).
  const legalParts = [association?.statut_juridique, association?.numero_enregistrement].filter(Boolean);
  if (legalParts.length > 0 || association?.adresse) {
    doc.setFontSize(8.5); doc.setTextColor(110, 110, 110); doc.setFont(undefined, "normal");
    if (legalParts.length > 0) { doc.text(legalParts.join(" — "), textX, y); y += 11; }
    if (association?.adresse) {
      const addrLines = String(association.adresse).split("\n");
      for (const line of addrLines) { doc.text(line, textX, y); y += 11; }
    }
  }
  y += 6;

  doc.setFontSize(14); doc.setTextColor(31, 56, 100); doc.setFont(undefined, "bold");
  doc.text(event.titre, textX, y); y += 16;
  doc.setFontSize(10); doc.setTextColor(60, 60, 60); doc.setFont(undefined, "normal");
  doc.text(new Date(event.date_debut).toLocaleString("fr-CA"), textX, y); y += 20;

  const rows = [
    [t("ev_col_participants"), String(confirmedCount)],
    [t("interac_claims_col_amount"), money(revenue, devise)],
    [t("ev_col_reviews"), avgRatingValue ? `${avgRatingValue.toFixed(1)} / 5 (${nbReviews})` : t("ev_no_reviews_short")],
    [t("ev_volunteer_toggle"), String(volunteerCount)],
  ];
  autoTable(doc, {
    startY: y, margin: { left: marginX, right: marginX },
    body: rows,
    styles: { fontSize: 10.5, cellPadding: 6 },
    columnStyles: { 0: { fontStyle: "bold", textColor: [31, 56, 100] } },
  });

  return doc;
}

export default function Evenements({ profile, isBureau, association }) {
  const [events, setEvents] = useState([]);
  const [rsvps, setRsvps] = useState([]);
  const [members, setMembers] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [claims, setClaims] = useState([]);
  // Détail des paiements par événement (chantier « application complète »,
  // 2026-09-28, suite 90) — le registre payment_transactions est déjà
  // alimenté (webhook Stripe + confirmation Interac) mais rien ne le
  // retraçait par événement jusqu'ici. RLS (payment_transactions select,
  // sql/2026-09-10g) limite déjà un adhérent à ses propres lignes, donc
  // aucun filtrage supplémentaire n'est nécessaire côté client pour la
  // confidentialité : le Bureau (is_staff()) reçoit tout, l'adhérent ne
  // reçoit que les siennes.
  const [eventPayments, setEventPayments] = useState([]);
  const [financeEventId, setFinanceEventId] = useState(null);
  // ---------- Modernisation Événements (2026-09-30) : état des nouveaux
  // blocs — voir sql/2026-09-30_evenements_modernisation.sql. Chaque
  // requête de chargement ci-dessous est tolérante (liste vide en cas
  // d'erreur) tant que le script n'a pas encore été exécuté par l'utilisateur.
  const [sessions, setSessions] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [volunteerTasks, setVolunteerTasks] = useState([]);
  const [volunteerSignups, setVolunteerSignups] = useState([]);
  const [carpoolOffers, setCarpoolOffers] = useState([]);
  const [carpoolRequests, setCarpoolRequests] = useState([]);
  const [refundQueue, setRefundQueue] = useState([]);
  const [publicRegistrations, setPublicRegistrations] = useState([]);
  const [expandedPublicRegsId, setExpandedPublicRegsId] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // ---------- Réaménagement Événements (2026-09-30) : liste compacte +
  // fiche plein écran avec rubriques en onglets, à la demande de
  // l'utilisateur ("les cases sont très étroites... on peut facilement
  // faire des erreurs"). selectedEventId pilote l'affichage liste/fiche ;
  // activeTab pilote la rubrique affichée dans la fiche ; listFilter
  // pilote le sous-ensemble (à venir / passés) affiché dans la liste.
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [activeTab, setActiveTab] = useState("apercu");
  const [listFilter, setListFilter] = useState("avenir");
  // Formulaire de création replié par défaut (bouton "+ Nouvel événement"),
  // à la demande de l'utilisateur : ce formulaire fait partie de la même
  // réforme de design que la liste/fiche — plus compact au repos, en
  // grille à l'ouverture plutôt qu'empilé sur toute la hauteur de page.
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [scanningEventId, setScanningEventId] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [manualToken, setManualToken] = useState("");
  const [ticketEventId, setTicketEventId] = useState(null);
  const [linkCopiedId, setLinkCopiedId] = useState(null);
  const [expandedSessionsId, setExpandedSessionsId] = useState(null);
  const [newSession, setNewSession] = useState({ titre: "", date_debut: "", date_fin: "", lieu: "", description: "" });
  const [expandedVolunteerId, setExpandedVolunteerId] = useState(null);
  const [newVolunteerTask, setNewVolunteerTask] = useState({ titre: "", description: "", membres_requis: 1 });
  const [expandedCarpoolId, setExpandedCarpoolId] = useState(null);
  const [newCarpoolOffer, setNewCarpoolOffer] = useState({ places_disponibles: 1, point_depart: "", heure_depart: "", notes: "" });
  const [newCarpoolRequest, setNewCarpoolRequest] = useState({ notes: "" });
  const [loading, setLoading] = useState(true);
  const { t, lang } = useLang();
  // 2026-09-28 (suite 80) — devise réelle de l'association plutôt qu'un CAD
  // codé en dur (même correctif que Projets.jsx, oublié lors du chantier
  // devise de la suite 78 : le prix d'un événement s'affichait toujours en
  // CAD quelle que soit la devise configurée).
  const devise = association?.devise_monetaire || "CAD";

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: ev }, { data: rs }, { data: mem }, revResult, claimsResult, txResult,
      sessResult, waitResult, volTaskResult, volSignResult, carpoolOfferResult, carpoolRequestResult, refundResult,
      publicRegsResult,
    ] = await Promise.all([
      supabase.from("events").select("*").eq("association_id", profile.association_id).order("date_debut"),
      supabase.from("event_rsvps").select("*"),
      supabase.from("members").select("id,nom").order("nom"),
      supabase.from("event_reviews").select("*"),
      supabase.from("interac_payment_claims").select("*").eq("type", "billet_evenement"),
      supabase.from("payment_transactions").select("*").eq("type", "billet_evenement"),
      // Requêtes tolérantes : les tables ci-dessous n'existent qu'après
      // l'exécution de sql/2026-09-30_evenements_modernisation.sql — liste
      // vide en attendant plutôt que de faire échouer tout le module.
      supabase.from("event_sessions").select("*").order("ordre"),
      supabase.from("event_waitlist").select("*"),
      supabase.from("event_volunteer_tasks").select("*"),
      supabase.from("event_volunteer_signups").select("*"),
      supabase.from("event_carpool_offers").select("*").order("created_at", { ascending: false }),
      supabase.from("event_carpool_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("event_refund_queue").select("*"),
      // Inscriptions publiques (non-adhérents) — RLS réservée au Bureau,
      // un adhérent reçoit silencieusement une liste vide (aucune erreur).
      supabase.from("event_public_registrations").select("*").order("created_at", { ascending: false }),
    ]);
   setEvents(ev || []); setRsvps(rs || []); setMembers((mem || []).filter((m) => m.statut !== "Supprimé"));
    // Requête tolérante : n'existe qu'à partir de la suite 63 (2026-09-12) —
    // une liste vide en attendant l'exécution du script SQL plutôt que de
    // faire échouer le chargement de tout le module.
    setReviews(revResult?.error ? [] : (revResult?.data || []));
    // Preuves de virement Interac pour un billet d'événement (chantier
    // « application complète », 2026-09-28) — requête tolérante elle
    // aussi : la colonne event_id n'existe qu'après l'exécution du script
    // sql/2026-09-28g_billet_evenement.sql.
    setClaims(claimsResult?.error ? [] : (claimsResult?.data || []));
    // Idem : payment_transactions.event_id n'existe qu'après le script
    // sql/2026-09-28h_paiements_evenement_detail.sql (suite 90).
    setEventPayments(txResult?.error ? [] : (txResult?.data || []));
    setSessions(sessResult?.error ? [] : (sessResult?.data || []));
    setWaitlist(waitResult?.error ? [] : (waitResult?.data || []));
    setVolunteerTasks(volTaskResult?.error ? [] : (volTaskResult?.data || []));
    setVolunteerSignups(volSignResult?.error ? [] : (volSignResult?.data || []));
    setCarpoolOffers(carpoolOfferResult?.error ? [] : (carpoolOfferResult?.data || []));
    setCarpoolRequests(carpoolRequestResult?.error ? [] : (carpoolRequestResult?.data || []));
    setRefundQueue(refundResult?.error ? [] : (refundResult?.data || []));
    setPublicRegistrations(publicRegsResult?.error ? [] : (publicRegsResult?.data || []));
    setLoading(false);
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  // ---------- Avis sur un événement passé ----------
  // Suite 63 (2026-09-12), à la demande de l'utilisateur : « une option
  // d'avoir les avis », précisée (AskUserQuestion) comme des avis notés
  // sur les événements passés. Un seul avis par adhérent et par
  // événement (le soumettre à nouveau met à jour le précédent).
  const [reviewsEventId, setReviewsEventId] = useState(null);
  function eventReviews(eventId) { return reviews.filter((r) => r.event_id === eventId); }
  function myReview(eventId) { return reviews.find((r) => r.event_id === eventId && r.member_profile_id === profile.id); }
  function avgRating(eventId) {
    const rs = eventReviews(eventId);
    if (rs.length === 0) return null;
    return rs.reduce((s, r) => s + Number(r.note), 0) / rs.length;
  }
  async function submitReview(eventId, note, commentaire) {
    const existing = myReview(eventId);
    if (existing) {
      const { error } = await supabase.from("event_reviews").update({ note, commentaire, updated_at: new Date().toISOString() }).eq("id", existing.id);
      if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
      setReviews((prev) => prev.map((r) => (r.id === existing.id ? { ...r, note, commentaire } : r)));
    } else {
      const { data, error } = await supabase.from("event_reviews").insert({
        event_id: eventId, association_id: profile.association_id, member_profile_id: profile.id,
        member_nom: profile.nom_complet, note, commentaire,
      }).select().single();
      if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
      setReviews((prev) => [...prev, data]);
    }
  }
  async function deleteReview(reviewId) {
    if (!window.confirm(t("ev_confirm_delete_review"))) return;
    const { error } = await supabase.from("event_reviews").delete().eq("id", reviewId);
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
    setReviews((prev) => prev.filter((r) => r.id !== reviewId));
  }

  const [newEvent, setNewEvent] = useState({
    titre: "", description: "", lieu: "", date_debut: "", capacite_max: "", prix: "", lien_reunion: "",
    categorie: "", recurrence: "", prix_membre: "", check_in_actif: false, public_inscription: false,
  });
  async function createEvent() {
    if (!newEvent.titre.trim() || !newEvent.date_debut) return;
    if (!window.confirm(t("ev_confirm_create").replace("{titre}", newEvent.titre.trim()))) return;
    const { data, error } = await supabase.from("events").insert({
      association_id: profile.association_id, titre: newEvent.titre, description: newEvent.description, lieu: newEvent.lieu,
      date_debut: newEvent.date_debut, capacite_max: newEvent.capacite_max ? Number(newEvent.capacite_max) : null,
      prix: Number(newEvent.prix) || 0, lien_reunion: newEvent.lien_reunion.trim() || null,
      categorie: newEvent.categorie.trim() || null, recurrence: newEvent.recurrence || null,
      prix_membre: newEvent.prix_membre !== "" ? Number(newEvent.prix_membre) : null,
      check_in_actif: newEvent.check_in_actif, public_inscription: newEvent.public_inscription,
    }).select().single();
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
    setEvents((p) => [...p, data].sort((a, b) => a.date_debut.localeCompare(b.date_debut)));
    setNewEvent({
      titre: "", description: "", lieu: "", date_debut: "", capacite_max: "", prix: "", lien_reunion: "",
      categorie: "", recurrence: "", prix_membre: "", check_in_actif: false, public_inscription: false,
    });
    setShowCreateForm(false);
  }

  function eventRsvps(eventId) { return rsvps.filter((r) => r.event_id === eventId && r.statut === "confirme"); }
  function myRsvp(eventId) { return rsvps.find((r) => r.event_id === eventId && r.member_id === profile.member_id); }
  // Tarif effectif pour un adhérent : le tarif préférentiel (prix_membre)
  // s'il est défini, sinon le prix normal — voir events.prix_membre (2026-09-30).
  function effectiveMemberPrice(ev) { return ev.prix_membre != null ? Number(ev.prix_membre) : Number(ev.prix); }

  // ---------- Détail des paiements par événement (suite 90) ----------
  function eventPaymentFor(eventId, memberId) {
    return eventPayments.find((p) => p.event_id === eventId && p.member_id === memberId);
  }
  function myEventPayment(eventId) { return eventPaymentFor(eventId, profile.member_id); }
  // Statut affiché par adhérent dans le panneau Bureau : distingue un
  // paiement réellement tracé (payment_transactions) d'une place confirmée
  // SANS paiement enregistré — cas résiduel possible si un membre s'était
  // confirmé quand l'événement était encore gratuit, avant qu'un prix ne
  // lui soit ajouté (vécu en test le 2026-09-28) — plutôt que de l'afficher
  // silencieusement comme "payé".
  function memberFinanceStatus(eventId, memberId) {
    const rsvp = rsvps.find((r) => r.event_id === eventId && r.member_id === memberId);
    const payment = eventPaymentFor(eventId, memberId);
    if (payment) return "paid";
    if (rsvp?.statut === "confirme") return "untracked";
    if (rsvp?.statut === "decline") return "declined";
    return "none";
  }

  async function rsvpToEvent(eventId, statut) {
    if (!profile.member_id) return;
    const existing = myRsvp(eventId);
    if (existing) {
      const { error } = await supabase.from("event_rsvps").update({ statut }).eq("id", existing.id);
      if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
      setRsvps((prev) => prev.map((r) => (r.id === existing.id ? { ...r, statut } : r)));
    } else {
      const { data, error } = await supabase.from("event_rsvps").insert({
        event_id: eventId, association_id: profile.association_id, member_id: profile.member_id, statut,
      }).select().single();
      if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
      setRsvps((p) => [...p, data]);
    }
  }

  // ---------- Billet payant en ligne (chantier « application complète »,
  // 2026-09-28) ----------
  // Un événement à prix > 0 n'utilise PLUS rsvpToEvent() directement pour
  // se confirmer : la ligne event_rsvps n'est créée (statut "confirme")
  // qu'APRÈS un paiement réussi — par carte (webhook Stripe) ou par
  // confirmation d'une preuve Interac par le Bureau (confirmEventClaim
  // ci-dessous). Les événements gratuits (prix = 0) ne sont pas touchés :
  // rsvpToEvent() reste utilisée telle quelle pour eux.
  const [payingStripeId, setPayingStripeId] = useState(null);
  async function payEventStripe(ev) {
    setPayingStripeId(ev.id);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", { body: { type: "billet_evenement", event_id: ev.id } });
      if (error) throw error;
      if (data?.error) { alert(data.error); return; }
      if (data?.url) { window.location.href = data.url; return; }
      alert(t("ms_pay_online_error"));
    } catch (e) {
      alert(t("ms_pay_online_error") + " " + friendlyError(e, t));
    } finally {
      setPayingStripeId(null);
    }
  }

  // Preuve de virement Interac, scopée aux billets d'événement — même
  // mécanisme que submitInteracProof()/confirmInteracClaim() dans
  // App.jsx (suite 49-51), volontairement dupliqué ici en local plutôt
  // que partagé : App.jsx ne charge aujourd'hui ni events ni
  // event_rsvps, et ce module reste autonome comme Funeraire.jsx/
  // Sanctions.jsx/Projets.jsx. La confirmation par le Bureau se fait donc
  // directement dans l'onglet Événements, pas dans l'onglet générique
  // « Paiements Interac » de Mon espace.
  const [interacPanelId, setInteracPanelId] = useState(null);
  const [interacFile, setInteracFile] = useState(null);
  const [interacUploading, setInteracUploading] = useState(false);
  function myEventClaims(eventId) {
    return claims.filter((c) => c.member_id === profile.member_id && c.event_id === eventId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  function myPendingEventClaim(eventId) {
    return myEventClaims(eventId).find((c) => c.statut === "en_attente");
  }
  function pendingEventClaimsForBureau(eventId) {
    return claims.filter((c) => c.event_id === eventId && c.statut === "en_attente");
  }
  async function submitEventInteracProof(ev) {
    if (!interacFile || !profile.member_id) return;
    if (!window.confirm(t("ev_interac_confirm_submit").replace("{titre}", ev.titre))) return;
    setInteracUploading(true);
    try {
      const path = `${profile.association_id}/${profile.member_id}/${Date.now()}_${interacFile.name}`;
      const { error: uploadErr } = await supabase.storage.from("interac-proofs").upload(path, interacFile);
      if (uploadErr) throw uploadErr;
      const { data, error } = await supabase.from("interac_payment_claims").insert({
        association_id: profile.association_id, member_id: profile.member_id, type: "billet_evenement",
        montant: ev.prix, fichier_path: path, fichier_nom: interacFile.name, event_id: ev.id,
      }).select().single();
      if (error) throw error;
      setClaims((prev) => [data, ...prev]);
      setInteracFile(null);
      setInteracPanelId(null);
    } catch (e) {
      alert(t("ev_interac_submit_error") + " " + friendlyError(e, t));
    } finally {
      setInteracUploading(false);
    }
  }
  async function cancelEventClaim(claim) {
    if (!window.confirm(t("ms_cancel_confirm"))) return;
    const { data, error } = await supabase.from("interac_payment_claims").update({ statut: "annule" }).eq("id", claim.id).select().single();
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); return; }
    setClaims((prev) => prev.map((c) => (c.id === claim.id ? data : c)));
  }
  async function viewEventProof(claim) {
    const { data, error } = await supabase.storage.from("interac-proofs").createSignedUrl(claim.fichier_path, 60);
    if (!error && data) window.open(data.signedUrl, "_blank");
  }
  // Confirmation par le Bureau : applique le paiement (RSVP confirmée +
  // registre payment_transactions), exactement comme confirmInteracClaim
  // dans App.jsx pour les autres rubriques.
  async function confirmEventClaim(claim) {
    if (!isBureau) return;
    const ev = events.find((e) => e.id === claim.event_id);
    if (!ev) return;
    const nomMembre = members.find((m) => m.id === claim.member_id)?.nom || "—";
    if (!window.confirm(t("ev_interac_confirm_claim").replace("{nom}", nomMembre).replace("{titre}", ev.titre))) return;
    try {
      const existingRsvp = rsvps.find((r) => r.event_id === claim.event_id && r.member_id === claim.member_id);
      let rsvpRow;
      if (existingRsvp) {
        const { data, error } = await supabase.from("event_rsvps").update({ statut: "confirme" }).eq("id", existingRsvp.id).select().single();
        if (error) throw error;
        rsvpRow = data;
      } else {
        const { data, error } = await supabase.from("event_rsvps").insert({
          event_id: claim.event_id, association_id: profile.association_id, member_id: claim.member_id, statut: "confirme",
        }).select().single();
        if (error) throw error;
        rsvpRow = data;
      }
      setRsvps((prev) => (existingRsvp ? prev.map((r) => (r.id === rsvpRow.id ? rsvpRow : r)) : [...prev, rsvpRow]));

      const { data: updatedClaim, error: claimErr } = await supabase.from("interac_payment_claims").update({
        statut: "confirme", confirmed_at: new Date().toISOString(), confirmed_by: profile.id, montant_recu: claim.montant,
      }).eq("id", claim.id).select().single();
      if (claimErr) throw claimErr;
      setClaims((prev) => prev.map((c) => (c.id === claim.id ? updatedClaim : c)));

      const { data: txRow, error: txErr } = await supabase.from("payment_transactions").insert({
        association_id: profile.association_id, member_id: claim.member_id, type: "billet_evenement",
        periode: ev.titre, montant: claim.montant, methode: "interac", reference: claim.id, event_id: ev.id,
      }).select().single();
      if (txErr) console.error("Échec de l'écriture au registre des transactions :", txErr);
      else setEventPayments((prev) => [...prev, txRow]);
    } catch (e) {
      alert(t("ev_interac_claim_error") + " " + friendlyError(e, t));
    }
  }
  async function rejectEventClaim(claim) {
    if (!isBureau) return;
    const commentaire = window.prompt(t("interac_claims_reject_prompt")) || null;
    if (!window.confirm(t("ev_interac_confirm_reject"))) return;
    const { data, error } = await supabase.from("interac_payment_claims").update({
      statut: "rejete", confirmed_at: new Date().toISOString(), confirmed_by: profile.id, commentaire_bureau: commentaire,
    }).eq("id", claim.id).select().single();
    if (!error) setClaims((prev) => prev.map((c) => (c.id === claim.id ? data : c)));
  }

  // ---------- Modifier / Supprimer un événement ----------
  const [editingEvent, setEditingEvent] = useState(null);
  async function updateEvent(eventId, patch) {
    const { error } = await supabase.from("events").update(patch).eq("id", eventId);
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
    setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, ...patch } : e)));
  }
  async function deleteEvent(eventId) {
    if (!window.confirm(t("ev_confirm_delete_event"))) return;
    // Suppression en cascade : les inscriptions (RSVP) d'abord, puis l'événement lui-même.
    const { error: rsvpErr } = await supabase.from("event_rsvps").delete().eq("event_id", eventId);
    if (rsvpErr) { alert(t("ev_error_generic") + " " + friendlyError(rsvpErr, t)); console.error(rsvpErr); return; }
    const { error } = await supabase.from("events").delete().eq("id", eventId);
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
    setRsvps((prev) => prev.filter((r) => r.event_id !== eventId));
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
  }

  // ---------- Retirer un participant confirmé ----------
  async function removeRsvp(rsvpId) {
    if (!window.confirm(t("ev_confirm_remove_rsvp"))) return;
    const { error } = await supabase.from("event_rsvps").delete().eq("id", rsvpId);
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
    setRsvps((prev) => prev.filter((r) => r.id !== rsvpId));
  }

  // =====================================================================
  // Modernisation Événements (2026-09-30) — fonctions des nouveaux blocs
  // =====================================================================

  // ---------- Programme multi-sessions (agenda informatif) ----------
  function eventSessions(eventId) { return sessions.filter((s) => s.event_id === eventId); }
  async function addSession(eventId) {
    if (!newSession.titre.trim()) return;
    const { data, error } = await supabase.from("event_sessions").insert({
      association_id: profile.association_id, event_id: eventId, titre: newSession.titre.trim(),
      date_debut: newSession.date_debut || null, date_fin: newSession.date_fin || null,
      lieu: newSession.lieu.trim() || null, description: newSession.description.trim() || null,
      ordre: eventSessions(eventId).length,
    }).select().single();
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); return; }
    setSessions((p) => [...p, data]);
    setNewSession({ titre: "", date_debut: "", date_fin: "", lieu: "", description: "" });
  }
  async function deleteSession(sessionId) {
    if (!window.confirm(t("ev_session_delete_confirm"))) return;
    const { error } = await supabase.from("event_sessions").delete().eq("id", sessionId);
    if (!error) setSessions((p) => p.filter((s) => s.id !== sessionId));
  }

  // ---------- Récurrence : dupliquer pour la prochaine occurrence ----------
  async function duplicateEventOccurrence(ev) {
    const next = nextOccurrence(ev);
    if (!next) return;
    if (!window.confirm(t("ev_confirm_duplicate_recurrence").replace("{date}", new Date(next).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA")))) return;
    const { data, error } = await supabase.from("events").insert({
      association_id: profile.association_id, titre: ev.titre, description: ev.description, lieu: ev.lieu,
      date_debut: next, capacite_max: ev.capacite_max, prix: ev.prix, prix_membre: ev.prix_membre ?? null,
      lien_reunion: ev.lien_reunion, categorie: ev.categorie ?? null, recurrence: ev.recurrence ?? null,
    }).select().single();
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); return; }
    setEvents((p) => [...p, data].sort((a, b) => a.date_debut.localeCompare(b.date_debut)));
  }

  // ---------- Liste d'attente ----------
  function myWaitlistEntry(eventId) { return waitlist.find((w) => w.event_id === eventId && w.member_id === profile.member_id); }
  function eventWaitlist(eventId) { return waitlist.filter((w) => w.event_id === eventId).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); }
  async function joinWaitlist(ev) {
    if (!profile.member_id) return;
    const { data, error } = await supabase.from("event_waitlist").insert({
      event_id: ev.id, association_id: profile.association_id, member_id: profile.member_id,
    }).select().single();
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); return; }
    setWaitlist((p) => [...p, data]);
  }
  async function leaveWaitlist(entry) {
    const { error } = await supabase.from("event_waitlist").delete().eq("id", entry.id);
    if (!error) setWaitlist((p) => p.filter((w) => w.id !== entry.id));
  }

  // ---------- Billet / check-in à l'entrée ----------
  async function handleTicketScan(token) {
    if (!token) return;
    const { data, error } = await supabase.rpc("checkin_event_ticket", { p_token: token });
    if (error) { setScanResult({ status: "erreur" }); return; }
    const row = Array.isArray(data) ? data[0] : data;
    setScanResult(row);
    if (row?.status === "enregistre") {
      setRsvps((prev) => prev.map((r) => (r.billet_token === token ? { ...r, checkin_le: new Date().toISOString() } : r)));
    }
    setManualToken("");
  }

  // ---------- Annulation d'un événement (jamais de modification de
  // payment_transactions — voir annuler_evenement() côté SQL) ----------
  async function cancelEvent(ev) {
    if (!window.confirm(t("ev_confirm_cancel_event").replace("{titre}", ev.titre))) return;
    const { data, error } = await supabase.rpc("annuler_evenement", { p_event_id: ev.id });
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.status === "annule") {
      setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, annule: true } : e)));
      alert(t("ev_cancel_success").replace("{n}", String(row.nb_paiements_a_rembourser)));
      load();
    } else if (row?.status === "deja_annule") {
      alert(t("ev_cancel_already"));
    } else {
      alert(t("ev_error_generic"));
    }
  }
  function eventRefunds(eventId) { return refundQueue.filter((r) => r.event_id === eventId); }
  async function markRefundTraite(refund) {
    const { data, error } = await supabase.from("event_refund_queue").update({
      traite: true, traite_par: profile.id, traite_le: new Date().toISOString(),
    }).eq("id", refund.id).select().single();
    if (!error) setRefundQueue((prev) => prev.map((r) => (r.id === refund.id ? data : r)));
  }

  // ---------- Inscriptions publiques (non-adhérents) — voir
  // sql/2026-09-30d_evenements_inscriptions_publiques_checkin.sql ----------
  function eventPublicRegistrations(eventId) { return publicRegistrations.filter((r) => r.event_id === eventId); }
  async function updatePublicRegistrationStatut(reg, statut) {
    const { data, error } = await supabase.from("event_public_registrations").update({ statut }).eq("id", reg.id).select().single();
    if (!error) setPublicRegistrations((prev) => prev.map((r) => (r.id === reg.id ? data : r)));
  }
  async function checkinPublicRegistration(reg) {
    const { data, error } = await supabase.from("event_public_registrations").update({
      checkin_le: new Date().toISOString(), checkin_par: profile.id,
    }).eq("id", reg.id).select().single();
    if (!error) setPublicRegistrations((prev) => prev.map((r) => (r.id === reg.id ? data : r)));
  }
  function downloadPublicRegistrationsCsv(ev, regs) {
    const header = ["Nom", "Courriel", "Téléphone", "Nombre de personnes", "Message", "Statut", "Inscrit le", "Présent à l'entrée"];
    const rows = regs.map((r) => [
      r.nom, r.courriel, r.telephone || "", String(r.nb_personnes), r.message || "",
      t("ev_public_reg_status_" + r.statut), new Date(r.created_at).toLocaleString("fr-CA"),
      r.checkin_le ? new Date(r.checkin_le).toLocaleString("fr-CA") : "",
    ]);
    const csv = [...csvLegalHeaderLines(association), header, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${(ev.titre || "evenement").replace(/[^a-z0-9]+/gi, "_")}_inscriptions_publiques.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- Bénévolat lié à l'événement ----------
  function eventVolunteerTasks(eventId) { return volunteerTasks.filter((vt) => vt.event_id === eventId); }
  function taskSignups(taskId) { return volunteerSignups.filter((s) => s.task_id === taskId); }
  function myVolunteerSignup(taskId) { return volunteerSignups.find((s) => s.task_id === taskId && s.member_id === profile.member_id); }
  async function addVolunteerTask(eventId) {
    if (!newVolunteerTask.titre.trim()) return;
    const { data, error } = await supabase.from("event_volunteer_tasks").insert({
      association_id: profile.association_id, event_id: eventId, titre: newVolunteerTask.titre.trim(),
      description: newVolunteerTask.description.trim() || null, membres_requis: Number(newVolunteerTask.membres_requis) || 1,
    }).select().single();
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); return; }
    setVolunteerTasks((p) => [...p, data]);
    setNewVolunteerTask({ titre: "", description: "", membres_requis: 1 });
  }
  async function deleteVolunteerTask(taskId) {
    if (!window.confirm(t("ev_volunteer_task_delete_confirm"))) return;
    const { error } = await supabase.from("event_volunteer_tasks").delete().eq("id", taskId);
    if (!error) {
      setVolunteerTasks((p) => p.filter((vt) => vt.id !== taskId));
      setVolunteerSignups((p) => p.filter((s) => s.task_id !== taskId));
    }
  }
  async function volunteerForTask(taskId) {
    const { data, error } = await supabase.rpc("se_porter_volontaire_evenement", { p_task_id: taskId });
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.status === "inscrit") load();
    else if (row?.status === "complet") alert(t("ev_volunteer_full"));
    else alert(t("ev_volunteer_error"));
  }
  async function leaveVolunteerTask(signup) {
    const { error } = await supabase.from("event_volunteer_signups").delete().eq("id", signup.id);
    if (!error) setVolunteerSignups((p) => p.filter((s) => s.id !== signup.id));
  }

  // ---------- Covoiturage entre membres ----------
  function eventCarpoolOffers(eventId) { return carpoolOffers.filter((o) => o.event_id === eventId); }
  function eventCarpoolRequests(eventId) { return carpoolRequests.filter((r) => r.event_id === eventId); }
  async function addCarpoolOffer(eventId) {
    const { data, error } = await supabase.from("event_carpool_offers").insert({
      association_id: profile.association_id, event_id: eventId, member_id: profile.member_id, member_nom: profile.nom_complet,
      places_disponibles: Number(newCarpoolOffer.places_disponibles) || 1,
      point_depart: newCarpoolOffer.point_depart.trim() || null, heure_depart: newCarpoolOffer.heure_depart.trim() || null,
      notes: newCarpoolOffer.notes.trim() || null,
    }).select().single();
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); return; }
    setCarpoolOffers((p) => [data, ...p]);
    setNewCarpoolOffer({ places_disponibles: 1, point_depart: "", heure_depart: "", notes: "" });
  }
  async function deleteCarpoolOffer(id) {
    if (!window.confirm(t("ev_carpool_delete_confirm"))) return;
    const { error } = await supabase.from("event_carpool_offers").delete().eq("id", id);
    if (!error) setCarpoolOffers((p) => p.filter((o) => o.id !== id));
  }
  async function addCarpoolRequest(eventId) {
    const { data, error } = await supabase.from("event_carpool_requests").insert({
      association_id: profile.association_id, event_id: eventId, member_id: profile.member_id, member_nom: profile.nom_complet,
      notes: newCarpoolRequest.notes.trim() || null,
    }).select().single();
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); return; }
    setCarpoolRequests((p) => [data, ...p]);
    setNewCarpoolRequest({ notes: "" });
  }
  async function deleteCarpoolRequest(id) {
    if (!window.confirm(t("ev_carpool_delete_confirm"))) return;
    const { error } = await supabase.from("event_carpool_requests").delete().eq("id", id);
    if (!error) setCarpoolRequests((p) => p.filter((r) => r.id !== id));
  }
  async function expressCarpoolInterest(offer) {
    const message = window.prompt(t("ev_carpool_interest_prompt")) || null;
    const { error } = await supabase.rpc("signaler_interet_covoiturage", { p_offer_id: offer.id, p_message: message });
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); return; }
    alert(t("ev_carpool_interest_sent"));
  }

  // ---------- Export / bilan / sondage de satisfaction ----------
  async function generateBilanPdf(ev) {
    try {
      const confirmed = eventRsvps(ev.id);
      const revenue = eventPayments.filter((p) => p.event_id === ev.id).reduce((s, p) => s + Number(p.montant), 0);
      const avg = avgRating(ev.id);
      const doc = await buildEventBilanPdf({
        t, association, event: ev, confirmedCount: confirmed.length, revenue, avgRatingValue: avg,
        nbReviews: eventReviews(ev.id).length, volunteerCount: eventVolunteerTasks(ev.id).reduce((s, vt) => s + taskSignups(vt.id).length, 0), devise,
      });
      doc.save(`${(ev.titre || "evenement").replace(/[^a-z0-9]+/gi, "_")}_bilan.pdf`);
    } catch (e) {
      alert(t("rap_missing_deps"));
    }
  }
  async function createSatisfactionPoll(ev) {
    if (!window.confirm(t("ev_confirm_create_poll").replace("{titre}", ev.titre))) return;
    const question = t("ev_poll_default_question").replace("{titre}", ev.titre);
    const { data: poll, error } = await supabase.from("polls").insert({
      association_id: profile.association_id, question, created_by: profile.id, created_by_nom: profile.nom_complet,
    }).select().single();
    if (error) { alert(t("ev_error_generic") + " " + friendlyError(error, t)); return; }
    const optionLabels = [t("ev_poll_option_excellent"), t("ev_poll_option_bon"), t("ev_poll_option_moyen"), t("ev_poll_option_decevant")];
    const { error: optErr } = await supabase.from("poll_options").insert(
      optionLabels.map((texte, i) => ({ poll_id: poll.id, association_id: profile.association_id, texte, position: i }))
    );
    if (optErr) { alert(t("ev_error_generic") + " " + friendlyError(optErr, t)); return; }
    alert(t("ev_poll_created_success"));
  }
  function copyPublicLink(ev) {
    const url = `${window.location.origin}/?pub=${association?.slug_public}&evenement=${ev.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopiedId(ev.id);
      setTimeout(() => setLinkCopiedId(null), 2000);
    });
  }

  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  // ---------- Panneau « Détails financiers » (suite 90, dépliable sous
  // l'événement) : Bureau = tous les adhérents avec leur statut ; adhérent
  // = uniquement sa propre ligne (RLS payment_transactions le garantit
  // déjà côté serveur, ceci est la mise en forme côté client). ----------
  function renderFinancePanel(ev) {
    const methodLabel = (m) => (m === "stripe" ? t("ms_tx_method_stripe") : m === "interac" ? t("ms_tx_method_interac") : t("ms_tx_method_manuel"));
    const methodColors = (m) => (m === "stripe" ? { color: "var(--primary)", bg: "#EEF1F8" } : { color: TEAL, bg: TEAL_LIGHT });
    if (isBureau) {
      return (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, color: "var(--primary)", margin: "0 0 6px" }}>{t("ev_finance_panel_title")}</p>
          <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #EEE", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("member")}</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("ev_col_status")}</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("interac_claims_col_amount")}</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("ms_tx_detail_col_method")}</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("interac_claims_col_date")}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const status = memberFinanceStatus(ev.id, m.id);
                  const payment = eventPaymentFor(ev.id, m.id);
                  const label = status === "paid" ? t("ev_finance_status_paid")
                    : status === "untracked" ? t("ev_finance_status_untracked")
                    : status === "declined" ? t("ev_finance_status_declined")
                    : t("ev_finance_status_none");
                  const pillColor = status === "paid" ? TEAL : status === "declined" ? RED : status === "untracked" ? "#8A6D00" : "#686F7D";
                  const pillBg = status === "paid" ? TEAL_LIGHT : status === "declined" ? "#FBE4E1" : status === "untracked" ? "#FFF3CD" : "#F1F2F4";
                  return (
                    <tr key={m.id} style={{ borderTop: "1px solid #F0F0F0" }}>
                      <td style={{ padding: "6px 8px" }}>{m.nom}</td>
                      <td style={{ padding: "6px 8px" }}><Pill color={pillColor} bg={pillBg}>{label}</Pill></td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: payment ? 700 : 400 }}>{payment ? money(payment.montant, devise) : "—"}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>
                        {payment ? <Pill color={methodColors(payment.methode).color} bg={methodColors(payment.methode).bg}>{methodLabel(payment.methode)}</Pill> : "—"}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                        {payment ? new Date(payment.created_at).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    // Adhérent : uniquement son propre paiement, jamais celui des autres.
    const payment = myEventPayment(ev.id);
    return (
      <div style={{ marginTop: 8 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, color: "var(--primary)", margin: "0 0 6px" }}>{t("ev_finance_my_title")}</p>
        {payment ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 12 }}>
            <span style={{ fontWeight: 700 }}>{money(payment.montant, devise)}</span>
            <Pill color={methodColors(payment.methode).color} bg={methodColors(payment.methode).bg}>{methodLabel(payment.methode)}</Pill>
            <span style={{ color: "#5B6270" }}>{new Date(payment.created_at).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA")}</span>
            {payment.numero_recu != null && (
              <span style={{ color: "#686F7D", fontSize: 11 }}>{t("ms_receipt_number_label")} {String(payment.numero_recu).padStart(6, "0")}</span>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: "#686F7D", fontStyle: "italic", margin: 0 }}>{t("ev_finance_my_none")}</p>
        )}
      </div>
    );
  }

  const now = new Date();
  const categories = [...new Set(events.map((e) => e.categorie).filter(Boolean))];
  function matchesFilter(ev) {
    if (categoryFilter && ev.categorie !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = foldText(searchQuery);
      if (!foldText(ev.titre || "").includes(q) && !foldText(ev.lieu || "").includes(q) && !foldText(ev.description || "").includes(q)) return false;
    }
    return true;
  }
  const upcoming = events.filter((e) => new Date(e.date_debut) >= now && matchesFilter(e));
  const past = events.filter((e) => new Date(e.date_debut) < now && matchesFilter(e));

  // ---------- Réaménagement Événements (2026-09-30) : libellés bilingues
  // pour les nouveaux éléments d'interface (onglets, filtre liste) qui
  // n'avaient pas encore de clé t() dédiée — même patron que les dates
  // locales (lang === "en" ? "en-CA" : "fr-CA") déjà utilisé ailleurs
  // dans ce fichier, plutôt que d'inventer des clés de traduction sans
  // les ajouter au dictionnaire.
  const L = lang === "en" ? {
    apercu: "Overview", programme: "Program", participants: "Participants", billetterie: "Ticketing",
    benevolat: "Volunteering", covoiturage: "Carpooling", public: "Public registrations",
    presences: "Check-in", avis: "Reviews", back: "Back to events list", upcoming: "Upcoming", past: "Past",
  } : {
    apercu: "Aperçu", programme: "Programme", participants: "Participants", billetterie: "Billetterie",
    benevolat: "Bénévolat", covoiturage: "Covoiturage", public: "Inscriptions publiques",
    presences: "Présences", avis: "Avis", back: "Retour à la liste des événements", upcoming: "À venir", past: "Passés",
  };

  const selectedEvent = selectedEventId ? events.find((e) => e.id === selectedEventId) : null;
  if (selectedEvent) return renderEventDetail(selectedEvent);

  // =====================================================================
  // Fiche plein écran d'un événement — réaménagement 2026-09-30, à la
  // demande de l'utilisateur (voir claude/evenements-modernisation-
  // proposition.md pour le prototype validé) : au lieu de cases étroites
  // empilées, un clic sur un événement ouvre une page entière avec les
  // rubriques (Aperçu, Programme, Participants, ...) présentées en
  // onglets. Toute la logique métier ci-dessus (handlers, requêtes) est
  // réutilisée telle quelle ; seule la présentation change.
  // =====================================================================
  function renderEventDetail(ev) {
    const confirmed = eventRsvps(ev.id);
    const mine = myRsvp(ev.id);
    const full = ev.capacite_max && confirmed.length >= ev.capacite_max;
    const isPastEvent = new Date(ev.date_debut) < now;
    const avg = avgRating(ev.id);
    const nbReviews = eventReviews(ev.id).length;
    const revenue = eventPayments.filter((p) => p.event_id === ev.id).reduce((s, p) => s + Number(p.montant), 0);

    const tabs = [
      { key: "apercu", label: L.apercu, show: true },
      { key: "programme", label: L.programme, show: eventSessions(ev.id).length > 0 || isBureau },
      { key: "participants", label: L.participants, show: isBureau },
      { key: "billetterie", label: L.billetterie, show: ev.prix > 0 },
      { key: "benevolat", label: L.benevolat, show: eventVolunteerTasks(ev.id).length > 0 || isBureau },
      { key: "covoiturage", label: L.covoiturage, show: !!profile.member_id },
      { key: "public", label: L.public, show: isBureau && ev.public_inscription },
      { key: "presences", label: L.presences, show: isBureau },
      { key: "avis", label: L.avis, show: isPastEvent },
    ].filter((tb) => tb.show);
    const currentTab = tabs.some((tb) => tb.key === activeTab) ? activeTab : "apercu";

    return (
      <Container><Section>
        <div style={{ position: "relative", overflow: "hidden", background: `linear-gradient(135deg,#152541 0%,${NAVY} 46%,${TEAL} 100%)`, padding: "28px 0 70px", borderRadius: 18, marginBottom: 0 }}>
          <div style={{ position: "absolute", top: -120, right: -60, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle, rgba(46,139,116,.22), transparent 70%)" }} />
          <div style={{ position: "absolute", bottom: -160, left: "10%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,206,122,.22), transparent 70%)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: `linear-gradient(90deg,transparent,${GOLD_LIGHT} 50%,transparent)` }} />
          <div style={{ position: "relative", padding: "0 28px", display: "flex", flexDirection: "column", gap: 16 }}>
            <button onClick={() => { setSelectedEventId(null); setActiveTab("apercu"); }} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.72)", fontSize: 13.5, fontWeight: 600, padding: 0, alignSelf: "flex-start" }}>
              <ChevronDown size={14} style={{ transform: "rotate(90deg)" }} /> {L.back}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {ev.annule && <Pill color="#fff" bg="rgba(255,255,255,.16)">{t("ev_annule_pill")}</Pill>}
                  {ev.categorie && <Pill color="#fff" bg="rgba(255,255,255,.16)">{ev.categorie}</Pill>}
                  {!ev.annule && full && <Pill color={NAVY} bg={GOLD_LIGHT}>{t("ev_full")}</Pill>}
                </div>
                <h1 style={{ margin: 0, fontFamily: "Poppins, sans-serif", fontWeight: 800, fontSize: 28, color: "#fff", lineHeight: 1.16 }}>{ev.titre}</h1>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "rgba(255,255,255,.78)" }}>
                  <span>📅 {new Date(ev.date_debut).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</span>
                  {ev.lieu && <span>📍 {ev.lieu}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                <button onClick={() => downloadEventIcs(ev, t("ev_join_meeting_btn"))} title={t("ev_add_to_calendar_btn")} style={HERO_ICON_BTN}><Download size={13} /></button>
                <a href={whatsappShareUrl(eventShareText(ev, t, lang, t("ev_join_meeting_btn")))} target="_blank" rel="noreferrer" title={t("whatsapp_share_btn")} style={{ ...HERO_ICON_BTN, textDecoration: "none", borderColor: "rgba(37,211,102,.6)" }}><MessageCircle size={13} /></a>
                {isBureau && ev.recurrence && (
                  <button onClick={() => duplicateEventOccurrence(ev)} title={t("ev_duplicate_recurrence_btn")} style={HERO_ICON_BTN}><Repeat size={13} /></button>
                )}
                {isBureau && !ev.annule && (
                  <button onClick={() => cancelEvent(ev)} title={t("ev_cancel_btn")} style={{ ...HERO_ICON_BTN, borderColor: GOLD_LIGHT, color: GOLD_LIGHT }}><Ban size={13} /></button>
                )}
                {isBureau && (
                  <>
                    <button onClick={() => setEditingEvent(ev)} title={t("ev_edit_btn")} style={HERO_ICON_BTN}><Pencil size={13} /></button>
                    <button onClick={() => deleteEvent(ev.id)} title={t("ev_delete_btn")} style={{ ...HERO_ICON_BTN, borderColor: "#E8746B", color: "#E8746B" }}><Trash2 size={13} /></button>
                  </>
                )}
                {isBureau && isPastEvent && (
                  <>
                    <button onClick={() => downloadParticipantsCsv(ev, confirmed, members, association)} title={t("ev_export_participants_btn")} style={HERO_ICON_BTN}><FileDown size={13} /></button>
                    <button onClick={() => generateBilanPdf(ev)} title={t("ev_bilan_pdf_btn")} style={HERO_ICON_BTN}><ClipboardCheck size={13} /></button>
                    <button onClick={() => createSatisfactionPoll(ev)} title={t("ev_poll_create_btn")} style={HERO_ICON_BTN}><MessageCircle size={13} /></button>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 14, padding: "14px 20px", minWidth: 140 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", color: "rgba(255,255,255,.55)", marginBottom: 4 }}>{t("ev_col_participants").toUpperCase()}</div>
                <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 19, color: "#fff" }}>{confirmed.length}{ev.capacite_max ? ` / ${ev.capacite_max}` : ""}</div>
              </div>
              {ev.prix > 0 && (
                <div style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 14, padding: "14px 20px", minWidth: 140 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", color: "rgba(255,255,255,.55)", marginBottom: 4 }}>{t("interac_claims_col_amount").toUpperCase()}</div>
                  <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 19, color: "#E4F2EE" }}>{money(revenue, devise)}</div>
                </div>
              )}
              {isPastEvent && avg != null && (
                <div style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 14, padding: "14px 20px", minWidth: 140 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", color: "rgba(255,255,255,.55)", marginBottom: 4 }}>{t("ev_col_reviews").toUpperCase()}</div>
                  <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 19, color: GOLD_LIGHT }}>{avg.toFixed(1)} / 5</div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: "0 4px", marginTop: -26, position: "relative", display: "flex", flexDirection: "column", gap: 26 }}>
          <Card style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: 10 }}>
            {tabs.map((tb) => (
              <button key={tb.key} onClick={() => setActiveTab(tb.key)} style={tabBtnStyle(currentTab === tb.key)}>{tb.label}</button>
            ))}
          </Card>

          {currentTab === "apercu" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 920 }}>
              {ev.description && (
                <Card style={{ padding: "20px 24px", borderLeft: `3px solid ${AMBER}` }}>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "#4A4740" }}>{ev.description}</p>
                </Card>
              )}
              {ev.lien_reunion && (
                <a href={ev.lien_reunion} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: TEAL, fontWeight: 600, textDecoration: "none", alignSelf: "flex-start" }}>
                  <Video size={14} /> {t("ev_join_meeting_btn")}
                </a>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
                <Card style={{ padding: "14px 16px" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: "rgba(42,42,42,.42)", marginBottom: 5 }}>{t("ev_col_participants").toUpperCase()}</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{confirmed.length}{ev.capacite_max ? ` / ${ev.capacite_max}` : ""}</div>
                </Card>
                {ev.prix > 0 && (
                  <Card style={{ padding: "14px 16px" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: "rgba(42,42,42,.42)", marginBottom: 5 }}>{t("ev_price").toUpperCase()}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: TEAL }}>{money(ev.prix, devise)}</div>
                    {ev.prix_membre != null && Number(ev.prix_membre) !== Number(ev.prix) && (
                      <div style={{ fontSize: 11, color: "rgba(42,42,42,.5)", marginTop: 3 }}>{t("ev_price_for_member")} : {money(ev.prix_membre, devise)}</div>
                    )}
                  </Card>
                )}
                {ev.categorie && (
                  <Card style={{ padding: "14px 16px" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: "rgba(42,42,42,.42)", marginBottom: 5 }}>{t("ev_category_label").toUpperCase()}</div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{ev.categorie}</div>
                  </Card>
                )}
              </div>

              {profile.role === "adherent" && ev.prix > 0 && mine?.statut !== "confirme" ? (
                (() => {
                  const pending = myPendingEventClaim(ev.id);
                  if (pending) {
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11.5, background: "#FFF3CD", color: "#8A6D00", borderRadius: 999, padding: "3px 10px", fontWeight: 600 }}>{t("ev_interac_pending_badge")}</span>
                        <button onClick={() => viewEventProof(pending)} style={{ background: "none", border: "none", color: TEAL, cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>{t("ms_menu_view_proof")}</button>
                        <button onClick={() => cancelEventClaim(pending)} style={{ background: "none", border: "none", color: RED, cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>{t("ms_menu_cancel_pending")}</button>
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", gap: 10 }}>
                        <Btn onClick={() => payEventStripe(ev)} disabled={full || payingStripeId === ev.id}>
                          <CreditCard size={14} /> {payingStripeId === ev.id ? t("ms_pay_online_loading") : full ? t("ev_full") : t("ev_pay_card_btn")}
                        </Btn>
                        {!full && (
                          <Btn variant="outline" onClick={() => setInteracPanelId(interacPanelId === ev.id ? null : ev.id)}>{t("ev_pay_interac_btn")}</Btn>
                        )}
                      </div>
                      {interacPanelId === ev.id && (
                        <Card style={{ padding: 14 }}>
                          <p style={{ fontSize: 12, color: "#5B6270", margin: "0 0 8px" }}>{t("ev_interac_help").replace("{montant}", money(ev.prix, devise))}</p>
                          <input type="file" accept="image/*,.pdf" onChange={(e) => setInteracFile(e.target.files?.[0] || null)} style={{ fontSize: 12, marginBottom: 8, display: "block" }} />
                          <Btn onClick={() => submitEventInteracProof(ev)} disabled={!interacFile || interacUploading}>{interacUploading ? t("ms_pay_online_loading") : t("ev_interac_submit_btn")}</Btn>
                        </Card>
                      )}
                    </div>
                  );
                })()
              ) : profile.role === "adherent" && (
                <div style={{ display: "flex", gap: 10 }}>
                  <Btn onClick={() => { if (!window.confirm(t("ev_confirm_rsvp_yes").replace("{titre}", ev.titre))) return; rsvpToEvent(ev.id, "confirme"); }} disabled={full && mine?.statut !== "confirme"} style={{ background: mine?.statut === "confirme" ? TEAL : undefined, color: mine?.statut === "confirme" ? "white" : undefined }}>
                    {mine?.statut === "confirme" ? t("ev_confirmed_check") : full ? t("ev_full") : t("ev_participate")}
                  </Btn>
                  <Btn variant="outline" onClick={() => { if (!window.confirm(t("ev_confirm_rsvp_no").replace("{titre}", ev.titre))) return; rsvpToEvent(ev.id, "decline"); }}>{t("ev_decline")}</Btn>
                </div>
              )}

              {profile.role === "adherent" && full && (() => {
                const mineWait = myWaitlistEntry(ev.id);
                const wl = eventWaitlist(ev.id);
                return mineWait ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11.5, background: "#EAEDF6", color: "#5B6B94", borderRadius: 999, padding: "3px 10px", fontWeight: 600 }}>
                      {t("ev_waitlist_position").replace("{n}", String(wl.findIndex((w) => w.id === mineWait.id) + 1))}
                    </span>
                    <button onClick={() => leaveWaitlist(mineWait)} style={{ background: "none", border: "none", color: RED, cursor: "pointer", fontSize: 11.5, padding: 0, textDecoration: "underline" }}>{t("ev_waitlist_leave_btn")}</button>
                  </div>
                ) : (
                  <Btn variant="outline" onClick={() => joinWaitlist(ev)} style={{ alignSelf: "flex-start" }}>{t("ev_waitlist_join_btn")}</Btn>
                );
              })()}

              {profile.role === "adherent" && mine?.statut === "confirme" && (
                <button onClick={() => setTicketEventId(ev.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "1px solid rgba(42,42,42,.14)", borderRadius: 999, padding: "8px 16px", cursor: "pointer", color: TEAL, fontSize: 13, fontWeight: 600, alignSelf: "flex-start" }}>
                  <QrCode size={14} /> {t("ev_ticket_btn")}
                </button>
              )}

              {ev.public_inscription && association?.vitrine_active && association?.slug_public && (
                <button onClick={() => copyPublicLink(ev)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: TEAL, fontSize: 12.5, fontWeight: 600, padding: 0, alignSelf: "flex-start" }}>
                  <Link2 size={14} /> {linkCopiedId === ev.id ? t("ev_public_link_copied") : t("ev_public_link_copy_btn")}
                </button>
              )}
            </div>
          )}

          {currentTab === "programme" && (
            <Card style={{ padding: "6px 26px", maxWidth: 820 }}>
              {eventSessions(ev.id).length === 0 && <p style={{ fontSize: 13, color: "#686F7D", fontStyle: "italic", padding: "14px 0" }}>{t("ev_sessions_empty")}</p>}
              {eventSessions(ev.id).map((s) => (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "16px 0", borderBottom: "1px solid rgba(42,42,42,.07)", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{s.titre}</div>
                    {s.date_debut && <div style={{ fontSize: 12, color: "rgba(42,42,42,.5)", marginTop: 2 }}>{new Date(s.date_debut).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}{s.lieu ? ` · ${s.lieu}` : ""}</div>}
                    {s.description && <div style={{ fontSize: 12.5, color: "rgba(42,42,42,.65)", marginTop: 4 }}>{s.description}</div>}
                  </div>
                  {isBureau && (
                    <button onClick={() => deleteSession(s.id)} style={{ background: "none", border: "none", color: RED, cursor: "pointer", padding: 0, flexShrink: 0, display: "flex" }}><Trash2 size={13} /></button>
                  )}
                </div>
              ))}
              {isBureau && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px 0" }}>
                  <input placeholder={t("ev_session_title_placeholder")} style={inputStyle} value={newSession.titre} onChange={(e) => setNewSession({ ...newSession, titre: e.target.value })} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="datetime-local" style={inputStyle} value={newSession.date_debut} onChange={(e) => setNewSession({ ...newSession, date_debut: e.target.value })} />
                    <input placeholder={t("ev_session_location_placeholder")} style={inputStyle} value={newSession.lieu} onChange={(e) => setNewSession({ ...newSession, lieu: e.target.value })} />
                  </div>
                  <Btn onClick={() => addSession(ev.id)} style={{ alignSelf: "flex-start" }}><Plus size={13} /> {t("ev_session_add_btn")}</Btn>
                </div>
              )}
            </Card>
          )}

          {currentTab === "participants" && isBureau && (
            <Table head={[t("member"), t("ev_col_status"), t("ev_col_actions")]}>
              {confirmed.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{members.find((m) => m.id === r.member_id)?.nom}</td>
                  <td style={td}>{r.statut}</td>
                  <td style={td}>
                    <button onClick={() => removeRsvp(r.id)} title={t("ev_remove_participant_btn")} style={{ width: 20, height: 20, borderRadius: "50%", background: "none", border: `1px solid ${RED}`, color: RED, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                      <X size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          )}

          {currentTab === "billetterie" && ev.prix > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {isBureau && pendingEventClaimsForBureau(ev.id).length > 0 && (
                <div>
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: "#8A6D00", margin: "0 0 8px" }}>{t("ev_interac_claims_title")}</p>
                  {pendingEventClaimsForBureau(ev.id).map((c) => (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13, marginBottom: 8, flexWrap: "wrap" }}>
                      <span>{members.find((m) => m.id === c.member_id)?.nom || "—"} · {money(c.montant, devise)}</span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button onClick={() => viewEventProof(c)} title={t("ms_menu_view_proof")} style={{ background: "none", border: "none", color: TEAL, cursor: "pointer", padding: 0, display: "flex" }}><Eye size={14} /></button>
                        <button onClick={() => confirmEventClaim(c)} style={{ fontSize: 12, fontWeight: 600, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "4px 12px", cursor: "pointer" }}>{t("interac_claims_confirm_btn")}</button>
                        <button onClick={() => rejectEventClaim(c)} style={{ fontSize: 12, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "4px 12px", cursor: "pointer" }}>{t("interac_claims_reject_btn")}</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {isBureau && ev.annule && eventRefunds(ev.id).length > 0 && (
                <div>
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: AMBER, margin: "0 0 8px" }}>{t("ev_refund_queue_title")}</p>
                  {eventRefunds(ev.id).map((r) => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13, marginBottom: 8, flexWrap: "wrap" }}>
                      <span>{r.member_nom || "—"} · {money(r.montant, devise)}</span>
                      {r.traite ? <Pill color={TEAL} bg={TEAL_LIGHT}>{t("ev_refund_done_pill")}</Pill> : (
                        <button onClick={() => markRefundTraite(r)} style={{ fontSize: 12, fontWeight: 600, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "4px 12px", cursor: "pointer" }}>{t("ev_refund_mark_done_btn")}</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Card style={{ padding: 20 }}>{renderFinancePanel(ev)}</Card>
            </div>
          )}

          {currentTab === "benevolat" && (
            <div>
              {eventVolunteerTasks(ev.id).length === 0 && <p style={{ fontSize: 13, color: "#686F7D", fontStyle: "italic" }}>{t("ev_volunteer_empty")}</p>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14 }}>
                {eventVolunteerTasks(ev.id).map((task) => {
                  const signups = taskSignups(task.id);
                  const mineSignup = myVolunteerSignup(task.id);
                  const taskFull = signups.length >= task.membres_requis;
                  return (
                    <Card key={task.id} style={{ padding: 18 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{task.titre} <span style={{ color: "#9AA2B5", fontWeight: 400 }}>({signups.length}/{task.membres_requis})</span></div>
                          {task.description && <div style={{ fontSize: 12, color: "#5B6270", marginTop: 4 }}>{task.description}</div>}
                          {signups.length > 0 && <div style={{ fontSize: 11.5, color: "#5B6270", marginTop: 4 }}>{signups.map((s) => members.find((m) => m.id === s.member_id)?.nom).filter(Boolean).join(", ")}</div>}
                        </div>
                        {isBureau && (
                          <button onClick={() => deleteVolunteerTask(task.id)} style={{ background: "none", border: "none", color: RED, cursor: "pointer", padding: 0, flexShrink: 0, display: "flex" }}><Trash2 size={13} /></button>
                        )}
                      </div>
                      {profile.member_id && !mineSignup && !taskFull && (
                        <button onClick={() => volunteerForTask(task.id)} style={{ marginTop: 8, background: "none", border: "none", color: TEAL, cursor: "pointer", fontSize: 12, padding: 0, fontWeight: 600 }}>{t("ev_volunteer_signup_btn")}</button>
                      )}
                      {mineSignup && (
                        <button onClick={() => leaveVolunteerTask(mineSignup)} style={{ marginTop: 8, background: "none", border: "none", color: RED, cursor: "pointer", fontSize: 12, padding: 0 }}>{t("ev_volunteer_leave_btn")}</button>
                      )}
                    </Card>
                  );
                })}
              </div>
              {isBureau && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16, maxWidth: 480 }}>
                  <input placeholder={t("ev_volunteer_task_title_placeholder")} style={inputStyle} value={newVolunteerTask.titre} onChange={(e) => setNewVolunteerTask({ ...newVolunteerTask, titre: e.target.value })} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <input placeholder={t("ev_volunteer_task_desc_placeholder")} style={{ ...inputStyle, flex: 1 }} value={newVolunteerTask.description} onChange={(e) => setNewVolunteerTask({ ...newVolunteerTask, description: e.target.value })} />
                    <input type="number" min={1} style={{ ...inputStyle, width: 80 }} value={newVolunteerTask.membres_requis} onChange={(e) => setNewVolunteerTask({ ...newVolunteerTask, membres_requis: e.target.value })} />
                  </div>
                  <Btn onClick={() => addVolunteerTask(ev.id)} style={{ alignSelf: "flex-start" }}><Plus size={13} /> {t("ev_volunteer_task_add_btn")}</Btn>
                </div>
              )}
            </div>
          )}

          {currentTab === "covoiturage" && profile.member_id && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
              <div>
                <h3 style={{ fontSize: 14, margin: "0 0 12px" }}>{t("ev_carpool_offers_title")}</h3>
                {eventCarpoolOffers(ev.id).length === 0 && <p style={{ fontSize: 12.5, color: "#686F7D", fontStyle: "italic" }}>{t("ev_carpool_offers_empty")}</p>}
                {eventCarpoolOffers(ev.id).map((o) => (
                  <Card key={o.id} style={{ padding: 14, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{o.member_nom} — {o.places_disponibles} {t("ev_volunteer_members_required")}</div>
                      <div style={{ fontSize: 12, color: "#5B6270" }}>{[o.point_depart, o.heure_depart].filter(Boolean).join(" · ")}</div>
                      {o.notes && <div style={{ fontSize: 11.5, color: "#5B6270", marginTop: 2 }}>{o.notes}</div>}
                    </div>
                    {o.member_id === profile.member_id ? (
                      <button onClick={() => deleteCarpoolOffer(o.id)} style={{ background: "none", border: "none", color: RED, cursor: "pointer", padding: 0, flexShrink: 0, display: "flex" }}><Trash2 size={13} /></button>
                    ) : (
                      <button onClick={() => expressCarpoolInterest(o)} style={{ background: "none", border: "none", color: TEAL, cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0, whiteSpace: "nowrap" }}>{t("ev_carpool_interest_btn")}</button>
                    )}
                  </Card>
                ))}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="number" min={1} style={{ ...inputStyle, width: 80 }} value={newCarpoolOffer.places_disponibles} onChange={(e) => setNewCarpoolOffer({ ...newCarpoolOffer, places_disponibles: e.target.value })} title={t("ev_carpool_offer_places_label")} />
                    <input placeholder={t("ev_carpool_offer_depart_placeholder")} style={{ ...inputStyle, flex: 1 }} value={newCarpoolOffer.point_depart} onChange={(e) => setNewCarpoolOffer({ ...newCarpoolOffer, point_depart: e.target.value })} />
                    <input placeholder={t("ev_carpool_offer_heure_placeholder")} style={{ ...inputStyle, width: 120 }} value={newCarpoolOffer.heure_depart} onChange={(e) => setNewCarpoolOffer({ ...newCarpoolOffer, heure_depart: e.target.value })} />
                  </div>
                  <Btn onClick={() => addCarpoolOffer(ev.id)} style={{ alignSelf: "flex-start" }}><Plus size={13} /> {t("ev_carpool_offer_add_btn")}</Btn>
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: 14, margin: "0 0 12px" }}>{t("ev_carpool_requests_title")}</h3>
                {eventCarpoolRequests(ev.id).length === 0 && <p style={{ fontSize: 12.5, color: "#686F7D", fontStyle: "italic" }}>{t("ev_carpool_requests_empty")}</p>}
                {eventCarpoolRequests(ev.id).map((r) => (
                  <Card key={r.id} style={{ padding: 14, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{r.member_nom}</div>
                      {r.notes && <div style={{ fontSize: 12, color: "#5B6270" }}>{r.notes}</div>}
                    </div>
                    {r.member_id === profile.member_id && (
                      <button onClick={() => deleteCarpoolRequest(r.id)} style={{ background: "none", border: "none", color: RED, cursor: "pointer", padding: 0, flexShrink: 0, display: "flex" }}><Trash2 size={13} /></button>
                    )}
                  </Card>
                ))}
                {!eventCarpoolRequests(ev.id).some((r) => r.member_id === profile.member_id) && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input placeholder={t("ev_carpool_request_notes_placeholder")} style={{ ...inputStyle, flex: 1 }} value={newCarpoolRequest.notes} onChange={(e) => setNewCarpoolRequest({ notes: e.target.value })} />
                    <Btn onClick={() => addCarpoolRequest(ev.id)}>{t("ev_carpool_request_add_btn")}</Btn>
                  </div>
                )}
              </div>
            </div>
          )}

          {currentTab === "public" && isBureau && ev.public_inscription && (() => {
            const regs = eventPublicRegistrations(ev.id);
            const totalPeople = regs.filter((r) => r.statut !== "annulee").reduce((s, r) => s + (Number(r.nb_personnes) || 1), 0);
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {regs.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#686F7D", fontStyle: "italic" }}>{t("ev_public_regs_empty")}</p>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#5B6270" }}>{t("ev_public_regs_total_people").replace("{n}", String(totalPeople))}</span>
                      <button onClick={() => downloadPublicRegistrationsCsv(ev, regs)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "1px solid rgba(42,42,42,.14)", borderRadius: 999, padding: "6px 14px", cursor: "pointer", color: TEAL, fontSize: 12.5 }}>
                        <FileDown size={13} /> {t("ev_public_regs_export_btn")}
                      </button>
                    </div>
                    <Table head={[t("member"), t("ev_public_reg_col_contact"), t("ev_public_reg_col_people"), t("ev_col_status"), ""]}>
                      {regs.map((r) => (
                        <tr key={r.id}>
                          <td style={td}>{r.nom}{r.message && <div style={{ fontSize: 11, color: "#9AA2B5", marginTop: 2 }}>{r.message}</div>}</td>
                          <td style={td}>{r.courriel}{r.telephone && <div style={{ color: "#9AA2B5" }}>{r.telephone}</div>}</td>
                          <td style={td}>{r.nb_personnes}</td>
                          <td style={td}>
                            <select value={r.statut} onChange={(e) => updatePublicRegistrationStatut(r, e.target.value)} style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid #DDD" }}>
                              <option value="en_attente">{t("ev_public_reg_status_en_attente")}</option>
                              <option value="contacte">{t("ev_public_reg_status_contacte")}</option>
                              <option value="annulee">{t("ev_public_reg_status_annulee")}</option>
                            </select>
                          </td>
                          <td style={td}>
                            {r.checkin_le ? (
                              <Pill color={TEAL} bg={TEAL_LIGHT}>{t("ev_public_reg_checked_in")}</Pill>
                            ) : (
                              <button onClick={() => checkinPublicRegistration(r)} style={{ fontSize: 11.5, fontWeight: 600, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "3px 10px", cursor: "pointer" }}>{t("ev_public_reg_checkin_btn")}</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  </>
                )}
              </div>
            );
          })()}

          {currentTab === "presences" && isBureau && (
            <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 24 }}>
              <Card style={{ padding: 20 }}>
                <EventQrScanner active={true} onDecode={handleTicketScan} t={t} />
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <input placeholder={t("ev_checkin_manual_placeholder")} style={{ ...inputStyle, flex: 1 }} value={manualToken} onChange={(e) => setManualToken(e.target.value)} />
                  <Btn onClick={() => handleTicketScan(manualToken)}>{t("ev_checkin_manual_btn")}</Btn>
                </div>
                {scanResult && (
                  <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, padding: "8px 12px", borderRadius: 8, background: scanResult.status === "enregistre" ? TEAL_LIGHT : scanResult.status === "deja_valide" ? "#FFF3CD" : "#FBE4E1", color: scanResult.status === "enregistre" ? TEAL : scanResult.status === "deja_valide" ? "#8A6D00" : RED }}>
                    {t("ev_checkin_status_" + scanResult.status)}{scanResult.member_nom ? ` — ${scanResult.member_nom}` : ""}
                  </div>
                )}
              </Card>
              <Table head={[t("member"), t("interac_claims_col_date")]}>
                {confirmed.filter((r) => r.checkin_le).map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{members.find((m) => m.id === r.member_id)?.nom}</td>
                    <td style={td}>{new Date(r.checkin_le).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}

          {currentTab === "avis" && isPastEvent && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {avg != null ? (
                  <>
                    <span style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 32, color: AMBER }}>{avg.toFixed(1)}</span>
                    <div>
                      <div style={{ display: "flex", gap: 2 }}>
                        {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={16} fill={n <= Math.round(avg) ? STAR_COLOR : "none"} color={n <= Math.round(avg) ? STAR_COLOR : "#BBB"} />)}
                      </div>
                      <span style={{ fontSize: 12.5, color: "rgba(42,42,42,.5)" }}>{t("ev_col_reviews")} · {nbReviews}</span>
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize: 13, color: "#686F7D", fontStyle: "italic", margin: 0 }}>{t("ev_no_reviews")}</p>
                )}
              </div>
              <Btn variant="outline" onClick={() => setReviewsEventId(ev.id)} style={{ alignSelf: "flex-start" }}>
                <MessageCircle size={14} /> {t("ev_reviews_title")}
              </Btn>
            </div>
          )}

        </div>

        {editingEvent && (
          <EditEventModal event={editingEvent} onClose={() => setEditingEvent(null)} onSave={updateEvent} t={t} association={association} />
        )}
        {ticketEventId && (() => {
          const tev = events.find((e) => e.id === ticketEventId);
          const trsvp = tev ? myRsvp(tev.id) : null;
          if (!tev || !trsvp) return null;
          return <TicketModal ev={tev} rsvp={trsvp} association={association} t={t} lang={lang} onClose={() => setTicketEventId(null)} />;
        })()}
        {reviewsEventId && (() => {
          const rev = events.find((e) => e.id === reviewsEventId);
          if (!rev) return null;
          return (
            <EventReviewsModal
              event={rev} reviews={eventReviews(rev.id)} myReview={myReview(rev.id)}
              canReview={!!profile.member_id} isBureau={isBureau}
              onClose={() => setReviewsEventId(null)}
              onSubmit={(note, commentaire) => submitReview(rev.id, note, commentaire)}
              onDelete={deleteReview}
              t={t} lang={lang}
            />
          );
        })()}
      </Section></Container>
    );
  }

  return (
    <Container><Section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}><CalendarDays size={20} /> {t("nav_events")}</h2>
        {isBureau && (
          <Btn onClick={() => setShowCreateForm((v) => !v)} variant={showCreateForm ? "outline" : "primary"}>
            <Plus size={14} style={{ transform: showCreateForm ? "rotate(45deg)" : "none", transition: "transform .15s ease" }} /> {showCreateForm ? t("action_close") : t("ev_create_title")}
          </Btn>
        )}
      </div>

      {isBureau && showCreateForm && (
        <Card style={{ marginBottom: 24, maxWidth: 780, borderRadius: 16, border: "1px solid rgba(42,42,42,.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, margin: 0, fontFamily: "Poppins, sans-serif", fontWeight: 700, color: TEAL }}>{t("ev_create_title")}</h3>
            <button onClick={() => setShowCreateForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(42,42,42,.4)", display: "flex", padding: 0 }}><X size={16} /></button>
          </div>
          <Field label={t("ev_title")}><input style={inputStyle} value={newEvent.titre} onChange={(e) => setNewEvent({ ...newEvent, titre: e.target.value })} /></Field>
          <Field label={t("description")}><input style={inputStyle} value={newEvent.description} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
            <Field label={t("ev_location")}><input style={inputStyle} value={newEvent.lieu} onChange={(e) => setNewEvent({ ...newEvent, lieu: e.target.value })} /></Field>
            <Field label={t("ev_datetime")}><input type="datetime-local" style={inputStyle} value={newEvent.date_debut} onChange={(e) => setNewEvent({ ...newEvent, date_debut: e.target.value })} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <Field label={t("ev_max_capacity")}><input type="number" style={inputStyle} value={newEvent.capacite_max} onChange={(e) => setNewEvent({ ...newEvent, capacite_max: e.target.value })} /></Field>
            <Field label={t("ev_price")}><input type="number" style={inputStyle} value={newEvent.prix} onChange={(e) => setNewEvent({ ...newEvent, prix: e.target.value })} /></Field>
            <Field label={t("ev_member_price_label")}><input type="number" style={inputStyle} value={newEvent.prix_membre} onChange={(e) => setNewEvent({ ...newEvent, prix_membre: e.target.value })} /></Field>
          </div>
          <p style={{ fontSize: 11, color: "#9AA2B5", margin: "-8px 0 14px" }}>{t("ev_member_price_hint")}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label={t("ev_category_label")}>
              <input list="ev-categories" placeholder={t("ev_category_placeholder")} style={inputStyle} value={newEvent.categorie} onChange={(e) => setNewEvent({ ...newEvent, categorie: e.target.value })} />
              <datalist id="ev-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label={t("ev_recurrence_label")}>
              <select style={inputStyle} value={newEvent.recurrence} onChange={(e) => setNewEvent({ ...newEvent, recurrence: e.target.value })}>
                <option value="">{t("ev_recurrence_none")}</option>
                <option value="hebdomadaire">{t("ev_recurrence_hebdomadaire")}</option>
                <option value="mensuel">{t("ev_recurrence_mensuel")}</option>
              </select>
            </Field>
          </div>
          <Field label={t("ev_meeting_link")}><input type="url" placeholder={t("ev_meeting_link_placeholder")} style={inputStyle} value={newEvent.lien_reunion} onChange={(e) => setNewEvent({ ...newEvent, lien_reunion: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 22, marginBottom: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={newEvent.check_in_actif} onChange={(e) => setNewEvent({ ...newEvent, check_in_actif: e.target.checked })} />
              {t("ev_checkin_active_label")}
            </label>
            {association?.vitrine_active && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={newEvent.public_inscription} onChange={(e) => setNewEvent({ ...newEvent, public_inscription: e.target.checked })} />
                {t("ev_public_registration_label")}
              </label>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={createEvent}><Plus size={14} /> {t("ev_create_btn")}</Btn>
            <Btn variant="outline" onClick={() => setShowCreateForm(false)}>{t("action_close")}</Btn>
          </div>
        </Card>
      )}

      {(categories.length > 0 || events.length > 3) && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: 11, color: "#9AA2B5" }} />
            <input placeholder={t("ev_search_placeholder")} style={{ ...inputStyle, paddingLeft: 30 }} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          {categories.length > 0 && (
            <select style={{ ...inputStyle, maxWidth: 220 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">{t("ev_filter_all_categories")}</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <button onClick={() => setListFilter("avenir")} style={pillFilterStyle(listFilter === "avenir")}>{L.upcoming} · {upcoming.length}</button>
        <button onClick={() => setListFilter("passes")} style={pillFilterStyle(listFilter === "passes")}>{L.past} · {past.length}</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2.4fr 1.3fr 1.6fr 1.1fr 1fr 1fr 20px", gap: 16, padding: "0 20px 10px" }}>
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 10.5, letterSpacing: ".08em", color: "rgba(42,42,42,.4)" }}>{t("ev_col_event")}</span>
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 10.5, letterSpacing: ".08em", color: "rgba(42,42,42,.4)" }}>{t("date")}</span>
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 10.5, letterSpacing: ".08em", color: "rgba(42,42,42,.4)" }}>{t("ev_location")}</span>
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 10.5, letterSpacing: ".08em", color: "rgba(42,42,42,.4)" }}>{t("ev_col_participants")}</span>
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 10.5, letterSpacing: ".08em", color: "rgba(42,42,42,.4)" }}>{t("ev_price")}</span>
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 10.5, letterSpacing: ".08em", color: "rgba(42,42,42,.4)" }}>{t("ev_col_status")}</span>
        <span></span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginBottom: 30 }}>
        {(listFilter === "avenir" ? upcoming : past).map((ev) => {
          const confirmed = eventRsvps(ev.id);
          const full = ev.capacite_max && confirmed.length >= ev.capacite_max;
          const accent = ev.annule ? RED : categoryAccent(ev.categorie);
          const isPastRow = new Date(ev.date_debut) < now;
          return (
            <div
              key={ev.id}
              onClick={() => { setSelectedEventId(ev.id); setActiveTab("apercu"); }}
              style={{
                display: "grid", gridTemplateColumns: "2.4fr 1.3fr 1.6fr 1.1fr 1fr 1fr 20px", gap: 16, alignItems: "center",
                padding: "18px 20px", marginBottom: 10, background: "#fff", border: "1px solid rgba(42,42,42,.08)", borderRadius: 14,
                boxShadow: "0 2px 8px rgba(42,42,42,.05)", cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: accent, flexShrink: 0 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span style={{ fontFamily: "Poppins, sans-serif", fontWeight: 600, fontSize: 14.5, color: "#182233", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.titre}</span>
                  {ev.categorie && <span style={{ fontSize: 11, fontWeight: 600, color: accent }}>{ev.categorie}</span>}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{new Date(ev.date_debut).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA")}</span>
                <span style={{ fontSize: 11.5, color: "rgba(42,42,42,.42)" }}>{new Date(ev.date_debut).toLocaleTimeString(lang === "en" ? "en-CA" : "fr-CA", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <span style={{ fontSize: 13, color: "rgba(42,42,42,.62)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.lieu || "—"}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{confirmed.length}{ev.capacite_max ? ` / ${ev.capacite_max}` : ""}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{ev.prix > 0 ? money(ev.prix, devise) : (lang === "en" ? "Free" : "Gratuit")}</span>
              <span style={statusPillStyle(ev, full)}>{ev.annule ? t("ev_annule_pill") : full ? t("ev_full") : (isPastRow ? L.past : L.upcoming)}</span>
              <ChevronDown size={16} style={{ transform: "rotate(-90deg)", color: "rgba(42,42,42,.35)", flexShrink: 0 }} />
            </div>
          );
        })}
        {(listFilter === "avenir" ? upcoming : past).length === 0 && (
          <p style={{ color: "#686F7D", fontStyle: "italic", padding: "20px 4px" }}>{listFilter === "avenir" ? t("ev_no_upcoming") : ""}</p>
        )}
      </div>

      {editingEvent && (
        <EditEventModal event={editingEvent} onClose={() => setEditingEvent(null)} onSave={updateEvent} t={t} association={association} />
      )}

      {ticketEventId && (() => {
        const ev = events.find((e) => e.id === ticketEventId);
        const rsvp = ev ? myRsvp(ev.id) : null;
        if (!ev || !rsvp) return null;
        return <TicketModal ev={ev} rsvp={rsvp} association={association} t={t} lang={lang} onClose={() => setTicketEventId(null)} />;
      })()}

      {reviewsEventId && (() => {
        const ev = events.find((e) => e.id === reviewsEventId);
        if (!ev) return null;
        return (
          <EventReviewsModal
            event={ev} reviews={eventReviews(ev.id)} myReview={myReview(ev.id)}
            canReview={!!profile.member_id} isBureau={isBureau}
            onClose={() => setReviewsEventId(null)}
            onSubmit={(note, commentaire) => submitReview(ev.id, note, commentaire)}
            onDelete={deleteReview}
            t={t} lang={lang}
          />
        );
      })()}
    </Section></Container>
  );
}

function EventReviewsModal({ event, reviews, myReview, canReview, isBureau, onClose, onSubmit, onDelete, t, lang }) {
  const [note, setNote] = useState(myReview?.note || 5);
  const [commentaire, setCommentaire] = useState(myReview?.commentaire || "");
  const avg = reviews.length ? (reviews.reduce((s, r) => s + Number(r.note), 0) / reviews.length).toFixed(1) : null;
  function handleSave() {
    if (!window.confirm(t("ev_confirm_review").replace("{n}", String(note)))) return;
    onSubmit(note, commentaire.trim() || null);
  }
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 480, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("ev_reviews_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <p style={{ fontSize: 12.5, color: "#5B6270", marginTop: 0, marginBottom: 16 }}>{event.titre}</p>
        {avg && (
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)", marginTop: -8, marginBottom: 14 }}>
            {t("ev_avg_rating").replace("{avg}", avg).replace("{n}", String(reviews.length))}
          </p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          {reviews.map((r) => (
            <div key={r.id} style={{ borderBottom: "1px solid #EEE", paddingBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: 12.5 }}>{r.member_nom || "—"}</strong>
                  <span style={{ color: STAR_COLOR, fontSize: 12 }}>{"★".repeat(r.note)}{"☆".repeat(5 - r.note)}</span>
                </div>
                {isBureau && (
                  <button onClick={() => onDelete(r.id)} style={{ background: "none", border: "none", color: RED, cursor: "pointer", padding: 0, flexShrink: 0, display: "flex" }} title={t("action_delete")}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              {r.commentaire && <p style={{ fontSize: 12.5, color: "#333", margin: "4px 0 0" }}>{r.commentaire}</p>}
              <div style={{ fontSize: 10.5, color: "#686F7D", marginTop: 3 }}>{new Date(r.created_at).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA")}</div>
            </div>
          ))}
          {reviews.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 12.5 }}>{t("ev_no_reviews")}</p>}
        </div>
        {canReview && (
          <div style={{ background: "#F8F9FC", borderRadius: 10, padding: 14 }}>
            <h4 style={{ fontSize: 13, margin: "0 0 10px" }}>{myReview ? t("ev_edit_review_title") : t("ev_add_review_title")}</h4>
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setNote(n)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }} title={String(n)}>
                  <Star size={20} fill={n <= note ? STAR_COLOR : "none"} color={n <= note ? STAR_COLOR : "#BBB"} />
                </button>
              ))}
            </div>
            <textarea
              style={{ ...inputStyle, minHeight: 70, marginBottom: 10 }} value={commentaire}
              placeholder={t("ev_review_comment_placeholder")} onChange={(e) => setCommentaire(e.target.value)}
            />
            <Btn onClick={handleSave}>{t("action_save")}</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

function EditEventModal({ event, onClose, onSave, t, association }) {
  const [form, setForm] = useState({
    titre: event.titre || "", description: event.description || "", lieu: event.lieu || "",
    date_debut: event.date_debut ? new Date(event.date_debut).toISOString().slice(0, 16) : "",
    capacite_max: event.capacite_max ?? "", prix: event.prix ?? "", lien_reunion: event.lien_reunion || "",
    categorie: event.categorie || "", recurrence: event.recurrence || "", prix_membre: event.prix_membre ?? "",
    check_in_actif: event.check_in_actif || false, public_inscription: event.public_inscription || false,
  });
  function handleSave() {
    if (!form.titre.trim() || !form.date_debut) return;
    if (!window.confirm(t("ev_confirm_edit").replace("{titre}", form.titre.trim()))) return;
    onSave(event.id, {
      titre: form.titre.trim(), description: form.description.trim() || null, lieu: form.lieu.trim() || null,
      date_debut: new Date(form.date_debut).toISOString(),
      capacite_max: form.capacite_max ? Number(form.capacite_max) : null, prix: Number(form.prix) || 0,
      lien_reunion: form.lien_reunion.trim() || null,
      categorie: form.categorie.trim() || null, recurrence: form.recurrence || null,
      prix_membre: form.prix_membre !== "" ? Number(form.prix_membre) : null,
      check_in_actif: form.check_in_actif, public_inscription: form.public_inscription,
    });
    onClose();
  }
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 520, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("ev_edit_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <Field label={t("ev_title")}><input style={inputStyle} value={form.titre} onChange={(e) => setForm((p) => ({ ...p, titre: e.target.value }))} /></Field>
        <Field label={t("description")}><input style={inputStyle} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></Field>
        <Field label={t("ev_location")}><input style={inputStyle} value={form.lieu} onChange={(e) => setForm((p) => ({ ...p, lieu: e.target.value }))} /></Field>
        <Field label={t("ev_datetime")}><input type="datetime-local" style={inputStyle} value={form.date_debut} onChange={(e) => setForm((p) => ({ ...p, date_debut: e.target.value }))} /></Field>
        <Field label={t("ev_max_capacity")}><input type="number" style={inputStyle} value={form.capacite_max} onChange={(e) => setForm((p) => ({ ...p, capacite_max: e.target.value }))} /></Field>
        <Field label={t("ev_price")}><input type="number" style={inputStyle} value={form.prix} onChange={(e) => setForm((p) => ({ ...p, prix: e.target.value }))} /></Field>
        <Field label={t("ev_member_price_label")}><input type="number" style={inputStyle} value={form.prix_membre} onChange={(e) => setForm((p) => ({ ...p, prix_membre: e.target.value }))} /></Field>
        <Field label={t("ev_meeting_link")}><input type="url" placeholder={t("ev_meeting_link_placeholder")} style={inputStyle} value={form.lien_reunion} onChange={(e) => setForm((p) => ({ ...p, lien_reunion: e.target.value }))} /></Field>
        <Field label={t("ev_category_label")}><input placeholder={t("ev_category_placeholder")} style={inputStyle} value={form.categorie} onChange={(e) => setForm((p) => ({ ...p, categorie: e.target.value }))} /></Field>
        <Field label={t("ev_recurrence_label")}>
          <select style={inputStyle} value={form.recurrence} onChange={(e) => setForm((p) => ({ ...p, recurrence: e.target.value }))}>
            <option value="">{t("ev_recurrence_none")}</option>
            <option value="hebdomadaire">{t("ev_recurrence_hebdomadaire")}</option>
            <option value="mensuel">{t("ev_recurrence_mensuel")}</option>
          </select>
        </Field>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={form.check_in_actif} onChange={(e) => setForm((p) => ({ ...p, check_in_actif: e.target.checked }))} />
          {t("ev_checkin_active_label")}
        </label>
        {association?.vitrine_active && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={form.public_inscription} onChange={(e) => setForm((p) => ({ ...p, public_inscription: e.target.checked }))} />
            {t("ev_public_registration_label")}
          </label>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <Btn onClick={handleSave}>{t("action_save")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_close")}</Btn>
        </div>
      </div>
    </div>
  );
}
