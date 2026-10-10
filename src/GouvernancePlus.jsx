// =====================================================================
// GouvernancePlus.jsx — Documents de gouvernance, Assemblées générales,
// Organigramme (2026-10-10)
// =====================================================================
// Demandes de l'utilisateur (suggestions retenues) — voir
// sql/2026-10-10h_gouvernance_documents_ag.sql :
//  • DocumentsGouvernance : statuts, règlement intérieur, PV d'AG… avec
//    version et date d'adoption ; version en vigueur + historique replié.
//  • Assemblees : préparation → convocation (notification) → feuille de
//    présence et quorum → résolutions → compte rendu → PV PDF officiel
//    archivé dans les documents de gouvernance.
//  • Organigramme : bureau en fonction (président en tête) et responsables
//    de rubriques ; option d'affichage sur la vitrine publique.
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import { FileText, Upload, Trash2, ChevronDown, ChevronRight, Plus, Megaphone, UserCheck, Gavel, FileDown, CheckCircle2, Clock, Globe, Crown } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Card, Btn, Field, inputStyle, useLang, friendlyError, formatEventDateTime, datetimeLocalToISO, TEAL, TEAL_LIGHT, RED } from "./shared";
import { pdfTexte, enTeteOfficiel, piedsDePageOfficiels, couleurAssociation } from "./pdfOfficiel";

const TXT = {
  fr: {
    // Documents
    doc_types: { statuts: "Statuts", reglement: "Règlement intérieur", pv_ag: "PV d'assemblées générales", charte: "Chartes et politiques", autre: "Autres documents" },
    doc_add: "Ajouter un document", doc_type: "Type", doc_title: "Titre", doc_version: "Version (ex. 2.0)", doc_date: "Date d'adoption", doc_file: "Fichier",
    doc_in_force: "En vigueur", doc_versions: "Versions précédentes ({n})", doc_none: "Aucun document pour l'instant.",
    doc_open: "Ouvrir", doc_delete_confirm: "Supprimer définitivement « {t} » ?", doc_adopted: "adopté le {d}", doc_v: "version {v}",
    doc_missing: "Choisissez un fichier et indiquez un titre.",
    // AG
    ag_new: "Nouvelle assemblée", ag_title: "Titre", ag_title_default: "Assemblée générale ordinaire {y}",
    ag_type: "Type", ag_ordinaire: "Ordinaire", ag_extra: "Extraordinaire",
    ag_date: "Date et heure", ag_place: "Lieu", ag_visio: "Lien de visioconférence (optionnel)",
    ag_agenda: "Ordre du jour (un point par ligne)", ag_quorum: "Quorum (% des membres actifs)",
    ag_create: "Créer", ag_cancel: "Annuler", ag_none: "Aucune assemblée pour l'instant.",
    st_preparation: "En préparation", st_convoquee: "Convoquée", st_tenue: "Tenue", st_cloturee: "Clôturée",
    ag_convoke: "Convoquer les membres", ag_convoke_confirm: "Envoyer la convocation à tous les membres actifs ?", ag_convoked: "Convocation envoyée à {n} compte(s).",
    ag_held: "Marquer la séance comme tenue", ag_delete: "Supprimer", ag_delete_confirm: "Supprimer cette assemblée et sa feuille de présence ?",
    ag_attendance: "Feuille de présence", ag_present: "Présent", ag_represented: "Représenté", ag_excused: "Excusé", ag_by: "par {nom}",
    ag_choose_proxy: "Mandataire…", ag_quorum_line: "{p} présent(s) + {r} représenté(s) = {t} sur {a} membre(s) actif(s)",
    ag_quorum_ok: "Quorum atteint ({q} requis)", ag_quorum_ko: "Quorum non atteint : {q} requis", ag_no_quorum: "Pas de quorum exigé",
    ag_resolutions: "Résolutions votées en séance", ag_res_title: "Résolution", ag_res_for: "Pour", ag_res_against: "Contre", ag_res_abst: "Abstentions",
    ag_res_add: "Ajouter la résolution", ag_adopted: "Adoptée", ag_rejected: "Rejetée", ag_res_none: "Aucune résolution enregistrée.",
    ag_minutes: "Compte rendu des débats", ag_save: "Enregistrer",
    ag_close: "Clôturer et archiver le PV", ag_close_confirm: "Clôturer l'assemblée ? Le procès-verbal sera généré et archivé dans les documents de gouvernance.",
    ag_pv: "Procès-verbal (PDF)", ag_pv_open: "Ouvrir le PV archivé", ag_closed: "Assemblée clôturée, PV archivé.",
    pdf_title_o: "Procès-verbal de l'assemblée générale ordinaire", pdf_title_e: "Procès-verbal de l'assemblée générale extraordinaire",
    pdf_info: "Séance", pdf_date: "Date", pdf_place: "Lieu", pdf_convoked: "Convocation envoyée le",
    pdf_attendance: "Présence et quorum", pdf_agenda: "Ordre du jour", pdf_res: "Résolutions", pdf_result: "Résultat",
    pdf_minutes: "Compte rendu", pdf_list: "Liste des membres présents ou représentés",
    pdf_sign: "Signatures", pdf_president: "Président(e) de séance", pdf_secretary: "Secrétaire de séance", pdf_signature: "Signature",
    sig_title: "Signatures électroniques du PV", sig_as_president: "Signer comme président(e) de séance", sig_as_secretary: "Signer comme secrétaire de séance",
    sig_confirm: "Je soussigné(e) {nom}, {role}, atteste l'exactitude du procès-verbal de « {titre} » (présences, résolutions, compte rendu). Signer électroniquement ?",
    sig_signed: "signé par {nom} le {d}", sig_wait: "en attente", sig_needed: "Le président et le secrétaire de séance doivent signer électroniquement avant la clôture.",
    sig_locked: "PV signé : présences, résolutions et compte rendu sont figés.",
    pdf_esign: "Signé électroniquement par {nom} le {d}", pdf_ref: "réf. {h}", pdf_manual: "Signature manuscrite (facultative)",
    // Organigramme
    org_board: "Bureau", org_resp: "Responsables de rubriques", org_none: "Aucun membre du bureau en fonction.",
    org_vitrine: "Afficher aussi les responsables de rubriques sur la vitrine publique",
    org_vitrine_help: "Le bureau en fonction est déjà affiché sur la vitrine publique (si elle est activée).",
    org_vitrine_sql: "Option indisponible : exécutez d'abord sql/2026-10-10h_gouvernance_documents_ag.sql.",
    rubriques: { inscription: "Inscription", tontine: "Cotisation", collation: "Présence", fonds_urgence: "Fonds d'urgence", fonds_secours: "Fonds de secours" },
    resp_label: "Responsable",
    sql: "Fonction indisponible : exécutez d'abord sql/2026-10-10h_gouvernance_documents_ag.sql dans Supabase.",
  },
  en: {
    doc_types: { statuts: "Bylaws", reglement: "Internal rules", pv_ag: "General meeting minutes", charte: "Charters and policies", autre: "Other documents" },
    doc_add: "Add a document", doc_type: "Type", doc_title: "Title", doc_version: "Version (e.g. 2.0)", doc_date: "Adoption date", doc_file: "File",
    doc_in_force: "In force", doc_versions: "Previous versions ({n})", doc_none: "No document yet.",
    doc_open: "Open", doc_delete_confirm: "Permanently delete \"{t}\"?", doc_adopted: "adopted on {d}", doc_v: "version {v}",
    doc_missing: "Choose a file and enter a title.",
    ag_new: "New general meeting", ag_title: "Title", ag_title_default: "Annual general meeting {y}",
    ag_type: "Type", ag_ordinaire: "Ordinary", ag_extra: "Extraordinary",
    ag_date: "Date and time", ag_place: "Place", ag_visio: "Video link (optional)",
    ag_agenda: "Agenda (one item per line)", ag_quorum: "Quorum (% of active members)",
    ag_create: "Create", ag_cancel: "Cancel", ag_none: "No general meeting yet.",
    st_preparation: "In preparation", st_convoquee: "Convened", st_tenue: "Held", st_cloturee: "Closed",
    ag_convoke: "Convene members", ag_convoke_confirm: "Send the notice to all active members?", ag_convoked: "Notice sent to {n} account(s).",
    ag_held: "Mark the meeting as held", ag_delete: "Delete", ag_delete_confirm: "Delete this meeting and its attendance sheet?",
    ag_attendance: "Attendance sheet", ag_present: "Present", ag_represented: "Represented", ag_excused: "Excused", ag_by: "by {nom}",
    ag_choose_proxy: "Proxy holder…", ag_quorum_line: "{p} present + {r} represented = {t} of {a} active member(s)",
    ag_quorum_ok: "Quorum reached ({q} required)", ag_quorum_ko: "Quorum not reached: {q} required", ag_no_quorum: "No quorum required",
    ag_resolutions: "Resolutions voted in session", ag_res_title: "Resolution", ag_res_for: "For", ag_res_against: "Against", ag_res_abst: "Abstentions",
    ag_res_add: "Add resolution", ag_adopted: "Adopted", ag_rejected: "Rejected", ag_res_none: "No resolution recorded.",
    ag_minutes: "Minutes of the discussions", ag_save: "Save",
    ag_close: "Close and file the minutes", ag_close_confirm: "Close the meeting? The minutes will be generated and filed in the governance documents.",
    ag_pv: "Minutes (PDF)", ag_pv_open: "Open filed minutes", ag_closed: "Meeting closed, minutes filed.",
    pdf_title_o: "Minutes of the annual general meeting", pdf_title_e: "Minutes of the extraordinary general meeting",
    pdf_info: "Session", pdf_date: "Date", pdf_place: "Place", pdf_convoked: "Notice sent on",
    pdf_attendance: "Attendance and quorum", pdf_agenda: "Agenda", pdf_res: "Resolutions", pdf_result: "Result",
    pdf_minutes: "Minutes", pdf_list: "Members present or represented",
    pdf_sign: "Signatures", pdf_president: "Chair of the meeting", pdf_secretary: "Secretary of the meeting", pdf_signature: "Signature",
    sig_title: "Electronic signatures of the minutes", sig_as_president: "Sign as chair of the meeting", sig_as_secretary: "Sign as secretary of the meeting",
    sig_confirm: "I, {nom}, {role}, certify that the minutes of \"{titre}\" are accurate (attendance, resolutions, minutes). Sign electronically?",
    sig_signed: "signed by {nom} on {d}", sig_wait: "pending", sig_needed: "The chair and the secretary of the meeting must sign electronically before closing.",
    sig_locked: "Minutes signed: attendance, resolutions and minutes are locked.",
    pdf_esign: "Electronically signed by {nom} on {d}", pdf_ref: "ref. {h}", pdf_manual: "Handwritten signature (optional)",
    org_board: "Board", org_resp: "Section managers", org_none: "No board member in office.",
    org_vitrine: "Also show section managers on the public page",
    org_vitrine_help: "The current board is already shown on the public page (if enabled).",
    org_vitrine_sql: "Option unavailable: first run sql/2026-10-10h_gouvernance_documents_ag.sql.",
    rubriques: { inscription: "Registration", tontine: "Contributions", collation: "Refreshments", fonds_urgence: "Emergency fund", fonds_secours: "Relief fund" },
    resp_label: "Manager",
    sql: "Feature unavailable: first run sql/2026-10-10h_gouvernance_documents_ag.sql in Supabase.",
  },
};
const useT = () => { const { t, lang } = useLang(); return { t, lang, P: TXT[lang === "en" ? "en" : "fr"] }; };
const fill = (s, v) => Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(String(x)), s);
const msgErr = (e, t, P) => (e?.code === "P0001" ? e.message : e?.code === "PGRST205" || e?.code === "42P01" || e?.code === "PGRST202" ? P.sql : friendlyError(e, t));
const dateLocale = (s) => { const j = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(String(s || "")); return j ? new Date(+j[1], +j[2] - 1, +j[3]) : null; };
const fmtJour = (d, lang) => (d ? d.toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA", { day: "numeric", month: "long", year: "numeric" }) : "");
const small = { padding: "5px 12px", fontSize: 12 };
const muted = { fontSize: 12, color: "#686F7D" };

async function ouvrirFichier(path, t) {
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 120);
  if (error) alert(friendlyError(error, t)); else window.open(data.signedUrl, "_blank", "noopener");
}
async function deposerFichier(associationId, fichier, nom) {
  const path = `${associationId}/gouvernance/${Date.now()}_${String(nom).normalize("NFD").replace(/[^A-Za-z0-9._-]+/g, "_")}`;
  const { error } = await supabase.storage.from("documents").upload(path, fichier, { contentType: fichier.type || "application/pdf" });
  if (error) throw error;
  return path;
}

// =====================================================================
// Documents de gouvernance
// =====================================================================
export function DocumentsGouvernance({ profile, isBureau }) {
  const { t, lang, P } = useT();
  const [docs, setDocs] = useState([]);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(null);
  const [ouverts, setOuverts] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("gouvernance_documents").select("*").eq("association_id", profile.association_id).order("date_adoption", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
    if (error) { setErr(msgErr(error, t, P)); return; }
    setErr(""); setDocs(data || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  async function ajouter() {
    if (!form?.file || !form.titre.trim()) { alert(P.doc_missing); return; }
    setBusy(true);
    try {
      const path = await deposerFichier(profile.association_id, form.file, form.file.name);
      const { error } = await supabase.from("gouvernance_documents").insert({
        association_id: profile.association_id, type: form.type, titre: form.titre.trim(), version: form.version.trim() || null,
        date_adoption: form.date || null, storage_path: path, nom_fichier: form.file.name, ajoute_par: profile.id, ajoute_par_nom: profile.nom_complet,
      });
      if (error) throw error;
      setForm(null); load();
    } catch (e) { alert(msgErr(e, t, P)); } finally { setBusy(false); }
  }
  async function supprimer(d) {
    if (!window.confirm(fill(P.doc_delete_confirm, { t: d.titre }))) return;
    const { error } = await supabase.from("gouvernance_documents").delete().eq("id", d.id);
    if (error) { alert(msgErr(error, t, P)); return; }
    await supabase.storage.from("documents").remove([d.storage_path]);
    load();
  }

  const ligne = (d) => (
    <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid #F0F1F3", flexWrap: "wrap" }}>
      <FileText size={15} color={TEAL} />
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{d.titre}</div>
        <div style={muted}>{[d.version ? fill(P.doc_v, { v: d.version }) : null, d.date_adoption ? fill(P.doc_adopted, { d: fmtJour(dateLocale(d.date_adoption), lang) }) : null].filter(Boolean).join(" · ")}</div>
      </div>
      <Btn variant="outline" style={small} onClick={() => ouvrirFichier(d.storage_path, t)}>{P.doc_open}</Btn>
      {isBureau && <button onClick={() => supprimer(d)} style={{ background: "none", border: "none", color: RED, cursor: "pointer" }}><Trash2 size={14} /></button>}
    </div>
  );

  return (
    <div>
      {err && <p style={{ color: RED, fontSize: 12.5 }}>{err}</p>}
      {isBureau && !form && <div style={{ marginBottom: 14 }}><Btn onClick={() => setForm({ type: "statuts", titre: "", version: "", date: "", file: null })}><Upload size={14} /> {P.doc_add}</Btn></div>}
      {form && (
        <Card style={{ marginBottom: 16, maxWidth: 640 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 14px" }}>
            <Field label={P.doc_type}>
              <select style={inputStyle} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(P.doc_types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label={P.doc_title}><input style={inputStyle} value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} /></Field>
            <Field label={P.doc_version}><input style={inputStyle} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field>
            <Field label={P.doc_date}><input type="date" style={inputStyle} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          </div>
          <Field label={P.doc_file}><input type="file" accept=".pdf,image/*,.doc,.docx" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null, titre: form.titre || (e.target.files?.[0]?.name || "").replace(/\.[^.]+$/, "") })} /></Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn disabled={busy} onClick={ajouter}>{P.doc_add}</Btn>
            <Btn variant="outline" onClick={() => setForm(null)}>{P.ag_cancel}</Btn>
          </div>
        </Card>
      )}
      {docs.length === 0 && !err && <p style={{ fontSize: 13, color: "#9AA2B5", fontStyle: "italic" }}>{P.doc_none}</p>}
      <div style={{ display: "grid", gap: 12 }}>
        {Object.keys(P.doc_types).map((type) => {
          const liste = docs.filter((d) => d.type === type);
          if (!liste.length) return null;
          // Statuts et règlement : une seule version en vigueur, les autres
          // en historique. Les autres types : tous listés.
          const unique = type === "statuts" || type === "reglement";
          const vigueur = unique ? [liste[0]] : liste;
          const anciens = unique ? liste.slice(1) : [];
          return (
            <Card key={type} style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--primary)", marginBottom: 4 }}>{P.doc_types[type]}</div>
              {unique && <div style={{ fontSize: 11, fontWeight: 700, color: TEAL, textTransform: "uppercase", letterSpacing: ".04em" }}>{P.doc_in_force}</div>}
              {vigueur.map(ligne)}
              {anciens.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <button onClick={() => setOuverts({ ...ouverts, [type]: !ouverts[type] })} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12.5, fontWeight: 600, color: "#5B6270", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {ouverts[type] ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {fill(P.doc_versions, { n: anciens.length })}
                  </button>
                  {ouverts[type] && <div style={{ opacity: 0.8 }}>{anciens.map(ligne)}</div>}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// Assemblées générales
// =====================================================================
async function exporterPvAg({ ag, presences, members, signatures = [], association, P, lang, sortie = "telecharger" }) {
  const [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const { jsPDF } = jsPDFmod;
  const autoTable = autoTableMod.default || autoTableMod;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 48, W = doc.internal.pageSize.getWidth() - 2 * M;
  const accent = couleurAssociation(association);
  const T = pdfTexte;
  const nom = (id) => members.find((m) => m.id === id)?.nom || "—";
  let y = await enTeteOfficiel(doc, association, { titre: ag.type === "extraordinaire" ? P.pdf_title_e : P.pdf_title_o, sousTitre: ag.titre, marge: M });
  const saut = (h) => { if (y + h > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 56; } };
  const section = (titre) => {
    saut(40); y += 10;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(0, 0, 0);
    doc.text(T(titre).toUpperCase(), M, y);
    doc.setDrawColor(...accent); doc.setLineWidth(1.2); doc.line(M, y + 5, M + W, y + 5);
    y += 16; doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  };
  const tableau = (head, body, cols = {}) => {
    autoTable(doc, { startY: y, head: head ? [head.map(T)] : undefined, body: body.map((r) => r.map(T)), theme: head ? "grid" : "plain",
      styles: { font: "helvetica", fontSize: 10, cellPadding: 5, textColor: [0, 0, 0], lineColor: [220, 224, 230], lineWidth: head ? 0.5 : 0 },
      headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold" },
      columnStyles: head ? cols : { 0: { cellWidth: 170, fontStyle: "bold" } }, margin: { left: M, right: M, top: 56, bottom: 60 } });
    y = doc.lastAutoTable.finalY + 8;
  };
  const para = (txt, style = "normal") => {
    doc.setFont("helvetica", style); doc.setFontSize(10.5);
    const l = doc.splitTextToSize(T(txt), W); saut(l.length * 14); doc.text(l, M, y + 4, { lineHeightFactor: 1.35 }); y += l.length * 14 + 6;
  };
  const actifs = members.filter((m) => m.statut === "Actif").length;
  const pres = presences.filter((x) => x.mode === "present"), rep = presences.filter((x) => x.mode === "represente");
  const q = ag.quorum_pct != null ? Math.ceil(actifs * Number(ag.quorum_pct) / 100) : null;

  section(P.pdf_info);
  tableau(null, [[P.pdf_date, ag.date_ag ? formatEventDateTime(ag.date_ag, lang) : "—"], [P.pdf_place, [ag.lieu, ag.lien_visio].filter(Boolean).join(" - ") || "—"], [P.pdf_convoked, ag.convoquee_le ? formatEventDateTime(ag.convoquee_le, lang) : "—"]]);
  section(P.pdf_attendance);
  para(fill(P.ag_quorum_line, { p: pres.length, r: rep.length, t: pres.length + rep.length, a: actifs }));
  para(q == null ? P.ag_no_quorum : (pres.length + rep.length >= q ? fill(P.ag_quorum_ok, { q }) : fill(P.ag_quorum_ko, { q })), "bold");
  if (presences.length) {
    tableau([P.pdf_list, ""], [...pres, ...rep].map((x) => [nom(x.member_id), x.mode === "present" ? P.ag_present : `${P.ag_represented} ${fill(P.ag_by, { nom: nom(x.mandataire_id) })}`]));
  }
  const points = String(ag.ordre_du_jour || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (points.length) { section(P.pdf_agenda); points.forEach((pt, i) => para(`${i + 1}. ${pt}`)); }
  const res = Array.isArray(ag.resolutions) ? ag.resolutions : [];
  section(P.pdf_res);
  if (res.length) {
    tableau([P.ag_res_title, P.ag_res_for, P.ag_res_against, P.ag_res_abst, P.pdf_result], res.map((r) => [r.titre, String(r.pour || 0), String(r.contre || 0), String(r.abstention || 0), Number(r.pour) > Number(r.contre) ? P.ag_adopted : P.ag_rejected]), { 0: { cellWidth: W * 0.44 }, 4: { fontStyle: "bold" } });
  } else para(P.ag_res_none, "italic");
  if (ag.compte_rendu) { section(P.pdf_minutes); para(ag.compte_rendu); }
  section(P.pdf_sign);
  saut(90); y += 6;
  const BW = (W - 20) / 2;
  [["president", P.pdf_president], ["secretaire", P.pdf_secretary]].forEach(([code, role], i) => {
    const bx = M + i * (BW + 20);
    const sg = signatures.find((x) => x.role === code);
    doc.setDrawColor(200, 205, 212); doc.setLineWidth(0.6); doc.roundedRect(bx, y, BW, 80, 4, 4, "S");
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(T(role), bx + 10, y + 16);
    if (sg) {
      doc.setFontSize(8.5); doc.text(doc.splitTextToSize(T(fill(P.pdf_esign, { nom: sg.nom || "", d: formatEventDateTime(sg.signe_le, lang) })), BW - 20).slice(0, 2), bx + 10, y + 32);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.text(T(fill(P.pdf_ref, { h: String(sg.empreinte || "").slice(0, 16) })), bx + 10, y + 52);
    }
    doc.setDrawColor(0, 0, 0); doc.line(bx + 10, y + 62, bx + BW - 10, y + 62);
    doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.text(T(P.pdf_manual), bx + 10, y + 72);
  });
  piedsDePageOfficiels(doc, association, { marge: M, texte: ag.titre, libellePage: (p, n) => `${p} / ${n}` });
  const fichier = `PV_${String(ag.titre || "AG").normalize("NFD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}.pdf`;
  if (sortie === "blob") return { blob: doc.output("blob"), fichier };
  doc.save(fichier);
  return null;
}

function CarteAssemblee({ ag, presences, members, signatures = [], isBureau, association, profile, onChanged }) {
  const { t, lang, P } = useT();
  const [ouvert, setOuvert] = useState(ag.statut !== "cloturee");
  const [cr, setCr] = useState(ag.compte_rendu || "");
  const [res, setRes] = useState({ titre: "", pour: "", contre: "", abstention: "" });
  const [busy, setBusy] = useState(false);
  const actifs = members.filter((m) => m.statut === "Actif");
  const pres = presences.filter((x) => x.mode === "present").length;
  const rep = presences.filter((x) => x.mode === "represente").length;
  const q = ag.quorum_pct != null ? Math.ceil(actifs.length * Number(ag.quorum_pct) / 100) : null;
  // Contenu figé dès la première signature (sql/2026-10-10i).
  const modifiable = isBureau && ag.statut !== "cloturee" && signatures.length === 0;
  const sigDe = (role) => signatures.find((x) => x.role === role);
  const signeTout = !!sigDe("president") && !!sigDe("secretaire");
  async function signer(role) {
    const libelle = role === "president" ? P.pdf_president : P.pdf_secretary;
    if (!window.confirm(fill(P.sig_confirm, { nom: profile.nom_complet || "", role: libelle, titre: ag.titre }))) return;
    if (cr !== (ag.compte_rendu || "")) { const ok = await maj({ compte_rendu: cr }); if (!ok) return; }
    const { error } = await supabase.rpc("signer_pv_assemblee", { p_id: ag.id, p_role: role });
    if (error) { alert(msgErr(error, t, P)); return; }
    onChanged();
  }
  const enSeance = ag.statut === "convoquee" || ag.statut === "tenue";
  const resolutions = Array.isArray(ag.resolutions) ? ag.resolutions : [];
  const stColor = { preparation: "#B7791F", convoquee: "#2B6CB0", tenue: TEAL, cloturee: "#4A5468" }[ag.statut];

  async function maj(patch) {
    const { error } = await supabase.from("assemblees").update(patch).eq("id", ag.id);
    if (error) { alert(msgErr(error, t, P)); return false; }
    onChanged(); return true;
  }
  async function convoquer() {
    if (!window.confirm(P.ag_convoke_confirm)) return;
    const { data, error } = await supabase.rpc("convoquer_assemblee", { p_id: ag.id });
    if (error) { alert(msgErr(error, t, P)); return; }
    alert(fill(P.ag_convoked, { n: data ?? 0 })); onChanged();
  }
  async function pointer(memberId, mode, mandataire = null) {
    const ex = presences.find((x) => x.member_id === memberId);
    if (ex && ex.mode === mode && !mandataire) {
      await supabase.from("assemblee_presences").delete().eq("id", ex.id);
    } else {
      const { error } = await supabase.from("assemblee_presences").upsert({ association_id: profile.association_id, assemblee_id: ag.id, member_id: memberId, mode, mandataire_id: mode === "represente" ? mandataire : null }, { onConflict: "assemblee_id,member_id" });
      if (error) { alert(msgErr(error, t, P)); return; }
    }
    onChanged();
  }
  async function ajouterResolution() {
    if (!res.titre.trim()) return;
    const nouv = [...resolutions, { titre: res.titre.trim(), pour: Number(res.pour) || 0, contre: Number(res.contre) || 0, abstention: Number(res.abstention) || 0 }];
    if (await maj({ resolutions: nouv })) setRes({ titre: "", pour: "", contre: "", abstention: "" });
  }
  async function cloturer() {
    if (!window.confirm(P.ag_close_confirm)) return;
    setBusy(true);
    try {
      if (cr !== (ag.compte_rendu || "")) await maj({ compte_rendu: cr });
      const out = await exporterPvAg({ ag: { ...ag, compte_rendu: cr }, presences, members, signatures, association, P, lang, sortie: "blob" });
      const path = await deposerFichier(profile.association_id, out.blob, out.fichier);
      const dateAg = ag.date_ag ? new Date(ag.date_ag) : new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const { data: d, error } = await supabase.from("gouvernance_documents").insert({
        association_id: profile.association_id, type: "pv_ag", titre: `PV - ${ag.titre}`, date_adoption: `${dateAg.getFullYear()}-${pad(dateAg.getMonth() + 1)}-${pad(dateAg.getDate())}`,
        storage_path: path, nom_fichier: out.fichier, assemblee_id: ag.id, ajoute_par: profile.id, ajoute_par_nom: profile.nom_complet,
      }).select("id").single();
      if (error) throw error;
      await maj({ statut: "cloturee", pv_document_id: d.id });
      alert(P.ag_closed);
    } catch (e) { alert(msgErr(e, t, P)); } finally { setBusy(false); }
  }
  async function ouvrirPv() {
    const { data } = await supabase.from("gouvernance_documents").select("storage_path").eq("id", ag.pv_document_id).maybeSingle();
    if (data?.storage_path) ouvrirFichier(data.storage_path, t);
  }
  async function supprimer() {
    if (!window.confirm(P.ag_delete_confirm)) return;
    const { error } = await supabase.from("assemblees").delete().eq("id", ag.id);
    if (error) alert(msgErr(error, t, P)); else onChanged();
  }

  const points = String(ag.ordre_du_jour || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return (
    <Card style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
      <button onClick={() => setOuvert((o) => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: ouvert ? "#F8FAFB" : "white", border: "none", cursor: "pointer", textAlign: "left" }}>
        {ouvert ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{ag.titre}</div>
          <div style={muted}>{[ag.type === "extraordinaire" ? P.ag_extra : P.ag_ordinaire, ag.date_ag ? formatEventDateTime(ag.date_ag, lang) : null, ag.lieu].filter(Boolean).join(" · ")}</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: stColor, border: `1px solid ${stColor}`, borderRadius: 999, padding: "1px 8px" }}>{P["st_" + ag.statut]}</span>
      </button>
      {ouvert && (
        <div style={{ padding: "12px 18px 18px", borderTop: "1px solid #EEF0F3", display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {isBureau && ag.statut === "preparation" && <Btn style={small} onClick={convoquer}><Megaphone size={13} /> {P.ag_convoke}</Btn>}
            {isBureau && ag.statut === "convoquee" && <Btn variant="outline" style={small} onClick={() => maj({ statut: "tenue" })}><CheckCircle2 size={13} /> {P.ag_held}</Btn>}
            <Btn variant="outline" style={small} onClick={() => exporterPvAg({ ag: { ...ag, compte_rendu: cr }, presences, members, signatures, association, P, lang }).catch((e) => alert(friendlyError(e, t)))}><FileDown size={13} /> {P.ag_pv}</Btn>
            {ag.pv_document_id && <Btn variant="outline" style={small} onClick={ouvrirPv}><FileText size={13} /> {P.ag_pv_open}</Btn>}
            {isBureau && ag.statut !== "cloturee" && <button onClick={supprimer} style={{ background: "none", border: `1px solid ${RED}`, color: RED, borderRadius: 999, fontSize: 11, padding: "2px 8px", cursor: "pointer" }}><Trash2 size={11} /> {P.ag_delete}</button>}
          </div>
          {ag.lien_visio && <a href={ag.lien_visio} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: TEAL }}>{ag.lien_visio}</a>}
          {points.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{P.pdf_agenda}</div>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.6 }}>{points.map((pt, i) => <li key={i}>{pt}</li>)}</ol>
            </div>
          )}

          {/* Présence et quorum */}
          {(enSeance || ag.statut === "cloturee") && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}><UserCheck size={14} color={TEAL} /> {P.ag_attendance}</div>
              <div style={{ fontSize: 12.5 }}>{fill(P.ag_quorum_line, { p: pres, r: rep, t: pres + rep, a: actifs.length })}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: q == null || pres + rep >= q ? TEAL : "#B7791F", display: "flex", alignItems: "center", gap: 6, margin: "4px 0 8px" }}>
                {q == null ? P.ag_no_quorum : pres + rep >= q ? <><CheckCircle2 size={13} /> {fill(P.ag_quorum_ok, { q })}</> : <><Clock size={13} /> {fill(P.ag_quorum_ko, { q })}</>}
              </div>
              {modifiable && enSeance && (
                <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #EEF0F3", borderRadius: 8 }}>
                  {actifs.map((m) => {
                    const x = presences.find((pp) => pp.member_id === m.id);
                    const b = (mode, label) => (
                      <button onClick={() => pointer(m.id, mode, mode === "represente" ? x?.mandataire_id || null : null)} style={{ fontSize: 11.5, padding: "3px 9px", borderRadius: 999, cursor: "pointer", border: "1px solid #DCE0E8", background: x?.mode === mode ? "var(--primary)" : "white", color: x?.mode === mode ? "white" : "#2C3A50" }}>{label}</button>
                    );
                    return (
                      <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderTop: "1px solid #F4F5F7", flexWrap: "wrap" }}>
                        <span style={{ flex: 1, minWidth: 140, fontSize: 13 }}>{m.nom}</span>
                        {b("present", P.ag_present)}
                        {b("excuse", P.ag_excused)}
                        <select value={x?.mode === "represente" ? x.mandataire_id || "" : ""} onChange={(e) => e.target.value && pointer(m.id, "represente", e.target.value)} style={{ ...inputStyle, width: 150, padding: "3px 6px", fontSize: 11.5 }}>
                          <option value="">{x?.mode === "represente" ? P.ag_represented : P.ag_choose_proxy}</option>
                          {actifs.filter((o) => o.id !== m.id).map((o) => <option key={o.id} value={o.id}>{P.ag_represented} {fill(P.ag_by, { nom: o.nom })}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Résolutions */}
          {(enSeance || resolutions.length > 0) && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><Gavel size={14} color={TEAL} /> {P.ag_resolutions}</div>
              {resolutions.length === 0 && <p style={{ ...muted, fontStyle: "italic", margin: 0 }}>{P.ag_res_none}</p>}
              {resolutions.map((r, i) => (
                <div key={i} style={{ fontSize: 13, padding: "5px 0", borderTop: "1px solid #F4F5F7" }}>
                  <b>{i + 1}. {r.titre}</b> — {P.ag_res_for} {r.pour} · {P.ag_res_against} {r.contre} · {P.ag_res_abst} {r.abstention} · <b>{Number(r.pour) > Number(r.contre) ? P.ag_adopted : P.ag_rejected}</b>
                </div>
              ))}
              {modifiable && enSeance && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                  <input placeholder={P.ag_res_title} style={{ ...inputStyle, flex: "1 1 220px" }} value={res.titre} onChange={(e) => setRes({ ...res, titre: e.target.value })} />
                  {["pour", "contre", "abstention"].map((k) => <input key={k} type="number" min={0} placeholder={P[k === "pour" ? "ag_res_for" : k === "contre" ? "ag_res_against" : "ag_res_abst"]} style={{ ...inputStyle, width: 90 }} value={res[k]} onChange={(e) => setRes({ ...res, [k]: e.target.value })} />)}
                  <Btn style={small} onClick={ajouterResolution}><Plus size={13} /> {P.ag_res_add}</Btn>
                </div>
              )}
            </div>
          )}

          {/* Signatures électroniques du PV puis clôture */}
          {(ag.statut === "tenue" || ag.statut === "cloturee") && (
            <div style={{ padding: 10, borderRadius: 8, background: "#F8FAFB" }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>✍️ {P.sig_title}</div>
              {[["president", P.pdf_president, P.sig_as_president], ["secretaire", P.pdf_secretary, P.sig_as_secretary]].map(([code, libelle, bouton]) => {
                const sg = sigDe(code);
                return (
                  <div key={code} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5, marginBottom: 4 }}>
                    {sg ? <CheckCircle2 size={13} color={TEAL} /> : <Clock size={13} color="#B7791F" />}
                    <b>{libelle}</b>
                    <span style={{ color: sg ? TEAL : "#B7791F" }}>{sg ? fill(P.sig_signed, { nom: sg.nom || "", d: formatEventDateTime(sg.signe_le, lang) }) : P.sig_wait}</span>
                    {!sg && isBureau && ag.statut === "tenue" && !signatures.some((x) => x.profile_id === profile.id) && (
                      <Btn style={small} onClick={() => signer(code)}>{bouton}</Btn>
                    )}
                  </div>
                );
              })}
              {signatures.length > 0 && ag.statut !== "cloturee" && <p style={{ ...muted, margin: "4px 0 0" }}>{P.sig_locked}</p>}
              {ag.statut === "tenue" && isBureau && (
                <div style={{ marginTop: 8 }}>
                  {!signeTout && <p style={{ fontSize: 12, color: "#B7791F", margin: "0 0 6px" }}>{P.sig_needed}</p>}
                  <Btn style={small} disabled={busy || !signeTout} onClick={cloturer}><FileDown size={13} /> {P.ag_close}</Btn>
                </div>
              )}
            </div>
          )}

          {/* Compte rendu */}
          {(enSeance || ag.compte_rendu) && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{P.ag_minutes}</div>
              {modifiable ? (
                <>
                  <textarea style={{ ...inputStyle, minHeight: 110 }} value={cr} onChange={(e) => setCr(e.target.value)} />
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <Btn variant="outline" style={small} onClick={() => maj({ compte_rendu: cr })}>{P.ag_save}</Btn>
                  </div>
                </>
              ) : <p style={{ fontSize: 13, whiteSpace: "pre-wrap", margin: 0 }}>{ag.compte_rendu}</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function Assemblees({ profile, isBureau, association, members }) {
  const { t, P } = useT();
  const [ags, setAgs] = useState([]);
  const [pres, setPres] = useState([]);
  const [sigs, setSigs] = useState([]);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    const [{ data: a, error }, { data: p }, sg] = await Promise.all([
      supabase.from("assemblees").select("*").eq("association_id", profile.association_id).order("date_ag", { ascending: false, nullsFirst: true }),
      supabase.from("assemblee_presences").select("*").eq("association_id", profile.association_id),
      supabase.from("assemblee_signatures").select("*").eq("association_id", profile.association_id),
    ]);
    setSigs(sg.error ? [] : sg.data || []);
    if (error) { setErr(msgErr(error, t, P)); return; }
    setErr(""); setAgs(a || []); setPres(p || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  async function creer() {
    if (!form.titre.trim()) return;
    const { error } = await supabase.from("assemblees").insert({
      association_id: profile.association_id, titre: form.titre.trim(), type: form.type, date_ag: datetimeLocalToISO(form.date),
      lieu: form.lieu.trim() || null, lien_visio: form.visio.trim() || null, ordre_du_jour: form.odj.trim() || null,
      quorum_pct: form.quorum === "" ? null : Number(form.quorum),
    });
    if (error) { alert(msgErr(error, t, P)); return; }
    setForm(null); load();
  }

  return (
    <div>
      {err && <p style={{ color: RED, fontSize: 12.5 }}>{err}</p>}
      {isBureau && !form && <div style={{ marginBottom: 14 }}><Btn onClick={() => setForm({ titre: fill(P.ag_title_default, { y: new Date().getFullYear() }), type: "ordinaire", date: "", lieu: "", visio: "", odj: "", quorum: "" })}><Plus size={14} /> {P.ag_new}</Btn></div>}
      {form && (
        <Card style={{ marginBottom: 16, maxWidth: 680 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 14px" }}>
            <Field label={P.ag_title}><input style={inputStyle} value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} /></Field>
            <Field label={P.ag_type}>
              <select style={inputStyle} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="ordinaire">{P.ag_ordinaire}</option><option value="extraordinaire">{P.ag_extra}</option>
              </select>
            </Field>
            <Field label={P.ag_date}><input type="datetime-local" style={inputStyle} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label={P.ag_place}><input style={inputStyle} value={form.lieu} onChange={(e) => setForm({ ...form, lieu: e.target.value })} /></Field>
            <Field label={P.ag_visio}><input style={inputStyle} value={form.visio} onChange={(e) => setForm({ ...form, visio: e.target.value })} /></Field>
            <Field label={P.ag_quorum}><input type="number" min={0} max={100} style={inputStyle} value={form.quorum} onChange={(e) => setForm({ ...form, quorum: e.target.value })} placeholder="50" /></Field>
          </div>
          <Field label={P.ag_agenda}><textarea style={{ ...inputStyle, minHeight: 100 }} value={form.odj} onChange={(e) => setForm({ ...form, odj: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={creer}>{P.ag_create}</Btn>
            <Btn variant="outline" onClick={() => setForm(null)}>{P.ag_cancel}</Btn>
          </div>
        </Card>
      )}
      {ags.length === 0 && !err && <p style={{ fontSize: 13, color: "#9AA2B5", fontStyle: "italic" }}>{P.ag_none}</p>}
      {ags.map((ag) => (
        <CarteAssemblee key={ag.id} ag={ag} presences={pres.filter((x) => x.assemblee_id === ag.id)} signatures={sigs.filter((x) => x.assemblee_id === ag.id)} members={members} isBureau={isBureau} association={association} profile={profile} onChanged={load} />
      ))}
    </div>
  );
}

// =====================================================================
// Organigramme
// =====================================================================
function Personne({ nom, photo, role, grand = false }) {
  const s = grand ? 64 : 48;
  const ini = String(nom || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", width: grand ? 180 : 150 }}>
      {photo ? <img src={photo} alt="" style={{ width: s, height: s, borderRadius: "50%", objectFit: "cover", border: "3px solid white", boxShadow: "0 2px 8px rgba(0,0,0,.12)" }} />
        : <span style={{ width: s, height: s, borderRadius: "50%", background: TEAL_LIGHT, color: TEAL, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: s * 0.34, border: "3px solid white", boxShadow: "0 2px 8px rgba(0,0,0,.12)" }}>{ini}</span>}
      <div style={{ fontSize: grand ? 14 : 13, fontWeight: 700, marginTop: 6 }}>{nom}</div>
      <div style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>{role}</div>
    </div>
  );
}

export function Organigramme({ profile, isBureau, association, bureauActuel }) {
  const { t, P } = useT();
  const [resp, setResp] = useState([]);
  const [vitrine, setVitrine] = useState(!!association?.vitrine_responsables);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let annule = false;
    supabase.from("profiles").select("id, nom_complet, role, rubrique_assignee, member_id").eq("association_id", profile.association_id).eq("role", "responsable_rubrique")
      .then(async ({ data }) => {
        if (annule || !data) return;
        const ids = data.map((p) => p.member_id).filter(Boolean);
        const { data: mems } = ids.length ? await supabase.from("members").select("id,nom,photo_url").in("id", ids) : { data: [] };
        if (!annule) setResp(data.map((p) => ({ ...p, nom: (mems || []).find((m) => m.id === p.member_id)?.nom || p.nom_complet, photo: (mems || []).find((m) => m.id === p.member_id)?.photo_url || null })));
      });
    return () => { annule = true; };
  }, [profile.association_id]);

  async function basculerVitrine() {
    const v = !vitrine;
    const { error } = await supabase.from("associations").update({ vitrine_responsables: v }).eq("id", association.id);
    if (error) { setMsg(error.code === "PGRST204" || /column/i.test(error.message || "") ? P.org_vitrine_sql : friendlyError(error, t)); return; }
    setVitrine(v); setMsg("");
  }

  const estPresident = (b) => /pr[ée]sident/i.test(b.poste || "") && !/vice/i.test(b.poste || "");
  const tete = bureauActuel.filter(estPresident);
  const autres = bureauActuel.filter((b) => !estPresident(b));
  const ligneV = <div style={{ width: 2, height: 22, background: "#CBD2DC", margin: "0 auto" }} />;

  return (
    <div>
      <Card style={{ padding: "24px 16px", overflowX: "auto" }}>
        <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: "#686F7D", textTransform: "uppercase", marginBottom: 12 }}>{P.org_board}</div>
        {bureauActuel.length === 0 && <p style={{ textAlign: "center", ...muted, fontStyle: "italic" }}>{P.org_none}</p>}
        {tete.length > 0 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 24 }}>
            {tete.map((b) => <div key={b.id} style={{ position: "relative" }}><Crown size={16} color="#C8963E" style={{ position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)" }} /><Personne nom={b.nom} photo={b.photo} role={b.poste} grand /></div>)}
          </div>
        )}
        {tete.length > 0 && autres.length > 0 && ligneV}
        {autres.length > 0 && (
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 18, borderTop: tete.length ? "2px solid #CBD2DC" : "none", paddingTop: 16, margin: "0 auto", maxWidth: 820 }}>
            {autres.map((b) => <Personne key={b.id} nom={b.nom} photo={b.photo} role={b.poste} />)}
          </div>
        )}
        {resp.length > 0 && (
          <>
            {ligneV}
            <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: "#686F7D", textTransform: "uppercase", margin: "4px 0 12px" }}>{P.org_resp}</div>
            <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 18 }}>
              {resp.map((r) => <Personne key={r.id} nom={r.nom} photo={r.photo} role={`${P.resp_label} · ${P.rubriques[r.rubrique_assignee] || r.rubrique_assignee || ""}`} />)}
            </div>
          </>
        )}
      </Card>
      {isBureau && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={vitrine} onChange={basculerVitrine} /> <Globe size={14} /> {P.org_vitrine}
          </label>
          <p style={{ ...muted, margin: "4px 0 0 24px" }}>{P.org_vitrine_help}</p>
          {msg && <p style={{ color: RED, fontSize: 12, margin: "4px 0 0 24px" }}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
