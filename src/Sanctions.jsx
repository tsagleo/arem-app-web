// =====================================================================
// Sanctions.jsx — Volet disciplinaire (suite 76, 2026-09-21 ; refonte
// « nouvelle génération » 2026-10-10)
// =====================================================================
// Origine : barème entièrement configurable par chaque association, types
// Avertissement / Amende / Suspension / Exclusion, double validation par
// l'approbateur désigné (associations.approbateur_suppression_id), paiement
// en ligne des amendes (carte ou Interac). Voir sql/2026-09-21d_sanctions.sql.
//
// Refonte demandée par l'utilisateur le 2026-10-10 (« réorganisation
// complète, retouche professionnelle, dernier cri ») — voir
// sql/2026-10-10j_sanctions_nouvelle_generation.sql :
//  • 4 onglets pour le bureau : Tableau de bord (indicateurs, motifs les
//    plus fréquents, alertes), Registre (par adhérent ou en liste, fiches
//    dépliables, filtres, export CSV), À traiter (approbations, recours,
//    virements à vérifier), Barème & règles (catégories, paliers, seuil,
//    délais de recours et de paiement, prescription) ;
//  • droit de recours de l'adhérent, décision du bureau (maintenue,
//    réduite, annulée) ;
//  • échéance de paiement des amendes, retard signalé, rappels automatiques ;
//  • prescription : une mesure ancienne ne compte plus dans la récidive ;
//  • notification officielle PDF (en-tête légal, signature électronique
//    de la validation, droit de recours) ;
//  • double validation imposée par la base (plus seulement à l'écran).
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import {
  Gavel, Plus, X, Loader2, CreditCard, Upload, Search, Info, Clock, Wallet, ShieldCheck, ChevronDown, ChevronRight,
  LayoutDashboard, ListChecks, Inbox, SlidersHorizontal, FileDown, AlertTriangle, Users, Scale, TrendingUp,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, inputStyle, useLang, RED, TEAL, TEAL_LIGHT, CHARCOAL, money, todayISO, friendlyError, formatEventDateTime } from "./shared";
import { pdfTexte, enTeteOfficiel, piedsDePageOfficiels, couleurAssociation } from "./pdfOfficiel";

const SANCTION_TYPES = ["avertissement", "amende", "suspension", "exclusion"];
const TYPE_LABEL_KEY = { avertissement: "san_type_avertissement", amende: "san_type_amende", suspension: "san_type_suspension", exclusion: "san_type_exclusion" };
const STATUT_LABEL_KEY = { proposee: "san_status_proposee", validee: "san_status_validee", rejetee: "san_status_rejetee", annulee: "san_status_annulee" };
const PALIER_LABEL_KEY = { 1: "san_col_palier1", 2: "san_col_palier2", 3: "san_col_palier3" };

const AMBER = "#8A5A00";
const AMBER_LIGHT = "#FBF3D9";
const AMBER_BORDER = "#D9B84A";
const RED_LIGHT = "#FBE4E1";
const RED_BORDER = "#EFB4AC";
const GREY = "#6B7280";
const GREY_LIGHT = "#F5F5F3";
const GREY_BORDER = "#D8D8D4";
const TYPE_COLOR = { avertissement: "#2B6CB0", amende: AMBER, suspension: "#9C4221", exclusion: RED };

const TXT = {
  fr: {
    tab_dashboard: "Tableau de bord", tab_registre: "Registre", tab_traiter: "À traiter", tab_regles: "Barème & règles",
    kpi_month: "Mesures ce mois", kpi_pending: "À traiter", kpi_unpaid: "Amendes impayées", kpi_overdue: "En retard",
    kpi_recovery: "Taux de recouvrement", kpi_members: "Adhérents concernés (12 mois)",
    top_motifs: "Motifs les plus fréquents (12 mois)", no_data: "Aucune donnée.",
    alerts: "Alertes", alert_overdue: "{n} amende(s) en retard de paiement ({m})", alert_suspended: "{n} suspension(s) en cours",
    alert_recidive: "{n} adhérent(s) avec 3 mesures ou plus non prescrites", alert_recours: "{n} recours à examiner", alert_none: "Aucune alerte. ✓",
    view_members: "Par adhérent", view_list: "Liste chronologique", export_csv: "Exporter (CSV)",
    filter_type: "Tous les types", filter_period: "Toute période", period_month: "Ce mois", period_quarter: "3 derniers mois", period_year: "12 derniers mois",
    member_summary: "{n} mesure(s) · {u} à payer", see_all: "Voir les mesures",
    proposed_by: "Proposée par {nom} le {d}", validated_by: "Validée par {nom} le {d}", rejected: "Rejetée par {nom}{m}",
    period: "Du {a} au {b}", due: "Échéance : {d}", overdue: "En retard", prescribed: "Prescrite", suspended_now: "Suspension en cours",
    recours_en_cours: "Recours en cours", recours_maintenue: "Recours : mesure maintenue", recours_reduite: "Recours : montant réduit (initial {m})", recours_annulee: "Recours : mesure annulée",
    recours_motif: "Motif du recours : {m}", recours_decision: "Décision : {m}",
    notif_pdf: "Notification (PDF)", contest: "Contester cette mesure", contest_prompt: "Expliquez pourquoi vous contestez cette mesure (le bureau examinera votre recours) :",
    contest_done: "Votre recours a été transmis au bureau.", contest_until: "Recours possible jusqu'au {d}",
    decide_recours: "Statuer sur le recours", keep: "Maintenir", reduce: "Réduire le montant", cancel_m: "Annuler la mesure",
    reduce_prompt: "Nouveau montant (inférieur à {m}) :", comment_prompt: "Commentaire de la décision (communiqué à l'adhérent, facultatif) :",
    pending_approvals: "Mesures à approuver", recours_title: "Recours à examiner", interac_title: "Virements Interac à vérifier",
    nothing: "Rien à traiter pour le moment. ✓", not_approver: "En attente de l'approbateur désigné : {nom}.",
    rules_title: "Règles disciplinaires", paliers: "Paliers de récidive (1er, 2e, 3e manquement)", seuil: "Seuil de double validation des amendes ($)",
    delai_recours: "Délai de recours (jours)", delai_paiement: "Délai de paiement des amendes (jours)", prescription: "Prescription (mois) — au-delà, une mesure ne compte plus dans la récidive",
    rules_save: "Enregistrer les règles", rules_saved: "Règles enregistrées.", rules_sql: "Réglage indisponible : exécutez d'abord sql/2026-10-10j_sanctions_nouvelle_generation.sql.",
    approver_note: "Approbateur désigné (Configuration) : {nom}. Les suspensions, exclusions et amendes au-dessus du seuil lui sont soumises.",
    my_title: "Mon dossier disciplinaire", my_to_pay: "Montant à régler : {m}", my_none: "Aucune mesure vous concernant. ✓",
    // PDF
    pdf_title: "Notification de mesure disciplinaire", pdf_to: "Destinataire", pdf_ref: "Référence", pdf_date: "Date",
    pdf_type: "Mesure", pdf_cat: "Catégorie", pdf_motif: "Motif", pdf_amount: "Montant", pdf_due: "À régler avant le",
    pdf_period: "Période", pdf_status: "Statut", pdf_validation: "Validation",
    pdf_recours: "Droit de recours : vous pouvez contester cette mesure dans un délai de {n} jours à compter de sa notification, depuis votre espace (rubrique Sanctions → « Contester cette mesure »). Le bureau examinera votre recours et vous informera de sa décision.",
    pdf_esign: "Signé électroniquement par {nom} le {d} (validation enregistrée dans l'application).", pdf_manual: "Signature manuscrite (facultative)",
    pdf_pay: "Paiement en ligne (carte ou virement Interac) depuis votre espace, rubrique Sanctions.",
    csv_cols: ["Adhérent", "Type", "Catégorie", "Motif", "Montant", "Statut", "Payée", "Échéance", "Recours", "Date"],
  },
  en: {
    tab_dashboard: "Dashboard", tab_registre: "Register", tab_traiter: "To handle", tab_regles: "Schedule & rules",
    kpi_month: "Measures this month", kpi_pending: "To handle", kpi_unpaid: "Unpaid fines", kpi_overdue: "Overdue",
    kpi_recovery: "Recovery rate", kpi_members: "Members concerned (12 months)",
    top_motifs: "Most frequent reasons (12 months)", no_data: "No data.",
    alerts: "Alerts", alert_overdue: "{n} fine(s) overdue ({m})", alert_suspended: "{n} ongoing suspension(s)",
    alert_recidive: "{n} member(s) with 3 or more non-prescribed measures", alert_recours: "{n} appeal(s) to review", alert_none: "No alert. ✓",
    view_members: "By member", view_list: "Chronological list", export_csv: "Export (CSV)",
    filter_type: "All types", filter_period: "Any period", period_month: "This month", period_quarter: "Last 3 months", period_year: "Last 12 months",
    member_summary: "{n} measure(s) · {u} unpaid", see_all: "Show measures",
    proposed_by: "Proposed by {nom} on {d}", validated_by: "Approved by {nom} on {d}", rejected: "Rejected by {nom}{m}",
    period: "From {a} to {b}", due: "Due: {d}", overdue: "Overdue", prescribed: "Prescribed", suspended_now: "Ongoing suspension",
    recours_en_cours: "Appeal pending", recours_maintenue: "Appeal: upheld", recours_reduite: "Appeal: amount reduced (initially {m})", recours_annulee: "Appeal: measure cancelled",
    recours_motif: "Appeal reason: {m}", recours_decision: "Decision: {m}",
    notif_pdf: "Notice (PDF)", contest: "Appeal this measure", contest_prompt: "Explain why you appeal this measure (the board will review it):",
    contest_done: "Your appeal has been sent to the board.", contest_until: "Appeal possible until {d}",
    decide_recours: "Decide on the appeal", keep: "Uphold", reduce: "Reduce the amount", cancel_m: "Cancel the measure",
    reduce_prompt: "New amount (lower than {m}):", comment_prompt: "Comment on the decision (shared with the member, optional):",
    pending_approvals: "Measures to approve", recours_title: "Appeals to review", interac_title: "Interac transfers to verify",
    nothing: "Nothing to handle for now. ✓", not_approver: "Waiting for the designated approver: {nom}.",
    rules_title: "Disciplinary rules", paliers: "Repeat-offence tiers (1st, 2nd, 3rd breach)", seuil: "Fine amount requiring double approval ($)",
    delai_recours: "Appeal period (days)", delai_paiement: "Fine payment period (days)", prescription: "Prescription (months) — beyond it, a measure no longer counts as a repeat",
    rules_save: "Save rules", rules_saved: "Rules saved.", rules_sql: "Setting unavailable: first run sql/2026-10-10j_sanctions_nouvelle_generation.sql.",
    approver_note: "Designated approver (Configuration): {nom}. Suspensions, exclusions and fines above the threshold are submitted to them.",
    my_title: "My disciplinary record", my_to_pay: "Amount to pay: {m}", my_none: "No measure concerning you. ✓",
    pdf_title: "Notice of disciplinary measure", pdf_to: "Recipient", pdf_ref: "Reference", pdf_date: "Date",
    pdf_type: "Measure", pdf_cat: "Category", pdf_motif: "Reason", pdf_amount: "Amount", pdf_due: "Payable by",
    pdf_period: "Period", pdf_status: "Status", pdf_validation: "Approval",
    pdf_recours: "Right of appeal: you may appeal this measure within {n} days of notice, from your space (Sanctions → \"Appeal this measure\"). The board will review your appeal and inform you of its decision.",
    pdf_esign: "Electronically signed by {nom} on {d} (approval recorded in the application).", pdf_manual: "Handwritten signature (optional)",
    pdf_pay: "Online payment (card or Interac transfer) from your space, Sanctions section.",
    csv_cols: ["Member", "Type", "Category", "Reason", "Amount", "Status", "Paid", "Due date", "Appeal", "Date"],
  },
};
const fill = (s, v) => Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(String(x)), s);

function StatusBadge({ label, color, bg, border }) {
  return <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color, background: bg, border: `1.5px solid ${border}`, whiteSpace: "nowrap" }}>{label}</span>;
}
function statusBadgeProps(statut) {
  if (statut === "validee") return { color: "#1F8A5C", bg: TEAL_LIGHT, border: TEAL };
  if (statut === "rejetee") return { color: RED, bg: RED_LIGHT, border: RED_BORDER };
  if (statut === "annulee") return { color: GREY, bg: GREY_LIGHT, border: GREY_BORDER };
  return { color: AMBER, bg: AMBER_LIGHT, border: AMBER_BORDER };
}
function Chip({ children, color = GREY, bg = GREY_LIGHT }) {
  return <span style={{ fontSize: 10.5, fontWeight: 700, color, background: bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{children}</span>;
}
function Kpi({ icon: Icon, label, value, color, onClick }) {
  return (
    <Card style={{ padding: "14px 16px", cursor: onClick ? "pointer" : "default" }}>
      <div onClick={onClick}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
          <Icon size={13} color={color || "rgba(42,42,42,.42)"} />
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: "rgba(42,42,42,.45)" }}>{label.toUpperCase()}</div>
        </div>
        <div style={{ fontSize: 19, fontWeight: 700, color: color || CHARCOAL }}>{value}</div>
      </div>
    </Card>
  );
}
const dateLocale = (s) => { const j = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(String(s || "")); return j ? new Date(+j[1], +j[2] - 1, +j[3]) : null; };

export default function Sanctions({ profile, isBureau, association }) {
  const { t, lang } = useLang();
  const S = TXT[lang === "en" ? "en" : "fr"];
  const moneyF = (n) => money(n, association?.devise_monetaire);
  const [assoc, setAssoc] = useState(association || {});
  useEffect(() => { setAssoc(association || {}); }, [association]);
  const paliersActifs = assoc?.sanctions_paliers_actifs !== false;
  const seuilValidation = Number(assoc?.sanctions_seuil_validation ?? 25);
  const delaiRecours = Number(assoc?.sanctions_delai_recours_jours ?? 15);
  const prescriptionMois = Number(assoc?.sanctions_prescription_mois ?? 12);
  const approbateurId = assoc?.approbateur_suppression_id || null;
  const jeSuisApprobateur = !!approbateurId && approbateurId === profile.id;
  const fmtJ = (d) => (d ? d.toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA", { day: "numeric", month: "long", year: "numeric" }) : "—");

  const [members, setMembers] = useState([]);
  const [baremes, setBaremes] = useState([]);
  const [sanctions, setSanctions] = useState([]);
  const [approbateurProfile, setApprobateurProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [amendeClaims, setAmendeClaims] = useState([]);
  const [payingId, setPayingId] = useState(null);
  const [interacFiles, setInteracFiles] = useState({});
  const [interacUploading, setInteracUploading] = useState(null);
  const [interacMsg, setInteracMsg] = useState({});
  const [claimActionId, setClaimActionId] = useState(null);
  const [onglet, setOnglet] = useState("dashboard");
  const [mesuresOuvertes, setMesuresOuvertes] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: m }, { data: b }, { data: s }, { data: claims }, apRes] = await Promise.all([
      supabase.from("members").select("id,nom,statut,photo_url").order("nom"),
      supabase.from("sanctions_baremes").select("*").order("ordre"),
      supabase.from("sanctions").select("*").order("date_proposition", { ascending: false }),
      supabase.from("interac_payment_claims").select("*").eq("type", "amende").order("created_at", { ascending: false }),
      approbateurId ? supabase.from("profiles").select("id,nom_complet").eq("id", approbateurId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setMembers(m || []); setBaremes(b || []); setSanctions(s || []); setAmendeClaims(claims || []); setApprobateurProfile(apRes.data || null);
    setLoading(false);
  }, [profile.association_id, approbateurId]);
  useEffect(() => { load(); }, [load]);

  const rpcErr = (e) => (e?.code === "P0001" ? e.message : e?.code === "PGRST202" || e?.code === "42883" ? S.rules_sql : friendlyError(e, t));

  // ---------- Paiement en ligne d'une amende (adhérent) ----------
  async function payerAmendeEnLigne(s) {
    setPayingId(s.id);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", { body: { type: "amende", sanction_id: s.id } });
      if (error) throw error;
      if (data?.error) { alert(data.error); return; }
      if (data?.url) { window.location.href = data.url; return; }
      alert(t("san_pay_online_error"));
    } catch (e) {
      alert(t("san_pay_online_error") + " " + friendlyError(e, t));
    } finally {
      setPayingId(null);
    }
  }
  function pendingInteracClaimFor(sanctionId) { return amendeClaims.find((c) => c.sanction_id === sanctionId && c.statut === "en_attente"); }
  async function submitInteracForAmende(s) {
    const file = interacFiles[s.id];
    if (!file || !profile.member_id) return;
    if (!window.confirm(t("interac_confirm_submit_proof").replace("{montant}", moneyF(s.montant)))) return;
    setInteracUploading(s.id); setInteracMsg((p) => ({ ...p, [s.id]: "" }));
    try {
      const path = `${profile.association_id}/${profile.member_id}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from("interac-proofs").upload(path, file);
      if (uploadErr) throw uploadErr;
      const { data, error } = await supabase.from("interac_payment_claims").insert({
        association_id: profile.association_id, member_id: profile.member_id, type: "amende",
        sanction_id: s.id, montant: s.montant, fichier_path: path, fichier_nom: file.name,
      }).select().single();
      if (error) throw error;
      setAmendeClaims((p) => [data, ...p]);
      setInteracMsg((p) => ({ ...p, [s.id]: t("ms_interac_submit_success") }));
      setInteracFiles((p) => { const next = { ...p }; delete next[s.id]; return next; });
    } catch (e) {
      setInteracMsg((p) => ({ ...p, [s.id]: t("ms_interac_submit_error") + " " + friendlyError(e, t) }));
    } finally {
      setInteracUploading(null);
    }
  }
  async function voirPreuveAmende(claim) {
    const { data, error } = await supabase.storage.from("interac-proofs").createSignedUrl(claim.fichier_path, 60);
    if (!error && data) window.open(data.signedUrl, "_blank");
  }
  async function confirmerAmendeInterac(claim) {
    if (!isBureau) return;
    if (!window.confirm(t("interac_confirm_claim").replace("{nom}", nameOf(claim.member_id)).replace("{montant}", moneyF(claim.montant)))) return;
    setClaimActionId(claim.id);
    try {
      const { error: sancErr } = await supabase.from("sanctions").update({ paye: true, date_paiement: todayISO() }).eq("id", claim.sanction_id);
      if (sancErr) throw sancErr;
      const { data, error } = await supabase.from("interac_payment_claims").update({
        statut: "confirme", confirmed_at: new Date().toISOString(), confirmed_by: profile.id,
      }).eq("id", claim.id).select().single();
      if (error) throw error;
      setAmendeClaims((p) => p.map((c) => (c.id === claim.id ? data : c)));
      setSanctions((p) => p.map((x) => (x.id === claim.sanction_id ? { ...x, paye: true, date_paiement: todayISO() } : x)));
      const { error: txErr } = await supabase.from("payment_transactions").insert({
        association_id: profile.association_id, member_id: claim.member_id, type: "amende",
        montant: claim.montant, methode: "interac", reference: claim.id, sanction_id: claim.sanction_id,
      });
      if (txErr) console.error("Échec de l'écriture au registre des transactions :", txErr);
    } catch (e) {
      alert(friendlyError(e, t));
    } finally {
      setClaimActionId(null);
    }
  }
  async function rejeterAmendeInterac(claim) {
    if (!isBureau) return;
    const commentaire = window.prompt(t("interac_claims_reject_prompt")) || null;
    if (!window.confirm(t("interac_confirm_reject_claim"))) return;
    setClaimActionId(claim.id);
    const { data, error } = await supabase.from("interac_payment_claims").update({
      statut: "rejete", confirmed_at: new Date().toISOString(), confirmed_by: profile.id, commentaire_bureau: commentaire,
    }).eq("id", claim.id).select().single();
    setClaimActionId(null);
    if (!error) setAmendeClaims((p) => p.map((c) => (c.id === claim.id ? data : c)));
  }

  function nameOf(id) { return members.find((m) => m.id === id)?.nom || "—"; }
  const approbateurNom = approbateurProfile?.nom_complet || "";
  const baremesActifs = baremes.filter((b) => b.actif);

  // ---------- Barème ----------
  const [newCategorie, setNewCategorie] = useState({ categorie: "", palier_1: "", palier_2: "", palier_3: "" });
  const [bSaving, setBSaving] = useState(false);
  async function addCategorie() {
    if (!newCategorie.categorie.trim()) return;
    setBSaving(true);
    const { data, error } = await supabase.from("sanctions_baremes").insert({
      association_id: profile.association_id, categorie: newCategorie.categorie.trim(),
      palier_1: Number(newCategorie.palier_1) || 0, palier_2: Number(newCategorie.palier_2) || 0, palier_3: Number(newCategorie.palier_3) || 0,
      ordre: baremes.length,
    }).select().single();
    setBSaving(false);
    if (error) { alert(friendlyError(error, t)); return; }
    setBaremes((p) => [...p, data]);
    setNewCategorie({ categorie: "", palier_1: "", palier_2: "", palier_3: "" });
  }
  async function updateBaremeMontant(id, field, value) {
    setBaremes((p) => p.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
    const { error } = await supabase.from("sanctions_baremes").update({ [field]: Number(value) || 0 }).eq("id", id);
    if (error) { alert(friendlyError(error, t)); load(); }
  }
  async function archiveCategorie(b) {
    if (!window.confirm(t("san_confirm_archive_categorie").replace("{nom}", b.categorie))) return;
    const { error } = await supabase.from("sanctions_baremes").update({ actif: false }).eq("id", b.id);
    if (error) { alert(friendlyError(error, t)); return; }
    setBaremes((p) => p.map((x) => (x.id === b.id ? { ...x, actif: false } : x)));
  }

  // ---------- Règles ----------
  const [regles, setRegles] = useState(null);
  const [reglesMsg, setReglesMsg] = useState("");
  async function saveRegles(regles) {
    const patch = {
      sanctions_paliers_actifs: !!regles.paliers, sanctions_seuil_validation: Number(regles.seuil) || 0,
      sanctions_delai_recours_jours: Number(regles.recours) || 0, sanctions_delai_paiement_jours: Number(regles.paiement) || 0,
      sanctions_prescription_mois: Number(regles.prescription) || 0,
    };
    const { data, error } = await supabase.from("associations").update(patch).eq("id", assoc.id).select().single();
    if (error) { setReglesMsg(error.code === "PGRST204" || /column/i.test(error.message || "") ? S.rules_sql : friendlyError(error, t)); return; }
    setAssoc(data); setReglesMsg(S.rules_saved);
  }

  // ---------- Prescription et récidive ----------
  const limitePrescription = new Date(); limitePrescription.setMonth(limitePrescription.getMonth() - prescriptionMois);
  const estPrescrite = (s) => prescriptionMois > 0 && new Date(s.date_validation || s.date_proposition) < limitePrescription;
  function priorOccurrences(memberId, baremeId) {
    if (!memberId || !baremeId) return 0;
    return sanctions.filter((s) => s.member_id === memberId && s.bareme_id === baremeId && s.statut !== "rejetee" && s.statut !== "annulee" && !estPrescrite(s)).length;
  }
  function suggestedPalierFor(memberId, baremeId) {
    if (!memberId || !baremeId) return 1;
    return Math.min(priorOccurrences(memberId, baremeId) + 1, 3);
  }

  // ---------- Consigner une mesure ----------
  const [showCreateForm, setShowCreateForm] = useState(false);
  const emptyDraft = { member_id: "", type: "avertissement", bareme_id: "", palier: 1, montant: "", motif: "", date_debut: todayISO(), date_fin: "" };
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const selectedBareme = baremesActifs.find((b) => b.id === draft.bareme_id);
  function onCategorieChange(baremeId) {
    const b = baremesActifs.find((x) => x.id === baremeId);
    if (!b) { setDraft((d) => ({ ...d, bareme_id: "", montant: "" })); return; }
    const palier = paliersActifs ? suggestedPalierFor(draft.member_id, baremeId) : 1;
    setDraft((d) => ({ ...d, bareme_id: baremeId, palier, montant: String(b["palier_" + palier]) }));
  }
  function onPalierChange(palier) {
    setDraft((d) => ({ ...d, palier, montant: selectedBareme ? String(selectedBareme["palier_" + palier]) : d.montant }));
  }
  function onTypeChange(type) { setDraft((d) => ({ ...emptyDraft, member_id: d.member_id, motif: d.motif, type })); }
  function willNeedValidation() {
    if (draft.type === "avertissement") return false;
    if (!approbateurId || approbateurId === profile.id) return false;
    if (draft.type === "amende") return Number(draft.montant || 0) >= seuilValidation;
    return true;
  }
  async function submitSanction() {
    if (!isBureau) return;
    if (!draft.member_id || !draft.motif.trim()) { alert(t("san_error_required_fields")); return; }
    if (draft.type === "amende" && !(Number(draft.montant) > 0)) { alert(t("san_error_required_fields")); return; }
    if (draft.type === "suspension" && (!draft.date_debut || !draft.date_fin)) { alert(t("san_error_required_fields")); return; }
    const memberName = nameOf(draft.member_id);
    const needsValidation = willNeedValidation();
    const typeLabel = t(TYPE_LABEL_KEY[draft.type]);
    const confirmMsg = needsValidation
      ? t("san_confirm_propose").replace("{type}", typeLabel).replace("{nom}", memberName).replace("{approbateur}", approbateurNom)
      : t("san_confirm_immediate").replace("{type}", typeLabel).replace("{nom}", memberName);
    if (!window.confirm(confirmMsg)) return;
    setSaving(true);
    const now = new Date().toISOString();
    const { data, error } = await supabase.from("sanctions").insert({
      association_id: profile.association_id, member_id: draft.member_id, type: draft.type,
      bareme_id: draft.type === "amende" ? (draft.bareme_id || null) : null,
      categorie_nom: draft.type === "amende" && selectedBareme ? selectedBareme.categorie : null,
      palier: draft.type === "amende" && draft.bareme_id ? draft.palier : null,
      montant: draft.type === "amende" ? Number(draft.montant) : null,
      motif: draft.motif.trim(),
      date_debut: draft.type === "suspension" ? draft.date_debut : null,
      date_fin: draft.type === "suspension" ? draft.date_fin : null,
      statut: needsValidation ? "proposee" : "validee",
      proposee_par: profile.id, proposee_par_nom: profile.nom_complet,
      validee_par: needsValidation ? null : profile.id, validee_par_nom: needsValidation ? null : profile.nom_complet,
      date_validation: needsValidation ? null : now,
    }).select().single();
    setSaving(false);
    if (error) { alert(friendlyError(error, t)); return; }
    setSanctions((p) => [data, ...p]);
    setDraft(emptyDraft);
    setShowCreateForm(false);
    if (data.statut === "proposee") alert(t("san_success_propose_alert").replace("{approbateur}", approbateurNom));
  }

  // ---------- Décisions ----------
  async function patchSanction(s, patch) {
    const { data, error } = await supabase.from("sanctions").update(patch).eq("id", s.id).select().single();
    if (error) { alert(rpcErr(error)); return; }
    setSanctions((p) => p.map((x) => (x.id === s.id ? data : x)));
  }
  async function validateSanction(s) {
    if (!jeSuisApprobateur || !window.confirm(t("san_confirm_validate").replace("{nom}", nameOf(s.member_id)))) return;
    await patchSanction(s, { statut: "validee", validee_par: profile.id, validee_par_nom: profile.nom_complet, date_validation: new Date().toISOString() });
  }
  async function rejectSanction(s) {
    if (!jeSuisApprobateur || !window.confirm(t("san_confirm_reject").replace("{nom}", nameOf(s.member_id)))) return;
    const motif_rejet = window.prompt(t("san_reject_reason_prompt")) || null;
    await patchSanction(s, { statut: "rejetee", validee_par: profile.id, validee_par_nom: profile.nom_complet, date_validation: new Date().toISOString(), motif_rejet });
  }
  async function cancelSanction(s) {
    if (!isBureau || !window.confirm(t("san_confirm_cancel").replace("{nom}", nameOf(s.member_id)))) return;
    await patchSanction(s, { statut: "annulee" });
  }
  async function markPaid(s) {
    if (!isBureau || !window.confirm(t("san_confirm_mark_paid").replace("{montant}", moneyF(s.montant)))) return;
    await patchSanction(s, { paye: true, date_paiement: todayISO() });
  }
  async function contester(s) {
    const motif = window.prompt(S.contest_prompt);
    if (!motif || !motif.trim()) return;
    const { error } = await supabase.rpc("contester_sanction", { p_id: s.id, p_motif: motif.trim() });
    if (error) { alert(rpcErr(error)); return; }
    alert(S.contest_done); load();
  }
  async function statuerRecours(s, decision) {
    let montant = null;
    if (decision === "reduite") {
      const v = window.prompt(fill(S.reduce_prompt, { m: moneyF(s.montant) }));
      if (v === null) return;
      montant = Number(String(v).replace(",", "."));
    }
    const commentaire = window.prompt(S.comment_prompt);
    if (commentaire === null) return;
    const { error } = await supabase.rpc("statuer_recours_sanction", { p_id: s.id, p_decision: decision, p_montant: montant, p_commentaire: commentaire });
    if (error) { alert(rpcErr(error)); return; }
    load();
  }

  // ---------- Notification officielle (PDF) ----------
  async function notificationPdf(s) {
    try {
      const [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const { jsPDF } = jsPDFmod;
      const autoTable = autoTableMod.default || autoTableMod;
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const M = 56, W = doc.internal.pageSize.getWidth() - 2 * M;
      let y = await enTeteOfficiel(doc, assoc, { titre: S.pdf_title, marge: M });
      const ref = `S-${String(s.id).slice(0, 8).toUpperCase()}`;
      const lignes = [
        [S.pdf_to, nameOf(s.member_id)], [S.pdf_ref, ref], [S.pdf_date, fmtJ(new Date(s.date_validation || s.date_proposition))],
        [S.pdf_type, t(TYPE_LABEL_KEY[s.type])],
        ...(s.categorie_nom ? [[S.pdf_cat, s.categorie_nom]] : []),
        [S.pdf_motif, s.motif || ""],
        ...(s.type === "amende" ? [[S.pdf_amount, moneyF(s.montant) + (s.montant_initial != null ? ` (${moneyF(s.montant_initial)} → ${moneyF(s.montant)})` : "")], [S.pdf_due, fmtJ(dateLocale(s.echeance))]] : []),
        ...(s.type === "suspension" ? [[S.pdf_period, fill(S.period, { a: fmtJ(dateLocale(s.date_debut)), b: fmtJ(dateLocale(s.date_fin)) })]] : []),
        [S.pdf_status, t(STATUT_LABEL_KEY[s.statut]) + (s.paye ? ` - ${t("san_paid_badge")}` : "")],
        [S.pdf_validation, s.validee_par_nom ? fill(S.validated_by, { nom: s.validee_par_nom, d: formatEventDateTime(s.date_validation, lang) }) : fill(S.proposed_by, { nom: s.proposee_par_nom || "—", d: formatEventDateTime(s.date_proposition, lang) })],
      ];
      autoTable(doc, {
        startY: y, body: lignes.map((r) => r.map((x) => pdfTexte(x))), theme: "plain",
        styles: { font: "helvetica", fontSize: 10.5, cellPadding: 5, textColor: [0, 0, 0] },
        columnStyles: { 0: { cellWidth: 140, fontStyle: "bold" } },
        alternateRowStyles: { fillColor: [246, 247, 249] }, margin: { left: M, right: M },
      });
      y = doc.lastAutoTable.finalY + 18;
      doc.setFont("helvetica", "italic"); doc.setFontSize(10); doc.setTextColor(0, 0, 0);
      const para = (txt) => { const l = doc.splitTextToSize(pdfTexte(txt), W); doc.text(l, M, y, { lineHeightFactor: 1.4 }); y += l.length * 14 + 8; };
      if (s.type === "amende" && !s.paye) para(S.pdf_pay);
      if (s.statut === "validee") para(fill(S.pdf_recours, { n: delaiRecours }));
      if (s.recours_statut) para(S["recours_" + s.recours_statut].replace("{m}", moneyF(s.montant_initial)) + (s.recours_decision ? ` - ${s.recours_decision}` : ""));
      // Signature électronique : la validation enregistrée dans l'application.
      y += 14;
      if (y + 90 > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 60; }
      const bx = M + W - 260;
      doc.setDrawColor(...couleurAssociation(assoc)); doc.setLineWidth(0.8); doc.roundedRect(bx, y, 260, 78, 4, 4, "S");
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      const signataire = s.validee_par_nom || s.proposee_par_nom || "";
      const quand = s.date_validation || s.date_proposition;
      doc.text(doc.splitTextToSize(pdfTexte(fill(S.pdf_esign, { nom: signataire, d: formatEventDateTime(quand, lang) })), 240), bx + 10, y + 16);
      doc.setDrawColor(0, 0, 0); doc.line(bx + 10, y + 58, bx + 250, y + 58);
      doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.text(pdfTexte(S.pdf_manual), bx + 10, y + 69);
      piedsDePageOfficiels(doc, assoc, { marge: M, texte: `${S.pdf_title} - ${ref}` });
      doc.save(`Notification_${ref}.pdf`);
    } catch (e) { alert(friendlyError(e, t)); }
  }

  if (loading) return <Container><Section><p>{t("load_data")}</p></Section></Container>;

  // ---------- Indicateurs ----------
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const effectives = sanctions.filter((s) => s.statut === "validee");
  const isOverdue = (s) => s.type === "amende" && s.statut === "validee" && !s.paye && s.echeance && dateLocale(s.echeance) < today && s.recours_statut !== "en_cours";
  const isSuspendedNow = (s) => s.type === "suspension" && s.statut === "validee" && dateLocale(s.date_debut) <= today && today <= dateLocale(s.date_fin);
  const recoursPeriode = (s) => { const d = new Date(s.date_validation || s.date_proposition); d.setDate(d.getDate() + delaiRecours); return d; };
  const pending = sanctions.filter((s) => s.statut === "proposee");
  const recoursEnCours = sanctions.filter((s) => s.recours_statut === "en_cours");
  const interacEnAttente = amendeClaims.filter((c) => c.statut === "en_attente");
  const nbATraiter = (jeSuisApprobateur ? pending.length : 0) + recoursEnCours.length + interacEnAttente.length;
  const thisMonthPrefix = todayISO().slice(0, 7);
  const countThisMonth = sanctions.filter((s) => (s.date_proposition || "").slice(0, 7) === thisMonthPrefix).length;
  const amendesEff = effectives.filter((s) => s.type === "amende");
  const totalUnpaid = amendesEff.filter((s) => !s.paye).reduce((sum, s) => sum + Number(s.montant || 0), 0);
  const totalAmendes = amendesEff.reduce((sum, s) => sum + Number(s.montant || 0), 0);
  const recouvrement = totalAmendes > 0 ? Math.round(((totalAmendes - totalUnpaid) / totalAmendes) * 100) : 100;
  const overdue = sanctions.filter(isOverdue);
  const unAn = new Date(); unAn.setFullYear(unAn.getFullYear() - 1);
  const recentes = sanctions.filter((s) => s.statut !== "rejetee" && s.statut !== "annulee" && new Date(s.date_proposition) >= unAn);
  const membresConcernes = new Set(recentes.map((s) => s.member_id)).size;
  const motifs = Object.entries(recentes.reduce((acc, s) => { const k = s.categorie_nom || t(TYPE_LABEL_KEY[s.type]); acc[k] = (acc[k] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const parMembreActif = sanctions.filter((s) => s.statut !== "rejetee" && s.statut !== "annulee" && !estPrescrite(s)).reduce((acc, s) => { acc[s.member_id] = (acc[s.member_id] || 0) + 1; return acc; }, {});
  const recidivistes = Object.entries(parMembreActif).filter(([, n]) => n >= 3);
  const suspendus = sanctions.filter(isSuspendedNow);

  // ---------- Ligne d'une mesure (dépliable) ----------
  function Mesure({ s, montrerNom = true }) {
    const ouvert = !!mesuresOuvertes[s.id];
    const setOuvert = (f) => setMesuresOuvertes((p) => ({ ...p, [s.id]: f(!!p[s.id]) }));
    const col = TYPE_COLOR[s.type];
    const peutContester = !isBureau && s.member_id === profile.member_id && s.statut === "validee" && !s.recours_statut && !s.paye && new Date() <= recoursPeriode(s);
    return (
      <div style={{ borderTop: "1px solid #F0F1F3" }}>
        <button onClick={() => setOuvert((o) => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", background: "none", border: "none", cursor: "pointer", textAlign: "left", flexWrap: "wrap" }}>
          {ouvert ? <ChevronDown size={15} color={GREY} /> : <ChevronRight size={15} color={GREY} />}
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: col, flexShrink: 0 }} />
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: CHARCOAL }}>
              {montrerNom && <>{nameOf(s.member_id)} · </>}{t(TYPE_LABEL_KEY[s.type])}{s.categorie_nom ? ` — ${s.categorie_nom}` : ""}
            </div>
            <div style={{ fontSize: 11.5, color: GREY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.motif}</div>
          </div>
          {s.montant != null && <span style={{ fontSize: 13, fontWeight: 700, color: CHARCOAL }}>{moneyF(s.montant)}</span>}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <StatusBadge label={t(STATUT_LABEL_KEY[s.statut])} {...statusBadgeProps(s.statut)} />
            {s.type === "amende" && s.statut === "validee" && (s.paye ? <Chip color={TEAL} bg={TEAL_LIGHT}>{t("san_paid_badge")}</Chip> : isOverdue(s) ? <Chip color={RED} bg={RED_LIGHT}>{S.overdue}</Chip> : <Chip color={AMBER} bg={AMBER_LIGHT}>{t("san_unpaid_badge")}</Chip>)}
            {isSuspendedNow(s) && <Chip color="#9C4221" bg="#FDEBD8">{S.suspended_now}</Chip>}
            {s.recours_statut === "en_cours" && <Chip color="#2B6CB0" bg="#E3EEFA">{S.recours_en_cours}</Chip>}
            {estPrescrite(s) && s.statut === "validee" && <Chip>{S.prescribed}</Chip>}
          </div>
          <span style={{ fontSize: 11.5, color: GREY, width: 82, textAlign: "right" }}>{(s.date_proposition || "").slice(0, 10)}</span>
        </button>
        {ouvert && (
          <div style={{ padding: "4px 12px 14px 38px", fontSize: 12.5, color: "#3D4654", display: "grid", gap: 4 }}>
            <div style={{ whiteSpace: "pre-wrap" }}>{s.motif}</div>
            <div style={{ color: GREY }}>{fill(S.proposed_by, { nom: s.proposee_par_nom || "—", d: formatEventDateTime(s.date_proposition, lang) })}</div>
            {s.statut === "validee" && s.validee_par_nom && <div style={{ color: GREY }}>{fill(S.validated_by, { nom: s.validee_par_nom, d: formatEventDateTime(s.date_validation, lang) })}</div>}
            {s.statut === "rejetee" && <div style={{ color: RED }}>{fill(S.rejected, { nom: s.validee_par_nom || "—", m: s.motif_rejet ? ` : ${s.motif_rejet}` : "" })}</div>}
            {s.type === "suspension" && <div>{fill(S.period, { a: fmtJ(dateLocale(s.date_debut)), b: fmtJ(dateLocale(s.date_fin)) })}</div>}
            {s.type === "amende" && s.echeance && !s.paye && s.statut === "validee" && <div style={{ color: isOverdue(s) ? RED : GREY }}>{fill(S.due, { d: fmtJ(dateLocale(s.echeance)) })}</div>}
            {s.recours_statut && s.recours_statut !== "en_cours" && <div style={{ color: "#2B6CB0" }}>{S["recours_" + s.recours_statut].replace("{m}", moneyF(s.montant_initial))}{s.recours_decision ? ` — ${s.recours_decision}` : ""}</div>}
            {s.recours_motif && <div style={{ color: "#2B6CB0" }}>{fill(S.recours_motif, { m: s.recours_motif })}</div>}
            {peutContester && <div style={{ color: GREY }}>{fill(S.contest_until, { d: fmtJ(recoursPeriode(s)) })}</div>}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {(s.statut === "validee" || s.statut === "proposee") && <Btn variant="outline" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => notificationPdf(s)}><FileDown size={12} /> {S.notif_pdf}</Btn>}
              {isBureau && s.type === "amende" && s.statut === "validee" && !s.paye && <Btn style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => markPaid(s)}>{t("san_mark_paid_btn")}</Btn>}
              {jeSuisApprobateur && s.statut === "proposee" && <Btn style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => validateSanction(s)}>{t("san_validate_btn")}</Btn>}
              {jeSuisApprobateur && s.statut === "proposee" && <Btn variant="outline" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => rejectSanction(s)}>{t("san_reject_btn")}</Btn>}
              {isBureau && s.recours_statut === "en_cours" && (
                <>
                  <Btn variant="outline" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => statuerRecours(s, "maintenue")}>{S.keep}</Btn>
                  {s.type === "amende" && <Btn variant="outline" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => statuerRecours(s, "reduite")}>{S.reduce}</Btn>}
                  <Btn variant="outline" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => statuerRecours(s, "annulee")}>{S.cancel_m}</Btn>
                </>
              )}
              {isBureau && (s.statut === "validee" || s.statut === "proposee") && s.recours_statut !== "en_cours" && <button onClick={() => cancelSanction(s)} style={{ fontSize: 11, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "3px 9px", cursor: "pointer" }}>{t("san_cancel_btn")}</button>}
              {peutContester && <Btn variant="outline" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => contester(s)}><Scale size={12} /> {S.contest}</Btn>}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===================== VUE ADHÉRENT =====================
  if (!isBureau) {
    const mySanctions = sanctions.filter((s) => s.member_id === profile.member_id && s.statut !== "rejetee");
    const myDue = mySanctions.filter((s) => s.type === "amende" && s.statut === "validee" && !s.paye).reduce((a, s) => a + Number(s.montant || 0), 0);
    return (
      <Container><Section>
        <h2 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><Gavel size={20} /> {S.my_title}</h2>
        <p style={{ fontSize: 12.5, color: GREY, marginBottom: 16 }}>{t("san_my_intro")}</p>
        {myDue > 0 && <Card style={{ padding: 14, marginBottom: 14, borderLeft: `4px solid ${RED}` }}><b style={{ color: RED }}>{fill(S.my_to_pay, { m: moneyF(myDue) })}</b></Card>}
        <Card style={{ padding: "6px 16px" }}>
          {mySanctions.length === 0 && <p style={{ fontSize: 13, color: GREY, fontStyle: "italic", padding: "10px 0" }}>{S.my_none}</p>}
          {mySanctions.map((s) => (
            <div key={s.id}>
              {Mesure({ s, montrerNom: false })}
              {s.type === "amende" && s.statut === "validee" && !s.paye && s.recours_statut !== "en_cours" && (
                <div style={{ padding: "0 12px 12px 38px" }}>
                  {pendingInteracClaimFor(s.id) ? (
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: AMBER, background: "#FFF3D6", borderRadius: 999, padding: "4px 10px" }}>{t("san_interac_claim_pending")}</span>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <Btn variant="outline" disabled={payingId === s.id} onClick={() => payerAmendeEnLigne(s)}><CreditCard size={13} /> {payingId === s.id ? t("san_pay_redirecting") : t("san_pay_card_btn")}</Btn>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: TEAL, border: `1px solid ${TEAL}`, borderRadius: 999, padding: "7px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Upload size={13} /> {t("san_pay_interac_upload_btn")}
                        <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => setInteracFiles((p) => ({ ...p, [s.id]: e.target.files?.[0] || null }))} />
                      </label>
                      {interacFiles[s.id] && <Btn disabled={interacUploading === s.id} onClick={() => submitInteracForAmende(s)}>{interacUploading === s.id ? t("san_pay_uploading") : t("san_pay_interac_submit_btn")}</Btn>}
                    </div>
                  )}
                  {interacFiles[s.id] && <p style={{ fontSize: 11.5, color: "#888", marginTop: 4 }}>{interacFiles[s.id].name}</p>}
                  {interacMsg[s.id] && <p style={{ fontSize: 11.5, color: TEAL, marginTop: 4 }}>{interacMsg[s.id]}</p>}
                </div>
              )}
            </div>
          ))}
        </Card>
      </Section></Container>
    );
  }

  // ===================== VUE BUREAU =====================
  const ongletBtn = (id, label, Icon, badge) => (
    <button key={id} onClick={() => setOnglet(id)} style={{
      display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 13.5, padding: "10px 16px", borderRadius: 11, border: "none", cursor: "pointer",
      color: onglet === id ? "#fff" : "rgba(42,42,42,.6)", background: onglet === id ? "var(--primary)" : "transparent",
    }}><Icon size={15} /> {label}{badge > 0 && <span style={{ background: RED, color: "white", borderRadius: 999, fontSize: 10.5, padding: "0 6px", fontWeight: 700 }}>{badge}</span>}</button>
  );

  return (
    <Container><Section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}><Gavel size={20} /> {t("nav_sanctions")}</h2>
        <Btn onClick={() => setShowCreateForm((v) => !v)}>{showCreateForm ? <X size={14} /> : <Plus size={14} />} {showCreateForm ? t("action_close") : t("san_propose_title")}</Btn>
      </div>

      {/* ---------- Consigner une mesure ---------- */}
      {showCreateForm && (
        <Card style={{ marginBottom: 18, maxWidth: 640, borderTop: `3px solid ${TEAL}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 14px" }}>
            <Field label={t("san_field_member")}>
              <select style={inputStyle} value={draft.member_id} onChange={(e) => setDraft({ ...draft, member_id: e.target.value })}>
                <option value="">{t("san_field_member_placeholder")}</option>
                {members.filter((m) => m.statut === "Actif").map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
              </select>
            </Field>
            <Field label={t("san_field_type")}>
              <select style={inputStyle} value={draft.type} onChange={(e) => onTypeChange(e.target.value)}>
                {SANCTION_TYPES.map((ty) => <option key={ty} value={ty}>{t(TYPE_LABEL_KEY[ty])}</option>)}
              </select>
            </Field>
            {draft.type === "amende" && (
              <Field label={t("san_field_categorie")}>
                <select style={inputStyle} value={draft.bareme_id} onChange={(e) => onCategorieChange(e.target.value)}>
                  <option value="">{t("san_field_categorie_none_option")}</option>
                  {baremesActifs.map((b) => <option key={b.id} value={b.id}>{b.categorie}</option>)}
                </select>
              </Field>
            )}
            {draft.type === "amende" && selectedBareme && paliersActifs && (
              <Field label={t("san_field_palier")}>
                <select style={inputStyle} value={draft.palier} onChange={(e) => onPalierChange(Number(e.target.value))}>
                  {[1, 2, 3].map((p) => <option key={p} value={p}>{t(PALIER_LABEL_KEY[p])} — {moneyF(selectedBareme["palier_" + p])}</option>)}
                </select>
              </Field>
            )}
            {draft.type === "amende" && (
              <Field label={t("san_field_montant")}><input type="number" min="0" step="0.01" style={inputStyle} value={draft.montant} onChange={(e) => setDraft({ ...draft, montant: e.target.value })} /></Field>
            )}
            {draft.type === "suspension" && (
              <>
                <Field label={t("san_field_date_debut")}><input type="date" style={inputStyle} value={draft.date_debut} onChange={(e) => setDraft({ ...draft, date_debut: e.target.value })} /></Field>
                <Field label={t("san_field_date_fin")}><input type="date" style={inputStyle} value={draft.date_fin} onChange={(e) => setDraft({ ...draft, date_fin: e.target.value })} /></Field>
              </>
            )}
          </div>
          {draft.type === "amende" && selectedBareme && paliersActifs && priorOccurrences(draft.member_id, draft.bareme_id) > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", background: AMBER_LIGHT, borderRadius: 10, marginBottom: 12 }}>
              <Info size={15} color={AMBER} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5, color: "#4A5560" }}>
                <strong style={{ color: AMBER }}>{t("san_palier_suggestion_detected").replace("{palier}", t(PALIER_LABEL_KEY[suggestedPalierFor(draft.member_id, draft.bareme_id)]))}</strong>{" "}
                {t("san_palier_suggestion_hint").replace("{palier}", t(PALIER_LABEL_KEY[suggestedPalierFor(draft.member_id, draft.bareme_id)])).replace("{montant}", moneyF(selectedBareme["palier_" + suggestedPalierFor(draft.member_id, draft.bareme_id)]))}
              </div>
            </div>
          )}
          {draft.type === "exclusion" && <p style={{ fontSize: 11.5, color: "#888", marginTop: -4, marginBottom: 12 }}>{t("san_exclusion_note")}</p>}
          <Field label={t("san_field_motif")}><textarea style={{ ...inputStyle, minHeight: 60 }} placeholder={t("san_field_motif_placeholder")} value={draft.motif} onChange={(e) => setDraft({ ...draft, motif: e.target.value })} /></Field>
          <p style={{ fontSize: 11.5, color: willNeedValidation() ? AMBER : "#888", marginTop: -6, marginBottom: 12 }}>
            {willNeedValidation() ? t("san_effect_pending_note").replace("{nom}", approbateurNom) : t("san_effect_immediate_note")}
          </p>
          <Btn onClick={submitSanction} disabled={saving}>{saving ? <Loader2 size={14} /> : <Gavel size={13} />} {t("san_submit_btn")}</Btn>
        </Card>
      )}

      <Card style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: 8, marginBottom: 18 }}>
        {ongletBtn("dashboard", S.tab_dashboard, LayoutDashboard)}
        {ongletBtn("registre", S.tab_registre, ListChecks)}
        {ongletBtn("traiter", S.tab_traiter, Inbox, nbATraiter)}
        {ongletBtn("regles", S.tab_regles, SlidersHorizontal)}
      </Card>

      {onglet === "dashboard" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
            <Kpi icon={Gavel} label={S.kpi_month} value={countThisMonth} />
            <Kpi icon={Inbox} label={S.kpi_pending} value={nbATraiter} color={nbATraiter ? AMBER : undefined} onClick={() => setOnglet("traiter")} />
            <Kpi icon={Wallet} label={S.kpi_unpaid} value={moneyF(totalUnpaid)} color={totalUnpaid > 0 ? RED : undefined} />
            <Kpi icon={AlertTriangle} label={S.kpi_overdue} value={overdue.length} color={overdue.length ? RED : undefined} />
            <Kpi icon={TrendingUp} label={S.kpi_recovery} value={`${recouvrement} %`} color={TEAL} />
            <Kpi icon={Users} label={S.kpi_members} value={membresConcernes} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
            <Card style={{ padding: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 12 }}>{S.top_motifs}</div>
              {motifs.length === 0 && <p style={{ fontSize: 12.5, color: GREY, fontStyle: "italic" }}>{S.no_data}</p>}
              {motifs.map(([k, n]) => (
                <div key={k} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}><span>{k}</span><b>{n}</b></div>
                  <div style={{ height: 6, background: "#EEF0F3", borderRadius: 999 }}><div style={{ width: `${(n / motifs[0][1]) * 100}%`, height: "100%", background: "var(--primary)", borderRadius: 999 }} /></div>
                </div>
              ))}
            </Card>
            <Card style={{ padding: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 12 }}>{S.alerts}</div>
              {[
                overdue.length > 0 && { c: RED, txt: fill(S.alert_overdue, { n: overdue.length, m: moneyF(overdue.reduce((a, s) => a + Number(s.montant || 0), 0)) }) },
                recoursEnCours.length > 0 && { c: "#2B6CB0", txt: fill(S.alert_recours, { n: recoursEnCours.length }), go: "traiter" },
                suspendus.length > 0 && { c: "#9C4221", txt: fill(S.alert_suspended, { n: suspendus.length }) },
                recidivistes.length > 0 && { c: AMBER, txt: fill(S.alert_recidive, { n: recidivistes.length }) + " — " + recidivistes.map(([id]) => nameOf(id)).join(", ") },
              ].filter(Boolean).map((a, i) => (
                <div key={i} onClick={() => a.go && setOnglet(a.go)} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, padding: "6px 0", cursor: a.go ? "pointer" : "default" }}>
                  <AlertTriangle size={14} color={a.c} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{a.txt}</span>
                </div>
              ))}
              {!overdue.length && !recoursEnCours.length && !suspendus.length && !recidivistes.length && <p style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{S.alert_none}</p>}
            </Card>
          </div>
        </div>
      )}

      {onglet === "registre" && <Registre sanctions={sanctions} members={members} nameOf={nameOf} Mesure={Mesure} S={S} t={t} moneyF={moneyF} />}

      {onglet === "traiter" && (
        <div style={{ display: "grid", gap: 14 }}>
          {nbATraiter === 0 && <Card style={{ padding: 18 }}><p style={{ margin: 0, color: TEAL, fontWeight: 600 }}>{S.nothing}</p></Card>}
          {pending.length > 0 && (
            <Card style={{ padding: "12px 16px" }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}><ShieldCheck size={15} color={AMBER} /> {S.pending_approvals} · {pending.length}</div>
              {!jeSuisApprobateur && <p style={{ fontSize: 12, color: GREY, margin: "4px 0" }}>{fill(S.not_approver, { nom: approbateurNom || "—" })}</p>}
              {pending.map((s) => <div key={s.id}>{Mesure({ s })}</div>)}
            </Card>
          )}
          {recoursEnCours.length > 0 && (
            <Card style={{ padding: "12px 16px" }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}><Scale size={15} color="#2B6CB0" /> {S.recours_title} · {recoursEnCours.length}</div>
              {recoursEnCours.map((s) => <div key={s.id}>{Mesure({ s })}</div>)}
            </Card>
          )}
          {interacEnAttente.length > 0 && (
            <Card style={{ padding: "12px 16px" }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}><Clock size={15} color={TEAL} /> {S.interac_title} · {interacEnAttente.length}</div>
              {interacEnAttente.map((c) => (
                <div key={c.id} style={{ padding: "10px 0", borderTop: "1px solid #F0F1F3", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 13, flex: 1 }}>{nameOf(c.member_id)} — {moneyF(c.montant)} <span style={{ fontWeight: 400, color: GREY, fontSize: 11.5 }}>· {(c.created_at || "").slice(0, 10)}</span></strong>
                  <Btn variant="outline" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => voirPreuveAmende(c)}>{t("san_interac_view_proof_btn")}</Btn>
                  <Btn style={{ padding: "4px 10px", fontSize: 11.5 }} disabled={claimActionId === c.id} onClick={() => confirmerAmendeInterac(c)}>{t("san_interac_confirm_btn")}</Btn>
                  <button onClick={() => rejeterAmendeInterac(c)} disabled={claimActionId === c.id} style={{ fontSize: 11, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "3px 9px", cursor: "pointer" }}>{t("san_interac_reject_btn")}</button>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {onglet === "regles" && (
        <div style={{ display: "grid", gap: 16 }}>
          <Card>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("san_bareme_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("san_bareme_intro")}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12 }}>
              {baremesActifs.map((b) => (
                <div key={b.id} style={{ border: "1px solid rgba(42,42,42,.08)", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                    <strong style={{ fontSize: 13.5 }}>{b.categorie}</strong>
                    <button onClick={() => archiveCategorie(b)} style={{ fontSize: 10.5, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer" }}>{t("san_archive_categorie_btn")}</button>
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {(paliersActifs ? [1, 2, 3] : [1]).map((n) => (
                      <div key={n}>
                        <div style={{ fontSize: 10, color: "#686F7D", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 3 }}>{paliersActifs ? t(PALIER_LABEL_KEY[n]) : t("san_col_montant_unique")}</div>
                        <input type="number" min="0" step="0.01" style={{ ...inputStyle, width: 84 }} value={b["palier_" + n]} onChange={(e) => updateBaremeMontant(b.id, "palier_" + n, e.target.value)} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {baremesActifs.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{t("san_no_baremes")}</p>}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
              <input style={{ ...inputStyle, width: 220 }} placeholder={t("san_new_categorie_placeholder")} value={newCategorie.categorie} onChange={(e) => setNewCategorie({ ...newCategorie, categorie: e.target.value })} />
              {(paliersActifs ? [1, 2, 3] : [1]).map((n) => <input key={n} type="number" min="0" step="0.01" style={{ ...inputStyle, width: 84 }} placeholder={paliersActifs ? `P${n}` : "0"} value={newCategorie["palier_" + n]} onChange={(e) => setNewCategorie({ ...newCategorie, ["palier_" + n]: e.target.value })} />)}
              <Btn variant="outline" disabled={bSaving || !newCategorie.categorie.trim()} onClick={addCategorie}><Plus size={13} /> {t("san_add_categorie_btn")}</Btn>
            </div>
          </Card>
          <Card style={{ maxWidth: 640 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>{S.rules_title}</h3>
            <p style={{ fontSize: 12, color: GREY, margin: "0 0 12px" }}>{fill(S.approver_note, { nom: approbateurNom || t("san_overview_approbateur_none") })}</p>
            {(() => {
              const r = regles || { paliers: paliersActifs, seuil: seuilValidation, recours: delaiRecours, paiement: Number(assoc?.sanctions_delai_paiement_jours ?? 30), prescription: prescriptionMois };
              const set = (k, v) => setRegles({ ...r, [k]: v });
              return (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 10 }}><input type="checkbox" checked={!!r.paliers} onChange={(e) => set("paliers", e.target.checked)} /> {S.paliers}</label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 14px" }}>
                    <Field label={S.seuil}><input type="number" min={0} style={inputStyle} value={r.seuil} onChange={(e) => set("seuil", e.target.value)} /></Field>
                    <Field label={S.delai_recours}><input type="number" min={0} style={inputStyle} value={r.recours} onChange={(e) => set("recours", e.target.value)} /></Field>
                    <Field label={S.delai_paiement}><input type="number" min={0} style={inputStyle} value={r.paiement} onChange={(e) => set("paiement", e.target.value)} /></Field>
                    <Field label={S.prescription}><input type="number" min={0} style={inputStyle} value={r.prescription} onChange={(e) => set("prescription", e.target.value)} /></Field>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <Btn onClick={() => { setRegles(r); saveRegles(r); }}>{S.rules_save}</Btn>
                    {reglesMsg && <span style={{ fontSize: 12, color: GREY }}>{reglesMsg}</span>}
                  </div>
                </>
              );
            })()}
          </Card>
        </div>
      )}
    </Section></Container>
  );
}

// ---------------------------------------------------------------------
// Registre : par adhérent (fiches dépliables) ou liste chronologique,
// filtres (statut, type, période, recherche), export CSV.
// ---------------------------------------------------------------------
function Registre({ sanctions, members, nameOf, Mesure, S, t, moneyF }) {
  const [vue, setVue] = useState("membres");
  const [q, setQ] = useState("");
  const [statut, setStatut] = useState("all");
  const [type, setType] = useState("");
  const [periode, setPeriode] = useState("");
  const [ouverts, setOuverts] = useState({});

  const debut = (() => {
    if (!periode) return null;
    const d = new Date();
    if (periode === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
    d.setMonth(d.getMonth() - (periode === "quarter" ? 3 : 12));
    return d;
  })();
  const liste = sanctions
    .filter((s) => statut === "all" || s.statut === statut)
    .filter((s) => !type || s.type === type)
    .filter((s) => !debut || new Date(s.date_proposition) >= debut)
    .filter((s) => !q.trim() || nameOf(s.member_id).toLowerCase().includes(q.trim().toLowerCase()) || String(s.motif || "").toLowerCase().includes(q.trim().toLowerCase()));

  function exportCsv() {
    const rows = liste.map((s) => [nameOf(s.member_id), t(TYPE_LABEL_KEY[s.type]), s.categorie_nom || "", s.motif || "", s.montant ?? "", t(STATUT_LABEL_KEY[s.statut]), s.paye ? "oui" : "", s.echeance || "", s.recours_statut || "", (s.date_proposition || "").slice(0, 10)]);
    const csv = [S.csv_cols, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `registre_disciplinaire_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const parMembre = Object.values(liste.reduce((acc, s) => { (acc[s.member_id] = acc[s.member_id] || { id: s.member_id, items: [] }).items.push(s); return acc; }, {}))
    .sort((a, b) => nameOf(a.id).localeCompare(nameOf(b.id)));
  const pill = (actif) => ({ fontWeight: 600, fontSize: 12.5, padding: "6px 12px", borderRadius: 999, cursor: "pointer", border: actif ? "1px solid transparent" : "1px solid #DCE0E8", background: actif ? "var(--primary)" : "white", color: actif ? "white" : "#4A5468" });

  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <button style={pill(vue === "membres")} onClick={() => setVue("membres")}>{S.view_members}</button>
        <button style={pill(vue === "liste")} onClick={() => setVue("liste")}>{S.view_list}</button>
        <div style={{ flex: 1 }} />
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#686F7D", pointerEvents: "none" }} />
          <input style={{ ...inputStyle, width: 200, paddingLeft: 28 }} placeholder={t("san_registre_search_placeholder")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Btn variant="outline" style={{ padding: "5px 12px", fontSize: 12 }} onClick={exportCsv}><FileDown size={13} /> {S.export_csv}</Btn>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {["all", "proposee", "validee", "rejetee", "annulee"].map((f) => (
          <button key={f} onClick={() => setStatut(f)} style={pill(statut === f)}>
            {f === "all" ? t("san_filter_all") : t(STATUT_LABEL_KEY[f])} · {f === "all" ? sanctions.length : sanctions.filter((s) => s.statut === f).length}
          </button>
        ))}
        <select style={{ ...inputStyle, width: "auto", padding: "5px 10px", fontSize: 12.5 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{S.filter_type}</option>
          {SANCTION_TYPES.map((ty) => <option key={ty} value={ty}>{t(TYPE_LABEL_KEY[ty])}</option>)}
        </select>
        <select style={{ ...inputStyle, width: "auto", padding: "5px 10px", fontSize: 12.5 }} value={periode} onChange={(e) => setPeriode(e.target.value)}>
          <option value="">{S.filter_period}</option>
          <option value="month">{S.period_month}</option><option value="quarter">{S.period_quarter}</option><option value="year">{S.period_year}</option>
        </select>
      </div>
      {liste.length === 0 && <p style={{ fontSize: 13, color: GREY, fontStyle: "italic" }}>{t("san_no_sanctions")}</p>}
      {vue === "liste" && liste.map((s) => <div key={s.id}>{Mesure({ s })}</div>)}
      {vue === "membres" && parMembre.map((g) => {
        const m = members.find((x) => x.id === g.id);
        const impaye = g.items.filter((s) => s.type === "amende" && s.statut === "validee" && !s.paye).reduce((a, s) => a + Number(s.montant || 0), 0);
        const ouvert = !!ouverts[g.id];
        return (
          <div key={g.id} style={{ borderTop: "1px solid #EEF0F3" }}>
            <button onClick={() => setOuverts({ ...ouverts, [g.id]: !ouvert })} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 4px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
              {ouvert ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              {m?.photo_url ? <img src={m.photo_url} alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover" }} />
                : <span style={{ width: 30, height: 30, borderRadius: "50%", background: TEAL_LIGHT, color: TEAL, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11 }}>{nameOf(g.id).split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span>}
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: CHARCOAL }}>{nameOf(g.id)}</span>
              <span style={{ fontSize: 12, color: impaye > 0 ? RED : GREY, fontWeight: 600 }}>{fill(S.member_summary, { n: g.items.length, u: moneyF(impaye) })}</span>
            </button>
            {ouvert && <div style={{ paddingLeft: 26 }}>{g.items.map((s) => <div key={s.id}>{Mesure({ s, montrerNom: false })}</div>)}</div>}
          </div>
        );
      })}
    </Card>
  );
}
