// =====================================================================
// Comptabilite.jsx — Système comptable professionnel
// Suite 86, 2026-09-28 (Phase A / Phase B / Phase C). Voir
// claude/comptabilite-professionnelle-proposition.md,
// sql/2026-09-28c_comptabilite_fondations.sql (+ correctif 2026-09-28d)
// et sql/2026-09-28e_comptabilite_exercices.sql (Phase B). Phase C
// n'ajoute aucune SQL — tout est dérivable des données déjà chargées.
// =====================================================================
//
// Trois vues, calculées à partir du grand livre `ecritures_comptables`
// (alimenté automatiquement par des déclencheurs SQL à chaque don, prêt,
// dépense/quote-part de fonds, inscription, cotisation, collation — le
// trésorier ne saisit jamais de débit/crédit à la main) :
//
//  1. Bilan (Phase A) — Actifs/Passifs/Actif net PAR FONDS, à une date
//     donnée. Affiché juste au-dessus du « Bilan simplifié » existant
//     pour que l'utilisateur puisse comparer les deux.
//  2. État des résultats (Phase B) — Produits/Charges/Excédent PAR FONDS,
//     sur un exercice financier choisi. L'exercice est CONFIGURABLE par
//     association (`associations.exercice_mois_debut`, réservé au
//     président) — année civile par défaut. Un exercice déjà terminé
//     (sa date de fin est passée) peut être CLÔTURÉ par le président :
//     ça gèle ses totaux dans `exercices_clotures` pour l'audit/l'AG,
//     mais ne verrouille PAS les transactions ailleurs dans l'application
//     (décision explicite de l'utilisateur — un chantier séparé si
//     demandé plus tard).
//  3. Évolution de l'actif net (Phase C) — la pièce qui retrace le
//     patrimoine dans le temps : Solde d'ouverture de l'exercice (toutes
//     les écritures antérieures à son début) + Excédent/déficit de la
//     période (Phase B) ± Virements entre fonds = Solde de clôture, par
//     fonds et au total. Partage l'exercice (dates libres, suite 87) avec
//     l'État des résultats.
//
// Suite 88 (2026-09-28) — Mise en page à l'impression. Les 3 onglets
// ci-dessus sont l'expérience INTERACTIVE (un seul visible à la fois,
// jamais destiné à l'impression tel quel). Un bloc `.print-only` séparé,
// plus bas dans ce composant, retrace les 3 états dans une mise en page
// dédiée à l'impression (un état par page, en-tête répété, tableaux
// sobres en noir et blanc) — cochable indépendamment (Bilan/Résultats/
// Évolution), avec chargement automatique des données manquantes avant
// d'imprimer. Voir claude/comptabilite-professionnelle-proposition.md.
import React, { useState, useCallback } from "react";
import { Printer, Download } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Card, Btn, Field, useLang, friendlyError, inputStyle, Table, td, Banner, todayISO, exerciceBounds } from "./shared";

// Export du grand livre (suite 2026-10-06, demande explicite de
// l'utilisateur, suite à la veille concurrentielle : « Palier 1 » de
// claude/integration-comptable-externe-proposition.md). Volontairement un
// simple export de fichier — jamais de connexion API, jamais de compte
// développeur à créer — pour couvrir QuickBooks (format d'import dédié),
// Sage et « mon comptable utilise Excel » en un seul chantier. Toujours
// à sens unique (Unia → fichier) : rien n'écrit jamais en retour dans
// Unia, donc aucun risque de double-source de vérité comptable.
function slugifyNomAssoc(s) {
  return (s || "association").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "association";
}
// Échappement CSV standard (RFC 4180) : une valeur contenant une virgule,
// un guillemet ou un retour à la ligne est entourée de guillemets, et tout
// guillemet interne est doublé.
function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(rows, filename) {
  // BOM (﻿) en tête : Excel (Windows et Mac) n'affiche correctement
  // les accents français en UTF-8 que si ce repère est présent, sinon les
  // caractères comme « é »/« è » s'affichent corrompus à l'ouverture.
  const contenu = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([contenu], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const FONDS_KEYS = ["general", "urgence", "secours"];

// Année de référence de l'exercice qui contient aujourd'hui.
function anneeRefCourante(moisDebut) {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  return m >= moisDebut ? y : y - 1;
}

export default function Comptabilite({ moneyF, association, isPresident }) {
  const { t, lang } = useLang();
  const moisDebut = association?.exercice_mois_debut || 1;
  const [vue, setVue] = useState("bilan");

  // ---------- Bilan (Phase A) ----------
  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [notInstalled, setNotInstalled] = useState(false);
  const [comptes, setComptes] = useState([]);
  const [lignes, setLignes] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const chargerBilan = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    setNotInstalled(false);
    const [{ data: comptesData, error: e1 }, { data: lignesData, error: e2 }] = await Promise.all([
      supabase.from("comptes_comptables").select("*").order("ordre"),
      supabase.from("ecritures_comptables").select("compte_code, fonds, debit, credit").lte("date", date),
    ]);
    setLoading(false);
    const err = e1 || e2;
    if (err) {
      if (err.code === "42P01" || (err.message || "").includes("does not exist")) { setNotInstalled(true); return; }
      setErrorMsg(friendlyError(err, t));
      return;
    }
    setComptes(comptesData || []);
    setLignes(lignesData || []);
    setLoaded(true);
  }, [date, t]);

  const soldeParCompte = {};
  for (const l of lignes) {
    const s = soldeParCompte[l.compte_code] || (soldeParCompte[l.compte_code] = { debit: 0, credit: 0 });
    s.debit += Number(l.debit) || 0;
    s.credit += Number(l.credit) || 0;
  }
  function soldeCompte(compte) {
    const s = soldeParCompte[compte.code];
    if (!s) return 0;
    return compte.type === "passif" ? s.credit - s.debit : s.debit - s.credit;
  }
  const comptesActif = comptes.filter((c) => c.type === "actif" && soldeCompte(c) !== 0);
  const comptesPassif = comptes.filter((c) => c.type === "passif" && soldeCompte(c) !== 0);
  const totalActif = comptesActif.reduce((s, c) => s + soldeCompte(c), 0);
  const totalPassif = comptesPassif.reduce((s, c) => s + soldeCompte(c), 0);
  const totalActifNet = totalActif - totalPassif;

  const totalDebitGlobal = lignes.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCreditGlobal = lignes.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const equilibre = Math.abs(totalDebitGlobal - totalCreditGlobal) < 0.01;

  const comptesById = Object.fromEntries(comptes.map((c) => [c.code, c]));
  // Actif net d'un fonds à partir d'un ensemble d'écritures donné — utilisé
  // pour le Bilan (toutes les écritures jusqu'à `date`) et pour le solde
  // d'ouverture de l'exercice en Phase C (toutes les écritures avant le
  // début de l'exercice).
  function calcActifNetFonds(lignesArr, fonds) {
    let actif = 0, passif = 0;
    for (const l of lignesArr) {
      if (l.fonds !== fonds) continue;
      const compte = comptesById[l.compte_code];
      if (!compte) continue;
      if (compte.type === "actif") actif += (Number(l.debit) || 0) - (Number(l.credit) || 0);
      else if (compte.type === "passif") passif += (Number(l.credit) || 0) - (Number(l.debit) || 0);
    }
    return actif - passif;
  }
  function soldeFondsBilan(fonds) {
    return calcActifNetFonds(lignes, fonds);
  }

  // ---------- État des résultats (Phase B) ----------
  // Période librement choisie (suite 87, 2026-09-28) : demande explicite de
  // l'utilisateur — « l'association doit choisir sa période librement » —
  // remplace le sélecteur d'année + mois de départ fixe de la Phase B par
  // deux dates directement modifiables. Aucun lien forcé avec la clôture :
  // le président peut clôturer QUELLE QUE SOIT la période affichée à ce
  // moment (la fonction SQL `cloturer_exercice` acceptait déjà n'importe
  // quelle date en paramètre — seule l'interface imposait une année pleine
  // calée sur `exercice_mois_debut`). La colonne `associations.exercice_
  // mois_debut` (Phase B) n'est pas retirée de la base (aucun risque à la
  // garder inutilisée) — elle sert uniquement à calculer la période
  // affichée par défaut au premier chargement, pour ne pas partir d'une
  // page vide.
  const [exerciceDebut, setExerciceDebut] = useState(() => exerciceBounds(anneeRefCourante(moisDebut), moisDebut).debut);
  const [exerciceFin, setExerciceFin] = useState(() => exerciceBounds(anneeRefCourante(moisDebut), moisDebut).fin);
  const [loadingR, setLoadingR] = useState(false);
  const [errorMsgR, setErrorMsgR] = useState("");
  const [notInstalledR, setNotInstalledR] = useState(false);
  const [lignesR, setLignesR] = useState([]);
  const [lignesOuverture, setLignesOuverture] = useState([]);
  const [loadedR, setLoadedR] = useState(false);
  const [clotureInfo, setClotureInfo] = useState(null);
  const [cloturing, setCloturing] = useState(false);

  const periodeInvalide = !exerciceDebut || !exerciceFin || exerciceFin < exerciceDebut;
  const exerciceTermine = !periodeInvalide && exerciceFin < todayISO();

  const chargerResultats = useCallback(async () => {
    if (periodeInvalide) return;
    setLoadingR(true);
    setErrorMsgR("");
    setNotInstalledR(false);
    setClotureInfo(null);
    const [{ data: comptesData, error: e1 }, { data: lignesData, error: e2 }, { data: clotureData, error: e3 }, { data: ouvertureData, error: e4 }] = await Promise.all([
      comptes.length > 0 ? Promise.resolve({ data: comptes, error: null }) : supabase.from("comptes_comptables").select("*").order("ordre"),
      supabase.from("ecritures_comptables").select("compte_code, fonds, debit, credit, source_table")
        .gte("date", exerciceDebut).lte("date", exerciceFin),
      supabase.from("exercices_clotures").select("*").eq("date_debut", exerciceDebut).maybeSingle(),
      supabase.from("ecritures_comptables").select("compte_code, fonds, debit, credit").lt("date", exerciceDebut),
    ]);
    setLoadingR(false);
    const err = e1 || e2 || e4;
    if (err) {
      if (err.code === "42P01" || (err.message || "").includes("does not exist")) { setNotInstalledR(true); return; }
      setErrorMsgR(friendlyError(err, t));
      return;
    }
    if (comptes.length === 0) setComptes(comptesData || []);
    setLignesR(lignesData || []);
    setLignesOuverture(ouvertureData || []);
    if (!e3) setClotureInfo(clotureData || null);
    setLoadedR(true);
  }, [exerciceDebut, exerciceFin, comptes, t]);

  const comptesByIdR = comptesById; // même plan comptable, déjà chargé (Bilan) ou juste chargé (résultats)
  function detailFonds(type, fonds) {
    let total = 0;
    for (const l of lignesR) {
      if (l.fonds !== fonds) continue;
      const compte = comptesByIdR[l.compte_code] || (comptes.find((c) => c.code === l.compte_code));
      if (!compte || compte.type !== type) continue;
      total += type === "produit" ? (Number(l.credit) || 0) - (Number(l.debit) || 0) : (Number(l.debit) || 0) - (Number(l.credit) || 0);
    }
    return total;
  }
  const comptesProduits = comptes.filter((c) => c.type === "produit");
  const comptesCharges = comptes.filter((c) => c.type === "charge");
  function soldeCompteExercice(compte) {
    let total = 0;
    for (const l of lignesR) {
      if (l.compte_code !== compte.code) continue;
      total += compte.type === "produit" ? (Number(l.credit) || 0) - (Number(l.debit) || 0) : (Number(l.debit) || 0) - (Number(l.credit) || 0);
    }
    return total;
  }
  const comptesProduitsAffiches = comptesProduits.filter((c) => soldeCompteExercice(c) !== 0);
  const comptesChargesAffiches = comptesCharges.filter((c) => soldeCompteExercice(c) !== 0);
  const totalProduitsEx = comptesProduitsAffiches.reduce((s, c) => s + soldeCompteExercice(c), 0);
  const totalChargesEx = comptesChargesAffiches.reduce((s, c) => s + soldeCompteExercice(c), 0);
  const excedentEx = totalProduitsEx - totalChargesEx;

  // ---------- Évolution de l'actif net (Phase C) ----------
  // Aucune SQL supplémentaire : tout se dérive des écritures déjà
  // chargées pour l'État des résultats (lignesR) et d'un fetch de plus
  // (lignesOuverture, toutes les écritures avant le début de l'exercice).
  function soldeOuvertureFonds(fonds) {
    return calcActifNetFonds(lignesOuverture, fonds);
  }
  function excedentFondsEx(fonds) {
    return detailFonds("produit", fonds) - detailFonds("charge", fonds);
  }
  // Virements entre fonds (suite 87) : deux lignes sur le compte 1000,
  // taguées `source_table = 'virement_fonds'` par la fonction SQL
  // `virement_entre_fonds` — jamais de compte produit/charge, donc
  // totalement distinct de l'excédent de l'exercice.
  function virementsFondsCalc(fonds) {
    let total = 0;
    for (const l of lignesR) {
      if (l.fonds !== fonds || l.source_table !== "virement_fonds") continue;
      total += (Number(l.debit) || 0) - (Number(l.credit) || 0);
    }
    return total;
  }
  function soldeClotureFonds(fonds) {
    return soldeOuvertureFonds(fonds) + excedentFondsEx(fonds) + virementsFondsCalc(fonds);
  }
  const soldeOuvertureTotal = FONDS_KEYS.reduce((s, f) => s + soldeOuvertureFonds(f), 0);
  const soldeClotureTotal = FONDS_KEYS.reduce((s, f) => s + soldeClotureFonds(f), 0);
  const virementsTotal = FONDS_KEYS.reduce((s, f) => s + virementsFondsCalc(f), 0);

  // ---------- Virement entre fonds (suite 87, président seulement) ----------
  const [virSource, setVirSource] = useState("general");
  const [virDest, setVirDest] = useState("urgence");
  const [virMontant, setVirMontant] = useState("");
  const [virMotif, setVirMotif] = useState("");
  const [virDate, setVirDate] = useState(todayISO());
  const [virSubmitting, setVirSubmitting] = useState(false);
  const [virError, setVirError] = useState("");
  const [virSuccess, setVirSuccess] = useState("");

  async function effectuerVirement() {
    setVirError("");
    setVirSuccess("");
    if (virSource === virDest) { setVirError(t("cpt_virement_error_same")); return; }
    if (!virMontant || Number(virMontant) <= 0) { setVirError(t("cpt_virement_error_montant")); return; }
    if (!virMotif.trim()) { setVirError(t("cpt_virement_error_motif")); return; }
    if (!window.confirm(
      t("cpt_virement_confirm")
        .replace("{montant}", moneyF(Number(virMontant)))
        .replace("{source}", t("cpt_fonds_" + virSource))
        .replace("{dest}", t("cpt_fonds_" + virDest))
    )) return;
    setVirSubmitting(true);
    const { error } = await supabase.rpc("virement_entre_fonds", {
      p_fonds_source: virSource, p_fonds_dest: virDest, p_montant: Number(virMontant),
      p_description: virMotif.trim(), p_date: virDate,
    });
    setVirSubmitting(false);
    if (error) { setVirError(friendlyError(error, t)); return; }
    setVirMontant("");
    setVirMotif("");
    setVirSuccess(t("cpt_virement_success"));
    setTimeout(() => setVirSuccess(""), 3500);
    chargerResultats();
  }

  async function cloturerExercice() {
    if (!window.confirm(t("cpt_cloturer_confirm").replace("{debut}", exerciceDebut).replace("{fin}", exerciceFin))) return;
    setCloturing(true);
    setErrorMsgR("");
    const { error } = await supabase.rpc("cloturer_exercice", {
      p_date_debut: exerciceDebut, p_date_fin: exerciceFin,
    });
    setCloturing(false);
    if (error) { setErrorMsgR(friendlyError(error, t)); return; }
    chargerResultats();
  }

  // ---------- Impression (suite 88) ----------
  // Choix de l'utilisateur : « rendre optionnel — choix d'imprimer l'un
  // ou l'autre, soit les trois à la fois selon la sélection ». Les 3
  // cases sont cochées par défaut (le jeu complet des états officiels,
  // le cas le plus courant), mais décochables indépendamment. Le bouton
  // charge automatiquement les données manquantes (Bilan et/ou Résultats/
  // Évolution) avant d'imprimer — l'utilisateur n'a pas à visiter chaque
  // onglet manuellement au préalable pour que l'impression soit complète.
  const [printBilan, setPrintBilan] = useState(true);
  const [printResultats, setPrintResultats] = useState(true);
  const [printEvolution, setPrintEvolution] = useState(true);
  const [printPreparing, setPrintPreparing] = useState(false);
  const printSelectionVide = !printBilan && !printResultats && !printEvolution;

  // ---------- Export du grand livre (suite 2026-10-06) ----------
  // Réutilise la période déjà sélectionnée pour l'État des résultats
  // (exerciceDebut/exerciceFin) plutôt que d'ajouter un 2e sélecteur de
  // dates redondant — l'association exporte en général la même période
  // qu'elle vient de consulter.
  const [exportFormat, setExportFormat] = useState("generique");
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState("");

  async function exporterGrandLivre() {
    if (periodeInvalide) return;
    setExportLoading(true);
    setExportError("");
    try {
      const [{ data: ecr, error: e1 }, comptesRes] = await Promise.all([
        supabase.from("ecritures_comptables")
          .select("date, compte_code, fonds, debit, credit, description, piece_id")
          .gte("date", exerciceDebut).lte("date", exerciceFin)
          .order("date").order("piece_id"),
        comptes.length > 0 ? Promise.resolve({ data: comptes, error: null }) : supabase.from("comptes_comptables").select("*").order("ordre"),
      ]);
      if (e1) throw e1;
      if (comptesRes.error) throw comptesRes.error;
      const comptesMap = Object.fromEntries((comptesRes.data || []).map((c) => [c.code, c.nom]));
      const lignesExport = ecr || [];
      if (lignesExport.length === 0) {
        setExportError(t("cpt_export_vide"));
        return;
      }
      const base = `${slugifyNomAssoc(association?.nom)}_${exerciceDebut}_${exerciceFin}`;
      if (exportFormat === "quickbooks") {
        // Format d'import QuickBooks Online vérifié auprès de la
        // documentation officielle Intuit (colonnes exactes requises) :
        // Journal No., Journal Date, Account Name, Journal/Description,
        // Debits, Credits. Un même numéro de pièce (piece_id, interne à
        // Unia) regroupe les lignes d'une même écriture — QuickBooks a
        // besoin d'un numéro de journal lisible, pas de l'identifiant
        // technique : on génère un compteur séquentiel propre à cet
        // export plutôt que d'exposer le piece_id brut.
        const numeroParPiece = {};
        let compteur = 0;
        const rows = [["Journal No.", "Journal Date", "Account Name", "Journal/Description", "Debits", "Credits"]];
        for (const l of lignesExport) {
          if (!(l.piece_id in numeroParPiece)) numeroParPiece[l.piece_id] = ++compteur;
          rows.push([
            `UNIA-${numeroParPiece[l.piece_id]}`,
            l.date,
            comptesMap[l.compte_code] || l.compte_code,
            l.description || "",
            Number(l.debit) > 0 ? Number(l.debit).toFixed(2) : "",
            Number(l.credit) > 0 ? Number(l.credit).toFixed(2) : "",
          ]);
        }
        downloadCsv(rows, `grand_livre_quickbooks_${base}.csv`);
      } else {
        const rows = [["Date", "Compte", "Nom du compte", "Fonds", "Débit", "Crédit", "Description", "Pièce"]];
        for (const l of lignesExport) {
          rows.push([
            l.date, l.compte_code, comptesMap[l.compte_code] || "", t("cpt_fonds_" + l.fonds) || l.fonds,
            Number(l.debit) > 0 ? Number(l.debit).toFixed(2) : "0.00",
            Number(l.credit) > 0 ? Number(l.credit).toFixed(2) : "0.00",
            l.description || "", l.piece_id,
          ]);
        }
        downloadCsv(rows, `grand_livre_${base}.csv`);
      }
    } catch (e) {
      setExportError(friendlyError(e, t));
    } finally {
      setExportLoading(false);
    }
  }

  // Attend qu'un rendu React ait bien eu lieu (deux passages par
  // requestAnimationFrame) avant d'appeler window.print() — nécessaire
  // car chargerBilan()/chargerResultats() mettent à jour le state de
  // façon asynchrone ; sans cette attente, window.print() risquerait de
  // capturer le DOM juste avant que les nouvelles données n'y apparaissent.
  function attendreRendu() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function handlePrint() {
    if (printSelectionVide) return;
    setPrintPreparing(true);
    const taches = [];
    if (printBilan && !loaded) taches.push(chargerBilan());
    if ((printResultats || printEvolution) && !loadedR) taches.push(chargerResultats());
    if (taches.length > 0) await Promise.all(taches);
    await attendreRendu();
    setPrintPreparing(false);
    window.print();
  }

  return (
    <Card style={{ marginTop: 22 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }} className="no-print">
        <button onClick={() => setVue("bilan")} style={{ padding: "7px 16px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: vue === "bilan" ? "var(--primary)" : "#EEF1F5", color: vue === "bilan" ? "white" : "#5B6270" }}>{t("cpt_tab_bilan")}</button>
        <button onClick={() => setVue("resultats")} style={{ padding: "7px 16px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: vue === "resultats" ? "var(--primary)" : "#EEF1F5", color: vue === "resultats" ? "white" : "#5B6270" }}>{t("cpt_tab_resultats")}</button>
        <button onClick={() => setVue("evolution")} style={{ padding: "7px 16px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: vue === "evolution" ? "var(--primary)" : "#EEF1F5", color: vue === "evolution" ? "white" : "#5B6270" }}>{t("cpt_tab_evolution")}</button>
      </div>

      <div className="no-print" style={{ background: "#FBF6EC", borderRadius: 10, padding: "10px 16px", marginBottom: 18, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#5B6270" }}>{t("cpt_print_select_label")}</span>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={printBilan} onChange={(e) => setPrintBilan(e.target.checked)} /> {t("cpt_tab_bilan")}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={printResultats} onChange={(e) => setPrintResultats(e.target.checked)} /> {t("cpt_tab_resultats")}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={printEvolution} onChange={(e) => setPrintEvolution(e.target.checked)} /> {t("cpt_tab_evolution")}
        </label>
        <Btn variant="outline" onClick={handlePrint} disabled={printPreparing || printSelectionVide}>
          <Printer size={14} /> {printPreparing ? t("cpt_loading") : t("fin_print_btn")}
        </Btn>
      </div>
      {(printResultats || printEvolution) && periodeInvalide && (
        <Banner tone="warn">{t("cpt_periode_invalide")}</Banner>
      )}

      {/* ================= EXPORT DU GRAND LIVRE =================
          Suite 2026-10-06, suite à la veille concurrentielle (demande
          explicite de l'utilisateur) — voir
          claude/integration-comptable-externe-proposition.md, Palier 1.
          Toujours un simple fichier téléchargé, jamais une connexion API
          à un service externe. Période = celle déjà choisie ci-dessus
          pour l'État des résultats (exerciceDebut/exerciceFin), pour ne
          pas dupliquer un 2e sélecteur de dates. */}
      <div className="no-print" style={{ background: "#F5F7FA", borderRadius: 10, padding: "10px 16px", marginBottom: 18, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#5B6270" }}>{t("cpt_export_label")}</span>
        <select style={{ ...inputStyle, width: "auto" }} value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
          <option value="generique">{t("cpt_export_format_generique")}</option>
          <option value="quickbooks">{t("cpt_export_format_quickbooks")}</option>
        </select>
        <Btn variant="outline" onClick={exporterGrandLivre} disabled={exportLoading || periodeInvalide}>
          <Download size={14} /> {exportLoading ? t("cpt_loading") : t("cpt_export_btn")}
        </Btn>
        <span style={{ fontSize: 11.5, color: "#686F7D" }}>{t("cpt_export_period_note").replace("{debut}", exerciceDebut).replace("{fin}", exerciceFin)}</span>
      </div>
      {exportError && <Banner tone="warn">{exportError}</Banner>}
      {exportFormat === "quickbooks" && (
        <p className="no-print" style={{ fontSize: 11.5, color: "#686F7D", marginTop: -10, marginBottom: 16 }}>{t("cpt_export_quickbooks_note")}</p>
      )}

      {vue === "bilan" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 4 }}>{t("cpt_title")}</h3>
              <p style={{ fontSize: 12.5, color: "#5B6270", maxWidth: 640, margin: 0 }}>{t("cpt_subtitle")}</p>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <Field label={t("cpt_date_label")}>
                <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Btn onClick={chargerBilan} disabled={loading}>{loading ? t("cpt_loading") : t("cpt_refresh")}</Btn>
            </div>
          </div>

          {errorMsg && <Banner tone="warn">{errorMsg}</Banner>}
          {notInstalled && <Banner tone="warn">{t("cpt_not_installed")}</Banner>}
          {!loaded && !notInstalled && !errorMsg && (
            <p style={{ fontSize: 13, color: "#686F7D", fontStyle: "italic", marginTop: 10 }}>{t("cpt_prompt_load")}</p>
          )}

          {loaded && !notInstalled && (
            lignes.length === 0 ? (
              <p style={{ fontSize: 13, color: "#686F7D", fontStyle: "italic", marginTop: 10 }}>{t("cpt_no_data")}</p>
            ) : (
              <>
                <div style={{ marginTop: 14 }}>
                  <Table head={[t("cpt_col_compte"), t("cpt_col_solde")]}>
                    {comptesActif.length > 0 && (
                      <tr><td colSpan={2} style={{ ...td, background: "#F5F7FA", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", color: "#5B6270" }}>{t("cpt_section_actifs")}</td></tr>
                    )}
                    {comptesActif.map((c) => (
                      <tr key={c.code}><td style={td}>{c.nom}</td><td style={{ ...td, textAlign: "right" }}>{moneyF(soldeCompte(c))}</td></tr>
                    ))}
                    {comptesActif.length > 0 && (
                      <tr><td style={{ ...td, fontWeight: 700 }}>{t("cpt_total_actifs")}</td><td style={{ ...td, fontWeight: 700, textAlign: "right" }}>{moneyF(totalActif)}</td></tr>
                    )}
                    {comptesPassif.length > 0 && (
                      <tr><td colSpan={2} style={{ ...td, background: "#F5F7FA", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", color: "#5B6270" }}>{t("cpt_section_passifs")}</td></tr>
                    )}
                    {comptesPassif.map((c) => (
                      <tr key={c.code}><td style={td}>{c.nom}</td><td style={{ ...td, textAlign: "right" }}>{moneyF(soldeCompte(c))}</td></tr>
                    ))}
                    {comptesPassif.length > 0 && (
                      <tr><td style={{ ...td, fontWeight: 700 }}>{t("cpt_total_passifs")}</td><td style={{ ...td, fontWeight: 700, textAlign: "right" }}>{moneyF(totalPassif)}</td></tr>
                    )}
                    <tr><td style={{ ...td, fontWeight: 700, borderBottom: "none" }}>{t("cpt_total_actif_net")}</td><td style={{ ...td, fontWeight: 700, textAlign: "right", borderBottom: "none" }}>{moneyF(totalActifNet)}</td></tr>
                  </Table>
                </div>

                <h4 style={{ fontSize: 13.5, marginTop: 18, marginBottom: 8 }}>{t("cpt_actif_net_title")}</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                  {FONDS_KEYS.map((f) => (
                    <div key={f} style={{ background: "#FBF6EC", borderRadius: 10, padding: "10px 14px" }}>
                      <div style={{ fontSize: 11.5, color: "#5B6270", textTransform: "uppercase", letterSpacing: ".02em" }}>{t("cpt_fonds_" + f)}</div>
                      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{moneyF(soldeFondsBilan(f))}</div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 16, fontSize: 12, color: equilibre ? "#1F8A5C" : "#C0392B", fontWeight: 600 }}>
                  {equilibre ? t("cpt_equilibre_ok") : t("cpt_equilibre_fail")}
                </div>
                <p style={{ fontSize: 11.5, color: "#686F7D", marginTop: 10 }}>{t("cpt_compare_note")}</p>
              </>
            )
          )}
        </>
      )}

      {vue === "resultats" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 4 }}>{t("cpt_tab_resultats")}</h3>
              <p style={{ fontSize: 12.5, color: "#5B6270", maxWidth: 640, margin: 0 }}>{t("cpt_resultats_subtitle")}</p>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <Field label={t("cpt_exercice_debut_label")}>
                <input type="date" style={inputStyle} value={exerciceDebut} onChange={(e) => setExerciceDebut(e.target.value)} />
              </Field>
              <Field label={t("cpt_exercice_fin_label")}>
                <input type="date" style={inputStyle} value={exerciceFin} onChange={(e) => setExerciceFin(e.target.value)} />
              </Field>
              <Btn onClick={chargerResultats} disabled={loadingR || periodeInvalide}>{loadingR ? t("cpt_loading") : t("cpt_refresh")}</Btn>
            </div>
          </div>
          {periodeInvalide && <Banner tone="warn">{t("cpt_periode_invalide")}</Banner>}

          {errorMsgR && <Banner tone="warn">{errorMsgR}</Banner>}
          {notInstalledR && <Banner tone="warn">{t("cpt_not_installed")}</Banner>}
          {!loadedR && !notInstalledR && !errorMsgR && (
            <p style={{ fontSize: 13, color: "#686F7D", fontStyle: "italic", marginTop: 10 }}>{t("cpt_prompt_load")}</p>
          )}

          {loadedR && !notInstalledR && (
            lignesR.length === 0 ? (
              <p style={{ fontSize: 13, color: "#686F7D", fontStyle: "italic", marginTop: 10 }}>{t("cpt_no_data_resultats")}</p>
            ) : (
              <>
                <div style={{ marginTop: 4 }}>
                  <Table head={[t("cpt_col_compte"), t("cpt_col_solde")]}>
                    {comptesProduitsAffiches.length > 0 && (
                      <tr><td colSpan={2} style={{ ...td, background: "#F5F7FA", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", color: "#5B6270" }}>{t("cpt_section_produits")}</td></tr>
                    )}
                    {comptesProduitsAffiches.map((c) => (
                      <tr key={c.code}><td style={td}>{c.nom}</td><td style={{ ...td, textAlign: "right" }}>{moneyF(soldeCompteExercice(c))}</td></tr>
                    ))}
                    {comptesProduitsAffiches.length > 0 && (
                      <tr><td style={{ ...td, fontWeight: 700 }}>{t("cpt_total_produits")}</td><td style={{ ...td, fontWeight: 700, textAlign: "right" }}>{moneyF(totalProduitsEx)}</td></tr>
                    )}
                    {comptesChargesAffiches.length > 0 && (
                      <tr><td colSpan={2} style={{ ...td, background: "#F5F7FA", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", color: "#5B6270" }}>{t("cpt_section_charges")}</td></tr>
                    )}
                    {comptesChargesAffiches.map((c) => (
                      <tr key={c.code}><td style={td}>{c.nom}</td><td style={{ ...td, textAlign: "right" }}>{moneyF(soldeCompteExercice(c))}</td></tr>
                    ))}
                    {comptesChargesAffiches.length > 0 && (
                      <tr><td style={{ ...td, fontWeight: 700 }}>{t("cpt_total_charges")}</td><td style={{ ...td, fontWeight: 700, textAlign: "right" }}>{moneyF(totalChargesEx)}</td></tr>
                    )}
                    <tr><td style={{ ...td, fontWeight: 700, borderBottom: "none" }}>{t("cpt_excedent_label")}</td><td style={{ ...td, fontWeight: 700, textAlign: "right", borderBottom: "none" }}>{moneyF(excedentEx)}</td></tr>
                  </Table>
                </div>

                <h4 style={{ fontSize: 13.5, marginTop: 18, marginBottom: 8 }}>{t("cpt_excedent_par_fonds_title")}</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                  {FONDS_KEYS.map((f) => (
                    <div key={f} style={{ background: "#FBF6EC", borderRadius: 10, padding: "10px 14px" }}>
                      <div style={{ fontSize: 11.5, color: "#5B6270", textTransform: "uppercase", letterSpacing: ".02em" }}>{t("cpt_fonds_" + f)}</div>
                      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{moneyF(detailFonds("produit", f) - detailFonds("charge", f))}</div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 18 }} className="no-print">
                  {clotureInfo ? (
                    <Banner>{t("cpt_cloture_badge").replace("{date}", new Date(clotureInfo.cloture_le).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA"))}</Banner>
                  ) : exerciceTermine ? (
                    isPresident && (
                      <Btn onClick={cloturerExercice} disabled={cloturing}>{cloturing ? t("cpt_loading") : t("cpt_cloturer_btn")}</Btn>
                    )
                  ) : (
                    <p style={{ fontSize: 12, color: "#686F7D", fontStyle: "italic" }}>{t("cpt_exercice_en_cours")}</p>
                  )}
                </div>
              </>
            )
          )}
        </>
      )}

      {vue === "evolution" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 4 }}>{t("cpt_tab_evolution")}</h3>
              <p style={{ fontSize: 12.5, color: "#5B6270", maxWidth: 640, margin: 0 }}>{t("cpt_evolution_subtitle")}</p>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <Field label={t("cpt_exercice_debut_label")}>
                <input type="date" style={inputStyle} value={exerciceDebut} onChange={(e) => setExerciceDebut(e.target.value)} />
              </Field>
              <Field label={t("cpt_exercice_fin_label")}>
                <input type="date" style={inputStyle} value={exerciceFin} onChange={(e) => setExerciceFin(e.target.value)} />
              </Field>
              <Btn onClick={chargerResultats} disabled={loadingR || periodeInvalide}>{loadingR ? t("cpt_loading") : t("cpt_refresh")}</Btn>
            </div>
          </div>
          {periodeInvalide && <Banner tone="warn">{t("cpt_periode_invalide")}</Banner>}

          {errorMsgR && <Banner tone="warn">{errorMsgR}</Banner>}
          {notInstalledR && <Banner tone="warn">{t("cpt_not_installed")}</Banner>}
          {!loadedR && !notInstalledR && !errorMsgR && (
            <p style={{ fontSize: 13, color: "#686F7D", fontStyle: "italic", marginTop: 10 }}>{t("cpt_prompt_load")}</p>
          )}

          {loadedR && !notInstalledR && (
            <>
              <div style={{ marginTop: 4 }}>
                <Table head={[t("cpt_col_poste"), t("cpt_fonds_general"), t("cpt_fonds_urgence"), t("cpt_fonds_secours"), t("cpt_col_total")]}>
                  <tr>
                    <td style={td}>{t("cpt_evolution_ouverture")}</td>
                    {FONDS_KEYS.map((f) => <td key={f} style={{ ...td, textAlign: "right" }}>{moneyF(soldeOuvertureFonds(f))}</td>)}
                    <td style={{ ...td, textAlign: "right" }}>{moneyF(soldeOuvertureTotal)}</td>
                  </tr>
                  <tr>
                    <td style={td}>{t("cpt_evolution_excedent")}</td>
                    {FONDS_KEYS.map((f) => <td key={f} style={{ ...td, textAlign: "right" }}>{moneyF(excedentFondsEx(f))}</td>)}
                    <td style={{ ...td, textAlign: "right" }}>{moneyF(excedentEx)}</td>
                  </tr>
                  <tr>
                    <td style={td}>{t("cpt_evolution_virements")}</td>
                    {FONDS_KEYS.map((f) => <td key={f} style={{ ...td, textAlign: "right" }}>{moneyF(virementsFondsCalc(f))}</td>)}
                    <td style={{ ...td, textAlign: "right" }}>{moneyF(virementsTotal)}</td>
                  </tr>
                  <tr>
                    <td style={{ ...td, fontWeight: 700, borderBottom: "none" }}>{t("cpt_evolution_cloture")}</td>
                    {FONDS_KEYS.map((f) => <td key={f} style={{ ...td, fontWeight: 700, textAlign: "right", borderBottom: "none" }}>{moneyF(soldeClotureFonds(f))}</td>)}
                    <td style={{ ...td, fontWeight: 700, textAlign: "right", borderBottom: "none" }}>{moneyF(soldeClotureTotal)}</td>
                  </tr>
                </Table>
              </div>

              {isPresident && (
                <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid #E5E7EB" }} className="no-print">
                  <h4 style={{ fontSize: 13.5, marginBottom: 4 }}>{t("cpt_virement_title")}</h4>
                  <p style={{ fontSize: 12, color: "#5B6270", maxWidth: 640, margin: "0 0 12px" }}>{t("cpt_virement_note")}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
                    <Field label={t("cpt_virement_source_label")}>
                      <select style={inputStyle} value={virSource} onChange={(e) => setVirSource(e.target.value)}>
                        {FONDS_KEYS.map((f) => <option key={f} value={f}>{t("cpt_fonds_" + f)}</option>)}
                      </select>
                    </Field>
                    <Field label={t("cpt_virement_dest_label")}>
                      <select style={inputStyle} value={virDest} onChange={(e) => setVirDest(e.target.value)}>
                        {FONDS_KEYS.map((f) => <option key={f} value={f}>{t("cpt_fonds_" + f)}</option>)}
                      </select>
                    </Field>
                    <Field label={t("cpt_virement_montant_label")}>
                      <input type="number" min="0.01" step="0.01" style={inputStyle} value={virMontant} onChange={(e) => setVirMontant(e.target.value)} />
                    </Field>
                    <Field label={t("cpt_virement_date_label")}>
                      <input type="date" style={inputStyle} value={virDate} onChange={(e) => setVirDate(e.target.value)} />
                    </Field>
                  </div>
                  <div style={{ marginTop: 10, maxWidth: 480 }}>
                    <Field label={t("cpt_virement_motif_label")}>
                      <input type="text" style={{ ...inputStyle, width: "100%" }} value={virMotif} onChange={(e) => setVirMotif(e.target.value)} placeholder={t("cpt_virement_motif_placeholder")} />
                    </Field>
                  </div>
                  {virError && <Banner tone="warn">{virError}</Banner>}
                  {virSuccess && <Banner>{virSuccess}</Banner>}
                  <div style={{ marginTop: 10 }}>
                    <Btn onClick={effectuerVirement} disabled={virSubmitting}>{virSubmitting ? t("cpt_loading") : t("cpt_virement_submit")}</Btn>
                  </div>
                </div>
              )}

              <p style={{ fontSize: 11.5, color: "#686F7D", marginTop: 16 }}>{t("cpt_evolution_virements_note")}</p>
            </>
          )}
        </>
      )}

      {/* ============ Mise en page dédiée à l'impression (suite 88) ============
          Invisible à l'écran (.print-only), affichée UNIQUEMENT au moment
          d'imprimer, quel que soit l'onglet interactif actuellement ouvert
          ci-dessus. Reprend les mêmes calculs (soldeCompte, detailFonds,
          soldeOuvertureFonds, virementsFondsCalc, soldeClotureFonds...) sur
          les mêmes données déjà chargées (lignes/lignesR/lignesOuverture) —
          jamais de recalcul divergent entre l'écran et le papier. */}
      <div className="fin-print print-only">
        <style>{`
          @media print {
            .fin-print-section { page-break-inside: avoid; margin-bottom: 22pt; }
            .fin-print-section + .fin-print-section { page-break-before: always; }
            .fin-print-runner {
              display: flex; justify-content: space-between; font-size: 9pt; color: #666;
              text-transform: uppercase; letter-spacing: .04em; border-bottom: 0.75pt solid #686F7D;
              padding-bottom: 4pt; margin-bottom: 12pt;
            }
            .fin-print-section h2 { font-size: 15pt; margin: 0 0 3pt; color: #111; font-family: inherit; }
            .fin-print-section h3 { font-size: 11pt; margin: 14pt 0 5pt; color: #111; font-family: inherit; }
            .fin-print-meta { font-size: 9.5pt; color: #555; margin: 0 0 10pt; }
            .fin-print table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-bottom: 4pt; }
            .fin-print th, .fin-print td { text-align: left; padding: 4.5pt 6pt; border-bottom: 0.5pt solid #ccc; }
            .fin-print th { border-bottom: 1pt solid #333; font-size: 8pt; text-transform: uppercase; letter-spacing: .03em; color: #333; font-weight: 700; }
            .fin-print .fin-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .fin-print tr.fin-section-row td { font-weight: 700; font-size: 8pt; text-transform: uppercase; letter-spacing: .03em; padding-top: 10pt; border-bottom: 1pt solid #333; color: #333; }
            .fin-print tr.fin-total-row td { font-weight: 700; border-top: 1pt solid #333; }
            .fin-print tr.fin-grand-row td { font-weight: 700; border-top: 1.5pt double #111; border-bottom: 1.5pt double #111; }
            .fin-print-note { font-size: 8.5pt; color: #777; font-style: italic; margin-top: 6pt; }
          }
        `}</style>

        {printBilan && loaded && (
          <section className="fin-print-section">
            <div className="fin-print-runner"><span>{association?.nom}</span><span>{t("cpt_title")}</span></div>
            <h2>{t("cpt_title")}</h2>
            <p className="fin-print-meta">{t("cpt_date_label")} : {new Date(date).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA")}</p>
            <table>
              <thead><tr><th>{t("cpt_col_compte")}</th><th className="fin-num">{t("cpt_col_solde")}</th></tr></thead>
              <tbody>
                {comptesActif.length > 0 && <tr className="fin-section-row"><td colSpan={2}>{t("cpt_section_actifs")}</td></tr>}
                {comptesActif.map((c) => <tr key={c.code}><td>{c.nom}</td><td className="fin-num">{moneyF(soldeCompte(c))}</td></tr>)}
                {comptesActif.length > 0 && <tr className="fin-total-row"><td>{t("cpt_total_actifs")}</td><td className="fin-num">{moneyF(totalActif)}</td></tr>}
                {comptesPassif.length > 0 && <tr className="fin-section-row"><td colSpan={2}>{t("cpt_section_passifs")}</td></tr>}
                {comptesPassif.map((c) => <tr key={c.code}><td>{c.nom}</td><td className="fin-num">{moneyF(soldeCompte(c))}</td></tr>)}
                {comptesPassif.length > 0 && <tr className="fin-total-row"><td>{t("cpt_total_passifs")}</td><td className="fin-num">{moneyF(totalPassif)}</td></tr>}
                <tr className="fin-grand-row"><td>{t("cpt_total_actif_net")}</td><td className="fin-num">{moneyF(totalActifNet)}</td></tr>
              </tbody>
            </table>
            <h3>{t("cpt_actif_net_title")}</h3>
            <table>
              <thead><tr>{FONDS_KEYS.map((f) => <th key={f} className="fin-num">{t("cpt_fonds_" + f)}</th>)}</tr></thead>
              <tbody><tr>{FONDS_KEYS.map((f) => <td key={f} className="fin-num">{moneyF(soldeFondsBilan(f))}</td>)}</tr></tbody>
            </table>
          </section>
        )}

        {printResultats && loadedR && (
          <section className="fin-print-section">
            <div className="fin-print-runner"><span>{association?.nom}</span><span>{t("cpt_tab_resultats")}</span></div>
            <h2>{t("cpt_tab_resultats")}</h2>
            <p className="fin-print-meta">{t("cpt_exercice_range").replace("{debut}", exerciceDebut).replace("{fin}", exerciceFin)}</p>
            <table>
              <thead><tr><th>{t("cpt_col_compte")}</th><th className="fin-num">{t("cpt_col_solde")}</th></tr></thead>
              <tbody>
                {comptesProduitsAffiches.length > 0 && <tr className="fin-section-row"><td colSpan={2}>{t("cpt_section_produits")}</td></tr>}
                {comptesProduitsAffiches.map((c) => <tr key={c.code}><td>{c.nom}</td><td className="fin-num">{moneyF(soldeCompteExercice(c))}</td></tr>)}
                {comptesProduitsAffiches.length > 0 && <tr className="fin-total-row"><td>{t("cpt_total_produits")}</td><td className="fin-num">{moneyF(totalProduitsEx)}</td></tr>}
                {comptesChargesAffiches.length > 0 && <tr className="fin-section-row"><td colSpan={2}>{t("cpt_section_charges")}</td></tr>}
                {comptesChargesAffiches.map((c) => <tr key={c.code}><td>{c.nom}</td><td className="fin-num">{moneyF(soldeCompteExercice(c))}</td></tr>)}
                {comptesChargesAffiches.length > 0 && <tr className="fin-total-row"><td>{t("cpt_total_charges")}</td><td className="fin-num">{moneyF(totalChargesEx)}</td></tr>}
                <tr className="fin-grand-row"><td>{t("cpt_excedent_label")}</td><td className="fin-num">{moneyF(excedentEx)}</td></tr>
              </tbody>
            </table>
            <h3>{t("cpt_excedent_par_fonds_title")}</h3>
            <table>
              <thead><tr>{FONDS_KEYS.map((f) => <th key={f} className="fin-num">{t("cpt_fonds_" + f)}</th>)}</tr></thead>
              <tbody><tr>{FONDS_KEYS.map((f) => <td key={f} className="fin-num">{moneyF(detailFonds("produit", f) - detailFonds("charge", f))}</td>)}</tr></tbody>
            </table>
          </section>
        )}

        {printEvolution && loadedR && (
          <section className="fin-print-section">
            <div className="fin-print-runner"><span>{association?.nom}</span><span>{t("cpt_tab_evolution")}</span></div>
            <h2>{t("cpt_tab_evolution")}</h2>
            <p className="fin-print-meta">{t("cpt_exercice_range").replace("{debut}", exerciceDebut).replace("{fin}", exerciceFin)}</p>
            <table>
              <thead><tr><th>{t("cpt_col_poste")}</th>{FONDS_KEYS.map((f) => <th key={f} className="fin-num">{t("cpt_fonds_" + f)}</th>)}<th className="fin-num">{t("cpt_col_total")}</th></tr></thead>
              <tbody>
                <tr><td>{t("cpt_evolution_ouverture")}</td>{FONDS_KEYS.map((f) => <td key={f} className="fin-num">{moneyF(soldeOuvertureFonds(f))}</td>)}<td className="fin-num">{moneyF(soldeOuvertureTotal)}</td></tr>
                <tr><td>{t("cpt_evolution_excedent")}</td>{FONDS_KEYS.map((f) => <td key={f} className="fin-num">{moneyF(excedentFondsEx(f))}</td>)}<td className="fin-num">{moneyF(excedentEx)}</td></tr>
                <tr><td>{t("cpt_evolution_virements")}</td>{FONDS_KEYS.map((f) => <td key={f} className="fin-num">{moneyF(virementsFondsCalc(f))}</td>)}<td className="fin-num">{moneyF(virementsTotal)}</td></tr>
                <tr className="fin-grand-row"><td>{t("cpt_evolution_cloture")}</td>{FONDS_KEYS.map((f) => <td key={f} className="fin-num">{moneyF(soldeClotureFonds(f))}</td>)}<td className="fin-num">{moneyF(soldeClotureTotal)}</td></tr>
              </tbody>
            </table>
          </section>
        )}

        {((printBilan && !loaded) || ((printResultats || printEvolution) && !loadedR)) && (
          <p className="fin-print-note">{t("cpt_print_missing_data")}</p>
        )}
      </div>
    </Card>
  );
}
