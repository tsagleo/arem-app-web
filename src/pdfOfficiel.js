// =====================================================================
// pdfOfficiel.js — en-tête et pied de page OFFICIELS des PDF générés
// =====================================================================
// Demande de l'utilisateur (2026-10-09) : le logo et les mentions légales
// de l'association (statut juridique, numéro d'enregistrement, adresse)
// doivent figurer sur TOUS les procès-verbaux et documents générés, pour
// qu'ils soient authentiques. Un seul endroit pour le faire, partagé par
// tous les modules qui produisent un PDF avec jsPDF.
//
// Usage :
//   let y = await enTeteOfficiel(doc, association, { titre: "Procès-verbal…" });
//   … contenu …
//   piedsDePageOfficiels(doc, association, { libellePage: (p, n) => `Page ${p} / ${n}` });
// =====================================================================

const NOIR = [0, 0, 0];

// Couleur d'accent des PDF = couleur principale choisie par l'association
// (Configuration → couleurs), comme dans l'application. Demande de
// l'utilisateur (2026-10-09) : une seule couleur, celle de l'association,
// et tout le texte en noir. Une couleur trop claire (texte blanc illisible
// dessus) retombe sur le bleu par défaut de l'application.
export function couleurAssociation(association) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(association?.couleur_primaire || "").trim());
  const rgb = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  if (!rgb) return [13, 58, 99];
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.75 ? [13, 58, 99] : rgb;
}

// Les polices standard de jsPDF ne connaissent que l'alphabet latin
// courant (WinAnsi) : flèches, espaces fines des dates françaises, etc.
// s'imprimeraient en charabia. Tout texte passe par ici.
export function pdfTexte(s) {
  return String(s ?? "")
    .replace(/[\u202F\u2009\u2007\u00A0]/g, " ")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2192/g, "->")
    .replace(/\u2026/g, "...")
    .replace(/[^\n -\u00FF]/g, "");
}

// Logo de l'association → image PNG utilisable par jsPDF, avec son
// rapport largeur/hauteur. Passe par un canevas pour accepter aussi les
// formats que jsPDF ne lit pas (WebP, SVG). Mémorisé par adresse.
const logos = new Map();
export function chargerLogo(url) {
  if (!url) return Promise.resolve(null);
  if (!logos.has(url)) {
    logos.set(url, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const fin = setTimeout(() => resolve(null), 6000);
      img.onload = () => {
        clearTimeout(fin);
        try {
          const max = 300;
          const r = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round((img.naturalWidth || max) * r));
          c.height = Math.max(1, Math.round((img.naturalHeight || max) * r));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve({ dataUrl: c.toDataURL("image/png"), ratio: c.width / c.height });
        } catch {
          resolve(null); // image distante non exportable (CORS) : PDF sans logo
        }
      };
      img.onerror = () => { clearTimeout(fin); resolve(null); };
      img.src = url;
    }));
  }
  return logos.get(url);
}

// Lignes des mentions légales, dans l'ordre d'affichage.
export function mentionsLegales(association) {
  const lignes = [];
  const id = [association?.statut_juridique, association?.numero_enregistrement].filter(Boolean).join(" - ");
  if (id) lignes.push(id);
  if (association?.adresse) lignes.push(...String(association.adresse).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  return lignes;
}

// En-tête officiel : logo à gauche, nom de l'association, mentions
// légales, filet, puis titre (et sous-titre) du document.
// Renvoie l'ordonnée (y) où commencer le contenu.
export async function enTeteOfficiel(doc, association, { titre, sousTitre, marge = 40, y = 40, droite } = {}) {
  const largeurPage = doc.internal.pageSize.getWidth();
  const logo = await chargerLogo(association?.logo_url);
  const H = 54; // hauteur réservée au logo
  let x = marge;
  if (logo) {
    const w = Math.min(H * logo.ratio, 110);
    const h = w / logo.ratio;
    try { doc.addImage(logo.dataUrl, "PNG", marge, y, w, h); x = marge + w + 12; } catch { /* format illisible : sans logo */ }
  }
  const largeurTexte = largeurPage - marge - x;
  const ACCENT = couleurAssociation(association);
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...NOIR);
  doc.text(pdfTexte(association?.nom || ""), x, y + 14, { maxWidth: largeurTexte });
  let ty = y + 28;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...NOIR);
  mentionsLegales(association).forEach((l) => {
    const morceaux = doc.splitTextToSize(pdfTexte(l), largeurTexte);
    doc.text(morceaux, x, ty);
    ty += morceaux.length * 10.5;
  });
  if (droite) doc.text(pdfTexte(droite), largeurPage - marge, y + 14, { align: "right" });
  let yy = Math.max(ty, y + (logo ? H : 30)) + 6;
  doc.setDrawColor(...ACCENT); doc.setLineWidth(1.2);
  doc.line(marge, yy, largeurPage - marge, yy);
  yy += 22;
  if (titre) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...NOIR);
    const t = doc.splitTextToSize(pdfTexte(titre), largeurPage - 2 * marge);
    doc.text(t, marge, yy);
    yy += t.length * 16;
  }
  if (sousTitre) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(10); doc.setTextColor(...NOIR);
    const t = doc.splitTextToSize(pdfTexte(sousTitre), largeurPage - 2 * marge);
    doc.text(t, marge, yy);
    yy += t.length * 13;
  }
  doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  return yy + 6;
}

// Pied de page sur CHAQUE page : nom + identification légale, numéro de
// page. À appeler une fois le document terminé.
export function piedsDePageOfficiels(doc, association, { marge = 40, texte, libellePage } = {}) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const id = [association?.nom, association?.statut_juridique, association?.numero_enregistrement].filter(Boolean).join(" - ");
  const n = doc.internal.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setDrawColor(220, 224, 230); doc.setLineWidth(0.5);
    doc.line(marge, H - 36, W - marge, H - 36);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...NOIR);
    doc.text(pdfTexte(texte ? `${id} - ${texte}` : id), marge, H - 24, { maxWidth: W - 2 * marge - 70 });
    if (libellePage) doc.text(pdfTexte(libellePage(p, n)), W - marge, H - 24, { align: "right" });
  }
  doc.setTextColor(0, 0, 0);
}
