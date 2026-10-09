// =====================================================================
// evenementsPlus.js — bénévolat encadré, carte de membre à l'entrée,
// programme officiel (2026-10-10)
// =====================================================================
// Demandes de l'utilisateur :
//  • bénévolat validé par le bureau, délai de prévenance, demande de
//    retrait tant qu'aucun remplaçant n'est trouvé ;
//  • badge des membres (adhérents et bureau) au même format que celui des
//    visiteurs, avec photo, logo et mentions légales : il sert de carte
//    de membre ET de badge d'entrée (valable seulement si la personne est
//    inscrite à l'événement — contrôlé par la base) ;
//  • programme de l'événement propre : PDF officiel, impression, archive.
// Côté base : sql/2026-10-10b_evenements_benevolat_cartes.sql.
// Fichier sans composant (textes + fonctions), partagé par
// Evenements.jsx et MesEngagements.jsx.
// =====================================================================
import { formatEventDateTime } from "./shared";
import { pdfTexte, enTeteOfficiel, piedsDePageOfficiels, couleurAssociation, chargerLogo, mentionsLegales } from "./pdfOfficiel";
import { qrDataUrl } from "./badgesEvenement";

export const EVPLUS_TXT = {
  fr: {
    // Bénévolat
    st_en_attente: "En attente de validation",
    st_confirme: "Confirmé",
    st_retrait_demande: "Retrait demandé",
    complete: "Complète ✓",
    summary: "{c} tâche(s) sur {n} comblée(s) · {a} proposition(s) à valider · {r} retrait(s) demandé(s)",
    validate: "Valider",
    refuse: "Refuser",
    acceptWithdraw: "Accepter le retrait",
    remove: "Retirer",
    confirmRefuse: "Refuser la proposition de {nom} ?",
    confirmAcceptWithdraw: "Accepter le retrait de {nom} ? Sa place sera libérée.",
    confirmRemove: "Retirer {nom} de cette tâche ?",
    reason: "Motif",
    myStatus: "Votre engagement : {s}",
    withdraw: "Me retirer",
    askWithdraw: "Demander à me retirer",
    cancelWithdraw: "Annuler ma demande de retrait",
    withdrawFreeConfirm: "Vous retirer de cette tâche ?",
    withdrawLateInfo: "Moins de {h} h avant l'événement : votre retrait doit être accepté par le bureau. Vous restez engagé(e) jusqu'à ce qu'un remplaçant soit trouvé.\n\nMotif (facultatif) :",
    withdrawRequested: "Demande envoyée. Le bureau et les membres disponibles sont prévenus ; vous restez engagé(e) jusqu'à l'accord du bureau.",
    pendingInfo: "Proposition envoyée : le bureau doit la valider.",
    delayLabel: "Délai de prévenance pour se retirer librement (heures avant l'événement)",
    delaySave: "Enregistrer",
    policyNote: "Règle : une proposition est validée par le bureau. Jusqu'à {h} h avant l'événement, on peut se retirer librement ; après, on fait une demande de retrait et l'on reste engagé tant que le bureau n'a pas trouvé de remplaçant.",
    // Carte de membre / badge
    membersBadges: "Badges des membres (PDF)",
    myBadge: "Mon badge / carte de membre (PDF)",
    card: "CARTE DE MEMBRE · BADGE",
    member: "Adhérent(e)",
    since: "Membre depuis {d}",
    valid: "Valable en {y}",
    scanHint: "À l'entrée, scannez la carte de membre (ou le billet) d'un adhérent : il n'est pointé que s'il est inscrit à cet événement.",
    status_enregistre: "✓ Entrée enregistrée",
    status_deja_valide: "Déjà pointé(e) — premier passage à {h}",
    status_non_inscrit: "Non inscrit(e) à cet événement",
    status_inactif: "Membre non actif : carte non valable",
    status_introuvable: "Carte inconnue dans cette association",
    status_non_autorise: "Réservé au bureau",
    status_non_confirme: "Inscription non confirmée",
    enrollNow: "Inscrire maintenant et pointer",
    status_ancien_billet: "Ancien billet : demandez la carte de membre (Mon espace → Mon badge), elle sert de billet d'entrée.",
    ticketHint: "Présentez ce code à l'entrée : c'est votre carte de membre, valable comme billet pour les événements où vous êtes inscrit(e).",
    attestMine: "Mon attestation de participation (PDF)",
    attestAll: "Attestations de participation (PDF)",
    attestNone: "Personne n'a encore été pointé(e) à l'entrée de cet événement.",
    attestTitle: "Attestation de participation",
    attestBody: "{assoc} atteste que {nom} a participé à l'événement « {titre} », tenu le {date}{lieu}.",
    attestRole: "Rôle : {r}.",
    attestParticipant: "participant(e)",
    attestVolunteer: "bénévole ({t})",
    attestArrived: "Présence enregistrée à l'entrée le {d}.",
    attestPlace: " à {l}",
    attestDone: "Fait le {d}.",
    attestSign: "Pour l'association — signature",
    checkPhoto: "Vérifiez que la photo correspond à la personne.",
    // Programme
    progTitle: "Programme",
    progPdf: "Programme (PDF)",
    progPrint: "Imprimer",
    progArchive: "Archiver dans Documents",
    progArchived: "Programme archivé dans Documents → Événements.",
    progEnd: "Fin (optionnel)",
    progDesc: "Description (optionnel)",
    progStart: "Début",
    progTime: "Heure",
    progActivity: "Activité",
    progPlace: "Lieu",
    progEmpty: "Aucune séance au programme.",
    progDate: "Date",
    progAt: "Lieu de l'événement",
  },
  en: {
    st_en_attente: "Awaiting approval",
    st_confirme: "Confirmed",
    st_retrait_demande: "Withdrawal requested",
    complete: "Filled ✓",
    summary: "{c} of {n} task(s) filled · {a} offer(s) to approve · {r} withdrawal(s) requested",
    validate: "Approve",
    refuse: "Decline",
    acceptWithdraw: "Accept withdrawal",
    remove: "Remove",
    confirmRefuse: "Decline {nom}'s offer?",
    confirmAcceptWithdraw: "Accept {nom}'s withdrawal? Their spot will be freed.",
    confirmRemove: "Remove {nom} from this task?",
    reason: "Reason",
    myStatus: "Your commitment: {s}",
    withdraw: "Withdraw",
    askWithdraw: "Request to withdraw",
    cancelWithdraw: "Cancel my withdrawal request",
    withdrawFreeConfirm: "Withdraw from this task?",
    withdrawLateInfo: "Less than {h} h before the event: the board must accept your withdrawal. You remain committed until a replacement is found.\n\nReason (optional):",
    withdrawRequested: "Request sent. The board and available members are notified; you remain committed until the board agrees.",
    pendingInfo: "Offer sent: the board must approve it.",
    delayLabel: "Notice period to withdraw freely (hours before the event)",
    delaySave: "Save",
    policyNote: "Rule: offers are approved by the board. Up to {h} h before the event, volunteers may withdraw freely; after that, they request a withdrawal and remain committed until the board finds a replacement.",
    membersBadges: "Member badges (PDF)",
    myBadge: "My badge / membership card (PDF)",
    card: "MEMBERSHIP CARD · BADGE",
    member: "Member",
    since: "Member since {d}",
    valid: "Valid in {y}",
    scanHint: "At the entrance, scan a member's membership card (or ticket): they are checked in only if registered for this event.",
    status_enregistre: "✓ Check-in recorded",
    status_deja_valide: "Already checked in — first at {h}",
    status_non_inscrit: "Not registered for this event",
    status_inactif: "Inactive member: card not valid",
    status_introuvable: "Unknown card in this association",
    status_non_autorise: "Board only",
    status_non_confirme: "Registration not confirmed",
    enrollNow: "Register now and check in",
    status_ancien_billet: "Old ticket: ask for the membership card (My space → My badge); it serves as the entry ticket.",
    ticketHint: "Show this code at the entrance: it is your membership card, valid as a ticket for events you are registered for.",
    attestMine: "My certificate of attendance (PDF)",
    attestAll: "Certificates of attendance (PDF)",
    attestNone: "Nobody has been checked in at this event yet.",
    attestTitle: "Certificate of attendance",
    attestBody: "{assoc} certifies that {nom} attended the event \"{titre}\", held on {date}{lieu}.",
    attestRole: "Role: {r}.",
    attestParticipant: "participant",
    attestVolunteer: "volunteer ({t})",
    attestArrived: "Attendance recorded at the entrance on {d}.",
    attestPlace: " at {l}",
    attestDone: "Issued on {d}.",
    attestSign: "On behalf of the association — signature",
    checkPhoto: "Check that the photo matches the person.",
    progTitle: "Program",
    progPdf: "Program (PDF)",
    progPrint: "Print",
    progArchive: "Archive in Documents",
    progArchived: "Program archived in Documents → Events.",
    progEnd: "End (optional)",
    progDesc: "Description (optional)",
    progStart: "Start",
    progTime: "Time",
    progActivity: "Activity",
    progPlace: "Place",
    progEmpty: "No session in the program.",
    progDate: "Date",
    progAt: "Event venue",
  },
};
export function txtEvPlus(lang) { return EVPLUS_TXT[lang === "en" ? "en" : "fr"]; }

// Places occupées d'une tâche (toute proposition, confirmée ou non, réserve
// une place — même règle que la base).
export function statsBenevolat(tasks, signups) {
  let comblees = 0, attente = 0, retraits = 0;
  tasks.forEach((tk) => {
    const s = signups.filter((x) => x.task_id === tk.id);
    if (s.length >= tk.membres_requis && s.every((x) => (x.statut || "confirme") === "confirme")) comblees += 1;
    attente += s.filter((x) => x.statut === "en_attente").length;
    retraits += s.filter((x) => x.statut === "retrait_demande").length;
  });
  return { comblees, attente, retraits, total: tasks.length };
}

// Le délai de prévenance est-il dépassé (retrait seulement sur demande) ?
export function retraitSurDemande(ev, signup) {
  if (!ev?.date_debut || (signup?.statut || "confirme") === "en_attente") return false;
  const h = ev.benevolat_delai_heures ?? 72;
  return Date.now() >= new Date(ev.date_debut).getTime() - h * 3600000;
}

const fmtHeure = (iso, lang) => {
  if (!iso) return "";
  const d = new Date(iso);
  return lang === "en" ? d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }) : `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------
// Programme officiel (PDF) — en-tête/pied officiels, frise horaire.
// sortie : "telecharger" | "imprimer" | "blob"
// ---------------------------------------------------------------------
export async function exporterProgrammePdf({ ev, sessions, association, lang, sortie = "telecharger" }) {
  const P = txtEvPlus(lang);
  const [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const { jsPDF } = jsPDFmod;
  const autoTable = autoTableMod.default || autoTableMod;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 48;
  const lignesInfo = [formatEventDateTime(ev.date_debut, lang), ev.lieu].filter(Boolean).join(" - ");
  let y = await enTeteOfficiel(doc, association, { titre: `${P.progTitle} - ${ev.titre || ""}`, sousTitre: lignesInfo, marge: M });
  if (ev.description) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(10);
    const l = doc.splitTextToSize(pdfTexte(ev.description), doc.internal.pageSize.getWidth() - 2 * M);
    doc.text(l, M, y + 4); y += l.length * 13 + 10;
    doc.setFont("helvetica", "normal");
  }
  const tri = [...sessions].sort((a, b) => String(a.date_debut || "").localeCompare(String(b.date_debut || "")) || (a.ordre || 0) - (b.ordre || 0));
  // Plusieurs jours ? on ajoute la date à côté de l'heure.
  const jours = new Set(tri.map((s) => (s.date_debut ? new Date(s.date_debut).toDateString() : "")));
  const plusieursJours = jours.size > 1;
  autoTable(doc, {
    startY: y + 4,
    head: [[P.progTime, P.progActivity, P.progPlace].map(pdfTexte)],
    body: tri.length ? tri.map((s) => {
      const debut = s.date_debut ? (plusieursJours ? `${new Date(s.date_debut).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA")} ` : "") + fmtHeure(s.date_debut, lang) : "";
      const heure = s.date_fin ? `${debut} - ${fmtHeure(s.date_fin, lang)}` : debut;
      const activite = s.description ? `${s.titre}\n${s.description}` : s.titre;
      return [heure, activite, s.lieu || ""].map(pdfTexte);
    }) : [[pdfTexte(P.progEmpty), "", ""]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 10.5, cellPadding: 7, lineColor: [220, 224, 230], lineWidth: 0.5, valign: "top", textColor: [0, 0, 0] },
    headStyles: { fillColor: couleurAssociation(association), textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: plusieursJours ? 130 : 95, fontStyle: "bold" }, 2: { cellWidth: 130 } },
    margin: { left: M, right: M, top: 56, bottom: 60 },
  });
  piedsDePageOfficiels(doc, association, { marge: M, texte: `${P.progTitle} - ${ev.titre || ""}`, libellePage: (p, n) => `${p} / ${n}` });
  const fichier = `Programme_${(ev.titre || "evenement").normalize("NFD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}.pdf`;
  if (sortie === "blob") return { blob: doc.output("blob"), fichier };
  if (sortie === "imprimer") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
    return null;
  }
  doc.save(fichier);
  return null;
}

// ---------------------------------------------------------------------
// Badges des membres : même format que les badges visiteurs, avec la
// photo, le logo, le rôle et les mentions légales. Le QR est celui de la
// carte de membre (?verify=<jeton>) : il sert aussi à l'entrée des
// événements, accepté seulement si la personne y est inscrite.
// m : { nom, photo_url, verification_token, date_adhesion, role_label }
// ---------------------------------------------------------------------
function dessinerBadgeMembre(doc, x, y, w, h, m, ctx) {
  const { P, logo, accent, legal, association, lang } = ctx;
  const pad = 12;
  doc.setDrawColor(200, 205, 214); doc.setLineWidth(0.8);
  doc.roundedRect(x, y, w, h, 8, 8, "S");
  // Bandeau à la couleur de l'association
  doc.setFillColor(...accent);
  doc.roundedRect(x, y, w, 34, 8, 8, "F");
  doc.rect(x, y + 20, w, 14, "F");
  let tx = x + pad;
  if (logo) {
    const lw = Math.min(24 * logo.ratio, 48);
    try { doc.addImage(logo.dataUrl, "PNG", x + pad, y + 5, lw, lw / logo.ratio); tx += lw + 6; } catch { /* logo illisible */ }
  }
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(doc.splitTextToSize(pdfTexte(association?.nom || ""), w - (tx - x) - pad)[0] || "", tx, y + 15);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7);
  doc.text(pdfTexte(P.card), tx, y + 26);

  // Photo à gauche, QR à droite
  const top = y + 34 + pad;
  const qrSize = Math.min(h - 34 - 2 * pad - 14, w * 0.32);
  const qrX = x + w - pad - qrSize;
  if (m.qr) { try { doc.addImage(m.qr, "PNG", qrX, top, qrSize, qrSize, undefined, "FAST"); } catch { /* QR indisponible */ } }
  const photoSize = 54;
  let colX = x + pad;
  if (m.photo) {
    try {
      const pw = m.photo.ratio >= 1 ? photoSize : photoSize * m.photo.ratio;
      const ph = m.photo.ratio >= 1 ? photoSize / m.photo.ratio : photoSize;
      doc.addImage(m.photo.dataUrl, "PNG", x + pad + (photoSize - pw) / 2, top + (photoSize - ph) / 2, pw, ph);
      doc.setDrawColor(...accent); doc.setLineWidth(1);
      doc.rect(x + pad, top, photoSize, photoSize, "S");
      colX = x + pad + photoSize + 10;
    } catch { /* photo illisible */ }
  }
  // Pas de photo sur la fiche (ou photo illisible) : on garde l'emplacement,
  // avec les initiales, pour que tous les badges aient la même présentation
  // — adhérents comme membres du bureau. Demande de l'utilisateur (2026-10-10).
  if (colX === x + pad) {
    const initiales = String(m.nom || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    doc.setFillColor(242, 243, 246); doc.setDrawColor(...accent); doc.setLineWidth(1);
    doc.rect(x + pad, top, photoSize, photoSize, "FD");
    doc.setTextColor(...accent); doc.setFont("helvetica", "bold"); doc.setFontSize(18);
    doc.text(pdfTexte(initiales), x + pad + photoSize / 2, top + photoSize / 2 + 6, { align: "center" });
    colX = x + pad + photoSize + 10;
  }
  const colW = qrX - colX - 8;
  let ty = top + 12;
  doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  const nom = doc.splitTextToSize(pdfTexte(m.nom || ""), colW).slice(0, 2);
  doc.text(nom, colX, ty); ty += nom.length * 15;
  doc.setFont("helvetica", "bolditalic"); doc.setFontSize(9);
  doc.text(doc.splitTextToSize(pdfTexte(m.role_label || P.member), colW)[0] || "", colX, ty); ty += 12;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  if (m.date_adhesion) {
    // Date seule (AAAA-MM-JJ) lue en heure locale : sinon elle recule d'un jour
    // à l'ouest de Greenwich (minuit UTC = la veille au soir à Moncton).
    const j = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(m.date_adhesion));
    const d = j ? new Date(+j[1], +j[2] - 1, +j[3]) : new Date(m.date_adhesion);
    if (!Number.isNaN(d.getTime())) {
      const l = doc.splitTextToSize(pdfTexte(P.since.replace("{d}", d.toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA"))), colW).slice(0, 2);
      doc.text(l, colX, ty); ty += l.length * 10;
    }
  }
  doc.text(doc.splitTextToSize(pdfTexte(P.valid.replace("{y}", String(new Date().getFullYear()))), colW)[0] || "", colX, ty);

  // Mentions légales, en petit, au pied du badge
  if (legal) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(6); doc.setTextColor(0, 0, 0);
    const l = doc.splitTextToSize(pdfTexte(legal), w - 2 * pad).slice(0, 2);
    doc.text(l, x + pad, y + h - 6 - (l.length - 1) * 7);
  }
}

export async function downloadMemberBadgesPdf(membres, { association, lang = "fr", fileName = "badges_membres.pdf", sortie = "telecharger" } = {}) {
  const P = txtEvPlus(lang);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const logo = await chargerLogo(association?.logo_url);
  const accent = couleurAssociation(association);
  const legal = mentionsLegales(association).join(" - ");
  const prets = await Promise.all(membres.map(async (m) => ({
    ...m,
    qr: m.verification_token ? await qrDataUrl(`${window.location.origin}/?verify=${m.verification_token}`).catch(() => null) : null,
    photo: await chargerLogo(m.photo_url),
  })));
  const marginX = 36, marginY = 36, gap = 12, cols = 2, rows = 4;
  const w = (612 - 2 * marginX - gap) / cols;
  const h = (792 - 2 * marginY - (rows - 1) * gap) / rows;
  prets.forEach((m, i) => {
    const slot = i % (cols * rows);
    if (i > 0 && slot === 0) doc.addPage();
    dessinerBadgeMembre(doc, marginX + (slot % cols) * (w + gap), marginY + Math.floor(slot / cols) * (h + gap), w, h, m, { P, logo, accent, legal, association, lang });
  });
  if (sortie === "blob") return doc.output("blob");
  doc.save(fileName);
  return null;
}

// ---------------------------------------------------------------------
// Attestations de participation : une page par personne, en-tête et pied
// officiels. personnes : [{ nom, role ("participant" | texte bénévole),
// checkin_le }]. Demande de l'utilisateur (2026-10-10).
// ---------------------------------------------------------------------
export async function exporterAttestationsPdf({ ev, personnes, association, lang, fileName }) {
  const P = txtEvPlus(lang);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 64;
  const W = doc.internal.pageSize.getWidth() - 2 * M;
  const loc = lang === "en" ? "en-CA" : "fr-CA";
  for (let i = 0; i < personnes.length; i++) {
    const p = personnes[i];
    if (i > 0) doc.addPage();
    let y = await enTeteOfficiel(doc, association, { marge: M });
    y += 30;
    doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(0, 0, 0);
    doc.text(pdfTexte(P.attestTitle).toUpperCase(), doc.internal.pageSize.getWidth() / 2, y, { align: "center" });
    y += 12;
    doc.setDrawColor(...couleurAssociation(association)); doc.setLineWidth(1.5);
    doc.line(doc.internal.pageSize.getWidth() / 2 - 80, y, doc.internal.pageSize.getWidth() / 2 + 80, y);
    y += 50;
    doc.setFont("helvetica", "normal"); doc.setFontSize(12.5);
    const corps = P.attestBody
      .replace("{assoc}", association?.nom || "")
      .replace("{nom}", p.nom || "")
      .replace("{titre}", ev.titre || "")
      .replace("{date}", formatEventDateTime(ev.date_debut, lang))
      .replace("{lieu}", ev.lieu ? P.attestPlace.replace("{l}", ev.lieu) : "");
    const lignes = doc.splitTextToSize(pdfTexte(corps), W);
    doc.text(lignes, M, y, { lineHeightFactor: 1.6 });
    y += lignes.length * 20 + 14;
    doc.setFont("helvetica", "bold");
    doc.text(pdfTexte(P.attestRole.replace("{r}", p.role || P.attestParticipant)), M, y);
    y += 22;
    if (p.checkin_le) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(11);
      doc.text(pdfTexte(P.attestArrived.replace("{d}", formatEventDateTime(p.checkin_le, lang))), M, y);
      y += 20;
    }
    y += 40;
    doc.setFont("helvetica", "normal"); doc.setFontSize(11);
    doc.text(pdfTexte(P.attestDone.replace("{d}", new Date().toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" }))), M, y);
    y += 70;
    const x2 = M + W - 220;
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.6);
    doc.line(x2, y, x2 + 220, y);
    doc.setFont("helvetica", "italic"); doc.setFontSize(9.5);
    doc.text(pdfTexte(P.attestSign), x2, y + 13);
  }
  piedsDePageOfficiels(doc, association, { marge: M, texte: `${P.attestTitle} - ${ev.titre || ""}` });
  doc.save(fileName || `Attestations_${(ev.titre || "evenement").normalize("NFD").replace(/[^A-Za-z0-9]+/g, "_")}.pdf`);
}
