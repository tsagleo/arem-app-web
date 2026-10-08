// =====================================================================
// Sanctions.jsx — Volet disciplinaire (nouveau module, suite 76, 2026-09-21)
// =====================================================================
// Demande directe de l'utilisateur : donner au Bureau un espace structuré
// et traçable pour appliquer des mesures disciplinaires, avec un barème
// ENTIÈREMENT CONFIGURABLE par chaque association (« les taux liés aux
// sanctions sont fixés délibérément par chaque association qui définit
// leur politique »). Voir le document de projet
// « proposition-funeraire-sanctions.md », section « Volet Sanctions », et
// trois arbitrages tranchés via AskUserQuestion (format des montants :
// dollars fixes plutôt qu'un pourcentage de la cotisation ; escalade :
// choisie manuellement par le Bureau plutôt qu'un comptage automatique de
// récidive ; catégories : ensemble standard proposé par défaut, librement
// modifiable), plus une précision de l'utilisateur le même jour : les
// paliers de récidive sont OPTIONNELS (activables/désactivables par
// l'association), le mode par défaut restant AVEC paliers.
//
// Types : Avertissement (immédiat, sans validation), Amende (immédiate
// sous le seuil de double validation, sinon soumise), Suspension et
// Exclusion (toujours soumises à validation si un approbateur est
// désigné et distinct du proposant). La validation à deux réutilise le
// mécanisme d'approbateur DÉJÀ EN PLACE pour les suppressions
// (associations.approbateur_suppression_id, App.jsx) plutôt que
// d'inventer un second rôle — décision prise en observant le patron déjà
// construit pour deletion_requests : sans approbateur désigné, ou si le
// proposant EST l'approbateur, toute sanction est effective
// immédiatement (même logique, même comportement par défaut).
//
// L'Exclusion crée ici un dossier disciplinaire traçable ; elle NE
// déclenche PAS automatiquement la révocation d'accès (Gestion des
// accès, suite 37) — décision délibérée pour ne pas coupler un module
// neuf à un mécanisme de sécurité de compte existant sans que
// l'utilisateur l'ait explicitement demandé. Le Bureau agit séparément
// si l'exclusion doit se traduire par une révocation d'accès.
//
// Script SQL : sql/2026-09-21d_sanctions.sql.
// =====================================================================
import React, { useState, useEffect, useCallback } from "react";
import { Gavel, Plus, X, Loader2, CreditCard, Upload, Search, Info, Clock, Wallet, ShieldCheck } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, inputStyle, useLang, RED, TEAL, TEAL_LIGHT, CHARCOAL, Table, td, money, todayISO, friendlyError } from "./shared";

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

function pillFilterStyle(active) {
  return active
    ? { fontWeight: 600, fontSize: 13, color: "#fff", background: TEAL, border: "1px solid transparent", borderRadius: 999, padding: "8px 16px", cursor: "pointer" }
    : { fontWeight: 600, fontSize: 13, color: "rgba(42,42,42,.55)", background: "transparent", border: "1px solid rgba(42,42,42,.14)", borderRadius: 999, padding: "8px 16px", cursor: "pointer" };
}

function StatusBadge({ label, color, bg, border }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, color, background: bg, border: `1.5px solid ${border}`, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function OverviewTile({ icon: Icon, label, value, color }) {
  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <Icon size={13} color={color || "rgba(42,42,42,.42)"} />
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: "rgba(42,42,42,.42)" }}>{label.toUpperCase()}</div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || CHARCOAL }}>{value}</div>
    </Card>
  );
}

function statusBadgeProps(statut) {
  if (statut === "validee") return { color: "#1F8A5C", bg: TEAL_LIGHT, border: TEAL };
  if (statut === "rejetee") return { color: RED, bg: RED_LIGHT, border: RED_BORDER };
  if (statut === "annulee") return { color: GREY, bg: GREY_LIGHT, border: GREY_BORDER };
  return { color: AMBER, bg: AMBER_LIGHT, border: AMBER_BORDER };
}

export default function Sanctions({ profile, isBureau, isPresident, association }) {
  const { t } = useLang();
  const moneyF = (n) => money(n, association?.devise_monetaire);
  const paliersActifs = association?.sanctions_paliers_actifs !== false;
  const seuilValidation = Number(association?.sanctions_seuil_validation ?? 25);
  const approbateurId = association?.approbateur_suppression_id || null;
  const jeSuisApprobateur = !!approbateurId && approbateurId === profile.id;

  const [members, setMembers] = useState([]);
  const [baremes, setBaremes] = useState([]);
  const [sanctions, setSanctions] = useState([]);
  const [approbateurProfile, setApprobateurProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Paiement en ligne des amendes (suite « fiche unifiée présence/
  // absence + paiement », 2026-09-30) : carte (Stripe) ou virement
  // Interac avec preuve — même infrastructure que le reste de l'app
  // (inscription, fonds, recouvrements), étendue via sanction_id plutôt
  // qu'un solde agrégé, chaque amende étant distincte.
  const [amendeClaims, setAmendeClaims] = useState([]);
  const [payingId, setPayingId] = useState(null);
  const [interacFiles, setInteracFiles] = useState({});
  const [interacUploading, setInteracUploading] = useState(null);
  const [interacMsg, setInteracMsg] = useState({});
  const [claimActionId, setClaimActionId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: m }, { data: b }, { data: s }, { data: claims }, apRes] = await Promise.all([
      supabase.from("members").select("id,nom,statut").order("nom"),
      supabase.from("sanctions_baremes").select("*").order("ordre"),
      supabase.from("sanctions").select("*").order("date_proposition", { ascending: false }),
      supabase.from("interac_payment_claims").select("*").eq("type", "amende").order("created_at", { ascending: false }),
      approbateurId ? supabase.from("profiles").select("id,nom_complet").eq("id", approbateurId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setMembers(m || []); setBaremes(b || []); setSanctions(s || []); setAmendeClaims(claims || []); setApprobateurProfile(apRes.data || null);
    setLoading(false);
  }, [profile.association_id, approbateurId]);
  useEffect(() => { load(); }, [load]);

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
  function pendingInteracClaimFor(sanctionId) {
    return amendeClaims.find((c) => c.sanction_id === sanctionId && c.statut === "en_attente");
  }
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

  // ---------- Confirmation Bureau d'un virement Interac pour une amende ----------
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

  // ---------- Barème (Bureau) ----------
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

  // ---------- Réforme visuelle : formulaire repliable, suggestion de
  // palier non contraignante, recherche/filtre sur le registre ----------
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [registreSearch, setRegistreSearch] = useState("");
  const [registreFilter, setRegistreFilter] = useState("all");

  // ---------- Proposer / appliquer une sanction (Bureau) ----------
  const emptyDraft = { member_id: "", type: "avertissement", bareme_id: "", palier: 1, montant: "", motif: "", date_debut: todayISO(), date_fin: "" };
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const selectedBareme = baremesActifs.find((b) => b.id === draft.bareme_id);

  // Suggestion non contraignante : compte les sanctions déjà consignées
  // (hors rejetées/annulées) pour le même adhérent et la même catégorie,
  // afin de proposer le palier suivant — le Bureau reste libre de le
  // modifier via le champ Palier ci-dessous.
  function priorOccurrences(memberId, baremeId) {
    if (!memberId || !baremeId) return 0;
    return sanctions.filter((s) => s.member_id === memberId && s.bareme_id === baremeId && s.statut !== "rejetee" && s.statut !== "annulee").length;
  }
  function suggestedPalierFor(memberId, baremeId) {
    if (!memberId || !baremeId) return 1;
    return Math.min(priorOccurrences(memberId, baremeId) + 1, 3);
  }

  function onCategorieChange(baremeId) {
    const b = baremesActifs.find((x) => x.id === baremeId);
    if (!b) { setDraft((d) => ({ ...d, bareme_id: "", montant: "" })); return; }
    const palier = paliersActifs ? suggestedPalierFor(draft.member_id, baremeId) : 1;
    setDraft((d) => ({ ...d, bareme_id: baremeId, palier, montant: String(b["palier_" + palier]) }));
  }
  function onPalierChange(palier) {
    setDraft((d) => ({ ...d, palier, montant: selectedBareme ? String(selectedBareme["palier_" + palier]) : d.montant }));
  }
  function onTypeChange(type) {
    setDraft((d) => ({ ...emptyDraft, member_id: d.member_id, motif: d.motif, type }));
  }

  function willNeedValidation() {
    if (draft.type === "avertissement") return false;
    if (!approbateurId || approbateurId === profile.id) return false;
    if (draft.type === "amende") return Number(draft.montant || 0) >= seuilValidation;
    return true; // suspension, exclusion : toujours soumises si un approbateur distinct existe
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
    const payload = {
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
      validee_par: needsValidation ? null : profile.id,
      validee_par_nom: needsValidation ? null : profile.nom_complet,
      date_validation: needsValidation ? null : now,
    };
    const { data, error } = await supabase.from("sanctions").insert(payload).select().single();
    setSaving(false);
    if (error) { alert(friendlyError(error, t)); return; }
    setSanctions((p) => [data, ...p]);
    setDraft(emptyDraft);
    setShowCreateForm(false);
    if (needsValidation) alert(t("san_success_propose_alert").replace("{approbateur}", approbateurNom));
  }

  // ---------- Validation par l'approbateur désigné ----------
  async function validateSanction(s) {
    if (!jeSuisApprobateur) return;
    if (!window.confirm(t("san_confirm_validate").replace("{nom}", nameOf(s.member_id)))) return;
    const patch = { statut: "validee", validee_par: profile.id, validee_par_nom: profile.nom_complet, date_validation: new Date().toISOString() };
    const { error } = await supabase.from("sanctions").update(patch).eq("id", s.id);
    if (error) { alert(friendlyError(error, t)); return; }
    setSanctions((p) => p.map((x) => (x.id === s.id ? { ...x, ...patch } : x)));
  }
  async function rejectSanction(s) {
    if (!jeSuisApprobateur) return;
    if (!window.confirm(t("san_confirm_reject").replace("{nom}", nameOf(s.member_id)))) return;
    const motif_rejet = window.prompt(t("san_reject_reason_prompt")) || null;
    const patch = { statut: "rejetee", validee_par: profile.id, validee_par_nom: profile.nom_complet, date_validation: new Date().toISOString(), motif_rejet };
    const { error } = await supabase.from("sanctions").update(patch).eq("id", s.id);
    if (error) { alert(friendlyError(error, t)); return; }
    setSanctions((p) => p.map((x) => (x.id === s.id ? { ...x, ...patch } : x)));
  }
  async function cancelSanction(s) {
    if (!isBureau) return;
    if (!window.confirm(t("san_confirm_cancel").replace("{nom}", nameOf(s.member_id)))) return;
    const { error } = await supabase.from("sanctions").update({ statut: "annulee" }).eq("id", s.id);
    if (error) { alert(friendlyError(error, t)); return; }
    setSanctions((p) => p.map((x) => (x.id === s.id ? { ...x, statut: "annulee" } : x)));
  }
  async function markPaid(s) {
    if (!isBureau) return;
    if (!window.confirm(t("san_confirm_mark_paid").replace("{montant}", moneyF(s.montant)))) return;
    const patch = { paye: true, date_paiement: todayISO() };
    const { error } = await supabase.from("sanctions").update(patch).eq("id", s.id);
    if (error) { alert(friendlyError(error, t)); return; }
    setSanctions((p) => p.map((x) => (x.id === s.id ? { ...x, ...patch } : x)));
  }

  if (loading) return <Container><Section><p>{t("load_data")}</p></Section></Container>;

  const pending = sanctions.filter((s) => s.statut === "proposee");
  const mySanctions = sanctions.filter((s) => s.member_id === profile.member_id);
  const myUnpaid = mySanctions.some((s) => s.type === "amende" && s.statut === "validee" && !s.paye);

  // ---------- Vue d'ensemble (tuiles) ----------
  const thisMonthPrefix = todayISO().slice(0, 7);
  const countThisMonth = sanctions.filter((s) => (s.date_proposition || "").slice(0, 7) === thisMonthPrefix).length;
  const totalUnpaid = sanctions.filter((s) => s.type === "amende" && s.statut === "validee" && !s.paye).reduce((sum, s) => sum + Number(s.montant || 0), 0);

  // ---------- Registre disciplinaire : recherche + filtre de statut ----------
  const registreFilters = ["all", "proposee", "validee", "rejetee", "annulee"];
  const visibleSanctions = sanctions
    .filter((s) => registreFilter === "all" || s.statut === registreFilter)
    .filter((s) => !registreSearch.trim() || nameOf(s.member_id).toLowerCase().includes(registreSearch.trim().toLowerCase()));

  return (
    <Container><Section>
      <h2 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><Gavel size={20} /> {t("nav_sanctions")}</h2>

      {isBureau && (
        <>
          {/* ---------- Vue d'ensemble ---------- */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 20 }}>
            <OverviewTile icon={Gavel} label={t("san_overview_month")} value={countThisMonth} />
            <OverviewTile icon={Clock} label={t("san_pending_title")} value={pending.length} color={pending.length > 0 ? AMBER : undefined} />
            <OverviewTile icon={Wallet} label={t("san_overview_unpaid")} value={moneyF(totalUnpaid)} color={totalUnpaid > 0 ? RED : undefined} />
            <OverviewTile icon={ShieldCheck} label={t("san_overview_approbateur")} value={approbateurNom || t("san_overview_approbateur_none")} color={approbateurNom ? TEAL : undefined} />
          </div>

          {/* ---------- Barème de sanctions ---------- */}
          <Card style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("san_bareme_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("san_bareme_intro")}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
              {baremesActifs.map((b) => (
                <div key={b.id} style={{ border: "1px solid rgba(42,42,42,.08)", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                    <strong style={{ fontSize: 13.5 }}>{b.categorie}</strong>
                    <button onClick={() => archiveCategorie(b)} style={{ fontSize: 10.5, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "3px 8px", cursor: "pointer" }}>{t("san_archive_categorie_btn")}</button>
                  </div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#686F7D", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 3 }}>{paliersActifs ? t("san_col_palier1") : t("san_col_montant_unique")}</div>
                      <input type="number" min="0" step="0.01" style={{ ...inputStyle, width: 90 }} value={b.palier_1} onChange={(e) => updateBaremeMontant(b.id, "palier_1", e.target.value)} />
                    </div>
                    {paliersActifs && (
                      <div>
                        <div style={{ fontSize: 10, color: "#686F7D", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 3 }}>{t("san_col_palier2")}</div>
                        <input type="number" min="0" step="0.01" style={{ ...inputStyle, width: 90 }} value={b.palier_2} onChange={(e) => updateBaremeMontant(b.id, "palier_2", e.target.value)} />
                      </div>
                    )}
                    {paliersActifs && (
                      <div>
                        <div style={{ fontSize: 10, color: "#686F7D", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 3 }}>{t("san_col_palier3")}</div>
                        <input type="number" min="0" step="0.01" style={{ ...inputStyle, width: 90 }} value={b.palier_3} onChange={(e) => updateBaremeMontant(b.id, "palier_3", e.target.value)} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {baremesActifs.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{t("san_no_baremes")}</p>}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
              <input style={{ ...inputStyle, width: 200 }} placeholder={t("san_new_categorie_placeholder")} value={newCategorie.categorie} onChange={(e) => setNewCategorie({ ...newCategorie, categorie: e.target.value })} />
              <input type="number" min="0" step="0.01" style={{ ...inputStyle, width: 90 }} placeholder="0" value={newCategorie.palier_1} onChange={(e) => setNewCategorie({ ...newCategorie, palier_1: e.target.value })} />
              {paliersActifs && <input type="number" min="0" step="0.01" style={{ ...inputStyle, width: 90 }} placeholder="0" value={newCategorie.palier_2} onChange={(e) => setNewCategorie({ ...newCategorie, palier_2: e.target.value })} />}
              {paliersActifs && <input type="number" min="0" step="0.01" style={{ ...inputStyle, width: 90 }} placeholder="0" value={newCategorie.palier_3} onChange={(e) => setNewCategorie({ ...newCategorie, palier_3: e.target.value })} />}
              <Btn variant="outline" disabled={bSaving || !newCategorie.categorie.trim()} onClick={addCategorie}><Plus size={13} /> {t("san_add_categorie_btn")}</Btn>
            </div>
          </Card>

          {/* ---------- Consigner une mesure (repliable) ---------- */}
          <Card style={{ marginBottom: 20, maxWidth: 560, borderTop: `3px solid ${TEAL}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: showCreateForm ? 14 : 0 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>{t("san_propose_title")}</h3>
              <Btn onClick={() => setShowCreateForm((v) => !v)}>
                {showCreateForm ? <X size={14} /> : <Plus size={14} />} {showCreateForm ? t("action_close") : t("san_propose_title")}
              </Btn>
            </div>
            {showCreateForm && (
              <>
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
                  <>
                    <Field label={t("san_field_categorie")}>
                      <select style={inputStyle} value={draft.bareme_id} onChange={(e) => onCategorieChange(e.target.value)}>
                        <option value="">{t("san_field_categorie_none_option")}</option>
                        {baremesActifs.map((b) => <option key={b.id} value={b.id}>{b.categorie}</option>)}
                      </select>
                    </Field>
                    {selectedBareme && paliersActifs && (
                      <Field label={t("san_field_palier")}>
                        <select style={inputStyle} value={draft.palier} onChange={(e) => onPalierChange(Number(e.target.value))}>
                          {[1, 2, 3].map((p) => <option key={p} value={p}>{t(PALIER_LABEL_KEY[p])} — {moneyF(selectedBareme["palier_" + p])}</option>)}
                        </select>
                      </Field>
                    )}
                    {selectedBareme && paliersActifs && priorOccurrences(draft.member_id, draft.bareme_id) > 0 && (
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", background: AMBER_LIGHT, borderRadius: 10, marginBottom: 14 }}>
                        <Info size={15} color={AMBER} style={{ flexShrink: 0, marginTop: 2 }} />
                        <div style={{ fontSize: 12.5, color: "#4A5560" }}>
                          <strong style={{ color: AMBER }}>{t("san_palier_suggestion_detected").replace("{palier}", t(PALIER_LABEL_KEY[suggestedPalierFor(draft.member_id, draft.bareme_id)]))}</strong>{" "}
                          {t("san_palier_suggestion_hint").replace("{palier}", t(PALIER_LABEL_KEY[suggestedPalierFor(draft.member_id, draft.bareme_id)])).replace("{montant}", moneyF(selectedBareme["palier_" + suggestedPalierFor(draft.member_id, draft.bareme_id)]))}
                        </div>
                      </div>
                    )}
                    <Field label={t("san_field_montant")}>
                      <input type="number" min="0" step="0.01" style={inputStyle} value={draft.montant} onChange={(e) => setDraft({ ...draft, montant: e.target.value })} />
                    </Field>
                  </>
                )}
                {draft.type === "suspension" && (
                  <>
                    <Field label={t("san_field_date_debut")}>
                      <input type="date" style={inputStyle} value={draft.date_debut} onChange={(e) => setDraft({ ...draft, date_debut: e.target.value })} />
                    </Field>
                    <Field label={t("san_field_date_fin")}>
                      <input type="date" style={inputStyle} value={draft.date_fin} onChange={(e) => setDraft({ ...draft, date_fin: e.target.value })} />
                    </Field>
                  </>
                )}
                {draft.type === "exclusion" && <p style={{ fontSize: 11.5, color: "#888", marginTop: -6, marginBottom: 14 }}>{t("san_exclusion_note")}</p>}
                <Field label={t("san_field_motif")}>
                  <textarea style={{ ...inputStyle, minHeight: 60 }} placeholder={t("san_field_motif_placeholder")} value={draft.motif} onChange={(e) => setDraft({ ...draft, motif: e.target.value })} />
                </Field>
                <p style={{ fontSize: 11.5, color: willNeedValidation() ? AMBER : "#888", marginTop: -6, marginBottom: 14 }}>
                  {willNeedValidation() ? t("san_effect_pending_note").replace("{nom}", approbateurNom) : t("san_effect_immediate_note")}
                </p>
                <Btn onClick={submitSanction} disabled={saving}>{saving ? <Loader2 size={14} /> : <Gavel size={13} />} {t("san_submit_btn")}</Btn>
              </>
            )}
          </Card>

          {/* ---------- Sanctions en attente de validation ---------- */}
          {jeSuisApprobateur && pending.length > 0 && (
            <Card style={{ marginBottom: 20, maxWidth: 760 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("san_pending_title")}</h3>
              <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("san_pending_intro")}</p>
              {pending.map((s) => (
                <div key={s.id} style={{ padding: "10px 0", borderBottom: "1px solid #F5F5F3" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 13 }}>{nameOf(s.member_id)} — {t(TYPE_LABEL_KEY[s.type])}{s.montant != null ? ` (${moneyF(s.montant)})` : ""}</strong>
                    <span style={{ fontSize: 11, color: "#686F7D" }}>{(s.date_proposition || "").slice(0, 10)}</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: "#666", marginTop: 4 }}>{s.motif}</p>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={() => validateSanction(s)} style={{ fontSize: 11.5, fontWeight: 600, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "5px 12px", cursor: "pointer" }}>{t("san_validate_btn")}</button>
                    <button onClick={() => rejectSanction(s)} style={{ fontSize: 11.5, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "5px 12px", cursor: "pointer" }}>{t("san_reject_btn")}</button>
                  </div>
                </div>
              ))}
            </Card>
          )}

          {/* ---------- Virements Interac en attente (amendes) ---------- */}
          {amendeClaims.filter((c) => c.statut === "en_attente").length > 0 && (
            <Card style={{ marginBottom: 20, maxWidth: 760 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("san_interac_pending_title")}</h3>
              <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("san_interac_pending_intro")}</p>
              {amendeClaims.filter((c) => c.statut === "en_attente").map((c) => (
                <div key={c.id} style={{ padding: "10px 0", borderBottom: "1px solid #F5F5F3" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 13 }}>{nameOf(c.member_id)} — {moneyF(c.montant)}</strong>
                    <span style={{ fontSize: 11, color: "#686F7D" }}>{(c.created_at || "").slice(0, 10)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={() => voirPreuveAmende(c)} style={{ fontSize: 11.5, fontWeight: 600, color: "#5B6270", background: "none", border: "1px solid #E7E9F1", borderRadius: 999, padding: "5px 12px", cursor: "pointer" }}>{t("san_interac_view_proof_btn")}</button>
                    <button onClick={() => confirmerAmendeInterac(c)} disabled={claimActionId === c.id} style={{ fontSize: 11.5, fontWeight: 600, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "5px 12px", cursor: "pointer" }}>{t("san_interac_confirm_btn")}</button>
                    <button onClick={() => rejeterAmendeInterac(c)} disabled={claimActionId === c.id} style={{ fontSize: 11.5, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "5px 12px", cursor: "pointer" }}>{t("san_interac_reject_btn")}</button>
                  </div>
                </div>
              ))}
            </Card>
          )}

          {/* ---------- Registre disciplinaire ---------- */}
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>{t("san_history_title")}</h3>
              <div style={{ position: "relative" }}>
                <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#686F7D", pointerEvents: "none" }} />
                <input style={{ ...inputStyle, width: 190, paddingLeft: 28 }} placeholder={t("san_registre_search_placeholder")} value={registreSearch} onChange={(e) => setRegistreSearch(e.target.value)} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {registreFilters.map((f) => (
                <button key={f} onClick={() => setRegistreFilter(f)} style={pillFilterStyle(registreFilter === f)}>
                  {f === "all" ? t("san_filter_all") : t(STATUT_LABEL_KEY[f])} · {f === "all" ? sanctions.length : sanctions.filter((s) => s.statut === f).length}
                </button>
              ))}
            </div>
            <Table head={[t("san_col_adherent"), t("san_col_type"), t("san_col_categorie_col"), t("san_col_montant_col"), t("san_col_statut"), t("san_col_date"), t("san_col_actions")]}>
              {visibleSanctions.map((s) => (
                <tr key={s.id}>
                  <td style={td}>{nameOf(s.member_id)}</td>
                  <td style={td}>{t(TYPE_LABEL_KEY[s.type])}</td>
                  <td style={td}>{s.categorie_nom || "—"}<div style={{ fontSize: 11, color: "#686F7D" }}>{s.motif}</div></td>
                  <td style={td}>{s.montant != null ? moneyF(s.montant) : "—"}</td>
                  <td style={td}>
                    <StatusBadge label={t(STATUT_LABEL_KEY[s.statut])} {...statusBadgeProps(s.statut)} />
                    {s.type === "amende" && s.statut === "validee" && (
                      <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: s.paye ? TEAL : RED }}>{s.paye ? t("san_paid_badge") : t("san_unpaid_badge")}</span>
                    )}
                  </td>
                  <td style={td}>{(s.date_proposition || "").slice(0, 10)}</td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {s.type === "amende" && s.statut === "validee" && !s.paye && (
                        <button onClick={() => markPaid(s)} style={{ fontSize: 11, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "4px 8px", cursor: "pointer" }}>{t("san_mark_paid_btn")}</button>
                      )}
                      {(s.statut === "validee" || s.statut === "proposee") && (
                        <button onClick={() => cancelSanction(s)} style={{ fontSize: 11, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "4px 8px", cursor: "pointer" }}>{t("san_cancel_btn")}</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visibleSanctions.length === 0 && <tr><td colSpan={7} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("san_no_sanctions")}</td></tr>}
            </Table>
          </Card>
        </>
      )}

      {!isBureau && (
        <Card style={{ maxWidth: 640 }}>
          <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("san_my_title")}</h3>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("san_my_intro")}</p>
          {myUnpaid && <p style={{ fontSize: 12.5, color: RED, marginBottom: 12 }}>{t("san_my_to_pay_note")}</p>}
          {mySanctions.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "#686F7D", fontStyle: "italic" }}>{t("san_my_none")}</p>
          ) : (
            mySanctions.map((s) => (
              <div key={s.id} style={{ padding: "10px 0", borderBottom: "1px solid #F5F5F3" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 13 }}>{t(TYPE_LABEL_KEY[s.type])}{s.montant != null ? ` — ${moneyF(s.montant)}` : ""}</strong>
                  <span style={{ fontSize: 11, color: "#686F7D" }}>{(s.date_proposition || "").slice(0, 10)}</span>
                </div>
                <p style={{ fontSize: 12.5, color: "#666", marginTop: 4 }}>{s.motif}</p>
                <StatusBadge label={t(STATUT_LABEL_KEY[s.statut])} {...statusBadgeProps(s.statut)} />
                {s.type === "amende" && s.statut === "validee" && (
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: s.paye ? TEAL : RED }}>{s.paye ? t("san_paid_badge") : t("san_unpaid_badge")}</span>
                )}
                {s.type === "amende" && s.statut === "validee" && !s.paye && (
                  <div style={{ marginTop: 8 }}>
                    {pendingInteracClaimFor(s.id) ? (
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: "#8A5A00", background: "#FFF3D6", borderRadius: 999, padding: "4px 10px" }}>{t("san_interac_claim_pending")}</span>
                    ) : (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <Btn variant="outline" disabled={payingId === s.id} onClick={() => payerAmendeEnLigne(s)}><CreditCard size={13} /> {payingId === s.id ? t("san_pay_redirecting") : t("san_pay_card_btn")}</Btn>
                        <label style={{ fontSize: 11.5, fontWeight: 600, color: TEAL, border: `1px solid ${TEAL}`, borderRadius: 999, padding: "7px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Upload size={13} /> {t("san_pay_interac_upload_btn")}
                          <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => setInteracFiles((p) => ({ ...p, [s.id]: e.target.files?.[0] || null }))} />
                        </label>
                        {interacFiles[s.id] && (
                          <Btn disabled={interacUploading === s.id} onClick={() => submitInteracForAmende(s)}>{interacUploading === s.id ? t("san_pay_uploading") : t("san_pay_interac_submit_btn")}</Btn>
                        )}
                      </div>
                    )}
                    {interacFiles[s.id] && <p style={{ fontSize: 11.5, color: "#888", marginTop: 4 }}>{interacFiles[s.id].name}</p>}
                    {interacMsg[s.id] && <p style={{ fontSize: 11.5, color: TEAL, marginTop: 4 }}>{interacMsg[s.id]}</p>}
                  </div>
                )}
              </div>
            ))
          )}
        </Card>
      )}
    </Section></Container>
  );
}
