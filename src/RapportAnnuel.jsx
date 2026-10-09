// =====================================================================
// RapportAnnuel.jsx — Rapport annuel (PDF) + export complet des données
// Phase 5 de la feuille de route ("Rapports et conformité"), 2026-09-28.
// Développé par Omnia Trade Solutions
// =====================================================================
//
// Deux outils distincts, regroupés ici et affichés dans Configuration
// (réservé au bureau, comme le reste des outils administratifs de cet
// onglet) :
//  1. Rapport annuel — document PDF prêt pour l'assemblée générale,
//     couvrant Finances/Gouvernance/Activités/Adhérents pour une année
//     choisie. Généré programmatiquement avec jsPDF + jspdf-autotable
//     (choix explicite de l'utilisateur plutôt que le patron
//     « page imprimable + window.print() » déjà utilisé ailleurs dans
//     l'app pour les reçus/décharges/PV — voir resume-arem-app.md).
//     NÉCESSITE `npm install jspdf jspdf-autotable` dans le projet.
//  2. Export complet des données — un fichier JSON unique avec toutes les
//     tables de l'association (sauvegarde / portabilité / réponse à une
//     demande de suppression), réservé au président (données sensibles).
//
// Section Finances BRANCHÉE sur le système comptable professionnel (suite
// 86, Phase C, 2026-09-28) : Bilan / État des résultats / Évolution de
// l'actif net, calculés depuis le grand livre `ecritures_comptables`,
// pour le même exercice financier (configurable, `exerciceBounds`) que
// l'onglet Comptabilité (États financiers). Remplace les anciennes
// formules JS approximatives (`fondsSoldeCalc`, agrégation brute des
// tables `donations`/`loans`/`fonds_depenses`/`fonds_recouvrements`) et
// retire du même coup la limite qui était documentée ici : l'inscription
// et les contributions initiales aux fonds étaient suivies comme des
// totaux cumulatifs non datés, impossibles à borner exactement à une
// année — le grand livre, lui, date chaque écriture (y compris le bilan
// d'ouverture), donc les trois états produits ici sont exacts.
import { useState } from "react";
import { supabase } from "./supabaseClient";
import { Card, Btn, Field, useLang, friendlyError, money, inputStyle, exerciceBounds, toDatetimeLocal } from "./shared";

// Toutes les tables propres à une association, pour l'export complet.
// « associations » elle-même est traitée à part (filtrée par id, pas par
// association_id — cohérent avec la façon dont elle est déjà lue ailleurs
// dans l'app, ex. AuthenticatedApp.load()). Pour toutes les autres, on
// s'appuie sur les politiques RLS déjà en place pour le cloisonnement par
// association — patron déjà dominant dans ce projet (le chargement
// principal de App.jsx ne filtre explicitement AUCUNE de ces tables par
// association_id, ex. members/donations/loans/fonds_depenses/
// documents/announcements/activity_log...) plutôt que de deviner/dupliquer
// un filtre .eq("association_id", ...) table par table, risquant d'en
// oublier une ou de se tromper sur une colonne qui n'existe pas partout
// (ex. election_candidats/election_votes n'ont pas de colonne
// association_id directe, uniquement une clé étrangère vers un parent).
const EXPORT_TABLES = [
  "subscriptions", "profiles", "members", "board_members", "governance_info",
  "elections", "election_candidats", "election_emargements",
  "donations", "loans", "loan_repayments",
  "fonds_depenses", "fonds_recouvrements",
  "tontine_seances", "tontine_presences", "collation_presences",
  "documents", "announcements", "announcement_acks",
  "activity_log", "deletion_requests", "member_link_requests",
  "interac_payment_claims", "payment_transactions",
  "events", "event_rsvps", "event_reviews",
  "posts", "post_comments", "post_reactions",
  "polls", "poll_options", "poll_votes",
  "projects", "project_tasks", "project_budget_lines", "project_expenses", "project_milestones",
  "sanctions", "sanctions_baremes",
  "funeraire_inscriptions", "funeraire_beneficiaires", "funeraire_dossiers",
  "funeraire_contributions", "funeraire_reserve_individuelle_mouvements", "funeraire_annonces",
  "push_subscriptions",
  // Système comptable professionnel (suite 86, 2026-09-28) : le grand
  // livre et ses tables associées font partie des données de
  // l'association au même titre que le reste — ajoutées ici pour que
  // l'export complet (sauvegarde/portabilité/réponse à une demande de
  // suppression) les couvre aussi.
  "comptes_comptables", "ecritures_comptables", "exercices_clotures",
];

function slugify(s) {
  return (s || "association").toString().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "association";
}

// ---------------------------------------------------------------------
// Construction du PDF (jsPDF + jspdf-autotable, chargés dynamiquement :
// seule cette fonction en a besoin, et ça donne un message d'erreur clair
// si les paquets ne sont pas encore installés plutôt qu'un écran blanc au
// démarrage de toute l'application).
// ---------------------------------------------------------------------
async function buildPdf({ t, association, year, devise, finances, gouvernance, activites, adherents, covoiturage }) {
  let jsPDFmod, autoTableMod;
  try {
    [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  } catch {
    throw new Error(t("rap_missing_deps"));
  }
  const { jsPDF } = jsPDFmod;
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 40;
  let y = 50;
  const pageWidth = doc.internal.pageSize.getWidth();

  function ensureSpace(needed) {
    if (y + needed > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 50; }
  }
  function h1(text) {
    ensureSpace(30);
    doc.setFontSize(18); doc.setTextColor(31, 56, 100); doc.setFont(undefined, "bold");
    doc.text(text, marginX, y); y += 24;
    doc.setDrawColor(201, 162, 39); doc.setLineWidth(1.5);
    doc.line(marginX, y - 16, marginX + 60, y - 16);
  }
  function h2(text) {
    ensureSpace(26);
    doc.setFontSize(13); doc.setTextColor(31, 56, 100); doc.setFont(undefined, "bold");
    doc.text(text, marginX, y); y += 18;
  }
  function para(text) {
    doc.setFontSize(10.5); doc.setTextColor(60, 60, 60); doc.setFont(undefined, "normal");
    const lines = doc.splitTextToSize(text, pageWidth - marginX * 2);
    ensureSpace(lines.length * 13 + 6);
    doc.text(lines, marginX, y); y += lines.length * 13 + 6;
  }
  function table(head, rows) {
    autoTable(doc, {
      startY: y, margin: { left: marginX, right: marginX },
      head: [head], body: rows,
      styles: { fontSize: 9.5, cellPadding: 5 },
      headStyles: { fillColor: [31, 56, 100], textColor: 255, fontSize: 9 },
      alternateRowStyles: { fillColor: [247, 248, 250] },
    });
    y = doc.lastAutoTable.finalY + 16;
  }

  // ---------- Couverture ----------
  doc.setFontSize(22); doc.setTextColor(31, 56, 100); doc.setFont(undefined, "bold");
  doc.text(association?.nom || t("rap_org_fallback"), marginX, y); y += 20;
  // Mentions légales (statut juridique, numéro d'enregistrement, adresse) —
  // même sous-ligne que sur les reçus (OrgLegalSubline, suite 80), reprise
  // ici en texte jsPDF puisque ce document est un PDF généré, pas une page
  // HTML imprimée. N'affiche rien si rien n'est configuré (suite 86, Phase C
  // — remarque de l'utilisateur : les mentions légales doivent apparaître
  // sur tout document destiné à être imprimé ou transféré).
  const legalParts = [association?.statut_juridique, association?.numero_enregistrement].filter(Boolean);
  if (legalParts.length > 0) {
    doc.setFontSize(9.5); doc.setTextColor(102, 102, 102); doc.setFont(undefined, "normal");
    doc.text(legalParts.join(" — "), marginX, y); y += 13;
  }
  if (association?.adresse) {
    doc.setFontSize(9.5); doc.setTextColor(102, 102, 102); doc.setFont(undefined, "normal");
    const addrLines = doc.splitTextToSize(association.adresse, pageWidth - marginX * 2);
    doc.text(addrLines, marginX, y); y += addrLines.length * 13;
  }
  y += 10;
  doc.setFontSize(15); doc.setTextColor(201, 162, 39);
  doc.text(t("rap_pdf_title").replace("{year}", String(year)), marginX, y); y += 20;
  doc.setFontSize(9.5); doc.setTextColor(140, 140, 140); doc.setFont(undefined, "normal");
  doc.text(t("rap_generated_on").replace("{date}", new Date().toLocaleDateString("fr-CA")), marginX, y); y += 30;

  // ---------- Finances (branché sur le système comptable — suite 86, Phase C) ----------
  h1(t("rap_section_finances"));
  para(t("rap_finances_ledger_note"));

  h2(t("rap_finances_bilan_title").replace("{date}", finances.exerciceFin));
  table([t("cpt_col_compte"), t("cpt_col_solde")], [
    ...finances.comptesActif.map((c) => [c.nom, money(c.solde, devise)]),
    [t("cpt_total_actifs"), money(finances.totalActif, devise)],
    ...finances.comptesPassif.map((c) => [c.nom, money(c.solde, devise)]),
    [t("cpt_total_passifs"), money(finances.totalPassif, devise)],
    [t("cpt_total_actif_net"), money(finances.totalActifNet, devise)],
  ]);
  table([t("cpt_col_poste"), t("cpt_fonds_general"), t("cpt_fonds_urgence"), t("cpt_fonds_secours")], [
    [t("cpt_actif_net_title"), money(finances.actifNetParFonds.general, devise), money(finances.actifNetParFonds.urgence, devise), money(finances.actifNetParFonds.secours, devise)],
  ]);

  h2(t("rap_finances_resultats_title"));
  para(t("cpt_exercice_range").replace("{debut}", finances.exerciceDebut).replace("{fin}", finances.exerciceFin));
  table([t("cpt_col_compte"), t("cpt_col_solde")], [
    ...finances.comptesProduits.map((c) => [c.nom, money(c.solde, devise)]),
    [t("cpt_total_produits"), money(finances.totalProduits, devise)],
    ...finances.comptesCharges.map((c) => [c.nom, money(c.solde, devise)]),
    [t("cpt_total_charges"), money(finances.totalCharges, devise)],
    [t("cpt_excedent_label"), money(finances.excedent, devise)],
  ]);
  table([t("cpt_col_poste"), t("cpt_fonds_general"), t("cpt_fonds_urgence"), t("cpt_fonds_secours")], [
    [t("cpt_excedent_par_fonds_title"), money(finances.excedentParFonds.general, devise), money(finances.excedentParFonds.urgence, devise), money(finances.excedentParFonds.secours, devise)],
  ]);

  h2(t("cpt_tab_evolution"));
  table([t("cpt_col_poste"), t("cpt_fonds_general"), t("cpt_fonds_urgence"), t("cpt_fonds_secours"), t("cpt_col_total")], [
    [t("cpt_evolution_ouverture"), money(finances.soldeOuvertureParFonds.general, devise), money(finances.soldeOuvertureParFonds.urgence, devise), money(finances.soldeOuvertureParFonds.secours, devise), money(finances.soldeOuvertureTotal, devise)],
    [t("cpt_evolution_excedent"), money(finances.excedentParFonds.general, devise), money(finances.excedentParFonds.urgence, devise), money(finances.excedentParFonds.secours, devise), money(finances.excedent, devise)],
    [t("cpt_evolution_virements"), money(finances.virementsParFonds.general, devise), money(finances.virementsParFonds.urgence, devise), money(finances.virementsParFonds.secours, devise), money(finances.virementsTotal, devise)],
    [t("cpt_evolution_cloture"), money(finances.soldeClotureParFonds.general, devise), money(finances.soldeClotureParFonds.urgence, devise), money(finances.soldeClotureParFonds.secours, devise), money(finances.soldeClotureTotal, devise)],
  ]);
  para(t("cpt_evolution_virements_note"));

  // ---------- Gouvernance ----------
  h1(t("rap_section_gouvernance"));
  if (gouvernance.info?.vision) { h2(t("gov_vision") || "Vision"); para(gouvernance.info.vision); }
  if (gouvernance.info?.mission) { h2(t("gov_mission") || "Mission"); para(gouvernance.info.mission); }
  if (gouvernance.info?.valeurs) { h2(t("gov_values") || "Valeurs"); para(gouvernance.info.valeurs); }
  h2(t("rap_gov_board"));
  if (gouvernance.board.length > 0) {
    table([t("rap_col_name"), t("rap_col_role"), t("rap_col_mandate")],
      gouvernance.board.map((b) => [b.nomMembre, b.poste || "—", `${b.mandat_debut || "—"} - ${b.mandat_fin || t("gov_ongoing")}`]));
  } else para(t("rap_gov_board_none"));
  h2(t("rap_gov_elections").replace("{year}", String(year)));
  if (gouvernance.elections.length > 0) {
    gouvernance.elections.forEach((el) => {
      para(`${el.titre} (${el.date_fin || el.date_debut || "—"})`);
      if (el.results.length > 0) {
        table([t("rap_col_candidate"), t("rap_col_seat"), t("rap_col_votes")],
          el.results.map((r) => [r.nom, r.poste, String(r.votes)]));
      }
    });
  } else para(t("rap_gov_elections_none"));

  // ---------- Activités ----------
  h1(t("rap_section_activites"));
  h2(t("rap_act_events").replace("{year}", String(year)));
  if (activites.events.length > 0) {
    table([t("rap_col_event"), t("rap_col_date"), t("rap_col_place"), t("rap_col_confirmed")],
      activites.events.map((ev) => [ev.titre, toDatetimeLocal(ev.date_debut).slice(0, 10), ev.lieu || "—", String(ev.confirmes)]));
  } else para(t("rap_act_events_none"));
  h2(t("rap_act_projects"));
  if (activites.projects.length > 0) {
    table([t("rap_col_project"), t("rap_col_status"), t("rap_col_category")],
      activites.projects.map((p) => [p.nom, p.statut || "—", p.categorie || "—"]));
    para(t("rap_act_projects_note"));
  } else para(t("rap_act_projects_none"));

  // ---------- Covoiturage (suite 2026-10-08, claude/covoiturage-
  // administration-rapport-proposition.md) — n'apparaît que si le module
  // a jamais été actif ou utilisé, pour ne pas alourdir le rapport des
  // associations qui ne l'utilisent pas.
  if (covoiturage.moduleActif || covoiturage.tripsAnnee > 0 || covoiturage.incidentsRecusAnnee > 0) {
    h1(t("rap_section_covoiturage"));
    h2(t("rap_cov_impact_title"));
    table([t("rap_col_item"), t("rap_col_value")], [
      [t("rap_cov_trips"), String(covoiturage.tripsAnnee)],
      [t("rap_cov_km"), `${Math.round(covoiturage.totalKmAnnee)} km`],
      [t("rap_cov_co2"), `${Math.round(covoiturage.co2KgAnnee)} kg`],
    ]);
    para(t("rap_cov_impact_note"));

    h2(t("rap_cov_confiance_title"));
    table([t("rap_col_item"), t("rap_col_value")], [
      [t("rap_cov_verified"), String(covoiturage.verifiedCount)],
      [t("rap_cov_suspended"), String(covoiturage.suspendedCount)],
      [t("rap_cov_incidents_received").replace("{year}", String(year)), String(covoiturage.incidentsRecusAnnee)],
      [t("rap_cov_incidents_handled").replace("{year}", String(year)), String(covoiturage.incidentsTraitesAnnee)],
    ]);

    h2(t("rap_cov_fiabilite_title"));
    table([t("rap_col_item"), t("rap_col_value")], [
      [t("rap_cov_noshow").replace("{year}", String(year)), String(covoiturage.noShowAnnee)],
      [t("rap_cov_latecancel").replace("{year}", String(year)), String(covoiturage.lateCancelAnnee)],
    ]);

    if (covoiturage.facturation === "addon_payant" && covoiturage.addonPrix > 0) {
      para(t("rap_cov_facturation_addon").replace("{prix}", money(covoiturage.addonPrix, devise)));
    } else {
      para(t("rap_cov_facturation_inclus"));
    }
  }

  // ---------- Adhérents ----------
  h1(t("rap_section_members"));
  table([t("rap_col_item"), t("rap_col_value")], [
    [t("rap_mem_new").replace("{year}", String(year)), String(adherents.nouveauxAnnee)],
    [t("rap_mem_active_now"), String(adherents.totalActifsActuel)],
    [t("rap_mem_reg_rate"), `${adherents.tauxInscription}%`],
  ]);

  doc.save(`rapport_annuel_${slugify(association?.nom)}_${year}.pdf`);
}

export default function RapportAnnuel({ association, isPresident }) {
  const { t } = useLang();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState("");

  const startYear = association?.created_at ? new Date(association.created_at).getFullYear() : currentYear;
  const yearOptions = [];
  for (let y = currentYear; y >= Math.min(startYear, currentYear - 5); y--) yearOptions.push(y);
  if (yearOptions.length === 0) yearOptions.push(currentYear);

  async function genererRapport() {
    setGenLoading(true); setGenError("");
    try {
      const moisDebut = association?.exercice_mois_debut || 1;
      const { debut: yStart, fin: yEnd } = exerciceBounds(year, moisDebut);
      const inYear = (d) => !!d && d >= yStart && d <= yEnd;

      const [
        { data: members, error: eMem },
        { data: boardMembers, error: eBoard },
        { data: governanceInfo, error: eGov },
        { data: elections, error: eEl },
        { data: electionCandidats, error: eCand },
        { data: etatsElections, error: eVotes },
        { data: events, error: eEvents },
        { data: eventRsvps, error: eRsvps },
        { data: projects, error: eProj },
        { data: comptesCpt, error: eComptesCpt },
        { data: lignesEx, error: eLignesEx },
        { data: lignesOuv, error: eLignesOuv },
        { data: carpoolBookings },
        { data: carpoolIncidents },
      ] = await Promise.all([
        supabase.from("members").select("*"),
        supabase.from("board_members").select("*"),
        supabase.from("governance_info").select("*").maybeSingle(),
        supabase.from("elections").select("*"),
        supabase.from("election_candidats").select("*"),
        supabase.rpc("etat_elections"), // vote secret : voix agrégées, connues après clôture
        supabase.from("events").select("*"),
        supabase.from("event_rsvps").select("*"),
        supabase.from("projects").select("*"),
        supabase.from("comptes_comptables").select("*").order("ordre"),
        supabase.from("ecritures_comptables").select("compte_code, fonds, debit, credit, source_table").gte("date", yStart).lte("date", yEnd),
        supabase.from("ecritures_comptables").select("compte_code, fonds, debit, credit").lt("date", yStart),
        // Covoiturage (suite 2026-10-08) — requêtes tolérantes : le module
        // peut ne jamais avoir été utilisé par cette association, ou les
        // scripts SQL 2026-10-08j/k pas encore exécutés ; dans les deux
        // cas on obtient simplement des listes vides plutôt qu'une erreur
        // qui ferait échouer tout le rapport annuel.
        supabase.from("carpool_bookings").select("statut, distance_m, seats_reserved, terminee_at, created_at, no_show, annulation_tardive"),
        supabase.from("carpool_incidents").select("statut, created_at"),
      ]);
      if (eComptesCpt?.code === "42P01" || eLignesEx?.code === "42P01" || eLignesOuv?.code === "42P01") {
        throw new Error(t("cpt_not_installed"));
      }
      const firstError = eMem || eBoard || eGov || eEl || eCand || eVotes || eEvents || eRsvps || eProj || eComptesCpt || eLignesEx || eLignesOuv;
      if (firstError) throw firstError;
      // carpool_bookings/carpool_incidents sont volontairement exclus de
      // firstError (voir commentaire ci-dessus, requêtes tolérantes).

      const allMembers = members || [];
      const trulyActive = allMembers.filter((m) => m.statut === "Actif");
      const memberNameById = {}; allMembers.forEach((m) => { memberNameById[m.id] = m.nom; });

      // ---------- Finances — depuis le grand livre (suite 86, Phase C) ----------
      // Même logique que Comptabilite.jsx (Bilan/État des résultats/Évolution
      // de l'actif net), réimplémentée ici pour ne pas dépendre d'un import
      // React entre les deux composants — voir ce fichier pour la version
      // déjà validée en conditions réelles (Phases A/B/C).
      const devise = association?.devise_monetaire || "CAD";
      const comptesCptList = comptesCpt || [];
      const comptesById = Object.fromEntries(comptesCptList.map((c) => [c.code, c]));
      const lignesJusquFin = [...(lignesOuv || []), ...(lignesEx || [])];

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
      function soldeCompte(lignesArr, compte) {
        let debit = 0, credit = 0;
        for (const l of lignesArr) {
          if (l.compte_code !== compte.code) continue;
          debit += Number(l.debit) || 0; credit += Number(l.credit) || 0;
        }
        return compte.type === "passif" ? credit - debit : debit - credit;
      }
      function soldeCompteExercice(compte) {
        let total = 0;
        for (const l of (lignesEx || [])) {
          if (l.compte_code !== compte.code) continue;
          total += compte.type === "produit" ? (Number(l.credit) || 0) - (Number(l.debit) || 0) : (Number(l.debit) || 0) - (Number(l.credit) || 0);
        }
        return total;
      }
      function detailFondsType(type, fonds) {
        let total = 0;
        for (const l of (lignesEx || [])) {
          if (l.fonds !== fonds) continue;
          const compte = comptesById[l.compte_code];
          if (!compte || compte.type !== type) continue;
          total += type === "produit" ? (Number(l.credit) || 0) - (Number(l.debit) || 0) : (Number(l.debit) || 0) - (Number(l.credit) || 0);
        }
        return total;
      }

      const comptesActifRows = comptesCptList.filter((c) => c.type === "actif" && soldeCompte(lignesJusquFin, c) !== 0);
      const comptesPassifRows = comptesCptList.filter((c) => c.type === "passif" && soldeCompte(lignesJusquFin, c) !== 0);
      const totalActifCpt = comptesActifRows.reduce((s, c) => s + soldeCompte(lignesJusquFin, c), 0);
      const totalPassifCpt = comptesPassifRows.reduce((s, c) => s + soldeCompte(lignesJusquFin, c), 0);
      const actifNetParFonds = {
        general: calcActifNetFonds(lignesJusquFin, "general"),
        urgence: calcActifNetFonds(lignesJusquFin, "urgence"),
        secours: calcActifNetFonds(lignesJusquFin, "secours"),
      };

      const comptesProduitsRows = comptesCptList.filter((c) => c.type === "produit" && soldeCompteExercice(c) !== 0);
      const comptesChargesRows = comptesCptList.filter((c) => c.type === "charge" && soldeCompteExercice(c) !== 0);
      const totalProduitsCpt = comptesProduitsRows.reduce((s, c) => s + soldeCompteExercice(c), 0);
      const totalChargesCpt = comptesChargesRows.reduce((s, c) => s + soldeCompteExercice(c), 0);
      const excedentCpt = totalProduitsCpt - totalChargesCpt;
      const excedentParFonds = {
        general: detailFondsType("produit", "general") - detailFondsType("charge", "general"),
        urgence: detailFondsType("produit", "urgence") - detailFondsType("charge", "urgence"),
        secours: detailFondsType("produit", "secours") - detailFondsType("charge", "secours"),
      };

      const soldeOuvertureParFonds = {
        general: calcActifNetFonds(lignesOuv || [], "general"),
        urgence: calcActifNetFonds(lignesOuv || [], "urgence"),
        secours: calcActifNetFonds(lignesOuv || [], "secours"),
      };
      const soldeOuvertureTotalCpt = soldeOuvertureParFonds.general + soldeOuvertureParFonds.urgence + soldeOuvertureParFonds.secours;

      // Virements entre fonds (suite 87) : mêmes lignes taguées
      // `source_table = 'virement_fonds'` que dans Comptabilite.jsx — ne
      // touchent jamais l'excédent, seulement la répartition par fonds.
      function virementsFondsCpt(fonds) {
        let total = 0;
        for (const l of (lignesEx || [])) {
          if (l.fonds !== fonds || l.source_table !== "virement_fonds") continue;
          total += (Number(l.debit) || 0) - (Number(l.credit) || 0);
        }
        return total;
      }
      const virementsParFonds = {
        general: virementsFondsCpt("general"),
        urgence: virementsFondsCpt("urgence"),
        secours: virementsFondsCpt("secours"),
      };
      const virementsTotalCpt = virementsParFonds.general + virementsParFonds.urgence + virementsParFonds.secours;

      const soldeClotureParFonds = {
        general: soldeOuvertureParFonds.general + excedentParFonds.general + virementsParFonds.general,
        urgence: soldeOuvertureParFonds.urgence + excedentParFonds.urgence + virementsParFonds.urgence,
        secours: soldeOuvertureParFonds.secours + excedentParFonds.secours + virementsParFonds.secours,
      };
      const soldeClotureTotalCpt = soldeClotureParFonds.general + soldeClotureParFonds.urgence + soldeClotureParFonds.secours;

      // ---------- Gouvernance ----------
      const boardDuringYear = (boardMembers || [])
        .filter((b) => (!b.mandat_debut || b.mandat_debut <= yEnd) && (!b.mandat_fin || b.mandat_fin >= yStart))
        .map((b) => ({ ...b, nomMembre: memberNameById[b.member_id] || "—" }));
      const electionsAnnee = (elections || []).filter((e) => inYear(e.date_fin) || inYear(e.date_debut));
      const electionResults = electionsAnnee.map((e) => {
        const cands = (electionCandidats || []).filter((c) => c.election_id === e.id);
        const results = cands.map((c) => ({
          nom: memberNameById[c.member_id] || "—",
          poste: c.poste_vise || "",
          votes: Number((etatsElections || []).find((x) => x.election_id === e.id)?.voix?.[c.id] || 0),
        }));
        return { ...e, results };
      });

      // ---------- Activités ----------
      const eventsAnnee = (events || []).filter((ev) => inYear(toDatetimeLocal(ev.date_debut).slice(0, 10)));
      const eventsWithCounts = eventsAnnee.map((ev) => ({
        ...ev,
        confirmes: (eventRsvps || []).filter((r) => r.event_id === ev.id && r.statut === "confirme").length,
      }));
      const projectsSnapshot = (projects || []).map((p) => ({ nom: p.nom, statut: p.statut, categorie: p.categorie }));

      // ---------- Adhérents ----------
      const nouveauxAnnee = allMembers.filter((m) => inYear(m.date_adhesion)).length;
      const totalActifsActuel = trulyActive.length;
      const montantInscription = Number(association?.inscription_montant || 0);
      const tauxInscription = totalActifsActuel > 0 && montantInscription > 0
        ? Math.round((trulyActive.filter((m) => Number(m.inscription_paye || 0) >= montantInscription).length / totalActifsActuel) * 100)
        : 0;

      // ---------- Covoiturage (suite 2026-10-08) ----------
      // Vérifié/suspendu : état courant (comme totalActifsActuel plus haut),
      // pas une mesure annuelle — un badge ne « s'ouvre » pas pour une année
      // donnée. Trajets/km/CO2/incidents/fiabilité : mesurés sur l'année du
      // rapport, même logique que le reste (inYear).
      const allCarpoolBookings = carpoolBookings || [];
      const allCarpoolIncidents = carpoolIncidents || [];
      const tripsAnneeRows = allCarpoolBookings.filter((b) => b.statut === "terminee" && inYear((b.terminee_at || "").slice(0, 10)));
      const totalKmAnnee = tripsAnneeRows.reduce((s, b) => s + (Number(b.distance_m || 0) / 1000) * (b.seats_reserved || 1), 0);
      const covoiturage = {
        moduleActif: association?.covoiturage_module_actif ?? true,
        facturation: association?.covoiturage_facturation || "inclus",
        addonPrix: Number(association?.covoiturage_addon_prix_mensuel || 0),
        tripsAnnee: tripsAnneeRows.length,
        totalKmAnnee,
        co2KgAnnee: totalKmAnnee * 0.2,
        verifiedCount: allMembers.filter((m) => m.covoiturage_verifie).length,
        suspendedCount: allMembers.filter((m) => m.covoiturage_suspendu).length,
        incidentsRecusAnnee: allCarpoolIncidents.filter((i) => inYear((i.created_at || "").slice(0, 10))).length,
        incidentsTraitesAnnee: allCarpoolIncidents.filter((i) => i.statut === "traite" && inYear((i.created_at || "").slice(0, 10))).length,
        noShowAnnee: allCarpoolBookings.filter((b) => b.no_show && inYear((b.created_at || "").slice(0, 10))).length,
        lateCancelAnnee: allCarpoolBookings.filter((b) => b.annulation_tardive && inYear((b.created_at || "").slice(0, 10))).length,
      };

      await buildPdf({
        t, association, year, devise,
        finances: {
          exerciceDebut: yStart, exerciceFin: yEnd,
          comptesActif: comptesActifRows.map((c) => ({ nom: c.nom, solde: soldeCompte(lignesJusquFin, c) })),
          comptesPassif: comptesPassifRows.map((c) => ({ nom: c.nom, solde: soldeCompte(lignesJusquFin, c) })),
          totalActif: totalActifCpt, totalPassif: totalPassifCpt, totalActifNet: totalActifCpt - totalPassifCpt,
          actifNetParFonds,
          comptesProduits: comptesProduitsRows.map((c) => ({ nom: c.nom, solde: soldeCompteExercice(c) })),
          comptesCharges: comptesChargesRows.map((c) => ({ nom: c.nom, solde: soldeCompteExercice(c) })),
          totalProduits: totalProduitsCpt, totalCharges: totalChargesCpt, excedent: excedentCpt,
          excedentParFonds,
          soldeOuvertureParFonds, soldeOuvertureTotal: soldeOuvertureTotalCpt,
          virementsParFonds, virementsTotal: virementsTotalCpt,
          soldeClotureParFonds, soldeClotureTotal: soldeClotureTotalCpt,
        },
        gouvernance: { info: governanceInfo, board: boardDuringYear, elections: electionResults },
        activites: { events: eventsWithCounts, projects: projectsSnapshot },
        adherents: { nouveauxAnnee, totalActifsActuel, tauxInscription },
        covoiturage,
      });
    } catch (e) {
      console.error(e);
      setGenError(friendlyError(e, t));
    } finally {
      setGenLoading(false);
    }
  }

  async function exporterDonnees() {
    if (!window.confirm(t("rap_confirm_export"))) return;
    setExportLoading(true); setExportError("");
    try {
      const out = { export_version: 1, exported_at: new Date().toISOString(), association: null, tables: {}, errors: {} };
      const { data: assocRow, error: eAssoc } = await supabase.from("associations").select("*").eq("id", association.id).single();
      if (eAssoc) throw eAssoc;
      out.association = assocRow;
      await Promise.all(EXPORT_TABLES.map(async (table) => {
        try {
          const { data, error } = await supabase.from(table).select("*");
          if (error) throw error;
          out.tables[table] = data || [];
        } catch (e) {
          out.errors[table] = e.message || String(e);
        }
      }));
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export_${slugify(association?.nom)}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      setExportError(friendlyError(e, t));
    } finally {
      setExportLoading(false);
    }
  }

  return (
    <>
      <Card style={{ maxWidth: 480, marginTop: 22 }}>
        <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("rap_title")}</h3>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("rap_intro")}</p>
        <Field label={t("rap_year_label")}>
          <select style={inputStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <p style={{ fontSize: 11.5, color: "#686F7D", marginTop: -6, marginBottom: 12 }}>
          {t("cpt_exercice_range").replace("{debut}", exerciceBounds(year, association?.exercice_mois_debut || 1).debut).replace("{fin}", exerciceBounds(year, association?.exercice_mois_debut || 1).fin)}
        </p>
        {genError && <p style={{ fontSize: 12, color: "#C0392B", marginBottom: 10 }}>{genError}</p>}
        <Btn onClick={genererRapport} disabled={genLoading}>
          {genLoading ? t("rap_generating") : t("rap_generate_btn")}
        </Btn>
      </Card>

      {isPresident && (
        <Card style={{ maxWidth: 480, marginTop: 22 }}>
          <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("rap_export_title")}</h3>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("rap_export_intro")}</p>
          {exportError && <p style={{ fontSize: 12, color: "#C0392B", marginBottom: 10 }}>{exportError}</p>}
          <Btn variant="outline" onClick={exporterDonnees} disabled={exportLoading}>
            {exportLoading ? t("rap_exporting") : t("rap_export_btn")}
          </Btn>
        </Card>
      )}
    </>
  );
}
