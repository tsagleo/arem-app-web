// =====================================================================
// ComiteRestreint.jsx — Comité restreint du bureau
// =====================================================================
// Demande de l'utilisateur (2026-10-09) : au sein du bureau, un petit
// comité pour diriger et traiter les questions ponctuelles qui n'ont pas
// à être débattues en assemblée générale. Voir
// sql/2026-10-09d_comite_restreint.sql :
//   • membres désignés par le président (lui-même membre d'office) ;
//   • confidentialité imposée par la base (RLS sur is_comite_membre()) :
//     les autres comptes du bureau ne lisent rien… sauf les décisions
//     closes marquées « à communiquer au bureau », en lecture seule ;
//   • réunions (ordre du jour, compte rendu, PV PDF), sujets avec fil de
//     discussion, documents (bucket privé comite-docs), décisions votées
//     en interne (pour / contre / abstention, quorum).
// La rubrique n'apparaît dans le menu que pour les membres du comité, ou
// pour le reste du bureau dès qu'une décision lui a été communiquée
// (voir comiteAcces dans App.jsx).
// =====================================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { ShieldHalf, Plus, CalendarDays, MessageSquare, Gavel, FileText, Users, FileDown, Trash2, Send, Upload, Lock, Megaphone, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "./supabaseClient";
import { enTeteOfficiel, piedsDePageOfficiels, couleurAssociation, pdfTexte } from "./pdfOfficiel";
import { Section, Container, Card, Btn, Field, inputStyle, useLang, friendlyError, formatEventDateTime, toDatetimeLocal, datetimeLocalToISO, TEAL, TEAL_LIGHT, RED } from "./shared";

const BUCKET = "comite-docs";

const TXT = {
  fr: {
    title: "Comité restreint",
    intro: "Espace confidentiel du comité restreint : réunions, sujets, documents et décisions. Seuls les membres du comité (et le président) y ont accès — la base de données elle-même l'impose.",
    intro_bureau: "Décisions que le comité restreint a choisi de communiquer au bureau.",
    no_access: "Cette rubrique est réservée aux membres du comité restreint.",
    setup_needed: "Le module n'est pas encore installé : le script sql/2026-10-09d_comite_restreint.sql doit être exécuté dans Supabase.",
    tab_reunions: "Réunions", tab_sujets: "Sujets", tab_decisions: "Décisions", tab_documents: "Documents", tab_membres: "Membres",
    // Membres
    members_title: "Membres du comité",
    president_badge: "Président — membre d'office",
    members_help: "Le président désigne les membres parmi les comptes du bureau. Lui seul peut modifier cette liste.",
    members_edit: "Modifier la composition",
    members_save: "Enregistrer la composition",
    members_none_available: "Aucun autre compte du bureau n'est disponible.",
    members_saved: "Composition du comité enregistrée.",
    // Réunions
    new_meeting: "Nouvelle réunion",
    m_title: "Titre", m_title_default: "Réunion du comité restreint",
    m_date: "Date et heure", m_place: "Lieu ou lien",
    m_agenda: "Ordre du jour (un point par ligne)",
    m_minutes: "Compte rendu",
    m_status: "Statut",
    st_prevue: "Prévue", st_tenue: "Tenue", st_annulee: "Annulée",
    edit: "Modifier", create: "Créer", save: "Enregistrer", cancel: "Annuler", delete: "Supprimer",
    saved: "Enregistré.",
    no_meetings: "Aucune réunion pour le moment.",
    agenda: "Ordre du jour",
    linked_subjects: "Sujets inscrits",
    linked_decisions: "Décisions",
    pv_btn: "Procès-verbal (PDF)",
    confirm_delete_meeting: "Supprimer cette réunion ? Les sujets, décisions et documents liés sont conservés.",
    // Sujets
    new_subject: "Nouveau sujet",
    s_title: "Sujet", s_desc: "Description",
    s_meeting: "Inscrire à l'ordre du jour de", s_none: "— Aucune réunion —",
    st_ouvert: "Ouvert", st_clos: "Clos",
    close_subject: "Clore le sujet", reopen_subject: "Rouvrir",
    no_subjects: "Aucun sujet pour le moment.",
    messages_n: "{n} message(s)",
    write_message: "Votre message au comité…",
    send: "Envoyer",
    no_messages: "Aucun message. Lancez la discussion.",
    confirm_delete_subject: "Supprimer ce sujet et tout son fil de discussion ?",
    confirm_delete_message: "Retirer ce message ?",
    // Décisions
    new_decision: "Nouvelle décision",
    d_title: "Décision proposée", d_text: "Texte de la décision",
    d_meeting: "Réunion", d_subject: "Sujet",
    d_quorum: "Quorum (nombre de votants requis)",
    d_quorum_help: "Par défaut : majorité absolue des {n} membres du comité. Abstentions comprises dans le quorum ; adoptée si « pour » > « contre ».",
    d_diffusion: "Diffusion",
    diff_comite: "Reste au comité",
    diff_bureau: "À communiquer au bureau",
    diff_help: "« À communiquer au bureau » : une fois le vote clos, la décision et son résultat sont visibles de tout le bureau, en lecture seule. Les votes nominatifs restent au comité.",
    open_vote: "Ouvrir le vote",
    no_decisions: "Aucune décision pour le moment.",
    dst_en_vote: "Vote en cours", dst_adoptee: "Adoptée", dst_rejetee: "Rejetée", dst_sans_quorum: "Quorum non atteint",
    v_pour: "Pour", v_contre: "Contre", v_abstention: "Abstention",
    your_vote: "Votre vote : {v}",
    votes_count: "{n} / {total} vote(s) — quorum : {q}",
    voters: "Votants",
    close_vote: "Clore le vote",
    confirm_close: "Clore le vote maintenant ? Le résultat sera calculé avec les votes déjà exprimés.",
    set_diff_bureau: "Communiquer au bureau",
    set_diff_comite: "Ne plus communiquer",
    proposed_by: "Proposée par {nom}",
    closed_on: "Close le {date}",
    // Documents
    upload: "Ajouter un document",
    doc_title: "Titre du document", doc_file: "Fichier (20 Mo max.)", doc_subject: "Lié au sujet",
    no_documents: "Aucun document pour le moment.",
    open: "Ouvrir",
    added_by: "Ajouté par {nom}",
    confirm_delete_doc: "Supprimer définitivement ce document ?",
    too_big: "Fichier trop volumineux (20 Mo maximum).",
    // PDF
    pdf_title: "Procès-verbal — Comité restreint",
    pdf_confidential: "CONFIDENTIEL — diffusion réservée au comité restreint",
    pdf_date: "Date", pdf_place: "Lieu", pdf_status: "Statut",
    pdf_members: "Membres du comité",
    pdf_agenda: "Ordre du jour",
    pdf_subjects: "Sujets traités",
    pdf_minutes: "Compte rendu",
    pdf_decisions: "Décisions",
    pdf_dec: "Décision", pdf_result: "Résultat", pdf_votes: "Pour / Contre / Abst.", pdf_diff: "Diffusion",
    pdf_sign: "Signatures",
    pdf_president: "Président(e)", pdf_secretary: "Secrétaire de séance",
    pdf_generated: "Document généré le {date}",
    member_col: "Nom", role_col: "Rôle",
    sig_title: "Signatures électroniques du PV", sig_btn: "Signer électroniquement (décharge)",
    sig_confirm: "Je soussigné(e) {nom}, membre du comité restreint, atteste avoir pris connaissance du procès-verbal de la résolution « {titre} » et en approuver le contenu (résultat et détail des votes). Signer électroniquement ?",
    sig_signed_on: "Signé le {d}", sig_pending: "En attente", sig_wait: "En attente de {n} signature(s) électronique(s) avant consignation",
    sig_valid: "PV validé : signé par tous les membres, consigné et archivé", sig_me: "Votre signature est attendue",
    pdf_esign: "Signé électroniquement le {d}", pdf_ref: "depuis son compte - réf. {h}", pdf_manual: "Signature manuscrite (facultative)",
    pdf_esign_wait: "Signature électronique en attente",
    res_pv_btn: "PV de la résolution (PDF)", res_open: "Ouvrir le PV archivé", res_archived: "PV archivé dans les documents du comité",
    res_title: "Procès-verbal de résolution", res_num: "Résolution n° {n}",
    res_info: "Informations", res_meeting: "Réunion", res_subject: "Sujet", res_author: "Proposée par",
    res_opened: "Mise au vote le", res_closed: "Vote clos le", res_diffusion: "Diffusion",
    res_members: "Membres du comité à la clôture ({n})", res_text: "Texte de la résolution",
    res_vote: "Résultat du vote", res_quorum: "Quorum requis", res_votants: "Votants",
    res_result: "Décision", res_nominal: "Détail nominatif des votes (confidentiel)", res_no_vote: "N'a pas voté",
    res_sign: "Lu et approuvé — signatures des membres du comité", res_signature: "Signature", res_date: "Date",
    res_doc_title: "PV de résolution n° {n} — {titre}", res_president: "Président(e)", res_member: "Membre du comité",
    res_mention: "Le présent procès-verbal est établi à la clôture du vote, consigné et archivé dans les documents confidentiels du comité restreint. Il vaut décharge pour les membres du comité quant à la régularité de la procédure de vote.",
  },
  en: {
    title: "Executive committee",
    intro: "Confidential space of the executive committee: meetings, topics, documents and decisions. Only committee members (and the president) have access — enforced by the database itself.",
    intro_bureau: "Decisions the executive committee chose to share with the board.",
    no_access: "This section is reserved for executive committee members.",
    setup_needed: "The module is not installed yet: the script sql/2026-10-09d_comite_restreint.sql must be run in Supabase.",
    tab_reunions: "Meetings", tab_sujets: "Topics", tab_decisions: "Decisions", tab_documents: "Documents", tab_membres: "Members",
    members_title: "Committee members",
    president_badge: "President — member by right",
    members_help: "The president appoints members from the board accounts. Only the president can change this list.",
    members_edit: "Change membership",
    members_save: "Save membership",
    members_none_available: "No other board account is available.",
    members_saved: "Committee membership saved.",
    new_meeting: "New meeting",
    m_title: "Title", m_title_default: "Executive committee meeting",
    m_date: "Date and time", m_place: "Place or link",
    m_agenda: "Agenda (one item per line)",
    m_minutes: "Minutes",
    m_status: "Status",
    st_prevue: "Scheduled", st_tenue: "Held", st_annulee: "Cancelled",
    edit: "Edit", create: "Create", save: "Save", cancel: "Cancel", delete: "Delete",
    saved: "Saved.",
    no_meetings: "No meetings yet.",
    agenda: "Agenda",
    linked_subjects: "Topics on the agenda",
    linked_decisions: "Decisions",
    pv_btn: "Minutes (PDF)",
    confirm_delete_meeting: "Delete this meeting? Linked topics, decisions and documents are kept.",
    new_subject: "New topic",
    s_title: "Topic", s_desc: "Description",
    s_meeting: "Add to the agenda of", s_none: "— No meeting —",
    st_ouvert: "Open", st_clos: "Closed",
    close_subject: "Close topic", reopen_subject: "Reopen",
    no_subjects: "No topics yet.",
    messages_n: "{n} message(s)",
    write_message: "Your message to the committee…",
    send: "Send",
    no_messages: "No messages. Start the discussion.",
    confirm_delete_subject: "Delete this topic and its whole discussion?",
    confirm_delete_message: "Remove this message?",
    new_decision: "New decision",
    d_title: "Proposed decision", d_text: "Decision text",
    d_meeting: "Meeting", d_subject: "Topic",
    d_quorum: "Quorum (number of voters required)",
    d_quorum_help: "Default: absolute majority of the {n} committee members. Abstentions count toward quorum; adopted if “for” > “against”.",
    d_diffusion: "Visibility",
    diff_comite: "Stays within the committee",
    diff_bureau: "Share with the board",
    diff_help: "“Share with the board”: once voting is closed, the decision and its result are visible to the whole board, read-only. Individual votes stay within the committee.",
    open_vote: "Open the vote",
    no_decisions: "No decisions yet.",
    dst_en_vote: "Voting open", dst_adoptee: "Adopted", dst_rejetee: "Rejected", dst_sans_quorum: "Quorum not reached",
    v_pour: "For", v_contre: "Against", v_abstention: "Abstain",
    your_vote: "Your vote: {v}",
    votes_count: "{n} / {total} vote(s) — quorum: {q}",
    voters: "Voters",
    close_vote: "Close the vote",
    confirm_close: "Close the vote now? The result will be computed from the votes already cast.",
    set_diff_bureau: "Share with the board",
    set_diff_comite: "Stop sharing",
    proposed_by: "Proposed by {nom}",
    closed_on: "Closed on {date}",
    upload: "Add a document",
    doc_title: "Document title", doc_file: "File (20 MB max.)", doc_subject: "Linked topic",
    no_documents: "No documents yet.",
    open: "Open",
    added_by: "Added by {nom}",
    confirm_delete_doc: "Permanently delete this document?",
    too_big: "File too large (20 MB maximum).",
    pdf_title: "Minutes — Executive committee",
    pdf_confidential: "CONFIDENTIAL — restricted to the executive committee",
    pdf_date: "Date", pdf_place: "Place", pdf_status: "Status",
    pdf_members: "Committee members",
    pdf_agenda: "Agenda",
    pdf_subjects: "Topics discussed",
    pdf_minutes: "Minutes",
    pdf_decisions: "Decisions",
    pdf_dec: "Decision", pdf_result: "Result", pdf_votes: "For / Against / Abst.", pdf_diff: "Visibility",
    pdf_sign: "Signatures",
    pdf_president: "President", pdf_secretary: "Recording secretary",
    pdf_generated: "Generated on {date}",
    member_col: "Name", role_col: "Role",
    sig_title: "Electronic signatures of the minutes", sig_btn: "Sign electronically (discharge)",
    sig_confirm: "I, {nom}, member of the executive committee, certify that I have read the minutes of the resolution \"{titre}\" and approve their content (result and votes). Sign electronically?",
    sig_signed_on: "Signed on {d}", sig_pending: "Pending", sig_wait: "Waiting for {n} electronic signature(s) before filing",
    sig_valid: "Minutes validated: signed by all members, recorded and filed", sig_me: "Your signature is awaited",
    pdf_esign: "Electronically signed on {d}", pdf_ref: "from their own account - ref. {h}", pdf_manual: "Handwritten signature (optional)",
    pdf_esign_wait: "Electronic signature pending",
    res_pv_btn: "Resolution minutes (PDF)", res_open: "Open filed minutes", res_archived: "Minutes filed in the committee documents",
    res_title: "Resolution minutes", res_num: "Resolution no. {n}",
    res_info: "Information", res_meeting: "Meeting", res_subject: "Topic", res_author: "Proposed by",
    res_opened: "Put to vote on", res_closed: "Vote closed on", res_diffusion: "Distribution",
    res_members: "Committee members at closing ({n})", res_text: "Text of the resolution",
    res_vote: "Vote result", res_quorum: "Quorum required", res_votants: "Voters",
    res_result: "Decision", res_nominal: "Votes by member (confidential)", res_no_vote: "Did not vote",
    res_sign: "Read and approved — committee members' signatures", res_signature: "Signature", res_date: "Date",
    res_doc_title: "Resolution minutes no. {n} — {titre}", res_president: "President", res_member: "Committee member",
    res_mention: "These minutes are drawn up when the vote closes, recorded and filed in the executive committee's confidential documents. They discharge the committee members as to the regularity of the voting procedure.",
  },
};

const muted = { fontSize: 12, color: "#686F7D" };
const smallBtn = { background: "none", border: "1px solid #DCE0E8", borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, color: "#2C3A50" };

function DecisionPill({ statut, L }) {
  const styles = {
    en_vote: { background: "#FFF3D6", color: "#8a6d1a" },
    adoptee: { background: TEAL_LIGHT, color: TEAL },
    rejetee: { background: "#F3E8E8", color: "#8A3B3B" },
    sans_quorum: { background: "#EEF1F6", color: "#4A5468" },
  };
  return <span style={{ ...styles[statut], fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>{L["dst_" + statut]}</span>;
}

function DiffusionTag({ diffusion, L }) {
  const bureau = diffusion === "bureau";
  return (
    <span style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, color: bureau ? TEAL : "#4A5468" }}>
      {bureau ? <Megaphone size={12} /> : <Lock size={12} />} {bureau ? L.diff_bureau : L.diff_comite}
    </span>
  );
}

// ---------- Procès-verbal restreint (PDF) ----------
async function exporterPv({ reunion, association, membres, sujets, decisions, L, lang }) {
  const [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const { jsPDF } = jsPDFmod;
  const autoTable = autoTableMod.default || autoTableMod;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const x = 40;
  const largeur = 530;
  let y = 46;
  const saut = (h) => { if (y + h > 740) { doc.addPage(); y = 50; } };
  const bandeau = () => {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(0); doc.setFont("helvetica", "bolditalic");
      doc.text(L.pdf_confidential, x, 24);
      doc.setTextColor(120); doc.setFont(undefined, "normal");
      doc.text(`${i} / ${n}`, 572, 24, { align: "right" });
      doc.setTextColor(0);
    }
  };
  const titreSection = (txt) => {
    saut(30); y += 8;
    doc.setFontSize(11.5); doc.setFont(undefined, "bold"); doc.text(txt, x, y); y += 15;
    doc.setFont(undefined, "normal"); doc.setFontSize(10);
  };
  const paragraphe = (txt) => {
    const lignes = doc.splitTextToSize(txt || "—", largeur);
    lignes.forEach((l) => { saut(13); doc.text(l, x, y); y += 13; });
  };

  // Logo + mentions légales (pdfOfficiel.js) : demande de l'utilisateur
  // (2026-10-09), sur tous les documents générés, pour leur authenticité.
  y = await enTeteOfficiel(doc, association, { titre: L.pdf_title, sousTitre: reunion.titre, marge: x });
  doc.setFont(undefined, "normal"); doc.setFontSize(10);
  [[L.pdf_date, reunion.date_reunion ? formatEventDateTime(reunion.date_reunion, lang) : "—"],
    [L.pdf_place, reunion.lieu || "—"],
    [L.pdf_status, L["st_" + reunion.statut]],
    [L.pdf_members, membres.map((m) => m.nom).join(", ") || "—"],
  ].forEach(([k, v]) => paragraphe(`${k} : ${v}`));

  const points = (reunion.ordre_du_jour || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  titreSection(L.pdf_agenda);
  if (points.length) points.forEach((p, i) => paragraphe(`${i + 1}. ${p}`)); else paragraphe("—");

  if (sujets.length) {
    titreSection(L.pdf_subjects);
    sujets.forEach((s) => paragraphe(`• ${s.titre}${s.description ? ` — ${s.description}` : ""}`));
  }

  titreSection(L.pdf_minutes);
  paragraphe(reunion.compte_rendu);

  if (decisions.length) {
    titreSection(L.pdf_decisions);
    autoTable(doc, {
      startY: y,
      head: [[L.pdf_dec, L.pdf_result, L.pdf_votes, L.pdf_diff]],
      body: decisions.map((d) => [
        d.texte ? `${d.titre}\n${d.texte}` : d.titre,
        L["dst_" + d.statut],
        d.statut === "en_vote" ? "—" : `${d.pour} / ${d.contre} / ${d.abstention}`,
        d.diffusion === "bureau" ? L.diff_bureau : L.diff_comite,
      ]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: couleurAssociation(association) },
      columnStyles: { 0: { cellWidth: 270 } },
      margin: { left: x, right: x, top: 40 },
    });
    y = (doc.lastAutoTable?.finalY || y) + 10;
  }

  saut(110); y += 26;
  doc.setFontSize(11); doc.setFont(undefined, "bold"); doc.text(L.pdf_sign, x, y); y += 42;
  doc.setFont(undefined, "normal"); doc.setFontSize(9.5);
  [L.pdf_president, L.pdf_secretary].forEach((role, i) => {
    const cx = x + i * 270;
    doc.line(cx, y, cx + 220, y);
    doc.text(role, cx, y + 12);
  });
  y += 34;
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text(L.pdf_generated.replace("{date}", formatEventDateTime(new Date().toISOString(), lang)), x, y);
  doc.setTextColor(0);
  bandeau();
  piedsDePageOfficiels(doc, association, { marge: x, texte: L.pdf_title });
  doc.save(`${(reunion.titre || "comite").replace(/[^a-z0-9]+/gi, "_")}_PV_restreint.pdf`);
}

// ---------- Membres ----------
function MembresPanel({ L, t, membres, isPresident, associationId, onChanged }) {
  const [edition, setEdition] = useState(false);
  const [candidats, setCandidats] = useState([]);
  const [choix, setChoix] = useState(new Set());
  const [busy, setBusy] = useState(false);

  async function ouvrir() {
    const { data, error } = await supabase.from("profiles").select("id, nom_complet, role")
      .eq("association_id", associationId).in("role", ["bureau_secretaire", "bureau_tresorier", "bureau_custom"]).order("nom_complet");
    if (error) { alert(friendlyError(error, t)); return; }
    setCandidats(data || []);
    setChoix(new Set(membres.filter((m) => !m.est_president).map((m) => m.profile_id)));
    setEdition(true);
  }
  async function enregistrer() {
    setBusy(true);
    const { error } = await supabase.rpc("definir_membres_comite", { p_profile_ids: [...choix] });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    setEdition(false);
    onChanged();
  }
  const basculer = (id) => setChoix((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Card>
      <h3 style={{ fontSize: 16, margin: "0 0 4px" }}>{L.members_title}</h3>
      <p style={{ ...muted, margin: "0 0 14px" }}>{L.members_help}</p>
      {!edition && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px", display: "grid", gap: 6 }}>
          {membres.map((m) => (
            <li key={m.profile_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <Users size={14} color={TEAL} /> {m.nom || "—"}
              {m.est_president && <span style={{ ...muted, fontSize: 11 }}>· {L.president_badge}</span>}
            </li>
          ))}
        </ul>
      )}
      {isPresident && !edition && <Btn variant="outline" onClick={ouvrir}>{L.members_edit}</Btn>}
      {edition && (
        <>
          {candidats.length === 0 ? <p style={muted}>{L.members_none_available}</p> : (
            <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
              {candidats.map((c) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                  <input type="checkbox" checked={choix.has(c.id)} onChange={() => basculer(c.id)} /> {c.nom_complet || "—"}
                  {c.role !== "bureau_custom" && <span style={{ ...muted, fontSize: 11 }}>{t("role_" + c.role)}</span>}
                </label>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn onClick={enregistrer} disabled={busy}>{L.members_save}</Btn>
            <Btn variant="outline" onClick={() => setEdition(false)}>{L.cancel}</Btn>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------- Réunions ----------
function ReunionForm({ L, t, onDone }) {
  const [f, setF] = useState({ titre: L.m_title_default, date: "", lieu: "", odj: "" });
  const [busy, setBusy] = useState(false);
  async function creer() {
    setBusy(true);
    const { error } = await supabase.from("comite_reunions").insert({
      titre: f.titre.trim(), date_reunion: datetimeLocalToISO(f.date), lieu: f.lieu.trim() || null, ordre_du_jour: f.odj.trim() || null,
    });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onDone(true);
  }
  return (
    <Card style={{ marginBottom: 16 }}>
      <Field label={L.m_title}><input style={inputStyle} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <Field label={L.m_date}><input type="datetime-local" style={inputStyle} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={L.m_place}><input style={inputStyle} value={f.lieu} onChange={(e) => setF({ ...f, lieu: e.target.value })} /></Field>
      </div>
      <Field label={L.m_agenda}><textarea rows={4} style={inputStyle} value={f.odj} onChange={(e) => setF({ ...f, odj: e.target.value })} /></Field>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn onClick={creer} disabled={busy || !f.titre.trim()}>{L.create}</Btn>
        <Btn variant="outline" onClick={() => onDone(false)}>{L.cancel}</Btn>
      </div>
    </Card>
  );
}

function ReunionCard({ reunion, L, t, lang, sujets, decisions, membres, association, profile, isPresident, onChanged }) {
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const sujetsLies = sujets.filter((s) => s.reunion_id === reunion.id);
  const decisionsLiees = decisions.filter((d) => d.reunion_id === reunion.id);
  const points = (reunion.ordre_du_jour || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  function editer() {
    setF({ titre: reunion.titre, date: toDatetimeLocal(reunion.date_reunion), lieu: reunion.lieu || "", odj: reunion.ordre_du_jour || "", cr: reunion.compte_rendu || "", statut: reunion.statut });
  }
  async function enregistrer() {
    setBusy(true);
    const { error } = await supabase.from("comite_reunions").update({
      titre: f.titre.trim() || reunion.titre, date_reunion: datetimeLocalToISO(f.date), lieu: f.lieu.trim() || null,
      ordre_du_jour: f.odj.trim() || null, compte_rendu: f.cr.trim() || null, statut: f.statut,
    }).eq("id", reunion.id);
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    setF(null);
    onChanged();
  }
  async function supprimer() {
    if (!window.confirm(L.confirm_delete_meeting)) return;
    const { error } = await supabase.from("comite_reunions").delete().eq("id", reunion.id);
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }
  const peutSupprimer = isPresident || reunion.auteur_id === profile.id;

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start", cursor: "pointer" }} onClick={() => setOuvert(!ouvert)}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          {ouvert ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <div>
            <h3 style={{ fontSize: 15.5, margin: "0 0 3px" }}>{reunion.titre}</h3>
            <div style={{ ...muted, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {reunion.date_reunion && <span>{formatEventDateTime(reunion.date_reunion, lang)}</span>}
              {reunion.lieu && <span>· {reunion.lieu}</span>}
              <span>· {L.linked_subjects} : {sujetsLies.length}</span>
              <span>· {L.linked_decisions} : {decisionsLiees.length}</span>
            </div>
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 10px", background: reunion.statut === "tenue" ? TEAL_LIGHT : reunion.statut === "annulee" ? "#F3E8E8" : "#EEF1F6", color: reunion.statut === "tenue" ? TEAL : reunion.statut === "annulee" ? "#8A3B3B" : "#4A5468" }}>{L["st_" + reunion.statut]}</span>
      </div>

      {ouvert && !f && (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ fontSize: 13, margin: "0 0 6px" }}>{L.agenda}</h4>
          {points.length ? <ol style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 14 }}>{points.map((p, i) => <li key={i}>{p}</li>)}</ol> : <p style={muted}>—</p>}
          {sujetsLies.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, margin: "0 0 6px" }}>{L.linked_subjects}</h4>
              <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 14 }}>{sujetsLies.map((s) => <li key={s.id}>{s.titre} <span style={muted}>({L["st_" + s.statut]})</span></li>)}</ul>
            </>
          )}
          {decisionsLiees.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, margin: "0 0 6px" }}>{L.linked_decisions}</h4>
              <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 14 }}>{decisionsLiees.map((d) => <li key={d.id}>{d.titre} — <DecisionPill statut={d.statut} L={L} /></li>)}</ul>
            </>
          )}
          <h4 style={{ fontSize: 13, margin: "0 0 6px" }}>{L.m_minutes}</h4>
          <p style={{ fontSize: 14, whiteSpace: "pre-wrap", margin: "0 0 14px" }}>{reunion.compte_rendu || "—"}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={smallBtn} onClick={editer}>{L.edit}</button>
            <button style={smallBtn} onClick={() => exporterPv({ reunion, association, membres, sujets: sujetsLies, decisions: decisionsLiees, L, lang })}><FileDown size={13} /> {L.pv_btn}</button>
            {peutSupprimer && <button style={{ ...smallBtn, color: RED }} onClick={supprimer}><Trash2 size={13} /> {L.delete}</button>}
          </div>
        </div>
      )}

      {ouvert && f && (
        <div style={{ marginTop: 14 }}>
          <Field label={L.m_title}><input style={inputStyle} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <Field label={L.m_date}><input type="datetime-local" style={inputStyle} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label={L.m_place}><input style={inputStyle} value={f.lieu} onChange={(e) => setF({ ...f, lieu: e.target.value })} /></Field>
            <Field label={L.m_status}>
              <select style={inputStyle} value={f.statut} onChange={(e) => setF({ ...f, statut: e.target.value })}>
                {["prevue", "tenue", "annulee"].map((s) => <option key={s} value={s}>{L["st_" + s]}</option>)}
              </select>
            </Field>
          </div>
          <Field label={L.m_agenda}><textarea rows={4} style={inputStyle} value={f.odj} onChange={(e) => setF({ ...f, odj: e.target.value })} /></Field>
          <Field label={L.m_minutes}><textarea rows={7} style={inputStyle} value={f.cr} onChange={(e) => setF({ ...f, cr: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={enregistrer} disabled={busy}>{L.save}</Btn>
            <Btn variant="outline" onClick={() => setF(null)}>{L.cancel}</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------- Sujets et fil de discussion ----------
function SujetForm({ L, t, reunions, onDone }) {
  const [f, setF] = useState({ titre: "", description: "", reunion_id: "" });
  const [busy, setBusy] = useState(false);
  async function creer() {
    setBusy(true);
    const { error } = await supabase.from("comite_sujets").insert({ titre: f.titre.trim(), description: f.description.trim() || null, reunion_id: f.reunion_id || null });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onDone(true);
  }
  return (
    <Card style={{ marginBottom: 16 }}>
      <Field label={L.s_title}><input style={inputStyle} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} /></Field>
      <Field label={L.s_desc}><textarea rows={3} style={inputStyle} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label={L.s_meeting}>
        <select style={inputStyle} value={f.reunion_id} onChange={(e) => setF({ ...f, reunion_id: e.target.value })}>
          <option value="">{L.s_none}</option>
          {reunions.filter((r) => r.statut === "prevue").map((r) => <option key={r.id} value={r.id}>{r.titre}</option>)}
        </select>
      </Field>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn onClick={creer} disabled={busy || !f.titre.trim()}>{L.create}</Btn>
        <Btn variant="outline" onClick={() => onDone(false)}>{L.cancel}</Btn>
      </div>
    </Card>
  );
}

function SujetThread({ sujet, L, t, lang, profile, reunions, isPresident, onChanged }) {
  const [messages, setMessages] = useState([]);
  const [texte, setTexte] = useState("");
  const [busy, setBusy] = useState(false);

  const charger = useCallback(async () => {
    const { data } = await supabase.from("comite_messages").select("*").eq("sujet_id", sujet.id).order("created_at");
    setMessages(data || []);
  }, [sujet.id]);
  useEffect(() => { charger(); }, [charger]);
  // Temps réel : la RLS s'applique aussi au flux, seuls les membres du
  // comité reçoivent les nouveaux messages.
  useEffect(() => {
    const channel = supabase.channel(`comite-sujet-${sujet.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "comite_messages", filter: `sujet_id=eq.${sujet.id}` }, charger)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sujet.id, charger]);

  async function envoyer() {
    if (!texte.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("comite_messages").insert({ sujet_id: sujet.id, contenu: texte.trim() });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    setTexte("");
    charger();
  }
  async function retirer(id) {
    if (!window.confirm(L.confirm_delete_message)) return;
    const { error } = await supabase.from("comite_messages").delete().eq("id", id);
    if (error) { alert(friendlyError(error, t)); return; }
    charger();
  }
  async function changerStatut(statut) {
    const { error } = await supabase.from("comite_sujets").update({ statut }).eq("id", sujet.id);
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }
  async function changerReunion(reunion_id) {
    const { error } = await supabase.from("comite_sujets").update({ reunion_id: reunion_id || null }).eq("id", sujet.id);
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }
  async function supprimer() {
    if (!window.confirm(L.confirm_delete_subject)) return;
    const { error } = await supabase.from("comite_sujets").delete().eq("id", sujet.id);
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }

  return (
    <div style={{ marginTop: 12 }}>
      {sujet.description && <p style={{ fontSize: 14, whiteSpace: "pre-wrap", margin: "0 0 12px" }}>{sujet.description}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 12 }} value={sujet.reunion_id || ""} onChange={(e) => changerReunion(e.target.value)}>
          <option value="">{L.s_none}</option>
          {reunions.map((r) => <option key={r.id} value={r.id}>{r.titre}</option>)}
        </select>
        <button style={smallBtn} onClick={() => changerStatut(sujet.statut === "ouvert" ? "clos" : "ouvert")}>
          {sujet.statut === "ouvert" ? <><CheckCircle2 size={13} /> {L.close_subject}</> : L.reopen_subject}
        </button>
        {(isPresident || sujet.auteur_id === profile.id) && <button style={{ ...smallBtn, color: RED }} onClick={supprimer}><Trash2 size={13} /> {L.delete}</button>}
      </div>
      <div style={{ background: "#F7F8FA", borderRadius: 10, padding: 12, display: "grid", gap: 10, maxHeight: 420, overflowY: "auto" }}>
        {messages.length === 0 && <p style={{ ...muted, margin: 0 }}>{L.no_messages}</p>}
        {messages.map((m) => {
          const moi = m.auteur_id === profile.id;
          return (
            <div key={m.id} style={{ justifySelf: moi ? "end" : "start", maxWidth: "85%", background: moi ? TEAL_LIGHT : "white", borderRadius: 10, padding: "8px 12px", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              <div style={{ ...muted, fontSize: 11, display: "flex", gap: 8, justifyContent: "space-between" }}>
                <b style={{ color: "#2C3A50" }}>{m.auteur_nom || "—"}</b>
                <span>{formatEventDateTime(m.created_at, lang)}</span>
              </div>
              <div style={{ fontSize: 14, whiteSpace: "pre-wrap", marginTop: 3 }}>{m.contenu}</div>
              {moi && <button onClick={() => retirer(m.id)} style={{ background: "none", border: "none", color: "#8A3B3B", fontSize: 11, cursor: "pointer", padding: 0, marginTop: 4 }}>{L.delete}</button>}
            </div>
          );
        })}
      </div>
      {sujet.statut === "ouvert" && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}>
          <textarea rows={2} style={{ ...inputStyle, flex: 1 }} placeholder={L.write_message} value={texte} onChange={(e) => setTexte(e.target.value)} />
          <Btn onClick={envoyer} disabled={busy || !texte.trim()}><Send size={14} /> {L.send}</Btn>
        </div>
      )}
    </div>
  );
}

// ---------- Décisions ----------
function DecisionForm({ L, t, reunions, sujets, nbMembres, onDone }) {
  const defaut = Math.floor(nbMembres / 2) + 1;
  const [f, setF] = useState({ titre: "", texte: "", reunion_id: "", sujet_id: "", diffusion: "comite", quorum: String(defaut) });
  const [busy, setBusy] = useState(false);
  async function creer() {
    setBusy(true);
    const { error } = await supabase.rpc("creer_decision", {
      p_titre: f.titre.trim(), p_texte: f.texte.trim() || null, p_reunion_id: f.reunion_id || null, p_sujet_id: f.sujet_id || null,
      p_diffusion: f.diffusion, p_quorum: Number(f.quorum) || null,
    });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onDone(true);
  }
  return (
    <Card style={{ marginBottom: 16 }}>
      <Field label={L.d_title}><input style={inputStyle} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} /></Field>
      <Field label={L.d_text}><textarea rows={3} style={inputStyle} value={f.texte} onChange={(e) => setF({ ...f, texte: e.target.value })} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Field label={L.d_meeting}>
          <select style={inputStyle} value={f.reunion_id} onChange={(e) => setF({ ...f, reunion_id: e.target.value })}>
            <option value="">—</option>
            {reunions.map((r) => <option key={r.id} value={r.id}>{r.titre}</option>)}
          </select>
        </Field>
        <Field label={L.d_subject}>
          <select style={inputStyle} value={f.sujet_id} onChange={(e) => setF({ ...f, sujet_id: e.target.value })}>
            <option value="">—</option>
            {sujets.map((s) => <option key={s.id} value={s.id}>{s.titre}</option>)}
          </select>
        </Field>
        <Field label={L.d_quorum}>
          <input type="number" min={1} max={nbMembres} style={inputStyle} value={f.quorum} onChange={(e) => setF({ ...f, quorum: e.target.value })} />
        </Field>
      </div>
      <p style={{ ...muted, margin: "-6px 0 12px" }}>{L.d_quorum_help.replace("{n}", String(nbMembres))}</p>
      <Field label={L.d_diffusion}>
        <select style={inputStyle} value={f.diffusion} onChange={(e) => setF({ ...f, diffusion: e.target.value })}>
          <option value="comite">{L.diff_comite}</option>
          <option value="bureau">{L.diff_bureau}</option>
        </select>
      </Field>
      <p style={{ ...muted, margin: "-6px 0 12px" }}>{L.diff_help}</p>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn onClick={creer} disabled={busy || !f.titre.trim()}><Gavel size={14} /> {L.open_vote}</Btn>
        <Btn variant="outline" onClick={() => onDone(false)}>{L.cancel}</Btn>
      </div>
    </Card>
  );
}

function DecisionCard({ d, L, t, lang, votes, membres, reunions, sujets, profile, isPresident, lectureSeule, onChanged, association, documents = [], signatures = [] }) {
  const [busy, setBusy] = useState(false);
  const mesVotes = votes.filter((v) => v.decision_id === d.id);
  const monVote = mesVotes.find((v) => v.profile_id === profile.id);
  const peutGerer = !lectureSeule && (isPresident || d.auteur_id === profile.id);
  const reunion = reunions.find((r) => r.id === d.reunion_id);
  const sujet = sujets.find((s) => s.id === d.sujet_id);

  async function rpc(fn, args, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }
  const enVote = d.statut === "en_vote";

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 15.5, margin: "0 0 3px" }}>{d.titre}</h3>
          <div style={{ ...muted, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {d.auteur_nom && <span>{L.proposed_by.replace("{nom}", d.auteur_nom)}</span>}
            {!lectureSeule && reunion && <span>· {reunion.titre}</span>}
            {!lectureSeule && sujet && <span>· {sujet.titre}</span>}
            {d.cloture_le && <span>· {L.closed_on.replace("{date}", formatEventDateTime(d.cloture_le, lang))}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {!lectureSeule && <DiffusionTag diffusion={d.diffusion} L={L} />}
          <DecisionPill statut={d.statut} L={L} />
        </div>
      </div>
      {d.texte && <p style={{ fontSize: 14, whiteSpace: "pre-wrap", margin: "10px 0 0" }}>{d.texte}</p>}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "12px 0 0", fontSize: 13 }}>
        {enVote
          ? <span style={muted}>{L.votes_count.replace("{n}", String(mesVotes.length)).replace("{total}", String(membres.length || d.nb_membres)).replace("{q}", String(d.quorum))}</span>
          : <>
            <span><b style={{ color: TEAL }}>{L.v_pour}</b> {d.pour}</span>
            <span><b style={{ color: RED }}>{L.v_contre}</b> {d.contre}</span>
            <span><b style={{ color: "#4A5468" }}>{L.v_abstention}</b> {d.abstention}</span>
            <span style={muted}>(quorum {d.quorum})</span>
          </>}
      </div>

      {!lectureSeule && enVote && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["pour", "contre", "abstention"].map((c) => {
              const actif = monVote?.choix === c;
              return (
                <button key={c} disabled={busy} onClick={() => rpc("voter_decision", { p_id: d.id, p_choix: c })}
                  style={{ ...smallBtn, padding: "7px 14px", fontSize: 13, fontWeight: 600, background: actif ? (c === "pour" ? TEAL : c === "contre" ? RED : "#4A5468") : "white", color: actif ? "white" : "#2C3A50", borderColor: actif ? "transparent" : "#DCE0E8" }}>
                  {L["v_" + c]}
                </button>
              );
            })}
          </div>
          {monVote && <p style={{ ...muted, margin: "6px 0 0" }}>{L.your_vote.replace("{v}", L["v_" + monVote.choix])}</p>}
        </div>
      )}

      {!lectureSeule && mesVotes.length > 0 && (
        <p style={{ ...muted, margin: "10px 0 0" }}>
          {L.voters} : {mesVotes.map((v) => `${v.votant_nom || "—"} (${L["v_" + v.choix]})`).join(", ")}
        </p>
      )}

      {!lectureSeule && !enVote && (() => {
        const sigs = signatairesResolution(d, membres);
        const manque = signaturesManquantes(d, membres, signatures);
        const moi = sigs.find((m) => m.profile_id === profile.id);
        const moiSigne = moi && signatureDe(signatures, d, moi);
        return (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "#F8FAFB" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{L.sig_title}</div>
            {sigs.map((m, i) => {
              const sg = signatureDe(signatures, d, m);
              return (
                <div key={i} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                  {sg ? <CheckCircle2 size={13} color={TEAL} /> : <span style={{ width: 13, height: 13, borderRadius: "50%", border: "1.5px solid #B7791F", display: "inline-block" }} />}
                  <b>{m.nom}</b>
                  <span style={{ color: sg ? TEAL : "#B7791F" }}>{sg ? L.sig_signed_on.replace("{d}", formatEventDateTime(sg.signe_le, lang)) : L.sig_pending}</span>
                </div>
              );
            })}
            {moi && !moiSigne && (
              <button style={{ ...smallBtn, marginTop: 8, background: TEAL, color: "white", borderColor: "transparent", fontWeight: 600 }}
                onClick={() => rpc("signer_pv_resolution", { p_id: d.id }, L.sig_confirm.replace("{nom}", moi.nom || "").replace("{titre}", d.titre))}>
                ✍️ {L.sig_btn}
              </button>
            )}
            <p style={{ ...muted, margin: "8px 0 0", fontWeight: 600, color: manque === 0 && d.pv_document_id ? TEAL : "#B7791F" }}>
              {manque === 0 && d.pv_document_id ? `✓ ${L.sig_valid}` : manque > 0 ? L.sig_wait.replace("{n}", String(manque)) : ""}
            </p>
          </div>
        );
      })()}

      {!lectureSeule && !enVote && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
          <button style={smallBtn} onClick={() => exporterPvResolution({ d, votes, reunions, sujets, membres, signatures, association, L, lang }).catch((e) => alert(friendlyError(e, t)))}><FileDown size={13} /> {L.res_pv_btn}</button>
          {d.pv_document_id && (() => {
            const archive = documents.find((x) => x.id === d.pv_document_id);
            return archive ? (
              <button style={smallBtn} onClick={async () => { const { data: u, error } = await supabase.storage.from(BUCKET).createSignedUrl(archive.chemin, 60); if (error) alert(friendlyError(error, t)); else window.open(u.signedUrl, "_blank", "noopener"); }}><FileText size={13} /> {L.res_open}</button>
            ) : null;
          })()}
          {d.pv_document_id && <span style={{ ...muted, fontSize: 11.5 }}>✓ {L.res_archived} · {L.res_num.replace("{n}", numeroResolution(d))}</span>}
        </div>
      )}

      {peutGerer && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {enVote && <button style={smallBtn} disabled={busy} onClick={() => rpc("cloturer_decision", { p_id: d.id }, L.confirm_close)}><CheckCircle2 size={13} /> {L.close_vote}</button>}
          <button style={smallBtn} disabled={busy} onClick={() => rpc("definir_diffusion_decision", { p_id: d.id, p_diffusion: d.diffusion === "bureau" ? "comite" : "bureau" })}>
            {d.diffusion === "bureau" ? <><Lock size={13} /> {L.set_diff_comite}</> : <><Megaphone size={13} /> {L.set_diff_bureau}</>}
          </button>
        </div>
      )}
    </Card>
  );
}

// ---------- Signatures électroniques du PV (sql/2026-10-10i) ----------
function signatairesResolution(d, membres) {
  return Array.isArray(d.membres_cloture) && d.membres_cloture.length
    ? d.membres_cloture
    : membres.map((m) => ({ profile_id: m.profile_id, nom: m.nom, president: m.est_president }));
}
function signatureDe(signatures, d, m) {
  return signatures.find((x) => x.decision_id === d.id && ((m.profile_id && x.profile_id === m.profile_id) || (!m.profile_id && x.nom === m.nom)));
}
function signaturesManquantes(d, membres, signatures) {
  return signatairesResolution(d, membres).filter((m) => !signatureDe(signatures, d, m)).length;
}

// ---------- PV de résolution (2026-10-10) ----------
// Généré à la clôture du vote et archivé automatiquement dans les
// documents confidentiels du comité (sql/2026-10-10g). Contient l'en-tête
// officiel (logo, mentions légales), le numéro, le texte, la composition
// du comité à la clôture, le résultat et le détail nominatif des votes,
// et les signatures de tous les membres.
function numeroResolution(d) {
  if (d.numero == null) return "—";
  const an = d.cloture_le ? new Date(d.cloture_le).getFullYear() : new Date().getFullYear();
  return `${an}-${String(d.numero).padStart(3, "0")}`;
}
async function exporterPvResolution({ d, votes, reunions, sujets, membres, signatures = [], association, L, lang, sortie = "telecharger" }) {
  const [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const { jsPDF } = jsPDFmod;
  const autoTable = autoTableMod.default || autoTableMod;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 48;
  const W = doc.internal.pageSize.getWidth() - 2 * M;
  const T = pdfTexte;
  const D = (iso) => (iso ? formatEventDateTime(iso, lang) : "—");
  const accent = couleurAssociation(association);
  const num = numeroResolution(d);
  let y = await enTeteOfficiel(doc, association, { titre: `${L.res_title} - ${L.res_num.replace("{n}", num)}`, sousTitre: d.titre, marge: M });
  doc.setFont("helvetica", "bolditalic"); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
  doc.text(T(L.pdf_confidential), M, y); y += 14;
  const saut = (h) => { if (y + h > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 56; } };
  const section = (titre) => {
    saut(40); y += 10;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(0, 0, 0);
    doc.text(T(titre).toUpperCase(), M, y);
    doc.setDrawColor(...accent); doc.setLineWidth(1.2); doc.line(M, y + 5, M + W, y + 5);
    y += 16; doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  };
  const tableau = (head, body, opts = {}) => {
    autoTable(doc, {
      startY: y, head: head ? [head.map(T)] : undefined, body: body.map((r) => r.map(T)),
      theme: head ? "grid" : "plain",
      styles: { font: "helvetica", fontSize: 10, cellPadding: 5, textColor: [0, 0, 0], lineColor: [220, 224, 230], lineWidth: head ? 0.5 : 0 },
      headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold" },
      columnStyles: head ? {} : { 0: { cellWidth: 160, fontStyle: "bold" } },
      margin: { left: M, right: M, top: 56, bottom: 60 }, ...opts,
    });
    y = doc.lastAutoTable.finalY + 8;
  };
  const reunion = reunions.find((r) => r.id === d.reunion_id);
  const sujet = sujets.find((x) => x.id === d.sujet_id);
  const resultat = L["dst_" + d.statut] || d.statut;

  section(L.res_info);
  tableau(null, [
    [L.res_num.replace(" {n}", ""), num],
    ...(reunion ? [[L.res_meeting, `${reunion.titre}${reunion.date_reunion ? " - " + D(reunion.date_reunion) : ""}`]] : []),
    ...(sujet ? [[L.res_subject, sujet.titre]] : []),
    [L.res_author, d.auteur_nom || "—"],
    [L.res_opened, D(d.created_at)],
    [L.res_closed, D(d.cloture_le)],
    [L.res_diffusion, d.diffusion === "bureau" ? L.diff_bureau : L.diff_comite],
  ]);

  section(L.res_text);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11.5);
  const tl = doc.splitTextToSize(T(d.titre), W); saut(tl.length * 15); doc.text(tl, M, y + 4); y += tl.length * 15 + 4;
  if (d.texte) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5);
    const lignes = doc.splitTextToSize(T(d.texte), W);
    saut(lignes.length * 14); doc.text(lignes, M, y + 4, { lineHeightFactor: 1.35 }); y += lignes.length * 14 + 6;
  }

  const compo = Array.isArray(d.membres_cloture) && d.membres_cloture.length
    ? d.membres_cloture
    : membres.map((m) => ({ nom: m.nom, president: m.est_president }));
  section(L.res_members.replace("{n}", String(compo.length)));
  tableau([L.member_col, L.role_col], compo.map((m) => [m.nom || "—", m.president ? L.res_president : L.res_member]));

  section(L.res_vote);
  const votants = d.pour + d.contre + d.abstention;
  tableau(null, [
    [L.res_quorum, String(d.quorum)],
    [L.res_votants, `${votants} / ${compo.length || d.nb_membres}`],
    [L.v_pour, String(d.pour)], [L.v_contre, String(d.contre)], [L.v_abstention, String(d.abstention)],
    [L.res_result, resultat],
  ]);
  const vd = votes.filter((v) => v.decision_id === d.id);
  section(L.res_nominal);
  const lignesVotes = compo.map((m) => {
    const v = vd.find((x) => (x.votant_nom || "") === (m.nom || ""));
    return [m.nom || "—", v ? L["v_" + v.choix] : L.res_no_vote, v ? D(v.created_at) : ""];
  });
  vd.filter((v) => !compo.some((m) => (m.nom || "") === (v.votant_nom || ""))).forEach((v) => lignesVotes.push([v.votant_nom || "—", L["v_" + v.choix], D(v.created_at)]));
  tableau([L.member_col, L.res_result, L.res_date], lignesVotes);

  doc.setFont("helvetica", "italic"); doc.setFontSize(9);
  const mention = doc.splitTextToSize(T(L.res_mention), W); saut(mention.length * 12 + 6); doc.text(mention, M, y + 6); y += mention.length * 12 + 10;

  // Signatures : un cadre par membre du comité à la clôture.
  section(L.res_sign);
  const BW = (W - 20) / 2, BH = 70;
  compo.forEach((m, i) => {
    if (i % 2 === 0) saut(BH + 12);
    const bx = M + (i % 2) * (BW + 20), by = y;
    doc.setDrawColor(200, 205, 212); doc.setLineWidth(0.6); doc.roundedRect(bx, by, BW, BH, 4, 4, "S");
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(T(m.nom || "—"), bx + 10, by + 16, { maxWidth: BW - 20 });
    doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.text(T(m.president ? L.res_president : L.res_member), bx + 10, by + 28);
    const sg = signatureDe(signatures, d, m);
    if (sg) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
      doc.text(T(L.pdf_esign.replace("{d}", D(sg.signe_le))), bx + 10, by + 40);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7);
      doc.text(T(L.pdf_ref.replace("{h}", String(sg.empreinte || "").slice(0, 16))), bx + 10, by + 48);
    } else {
      doc.setFont("helvetica", "italic"); doc.setFontSize(8);
      doc.text(T(L.pdf_esign_wait), bx + 10, by + 42);
    }
    doc.setDrawColor(0, 0, 0); doc.line(bx + 10, by + 56, bx + BW - 10, by + 56);
    doc.setFont("helvetica", "italic"); doc.setFontSize(7.5);
    doc.text(T(L.pdf_manual), bx + 10, by + 65);
    if (i % 2 === 1 || i === compo.length - 1) y += BH + 12;
  });

  piedsDePageOfficiels(doc, association, { marge: M, texte: `${L.pdf_confidential} - ${L.res_num.replace("{n}", num)}`, libellePage: (pg, n) => `${pg} / ${n}` });
  const fichier = `PV_resolution_${num}.pdf`;
  if (sortie === "blob") return { blob: doc.output("blob"), fichier, num };
  doc.save(fichier);
  return null;
}

// Archive le PV dans les documents du comité et le lie à la décision.
// Renvoie true si ce PV est celui retenu (un autre membre a pu le faire
// au même moment : le doublon est alors retiré).
async function archiverPvResolution({ d, data, association, profile, L, lang }) {
  const res = await exporterPvResolution({ d, votes: data.votes, reunions: data.reunions, sujets: data.sujets, membres: data.membres, signatures: data.signatures || [], association, L, lang, sortie: "blob" });
  const chemin = `${profile.association_id}/resolutions/${Date.now()}_${res.fichier}`;
  const { error: e1 } = await supabase.storage.from(BUCKET).upload(chemin, res.blob, { contentType: "application/pdf" });
  if (e1) return false;
  const { data: docRow, error: e2 } = await supabase.from("comite_documents").insert({
    titre: L.res_doc_title.replace("{n}", res.num).replace("{titre}", d.titre), chemin, nom_fichier: res.fichier,
    taille: res.blob.size, type_mime: "application/pdf", sujet_id: d.sujet_id || null, reunion_id: d.reunion_id || null,
  }).select("id").single();
  if (e2) { await supabase.storage.from(BUCKET).remove([chemin]); return false; }
  const { data: lie } = await supabase.rpc("lier_pv_resolution", { p_id: d.id, p_document_id: docRow.id });
  if (lie !== true) {
    await supabase.from("comite_documents").delete().eq("id", docRow.id);
    await supabase.storage.from(BUCKET).remove([chemin]);
    return false;
  }
  return true;
}

// ---------- Documents ----------
function DocumentsPanel({ L, t, lang, documents, sujets, profile, isPresident, onChanged }) {
  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({ titre: "", sujet_id: "", file: null });
  const [busy, setBusy] = useState(false);

  async function envoyer() {
    if (!f.file) return;
    if (f.file.size > 20 * 1024 * 1024) { alert(L.too_big); return; }
    setBusy(true);
    const propre = f.file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const chemin = `${profile.association_id}/${Date.now()}_${propre}`;
    const { error: e1 } = await supabase.storage.from(BUCKET).upload(chemin, f.file);
    if (e1) { setBusy(false); alert(friendlyError(e1, t)); return; }
    const { error: e2 } = await supabase.from("comite_documents").insert({
      titre: f.titre.trim() || f.file.name, chemin, nom_fichier: f.file.name, taille: f.file.size, type_mime: f.file.type || null, sujet_id: f.sujet_id || null,
    });
    setBusy(false);
    if (e2) { await supabase.storage.from(BUCKET).remove([chemin]); alert(friendlyError(e2, t)); return; }
    setF({ titre: "", sujet_id: "", file: null });
    setShowForm(false);
    onChanged();
  }
  async function ouvrir(doc) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.chemin, 60);
    if (error) { alert(friendlyError(error, t)); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }
  async function supprimer(doc) {
    if (!window.confirm(L.confirm_delete_doc)) return;
    const { error } = await supabase.from("comite_documents").delete().eq("id", doc.id);
    if (error) { alert(friendlyError(error, t)); return; }
    await supabase.storage.from(BUCKET).remove([doc.chemin]);
    onChanged();
  }

  return (
    <>
      {!showForm && <div style={{ marginBottom: 14 }}><Btn onClick={() => setShowForm(true)}><Upload size={14} /> {L.upload}</Btn></div>}
      {showForm && (
        <Card style={{ marginBottom: 16 }}>
          <Field label={L.doc_file}><input type="file" onChange={(e) => setF({ ...f, file: e.target.files?.[0] || null })} /></Field>
          <Field label={L.doc_title}><input style={inputStyle} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} placeholder={f.file?.name || ""} /></Field>
          <Field label={L.doc_subject}>
            <select style={inputStyle} value={f.sujet_id} onChange={(e) => setF({ ...f, sujet_id: e.target.value })}>
              <option value="">—</option>
              {sujets.map((s) => <option key={s.id} value={s.id}>{s.titre}</option>)}
            </select>
          </Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={envoyer} disabled={busy || !f.file}><Upload size={14} /> {L.upload}</Btn>
            <Btn variant="outline" onClick={() => setShowForm(false)}>{L.cancel}</Btn>
          </div>
        </Card>
      )}
      {documents.length === 0 ? <p style={muted}>{L.no_documents}</p> : (
        <div style={{ display: "grid", gap: 8 }}>
          {documents.map((doc) => {
            const sujet = sujets.find((s) => s.id === doc.sujet_id);
            return (
              <Card key={doc.id} style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                  <FileText size={18} color={TEAL} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.titre}</div>
                    <div style={muted}>
                      {doc.auteur_nom && L.added_by.replace("{nom}", doc.auteur_nom)} · {formatEventDateTime(doc.created_at, lang)}
                      {sujet && <> · {sujet.titre}</>}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={smallBtn} onClick={() => ouvrir(doc)}>{L.open}</button>
                  {(isPresident || doc.auteur_id === profile.id) && <button style={{ ...smallBtn, color: RED }} onClick={() => supprimer(doc)}><Trash2 size={13} /></button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------- Rubrique ----------
const ONGLETS = [
  { id: "reunions", icon: CalendarDays },
  { id: "sujets", icon: MessageSquare },
  { id: "decisions", icon: Gavel },
  { id: "documents", icon: FileText },
  { id: "membres", icon: Users },
];

export default function ComiteRestreint({ profile, association }) {
  const { t, lang } = useLang();
  const L = TXT[lang === "en" ? "en" : "fr"];
  const isPresident = profile.role === "bureau_president";
  const [acces, setAcces] = useState(null);
  const [erreur, setErreur] = useState(false);
  const [onglet, setOnglet] = useState("reunions");
  const [data, setData] = useState({ membres: [], reunions: [], sujets: [], decisions: [], votes: [], documents: [] });
  const [form, setForm] = useState(null); // "reunion" | "sujet" | "decision"
  const [sujetOuvert, setSujetOuvert] = useState(null);

  const load = useCallback(async () => {
    const { data: a, error } = await supabase.rpc("comite_mon_acces");
    if (error) { setErreur(true); setAcces({ membre: false }); return; }
    setAcces(a);
    const assoc = profile.association_id;
    if (!a?.membre) {
      const { data: dec } = await supabase.from("comite_decisions").select("*").eq("association_id", assoc).eq("diffusion", "bureau").neq("statut", "en_vote").order("cloture_le", { ascending: false });
      setData((d) => ({ ...d, decisions: dec || [] }));
      return;
    }
    const [mb, re, su, de, vo, doc, sg] = await Promise.all([
      supabase.rpc("comite_membres_effectifs"),
      supabase.from("comite_reunions").select("*").eq("association_id", assoc).order("date_reunion", { ascending: false, nullsFirst: true }),
      supabase.from("comite_sujets").select("*").eq("association_id", assoc).order("created_at", { ascending: false }),
      supabase.from("comite_decisions").select("*").eq("association_id", assoc).order("created_at", { ascending: false }),
      supabase.from("comite_votes").select("*").eq("association_id", assoc),
      supabase.from("comite_documents").select("*").eq("association_id", assoc).order("created_at", { ascending: false }),
      supabase.from("comite_pv_signatures").select("*").eq("association_id", assoc),
    ]);
    setData({ membres: mb.data || [], reunions: re.data || [], sujets: su.data || [], decisions: de.data || [], votes: vo.data || [], documents: doc.data || [], signatures: sg.error ? [] : sg.data || [], signaturesActives: !sg.error });
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  // PV de résolution : dès qu'une décision est close (numérotée par la
  // base — sql/2026-10-10g) sans PV archivé, le premier membre du comité
  // qui ouvre la rubrique le génère et l'archive automatiquement.
  const archivage = useRef(new Set());
  useEffect(() => {
    if (!acces?.membre) return;
    if (!data.signaturesActives) return; // script 2026-10-10i pas encore exécuté
    const aFaire = data.decisions.filter((d) => d.statut !== "en_vote" && d.numero != null && !d.pv_document_id && !archivage.current.has(d.id)
      && signaturesManquantes(d, data.membres, data.signatures) === 0);
    if (!aFaire.length) return;
    aFaire.forEach((d) => archivage.current.add(d.id));
    (async () => {
      let change = false;
      for (const d of aFaire) {
        try { if (await archiverPvResolution({ d, data, association, profile, L, lang })) change = true; } catch { /* nouvel essai à la prochaine ouverture */ }
      }
      if (change) load();
    })();
  }, [data, acces?.membre, association, profile, L, lang, load]);

  if (!acces) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  const entete = (intro) => (
    <div style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 22, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 10 }}><ShieldHalf size={22} /> {L.title}</h2>
      <p style={{ fontSize: 13, color: "#686F7D", margin: 0, maxWidth: 680 }}>{intro}</p>
    </div>
  );

  if (erreur) return <Container><Section>{entete(L.intro)}<Card><p style={{ margin: 0, color: RED }}>{L.setup_needed}</p></Card></Section></Container>;

  // Bureau hors comité : seulement les décisions communiquées.
  if (!acces.membre) {
    return (
      <Container>
        <Section>
          {entete(L.intro_bureau)}
          {data.decisions.length === 0 ? <p style={muted}>{L.no_access}</p>
            : data.decisions.map((d) => <DecisionCard key={d.id} d={d} L={L} t={t} lang={lang} votes={[]} membres={[]} reunions={[]} sujets={[]} profile={profile} isPresident={false} lectureSeule onChanged={load} />)}
        </Section>
      </Container>
    );
  }

  const fermerForm = (recharger) => { setForm(null); if (recharger) load(); };
  const nouveau = { reunions: ["reunion", L.new_meeting], sujets: ["sujet", L.new_subject], decisions: ["decision", L.new_decision] }[onglet];

  return (
    <Container>
      <Section>
        {entete(L.intro)}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, borderBottom: "1px solid #E4E7EE", paddingBottom: 8 }}>
          {ONGLETS.map(({ id, icon: Icon }) => (
            <button key={id} onClick={() => { setOnglet(id); setForm(null); }}
              style={{ ...smallBtn, border: "none", padding: "7px 12px", fontSize: 13, fontWeight: 600, background: onglet === id ? "var(--primary)" : "transparent", color: onglet === id ? "white" : "#2C3A50" }}>
              <Icon size={14} /> {L["tab_" + id]}
            </button>
          ))}
        </div>

        {nouveau && !form && <div style={{ marginBottom: 14 }}><Btn onClick={() => setForm(nouveau[0])}><Plus size={14} /> {nouveau[1]}</Btn></div>}

        {onglet === "reunions" && (
          <>
            {form === "reunion" && <ReunionForm L={L} t={t} onDone={fermerForm} />}
            {data.reunions.length === 0 ? <p style={muted}>{L.no_meetings}</p>
              : data.reunions.map((r) => <ReunionCard key={r.id} reunion={r} L={L} t={t} lang={lang} sujets={data.sujets} decisions={data.decisions} membres={data.membres} association={association} profile={profile} isPresident={isPresident} onChanged={load} />)}
          </>
        )}

        {onglet === "sujets" && (
          <>
            {form === "sujet" && <SujetForm L={L} t={t} reunions={data.reunions} onDone={fermerForm} />}
            {data.sujets.length === 0 ? <p style={muted}>{L.no_subjects}</p> : data.sujets.map((s) => {
              const ouvert = sujetOuvert === s.id;
              const reunion = data.reunions.find((r) => r.id === s.reunion_id);
              return (
                <Card key={s.id} style={{ marginBottom: 12 }}>
                  <div onClick={() => setSujetOuvert(ouvert ? null : s.id)} style={{ display: "flex", justifyContent: "space-between", gap: 10, cursor: "pointer", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      {ouvert ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      <div>
                        <h3 style={{ fontSize: 15.5, margin: "0 0 3px" }}>{s.titre}</h3>
                        <div style={muted}>{s.auteur_nom}{reunion && <> · {reunion.titre}</>}</div>
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 10px", background: s.statut === "ouvert" ? "#FFF3D6" : "#EEF1F6", color: s.statut === "ouvert" ? "#8a6d1a" : "#4A5468" }}>{L["st_" + s.statut]}</span>
                  </div>
                  {ouvert && <SujetThread sujet={s} L={L} t={t} lang={lang} profile={profile} reunions={data.reunions} isPresident={isPresident} onChanged={load} />}
                </Card>
              );
            })}
          </>
        )}

        {onglet === "decisions" && (
          <>
            {form === "decision" && <DecisionForm L={L} t={t} reunions={data.reunions} sujets={data.sujets} nbMembres={Math.max(data.membres.length, 1)} onDone={fermerForm} />}
            {data.decisions.length === 0 ? <p style={muted}>{L.no_decisions}</p>
              : data.decisions.map((d) => <DecisionCard key={d.id} d={d} L={L} t={t} lang={lang} votes={data.votes} membres={data.membres} reunions={data.reunions} sujets={data.sujets} profile={profile} isPresident={isPresident} onChanged={load} association={association} documents={data.documents} signatures={data.signatures || []} />)}
          </>
        )}

        {onglet === "documents" && <DocumentsPanel L={L} t={t} lang={lang} documents={data.documents} sujets={data.sujets} profile={profile} isPresident={isPresident} onChanged={load} />}

        {onglet === "membres" && <MembresPanel L={L} t={t} membres={data.membres} isPresident={isPresident} associationId={profile.association_id} onChanged={load} />}

      </Section>
    </Container>
  );
}
