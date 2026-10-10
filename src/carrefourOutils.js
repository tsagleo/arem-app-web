// =====================================================================
// carrefourOutils.js — outils partagés du Carrefour du savoir (2026-10-10)
// =====================================================================
import { supabase } from "./supabaseClient";

// ---------- Export calendrier (.ics) : séances de classe ----------
const pad2 = (n) => String(n).padStart(2, "0");
const icsDate = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}00Z`;
const icsTxt = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

// items : [{ id, debut, duree_min, titre, description, lieu, url }]
export function telechargerIcs(items, nomFichier = "seances.ics") {
  const lignes = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Unia//Carrefour du savoir//FR", "CALSCALE:GREGORIAN"];
  items.forEach((it) => {
    const debut = new Date(it.debut);
    const fin = new Date(debut.getTime() + (it.duree_min || 60) * 60000);
    lignes.push("BEGIN:VEVENT", `UID:${it.id}@unia-carrefour`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(debut)}`, `DTEND:${icsDate(fin)}`, `SUMMARY:${icsTxt(it.titre)}`);
    if (it.description) lignes.push(`DESCRIPTION:${icsTxt(it.description)}`);
    if (it.lieu) lignes.push(`LOCATION:${icsTxt(it.lieu)}`);
    if (it.url) lignes.push(`URL:${it.url}`);
    lignes.push("BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", `DESCRIPTION:${icsTxt(it.titre)}`, "END:VALARM", "END:VEVENT");
  });
  lignes.push("END:VCALENDAR");
  const url = URL.createObjectURL(new Blob([lignes.join("\r\n")], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nomFichier;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Ouvrir un fichier privé (lien signé de 5 minutes) ----------
export async function ouvrirFichier(bucket, chemin) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(chemin, 300);
  if (error) throw error;
  window.open(data.signedUrl, "_blank", "noopener");
}

// ---------- Signaler un contenu ----------
// Renvoie true si le signalement a été envoyé.
export async function signaler({ profile, type, id, apercu, invite, merci }) {
  const motif = window.prompt(invite);
  if (!motif || !motif.trim()) return false;
  const { error } = await supabase.from("savoir_signalements").insert({
    association_id: profile.association_id, cible_type: type, cible_id: id, apercu: String(apercu || "").slice(0, 200),
    motif: motif.trim().slice(0, 500), auteur_id: profile.id, auteur_nom: profile.nom_complet,
  });
  if (error) throw error;
  if (merci) alert(merci);
  return true;
}

// ---------- Ressources de Jeunesse & tutorat dans la recherche unique ----------
const CAT_DOMAINE = { cours: "academique", remise_niveau: "academique", orientation: "academique", developpement_personnel: "personnel" };
const NIV_PUBLICS = { primaire: ["eleves"], secondaire: ["eleves"], cegep: ["etudiants"], universite: ["universitaires"], tous: ["eleves", "etudiants"] };
export function ressourcesJeunesse(liste) {
  return (liste || []).map((r) => ({
    id: "j-" + r.id, _jeunesse: true, _origine: r, titre: r.titre, description: r.description, domaine: CAT_DOMAINE[r.categorie] || "academique",
    theme: r.matiere, publics: NIV_PUBLICS[r.niveau] || ["eleves"], type: ["pdf", "video", "lien", "document"].includes(r.type) ? r.type : "document",
    url: r.url, storage_path: r.storage_path, statut: "publiee", depose_par_nom: r.depose_par_nom, created_at: r.created_at,
  }));
}
