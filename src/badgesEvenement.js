// =====================================================================
// badgesEvenement.js — badges QR des visiteurs non adhérents
// (inscriptions publiques d'un événement) — 2026-10-09
// Partagé entre la page publique (PublicShowcase.jsx, badge d'une
// personne) et le Bureau (Evenements.jsx, planche de tous les badges).
// Côté base : sql/2026-10-09c_badges_inscriptions_publiques.sql.
// =====================================================================
import { formatEventDateTime } from "./shared";

// Lien personnel du badge : c'est aussi le contenu du code QR. La page
// publique de l'événement l'affiche ; le scanner du Bureau en extrait le
// paramètre « badge ».
export function badgeUrl(slug, eventId, token) {
  const params = new URLSearchParams();
  if (slug) params.set("pub", slug);
  if (eventId) params.set("evenement", eventId);
  params.set("badge", token);
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

// Identifiant d'inscription tiré au hasard par le navigateur (sert de
// secret pour récupérer le badge juste après l'envoi — voir le SQL).
export function randomUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const b = window.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function qrDataUrl(text, width = 300) {
  const QRCode = await import("qrcode");
  return QRCode.toDataURL(text, { width, margin: 1 });
}

export async function imageToDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
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

const TXT = {
  fr: { badge: "BADGE D'ENTRÉE", people: "{n} personnes", visitor: "Visiteur" },
  en: { badge: "ENTRY BADGE", people: "{n} people", visitor: "Visitor" },
};

// Dessine un badge (rectangle w × h, en points) à la position x, y.
// b : { nom, nb_personnes, event_titre, event_date_debut, event_lieu,
//       association_nom, qr (data URL) } ; logo : data URL ou null.
function drawBadge(doc, x, y, w, h, b, logo, lang) {
  const L = TXT[lang] || TXT.fr;
  const pad = 12;
  doc.setDrawColor(200, 205, 214); doc.setLineWidth(0.8);
  doc.roundedRect(x, y, w, h, 8, 8, "S");
  // Bandeau supérieur
  doc.setFillColor(31, 56, 100);
  doc.roundedRect(x, y, w, 34, 8, 8, "F");
  doc.rect(x, y + 20, w, 14, "F");
  let textX = x + pad;
  if (logo) {
    try { doc.addImage(logo, x + pad, y + 5, 24, 24); textX += 30; } catch { /* format d'image non pris en charge */ }
  }
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(doc.splitTextToSize(b.association_nom || "", w - (textX - x) - pad)[0] || "", textX, y + 15);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7);
  doc.text(L.badge, textX, y + 26);

  const qrSize = Math.min(h - 34 - 2 * pad, w * 0.38);
  const qrX = x + w - pad - qrSize;
  const qrY = y + 34 + pad;
  if (b.qr) {
    try { doc.addImage(b.qr, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST"); } catch { /* QR indisponible */ }
  }

  const colW = qrX - x - 2 * pad;
  let ty = y + 34 + pad + 12;
  doc.setTextColor(20, 20, 20); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  const nameLines = doc.splitTextToSize(b.nom || L.visitor, colW).slice(0, 2);
  doc.text(nameLines, x + pad, ty); ty += nameLines.length * 17;
  if (Number(b.nb_personnes) > 1) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(46, 139, 116);
    doc.text(L.people.replace("{n}", String(b.nb_personnes)), x + pad, ty); ty += 13;
  }
  ty += 4;
  doc.setTextColor(31, 56, 100); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
  const titleLines = doc.splitTextToSize(b.event_titre || "", colW).slice(0, 2);
  doc.text(titleLines, x + pad, ty); ty += titleLines.length * 11 + 2;
  doc.setTextColor(90, 98, 112); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  const dateLines = doc.splitTextToSize(formatEventDateTime(b.event_date_debut, lang), colW).slice(0, 2);
  doc.text(dateLines, x + pad, ty); ty += dateLines.length * 10;
  if (b.event_lieu && ty < y + h - 8) doc.text(doc.splitTextToSize(b.event_lieu, colW).slice(0, 1), x + pad, ty);
}

// Génère et télécharge un PDF de badges : une planche de 8 badges par
// page (format Lettre, 2 × 4), à découper. Un seul badge donne une page
// avec un seul badge en haut à gauche.
export async function downloadBadgesPdf(badges, { logoUrl, lang = "fr", fileName = "badges.pdf" } = {}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const logo = await imageToDataUrl(logoUrl);
  const withQr = await Promise.all(badges.map(async (b) => ({ ...b, qr: b.qr || await qrDataUrl(b.url).catch(() => null) })));
  const marginX = 36, marginY = 36, gap = 12;
  const cols = 2, rows = 4;
  const w = (612 - 2 * marginX - gap) / cols;
  const h = (792 - 2 * marginY - (rows - 1) * gap) / rows;
  withQr.forEach((b, i) => {
    const slot = i % (cols * rows);
    if (i > 0 && slot === 0) doc.addPage();
    const cx = marginX + (slot % cols) * (w + gap);
    const cy = marginY + Math.floor(slot / cols) * (h + gap);
    drawBadge(doc, cx, cy, w, h, b, logo, lang);
  });
  doc.save(fileName);
}

export function safeFileName(s) {
  return (s || "evenement").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "evenement";
}
