// =====================================================================
// jeunessePdf.js — Certificat de distinction des bourses et prix
// (Jeunesse & tutorat), 2026-10-10, demandé par l'utilisateur : « une
// version imprimable du prix que les candidats reçoivent ».
// =====================================================================
// Une page paysage par lauréat : cadre à la couleur de l'association,
// logo, mentions légales, nom du lauréat, intitulé du prix, montant,
// mode d'attribution (jury ou tirage au sort vérifiable), date, deux
// cadres de signature (signataires des documents officiels, Configuration
// → Documents officiels) avec la mention de l'attribution enregistrée
// électroniquement dans l'application, et une ligne manuscrite facultative.
// =====================================================================
import { pdfTexte, couleurAssociation, chargerLogo, mentionsLegales } from "./pdfOfficiel";

const TXT = {
  fr: {
    titre: "CERTIFICAT DE DISTINCTION", decerne: "est décerné à", laureat: "lauréat(e) du",
    montant: "assorti d'une bourse de {m}", niveau: "Niveau : {n}",
    jury: "Attribué sur décision du jury de l'association", tirage: "Attribué par tirage au sort public et vérifiable",
    fait: "Fait le {d}", ref: "Réf. {r}",
    esign: "Attribution enregistrée électroniquement dans l'application le {d}",
    manuel: "Signature manuscrite (facultative)", signataire: "Pour l'association",
  },
  en: {
    titre: "CERTIFICATE OF DISTINCTION", decerne: "is awarded to", laureat: "recipient of the",
    montant: "with a scholarship of {m}", niveau: "Level: {n}",
    jury: "Awarded by decision of the association's jury", tirage: "Awarded by a public, verifiable draw",
    fait: "Issued on {d}", ref: "Ref. {r}",
    esign: "Award recorded electronically in the application on {d}",
    manuel: "Handwritten signature (optional)", signataire: "For the association",
  },
};

// laureats : [{ nom, niveauLabel }]
export async function exporterCertificatsBourse({ bourse, laureats, association, lang = "fr", fileName }) {
  const T = TXT[lang === "en" ? "en" : "fr"];
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const accent = couleurAssociation(association);
  const logo = await chargerLogo(association?.logo_url);
  const legal = mentionsLegales(association).join(" - ");
  const loc = lang === "en" ? "en-CA" : "fr-CA";
  const quand = new Date(bourse.attribuee_le || Date.now());
  const dateLongue = quand.toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" });
  const montant = bourse.montant != null && Number(bourse.montant) > 0
    ? Number(bourse.montant).toLocaleString(loc, { style: "currency", currency: association?.devise_monetaire || "CAD" })
    : null;
  const signataires = [
    association?.signataire1_nom ? { nom: association.signataire1_nom, titre: association.signataire1_titre || "" } : null,
    association?.signataire2_nom ? { nom: association.signataire2_nom, titre: association.signataire2_titre || "" } : null,
  ].filter(Boolean);
  if (signataires.length === 0) signataires.push({ nom: "", titre: T.signataire });

  laureats.forEach((l, i) => {
    if (i > 0) doc.addPage();
    // Double cadre à la couleur de l'association
    doc.setDrawColor(...accent); doc.setLineWidth(3); doc.rect(24, 24, W - 48, H - 48, "S");
    doc.setLineWidth(0.8); doc.rect(32, 32, W - 64, H - 64, "S");

    let y = 62;
    if (logo) {
      const lh = 52, lw = Math.min(lh * logo.ratio, 140);
      try { doc.addImage(logo.dataUrl, "PNG", (W - lw) / 2, y, lw, lw / logo.ratio); y += lw / logo.ratio + 10; } catch { /* logo illisible */ }
    }
    doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text(pdfTexte(association?.nom || ""), W / 2, y + 8, { align: "center" }); y += 22;
    if (legal) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      doc.text(doc.splitTextToSize(pdfTexte(legal), W - 160).slice(0, 2), W / 2, y, { align: "center" }); y += 16;
    }
    doc.setDrawColor(...accent); doc.setLineWidth(1); doc.line(W / 2 - 120, y, W / 2 + 120, y); y += 34;

    doc.setTextColor(...accent); doc.setFont("helvetica", "bold"); doc.setFontSize(28);
    doc.text(pdfTexte(T.titre), W / 2, y, { align: "center" }); y += 30;
    doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "italic"); doc.setFontSize(13);
    doc.text(pdfTexte(T.decerne), W / 2, y, { align: "center" }); y += 36;
    doc.setFont("helvetica", "bold"); doc.setFontSize(30);
    doc.text(pdfTexte(l.nom), W / 2, y, { align: "center" }); y += 30;
    doc.setFont("helvetica", "italic"); doc.setFontSize(13);
    doc.text(pdfTexte(T.laureat), W / 2, y, { align: "center" }); y += 22;
    doc.setFont("helvetica", "bold"); doc.setFontSize(18);
    const titre = doc.splitTextToSize(pdfTexte(bourse.titre), W - 200).slice(0, 2);
    doc.text(titre, W / 2, y, { align: "center" }); y += titre.length * 20 + 2;
    doc.setFont("helvetica", "normal"); doc.setFontSize(11.5);
    const details = [montant ? T.montant.replace("{m}", montant) : null, l.niveauLabel ? T.niveau.replace("{n}", l.niveauLabel) : null].filter(Boolean).join("  -  ");
    if (details) { doc.text(pdfTexte(details), W / 2, y, { align: "center" }); y += 16; }
    doc.setFont("helvetica", "italic"); doc.setFontSize(10);
    doc.text(pdfTexte(bourse.mode === "tirage" ? T.tirage : T.jury), W / 2, y, { align: "center" });

    // Signatures
    const BW = 220, gap = 40, total = signataires.length * BW + (signataires.length - 1) * gap;
    const by = H - 150;
    signataires.forEach((s, k) => {
      const bx = (W - total) / 2 + k * (BW + gap);
      doc.setDrawColor(...accent); doc.setLineWidth(0.6); doc.roundedRect(bx, by, BW, 76, 4, 4, "S");
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(0, 0, 0);
      doc.text(pdfTexte(s.nom || T.signataire), bx + 10, by + 15);
      doc.setFont("helvetica", "italic"); doc.setFontSize(8.5);
      if (s.titre && s.nom) doc.text(pdfTexte(s.titre), bx + 10, by + 27);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      doc.text(doc.splitTextToSize(pdfTexte(T.esign.replace("{d}", dateLongue)), BW - 20).slice(0, 2), bx + 10, by + 40);
      doc.setDrawColor(0, 0, 0); doc.line(bx + 10, by + 60, bx + BW - 10, by + 60);
      doc.setFont("helvetica", "italic"); doc.setFontSize(7); doc.text(pdfTexte(T.manuel), bx + 10, by + 70);
    });

    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
    doc.text(pdfTexte(T.fait.replace("{d}", dateLongue)), 48, H - 46);
    doc.text(pdfTexte(T.ref.replace("{r}", `B-${String(bourse.id).slice(0, 8).toUpperCase()}-${i + 1}`)), W - 48, H - 46, { align: "right" });
  });
  doc.save(fileName || `Certificat_${String(bourse.titre || "prix").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40)}.pdf`);
}
