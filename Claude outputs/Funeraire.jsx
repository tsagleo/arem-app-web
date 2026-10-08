// =====================================================================
// Funeraire.jsx — Programme funéraire (rapatriement des dépouilles)
// =====================================================================
// Suite 70 (2026-09-18) puis Refonte (2026-09-21, main levée / clé
// variable) — voir l'historique complet dans les versions précédentes de
// ce fichier et dans resume-arem-app.md.
//
// REFONTE N°2 (suite 75, 2026-09-21), demande directe de l'utilisateur,
// cadrée par deux rounds d'AskUserQuestion — voir le document de projet
// « proposition-funeraire-sanctions.md », section « Refonte n°2 du volet
// Funéraire ». Remplace en profondeur le modèle précédent :
//
//   A) Les deux plans (Main levée / Organisme tiers) deviennent deux
//      sous-rubriques INDÉPENDANTES ET CUMULABLES plutôt qu'un choix
//      unique (associations.funeraire_mode) : une association active
//      l'un, l'autre, ou les deux à la fois
//      (funeraire_main_levee_actif / funeraire_organisme_tiers_actif).
//      Un même dossier de décès peut désormais déclencher les deux plans
//      en même temps — la déclaration et la liste des dossiers restent
//      donc un mécanisme UNIQUE et PARTAGÉ, affiché en dehors des deux
//      sous-onglets ; chaque sous-onglet n'affiche que son propre
//      contenu spécifique (formulaires, tableaux, cartes).
//   B) Organisme tiers : la réserve commune partagée (un seul pot par
//      association) est remplacée par une RÉSERVE INDIVIDUELLE par
//      adhérent (funeraire_reserve_individuelle_mouvements). À chaque
//      décès, la clé de répartition communiquée par l'organisme tiers
//      est débitée du solde individuel de CHAQUE adhérent inscrit, payé,
//      hors probation et non suspendu — jamais de solde négatif
//      (déduction plafonnée). Alerte visuelle sous un seuil, puis
//      suspension automatique à solde zéro ; la suspension ne se lève
//      QU'UNE FOIS LE SOLDE REMONTÉ AU-DESSUS DU SEUIL D'ALERTE lui-même
//      (précision de l'utilisateur : « la suspension ne se lève qu'une
//      fois complètement sorti du rouge »), pas simplement au-dessus de
//      zéro. Nouvelle période de probation après le paiement de
//      l'inscription (associations.funeraire_periode_probation_jours),
//      même principe que periode_probation_secours_jours.
//      L'inscription (funeraire_inscriptions), les bénéficiaires couverts
//      et toute cette mécanique d'éligibilité sont désormais spécifiques
//      au plan Organisme tiers — Main levée reste ouverte à tous les
//      adhérents de l'association, sans inscription.
//   C) Rapports et états imprimables/transférables aux ayants droit :
//      réutilise le patron déjà en place (Décharge, Reçus, PV) — vue
//      imprimable côté client, window.print(), aucune librairie PDF.
//      Deux vues : l'état individuel de réserve d'un adhérent (modale
//      FuneraireIndivLedgerModal, qui sert aussi de détail chronologique
//      pour le tableau de gestion du point B) et le rapport d'un dossier
//      de décès (modale FuneraireDossierReportModal).
//   D) Volet d'annonces spécifique à Funéraire (funeraire_annonces),
//      rédigé par le Bureau, visible UNIQUEMENT par les adhérents ayant
//      une inscription active au plan Organisme tiers (RLS côté base,
//      audience confirmée via AskUserQuestion).
//
// Script SQL : sql/2026-09-21c_funeraire_refonte2.sql.
// =====================================================================
import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HeartHandshake, Plus, X, UserPlus, AlertTriangle, Trash2, HandCoins, CreditCard, Loader2, Printer, Megaphone, History, Wallet } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, inputStyle, useLang, RED, TEAL, TEAL_LIGHT, Table, td, money, todayISO } from "./shared";

// Motifs de suppression d'une inscription au programme funéraire → clé
// DICTIONARY correspondante (même principe que DOC_CATEGORY_KEY_MAP,
// App.jsx). Suite 70 (complément #4).
const FUN_MOTIF_KEY_MAP = {
  test: "fun_motif_test",
  erreur_saisie: "fun_motif_erreur_saisie",
  doublon: "fun_motif_doublon",
  demande_adherent: "fun_motif_demande_adherent",
  autre: "fun_motif_other",
};

// Motifs de suppression d'un dossier de décès (distincts de ceux d'une
// inscription — un dossier peut être supprimé même après un rapatriement
// déjà réglé, ex. doublon ou dossier créé par erreur). Suite 70
// (complément #5).
const FUN_DOSSIER_MOTIF_KEY_MAP = {
  test: "fun_motif_test",
  erreur_saisie: "fun_motif_erreur_saisie",
  doublon: "fun_motif_doublon",
  rapatriement_annule: "fun_dossier_motif_annule",
  autre: "fun_motif_other",
};

const tabBtnStyle = (active) => ({
  fontSize: 13, fontWeight: 600, padding: "9px 16px", background: "none",
  border: "none", borderBottom: active ? `2px solid ${TEAL}` : "2px solid transparent",
  color: active ? TEAL : "#888", cursor: "pointer",
});

export default function Funeraire({ profile, isBureau, isPresident, association }) {
  const { t, lang } = useLang();
  const moneyF = (n) => money(n, association?.devise_monetaire);
  // Traduit les erreurs techniques Postgres (codes SQLSTATE) en messages
  // compréhensibles pour le Bureau/les adhérents, plutôt que d'afficher le
  // texte brut renvoyé par la base. Le détail technique reste dans la
  // console (console.error) pour le diagnostic si besoin. Suite 70
  // (complément).
  function friendlyError(error) {
    if (!error) return t("fun_error_generic");
    switch (error.code) {
      case "23505": return t("fun_error_duplicate");
      case "23503": return t("fun_error_foreign_key");
      case "23514": return t("fun_error_invalid_value");
      case "42501": return t("fun_error_permission");
      default: return t("fun_error_generic") + " " + (error.message || "");
    }
  }

  // ---------- Refonte n°2 : deux plans indépendants et cumulables ----------
  const mainLeveeActif = association?.funeraire_main_levee_actif !== false;
  const organismeTiersActif = !!association?.funeraire_organisme_tiers_actif;
  const bothActive = mainLeveeActif && organismeTiersActif;
  const montantInscriptionCfg = Number(association?.funeraire_montant_inscription || 0);
  const montantDecesCfg = Number(association?.funeraire_montant_deces || 0);
  const montantRechargeCfg = Number(association?.funeraire_montant_recharge || 0);
  const seuilAlerte = Number(association?.funeraire_seuil_alerte || 0);
  const periodeProbationJours = Number(association?.funeraire_periode_probation_jours || 0);

  const [activeSubTab, setActiveSubTab] = useState(mainLeveeActif ? "main_levee" : "organisme_tiers");
  useEffect(() => {
    setActiveSubTab((prev) => {
      if ((prev === "main_levee" && mainLeveeActif) || (prev === "organisme_tiers" && organismeTiersActif)) return prev;
      return mainLeveeActif ? "main_levee" : "organisme_tiers";
    });
  }, [mainLeveeActif, organismeTiersActif]);
  const showMainLevee = mainLeveeActif && (!bothActive || activeSubTab === "main_levee");
  const showOrganismeTiers = organismeTiersActif && (!bothActive || activeSubTab === "organisme_tiers");

  const [members, setMembers] = useState([]);
  const [inscriptions, setInscriptions] = useState([]);
  const [beneficiaires, setBeneficiaires] = useState([]);
  const [dossiers, setDossiers] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [reserveIndivMvts, setReserveIndivMvts] = useState([]);
  const [annonces, setAnnonces] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: m }, { data: ins }, { data: ben }, { data: dos }, { data: contribs }, { data: mvts }, { data: ann }] = await Promise.all([
      supabase.from("members").select("id,nom,statut").order("nom"),
      supabase.from("funeraire_inscriptions").select("*"),
      supabase.from("funeraire_beneficiaires").select("*"),
      supabase.from("funeraire_dossiers").select("*").order("date_deces", { ascending: false }),
      supabase.from("funeraire_contributions").select("*").order("created_at", { ascending: false }),
      supabase.from("funeraire_reserve_individuelle_mouvements").select("*").order("created_at", { ascending: false }),
      supabase.from("funeraire_annonces").select("*").order("created_at", { ascending: false }),
    ]);
    setMembers(m || []); setInscriptions(ins || []); setBeneficiaires(ben || []);
    setDossiers(dos || []); setContributions(contribs || []); setReserveIndivMvts(mvts || []);
    setAnnonces(ann || []);
    setLoading(false);
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  function nameOf(id) { return members.find((m) => m.id === id)?.nom || "—"; }
  function myInscription() { return inscriptions.find((i) => i.member_id === profile.member_id && i.statut === "actif"); }
  function myBeneficiaires() { return beneficiaires.filter((b) => b.member_id === profile.member_id); }
  const activeMembers = members.filter((m) => m.statut === "Actif");

  // ---------- Organisme tiers : probation, réserve individuelle, éligibilité ----------
  function isProbationDone(insc) {
    if (!periodeProbationJours || !insc?.date_paiement) return true;
    const deadline = new Date(insc.date_paiement);
    deadline.setDate(deadline.getDate() + periodeProbationJours);
    return new Date() >= deadline;
  }
  function probationDeadlineLabel(insc) {
    if (!periodeProbationJours || !insc?.date_paiement) return null;
    const d = new Date(insc.date_paiement);
    d.setDate(d.getDate() + periodeProbationJours);
    return d.toISOString().slice(0, 10);
  }
  function memberReserveBalance(memberId) {
    return reserveIndivMvts.filter((mv) => mv.member_id === memberId).reduce((s, mv) => s + Number(mv.montant), 0);
  }
  // Éligibilité au plan Organisme tiers (comptabilisé dans l'application d'une
  // clé de répartition) : inscrit actif, inscription payée, probation
  // terminée, pas suspendu. Refonte n°2.
  function eligibleOrganismeTiersMembers() {
    return activeMembers.filter((m) => {
      const insc = inscriptions.find((i) => i.member_id === m.id && i.statut === "actif");
      return insc && insc.inscription_payee && !insc.suspendu && isProbationDone(insc);
    });
  }
  function balanceBadge(insc) {
    if (!insc) return null;
    const balance = memberReserveBalance(insc.member_id);
    if (insc.suspendu) return { label: t("fun_badge_suspended"), color: RED };
    if (balance <= seuilAlerte) return { label: t("fun_badge_alert"), color: "#B8860B" };
    return { label: t("fun_badge_ok"), color: TEAL };
  }

  // ---------- Adhérent : rejoindre le plan Organisme tiers ----------
  async function joinProgram() {
    if (!profile.member_id) return;
    if (!montantInscriptionCfg) { alert(t("fun_montant_inscription_missing")); return; }
    if (!window.confirm(t("fun_confirm_join").replace("{montant}", moneyF(montantInscriptionCfg)))) return;
    const { data, error } = await supabase.from("funeraire_inscriptions").insert({
      association_id: profile.association_id, member_id: profile.member_id,
      montant_inscription: montantInscriptionCfg,
    }).select().single();
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setInscriptions((p) => [...p, data]);
  }

  // ---------- Bureau : inscrire un adhérent ----------
  const [enrollMemberId, setEnrollMemberId] = useState("");
  async function enrollMember() {
    if (!enrollMemberId) return;
    if (!montantInscriptionCfg) { alert(t("fun_montant_inscription_missing")); return; }
    if (!window.confirm(t("fun_confirm_enroll_member").replace("{nom}", nameOf(enrollMemberId)).replace("{montant}", moneyF(montantInscriptionCfg)))) return;
    const { data, error } = await supabase.from("funeraire_inscriptions").insert({
      association_id: profile.association_id, member_id: enrollMemberId,
      montant_inscription: montantInscriptionCfg,
    }).select().single();
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setInscriptions((p) => [...p, data]);
    setEnrollMemberId("");
  }

  async function markInscriptionPaid(inscriptionId) {
    const insc = inscriptions.find((i) => i.id === inscriptionId);
    if (!insc) return;
    if (!window.confirm(t("fun_confirm_mark_inscription_paid").replace("{nom}", nameOf(insc.member_id)).replace("{montant}", moneyF(insc.montant_inscription)))) return;
    const { error } = await supabase.from("funeraire_inscriptions").update({ inscription_payee: true, date_paiement: todayISO() }).eq("id", inscriptionId);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setInscriptions((p) => p.map((i) => (i.id === inscriptionId ? { ...i, inscription_payee: true, date_paiement: todayISO() } : i)));
  }

  async function withdrawInscription(inscriptionId) {
    if (!window.confirm(t("fun_confirm_withdraw"))) return;
    const { error } = await supabase.from("funeraire_inscriptions").update({ statut: "retire" }).eq("id", inscriptionId);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setInscriptions((p) => p.map((i) => (i.id === inscriptionId ? { ...i, statut: "retire" } : i)));
  }

  async function transferInscription(inscriptionId) {
    const dest = window.prompt(t("fun_transfer_prompt"));
    if (!dest || !dest.trim()) return;
    if (!window.confirm(t("fun_confirm_transfer").replace("{dest}", dest.trim()))) return;
    const { error } = await supabase.from("funeraire_inscriptions").update({ statut: "transfere", transfert_association_nom: dest.trim() }).eq("id", inscriptionId);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setInscriptions((p) => p.map((i) => (i.id === inscriptionId ? { ...i, statut: "transfere", transfert_association_nom: dest.trim() } : i)));
  }

  // Suppression d'une ligne d'inscription : archivée (statut « supprime »),
  // motif obligatoire — même principe que la suppression d'un adhérent.
  // Suite 70 (complément #4).
  const [deleteMotifs, setDeleteMotifs] = useState({});
  const [showDeletedInscriptions, setShowDeletedInscriptions] = useState(false);
  async function archiveInscription(inscriptionId, motif) {
    if (!motif) return;
    if (!window.confirm(t("fun_confirm_archive_inscription"))) return;
    const { error } = await supabase.from("funeraire_inscriptions").update({
      statut: "supprime", motif_suppression: motif, date_suppression: todayISO(),
    }).eq("id", inscriptionId);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setInscriptions((p) => p.map((i) => (i.id === inscriptionId ? { ...i, statut: "supprime", motif_suppression: motif, date_suppression: todayISO() } : i)));
    setDeleteMotifs((p) => { const n = { ...p }; delete n[inscriptionId]; return n; });
  }
  async function restoreInscription(inscriptionId) {
    if (!window.confirm(t("fun_confirm_restore_inscription"))) return;
    const { error } = await supabase.from("funeraire_inscriptions").update({
      statut: "retire", motif_suppression: null, date_suppression: null,
    }).eq("id", inscriptionId);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setInscriptions((p) => p.map((i) => (i.id === inscriptionId ? { ...i, statut: "retire", motif_suppression: null, date_suppression: null } : i)));
  }
  async function permanentlyDeleteInscription(inscriptionId) {
    if (!window.confirm(t("fun_confirm_delete_permanent_inscription"))) return;
    const { error } = await supabase.from("funeraire_inscriptions").delete().eq("id", inscriptionId);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setInscriptions((p) => p.filter((i) => i.id !== inscriptionId));
  }

  // ---------- Bénéficiaires couverts ----------
  const [newBenef, setNewBenef] = useState({ nom: "", lien_parente: "", date_naissance: "" });
  async function addBeneficiaire() {
    if (!profile.member_id || !newBenef.nom.trim() || !newBenef.lien_parente.trim()) return;
    if (!window.confirm(t("fun_confirm_add_beneficiary").replace("{nom}", newBenef.nom.trim()).replace("{lien}", newBenef.lien_parente.trim()))) return;
    const { data, error } = await supabase.from("funeraire_beneficiaires").insert({
      association_id: profile.association_id, member_id: profile.member_id,
      nom: newBenef.nom.trim(), lien_parente: newBenef.lien_parente.trim(), date_naissance: newBenef.date_naissance || null,
    }).select().single();
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setBeneficiaires((p) => [...p, data]);
    setNewBenef({ nom: "", lien_parente: "", date_naissance: "" });
  }
  async function deleteBeneficiaire(id) {
    if (!window.confirm(t("fun_confirm_delete_beneficiary"))) return;
    const { error } = await supabase.from("funeraire_beneficiaires").delete().eq("id", id);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setBeneficiaires((p) => p.filter((b) => b.id !== id));
  }

  // ---------- Bureau : déclarer un décès (mécanisme unique, partagé par les deux plans) ----------
  // Refonte n°2 : un même dossier peut désormais porter à la fois un
  // montant suggéré (Main levée) et une clé de répartition (Organisme
  // tiers), selon les plans actifs pour l'association.
  const [newDossier, setNewDossier] = useState({ memberId: "", beneficiaireId: "", dateDeces: "", description: "", montantSuggere: "", montantCle: "" });
  useEffect(() => {
    setNewDossier((p) => (p.montantCle ? p : { ...p, montantCle: montantDecesCfg ? String(montantDecesCfg) : "" }));
  }, [montantDecesCfg]);
  async function declareDeath() {
    if (!newDossier.memberId || !newDossier.dateDeces) { alert(t("fun_error_generic")); return; }
    if (organismeTiersActif && !newDossier.montantCle) { alert(t("fun_cle_repartition_required")); return; }
    const nomDefunt = newDossier.beneficiaireId
      ? (beneficiaires.find((b) => b.id === newDossier.beneficiaireId)?.nom || "—")
      : nameOf(newDossier.memberId);
    const montantSuggere = mainLeveeActif && newDossier.montantSuggere ? Number(newDossier.montantSuggere) : null;
    const montantCle = organismeTiersActif ? Number(newDossier.montantCle) : null;
    const eligibles = organismeTiersActif ? eligibleOrganismeTiersMembers() : [];

    let confirmMsg = t("fun_confirm_declare_death_base").replace("{nom}", nomDefunt);
    if (mainLeveeActif) confirmMsg += t("fun_confirm_declare_death_main_levee_note").replace("{montant}", montantSuggere != null ? moneyF(montantSuggere) : "—");
    if (organismeTiersActif) confirmMsg += t("fun_confirm_declare_death_organisme_tiers_note").replace("{montant}", moneyF(montantCle)).replace("{n}", String(eligibles.length));
    if (!window.confirm(confirmMsg)) return;

    const { data: dossier, error } = await supabase.from("funeraire_dossiers").insert({
      association_id: profile.association_id, member_id: newDossier.memberId,
      beneficiaire_id: newDossier.beneficiaireId || null, nom_defunt: nomDefunt,
      date_deces: newDossier.dateDeces, description: newDossier.description || null,
      montant_suggere: montantSuggere, montant_cle_repartition: montantCle,
      nb_actifs_snapshot: eligibles.length,
    }).select().single();
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setDossiers((p) => [dossier, ...p]);

    if (organismeTiersActif && montantCle) {
      await applyCleRepartition(dossier.id, montantCle, eligibles, nomDefunt);
    }
    setNewDossier({ memberId: "", beneficiaireId: "", dateDeces: "", description: "", montantSuggere: "", montantCle: montantDecesCfg ? String(montantDecesCfg) : "" });
  }

  // ---------- Organisme tiers : application de la clé de répartition à la réserve individuelle ----------
  // Débite chaque adhérent éligible du montant de la clé, PLAFONNÉ à ce qui
  // lui reste (jamais de solde négatif). Suspend automatiquement tout
  // adhérent dont le solde atteint exactement zéro. Refonte n°2, point B.
  async function applyCleRepartition(dossierId, montantCle, eligibles, nomDefunt) {
    const rows = [];
    const toSuspend = [];
    for (const m of eligibles) {
      const balance = memberReserveBalance(m.id);
      const deduction = Math.min(montantCle, Math.max(0, balance));
      if (deduction <= 0) continue;
      rows.push({
        association_id: profile.association_id, member_id: m.id, type: "application_cle",
        montant: -deduction, dossier_id: dossierId,
        description: t("fun_ledger_desc_deces").replace("{nom}", nomDefunt),
      });
      if (balance - deduction <= 0) toSuspend.push(m.id);
    }
    if (rows.length === 0) return;
    const { data: mvts, error } = await supabase.from("funeraire_reserve_individuelle_mouvements").insert(rows).select();
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setReserveIndivMvts((p) => [...(mvts || []), ...p]);
    if (toSuspend.length > 0) {
      const { error: e2 } = await supabase.from("funeraire_inscriptions").update({ suspendu: true }).in("member_id", toSuspend).eq("association_id", profile.association_id).eq("statut", "actif");
      if (e2) { alert(friendlyError(e2)); console.error(e2); return; }
      setInscriptions((p) => p.map((i) => (toSuspend.includes(i.member_id) && i.statut === "actif" ? { ...i, suspendu: true } : i)));
    }
  }

  // ---------- Organisme tiers : Bureau enregistre un dépôt (recharge) pour un adhérent ----------
  // La suspension ne se lève QU'UNE FOIS le solde remonté au-dessus du seuil
  // d'alerte lui-même (pas simplement au-dessus de zéro) — précision de
  // l'utilisateur, 2026-09-21. Refonte n°2.
  const [depositDrafts, setDepositDrafts] = useState({});
  function depositDraft(memberId) { return depositDrafts[memberId] ?? (montantRechargeCfg ? String(montantRechargeCfg) : ""); }
  function setDepositDraft(memberId, val) { setDepositDrafts((p) => ({ ...p, [memberId]: val })); }
  const [depositSaving, setDepositSaving] = useState({});
  async function recordDeposit(memberId) {
    const montant = Number(depositDraft(memberId));
    if (!montant || montant <= 0) return;
    if (!window.confirm(t("fun_confirm_reserve_deposit").replace("{montant}", moneyF(montant)).replace("{nom}", nameOf(memberId)))) return;
    setDepositSaving((p) => ({ ...p, [memberId]: true }));
    const { data, error } = await supabase.from("funeraire_reserve_individuelle_mouvements").insert({
      association_id: profile.association_id, member_id: memberId, type: "depot", montant,
      description: t("fun_ledger_desc_depot"),
    }).select().single();
    setDepositSaving((p) => ({ ...p, [memberId]: false }));
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setReserveIndivMvts((p) => [data, ...p]);
    setDepositDrafts((p) => ({ ...p, [memberId]: "" }));
    const newBalance = memberReserveBalance(memberId) + montant;
    const insc = inscriptions.find((i) => i.member_id === memberId && i.statut === "actif");
    if (insc?.suspendu && newBalance > seuilAlerte) {
      const { error: e2 } = await supabase.from("funeraire_inscriptions").update({ suspendu: false }).eq("id", insc.id);
      if (!e2) setInscriptions((p) => p.map((i) => (i.id === insc.id ? { ...i, suspendu: false } : i)));
    }
  }

  // ---------- Collecte de solidarité (Main levée) ----------
  // Contributions volontaires et nominatives, ouvertes à TOUS les adhérents
  // de l'association (pas seulement les inscrits au plan Organisme tiers,
  // qui n'a aucun lien avec ce plan) — décision explicite de l'utilisateur.
  const [newContrib, setNewContrib] = useState({});
  function contribDraft(dossierId) { return newContrib[dossierId] || { memberId: "", montant: "", methode: "manuel", reference: "", file: null }; }
  function setContribDraft(dossierId, patch) { setNewContrib((p) => ({ ...p, [dossierId]: { ...contribDraft(dossierId), ...patch } })); }
  async function uploadContributionPreuve(dossierId, file) {
    const path = `${profile.association_id}/funeraire/contributions/${dossierId}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("documents").upload(path, file);
    if (error) { alert(friendlyError(error)); console.error(error); return null; }
    return path;
  }
  const [contribUploading, setContribUploading] = useState({});
  async function addContribution(dossierId) {
    const draft = contribDraft(dossierId);
    const montant = Number(draft.montant);
    if (!draft.memberId || !montant || montant <= 0) return;
    const d = dossiers.find((x) => x.id === dossierId);
    if (!window.confirm(t("fun_confirm_add_contribution").replace("{nom}", nameOf(draft.memberId)).replace("{montant}", moneyF(montant)).replace("{defunt}", d?.nom_defunt || "—"))) return;
    let preuvePath = null;
    if (draft.file) {
      setContribUploading((p) => ({ ...p, [dossierId]: true }));
      preuvePath = await uploadContributionPreuve(dossierId, draft.file);
      setContribUploading((p) => ({ ...p, [dossierId]: false }));
    }
    const { data, error } = await supabase.from("funeraire_contributions").insert({
      association_id: profile.association_id, dossier_id: dossierId, member_id: draft.memberId,
      montant, methode: draft.methode || "manuel", reference: draft.reference?.trim() || null, preuve_path: preuvePath,
    }).select().single();
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setContributions((p) => [data, ...p]);
    setNewContrib((p) => ({ ...p, [dossierId]: { memberId: "", montant: "", methode: "manuel", reference: "", file: null } }));
  }
  async function deleteContribution(id) {
    if (!window.confirm(t("fun_confirm_delete_contribution"))) return;
    const { error } = await supabase.from("funeraire_contributions").delete().eq("id", id);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setContributions((p) => p.filter((c) => c.id !== id));
  }

  // ---------- Bureau : verser les fonds récoltés/décaissés au foyer endeuillé ----------
  const [versementDossierId, setVersementDossierId] = useState(null);
  // Rapports imprimables/transférables aux ayants droit (point C de la
  // refonte n°2) : détail de la réserve individuelle d'un adhérent
  // (également le « détail » du tableau de gestion, point B) et rapport
  // d'un dossier de décès.
  const [ledgerModalMemberId, setLedgerModalMemberId] = useState(null);
  const [reportDossierId, setReportDossierId] = useState(null);
  async function uploadVersementPreuve(dossierId, file) {
    const path = `${profile.association_id}/funeraire/versement/${dossierId}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("documents").upload(path, file);
    if (error) { alert(friendlyError(error)); console.error(error); return null; }
    return path;
  }
  async function saveVersementFamille(dossierId, { methode, montant, date, reference, preuvePath }) {
    const d = dossiers.find((x) => x.id === dossierId);
    if (!window.confirm(t("fun_confirm_versement_famille").replace("{nom}", d?.nom_defunt || "—").replace("{montant}", moneyF(montant)))) return;
    const patch = { versement_methode: methode, versement_montant: montant, versement_date: date, versement_reference: reference?.trim() || null, versement_preuve_path: preuvePath || d?.versement_preuve_path || null };
    const { error } = await supabase.from("funeraire_dossiers").update(patch).eq("id", dossierId);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setDossiers((p) => p.map((x) => (x.id === dossierId ? { ...x, ...patch } : x)));
    setVersementDossierId(null);
  }

  async function closeDossier(id) {
    const d = dossiers.find((x) => x.id === id);
    if (!window.confirm(t("fun_confirm_close_dossier").replace("{nom}", d?.nom_defunt || "—"))) return;
    const { error } = await supabase.from("funeraire_dossiers").update({ statut: "cloture" }).eq("id", id);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setDossiers((p) => p.map((d) => (d.id === id ? { ...d, statut: "cloture" } : d)));
  }

  // ---------- Bureau : modifier un dossier déjà créé ----------
  const [editingDossierId, setEditingDossierId] = useState(null);
  const [dossierEditDraft, setDossierEditDraft] = useState({ nom_defunt: "", date_deces: "", description: "" });
  function startEditDossier(d) {
    setEditingDossierId(d.id);
    setDossierEditDraft({ nom_defunt: d.nom_defunt || "", date_deces: d.date_deces || "", description: d.description || "" });
  }
  function cancelEditDossier() { setEditingDossierId(null); }
  async function saveDossierEdit(id) {
    if (!dossierEditDraft.nom_defunt.trim() || !dossierEditDraft.date_deces) { alert(t("fun_error_generic")); return; }
    if (!window.confirm(t("fun_confirm_save_dossier_edit").replace("{nom}", dossierEditDraft.nom_defunt.trim()))) return;
    const patch = { nom_defunt: dossierEditDraft.nom_defunt.trim(), date_deces: dossierEditDraft.date_deces, description: dossierEditDraft.description.trim() || null };
    const { error } = await supabase.from("funeraire_dossiers").update(patch).eq("id", id);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setDossiers((p) => p.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    setEditingDossierId(null);
  }

  // ---------- Bureau : supprimer (archiver) un dossier de décès ----------
  const [dossierDeleteMotifs, setDossierDeleteMotifs] = useState({});
  const [showDeletedDossiers, setShowDeletedDossiers] = useState(false);
  async function archiveDossier(id, motif) {
    if (!motif) return;
    if (!window.confirm(t("fun_confirm_archive_dossier"))) return;
    const d = dossiers.find((x) => x.id === id);
    const patch = { statut: "supprime", statut_avant_suppression: d?.statut || "cloture", motif_suppression: motif, date_suppression: todayISO() };
    const { error } = await supabase.from("funeraire_dossiers").update(patch).eq("id", id);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setDossiers((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setDossierDeleteMotifs((p) => { const n = { ...p }; delete n[id]; return n; });
  }
  async function restoreDossier(id) {
    if (!window.confirm(t("fun_confirm_restore_dossier"))) return;
    const d = dossiers.find((x) => x.id === id);
    const patch = { statut: d?.statut_avant_suppression || "cloture", statut_avant_suppression: null, motif_suppression: null, date_suppression: null };
    const { error } = await supabase.from("funeraire_dossiers").update(patch).eq("id", id);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setDossiers((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  async function permanentlyDeleteDossier(id) {
    if (!window.confirm(t("fun_confirm_delete_permanent_dossier"))) return;
    const { error } = await supabase.from("funeraire_dossiers").delete().eq("id", id);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setDossiers((p) => p.filter((x) => x.id !== id));
    setContributions((p) => p.filter((c) => c.dossier_id !== id));
  }

  // ---------- Organisme tiers : annonces (visibles seulement aux inscrits actifs, RLS) ----------
  const [annonceDraft, setAnnonceDraft] = useState({ titre: "", contenu: "" });
  async function addAnnonce() {
    if (!annonceDraft.titre.trim() || !annonceDraft.contenu.trim()) return;
    if (!window.confirm(t("fun_confirm_add_annonce").replace("{titre}", annonceDraft.titre.trim()))) return;
    const { data, error } = await supabase.from("funeraire_annonces").insert({
      association_id: profile.association_id, titre: annonceDraft.titre.trim(), contenu: annonceDraft.contenu.trim(),
      auteur_id: profile.id, auteur_nom: profile.nom_complet,
    }).select().single();
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setAnnonces((p) => [data, ...p]);
    setAnnonceDraft({ titre: "", contenu: "" });
  }
  async function archiveAnnonce(id) {
    if (!window.confirm(t("fun_confirm_archive_annonce"))) return;
    const { error } = await supabase.from("funeraire_annonces").update({ statut: "archivee" }).eq("id", id);
    if (error) { alert(friendlyError(error)); console.error(error); return; }
    setAnnonces((p) => p.map((a) => (a.id === id ? { ...a, statut: "archivee" } : a)));
  }

  // ---------- Président(e) : réinitialisation complète du volet ----------
  const [resetting, setResetting] = useState(false);
  async function resetFuneraireModule() {
    if (!isPresident) return;
    const expected = (association?.nom || "").trim();
    const typed = window.prompt(t("fun_reset_confirm_prompt").replace("{nom}", expected));
    if (typed === null) return;
    if (typed.trim() !== expected) { alert(t("fun_reset_confirm_mismatch")); return; }
    if (!window.confirm(t("fun_reset_confirm_final"))) return;
    setResetting(true);
    const aid = profile.association_id;
    const { error: e0 } = await supabase.from("funeraire_contributions").delete().eq("association_id", aid);
    const { error: e1 } = await supabase.from("funeraire_annonces").delete().eq("association_id", aid);
    const { error: e2 } = await supabase.from("funeraire_reserve_individuelle_mouvements").delete().eq("association_id", aid);
    const { error: e3 } = await supabase.from("funeraire_dossiers").delete().eq("association_id", aid);
    const { error: e4 } = await supabase.from("funeraire_beneficiaires").delete().eq("association_id", aid);
    const { error: e5 } = await supabase.from("funeraire_inscriptions").delete().eq("association_id", aid);
    setResetting(false);
    const err = e0 || e1 || e2 || e3 || e4 || e5;
    if (err) { alert(friendlyError(err)); console.error(err); return; }
    setInscriptions([]); setBeneficiaires([]); setDossiers([]); setContributions([]); setReserveIndivMvts([]); setAnnonces([]);
    setDeleteMotifs({}); setDossierDeleteMotifs({}); setShowDeletedInscriptions(false); setShowDeletedDossiers(false);
    setEnrollMemberId(""); setNewBenef({ nom: "", lien_parente: "", date_naissance: "" });
    setNewDossier({ memberId: "", beneficiaireId: "", dateDeces: "", description: "", montantSuggere: "", montantCle: montantDecesCfg ? String(montantDecesCfg) : "" });
    setNewContrib({}); setDepositDrafts({}); setAnnonceDraft({ titre: "", contenu: "" });
    alert(t("fun_reset_done"));
  }

  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  const mine = myInscription();
  const archivedDossierIds = new Set(dossiers.filter((d) => d.statut === "supprime").map((d) => d.id));
  const inscritsActifs = inscriptions.filter((i) => i.statut === "actif");
  const totalReserveIndiv = inscritsActifs.reduce((s, i) => s + memberReserveBalance(i.member_id), 0);
  const countAlert = inscritsActifs.filter((i) => { const b = memberReserveBalance(i.member_id); return !i.suspendu && b <= seuilAlerte; }).length;
  const countSuspended = inscritsActifs.filter((i) => i.suspendu).length;
  const activeAnnonces = annonces.filter((a) => a.statut !== "archivee");

  return (
    <Container><Section>
      <h2 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><HeartHandshake size={20} /> {t("fun_title")}</h2>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 20, maxWidth: 640 }}>{t("fun_intro")}</p>

      {bothActive && (
        <div style={{ display: "flex", gap: 4, marginBottom: 22, borderBottom: "1px solid #EEE" }}>
          <button onClick={() => setActiveSubTab("main_levee")} style={tabBtnStyle(activeSubTab === "main_levee")}>{t("fun_subtab_main_levee")}</button>
          <button onClick={() => setActiveSubTab("organisme_tiers")} style={tabBtnStyle(activeSubTab === "organisme_tiers")}>{t("fun_subtab_organisme_tiers")}</button>
        </div>
      )}

      {/* ---------- Main levée : collecte de solidarité (résumé + adhérent) ---------- */}
      {showMainLevee && dossiers.some((d) => d.statut === "ouvert") && (
        <Card style={{ marginBottom: 20, maxWidth: 640 }}>
          <h3 style={{ fontSize: 14, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}><HandCoins size={16} /> {t("fun_collecte_title")}</h3>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("fun_collecte_intro")}</p>
          {dossiers.filter((d) => d.statut === "ouvert").map((d) => {
            const total = contributions.filter((c) => c.dossier_id === d.id).reduce((s, c) => s + Number(c.montant), 0);
            return (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid #F0F0EE", fontSize: 13 }}>
                <span>{d.nom_defunt}</span>
                <strong style={{ color: TEAL, fontVariantNumeric: "tabular-nums" }}>
                  {moneyF(total)} {d.montant_suggere != null && <span style={{ color: "#999", fontWeight: 500 }}>/ {moneyF(d.montant_suggere)} {t("fun_suggested_label")}</span>}
                </strong>
              </div>
            );
          })}
        </Card>
      )}

      {/* ---------- Organisme tiers : statut de l'adhérent (inscription, bénéficiaires, réserve, probation) ---------- */}
      {showOrganismeTiers && profile.member_id && (
        <Card style={{ marginBottom: 20, maxWidth: 560 }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>{t("fun_my_status_title")}</h3>
          {!mine ? (
            <>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>{t("fun_not_enrolled_msg")}</p>
              <Btn onClick={joinProgram} disabled={!montantInscriptionCfg}><Plus size={14} /> {t("fun_join_btn")}</Btn>
              {!montantInscriptionCfg && <p style={{ fontSize: 11.5, color: "#B8860B", marginTop: 8 }}>{t("fun_montant_inscription_missing")}</p>}
              {!!periodeProbationJours && <p style={{ fontSize: 11.5, color: "#999", marginTop: 8 }}>{t("fun_inscription_probation_note").replace("{n}", String(periodeProbationJours))}</p>}
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: TEAL_LIGHT, color: TEAL, fontWeight: 600 }}>
                  {mine.inscription_payee ? t("fun_inscription_paid") : t("fun_inscription_unpaid")}
                </span>
                <span style={{ fontSize: 12, color: "#888" }}>{t("fun_enrolled_since")} {mine.date_inscription}</span>
              </div>

              <div style={{ padding: "12px 14px", borderRadius: 10, background: "#FAFAF8", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Wallet size={15} color={TEAL} />
                  <strong style={{ fontSize: 13 }}>{t("fun_my_reserve_title")}</strong>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: mine.suspendu ? RED : (memberReserveBalance(profile.member_id) <= seuilAlerte ? "#B8860B" : TEAL) }}>
                  {moneyF(memberReserveBalance(profile.member_id))}
                </div>
                {mine.suspendu ? (
                  <p style={{ fontSize: 12, color: RED, display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}><AlertTriangle size={13} /> {t("fun_my_reserve_suspended_banner")}</p>
                ) : memberReserveBalance(profile.member_id) <= seuilAlerte ? (
                  <p style={{ fontSize: 12, color: "#B8860B", display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}><AlertTriangle size={13} /> {t("fun_my_reserve_alert_banner")}</p>
                ) : null}
                {!isProbationDone(mine) && (
                  <p style={{ fontSize: 12, color: "#999", marginTop: 6 }}>{t("fun_my_probation_banner").replace("{date}", probationDeadlineLabel(mine))}</p>
                )}
                <div style={{ marginTop: 8 }}>
                  <Btn variant="outline" onClick={() => setLedgerModalMemberId(profile.member_id)}><History size={13} /> {t("fun_detail_btn")}</Btn>
                </div>
              </div>

              <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("fun_beneficiaries_title")}</h4>
              {myBeneficiaires().length === 0 && <p style={{ fontSize: 12.5, color: "#999", fontStyle: "italic" }}>{t("fun_no_beneficiaries")}</p>}
              {myBeneficiaires().map((b) => (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "6px 0", borderBottom: "1px solid #F0F0EE" }}>
                  <span>{b.nom} <span style={{ color: "#999" }}>({b.lien_parente})</span></span>
                  <button onClick={() => deleteBeneficiaire(b.id)} title={t("fun_delete_btn")} style={{ background: "none", border: "none", color: RED, cursor: "pointer", display: "flex" }}><X size={14} /></button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <input style={{ ...inputStyle, width: 140 }} placeholder={t("fun_beneficiary_name_field")} value={newBenef.nom} onChange={(e) => setNewBenef({ ...newBenef, nom: e.target.value })} />
                <input style={{ ...inputStyle, width: 120 }} placeholder={t("fun_beneficiary_relation_field")} value={newBenef.lien_parente} onChange={(e) => setNewBenef({ ...newBenef, lien_parente: e.target.value })} />
                <input type="date" style={{ ...inputStyle, width: 140 }} value={newBenef.date_naissance} onChange={(e) => setNewBenef({ ...newBenef, date_naissance: e.target.value })} />
                <Btn variant="outline" onClick={addBeneficiaire}><Plus size={13} /> {t("fun_add_beneficiary_btn")}</Btn>
              </div>
            </>
          )}
        </Card>
      )}

      {/* ---------- Organisme tiers : annonces (visibles aux inscrits actifs uniquement, via RLS) ---------- */}
      {showOrganismeTiers && (activeAnnonces.length > 0 || isBureau) && (
        <Card style={{ marginBottom: 20, maxWidth: 640 }}>
          <h3 style={{ fontSize: 14, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}><Megaphone size={16} /> {t("fun_annonces_title")}</h3>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("fun_annonces_intro")}</p>
          {isBureau && (
            <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #F0F0EE" }}>
              <input style={{ ...inputStyle, marginBottom: 6 }} placeholder={t("fun_annonce_title_field")} value={annonceDraft.titre} onChange={(e) => setAnnonceDraft({ ...annonceDraft, titre: e.target.value })} />
              <textarea style={{ ...inputStyle, minHeight: 60, marginBottom: 6 }} placeholder={t("fun_annonce_content_field")} value={annonceDraft.contenu} onChange={(e) => setAnnonceDraft({ ...annonceDraft, contenu: e.target.value })} />
              <Btn variant="outline" onClick={addAnnonce} disabled={!annonceDraft.titre.trim() || !annonceDraft.contenu.trim()}><Plus size={13} /> {t("fun_add_annonce_btn")}</Btn>
            </div>
          )}
          {activeAnnonces.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "#999", fontStyle: "italic" }}>{t("fun_annonces_no_data")}</p>
          ) : (
            activeAnnonces.map((a) => (
              <div key={a.id} style={{ padding: "10px 0", borderBottom: "1px solid #F5F5F3" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <strong style={{ fontSize: 13, overflowWrap: "anywhere", wordBreak: "break-word" }}>{a.titre}</strong>
                  <span style={{ fontSize: 11, color: "#999" }}>{(a.created_at || "").slice(0, 10)}</span>
                </div>
                <p style={{ fontSize: 13, color: "#444", marginTop: 4, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>{a.contenu}</p>
                {a.auteur_nom && <p style={{ fontSize: 11, color: "#999", marginTop: 4 }}>— {a.auteur_nom}</p>}
                {isBureau && <button onClick={() => archiveAnnonce(a.id)} style={{ fontSize: 11, color: "#888", background: "none", border: "1px solid #DDD", borderRadius: 999, padding: "3px 8px", cursor: "pointer", marginTop: 6 }}>{t("fun_archive_annonce_btn")}</button>}
              </div>
            ))
          )}
        </Card>
      )}

      {isBureau && (
        <>
          {/* ---------- Organisme tiers : adhérents inscrits ---------- */}
          {showOrganismeTiers && (
            <Card style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
                <h3 style={{ fontSize: 14, margin: 0 }}>{showDeletedInscriptions ? t("fun_archived_title") : t("fun_bureau_members_title")}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "#999" }}>{t("fun_config_hint")}</span>
                  <Btn variant="outline" onClick={() => setShowDeletedInscriptions(!showDeletedInscriptions)}>
                    {showDeletedInscriptions ? t("fun_view_active_btn") : t("fun_view_archives_btn")}
                  </Btn>
                </div>
              </div>
              {!showDeletedInscriptions && (
                <>
                  <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                    <select style={{ ...inputStyle, width: 220 }} value={enrollMemberId} onChange={(e) => setEnrollMemberId(e.target.value)}>
                      <option value="">{t("fun_select_member_placeholder")}</option>
                      {activeMembers.filter((m) => !inscriptions.some((i) => i.member_id === m.id && i.statut === "actif")).map((m) => (
                        <option key={m.id} value={m.id}>{m.nom}</option>
                      ))}
                    </select>
                    <Btn onClick={enrollMember} disabled={!montantInscriptionCfg}><UserPlus size={14} /> {t("fun_enroll_member_btn")}</Btn>
                  </div>
                  {!montantInscriptionCfg && <p style={{ fontSize: 11.5, color: "#B8860B", marginBottom: 10 }}>{t("fun_montant_inscription_missing")}</p>}
                </>
              )}
              {!showDeletedInscriptions ? (
                <Table head={[t("fun_col_member"), t("fun_col_since"), t("fun_col_amount"), t("fun_col_status"), t("fun_col_actions")]}>
                  {inscriptions.filter((i) => i.statut !== "supprime").map((i) => (
                    <tr key={i.id}>
                      <td style={td}>{nameOf(i.member_id)}</td>
                      <td style={td}>{i.date_inscription}</td>
                      <td style={td}>{i.montant_inscription ? moneyF(i.montant_inscription) : "—"}</td>
                      <td style={td}>
                        {i.statut === "actif" ? (i.inscription_payee ? t("fun_inscription_paid") : t("fun_inscription_unpaid")) : i.statut === "transfere" ? `${t("fun_status_transferred")} → ${i.transfert_association_nom || "—"}` : t("fun_status_withdrawn")}
                        {i.statut === "actif" && i.suspendu && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: RED }}>· {t("fun_badge_suspended")}</span>}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {i.statut === "actif" && (
                            <>
                              {!i.inscription_payee && <Btn variant="outline" onClick={() => markInscriptionPaid(i.id)}>{t("fun_mark_paid_btn")}</Btn>}
                              <button onClick={() => withdrawInscription(i.id)} style={{ fontSize: 11, color: "#888", background: "none", border: "1px solid #DDD", borderRadius: 999, padding: "3px 8px", cursor: "pointer" }}>{t("fun_withdraw_btn")}</button>
                              <button onClick={() => transferInscription(i.id)} style={{ fontSize: 11, color: "#888", background: "none", border: "1px solid #DDD", borderRadius: 999, padding: "3px 8px", cursor: "pointer" }}>{t("fun_transfer_btn")}</button>
                            </>
                          )}
                          <select value={deleteMotifs[i.id] || ""} onChange={(e) => setDeleteMotifs((p) => ({ ...p, [i.id]: e.target.value }))} style={{ ...inputStyle, fontSize: 11, padding: "4px 6px", width: 150, border: deleteMotifs[i.id] ? inputStyle.border : "1.5px solid " + RED }}>
                            <option value="">{t("fun_motif_placeholder")}</option>
                            <option value="test">{t("fun_motif_test")}</option>
                            <option value="erreur_saisie">{t("fun_motif_erreur_saisie")}</option>
                            <option value="doublon">{t("fun_motif_doublon")}</option>
                            <option value="demande_adherent">{t("fun_motif_demande_adherent")}</option>
                            <option value="autre">{t("fun_motif_other")}</option>
                          </select>
                          <button
                            disabled={!deleteMotifs[i.id]}
                            onClick={() => archiveInscription(i.id, deleteMotifs[i.id])}
                            title={deleteMotifs[i.id] ? t("fun_delete_inscription_btn") : t("fun_motif_required")}
                            style={{ background: "none", border: "1px solid #DDD", borderRadius: 6, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: deleteMotifs[i.id] ? "pointer" : "not-allowed", color: RED, opacity: deleteMotifs[i.id] ? 1 : 0.35, flexShrink: 0 }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {inscriptions.filter((i) => i.statut !== "supprime").length === 0 && <tr><td colSpan={5} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("fun_no_inscriptions")}</td></tr>}
                </Table>
              ) : (
                <Table head={[t("fun_col_member"), t("fun_col_since"), t("fun_col_amount"), t("fun_col_deletion_reason"), t("fun_col_deletion_date"), t("fun_col_actions")]}>
                  {inscriptions.filter((i) => i.statut === "supprime").map((i) => (
                    <tr key={i.id}>
                      <td style={td}>{nameOf(i.member_id)}</td>
                      <td style={td}>{i.date_inscription}</td>
                      <td style={td}>{i.montant_inscription ? moneyF(i.montant_inscription) : "—"}</td>
                      <td style={td}>{t(FUN_MOTIF_KEY_MAP[i.motif_suppression] || "fun_motif_other")}</td>
                      <td style={td}>{i.date_suppression || "—"}</td>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <Btn onClick={() => restoreInscription(i.id)} style={{ background: TEAL }}>{t("fun_restore_btn")}</Btn>
                          <button
                            onClick={() => permanentlyDeleteInscription(i.id)}
                            title={t("fun_delete_permanent_btn")}
                            style={{ fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "5px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                          >
                            <Trash2 size={12} /> {t("fun_delete_permanent_btn")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {inscriptions.filter((i) => i.statut === "supprime").length === 0 && <tr><td colSpan={6} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("fun_no_deleted_inscriptions")}</td></tr>}
                </Table>
              )}
            </Card>
          )}

          {/* ---------- Organisme tiers : vue d'ensemble + tableau de gestion de la réserve individuelle ---------- */}
          {showOrganismeTiers && (
            <Card style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("fun_reserve_indiv_overview_title")}</h3>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#999" }}>{t("fun_reserve_indiv_overview_total")}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: TEAL, fontVariantNumeric: "tabular-nums" }}>{moneyF(totalReserveIndiv)}</div>
                </div>
                {countAlert > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: "#999" }}>{t("fun_reserve_indiv_overview_alert_count")}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "#B8860B" }}>{countAlert}</div>
                  </div>
                )}
                {countSuspended > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: "#999" }}>{t("fun_reserve_indiv_overview_suspended_count")}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: RED }}>{countSuspended}</div>
                  </div>
                )}
              </div>

              <h4 style={{ fontSize: 13, marginBottom: 10 }}>{t("fun_management_table_title")}</h4>
              <Table head={[t("fun_col_member"), t("fun_col_inscription_status"), t("fun_col_probation_status"), t("fun_col_balance"), t("fun_col_actions")]}>
                {inscritsActifs.map((i) => {
                  const badge = balanceBadge(i);
                  const probationDone = isProbationDone(i);
                  return (
                    <tr key={i.id}>
                      <td style={td}>{nameOf(i.member_id)}</td>
                      <td style={td}>{i.inscription_payee ? t("fun_inscription_paid") : t("fun_inscription_unpaid")}</td>
                      <td style={td}>
                        {!periodeProbationJours ? t("fun_probation_none") : probationDone ? t("fun_probation_done") : t("fun_probation_pending").replace("{date}", probationDeadlineLabel(i))}
                      </td>
                      <td style={td}>
                        <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{moneyF(memberReserveBalance(i.member_id))}</span>
                        {badge && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: badge.color }}>{badge.label}</span>}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <input type="number" min="0" step="0.01" style={{ ...inputStyle, width: 90, fontSize: 12, padding: "4px 6px" }} placeholder={t("fun_deposit_amount_placeholder")} value={depositDraft(i.member_id)} onChange={(e) => setDepositDraft(i.member_id, e.target.value)} />
                          <Btn variant="outline" onClick={() => recordDeposit(i.member_id)} disabled={depositSaving[i.member_id] || !depositDraft(i.member_id)}>
                            {depositSaving[i.member_id] ? <Loader2 size={12} className="spin" /> : <Plus size={12} />} {t("fun_deposit_btn")}
                          </Btn>
                          <button onClick={() => setLedgerModalMemberId(i.member_id)} title={t("fun_detail_btn")} style={{ background: "none", border: "1px solid #DDD", borderRadius: 6, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#666" }}>
                            <History size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {inscritsActifs.length === 0 && <tr><td colSpan={5} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("fun_no_inscriptions")}</td></tr>}
              </Table>
            </Card>
          )}

          {/* ---------- Déclaration et liste des dossiers — partagées, hors sous-onglets ---------- */}
          <Card style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>{t("fun_declare_death_title")}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
              <Field label={t("fun_deceased_member_field")}>
                <select style={inputStyle} value={newDossier.memberId} onChange={(e) => setNewDossier({ ...newDossier, memberId: e.target.value, beneficiaireId: "" })}>
                  <option value="">{t("fun_select_member_placeholder")}</option>
                  {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                </select>
              </Field>
              <Field label={t("fun_deceased_field")}>
                <select style={inputStyle} value={newDossier.beneficiaireId} onChange={(e) => setNewDossier({ ...newDossier, beneficiaireId: e.target.value })} disabled={!newDossier.memberId}>
                  <option value="">{t("fun_deceased_self_option")}</option>
                  {beneficiaires.filter((b) => b.member_id === newDossier.memberId).map((b) => (
                    <option key={b.id} value={b.id}>{b.nom} ({b.lien_parente})</option>
                  ))}
                </select>
              </Field>
              <Field label={t("fun_death_date_field")}>
                <input type="date" style={inputStyle} value={newDossier.dateDeces} onChange={(e) => setNewDossier({ ...newDossier, dateDeces: e.target.value })} />
              </Field>
              {mainLeveeActif && (
                <Field label={t("fun_montant_suggere_field")}>
                  <input type="number" min="0" step="0.01" style={inputStyle} value={newDossier.montantSuggere} onChange={(e) => setNewDossier({ ...newDossier, montantSuggere: e.target.value })} placeholder={t("fun_montant_suggere_placeholder")} />
                </Field>
              )}
              {organismeTiersActif && (
                <Field label={t("fun_cle_repartition_field")}>
                  <input type="number" min="0" step="0.01" style={inputStyle} value={newDossier.montantCle} onChange={(e) => setNewDossier({ ...newDossier, montantCle: e.target.value })} placeholder={t("fun_cle_repartition_placeholder")} />
                </Field>
              )}
            </div>
            {mainLeveeActif && <p style={{ fontSize: 11.5, color: "#999", marginTop: -8, marginBottom: 8 }}>{t("fun_montant_suggere_help")}</p>}
            {organismeTiersActif && <p style={{ fontSize: 11.5, color: "#999", marginTop: -4, marginBottom: 12 }}>{t("fun_cle_repartition_help")}</p>}
            <Field label={t("fun_death_description_field")}>
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={newDossier.description} onChange={(e) => setNewDossier({ ...newDossier, description: e.target.value })} />
            </Field>
            <Btn onClick={declareDeath} disabled={organismeTiersActif && !newDossier.montantCle}><Plus size={14} /> {t("fun_create_dossier_btn")}</Btn>
            {organismeTiersActif && !newDossier.montantCle && <p style={{ fontSize: 11.5, color: "#B8860B", marginTop: 8 }}>{t("fun_cle_repartition_required")}</p>}
          </Card>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>{showDeletedDossiers ? t("fun_dossiers_archived_title") : t("fun_dossiers_title")}</h3>
              <Btn variant="outline" onClick={() => setShowDeletedDossiers(!showDeletedDossiers)}>
                {showDeletedDossiers ? t("fun_view_active_btn") : t("fun_view_archives_btn")}
              </Btn>
            </div>
            {!showDeletedDossiers && (
              <Table head={[t("fun_col_deceased"), t("fun_col_date"), t("fun_col_dossier_amounts"), t("fun_col_status"), t("fun_col_dossier_actions")]}>
                {dossiers.filter((d) => d.statut !== "supprime").map((d) => (
                  <tr key={d.id}>
                    {editingDossierId === d.id ? (
                      <>
                        <td style={td}><input style={{ ...inputStyle, width: 140 }} value={dossierEditDraft.nom_defunt} onChange={(e) => setDossierEditDraft({ ...dossierEditDraft, nom_defunt: e.target.value })} /></td>
                        <td style={td}><input type="date" style={{ ...inputStyle, width: 140 }} value={dossierEditDraft.date_deces} onChange={(e) => setDossierEditDraft({ ...dossierEditDraft, date_deces: e.target.value })} /></td>
                        <td style={td}>{d.montant_suggere != null && <div>{t("fun_amount_suggere_prefix")} {moneyF(d.montant_suggere)}</div>}{d.montant_cle_repartition != null && <div>{t("fun_amount_cle_prefix")} {moneyF(d.montant_cle_repartition)}</div>}</td>
                        <td style={td}>{d.statut === "cloture" ? t("fun_dossier_status_closed") : t("fun_dossier_status_open")}</td>
                        <td style={td}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <Btn onClick={() => saveDossierEdit(d.id)}>{t("action_save")}</Btn>
                            <Btn variant="outline" onClick={cancelEditDossier}>{t("action_cancel")}</Btn>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={td}>{d.nom_defunt}</td>
                        <td style={td}>{d.date_deces}</td>
                        <td style={td}>
                          {d.montant_suggere != null && <div style={{ fontSize: 12 }}>{t("fun_amount_suggere_prefix")} {moneyF(d.montant_suggere)}</div>}
                          {d.montant_cle_repartition != null && <div style={{ fontSize: 12 }}>{t("fun_amount_cle_prefix")} {moneyF(d.montant_cle_repartition)}</div>}
                          {d.montant_suggere == null && d.montant_cle_repartition == null && "—"}
                        </td>
                        <td style={td}>{d.statut === "cloture" ? t("fun_dossier_status_closed") : t("fun_dossier_status_open")}</td>
                        <td style={td}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            {d.statut === "ouvert" && <Btn variant="outline" onClick={() => closeDossier(d.id)}>{t("fun_close_dossier_btn")}</Btn>}
                            <button onClick={() => setReportDossierId(d.id)} title={t("fun_report_btn")} style={{ fontSize: 11, fontWeight: 600, color: "#666", background: "none", border: "1px solid #DDD", borderRadius: 999, padding: "5px 9px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <Printer size={12} /> {t("fun_report_btn")}
                            </button>
                            <button onClick={() => setVersementDossierId(d.id)} title={t("fun_versement_famille_btn")} style={{ fontSize: 11, fontWeight: 600, color: d.versement_methode ? TEAL : "#888", background: "none", border: `1px solid ${d.versement_methode ? TEAL : "#DDD"}`, borderRadius: 999, padding: "5px 9px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <CreditCard size={12} /> {d.versement_methode ? t("fun_versement_done_badge") : t("fun_versement_famille_btn")}
                            </button>
                            <Btn variant="outline" onClick={() => startEditDossier(d)}>{t("action_edit")}</Btn>
                            <select style={{ ...inputStyle, width: 130 }} value={dossierDeleteMotifs[d.id] || ""} onChange={(e) => setDossierDeleteMotifs((p) => ({ ...p, [d.id]: e.target.value }))}>
                              <option value="">{t("fun_motif_placeholder")}</option>
                              {Object.keys(FUN_DOSSIER_MOTIF_KEY_MAP).map((k) => <option key={k} value={k}>{t(FUN_DOSSIER_MOTIF_KEY_MAP[k])}</option>)}
                            </select>
                            <button
                              onClick={() => archiveDossier(d.id, dossierDeleteMotifs[d.id])}
                              disabled={!dossierDeleteMotifs[d.id]}
                              title={dossierDeleteMotifs[d.id] ? t("fun_delete_inscription_btn") : t("fun_motif_required")}
                              style={{ background: "none", border: "none", color: dossierDeleteMotifs[d.id] ? RED : "#ccc", cursor: dossierDeleteMotifs[d.id] ? "pointer" : "not-allowed", display: "flex" }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {dossiers.filter((d) => d.statut !== "supprime").length === 0 && <tr><td colSpan={5} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("fun_no_dossiers")}</td></tr>}
              </Table>
            )}
            {showDeletedDossiers && (
              <Table head={[t("fun_col_deceased"), t("fun_col_date"), t("fun_col_dossier_amounts"), t("fun_col_deletion_reason"), t("fun_col_deletion_date"), t("fun_col_actions")]}>
                {dossiers.filter((d) => d.statut === "supprime").map((d) => (
                  <tr key={d.id}>
                    <td style={td}>{d.nom_defunt}</td>
                    <td style={td}>{d.date_deces}</td>
                    <td style={td}>
                      {d.montant_suggere != null && <div style={{ fontSize: 12 }}>{t("fun_amount_suggere_prefix")} {moneyF(d.montant_suggere)}</div>}
                      {d.montant_cle_repartition != null && <div style={{ fontSize: 12 }}>{t("fun_amount_cle_prefix")} {moneyF(d.montant_cle_repartition)}</div>}
                    </td>
                    <td style={td}>{t(FUN_DOSSIER_MOTIF_KEY_MAP[d.motif_suppression] || "fun_motif_other")}</td>
                    <td style={td}>{d.date_suppression}</td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Btn variant="outline" onClick={() => restoreDossier(d.id)}>{t("fun_restore_btn")}</Btn>
                        <button onClick={() => permanentlyDeleteDossier(d.id)} title={t("fun_delete_permanent_btn")} style={{ background: "none", border: "none", color: RED, cursor: "pointer", display: "flex" }}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {dossiers.filter((d) => d.statut === "supprime").length === 0 && <tr><td colSpan={6} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("fun_no_deleted_dossiers")}</td></tr>}
              </Table>
            )}
          </Card>

          {/* ---------- Main levée : détail des collectes par dossier ---------- */}
          {showMainLevee && dossiers.filter((d) => d.statut !== "supprime").length > 0 && (
            <Card style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}><HandCoins size={16} /> {t("fun_collecte_title")}</h3>
              <p style={{ fontSize: 12, color: "#888", marginBottom: 16, maxWidth: 620 }}>{t("fun_collecte_intro")}</p>
              {dossiers.filter((d) => d.statut !== "supprime").map((d) => {
                const contribs = contributions.filter((c) => c.dossier_id === d.id);
                const total = contribs.reduce((s, c) => s + Number(c.montant), 0);
                const draft = contribDraft(d.id);
                const pct = d.montant_suggere ? Math.min(100, Math.round((total / d.montant_suggere) * 100)) : null;
                return (
                  <div key={d.id} style={{ borderTop: "1px solid #F0F0EE", paddingTop: 14, marginTop: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                      <strong style={{ fontSize: 13.5 }}>{d.nom_defunt}</strong>
                      <span style={{ fontSize: 13, fontWeight: 700, color: TEAL, fontVariantNumeric: "tabular-nums" }}>
                        {moneyF(total)} {d.montant_suggere != null && <span style={{ color: "#999", fontWeight: 500 }}>/ {moneyF(d.montant_suggere)} {t("fun_suggested_label")}</span>}
                      </span>
                    </div>
                    {pct != null && (
                      <div style={{ height: 6, borderRadius: 999, background: "#EEE", marginBottom: 10, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: TEAL, borderRadius: 999 }} />
                      </div>
                    )}
                    {contribs.length === 0 ? (
                      <p style={{ fontSize: 12, color: "#999", fontStyle: "italic", marginBottom: 10 }}>{t("fun_no_contributions")}</p>
                    ) : (
                      <div style={{ marginBottom: 10 }}>
                        {contribs.map((c) => (
                          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "4px 0", borderBottom: "1px solid #F5F5F3" }}>
                            <span>{nameOf(c.member_id)} <span style={{ color: "#999" }}>· {t("tont_versement_method_" + c.methode)} · {c.date_contribution}</span></span>
                            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <strong>{moneyF(c.montant)}</strong>
                              <button onClick={() => deleteContribution(c.id)} title={t("fun_delete_btn")} style={{ background: "none", border: "none", color: RED, cursor: "pointer", display: "flex" }}><X size={13} /></button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <select style={{ ...inputStyle, width: 170 }} value={draft.memberId} onChange={(e) => setContribDraft(d.id, { memberId: e.target.value })}>
                        <option value="">{t("fun_select_member_placeholder")}</option>
                        {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                      </select>
                      <input type="number" min="0" step="0.01" style={{ ...inputStyle, width: 100 }} placeholder={t("fun_contribution_amount_placeholder")} value={draft.montant} onChange={(e) => setContribDraft(d.id, { montant: e.target.value })} />
                      <select style={{ ...inputStyle, width: 110 }} value={draft.methode} onChange={(e) => setContribDraft(d.id, { methode: e.target.value })}>
                        <option value="manuel">{t("tont_versement_method_manuel")}</option>
                        <option value="interac">{t("tont_versement_method_interac")}</option>
                        <option value="stripe">{t("tont_versement_method_stripe")}</option>
                      </select>
                      <input style={{ ...inputStyle, width: 120 }} placeholder={t("tont_versement_reference_placeholder")} value={draft.reference} onChange={(e) => setContribDraft(d.id, { reference: e.target.value })} />
                      <input type="file" style={{ fontSize: 11, width: 130 }} onChange={(e) => setContribDraft(d.id, { file: e.target.files?.[0] || null })} />
                      <Btn variant="outline" onClick={() => addContribution(d.id)} disabled={!draft.memberId || !draft.montant || contribUploading[d.id]}>
                        {contribUploading[d.id] ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} {t("fun_add_contribution_btn")}
                      </Btn>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}

          {isPresident && (
            <Card style={{ marginTop: 20, border: "1px solid #F3D0D0", background: "#FFF8F8" }}>
              <h3 style={{ fontSize: 14, marginBottom: 6, color: RED, display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={15} /> {t("fun_reset_title")}</h3>
              <p style={{ fontSize: 12.5, color: "#666", marginBottom: 12, maxWidth: 560 }}>{t("fun_reset_intro")}</p>
              <Btn variant="outline" onClick={resetFuneraireModule} disabled={resetting} style={{ color: RED, borderColor: RED }}>
                {resetting ? t("loading") : t("fun_reset_btn")}
              </Btn>
            </Card>
          )}
        </>
      )}

      {versementDossierId && (
        <FuneraireVersementModal
          dossier={dossiers.find((d) => d.id === versementDossierId)}
          montantDefaut={(() => {
            const d = dossiers.find((x) => x.id === versementDossierId);
            if (!d) return "";
            const contribTotal = contributions.filter((c) => c.dossier_id === d.id).reduce((s, c) => s + Number(c.montant), 0);
            if (contribTotal > 0) return String(contribTotal);
            if (d.montant_cle_repartition != null) return String(d.montant_cle_repartition);
            if (d.montant_suggere != null) return String(d.montant_suggere);
            return "";
          })()}
          t={t}
          onClose={() => setVersementDossierId(null)}
          onSave={(payload) => saveVersementFamille(versementDossierId, payload)}
          onUploadPreuve={(file) => uploadVersementPreuve(versementDossierId, file)}
        />
      )}

      {ledgerModalMemberId && (
        <FuneraireIndivLedgerModal
          memberId={ledgerModalMemberId}
          memberName={nameOf(ledgerModalMemberId)}
          inscription={inscriptions.find((i) => i.member_id === ledgerModalMemberId && i.statut === "actif")}
          mvts={reserveIndivMvts.filter((mv) => mv.member_id === ledgerModalMemberId)}
          balance={memberReserveBalance(ledgerModalMemberId)}
          association={association}
          t={t}
          lang={lang}
          onClose={() => setLedgerModalMemberId(null)}
        />
      )}

      {reportDossierId && (
        <FuneraireDossierReportModal
          dossier={dossiers.find((d) => d.id === reportDossierId)}
          contributions={contributions.filter((c) => c.dossier_id === reportDossierId)}
          cleMvts={reserveIndivMvts.filter((mv) => mv.dossier_id === reportDossierId)}
          nameOf={nameOf}
          moneyF={moneyF}
          association={association}
          t={t}
          lang={lang}
          onClose={() => setReportDossierId(null)}
        />
      )}
    </Section></Container>
  );
}

// =====================================================================
// Confirmer le versement des fonds (récoltés par la main levée, et/ou
// décaissés de la réserve individuelle via la clé de répartition) au
// foyer endeuillé — même modèle que la confirmation de versement de la
// cagnotte Cotisation/Collation (App.jsx, VersementModal, suite 56).
// =====================================================================
function FuneraireVersementModal({ dossier, montantDefaut, t, onClose, onSave, onUploadPreuve }) {
  const [methode, setMethode] = useState(dossier?.versement_methode || "interac");
  const [montant, setMontant] = useState(String(dossier?.versement_montant ?? montantDefaut ?? ""));
  const [date, setDate] = useState(dossier?.versement_date || todayISO());
  const [reference, setReference] = useState(dossier?.versement_reference || "");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  if (!dossier) return null;

  async function handleSave() {
    if (!montant) return;
    let preuvePath = dossier.versement_preuve_path || null;
    if (file) {
      setUploading(true);
      const path = await onUploadPreuve(file);
      setUploading(false);
      if (path) preuvePath = path;
    }
    onSave({ methode, montant: Number(montant), date, reference, preuvePath });
  }

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 420, width: "92%", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("fun_versement_famille_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--primary)", fontWeight: 600, marginBottom: 10 }}>{dossier.nom_defunt}</p>
        <p style={{ fontSize: 11, color: "#999", marginTop: -4, marginBottom: 16 }}>{t("fun_versement_famille_help")}</p>
        <Field label={t("tont_versement_method_label")}>
          <select style={inputStyle} value={methode} onChange={(e) => setMethode(e.target.value)}>
            <option value="interac">{t("tont_versement_method_interac")}</option>
            <option value="stripe">{t("tont_versement_method_stripe")}</option>
            <option value="manuel">{t("tont_versement_method_manuel")}</option>
          </select>
        </Field>
        <Field label={t("tont_versement_amount_label")}><input type="number" step="0.01" style={inputStyle} value={montant} onChange={(e) => setMontant(e.target.value)} /></Field>
        <Field label={t("tont_versement_date_label")}><input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t("tont_versement_reference_label")}><input style={inputStyle} placeholder={t("tont_versement_reference_placeholder")} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label={t("tont_versement_proof_label")}>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} style={inputStyle} />
        </Field>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <Btn onClick={handleSave} disabled={uploading || !montant}>{uploading && <Loader2 size={14} className="spin" />} {t("tont_versement_save_btn")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// FuneraireIndivLedgerModal — état individuel de réserve d'un adhérent :
// détail chronologique de ses mouvements (dépôts / applications de clé),
// solde actuel, statut de probation. Sert à la fois de vue « détail » du
// tableau de gestion (point B de la refonte n°2) et de document
// imprimable/transférable aux ayants droit (point C) — même patron que
// DonReceiptModal (FinancesElargies.jsx) : portail plein écran dont seul
// le contenu est visible à l'impression.
// =====================================================================
function FuneraireIndivLedgerModal({ memberId, memberName, inscription, mvts, balance, association, t, lang, onClose }) {
  const moneyF = (n) => money(n, association?.devise_monetaire);
  const todayFormatted = new Date().toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA");
  const sorted = [...mvts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  function handlePrint() { window.print(); }
  return createPortal(
    <div className="fun-print-root" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }} onClick={onClose}>
      <style>{`
        @media print {
          body > *:not(.fun-print-root) { display: none !important; }
          .fun-print-root { position: static !important; background: white !important; padding: 0 !important; display: block !important; }
          .fun-no-print { display: none !important; }
          .fun-card { box-shadow: none !important; max-height: none !important; overflow: visible !important; width: 100% !important; max-width: 100% !important; }
        }
      `}</style>
      <div className="fun-card" style={{ background: "white", borderRadius: 12, padding: 28, maxWidth: 560, width: "94%", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="fun-no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("fun_indiv_ledger_modal_title").replace("{nom}", memberName)}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <h3 style={{ marginBottom: 2 }}>{association?.nom}</h3>
        <h4 style={{ marginBottom: 16, fontWeight: 600 }}>{t("fun_indiv_ledger_modal_title").replace("{nom}", memberName)}</h4>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderRadius: 10, background: "#FAFAF8", marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t("fun_indiv_ledger_balance_label")}</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: TEAL, fontVariantNumeric: "tabular-nums" }}>{moneyF(balance)}</span>
        </div>

        {inscription && (
          <div style={{ fontSize: 12.5, color: "#666", marginBottom: 16 }}>
            <div>{inscription.inscription_payee ? t("fun_inscription_paid") : t("fun_inscription_unpaid")}{inscription.suspendu && <span style={{ color: RED, fontWeight: 700 }}> · {t("fun_badge_suspended")}</span>}</div>
          </div>
        )}

        {sorted.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "#999", fontStyle: "italic" }}>{t("fun_indiv_ledger_no_mvts")}</p>
        ) : (
          <Table head={[t("fun_indiv_ledger_col_date"), t("fun_indiv_ledger_col_type"), t("fun_indiv_ledger_col_amount"), t("fun_indiv_ledger_col_dossier")]}>
            {sorted.map((mv) => (
              <tr key={mv.id}>
                <td style={td}>{(mv.date_mouvement || mv.created_at || "").slice(0, 10)}</td>
                <td style={td}>{mv.type === "depot" ? t("fun_indiv_ledger_type_depot") : t("fun_indiv_ledger_type_application")}</td>
                <td style={{ ...td, fontWeight: 700, color: Number(mv.montant) >= 0 ? TEAL : RED }}>{Number(mv.montant) >= 0 ? "+" : ""}{moneyF(mv.montant)}</td>
                <td style={td}>{mv.description || "—"}</td>
              </tr>
            ))}
          </Table>
        )}

        <div style={{ fontSize: 12, color: "#5B6270", marginTop: 20 }}>{t("fun_report_issued_on")} : <b>{todayFormatted}</b></div>

        <div className="fun-no-print" style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <Btn onClick={handlePrint}><Printer size={14} /> {t("fin_print_btn")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_close")}</Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}

// =====================================================================
// FuneraireDossierReportModal — rapport complet d'un dossier de décès :
// contributions de la collecte de solidarité (Main levée), applications
// de la clé de répartition (Organisme tiers) et versement au foyer
// endeuillé. Imprimable/transférable aux ayants droit (point C de la
// refonte n°2) — même patron que FuneraireIndivLedgerModal ci-dessus.
// =====================================================================
function FuneraireDossierReportModal({ dossier, contributions, cleMvts, nameOf, moneyF, association, t, lang, onClose }) {
  const todayFormatted = new Date().toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA");
  if (!dossier) return null;
  const totalContributions = contributions.reduce((s, c) => s + Number(c.montant), 0);
  const totalCle = cleMvts.reduce((s, mv) => s + Math.abs(Number(mv.montant)), 0);
  function handlePrint() { window.print(); }
  return createPortal(
    <div className="fun-print-root" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }} onClick={onClose}>
      <style>{`
        @media print {
          body > *:not(.fun-print-root) { display: none !important; }
          .fun-print-root { position: static !important; background: white !important; padding: 0 !important; display: block !important; }
          .fun-no-print { display: none !important; }
          .fun-card { box-shadow: none !important; max-height: none !important; overflow: visible !important; width: 100% !important; max-width: 100% !important; }
        }
      `}</style>
      <div className="fun-card" style={{ background: "white", borderRadius: 12, padding: 28, maxWidth: 580, width: "94%", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="fun-no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("fun_dossier_report_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <h3 style={{ marginBottom: 2 }}>{association?.nom}</h3>
        <h4 style={{ marginBottom: 4, fontWeight: 600 }}>{t("fun_dossier_report_title")}</h4>
        <p style={{ fontSize: 13, color: "#444", marginBottom: 4 }}><b>{dossier.nom_defunt}</b> — {dossier.date_deces}</p>
        {dossier.description && <p style={{ fontSize: 12.5, color: "#666", marginBottom: 16 }}>{dossier.description}</p>}

        {dossier.montant_suggere != null && (
          <div style={{ marginTop: 18 }}>
            <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("fun_report_contributions_section")}</h4>
            {contributions.length === 0 ? (
              <p style={{ fontSize: 12.5, color: "#999", fontStyle: "italic" }}>{t("fun_no_contributions")}</p>
            ) : (
              <Table head={[t("fun_col_member"), t("date"), t("fun_col_amount")]}>
                {contributions.map((c) => (
                  <tr key={c.id}><td style={td}>{nameOf(c.member_id)}</td><td style={td}>{c.date_contribution}</td><td style={td}>{moneyF(c.montant)}</td></tr>
                ))}
              </Table>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 13, fontWeight: 700, marginTop: 6 }}>{t("fun_report_total_label")} : {moneyF(totalContributions)}</div>
          </div>
        )}

        {dossier.montant_cle_repartition != null && (
          <div style={{ marginTop: 18 }}>
            <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("fun_report_cle_section")}</h4>
            <p style={{ fontSize: 12, color: "#999", marginTop: -4, marginBottom: 8 }}>{t("fun_amount_cle_prefix")} {moneyF(dossier.montant_cle_repartition)}</p>
            {cleMvts.length === 0 ? (
              <p style={{ fontSize: 12.5, color: "#999", fontStyle: "italic" }}>{t("fun_report_no_cle_applications")}</p>
            ) : (
              <Table head={[t("fun_col_member"), t("fun_col_amount")]}>
                {cleMvts.map((mv) => (
                  <tr key={mv.id}><td style={td}>{nameOf(mv.member_id)}</td><td style={td}>{moneyF(Math.abs(mv.montant))}</td></tr>
                ))}
              </Table>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 13, fontWeight: 700, marginTop: 6 }}>{t("fun_report_total_label")} : {moneyF(totalCle)}</div>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("fun_report_versement_section")}</h4>
          {dossier.versement_methode ? (
            <div style={{ fontSize: 13 }}>
              <div>{t("tont_versement_amount_label")} : <b>{moneyF(dossier.versement_montant)}</b></div>
              <div>{t("tont_versement_date_label")} : {dossier.versement_date}</div>
              {dossier.versement_reference && <div>{t("tont_versement_reference_label")} : {dossier.versement_reference}</div>}
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: "#999", fontStyle: "italic" }}>{t("fun_report_no_versement")}</p>
          )}
        </div>

        <div style={{ fontSize: 12, color: "#5B6270", marginTop: 20 }}>{t("fun_report_issued_on")} : <b>{todayFormatted}</b></div>

        <div className="fun-no-print" style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <Btn onClick={handlePrint}><Printer size={14} /> {t("fin_print_btn")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_close")}</Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}
