import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense, Children } from "react";
import { createPortal } from "react-dom";
import {
  Users, LayoutDashboard, HeartHandshake, FileBarChart, Plus, ShieldCheck,
  CheckCircle2, Circle, Coffee, LifeBuoy, IdCard, Loader2, AlertTriangle,
 Bell, BellOff, FileText, History, Settings, Printer, LogOut, Download, Eye, EyeOff, Trash2, Pencil,
  Landmark, Rss, Kanban, CalendarDays, Gift, Vote, Building2, KeyRound, Copy, RefreshCw, CreditCard, X, ChevronDown, ChevronLeft,
  MoreVertical, Ban, Receipt, FileSignature, Upload, BarChart3, Wallet, Flower2, Gavel, QrCode, Search, Sparkles, ArrowRight, ChevronRight, UserCog,
  Globe, Layers, Car, Video, Briefcase, Dices, ShieldHalf, GraduationCap, ShoppingBasket,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { LangProvider, LanguageSwitcher, useLang, friendlyError, isNetworkError, cacheAuthSnapshot, readCachedAuthSnapshot, currencyOptions, timezoneOptions, OrgLegalSubline, WhatsAppShareButton, getPushSubscriptionState, subscribeToPush, unsubscribeFromPush, OfflineBanner, NotifBadge, foldText, TextSizeProvider, TextSizeControl, RECU_CATEGORIES, toDatetimeLocal } from "./shared";
import { useUnreadCounts } from "./useUnreadCounts";
import PresentationAssociation from "./PresentationAssociation";

// Chargement à la demande (2026-10-08) : chaque rubrique est téléchargée
// seulement quand on l'ouvre, au lieu d'un unique fichier de près de 2 Mo
// au démarrage — ouverture nettement plus rapide, surtout sur téléphone.
// lazyModule enveloppe chaque rubrique dans son propre <Suspense>, donc les
// endroits qui l'affichent n'ont pas à changer. `pick` sert aux exports
// nommés (ex. MyVolunteerSpace dans Projets).
function lazyModule(load, pick = "default") {
  const Lazy = lazy(() => load().then((m) => ({ default: m[pick] })));
  return function LazyModule(props) {
    return (
      <Suspense fallback={<ModuleLoader />}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
function ModuleLoader() {
  return (
    <div style={{ minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Loader2 size={24} color={EMERALD_DARK_DEFAULT} style={{ animation: "spin 1s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
const PublicShowcase = lazyModule(() => import("./PublicShowcase.jsx"));
const SuiviTrajet = lazyModule(() => import("./SuiviTrajet.jsx"));
const GestionAcces = lazyModule(() => import("./GestionAcces.jsx"));
const Gouvernance = lazyModule(() => import("./Gouvernance.jsx"));
import { CompteNonRelieBanner, AideDemandeAdhesion } from "./LiaisonCompte.jsx";
import MesEngagements from "./MesEngagements.jsx";
import { txtEvPlus, finValiditeBadge, downloadMemberBadgesPdf } from "./evenementsPlus";
import { mentionsLegales } from "./pdfOfficiel";
import ParametresBadges from "./ParametresBadges.jsx";
const VieAssociative = lazyModule(() => import("./VieAssociative.jsx"));
const Projets = lazyModule(() => import("./Projets"));
const MyVolunteerSpace = lazyModule(() => import("./Projets"), "MyVolunteerSpace");
const Evenements = lazyModule(() => import("./Evenements"));
const Sondages = lazyModule(() => import("./Sondages"));
const Funeraire = lazyModule(() => import("./Funeraire"));
const Sanctions = lazyModule(() => import("./Sanctions.jsx"));
const FinancesElargies = lazyModule(() => import("./FinancesElargies"));
const PaymentHistory = lazyModule(() => import("./PaymentHistory"));
const FinanceSynthese = lazyModule(() => import("./FinanceSynthese"));
const Comptabilite = lazyModule(() => import("./Comptabilite"));
const RapportAnnuel = lazyModule(() => import("./RapportAnnuel"));
const Presences = lazyModule(() => import("./Presences.jsx"));
const MyAttendanceHistory = lazyModule(() => import("./Presences.jsx"), "MyAttendanceHistory");
const Covoiturage = lazyModule(() => import("./Covoiturage.jsx"));
// Grille tarifaire du covoiturage (2026-10-09), affichée dans Configuration → Modules.
const CovoiturageTarifs = lazyModule(() => import("./CovoiturageTarifs.jsx"));
const Reunions = lazyModule(() => import("./Reunions.jsx"));
const Emploi = lazyModule(() => import("./Emploi.jsx"));
const Tirages = lazyModule(() => import("./Tirages.jsx"));
const ComiteRestreint = lazyModule(() => import("./ComiteRestreint.jsx"));
const Jeunesse = lazyModule(() => import("./Jeunesse.jsx"));
const AchatsGroupes = lazyModule(() => import("./AchatsGroupes.jsx"));

// =====================================================================
// CONSTANTES
// =====================================================================
const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const MONTH_KEYS = ["m_jan", "m_feb", "m_mar", "m_apr", "m_may", "m_jun", "m_jul", "m_aug", "m_sep", "m_oct", "m_nov", "m_dec"];
// Fréquence des réunions (Cotisation/Collation) : nombre de séances suivies par an selon la
// fréquence choisie par l'association (par défaut "mois" = comportement historique inchangé).
const PERIODES_PAR_AN = { semaine: 52, quinzaine: 26, trois_semaines: 17, mois: 12 };
const FREQ_LABEL_PREFIX = { semaine: "Semaine", quinzaine: "Quinzaine", trois_semaines: "Période" };
// Palette « Saphir profond & or antique » (suite 2026-10-06, harmonisation
// de toute l'application avec la maquette sidebar/diaporama validée par
// l'utilisateur — remplace le premier essai « émeraude Unia » du même jour,
// jugé trop vert). EMERALD_DARK_DEFAULT (couleur de marque par défaut,
// --primary, quand une association n'a pas personnalisé ses couleurs) passe
// au bleu saphir profond ; CHARCOAL (texte) à l'encre bleu-nuit ; BG au
// papier ivoire chaud ; l'or antique (#C8963E, voir les usages directs plus
// loin) remplace l'ancien or jaune comme accent par défaut. TEAL devient le
// vert « succès » sémantique (adhérent actif, paiement confirmé...),
// volontairement distinct de la couleur de marque pour ne plus jamais
// donner une impression générale "tout est vert". RED/AMBER inchangés
// (toujours sémantiquement alerte/avertissement partout dans l'appli).
const TEAL = "#1F8A5C";
const TEAL_LIGHT = "#E4F2EE";
const RED = "#C0392B";
const AMBER = "#8A5A00";
const CHARCOAL = "#182233";
const BG = "#FBF6EC";
const EMERALD_DARK_DEFAULT = "#0D3A63";

const ROLE_KEY_MAP = {
  super_admin: "role_super_admin", bureau_president: "role_bureau_president",
  bureau_secretaire: "role_bureau_secretaire", bureau_tresorier: "role_bureau_tresorier",
  responsable_rubrique: "role_responsable_rubrique", adherent: "role_adherent",
};
const RUBRIQUE_KEY_MAP = {
  inscription: "nav_inscription", tontine: "nav_tontine", collation: "nav_collation",
  fonds_urgence: "nav_urgence", fonds_secours: "nav_secours",
};
// Modules que le président peut autoriser ou retirer rôle par rôle
// (suite 2026-10-07, demandé par l'utilisateur — voir sql/2026-10-07d_
// configuration_roles_bureau.sql et GestionAcces.jsx). Mêmes ids que les
// entrées "bureau" de navItems plus bas, SAUF "apercu"/"dashboard"
// (orientation de base, toujours visibles) et "securite" (paramètres du
// compte de la personne elle-même, pas un module de gestion) — ces 3
// restent toujours accessibles à tout membre du bureau quel que soit son
// rôle.
const BUREAU_CONFIGURABLE_MODULES = [
  "membres", "inscription", "tontine", "collation", "urgence", "secours",
  "finances", "paiements_interac", "gouvernance", "vieassociative", "presences",
  "projets", "evenements", "covoiturage", "reunions", "emploi", "sondages", "tirages", "jeunesse", "achats",
  "funeraire", "sanctions", "comite", "dons", "emprunts", "documents", "annonces",
  "journal", "demandes_suppression", "acces", "config",
];
// Libellé de navigation déjà traduit à réutiliser pour chaque module
// ci-dessus, pour ne pas dupliquer les textes dans l'écran de
// configuration (GestionAcces.jsx).
const BUREAU_MODULE_LABEL_KEYS = {
  membres: "nav_members", inscription: "nav_inscription", tontine: "nav_tontine",
  collation: "nav_collation", urgence: "nav_urgence", secours: "nav_secours",
  finances: "nav_finances", paiements_interac: "nav_interac", gouvernance: "nav_governance",
  vieassociative: "nav_community", presences: "nav_presences", projets: "nav_projects",
  evenements: "nav_events", covoiturage: "nav_carpool", reunions: "nav_meetings",
  emploi: "nav_jobs", sondages: "nav_polls", tirages: "nav_draws", jeunesse: "nav_jeunesse", achats: "nav_achats", funeraire: "nav_funeraire",
  sanctions: "nav_sanctions", comite: "nav_comite", dons: "nav_donations", emprunts: "nav_loans",
  documents: "nav_documents", annonces: "nav_announcements", journal: "nav_activity",
  demandes_suppression: "nav_del_requests", acces: "nav_access", config: "nav_config",
};
// Regroupement visuel des onglets de navigation dans la sidebar (suite
// 2026-10-06, refonte navigation/couleurs demandée par l'utilisateur —
// remplace l'ancien menu horizontal à 26 items qui wrappait sur plusieurs
// lignes). Un id de navItems absent d'ici retombe sur "administration"
// (voir son usage dans MainApp) plutôt que de disparaître silencieusement.
// Suite 2026-10-08 : réorganisation en 7 espaces (nouveau groupe
// "entraide"). "comite", "achats" et "jeunesse" sont rangés d'avance :
// leurs modules arrivent par d'autres branches.
const NAV_GROUP_ORDER = ["accueil", "membres", "finances", "gouvernance", "vie", "entraide", "administration"];
const NAV_GROUP_LABEL_KEYS = {
  accueil: "navgroup_home", membres: "navgroup_members", finances: "navgroup_finances",
  gouvernance: "navgroup_governance", vie: "navgroup_life", entraide: "navgroup_mutual_aid",
  administration: "navgroup_admin",
};
const NAV_GROUP_OF = {
  apercu: "accueil", dashboard: "accueil", monespace: "accueil",
  membres: "membres", inscription: "membres", presences: "membres",
  tontine: "finances", collation: "finances", urgence: "finances", secours: "finances",
  finances: "finances", paiements_interac: "finances", dons: "finances", emprunts: "finances",
  gouvernance: "gouvernance", comite: "gouvernance", sanctions: "gouvernance", documents: "gouvernance",
  vieassociative: "vie", evenements: "vie", reunions: "vie", sondages: "vie",
  tirages: "vie", annonces: "vie", projets: "vie",
  covoiturage: "entraide", emploi: "entraide", funeraire: "entraide", achats: "entraide", jeunesse: "entraide",
  journal: "administration", demandes_suppression: "administration",
  acces: "administration", config: "administration", securite: "administration",
};
// Catégories de la banque de documents (onglet Documents) — distinct de RUBRIQUE_KEY_MAP
// ci-dessus (qui sert uniquement à l'étiquette de nav d'un rôle "responsable de rubrique").
// Couvre l'ensemble des sections de l'application pour qu'un document ait toujours un
// classement logique, avec une section dédiée aux procès-verbaux de réunion.
const DOC_CATEGORY_KEY_MAP = {
  general: "doc_general",
  pv_reunion: "doc_cat_pv_reunion",
  gouvernance: "doc_cat_gouvernance",
  inscription: "nav_inscription", tontine: "nav_tontine", collation: "nav_collation",
  fonds_urgence: "nav_urgence", fonds_secours: "nav_secours",
  // 2026-10-06 (demandé par l'utilisateur) — les pièces d'identité et les
  // preuves de paiement jointes lors d'une demande d'adhésion (voir
  // GestionAcces.jsx, archiveJoinDocument/saveCompleteMember) sont copiées
  // ici automatiquement dès que le bureau confirme l'adhésion, pour rester
  // consultables dans ce coffre-fort documentaire même après la disparition
  // de la demande qui les a apportées.
  piece_identite_adhesion: "doc_cat_piece_identite_adhesion",
  preuve_paiement_adhesion: "doc_cat_preuve_paiement_adhesion",
  // 2026-10-06 (demandé par l'utilisateur) — ordre du jour déposé lors de
  // la planification d'une réunion (Reunions.jsx) ; le procès-verbal
  // utilise la catégorie "pv_reunion" déjà existante ci-dessus.
  ordre_du_jour_reunion: "doc_cat_ordre_du_jour_reunion",
  finances: "doc_cat_finances",
  vie_associative: "doc_cat_vie_associative",
  projets: "doc_cat_projets",
  evenements: "doc_cat_evenements",
  dons: "doc_cat_dons",
  emprunts: "doc_cat_emprunts",
  autre: "doc_cat_autre",
};

// 2026-10-06 (demandé par l'utilisateur) — l'onglet Configuration était une
// seule longue colonne de 13 blocs : beaucoup de défilement pour retrouver
// une information précise. Réorganisé en catégories, même disposition
// (menu de gauche + contenu de droite) que l'onglet Documents ci-dessus,
// pour rester cohérent avec le reste de l'application plutôt que
// d'inventer un nouveau patron d'interface. Regroupement inspiré des
// pages de paramètres des plateformes de référence (Stripe, Slack,
// QuickBooks, Wild Apricot) : une catégorie par thème métier, jamais par
// type de champ.
const CONFIG_SECTIONS = [
  { id: "general", labelKey: "cfg_section_general", descKey: "cfg_section_general_desc", icon: Building2 },
  { id: "adhesion", labelKey: "cfg_section_adhesion", descKey: "cfg_section_adhesion_desc", icon: Users },
  { id: "modules", labelKey: "cfg_section_modules", descKey: "cfg_section_modules_desc", icon: Layers },
  { id: "vitrine", labelKey: "cfg_section_vitrine", descKey: "cfg_section_vitrine_desc", icon: Globe },
  { id: "documents_officiels", labelKey: "cfg_section_documents", descKey: "cfg_section_documents_desc", icon: FileSignature },
  { id: "gouvernance", labelKey: "cfg_section_gouvernance", descKey: "cfg_section_gouvernance_desc", icon: ShieldCheck },
  { id: "abonnement", labelKey: "cfg_section_abonnement", descKey: "cfg_section_abonnement_desc", icon: CreditCard },
  { id: "rapports", labelKey: "cfg_section_rapports", descKey: "cfg_section_rapports_desc", icon: BarChart3 },
];

// Même logique que money() dans shared.jsx (voir ses commentaires) — ce
// fichier garde sa propre copie locale depuis l'origine du projet plutôt
// que d'importer celle de shared.jsx ; les deux sont tenues identiques.
function money(n, devise = "CAD") {
  const v = Number(n) || 0;
  const code = (devise || "CAD").trim().toUpperCase();
  try {
    return new Intl.NumberFormat("fr-CA", { style: "currency", currency: code, currencyDisplay: "code" }).format(v);
  } catch {
    const sign = v < 0 ? "-" : "";
    return `${sign}${Math.abs(v).toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
  }
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
// Accepte la virgule ET le point comme séparateur décimal — un
// <input type="number"> HTML n'accepte QUE le point, et en refusant
// silencieusement toute virgule tapée (comportement natif du navigateur,
// indépendant de la langue affichée par l'app), il laisse le champ vide
// sans que l'utilisateur s'en rende compte. Les montants saisis
// librement (dons, remboursements de prêt, montant reçu Interac) passent
// donc par un <input type="text" inputMode="decimal"> et cette fonction
// plutôt que par type="number", pour rester utilisables au clavier
// français/canadien-français.
function parseDecimal(str) {
  if (typeof str !== "string") return Number(str) || 0;
  return Number(str.replace(",", ".").trim()) || 0;
}

// Fonds de secours uniquement : un adhérent n'est soumis au recouvrement
// d'une dépense que s'il a déjà acquitté son fonds de secours (montant
// configurable par association, 200 $ par défaut) ET, le cas échéant,
// terminé la période de probation de son association — comptée depuis sa
// date de PAIEMENT du fonds de secours (fonds_secours_date_paiement), pas
// depuis sa date d'adhésion (changement suite 51, 2026-09-11, à la
// demande explicite de l'utilisateur : la probation doit protéger contre
// un versement suivi d'une demande de recouvrement immédiate, pas contre
// une adhésion récente — un adhérent de longue date qui paie tardivement
// doit lui aussi patienter). Sans période de probation renseignée pour
// l'association (valeur par défaut), seule la condition de paiement
// s'applique — le recouvrement démarre dès que le fonds de secours est payé.
function estEligibleRecouvrementSecours(member, association) {
  const paye = Number(member?.fonds_secours_paye || 0);
  const montantFondsSecours = Number(association?.fonds_secours_montant || 200);
  if (paye < montantFondsSecours - 0.005) return false;
  const probationJours = Number(association?.periode_probation_secours_jours || 0);
  if (probationJours > 0 && member?.fonds_secours_date_paiement) {
    const dateEligible = new Date(member.fonds_secours_date_paiement);
    dateEligible.setDate(dateEligible.getDate() + probationJours);
    if (new Date() < dateEligible) return false;
  }
  return true;
}

// =====================================================================
// JOURNAL D'ACTIVITÉ — lisibilité (transforme les entrées brutes de
// `activity_log` en descriptions humaines au lieu du JSON brut)
// =====================================================================
const JRN_TABLE_LABEL_KEYS = {
  members: "jrn_table_members", loans: "jrn_table_loans", loan_repayments: "jrn_table_loan_repayments",
  fonds_recouvrements: "jrn_table_fonds_recouvrements", fonds_depenses: "jrn_table_fonds_depenses",
  projects: "jrn_table_projects", project_tasks: "jrn_table_project_tasks",
  events: "jrn_table_events", event_rsvps: "jrn_table_event_rsvps",
  donations: "jrn_table_donations", documents: "jrn_table_documents", announcements: "jrn_table_announcements",
  posts: "jrn_table_posts", elections: "jrn_table_elections", tirages: "jrn_table_tirages", comite_membres: "jrn_table_comite_membres",
  jeunesse_etudiants: "jrn_table_jeunesse_etudiants", jeunesse_mentors: "jrn_table_jeunesse_mentors",
  jeunesse_jumelages: "jrn_table_jeunesse_jumelages", jeunesse_seances: "jrn_table_jeunesse_seances",
  jeunesse_ressources: "jrn_table_jeunesse_ressources", jeunesse_bourses: "jrn_table_jeunesse_bourses",
  jeunesse_candidatures: "jrn_table_jeunesse_candidatures",
  achats_groupes: "jrn_table_achats_groupes", achats_souscriptions: "jrn_table_achats_souscriptions", achats_mouvements: "jrn_table_achats_mouvements",
  election_candidats: "jrn_table_election_candidats", election_votes: "jrn_table_election_votes",
  election_comite: "jrn_table_election_comite", election_procurations: "jrn_table_election_procurations",
  tontine_seances: "jrn_table_tontine_seances", tontine_presences: "jrn_table_tontine_presences",
  collation_presences: "jrn_table_collation_presences", board_members: "jrn_table_board_members",
  governance_info: "jrn_table_governance_info", associations: "jrn_table_associations",
  profiles: "jrn_table_profiles", subscriptions: "jrn_table_subscriptions",
};
const JRN_SKIP_FIELDS = ["id", "created_at", "updated_at", "association_id"];
const JRN_MONEY_FIELDS = ["montant", "montant_pret", "montant_total", "quote_part", "collation_montant_paye", "montant_verse", "prix", "cotisation", "montant_don"];
const JRN_PERCENT_FIELDS = ["taux_interet"];
const JRN_BOOL_FIELDS = ["paye", "urgent", "inscription_paye", "disponible_benevolat", "fonds_urgence_paye", "fonds_secours_paye"];
const JRN_IDENTIFIER_FIELDS = ["nom", "titre", "nom_complet", "email", "description", "message"];

function jrnTableLabel(tableName, t) {
  const key = JRN_TABLE_LABEL_KEYS[tableName];
  return key ? t(key) : (tableName || "—").replace(/_/g, " ");
}
function jrnActionLabel(action, t) {
  if (action === "INSERT") return t("jrn_action_insert");
  if (action === "UPDATE") return t("jrn_action_update");
  if (action === "DELETE") return t("jrn_action_delete");
  return action || "—";
}
function jrnActionColor(action) {
  if (action === "INSERT") return "#1F8A5C";
  if (action === "UPDATE") return "#B7791F";
  if (action === "DELETE") return "#C0392B";
  return "#5B6270";
}
function jrnHumanizeKey(key) {
  return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
function jrnFormatValue(key, val, lang, moneyF) {
  if (val === null || val === undefined || val === "") return "—";
  if (JRN_MONEY_FIELDS.includes(key)) return moneyF(val);
  if (JRN_PERCENT_FIELDS.includes(key)) return `${val}%`;
  if (JRN_BOOL_FIELDS.includes(key) || typeof val === "boolean") return val ? (lang === "en" ? "Yes" : "Oui") : (lang === "en" ? "No" : "Non");
  if (key === "sexe") return val === "M" ? (lang === "en" ? "Male" : "Masculin") : val === "F" ? (lang === "en" ? "Female" : "Féminin") : String(val);
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA");
  }
  return s.length > 70 ? s.slice(0, 67) + "…" : s;
}
// Sexe de l'adhérent ('M'/'F', colonne members.sexe, suite 73 — 2026-09-21) :
// libellé complet affiché partout où le champ apparaît (tableau, formulaires,
// historique, fiche complète), plutôt que le code brut stocké en base.
function sexeLabel(sexe, t) {
  return sexe === "M" ? t("mem_sexe_m") : sexe === "F" ? t("mem_sexe_f") : "—";
}
function jrnIdentifier(row) {
  if (!row || typeof row !== "object") return "";
  for (const f of JRN_IDENTIFIER_FIELDS) {
    if (row[f]) return String(row[f]).slice(0, 50);
  }
  return "";
}
function describeActivityLog(log, t, lang, moneyF) {
  const tableLabel = jrnTableLabel(log.table_name, t);
  const ancien = log.details?.ancien;
  const nouveau = log.details?.nouveau;
  if (log.action === "INSERT") {
    const id = jrnIdentifier(nouveau || log.details);
    return id ? t("jrn_desc_created_named").replace("{table}", tableLabel).replace("{name}", id) : t("jrn_desc_created").replace("{table}", tableLabel);
  }
  if (log.action === "DELETE") {
    const id = jrnIdentifier(ancien || log.details);
    return id ? t("jrn_desc_deleted_named").replace("{table}", tableLabel).replace("{name}", id) : t("jrn_desc_deleted").replace("{table}", tableLabel);
  }
  if (log.action === "UPDATE" && ancien && nouveau) {
    const lines = [];
    Object.keys(nouveau).forEach((key) => {
      if (JRN_SKIP_FIELDS.includes(key)) return;
      if (JSON.stringify(ancien[key]) === JSON.stringify(nouveau[key])) return;
      const oldVal = jrnFormatValue(key, ancien[key], lang, moneyF);
      const newVal = jrnFormatValue(key, nouveau[key], lang, moneyF);
      lines.push(`${jrnHumanizeKey(key)} : ${oldVal} → ${newVal}`);
    });
    const id = jrnIdentifier(nouveau);
    const prefix = id ? `${id} — ` : "";
    return lines.length ? prefix + lines.join(" · ") : t("jrn_desc_updated_nofields").replace("{table}", tableLabel);
  }
  return `${jrnActionLabel(log.action, t)} — ${tableLabel}`;
}

// =====================================================================
// PRIMITIVES UI (couleurs dynamiques via variables CSS --primary/--accent)
// =====================================================================
function Section({ children, style }) { return <section style={{ padding: "32px 0", ...style }}>{children}</section>; }
function Container({ children, style }) { return <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", ...style }}>{children}</div>; }
function Pill({ children, color = TEAL, bg = TEAL_LIGHT }) {
  return <span style={{ display: "inline-block", background: bg, color, fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", padding: "4px 12px", borderRadius: 999 }}>{children}</span>;
}
function Card({ children, style, ...rest }) {
  // overflowWrap + minWidth : voir le commentaire sur Card dans
  // shared.jsx (même correctif appliqué aux deux copies du composant,
  // suite Phase 6, 2026-09-29).
  return <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 4px 18px rgba(31,56,100,0.08)", borderTop: "3px solid transparent", overflowWrap: "break-word", minWidth: 0, ...style }} {...rest}>{children}</div>;
}
function RuleBox({ children }) {
  return <div style={{ background: "#FBF3D9", border: "1px solid #EEDDA0", borderRadius: 10, padding: "12px 16px", marginBottom: 18, fontSize: 13, color: "#8a6d1a" }}>{children}</div>;
}
function StatCard({ label, value, accent, icon: Icon, onClick, actionLabel, active, menuItems, menuAriaLabel }) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const clickable = typeof onClick === "function";
  const hasMenu = Array.isArray(menuItems) && menuItems.length > 0;
  return (
    <Card
      style={{
        position: "relative",
        borderTopColor: accent || "var(--accent)",
        cursor: clickable ? "pointer" : "default",
        transition: "box-shadow .15s ease, transform .15s ease, border-color .15s ease",
        boxShadow: (clickable || hasMenu) && (hover || active || menuOpen) ? "0 8px 22px rgba(31,56,100,0.16)" : undefined,
        transform: clickable && (hover || active) ? "translateY(-2px)" : undefined,
        border: active ? "1.5px solid var(--accent)" : "1.5px solid transparent",
      }}
      onClick={clickable ? onClick : undefined}
      onMouseEnter={clickable ? () => setHover(true) : undefined}
      onMouseLeave={clickable ? () => setHover(false) : undefined}
    >
      {hasMenu && (
        <div style={{ position: "absolute", top: 8, right: 8 }} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuAriaLabel || "Actions"}
            style={{ background: menuOpen ? "#F1F2F4" : "none", border: "none", cursor: "pointer", color: "#8A8F98", padding: 5, borderRadius: 7, display: "flex" }}
          >
            <MoreVertical size={16} />
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "white", borderRadius: 10, boxShadow: "0 10px 30px rgba(20,30,50,0.2)", minWidth: 220, zIndex: 21, overflow: "hidden", border: "1px solid #EEE" }}>
                {menuItems.map((mi) => (
                  <button
                    key={mi.key}
                    onClick={() => { setMenuOpen(false); mi.onClick(); }}
                    style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "10px 13px", background: "none", border: "none", borderBottom: "1px solid #F3F3F1", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: mi.danger ? RED : "var(--primary)" }}
                  >
                    {mi.icon && <mi.icon size={14} />} {mi.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 700, color: TEAL, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        {Icon && <Icon size={14} />}{label}
      </div>
      <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 22, color: "var(--primary)" }}>{value}</div>
      {clickable && !hasMenu && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 10, fontSize: 11, fontWeight: 700, color: "var(--primary-dark)", background: "var(--accent)", padding: "3px 10px", borderRadius: 999, opacity: hover || active ? 1 : 0.82 }}>
          <CreditCard size={11} /> {actionLabel}
        </div>
      )}
    </Card>
  );
}
// Carte de rubrique dédiée à « Mon espace » (suite 53, 2026-09-11) — porte
// le design retenu par l'utilisateur sur la maquette « Relevé financier »
// (badge icône, pastille de statut, barre de progression). Volontairement
// un composant séparé du StatCard générique (utilisé partout ailleurs :
// tableau de bord, écrans bureau Inscription/Cotisation/Collation/Fonds)
// pour ne changer l'apparence QUE dans Mon espace, sans rien affecter aux
// autres écrans. Reprend exactement le même mécanisme d'actions (menu ⋮
// alimenté par buildMenuItems) que l'ancien StatCard utilisé ici — seule
// l'apparence change, aucun comportement de paiement/Interac/reçu n'est
// modifié.
function MonEspaceCard({ icon: Icon, label, paidLabel, dueLabel, percent, progressTone, pillText, pillTone, settled, liability, footNote, active, menuItems, menuAriaLabel }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMenu = Array.isArray(menuItems) && menuItems.length > 0;
  const pillStyles = {
    ok: { bg: TEAL_LIGHT, color: TEAL },
    warn: { bg: "#FBF3D9", color: AMBER },
    debt: { bg: "#FBE4E1", color: RED },
  };
  const pillStyle = pillStyles[pillTone] || pillStyles.ok;
  const badgeBg = liability ? "#FBE4E1" : "#EAEDF6";
  const badgeColor = liability ? RED : "var(--primary)";
  return (
    <div
      style={{
        background: settled ? "#F8F9FC" : "white",
        border: active ? "1.5px solid var(--accent)" : "1px solid #E7E9F1",
        borderRadius: 13, padding: "18px 18px 16px",
        boxShadow: menuOpen || active ? "0 8px 22px rgba(31,56,100,0.14)" : "0 3px 12px rgba(31,56,100,0.06)",
        transition: "box-shadow .15s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 13 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: badgeBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {Icon && <Icon size={17} color={badgeColor} />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {pillText && (
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", padding: "4px 9px", borderRadius: 999, whiteSpace: "nowrap", background: pillStyle.bg, color: pillStyle.color }}>
              {pillText}
            </span>
          )}
          {hasMenu && (
            <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={menuAriaLabel || "Actions"}
                style={{ background: menuOpen ? "#F1F2F4" : "none", border: "none", cursor: "pointer", color: "#8A8F98", padding: 5, borderRadius: 7, display: "flex" }}
              >
                <MoreVertical size={16} />
              </button>
              {menuOpen && (
                <>
                  <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
                  <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "white", borderRadius: 10, boxShadow: "0 10px 30px rgba(20,30,50,0.2)", minWidth: 220, zIndex: 21, overflow: "hidden", border: "1px solid #EEE" }}>
                    {menuItems.map((mi) => (
                      <button
                        key={mi.key}
                        onClick={() => { setMenuOpen(false); mi.onClick(); }}
                        style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "10px 13px", background: "none", border: "none", borderBottom: "1px solid #F3F3F1", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: mi.danger ? RED : "var(--primary)" }}
                      >
                        {mi.icon && <mi.icon size={14} />} {mi.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#555F73", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 22, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>
        {paidLabel}{dueLabel && <span style={{ fontWeight: 500, fontSize: 13.5, color: "#9AA2B5" }}> / {dueLabel}</span>}
      </div>
      {typeof percent === "number" ? (
        <div style={{ height: 6, borderRadius: 999, background: "#E7EAF2", marginTop: 12, overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: 999, width: `${Math.min(100, Math.max(0, percent))}%`, background: progressTone === "warn" ? AMBER : TEAL }} />
        </div>
      ) : footNote ? (
        <div style={{ fontSize: 11.5, color: "#9AA2B5", marginTop: 9 }}>{footNote}</div>
      ) : null}
    </div>
  );
}
// Astérisque automatique sur les champs obligatoires (même règle que Field
// dans shared.jsx) : dès que le champ direct porte `required`, ou <Field required>.
function Field({ label, children, required }) {
  const obligatoire = required ?? Children.toArray(children).some((c) => c?.props?.required);
  return <div style={{ marginBottom: 14 }}><label style={{ display: "block", fontWeight: 600, fontSize: 13, color: "var(--primary)", marginBottom: 5 }}>{label}{obligatoire && <span aria-hidden="true" style={{ color: "#C0392B", marginLeft: 3 }}>*</span>}</label>{children}</div>;
}
const inputStyle = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #DCE0E8", fontSize: 14, fontFamily: "inherit", background: "white", boxSizing: "border-box" };
// Écran de remplacement affiché à la place d'un volet Premium quand
// l'association est à l'essai ou en Standard (suite 2026-10-06, voir le
// commentaire sur PREMIUM_FEATURE_IDS dans MainApp). `compact` donne une
// version plus petite, pour un bloc intégré dans un onglet par ailleurs
// accessible (ex. Comptabilité professionnelle dans Finances) plutôt
// qu'un onglet entièrement dédié.
function PremiumLocked({ label, features, onUpgrade, compact }) {
  const { t } = useLang();
  return (
    <Card style={{ maxWidth: compact ? "100%" : 480, margin: compact ? 0 : "40px auto", padding: compact ? 24 : 32, borderTopColor: "#C8963E" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "#FBF3D9", color: "#8F6A24", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
          <KeyRound size={20} />
        </div>
        <h3 style={{ marginBottom: 6, fontSize: compact ? 15 : 17 }}>{label}</h3>
        <p style={{ color: "#5B6270", fontSize: 13, marginBottom: 16 }}>{t("premium_locked_text")}</p>
      </div>
      {/* Liste de ce que le module comprend (suite 2026-10-06, demande
          explicite de l'utilisateur : « une présentation de ce que ce
          module fait exactement ... pour inciter l'association à passer
          à l'action ») — contenu repris de tarification-standard-premium-
          proposition.md, §2, colonne « Ce qu'il ajoute ». */}
      {features && features.length > 0 && (
        <ul style={{ listStyle: "none", margin: "0 0 20px", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {features.map((f, i) => (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#333", textAlign: "left" }}>
              <CheckCircle2 size={15} color="#1F8A5C" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ textAlign: "center" }}>
        <Btn onClick={onUpgrade} style={{ background: "#C8963E", color: "#182233" }}>{t("premium_locked_cta")}</Btn>
      </div>
    </Card>
  );
}
// Verrou distinct du PremiumLocked ci-dessus (suite 2026-10-08, demande de
// l'utilisateur : « je donne accès à l'association que je veux, je ne suis
// pas obligé de l'ouvrir pour toutes ») — covoiturage_module_actif
// (associations) est un verrou que seul le Super-Admin contrôle (voir
// activer_module_covoiturage, sql/2026-10-08d_activation_module_
// covoiturage.sql), indépendant du forfait Standard/Premium : une
// association Premium peut malgré tout ne pas encore avoir ce module, le
// temps d'un déploiement progressif. Pas de bouton « Passer à Premium » ici
// puisque payer ne change rien à ce verrou précis.
function ModuleRestreintSuperAdmin({ label }) {
  const { t } = useLang();
  return (
    <Card style={{ maxWidth: 480, margin: "40px auto", padding: 32, borderTopColor: EMERALD_DARK_DEFAULT }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "#E7EEF5", color: EMERALD_DARK_DEFAULT, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
          <ShieldCheck size={20} />
        </div>
        <h3 style={{ marginBottom: 6, fontSize: 17 }}>{label}</h3>
        <p style={{ color: "#5B6270", fontSize: 13, margin: 0 }}>{t("module_restreint_text")}</p>
      </div>
    </Card>
  );
}
function Btn({ children, onClick, variant = "primary", disabled, type = "button", style }) {
  const base = { display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 999, fontWeight: 600, fontSize: 14, cursor: disabled ? "not-allowed" : "pointer", border: "none", opacity: disabled ? 0.6 : 1 };
  const variants = {
    primary: { background: "var(--accent)", color: "var(--primary-dark)" },
    outline: { background: "transparent", color: "var(--primary)", border: "2px solid var(--primary)" },
    outlineWhite: { background: "transparent", color: "white", border: "2px solid rgba(255,255,255,.6)" },
    danger: { background: RED, color: "white" },
  };
  return <button type={type} onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant], ...style }}>{children}</button>;
}
// Petits composants d'affichage pour le panneau de résultats de la
// recherche globale (Phase 6, feuille de route, 2026-09-29) — un groupe
// par catégorie (membres, documents, transactions, événements, projets,
// annonces), chacun listant ses résultats sous forme de ligne cliquable.
function SearchGroup({ label, children }) {
  return (
    <div>
      <div style={{ padding: "8px 13px 4px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#9AA2B5" }}>{label}</div>
      {children}
    </div>
  );
}
function SearchResultRow({ icon: Icon, title, subtitle, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "8px 13px", background: hover ? "#F6F7FA" : "none", border: "none", borderBottom: "1px solid #F3F3F1", cursor: "pointer" }}
    >
      {Icon && <Icon size={14} color="#8A8F98" style={{ flexShrink: 0 }} />}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: "#9AA2B5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</div>}
      </div>
    </button>
  );
}
// Avatar (photo réelle ou initiales) — composant réutilisable (suite
// Phase 6, 2026-09-29, demande explicite de l'utilisateur) pour afficher
// la vraie photo du membre (members.photo_url, déjà utilisée ailleurs
// dans l'appli : annuaire de Vie associative, vitrine publique, fiche
// complète d'un membre) partout où un rond réservé à la photo n'affichait
// jusqu'ici que les initiales sans jamais vérifier si une photo existait
// — l'en-tête (à côté du nom) et la carte de Mon espace. Retombe sur les
// initiales (fond dégradé) quand aucune photo n'est enregistrée, comme
// avant.
function Avatar({ photoUrl, name, size = 32, fontSize }) {
  const fs = fontSize || Math.round(size * 0.36);
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "linear-gradient(155deg, var(--primary), var(--primary-dark))", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Poppins, sans-serif", fontWeight: 600, fontSize: fs, flexShrink: 0, overflow: "hidden", boxShadow: "0 3px 10px rgba(31,56,100,.25)" }}>
      {photoUrl ? <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (initialsOf(name).slice(0, 2) || "?")}
    </div>
  );
}
function Table({ head, children }) {
  return (
    <div className="table-scroll" style={{ overflowX: "auto", borderRadius: 12, boxShadow: "0 4px 18px rgba(31,56,100,0.08)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead><tr>{head.map((h) => <th key={h} style={{ textAlign: "left", background: "var(--primary)", color: "white", padding: "7px 9px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".03em" }}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const td = { padding: "7px 9px", borderBottom: "1px solid #EEE" };
function Banner({ children, tone = "info" }) {
  const tones = { info: [TEAL_LIGHT, TEAL], warn: ["#FBE4E1", RED] };
  const [bg, color] = tones[tone];
  return <div style={{ background: bg, color, padding: "8px 24px", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}><AlertTriangle size={14} /> {children}</div>;
}

// =====================================================================
// APPLICATION RACINE — gère l'authentification puis délègue
// =====================================================================
export default function PlatformApp() {
  return (
    <LangProvider>
      <TextSizeProvider>
        <PlatformAppInner />
      </TextSizeProvider>
    </LangProvider>
  );
}

function PlatformAppInner() {const { t } = useLang();
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

  // Vitrine publique (Phase 4, suite 91) : une adresse avec ?pub=<slug>
  // (page de présentation/calendrier/formulaire d'adhésion d'une
  // association) ou ?verify=<jeton> (vérification d'une carte de membre)
  // affiche la zone publique directement, SANS jamais passer par l'écran
  // de connexion — peu importe l'état de la session. C'est la seule
  // partie de l'application accessible sans compte, vérifiée avant tout
  // le reste (y compris avant la fin du chargement de la session, pour
  // qu'un visiteur non connecté ne voie jamais l'écran de connexion
  // clignoter avant la page publique).
  const publicParams = new URLSearchParams(window.location.search);
  const publicSlug = publicParams.get("pub");
  const verifyToken = publicParams.get("verify");
  // Page de suivi public d'un projet (modernisation Projets, 2026-09-30) :
  // ?pub=<slug>&projet=<id> — combine le slug de l'association (déjà
  // requis pour identifier l'association publiquement) et l'id du
  // projet ciblé. Double condition vérifiée côté vues SQL uniquement
  // (vitrine_active + projects.public_suivi) — jamais côté client.
  const publicProjectId = publicParams.get("projet");
  // Page publique dédiée à un événement (modernisation Événements,
  // 2026-09-30) : ?pub=<slug>&evenement=<id> — même patron exact que
  // ?pub=<slug>&projet=<id> ci-dessus.
  const publicEventId = publicParams.get("evenement");
  // Page de suivi public d'un trajet de covoiturage (dispatch sophistiqué,
  // 2026-10-07) : ?suivi=<jeton> — même patron que ?verify=<jeton>
  // ci-dessus, mais dédié au covoiturage (statut de la course + position
  // en direct pendant la course active, jamais les coordonnées des
  // personnes). Géré par un composant séparé (SuiviTrajet.jsx), pas par
  // PublicShowcase, car il interroge une fonction publique différente
  // (consulter_partage_trajet) et se rafraîchit en direct.
  const suiviToken = publicParams.get("suivi");
  if (publicSlug || verifyToken) {
    return <PublicShowcase slug={publicSlug} verifyToken={verifyToken} projectId={publicProjectId} eventId={publicEventId} />;
  }
  if (suiviToken) {
    return <SuiviTrajet token={suiviToken} />;
  }

  // OfflineBanner tout en haut, une seule fois pour toute l'application
  // (mode hors-ligne/PWA, suite 84) — couvre l'écran de connexion comme
  // l'application une fois connectée, sans dupliquer le composant.
  return (
    <>
      <OfflineBanner />
      {authLoading ? <FullPageLoader text={t("load_generic")} /> : !session ? <LandingAuthScreen /> : <AuthenticatedApp session={session} />}
    </>
  );
}

function FullPageLoader({ text }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: BG, fontFamily: "Inter, sans-serif", flexDirection: "column", gap: 12 }}>
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <Loader2 size={28} color={EMERALD_DARK_DEFAULT} className="spin" />
      <p style={{ color: EMERALD_DARK_DEFAULT, fontWeight: 600 }}>{text}</p>
    </div>
  );
}

function BlockedAccountScreen() {
  const { t } = useLang();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: BG, fontFamily: "Inter, sans-serif", flexDirection: "column", gap: 14, padding: 24, textAlign: "center" }}>
      <ShieldCheck size={36} color={RED} />
      <h2 style={{ color: EMERALD_DARK_DEFAULT, margin: 0 }}>{t("blocked_title")}</h2>
      <p style={{ color: "#5B6270", maxWidth: 380, margin: 0 }}>{t("blocked_text")}</p>
      <Btn onClick={() => supabase.auth.signOut()} style={{ background: EMERALD_DARK_DEFAULT, color: "white" }}>{t("action_logout")}</Btn>
    </div>
  );
}

// 2026-10-10 (signalé par l'utilisateur) — un compte qui rejoint par code
// d'invitation n'a accès à l'espace qu'après validation du bureau
// (profiles.acces_en_attente, sql/2026-10-10k_adhesion_validation_bureau.sql).
// L'écran vérifie toutes les 30 s et s'ouvre dès la validation.
const ATTENTE_TXT = {
  fr: { titre: "Demande en attente de validation", texte: "Votre demande d'adhésion{a} a bien été transmise. Le bureau doit la valider avant que vous ayez accès à l'espace de l'association. Vous recevrez une notification dès qu'elle sera acceptée.", refus: "Votre demande d'adhésion{a} n'a pas été acceptée par le bureau. Contactez-le pour en savoir plus.", verifier: "Vérifier maintenant" },
  en: { titre: "Request awaiting approval", texte: "Your membership request{a} has been sent. The board must approve it before you can access the association's space. You will be notified as soon as it is accepted.", refus: "Your membership request{a} was not accepted by the board. Contact them for more information.", verifier: "Check now" },
};
function PendingAccessScreen() {
  const { t, lang } = useLang();
  const T = ATTENTE_TXT[lang === "en" ? "en" : "fr"];
  const [info, setInfo] = useState(null);
  const verifier = useCallback(async () => {
    const { data } = await supabase.rpc("mon_statut_adhesion");
    if (data && data.en_attente === false) { window.location.reload(); return; }
    if (data) setInfo(data);
  }, []);
  useEffect(() => { verifier(); const id = setInterval(verifier, 30000); return () => clearInterval(id); }, [verifier]);
  const a = info?.association ? (lang === "en" ? ` to ${info.association}` : ` à « ${info.association} »`) : "";
  const refus = info?.statut === "rejete";
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: BG, fontFamily: "Inter, sans-serif", flexDirection: "column", gap: 14, padding: 24, textAlign: "center" }}>
      <ShieldCheck size={36} color={refus ? RED : EMERALD_DARK_DEFAULT} />
      <h2 style={{ color: EMERALD_DARK_DEFAULT, margin: 0 }}>{T.titre}</h2>
      <p style={{ color: "#5B6270", maxWidth: 420, margin: 0 }}>{(refus ? T.refus : T.texte).replace("{a}", a)}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {!refus && <Btn variant="outline" onClick={verifier}>{T.verifier}</Btn>}
        <Btn onClick={() => supabase.auth.signOut()} style={{ background: EMERALD_DARK_DEFAULT, color: "white" }}>{t("action_logout")}</Btn>
      </div>
    </div>
  );
}

// =====================================================================
// CompleteJoinRequestForm — 2026-10-06, demandé par l'utilisateur.
// =====================================================================
// Affiché juste après la création du compte pour un rattachement par code
// d'invitation (AuthenticatedApp.load(), plus haut), AVANT que la demande
// n'atteigne le bureau : la personne remplit elle-même sa fiche adhérent
// complète et joint sa pièce d'identité + une preuve de paiement de
// l'inscription (ou une simple déclaration si elle n'a pas de preuve) —
// pour que le bureau n'ait plus qu'à vérifier et valider dans Gestion des
// accès, sans rien ressaisir (voir CompleteMemberModal, GestionAcces.jsx).
// =====================================================================
function CompleteJoinRequestForm({ defaultEmail, onSubmit, onCancel }) {
  const { t } = useLang();
  const [form, setForm] = useState({
    courriel: defaultEmail || "", telephone: "", sexe: "", dateNaissance: "", quartier: "",
    competences: "", disponibleBenevolat: false,
    pieceIdentiteFile: null,
    paiementMode: "non_paye", paiementMontant: "", paiementFile: null, paiementNote: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await onSubmit(form);
    } catch (e2) {
      setErr(friendlyError(e2, t));
      setBusy(false);
    }
    // Pas de setBusy(false) dans le cas succès : onSubmit déclenche
    // finishJoinRequest → load(), qui démonte cet écran (remplacé par le
    // FullPageLoader, puis la vraie application).
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "Inter, sans-serif", padding: "32px 16px", display: "flex", justifyContent: "center" }}>
      <div style={{ background: "white", borderRadius: 16, padding: 32, width: 640, maxWidth: "100%", boxShadow: "0 10px 40px rgba(0,0,0,.08)", alignSelf: "flex-start" }}>
        <h2 style={{ color: EMERALD_DARK_DEFAULT, marginBottom: 6 }}>{t("join_complete_title")}</h2>
        <p style={{ color: "#5B6270", fontSize: 13.5, marginBottom: 24 }}>{t("join_complete_intro")}</p>
        <AideDemandeAdhesion />
        {err && <p style={{ color: RED, fontSize: 13, marginBottom: 16 }}>{err}</p>}
        <form onSubmit={handleSubmit}>
          <p style={{ fontSize: 12, color: "#5B6270", margin: "0 0 14px" }}><span style={{ color: "#C0392B" }}>*</span> {t("champ_obligatoire")}</p>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>{t("join_complete_section_fiche")}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 20 }}>
            <Field label={t("mem_email")}><input type="email" required style={inputStyle} value={form.courriel} onChange={(e) => setForm((p) => ({ ...p, courriel: e.target.value }))} /></Field>
            <Field label={t("mem_phone")}><input type="tel" required style={inputStyle} value={form.telephone} onChange={(e) => setForm((p) => ({ ...p, telephone: e.target.value }))} placeholder={t("mem_phone_placeholder")} /></Field>
            <Field label={t("mem_sexe")}>
              <select style={inputStyle} value={form.sexe} onChange={(e) => setForm((p) => ({ ...p, sexe: e.target.value }))}>
                <option value="">{t("mem_sexe_placeholder")}</option>
                <option value="M">{t("mem_sexe_m")}</option>
                <option value="F">{t("mem_sexe_f")}</option>
              </select>
            </Field>
            <Field label={t("mem_birthdate")}><input type="date" required style={inputStyle} value={form.dateNaissance} onChange={(e) => setForm((p) => ({ ...p, dateNaissance: e.target.value }))} /></Field>
            <Field label={t("mem_address")}><input required style={inputStyle} value={form.quartier} onChange={(e) => setForm((p) => ({ ...p, quartier: e.target.value }))} /></Field>
            <Field label={t("mem_skills")}><input style={inputStyle} value={form.competences} onChange={(e) => setForm((p) => ({ ...p, competences: e.target.value }))} placeholder={t("mem_skills_placeholder")} /></Field>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 24, cursor: "pointer" }}>
            <input type="checkbox" checked={form.disponibleBenevolat} onChange={(e) => setForm((p) => ({ ...p, disponibleBenevolat: e.target.checked }))} />
            {t("mem_volunteer")}
          </label>

          <h3 style={{ fontSize: 14, marginBottom: 6 }}>{t("join_complete_section_identite")}</h3>
          <Field label={t("join_complete_identite_label")}>
            <input type="file" accept="image/*,.pdf" style={inputStyle} onChange={(e) => setForm((p) => ({ ...p, pieceIdentiteFile: e.target.files?.[0] || null }))} />
          </Field>
          <p style={{ fontSize: 11.5, color: "#686F7D", marginTop: -8, marginBottom: 24 }}>{t("join_complete_identite_help")}</p>

          <h3 style={{ fontSize: 14, marginBottom: 6 }}>{t("join_complete_section_paiement")}</h3>
          <p style={{ fontSize: 12, color: "#5B6270", marginBottom: 10 }}>{t("join_complete_paiement_intro")}</p>
          <Field label={t("join_complete_paiement_mode_label")}>
            <select style={inputStyle} value={form.paiementMode} onChange={(e) => setForm((p) => ({ ...p, paiementMode: e.target.value }))}>
              <option value="non_paye">{t("join_complete_paiement_mode_non_paye")}</option>
              <option value="fichier">{t("join_complete_paiement_mode_fichier")}</option>
              <option value="especes">{t("join_complete_paiement_mode_especes")}</option>
              <option value="autre">{t("join_complete_paiement_mode_autre")}</option>
            </select>
          </Field>
          {form.paiementMode !== "non_paye" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginTop: 10, marginBottom: 10 }}>
              <Field label={t("join_complete_paiement_montant_label")}>
                <input type="number" required min="0" step="0.01" style={inputStyle} value={form.paiementMontant} onChange={(e) => setForm((p) => ({ ...p, paiementMontant: e.target.value }))} />
              </Field>
              {form.paiementMode === "fichier" && (
                <Field label={t("join_complete_paiement_fichier_label")}>
                  <input type="file" required accept="image/*,.pdf" style={inputStyle} onChange={(e) => setForm((p) => ({ ...p, paiementFile: e.target.files?.[0] || null }))} />
                </Field>
              )}
            </div>
          )}
          {form.paiementMode !== "non_paye" && form.paiementMode !== "fichier" && (
            <Field label={t("join_complete_paiement_note_label")}>
              <input style={inputStyle} value={form.paiementNote} onChange={(e) => setForm((p) => ({ ...p, paiementNote: e.target.value }))} />
            </Field>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
            <Btn type="submit" disabled={busy}>{busy ? t("join_complete_submitting") : t("join_complete_submit_btn")}</Btn>
            <Btn type="button" variant="outline" onClick={onCancel} disabled={busy}>{t("action_logout")}</Btn>
          </div>
        </form>
      </div>
    </div>
  );
}

// =====================================================================
// ÉCRAN D'AUTHENTIFICATION (connexion + création d'association)
// =====================================================================
function AuthScreen({ initialMode = "login", onClose } = {}) {
  const { t } = useLang();
  const [mode, setMode] = useState(initialMode); // 'login' | 'signup' | 'join' | 'mfa'
  // Préremplissage à usage unique (suite 2026-10-06, bascule rapide vers
  // le compte personnel depuis le menu bureau — voir switchToPersonalAccount
  // dans App.jsx) : jamais de mot de passe stocké, seulement l'adresse
  // courriel, lue puis aussitôt effacée du stockage local.
  const [email, setEmail] = useState(() => {
    try {
      const pre = window.localStorage.getItem("arem_switch_prefill_email");
      if (pre) { window.localStorage.removeItem("arem_switch_prefill_email"); return pre; }
    } catch { /* stockage indisponible : simplement pas de préremplissage */ }
    return "";
  });
  const [password, setPassword] = useState("");
  const [nomComplet, setNomComplet] = useState("");
  const [nomAssociation, setNomAssociation] = useState("");
  const [codeInvitation, setCodeInvitation] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState(null);
  const [mfaCode, setMfaCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
const [resetSent, setResetSent] = useState(false);
async function handleResetPassword() {
  if (!email) { setErr("Entrez votre courriel ci-dessus, puis cliquez sur ce lien."); return; }
  setErr(""); setBusy(true);
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  setBusy(false);
  if (error) { setErr(friendlyError(error, t)); return; }
  setResetSent(true);
}

  async function handleLogin(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setBusy(false); setErr(friendlyError(error, t)); return; }
    // Vérifier si une authentification à deux facteurs est requise
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setBusy(false);
    if (aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.[0];
      if (totp) { setMfaFactorId(totp.id); setMode("mfa"); }
    }
  }

  async function handleMfaVerify(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const { data: challenge, error: e1 } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
    if (e1) { setBusy(false); setErr(friendlyError(e1, t)); return; }
    const { error: e2 } = await supabase.auth.mfa.verify({ factorId: mfaFactorId, challengeId: challenge.id, code: mfaCode });
    setBusy(false);
    if (e2) setErr(t("auth_wrong_code"));
    // Si succès, onAuthStateChange (dans PlatformAppInner) détecte automatiquement la session pleinement authentifiée.
  }

  async function handleSignup(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      // 1) Créer le compte utilisateur.
      const { data: signUpData, error: e1 } = await supabase.auth.signUp({ email, password });
      if (e1) throw e1;
      if (!signUpData.user?.id) throw new Error(t("auth_confirm_email_first"));

      // 2) Mémoriser ce qu'il faut créer (association + profil) une fois
      // pleinement authentifié·e. Selon que la confirmation de courriel
      // est activée ou non, cela peut arriver tout de suite (session déjà
      // active ci-dessous) ou seulement après avoir cliqué le lien de
      // confirmation puis s'être connecté·e — dans les deux cas, c'est
      // AuthenticatedApp qui termine la création via
      // create_association_for_new_user() à la première ouverture de
      // session, jamais ce formulaire directement (voir plus bas dans le
      // fichier). Ça évite les échecs partiels selon l'état exact de la
      // session au moment de la saisie.
      try {
        localStorage.setItem("arem_pending_signup", JSON.stringify({ mode: "create", email, nomAssociation, nomComplet }));
      } catch { /* stockage local indisponible : tant pis, seul le cas "session immédiate" fonctionnera */ }

      setErr(t("auth_account_created"));
      if (!signUpData.session) {
        // Pas de session immédiate (confirmation de courriel requise) :
        // on reste sur l'écran de connexion, la création se terminera au
        // premier login réussi. Avec une session déjà active,
        // AuthenticatedApp se monte automatiquement et s'en charge tout
        // de suite — inutile de changer de mode ici.
        setMode("login");
      }
    } catch (error) {
      setErr(friendlyError(error, t));
    } finally {
      setBusy(false);
    }
  }

  // Rejoindre une association existante avec un code d'invitation — même
  // logique que handleSignup ci-dessus (compte créé ici, rattachement
  // terminé une fois par AuthenticatedApp via join_association_with_code,
  // voir plus bas dans le fichier), pour éviter les mêmes échecs partiels
  // selon l'état exact de la session au moment de la saisie.
  async function handleJoin(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const { data: signUpData, error: e1 } = await supabase.auth.signUp({ email, password });
      if (e1) throw e1;
      if (!signUpData.user?.id) throw new Error(t("auth_confirm_email_first"));

      try {
        localStorage.setItem("arem_pending_signup", JSON.stringify({ mode: "join", email, code: codeInvitation, nomComplet }));
      } catch { /* stockage local indisponible */ }

      setErr(t("auth_account_created"));
      if (!signUpData.session) {
        setMode("login");
      }
    } catch (error) {
      setErr(friendlyError(error, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "relative", fontFamily: "Inter, sans-serif", background: "white", borderRadius: 16, padding: 36, width: 420, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap');`}</style>
      {onClose && (
        <button type="button" onClick={onClose} aria-label={t("action_close")} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", cursor: "pointer", color: "#99A2B3", padding: 4, lineHeight: 0 }}>
          <X size={18} />
        </button>
      )}
      {/* En-tête identique à la marque « Unia » de la page d'accueil (badge
          saphir/or + mot-symbole Fraunces — vert d'origine remplacé par le
          bleu de l'application, suite 2026-10-06) — remplace l'ancien badge
          navy + « auth_platform_title » générique, pour que la modale
          s'intègre visuellement à la page qui l'ouvre (suite 2026-10-06,
          demande explicite de l'utilisateur). */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <span style={{ display: "inline-flex", width: 36, height: 36, borderRadius: 10, background: "#0D3A63", alignItems: "center", justifyContent: "center", color: "#C8963E", fontFamily: "Fraunces, Georgia, serif", fontWeight: 700, fontSize: 17 }}>U</span>
    <span style={{ fontFamily: "Fraunces, Georgia, serif", fontWeight: 600, fontSize: 20, color: "#182233" }}>Unia</span>
  </div>
  <div style={{ background: "#0D3A63", borderRadius: 6 }}><LanguageSwitcher /></div>
</div>

        {mode === "login" && (
          <form onSubmit={handleLogin}>
           <h2 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 18, marginBottom: 16, color: "#182233" }}>{t("auth_login_title")}</h2>
            <Field label={t("auth_email")}><input type="email" required style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label={t("auth_password")}>
  <div style={{ position: "relative" }}>
    <input type={showPassword ? "text" : "password"} required style={{ ...inputStyle, paddingRight: 40 }} value={password} onChange={(e) => setPassword(e.target.value)} />
    <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#686F7D", padding: 0 }}>
      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  </div>
</Field>
            
          <p style={{ fontSize: 12.5, marginBottom: 12, textAlign: "right" }}>
  {resetSent ? (
    <span style={{ color: TEAL }}>{t("auth_reset_sent")}</span>
  ) : (
   <a href="#" onClick={(e) => { e.preventDefault(); handleResetPassword(); }} style={{ color: TEAL, fontWeight: 600 }}>{t("auth_forgot_password")}</a>
  )}
</p>
{err && <p style={{ color: RED, fontSize: 12.5, marginBottom: 12 }}>{err}</p>}
{err && <p style={{ color: RED, fontSize: 12.5, marginBottom: 12 }}>{err}</p>}
            <Btn type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", background: "#C8963E", color: "#182233" }}>
             {busy ? t("auth_logging_in") : t("auth_login_btn")}
            </Btn>
            <p style={{ fontSize: 12.5, marginTop: 16, color: "#5B6270" }}>
              {t("auth_new_org")} <a href="#" onClick={(e) => { e.preventDefault(); setMode("signup"); setErr(""); }} style={{ color: TEAL, fontWeight: 600 }}>{t("auth_create_account")}</a>
            </p>
            <p style={{ fontSize: 12.5, marginTop: 6, color: "#5B6270" }}>
              {t("auth_have_code")} <a href="#" onClick={(e) => { e.preventDefault(); setMode("join"); setErr(""); }} style={{ color: TEAL, fontWeight: 600 }}>{t("auth_join_link")}</a>
            </p>
          </form>
        )}
        {mode === "mfa" && (
          <form onSubmit={handleMfaVerify}>
          <h2 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 18, marginBottom: 8, color: "#182233" }}>{t("auth_mfa_title")}</h2>
           <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 16 }}>{t("auth_mfa_desc")}</p>
           <Field label={t("sec_verif_code")}><input required maxLength={6} style={inputStyle} value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="123456" /></Field>
            {err && <p style={{ color: RED, fontSize: 12.5, marginBottom: 12 }}>{err}</p>}
            <Btn type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", background: "#C8963E", color: "#182233" }}>
             {busy ? t("auth_verifying") : t("auth_verify_btn")}
            </Btn>
          </form>
        )}
        {mode === "signup" && (
          <form onSubmit={handleSignup}>
            <h2 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 18, marginBottom: 16, color: "#182233" }}>{t("auth_signup_title")}</h2>
            <Field label={t("auth_org_name")}><input required style={inputStyle} value={nomAssociation} onChange={(e) => setNomAssociation(e.target.value)} /></Field>
            <Field label={t("auth_full_name")}><input required style={inputStyle} value={nomComplet} onChange={(e) => setNomComplet(e.target.value)} /></Field>
            <Field label={t("auth_email")}><input type="email" required style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={t("auth_password")} required>
              <div style={{ position: "relative" }}>
                <input type={showPassword ? "text" : "password"} required minLength={6} style={{ ...inputStyle, paddingRight: 40 }} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#686F7D", padding: 0 }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            {err && <p style={{ color: err.startsWith("Compte créé") ? TEAL : RED, fontSize: 12.5, marginBottom: 12 }}>{err}</p>}
            <Btn type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", background: "#C8963E", color: "#182233" }}>
              {busy ? "Création…" : "Créer l'association (essai 30 jours)"}
            </Btn>
            <p style={{ fontSize: 12.5, marginTop: 16, color: "#5B6270" }}>
              Déjà inscrit(e) ? <a href="#" onClick={(e) => { e.preventDefault(); setMode("login"); setErr(""); }} style={{ color: TEAL, fontWeight: 600 }}>Se connecter</a>
            </p>
            <p style={{ fontSize: 12.5, marginTop: 6, color: "#5B6270" }}>
              {t("auth_have_code")} <a href="#" onClick={(e) => { e.preventDefault(); setMode("join"); setErr(""); }} style={{ color: TEAL, fontWeight: 600 }}>{t("auth_join_link")}</a>
            </p>
          </form>
        )}
        {mode === "join" && (
          <form onSubmit={handleJoin}>
            <h2 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 18, marginBottom: 6, color: "#182233" }}>{t("auth_join_title")}</h2>
            <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 16 }}>{t("auth_join_desc")}</p>
            <Field label={t("auth_invite_code")}><input required style={{ ...inputStyle, textTransform: "uppercase" }} value={codeInvitation} onChange={(e) => setCodeInvitation(e.target.value.toUpperCase())} placeholder="EX1234AB" /></Field>
            <Field label={t("auth_full_name_join")}><input required style={inputStyle} value={nomComplet} onChange={(e) => setNomComplet(e.target.value)} /></Field>
            <Field label={t("auth_email")}><input type="email" required style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={t("auth_password")}>
              <div style={{ position: "relative" }}>
                <input type={showPassword ? "text" : "password"} required minLength={6} style={{ ...inputStyle, paddingRight: 40 }} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#686F7D", padding: 0 }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            {err && <p style={{ color: err.startsWith("Compte créé") ? TEAL : RED, fontSize: 12.5, marginBottom: 12 }}>{err}</p>}
            <Btn type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", background: "#C8963E", color: "#182233" }}>
              {busy ? "…" : t("auth_join_btn")}
            </Btn>
            <p style={{ fontSize: 12.5, marginTop: 16, color: "#5B6270" }}>
              <a href="#" onClick={(e) => { e.preventDefault(); setMode("login"); setErr(""); }} style={{ color: TEAL, fontWeight: 600 }}>{t("auth_back_login")}</a>
            </p>
          </form>
        )}
    </div>
  );
}

// =====================================================================
// PAGE D'ACCUEIL / ÉCRAN DE CONNEXION — design « Unia » (remplace, suite
// 2026-10-06, l'ancien AuthScreen minimal comme point d'entrée de
// l'application). La page d'accueil complète (nav, hero, fonctionnalités,
// tarifs, FAQ, etc.) EST maintenant l'écran de connexion : les appels à
// l'action ci-dessous ouvrent le vrai formulaire (AuthScreen ci-dessus,
// logique inchangée) dans une fenêtre modale superposée, plutôt que de
// remplacer toute la page — cf. décision utilisateur du 2026-10-06.
// =====================================================================
function LandingAuthScreen() {
  const { t } = useLang();
  // Ouverture automatique de l'écran de connexion (suite 2026-10-06) juste
  // après la déconnexion déclenchée par switchToPersonalAccount dans
  // App.jsx — sans ce jeton, la personne retomberait sur la page d'accueil
  // publique et devrait recliquer "Se connecter" elle-même.
  const [authMode, setAuthMode] = useState(() => { // null | 'login' | 'signup' | 'join'
    try {
      if (window.localStorage.getItem("arem_switch_autoopen") === "1") {
        window.localStorage.removeItem("arem_switch_autoopen");
        return "login";
      }
    } catch { /* stockage indisponible : pas d'ouverture automatique */ }
    return null;
  });
  const [openFaq, setOpenFaq] = useState(0);

  const openAuth = useCallback((m) => setAuthMode(m), []);
  const closeAuth = useCallback(() => setAuthMode(null), []);

  useEffect(() => {
    if (!authMode) return;
    function onKey(e) { if (e.key === "Escape") closeAuth(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authMode, closeAuth]);

  const heroTiles = [
    { label: t("landing_hero_tile_members_label"), value: "128", delta: t("landing_hero_tile_members_delta") },
    { label: t("landing_hero_tile_dues_label"), value: "94%", delta: t("landing_hero_tile_dues_delta") },
    { label: t("landing_hero_tile_plan_label"), value: "Premium" },
  ];
  const heroBars = [40, 62, 50, 78, 55, 90, 70, 60];

  const steps = [
    { num: "1", title: t("landing_step1_title"), text: t("landing_step1_text") },
    { num: "2", title: t("landing_step2_title"), text: t("landing_step2_text") },
    { num: "3", title: t("landing_step3_title"), text: t("landing_step3_text") },
  ];

  const features = [
    { bg: "#E3EAF2", fg: "#0D3A63", title: t("landing_feature1_title"), text: t("landing_feature1_text"),
      icon: <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /> },
    { bg: "#FBF3D9", fg: "#8F6A24", title: t("landing_feature2_title"), text: t("landing_feature2_text"),
      icon: <><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></> },
    { bg: "#FBE4E1", fg: "#C0392B", title: t("landing_feature3_title"), text: t("landing_feature3_text"),
      icon: <><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21V12h6v9" /></> },
    { bg: "#E3EAF2", fg: "#0D3A63", title: t("landing_feature4_title"), text: t("landing_feature4_text"),
      icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></> },
    { bg: "#FBF3D9", fg: "#8F6A24", title: t("landing_feature5_title"), text: t("landing_feature5_text"),
      icon: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></> },
    { bg: "#FBE4E1", fg: "#C0392B", title: t("landing_feature6_title"), text: t("landing_feature6_text"),
      icon: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></> },
  ];

  const premiumItems = [
    { title: t("landing_premium_item1_title"), text: t("landing_premium_item1_text") },
    { title: t("landing_premium_item2_title"), text: t("landing_premium_item2_text") },
    { title: t("landing_premium_item3_title"), text: t("landing_premium_item3_text") },
    { title: t("landing_premium_item4_title"), text: t("landing_premium_item4_text") },
  ];
  // Trois modules Premium ajoutés récemment (voir PREMIUM_FEATURE_IDS dans
  // MainApp) — mis en avant séparément des 4 items historiques ci-dessus
  // plutôt que fondus dans la même grille, pour que la nouveauté se
  // remarque. Réutilise les libellés de navigation et la 1re puce déjà
  // rédigée pour l'écran "PremiumLocked" de chaque module, plutôt que de
  // dupliquer le texte.
  const newItems = [
    { icon: Car, title: t("nav_carpool"), text: t("premium_feat_covoiturage_1") },
    { icon: Video, title: t("nav_meetings"), text: t("premium_feat_reunions_1") },
    { icon: Briefcase, title: t("nav_jobs"), text: t("premium_feat_emploi_1") },
  ];

  const faqItems = [
    { q: t("landing_faq_q1"), a: t("landing_faq_a1") },
    { q: t("landing_faq_q2"), a: t("landing_faq_a2") },
    { q: t("landing_faq_q3"), a: t("landing_faq_a3") },
    { q: t("landing_faq_q4"), a: t("landing_faq_a4") },
  ];

  const INK = "#182233", INK_SOFT = "#545B72", PAPER = "#FBF6EC", PAPER_RAISED = "#FFFFFF";
  // Couleurs de marque de la page d'accueil — suite 2026-10-06 : remplace le
  // vert ("émeraude", #1F8A5C) de la toute première version de cette page
  // par le bleu saphir déjà utilisé comme couleur de marque par défaut dans
  // le reste de l'application connectée (EMERALD_DARK_DEFAULT = "#0D3A63",
  // var(--primary)) — demande explicite de l'utilisateur pour que la page
  // d'accueil (hors session) soit visuellement uniforme avec l'application
  // (en session). PRIMARY reprend donc exactement cette même valeur ;
  // PRIMARY_DARK devient une nuance plus foncée dédiée (l'ancienne valeur de
  // PRIMARY_DARK, #0D3A63, est maintenant celle de PRIMARY) ; PRIMARY_LIGHT
  // passe du vert menthe clair à un bleu très clair assorti.
  const LINE = "rgba(24,34,51,.10)", PRIMARY = "#0D3A63", PRIMARY_DARK = "#0A2E4F", PRIMARY_LIGHT = "#E3EAF2";
  const GOLD = "#C8963E", GOLD_LIGHT_C = "#FBF3D9", GOLD_DARK = "#8F6A24";

  const wrapStyle = { maxWidth: 1120, margin: "0 auto", padding: "0 32px" };
  const btnPrimary = { fontFamily: "Inter, sans-serif", fontWeight: 700, borderRadius: 999, border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, whiteSpace: "nowrap", textDecoration: "none", background: PRIMARY, color: "#fff", padding: "14px 26px", fontSize: 14.5 };
  const btnGhost = { fontFamily: "Inter, sans-serif", fontWeight: 700, borderRadius: 999, border: `1.5px solid ${LINE}`, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, whiteSpace: "nowrap", textDecoration: "none", background: "transparent", color: INK, padding: "14px 22px", fontSize: 14.5 };
  const cardStyle = { background: PAPER_RAISED, borderRadius: 18, border: `1px solid ${LINE}`, boxShadow: "0 2px 10px rgba(24,34,51,.05)" };
  const eyebrowStyle = { fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: PRIMARY };

  return (
    <div style={{ overflowX: "hidden", minHeight: "100vh", background: PAPER, fontFamily: "Inter, system-ui, sans-serif", color: INK }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');
        .unia-landing h1, .unia-landing h2, .unia-landing h3 { font-family: 'Fraunces', Georgia, serif; margin: 0; text-wrap: balance; }
        .unia-landing p { margin: 0; }
        .unia-landing .btn-primary:hover { background: ${PRIMARY_DARK}; }
        .unia-landing .btn-ghost:hover { background: ${PRIMARY_LIGHT}; }
        @media (max-width: 760px) {
          .unia-landing .grid-2 { grid-template-columns: 1fr !important; }
          .unia-landing .grid-3 { grid-template-columns: 1fr !important; }
          .unia-landing .hero-row { flex-direction: column !important; }
        }
      `}</style>

      <div className="unia-landing">
        {/* ===== Nav ===== */}
        <div style={{ borderBottom: `1px solid ${LINE}`, background: PAPER }}>
          <div style={{ ...wrapStyle, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 32px", flexWrap: "wrap", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "inline-flex", width: 32, height: 32, borderRadius: 9, background: PRIMARY, alignItems: "center", justifyContent: "center", color: GOLD, fontFamily: "Fraunces, serif", fontWeight: 700, fontSize: 16 }}>U</span>
              <span style={{ fontFamily: "Fraunces, serif", fontWeight: 600, fontSize: 19 }}>Unia</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 26, fontSize: 13.5, fontWeight: 600, color: INK_SOFT }}>
              <a href="#fonctionnalites" style={{ color: "inherit", textDecoration: "none" }}>{t("landing_nav_features")}</a>
              <a href="#tarifs" style={{ color: "inherit", textDecoration: "none" }}>{t("landing_nav_pricing")}</a>
              <a href="#faq" style={{ color: "inherit", textDecoration: "none" }}>{t("landing_nav_faq")}</a>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ background: "#0D3A63", borderRadius: 6 }}><LanguageSwitcher /></div>
              <button type="button" className="btn-ghost" onClick={() => openAuth("login")} style={{ ...btnGhost, padding: "9px 16px", fontSize: 13 }}>{t("landing_nav_login")}</button>
              <button type="button" onClick={() => openAuth("signup")} style={{ ...btnPrimary, padding: "10px 18px", fontSize: 13 }}>{t("landing_nav_trial")}</button>
            </div>
          </div>
        </div>

        {/* ===== Hero ===== */}
        <div style={{ ...wrapStyle, paddingTop: 68, paddingBottom: 56 }}>
          <div className="hero-row" style={{ display: "flex", gap: 56, alignItems: "center" }}>
            <div style={{ flex: "1.1 1 0", minWidth: 0 }}>
              <div style={{ ...eyebrowStyle, marginBottom: 16 }}>{t("landing_hero_eyebrow")}</div>
              <h1 style={{ fontSize: 44, lineHeight: 1.12, letterSpacing: "-.01em", marginBottom: 20 }}>{t("landing_hero_title")}</h1>
              <p style={{ fontSize: 16.5, lineHeight: 1.6, color: INK_SOFT, maxWidth: 480, marginBottom: 30 }}>{t("landing_hero_subtitle")}</p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
                <button type="button" onClick={() => openAuth("signup")} style={btnPrimary}>{t("landing_hero_cta_primary")}</button>
                <a href="#fonctionnalites" className="btn-ghost" style={btnGhost}>{t("landing_hero_cta_secondary")}</a>
              </div>
              <p style={{ fontSize: 12.5, color: INK_SOFT }}>{t("landing_hero_note")}</p>
            </div>

            <div style={{ flex: "1 1 0", minWidth: 0 }}>
              <div style={{ ...cardStyle, padding: 10, transform: "rotate(-.6deg)", boxShadow: "0 18px 40px rgba(24,34,51,.16)" }}>
                <div style={{ background: INK, borderRadius: 12, padding: "14px 16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#E0624B" }} />
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: GOLD }} />
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: PRIMARY_LIGHT }} />
                    </div>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, color: "rgba(255,255,255,.45)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6FCF9A" }} /> {t("landing_hero_live_label")}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
                    {heroTiles.map((tile, i) => (
                      <div key={i} style={{ background: "rgba(255,255,255,.06)", borderRadius: 9, padding: 10 }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,.5)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 5 }}>{tile.label}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{tile.value}</div>
                          {tile.delta && <div style={{ fontSize: 9.5, fontWeight: 700, color: "#6FCF9A" }}>{tile.delta}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: "rgba(255,255,255,.06)", borderRadius: 9, padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,.5)", textTransform: "uppercase", letterSpacing: ".04em" }}>{t("landing_hero_chart_label")}</div>
                      <div style={{ fontSize: 9, color: GOLD, fontWeight: 700 }}>{t("landing_hero_chart_goal")}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 44, borderBottom: "1px solid rgba(255,255,255,.1)", paddingBottom: 2 }}>
                      {heroBars.map((h, i) => (
                        <div key={i} style={{ flex: 1, background: i === heroBars.length - 2 ? GOLD : "rgba(255,255,255,.25)", borderRadius: "3px 3px 1px 1px", height: `${h}%` }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ===== Comment ça marche ===== */}
        <div style={{ background: PAPER_RAISED, borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, padding: "56px 0" }}>
          <div style={wrapStyle}>
            <div style={{ textAlign: "center", maxWidth: 560, margin: "0 auto 36px" }}>
              <h2 style={{ fontSize: 27, marginBottom: 10 }}>{t("landing_steps_title")}</h2>
              <p style={{ fontSize: 14.5, color: INK_SOFT }}>{t("landing_steps_subtitle")}</p>
            </div>
            <div className="grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22 }}>
              {steps.map((s) => (
                <div key={s.num} style={{ padding: "4px 8px" }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: PRIMARY_LIGHT, color: PRIMARY_DARK, fontFamily: "Fraunces, serif", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>{s.num}</div>
                  <h3 style={{ fontSize: 16.5, marginBottom: 8 }}>{s.title}</h3>
                  <p style={{ fontSize: 13.5, color: INK_SOFT, lineHeight: 1.55 }}>{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ===== Fonctionnalités ===== */}
        <div id="fonctionnalites" style={{ ...wrapStyle, padding: "64px 32px" }}>
          <div style={{ textAlign: "center", maxWidth: 620, margin: "0 auto 40px" }}>
            <div style={{ ...eyebrowStyle, marginBottom: 10 }}>{t("landing_features_eyebrow")}</div>
            <h2 style={{ fontSize: 30, marginBottom: 10 }}>{t("landing_features_title")}</h2>
            <p style={{ fontSize: 14.5, color: INK_SOFT }}>{t("landing_features_subtitle")}</p>
          </div>
          <div className="grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
            {features.map((f, i) => (
              <div key={i} style={{ ...cardStyle, padding: 24 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: f.bg, color: f.fg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{f.icon}</svg>
                </div>
                <h3 style={{ fontSize: 15.5, marginBottom: 7 }}>{f.title}</h3>
                <p style={{ fontSize: 13, color: INK_SOFT, lineHeight: 1.55 }}>{f.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ===== Bandeau Premium ===== */}
        <div style={{ background: INK, padding: "56px 0" }}>
          <div style={wrapStyle}>
            <div className="grid-2" style={{ display: "grid", gridTemplateColumns: ".9fr 1.4fr", gap: 40, alignItems: "center", marginBottom: 36 }}>
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(201,162,39,.15)", color: GOLD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", padding: "5px 11px", borderRadius: 999, marginBottom: 14 }}>{t("landing_premium_badge")}</div>
                <h2 style={{ fontSize: 27, color: "#fff", marginBottom: 12 }}>{t("landing_premium_title")}</h2>
                <p style={{ fontSize: 14, color: "rgba(255,255,255,.65)", lineHeight: 1.6 }}>{t("landing_premium_text")}</p>
              </div>
              <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
                {premiumItems.map((p, i) => (
                  <div key={i} style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "16px 18px" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#fff", marginBottom: 5 }}>{p.title}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,.55)", lineHeight: 1.5 }}>{p.text}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", background: "rgba(111,207,154,.15)", color: "#6FCF9A", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", padding: "4px 10px", borderRadius: 999 }}>{t("landing_premium_new_label")}</span>
                <span style={{ fontSize: 12.5, color: "rgba(255,255,255,.55)" }}>{t("landing_premium_new_subtitle")}</span>
              </div>
              <div className="grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
                {newItems.map((n, i) => {
                  const Icon = n.icon;
                  return (
                    <div key={i} style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "16px 18px" }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(201,162,39,.15)", color: GOLD, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                        <Icon size={15} />
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#fff", marginBottom: 5 }}>{n.title}</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,.55)", lineHeight: 1.5 }}>{n.text}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ===== Tarifs ===== */}
        <div id="tarifs" style={{ ...wrapStyle, padding: "64px 32px" }}>
          <div style={{ textAlign: "center", maxWidth: 560, margin: "0 auto 40px" }}>
            <div style={{ ...eyebrowStyle, marginBottom: 10 }}>{t("landing_pricing_eyebrow")}</div>
            <h2 style={{ fontSize: 30, marginBottom: 10 }}>{t("landing_pricing_title")}</h2>
            <p style={{ fontSize: 14.5, color: INK_SOFT }}>{t("landing_pricing_subtitle")}</p>
          </div>
          <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxWidth: 760, margin: "0 auto" }}>
            <div style={{ ...cardStyle, padding: 30 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{t("landing_pricing_standard_name")}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: 18 }}>
                <span style={{ fontFamily: "Fraunces, serif", fontSize: 34, fontWeight: 700 }}>{t("landing_pricing_standard_price")}</span>
                <span style={{ fontSize: 13, color: INK_SOFT }}>{t("landing_pricing_period")}</span>
              </div>
              <p style={{ fontSize: 13, color: INK_SOFT, marginBottom: 18, lineHeight: 1.55 }}>{t("landing_pricing_standard_desc")}</p>
              <button type="button" className="btn-ghost" onClick={() => openAuth("signup")} style={{ ...btnGhost, width: "100%" }}>{t("landing_pricing_standard_cta")}</button>
            </div>
            <div style={{ ...cardStyle, padding: 30, border: `1.5px solid ${GOLD}`, background: GOLD_LIGHT_C }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: GOLD_DARK }}>{t("landing_pricing_premium_name")}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: 18 }}>
                <span style={{ fontFamily: "Fraunces, serif", fontSize: 34, fontWeight: 700, color: GOLD_DARK }}>{t("landing_pricing_premium_price")}</span>
                <span style={{ fontSize: 13, color: GOLD_DARK }}>{t("landing_pricing_period")}</span>
              </div>
              <p style={{ fontSize: 13, color: "#6B5712", marginBottom: 18, lineHeight: 1.55 }}>{t("landing_pricing_premium_desc")}</p>
              <button type="button" onClick={() => openAuth("signup")} style={{ ...btnPrimary, width: "100%", background: GOLD_DARK }}>{t("landing_pricing_premium_cta")}</button>
            </div>
          </div>
          <p style={{ textAlign: "center", fontSize: 12.5, color: INK_SOFT, marginTop: 22 }}>{t("landing_pricing_footnote")}</p>
        </div>

        {/* ===== Bilingue ===== */}
        <div style={{ background: PRIMARY_LIGHT, padding: "52px 0" }}>
          <div className="hero-row" style={{ ...wrapStyle, display: "flex", alignItems: "center", gap: 40 }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: 25, marginBottom: 10, color: PRIMARY_DARK }}>{t("landing_bilingual_title")}</h2>
              <p style={{ fontSize: 14, color: INK_SOFT, lineHeight: 1.6, maxWidth: 480 }}>{t("landing_bilingual_text")}</p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ background: "#fff", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 700, color: PRIMARY_DARK, boxShadow: "0 2px 8px rgba(24,34,51,.08)" }}>FR</span>
              <span style={{ background: "#fff", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 700, color: PRIMARY_DARK, boxShadow: "0 2px 8px rgba(24,34,51,.08)" }}>EN</span>
            </div>
          </div>
        </div>

        {/* ===== FAQ ===== */}
        <div id="faq" style={{ ...wrapStyle, padding: "64px 32px", maxWidth: 760 }}>
          <h2 style={{ fontSize: 27, textAlign: "center", marginBottom: 30 }}>{t("landing_faq_title")}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {faqItems.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={i} style={{ ...cardStyle, overflow: "hidden" }}>
                  <button type="button" onClick={() => setOpenFaq(open ? -1 : i)} style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontFamily: "Inter, sans-serif" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>{f.q}</span>
                    <span style={{ display: "inline-flex", flexShrink: 0, transform: `rotate(${open ? 45 : 0}deg)`, transition: "transform .15s ease", color: INK_SOFT }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    </span>
                  </button>
                  {open && (
                    <div style={{ padding: "0 20px 18px", fontSize: 13.5, color: INK_SOFT, lineHeight: 1.6 }}>{f.a}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ===== CTA finale ===== */}
        <div style={{ background: PRIMARY, padding: "64px 0" }}>
          <div style={{ ...wrapStyle, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
            <h2 style={{ fontSize: 30, color: "#fff", marginBottom: 14 }}>{t("landing_cta_title")}</h2>
            <p style={{ fontSize: 14.5, color: "rgba(255,255,255,.75)", marginBottom: 26 }}>{t("landing_cta_text")}</p>
            <button type="button" onClick={() => openAuth("signup")} style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, borderRadius: 999, border: "none", cursor: "pointer", background: "#fff", color: PRIMARY_DARK, padding: "15px 30px", fontSize: 15 }}>{t("landing_cta_button")}</button>
          </div>
        </div>

        {/* ===== Footer ===== */}
        <div style={{ padding: "36px 0", borderTop: `1px solid ${LINE}` }}>
          <div style={{ ...wrapStyle, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "inline-flex", width: 24, height: 24, borderRadius: 7, background: PRIMARY, alignItems: "center", justifyContent: "center", color: GOLD, fontFamily: "Fraunces, serif", fontWeight: 700, fontSize: 12 }}>U</span>
              <span style={{ fontFamily: "Fraunces, serif", fontWeight: 600, fontSize: 14.5 }}>Unia</span>
            </div>
            <p style={{ fontSize: 12, color: INK_SOFT }}>{t("landing_footer_tagline")} © {new Date().getFullYear()} Unia.</p>
          </div>
        </div>
      </div>

      {/* ===== Modale d'authentification (connexion / inscription / rejoindre) ===== */}
      {authMode && (
        <div
          role="dialog" aria-modal="true"
          onClick={closeAuth}
          style={{ position: "fixed", inset: 0, background: "rgba(24,34,51,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <AuthScreen initialMode={authMode} onClose={closeAuth} />
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// APPLICATION AUTHENTIFIÉE — charge le profil puis route par rôle
// =====================================================================
// =====================================================================
// SÉCURITÉ — activation de l'authentification à deux facteurs (TOTP)
// =====================================================================
function SecuritySettings({ showPersonalLink, personalEmail, onLinkPersonalAccount }) {
  const { t } = useLang();
  const [factors, setFactors] = useState([]);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState(null);
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  // Compte personnel lié (suite 2026-10-06) — voir linkPersonalAccount
  // dans MainApp. personalEmailInput reste local (brouillon de saisie),
  // personalEmail (prop) est la valeur déjà enregistrée côté profil.
  const [personalEmailInput, setPersonalEmailInput] = useState(personalEmail || "");
  const [personalMsg, setPersonalMsg] = useState("");
  const [personalSaving, setPersonalSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(data?.totp || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function startEnroll() {
    setMsg(""); setEnrolling(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error) { setMsg(friendlyError(error, t)); setEnrolling(false); return; }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
  }
  async function confirmEnroll() {
    setMsg("");
    const { data: challenge, error: e1 } = await supabase.auth.mfa.challenge({ factorId });
    if (e1) { setMsg(friendlyError(e1, t)); return; }
    const { error: e2 } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
   if (e2) { setMsg(t("sec_wrong_code")); return; }
    setMsg(t("sec_2fa_success"));
    setEnrolling(false); setQrCode(null); setCode("");
    load();
  }
  async function removeFactor(id) {
    await supabase.auth.mfa.unenroll({ factorId: id });
    load();
  }

  function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  async function savePersonalEmail() {
    const v = personalEmailInput.trim();
    if (!v || !isValidEmail(v)) { setPersonalMsg(t("sec_personal_account_invalid_email")); return; }
    setPersonalMsg(""); setPersonalSaving(true);
    const ok = await onLinkPersonalAccount(v);
    setPersonalSaving(false);
    setPersonalMsg(ok ? t("sec_personal_account_saved") : "");
  }

  async function unlinkPersonalEmail() {
    if (!window.confirm(t("sec_personal_account_unlink_confirm"))) return;
    setPersonalSaving(true);
    await onLinkPersonalAccount(null);
    setPersonalSaving(false);
    setPersonalEmailInput("");
    setPersonalMsg("");
  }

  return (
    <Container><Section>
     <h2 style={{ marginBottom: 14 }}>{t("sec_title")}</h2>
      {showPersonalLink && (
        // "Basculer vers mon compte personnel" (suite 2026-10-06) —
        // remplace la fusion abandonnée de "Mon espace" dans le compte
        // bureau (voir App.jsx, canSeeMySpace retiré) : le lien ci-dessous
        // est propre à ce compte précis, jamais au rôle — un(e)
        // successeur·e au bureau ne le verra pas, voir le texte explicatif.
        <Card style={{ maxWidth: 460, marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>{t("sec_personal_account_title")}</h3>
          <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 14 }}>{t("sec_personal_account_desc")}</p>
          {personalMsg && <p style={{ fontSize: 12.5, color: personalMsg === t("sec_personal_account_saved") ? TEAL : RED, marginBottom: 10 }}>{personalMsg}</p>}
          {personalEmail ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 0" }}>
              <span style={{ fontSize: 13 }}>{t("sec_personal_account_current_label")} : <strong>{personalEmail}</strong></span>
              <button onClick={unlinkPersonalEmail} disabled={personalSaving} style={{ fontSize: 11, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "3px 8px", cursor: personalSaving ? "default" : "pointer", flexShrink: 0 }}>{t("sec_personal_account_unlink")}</button>
            </div>
          ) : (
            <div>
              <Field label={t("sec_personal_account_email_label")}>
                <input style={inputStyle} type="email" value={personalEmailInput} onChange={(e) => setPersonalEmailInput(e.target.value)} placeholder="moi@exemple.com" />
              </Field>
              <Btn onClick={savePersonalEmail} disabled={personalSaving}>{t("sec_personal_account_save")}</Btn>
            </div>
          )}
        </Card>
      )}
      <Card style={{ maxWidth: 460 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>{t("sec_2fa_title")}</h3>
        <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 14 }}>
  {t("sec_2fa_desc")}
</p>
        {msg && <p style={{ fontSize: 12.5, color: msg.includes("succès") ? TEAL : RED, marginBottom: 10 }}>{msg}</p>}

        {factors.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {factors.map((f) => (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #EEE" }}>
                <span style={{ fontSize: 13 }}>{t("sec_auth_app")} ({f.status})</span>
              <button onClick={() => removeFactor(f.id)} style={{ fontSize: 11, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "3px 8px", cursor: "pointer" }}>{t("sec_remove")}</button>
              </div>
            ))}
          </div>
        )}

        {!enrolling && (
         <Btn onClick={startEnroll}>{t("sec_activate_2fa")}</Btn>
        )}

        {enrolling && qrCode && (
          <div>
           <p style={{ fontSize: 12.5, marginBottom: 10 }}>{t("sec_scan_code")}</p>
            <img src={qrCode} alt="QR code 2FA" style={{ width: 180, height: 180, marginBottom: 14 }} />
            <Field label={t("sec_verif_code")}><input style={inputStyle} maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" /></Field>
           <Btn onClick={confirmEnroll}>{t("sec_confirm")}</Btn>
          </div>
        )}
      </Card>
    </Section></Container>
  );
}

function AuthenticatedApp({ session }) {const { t } = useLang();
  const [profile, setProfile] = useState(null);
  const [association, setAssociation] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // Empêche un double appel de create_association_for_new_user()/
  // join_association_with_code() pour cette même instance du composant
  // (ex. double déclenchement de l'effet ci-dessous) — la fonction SQL
  // elle-même refuse déjà une deuxième tentative (voir le rattrapage plus
  // bas), mais autant éviter l'appel inutile.
  const pendingHandledRef = useRef(false);
  // 2026-10-06 (demandé par l'utilisateur) — demande de rattachement par
  // code d'invitation pas encore envoyée : contient {code, nomComplet,
  // email} tant que CompleteJoinRequestForm (plus bas) n'a pas été
  // soumise. Tant que ceci est non nul, on affiche ce formulaire au lieu
  // du reste de l'application — voir le rendu plus bas.
  const [pendingJoinData, setPendingJoinData] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      let { data: prof, error: e1 } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();

      // Aucun profil trouvé pour ce compte pourtant authentifié : c'est
      // l'état normal juste après une inscription (« Créer votre
      // association ») dont la création de l'association/du profil n'a
      // pas encore eu lieu — voir handleSignup() plus haut. On la termine
      // ici, une seule fois, via la fonction SQL create_association_for_
      // new_user (transaction atomique : tout ou rien).
      if (e1 && e1.code === "PGRST116" && !pendingHandledRef.current) {
        pendingHandledRef.current = true;
        let pending = null;
        try {
          const raw = localStorage.getItem("arem_pending_signup");
          if (raw) { const p = JSON.parse(raw); if (p.email === session.user.email) pending = p; }
        } catch { /* ignore */ }

        if (pending && pending.mode === "join") {
          // 2026-10-06 (demandé par l'utilisateur) — un rattachement par
          // code n'appelle plus join_association_with_code() directement
          // ici : on affiche d'abord CompleteJoinRequestForm pour que la
          // fiche adhérent complète + pièce d'identité + preuve de
          // paiement de l'inscription soient fournies par la personne
          // elle-même, AVANT l'envoi de la demande au bureau (voir
          // finishJoinRequest ci-dessous, qui appelle réellement la RPC
          // une fois ce formulaire soumis).
          setPendingJoinData(pending);
          setLoading(false);
          return;
        }

        if (pending) {
          const { error: rpcErr } = await supabase.rpc("create_association_for_new_user", { p_nom_association: pending.nomAssociation, p_nom_complet: pending.nomComplet });
          try { localStorage.removeItem("arem_pending_signup"); } catch { /* ignore */ }
          // Si un autre appel concurrent a déjà terminé la création juste
          // avant celui-ci (ex. l'effet ci-dessous s'est déclenché deux
          // fois pour cette session), la fonction SQL refuse cette
          // deuxième tentative avec ce message précis — ce n'est pas une
          // vraie erreur : le profil existe désormais bel et bien (créé
          // par le premier appel), on se contente de le relire au lieu
          // d'afficher un échec.
          const alreadyAttached = rpcErr && /d[ée]j[àa].*rattach/i.test(rpcErr.message || "");
          if (rpcErr && !alreadyAttached) throw rpcErr;
          ({ data: prof, error: e1 } = await supabase.from("profiles").select("*").eq("id", session.user.id).single());
        }
      }

      if (e1) throw e1;
      setProfile(prof);
      let assocData = null, subData = null;
      if (prof.association_id && !prof.compte_bloque && !prof.acces_en_attente) {
        const [{ data: assoc, error: e2 }, { data: sub }] = await Promise.all([
          supabase.from("associations").select("*").eq("id", prof.association_id).single(),
          supabase.from("subscriptions").select("*").eq("association_id", prof.association_id).order("created_at", { ascending: false }).limit(1).single(),
        ]);
        if (e2) throw e2;
        assocData = assoc; subData = sub || null;
        setAssociation(assocData);
        setSubscription(subData);
      }
      // Repli hors-ligne (suite 84b) : mémorise ce chargement réussi pour
      // ce compte, afin qu'un prochain rechargement hors ligne puisse
      // retomber dessus au lieu de bloquer sur un écran d'erreur — voir
      // shared.jsx.
      cacheAuthSnapshot(session.user.id, { profile: prof, association: assocData, subscription: subData });
    } catch (e) {
      // Rechargement raté spécifiquement pour une raison réseau (hors
      // ligne) : si un profil de ce compte a déjà été chargé avec succès
      // auparavant, on s'en sert plutôt que d'afficher un écran d'erreur
      // plein écran qui masquerait tout le menu — la bannière hors ligne
      // déjà affichée (OfflineBanner) reste le signal que ces données
      // peuvent ne plus être à jour. Toute autre erreur (permission,
      // compte bloqué...) garde le comportement d'origine.
      const cached = isNetworkError(e) ? readCachedAuthSnapshot(session.user.id) : null;
      if (cached) {
        setProfile(cached.profile);
        setAssociation(cached.association);
        setSubscription(cached.subscription);
      } else {
        setErr(t("load_profile_error") + " " + friendlyError(e, t));
      }
    } finally {
      setLoading(false);
    }
  }, [session.user.id]);

  useEffect(() => { load(); }, [load]);

  // 2026-10-06 (demandé par l'utilisateur) — soumission réelle de
  // CompleteJoinRequestForm : téléverse la pièce d'identité et, si
  // fournie, la preuve de paiement de l'inscription (bucket privé
  // "member-join-documents", chemin "<auth.uid()>/...", seul emplacement
  // possible puisqu'aucun profil n'existe encore à cet instant — voir
  // sql/2026-10-06_demande_adhesion_complete.sql), PUIS appelle
  // join_association_with_code() avec tout — c'est SEULEMENT cette RPC qui
  // crée réellement le profil et envoie la demande au bureau.
  async function finishJoinRequest(form) {
    const uid = session.user.id;
    let pieceIdentitePath = null, preuvePaiementPath = null;
    if (form.pieceIdentiteFile) {
      const path = `${uid}/identite_${Date.now()}_${form.pieceIdentiteFile.name}`;
      const { error } = await supabase.storage.from("member-join-documents").upload(path, form.pieceIdentiteFile);
      if (error) throw error;
      pieceIdentitePath = path;
    }
    if (form.paiementMode === "fichier" && form.paiementFile) {
      const path = `${uid}/paiement_${Date.now()}_${form.paiementFile.name}`;
      const { error } = await supabase.storage.from("member-join-documents").upload(path, form.paiementFile);
      if (error) throw error;
      preuvePaiementPath = path;
    }
    const { error: rpcError } = await supabase.rpc("join_association_with_code", {
      p_code: pendingJoinData.code, p_nom_complet: pendingJoinData.nomComplet,
      p_courriel: form.courriel || null, p_telephone: form.telephone || null, p_sexe: form.sexe || null,
      p_date_naissance: form.dateNaissance || null, p_quartier: form.quartier || null,
      p_competences: form.competences || null, p_disponible_benevolat: !!form.disponibleBenevolat,
      p_piece_identite_path: pieceIdentitePath, p_piece_identite_nom: form.pieceIdentiteFile?.name || null,
      p_preuve_paiement_mode: form.paiementMode === "non_paye" ? null : form.paiementMode,
      p_preuve_paiement_path: preuvePaiementPath, p_preuve_paiement_nom: form.paiementFile?.name || null,
      p_preuve_paiement_montant: form.paiementMontant ? Number(form.paiementMontant) : null,
      p_preuve_paiement_note: form.paiementNote || null,
    });
    if (rpcError) throw rpcError;
    try { localStorage.removeItem("arem_pending_signup"); } catch { /* ignore */ }
    setPendingJoinData(null);
    load();
  }

 if (loading) return <FullPageLoader text={t("load_space")} />;
if (pendingJoinData) return <CompleteJoinRequestForm pendingJoinData={pendingJoinData} defaultEmail={session.user.email} onSubmit={finishJoinRequest} onCancel={() => supabase.auth.signOut()} />;
if (err) return <FullPageLoader text={err} />;
if (!profile) return <FullPageLoader text={t("load_profile_missing")} />;
if (profile.compte_bloque) return <BlockedAccountScreen />;
if (profile.acces_en_attente) return <PendingAccessScreen />;

  const primary = association?.couleur_primaire || EMERALD_DARK_DEFAULT;
  const accent = association?.couleur_accent || "#C8963E";
  const primaryDark = shade(primary, -18);

  const theme = { "--primary": primary, "--primary-dark": primaryDark, "--accent": accent };

  function confirmLogout() {
    if (window.confirm(t("auth_confirm_logout"))) supabase.auth.signOut();
  }

  if (profile.role === "super_admin") {
    return (
      <div style={{ ...theme, minHeight: "100vh" }}>
        <SuperAdminPanel profile={profile} onLogout={confirmLogout} />
      </div>
    );
  }

  return (
    <div style={{ ...theme, minHeight: "100vh" }}>
      <MainApp profile={profile} association={association} subscription={subscription}
        onAssociationChange={setAssociation} onProfileChange={setProfile} onLogout={confirmLogout} />
    </div>
  );
}

function shade(hex, percent) {
  try {
    const num = parseInt(hex.replace("#", ""), 16);
    let r = (num >> 16) + Math.round(2.55 * percent);
    let g = ((num >> 8) & 0x00ff) + Math.round(2.55 * percent);
    let b = (num & 0x0000ff) + Math.round(2.55 * percent);
    r = Math.min(255, Math.max(0, r)); g = Math.min(255, Math.max(0, g)); b = Math.min(255, Math.max(0, b));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  } catch { return hex; }
}

// Variables CSS --primary/--primary-dark/--accent, réappliquées localement
// sur la racine de chaque modale imprimable (Reçu, Décharge, Modalités du
// prêt) — nécessaire car ces modales sont rendues via createPortal
// directement sur document.body, hors de l'arbre DOM du composant racine
// qui porte ces variables (voir MainApp) : un portail échappe à l'arbre
// DOM (et donc à l'héritage CSS), même s'il reste dans l'arbre React. Sans
// ceci, un bouton "primary" (var(--accent)/var(--primary-dark)) dans une
// de ces modales retombe sur une couleur non définie/incohérente au lieu
// de reprendre les couleurs configurées par l'association (suite 50,
// 2026-09-10, correctif du bouton d'impression du reçu apparaissant en
// mauve au lieu de la couleur de marque).
function themeVarsFor(association) {
  const primary = association?.couleur_primaire || EMERALD_DARK_DEFAULT;
  const accent = association?.couleur_accent || "#C8963E";
  return { "--primary": primary, "--primary-dark": shade(primary, -18), "--accent": accent };
}

// =====================================================================
// PANNEAU SUPER-ADMINISTRATEUR
// =====================================================================
function SuperAdminPanel({ onLogout }) {
  const { t } = useLang();
  const [associations, setAssociations] = useState([]);
  const [subs, setSubs] = useState([]);
  const [planRequests, setPlanRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  // Création manuelle (deuxième voie de provisionnement, en complément de
  // l'auto-inscription) — corrige le bug de l'« association orpheline » :
  // l'ancienne création ci-dessous n'assignait jamais de président, ce qui
  // rendait l'association impossible à administrer. create_association_manual()
  // génère un code d'invitation et invite directement la personne responsable
  // par courriel ; elle devient présidente dès sa première connexion avec ce
  // code (voir join_association_with_code() dans
  // sql/2026-10-05_provisionnement_forfaits.sql).
  const [manualForm, setManualForm] = useState({ nomAssociation: "", nomResponsable: "", emailResponsable: "" });
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMsg, setManualMsg] = useState("");
  // Demandes de changement de forfait par virement Interac — seul le
  // Super-Admin (ici) peut les confirmer ou les rejeter, jamais le bureau
  // de l'association elle-même (voir submitForfaitInterac dans MainApp).
  const [resolvingId, setResolvingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: a }, { data: s }, { data: pr }] = await Promise.all([
      supabase.from("associations").select("*").order("created_at", { ascending: false }),
      supabase.from("subscriptions").select("*"),
      supabase.from("plan_change_requests").select("*").order("created_at", { ascending: false }),
    ]);
    setAssociations(a || []); setSubs(s || []); setPlanRequests(pr || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createAssociationManual() {
    if (!manualForm.nomAssociation.trim() || !manualForm.emailResponsable.trim()) return;
    if (!window.confirm(t("sa_confirm_create_manual").replace("{nom}", manualForm.nomAssociation.trim()))) return;
    setManualBusy(true); setManualMsg("");
    try {
      const { error } = await supabase.rpc("create_association_manual", {
        p_nom_association: manualForm.nomAssociation.trim(),
        p_nom_responsable: manualForm.nomResponsable.trim() || null,
        p_email_responsable: manualForm.emailResponsable.trim(),
      });
      if (error) throw error;
      setManualForm({ nomAssociation: "", nomResponsable: "", emailResponsable: "" });
      setManualMsg(t("sa_manual_success"));
      load();
    } catch (e) {
      setManualMsg(t("sa_manual_error") + " " + friendlyError(e, t));
    } finally {
      setManualBusy(false);
    }
  }
  async function updateSub(subId, patch) {
    await supabase.from("subscriptions").update(patch).eq("id", subId);
    load();
  }
  async function resolvePlanRequest(req, approve) {
    const assocNom = associations.find((a) => a.id === req.association_id)?.nom || "—";
    const confirmMsg = approve
      ? t("sa_confirm_approve_plan_request").replace("{nom}", assocNom).replace("{plan}", req.plan_demande === "premium" ? t("sa_plan_premium") : t("sa_plan_standard"))
      : t("sa_confirm_reject_plan_request").replace("{nom}", assocNom);
    if (!window.confirm(confirmMsg)) return;
    const commentaire = approve ? null : (window.prompt(t("sa_reject_reason_prompt")) || null);
    setResolvingId(req.id);
    try {
      const { error } = await supabase.rpc("resolve_plan_change_request", { p_request_id: req.id, p_approve: approve, p_commentaire: commentaire });
      if (error) throw error;
      load();
    } catch (e) {
      alert(friendlyError(e, t));
    } finally {
      setResolvingId(null);
    }
  }
  async function planRequestProofUrl(req) {
    const { data, error } = await supabase.storage.from("plan-change-proofs").createSignedUrl(req.fichier_path, 60);
    if (!error && data) window.open(data.signedUrl, "_blank");
  }
  // Verrou d'activation du module Covoiturage par association (suite
  // 2026-10-08, demande explicite de l'utilisateur : « je donne accès à
  // l'association que je veux, je ne suis pas obligé de l'ouvrir pour
  // toutes ») — indépendant du forfait, voir activer_module_covoiturage
  // (sql/2026-10-08d_activation_module_covoiturage.sql) et
  // ModuleRestreintSuperAdmin dans MainApp.
  async function toggleCovoiturageModule(a) {
    const current = a.covoiturage_module_actif ?? true;
    const next = !current;
    const confirmMsg = (next ? t("sa_confirm_toggle_covoiturage_on") : t("sa_confirm_toggle_covoiturage_off")).replace("{nom}", a.nom);
    if (!window.confirm(confirmMsg)) return;
    try {
      const { error } = await supabase.rpc("activer_module_covoiturage", { p_association_id: a.id, p_actif: next });
      if (error) throw error;
      load();
    } catch (e) {
      alert(friendlyError(e, t));
    }
  }
  // Facturation du module Covoiturage — inclus gratuitement ou add-on
  // payant (suite 2026-10-08, sql/2026-10-08i_covoiturage_facturation_
  // addon.sql et claude/covoiturage-facturation-addon-proposition.md) —
  // distinct de l'activation ci-dessus : ici on décide SI un module déjà
  // actif coûte quelque chose en plus de l'abonnement de l'association.
  const [facturationEdit, setFacturationEdit] = useState({});
  function getFacturationDraft(a) {
    return facturationEdit[a.id] ?? { facturation: a.covoiturage_facturation || "inclus", prix: a.covoiturage_addon_prix_mensuel || 0 };
  }
  function setFacturationField(a, field, value) {
    setFacturationEdit((prev) => ({ ...prev, [a.id]: { ...getFacturationDraft(a), [field]: value } }));
  }
  function isFacturationDirty(a) {
    const draft = getFacturationDraft(a);
    return draft.facturation !== (a.covoiturage_facturation || "inclus") || Number(draft.prix || 0) !== Number(a.covoiturage_addon_prix_mensuel || 0);
  }
  async function saveFacturation(a) {
    const draft = getFacturationDraft(a);
    if (draft.facturation === "addon_payant" && !(Number(draft.prix) > 0)) {
      alert(t("sa_covoiturage_addon_prix_requis"));
      return;
    }
    const confirmMsg = draft.facturation === "addon_payant"
      ? t("sa_confirm_facturation_addon").replace("{nom}", a.nom).replace("{prix}", money(draft.prix))
      : t("sa_confirm_facturation_inclus").replace("{nom}", a.nom);
    if (!window.confirm(confirmMsg)) return;
    try {
      const { error } = await supabase.rpc("configurer_facturation_covoiturage", {
        p_association_id: a.id,
        p_facturation: draft.facturation,
        p_prix: draft.facturation === "addon_payant" ? Number(draft.prix) : 0,
      });
      if (error) throw error;
      setFacturationEdit((prev) => { const next = { ...prev }; delete next[a.id]; return next; });
      load();
    } catch (e) {
      alert(friendlyError(e, t));
    }
  }

 if (loading) return <FullPageLoader text={t("load_superadmin")} />;

  const pendingPlanRequests = planRequests.filter((r) => r.statut === "en_attente");
  const now = Date.now();
  const kpi = {
    total: associations.length,
    actives: subs.filter((s) => s.statut === "actif").length,
    essai: subs.filter((s) => s.plan === "essai").length,
    suspendues: subs.filter((s) => s.statut === "suspendu").length,
    essaiEcheance: subs.filter((s) => s.plan === "essai" && s.date_fin_periode && new Date(s.date_fin_periode).getTime() - now >= 0 && new Date(s.date_fin_periode).getTime() - now < 7 * 24 * 60 * 60 * 1000).length,
    forfaitsEnAttente: pendingPlanRequests.length,
  };
  // Tableau de bord Covoiturage — vue d'ensemble demandée par l'utilisateur
  // pour piloter l'accès ET la facturation du module depuis un seul écran
  // (suite 2026-10-08, sql/2026-10-08i_covoiturage_facturation_addon.sql).
  const covoiturageActives = associations.filter((a) => a.covoiturage_module_actif ?? true);
  const covoiturageKpi = {
    actifs: covoiturageActives.length,
    gratuits: covoiturageActives.filter((a) => (a.covoiturage_facturation || "inclus") === "inclus").length,
    payants: covoiturageActives.filter((a) => a.covoiturage_facturation === "addon_payant").length,
    revenuPotentiel: covoiturageActives
      .filter((a) => a.covoiturage_facturation === "addon_payant")
      .reduce((sum, a) => sum + Number(a.covoiturage_addon_prix_mensuel || 0), 0),
  };

  return (
    <div style={{ fontFamily: "Inter, sans-serif", background: BG, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');
        h1,h2,h3 { font-family: 'Fraunces', Georgia, serif; }
      `}</style>
      <header style={{ background: EMERALD_DARK_DEFAULT, padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontFamily: "Fraunces, Georgia, serif", fontWeight: 700, color: "white", fontSize: 18 }}>{t("sa_header_title")}</span>
      <Btn variant="outlineWhite" onClick={onLogout}><LogOut size={14} /> {t("action_logout")}</Btn>
      </header>
      <Container>
        <Section>
         <h2 style={{ fontFamily: "Fraunces, Georgia, serif", color: EMERALD_DARK_DEFAULT, marginBottom: 20 }}>{t("sa_orgs_title")}</h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 28 }}>
            <StatCard label={t("sa_kpi_total")} value={kpi.total} icon={Building2} accent={EMERALD_DARK_DEFAULT} />
            <StatCard label={t("sa_kpi_actives")} value={kpi.actives} icon={ShieldCheck} accent={TEAL} />
            <StatCard label={t("sa_kpi_essai")} value={kpi.essai} icon={CalendarDays} accent="#C8963E" />
            <StatCard label={t("sa_kpi_essai_echeance")} value={kpi.essaiEcheance} icon={AlertTriangle} accent={AMBER} />
            <StatCard label={t("sa_kpi_suspendues")} value={kpi.suspendues} icon={Ban} accent={RED} />
            <StatCard label={t("sa_kpi_forfaits_attente")} value={kpi.forfaitsEnAttente} icon={CreditCard} accent={EMERALD_DARK_DEFAULT} />
          </div>

          <h3 style={{ fontFamily: "Fraunces, Georgia, serif", color: EMERALD_DARK_DEFAULT, marginBottom: 14, fontSize: 16 }}>{t("sa_new_org_title")}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, marginBottom: 28 }}>
            <Card style={{ borderTopColor: EMERALD_DARK_DEFAULT }}>
              <h3 style={{ fontSize: 14, marginBottom: 8, color: EMERALD_DARK_DEFAULT }}>{t("sa_auto_title")}</h3>
              <p style={{ fontSize: 12.5, color: "#5B6270", lineHeight: 1.6, margin: 0 }}>{t("sa_auto_desc")}</p>
            </Card>
            <Card style={{ borderTopColor: "#C8963E" }}>
              <h3 style={{ fontSize: 14, marginBottom: 4, color: EMERALD_DARK_DEFAULT }}>{t("sa_manual_title")}</h3>
              <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("sa_manual_desc")}</p>
              <Field label={t("sa_name")}><input style={inputStyle} value={manualForm.nomAssociation} onChange={(e) => setManualForm({ ...manualForm, nomAssociation: e.target.value })} /></Field>
              <Field label={t("sa_manual_nom_responsable")}><input style={inputStyle} value={manualForm.nomResponsable} onChange={(e) => setManualForm({ ...manualForm, nomResponsable: e.target.value })} /></Field>
              <Field label={t("sa_manual_email_responsable")}><input type="email" style={inputStyle} value={manualForm.emailResponsable} onChange={(e) => setManualForm({ ...manualForm, emailResponsable: e.target.value })} /></Field>
              <Btn onClick={createAssociationManual} disabled={manualBusy} style={{ background: "#C8963E", color: "#152645" }}>
                <Plus size={14} /> {manualBusy ? t("sa_manual_creating") : t("sa_manual_create_btn")}
              </Btn>
              {manualMsg && <p style={{ fontSize: 11.5, color: TEAL, fontWeight: 600, marginTop: 10 }}>{manualMsg}</p>}
            </Card>
          </div>

          {pendingPlanRequests.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontFamily: "Fraunces, Georgia, serif", color: EMERALD_DARK_DEFAULT, marginBottom: 14, fontSize: 16 }}>{t("sa_plan_requests_title")}</h3>
              <Table head={[t("sa_col_org"), t("sa_plan_requests_col_plan"), t("sa_plan_requests_col_montant"), t("sa_plan_requests_col_proof"), t("sa_col_actions")]}>
                {pendingPlanRequests.map((r) => {
                  const assocNom = associations.find((a) => a.id === r.association_id)?.nom || "—";
                  return (
                    <tr key={r.id}>
                      <td style={{ ...td, fontWeight: 600, color: EMERALD_DARK_DEFAULT }}>{assocNom}</td>
                      <td style={td}>{r.plan_demande === "premium" ? t("sa_plan_premium") : t("sa_plan_standard")}</td>
                      <td style={td}>{money(r.montant)}</td>
                      <td style={td}><Btn variant="outline" onClick={() => planRequestProofUrl(r)} style={{ padding: "5px 12px", fontSize: 12 }}><Eye size={13} /> {t("sa_plan_requests_view_proof")}</Btn></td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Btn onClick={() => resolvePlanRequest(r, true)} disabled={resolvingId === r.id} style={{ background: TEAL, color: "white", padding: "6px 14px", fontSize: 12 }}>{t("sa_plan_requests_confirm")}</Btn>
                          <Btn variant="danger" onClick={() => resolvePlanRequest(r, false)} disabled={resolvingId === r.id} style={{ padding: "6px 14px", fontSize: 12 }}>{t("sa_plan_requests_reject")}</Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </div>
          )}

          <div style={{ marginBottom: 28 }}>
            <h3 style={{ fontFamily: "Fraunces, Georgia, serif", color: EMERALD_DARK_DEFAULT, marginBottom: 14, fontSize: 16 }}>{t("sa_covoiturage_dashboard_title")}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
              <StatCard label={t("sa_covoiturage_dashboard_actifs")} value={covoiturageKpi.actifs} icon={Car} accent={EMERALD_DARK_DEFAULT} />
              <StatCard label={t("sa_covoiturage_dashboard_gratuits")} value={covoiturageKpi.gratuits} icon={ShieldCheck} accent={TEAL} />
              <StatCard label={t("sa_covoiturage_dashboard_payants")} value={covoiturageKpi.payants} icon={Wallet} accent="#C8963E" />
              <StatCard label={t("sa_covoiturage_dashboard_revenu")} value={money(covoiturageKpi.revenuPotentiel)} icon={CreditCard} accent={EMERALD_DARK_DEFAULT} />
            </div>
          </div>

          <h3 style={{ fontFamily: "Fraunces, Georgia, serif", color: EMERALD_DARK_DEFAULT, marginBottom: 14, fontSize: 16 }}>{t("sa_all_orgs_title")}</h3>
           <Table head={[t("sa_col_org"), t("sa_col_created"), t("sa_col_plan"), t("sa_col_status"), t("sa_col_period_end"), t("sa_col_covoiturage"), t("sa_col_covoiturage_facturation"), t("sa_col_actions")]}>
              {associations.map((a) => {
                const sub = subs.find((s) => s.association_id === a.id);
                const covoiturageActif = a.covoiturage_module_actif ?? true;
                const facturationDraft = getFacturationDraft(a);
                return (
                  <tr key={a.id}>
                    <td style={{ ...td, fontWeight: 600, color: EMERALD_DARK_DEFAULT }}>
                      {a.nom}
                      {a.premier_responsable_requis && <div style={{ fontSize: 10.5, color: AMBER, fontWeight: 600 }}>{t("sa_awaiting_first_login")}</div>}
                    </td>
                    <td style={td}>{new Date(a.created_at).toLocaleDateString("fr-CA")}</td>
                    <td style={td}>
                      <select value={sub?.plan || "essai"} onChange={(e) => { if (sub && window.confirm(t("sa_confirm_change_plan").replace("{nom}", a.nom).replace("{plan}", e.target.value))) updateSub(sub.id, { plan: e.target.value }); }} style={{ ...inputStyle, padding: "3px 6px", fontSize: 12 }}>
                       <option value="essai">{t("sa_plan_trial")}</option><option value="standard">{t("sa_plan_standard")}</option><option value="premium">{t("sa_plan_premium")}</option>
                      </select>
                    </td>
                    <td style={td}>
                      <select value={sub?.statut || "actif"} onChange={(e) => { if (sub && window.confirm(t("sa_confirm_change_status").replace("{nom}", a.nom).replace("{statut}", e.target.value))) updateSub(sub.id, { statut: e.target.value }); }} style={{ ...inputStyle, padding: "3px 6px", fontSize: 12 }}>
                       <option value="actif">{t("sa_status_active")}</option><option value="suspendu">{t("sa_status_suspended")}</option><option value="annule">{t("sa_status_cancelled")}</option>
                      </select>
                    </td>
                    <td style={td}>{sub?.date_fin_periode || "—"}</td>
                    <td style={td}>
                      <Btn variant={covoiturageActif ? "outline" : "primary"} onClick={() => toggleCovoiturageModule(a)} style={{ padding: "5px 12px", fontSize: 11.5, ...(covoiturageActif ? {} : { background: "#C8963E", color: "#182233" }) }}>
                        {covoiturageActif ? t("sa_covoiturage_active_label") : t("sa_covoiturage_inactive_label")}
                      </Btn>
                    </td>
                    <td style={td}>
                      {!covoiturageActif ? (
                        <span style={{ fontSize: 11, color: "#AAB0BB" }}>—</span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
                          <Pill color={facturationDraft.facturation === "addon_payant" ? "#C8963E" : TEAL} bg={facturationDraft.facturation === "addon_payant" ? "#FBF3D9" : TEAL_LIGHT}>
                            {a.covoiturage_facturation === "addon_payant" ? `+${money(a.covoiturage_addon_prix_mensuel)}/${t("cfg_forfait_par_mois")}` : t("sa_facturation_badge_gratuit")}
                          </Pill>
                          <select
                            value={facturationDraft.facturation}
                            onChange={(e) => setFacturationField(a, "facturation", e.target.value)}
                            style={{ ...inputStyle, padding: "3px 6px", fontSize: 11.5 }}
                          >
                            <option value="inclus">{t("sa_facturation_inclus")}</option>
                            <option value="addon_payant">{t("sa_facturation_addon")}</option>
                          </select>
                          {facturationDraft.facturation === "addon_payant" && (
                            <input
                              type="number" min="0.01" step="0.01"
                              value={facturationDraft.prix}
                              onChange={(e) => setFacturationField(a, "prix", e.target.value)}
                              placeholder={t("sa_facturation_prix_placeholder")}
                              style={{ ...inputStyle, padding: "3px 6px", fontSize: 11.5, width: 100 }}
                            />
                          )}
                          {isFacturationDirty(a) && (
                            <Btn onClick={() => saveFacturation(a)} style={{ padding: "4px 10px", fontSize: 11 }}>{t("action_save")}</Btn>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={td}><span style={{ fontSize: 11, color: "#686F7D" }}>ID: {a.id.slice(0, 8)}…</span></td>
                  </tr>
                );
              })}
            </Table>
          <p style={{ fontSize: 12, color: "#686F7D", marginTop: 20, maxWidth: 700 }}>
  {t("sa_stripe_note")}
</p>
        </Section>
      </Container>
    </div>
  );
}

// =====================================================================
// APPLICATION PRINCIPALE (bureau / responsable / adhérent)
// =====================================================================
function MainApp({ profile, association, subscription, onAssociationChange, onProfileChange, onLogout }) {
 const { t, lang } = useLang();
  const [tab, setTab] = useState("apercu");
  // Groupes de la sidebar repliés/dépliés (suite 2026-10-06, refonte
  // navigation — remplace le menu horizontal à 26 items qui wrappait sur
  // plusieurs lignes par une sidebar groupée, cf. maquette validée). Un
  // groupe qui contient l'onglet actif s'ouvre automatiquement (voir
  // isGroupOpen plus bas) même s'il avait été replié.
  const [collapsedGroups, setCollapsedGroups] = useState({});
  // Repli de la sidebar entière en rail d'icônes (suite 2026-10-06, demandé
  // par l'utilisateur en complément du repli par groupe ci-dessus). Mémorisé
  // en localStorage (par navigateur/appareil, pas par compte) comme une
  // simple préférence d'affichage — jamais lu pour une décision de sécurité
  // ou d'accès, donc aucun risque à ce que ça échoue silencieusement sur un
  // navigateur qui bloque le stockage local.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem("unia_sidebar_collapsed") === "1"; } catch { return false; }
  });
  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("unia_sidebar_collapsed", next ? "1" : "0"); } catch { /* stockage indisponible : préférence non mémorisée, sans impact fonctionnel */ }
      return next;
    });
  }
  // Sélecteur d'association (suite 2026-10-06, section 8 de
  // claude/architecture-multi-association.md — "n'importe quel
  // utilisateur pourra un jour appartenir à plusieurs associations").
  // Tant que association_memberships ne contient qu'une ligne pour ce
  // compte (cas de tout le monde aujourd'hui, avant exécution de la
  // migration SQL par l'utilisateur, et le cas normal ensuite pour un
  // compte qui n'a toujours rejoint qu'une seule association), le
  // sélecteur reste un simple affichage statique dans la sidebar — pas de
  // menu déroulant qui ne proposerait rien d'autre. orgSwitching distingue
  // "aucune requête encore reçue" (null, affichage statique par défaut) de
  // "chargée, une seule appartenance" ([un seul élément]) : évite un
  // clignotement du sélecteur au premier rendu.
  const [memberships, setMemberships] = useState(null);
  const [orgSwitcherOpen, setOrgSwitcherOpen] = useState(false);
  const [switchingOrgId, setSwitchingOrgId] = useState(null);
  const orgSwitcherRef = useRef(null);
  useEffect(() => {
    supabase
      .from("association_memberships")
      .select("association_id, role, associations:association_id(nom, logo_url)")
      .eq("profile_id", profile.id)
      .then(({ data, error }) => {
        // error attendu (table absente) tant que la migration SQL de la
        // section 8 n'a pas été exécutée — échec silencieux volontaire,
        // le sélecteur reste alors simplement un affichage statique.
        if (!error && data) setMemberships(data);
      });
  }, [profile.id]);
  async function switchAssociation(targetAssociationId) {
    if (targetAssociationId === profile.association_id) { setOrgSwitcherOpen(false); return; }
    setSwitchingOrgId(targetAssociationId);
    const { error } = await supabase.rpc("switch_association", { p_association_id: targetAssociationId });
    if (error) {
      setSwitchingOrgId(null);
      alert(friendlyError(error, t));
      return;
    }
    // Rechargement complet plutôt qu'une mise à jour locale de l'état :
    // changer d'association change aussi le rôle, le forfait et toutes les
    // données déjà chargées (membres, finances, documents...) — un
    // rechargement garantit un état cohérent plutôt que de corriger chaque
    // morceau d'état local un par un.
    window.location.reload();
  }

  // Compte personnel lié + bascule rapide (suite 2026-10-06, en
  // remplacement de la fusion "Mon espace" dans le compte bureau
  // abandonnée à la demande de l'utilisateur : un·e successeur·e au
  // bureau ne doit jamais hériter de l'accès aux informations
  // personnelles de la personne précédente). Contrairement au sélecteur
  // d'association ci-dessus (qui ne fait que repointer association_id sur
  // la MÊME ligne profiles), ceci implique deux comptes bien distincts —
  // deux lignes auth.users/profiles séparées, puisque profiles.id est
  // 1:1 avec auth.users.id. On ne stocke donc ici qu'une adresse courriel
  // de confort (jamais de mot de passe ni de session parallèle) ; chaque
  // bascule redemande le mot de passe du compte personnel, ce qui reste
  // simple et sûr, et ne crée aucune session persistante partagée entre
  // les deux comptes.
  async function linkPersonalAccount(email) {
    const { error } = await supabase.from("profiles").update({ compte_personnel_email: email }).eq("id", profile.id);
    if (error) { alert(friendlyError(error, t)); return false; }
    onProfileChange?.({ ...profile, compte_personnel_email: email });
    return true;
  }

  function switchToPersonalAccount() {
    const email = profile.compte_personnel_email;
    if (!email) return;
    if (!window.confirm(t("switch_personal_confirm").replace("{email}", email))) return;
    // Jeton de préremplissage à usage unique, lu et aussitôt effacé par
    // LandingAuthScreen/AuthScreen au prochain montage (après la
    // déconnexion ci-dessous) — jamais de mot de passe stocké.
    try {
      window.localStorage.setItem("arem_switch_prefill_email", email);
      window.localStorage.setItem("arem_switch_autoopen", "1");
    } catch { /* stockage indisponible : la bascule fonctionne quand même, juste sans préremplissage */ }
    supabase.auth.signOut();
  }
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [payingType, setPayingType] = useState(null);
  const [selectedPayType, setSelectedPayType] = useState(null);
  const [payMethod, setPayMethod] = useState(null);
  const [interacCopyMsg, setInteracCopyMsg] = useState("");
  const [showTxDetail, setShowTxDetail] = useState(false);
  // Historique des demandes Interac du membre pour la rubrique ouverte,
  // toutes statuts confondus (en_attente/confirme/rejete/annule) — distinct
  // du tableau des transactions confirmées : une demande annulée ou
  // rejetée ne génère jamais de ligne dans payment_transactions (aucun
  // argent n'a changé de main), mais l'utilisateur doit tout de même
  // pouvoir la retrouver plutôt que la voir disparaître sans trace (suite
  // 50, 2026-09-11).
  const [showInteracHistory, setShowInteracHistory] = useState(false);
  // Journal chronologique unique, toutes rubriques confondues (suite 52,
  // 2026-09-11) : contrairement au détail par transaction du panneau de
  // paiement (limité à une seule rubrique à la fois), cette vue combine
  // inscription/cotisation/collation/fonds urgence/fonds secours/don/
  // prêt/recouvrement dans UNE seule liste triée par date — pour que le
  // membre voie toutes ses écritures sans devoir ouvrir chaque rubrique
  // une par une.
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [allHistoryFilter, setAllHistoryFilter] = useState("all");
  const [receiptFor, setReceiptFor] = useState(null); // { type, claims } | null — voir ReceiptModal
  const [loanTermsOpen, setLoanTermsOpen] = useState(false);
  // Notifications push web (suite 82, 2026-09-28) : "unsupported" | "denied"
  // | "subscribed" | "unsubscribed" | "loading" — pilote l'affichage et le
  // comportement du bouton 🔔 dans l'en-tête, visible par tout profil
  // connecté (Bureau ou adhérent), pas seulement dans "Mon espace".
  const [pushState, setPushState] = useState("loading");
  useEffect(() => {
    getPushSubscriptionState().then(setPushState);
  }, []);
  async function togglePush() {
    if (pushState === "subscribed") {
      await unsubscribeFromPush(supabase);
      setPushState("unsubscribed");
      return;
    }
    try {
      await subscribeToPush(supabase, profile.id, profile.association_id);
      setPushState("subscribed");
    } catch (err) {
      if (err?.message === "denied") {
        alert(t("push_denied_msg"));
        setPushState("denied");
      } else if (err?.message === "unsupported") {
        setPushState("unsupported");
      } else {
        console.error(err);
        alert(t("push_error_generic"));
      }
    }
  }
  // Avant de déclencher la demande de permission native du navigateur
  // (dont le texte, "ce site veut afficher des notifications", n'est ni
  // modifiable ni traduisible — c'est le navigateur qui l'affiche, pas
  // notre application), on explique nous-mêmes pourquoi en français dans
  // une petite boîte de dialogue (suite 82, 2026-09-28, à la demande de
  // l'utilisateur : "fait en sorte que le message soit compréhensible").
  // Cliquer sur "Activer" y déclenche togglePush(), qui lui affiche alors
  // la demande native du navigateur. Ne s'applique qu'au premier clic : si
  // déjà abonné, on désabonne directement (pas besoin de réexpliquer), et
  // si déjà bloqué par le navigateur, on redirige vers le message d'aide
  // existant (push_denied_msg) plutôt que de rouvrir cette explication.
  const [pushPromptOpen, setPushPromptOpen] = useState(false);
  function handleBellClick() {
    if (pushState === "subscribed") {
      togglePush();
    } else if (!isPremiumPlan) {
      alert(t("push_premium_msg"));
    } else if (pushState === "denied") {
      alert(t("push_denied_msg"));
    } else {
      setPushPromptOpen(true);
    }
  }
  // Ligne de recouvrement (fonds_recouvrements) actuellement sélectionnée
  // pour paiement — distinct des 7 types de la grille de cartes ci-dessus
  // car il peut exister PLUSIEURS lignes de recouvrement indépendantes
  // (une par dépense de fonds), chacune avec sa propre quote-part, plutôt
  // qu'un montant unique par membre (suite 51, 2026-09-11).
  const [selectedRecouvrement, setSelectedRecouvrement] = useState(null);
  function openPayPanel(type) {
    setSelectedPayType((prev) => (prev === type ? null : type));
    setSelectedRecouvrement(null);
    setPayMethod(null);
    setInteracCopyMsg("");
    setManualAmount("");
    setShowTxDetail(false);
    setShowInteracHistory(false);
  }
  // Ouvre le panneau de paiement pour UNE ligne de recouvrement précise
  // (jamais un simple bascule comme openPayPanel : cliquer "Payer" sur une
  // autre ligne pendant que le panneau est déjà ouvert doit basculer son
  // contenu, pas le fermer).
  function openRecouvrementPayPanel(r) {
    const depenses = r.fondsCode === "urgence" ? fuDepenses : fsDepenses;
    const dep = depenses.find((d) => d.id === r.depense_id);
    setSelectedPayType("recouvrement");
    setSelectedRecouvrement({ ...r, description: dep?.description || "" });
    setPayMethod(null);
    setInteracCopyMsg("");
    setManualAmount("");
    setShowTxDetail(false);
    setShowInteracHistory(false);
  }
  function copyInteracText(text) {
    try {
      navigator.clipboard.writeText(text);
      setInteracCopyMsg(t("ms_interac_copied"));
      setTimeout(() => setInteracCopyMsg(""), 2000);
    } catch { /* presse-papiers indisponible : rien à signaler */ }
  }

  // Déclarée ici (et pas avec bureauProfiles/deletionRequests plus bas)
  // car myRoleConfig, juste en dessous, en a besoin immédiatement — la
  // déclarer plus loin dans ce même composant aurait levé une
  // ReferenceError ("Cannot access 'roleConfigs' before initialization")
  // à chaque rendu de MainApp pour un compte bureau (zone morte
  // temporelle d'un const utilisé avant sa propre ligne). Bug introduit
  // puis corrigé dans la même session, suite 2026-10-07 — voir
  // sql/2026-10-07d_configuration_roles_bureau.sql.
  const [roleConfigs, setRoleConfigs] = useState([]);
  const isBureau = ["bureau_president", "bureau_secretaire", "bureau_tresorier", "bureau_custom"].includes(profile.role);
  const isPresident = profile.role === "bureau_president";
  // Comité restreint (ComiteRestreint.jsx, 2026-10-09) : rubrique visible
  // seulement des membres du comité (président d'office compris), ou du
  // reste du bureau dès qu'une décision lui a été communiquée. La base
  // impose de toute façon la confidentialité (RLS) ; ceci ne fait que
  // cacher l'entrée du menu. Le président la voit toujours, même avant
  // l'exécution du script SQL, pour y trouver le message d'installation.
  const [comiteAcces, setComiteAcces] = useState(null);
  useEffect(() => {
    if (!["bureau_president", "bureau_secretaire", "bureau_tresorier", "bureau_custom"].includes(profile.role)) return;
    supabase.rpc("comite_mon_acces").then(({ data, error }) => setComiteAcces(error ? null : data));
  }, [profile.id, profile.role]);
  const comiteVisible = isPresident || !!comiteAcces?.membre || (comiteAcces?.communiquees || 0) > 0;
  const isResponsable = profile.role === "responsable_rubrique";
  const isAdherent = profile.role === "adherent";
  function canEditRubrique(name) { return isBureau || (isResponsable && profile.rubrique_assignee === name); }
  // Accès par module configuré pour le rôle de ce compte (suite
  // 2026-10-07 — voir BUREAU_CONFIGURABLE_MODULES et sql/2026-10-07d_
  // configuration_roles_bureau.sql). myRoleConfig reste null pour le
  // président (toujours accès complet, jamais restreignable — voir
  // en-tête du fichier SQL) ET pour un rôle qui n'a pas encore de ligne
  // de configuration (rétrocompatibilité : aucune association existante
  // ne perd d'accès tant que le président n'a rien configuré). Dans ces
  // deux cas, allowedBureauModules reste null = accès complet.
  const myRoleConfig = isPresident ? null : roleConfigs.find((r) =>
    profile.role === "bureau_custom" ? r.id === profile.bureau_role_config_id : r.cle === profile.role
  ) || null;
  const allowedBureauModules = myRoleConfig ? new Set(myRoleConfig.modules || []) : null;
  function canSeeBureauModule(moduleId) { return !allowedBureauModules || allowedBureauModules.has(moduleId); }
  // Garde-fou central : si le rôle de ce compte vient d'être restreint
  // (ou qu'un lien ailleurs dans l'appli pointe vers un module que son
  // rôle ne couvre plus), on le ramène à l'aperçu plutôt que de laisser
  // un onglet masqué du menu rester affiché s'il était déjà ouvert.
  useEffect(() => {
    if (isBureau && BUREAU_CONFIGURABLE_MODULES.includes(tab) && !canSeeBureauModule(tab)) setTab("apercu");
  }, [tab, isBureau, allowedBureauModules]);

  // ---------- Recherche globale : index des rubriques du menu ----------
  // Suite 2026-10-06, demande explicite de l'utilisateur : taper le nom
  // d'une rubrique du menu ("Vie associative", "États financiers") ou un
  // mot courant qui s'y rapporte ("bilan", "cotisation", "annuaire") ne
  // donnait jusqu'ici AUCUN résultat — la recherche globale (plus bas,
  // searchResults) ne portait que sur des DONNÉES (adhérents, documents,
  // transactions…), jamais sur les rubriques elles-mêmes. Liste séparée
  // de `navItems` (plus bas dans ce fichier, même structure id/label) :
  // `navItems` n'existe pas encore à ce point de la fonction, et cette
  // liste a en plus besoin de synonymes que la navigation elle-même
  // n'affiche jamais. À tenir à jour si une rubrique de navItems change —
  // même principe que ROLE_LABELS/ROLE_KEY_MAP plus haut dans ce fichier,
  // deux structures parallèles déjà acceptées ici.
  const PAGE_SEARCH_ITEMS = [
    { id: "apercu", label: t("nav_apercu"), roles: ["bureau", "responsable", "adherent"], keywords: [] },
    { id: "dashboard", label: t("nav_dashboard"), roles: ["bureau", "responsable"], keywords: ["résumé", "statistiques"] },
    { id: "membres", label: t("nav_members"), roles: ["bureau"], keywords: ["annuaire", "liste des membres", "fiche adhérent"] },
    { id: "inscription", label: t("nav_inscription"), roles: ["bureau"], keywords: ["frais d'adhésion", "carte de membre"] },
    { id: "tontine", label: t("nav_tontine"), roles: ["bureau"], keywords: ["cotisation"] },
    { id: "collation", label: t("nav_collation"), roles: ["bureau"], keywords: ["présence", "goûter"] },
    { id: "urgence", label: t("nav_urgence"), roles: ["bureau"], keywords: ["fonds d'urgence", "secours"] },
    { id: "secours", label: t("nav_secours"), roles: ["bureau"], keywords: ["fonds de secours", "entraide"] },
    { id: "finances", label: t("nav_finances"), roles: ["bureau", "responsable"], keywords: ["bilan", "synthèse financière", "trésorerie", "comptabilité", "revenus", "dépenses", "rapport financier", "état financier"] },
    { id: "paiements_interac", label: t("nav_interac"), roles: ["bureau"], keywords: ["virement", "e-transfer", "paiement en ligne"] },
    { id: "gouvernance", label: t("nav_governance"), roles: ["bureau", "responsable", "adherent"], keywords: ["mission", "vision", "valeurs", "bureau", "élection", "procès-verbal", "statuts"] },
    { id: "vieassociative", label: t("nav_community"), roles: ["bureau", "responsable", "adherent"], keywords: ["annuaire", "fil d'actualité", "publication", "réseau social", "anniversaire", "statut", "clavardage"] },
    { id: "presences", label: t("nav_presences"), roles: ["bureau"], keywords: ["présence", "pointage", "qr code", "assiduité"] },
    { id: "projets", label: t("nav_projects"), roles: ["bureau", "responsable"], keywords: ["initiative", "chantier"] },
    { id: "evenements", label: t("nav_events"), roles: ["bureau", "responsable", "adherent"], keywords: ["calendrier", "assemblée générale", "ag", "billet"] },
    { id: "covoiturage", label: t("nav_carpool"), roles: ["bureau", "responsable", "adherent"], keywords: ["trajet", "voiture", "transport"] },
    { id: "reunions", label: t("nav_meetings"), roles: ["bureau", "responsable", "adherent"], keywords: ["conseil", "assemblée", "webinaire", "visioconférence", "jitsi", "procès-verbal"] },
    { id: "emploi", label: t("nav_jobs"), roles: ["bureau", "responsable", "adherent"], keywords: ["carrière", "candidature", "bénévolat", "cv"] },
    { id: "sondages", label: t("nav_polls"), roles: ["bureau", "responsable", "adherent"], keywords: ["vote", "consultation"] },
    { id: "tirages", label: t("nav_draws"), roles: ["bureau", "responsable", "adherent"], keywords: ["tirage", "hasard", "ordre de passage", "tontine", "direct"] },
    { id: "jeunesse", label: t("nav_jeunesse"), roles: ["bureau", "responsable", "adherent"], keywords: ["tutorat", "mentor", "étudiant", "école", "bourse", "devoirs", "campus", "jeunes"] },
    { id: "achats", label: t("nav_achats"), roles: ["bureau", "responsable", "adherent"], keywords: ["achat groupé", "coopérative", "prix de gros", "commande", "colis", "conteneur", "envoi", "ristourne"] },
    { id: "funeraire", label: t("nav_funeraire"), roles: ["bureau", "responsable", "adherent"], keywords: ["décès", "deuil", "condoléances"] },
    { id: "sanctions", label: t("nav_sanctions"), roles: ["bureau", "adherent"], keywords: ["avertissement", "suspension", "discipline"] },
    { id: "comite", label: t("nav_comite"), roles: ["bureau"], keywords: ["comité restreint", "comité exécutif", "confidentiel", "décision"] },
    { id: "dons", label: t("nav_donations"), roles: ["bureau"], keywords: ["don", "contribution"] },
    { id: "emprunts", label: t("nav_loans"), roles: ["bureau"], keywords: ["prêt", "remboursement"] },
    { id: "documents", label: t("nav_documents"), roles: ["bureau", "responsable"], keywords: ["archive", "procès-verbal", "pv", "fichier"] },
    { id: "annonces", label: t("nav_announcements"), roles: ["bureau", "responsable", "adherent"], keywords: ["communiqué", "nouvelle"] },
    { id: "journal", label: t("nav_activity"), roles: ["bureau"], keywords: ["audit", "historique", "journal d'activité"] },
    { id: "demandes_suppression", label: t("nav_del_requests"), roles: ["bureau"], keywords: ["suppression", "effacer"] },
    { id: "acces", label: t("nav_access"), roles: ["bureau"], keywords: ["rattachement", "rôle", "compte"] },
    { id: "config", label: t("nav_config"), roles: ["bureau"], keywords: ["paramètres", "logo", "couleur", "vitrine", "forfait"] },
    { id: "securite", label: t("sec_title"), roles: ["bureau", "responsable", "adherent"], keywords: ["mot de passe", "2fa", "authentification"] },
    { id: "monespace", label: t("nav_myspace"), roles: ["adherent"], keywords: ["reçu", "carte de membre", "mes paiements"] },
  ];
  const searchRoleKey = isBureau ? "bureau" : isResponsable ? "responsable" : isAdherent ? "adherent" : null;
  // Le filtre canSeeBureauModule ne s'applique qu'aux ids réellement
  // configurables (BUREAU_CONFIGURABLE_MODULES) — "apercu"/"dashboard"
  // restent cherchables même sous un rôle restreint, exactement comme
  // dans navItems plus bas.
  const pageSearchIndex = searchRoleKey
    ? PAGE_SEARCH_ITEMS.filter((p) => p.roles.includes(searchRoleKey) && (searchRoleKey !== "bureau" || !BUREAU_CONFIGURABLE_MODULES.includes(p.id) || canSeeBureauModule(p.id)) && (p.id !== "comite" || comiteVisible))
    : [];

  // Verrouillage Premium (suite 2026-10-06, répartition Standard/Premium
  // définie dans claude/tarification-standard-premium-proposition.md,
  // §4 : jusqu'ici documentée mais jamais appliquée techniquement — toute
  // association, à l'essai comme en Standard, voyait tout). Demande
  // explicite de l'utilisateur : l'essai se comporte comme Standard, pas
  // comme Premium. Les onglets ci-dessous restent visibles dans le menu
  // (pas de disparition sans explication, suite à la recommandation du
  // document) mais affichent un message « Disponible en Premium » à la
  // place du contenu réel tant que subscription.plan !== "premium".
  // Rien n'est supprimé : une association qui repasse en Premium
  // retrouve immédiatement ses données existantes.
  const isPremiumPlan = subscription?.plan === "premium";
  // Tirage au sort en direct (Tirages.jsx, 2026-10-08) : un bandeau
  // s'affiche sur toutes les pages pour inviter chacun à rejoindre la
  // scène. Mis à jour en temps réel (même table que la rubrique).
  const [tirageEnDirect, setTirageEnDirect] = useState(null);
  useEffect(() => {
    if (!isPremiumPlan || !profile.association_id) return;
    const chercher = () => supabase.from("tirages").select("id, titre").eq("association_id", profile.association_id)
      .eq("statut", "en_cours").order("lance_le", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setTirageEnDirect(data || null));
    chercher();
    const channel = supabase.channel(`tirages-bandeau-${profile.association_id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tirages", filter: `association_id=eq.${profile.association_id}` }, chercher)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isPremiumPlan, profile.association_id]);
  const PREMIUM_FEATURE_IDS =["vieassociative", "presences", "projets", "evenements", "sondages", "tirages", "jeunesse", "achats", "funeraire", "sanctions", "covoiturage", "reunions", "emploi"];
  // Bouton « Passer à Premium » des écrans verrouillés : bascule sur
  // Configuration (où vit la carte « Votre forfait ») puis y fait défiler
  // la page — fonctionne qu'on parte d'un autre onglet ou qu'on soit déjà
  // sur Configuration (cas du volet Vitrine, lui aussi verrouillé).
  function goToForfait() {
    setTab("config");
    // 2026-10-06 — depuis que Configuration est classée par catégories
    // (voir CONFIG_SECTIONS), la carte du forfait n'existe dans le DOM que
    // lorsque la catégorie "abonnement" est active : il faut la sélectionner
    // avant de faire défiler, sinon #forfait-card n'existe pas encore.
    setConfigSection("abonnement");
    requestAnimationFrame(() => {
      document.getElementById("forfait-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const [members, setMembers] = useState([]);
  const [collationPres, setCollationPres] = useState([]);
  const [tontinePres, setTontinePres] = useState([]);
  const [seances, setSeances] = useState([]);
  const [fuDepenses, setFuDepenses] = useState([]);
  const [fsDepenses, setFsDepenses] = useState([]);
  const [fuRecouvrementsBruts, setFuRecouvrements] = useState([]);
  const [fsRecouvrementsBruts, setFsRecouvrements] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [announcementAcks, setAnnouncementAcks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [donations, setDonations] = useState([]);
  const [loans, setLoans] = useState([]);
  const [loanRepayments, setLoanRepayments] = useState([]);
  const [bureauProfiles, setBureauProfiles] = useState([]);
  const [deletionRequests, setDeletionRequests] = useState([]);
  // roleConfigs (suite 2026-10-07) est déclaré plus haut, avec isBureau —
  // voir le commentaire à cet endroit.
  const [pendingLinkRequestsCount, setPendingLinkRequestsCount] = useState(0);
  const [interacClaims, setInteracClaims] = useState([]);
  const [paymentTransactions, setPaymentTransactions] = useState([]);
  // Badges de notifications non lues (suite 92) — voir
  // claude/badges-notifications-non-lues-proposition.md.
  // refreshUnreadCounts (2026-10-06, signalé par l'utilisateur) :
  // "demandes_suppression"/"demandes_rattachement" sont les 2 seules des 8
  // rubriques comptées par get_unread_counts() qui ne passent jamais par
  // markViewed() (volontairement, pour ne pas dupliquer leur badge déjà
  // existant — voir BADGED_SECTIONS plus bas) — leur contribution au total
  // de la cloche 🔔 ne se recalcule donc QUE si on rappelle get_unread_counts()
  // nous-mêmes après avoir traité une demande. Ça manquait : la cloche
  // restait bloquée sur son compte initial (pris au chargement de la page)
  // même après qu'une demande de rattachement/suppression ait été résolue
  // dans l'onglet correspondant, qui ne vide, lui, que sa propre liste et
  // son propre badge de menu (pendingLinkRequestsCount / showBadge).
  const { counts: unreadCounts, total: unreadTotal, markViewed, refresh: refreshUnreadCounts } = useUnreadCounts();

  const loadAll = useCallback(async () => {
    setLoading(true); setErrorMsg("");
    try {
      const results = await Promise.all([
        supabase.from("members").select("*").order("nom"),
        supabase.from("collation_presences").select("*"),
        supabase.from("tontine_presences").select("*"),
        supabase.from("tontine_seances").select("*").order("numero"),
        supabase.from("fonds_depenses").select("*").order("date"),
        supabase.from("fonds_recouvrements").select("*"),
        supabase.from("announcements").select("*").order("created_at", { ascending: false }),
        isBureau ? supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
        supabase.from("documents").select("*").order("created_at", { ascending: false }),
        supabase.from("donations").select("*"),
        supabase.from("loans").select("*"),
        supabase.from("loan_repayments").select("*"),
        isBureau ? supabase.from("profiles").select("id,nom_complet,role").in("role", ["bureau_president", "bureau_secretaire", "bureau_tresorier"]).order("nom_complet") : Promise.resolve({ data: [] }),
        isBureau ? supabase.from("deletion_requests").select("*").order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
        isBureau ? supabase.from("member_link_requests").select("id", { count: "exact", head: true }).eq("statut", "en_attente") : Promise.resolve({ count: 0 }),
        supabase.from("interac_payment_claims").select("*").order("created_at", { ascending: false }),
        supabase.from("payment_transactions").select("*").order("created_at", { ascending: false }),
        supabase.from("announcement_acks").select("*"),
        // Demandes d'adhésion publiques en attente (suite 91/93) — comptées
        // ici en plus des demandes de rattachement pour que le badge du
        // menu « Gestion des accès » soit à jour dès le chargement de
        // l'application, pas seulement après avoir ouvert cet onglet une
        // première fois (celui-ci recalcule déjà les deux, voir
        // GestionAcces.jsx). Tolérant : ne bloque pas loadAll() si la
        // table n'existe pas encore (script SQL de la vitrine publique pas
        // encore exécuté).
        isBureau ? supabase.from("membership_requests").select("id", { count: "exact", head: true }).eq("statut", "en_attente") : Promise.resolve({ count: 0 }),
        // Configuration des rôles du bureau (suite 2026-10-07) — ajoutée en
        // dernière position pour ne pas décaler les index déjà utilisés
        // ci-dessous (results[14]..[18]). Tolérante comme les autres
        // requêtes ajoutées après coup : liste vide si la table n'existe
        // pas encore (script SQL pas encore exécuté).
        isBureau ? supabase.from("bureau_role_configs").select("*") : Promise.resolve({ data: [] }),
      ]);
      const [mem, colPres, tonPres, seancesData, depensesData, recouvrementsData, ann, log, docs, dons, lns, repays, bProfiles, delReqs] = results.slice(0, 14).map((r) => r.data || []);
      const membershipPendingCount = results[18]?.error ? 0 : (results[18]?.count || 0);
      setPendingLinkRequestsCount((results[14]?.count || 0) + membershipPendingCount);
      // Requêtes tolérantes : ne bloquent pas le chargement du reste de
      // l'application si ces tables (suites 49-50, 64) n'existent pas
      // encore (script SQL pas encore exécuté) — se contentent d'une liste
      // vide dans ce cas plutôt que de faire échouer tout loadAll().
      setInteracClaims(results[15]?.error ? [] : (results[15]?.data || []));
      setPaymentTransactions(results[16]?.error ? [] : (results[16]?.data || []));
      setAnnouncementAcks(results[17]?.error ? [] : (results[17]?.data || []));
      setRoleConfigs(results[19]?.error ? [] : (results[19]?.data || []));
      const firstError = results.slice(0, 15).find((r) => r.error)?.error;
      if (firstError) throw firstError;

      setMembers(mem);
      setCollationPres(colPres);
      setTontinePres(tonPres);
      setSeances(seancesData);
      setFuDepenses(depensesData.filter((d) => d.fonds === "urgence"));
      setFsDepenses(depensesData.filter((d) => d.fonds === "secours"));
      const depenseFondsMap = Object.fromEntries(depensesData.map((d) => [d.id, d.fonds]));
      setFuRecouvrements(recouvrementsData.filter((r) => depenseFondsMap[r.depense_id] === "urgence"));
      setFsRecouvrements(recouvrementsData.filter((r) => depenseFondsMap[r.depense_id] === "secours"));
      setAnnouncements(ann);
      setActivityLog(log);
      setDocuments(docs);
      setDonations(dons);
      setLoans(lns);
      setLoanRepayments(repays);
      setBureauProfiles(bProfiles);
      setDeletionRequests(delReqs);
    } catch (e) {
      setErrorMsg(t("load_profile_error") + " " + friendlyError(e, t));
    } finally {
      setLoading(false);
    }
  }, [isBureau]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Marque la rubrique courante comme vue dès qu'un membre l'ouvre — les
  // 2 rubriques qui ont déjà leur propre badge (demandes de suppression,
  // gestion des accès) sont volontairement exclues : pas de doublon
  // visuel dans le menu, mais elles restent comptées dans le total 🔔.
  const BADGED_SECTIONS = ["annonces", "sondages", "documents", "evenements", "gouvernance", "sanctions"];
  useEffect(() => {
    if (BADGED_SECTIONS.includes(tab)) markViewed(tab);
  }, [tab]);
  // "vieassociative" n'est PAS ajoutée à BADGED_SECTIONS ci-dessus : marquer
  // "vu" dès l'ouverture de l'onglet marquerait le fil comme lu avant même
  // que la rubrique Fil d'actualité (repliée par défaut) soit dépliée.
  // C'est VieAssociative.jsx lui-même qui appelle mark_section_viewed au
  // bon moment (dépliage du fil). Ce tableau-ci sert seulement à afficher
  // le badge du menu une fois ce compteur alimenté (voir useUnreadCounts.js).
  const MENU_BADGE_SECTIONS = [...BADGED_SECTIONS, "vieassociative"];

  const activeMembers = members.filter((m) => m.statut === "Actif");const visibleMembers = members.filter((m) => m.statut !== "Supprimé");
  const nbActifs = activeMembers.length;
  const devise = association?.devise_monetaire || "CAD";
  const moneyF = (n) => money(n, devise);
  const depenseFondsMap = Object.fromEntries([...fuDepenses, ...fsDepenses].map((d) => [d.id, d.fonds]));

  // ---------- Nouveaux adhérents et montants antérieurs (2026-10-10) ----------
  // Réglage associations.nouveaux_payent_anterieur (Configuration →
  // Adhésion & cotisations, sql/2026-10-10l) : par défaut (true) un nouvel
  // adhérent doit tout depuis le début, comme avant. À false, il part sur
  // les bases normales à sa date d'adhésion : pas de recouvrement pour une
  // dépense antérieure, pas de séance de Présence antérieure.
  const nouveauxPayentAnterieur = association?.nouveaux_payent_anterieur !== false;
  const dateDepenseMap = Object.fromEntries([...fuDepenses, ...fsDepenses].map((d) => [d.id, d.date]));
  const dateAdhesionDe = (memberId) => members.find((m) => m.id === memberId)?.date_adhesion || null;
  const adhereAvant = (memberId, dateIso) => {
    if (nouveauxPayentAnterieur) return true;
    const da = dateAdhesionDe(memberId);
    return !da || !dateIso || String(da).slice(0, 10) <= String(dateIso).slice(0, 10);
  };
  // Une quote-part déjà payée reste comptée (l'argent a été reçu).
  const fuRecouvrements = fuRecouvrementsBruts.filter((r) => r.paye || adhereAvant(r.member_id, dateDepenseMap[r.depense_id]));
  const fsRecouvrements = fsRecouvrementsBruts.filter((r) => r.paye || adhereAvant(r.member_id, dateDepenseMap[r.depense_id]));

  // ---------- Fréquence des réunions (Cotisation/Collation) ----------
  // Par défaut "mois" (12 séances/an) : comportement historique inchangé pour toute
  // association qui n'a pas explicitement choisi une autre fréquence.
  const frequenceReunions = association?.frequence_reunions || "mois";
  const nbPeriodes = PERIODES_PAR_AN[frequenceReunions] || 12;
  const SEANCES = Array.from({ length: nbPeriodes }, (_, i) => i + 1);
  // Identifiants des périodes de Collation : les noms de mois habituels si la fréquence est
  // mensuelle (comportement inchangé), sinon des libellés génériques ("Semaine 1", etc.).
  const periodKeys = frequenceReunions === "mois" ? MONTHS : Array.from({ length: nbPeriodes }, (_, i) => `${FREQ_LABEL_PREFIX[frequenceReunions]} ${i + 1}`);

  // ---------- Fiche Collation ----------
  const COLLATION_MENSUEL = Number(association?.collation_montant_mensuel || 10);
  function collationMontant(memberId, mois) { return Number(collationPres.find((r) => r.member_id === memberId && r.mois === mois)?.montant || 0); }
  function collationTotalMois(memberId) { return periodKeys.reduce((s, mo) => s + collationMontant(memberId, mo), 0); }
  function collationMoisTotal(mois) { return visibleMembers.reduce((s, m) => s + collationMontant(m.id, mois), 0); }
  // Le montant configuré est "par séance" — le dû total suit donc le nombre de séances
  // suivies (12 par défaut en mensuel, sinon selon la fréquence choisie), exactement comme
  // pour la Cotisation.
  function premierePeriodeDue(memberId) {
    if (nouveauxPayentAnterieur) return 0;
    const j = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(String(dateAdhesionDe(memberId) || ""));
    if (!j) return 0;
    const da = new Date(+j[1], +j[2] - 1, +j[3]);
    const annee = new Date().getFullYear();
    if (da.getFullYear() < annee) return 0;
    if (da.getFullYear() > annee) return periodKeys.length;
    if (frequenceReunions === "mois") return da.getMonth();
    const jour = Math.floor((da - new Date(annee, 0, 1)) / 86400000);
    return Math.min(periodKeys.length, Math.floor(jour / (365 / periodKeys.length)));
  }
  function collationDu(memberId) { return (periodKeys.length - premierePeriodeDue(memberId)) * COLLATION_MENSUEL; }
  const collationTotalDu = members.reduce((s, m) => s + collationDu(m.id), 0);
  const collationTotalPaye = members.reduce((s, m) => s + collationTotalMois(m.id), 0);

  async function saveCollationMontant(memberId, mois, montant) {
    if (!canEditRubrique("collation")) return;
    setCollationPres((prev) => {
      const exists = prev.find((r) => r.member_id === memberId && r.mois === mois);
      if (exists) return prev.map((r) => (r === exists ? { ...r, montant } : r));
      return [...prev, { member_id: memberId, mois, montant }];
    });
    setSaving(true);
    const { error } = await supabase.from("collation_presences").upsert({ member_id: memberId, mois, montant }, { onConflict: "member_id,mois" });
    setSaving(false);
    if (error) setErrorMsg(friendlyError(error, t));
  }

  // ---------- Fiche Tontine ----------
  function tontineMontant(memberId, seance) { return Number(tontinePres.find((r) => r.member_id === memberId && r.seance === seance)?.montant || 0); }
  function tontineTotal(memberId) { return SEANCES.reduce((s, se) => s + tontineMontant(memberId, se), 0); }
  function tontineSeanceTotal(seance) { return visibleMembers.reduce((s, m) => s + tontineMontant(m.id, seance), 0); }
  const tontineTotalVerse = members.reduce((s, m) => s + tontineTotal(m.id), 0);
  // Prochaine séance/période non réglée pour un membre — même logique que
  // l'Edge Function create-checkout-session (suite 48-49), réutilisée ici
  // côté client pour la confirmation des virements Interac (suite 49).
  function nextUnpaidSeance(memberId) { return SEANCES.find((s) => tontineMontant(memberId, s) <= 0) ?? null; }
  function nextUnpaidMois(memberId) { return periodKeys.slice(premierePeriodeDue(memberId)).find((mo) => collationMontant(memberId, mo) <= 0) ?? null; }
  const tontineSeances = seances.filter((s) => (s.type || "tontine") === "tontine");
  const collationSeances = seances.filter((s) => s.type === "collation");

  async function saveTontineMontant(memberId, seance, montant) {
    if (!canEditRubrique("tontine")) return;
    setTontinePres((prev) => {
      const exists = prev.find((r) => r.member_id === memberId && r.seance === seance);
      if (exists) return prev.map((r) => (r === exists ? { ...r, montant } : r));
      return [...prev, { member_id: memberId, seance, montant }];
    });
    setSaving(true);
    const { error } = await supabase.from("tontine_presences").upsert({ member_id: memberId, seance, montant }, { onConflict: "member_id,seance" });
    setSaving(false);
    if (error) setErrorMsg(friendlyError(error, t));
  }

  const [newSeance, setNewSeance] = useState({ numero: 1, date: "", beneficiaireId: "", dechargeSignee: false });
  // Ordre de passage issu du dernier tirage au sort « tontine » terminé
  // (Tirages.jsx, 2026-10-08) : le bénéficiaire du numéro de séance en
  // cours de saisie est proposé automatiquement — le bureau peut toujours
  // en choisir un autre (échange de tour convenu entre membres, etc.).
  const [ordreTontine, setOrdreTontine] = useState(null);
  useEffect(() => {
    supabase.from("tirages").select("titre, resultat").eq("association_id", profile.association_id)
      .eq("type", "tontine").eq("statut", "termine").order("termine_le", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setOrdreTontine(data || null));
  }, [profile.association_id]);
  const tirageSuggestion = ordreTontine?.resultat?.find((r) => r.position === Number(newSeance.numero)) || null;
  useEffect(() => {
    if (tirageSuggestion) setNewSeance((s) => ({ ...s, beneficiaireId: tirageSuggestion.member_id }));
  }, [newSeance.numero, tirageSuggestion?.member_id]);
  useEffect(() => {
    const maxNumero = tontineSeances.reduce((mx, s) => Math.max(mx, Number(s.numero) || 0), 0);
    setNewSeance((s) => ({ ...s, numero: maxNumero + 1 }));
  }, [tontineSeances.length]);

  async function addSeance() {
    if (!canEditRubrique("tontine")) return;
    if (tontineSeances.some((s) => Number(s.numero) === Number(newSeance.numero))) {
      setErrorMsg(t("tont_numero_taken"));
      return;
    }
    if (!window.confirm(t("tont_confirm_add_seance").replace("{numero}", String(newSeance.numero)))) return;
    const nbContrib = activeMembers.filter((m) => tontineMontant(m.id, newSeance.numero) > 0).length;
    setSaving(true);
    const { data, error } = await supabase.from("tontine_seances").insert({
      association_id: profile.association_id, type: "tontine", numero: newSeance.numero, date: newSeance.date || null, nb_contrib: nbContrib,
      beneficiaire_id: newSeance.beneficiaireId || null, decharge_signee: newSeance.dechargeSignee,
      date_decharge: newSeance.dechargeSignee ? (newSeance.date || null) : null,
    }).select().single()
    setSaving(false);
    if (error) { setErrorMsg(friendlyError(error, t)); return; }
    setSeances((prev) => [...prev, data]);
    setNewSeance({ numero: newSeance.numero + 1, date: "", beneficiaireId: "", dechargeSignee: false });
  }

  const collationMoisDisponibles = periodKeys.filter((mo) => !collationSeances.some((s) => s.mois === mo));
  const [newCollAttrib, setNewCollAttrib] = useState({ mois: periodKeys[0], date: "", beneficiaireId: "", dechargeSignee: false });
  useEffect(() => {
    if (collationMoisDisponibles.length && !collationMoisDisponibles.includes(newCollAttrib.mois)) {
      setNewCollAttrib((s) => ({ ...s, mois: collationMoisDisponibles[0] }));
    }
  }, [collationSeances.length, frequenceReunions]);

  async function addCollationAttribution() {
    if (!canEditRubrique("collation")) return;
    if (collationSeances.some((s) => s.mois === newCollAttrib.mois)) {
      setErrorMsg(t("coll_mois_taken"));
      return;
    }
    if (!window.confirm(t("coll_confirm_add_attribution").replace("{mois}", newCollAttrib.mois))) return;
    const nbContrib = activeMembers.filter((m) => collationMontant(m.id, newCollAttrib.mois) > 0).length;
    setSaving(true);
    const { data, error } = await supabase.from("tontine_seances").insert({
      association_id: profile.association_id, type: "collation", mois: newCollAttrib.mois,
      numero: 1000 + periodKeys.indexOf(newCollAttrib.mois), date: newCollAttrib.date || null, nb_contrib: nbContrib,
      beneficiaire_id: newCollAttrib.beneficiaireId || null, decharge_signee: newCollAttrib.dechargeSignee,
      date_decharge: newCollAttrib.dechargeSignee ? (newCollAttrib.date || null) : null,
    }).select().single();
    setSaving(false);
    if (error) { setErrorMsg(friendlyError(error, t)); return; }
    setSeances((prev) => [...prev, data]);
    setNewCollAttrib({ mois: periodKeys[0], date: "", beneficiaireId: "", dechargeSignee: false });
  }

  const [dechargeSeanceId, setDechargeSeanceId] = useState(null);
  async function markDechargeSigned(seanceId) {
    if (!canEditRubrique("tontine")) return;
    if (!window.confirm(t("tont_confirm_mark_signed"))) return;
    setSaving(true);
    const { error } = await supabase.from("tontine_seances").update({ decharge_signee: true, date_decharge: todayISO() }).eq("id", seanceId);
    setSaving(false);
    if (error) { setErrorMsg(friendlyError(error, t)); return; }
    setSeances((prev) => prev.map((s) => (s.id === seanceId ? { ...s, decharge_signee: true, date_decharge: todayISO() } : s)));
  }
  async function savePieceIdentite(seanceId, valeur) {
    if (!canEditRubrique("tontine")) return;
    setSaving(true);
    const { error } = await supabase.from("tontine_seances").update({ beneficiaire_piece_identite: valeur || null }).eq("id", seanceId);
    setSaving(false);
    if (error) { setErrorMsg(friendlyError(error, t)); return; }
    setSeances((prev) => prev.map((s) => (s.id === seanceId ? { ...s, beneficiaire_piece_identite: valeur || null } : s)));
  }
  async function deleteSeance(seanceId, rubrique) {
    if (!canEditRubrique(rubrique)) return;
    if (!window.confirm(t("tont_confirm_delete"))) return;
    const s = seances.find((x) => x.id === seanceId);
    const beneficiaire = members.find((m) => m.id === s?.beneficiaire_id)?.nom || "—";
    const description = t("del_desc_seance")
      .replace("{rubrique}", rubrique === "tontine" ? t("nav_tontine") : t("nav_collation"))
      .replace("{repere}", s?.mois || (s?.numero ? String(s.numero) : "—"))
      .replace("{beneficiaire}", beneficiaire);
    await requestOrDelete({ tableName: "tontine_seances", recordId: seanceId, description, contexte: { rubrique } }, () => performerSuppressionSeance(seanceId));
  }

  async function performerSuppressionSeance(seanceId) {
    setSaving(true);
    const { error } = await supabase.from("tontine_seances").delete().eq("id", seanceId);
    setSaving(false);
    if (error) { setErrorMsg(friendlyError(error, t)); return; }
    setSeances((prev) => prev.filter((s) => s.id !== seanceId));
  }

  // ---------- Versement de la cagnotte au bénéficiaire (Cotisation/Collation) ----------
  // Suite 56 (2026-09-11), à la demande de l'utilisateur : pouvoir "reverser"
  // la cagnotte au bénéficiaire par les deux méthodes déjà en place ailleurs
  // dans l'app (Stripe/Interac), en plus d'un virement/chèque/espèces
  // classique. Après recherche, aucune des deux ne permet un vrai virement
  // automatisé sans mise en place supplémentaire (Stripe Connect côté
  // bénéficiaire, service tiers pour Interac Business) — l'utilisateur a
  // choisi de construire d'abord l'enregistrement + preuve (le bureau paie
  // lui-même en dehors de l'app, puis confirme ici), avec un modèle de
  // données déjà prêt à accueillir un vrai déclenchement automatisé plus
  // tard (mêmes valeurs de méthode que payment_transactions.methode :
  // stripe / interac / manuel).
  const [versementSeanceId, setVersementSeanceId] = useState(null);
  async function saveVersement(seanceId, rubrique, patch) {
    if (!canEditRubrique(rubrique)) return;
    if (!window.confirm(t("tont_confirm_save_versement").replace("{montant}", moneyF(patch.montant || 0)))) return;
    setSaving(true);
    const { data, error } = await supabase.from("tontine_seances").update({
      versement_methode: patch.methode,
      versement_reference: patch.reference || null,
      versement_montant: patch.montant,
      versement_date: patch.date || todayISO(),
      versement_preuve_path: patch.preuvePath || null,
      versement_enregistre_par: profile.id,
    }).eq("id", seanceId).select().single();
    setSaving(false);
    if (error) { setErrorMsg(friendlyError(error, t)); return; }
    setSeances((prev) => prev.map((s) => (s.id === seanceId ? { ...s, ...data } : s)));
    setVersementSeanceId(null);
  }
  async function uploadVersementPreuve(seanceId, file) {
    const path = `${profile.association_id}/decharges/${seanceId}_${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("documents").upload(path, file);
    if (error) { setErrorMsg("Erreur de téléversement : " + friendlyError(error, t)); return null; }
    return path;
  }
  async function voirPreuveVersement(seance) {
    if (!seance.versement_preuve_path) return;
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(seance.versement_preuve_path, 60);
    if (!error && data) window.open(data.signedUrl, "_blank");
    else if (error) setErrorMsg(friendlyError(error, t));
  }

  // ---------- Demandes de suppression : approbation / rejet ----------
  // Rejoue la suppression réellement demandée, quelle que soit la table
  // d'origine — permet à l'approbateur de traiter une demande depuis un
  // seul écran central, sans dépendre du composant qui l'a initiée.
  async function performApprovedDeletion(req) {
    if (req.table_name === "fonds_depenses") {
      await supabase.from("fonds_recouvrements").delete().eq("depense_id", req.record_id);
      await supabase.from("fonds_depenses").delete().eq("id", req.record_id);
    } else if (req.table_name === "tontine_seances") {
      await supabase.from("tontine_seances").delete().eq("id", req.record_id);
    } else if (req.table_name === "donations") {
      await supabase.from("donations").delete().eq("id", req.record_id);
    } else if (req.table_name === "loans") {
      await supabase.from("loan_repayments").delete().eq("loan_id", req.record_id);
      await supabase.from("loans").delete().eq("id", req.record_id);
    }
  }
  async function approveDeletionRequest(req) {
    if (association?.approbateur_suppression_id !== profile.id) return;
    if (!window.confirm(t("del_req_confirm_approve"))) return;
    setSaving(true);
    await performApprovedDeletion(req);
    const { error } = await supabase.from("deletion_requests").update({ statut: "approuvee", reviewed_by: profile.id, reviewed_at: new Date().toISOString() }).eq("id", req.id);
    setSaving(false);
    if (error) { setErrorMsg(friendlyError(error, t)); return; }
    setDeletionRequests((prev) => prev.map((r) => (r.id === req.id ? { ...r, statut: "approuvee", reviewed_by: profile.id, reviewed_at: new Date().toISOString() } : r)));
    await loadAll();
    // 2026-10-06 — voir le commentaire sur refreshUnreadCounts plus haut :
    // sans ça, le total affiché sur la cloche 🔔 restait figé même après
    // avoir traité cette demande.
    refreshUnreadCounts();
  }
  async function rejectDeletionRequest(req) {
    if (association?.approbateur_suppression_id !== profile.id) return;
    const motif = window.prompt(t("del_req_reject_reason_prompt")) || "";
    if (!window.confirm(t("del_req_confirm_reject"))) return;
    setSaving(true);
    const { error } = await supabase.from("deletion_requests").update({ statut: "rejetee", reviewed_by: profile.id, reviewed_at: new Date().toISOString(), motif_rejet: motif || null }).eq("id", req.id);
    setSaving(false);
    if (error) { setErrorMsg(friendlyError(error, t)); return; }
    setDeletionRequests((prev) => prev.map((r) => (r.id === req.id ? { ...r, statut: "rejetee", reviewed_by: profile.id, reviewed_at: new Date().toISOString(), motif_rejet: motif || null } : r)));
    refreshUnreadCounts();
  }

  // ---------- Fiches Fonds ----------
  function fondsSolde(fondKey, depenses, recouvrements) {
    const contribPayee = members.reduce((s, m) => s + Number(m[fondKey + "_paye"] || 0), 0);
    const recouvrementPaye = recouvrements.filter((r) => r.paye).reduce((s, r) => s + Number(r.quote_part), 0);
    const totalDep = depenses.reduce((s, d) => s + Number(d.montant), 0);
    return contribPayee + recouvrementPaye - totalDep;
  }
  const fuSolde = fondsSolde("fonds_urgence", fuDepenses, fuRecouvrements);
  const fsSolde = fondsSolde("fonds_secours", fsDepenses, fsRecouvrements);

  const [fuDraft, setFuDraft] = useState({ date: "", description: "", montant: "" });
  const [fsDraft, setFsDraft] = useState({ date: "", description: "", montant: "" });
  // Fonds de secours uniquement : la quote-part se répartit sur les seuls
  // adhérents déjà éligibles au recouvrement (voir estEligibleRecouvrementSecours) —
  // le fonds d'urgence continue de se répartir sur tous les membres actifs.
  const nbEligiblesSecours = activeMembers.filter((m) => estEligibleRecouvrementSecours(m, association)).length;
  const fuQuotePart = fuDraft.montant && nbActifs > 0 ? Number(fuDraft.montant) / nbActifs : 0;
  const fsQuotePart = fsDraft.montant && nbEligiblesSecours > 0 ? Number(fsDraft.montant) / nbEligiblesSecours : 0;

  // ---------- Approbation des suppressions (transactions financières) ----------
  // Si l'association a désigné un approbateur (Configuration) et que la
  // personne qui agit n'est PAS cet approbateur, l'action ne supprime rien :
  // elle crée une demande dans `deletion_requests`, que seul l'approbateur
  // pourra ensuite valider (onglet "Demandes de suppression"). Sans
  // approbateur désigné (réglage par défaut), le comportement est inchangé :
  // suppression immédiate.
  function approverName() {
    const id = association?.approbateur_suppression_id;
    if (!id) return "";
    return bureauProfiles.find((p) => p.id === id)?.nom_complet || "";
  }
  async function requestOrDelete({ tableName, recordId, description, contexte }, performDelete) {
    const approverId = association?.approbateur_suppression_id;
    if (!approverId || approverId === profile.id) {
      await performDelete();
      return true;
    }
    setSaving(true);
    const { error } = await supabase.from("deletion_requests").insert({
      association_id: profile.association_id, table_name: tableName, record_id: recordId,
      contexte: contexte || null, description,
      requested_by: profile.id, requested_by_nom: profile.nom_complet,
    }).select().single();
    setSaving(false);
    if (error) { setErrorMsg(friendlyError(error, t)); return false; }
    setDeletionRequests((prev) => [{ ...contexte, table_name: tableName, record_id: recordId, description, requested_by: profile.id, requested_by_nom: profile.nom_complet, statut: "en_attente", created_at: new Date().toISOString(), contexte: contexte || null }, ...prev]);
    alert(t("del_req_sent_alert").replace("{name}", approverName() || t("del_req_sent_alert_fallback")));
    return false;
  }

  async function enregistrerDepense(fonds) {
    const rubriqueKey = fonds === "urgence" ? "fonds_urgence" : "fonds_secours";
    if (!canEditRubrique(rubriqueKey)) return;
    const draft = fonds === "urgence" ? fuDraft : fsDraft;
    if (!draft.date || !draft.montant) { setErrorMsg(t("fonds_champs_requis")); return; }
    // Pour le fonds de secours uniquement : seuls les adhérents ayant terminé
    // leur période de probation (comptée depuis leur date de PAIEMENT du
    // fonds de secours, voir estEligibleRecouvrementSecours) ET déjà
    // acquitté leur fonds de secours sont soumis au recouvrement. Sans
    // période de probation renseignée pour l'association, le recouvrement
    // s'applique dès que le fonds de secours est payé (comportement par
    // défaut). Le fonds d'urgence n'est pas concerné par cette règle.
    const beneficiaires = (fonds === "secours" ? activeMembers.filter((m) => estEligibleRecouvrementSecours(m, association)) : activeMembers)
      .filter((m) => adhereAvant(m.id, draft.date));
    const montant = Number(draft.montant);
    const quotePart = beneficiaires.length > 0 ? montant / beneficiaires.length : 0;
    if (!window.confirm(t("fonds_confirm_register").replace("{montant}", moneyF(montant)).replace("{n}", String(beneficiaires.length)))) return;
    setSaving(true);
    const { data: depense, error: e1 } = await supabase.from("fonds_depenses").insert({
      association_id: profile.association_id, fonds, date: draft.date, description: draft.description,
      montant, nb_actifs_snapshot: beneficiaires.length,
    }).select().single();
    if (e1) { setSaving(false); setErrorMsg(friendlyError(e1, t)); return; }
    const rows = beneficiaires.map((m) => ({
      association_id: profile.association_id, depense_id: depense.id, member_id: m.id,
      quote_part: Math.round(quotePart * 100) / 100, paye: false,
    }));
    const { data: recs, error: e2 } = rows.length > 0
      ? await supabase.from("fonds_recouvrements").insert(rows).select()
      : { data: [], error: null };
    setSaving(false);
    if (e2) { setErrorMsg(friendlyError(e2, t)); return; }
    if (fonds === "urgence") { setFuDepenses((p) => [...p, depense]); setFuRecouvrements((p) => [...p, ...recs]); setFuDraft({ date: "", description: "", montant: "" }); }
    else { setFsDepenses((p) => [...p, depense]); setFsRecouvrements((p) => [...p, ...recs]); setFsDraft({ date: "", description: "", montant: "" }); }
  }

  // Modifie une dépense déjà enregistrée (date/description/montant) ET, à
  // chaque enregistrement, resynchronise sa répartition sur la liste
  // ACTUELLE d'adhérents éligibles — suite 51 (2026-09-11). Remplace
  // l'ancien bouton séparé "Recalculer" : la répartition étant figée au
  // moment de la création (snapshot), un adhérent qui devient éligible
  // APRÈS coup n'était jamais ajouté automatiquement à une dépense déjà
  // créée — modifier la dépense est maintenant l'occasion naturelle de la
  // remettre à jour, plutôt que d'avoir un geste distinct à comprendre.
  // Cette resynchronisation :
  //   - ajoute une ligne de recouvrement (non payée) pour tout adhérent
  //     désormais éligible qui n'en avait pas encore ;
  //   - recalcule la quote-part de TOUS les éligibles actuels (y compris
  //     ceux déjà présents) sur la base du montant (éventuellement modifié)
  //     de la dépense — un adhérent ayant déjà réglé l'ancienne quote-part
  //     se retrouve simplement en avance si la nouvelle est plus basse
  //     (déjà géré par l'affichage existant du solde) ;
  //   - ne touche jamais aux lignes des adhérents qui ne sont plus
  //     éligibles (pour ne jamais faire disparaître un paiement déjà
  //     enregistré) ;
  //   - NE RECALCULE JAMAIS la quote-part d'un adhérent qui a DÉJÀ RÉGLÉ
  //     la sienne (r.paye === true) — corrigé en suite 61 (2026-09-12),
  //     suite au signalement de l'utilisateur : modifier une dépense après
  //     qu'un adhérent a payé écrasait silencieusement sa quote-part déjà
  //     réglée par la nouvelle valeur (le montant "payé" affiché changeait
  //     rétroactivement avec elle, donnant l'impression que "rien n'avait
  //     changé" alors que les comptes de cet adhérent étaient faussés).
  //     Une fois qu'un reçu a été émis (quote-part marquée payée), son
  //     montant est désormais figé pour toujours — seules les quotes-parts
  //     encore impayées sont recalculées sur la base du nouveau montant.
  async function modifierDepense(fonds, depenseId, patch) {
    const rubriqueKey = fonds === "urgence" ? "fonds_urgence" : "fonds_secours";
    if (!canEditRubrique(rubriqueKey)) return;
    const depenses = fonds === "urgence" ? fuDepenses : fsDepenses;
    const recouvrements = fonds === "urgence" ? fuRecouvrements : fsRecouvrements;
    const dep = depenses.find((d) => d.id === depenseId);
    if (!dep) return;
    const montant = patch.montant != null ? Number(patch.montant) : Number(dep.montant);
    const beneficiaires = (fonds === "secours" ? activeMembers.filter((m) => estEligibleRecouvrementSecours(m, association)) : activeMembers)
      .filter((m) => adhereAvant(m.id, patch.date || dep.date));
    const quotePart = beneficiaires.length > 0 ? Math.round((montant / beneficiaires.length) * 100) / 100 : 0;
    const existantParMembre = {};
    recouvrements.filter((r) => r.depense_id === depenseId).forEach((r) => { existantParMembre[r.member_id] = r; });
    const aInserer = beneficiaires.filter((m) => !existantParMembre[m.id]).map((m) => ({
      association_id: profile.association_id, depense_id: depenseId, member_id: m.id, quote_part: quotePart, paye: false,
    }));
    const aMettreAJour = beneficiaires.filter((m) => existantParMembre[m.id] && !existantParMembre[m.id].paye && Number(existantParMembre[m.id].quote_part) !== quotePart);
    if (!window.confirm(t("fonds_confirm_edit_expense").replace("{montant}", moneyF(montant)))) return;
    setSaving(true); setErrorMsg("");
    try {
      const { error: eDep } = await supabase.from("fonds_depenses").update({ ...patch, montant, nb_actifs_snapshot: beneficiaires.length }).eq("id", depenseId);
      if (eDep) throw eDep;
      for (const m of aMettreAJour) {
        const { error } = await supabase.from("fonds_recouvrements").update({ quote_part: quotePart }).eq("id", existantParMembre[m.id].id);
        if (error) throw error;
      }
      let inserted = [];
      if (aInserer.length > 0) {
        const { data, error } = await supabase.from("fonds_recouvrements").insert(aInserer).select();
        if (error) throw error;
        inserted = data || [];
      }
      const setDepFn = fonds === "urgence" ? setFuDepenses : setFsDepenses;
      const setRecFn = fonds === "urgence" ? setFuRecouvrements : setFsRecouvrements;
      setDepFn((prev) => prev.map((d) => (d.id === depenseId ? { ...d, ...patch, montant, nb_actifs_snapshot: beneficiaires.length } : d)));
      setRecFn((prev) => [
        ...prev.map((r) => (r.depense_id === depenseId && aMettreAJour.some((m) => existantParMembre[m.id]?.id === r.id) ? { ...r, quote_part: quotePart } : r)),
        ...inserted,
      ]);
    } catch (e) {
      setErrorMsg(t("fonds_recalc_error") + " " + friendlyError(e, t));
    } finally {
      setSaving(false);
    }
  }

  async function marquerRecouvrementPaye(fonds, id) {
    const rubriqueKey = fonds === "urgence" ? "fonds_urgence" : "fonds_secours";
    if (!canEditRubrique(rubriqueKey)) return;
    const rec = (fonds === "urgence" ? fuRecouvrements : fsRecouvrements).find((r) => r.id === id);
    const nomMembre = members.find((m) => m.id === rec?.member_id)?.nom || "—";
    if (!window.confirm(t("fonds_confirm_mark_paid").replace("{nom}", nomMembre).replace("{montant}", moneyF(rec?.quote_part || 0)))) return;
    const setFn = fonds === "urgence" ? setFuRecouvrements : setFsRecouvrements;
    setFn((prev) => prev.map((r) => (r.id === id ? { ...r, paye: true } : r)));
    setSaving(true);
    const { error } = await supabase.from("fonds_recouvrements").update({ paye: true, date_paiement: todayISO() }).eq("id", id);
    setSaving(false);
    if (error) setErrorMsg(friendlyError(error, t));
  }

  async function supprimerDepense(fonds, depenseId) {
    const rubriqueKey = fonds === "urgence" ? "fonds_urgence" : "fonds_secours";
    if (!canEditRubrique(rubriqueKey)) return;
    if (!window.confirm(t("fonds_confirm_delete"))) return;
    const dep = (fonds === "urgence" ? fuDepenses : fsDepenses).find((d) => d.id === depenseId);
    const description = t("del_desc_fonds_depense")
      .replace("{fonds}", fonds === "urgence" ? t("nav_urgence") : t("nav_secours"))
      .replace("{date}", dep?.date || "").replace("{amount}", moneyF(dep?.montant || 0));
    await requestOrDelete({ tableName: "fonds_depenses", recordId: depenseId, description, contexte: { fonds } }, () => performerSuppressionDepense(fonds, depenseId));
  }

  async function performerSuppressionDepense(fonds, depenseId) {
    setSaving(true);
    const { error: eRec } = await supabase.from("fonds_recouvrements").delete().eq("depense_id", depenseId);
    if (eRec) { setSaving(false); setErrorMsg(friendlyError(eRec, t)); return; }
    const { error: eDep } = await supabase.from("fonds_depenses").delete().eq("id", depenseId);
    setSaving(false);
    if (eDep) { setErrorMsg(friendlyError(eDep, t)); return; }
    if (fonds === "urgence") {
      setFuDepenses((prev) => prev.filter((d) => d.id !== depenseId));
      setFuRecouvrements((prev) => prev.filter((r) => r.depense_id !== depenseId));
    } else {
      setFsDepenses((prev) => prev.filter((d) => d.id !== depenseId));
      setFsRecouvrements((prev) => prev.filter((r) => r.depense_id !== depenseId));
    }
  }

  async function patchMember(id, patch) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    setSaving(true);
    const { error } = await supabase.from("members").update(patch).eq("id", id);
    setSaving(false);
    if (error) setErrorMsg("Erreur d'enregistrement : " + friendlyError(error, t));
  }

  const [newMemberForm, setNewMemberForm] = useState({ nom: "", email: "", telephone: "", sexe: "", dateAdhesion: "", statut: "Actif", dateNaissance: "", quartier: "", competences: "", disponibleBenevolat: false });
  const [deleteMotifs, setDeleteMotifs] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const [editMemberId, setEditMemberId] = useState(null);
  const [historyMemberId, setHistoryMemberId] = useState(null);
  const [historyFundFilter, setHistoryFundFilter] = useState(null);
  const [fullProfileMemberId, setFullProfileMemberId] = useState(null);
  const [showMyCard, setShowMyCard] = useState(false);

  // Recherche globale (Phase 6, feuille de route, 2026-09-29) — un membre,
  // un document, une transaction, un événement, un projet ou une annonce,
  // peu importe l'onglet actif. Portée complète + placement en en-tête,
  // toujours visible, choisis par l'utilisateur. `events`/`projects` ne
  // sont pas dans l'état global de App.jsx (contrairement aux 4 autres
  // catégories, déjà chargées par loadAll()) : on les charge une seule
  // fois, à la demande (premier caractère tapé), et on les garde en cache
  // pour le reste de la session plutôt que de refaire une requête à
  // chaque frappe — même logique que loadAll() ("charger une fois, filtrer
  // côté client").
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchExtra, setSearchExtra] = useState({ events: null, projects: null, loading: false });
  const searchBoxRef = useRef(null);

  // Chargement paresseux (une seule fois, mis en cache pour le reste de la
  // session) des deux catégories absentes de l'état global de App.jsx.
  // Tolérant aux erreurs (ex. tables events/projects pas encore créées
  // pour une association) : se contente d'une liste vide dans ce cas,
  // sans bloquer les 4 autres catégories ni afficher de bannière d'erreur
  // pour ce qui reste une fonctionnalité secondaire.
  const ensureSearchExtraLoaded = useCallback(async () => {
    if (searchExtra.events !== null || searchExtra.loading) return;
    setSearchExtra((s) => ({ ...s, loading: true }));
    try {
      const [ev, pr] = await Promise.all([
        supabase.from("events").select("id,titre,description,lieu,date_debut").eq("association_id", profile.association_id).order("date_debut", { ascending: false }),
        isBureau ? supabase.from("projects").select("id,nom,categorie").eq("association_id", profile.association_id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
      ]);
      setSearchExtra({ events: ev.data || [], projects: pr.data || [], loading: false });
    } catch {
      setSearchExtra({ events: [], projects: [], loading: false });
    }
  }, [searchExtra.events, searchExtra.loading, profile.association_id, isBureau]);

  // Ferme le panneau de résultats au clic en dehors de la barre de
  // recherche (même principe que les menus ⋮ ailleurs dans ce fichier,
  // mais avec un vrai écouteur global puisque le panneau doit rester
  // ouvert tant qu'on interagit avec la barre elle-même).
  useEffect(() => {
    if (!searchOpen) return;
    function onDocClick(e) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [searchOpen]);

  // Même principe pour le sélecteur d'association de la sidebar (suite
  // 2026-10-06) — ferme le menu déroulant au clic en dehors.
  useEffect(() => {
    if (!orgSwitcherOpen) return;
    function onDocClick(e) {
      if (orgSwitcherRef.current && !orgSwitcherRef.current.contains(e.target)) setOrgSwitcherOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [orgSwitcherOpen]);

  function memberNomFor(id) { return members.find((m) => m.id === id)?.nom || ""; }

  const foldedQuery = foldText(searchQuery);
  // Recherche globale, portée complète (suite au choix de l'utilisateur) :
  // membres + documents + transactions + événements + projets + annonces,
  // filtrés côté client à partir de ce qui est déjà chargé (comme le reste
  // de l'application). Chaque catégorie est en plus limitée à ce que le
  // rôle courant peut normalement consulter (ex. seul le bureau voit les
  // adhérents et les transactions), pour ne jamais faire apparaître dans
  // les résultats un onglet que l'utilisateur n'a pas le droit d'ouvrir.
  const searchResults = useMemo(() => {
    if (foldedQuery.length < 2) return null;
    const has = (...vals) => vals.some((v) => v != null && foldText(v).includes(foldedQuery));
    const out = {
      // Rubriques du menu (suite 2026-10-06) — voir PAGE_SEARCH_ITEMS plus
      // haut. Volontairement en premier : taper le nom d'une section
      // ("finances", "vie associative") doit prioriser "aller à cette
      // page" plutôt que de la noyer sous des résultats de données.
      pages: pageSearchIndex.filter((p) => has(p.label, ...p.keywords)).slice(0, 8),
      members: isBureau ? members.filter((m) => has(m.nom, m.email, m.telephone)).slice(0, 8) : [],
      documents: (isBureau || isResponsable) ? documents.filter((d) => has(d.nom, d.rubrique)).slice(0, 8) : [],
      transactions: isBureau ? paymentTransactions.filter((tx) => has(tx.type, tx.periode, tx.methode, tx.reference, memberNomFor(tx.member_id), tx.numero_recu != null ? String(tx.numero_recu) : null)).slice(0, 8) : [],
      events: (isBureau || isResponsable || isAdherent) ? (searchExtra.events || []).filter((e) => has(e.titre, e.description, e.lieu)).slice(0, 8) : [],
      projects: isBureau ? (searchExtra.projects || []).filter((p) => has(p.nom, p.categorie)).slice(0, 8) : [],
      announcements: announcements.filter((a) => has(a.titre, a.message)).slice(0, 8),
    };
    const total = Object.values(out).reduce((n, arr) => n + arr.length, 0);
    return { ...out, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldedQuery, isBureau, isResponsable, isAdherent, members, documents, announcements, paymentTransactions, searchExtra.events, searchExtra.projects, pageSearchIndex]);

  function goToMember(memberId) {
    setSearchOpen(false); setSearchQuery("");
    setTab("membres"); setFullProfileMemberId(memberId);
  }
  function goToSearchTab(tabId) {
    setSearchOpen(false); setSearchQuery("");
    setTab(tabId);
  }

  const [recouvHistoryMemberId, setRecouvHistoryMemberId] = useState(null);
  const [recouvHistoryFund, setRecouvHistoryFund] = useState(null);
  // Correction directe d'un montant/date déjà enregistré pour Fonds
  // d'urgence/secours — { fonds, memberId } | null. Distinct du mécanisme
  // "Ajouter un versement" (qui additionne) : ceci ouvre une petite fenêtre
  // pour REVOIR et RÉÉCRIRE la valeur exacte, utile pour corriger une
  // erreur de saisie (ex. montant supérieur à ce qui était dû) sans devoir
  // annuler puis rejouer des versements un par un (suite 51, 2026-09-11).
  const [editFondsPaiement, setEditFondsPaiement] = useState(null);
  // Modification complète d'une dépense de Fonds urgence/secours déjà
  // enregistrée (date, description, montant) — { fonds, depenseId } | null.
  // Enregistrer applique toujours modifierDepense, qui resynchronise aussi
  // la répartition sur les adhérents actuellement éligibles (suite 51,
  // 2026-09-11 — remplace l'ancien bouton "Recalculer" séparé).
  const [editDepense, setEditDepense] = useState(null);
  async function annulerVersementFonds(fonds, memberId, delta) {
    const memberKey = fonds === "urgence" ? "fonds_urgence" : "fonds_secours";
    if (!canEditRubrique(memberKey)) return false;
    if (!window.confirm(t("fonds_confirm_delete_versement"))) return false;
    const m = members.find((x) => x.id === memberId);
    const nouveauTotal = Math.max(0, Number(m?.[memberKey + "_paye"] || 0) - delta);
    await patchMember(memberId, { [memberKey + "_paye"]: nouveauTotal, [memberKey + "_date_paiement"]: todayISO() });
    return true;
  }
 async function handleAddMember() {
    if (!newMemberForm.nom.trim() || !isBureau) return;
    if (!window.confirm(t("mem_confirm_add").replace("{nom}", newMemberForm.nom.trim()))) return;
    setSaving(true);
    const { data, error } = await supabase.from("members").insert({
  association_id: profile.association_id,
  nom: newMemberForm.nom, email: newMemberForm.email, telephone: newMemberForm.telephone || null,
  sexe: newMemberForm.sexe || null,
  date_adhesion: newMemberForm.dateAdhesion || null, statut: newMemberForm.statut,
  date_naissance: newMemberForm.dateNaissance || null, quartier: newMemberForm.quartier || null,
  competences: newMemberForm.competences || null, disponible_benevolat: newMemberForm.disponibleBenevolat,
}).select().single();
    setSaving(false);
    if (error) { setErrorMsg("Erreur d'ajout : " + friendlyError(error, t)); return; }
    setMembers((prev) => [...prev, data]);
    setNewMemberForm({ nom: "", email: "", telephone: "", sexe: "", dateAdhesion: "", statut: "Actif", dateNaissance: "", quartier: "", competences: "", disponibleBenevolat: false });
  }

  async function handleDeleteMember(id, motif) {
    if (!isBureau) return;
    if (!motif) { setErrorMsg(t("mem_motif_required")); return; }
    setSaving(true);
    const { error } = await supabase.from("members").update({
      statut: "Supprimé",
      motif_desactivation: motif,
      date_desactivation: new Date().toISOString().slice(0, 10),
    }).eq("id", id);
    setSaving(false);
    if (error) setErrorMsg(friendlyError(error, t));
    else setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, statut: "Supprimé", motif_desactivation: motif } : m)));
  }
  async function reactivateMember(id) {
    if (!isBureau) return;
    setSaving(true);
    const { error } = await supabase.from("members").update({
      statut: "Actif",
      motif_desactivation: null,
      date_desactivation: null,
    }).eq("id", id);
    setSaving(false);
    if (error) setErrorMsg(friendlyError(error, t));
    else setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, statut: "Actif", motif_desactivation: null } : m)));
  }
  async function permanentlyDeleteMember(id) {
    if (!isBureau) return;
    setSaving(true);
    const { error } = await supabase.from("members").delete().eq("id", id);
    setSaving(false);
    if (error) { setErrorMsg(friendlyError(error, t)); return; }
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }

  // ---------- Annonces ----------
  const [newAnn, setNewAnn] = useState({ titre: "", message: "", urgent: false, image_url: "", accuse_reception_requis: false });
  const [uploadingAnnImage, setUploadingAnnImage] = useState(false);
  const annImageInputRef = useRef(null);
  async function uploadAnnouncementImage(file) {
    if (!file) return null;
    setUploadingAnnImage(true);
    const path = `announcements/${profile.association_id}/${Date.now()}_${file.name}`;
    const { error: uploadErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    setUploadingAnnImage(false);
    if (uploadErr) { setErrorMsg("Erreur de téléversement : " + friendlyError(uploadErr, t)); return null; }
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    return urlData.publicUrl;
  }
  async function publishAnnouncement() {
    if (!isBureau) return;
    if (!newAnn.titre.trim()) { setErrorMsg(t("ann_error_title_required")); return; }
    if (!window.confirm(t("ann_confirm_publish").replace("{titre}", newAnn.titre.trim()))) return;
    setSaving(true);
    const { data, error } = await supabase.from("announcements").insert({
      association_id: profile.association_id, titre: newAnn.titre, message: newAnn.message,
      urgent: newAnn.urgent, image_url: newAnn.image_url || null, created_by: profile.id,
      accuse_reception_requis: newAnn.accuse_reception_requis,
    }).select().single();
    setSaving(false);
    if (error) { setErrorMsg(t("ann_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
    setErrorMsg("");
    setAnnouncements((p) => [data, ...p]); setNewAnn({ titre: "", message: "", urgent: false, image_url: "", accuse_reception_requis: false });
  }
  const [editingAnnId, setEditingAnnId] = useState(null);
  async function updateAnnouncement(id, patch) {
    const { error } = await supabase.from("announcements").update(patch).eq("id", id);
    if (error) { setErrorMsg(t("ann_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
    setErrorMsg("");
    setAnnouncements((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }
  async function deleteAnnouncement(id) {
    if (!window.confirm(t("ann_confirm_delete"))) return;
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) { setErrorMsg(t("ann_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
    setErrorMsg("");
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
  }
  // Accusé de réception d'un avis officiel (suite 64, 2026-09-12) — un
  // seul par adhérent et par avis (contrainte unique côté base), jamais
  // modifiable ni supprimable une fois donné : c'est la preuve elle-même.
  function myAnnouncementAck(announcementId) {
    return announcementAcks.find((a) => a.announcement_id === announcementId && a.member_profile_id === profile.id);
  }
  async function ackAnnouncement(announcementId) {
    if (myAnnouncementAck(announcementId)) return;
    if (!window.confirm(t("ann_confirm_ack"))) return;
    const { data, error } = await supabase.from("announcement_acks").insert({
      announcement_id: announcementId, association_id: profile.association_id,
      member_profile_id: profile.id, member_nom: profile.nom_complet,
    }).select().single();
    if (error) { alert(t("ann_ack_error") + " " + friendlyError(error, t)); console.error(error); return; }
    setAnnouncementAcks((prev) => [...prev, data]);
  }

  // ---------- Journal d'activité ----------
  const [jrnSearch, setJrnSearch] = useState("");
  const [jrnTableFilter, setJrnTableFilter] = useState("all");
  const [jrnActionFilter, setJrnActionFilter] = useState("all");
  const [jrnPurgeDays, setJrnPurgeDays] = useState(90);
  async function deleteActivityLogEntry(id) {
    if (!window.confirm(t("jrn_confirm_delete"))) return;
    await supabase.from("activity_log").delete().eq("id", id);
    setActivityLog((prev) => prev.filter((l) => l.id !== id));
  }
  async function purgeActivityLog() {
    const cutoff = new Date(Date.now() - jrnPurgeDays * 24 * 60 * 60 * 1000).toISOString();
    const toDelete = activityLog.filter((l) => l.created_at < cutoff);
    if (toDelete.length === 0) { alert(t("jrn_purge_none")); return; }
    if (!window.confirm(t("jrn_purge_confirm").replace("{count}", toDelete.length).replace("{days}", jrnPurgeDays))) return;
    await supabase.from("activity_log").delete().lt("created_at", cutoff);
    setActivityLog((prev) => prev.filter((l) => l.created_at >= cutoff));
  }

  // ---------- Documents ----------
  const [uploadRubrique, setUploadRubrique] = useState("general");
  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!window.confirm(t("doc_confirm_upload").replace("{nom}", file.name))) { e.target.value = ""; return; }
    setSaving(true);
    const path = `${profile.association_id}/${Date.now()}_${file.name}`;
    const { error: uploadErr } = await supabase.storage.from("documents").upload(path, file);
    if (uploadErr) { setSaving(false); setErrorMsg("Erreur de téléversement : " + friendlyError(uploadErr, t)); return; }
    const { data, error } = await supabase.from("documents").insert({
      association_id: profile.association_id, nom: file.name, storage_path: path,
      rubrique: uploadRubrique, uploaded_by: profile.id,
    }).select().single();
    setSaving(false);
    // Correctif (suite 68, 2026-09-18) : le fichier était bien envoyé dans le
    // stockage (documents/) mais, si l'enregistrement de la ligne dans la
    // table `documents` échouait ensuite (ex. contrainte, RLS), l'erreur était
    // silencieusement ignorée — le document restait alors invisible dans la
    // liste, sans aucun message pour expliquer pourquoi. Signalé par
    // l'utilisateur : « je ne le vois pas par la suite ».
    if (error) { setErrorMsg("Erreur d'enregistrement du document : " + friendlyError(error, t)); return; }
    setDocuments((p) => [data, ...p]);
  }
  async function downloadDocument(doc) {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60);
    if (!error && data) window.open(data.signedUrl, "_blank");
  }
  async function deleteDocument(doc) {
    if (!window.confirm(t("doc_confirm_delete"))) return;
    await supabase.storage.from("documents").remove([doc.storage_path]);
    await supabase.from("documents").delete().eq("id", doc.id);
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
  }
  async function updateDocumentCategory(docId, rubrique) {
    await supabase.from("documents").update({ rubrique }).eq("id", docId);
    setDocuments((prev) => prev.map((d) => (d.id === docId ? { ...d, rubrique } : d)));
  }
  const [docSearch, setDocSearch] = useState("");
  const [docCategoryFilter, setDocCategoryFilter] = useState("all");
  // 2026-10-06 (demandé par l'utilisateur) — catégorie active dans l'onglet
  // Configuration, voir CONFIG_SECTIONS plus haut.
  const [configSection, setConfigSection] = useState("general");
  function docFileExt(name) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(name || "");
    return m ? m[1].toUpperCase() : "—";
  }

  // ---------- Agrégats financiers ----------
  const inscriptionMontant = association?.inscription_montant || 25;

  // Phase 3 : paiement en ligne (Stripe Checkout) — inscription, fonds
  // d'urgence/secours, cotisation, collation (suites 48-49). Le montant
  // n'est jamais calculé ni envoyé depuis ce composant — la Edge
  // Function le recalcule elle-même côté serveur à partir de la fiche
  // du membre authentifié, pour qu'il ne soit jamais possible de le
  // falsifier depuis le navigateur. `type` correspond aux types gérés
  // par create-checkout-session : "inscription", "fonds_urgence",
  // "fonds_secours", "cotisation", "collation".
  async function payerEnLigne(type, extraBody) {
    setPayingType(type);
    setErrorMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", { body: { type, ...(extraBody || {}) } });
      if (error) throw error;
      if (data?.error) { setErrorMsg(data.error); return; }
      if (data?.url) { window.location.href = data.url; return; }
      setErrorMsg(t("ms_pay_online_error"));
    } catch (e) {
      setErrorMsg(t("ms_pay_online_error") + " " + friendlyError(e, t));
    } finally {
      setPayingType(null);
    }
  }
  const fondsUrgenceMontant = association?.fonds_urgence_montant || 25;
  const fondsSecoursMontant = association?.fonds_secours_montant || 200;
  const tontineMontantSeance = association?.tontine_montant_seance || 100;

  // ---------- Virement Interac (suite 49) ----------
  // Alternative "manuelle" au paiement par carte : aucune API Interac
  // automatisée n'est accessible à une petite association sans partenariat
  // commercial séparé (Moneris/Bambora...). Le membre téléverse une preuve
  // (reçu/capture d'écran de son virement) dans le stockage privé
  // "interac-proofs" ; le bureau vérifie visuellement puis confirme depuis
  // l'onglet "Paiements Interac" — la confirmation applique alors
  // exactement la même écriture en base que le webhook Stripe (montant
  // plein sur members.*_paye, ou upsert tontine_presences/
  // collation_presences), ce qui déclenche au passage les mêmes courriels
  // de confirmation déjà construits en Phase 2.
  const [interacFile, setInteracFile] = useState(null);
  const [interacUploading, setInteracUploading] = useState(false);
  const [interacSubmitMsg, setInteracSubmitMsg] = useState("");
  // Bouton stylé + input caché (comme pour le logo ci-dessus) plutôt que
  // le bouton natif du navigateur : celui-ci affiche "Choose file"/
  // "No file chosen" dans la langue du système/navigateur, pas dans celle
  // choisie dans l'app — d'où la confusion sur une interface par ailleurs
  // en français.
  const interacFileInputRef = useRef(null);
  async function submitInteracProof(type, montant, loanId, recouvrementId) {
    if (!interacFile || !me) return;
    if (!(Number(montant) > 0)) { setErrorMsg(t("interac_claims_amount_invalid")); return; }
    if (!window.confirm(t("interac_confirm_submit_proof").replace("{montant}", moneyF(montant)))) return;
    setInteracUploading(true); setErrorMsg(""); setInteracSubmitMsg("");
    try {
      const path = `${profile.association_id}/${me.id}/${Date.now()}_${interacFile.name}`;
      const { error: uploadErr } = await supabase.storage.from("interac-proofs").upload(path, interacFile);
      if (uploadErr) throw uploadErr;
      const { data, error } = await supabase.from("interac_payment_claims").insert({
        association_id: profile.association_id, member_id: me.id, type, montant,
        fichier_path: path, fichier_nom: interacFile.name, loan_id: loanId || null,
        recouvrement_id: recouvrementId || null,
      }).select().single();
      if (error) throw error;
      setInteracClaims((prev) => [data, ...prev]);
      setInteracSubmitMsg(t("ms_interac_submit_success"));
      setInteracFile(null);
      setManualAmount("");
    } catch (e) {
      setErrorMsg(t("ms_interac_submit_error") + " " + friendlyError(e, t));
    } finally {
      setInteracUploading(false);
    }
  }
  // Prêt(s) et dons — remboursement d'un prêt actif ou don libre par un
  // membre, avec le même mécanisme de preuve + confirmation (suite 49).
  // Réutilise la même logique que FinancesElargies.jsx (solde restant =
  // capital + intérêts simples moins la somme des remboursements déjà
  // enregistrés) plutôt que de la dupliquer sous une forme différente.
  function loanRepaidFor(loanId) { return loanRepayments.filter((r) => r.loan_id === loanId).reduce((s, r) => s + Number(r.montant), 0); }
  function loanInterestFor(l) { return Number(l.montant_pret) * (Number(l.taux_interet) || 0) / 100; }
  function loanTotalDueFor(l) { return Number(l.montant_pret) + loanInterestFor(l); }
  const [manualAmount, setManualAmount] = useState("");
  // recouvrementId n'est utilisé (et requis pour distinguer deux lignes
  // de recouvrement du même membre) que lorsque type === "recouvrement" —
  // ignoré pour tous les autres types, donc rétrocompatible avec les
  // appels existants qui ne le passent pas.
  function pendingInteracClaim(type, recouvrementId) {
    return interacClaims.find((c) => c.member_id === me?.id && c.type === type && c.statut === "en_attente" && (type !== "recouvrement" || c.recouvrement_id === recouvrementId));
  }
  // Toutes les demandes du membre pour cette rubrique, la plus récente
  // d'abord — utilisé par le menu déroulant (revoir la preuve envoyée,
  // même si la demande a déjà été confirmée ou rejetée).
  function memberInteracClaims(type, recouvrementId) {
    return interacClaims.filter((c) => c.member_id === me?.id && c.type === type && (type !== "recouvrement" || c.recouvrement_id === recouvrementId)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  async function interacProofUrl(claim) {
    const { data, error } = await supabase.storage.from("interac-proofs").createSignedUrl(claim.fichier_path, 60);
    if (!error && data) window.open(data.signedUrl, "_blank");
  }
  // Annulation d'une demande en attente par le membre lui-même (suite 49) :
  // on ne supprime jamais la ligne (trace d'audit), on la fait juste
  // passer au statut "annule" — le bureau ne la voit plus comme active,
  // mais elle reste visible dans l'historique du membre.
  async function cancelInteracClaim(claim) {
    if (!claim || !window.confirm(t("ms_cancel_confirm"))) return;
    setSaving(true); setErrorMsg("");
    try {
      const { data, error } = await supabase.from("interac_payment_claims").update({ statut: "annule" }).eq("id", claim.id).select().single();
      if (error) throw error;
      setInteracClaims((prev) => prev.map((c) => (c.id === claim.id ? data : c)));
    } catch (e) {
      setErrorMsg(t("ms_cancel_error") + " " + friendlyError(e, t));
    } finally {
      setSaving(false);
    }
  }
  // Libellé de rubrique et de période pour une ligne payment_transactions,
  // factorisés ici (suite 52, 2026-09-11) pour être utilisés à la fois par
  // le panneau de paiement (détail d'UNE rubrique) et par le nouveau
  // journal chronologique combiné (toutes rubriques). Reprend exactement
  // la logique déjà en place dans le panneau, jusqu'ici dupliquée en ligne.
  function txTypeLabel(tx) {
    return {
      inscription: t("ms_inscription"), fonds_urgence: t("ms_fonds_urgence"), fonds_secours: t("ms_fonds_secours"),
      cotisation: t("ms_label_cotisation"), collation: t("ms_collation"), don: t("ms_label_don"), pret: t("ms_label_pret"),
      recouvrement: t("ms_label_recouvrement"),
    }[tx.type] || tx.type;
  }
  function txPeriodeLabel(tx) {
    if (!tx.periode) return null;
    if (tx.type === "cotisation") return `${t("tont_col_seance")} ${tx.periode}`;
    if (tx.type === "collation") {
      const idx = MONTHS.indexOf(tx.periode);
      return frequenceReunions === "mois" && idx >= 0 ? t(MONTH_KEYS[idx]) : tx.periode;
    }
    if (tx.type === "pret" && tx.periode === "octroi") return t("ms_tx_pret_octroi");
    if (tx.type === "recouvrement") return tx.periode === "urgence" ? t("ms_urgence") : tx.periode === "secours" ? t("ms_secours") : tx.periode;
    return tx.periode;
  }
  // Construit les options du menu déroulant (coin supérieur droit de
  // chaque carte de "Mon espace") pour une rubrique donnée — regroupe
  // toutes les actions possibles au même endroit plutôt que de rendre la
  // carte entière cliquable (suite 50, 2026-09-10).
  function buildMenuItems(type, due) {
    const items = [
      { key: "detail", label: t("ms_menu_view_detail"), icon: History, onClick: () => { openPayPanel(type); setShowTxDetail(true); } },
    ];
    if (due) items.push({ key: "pay", label: t("ms_menu_pay_online"), icon: CreditCard, onClick: () => openPayPanel(type) });
    const claims = memberInteracClaims(type);
    if (claims.length > 0) items.push({ key: "proof", label: t("ms_menu_view_proof"), icon: Eye, onClick: () => interacProofUrl(claims[0]) });
    const pending = pendingInteracClaim(type);
    if (pending) items.push({ key: "cancel", label: t("ms_menu_cancel_pending"), icon: Ban, danger: true, onClick: () => cancelInteracClaim(pending) });
    // Le reçu s'appuie sur le registre unifié payment_transactions (suite
    // 50) plutôt que sur les seules demandes Interac, afin de couvrir
    // aussi les paiements par carte.
    const memberTx = paymentTransactions.filter((tx) => tx.member_id === me?.id && tx.type === type);
    if (memberTx.length > 0) {
      const typeLabel = {
        inscription: t("ms_inscription"), fonds_urgence: t("ms_fonds_urgence"), fonds_secours: t("ms_fonds_secours"),
        cotisation: t("ms_label_cotisation"), collation: t("ms_collation"), don: t("ms_label_don"), pret: t("ms_label_pret"),
      }[type] || type;
      items.push({ key: "receipt", label: t("ms_menu_download_receipt"), icon: Receipt, onClick: () => setReceiptFor({ type, typeLabel, transactions: memberTx }) });
    }
    if (type === "pret" && memberLoan) items.push({ key: "loanTerms", label: t("ms_menu_loan_terms"), icon: FileSignature, onClick: () => setLoanTermsOpen(true) });
    return items;
  }
  // Montant reçu éditable par ligne avant confirmation (le bureau peut le
  // corriger si le membre a versé moins — ou plus — que le montant
  // initialement demandé). Pré-rempli avec le montant demandé.
  const [interacAmountEdits, setInteracAmountEdits] = useState({});
  function interacAmountFor(claim) {
    return interacAmountEdits[claim.id] !== undefined ? interacAmountEdits[claim.id] : String(claim.montant);
  }
  async function confirmInteracClaim(claim) {
    if (!isBureau) return;
    const montantRecu = parseDecimal(interacAmountFor(claim));
    if (!(montantRecu > 0)) { setErrorMsg(t("interac_claims_amount_invalid")); return; }
    const nomMembreClaim = members.find((m) => m.id === claim.member_id)?.nom || "—";
    if (!window.confirm(t("interac_confirm_claim").replace("{nom}", nomMembreClaim).replace("{montant}", moneyF(montantRecu)))) return;
    setSaving(true); setErrorMsg("");
    try {
      let balanceErr = null;
      let periode = null; // numéro de séance / libellé de mois, pour le registre des transactions (suite 50)
      // Écriture additive (montant déjà versé + montant reçu maintenant,
      // plafonné au montant configuré) plutôt qu'un remplacement fixe —
      // nécessaire pour gérer correctement un versement partiel suivi
      // plus tard d'un complément.
      if (claim.type === "inscription") {
        const current = Number(members.find((m) => m.id === claim.member_id)?.inscription_paye || 0);
        const target = Math.min(inscriptionMontant, current + montantRecu);
        ({ error: balanceErr } = await supabase.from("members").update({ inscription_paye: target }).eq("id", claim.member_id));
      } else if (claim.type === "fonds_urgence") {
        const current = Number(members.find((m) => m.id === claim.member_id)?.fonds_urgence_paye || 0);
        const target = Math.min(fondsUrgenceMontant, current + montantRecu);
        ({ error: balanceErr } = await supabase.from("members").update({ fonds_urgence_paye: target }).eq("id", claim.member_id));
      } else if (claim.type === "fonds_secours") {
        const current = Number(members.find((m) => m.id === claim.member_id)?.fonds_secours_paye || 0);
        const target = Math.min(fondsSecoursMontant, current + montantRecu);
        ({ error: balanceErr } = await supabase.from("members").update({ fonds_secours_paye: target }).eq("id", claim.member_id));
      } else if (claim.type === "cotisation") {
        const seance = nextUnpaidSeance(claim.member_id);
        if (seance == null) { setErrorMsg(t("interac_claims_already_paid")); setSaving(false); return; }
        periode = String(seance);
        ({ error: balanceErr } = await supabase.from("tontine_presences").upsert({ member_id: claim.member_id, seance, montant: montantRecu }, { onConflict: "member_id,seance" }));
      } else if (claim.type === "collation") {
        const mois = nextUnpaidMois(claim.member_id);
        if (mois == null) { setErrorMsg(t("interac_claims_already_paid")); setSaving(false); return; }
        periode = mois;
        ({ error: balanceErr } = await supabase.from("collation_presences").upsert({ member_id: claim.member_id, mois, montant: montantRecu }, { onConflict: "member_id,mois" }));
      } else if (claim.type === "don") {
        const member = members.find((m) => m.id === claim.member_id);
        ({ error: balanceErr } = await supabase.from("donations").insert({
          association_id: profile.association_id, donateur_nom: member?.nom || "—", donateur_email: member?.email || null,
          montant: montantRecu, message: t("interac_claims_don_auto_message"), date: new Date().toISOString().slice(0, 10),
        }));
      } else if (claim.type === "pret") {
        if (!claim.loan_id) { setErrorMsg(t("interac_claims_loan_missing")); setSaving(false); return; }
        ({ error: balanceErr } = await supabase.from("loan_repayments").insert({
          loan_id: claim.loan_id, association_id: profile.association_id, montant: montantRecu, date: new Date().toISOString().slice(0, 10),
        }));
        if (!balanceErr) {
          const loan = loans.find((l) => l.id === claim.loan_id);
          if (loan) {
            const repaidSoFar = loanRepaidFor(claim.loan_id);
            if (repaidSoFar + montantRecu >= loanTotalDueFor(loan)) {
              await supabase.from("loans").update({ statut: "rembourse" }).eq("id", claim.loan_id);
            }
          }
        }
      } else if (claim.type === "recouvrement") {
        if (!claim.recouvrement_id) { setErrorMsg(t("interac_claims_recouvrement_missing")); setSaving(false); return; }
        const rec = [...fuRecouvrements, ...fsRecouvrements].find((r) => r.id === claim.recouvrement_id);
        if (!rec) { setErrorMsg(t("interac_claims_recouvrement_missing")); setSaving(false); return; }
        periode = depenseFondsMap[rec.depense_id] || null;
        ({ error: balanceErr } = await supabase.from("fonds_recouvrements").update({ paye: true, date_paiement: todayISO() }).eq("id", claim.recouvrement_id));
      }
      if (balanceErr) throw balanceErr;
      const { data, error } = await supabase.from("interac_payment_claims").update({
        statut: "confirme", confirmed_at: new Date().toISOString(), confirmed_by: profile.id, montant_recu: montantRecu,
      }).eq("id", claim.id).select().single();
      if (error) throw error;
      setInteracClaims((prev) => prev.map((c) => (c.id === claim.id ? data : c)));
      setInteracAmountEdits((prev) => { const next = { ...prev }; delete next[claim.id]; return next; });
      // Registre des transactions (suite 50) : une ligne par paiement
      // confirmé, en plus de l'écriture ci-dessus — alimente le détail
      // ligne par ligne dans Mon espace, au même titre que les paiements
      // par carte enregistrés côté webhook Stripe. Ne bloque jamais la
      // confirmation elle-même (déjà appliquée) si cette écriture
      // secondaire échoue.
      const { error: txErr } = await supabase.from("payment_transactions").insert({
        association_id: profile.association_id, member_id: claim.member_id, type: claim.type,
        periode, montant: montantRecu, methode: "interac", reference: claim.id,
      });
      if (txErr) console.error("Échec de l'écriture au registre des transactions :", txErr);
      await loadAll();
    } catch (e) {
      setErrorMsg(t("interac_claims_confirm_error") + " " + friendlyError(e, t));
    } finally {
      setSaving(false);
    }
  }
  async function rejectInteracClaim(claim) {
    if (!isBureau) return;
    const commentaire = window.prompt(t("interac_claims_reject_prompt")) || null;
    if (!window.confirm(t("interac_confirm_reject_claim"))) return;
    setSaving(true); setErrorMsg("");
    const { data, error } = await supabase.from("interac_payment_claims").update({
      statut: "rejete", confirmed_at: new Date().toISOString(), confirmed_by: profile.id, commentaire_bureau: commentaire,
    }).eq("id", claim.id).select().single();
    setSaving(false);
    if (!error) setInteracClaims((prev) => prev.map((c) => (c.id === claim.id ? data : c)));
  }

  const inscriptionTotalDu = members.length * inscriptionMontant;
  const inscriptionTotalPaye = members.reduce((s, m) => s + Number(m.inscription_paye || 0), 0);
  const donationsTotal = donations.reduce((s, d) => s + Number(d.montant || 0), 0);
  const loansGrantedTotal = loans.reduce((s, l) => s + Number(l.montant_pret || 0), 0);
  const loanRepaymentsTotal = loanRepayments.reduce((s, r) => s + Number(r.montant || 0), 0);
  const totalRevenusHorsTontine = inscriptionTotalPaye
    + members.reduce((s, m) => s + Number(m.fonds_urgence_paye || 0), 0)
    + members.reduce((s, m) => s + Number(m.fonds_secours_paye || 0), 0)
    + fuRecouvrements.filter((r) => r.paye).reduce((s, r) => s + Number(r.quote_part), 0)
    + fsRecouvrements.filter((r) => r.paye).reduce((s, r) => s + Number(r.quote_part), 0)
    + donationsTotal + loanRepaymentsTotal;
  const totalDepenses = fuDepenses.reduce((s, d) => s + Number(d.montant), 0) + fsDepenses.reduce((s, d) => s + Number(d.montant), 0) + loansGrantedTotal;
  const excedent = totalRevenusHorsTontine - totalDepenses;
  const generalFund = excedent - fuSolde - fsSolde;
  const revenueBreakdown = [
    { key: "inscriptions", label: t("fin_registrations"), value: inscriptionTotalPaye },
    { key: "contrib_urgence", label: t("fin_contrib_urgence"), value: members.reduce((s, m) => s + Number(m.fonds_urgence_paye || 0), 0) },
    { key: "contrib_secours", label: t("fin_contrib_secours"), value: members.reduce((s, m) => s + Number(m.fonds_secours_paye || 0), 0) },
    { key: "recouv_urgence", label: t("fin_recouv_urgence"), value: fuRecouvrements.filter((r) => r.paye).reduce((s, r) => s + Number(r.quote_part), 0) },
    { key: "recouv_secours", label: t("fin_recouv_secours"), value: fsRecouvrements.filter((r) => r.paye).reduce((s, r) => s + Number(r.quote_part), 0) },
    { key: "donations", label: t("fin_donations"), value: donationsTotal },
    { key: "loan_repayments", label: t("fin_loan_repayments"), value: loanRepaymentsTotal },
  ];
  const expenseBreakdown = [
    { key: "exp_urgence", label: t("fin_expenses_urgence"), value: fuDepenses.reduce((s, d) => s + Number(d.montant), 0) },
    { key: "exp_secours", label: t("fin_expenses_secours"), value: fsDepenses.reduce((s, d) => s + Number(d.montant), 0) },
    { key: "loans_granted", label: t("fin_loans_granted"), value: loansGrantedTotal },
  ];

  // ---------- Configuration (branding) ----------
  const currencyChoices = useMemo(() => currencyOptions(lang), [lang]);
  const timezoneChoices = useMemo(() => timezoneOptions(), []);
  const [brandDraft, setBrandDraft] = useState(association || {});
  useEffect(() => { setBrandDraft(association || {}); }, [association]);
  const [savedCard, setSavedCard] = useState(null);
  async function saveBranding(cardId) {
    if (!isBureau) return;
    const cardLabels = {
      branding: t("cfg_branding_card_title"),
      montants: t("cfg_montants_title"),
      funeraire: t("cfg_funeraire_title"),
      sanctions: t("cfg_sanctions_title"),
      secours: t("cfg_secours_title"),
      approbateur: t("cfg_approbateur_title"),
      signataires: t("cfg_signataires_title"),
      legal: t("cfg_legal_title"),
      vitrine: t("cfg_vitrine_title"),
    };
    if (cardId === "funeraire" && brandDraft.funeraire_main_levee_actif === false && !brandDraft.funeraire_organisme_tiers_actif) {
      alert(t("cfg_funeraire_au_moins_un_requis"));
      return;
    }
    if (!window.confirm(t("cfg_confirm_save_section").replace("{section}", cardLabels[cardId] || cardId))) return;
    setSaving(true); setErrorMsg("");
    const { data, error } = await supabase.from("associations").update({
      nom: brandDraft.nom, logo_url: brandDraft.logo_url, devise_texte: brandDraft.devise_texte,
      devise_monetaire: brandDraft.devise_monetaire, fuseau_horaire: brandDraft.fuseau_horaire, couleur_primaire: brandDraft.couleur_primaire, couleur_accent: brandDraft.couleur_accent,
      periode_probation_secours_jours: brandDraft.periode_probation_secours_jours ? Number(brandDraft.periode_probation_secours_jours) : null,
      approbateur_suppression_id: brandDraft.approbateur_suppression_id || null,
      inscription_montant: brandDraft.inscription_montant ? Number(brandDraft.inscription_montant) : null,
      fonds_urgence_montant: brandDraft.fonds_urgence_montant ? Number(brandDraft.fonds_urgence_montant) : null,
      fonds_secours_montant: brandDraft.fonds_secours_montant ? Number(brandDraft.fonds_secours_montant) : null,
      collation_montant_mensuel: brandDraft.collation_montant_mensuel ? Number(brandDraft.collation_montant_mensuel) : null,
      tontine_montant_seance: brandDraft.tontine_montant_seance ? Number(brandDraft.tontine_montant_seance) : null,
      frequence_reunions: brandDraft.frequence_reunions || null,
      interac_email: brandDraft.interac_email ? brandDraft.interac_email.trim() : null,
      signataire1_nom: brandDraft.signataire1_nom ? brandDraft.signataire1_nom.trim() : null,
      signataire1_titre: brandDraft.signataire1_titre ? brandDraft.signataire1_titre.trim() : null,
      signataire2_nom: brandDraft.signataire2_nom ? brandDraft.signataire2_nom.trim() : null,
      signataire2_titre: brandDraft.signataire2_titre ? brandDraft.signataire2_titre.trim() : null,
      statut_juridique: brandDraft.statut_juridique ? brandDraft.statut_juridique.trim() : null,
      numero_enregistrement: brandDraft.numero_enregistrement ? brandDraft.numero_enregistrement.trim() : null,
      adresse: brandDraft.adresse ? brandDraft.adresse.trim() : null,
      recu_mention_legale: brandDraft.recu_mention_legale ? brandDraft.recu_mention_legale.trim() : null,
      recu_objet_social: brandDraft.recu_objet_social ? brandDraft.recu_objet_social.trim() : null,
      recu_categorie_eligibilite: brandDraft.recu_categorie_eligibilite || null,
      recu_numero_organisme_bienfaisance: brandDraft.recu_numero_organisme_bienfaisance ? brandDraft.recu_numero_organisme_bienfaisance.trim().toUpperCase() : null,
      funeraire_main_levee_actif: brandDraft.funeraire_main_levee_actif !== false,
      funeraire_organisme_tiers_actif: !!brandDraft.funeraire_organisme_tiers_actif,
      funeraire_periode_probation_jours: brandDraft.funeraire_periode_probation_jours ? Number(brandDraft.funeraire_periode_probation_jours) : null,
      funeraire_montant_inscription: brandDraft.funeraire_montant_inscription ? Number(brandDraft.funeraire_montant_inscription) : null,
      funeraire_montant_deces: brandDraft.funeraire_montant_deces ? Number(brandDraft.funeraire_montant_deces) : null,
      funeraire_montant_recharge: brandDraft.funeraire_montant_recharge ? Number(brandDraft.funeraire_montant_recharge) : null,
      funeraire_seuil_alerte: brandDraft.funeraire_seuil_alerte ? Number(brandDraft.funeraire_seuil_alerte) : null,
      sanctions_paliers_actifs: brandDraft.sanctions_paliers_actifs !== false,
      sanctions_seuil_validation: brandDraft.sanctions_seuil_validation ? Number(brandDraft.sanctions_seuil_validation) : 25,
      adhesion_notif_auto: brandDraft.adhesion_notif_auto !== false,
    }).eq("id", profile.association_id).select().single();
    setSaving(false);
    if (!error) {
      onAssociationChange(data);
      if (cardId) {
        setSavedCard(cardId);
        setTimeout(() => setSavedCard((c) => (c === cardId ? null : c)), 2500);
      }
    } else {
      setErrorMsg(t("cfg_save_error") + " " + friendlyError(error, t));
    }
  }

  // ---------- Logo de l'association : téléversement depuis l'ordinateur ----------
  const logoFileInputRef = useRef(null);
  async function uploadLogo(file) {
    if (!file || !isBureau) return;
    if (!window.confirm(t("cfg_confirm_upload_logo").replace("{nom}", file.name))) return;
    setSaving(true);
    const path = `association/${profile.association_id}/${Date.now()}_${file.name}`;
    const { error: uploadErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (uploadErr) { setSaving(false); setErrorMsg(t("cfg_logo_upload_error") + " " + friendlyError(uploadErr, t)); return; }
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    const { data, error } = await supabase.from("associations").update({ logo_url: urlData.publicUrl }).eq("id", profile.association_id).select().single();
    setSaving(false);
    if (!error) { onAssociationChange(data); setBrandDraft((p) => ({ ...p, logo_url: data.logo_url })); }
    else setErrorMsg(friendlyError(error, t));
  }

  // ---------- Galerie de l'association (suite 2026-10-06) ----------
  // Table association_photos + bucket "association-photos" — voir
  // sql/2026-10-06_galerie_photos_association.sql. Comme pour
  // association_memberships, l'échec (table/bucket absents tant que le
  // script n'a pas été exécuté) reste silencieux pour la LECTURE
  // (galleryPhotos reste vide), mais l'ÉCRITURE (upload/suppression)
  // affiche bien l'erreur — contrairement au chargement initial, une
  // action explicite du bureau mérite un retour explicite si elle échoue.
  const [galleryPhotos, setGalleryPhotos] = useState([]);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryMsg, setGalleryMsg] = useState("");
  const [editingGalleryPhoto, setEditingGalleryPhoto] = useState(null);
  const galleryFileInputRef = useRef(null);
  const loadGalleryPhotos = useCallback(async () => {
    const { data, error } = await supabase.from("association_photos").select("*").eq("association_id", profile.association_id).order("ordre");
    if (!error) setGalleryPhotos(data || []);
  }, [profile.association_id]);
  useEffect(() => { loadGalleryPhotos(); }, [loadGalleryPhotos]);
  async function uploadGalleryPhotos(files) {
    if (!files || files.length === 0 || !isBureau) return;
    setGalleryUploading(true); setGalleryMsg("");
    let nextOrdre = galleryPhotos.reduce((max, p) => Math.max(max, p.ordre), -1) + 1;
    let failCount = 0;
    for (const file of files) {
      const path = `${profile.association_id}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from("association-photos").upload(path, file);
      if (uploadErr) { failCount++; continue; }
      const { data: urlData } = supabase.storage.from("association-photos").getPublicUrl(path);
      const { error: insertErr } = await supabase.from("association_photos").insert({
        association_id: profile.association_id, storage_path: path, url: urlData.publicUrl, ordre: nextOrdre, created_by: profile.id,
      });
      if (insertErr) failCount++;
      nextOrdre++;
    }
    setGalleryUploading(false);
    if (failCount > 0) setGalleryMsg(t("cfg_gallery_upload_error"));
    await loadGalleryPhotos();
  }
  async function deleteGalleryPhoto(photo) {
    if (!isBureau) return;
    if (!window.confirm(t("cfg_gallery_confirm_delete"))) return;
    const { error } = await supabase.from("association_photos").delete().eq("id", photo.id);
    if (error) { setGalleryMsg(friendlyError(error, t)); return; }
    await supabase.storage.from("association-photos").remove([photo.storage_path]);
    await loadGalleryPhotos();
  }
  async function moveGalleryPhoto(photo, direction) {
    const idx = galleryPhotos.findIndex((p) => p.id === photo.id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= galleryPhotos.length) return;
    const other = galleryPhotos[swapIdx];
    const [a, b] = [photo.ordre, other.ordre];
    await Promise.all([
      supabase.from("association_photos").update({ ordre: b }).eq("id", photo.id),
      supabase.from("association_photos").update({ ordre: a }).eq("id", other.id),
    ]);
    await loadGalleryPhotos();
  }
  // Texte de présentation d'une photo (suite 2026-10-06, demande explicite
  // de l'utilisateur — voir sql/2026-10-06_galerie_photos_legendes.sql) :
  // titre + description + lien optionnel, affichés dans le panneau
  // latéral du diaporama (PresentationAssociation.jsx, PhotoCarousel) à
  // la place de la simple surimpression de "legende" qui existait avant
  // sans jamais être réellement modifiable depuis l'application.
  async function updateGalleryPhoto(photoId, fields) {
    const { error } = await supabase.from("association_photos").update(fields).eq("id", photoId);
    if (error) { setGalleryMsg(friendlyError(error, t)); return false; }
    await loadGalleryPhotos();
    return true;
  }

  // ---------- Votre forfait (changement de plan) ----------
  // Seul le président initie un changement de forfait (standard/premium) —
  // par carte (Stripe, confirmation automatique via le webhook) ou par
  // virement Interac (preuve téléversée, confirmée manuellement par le
  // Super-Admin — jamais par le bureau de l'association elle-même, voir
  // sql/2026-10-05_provisionnement_forfaits.sql). Les autres rôles du
  // bureau peuvent consulter l'état du forfait mais pas le modifier.
  const [forfaitPlan, setForfaitPlan] = useState(null);
  const [forfaitShowInterac, setForfaitShowInterac] = useState(false);
  const [forfaitInteracFile, setForfaitInteracFile] = useState(null);
  const [forfaitInteracUploading, setForfaitInteracUploading] = useState(false);
  const [forfaitInteracMsg, setForfaitInteracMsg] = useState("");
  const [pendingPlanRequest, setPendingPlanRequest] = useState(null);
  const forfaitFileInputRef = useRef(null);
  const FORFAIT_PRIX = { standard: 10, premium: 25 };
  useEffect(() => {
    if (!isBureau) return;
    supabase.from("plan_change_requests").select("*").eq("association_id", profile.association_id).eq("statut", "en_attente")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setPendingPlanRequest(data || null));
  }, [isBureau, profile.association_id]);
  function forfaitPlanLabel(plan) {
    return plan === "premium" ? t("cfg_forfait_plan_premium") : plan === "standard" ? t("cfg_forfait_plan_standard") : t("cfg_forfait_plan_essai");
  }
  async function submitForfaitInterac(plan) {
    if (!forfaitInteracFile || !isPresident) return;
    if (!window.confirm(t("cfg_forfait_confirm_interac").replace("{plan}", forfaitPlanLabel(plan)).replace("{montant}", moneyF(FORFAIT_PRIX[plan])))) return;
    setForfaitInteracUploading(true); setErrorMsg(""); setForfaitInteracMsg("");
    try {
      const path = `${profile.association_id}/${Date.now()}_${forfaitInteracFile.name}`;
      const { error: uploadErr } = await supabase.storage.from("plan-change-proofs").upload(path, forfaitInteracFile);
      if (uploadErr) throw uploadErr;
      const { data: requestId, error } = await supabase.rpc("create_plan_change_request", {
        p_plan: plan, p_fichier_path: path, p_fichier_nom: forfaitInteracFile.name,
      });
      if (error) throw error;
      setPendingPlanRequest({
        id: requestId, plan_demande: plan, montant: FORFAIT_PRIX[plan], statut: "en_attente",
        fichier_nom: forfaitInteracFile.name, created_at: new Date().toISOString(),
      });
      setForfaitInteracMsg(t("cfg_forfait_interac_envoye"));
      setForfaitInteracFile(null);
      setForfaitShowInterac(false);
      setForfaitPlan(null);
    } catch (e) {
      setErrorMsg(t("cfg_forfait_interac_erreur") + " " + friendlyError(e, t));
    } finally {
      setForfaitInteracUploading(false);
    }
  }

  // ---------- Code d'invitation (rejoindre l'association) ----------
  const [inviteCodeMsg, setInviteCodeMsg] = useState("");
  async function regenerateInviteCode() {
    if (!isPresident) return;
    setSaving(true); setInviteCodeMsg("");
    const { data, error } = await supabase.rpc("regenerate_invite_code");
    setSaving(false);
    if (error) { setErrorMsg(friendlyError(error, t)); return; }
    onAssociationChange({ ...association, code_invitation: data });
    setBrandDraft((p) => ({ ...p, code_invitation: data }));
  }
  function copyInviteCode() {
    const code = brandDraft.code_invitation || association?.code_invitation;
    if (!code) return;
    try {
      navigator.clipboard.writeText(code);
      setInviteCodeMsg(t("cfg_invite_copied"));
      setTimeout(() => setInviteCodeMsg(""), 2500);
    } catch { /* presse-papier indisponible : rien de grave, le code reste affiché */ }
  }

  // ---------- Vitrine publique (Phase 4, suite 91) ----------
  const [vitrineBusy, setVitrineBusy] = useState(false);
  const [vitrineMsg, setVitrineMsg] = useState("");
  const publicUrl = association?.slug_public ? `${window.location.origin}/?pub=${association.slug_public}` : "";
  async function toggleVitrine() {
    if (!isPresident) return;
    setVitrineMsg("");
    if (!association?.vitrine_active) {
      setVitrineBusy(true);
      const { data, error } = await supabase.rpc("activate_public_vitrine");
      setVitrineBusy(false);
      if (error) { setVitrineMsg(friendlyError(error, t)); return; }
      onAssociationChange({ ...association, vitrine_active: true, slug_public: data });
      setBrandDraft((p) => ({ ...p, vitrine_active: true, slug_public: data }));
    } else {
      if (!window.confirm(t("cfg_vitrine_confirm_deactivate"))) return;
      setVitrineBusy(true);
      const { data, error } = await supabase.from("associations").update({ vitrine_active: false }).eq("id", profile.association_id).select().single();
      setVitrineBusy(false);
      if (error) { setVitrineMsg(friendlyError(error, t)); return; }
      onAssociationChange(data);
      setBrandDraft((p) => ({ ...p, vitrine_active: false }));
    }
  }
  async function saveSlug() {
    if (!isPresident) return;
    const slug = (brandDraft.slug_public || "").trim();
    if (!slug) return;
    setVitrineBusy(true); setVitrineMsg("");
    const { data, error } = await supabase.from("associations").update({ slug_public: slug }).eq("id", profile.association_id).select().single();
    setVitrineBusy(false);
    if (error) { setVitrineMsg(friendlyError(error, t)); return; }
    onAssociationChange(data);
    setVitrineMsg(t("cfg_vitrine_slug_saved"));
    setTimeout(() => setVitrineMsg(""), 2500);
  }
  function copyPublicUrl() {
    if (!publicUrl) return;
    try {
      navigator.clipboard.writeText(publicUrl);
      setVitrineMsg(t("cfg_invite_copied"));
      setTimeout(() => setVitrineMsg(""), 2500);
    } catch { /* presse-papier indisponible : l'adresse reste affichée */ }
  }

  // ---------- Navigation par rôle ----------
  const navItems = [{ id: "apercu", label: t("nav_apercu"), icon: Building2 }];
  if (isBureau) {
    navItems.push(
  { id: "dashboard", label: t("nav_dashboard"), icon: LayoutDashboard },
);
    // Filtré par canSeeBureauModule (suite 2026-10-07) : un rôle restreint
    // (voir allowedBureauModules plus haut) ne voit, dans ce bloc, que les
    // modules que le président lui a explicitement autorisés — "securite"
    // (paramètres du compte de la personne) reste toujours visible, hors
    // de ce filtre, il n'est pas dans BUREAU_CONFIGURABLE_MODULES.
    navItems.push(
      ...[
        { id: "membres", label: t("nav_members"), icon: Users },
        { id: "inscription", label: t("nav_inscription"), icon: IdCard },
        { id: "presences", label: t("nav_presences"), icon: QrCode },
        { id: "tontine", label: t("nav_tontine"), icon: HeartHandshake },
        { id: "collation", label: t("nav_collation"), icon: Coffee },
        { id: "urgence", label: t("nav_urgence"), icon: ShieldCheck },
        { id: "secours", label: t("nav_secours"), icon: LifeBuoy },
        { id: "finances", label: t("nav_finances"), icon: FileBarChart },
        { id: "paiements_interac", label: t("nav_interac"), icon: CreditCard },
        { id: "dons", label: t("nav_donations"), icon: Gift },
        { id: "emprunts", label: t("nav_loans"), icon: Vote },
        { id: "gouvernance", label: t("nav_governance"), icon: Landmark },
        { id: "sanctions", label: t("nav_sanctions"), icon: Gavel },
        { id: "comite", label: t("nav_comite"), icon: ShieldHalf },
        { id: "documents", label: t("nav_documents"), icon: FileText },
        { id: "vieassociative", label: t("nav_community"), icon: Rss },
        { id: "evenements", label: t("nav_events"), icon: CalendarDays },
        { id: "reunions", label: t("nav_meetings"), icon: Video },
        { id: "sondages", label: t("nav_polls"), icon: BarChart3 },
        { id: "tirages", label: t("nav_draws"), icon: Dices },
        { id: "jeunesse", label: t("nav_jeunesse"), icon: GraduationCap },
        { id: "achats", label: t("nav_achats"), icon: ShoppingBasket },
        { id: "annonces", label: t("nav_announcements"), icon: Bell },
        { id: "projets", label: t("nav_projects"), icon: Kanban },
        { id: "covoiturage", label: t("nav_carpool"), icon: Car },
        { id: "emploi", label: t("nav_jobs"), icon: Briefcase },
        { id: "funeraire", label: t("nav_funeraire"), icon: Flower2 },
        { id: "journal", label: t("nav_activity"), icon: History },
        { id: "demandes_suppression", label: t("nav_del_requests"), icon: AlertTriangle },
        { id: "acces", label: t("nav_access"), icon: KeyRound },
        { id: "config", label: t("nav_config"), icon: Settings },
      ].filter((item) => canSeeBureauModule(item.id) && (item.id !== "comite" || comiteVisible)),
      { id: "securite", label: t("sec_title"), icon: ShieldCheck },
    );
  } else if (isResponsable) {
    const r = profile.rubrique_assignee;
    navItems.push({ id: "dashboard", label: t("nav_dashboard"), icon: LayoutDashboard });
   if (r) navItems.push({ id: r === "fonds_urgence" ? "urgence" : r === "fonds_secours" ? "secours" : r, label: t(RUBRIQUE_KEY_MAP[r]), icon: IdCard });
    navItems.push(
      { id: "finances", label: t("nav_finances"), icon: FileBarChart },
      { id: "gouvernance", label: t("nav_governance"), icon: Landmark },
      { id: "documents", label: t("nav_documents"), icon: FileText },
      { id: "vieassociative", label: t("nav_community"), icon: Rss },
      { id: "evenements", label: t("nav_events"), icon: CalendarDays },
      { id: "reunions", label: t("nav_meetings"), icon: Video },
      { id: "sondages", label: t("nav_polls"), icon: BarChart3 },
      { id: "tirages", label: t("nav_draws"), icon: Dices },
      { id: "jeunesse", label: t("nav_jeunesse"), icon: GraduationCap },
      { id: "achats", label: t("nav_achats"), icon: ShoppingBasket },
      { id: "annonces", label: t("nav_announcements"), icon: Bell },
      { id: "projets", label: t("nav_projects"), icon: Kanban },
      { id: "covoiturage", label: t("nav_carpool"), icon: Car },
      { id: "emploi", label: t("nav_jobs"), icon: Briefcase },
      { id: "funeraire", label: t("nav_funeraire"), icon: Flower2 },
      { id: "securite", label: t("sec_title"), icon: ShieldCheck },
    );
 } else if (isAdherent) {
    navItems.push(
      { id: "monespace", label: t("nav_myspace"), icon: Users },
      { id: "gouvernance", label: t("nav_governance"), icon: Landmark },
      { id: "sanctions", label: t("nav_sanctions"), icon: Gavel },
      { id: "vieassociative", label: t("nav_community"), icon: Rss },
      { id: "evenements", label: t("nav_events"), icon: CalendarDays },
      { id: "reunions", label: t("nav_meetings"), icon: Video },
      { id: "sondages", label: t("nav_polls"), icon: BarChart3 },
      { id: "tirages", label: t("nav_draws"), icon: Dices },
      { id: "jeunesse", label: t("nav_jeunesse"), icon: GraduationCap },
      { id: "achats", label: t("nav_achats"), icon: ShoppingBasket },
      { id: "annonces", label: t("nav_announcements"), icon: Bell },
      { id: "covoiturage", label: t("nav_carpool"), icon: Car },
      { id: "emploi", label: t("nav_jobs"), icon: Briefcase },
      { id: "funeraire", label: t("nav_funeraire"), icon: Flower2 },
      { id: "securite", label: t("sec_title"), icon: ShieldCheck },
    );
  }

  // ---------- Regroupement de la navigation en sidebar (suite 2026-10-06) ----------
  // navItems reste la seule source de vérité des onglets visibles pour le
  // rôle courant (logique ci-dessus inchangée) — on se contente ici de
  // répartir ces mêmes items dans des groupes visuels pour la sidebar,
  // conformément à la maquette validée. Un id absent de NAV_GROUP_OF
  // retombe dans "administration" plutôt que de disparaître silencieusement.
  const navGroups = NAV_GROUP_ORDER.map((groupId) => ({
    id: groupId,
    label: t(NAV_GROUP_LABEL_KEYS[groupId]),
    items: navItems.filter((n) => (NAV_GROUP_OF[n.id] || "administration") === groupId),
  })).filter((g) => g.items.length > 0);

  if (loading) return <FullPageLoader text={t("load_data")} />;

  const me = isAdherent ? members.find((m) => m.id === profile.member_id) : null;
  const memberLoan = me ? loans.find((l) => l.member_id === me.id && l.statut === "actif") : null;
  const memberLoanSolde = memberLoan ? Math.max(0, loanTotalDueFor(memberLoan) - loanRepaidFor(memberLoan.id)) : 0;
  const memberDonTotal = me ? interacClaims.filter((c) => c.member_id === me.id && c.type === "don" && c.statut === "confirme").reduce((s, c) => s + Number(c.montant_recu ?? c.montant), 0) : 0;

  return (
    <div style={{ fontFamily: "Inter, -apple-system, sans-serif", background: BG, color: CHARCOAL, minHeight: "100vh" }} className="app-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap');
        * { box-sizing: border-box; }
        h1,h2,h3 { font-family: 'Fraunces', Georgia, serif; color: var(--primary); margin: 0; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: white; }
          /* Suite 88 (2026-09-28) : force l'impression des couleurs de fond
             (badges, en-têtes de tableau à fond coloré...) même quand
             l'option « Graphiques d'arrière-plan » du navigateur est
             décochée par défaut — sans quoi un texte blanc sur fond coloré
             deviendrait invisible (texte blanc sur papier blanc) une fois
             le fond supprimé à l'impression. */
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
          @page { margin: 16mm 14mm; }
        }
        .print-only { display: none; }
        /* Sidebar (suite 2026-10-06) : repose en "sticky" sur grand écran,
           mais sur un écran étroit elle passe en pleine largeur AU-DESSUS du
           contenu (flex-wrap du .shell) — sans ceci elle resterait figée à
           100vh de hauteur et scrollerait indépendamment du reste de la
           page, ce qui donnerait l'impression de deux ascenseurs sur
           téléphone. */
        @media (max-width: 860px) {
          .app-sidebar { position: static !important; max-height: none !important; overflow-y: visible !important; width: 100% !important; max-width: 100% !important; }
        }
      `}</style>

      {subscription && subscription.statut !== "actif" && (
       <Banner tone="warn">{t("sub_status_banner").replace("{statut}", subscription.statut)}</Banner>
      )}
      {errorMsg && <Banner tone="warn">{errorMsg}</Banner>}
      <CompteNonRelieBanner profile={profile} onOpen={tab === "acces" ? null : () => setTab("acces")} />
     {saving && <div className="no-print" style={{ background: TEAL_LIGHT, color: TEAL, padding: "4px 24px", fontSize: 11, textAlign: "right" }}>{t("saving_indicator")}</div>}

      {/* ================= NAVIGATION : SIDEBAR + BARRE SUPÉRIEURE =================
          Suite 2026-10-06 — remplace l'ancien <header> horizontal (logo + 26
          onglets qui wrappaient sur plusieurs lignes + recherche/cloche/langue/
          avatar) par la sidebar groupée/repliable validée en maquette, avec
          une barre supérieure fine pour les contrôles globaux. navItems/
          navGroups ci-dessus restent l'unique source de vérité des onglets
          visibles pour le rôle courant — aucun changement de logique d'accès,
          seulement de présentation. La sidebar se replie à deux niveaux :
          par groupe (collapsedGroups) et, maintenant, en entier vers un rail
          étroit d'icônes (sidebarCollapsed) — sur ce rail, les groupes sont
          tous "ouverts" de force (sinon un groupe fermé ne laisserait plus
          aucune icône visible) et chaque item garde son label en title=
          (info-bulle) plutôt que de le faire disparaître sans explication. */}
      <div className="shell" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start" }}>
        <aside className="no-print app-sidebar" style={{
          flex: sidebarCollapsed ? "0 0 60px" : "1 1 248px", width: sidebarCollapsed ? 60 : undefined,
          maxWidth: sidebarCollapsed ? 60 : 248, minWidth: sidebarCollapsed ? 60 : 220, boxSizing: "border-box",
          background: "var(--primary-dark)", color: "white", transition: "max-width .15s, flex-basis .15s",
          padding: sidebarCollapsed ? "16px 6px 24px" : "16px 12px 24px", display: "flex", flexDirection: "column",
          position: "sticky", top: 0, maxHeight: "100vh", overflowY: "auto", overflowX: "hidden",
        }}>
          {/* Identité de l'association — reprend logo + nom de l'ancien
              en-tête, + le bouton de repli de la sidebar. Le sélecteur
              d'association (menu déroulant) ne s'affiche QUE si ce compte
              a plus d'une appartenance dans association_memberships (voir
              claude/architecture-multi-association.md, section 8) — tant
              que ce n'est pas le cas (tout le monde aujourd'hui, avant même
              l'exécution de la migration SQL correspondante), on reste sur
              un simple affichage statique plutôt qu'un menu qui ne
              proposerait rien d'autre. */}
          <div style={{ position: "relative" }} ref={orgSwitcherRef}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6, padding: sidebarCollapsed ? "4px 0 14px" : "4px 6px 14px",
              borderBottom: "1px solid rgba(255,255,255,.12)", marginBottom: 10, justifyContent: sidebarCollapsed ? "center" : "space-between",
            }}>
              <div
                onClick={!sidebarCollapsed && memberships && memberships.length > 1 ? () => setOrgSwitcherOpen((v) => !v) : undefined}
                style={{ display: "flex", alignItems: "center", gap: 10, overflow: "hidden", minWidth: 0, cursor: !sidebarCollapsed && memberships && memberships.length > 1 ? "pointer" : "default" }}
              >
                {association?.logo_url ? <img src={association.logo_url} alt="" title="Unia" style={{ height: 32, width: 32, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} /> : (
                  <div title="Unia" style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,.1)", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid var(--accent)", flexShrink: 0 }}>
                    <HeartHandshake size={16} color="var(--accent)" />
                  </div>
                )}
                {!sidebarCollapsed && (
                  // Nom de la plateforme (« Unia ») — suite 2026-10-06 :
                  // jusqu'ici visible uniquement sur la page d'accueil/
                  // connexion (hors session), donc totalement absent une
                  // fois connecté dans le tableau de bord. Petite étiquette
                  // discrète au-dessus du nom de l'association, plutôt que de
                  // remplacer ce nom — les deux identités (la plateforme et
                  // l'association qui l'utilise) doivent rester visibles en
                  // même temps.
                  <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, lineHeight: 1.25 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "var(--accent)" }}>Unia</span>
                    <span style={{ fontFamily: "Fraunces, Georgia, serif", fontWeight: 700, color: "white", fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{association?.nom || t("org_default")}</span>
                    {/* Rôle du compte connecté, à côté du nom de l'association
                        (maquette : "ACA · Président(e)") — pour qu'on sache
                        toujours sous quel rôle on agit, surtout utile dès qu'il
                        y a plusieurs associations/rôles possibles pour le même
                        compte. Clé i18n (ROLE_KEY_MAP) plutôt que ROLE_LABELS
                        (FR uniquement) pour respecter la langue active. */}
                    {ROLE_KEY_MAP[profile.role] && (
                      <span style={{ fontSize: 10.5, color: "rgba(255,255,255,.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(ROLE_KEY_MAP[profile.role])}</span>
                    )}
                  </div>
                )}
                {!sidebarCollapsed && memberships && memberships.length > 1 && (
                  <ChevronDown size={13} color="rgba(255,255,255,.6)" style={{ flexShrink: 0, transform: orgSwitcherOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                )}
              </div>
              {!sidebarCollapsed && (
                <button
                  onClick={toggleSidebarCollapsed}
                  title={t("sidebar_collapse")}
                  aria-label={t("sidebar_collapse")}
                  style={{ background: "rgba(255,255,255,.08)", border: "none", borderRadius: 6, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,.75)", cursor: "pointer", flexShrink: 0 }}
                >
                  <ChevronLeft size={13} />
                </button>
              )}
            </div>
            {!sidebarCollapsed && memberships && memberships.length > 1 && orgSwitcherOpen && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "white", borderRadius: 10, boxShadow: "0 10px 30px rgba(24,34,51,.3)", zIndex: 40, overflow: "hidden", border: "1px solid #E6DFCD" }}>
                {memberships.map((m) => (
                  <button
                    key={m.association_id}
                    onClick={() => switchAssociation(m.association_id)}
                    disabled={switchingOrgId !== null}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "none",
                      background: m.association_id === profile.association_id ? "#FBF6EC" : "white", cursor: switchingOrgId !== null ? "default" : "pointer",
                      fontSize: 12.5, fontWeight: m.association_id === profile.association_id ? 700 : 500, color: "#182233", textAlign: "left",
                    }}
                  >
                    {m.associations?.logo_url ? <img src={m.associations.logo_url} alt="" style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} /> : <Building2 size={14} color="#0D3A63" style={{ flexShrink: 0 }} />}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.associations?.nom || t("org_default")}</span>
                      {ROLE_KEY_MAP[m.role] && (
                        <span style={{ fontSize: 10.5, fontWeight: 500, color: "#8A93A6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(ROLE_KEY_MAP[m.role])}</span>
                      )}
                    </span>
                    {switchingOrgId === m.association_id && <Loader2 size={13} style={{ flexShrink: 0, animation: "spin 1s linear infinite" }} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {sidebarCollapsed && (
            <button
              onClick={toggleSidebarCollapsed}
              title={t("sidebar_expand")}
              aria-label={t("sidebar_expand")}
              style={{ background: "rgba(255,255,255,.08)", border: "none", borderRadius: 6, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,.75)", cursor: "pointer", margin: "0 auto 10px" }}
            >
              <ChevronLeft size={13} style={{ transform: "rotate(180deg)" }} />
            </button>
          )}

          {navGroups.map((g) => {
            const groupHasActive = g.items.some((n) => n.id === tab);
            const isOpen = sidebarCollapsed || groupHasActive || !collapsedGroups[g.id];
            return (
              <div key={g.id} style={{ marginBottom: 2 }}>
                {sidebarCollapsed ? (
                  <div style={{ height: 1, background: "rgba(255,255,255,.12)", margin: "8px 4px 6px" }} title={g.label} />
                ) : (
                  <button
                    onClick={() => setCollapsedGroups((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, background: "none", border: "none", cursor: "pointer", padding: "7px 6px", color: "rgba(255,255,255,.55)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 }}
                  >
                    <span>{g.label}</span>
                    <ChevronDown size={12} style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .15s", flexShrink: 0 }} />
                  </button>
                )}
                {isOpen && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 6, alignItems: sidebarCollapsed ? "center" : "stretch" }}>
                    {g.items.map((n) => {
                      const Icon = n.icon; const active = tab === n.id;
                      const showBadge = n.id === "demandes_suppression" && association?.approbateur_suppression_id === profile.id
                        && deletionRequests.filter((r) => r.statut === "en_attente").length > 0;
                      const showAccesBadge = n.id === "acces" && pendingLinkRequestsCount > 0;
                      const interacPendingCount = interacClaims.filter((c) => c.statut === "en_attente").length;
                      const showInteracBadge = n.id === "paiements_interac" && interacPendingCount > 0;
                      // Petit repère « Premium » sur les onglets verrouillés (suite
                      // 2026-10-06) — l'onglet reste cliquable (menu inchangé, pas
                      // de disparition sans explication) mais signale avant même
                      // d'y entrer que le contenu réel est réservé au forfait
                      // Premium tant que l'association est à l'essai ou Standard.
                      const isLockedPremium = PREMIUM_FEATURE_IDS.includes(n.id) && !isPremiumPlan;
                      const anyBadge = showBadge || showAccesBadge || showInteracBadge || (MENU_BADGE_SECTIONS.includes(n.id) && unreadCounts[n.id] > 0);
                      return (
                        <button key={n.id} onClick={() => setTab(n.id)} title={sidebarCollapsed ? n.label : undefined} style={{
                          display: "flex", alignItems: "center", gap: 8, borderRadius: 7, border: "none", cursor: "pointer",
                          padding: sidebarCollapsed ? "9px" : "7px 10px", justifyContent: sidebarCollapsed ? "center" : "flex-start",
                          fontSize: 12.5, fontWeight: 600, background: active ? "rgba(255,255,255,.14)" : "transparent",
                          color: active ? "var(--accent)" : "rgba(255,255,255,.82)", position: "relative", textAlign: "left", width: sidebarCollapsed ? 40 : "100%",
                        }}>
                          <Icon size={13} style={{ flexShrink: 0 }} />
                          {!sidebarCollapsed && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{n.label}</span>}
                          {isLockedPremium && !sidebarCollapsed && <KeyRound size={10} color="#C8963E" style={{ flexShrink: 0 }} />}
                          {/* Rail replié : un seul point d'alerte en coin (pas la place pour
                              un badge chiffré lisible sur une icône de 13px) plutôt que de
                              faire disparaître le signal — le chiffre exact reste visible
                              au survol via title, et réapparaît en entier sidebar dépliée. */}
                          {sidebarCollapsed && anyBadge && (
                            <span style={{ position: "absolute", top: 4, right: 4, width: 7, height: 7, borderRadius: 999, background: RED }} />
                          )}
                          {!sidebarCollapsed && showBadge && <span style={{ background: RED, color: "white", borderRadius: 999, fontSize: 9.5, fontWeight: 700, minWidth: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 3px", flexShrink: 0 }}>{deletionRequests.filter((r) => r.statut === "en_attente").length}</span>}
                          {!sidebarCollapsed && showAccesBadge && <span style={{ background: RED, color: "white", borderRadius: 999, fontSize: 9.5, fontWeight: 700, minWidth: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 3px", flexShrink: 0 }}>{pendingLinkRequestsCount}</span>}
                          {!sidebarCollapsed && showInteracBadge && <span style={{ background: RED, color: "white", borderRadius: 999, fontSize: 9.5, fontWeight: 700, minWidth: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 3px", flexShrink: 0 }}>{interacPendingCount}</span>}
                          {!sidebarCollapsed && MENU_BADGE_SECTIONS.includes(n.id) && <NotifBadge count={unreadCounts[n.id]} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Pied de sidebar : statut du forfait + bouton "Passer à Premium"
              (suite 2026-10-06, maquette "Maquette sidebar Unia") — absent
              jusqu'ici une fois connecté, alors que ce rappel existait déjà
              textuellement dans Configuration (carte #forfait-card, voir
              goToForfait ci-dessus) ; marginTop: "auto" le pousse en bas de
              la sidebar (flex column) plutôt que juste après le dernier
              groupe de menu. Masqué sur le rail d'icônes replié (pas la
              place pour du texte) — comme le reste de l'identité de
              l'association ci-dessus. */}
          {!sidebarCollapsed && (
            <div style={{ marginTop: "auto", paddingTop: 14 }}>
              <div style={{ background: "rgba(255,255,255,.07)", borderRadius: 10, padding: "12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "white", textTransform: "uppercase", letterSpacing: .4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{forfaitPlanLabel(subscription?.plan)}</span>
                  {!isPremiumPlan && <Sparkles size={13} color="var(--accent)" style={{ flexShrink: 0 }} />}
                </div>
                {subscription?.plan === "essai" && subscription?.date_fin_periode && (
                  <p style={{ fontSize: 10.5, color: "rgba(255,255,255,.65)", margin: 0 }}>
                    {t("cfg_forfait_essai_fin")} {new Date(subscription.date_fin_periode).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA")}
                  </p>
                )}
                {!isPremiumPlan && (
                  <button
                    onClick={goToForfait}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: "var(--primary-dark)", background: "var(--accent)", border: "none", borderRadius: 7, padding: "7px 10px", cursor: "pointer" }}
                  >
                    {t("sidebar_upgrade_cta")} <ArrowRight size={12} />
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>

        <div className="content-area" style={{ flex: "999 1 560px", minWidth: 0 }}>

      <div className="no-print" style={{ background: "var(--primary)", position: "sticky", top: 0, zIndex: 10, boxShadow: "0 2px 14px rgba(0,0,0,.12)" }}>
        <Container style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", flexWrap: "wrap", gap: 10 }}>
          {/* Fil d'Ariane (suite 2026-10-06, maquette "Maquette sidebar Unia")
              — rappelle dans quelle association et quelle page on se trouve,
              utile dès qu'on jongle entre plusieurs associations (sélecteur
              ci-contre dans la sidebar). Purement indicatif, aucun des deux
              segments n'est cliquable : pas de page "accueil association"
              distincte de l'onglet courant vers laquelle renvoyer le premier
              segment. */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "rgba(255,255,255,.85)", fontSize: 12.5, overflow: "hidden", minWidth: 0 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{association?.nom || t("org_default")}</span>
            {(navItems.find((n) => n.id === tab)?.label) && (
              <>
                <ChevronRight size={12} color="rgba(255,255,255,.5)" style={{ flexShrink: 0 }} />
                <span style={{ fontWeight: 700, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{navItems.find((n) => n.id === tab)?.label}</span>
              </>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {/* Recherche globale (Phase 6, feuille de route, 2026-09-29) —
                dans l'en-tête, toujours visible, juste avant la cloche de
                notifications (placement choisi par l'utilisateur, plutôt
                qu'un onglet dédié). Portée complète : membres, documents,
                transactions, événements, projets, annonces, chacun filtré
                selon ce que le rôle courant peut normalement consulter. */}
            <div ref={searchBoxRef} style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.12)", borderRadius: 999, padding: "6px 12px" }}>
                <Search size={13} color="rgba(255,255,255,.75)" style={{ flexShrink: 0 }} />
                <input
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                  onFocus={() => { setSearchOpen(true); ensureSearchExtraLoaded(); }}
                  placeholder={t("search_placeholder")}
                  aria-label={t("search_aria")}
                  style={{ background: "none", border: "none", outline: "none", color: "white", fontSize: 12, width: 140, fontFamily: "inherit" }}
                />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(""); setSearchOpen(false); }} aria-label={t("action_close")} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.6)", display: "flex", padding: 0, flexShrink: 0 }}>
                    <X size={12} />
                  </button>
                )}
              </div>
              {searchOpen && searchQuery.trim() && (
                <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, background: "white", borderRadius: 10, boxShadow: "0 10px 30px rgba(20,30,50,0.2)", width: 320, maxHeight: 420, overflowY: "auto", zIndex: 30, border: "1px solid #EEE", textAlign: "left" }}>
                  {foldedQuery.length < 2 ? (
                    <div style={{ padding: "14px 16px", fontSize: 12, color: "#8A8F98" }}>{t("search_type_hint")}</div>
                  ) : searchExtra.loading ? (
                    <div style={{ padding: "14px 16px", fontSize: 12, color: "#8A8F98" }}>{t("loading")}</div>
                  ) : !searchResults || searchResults.total === 0 ? (
                    <div style={{ padding: "14px 16px", fontSize: 12, color: "#8A8F98" }}>{t("search_no_results").replace("{q}", searchQuery)}</div>
                  ) : (
                    <>
                      {searchResults.pages.length > 0 && (
                        <SearchGroup label={t("search_cat_pages")}>
                          {searchResults.pages.map((p) => (
                            <SearchResultRow key={p.id} icon={ArrowRight} title={p.label} subtitle="" onClick={() => goToSearchTab(p.id)} />
                          ))}
                        </SearchGroup>
                      )}
                      {searchResults.members.length > 0 && (
                        <SearchGroup label={t("nav_members")}>
                          {searchResults.members.map((m) => (
                            <SearchResultRow key={m.id} icon={Users} title={m.nom} subtitle={m.email || m.telephone || ""} onClick={() => goToMember(m.id)} />
                          ))}
                        </SearchGroup>
                      )}
                      {searchResults.transactions.length > 0 && (
                        <SearchGroup label={t("search_cat_transactions")}>
                          {searchResults.transactions.map((tx) => (
                            <SearchResultRow key={tx.id} icon={Receipt} title={`${memberNomFor(tx.member_id)} — ${moneyF(tx.montant)}`} subtitle={[tx.type, tx.created_at ? tx.created_at.slice(0, 10) : null].filter(Boolean).join(" · ")} onClick={() => goToMember(tx.member_id)} />
                          ))}
                        </SearchGroup>
                      )}
                      {searchResults.documents.length > 0 && (
                        <SearchGroup label={t("nav_documents")}>
                          {searchResults.documents.map((d) => (
                            <SearchResultRow key={d.id} icon={FileText} title={d.nom} subtitle={DOC_CATEGORY_KEY_MAP[d.rubrique] ? t(DOC_CATEGORY_KEY_MAP[d.rubrique]) : (d.rubrique || "")} onClick={() => goToSearchTab("documents")} />
                          ))}
                        </SearchGroup>
                      )}
                      {searchResults.events.length > 0 && (
                        <SearchGroup label={t("nav_events")}>
                          {searchResults.events.map((e) => (
                            <SearchResultRow key={e.id} icon={CalendarDays} title={e.titre} subtitle={[e.lieu, e.date_debut ? toDatetimeLocal(e.date_debut).slice(0, 10) : null].filter(Boolean).join(" · ")} onClick={() => goToSearchTab("evenements")} />
                          ))}
                        </SearchGroup>
                      )}
                      {searchResults.projects.length > 0 && (
                        <SearchGroup label={t("nav_projects")}>
                          {searchResults.projects.map((p) => (
                            <SearchResultRow key={p.id} icon={Kanban} title={p.nom} subtitle={p.categorie || ""} onClick={() => goToSearchTab("projets")} />
                          ))}
                        </SearchGroup>
                      )}
                      {searchResults.announcements.length > 0 && (
                        <SearchGroup label={t("nav_announcements")}>
                          {searchResults.announcements.map((a) => (
                            <SearchResultRow key={a.id} icon={Bell} title={a.titre} subtitle={(a.message || "").slice(0, 60)} onClick={() => goToSearchTab("annonces")} />
                          ))}
                        </SearchGroup>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            {pushState !== "unsupported" && pushState !== "loading" && (
              <button
                onClick={handleBellClick}
                title={pushState === "subscribed" ? t("push_enabled_tooltip") : t("push_disabled_tooltip")}
                style={{ background: "none", border: "none", cursor: "pointer", color: pushState === "subscribed" ? "#C8963E" : "rgba(255,255,255,.8)", display: "flex", alignItems: "center", gap: 4 }}
              >
                {pushState === "subscribed" ? <Bell size={15} /> : <BellOff size={15} />}
                <NotifBadge count={unreadTotal} />
              </button>
            )}
            <TextSizeControl />
            <LanguageSwitcher />
            {/* Photo de l'adhérent dans l'en-tête (suite Phase 6, 2026-09-29,
                demande explicite de l'utilisateur) — juste avant son nom,
                comme le reste de la ligne. me?.photo_url n'existe que pour
                un rôle adhérent (voir la définition de `me` plus haut) ;
                Avatar retombe sur les initiales sinon, comme partout
                ailleurs dans l'appli. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Avatar photoUrl={me?.photo_url} name={profile.nom_complet} size={26} fontSize={11} />
              <span style={{ fontSize: 11.5, color: "rgba(255,255,255,.7)" }}>{profile.nom_complet || profile.id.slice(0, 8)} · {t(ROLE_KEY_MAP[profile.role])}</span>
            </div>
            {(isBureau || isResponsable) && profile.compte_personnel_email && (
              // Bascule rapide vers le compte personnel (suite 2026-10-06)
              // — juste avant Déconnexion, comme demandé. Voir
              // switchToPersonalAccount plus haut : à configurer d'abord
              // dans Sécurité du compte (sec_personal_account_title).
              <button onClick={switchToPersonalAccount} title={t("switch_personal_tooltip")} style={{ background: "none", border: "none", color: "rgba(255,255,255,.8)", cursor: "pointer" }}><UserCog size={15} /></button>
            )}
            <button onClick={onLogout} style={{ background: "none", border: "none", color: "rgba(255,255,255,.8)", cursor: "pointer" }}><LogOut size={15} /></button>
          </div>
        </Container>
      </div>

      {tirageEnDirect && tab !== "tirages" && (!isBureau || canSeeBureauModule("tirages")) && (
        <button onClick={() => setTab("tirages")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", background: RED, color: "white", border: "none", padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
          <Dices size={16} /> {t("draw_live_banner").replace("{titre}", tirageEnDirect.titre)}
        </button>
      )}

      {/* ================= VUE D'ENSEMBLE (page d'accueil) ================= */}
      {tab === "apercu" && (
        <PresentationAssociation
          profile={profile}
          association={association}
          members={visibleMembers}
          fuSolde={fuSolde}
          fsSolde={fsSolde}
          activityLog={activityLog}
          describeActivity={(log) => describeActivityLog(log, t, lang, moneyF)}
          continueLabel={isAdherent ? t("apercu_continue_myspace") : t("apercu_continue_dashboard")}
          onContinue={(target) => setTab(target || (isAdherent ? "monespace" : "dashboard"))}
          isPremiumPlan={isPremiumPlan}
        />
      )}

      {/* ================= TABLEAU DE BORD ================= */}
      {tab === "dashboard" && (isBureau || isResponsable) && (
        <Container><Section>
         <h2 style={{ marginBottom: 4 }}>{t("dash_title")}</h2>
         <p style={{ color: "#5B6270", marginBottom: 20 }}>{lang === "en" ? (association?.devise_texte_en || association?.devise_texte) : association?.devise_texte}</p>
          {/* Rôle et responsabilités (suite 2026-10-07, demandé par
              l'utilisateur) — affiché uniquement quand le président a
              explicitement configuré CE rôle (myRoleConfig non nul) ; un
              rôle jamais configuré reste muet ici, comme avant. */}
          {myRoleConfig && (
            <div style={{ background: TEAL_LIGHT, border: `1px solid ${TEAL}`, borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEAL, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <ShieldCheck size={14} /> {t("dash_my_role_title").replace("{role}", myRoleConfig.nom)}
              </div>
              {myRoleConfig.responsabilites && <p style={{ fontSize: 13, color: "#182233", marginBottom: 8, whiteSpace: "pre-wrap" }}>{myRoleConfig.responsabilites}</p>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(myRoleConfig.modules || []).length === 0
                  ? <span style={{ fontSize: 11.5, color: "#5B6270" }}>{t("dash_my_role_no_modules")}</span>
                  : (myRoleConfig.modules || []).map((m) => (
                    <span key={m} style={{ fontSize: 11, fontWeight: 600, color: TEAL, background: "white", borderRadius: 999, padding: "3px 10px" }}>{t(BUREAU_MODULE_LABEL_KEYS[m] || m)}</span>
                  ))}
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 24 }}>
            <StatCard label={t("dash_active_members")} value={nbActifs} icon={Users} />
           <StatCard label={t("dash_registrations_received")} value={moneyF(inscriptionTotalPaye)} icon={IdCard} accent={TEAL} />
            <StatCard label={t("dash_tontine_paid")} value={moneyF(tontineTotalVerse)} icon={HeartHandshake} />
            <StatCard label={t("dash_collation_paid")} value={moneyF(collationTotalPaye)} icon={Coffee} accent={TEAL} />
            <StatCard label={t("dash_balance_urgence")} value={moneyF(fuSolde)} icon={ShieldCheck} />
            <StatCard label={t("dash_balance_secours")} value={moneyF(fsSolde)} icon={LifeBuoy} accent={TEAL} />
          </div>
          {isBureau && (
            <>
              <h3 style={{ fontSize: 15, marginBottom: 10 }}>{t("dash_detail_title")}</h3>
              <Table head={[t("member"), t("status"), t("nav_inscription"), t("dash_col_tontine"), t("dash_col_collation"), t("dash_col_urgence"), t("dash_col_secours"), t("tont_col_total")]}>
                {visibleMembers.map((m) => {
                  const rowTotal = Number(m.inscription_paye || 0) + tontineTotal(m.id) + collationTotalMois(m.id) + Number(m.fonds_urgence_paye || 0) + Number(m.fonds_secours_paye || 0);
                  return (
                    <tr key={m.id}>
                    <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>{m.nom}</td>
                      <td style={{ ...td, display: "flex", alignItems: "center", gap: 6 }}>
                        {m.statut === "Actif" ? <CheckCircle2 size={12} color={TEAL} /> : <Circle size={12} />} {m.statut === "Actif" ? t("active") : m.statut === "Inactif" ? t("inactive") : t("mem_deleted")}
                      </td>
                      <td style={td}>{moneyF(m.inscription_paye)}</td>
                      <td style={td}>{moneyF(tontineTotal(m.id))}</td>
                      <td style={td}>{moneyF(collationTotalMois(m.id))}</td>
                      <td style={td}>{moneyF(m.fonds_urgence_paye)}</td>
                      <td style={td}>{moneyF(m.fonds_secours_paye)}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{moneyF(rowTotal)}</td>
                    </tr>
                  );
                })}
                {(() => {
                  const colInscription = visibleMembers.reduce((s, m) => s + Number(m.inscription_paye || 0), 0);
                  const colTontine = visibleMembers.reduce((s, m) => s + tontineTotal(m.id), 0);
                  const colCollation = visibleMembers.reduce((s, m) => s + collationTotalMois(m.id), 0);
                  const colUrgence = visibleMembers.reduce((s, m) => s + Number(m.fonds_urgence_paye || 0), 0);
                  const colSecours = visibleMembers.reduce((s, m) => s + Number(m.fonds_secours_paye || 0), 0);
                  const grandTotal = colInscription + colTontine + colCollation + colUrgence + colSecours;
                  return (
                    <tr>
                      <td style={{ ...td, fontWeight: 700, background: TEAL_LIGHT }}>{t("tont_col_total")}</td>
                      <td style={{ ...td, background: TEAL_LIGHT }}></td>
                      <td style={{ ...td, fontWeight: 700, background: TEAL_LIGHT }}>{moneyF(colInscription)}</td>
                      <td style={{ ...td, fontWeight: 700, background: TEAL_LIGHT }}>{moneyF(colTontine)}</td>
                      <td style={{ ...td, fontWeight: 700, background: TEAL_LIGHT }}>{moneyF(colCollation)}</td>
                      <td style={{ ...td, fontWeight: 700, background: TEAL_LIGHT }}>{moneyF(colUrgence)}</td>
                      <td style={{ ...td, fontWeight: 700, background: TEAL_LIGHT }}>{moneyF(colSecours)}</td>
                      <td style={{ ...td, fontWeight: 700, background: TEAL_LIGHT }}>{moneyF(grandTotal)}</td>
                    </tr>
                  );
                })()}
              </Table>
            </>
          )}
        </Section></Container>
      )}

      {/* ================= ADHÉRENTS ================= */}
   {tab === "membres" && isBureau && (
        <Container><Section>
          <h2 style={{ marginBottom: 20 }}>{t("mem_title")}</h2>

          <Card style={{ marginBottom: 22 }}>
            <h3 style={{ fontSize: 14, marginBottom: 14 }}>{t("mem_add_title")}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 14 }}>
              <Field label={t("mem_fullname")}><input style={inputStyle} value={newMemberForm.nom} onChange={(e) => setNewMemberForm({ ...newMemberForm, nom: e.target.value })} /></Field>
              <Field label={t("mem_email")}><input style={inputStyle} value={newMemberForm.email} onChange={(e) => setNewMemberForm({ ...newMemberForm, email: e.target.value })} /></Field>
              <Field label={t("mem_phone")}><input type="tel" style={inputStyle} value={newMemberForm.telephone} onChange={(e) => setNewMemberForm({ ...newMemberForm, telephone: e.target.value })} placeholder={t("mem_phone_placeholder")} /></Field>
              <Field label={t("mem_sexe")}>
                <select style={inputStyle} value={newMemberForm.sexe} onChange={(e) => setNewMemberForm({ ...newMemberForm, sexe: e.target.value })}>
                  <option value="">{t("mem_sexe_placeholder")}</option>
                  <option value="M">{t("mem_sexe_m")}</option>
                  <option value="F">{t("mem_sexe_f")}</option>
                </select>
              </Field>
              <Field label={t("mem_join_date")}><input type="date" style={inputStyle} value={newMemberForm.dateAdhesion} onChange={(e) => setNewMemberForm({ ...newMemberForm, dateAdhesion: e.target.value })} /></Field>
              <Field label={t("mem_status")}>
                <select style={inputStyle} value={newMemberForm.statut} onChange={(e) => setNewMemberForm({ ...newMemberForm, statut: e.target.value })}>
                  <option>{t("mem_active")}</option><option>{t("mem_inactive")}</option>
                </select>
              </Field>
              <Field label={t("mem_birthdate")}><input type="date" style={inputStyle} value={newMemberForm.dateNaissance} onChange={(e) => setNewMemberForm((p) => ({ ...p, dateNaissance: e.target.value }))} /></Field>
              <Field label={t("mem_address")}><input style={inputStyle} value={newMemberForm.quartier} onChange={(e) => setNewMemberForm((p) => ({ ...p, quartier: e.target.value }))} /></Field>
              <Field label={t("mem_skills")}><input style={inputStyle} value={newMemberForm.competences} onChange={(e) => setNewMemberForm((p) => ({ ...p, competences: e.target.value }))} placeholder={t("mem_skills_placeholder")} /></Field>
              <Field label={t("mem_volunteer")}>
                <select style={inputStyle} value={newMemberForm.disponibleBenevolat ? "oui" : "non"} onChange={(e) => setNewMemberForm((p) => ({ ...p, disponibleBenevolat: e.target.value === "oui" }))}><option value="non">{t("mem_no")}</option><option value="oui">{t("mem_yes")}</option></select>
              </Field>
            </div>
            <Btn onClick={handleAddMember}><Plus size={15} /> {t("mem_add_btn")}</Btn>
          </Card>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>{showArchived ? t("mem_archived_title") : t("mem_title")}</h3>
            <Btn variant="outline" onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? t("mem_view_active") : t("mem_view_archives")}
            </Btn>
          </div>

          <Table head={showArchived
            ? [t("mem_col_name"), t("mem_email"), t("mem_phone"), t("mem_sexe"), t("mem_col_join"), t("mem_birthdate"), t("mem_col_delete_date"), t("mem_col_action")]
            : [t("mem_col_name"), t("mem_email"), t("mem_phone"), t("mem_sexe"), t("mem_col_join"), t("mem_birthdate"), t("mem_status"), t("mem_col_action")]}>
            {members.filter((m) => showArchived ? m.statut === "Supprimé" : m.statut !== "Supprimé").map((m) => (
              <tr key={m.id}>
                <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>
                  {showArchived ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => { setHistoryMemberId(m.id); setHistoryFundFilter("adhesion"); }}>{m.nom}</span>
                      <button onClick={() => setFullProfileMemberId(m.id)} title={t("mem_view_full_profile")} style={{ background: "none", border: "none", cursor: "pointer", color: "#686F7D", display: "flex", flexShrink: 0 }}>
                        <Wallet size={14} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ cursor: "pointer", textDecoration: "underline" }} title={t("mem_edit_title")} onClick={() => setEditMemberId(m.id)}>{m.nom}</span>
                      <button onClick={() => { setHistoryMemberId(m.id); setHistoryFundFilter("adhesion"); }} title={t("mem_view_history")} style={{ background: "none", border: "none", cursor: "pointer", color: "#686F7D", display: "flex", flexShrink: 0 }}>
                        <History size={14} />
                      </button>
                      <button onClick={() => setFullProfileMemberId(m.id)} title={t("mem_view_full_profile")} style={{ background: "none", border: "none", cursor: "pointer", color: "#686F7D", display: "flex", flexShrink: 0 }}>
                        <Wallet size={14} />
                      </button>
                    </div>
                  )}
                </td>
                <td style={td}>{m.email}</td>
                <td style={td}>{m.telephone || "—"}</td>
                <td style={td}>{sexeLabel(m.sexe, t)}</td>
                <td style={td}>{m.date_adhesion}</td>
                <td style={td}>{m.date_naissance || "—"}</td>
                {showArchived ? (
                  <td style={td}>{m.date_desactivation || "—"}</td>
                ) : (
                  <td style={td}>
                    <span style={{ display: "inline-block", padding: "6px 10px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: m.statut === "Actif" ? TEAL : "#8A5A00", background: m.statut === "Actif" ? TEAL_LIGHT : "#FBF3D9", border: `1.5px solid ${m.statut === "Actif" ? TEAL : "#D9B84A"}` }}>
                      {m.statut === "Actif" ? t("mem_active") : t("mem_inactive")}
                    </span>
                  </td>
                )}
                <td style={td}>
                  {showArchived ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Btn onClick={() => { if (window.confirm(t("mem_reactivate_btn") + " " + m.nom + " ?")) reactivateMember(m.id); }} style={{ background: TEAL }}>{t("mem_reactivate_btn")}</Btn>
                      <button
                        onClick={() => { if (window.confirm(t("mem_confirm_delete_permanent").replace("{nom}", m.nom))) permanentlyDeleteMember(m.id); }}
                        title={t("mem_delete_permanent_btn")}
                        style={{ fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "5px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <Trash2 size={12} /> {t("mem_delete_permanent_btn")}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <select value={deleteMotifs[m.id] || ""} onChange={(e) => setDeleteMotifs((p) => ({ ...p, [m.id]: e.target.value }))} style={{ ...inputStyle, fontSize: 11, padding: "4px 6px", width: 140, border: deleteMotifs[m.id] ? inputStyle.border : "1.5px solid " + RED }}>
                        <option value="">{t("mem_motif_placeholder")}</option>
                        <option value="demission">{t("mem_motif_resign")}</option>
                        <option value="deces">{t("mem_motif_death")}</option>
                        <option value="demenagement">{t("mem_motif_move")}</option>
                        <option value="non_paiement">{t("mem_motif_unpaid")}</option>
                        <option value="exclusion">{t("mem_motif_exclusion")}</option>
                        <option value="autre">{t("mem_motif_other")}</option>
                      </select>
                      <button
                        disabled={!deleteMotifs[m.id]}
                        onClick={() => { if (!deleteMotifs[m.id]) return; if (window.confirm(t("mem_delete_btn") + " " + m.nom + " ?")) handleDeleteMember(m.id, deleteMotifs[m.id]); }}
                        title={deleteMotifs[m.id] ? t("mem_delete_btn") : t("mem_motif_required")}
                        style={{ background: "none", border: "1px solid #DDD", borderRadius: 6, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: deleteMotifs[m.id] ? "pointer" : "not-allowed", color: RED, opacity: deleteMotifs[m.id] ? 1 : 0.35 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Section></Container>
      )}

      {/* ================= FICHE INSCRIPTION ================= */}
      {tab === "inscription" && (isBureau || (isResponsable && profile.rubrique_assignee === "inscription")) && (
        <Container><Section>
          <h2 style={{ marginBottom: 14 }}>{t("insc_title")}</h2>
          <RuleBox>{t("insc_rule").replace("{montant}", moneyF(inscriptionMontant))}</RuleBox>
          {!canEditRubrique("inscription") && <Banner>{t("readonly_msg")}</Banner>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, margin: "16px 0" }}>
            <StatCard label={t("insc_total_due")} value={moneyF(inscriptionTotalDu)} />
            <StatCard label={t("insc_total_paid")} value={moneyF(inscriptionTotalPaye)} accent={TEAL} />
            <StatCard label={t("insc_balance_pending")} value={moneyF(inscriptionTotalDu - inscriptionTotalPaye)} accent={RED} />
          </div>
          <Table head={[t("member"), t("insc_col_due"), t("fonds_col_paid"), t("insc_col_pay_date"), t("insc_col_balance")]}>
            {visibleMembers.map((m) => {
              const paye = Number(m.inscription_paye || 0);
              const solde = inscriptionMontant - paye;
              return (
                <tr key={m.id}>
                  <td style={{ ...td, fontWeight: 600, color: "var(--primary)", cursor: "pointer", textDecoration: "underline" }} onClick={() => { setHistoryMemberId(m.id); setHistoryFundFilter(null); }}>{m.nom}</td>
                  <td style={td}>{moneyF(inscriptionMontant)}</td>
                  <td style={td}><input type="number" disabled={!canEditRubrique("inscription")} defaultValue={m.inscription_paye} onBlur={(e) => patchMember(m.id, { inscription_paye: Number(e.target.value) })} style={{ ...inputStyle, width: 90, padding: "4px 8px" }} /></td>
                  <td style={td}><input type="date" disabled={!canEditRubrique("inscription")} defaultValue={m.inscription_date || ""} onBlur={(e) => patchMember(m.id, { inscription_date: e.target.value || null })} style={{ ...inputStyle, width: 140, padding: "4px 8px" }} /></td>
                  <td style={{ ...td, color: solde > 0 ? RED : TEAL, fontWeight: 700 }}>{moneyF(solde)}</td>
                </tr>
              );
            })}
            {visibleMembers.length === 0 && <tr><td colSpan={5} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
          </Table>
        </Section></Container>
      )}

      {/* ================= FICHE TONTINE ================= */}
      {tab === "tontine" && (isBureau || (isResponsable && profile.rubrique_assignee === "tontine")) && (
        <Container><Section>
          <h2 style={{ marginBottom: 14 }}>{t("tont_title")}</h2>
          <RuleBox>{t("tont_rule").replace("{montant}", moneyF(tontineMontantSeance))}</RuleBox>
          {!canEditRubrique("tontine") && <Banner>{t("readonly_msg")}</Banner>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, margin: "16px 0" }}>
            <StatCard label={t("tont_col_total")} value={moneyF(tontineTotalVerse)} accent={TEAL} />
          </div>
          <div className="table-scroll" style={{ overflowX: "auto", borderRadius: 12, boxShadow: "0 4px 18px rgba(31,56,100,0.08)", marginBottom: 24 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>
                <th style={{ background: "var(--primary)", color: "white", padding: "6px 10px", position: "sticky", left: 0 }}>{t("member")}</th>
                {SEANCES.map((s) => <th key={s} style={{ background: "var(--primary)", color: "white", padding: "6px 6px", textAlign: "center" }}>{s}</th>)}
                <th style={{ background: "var(--primary)", color: "white", padding: "6px 10px" }}>{t("tont_col_total")}</th>
              </tr></thead>
              <tbody>
                {visibleMembers.map((m) => (
                  <tr key={m.id}>
                    <td style={{ ...td, fontWeight: 600, color: "var(--primary)", position: "sticky", left: 0, background: "white" }}>{m.nom}</td>
                    {SEANCES.map((s) => (
                      <td key={s} style={{ ...td, textAlign: "center" }}>
                        <input type="number" disabled={!canEditRubrique("tontine")} defaultValue={tontineMontant(m.id, s) || ""} placeholder="0" onBlur={(e) => saveTontineMontant(m.id, s, Number(e.target.value) || 0)} style={{ ...inputStyle, width: 60, padding: "3px 4px", fontSize: 11, textAlign: "center" }} />
                      </td>
                    ))}
                    <td style={{ ...td, fontWeight: 700 }}>{moneyF(tontineTotal(m.id))}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 700, position: "sticky", left: 0, background: TEAL_LIGHT }}>{t("tont_col_total")}</td>
                  {SEANCES.map((s) => (
                    <td key={s} style={{ ...td, textAlign: "center", fontWeight: 700, background: TEAL_LIGHT }}>{moneyF(tontineSeanceTotal(s))}</td>
                  ))}
                  <td style={{ ...td, fontWeight: 700, background: TEAL_LIGHT }}>{moneyF(tontineTotalVerse)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {canEditRubrique("tontine") && (
            <Card style={{ marginBottom: 22, maxWidth: 520 }}>
              <h3 style={{ fontSize: 14, marginBottom: 12 }}>{t("tont_assign_title")}</h3>
              <Field label={t("tont_seance_no")}><input type="number" style={inputStyle} value={newSeance.numero} onChange={(e) => setNewSeance({ ...newSeance, numero: Number(e.target.value) })} /></Field>
              <Field label={t("date")}><input type="date" style={inputStyle} value={newSeance.date} onChange={(e) => setNewSeance({ ...newSeance, date: e.target.value })} /></Field>
              <Field label={t("tont_beneficiary")}>
                <select style={inputStyle} value={newSeance.beneficiaireId} onChange={(e) => setNewSeance({ ...newSeance, beneficiaireId: e.target.value })}>
                  <option value="">{t("tont_choose")}</option>
                  {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                </select>
                {tirageSuggestion && (
                  <p style={{ fontSize: 12, color: "#686F7D", margin: "6px 0 0" }}>
                    🎲 {t("tont_draw_hint").replace("{titre}", ordreTontine.titre).replace("{numero}", String(newSeance.numero)).replace("{nom}", tirageSuggestion.nom)}
                  </p>
                )}
              </Field>
              <Field label={t("tont_discharge_signed")}>
                <select style={inputStyle} value={newSeance.dechargeSignee ? "oui" : "non"} onChange={(e) => setNewSeance({ ...newSeance, dechargeSignee: e.target.value === "oui" })}>
                  <option value="non">{t("mem_no")}</option><option value="oui">{t("mem_yes")}</option>
                </select>
              </Field>
              <Btn onClick={addSeance}><Plus size={14} /> {t("tont_assign_btn")}</Btn>
            </Card>
          )}

          <Table head={[t("tont_col_seance"), t("tont_col_contributors"), t("tont_col_pot"), t("tont_beneficiary"), t("tont_col_date_reception"), t("tont_col_discharge"), t("tont_versement_col"), t("tont_col_actions")]}>
            {tontineSeances.map((s) => {
              const ben = members.find((mm) => mm.id === s.beneficiaire_id);
              return (
                <tr key={s.id}>
                  <td style={td}>{s.numero}</td>
                  <td style={td}>{s.nb_contrib}</td>
                  <td style={td}>{moneyF(tontineSeanceTotal(s.numero))}</td>
                  <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>{ben ? ben.nom : "—"}</td>
                  <td style={td}>{s.date_decharge || "—"}</td>
                  <td style={{ ...td, color: s.decharge_signee ? TEAL : RED, fontWeight: 700 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>{s.decharge_signee ? t("tont_signed") : t("tont_pending")}</span>
                      {ben && (
                        <button onClick={() => setDechargeSeanceId(s.id)} style={{ fontSize: 11, fontWeight: 600, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <FileText size={11} /> {t("tont_decharge_btn")}
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{ ...td, color: s.versement_methode ? TEAL : (ben ? RED : "#686F7D"), fontWeight: 700 }}>
                    {!ben ? "—" : (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span>{s.versement_methode ? `${t("tont_versement_paid_badge")} — ${t("tont_versement_method_" + s.versement_methode)}` : t("tont_versement_pending_badge")}</span>
                        {s.versement_preuve_path && (
                          <button onClick={() => voirPreuveVersement(s)} style={{ fontSize: 11, fontWeight: 600, color: "var(--primary)", background: "none", border: "1px solid var(--primary)", borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <FileText size={11} /> {t("tont_versement_view_proof")}
                          </button>
                        )}
                        {canEditRubrique("tontine") && (
                          <button onClick={() => setVersementSeanceId(s.id)} style={{ fontSize: 11, fontWeight: 600, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <CreditCard size={11} /> {s.versement_methode ? t("tont_versement_edit_btn") : t("tont_versement_btn")}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    {canEditRubrique("tontine") && (
                      <button onClick={() => deleteSeance(s.id, "tontine")} style={{ fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Trash2 size={11} /> {t("tont_delete_btn")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {tontineSeances.length === 0 && <tr><td colSpan={8} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
          </Table>
        </Section></Container>
      )}

      {/* ================= FICHE COLLATION ================= */}
      {tab === "collation" && (isBureau || (isResponsable && profile.rubrique_assignee === "collation")) && (
        <Container><Section>
          <h2 style={{ marginBottom: 14 }}>{t("collation_title")}</h2>
          <RuleBox>{t("collation_rule").replace("{montant}", moneyF(COLLATION_MENSUEL))}</RuleBox>
          {frequenceReunions !== "mois" && <p style={{ fontSize: 11.5, color: "#888", marginTop: -10, marginBottom: 14 }}>{t("collation_freq_note").replace("{n}", periodKeys.length)}</p>}
          {!canEditRubrique("collation") && <Banner>{t("readonly_msg")}</Banner>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, margin: "16px 0" }}>
            <StatCard label={t("collation_total_due")} value={moneyF(collationTotalDu)} />
           <StatCard label={t("collation_total_paid")} value={moneyF(collationTotalPaye)} accent={TEAL} />
            <StatCard label={t("collation_balance")} value={moneyF(collationTotalDu - collationTotalPaye)} accent={RED} />
          </div>
          <div className="table-scroll" style={{ overflowX: "auto", borderRadius: 12, boxShadow: "0 4px 18px rgba(31,56,100,0.08)" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>
               <th style={{ background: "var(--primary)", color: "white", padding: "6px 10px", position: "sticky", left: 0 }}>{t("member")}</th>
               {periodKeys.map((pk, i) => <th key={pk} style={{ background: "var(--primary)", color: "white", padding: "6px 6px", textAlign: "center" }}>{frequenceReunions === "mois" ? t(MONTH_KEYS[i]) : pk}</th>)}
                <th style={{ background: "var(--primary)", color: "white", padding: "6px 10px" }}>{t("collation_col_due")}</th>
<th style={{ background: "var(--primary)", color: "white", padding: "6px 10px" }}>{t("collation_col_paid")}</th>
<th style={{ background: "var(--primary)", color: "white", padding: "6px 10px" }}>{t("collation_col_balance")}</th>
              </tr></thead>
              <tbody>
                {visibleMembers.map((m) => {
                  const du = collationDu(m.id); const paye = collationTotalMois(m.id); const solde = du - paye;
                  return (
                    <tr key={m.id}>
                      <td style={{ ...td, fontWeight: 600, color: "var(--primary)", position: "sticky", left: 0, background: "white" }}>{m.nom}</td>
                      {periodKeys.map((mo, iMo) => (
                        <td key={mo} style={{ ...td, textAlign: "center", ...(iMo < premierePeriodeDue(m.id) ? { background: "#F1F2F4", opacity: 0.55 } : {}) }} title={iMo < premierePeriodeDue(m.id) ? t("presence_avant_adhesion") : undefined}>
                          <input type="number" disabled={!canEditRubrique("collation")} defaultValue={collationMontant(m.id, mo) || ""} placeholder="0" onBlur={(e) => saveCollationMontant(m.id, mo, Number(e.target.value) || 0)} style={{ ...inputStyle, width: 55, padding: "3px 4px", fontSize: 11, textAlign: "center" }} />
                        </td>
                      ))}
                      <td style={td}>{moneyF(du)}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{moneyF(paye)}</td>
                      <td style={{ ...td, color: solde > 0 ? RED : TEAL, fontWeight: 700 }}>{moneyF(solde)}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ ...td, fontWeight: 700, position: "sticky", left: 0, background: TEAL_LIGHT }}>{t("tont_col_total")}</td>
                  {periodKeys.map((mo) => (
                    <td key={mo} style={{ ...td, textAlign: "center", fontWeight: 700, background: TEAL_LIGHT }}>{moneyF(collationMoisTotal(mo))}</td>
                  ))}
                  <td style={{ ...td, fontWeight: 700, background: TEAL_LIGHT }}>{moneyF(collationTotalDu)}</td>
                  <td style={{ ...td, fontWeight: 700, background: TEAL_LIGHT }}>{moneyF(collationTotalPaye)}</td>
                  <td style={{ ...td, fontWeight: 700, background: TEAL_LIGHT }}>{moneyF(collationTotalDu - collationTotalPaye)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {canEditRubrique("collation") && collationMoisDisponibles.length > 0 && (
            <Card style={{ marginBottom: 22, maxWidth: 520, marginTop: 24 }}>
              <h3 style={{ fontSize: 14, marginBottom: 12 }}>{t("coll_assign_title")}</h3>
              <Field label={t("coll_col_mois")}>
                <select style={inputStyle} value={newCollAttrib.mois} onChange={(e) => setNewCollAttrib({ ...newCollAttrib, mois: e.target.value })}>
                  {collationMoisDisponibles.map((mo) => <option key={mo} value={mo}>{frequenceReunions === "mois" ? t(MONTH_KEYS[MONTHS.indexOf(mo)]) : mo}</option>)}
                </select>
              </Field>
              <Field label={t("date")}><input type="date" style={inputStyle} value={newCollAttrib.date} onChange={(e) => setNewCollAttrib({ ...newCollAttrib, date: e.target.value })} /></Field>
              <Field label={t("tont_beneficiary")}>
                <select style={inputStyle} value={newCollAttrib.beneficiaireId} onChange={(e) => setNewCollAttrib({ ...newCollAttrib, beneficiaireId: e.target.value })}>
                  <option value="">{t("tont_choose")}</option>
                  {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                </select>
              </Field>
              <Field label={t("tont_discharge_signed")}>
                <select style={inputStyle} value={newCollAttrib.dechargeSignee ? "oui" : "non"} onChange={(e) => setNewCollAttrib({ ...newCollAttrib, dechargeSignee: e.target.value === "oui" })}>
                  <option value="non">{t("mem_no")}</option><option value="oui">{t("mem_yes")}</option>
                </select>
              </Field>
              <Btn onClick={addCollationAttribution}><Plus size={14} /> {t("tont_assign_btn")}</Btn>
            </Card>
          )}
          {canEditRubrique("collation") && collationMoisDisponibles.length === 0 && (
            <Banner tone="warn">{t("coll_all_months_taken")}</Banner>
          )}

          <Table head={[t("coll_col_mois"), t("tont_col_contributors"), t("tont_col_pot"), t("tont_beneficiary"), t("tont_col_date_reception"), t("tont_col_discharge"), t("tont_versement_col"), t("tont_col_actions")]}>
            {collationSeances.map((s) => {
              const ben = members.find((mm) => mm.id === s.beneficiaire_id);
              return (
                <tr key={s.id}>
                  <td style={td}>{s.mois}</td>
                  <td style={td}>{s.nb_contrib}</td>
                  <td style={td}>{moneyF(collationMoisTotal(s.mois))}</td>
                  <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>{ben ? ben.nom : "—"}</td>
                  <td style={td}>{s.date_decharge || "—"}</td>
                  <td style={{ ...td, color: s.decharge_signee ? TEAL : RED, fontWeight: 700 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>{s.decharge_signee ? t("tont_signed") : t("tont_pending")}</span>
                      {ben && (
                        <button onClick={() => setDechargeSeanceId(s.id)} style={{ fontSize: 11, fontWeight: 600, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <FileText size={11} /> {t("tont_decharge_btn")}
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{ ...td, color: s.versement_methode ? TEAL : (ben ? RED : "#686F7D"), fontWeight: 700 }}>
                    {!ben ? "—" : (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span>{s.versement_methode ? `${t("tont_versement_paid_badge")} — ${t("tont_versement_method_" + s.versement_methode)}` : t("tont_versement_pending_badge")}</span>
                        {s.versement_preuve_path && (
                          <button onClick={() => voirPreuveVersement(s)} style={{ fontSize: 11, fontWeight: 600, color: "var(--primary)", background: "none", border: "1px solid var(--primary)", borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <FileText size={11} /> {t("tont_versement_view_proof")}
                          </button>
                        )}
                        {canEditRubrique("collation") && (
                          <button onClick={() => setVersementSeanceId(s.id)} style={{ fontSize: 11, fontWeight: 600, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <CreditCard size={11} /> {s.versement_methode ? t("tont_versement_edit_btn") : t("tont_versement_btn")}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    {canEditRubrique("collation") && (
                      <button onClick={() => deleteSeance(s.id, "collation")} style={{ fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Trash2 size={11} /> {t("tont_delete_btn")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {collationSeances.length === 0 && <tr><td colSpan={8} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
          </Table>
        </Section></Container>
      )}

      {/* ================= FICHES FONDS ================= */}
      {(tab === "urgence" || tab === "secours") && (isBureau || (isResponsable && profile.rubrique_assignee === (tab === "urgence" ? "fonds_urgence" : "fonds_secours"))) && (() => {
        const isUrgence = tab === "urgence";
        const fondsCode = isUrgence ? "urgence" : "secours";
        const memberKey = isUrgence ? "fonds_urgence" : "fonds_secours";
        const montantFixe = isUrgence ? fondsUrgenceMontant : fondsSecoursMontant;
        const draft = isUrgence ? fuDraft : fsDraft;
        const setDraft = isUrgence ? setFuDraft : setFsDraft;
        const quotePart = isUrgence ? fuQuotePart : fsQuotePart;
        const depenses = isUrgence ? fuDepenses : fsDepenses;
        const recouvrements = isUrgence ? fuRecouvrements : fsRecouvrements;
        const solde = isUrgence ? fuSolde : fsSolde;
        const editable = canEditRubrique(memberKey);
        const totalContribPaye = members.reduce((s, m) => s + Number(m[memberKey + "_paye"] || 0), 0);
        const nbBeneficiaires = isUrgence ? nbActifs : nbEligiblesSecours;
        return (
          <Container><Section>
           <h2 style={{ marginBottom: 14 }}>{isUrgence ? t("fonds_urgence_title") : t("fonds_secours_title")}</h2>
            <RuleBox>{(isUrgence ? t("fonds_urgence_rule") : t("fonds_secours_rule")).replace("{montant}", moneyF(montantFixe))}</RuleBox>
            {!isUrgence && <p style={{ fontSize: 12, color: "#888", marginTop: -6, marginBottom: 14 }}>{t("fonds_secours_probation_note").replace("{count}", nbBeneficiaires).replace("{total}", nbActifs)}</p>}
            {!editable && <Banner>{t("readonly_msg")}</Banner>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, margin: "16px 0" }}>
             <StatCard label={t("fonds_contrib_received")} value={moneyF(totalContribPaye)} accent={TEAL} />
             <StatCard label={t("fonds_total_expenses")} value={moneyF(depenses.reduce((s, d) => s + Number(d.montant), 0))} accent={RED} />
             <StatCard label={t("fonds_balance")} value={moneyF(solde)} accent={solde < 0 ? RED : undefined} />
            </div>
            <Table head={[t("member"), t("fonds_col_due"), t("fonds_col_paid"), t("fonds_col_status"), t("fonds_col_pay_date"), t("fonds_col_balance")]}>
              {visibleMembers.map((m) => {
                const paye = Number(m[memberKey + "_paye"] || 0);
                const s = montantFixe - paye;
                return (
                  <tr key={m.id}>
                   <td style={{ ...td, fontWeight: 600, color: "var(--primary)", cursor: "pointer", textDecoration: "underline" }} onClick={() => { setHistoryMemberId(m.id); setHistoryFundFilter(fondsCode); }}>{m.nom}</td>
                    <td style={td}>{moneyF(montantFixe)}</td>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 700 }}>{moneyF(paye)}</span>
                        {editable && (
                          <button onClick={() => setEditFondsPaiement({ fonds: fondsCode, memberId: m.id })} style={{ background: "none", border: "none", cursor: "pointer", color: "#686F7D", padding: 2, display: "inline-flex" }} aria-label={t("action_edit")} title={t("fonds_edit_payment_title")}>
                            <Pencil size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={td}>
                      {paye >= montantFixe - 0.005
                        ? <span style={{ color: TEAL, fontWeight: 700 }}>{t("paid")}</span>
                        : paye > 0
                        ? <span style={{ color: AMBER, fontWeight: 700 }}>{t("fonds_status_avance")}</span>
                        : <span style={{ color: RED, fontWeight: 700 }}>{t("unpaid")}</span>}
                    </td>
                    <td style={td}><input type="date" disabled={!editable} defaultValue={m[memberKey + "_date_paiement"] || ""} onBlur={(e) => patchMember(m.id, { [memberKey + "_date_paiement"]: e.target.value || null })} style={{ ...inputStyle, padding: "4px 8px" }} /></td>
                    <td style={{ ...td, color: s > 0 ? RED : TEAL, fontWeight: 700 }}>{moneyF(s)}</td>
                  </tr>
                );
              })}
            </Table>
            {editable && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 22, marginTop: 22 }}>
                <Card>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>{t("fonds_expense_title")}</h3>
                  <Field label={t("date")}><input type="date" style={inputStyle} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
                  <Field label={t("description")}><input style={inputStyle} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
                 <Field label={t("fonds_amount_total")}><input type="number" style={inputStyle} value={draft.montant} onChange={(e) => setDraft({ ...draft, montant: e.target.value })} /></Field>
                  <div style={{ background: TEAL_LIGHT, borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 12.5 }}>{t("fonds_quote_part")} ({nbBeneficiaires}) : <b>{moneyF(quotePart)}</b></div>
                 <Btn onClick={() => enregistrerDepense(fondsCode)}><Plus size={15} /> {t("fonds_register_btn")}</Btn>
                </Card>
               <Table head={[t("fonds_col_date"), t("fonds_col_description"), t("fonds_col_amount"), t("fonds_col_quotepart"), t("fonds_col_actions")]}>
                  {depenses.map((d) => (
                    <tr key={d.id}>
                      <td style={td}>{d.date}</td><td style={td}>{d.description}</td><td style={td}>{moneyF(d.montant)}</td><td style={td}>{moneyF(d.montant / Math.max(d.nb_actifs_snapshot || nbActifs, 1))}</td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => setEditDepense({ fonds: fondsCode, depenseId: d.id })} style={{ fontSize: 11, fontWeight: 600, color: "var(--primary)", background: "none", border: "1px solid var(--primary)", borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                            <Pencil size={11} /> {t("action_edit")}
                          </button>
                          <button onClick={() => supprimerDepense(fondsCode, d.id)} style={{ fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                            <Trash2 size={11} /> {t("fonds_delete_btn")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {depenses.length === 0 && <tr><td colSpan={5} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
                </Table>
              </div>
            )}
           <h3 style={{ fontSize: 14, margin: "22px 0 10px" }}>{t("fonds_recovery_title")}</h3>
            {(() => {
              const parMembre = {};
              recouvrements.forEach((r) => {
                if (!parMembre[r.member_id]) parMembre[r.member_id] = { memberId: r.member_id, totalDu: 0, totalPaye: 0 };
                parMembre[r.member_id].totalDu += Number(r.quote_part) || 0;
                if (r.paye) parMembre[r.member_id].totalPaye += Number(r.quote_part) || 0;
              });
              const lignes = Object.values(parMembre);
              return (
                <Table head={[t("member"), t("fonds_col_quotepart"), t("fonds_col_paid"), t("fonds_col_status"), t("fonds_col_balance")]}>
                  {lignes.map(({ memberId, totalDu, totalPaye }) => {
                    const m = members.find((mm) => mm.id === memberId);
                    const soldeR = totalDu - totalPaye;
                    return (
                      <tr key={memberId}>
                        <td style={{ ...td, fontWeight: 600, color: "var(--primary)", cursor: "pointer", textDecoration: "underline" }} onClick={() => { setRecouvHistoryMemberId(memberId); setRecouvHistoryFund(fondsCode); }}>{m ? m.nom : "—"}</td>
                        <td style={td}>{moneyF(totalDu)}</td>
                        <td style={td}>{moneyF(totalPaye)}</td>
                        <td style={td}>
                          {soldeR <= 0.005
                            ? <span style={{ color: TEAL, fontWeight: 700 }}>{t("paid")}</span>
                            : totalPaye > 0
                            ? <span style={{ color: AMBER, fontWeight: 700 }}>{t("fonds_status_avance")}</span>
                            : <span style={{ color: RED, fontWeight: 700 }}>{t("unpaid")}</span>}
                        </td>
                        <td style={{ ...td, color: soldeR > 0.005 ? RED : TEAL, fontWeight: 700 }}>{moneyF(soldeR)}</td>
                      </tr>
                    );
                  })}
                  {lignes.length === 0 && <tr><td colSpan={5} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
                </Table>
              );
            })()}
          </Section></Container>
        );
      })()}

      {/* ================= ÉTATS FINANCIERS (+ impression) =================
          Suite 88 (2026-09-28) — mise en page à l'impression revue à la
          demande de l'utilisateur. Décisions confirmées via AskUserQuestion :
          (1) l'impression du système comptable professionnel (Bilan/État des
          résultats/Évolution, dans `Comptabilite.jsx`) devient sélectionnable
          (un état, plusieurs, ou les trois) plutôt que limitée à l'onglet
          actif — voir le bloc `.print-only` dans `Comptabilite.jsx`, qui
          possède maintenant son propre bouton « Imprimer » ; (2) les cartes
          « simplifiées » ci-dessous et les graphiques de FinanceSynthese
          restent visibles à l'écran mais sont exclus de l'impression
          (`no-print`) — redondants avec les états officiels désormais
          imprimables ; (3) l'historique détaillé des paiements est lui aussi
          exclu de l'impression (`no-print`) — un registre de transactions
          brut, pas un état financier. */}
      {tab === "finances" && isBureau && (
        <Container><Section>
          <h2 style={{ marginBottom: 20 }} className="no-print">{t("fin_title")}</h2>
          <div id="printable-bilan">
            <h3 style={{ marginBottom: 4 }}>{association?.nom}</h3>
            <OrgLegalSubline association={association} />
            <p style={{ fontSize: 12, color: "#686F7D", marginBottom: 16 }}>{t("fin_edited_on")} {new Date().toLocaleDateString("fr-CA")}</p>
          </div>
          <div className="no-print">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
              <Card>
                <h3 style={{ fontSize: 15, marginBottom: 12 }}>{t("fin_income_statement")}</h3>
               {revenueBreakdown.map((it) => <div key={it.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span>{it.label}</span><span>{moneyF(it.value)}</span></div>)}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, borderTop: "1px solid #DDD", marginTop: 6, paddingTop: 6 }}><span>{t("fin_total_revenue")}</span><span>{moneyF(totalRevenusHorsTontine)}</span></div>
                {expenseBreakdown.map((it, i) => <div key={it.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: i === 0 ? "10px 0 4px" : "4px 0", color: RED }}><span>{it.label}</span><span>{moneyF(it.value)}</span></div>)}
               <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, background: TEAL_LIGHT, marginTop: 10, padding: 10, borderRadius: 8 }}><span>{t("fin_surplus")}</span><span>{moneyF(excedent)}</span></div>
              </Card>
              <Card>
                <h3 style={{ fontSize: 15, marginBottom: 12 }}>{t("fin_balance_sheet")}</h3>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span>{t("fin_balance_urgence")}</span><span>{moneyF(fuSolde)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span>{t("fin_balance_secours")}</span><span>{moneyF(fsSolde)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span>{t("fin_general_fund")}</span><span>{moneyF(generalFund)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, borderTop: "1px solid #DDD", marginTop: 6, paddingTop: 6 }}><span>{t("fin_total_equity")}</span><span>{moneyF(excedent)}</span></div>
              </Card>
            </div>
            <FinanceSynthese
              t={t} lang={lang} moneyF={moneyF}
              revenueBreakdown={revenueBreakdown} expenseBreakdown={expenseBreakdown}
              totalRevenus={totalRevenusHorsTontine} totalDepenses={totalDepenses} excedent={excedent}
              fuSolde={fuSolde} fsSolde={fsSolde} generalFund={generalFund}
              contribUrgencePaye={revenueBreakdown.find((i) => i.key === "contrib_urgence")?.value || 0}
              contribUrgenceDue={25 * nbActifs}
              contribSecoursPaye={revenueBreakdown.find((i) => i.key === "contrib_secours")?.value || 0}
              contribSecoursDue={200 * nbActifs}
              nbActifs={nbActifs}
            />
          </div>
          {isPremiumPlan
            ? <Comptabilite moneyF={moneyF} association={association} isPresident={isPresident} onAssociationChange={onAssociationChange} />
            : <PremiumLocked compact label={t("comptabilite_premium_label")} onUpgrade={goToForfait} features={[t("premium_feat_comptabilite_1"), t("premium_feat_comptabilite_2"), t("premium_feat_comptabilite_3")]} />}
          <div className="no-print">
            <PaymentHistory activityLog={activityLog} members={visibleMembers} depenseFondsMap={depenseFondsMap} t={t} lang={lang} moneyF={moneyF} />
          </div>
        </Section></Container>
      )}

      {/* ================= DOCUMENTS — banque d'archives organisée par section ================= */}
      {tab === "documents" && (isBureau || isResponsable) && (() => {
        const filteredDocuments = documents
          .filter((d) => docCategoryFilter === "all" || d.rubrique === docCategoryFilter)
          .filter((d) => !docSearch || d.nom.toLowerCase().includes(docSearch.toLowerCase()));
        return (
        <Container><Section>
          <h2 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><FileText size={20} /> {t("doc_title")}</h2>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 20, maxWidth: 640 }}>{t("doc_intro")}</p>
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 22, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {isBureau && (
                <Card>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>{t("doc_upload_title")}</h3>
                  <Field label={t("doc_rubrique")}>
                    <select style={inputStyle} value={uploadRubrique} onChange={(e) => setUploadRubrique(e.target.value)}>
                      {Object.entries(DOC_CATEGORY_KEY_MAP).map(([k, tk]) => <option key={k} value={k}>{t(tk)}</option>)}
                    </select>
                  </Field>
                  <Field label={t("doc_file_field")}><input type="file" onChange={handleFileUpload} /></Field>
                  <p style={{ fontSize: 11.5, color: "#686F7D" }}>{t("doc_privacy_note")}</p>
                </Card>
              )}
              <Card>
                <h3 style={{ fontSize: 13, marginBottom: 10 }}>{t("doc_sections_title")}</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <button
                    onClick={() => setDocCategoryFilter("all")}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left",
                      padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                      background: docCategoryFilter === "all" ? "var(--primary)" : "transparent",
                      color: docCategoryFilter === "all" ? "white" : "var(--primary)",
                    }}
                  >
                    <span>{t("doc_all_sections")}</span>
                    <span style={{ fontSize: 10.5, opacity: 0.85 }}>{documents.length}</span>
                  </button>
                  {Object.entries(DOC_CATEGORY_KEY_MAP).map(([k, tk]) => {
                    const count = documents.filter((d) => d.rubrique === k).length;
                    const active = docCategoryFilter === k;
                    return (
                      <button
                        key={k} onClick={() => setDocCategoryFilter(k)}
                        style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left",
                          padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: active ? 700 : 500,
                          background: active ? "var(--primary)" : "transparent", color: active ? "white" : "#444",
                        }}
                      >
                        <span>{t(tk)}</span>
                        <span style={{ fontSize: 10.5, opacity: 0.85 }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            </div>
            <div>
              <input
                style={{ ...inputStyle, marginBottom: 14, maxWidth: 380 }}
                placeholder={t("doc_search_placeholder")}
                value={docSearch} onChange={(e) => setDocSearch(e.target.value)}
              />
              <Table head={[t("doc_col_file"), t("doc_col_rubrique"), t("doc_col_uploaded"), t("doc_col_actions")]}>
                {filteredDocuments.map((d) => (
                  <tr key={d.id}>
                    <td style={{ ...td, fontWeight: 600 }}>
                      <span style={{ display: "inline-block", fontSize: 9, fontWeight: 700, color: "white", background: TEAL, borderRadius: 4, padding: "1px 5px", marginRight: 8, letterSpacing: 0.3, verticalAlign: 1 }}>
                        {docFileExt(d.nom)}
                      </span>
                      {d.nom}
                    </td>
                    <td style={td}>
                      {isBureau ? (
                        <select value={d.rubrique} onChange={(e) => { if (window.confirm(t("doc_confirm_reclassify").replace("{nom}", d.nom))) updateDocumentCategory(d.id, e.target.value); }} style={{ ...inputStyle, padding: "3px 6px", fontSize: 11, width: "auto" }}>
                          {Object.entries(DOC_CATEGORY_KEY_MAP).map(([k, tk]) => <option key={k} value={k}>{t(tk)}</option>)}
                        </select>
                      ) : (
                        DOC_CATEGORY_KEY_MAP[d.rubrique] ? t(DOC_CATEGORY_KEY_MAP[d.rubrique]) : d.rubrique
                      )}
                    </td>
                    <td style={td}>{new Date(d.created_at).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA")}</td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => downloadDocument(d)} style={{ fontSize: 11, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer" }}><Download size={11} style={{ verticalAlign: -2 }} /> {t("doc_open_btn")}</button>
                        {isBureau && (
                          <button onClick={() => deleteDocument(d)} title={t("doc_delete_btn")} style={{ width: 22, height: 22, borderRadius: "50%", background: "none", border: `1px solid ${RED}`, color: RED, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}>
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredDocuments.length === 0 && <tr><td colSpan={4} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("doc_no_document")}</td></tr>}
              </Table>
            </div>
          </div>
        </Section></Container>
        );
      })()}

      {/* ================= ANNONCES ================= */}
      {tab === "annonces" && (
        <Container><Section>
         <h2 style={{ marginBottom: 20 }}>{t("ann_title")}</h2>
          {/* minmax(0, ...) au lieu de 1fr seul (suite Phase 6, 2026-09-29)
              — trouvé pendant un test en conditions réelles : un texte
              d'annonce, même avec overflowWrap sur Card, restait coupé sur
              petit écran et illisible une fois le défilement horizontal
              bloqué (voir overflow-x sur <body>/<html>, index.css). Cause
              classique de CSS Grid : une piste "1fr" ne rétrécit JAMAIS
              en dessous de la largeur intrinsèque de son contenu (ici,
              le texte non coupé) — seul "minmax(0, 1fr)" l'autorise
              vraiment à rétrécir et donc à laisser le texte revenir à la
              ligne au lieu de déborder. C'est pour ça que ça fonctionnait
              en mode paysage (l'écran, plus large, dépassait la largeur
              intrinsèque du texte) mais pas en portrait. */}
          <div style={{ display: "grid", gridTemplateColumns: isBureau ? "minmax(0,1fr) minmax(0,1.4fr)" : "minmax(0,1fr)", gap: 22 }}>
            {isBureau && (
              <Card>
               <h3 style={{ fontSize: 14, marginBottom: 12 }}>{t("ann_publish_title")}</h3>
              <Field label={t("ann_title_field")}><input style={inputStyle} value={newAnn.titre} onChange={(e) => setNewAnn({ ...newAnn, titre: e.target.value })} /></Field>
              <Field label={t("ann_message")}><textarea style={{ ...inputStyle, minHeight: 90 }} value={newAnn.message} onChange={(e) => setNewAnn({ ...newAnn, message: e.target.value })} /></Field>
                <Field label={t("ann_urgent")}>
                <select style={inputStyle} value={newAnn.urgent ? "oui" : "non"} onChange={(e) => setNewAnn({ ...newAnn, urgent: e.target.value === "oui" })}>
                    <option value="non">{t("mem_no")}</option><option value="oui">{t("mem_yes")}</option>
                  </select>
                </Field>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 14, fontSize: 12.5, cursor: "pointer" }}>
                  <input type="checkbox" checked={newAnn.accuse_reception_requis} onChange={(e) => setNewAnn({ ...newAnn, accuse_reception_requis: e.target.checked })} style={{ marginTop: 2 }} />
                  <span>{t("ann_ack_required_label")}</span>
                </label>
                <Field label={t("ann_image_label")}>
                  <input
                    type="file" accept="image/*" ref={annImageInputRef} style={{ display: "none" }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]; e.target.value = "";
                      if (!file) return;
                      const url = await uploadAnnouncementImage(file);
                      if (url) setNewAnn((p) => ({ ...p, image_url: url }));
                    }}
                  />
                  {newAnn.image_url ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <img src={newAnn.image_url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid #DDD" }} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <button type="button" onClick={() => annImageInputRef.current?.click()} style={{ fontSize: 11, color: "var(--primary)", background: "none", border: "1px solid var(--primary)", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>{t("ann_image_change_btn")}</button>
                        <button type="button" onClick={() => setNewAnn((p) => ({ ...p, image_url: "" }))} style={{ fontSize: 11, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>{t("ann_image_remove_btn")}</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button" onClick={() => annImageInputRef.current?.click()} disabled={uploadingAnnImage}
                      style={{ fontSize: 12, color: "var(--primary)", background: "none", border: "1px dashed #BBB", borderRadius: 8, padding: "10px 14px", cursor: uploadingAnnImage ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8, width: "100%", boxSizing: "border-box" }}
                    >
                      <Upload size={14} /> {uploadingAnnImage ? t("ann_image_uploading") : t("ann_image_add_btn")}
                    </button>
                  )}
                </Field>
               <Btn onClick={publishAnnouncement}><Bell size={14} /> {t("ann_publish_btn")}</Btn>
                <p style={{ fontSize: 11, color: "#686F7D", marginTop: 10 }}>{t("ann_email_note")}</p>
              </Card>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
              {announcements.map((a) => (
                <Card key={a.id} style={{ borderTopColor: a.urgent ? RED : "var(--accent)" }}>
                  {editingAnnId === a.id ? (
                    <EditAnnouncementForm
                      announcement={a}
                      onSave={(patch) => { if (window.confirm(t("ann_confirm_edit").replace("{titre}", a.titre))) updateAnnouncement(a.id, patch); setEditingAnnId(null); }}
                      onCancel={() => setEditingAnnId(null)}
                      onUploadImage={uploadAnnouncementImage}
                      t={t} inputStyle={inputStyle}
                    />
                  ) : (
                    <>
                      {a.image_url && (
                        <img src={a.image_url} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8, marginBottom: 10 }} />
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <h3 style={{ fontSize: 15, margin: 0 }}>{a.titre}</h3>
                          {a.urgent && <Pill color={RED} bg="#FBE4E1">{t("ann_urgent_pill")}</Pill>}
                          {a.accuse_reception_requis && <Pill color={TEAL} bg={TEAL_LIGHT}>{t("ann_official_pill")}</Pill>}
                        </div>
                        {isBureau && (
                          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                            <button onClick={() => setEditingAnnId(a.id)} title={t("ann_edit_btn")} style={{ width: 24, height: 24, borderRadius: "50%", background: "none", border: "1px solid #DDD", color: "var(--primary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                              <Pencil size={12} />
                            </button>
                            <button onClick={() => deleteAnnouncement(a.id)} title={t("ann_delete_btn")} style={{ width: 24, height: 24, borderRadius: "50%", background: "none", border: `1px solid ${RED}`, color: RED, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                      <p style={{ fontSize: 13, color: "#5B6270", margin: 0 }}>{a.message}</p>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                        <p style={{ fontSize: 11, color: "#686F7D", margin: 0 }}>{new Date(a.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</p>
                        <WhatsAppShareButton
                          label={t("whatsapp_share_btn")}
                          text={`${a.urgent ? "🔴 " : "📢 "}${association?.nom ? `[${association.nom}] ` : ""}${a.titre}\n\n${a.message}`}
                        />
                      </div>
                      {a.accuse_reception_requis && (() => {
                        const acksForThis = announcementAcks.filter((ack) => ack.announcement_id === a.id);
                        if (isBureau) {
                          return (
                            <div style={{ marginTop: 10, background: TEAL_LIGHT, borderRadius: 8, padding: "8px 10px" }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: TEAL, marginBottom: acksForThis.length > 0 ? 4 : 0 }}>
                                {t("ann_ack_count").replace("{n}", String(acksForThis.length)).replace("{total}", String(nbActifs))}
                              </div>
                              {acksForThis.length > 0 && (
                                <div style={{ fontSize: 11, color: "#5B6270" }}>{acksForThis.map((ack) => ack.member_nom || "—").join(", ")}</div>
                              )}
                            </div>
                          );
                        }
                        const myAck = myAnnouncementAck(a.id);
                        return myAck ? (
                          <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: TEAL, display: "flex", alignItems: "center", gap: 6 }}>
                            <CheckCircle2 size={14} /> {t("ann_ack_done_at").replace("{date}", new Date(myAck.acked_at).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA"))}
                          </div>
                        ) : (
                          <Btn onClick={() => ackAnnouncement(a.id)} style={{ marginTop: 10, padding: "6px 14px", fontSize: 12 }}>
                            <CheckCircle2 size={13} /> {t("ann_ack_btn")}
                          </Btn>
                        );
                      })()}
                    </>
                  )}
                </Card>
              ))}
             {announcements.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic" }}>{t("ann_no_announcement")}</p>}
            </div>
          </div>
        </Section></Container>
      )}

      {/* ================= JOURNAL D'ACTIVITÉ ================= */}
      {tab === "journal" && isBureau && (
        <Container><Section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
            <h2 style={{ margin: 0 }}>{t("jrn_title")}</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select value={jrnPurgeDays} onChange={(e) => setJrnPurgeDays(Number(e.target.value))} style={{ ...inputStyle, width: "auto", padding: "6px 10px" }}>
                <option value={30}>{t("jrn_purge_days_30")}</option>
                <option value={90}>{t("jrn_purge_days_90")}</option>
                <option value={180}>{t("jrn_purge_days_180")}</option>
                <option value={365}>{t("jrn_purge_days_365")}</option>
              </select>
              <Btn variant="outline" onClick={purgeActivityLog}><Trash2 size={14} style={{ marginRight: 6 }} />{t("jrn_purge_btn")}</Btn>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <input placeholder={t("jrn_search_placeholder")} value={jrnSearch} onChange={(e) => setJrnSearch(e.target.value)} style={{ ...inputStyle, flex: "1 1 240px" }} />
            <select value={jrnTableFilter} onChange={(e) => setJrnTableFilter(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
              <option value="all">{t("jrn_filter_table_all")}</option>
              {Object.keys(JRN_TABLE_LABEL_KEYS).map((tbl) => (
                <option key={tbl} value={tbl}>{jrnTableLabel(tbl, t)}</option>
              ))}
            </select>
            <select value={jrnActionFilter} onChange={(e) => setJrnActionFilter(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
              <option value="all">{t("jrn_filter_action_all")}</option>
              <option value="INSERT">{t("jrn_action_insert")}</option>
              <option value="UPDATE">{t("jrn_action_update")}</option>
              <option value="DELETE">{t("jrn_action_delete")}</option>
            </select>
          </div>
          <Table head={[t("jrn_col_datetime"), t("jrn_col_user"), t("jrn_col_action"), t("jrn_col_table"), t("jrn_col_details"), t("jrn_col_actions")]}>
            {activityLog
              .filter((l) => jrnTableFilter === "all" || l.table_name === jrnTableFilter)
              .filter((l) => jrnActionFilter === "all" || l.action === jrnActionFilter)
              .filter((l) => {
                if (!jrnSearch.trim()) return true;
                const q = jrnSearch.toLowerCase();
                return (l.user_nom || "").toLowerCase().includes(q) ||
                  jrnTableLabel(l.table_name, t).toLowerCase().includes(q) ||
                  describeActivityLog(l, t, lang, moneyF).toLowerCase().includes(q);
              })
              .map((l) => (
              <tr key={l.id}>
                <td style={td}>{new Date(l.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</td>
                <td style={{ ...td, fontWeight: 600 }}>{l.user_nom || l.user_id?.slice(0, 8) || "—"}</td>
                <td style={td}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12, color: "#fff", background: jrnActionColor(l.action) }}>
                    {jrnActionLabel(l.action, t)}
                  </span>
                </td>
                <td style={td}>{jrnTableLabel(l.table_name, t)}</td>
                <td style={{ ...td, fontSize: 12.5, color: "#444", maxWidth: 380 }}>{describeActivityLog(l, t, lang, moneyF)}</td>
                <td style={td}>
                  <button onClick={() => deleteActivityLogEntry(l.id)} title={t("jrn_delete_btn")} style={{ background: "none", border: "none", cursor: "pointer", color: RED }}>
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
           {activityLog.length === 0 && <tr><td colSpan={6} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("jrn_no_activity")}</td></tr>}
          </Table>
        </Section></Container>
      )}

      {/* ================= DEMANDES DE SUPPRESSION (approbation) ================= */}
      {tab === "demandes_suppression" && isBureau && (() => {
        const jeSuisApprobateur = association?.approbateur_suppression_id === profile.id;
        const enAttente = deletionRequests.filter((r) => r.statut === "en_attente");
        const traitees = deletionRequests.filter((r) => r.statut !== "en_attente");
        return (
        <Container><Section>
          <h2 style={{ marginBottom: 6 }}>{t("del_req_title")}</h2>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 20, maxWidth: 640 }}>
            {association?.approbateur_suppression_id
              ? (jeSuisApprobateur ? t("del_req_intro_approver") : t("del_req_intro_other").replace("{name}", approverName()))
              : t("del_req_intro_none")}
          </p>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>{t("del_req_pending_title")} ({enAttente.length})</h3>
          <Table head={[t("del_req_col_date"), t("del_req_col_description"), t("del_req_col_requested_by"), ...(jeSuisApprobateur ? [t("del_req_col_actions")] : [t("del_req_col_status")])]}>
            {enAttente.map((r) => (
              <tr key={r.id}>
                <td style={td}>{new Date(r.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</td>
                <td style={td}>{r.description}</td>
                <td style={td}>{r.requested_by_nom || "—"}</td>
                {jeSuisApprobateur ? (
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => approveDeletionRequest(r)} style={{ fontSize: 11, fontWeight: 600, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "3px 10px", cursor: "pointer" }}>{t("del_req_approve_btn")}</button>
                      <button onClick={() => rejectDeletionRequest(r)} style={{ fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "3px 10px", cursor: "pointer" }}>{t("del_req_reject_btn")}</button>
                    </div>
                  </td>
                ) : (
                  <td style={{ ...td, color: AMBER, fontWeight: 700 }}>{t("del_req_status_pending")}</td>
                )}
              </tr>
            ))}
            {enAttente.length === 0 && <tr><td colSpan={4} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("del_req_none")}</td></tr>}
          </Table>

          <h3 style={{ fontSize: 14, margin: "26px 0 10px" }}>{t("del_req_history_title")}</h3>
          <Table head={[t("del_req_col_date"), t("del_req_col_description"), t("del_req_col_requested_by"), t("del_req_col_status")]}>
            {traitees.map((r) => (
              <tr key={r.id}>
                <td style={td}>{new Date(r.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</td>
                <td style={td}>{r.description}</td>
                <td style={td}>{r.requested_by_nom || "—"}</td>
                <td style={{ ...td, color: r.statut === "approuvee" ? TEAL : RED, fontWeight: 700 }}>
                  {r.statut === "approuvee" ? t("del_req_status_approved") : t("del_req_status_rejected")}
                  {r.motif_rejet && <div style={{ fontSize: 11, color: "#686F7D", fontWeight: 400 }}>{r.motif_rejet}</div>}
                </td>
              </tr>
            ))}
            {traitees.length === 0 && <tr><td colSpan={4} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("del_req_none")}</td></tr>}
          </Table>
        </Section></Container>
        );
      })()}

      {/* ================= PAIEMENTS INTERAC (confirmation manuelle) ================= */}
      {tab === "paiements_interac" && isBureau && (() => {
        function claimTypeLabel(c) {
          const base = { inscription: t("ms_inscription"), fonds_urgence: t("ms_fonds_urgence"), fonds_secours: t("ms_fonds_secours"), cotisation: t("ms_label_cotisation"), collation: t("ms_collation"), don: t("ms_label_don"), pret: t("ms_label_pret"), recouvrement: t("ms_label_recouvrement") }[c.type] || c.type;
          // Précise le fonds concerné pour une demande de recouvrement —
          // sinon toutes les demandes de ce type se ressembleraient dans
          // la liste, alors qu'elles règlent des lignes différentes.
          if (c.type === "recouvrement" && c.recouvrement_id) {
            const rec = [...fuRecouvrements, ...fsRecouvrements].find((r) => r.id === c.recouvrement_id);
            const fondsLabel = rec ? (depenseFondsMap[rec.depense_id] === "urgence" ? t("ms_urgence") : t("ms_secours")) : null;
            if (fondsLabel) return `${base} — ${fondsLabel}`;
          }
          return base;
        }
        function claimMemberName(memberId) { return members.find((m) => m.id === memberId)?.nom || "—"; }
        const enAttente = interacClaims.filter((c) => c.statut === "en_attente");
        const traitees = interacClaims.filter((c) => c.statut !== "en_attente");
        return (
        <Container><Section>
          <h2 style={{ marginBottom: 6 }}>{t("interac_claims_title")}</h2>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 20, maxWidth: 640 }}>{t("interac_claims_intro")}</p>
          <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("interac_claims_pending_title")} ({enAttente.length})</h3>
          {enAttente.length > 0 && <p style={{ fontSize: 11.5, color: "#686F7D", marginBottom: 10, maxWidth: 640 }}>{t("interac_claims_partial_help")}</p>}
          <Table head={[t("interac_claims_col_date"), t("interac_claims_col_member"), t("interac_claims_col_type"), t("interac_claims_amount_received_label"), t("interac_claims_col_file"), t("interac_claims_col_actions")]}>
            {enAttente.map((c) => (
              <tr key={c.id}>
                <td style={td}>{new Date(c.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</td>
                <td style={td}>{claimMemberName(c.member_id)}</td>
                <td style={td}>{claimTypeLabel(c)}</td>
                <td style={td}>
                  <input type="text" inputMode="decimal" value={interacAmountFor(c)}
                    onChange={(e) => setInteracAmountEdits((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    style={{ padding: "5px 8px", fontSize: 12.5, width: 84, borderRadius: 6, border: "1.5px solid #DCE0E8" }} />
                  <div style={{ fontSize: 10.5, color: "#686F7D", marginTop: 2 }}>{t("interac_claims_requested_prefix")} {moneyF(c.montant)}</div>
                </td>
                <td style={td}>
                  <button onClick={() => interacProofUrl(c)} style={{ fontSize: 11.5, fontWeight: 600, color: "var(--primary)", background: "none", border: "1px solid #DCE0E8", borderRadius: 999, padding: "3px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Eye size={12} /> {t("interac_claims_view_file")}
                  </button>
                </td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => confirmInteracClaim(c)} style={{ fontSize: 11, fontWeight: 600, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "3px 10px", cursor: "pointer" }}>{t("interac_claims_confirm_btn")}</button>
                    <button onClick={() => rejectInteracClaim(c)} style={{ fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "3px 10px", cursor: "pointer" }}>{t("interac_claims_reject_btn")}</button>
                  </div>
                </td>
              </tr>
            ))}
            {enAttente.length === 0 && <tr><td colSpan={6} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("interac_claims_none")}</td></tr>}
          </Table>

          <h3 style={{ fontSize: 14, margin: "26px 0 10px" }}>{t("interac_claims_history_title")}</h3>
          <Table head={[t("interac_claims_col_date"), t("interac_claims_col_member"), t("interac_claims_col_type"), t("interac_claims_col_amount"), t("interac_claims_col_status")]}>
            {traitees.map((c) => {
              const isPartial = c.statut === "confirme" && c.montant_recu != null && Number(c.montant_recu) < Number(c.montant);
              return (
              <tr key={c.id}>
                <td style={td}>{new Date(c.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</td>
                <td style={td}>{claimMemberName(c.member_id)}</td>
                <td style={td}>{claimTypeLabel(c)}</td>
                <td style={td}>
                  {moneyF(c.montant_recu ?? c.montant)}
                  {isPartial && <div style={{ fontSize: 10.5, color: AMBER, fontWeight: 700 }}>{t("interac_claims_partial_badge")} — {t("interac_claims_requested_prefix")} {moneyF(c.montant)}</div>}
                </td>
                <td style={{ ...td, color: c.statut === "confirme" ? TEAL : c.statut === "annule" ? "#686F7D" : RED, fontWeight: 700 }}>
                  {c.statut === "confirme" ? t("interac_claims_status_confirmed") : c.statut === "annule" ? t("interac_claims_status_cancelled") : t("interac_claims_status_rejected")}
                  {c.commentaire_bureau && <div style={{ fontSize: 11, color: "#686F7D", fontWeight: 400 }}>{c.commentaire_bureau}</div>}
                </td>
              </tr>
              );
            })}
            {traitees.length === 0 && <tr><td colSpan={5} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("interac_claims_none")}</td></tr>}
          </Table>
        </Section></Container>
        );
      })()}

      {/* ================= CONFIGURATION (marque blanche) ================= */}
      {tab === "acces" && isBureau && (
        <GestionAcces profile={profile} association={association} isPresident={isPresident}
          onPendingCountChange={setPendingLinkRequestsCount} onLinkRequestResolved={refreshUnreadCounts} />
      )}

      {tab === "config" && isBureau && (
        <Container><Section>
        <h2 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><Settings size={20} /> {t("cfg_title")}</h2>
        <p style={{ fontSize: 13, color: "#666", marginBottom: 20, maxWidth: 640 }}>{t("cfg_page_intro")}</p>
        {/* 2026-10-06 (demandé par l'utilisateur) — même disposition menu
            de gauche + contenu de droite que l'onglet Documents (voir plus
            haut) : treize blocs de configuration auparavant empilés sur
            une seule longue colonne, maintenant classés par catégorie pour
            ne plus avoir à tout faire défiler pour retrouver un réglage. */}
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 22, alignItems: "start" }}>
          <Card>
            <h3 style={{ fontSize: 13, marginBottom: 10 }}>{t("cfg_sections_title")}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {CONFIG_SECTIONS.map((s) => {
                const Icon = s.icon;
                const active = configSection === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setConfigSection(s.id)}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 8, textAlign: "left",
                      padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                      background: active ? "var(--primary)" : "transparent",
                    }}
                  >
                    <Icon size={15} style={{ marginTop: 1, flexShrink: 0, color: active ? "white" : "var(--primary)" }} />
                    <span>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: active ? 700 : 600, color: active ? "white" : "#2A2E37" }}>{t(s.labelKey)}</span>
                      <span style={{ display: "block", fontSize: 10.5, color: active ? "rgba(255,255,255,.85)" : "#9AA2B5", marginTop: 1 }}>{t(s.descKey)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
          <div>
          {configSection === "general" && (
          <Card style={{ maxWidth: 480 }}>
            <Field label={t("cfg_org_name")}><input style={inputStyle} value={brandDraft.nom || ""} onChange={(e) => setBrandDraft({ ...brandDraft, nom: e.target.value })} /></Field>
            <Field label={t("cfg_logo_url")}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                {brandDraft.logo_url && <img src={brandDraft.logo_url} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", border: "1px solid #E4E6EA" }} />}
                <Btn variant="outline" onClick={() => logoFileInputRef.current?.click()}>{t("cfg_logo_upload_btn")}</Btn>
              </div>
              <input style={inputStyle} value={brandDraft.logo_url || ""} onChange={(e) => setBrandDraft({ ...brandDraft, logo_url: e.target.value })} placeholder="https://…" />
              <p style={{ fontSize: 11, color: "#686F7D", marginTop: 4 }}>{t("cfg_logo_help")}</p>
            </Field>
            <input
              type="file" accept="image/*" ref={logoFileInputRef} style={{ display: "none" }}
              onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadLogo(file); e.target.value = ""; }}
            />
           <Field label={t("cfg_slogan")}><input style={inputStyle} value={brandDraft.devise_texte || ""} onChange={(e) => setBrandDraft({ ...brandDraft, devise_texte: e.target.value })} /></Field>
            <Field label={t("cfg_currency_code")}>
              <select style={inputStyle} value={brandDraft.devise_monetaire || "CAD"} onChange={(e) => setBrandDraft({ ...brandDraft, devise_monetaire: e.target.value })}>
                {!currencyChoices.some((c) => c.code === (brandDraft.devise_monetaire || "CAD")) && (
                  <option value={brandDraft.devise_monetaire}>{brandDraft.devise_monetaire}</option>
                )}
                {currencyChoices.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
              <p style={{ fontSize: 11, color: "#686F7D", marginTop: 4 }}>{t("cfg_currency_code_help")}</p>
            </Field>
            <Field label={t("cfg_timezone")}>
              <select style={inputStyle} value={brandDraft.fuseau_horaire || "America/Moncton"} onChange={(e) => setBrandDraft({ ...brandDraft, fuseau_horaire: e.target.value })}>
                {!timezoneChoices.some((z) => z.tz === (brandDraft.fuseau_horaire || "America/Moncton")) && (
                  <option value={brandDraft.fuseau_horaire}>{brandDraft.fuseau_horaire}</option>
                )}
                {timezoneChoices.map((z) => <option key={z.tz} value={z.tz}>{z.label}</option>)}
              </select>
              <p style={{ fontSize: 11, color: "#686F7D", marginTop: 4 }}>{t("cfg_timezone_help")}</p>
            </Field>
           <Field label={t("cfg_primary_color")}><input type="color" style={{ ...inputStyle, height: 40 }} value={brandDraft.couleur_primaire || EMERALD_DARK_DEFAULT} onChange={(e) => setBrandDraft({ ...brandDraft, couleur_primaire: e.target.value })} /></Field>
           <Field label={t("cfg_accent_color")}><input type="color" style={{ ...inputStyle, height: 40 }} value={brandDraft.couleur_accent || "#C8963E"} onChange={(e) => setBrandDraft({ ...brandDraft, couleur_accent: e.target.value })} /></Field>
           <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
             <Btn onClick={() => saveBranding("branding")}>{t("action_save")}</Btn>
             {savedCard === "branding" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
           </div>
          </Card>
          )}

          {configSection === "vitrine" && (
          /* ================= GALERIE DE PHOTOS ================= Suite
              2026-10-06 — voir sql/2026-10-06_galerie_photos_association.sql.
              Tant que ce script n'a pas été exécuté, l'envoi échoue avec un
              message d'erreur explicite (galleryMsg) plutôt que de rester
              muet — contrairement à la lecture (page d'accueil), une action
              explicite mérite toujours un retour.
              Passée en Premium (suite 2026-10-06, demande explicite de
              l'utilisateur : « Faire passer l'option de diaporama en mode
              premium ») — même patron que la Vitrine juste ci-dessous
              (PremiumLocked à la place du contenu réel tant que
              !isPremiumPlan). Gérer des photos qui ne s'afficheraient
              jamais nulle part (le diaporama de la page d'accueil est,
              lui aussi, verrouillé — voir PresentationAssociation.jsx)
              n'aurait aucun sens. */
          <Card style={{ maxWidth: 480, marginTop: 22 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_gallery_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_gallery_intro")}</p>
            {!isPremiumPlan ? (
              <PremiumLocked compact label={t("diaporama_premium_label")} onUpgrade={goToForfait} features={[t("premium_feat_diaporama_1"), t("premium_feat_diaporama_2"), t("premium_feat_diaporama_3")]} />
            ) : (
              <>
            {galleryPhotos.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(90px,1fr))", gap: 10, marginBottom: 14 }}>
                {galleryPhotos.map((p, i) => (
                  <div key={p.id} style={{ position: "relative" }}>
                    <img src={p.url} alt="" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 8, border: "1px solid #E4E6EA" }} />
                    <div style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 3 }}>
                      {/* Texte de présentation (suite 2026-10-06) — bouton
                          crayon distinct de la suppression, pour ne pas les
                          confondre ; voir GalleryPhotoEditModal plus bas. */}
                      <button onClick={() => setEditingGalleryPhoto(p)} title={t("cfg_gallery_edit")} style={{ background: "rgba(24,34,51,.75)", border: "none", borderRadius: 999, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", color: "white", cursor: "pointer" }}>
                        <Pencil size={11} />
                      </button>
                      <button onClick={() => deleteGalleryPhoto(p)} title={t("cfg_gallery_delete")} style={{ background: "rgba(24,34,51,.75)", border: "none", borderRadius: 999, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", color: "white", cursor: "pointer" }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div style={{ position: "absolute", bottom: 4, right: 4, display: "flex", gap: 3 }}>
                      <button disabled={i === 0} onClick={() => moveGalleryPhoto(p, -1)} title={t("cfg_gallery_move_up")} style={{ background: "rgba(24,34,51,.75)", border: "none", borderRadius: 999, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", color: "white", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.4 : 1 }}>
                        <ChevronLeft size={11} style={{ transform: "rotate(90deg)" }} />
                      </button>
                      <button disabled={i === galleryPhotos.length - 1} onClick={() => moveGalleryPhoto(p, 1)} title={t("cfg_gallery_move_down")} style={{ background: "rgba(24,34,51,.75)", border: "none", borderRadius: 999, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", color: "white", cursor: i === galleryPhotos.length - 1 ? "default" : "pointer", opacity: i === galleryPhotos.length - 1 ? 0.4 : 1 }}>
                        <ChevronLeft size={11} style={{ transform: "rotate(-90deg)" }} />
                      </button>
                    </div>
                    {(p.legende || p.description) && (
                      <div style={{ position: "absolute", bottom: 4, left: 4, background: "rgba(24,34,51,.75)", borderRadius: 999, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }} title={p.legende || t("cfg_gallery_has_text")}>
                        <FileText size={11} color="white" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <Btn variant="outline" onClick={() => galleryFileInputRef.current?.click()} disabled={galleryUploading}>
              <Upload size={13} /> {galleryUploading ? t("cfg_gallery_uploading") : t("cfg_gallery_add_btn")}
            </Btn>
            <input
              type="file" accept="image/*" multiple ref={galleryFileInputRef} style={{ display: "none" }}
              onChange={(e) => { const files = Array.from(e.target.files || []); if (files.length) uploadGalleryPhotos(files); e.target.value = ""; }}
            />
            {galleryMsg && <p style={{ fontSize: 11.5, color: RED, fontWeight: 600, marginTop: 10 }}>{galleryMsg}</p>}
              </>
            )}
          </Card>
          )}
          {editingGalleryPhoto && (
            <GalleryPhotoEditModal
              photo={editingGalleryPhoto}
              t={t}
              onSave={async (fields) => { const ok = await updateGalleryPhoto(editingGalleryPhoto.id, fields); if (ok) setEditingGalleryPhoto(null); }}
              onClose={() => setEditingGalleryPhoto(null)}
            />
          )}

          {configSection === "abonnement" && (
          <Card id="forfait-card" style={{ maxWidth: 480, marginTop: 22 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_forfait_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_forfait_intro")}</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: TEAL_LIGHT, borderRadius: 8, marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <div>
                <p style={{ fontSize: 11, color: "#5B6270", marginBottom: 2 }}>{t("cfg_forfait_actuel")}</p>
                <p style={{ fontSize: 15, fontWeight: 700, color: CHARCOAL }}>{forfaitPlanLabel(subscription?.plan)}</p>
              </div>
              {subscription?.plan === "essai" && subscription?.date_fin_periode && (
                <p style={{ fontSize: 11.5, color: AMBER, fontWeight: 600, textAlign: "right" }}>
                  {t("cfg_forfait_essai_fin")} {new Date(subscription.date_fin_periode).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA")}
                </p>
              )}
            </div>

            {/* Transparence sur le module Covoiturage (suite 2026-10-08,
                sql/2026-10-08i) — jamais de supplément facturé sans que le
                bureau le voie ici, en plus de la notification envoyée au
                moment où le Super-Admin change la facturation. */}
            {(association?.covoiturage_module_actif ?? true) && (
              <p style={{ fontSize: 11.5, color: association?.covoiturage_facturation === "addon_payant" ? "#C8963E" : TEAL, fontWeight: 600, marginTop: -4, marginBottom: 16 }}>
                {association?.covoiturage_facturation === "addon_payant"
                  ? t("cfg_forfait_covoiturage_addon").replace("{prix}", moneyF(association?.covoiturage_addon_prix_mensuel || 0))
                  : t("cfg_forfait_covoiturage_inclus")}
              </p>
            )}

            {pendingPlanRequest && (
              <Banner tone="warn">
                {t("cfg_forfait_demande_en_attente").replace("{plan}", forfaitPlanLabel(pendingPlanRequest.plan_demande)).replace("{montant}", moneyF(pendingPlanRequest.montant))}
              </Banner>
            )}

            {!isPresident ? (
              <p style={{ fontSize: 11.5, color: RED, fontWeight: 600, marginTop: 12 }}>{t("cfg_forfait_seul_president")}</p>
            ) : !pendingPlanRequest && (
              <>
                <Field label={t("cfg_forfait_choisir")}>
                  <div style={{ display: "flex", gap: 10 }}>
                    {["standard", "premium"].map((plan) => (
                      <button
                        key={plan}
                        type="button"
                        onClick={() => { setForfaitPlan(plan); setForfaitShowInterac(false); setForfaitInteracMsg(""); }}
                        style={{
                          flex: 1, padding: "12px 10px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                          border: forfaitPlan === plan ? `2px solid ${TEAL}` : "1px solid #E4E6EA",
                          background: forfaitPlan === plan ? TEAL_LIGHT : "#fff",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, color: CHARCOAL }}>{forfaitPlanLabel(plan)}</div>
                        <div style={{ fontSize: 12, color: "#5B6270" }}>{moneyF(FORFAIT_PRIX[plan])} / {t("cfg_forfait_par_mois")}</div>
                      </button>
                    ))}
                  </div>
                </Field>

                {forfaitPlan && subscription?.plan !== forfaitPlan && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <Btn onClick={() => payerEnLigne("forfait", { plan: forfaitPlan })} disabled={payingType === "forfait"}>
                        <CreditCard size={14} /> {payingType === "forfait" ? t("ms_pay_online_loading") : t("cfg_forfait_payer_carte")}
                      </Btn>
                      <Btn variant="outline" onClick={() => setForfaitShowInterac((s) => !s)}>{t("cfg_forfait_payer_interac")}</Btn>
                    </div>
                    <p style={{ fontSize: 11, color: "#686F7D", marginTop: 8 }}>{t("cfg_forfait_interac_aide")}</p>

                    {forfaitShowInterac && (
                      <div style={{ marginTop: 10, padding: 12, background: "#FAFAF8", borderRadius: 8, border: "1px solid #E4E6EA" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <Btn variant="outline" onClick={() => forfaitFileInputRef.current?.click()}>
                            <Upload size={13} /> {forfaitInteracFile ? forfaitInteracFile.name : t("cfg_forfait_choisir_fichier")}
                          </Btn>
                          <input type="file" ref={forfaitFileInputRef} style={{ display: "none" }}
                            onChange={(e) => { const file = e.target.files?.[0]; if (file) setForfaitInteracFile(file); e.target.value = ""; }} />
                        </div>
                        <Btn onClick={() => submitForfaitInterac(forfaitPlan)} disabled={!forfaitInteracFile || forfaitInteracUploading}>
                          {forfaitInteracUploading ? t("ms_pay_online_loading") : t("cfg_forfait_soumettre_preuve")}
                        </Btn>
                      </div>
                    )}
                  </div>
                )}
                {forfaitInteracMsg && <p style={{ fontSize: 11.5, color: TEAL, marginTop: 10 }}>{forfaitInteracMsg}</p>}
              </>
            )}
          </Card>
          )}

          {configSection === "adhesion" && (
          <Card style={{ maxWidth: 480, marginTop: 22 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_montants_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_montants_intro")}</p>
            <Field label={t("cfg_montant_inscription")}>
              <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.inscription_montant ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, inscription_montant: e.target.value })} placeholder="25" />
            </Field>
            <Field label={t("cfg_montant_urgence")}>
              <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.fonds_urgence_montant ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, fonds_urgence_montant: e.target.value })} placeholder="25" />
            </Field>
            <Field label={t("cfg_montant_secours")}>
              <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.fonds_secours_montant ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, fonds_secours_montant: e.target.value })} placeholder="200" />
            </Field>
            <Field label={t("cfg_montant_collation")}>
              <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.collation_montant_mensuel ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, collation_montant_mensuel: e.target.value })} placeholder="10" />
            </Field>
            <Field label={t("cfg_montant_tontine")}>
              <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.tontine_montant_seance ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, tontine_montant_seance: e.target.value })} placeholder="100" />
            </Field>
            <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 14 }}>{t("cfg_montants_help")}</p>
            <Field label={t("cfg_frequence_label")}>
              <select style={inputStyle} value={brandDraft.frequence_reunions || "mois"} onChange={(e) => setBrandDraft({ ...brandDraft, frequence_reunions: e.target.value })}>
                <option value="semaine">{t("cfg_freq_semaine")}</option>
                <option value="quinzaine">{t("cfg_freq_quinzaine")}</option>
                <option value="trois_semaines">{t("cfg_freq_trois_semaines")}</option>
                <option value="mois">{t("cfg_freq_mois")}</option>
              </select>
            </Field>
            <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 14 }}>{t("cfg_frequence_help")}</p>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--primary)", marginBottom: 4, cursor: "pointer" }}>
              <input type="checkbox" style={{ marginTop: 3 }} checked={association?.nouveaux_payent_anterieur !== false} onChange={async (e) => {
                const v = e.target.checked;
                const { data, error } = await supabase.from("associations").update({ nouveaux_payent_anterieur: v }).eq("id", profile.association_id).select().single();
                if (error) { alert(error.code === "PGRST204" || /nouveaux_payent_anterieur/.test(error.message || "") ? t("cfg_anterieur_sql") : friendlyError(error, t)); return; }
                onAssociationChange(data);
              }} />
              {t("cfg_anterieur_label")}
            </label>
            <p style={{ fontSize: 11, color: "#686F7D", marginTop: 0, marginBottom: 14 }}>{t("cfg_anterieur_help")}</p>
            <Field label={t("cfg_interac_email_label")}>
              <input type="email" style={inputStyle} value={brandDraft.interac_email || ""} onChange={(e) => setBrandDraft({ ...brandDraft, interac_email: e.target.value })} placeholder="paiements@monassociation.org" />
            </Field>
            <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 14 }}>{t("cfg_interac_email_help")}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Btn onClick={() => saveBranding("montants")}>{t("action_save")}</Btn>
              {savedCard === "montants" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
            </div>
          </Card>
          )}
          {configSection === "adhesion" && isBureau && <ParametresBadges association={association} onAssociationChange={onAssociationChange} />}

          {configSection === "modules" && (
          <>
          {(association?.covoiturage_module_actif ?? true) && <CovoiturageTarifs profile={profile} association={association} />}
          <Card style={{ maxWidth: 480, marginTop: 22 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_funeraire_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_funeraire_intro")}</p>
            <Field label={t("cfg_funeraire_plans_label")}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={brandDraft.funeraire_main_levee_actif !== false} onChange={(e) => setBrandDraft({ ...brandDraft, funeraire_main_levee_actif: e.target.checked })} />
                {t("cfg_funeraire_main_levee_checkbox")}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={!!brandDraft.funeraire_organisme_tiers_actif} onChange={(e) => setBrandDraft({ ...brandDraft, funeraire_organisme_tiers_actif: e.target.checked })} />
                {t("cfg_funeraire_organisme_tiers_checkbox")}
              </label>
            </Field>
            <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 14 }}>{t("cfg_funeraire_plans_help")}</p>
            {brandDraft.funeraire_main_levee_actif === false && !brandDraft.funeraire_organisme_tiers_actif && (
              <p style={{ fontSize: 11.5, color: RED, fontWeight: 600, marginTop: -10, marginBottom: 14 }}>{t("cfg_funeraire_au_moins_un_requis")}</p>
            )}
            <Field label={t("cfg_funeraire_montant_inscription")}>
              <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.funeraire_montant_inscription ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, funeraire_montant_inscription: e.target.value })} placeholder="50" />
            </Field>
            <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 14 }}>{t("cfg_funeraire_montant_inscription_help")}</p>
            {!!brandDraft.funeraire_organisme_tiers_actif && (
              <>
                <Field label={t("cfg_funeraire_periode_probation")}>
                  <input type="number" min="0" style={inputStyle} value={brandDraft.funeraire_periode_probation_jours ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, funeraire_periode_probation_jours: e.target.value })} placeholder="0" />
                </Field>
                <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 14 }}>{t("cfg_funeraire_periode_probation_help")}</p>
                <Field label={t("cfg_funeraire_montant_deces")}>
                  <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.funeraire_montant_deces ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, funeraire_montant_deces: e.target.value })} placeholder="1500" />
                </Field>
                <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 14 }}>{t("cfg_funeraire_montant_deces_help")}</p>
                <Field label={t("cfg_funeraire_montant_recharge")}>
                  <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.funeraire_montant_recharge ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, funeraire_montant_recharge: e.target.value })} placeholder="20" />
                </Field>
                <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 14 }}>{t("cfg_funeraire_montant_recharge_help")}</p>
                <Field label={t("cfg_funeraire_seuil_alerte")}>
                  <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.funeraire_seuil_alerte ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, funeraire_seuil_alerte: e.target.value })} placeholder="500" />
                </Field>
                <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 14 }}>{t("cfg_funeraire_seuil_alerte_help")}</p>
              </>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Btn onClick={() => saveBranding("funeraire")}>{t("action_save")}</Btn>
              {savedCard === "funeraire" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
            </div>
          </Card>

          <Card style={{ maxWidth: 480, marginTop: 22 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_sanctions_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_sanctions_intro")}</p>
            <Field label={t("cfg_sanctions_paliers_checkbox")}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={brandDraft.sanctions_paliers_actifs !== false} onChange={(e) => setBrandDraft({ ...brandDraft, sanctions_paliers_actifs: e.target.checked })} />
                {t("cfg_sanctions_paliers_checkbox")}
              </label>
            </Field>
            <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 14 }}>{t("cfg_sanctions_paliers_help")}</p>
            <Field label={t("cfg_sanctions_seuil_label")}>
              <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.sanctions_seuil_validation ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, sanctions_seuil_validation: e.target.value })} placeholder="25" />
            </Field>
            <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 14 }}>{t("cfg_sanctions_seuil_help")}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Btn onClick={() => saveBranding("sanctions")}>{t("action_save")}</Btn>
              {savedCard === "sanctions" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
            </div>
          </Card>
          </>
          )}

          {configSection === "adhesion" && (
          <Card style={{ maxWidth: 480, marginTop: 22, opacity: isPresident ? 1 : 0.55 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_invite_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_invite_intro")}</p>
            <Field label={t("cfg_invite_label")}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input readOnly style={{ ...inputStyle, fontWeight: 700, letterSpacing: 1, background: "#FBF6EC" }} value={brandDraft.code_invitation || association?.code_invitation || ""} />
                {isPresident && (
                  <>
                    <Btn variant="outline" onClick={copyInviteCode}><Copy size={13} /></Btn>
                    <Btn variant="outline" onClick={regenerateInviteCode}><RefreshCw size={13} /></Btn>
                  </>
                )}
              </div>
            </Field>
            {inviteCodeMsg && <p style={{ fontSize: 11.5, color: TEAL, marginTop: -8 }}>{inviteCodeMsg}</p>}
            {!isPresident && <p style={{ fontSize: 11.5, color: RED, fontWeight: 600 }}>{t("cfg_president_only_note")}</p>}
          </Card>
          )}

          {configSection === "vitrine" && (
          <Card style={{ maxWidth: 480, marginTop: 22, opacity: isPresident ? 1 : 0.55 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_vitrine_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_vitrine_intro")}</p>
            {isPresident && !isPremiumPlan ? (
              <PremiumLocked compact label={t("cfg_vitrine_title")} onUpgrade={goToForfait} features={[t("premium_feat_vitrine_1"), t("premium_feat_vitrine_2"), t("premium_feat_vitrine_3")]} />
            ) : isPresident ? (
              <>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 14, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!association?.vitrine_active} disabled={vitrineBusy} onChange={toggleVitrine} />
                  {t("cfg_vitrine_active_checkbox")}
                </label>
                {association?.vitrine_active && (
                  <>
                    <Field label={t("cfg_vitrine_url_label")}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input readOnly style={{ ...inputStyle, fontSize: 12, background: "#FBF6EC" }} value={publicUrl} />
                        <Btn variant="outline" onClick={copyPublicUrl}><Copy size={13} /></Btn>
                      </div>
                    </Field>
                    <Field label={t("cfg_vitrine_slug_label")}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input style={inputStyle} value={brandDraft.slug_public || ""} onChange={(e) => setBrandDraft({ ...brandDraft, slug_public: e.target.value })} />
                        <Btn variant="outline" onClick={saveSlug} disabled={vitrineBusy}>{t("action_save")}</Btn>
                      </div>
                    </Field>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 4, cursor: "pointer" }}>
                      <input type="checkbox" checked={brandDraft.adhesion_notif_auto !== false} onChange={(e) => setBrandDraft({ ...brandDraft, adhesion_notif_auto: e.target.checked })} />
                      {t("cfg_vitrine_notif_auto_checkbox")}
                    </label>
                    <p style={{ fontSize: 11, color: "#686F7D", marginTop: -6, marginBottom: 14 }}>{t("cfg_vitrine_notif_auto_help")}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Btn onClick={() => saveBranding("vitrine")}>{t("action_save")}</Btn>
                      {savedCard === "vitrine" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
                    </div>
                  </>
                )}
                {vitrineMsg && <p style={{ fontSize: 11.5, color: TEAL, marginTop: 10 }}>{vitrineMsg}</p>}
              </>
            ) : (
              <p style={{ fontSize: 11.5, color: RED, fontWeight: 600 }}>{t("cfg_president_only_note")}</p>
            )}
          </Card>
          )}

          {configSection === "adhesion" && (
          <Card style={{ maxWidth: 480, marginTop: 22, opacity: isPresident ? 1 : 0.55 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_secours_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_secours_intro")}</p>
            <Field label={t("cfg_probation_secours")}>
              <input type="number" min="0" disabled={!isPresident} style={{ ...inputStyle, ...(isPresident ? {} : { background: "#F1F2F4", cursor: "not-allowed" }) }} value={brandDraft.periode_probation_secours_jours ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, periode_probation_secours_jours: e.target.value })} placeholder="0" />
            </Field>
            <p style={{ fontSize: 11.5, color: "#686F7D", marginTop: -8, marginBottom: 14 }}>{t("cfg_probation_secours_help")}</p>
            {isPresident ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Btn onClick={() => saveBranding("secours")}>{t("action_save")}</Btn>
                {savedCard === "secours" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
              </div>
            ) : (
              <p style={{ fontSize: 11.5, color: RED, fontWeight: 600 }}>{t("cfg_president_only_note")}</p>
            )}
          </Card>
          )}

          {configSection === "gouvernance" && (
          <Card style={{ maxWidth: 480, marginTop: 22, opacity: isPresident ? 1 : 0.55 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_approbateur_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_approbateur_intro")}</p>
            <Field label={t("cfg_approbateur_label")}>
              <select disabled={!isPresident} style={{ ...inputStyle, ...(isPresident ? {} : { background: "#F1F2F4", cursor: "not-allowed" }) }} value={brandDraft.approbateur_suppression_id || ""} onChange={(e) => setBrandDraft({ ...brandDraft, approbateur_suppression_id: e.target.value })}>
                <option value="">{t("cfg_approbateur_none")}</option>
                {bureauProfiles.map((p) => <option key={p.id} value={p.id}>{p.nom_complet || p.id.slice(0, 8)} — {t(ROLE_KEY_MAP[p.role])}</option>)}
              </select>
            </Field>
            {isPresident ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Btn onClick={() => saveBranding("approbateur")}>{t("action_save")}</Btn>
                {savedCard === "approbateur" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
              </div>
            ) : (
              <p style={{ fontSize: 11.5, color: RED, fontWeight: 600 }}>{t("cfg_president_only_note")}</p>
            )}
          </Card>
          )}

          {configSection === "documents_officiels" && (
          <>
          <Card style={{ maxWidth: 480, marginTop: 22 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_signataires_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_signataires_intro")}</p>
            <Field label={t("cfg_signataire1_nom")}>
              <input style={inputStyle} value={brandDraft.signataire1_nom || ""} onChange={(e) => setBrandDraft({ ...brandDraft, signataire1_nom: e.target.value })} />
            </Field>
            <Field label={t("cfg_signataire1_titre")}>
              <input style={inputStyle} value={brandDraft.signataire1_titre || ""} onChange={(e) => setBrandDraft({ ...brandDraft, signataire1_titre: e.target.value })} placeholder={t("ms_receipt_signature1_fallback")} />
            </Field>
            <Field label={t("cfg_signataire2_nom")}>
              <input style={inputStyle} value={brandDraft.signataire2_nom || ""} onChange={(e) => setBrandDraft({ ...brandDraft, signataire2_nom: e.target.value })} />
            </Field>
            <Field label={t("cfg_signataire2_titre")}>
              <input style={inputStyle} value={brandDraft.signataire2_titre || ""} onChange={(e) => setBrandDraft({ ...brandDraft, signataire2_titre: e.target.value })} placeholder={t("ms_receipt_signature2_fallback")} />
            </Field>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Btn onClick={() => saveBranding("signataires")}>{t("action_save")}</Btn>
              {savedCard === "signataires" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
            </div>
          </Card>

          <Card style={{ maxWidth: 480, marginTop: 22 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_legal_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_legal_intro")}</p>
            <Field label={t("cfg_statut_juridique")}>
              <input style={inputStyle} value={brandDraft.statut_juridique || ""} onChange={(e) => setBrandDraft({ ...brandDraft, statut_juridique: e.target.value })} placeholder={t("cfg_statut_juridique_placeholder")} />
              <p style={{ fontSize: 11, color: "#686F7D", marginTop: 4 }}>{t("cfg_statut_juridique_help")}</p>
            </Field>
            <Field label={t("cfg_numero_enregistrement")}>
              <input style={inputStyle} value={brandDraft.numero_enregistrement || ""} onChange={(e) => setBrandDraft({ ...brandDraft, numero_enregistrement: e.target.value })} />
              <p style={{ fontSize: 11, color: "#686F7D", marginTop: 4 }}>{t("cfg_numero_enregistrement_help")}</p>
            </Field>
            <Field label={t("cfg_adresse")}>
              <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={brandDraft.adresse || ""} onChange={(e) => setBrandDraft({ ...brandDraft, adresse: e.target.value })} />
              <p style={{ fontSize: 11, color: "#686F7D", marginTop: 4 }}>{t("cfg_adresse_help")}</p>
            </Field>
            <Field label={t("cfg_recu_mention_legale")}>
              <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={brandDraft.recu_mention_legale || ""} onChange={(e) => setBrandDraft({ ...brandDraft, recu_mention_legale: e.target.value })} placeholder={t("cfg_recu_mention_legale_placeholder")} />
              <p style={{ fontSize: 11, color: "#686F7D", marginTop: 4 }}>{t("cfg_recu_mention_legale_help")}</p>
            </Field>
            {/* Reçu fiscal conforme France — CERFA 2041-RD, 2026-10-06 : ces
                deux champs activent le reçu conforme (natures/formes/base
                légale, numérotation séquentielle, mention art. 1740 A CGI)
                dans FinancesElargies.jsx → DonReceiptModal. Numéro
                d'enregistrement (déjà au-dessus) double comme SIREN/RNA. */}
            <Field label={t("recu_object_label")}>
              <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={brandDraft.recu_objet_social || ""} onChange={(e) => setBrandDraft({ ...brandDraft, recu_objet_social: e.target.value })} />
              <p style={{ fontSize: 11, color: "#686F7D", marginTop: 4 }}>{t("recu_objet_help")}</p>
            </Field>
            <Field label={t("recu_category_label")}>
              <select style={inputStyle} value={brandDraft.recu_categorie_eligibilite || ""} onChange={(e) => setBrandDraft({ ...brandDraft, recu_categorie_eligibilite: e.target.value })}>
                <option value="">—</option>
                {RECU_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{t(c.labelKey)}</option>)}
              </select>
              <p style={{ fontSize: 11, color: "#686F7D", marginTop: 4 }}>{t("recu_category_help")}</p>
            </Field>
            <p style={{ fontSize: 11, color: "#686F7D", marginTop: -6, marginBottom: 10 }}>{t("recu_siren_help")}</p>
            {/* Reçu officiel de don conforme Canada — règles de l'ARC,
                2026-10-06, deuxième juridiction après la France ci-dessus.
                Présence de ce champ (format validé par la contrainte SQL
                associations_numero_organisme_bienfaisance_check) active le
                reçu CRA sur DonReceiptModal. */}
            <Field label={t("recu_numero_bienfaisance_label")}>
              <input
                style={inputStyle}
                value={brandDraft.recu_numero_organisme_bienfaisance || ""}
                onChange={(e) => setBrandDraft({ ...brandDraft, recu_numero_organisme_bienfaisance: e.target.value.toUpperCase() })}
                placeholder="123456789RR0001"
              />
              <p style={{ fontSize: 11, color: "#686F7D", marginTop: 4 }}>{t("recu_numero_bienfaisance_help")}</p>
              {brandDraft.recu_numero_organisme_bienfaisance && !/^\d{9}RR\d{4}$/.test(brandDraft.recu_numero_organisme_bienfaisance) && (
                <p style={{ fontSize: 11, color: RED, marginTop: 4 }}>{t("recu_numero_bienfaisance_invalid")}</p>
              )}
            </Field>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Btn onClick={() => saveBranding("legal")}>{t("action_save")}</Btn>
              {savedCard === "legal" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
            </div>
          </Card>
          </>
          )}

          {configSection === "rapports" && (
            /* Rapport annuel (PDF) + export complet des données —
                Phase 5 de la feuille de route, suite 85, 2026-09-28. */
            <RapportAnnuel profile={profile} association={association} isPresident={isPresident} />
          )}
          </div>
        </div>
        </Section></Container>
      )}

      {/* ================= MON ESPACE (adhérent) ================= */}
      {tab === "monespace" && isAdherent && (
        <Container><Section>
          <h2 style={{ marginBottom: 6 }}>{t("ms_title")}</h2>
          {!me && <p style={{ color: "#5B6270", marginBottom: 20 }}>{t("ms_not_linked")}</p>}
          {me && (
            <>
              {(() => {
                // Indicateurs de synthèse (bandeau + en-tête d'identité,
                // suite 53, 2026-09-11 — redesign de Mon espace approuvé
                // par l'utilisateur à partir de la maquette « Relevé
                // financier ») : calculés à partir des mêmes valeurs déjà
                // utilisées par chaque carte plus bas, aucune nouvelle
                // source de données.
                const recouvrementsMe = [
                  ...fuRecouvrements.map((r) => ({ ...r, fondsCode: "urgence" })),
                  ...fsRecouvrements.map((r) => ({ ...r, fondsCode: "secours" })),
                ].filter((r) => r.member_id === me.id);
                const recouvrementsUnpaid = recouvrementsMe.filter((r) => !r.paye);
                const recouvrementsPaidTotal = recouvrementsMe.filter((r) => r.paye).reduce((s, r) => s + Number(r.quote_part), 0);
                const recouvrementsDueTotal = recouvrementsUnpaid.reduce((s, r) => s + Number(r.quote_part), 0);
                const totalVerse = Number(me.inscription_paye || 0) + tontineTotal(me.id) + collationTotalMois(me.id)
                  + Number(me.fonds_urgence_paye || 0) + Number(me.fonds_secours_paye || 0) + memberDonTotal + recouvrementsPaidTotal;
                const dueNow = Math.max(0, inscriptionMontant - Number(me.inscription_paye || 0))
                  + Math.max(0, fondsUrgenceMontant - Number(me.fonds_urgence_paye || 0))
                  + Math.max(0, fondsSecoursMontant - Number(me.fonds_secours_paye || 0))
                  + recouvrementsDueTotal;
                const capRubriques = [
                  { paid: Number(me.inscription_paye || 0), due: inscriptionMontant },
                  { paid: tontineTotal(me.id), due: SEANCES.length * tontineMontantSeance },
                  { paid: collationTotalMois(me.id), due: collationDu(me.id) },
                  { paid: Number(me.fonds_urgence_paye || 0), due: fondsUrgenceMontant },
                  { paid: Number(me.fonds_secours_paye || 0), due: fondsSecoursMontant },
                ];
                const rubriquesReglees = capRubriques.filter((r) => r.due <= 0 || r.paid >= r.due).length;
                const dueHint = dueNow <= 0
                  ? t("ms_summary_due_hint_none")
                  : recouvrementsUnpaid.length > 0
                    ? t("ms_summary_due_hint_recouvrements").replace("{n}", String(recouvrementsUnpaid.length))
                    : t("ms_summary_due_hint_other");
                const inscriptionPct = inscriptionMontant > 0 ? (Number(me.inscription_paye || 0) / inscriptionMontant) * 100 : 100;
                const inscriptionOk = Number(me.inscription_paye || 0) >= inscriptionMontant;
                const collationPct = collationDu(me.id) > 0 ? (collationTotalMois(me.id) / collationDu(me.id)) * 100 : 100;
                const collationOk = collationTotalMois(me.id) >= collationDu(me.id);
                const urgencePct = fondsUrgenceMontant > 0 ? (Number(me.fonds_urgence_paye || 0) / fondsUrgenceMontant) * 100 : 100;
                const urgenceOk = Number(me.fonds_urgence_paye || 0) >= fondsUrgenceMontant;
                const secoursPct = fondsSecoursMontant > 0 ? (Number(me.fonds_secours_paye || 0) / fondsSecoursMontant) * 100 : 100;
                const secoursOk = Number(me.fonds_secours_paye || 0) >= fondsSecoursMontant;
                return (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <Avatar photoUrl={me.photo_url} name={me.nom} size={50} fontSize={16} />
                        <div>
                          <h3 style={{ margin: 0, fontSize: 19, fontFamily: "Poppins, sans-serif", color: "var(--primary)" }}>{me.nom}</h3>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", background: "#FBF3DA", color: "var(--accent)", padding: "3px 10px", borderRadius: 999 }}>
                              {t(ROLE_KEY_MAP[profile.role] || "role_adherent")}
                            </span>
                            <span style={{ fontSize: 12.5, color: "#8A8F98" }}>{association?.nom}</span>
                          </div>
                        </div>
                      </div>
                      {/* flexWrap (suite Phase 6, 2026-09-29) — trouvé pendant un test en
                          conditions réelles : ces 4 boutons ne repassaient jamais à la
                          ligne sur petit écran (contrairement à la rangée juste au-dessus,
                          qui l'a déjà), forçant toute cette section — et donc toute la
                          page — plus large que l'écran. C'est ce qui donnait l'impression
                          d'un « écran noir » en défilant horizontalement pour atteindre
                          le dernier bouton : ce n'était pas un bug d'affichage, mais ces
                          boutons qui sortaient réellement de l'écran. */}
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }} className="no-print">
                        <Btn variant="outline" onClick={() => setFullProfileMemberId(me.id)}><Wallet size={14} /> {t("ms_full_profile_btn")}</Btn>
                        <Btn variant="outline" onClick={() => setShowMyCard(true)}><QrCode size={14} /> {t("ms_card_btn")}</Btn>
                        <Btn variant="outline" onClick={() => setShowAllHistory((v) => !v)}><History size={14} /> {t("ms_all_history_toggle_btn")}</Btn>
                        <Btn variant="outline" onClick={() => window.print()}><Printer size={14} /> {t("ms_print_btn")}</Btn>
                      </div>
                    </div>

                    {/* Bénévolat et badge de membre (MesEngagements.jsx, 2026-10-10) */}
                    <MesEngagements me={me} association={association} />

                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 22 }}>
                      <div style={{ flex: "1 1 200px", background: "white", border: "1px solid #E7E9F1", borderRadius: 12, padding: "15px 18px", boxShadow: "0 3px 12px rgba(31,56,100,0.06)" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#9AA2B5" }}>{t("ms_summary_total_label")}</div>
                        <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 22, color: "var(--primary)", marginTop: 5, fontVariantNumeric: "tabular-nums" }}>{moneyF(totalVerse)}</div>
                        <div style={{ fontSize: 11.5, color: "#9AA2B5", marginTop: 3 }}>{t("ms_summary_total_hint")}</div>
                      </div>
                      <div style={{ flex: "1 1 200px", background: "white", border: "1px solid #E7E9F1", borderRadius: 12, padding: "15px 18px", boxShadow: "0 3px 12px rgba(31,56,100,0.06)" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#9AA2B5" }}>{t("ms_summary_due_label")}</div>
                        <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 22, color: dueNow > 0 ? AMBER : "var(--primary)", marginTop: 5, fontVariantNumeric: "tabular-nums" }}>{moneyF(dueNow)}</div>
                        <div style={{ fontSize: 11.5, color: "#9AA2B5", marginTop: 3 }}>{dueHint}</div>
                      </div>
                      <div style={{ flex: "1 1 200px", background: "white", border: "1px solid #E7E9F1", borderRadius: 12, padding: "15px 18px", boxShadow: "0 3px 12px rgba(31,56,100,0.06)" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#9AA2B5" }}>{t("ms_summary_settled_label")}</div>
                        <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 22, color: "var(--primary)", marginTop: 5, fontVariantNumeric: "tabular-nums" }}>{rubriquesReglees} / {capRubriques.length}</div>
                        <div style={{ fontSize: 11.5, color: "#9AA2B5", marginTop: 3 }}>{t("ms_summary_settled_hint")}</div>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "#9AA2B5", margin: "0 0 10px 2px" }}>{t("ms_section_rubriques")}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14 }}>
                      <MonEspaceCard
                        icon={IdCard} label={t("ms_inscription")}
                        paidLabel={moneyF(me.inscription_paye)} dueLabel={moneyF(inscriptionMontant)}
                        percent={inscriptionPct} progressTone={inscriptionOk ? "ok" : "warn"}
                        pillText={inscriptionOk ? t("ms_card_status_settled") : `${Math.round(inscriptionPct)} %`} pillTone={inscriptionOk ? "ok" : "warn"}
                        settled={inscriptionOk}
                        active={selectedPayType === "inscription"}
                        menuItems={buildMenuItems("inscription", !inscriptionOk)} menuAriaLabel={t("ms_menu_actions_label")}
                      />
                      <MonEspaceCard
                        icon={HeartHandshake} label={t("ms_tontine_paid")}
                        paidLabel={moneyF(tontineTotal(me.id))}
                        footNote={t("ms_card_since_period_start")}
                        active={selectedPayType === "cotisation"}
                        menuItems={buildMenuItems("cotisation", tontineTotal(me.id) < SEANCES.length * tontineMontantSeance)} menuAriaLabel={t("ms_menu_actions_label")}
                      />
                      <MonEspaceCard
                        icon={Coffee} label={t("ms_collation")}
                        paidLabel={moneyF(collationTotalMois(me.id))} dueLabel={moneyF(collationDu(me.id))}
                        percent={collationPct} progressTone={collationOk ? "ok" : "warn"}
                        pillText={collationOk ? t("ms_card_status_settled") : `${Math.round(collationPct)} %`} pillTone={collationOk ? "ok" : "warn"}
                        settled={collationOk}
                        active={selectedPayType === "collation"}
                        menuItems={buildMenuItems("collation", collationTotalMois(me.id) < collationDu(me.id))} menuAriaLabel={t("ms_menu_actions_label")}
                      />
                      <MonEspaceCard
                        icon={ShieldCheck} label={t("ms_fonds_urgence")}
                        paidLabel={moneyF(me.fonds_urgence_paye)} dueLabel={moneyF(fondsUrgenceMontant)}
                        percent={urgencePct} progressTone={urgenceOk ? "ok" : "warn"}
                        pillText={urgenceOk ? t("ms_card_status_settled") : `${Math.round(urgencePct)} %`} pillTone={urgenceOk ? "ok" : "warn"}
                        settled={urgenceOk}
                        active={selectedPayType === "fonds_urgence"}
                        menuItems={buildMenuItems("fonds_urgence", !urgenceOk)} menuAriaLabel={t("ms_menu_actions_label")}
                      />
                      <MonEspaceCard
                        icon={LifeBuoy} label={t("ms_fonds_secours")}
                        paidLabel={moneyF(me.fonds_secours_paye)} dueLabel={moneyF(fondsSecoursMontant)}
                        percent={secoursPct} progressTone={secoursOk ? "ok" : "warn"}
                        pillText={secoursOk ? t("ms_card_status_settled") : `${Math.round(secoursPct)} %`} pillTone={secoursOk ? "ok" : "warn"}
                        settled={secoursOk}
                        active={selectedPayType === "fonds_secours"}
                        menuItems={buildMenuItems("fonds_secours", !secoursOk)} menuAriaLabel={t("ms_menu_actions_label")}
                      />
                      <MonEspaceCard
                        icon={Gift} label={t("ms_label_don")}
                        paidLabel={moneyF(memberDonTotal)}
                        footNote={t("ms_card_thanks")}
                        active={selectedPayType === "don"}
                        menuItems={buildMenuItems("don", true)} menuAriaLabel={t("ms_menu_actions_label")}
                      />
                      {memberLoan && (
                        <MonEspaceCard
                          icon={Vote} label={t("ms_label_pret")}
                          paidLabel={moneyF(memberLoanSolde)}
                          pillText={t("ms_loan_remaining_suffix")} pillTone="debt" liability
                          active={selectedPayType === "pret"}
                          menuItems={buildMenuItems("pret", memberLoanSolde > 0)} menuAriaLabel={t("ms_menu_actions_label")}
                        />
                      )}
                    </div>
                  </>
                );
              })()}
              {selectedPayType && (() => {
                const typeLabels = {
                  inscription: t("ms_inscription"),
                  fonds_urgence: t("ms_fonds_urgence"),
                  fonds_secours: t("ms_fonds_secours"),
                  cotisation: t("ms_label_cotisation"),
                  collation: t("ms_collation"),
                  don: t("ms_label_don"),
                  pret: t("ms_label_pret"),
                  recouvrement: selectedRecouvrement
                    ? `${t("ms_label_recouvrement")} — ${selectedRecouvrement.fondsCode === "urgence" ? t("ms_urgence") : t("ms_secours")}`
                    : t("ms_label_recouvrement"),
                };
                const montantDueMap = {
                  inscription: Math.max(0, inscriptionMontant - Number(me.inscription_paye || 0)),
                  fonds_urgence: Math.max(0, fondsUrgenceMontant - Number(me.fonds_urgence_paye || 0)),
                  fonds_secours: Math.max(0, fondsSecoursMontant - Number(me.fonds_secours_paye || 0)),
                  cotisation: tontineMontantSeance,
                  collation: COLLATION_MENSUEL,
                };
                // Don et remboursement de prêt n'ont pas de montant fixe —
                // le membre le saisit librement (plafonné au solde restant
                // pour un prêt, libre pour un don). Le recouvrement, lui, a
                // un montant fixe mais propre à la ligne sélectionnée (une
                // quote-part précise), pas à un champ agrégé du membre.
                const isFreeAmount = selectedPayType === "don" || selectedPayType === "pret";
                const montantDue = selectedPayType === "recouvrement"
                  ? (selectedRecouvrement?.paye ? 0 : Number(selectedRecouvrement?.quote_part || 0))
                  : isFreeAmount ? parseDecimal(manualAmount) : (montantDueMap[selectedPayType] || 0);
                const interacEmail = (association?.interac_email || "").trim();
                const interacReference = `${typeLabels[selectedPayType]} - ${me.nom}`;
                // Pas d'option carte (Stripe) pour don/prêt — seul Interac est
                // proposé pour ces deux types, per la demande de l'utilisateur.
                const inInteracView = isFreeAmount || payMethod === "interac";
                // Détail par transaction pour la rubrique sélectionnée : une
                // ligne par paiement réellement confirmé, carte (Stripe) ou
                // Interac confondus — payment_transactions est le registre
                // unique alimenté par le webhook Stripe et par la
                // confirmation Interac du bureau (suite 50, 2026-09-10).
                // "periode" porte le numéro de séance ou le libellé de mois
                // pour cotisation/collation, ce qui donne la vraie date de
                // versement à côté du repère de période (plutôt que la date
                // de la séance elle-même, utilisée jusqu'ici).
                const txRows = paymentTransactions
                  .filter((tx) => tx.member_id === me.id && tx.type === selectedPayType && (selectedPayType !== "recouvrement" || tx.periode === selectedRecouvrement?.fondsCode))
                  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                  .map((tx) => ({ key: tx.id, date: tx.created_at, montant: tx.montant, methode: tx.methode, periodeLabel: txPeriodeLabel(tx) }));
                return (
                  <Card style={{ marginTop: 14, maxWidth: 480 }} className="no-print">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <h3 style={{ fontSize: 14.5, margin: 0 }}>{typeLabels[selectedPayType]}</h3>
                        {!isFreeAmount && <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>{t("ms_pay_panel_amount_due")} {moneyF(montantDue)}</p>}
                        {selectedPayType === "pret" && <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>{t("ms_loan_balance_label")} {moneyF(memberLoanSolde)}</p>}
                        {selectedPayType === "recouvrement" && selectedRecouvrement?.description && <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>{selectedRecouvrement.description}</p>}
                      </div>
                      <button onClick={() => { setSelectedPayType(null); setSelectedRecouvrement(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#686F7D", padding: 2 }} aria-label={t("action_close")}>
                        <X size={18} />
                      </button>
                    </div>

                    <button onClick={() => setShowTxDetail((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", color: "var(--primary)", fontSize: 12.5, fontWeight: 600, padding: 0, marginBottom: showTxDetail ? 10 : 14 }}>
                      <ChevronDown size={14} style={{ transform: showTxDetail ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
                      {showTxDetail ? t("ms_tx_detail_toggle_hide") : t("ms_tx_detail_toggle_show")}
                    </button>
                    {showTxDetail && (
                      <div style={{ marginBottom: 14, maxHeight: 220, overflow: "auto", border: "1px solid #EEE", borderRadius: 8 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("interac_claims_col_date")}</th>
                              <th style={{ textAlign: "left", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("ms_tx_detail_col_detail")}</th>
                              <th style={{ textAlign: "right", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("interac_claims_col_amount")}</th>
                              <th style={{ textAlign: "right", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("ms_tx_detail_col_method")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {txRows.map((row) => (
                              <tr key={row.key} style={{ borderTop: "1px solid #F0F0F0" }}>
                                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{new Date(row.date).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</td>
                                <td style={{ padding: "6px 8px" }}>{row.periodeLabel || "—"}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{moneyF(row.montant)}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                                  <Pill
                                    color={row.methode === "stripe" ? "var(--primary)" : row.methode === "interac" ? TEAL : "#686F7D"}
                                    bg={row.methode === "stripe" ? "#EEF1F8" : row.methode === "interac" ? TEAL_LIGHT : "#F1F2F4"}
                                  >
                                    {row.methode === "stripe" ? t("ms_tx_method_stripe") : row.methode === "interac" ? t("ms_tx_method_interac") : t("ms_tx_method_manuel")}
                                  </Pill>
                                </td>
                              </tr>
                            ))}
                            {txRows.length === 0 && (
                              <tr><td colSpan={4} style={{ padding: "10px 8px", color: "#686F7D", fontStyle: "italic", textAlign: "center" }}>{t("ms_tx_detail_none")}</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {memberInteracClaims(selectedPayType, selectedRecouvrement?.id).length > 0 && (() => {
                      const claimRows = memberInteracClaims(selectedPayType, selectedRecouvrement?.id);
                      const statusStyle = {
                        en_attente: { label: t("interac_claims_status_pending"), color: "#8A5A00", bg: "#FBF3DA" },
                        confirme: { label: t("interac_claims_status_confirmed"), color: TEAL, bg: TEAL_LIGHT },
                        rejete: { label: t("interac_claims_status_rejected"), color: RED, bg: "#FBE4E1" },
                        annule: { label: t("interac_claims_status_cancelled"), color: "#686F7D", bg: "#F1F2F4" },
                      };
                      return (
                        <>
                          <button onClick={() => setShowInteracHistory((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", color: "var(--primary)", fontSize: 12.5, fontWeight: 600, padding: 0, marginBottom: showInteracHistory ? 10 : 14 }}>
                            <ChevronDown size={14} style={{ transform: showInteracHistory ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
                            {showInteracHistory ? t("ms_interac_history_toggle_hide") : t("ms_interac_history_toggle_show")}
                          </button>
                          {showInteracHistory && (
                            <div style={{ marginBottom: 14, maxHeight: 220, overflow: "auto", border: "1px solid #EEE", borderRadius: 8 }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                                <thead>
                                  <tr>
                                    <th style={{ textAlign: "left", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("interac_claims_col_date")}</th>
                                    <th style={{ textAlign: "right", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("interac_claims_col_amount")}</th>
                                    <th style={{ textAlign: "left", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("interac_claims_col_status")}</th>
                                    <th style={{ textAlign: "right", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("interac_claims_col_file")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {claimRows.map((c) => {
                                    const s = statusStyle[c.statut] || statusStyle.en_attente;
                                    return (
                                      <tr key={c.id} style={{ borderTop: "1px solid #F0F0F0" }}>
                                        <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{new Date(c.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</td>
                                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{moneyF(c.montant_recu ?? c.montant)}</td>
                                        <td style={{ padding: "6px 8px" }}><Pill color={s.color} bg={s.bg}>{s.label}</Pill></td>
                                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                                          <button onClick={() => interacProofUrl(c)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: 2 }} aria-label={t("ms_menu_view_proof")}>
                                            <Eye size={14} />
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </>
                      );
                    })()}

                    {!isFreeAmount && montantDue <= 0 ? (
                      <p style={{ fontSize: 12.5, color: TEAL, fontWeight: 600, background: "#EAF7F3", padding: "10px 12px", borderRadius: 8 }}>{t("ms_pay_fully_settled")}</p>
                    ) : !inInteracView ? (
                      <>
                        <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 12 }}>{t("ms_pay_panel_choose_method")}</p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <Btn onClick={() => payerEnLigne(selectedPayType, selectedPayType === "recouvrement" ? { recouvrement_id: selectedRecouvrement?.id } : undefined)} disabled={payingType === selectedPayType}>
                            <CreditCard size={14} /> {payingType === selectedPayType ? t("ms_pay_online_loading") : t("ms_pay_method_card")}
                          </Btn>
                          <Btn variant="outline" onClick={() => setPayMethod("interac")}>
                            <Landmark size={14} /> {t("ms_pay_method_interac")}
                          </Btn>
                        </div>
                        <p style={{ fontSize: 11, color: "#686F7D", marginTop: 10 }}>{t("ms_pay_online_help")}</p>
                      </>
                    ) : interacEmail ? (() => {
                      const pending = pendingInteracClaim(selectedPayType, selectedRecouvrement?.id);
                      return (
                        <div>
                          {isFreeAmount && !pending && (
                            <Field label={selectedPayType === "pret" ? t("ms_pret_amount_label") : t("ms_don_amount_label")}>
                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="text" inputMode="decimal" style={inputStyle} value={manualAmount}
                                  onChange={(e) => setManualAmount(e.target.value)} placeholder="0.00" />
                                {selectedPayType === "pret" && (
                                  <Btn variant="outline" onClick={() => setManualAmount(String(memberLoanSolde))}>{t("ms_loan_repay_full_btn")}</Btn>
                                )}
                              </div>
                            </Field>
                          )}
                          <Field label={t("ms_interac_email_label")}>
                            <div style={{ display: "flex", gap: 8 }}>
                              <input readOnly style={{ ...inputStyle, background: "#FBF6EC" }} value={interacEmail} />
                              <Btn variant="outline" onClick={() => copyInteracText(interacEmail)}><Copy size={13} /></Btn>
                            </div>
                          </Field>
                          <Field label={t("ms_interac_reference_label")}>
                            <div style={{ display: "flex", gap: 8 }}>
                              <input readOnly style={{ ...inputStyle, background: "#FBF6EC" }} value={interacReference} />
                              <Btn variant="outline" onClick={() => copyInteracText(interacReference)}><Copy size={13} /></Btn>
                            </div>
                          </Field>
                          {!isFreeAmount && <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--primary)", marginBottom: 4 }}>{t("ms_interac_amount_label")} {moneyF(montantDue)}</p>}
                          {interacCopyMsg && <p style={{ fontSize: 12, color: TEAL, fontWeight: 600 }}>{interacCopyMsg}</p>}
                          <p style={{ fontSize: 11.5, color: "#686F7D", marginTop: 8, marginBottom: 14 }}>{t("ms_interac_note")}</p>
                          {pending ? (
                            <p style={{ fontSize: 12.5, color: TEAL, fontWeight: 600, background: "#EAF7F3", padding: "10px 12px", borderRadius: 8 }}>{t("ms_interac_pending_status")}</p>
                          ) : (
                            <>
                              <Field label={t("ms_interac_upload_label")}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <Btn variant="outline" onClick={() => interacFileInputRef.current?.click()}>{t("ms_interac_choose_file_btn")}</Btn>
                                  <span style={{ fontSize: 12, color: "#666" }}>{interacFile ? interacFile.name : t("ms_interac_no_file_chosen")}</span>
                                </div>
                                <input
                                  type="file" accept="image/*,.pdf" ref={interacFileInputRef} style={{ display: "none" }}
                                  onChange={(e) => setInteracFile(e.target.files?.[0] || null)}
                                />
                              </Field>
                              <Btn onClick={() => submitInteracProof(selectedPayType, montantDue, selectedPayType === "pret" ? memberLoan?.id : undefined, selectedPayType === "recouvrement" ? selectedRecouvrement?.id : undefined)} disabled={!interacFile || interacUploading || !(montantDue > 0)}>
                                {interacUploading ? t("ms_interac_submit_loading") : t("ms_interac_submit_btn")}
                              </Btn>
                              {!(montantDue > 0) && <p style={{ fontSize: 11.5, color: RED, marginTop: 6 }}>{t("ms_interac_hint_no_amount")}</p>}
                              {montantDue > 0 && !interacFile && <p style={{ fontSize: 11.5, color: RED, marginTop: 6 }}>{t("ms_interac_hint_no_file")}</p>}
                              {interacSubmitMsg && <p style={{ fontSize: 12, color: TEAL, fontWeight: 600, marginTop: 8 }}>{interacSubmitMsg}</p>}
                            </>
                          )}
                          <div><Btn variant="outline" style={{ marginTop: 10 }} onClick={() => (isFreeAmount ? setSelectedPayType(null) : setPayMethod(null))}>{t("action_cancel")}</Btn></div>
                        </div>
                      );
                    })() : (
                      <div>
                        <p style={{ fontSize: 12.5, color: RED }}>{t("ms_interac_not_configured")}</p>
                        <Btn variant="outline" style={{ marginTop: 8 }} onClick={() => (isFreeAmount ? setSelectedPayType(null) : setPayMethod(null))}>{t("action_cancel")}</Btn>
                      </div>
                    )}
                  </Card>
                );
              })()}
              {(() => {
                // Liste des recouvrements restylée façon "panneau d'action"
                // (suite 53, 2026-09-11, maquette « Relevé financier ») —
                // remplace l'ancien tableau brut, mêmes données et mêmes
                // actions (Payer/Reçu), rien de fonctionnel ne change.
                // Masquée entièrement si le membre n'a aucun recouvrement
                // (au lieu d'un tableau vide comme avant).
                const recouvrementsMe = [
                  ...fuRecouvrements.map((r) => ({ ...r, fonds: t("ms_urgence"), fondsCode: "urgence" })),
                  ...fsRecouvrements.map((r) => ({ ...r, fonds: t("ms_secours"), fondsCode: "secours" })),
                ].filter((r) => r.member_id === me.id);
                if (recouvrementsMe.length === 0) return null;
                const dueTotal = recouvrementsMe.filter((r) => !r.paye).reduce((s, r) => s + Number(r.quote_part), 0);
                return (
                  <Card style={{ marginTop: 24, borderLeft: `4px solid ${dueTotal > 0 ? AMBER : TEAL}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                      <h3 style={{ fontSize: 15, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                        <AlertTriangle size={16} color={dueTotal > 0 ? AMBER : TEAL} /> {t("ms_recoveries_title")}
                      </h3>
                      {dueTotal > 0 && (
                        <span style={{ fontSize: 12.5, color: "#8A8F98" }}>
                          {t("ms_recoveries_due_total_label")} <b style={{ color: AMBER, fontVariantNumeric: "tabular-nums" }}>{moneyF(dueTotal)}</b>
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {recouvrementsMe.map((r) => {
                        const dep = (r.fondsCode === "urgence" ? fuDepenses : fsDepenses).find((d) => d.id === r.depense_id);
                        return (
                          <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, background: "#F8F9FC", border: "1px solid #E7E9F1", borderRadius: 9, padding: "11px 14px", flexWrap: "wrap" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                              <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.paye ? TEAL : AMBER, flexShrink: 0 }} />
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--primary)" }}>{r.fonds}</div>
                                <div style={{ fontSize: 12, color: "#9AA2B5" }}>{dep?.description || t("ms_recovery_row_generic_desc")}</div>
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                              <span style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 14.5, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{moneyF(r.quote_part)}</span>
                              {!r.paye ? (
                                <button onClick={() => openRecouvrementPayPanel(r)} style={{ fontSize: 12, fontWeight: 600, color: "white", background: "var(--primary)", border: "none", borderRadius: 7, padding: "7px 13px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                                  <CreditCard size={12} /> {t("ms_recouvrement_pay_btn")}
                                </button>
                              ) : (
                                <button
                                  onClick={() => setReceiptFor({
                                    type: "recouvrement",
                                    typeLabel: `${t("ms_label_recouvrement")} — ${r.fonds}`,
                                    transactions: paymentTransactions.filter((tx) => tx.member_id === me.id && tx.type === "recouvrement" && tx.periode === r.fondsCode),
                                  })}
                                  style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)", background: "none", border: "1px solid var(--primary)", borderRadius: 7, padding: "6px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}
                                >
                                  <Receipt size={12} /> {t("ms_menu_download_receipt")}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })()}

              {/* Journal chronologique unique, toutes rubriques confondues
                  (suite 52, 2026-09-11) : vue "membre" demandée par
                  l'utilisateur — regroupe payment_transactions de tous les
                  types (inscription, cotisation, collation, fonds
                  d'urgence/secours, don, prêt, recouvrement) triées par
                  date décroissante, avec un filtre par rubrique. */}
              {showAllHistory && (() => {
                const allTypes = ["inscription", "fonds_urgence", "fonds_secours", "cotisation", "collation", "don", "pret", "recouvrement"];
                const allRows = paymentTransactions
                  .filter((tx) => tx.member_id === me.id && (allHistoryFilter === "all" || tx.type === allHistoryFilter))
                  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                return (
                  <Card style={{ marginTop: 20 }} className="no-print">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                      <h3 style={{ fontSize: 14.5, margin: 0 }}>{t("ms_all_history_title")}</h3>
                      <select style={{ ...inputStyle, width: "auto", fontSize: 12.5 }} value={allHistoryFilter} onChange={(e) => setAllHistoryFilter(e.target.value)}>
                        <option value="all">{t("ms_all_history_filter_all")}</option>
                        {allTypes.map((ty) => <option key={ty} value={ty}>{txTypeLabel({ type: ty })}</option>)}
                      </select>
                    </div>
                    <div style={{ maxHeight: 340, overflow: "auto", border: "1px solid #EEE", borderRadius: 8 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("interac_claims_col_date")}</th>
                            <th style={{ textAlign: "left", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("ms_all_history_col_rubrique")}</th>
                            <th style={{ textAlign: "right", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("interac_claims_col_amount")}</th>
                            <th style={{ textAlign: "right", padding: "6px 8px", background: "#FBF6EC", position: "sticky", top: 0 }}>{t("ms_tx_detail_col_method")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allRows.map((tx) => {
                            const periodeLabel = txPeriodeLabel(tx);
                            return (
                              <tr key={tx.id} style={{ borderTop: "1px solid #F0F0F0" }}>
                                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{new Date(tx.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</td>
                                <td style={{ padding: "6px 8px" }}>
                                  {txTypeLabel(tx)}
                                  {periodeLabel && <span style={{ color: "#686F7D" }}> — {periodeLabel}</span>}
                                </td>
                                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{moneyF(tx.montant)}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                                  <Pill
                                    color={tx.methode === "stripe" ? "var(--primary)" : tx.methode === "interac" ? TEAL : "#686F7D"}
                                    bg={tx.methode === "stripe" ? "#EEF1F8" : tx.methode === "interac" ? TEAL_LIGHT : "#F1F2F4"}
                                  >
                                    {tx.methode === "stripe" ? t("ms_tx_method_stripe") : tx.methode === "interac" ? t("ms_tx_method_interac") : t("ms_tx_method_manuel")}
                                  </Pill>
                                </td>
                              </tr>
                            );
                          })}
                          {allRows.length === 0 && (
                            <tr><td colSpan={4} style={{ padding: "10px 8px", color: "#686F7D", fontStyle: "italic", textAlign: "center" }}>{t("ms_all_history_none")}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                );
              })()}

              <MyAttendanceHistory profile={profile} />
              <MyVolunteerSpace profile={profile} />

              {receiptFor && (
                <ReceiptModal data={receiptFor} member={me} association={association} interacClaims={interacClaims} t={t} lang={lang} moneyF={moneyF} onClose={() => setReceiptFor(null)} />
              )}
              {loanTermsOpen && memberLoan && (
                <LoanTermsModal loan={memberLoan} association={association} t={t} lang={lang} moneyF={moneyF} loanInterestFor={loanInterestFor} loanTotalDueFor={loanTotalDueFor} loanRepaidFor={loanRepaidFor} onClose={() => setLoanTermsOpen(false)} />
              )}
            </>
          )}
        </Section></Container>
      )}

      {/* ================= NOUVEAUX MODULES ================= */}
      {tab === "gouvernance" && (isBureau || isAdherent) && (
        <Gouvernance profile={profile} isBureau={isBureau} association={association} lang={lang} />
      )}
      {tab === "vieassociative" && (isBureau || isResponsable || isAdherent) && (
        isPremiumPlan ? <VieAssociative profile={profile} isBureau={isBureau} announcements={announcements} onGoToAnnonces={() => setTab("annonces")} onFeedOpened={() => markViewed("vieassociative")} />
          : <Container><Section><PremiumLocked label={t("nav_community")} onUpgrade={goToForfait} features={[t("premium_feat_vieassociative_1"), t("premium_feat_vieassociative_2"), t("premium_feat_vieassociative_3")]} /></Section></Container>
      )}
      {tab === "presences" && isBureau && (
        isPremiumPlan ? <Presences profile={profile} isBureau={isBureau} association={association} onAssociationChange={onAssociationChange} />
          : <Container><Section><PremiumLocked label={t("nav_presences")} onUpgrade={goToForfait} features={[t("premium_feat_presences_1"), t("premium_feat_presences_2"), t("premium_feat_presences_3")]} /></Section></Container>
      )}
      {tab === "projets" && isBureau && (
        isPremiumPlan ? <Projets profile={profile} isBureau={isBureau} association={association} />
          : <Container><Section><PremiumLocked label={t("nav_projects")} onUpgrade={goToForfait} features={[t("premium_feat_projets_1"), t("premium_feat_projets_2"), t("premium_feat_projets_3")]} /></Section></Container>
      )}
      {tab === "evenements" && (isBureau || isResponsable || isAdherent) && (
        isPremiumPlan ? <Evenements profile={profile} isBureau={isBureau} association={association} />
          : <Container><Section><PremiumLocked label={t("nav_events")} onUpgrade={goToForfait} features={[t("premium_feat_evenements_1"), t("premium_feat_evenements_2"), t("premium_feat_evenements_3")]} /></Section></Container>
      )}
      {tab === "covoiturage" && (isBureau || isResponsable || isAdherent) && (
        !(association?.covoiturage_module_actif ?? true)
          ? <Container><Section><ModuleRestreintSuperAdmin label={t("nav_carpool")} /></Section></Container>
          : isPremiumPlan ? <Covoiturage profile={profile} isBureau={isBureau} association={association} />
            : <Container><Section><PremiumLocked label={t("nav_carpool")} onUpgrade={goToForfait} features={[t("premium_feat_covoiturage_1"), t("premium_feat_covoiturage_2"), t("premium_feat_covoiturage_3")]} /></Section></Container>
      )}
      {tab === "reunions" && (isBureau || isResponsable || isAdherent) && (
        isPremiumPlan ? <Reunions profile={profile} isBureau={isBureau} association={association} />
          : <Container><Section><PremiumLocked label={t("nav_meetings")} onUpgrade={goToForfait} features={[t("premium_feat_reunions_1"), t("premium_feat_reunions_2"), t("premium_feat_reunions_3")]} /></Section></Container>
      )}
      {tab === "emploi" && (isBureau || isResponsable || isAdherent) && (
        isPremiumPlan ? <Emploi profile={profile} isBureau={isBureau} association={association} />
          : <Container><Section><PremiumLocked label={t("nav_jobs")} onUpgrade={goToForfait} features={[t("premium_feat_emploi_1"), t("premium_feat_emploi_2"), t("premium_feat_emploi_3")]} /></Section></Container>
      )}

      {tab === "sondages" && (isBureau || isResponsable || isAdherent) && (
        isPremiumPlan ? <Sondages profile={profile} isBureau={isBureau} />
          : <Container><Section><PremiumLocked label={t("nav_polls")} onUpgrade={goToForfait} features={[t("premium_feat_sondages_1"), t("premium_feat_sondages_2"), t("premium_feat_sondages_3")]} /></Section></Container>
      )}
      {tab === "comite" && isBureau && comiteVisible && canSeeBureauModule("comite") && <ComiteRestreint profile={profile} association={association} />}
      {tab === "tirages" && (isBureau || isResponsable || isAdherent) && (
        isPremiumPlan ? <Tirages profile={profile} isBureau={isBureau} association={association} />
          : <Container><Section><PremiumLocked label={t("nav_draws")} onUpgrade={goToForfait} features={[t("premium_feat_tirages_1"), t("premium_feat_tirages_2"), t("premium_feat_tirages_3")]} /></Section></Container>
      )}
      {tab === "jeunesse" && (isBureau || isResponsable || isAdherent) && (
        isPremiumPlan ? <Jeunesse profile={profile} isBureau={isBureau} />
          : <Container><Section><PremiumLocked label={t("nav_jeunesse")} onUpgrade={goToForfait} features={[t("premium_feat_jeunesse_1"), t("premium_feat_jeunesse_2"), t("premium_feat_jeunesse_3")]} /></Section></Container>
      )}
      {tab === "achats" && (isBureau || isResponsable || isAdherent) && (
        isPremiumPlan ? <AchatsGroupes profile={profile} isBureau={isBureau} association={association} />
          : <Container><Section><PremiumLocked label={t("nav_achats")} onUpgrade={goToForfait} features={[t("premium_feat_achats_1"), t("premium_feat_achats_2"), t("premium_feat_achats_3")]} /></Section></Container>
      )}
      {tab === "funeraire" && (isBureau || isResponsable || isAdherent) && (
        isPremiumPlan ? <Funeraire profile={profile} isBureau={isBureau} isPresident={isPresident} association={association} />
          : <Container><Section><PremiumLocked label={t("nav_funeraire")} onUpgrade={goToForfait} features={[t("premium_feat_funeraire_1"), t("premium_feat_funeraire_2"), t("premium_feat_funeraire_3")]} /></Section></Container>
      )}
      {tab === "sanctions" && (isBureau || isAdherent) && (
        isPremiumPlan ? <Sanctions profile={profile} isBureau={isBureau} isPresident={isPresident} association={association} />
          : <Container><Section><PremiumLocked label={t("nav_sanctions")} onUpgrade={goToForfait} features={[t("premium_feat_sanctions_1"), t("premium_feat_sanctions_2"), t("premium_feat_sanctions_3")]} /></Section></Container>
      )}
      {tab === "dons" && isBureau && (
        <FinancesElargies profile={profile} isBureau={isBureau} mode="dons" association={association} />
      )}
      {tab === "emprunts" && isBureau && (
        <FinancesElargies profile={profile} isBureau={isBureau} mode="emprunts" association={association} />
      )}
      {tab === "securite" && (
        <SecuritySettings
          showPersonalLink={isBureau || isResponsable}
          personalEmail={profile.compte_personnel_email}
          onLinkPersonalAccount={linkPersonalAccount}
        />
      )}

      <footer className="no-print" style={{ background: "var(--primary-dark)", color: "rgba(255,255,255,.6)", padding: "18px 0", marginTop: 20 }}>
        <Container style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
          <span>&copy; {new Date().getFullYear()} {association?.nom}</span>
         <span>{t("footer_dev_by")} <b style={{ color: "var(--accent)" }}>Omnia Trade Solutions</b></span>
        </Container>
      </footer>

        </div>
        {/* fin .content-area */}
      </div>
      {/* fin .shell (sidebar + contenu) */}

      {editMemberId && (() => {
        const m = members.find((mm) => mm.id === editMemberId);
        if (!m) return null;
        return <EditMemberModal member={m} onClose={() => setEditMemberId(null)} onSave={(id, patch) => { if (window.confirm(t("mem_confirm_save_edit").replace("{nom}", m.nom))) patchMember(id, patch); }} t={t} />;
      })()}

      {editFondsPaiement && (() => {
        const m = members.find((mm) => mm.id === editFondsPaiement.memberId);
        if (!m) return null;
        const memberKey = editFondsPaiement.fonds === "urgence" ? "fonds_urgence" : "fonds_secours";
        return (
          <FondsPaiementEditModal
            member={m} memberKey={memberKey} t={t}
            onClose={() => setEditFondsPaiement(null)}
            onSave={(patch) => { if (window.confirm(t("fonds_confirm_edit_paiement").replace("{nom}", m.nom))) patchMember(m.id, patch); setEditFondsPaiement(null); }}
          />
        );
      })()}

      {editDepense && (() => {
        const depenses = editDepense.fonds === "urgence" ? fuDepenses : fsDepenses;
        const recs = editDepense.fonds === "urgence" ? fuRecouvrements : fsRecouvrements;
        const d = depenses.find((dd) => dd.id === editDepense.depenseId);
        if (!d) return null;
        const paidCount = recs.filter((r) => r.depense_id === editDepense.depenseId && r.paye).length;
        return (
          <DepenseEditModal
            depense={d} t={t} paidCount={paidCount}
            onClose={() => setEditDepense(null)}
            onSave={(patch) => { modifierDepense(editDepense.fonds, editDepense.depenseId, patch); setEditDepense(null); }}
          />
        );
      })()}

      {historyMemberId && (
        <MemberHistoryModal
          memberId={historyMemberId}
          onClose={() => { setHistoryMemberId(null); setHistoryFundFilter(null); }}
          t={t} lang={lang} members={members} moneyF={moneyF} depenseFondsMap={depenseFondsMap}
          fundFilter={historyFundFilter}
          canDeleteVersement={(historyFundFilter === "urgence" || historyFundFilter === "secours") ? canEditRubrique(historyFundFilter === "urgence" ? "fonds_urgence" : "fonds_secours") : false}
          onCancelVersement={(delta) => annulerVersementFonds(historyFundFilter, historyMemberId, delta)}
        />
      )}

      {fullProfileMemberId && (() => {
        const m = members.find((mm) => mm.id === fullProfileMemberId);
        if (!m) return null;
        return (
          <MemberFullProfileModal
            member={m} t={t} moneyF={moneyF}
            inscriptionMontant={inscriptionMontant}
            tontineMontantSeance={tontineMontantSeance} SEANCES={SEANCES}
            collationDu={collationDu} collationTotalMois={collationTotalMois} tontineTotal={tontineTotal}
            fuRecouvrements={fuRecouvrements} fsRecouvrements={fsRecouvrements}
            fuDepenses={fuDepenses} fsDepenses={fsDepenses}
            loans={loans}
            onClose={() => setFullProfileMemberId(null)}
            onOpenHistory={(fundFilter) => { setFullProfileMemberId(null); setHistoryMemberId(m.id); setHistoryFundFilter(fundFilter); }}
          />
        );
      })()}

      {showMyCard && me && (
        <MemberCardModal member={me} association={association} t={t} roleLabel={isBureau && ROLE_KEY_MAP[profile.role] ? t(ROLE_KEY_MAP[profile.role]) : null} onClose={() => setShowMyCard(false)} />
      )}

      {recouvHistoryMemberId && (
        <RecouvrementHistoryModal
          memberId={recouvHistoryMemberId}
          fonds={recouvHistoryFund}
          onClose={() => { setRecouvHistoryMemberId(null); setRecouvHistoryFund(null); }}
          t={t} lang={lang} members={members} moneyF={moneyF}
          recouvrements={recouvHistoryFund === "urgence" ? fuRecouvrements : fsRecouvrements}
          depenses={recouvHistoryFund === "urgence" ? fuDepenses : fsDepenses}
          canEdit={canEditRubrique(recouvHistoryFund === "urgence" ? "fonds_urgence" : "fonds_secours")}
          onMarkPaid={(id) => marquerRecouvrementPaye(recouvHistoryFund, id)}
        />
      )}

      {dechargeSeanceId && (() => {
        const s = seances.find((se) => se.id === dechargeSeanceId);
        if (!s) return null;
        const ben = members.find((mm) => mm.id === s.beneficiaire_id);
        const isCollation = s.type === "collation";
        const montant = isCollation ? collationMoisTotal(s.mois) : tontineSeanceTotal(s.numero);
        const docTitle = t(isCollation ? "coll_decharge_doc_title" : "tont_decharge_doc_title");
        const body = t(isCollation ? "coll_decharge_body" : "tont_decharge_body")
          .replace("{beneficiaire}", ben?.nom || "—")
          .replace("{association}", association?.nom || "")
          .replace("{montant}", moneyF(montant))
          .replace("{numero}", s.numero)
          .replace("{mois}", s.mois || "")
          .replace("{date}", s.date || todayISO());
        return (
          <DechargeModal
            seance={s} association={association} docTitle={docTitle} body={body} t={t} lang={lang}
            beneficiaire={ben} moneyF={moneyF}
            canEdit={canEditRubrique(isCollation ? "collation" : "tontine")}
            onClose={() => setDechargeSeanceId(null)}
            onMarkSigned={() => markDechargeSigned(s.id)}
            onSavePiece={(valeur) => savePieceIdentite(s.id, valeur)}
          />
        );
      })()}

      {versementSeanceId && (() => {
        const s = seances.find((se) => se.id === versementSeanceId);
        if (!s) return null;
        const isCollation = s.type === "collation";
        const montant = isCollation ? collationMoisTotal(s.mois) : tontineSeanceTotal(s.numero);
        const ben = members.find((mm) => mm.id === s.beneficiaire_id);
        return (
          <VersementModal
            seance={s} beneficiaire={ben} montantDefaut={montant} t={t}
            onClose={() => setVersementSeanceId(null)}
            onSave={(patch) => saveVersement(s.id, isCollation ? "collation" : "tontine", patch)}
            onUploadPreuve={(file) => uploadVersementPreuve(s.id, file)}
          />
        );
      })()}

      {pushPromptOpen && (
        <PushPromptModal
          t={t}
          onConfirm={() => { setPushPromptOpen(false); togglePush(); }}
          onClose={() => setPushPromptOpen(false)}
        />
      )}
    </div>
  );
}

// Reçu de paiement imprimable pour une rubrique de "Mon espace" — reprend
// le même patron que DechargeModal (portail + CSS scoping @media print à
// une classe dédiée) plutôt que d'introduire une dépendance PDF : le
// membre utilise "Imprimer" puis "Enregistrer en PDF" dans la boîte de
// dialogue d'impression de son navigateur (suite 50, 2026-09-10).
// Un seul reçu = la transaction confirmée la plus récente ; si plusieurs
// versements confirmés existent pour cette rubrique, ils sont tous listés
// à la manière d'un relevé.
// Formatte la référence d'une transaction en fonction de sa méthode —
// suite 50 (2026-09-10), à la demande de l'utilisateur d'avoir « toute
// info utile » sur la pièce ayant généré le paiement, directement sur le
// reçu imprimable (pas seulement le badge de méthode déjà affiché dans le
// tableau du détail). Pour Interac, on retrouve la demande d'origine
// (interac_payment_claims.id === payment_transactions.reference) afin de
// citer le nom du fichier déposé par le membre et la date de confirmation
// par le bureau — sans exposer l'identifiant technique brut, peu lisible.
function receiptReference(tx, interacClaims, t, locale) {
  if (tx.methode === "stripe") return `${t("ms_receipt_ref_stripe")} ${tx.reference || "—"}`;
  if (tx.methode === "interac") {
    const claim = (interacClaims || []).find((c) => c.id === tx.reference);
    let label = t("ms_receipt_ref_interac");
    if (claim?.fichier_nom) label += ` — ${claim.fichier_nom}`;
    if (claim?.confirmed_at) label += ` (${t("ms_receipt_ref_confirmed_on")} ${new Date(claim.confirmed_at).toLocaleDateString(locale)})`;
    return label;
  }
  return t("ms_receipt_ref_manuel");
}

// Initiales d'un signataire (ex. "Leonel Tsague" -> "LT"), affichées comme
// paraphe au-dessus de sa ligne de signature sur le reçu — à la demande de
// l'utilisateur, en complément du nom et du titre déjà affichés en dessous
// (suite 50, 2026-09-10).
function initialsOf(nom) {
  return (nom || "").trim().split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).slice(0, 3).join("");
}

function ReceiptModal({ data, member, association, interacClaims, t, lang, moneyF, onClose }) {
  const { type, typeLabel, transactions } = data;
  const locale = lang === "en" ? "en-CA" : "fr-CA";
  const signataire1 = association?.signataire1_nom || null;
  const signataire2 = association?.signataire2_nom || null;
  return createPortal(
    <div className="receipt-print-root" style={{ ...themeVarsFor(association), position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }} onClick={onClose}>
      <style>{`
        @media print {
          body > *:not(.receipt-print-root) { display: none !important; }
          .receipt-print-root { position: static !important; background: white !important; padding: 0 !important; display: block !important; }
          .receipt-no-print { display: none !important; }
          .receipt-card { box-shadow: none !important; max-height: none !important; overflow: visible !important; width: 100% !important; max-width: 100% !important; }
        }
      `}</style>
      <div className="receipt-card" style={{ background: "white", borderRadius: 12, padding: 32, maxWidth: 520, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="receipt-no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("ms_receipt_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          {association?.logo_url && <img src={association.logo_url} alt="" style={{ height: 40, width: 40, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />}
          <h3 style={{ margin: 0 }}>{association?.nom}</h3>
        </div>
        <OrgLegalSubline association={association} />
        <h4 style={{ marginBottom: 20, fontWeight: 600 }}>{t("ms_receipt_title")}</h4>
        {transactions.length === 0 ? (
          <p style={{ color: "#686F7D", fontStyle: "italic" }}>{t("ms_receipt_none")}</p>
        ) : (
          transactions.map((tx, i) => (
            <div key={tx.id} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: i < transactions.length - 1 ? "1px solid #EEE" : "none" }}>
              {tx.numero_recu != null && (
                <p style={{ fontSize: 11.5, margin: "0 0 6px", color: "#686F7D", fontWeight: 600, letterSpacing: 0.3 }}>{t("ms_receipt_number_label")} {String(tx.numero_recu).padStart(6, "0")}</p>
              )}
              <p style={{ fontSize: 13.5, margin: "4px 0" }}><b>{t("ms_receipt_member_label")}</b> {member?.nom}</p>
              <p style={{ fontSize: 13.5, margin: "4px 0" }}><b>{t("ms_receipt_type_label")}</b> {typeLabel}{tx.periode && tx.periode !== "octroi" && type !== "recouvrement" ? ` — ${tx.periode}` : ""}</p>
              <p style={{ fontSize: 13.5, margin: "4px 0" }}><b>{t("ms_receipt_date_label")}</b> {new Date(tx.created_at).toLocaleDateString(locale)}</p>
              <p style={{ fontSize: 15, margin: "4px 0", fontWeight: 700, color: TEAL }}>{t("ms_receipt_amount_label")} {moneyF(tx.montant)}</p>
              <p style={{ fontSize: 11.5, margin: "4px 0", color: "#686F7D" }}><b>{t("ms_receipt_reference_label")}</b> {receiptReference(tx, interacClaims, t, locale)}</p>
            </div>
          ))
        )}
        <p style={{ fontSize: 11, color: "#686F7D", marginTop: 10, whiteSpace: "pre-wrap" }}>{association?.recu_mention_legale || t("ms_receipt_footer")}</p>
        <p style={{ fontSize: 10.5, color: "#BBB", marginTop: 4 }}>{t("ms_receipt_printed_on")} {new Date().toLocaleString(locale)}</p>
        <div style={{ display: "flex", gap: 40, marginTop: 46, flexWrap: "wrap" }}>
          <div style={{ minWidth: 160 }}>
            {signataire1 && <div style={{ fontFamily: "cursive", fontStyle: "italic", fontSize: 22, color: "#1F3864", height: 28, lineHeight: "28px" }}>{initialsOf(signataire1)}</div>}
            <div style={{ borderTop: "1px solid #333", paddingTop: 6, fontSize: 11.5 }}>
              {signataire1 && <div style={{ fontWeight: 600 }}>{signataire1}</div>}
              <div style={{ color: "#666" }}>{association?.signataire1_titre || t("ms_receipt_signature1_fallback")}</div>
            </div>
          </div>
          <div style={{ minWidth: 160 }}>
            {signataire2 && <div style={{ fontFamily: "cursive", fontStyle: "italic", fontSize: 22, color: "#1F3864", height: 28, lineHeight: "28px" }}>{initialsOf(signataire2)}</div>}
            <div style={{ borderTop: "1px solid #333", paddingTop: 6, fontSize: 11.5 }}>
              {signataire2 && <div style={{ fontWeight: 600 }}>{signataire2}</div>}
              <div style={{ color: "#666" }}>{association?.signataire2_titre || t("ms_receipt_signature2_fallback")}</div>
            </div>
          </div>
        </div>
        {(signataire1 || signataire2) && (
          <p style={{ fontSize: 10.5, color: "#686F7D", fontStyle: "italic", marginTop: 10 }}>{t("ms_receipt_electronic_signature_note")}</p>
        )}
        <div className="receipt-no-print" style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <Btn onClick={() => window.print()}><Printer size={14} /> {t("fin_print_btn")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("tont_decharge_close")}</Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Détail des modalités d'un prêt (montant, taux, dates) — complète le
// tableau des remboursements déjà listé dans le détail des transactions
// (suite 50, 2026-09-10).
function LoanTermsModal({ loan, association, t, lang, moneyF, loanTotalDueFor, onClose }) {
  const locale = lang === "en" ? "en-CA" : "fr-CA";
  const statusLabelKey = { actif: "loan_status_active", rembourse: "loan_status_repaid" }[loan.statut] || null;
  return createPortal(
    <div style={{ ...themeVarsFor(association), position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 28, maxWidth: 440, width: "90%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("ms_loan_terms_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}><span style={{ color: "#5B6270" }}>{t("ms_loan_terms_amount")}</span><b>{moneyF(loan.montant_pret)}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}><span style={{ color: "#5B6270" }}>{t("ms_loan_terms_rate")}</span><b>{Number(loan.taux_interet) || 0}%</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}><span style={{ color: "#5B6270" }}>{t("ms_loan_terms_date")}</span><b>{loan.date_pret ? new Date(loan.date_pret).toLocaleDateString(locale) : "—"}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}><span style={{ color: "#5B6270" }}>{t("ms_loan_terms_due_date")}</span><b>{loan.date_echeance ? new Date(loan.date_echeance).toLocaleDateString(locale) : "—"}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, paddingTop: 8, borderTop: "1px solid #EEE" }}><span style={{ color: "#5B6270" }}>{t("ms_loan_terms_total_due")}</span><b style={{ color: TEAL }}>{moneyF(loanTotalDueFor(loan))}</b></div>
          {statusLabelKey && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}><span style={{ color: "#5B6270" }}>{t("ms_loan_terms_status")}</span><b>{t(statusLabelKey)}</b></div>}
        </div>
        <div style={{ marginTop: 20 }}>
          <Btn variant="outline" onClick={onClose}>{t("tont_decharge_close")}</Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DechargeModal({ seance, association, docTitle, body, t, lang, canEdit, onClose, onMarkSigned, onSavePiece, beneficiaire, moneyF }) {
  const todayFormatted = new Date().toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA");
  // Paraphe (initiales) du bénéficiaire au-dessus de sa ligne de signature,
  // et signatures du bureau (signataire1/2, réglés en Configuration) —
  // même patron que ReceiptModal (suite 50) — plus la mention de signature
  // électronique, demandés par l'utilisateur (suite 55, 2026-09-11).
  const beneficiaireNom = beneficiaire?.nom || null;
  const signataire1 = association?.signataire1_nom || null;
  const signataire2 = association?.signataire2_nom || null;
  return createPortal(
    <div className="decharge-print-root" style={{ ...themeVarsFor(association), position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }} onClick={onClose}>
      <style>{`
        @media print {
          body > *:not(.decharge-print-root) { display: none !important; }
          .decharge-print-root { position: static !important; background: white !important; padding: 0 !important; display: block !important; }
          .decharge-no-print { display: none !important; }
          .decharge-card { box-shadow: none !important; max-height: none !important; overflow: visible !important; width: 100% !important; max-width: 100% !important; }
        }
      `}</style>
      <div className="decharge-card" style={{ background: "white", borderRadius: 12, padding: 32, maxWidth: 560, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="decharge-no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{docTitle}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          {association?.logo_url && <img src={association.logo_url} alt="" style={{ height: 40, width: 40, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />}
          <h3 style={{ margin: 0 }}>{association?.nom}</h3>
        </div>
        <OrgLegalSubline association={association} />
        <h4 style={{ marginBottom: 8, fontWeight: 600 }}>{docTitle}</h4>
        {seance.numero_decharge != null && (
          <p style={{ fontSize: 11.5, margin: "0 0 16px", color: "#686F7D", fontWeight: 600, letterSpacing: 0.3 }}>{t("tont_decharge_number_label")} {String(seance.numero_decharge).padStart(6, "0")}</p>
        )}
        <p style={{ fontSize: 14, lineHeight: 1.7 }}>{body}</p>
        <div style={{ marginTop: 50, display: "flex", gap: 32, flexWrap: "wrap" }}>
          <div style={{ minWidth: 180 }}>
            {beneficiaireNom && <div style={{ fontFamily: "cursive", fontStyle: "italic", fontSize: 22, color: "#1F3864", height: 28, lineHeight: "28px" }}>{initialsOf(beneficiaireNom)}</div>}
            <div style={{ borderTop: "1px solid #333", paddingTop: 6, fontSize: 12, maxWidth: 280 }}>{t("tont_decharge_signature")}</div>
          </div>
          <div style={{ minWidth: 180 }}>
            {signataire1 && <div style={{ fontFamily: "cursive", fontStyle: "italic", fontSize: 22, color: "#1F3864", height: 28, lineHeight: "28px" }}>{initialsOf(signataire1)}</div>}
            <div style={{ borderTop: "1px solid #333", paddingTop: 6, fontSize: 11.5 }}>
              {signataire1 && <div style={{ fontWeight: 600 }}>{signataire1}</div>}
              <div style={{ color: "#666" }}>{association?.signataire1_titre || t("ms_receipt_signature1_fallback")}</div>
            </div>
          </div>
          <div style={{ minWidth: 180 }}>
            {signataire2 && <div style={{ fontFamily: "cursive", fontStyle: "italic", fontSize: 22, color: "#1F3864", height: 28, lineHeight: "28px" }}>{initialsOf(signataire2)}</div>}
            <div style={{ borderTop: "1px solid #333", paddingTop: 6, fontSize: 11.5 }}>
              {signataire2 && <div style={{ fontWeight: 600 }}>{signataire2}</div>}
              <div style={{ color: "#666" }}>{association?.signataire2_titre || t("ms_receipt_signature2_fallback")}</div>
            </div>
          </div>
        </div>
        {(beneficiaireNom || signataire1 || signataire2) && (
          <p style={{ fontSize: 10.5, color: "#686F7D", fontStyle: "italic", marginTop: 10 }}>{t("ms_receipt_electronic_signature_note")}</p>
        )}
        {seance.versement_methode && (
          <p style={{ fontSize: 12, color: TEAL, fontWeight: 600, marginTop: 14, marginBottom: 0 }}>
            {t("tont_decharge_versement_confirmed")
              .replace("{methode}", t("tont_versement_method_" + seance.versement_methode))
              .replace("{montant}", moneyF(seance.versement_montant))
              .replace("{date}", seance.versement_date ? new Date(seance.versement_date).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA") : "—")}
            {seance.versement_reference ? ` (${seance.versement_reference})` : ""}
          </p>
        )}
        <div style={{ marginTop: 20 }}>
          <Field label={t("tont_decharge_piece_id")}>
            <input disabled={!canEdit} defaultValue={seance.beneficiaire_piece_identite || ""} placeholder={t("tont_decharge_piece_placeholder")} onBlur={(e) => onSavePiece(e.target.value)} style={inputStyle} />
          </Field>
        </div>
        <div style={{ fontSize: 12, color: "#5B6270", marginTop: 6 }}>{t("date")} : <b>{todayFormatted}</b></div>
        <div className="decharge-no-print" style={{ display: "flex", gap: 10, marginTop: 30 }}>
          <Btn onClick={() => window.print()}><Printer size={14} /> {t("fin_print_btn")}</Btn>
          {canEdit && !seance.decharge_signee && <Btn variant="outline" onClick={onMarkSigned}>{t("tont_mark_signed")}</Btn>}
          <Btn variant="outline" onClick={onClose}>{t("tont_decharge_close")}</Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}

// =====================================================================
// Confirmer le versement de la cagnotte au bénéficiaire (Cotisation ou
// Collation) — suite 56 (2026-09-11), à la demande de l'utilisateur
// d'implémenter le "système de paiement" pour reverser ces montants aux
// bénéficiaires, avec les deux méthodes déjà en place ailleurs dans l'app
// (Stripe/Interac). Recherche faite avant de coder : ni Stripe ni Interac
// ne permettent aujourd'hui un vrai virement automatisé vers un tiers sans
// mise en place supplémentaire (Stripe Connect côté bénéficiaire, service
// tiers payant pour Interac Business) — l'utilisateur a choisi de
// construire d'abord cet enregistrement manuel + preuve (le bureau envoie
// l'argent lui-même en dehors de l'application, puis confirme ici), avec
// un modèle de données déjà prêt pour brancher un vrai déclenchement
// automatisé plus tard sans tout reconstruire.
// =====================================================================
function VersementModal({ seance, beneficiaire, montantDefaut, t, onClose, onSave, onUploadPreuve }) {
  const [methode, setMethode] = useState(seance.versement_methode || "interac");
  const [montant, setMontant] = useState(String(seance.versement_montant ?? montantDefaut ?? ""));
  const [date, setDate] = useState(seance.versement_date || todayISO());
  const [reference, setReference] = useState(seance.versement_reference || "");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  async function handleSave() {
    if (!montant) return;
    let preuvePath = seance.versement_preuve_path || null;
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
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("tont_versement_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {beneficiaire && <p style={{ fontSize: 12.5, color: "var(--primary)", fontWeight: 600, marginBottom: 10 }}>{beneficiaire.nom}</p>}
        <p style={{ fontSize: 11, color: "#686F7D", marginTop: -4, marginBottom: 16 }}>{t("tont_versement_help")}</p>
        <Field label={t("tont_versement_method_label")}>
          <select style={inputStyle} value={methode} onChange={(e) => setMethode(e.target.value)}>
            <option value="interac">{t("tont_versement_method_interac")}</option>
            <option value="stripe">{t("tont_versement_method_stripe")}</option>
            <option value="mobile_money">{t("tont_versement_method_mobile_money")}</option>
            <option value="virement_bancaire">{t("tont_versement_method_virement_bancaire")}</option>
            <option value="especes">{t("tont_versement_method_especes")}</option>
            <option value="cheque">{t("tont_versement_method_cheque")}</option>
            <option value="autre">{t("tont_versement_method_autre")}</option>
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
// Modifier une annonce — édition en ligne dans la carte elle-même
// (même pattern que EditPostForm pour le fil d'actualité de Vie associative).
// =====================================================================
function EditAnnouncementForm({ announcement, onSave, onCancel, onUploadImage, t, inputStyle }) {
  const [titre, setTitre] = useState(announcement.titre || "");
  const [message, setMessage] = useState(announcement.message || "");
  const [urgent, setUrgent] = useState(!!announcement.urgent);
  const [ackRequis, setAckRequis] = useState(!!announcement.accuse_reception_requis);
  const [imageUrl, setImageUrl] = useState(announcement.image_url || "");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  function handleSave() {
    if (!titre.trim()) return;
    onSave({ titre: titre.trim(), message, urgent, image_url: imageUrl || null, accuse_reception_requis: ackRequis });
  }
  return (
    <div>
      <input style={{ ...inputStyle, marginBottom: 8, fontWeight: 600 }} value={titre} onChange={(e) => setTitre(e.target.value)} />
      <textarea style={{ ...inputStyle, minHeight: 80, marginBottom: 8 }} value={message} onChange={(e) => setMessage(e.target.value)} />
      <select style={{ ...inputStyle, marginBottom: 10, maxWidth: 160 }} value={urgent ? "oui" : "non"} onChange={(e) => setUrgent(e.target.value === "oui")}>
        <option value="non">{t("mem_no")}</option><option value="oui">{t("mem_yes")}</option>
      </select>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10, fontSize: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={ackRequis} onChange={(e) => setAckRequis(e.target.checked)} style={{ marginTop: 2 }} />
        <span>{t("ann_ack_required_label")}</span>
      </label>
      {onUploadImage && (
        <div style={{ marginBottom: 10 }}>
          <input
            type="file" accept="image/*" ref={fileInputRef} style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0]; e.target.value = "";
              if (!file) return;
              setUploading(true);
              const url = await onUploadImage(file);
              setUploading(false);
              if (url) setImageUrl(url);
            }}
          />
          {imageUrl ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src={imageUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid #DDD" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button onClick={() => fileInputRef.current?.click()} style={{ fontSize: 11, color: "var(--primary)", background: "none", border: "1px solid var(--primary)", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>{t("ann_image_change_btn")}</button>
                <button onClick={() => setImageUrl("")} style={{ fontSize: 11, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>{t("ann_image_remove_btn")}</button>
              </div>
            </div>
          ) : (
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{ fontSize: 11, color: "var(--primary)", background: "none", border: "1px dashed #BBB", borderRadius: 8, padding: "8px 12px", cursor: uploading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <Upload size={12} /> {uploading ? t("ann_image_uploading") : t("ann_image_add_btn")}
            </button>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleSave} style={{ fontSize: 11, color: "white", background: "var(--primary)", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>{t("action_save")}</button>
        <button onClick={onCancel} style={{ fontSize: 11, color: "var(--primary)", background: "none", border: "1px solid var(--primary)", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>{t("action_cancel")}</button>
      </div>
    </div>
  );
}

// =====================================================================
// Corriger le montant payé / la date de paiement déjà enregistrés pour
// Fonds d'urgence ou Fonds de secours — suite 51 (2026-09-11), à la
// demande de l'utilisateur : le mécanisme "Ajouter un versement" ne fait
// qu'additionner, il n'offre aucun moyen de revenir sur une erreur de
// saisie (ex. un montant supérieur à ce qui était dû). Cette fenêtre
// montre la valeur exacte actuellement enregistrée et permet de la
// réécrire directement — le nom de l'adhérent reste en lecture seule ici
// (le modifier se fait depuis "Modifier l'adhérent", dans l'onglet
// Adhérents, pas depuis une fiche de paiement).
// =====================================================================
function FondsPaiementEditModal({ member, memberKey, onClose, onSave, t }) {
  const [montant, setMontant] = useState(String(member[memberKey + "_paye"] ?? 0));
  const [date, setDate] = useState(member[memberKey + "_date_paiement"] || "");
  function handleSave() {
    onSave({ [memberKey + "_paye"]: Number(montant) || 0, [memberKey + "_date_paiement"]: date || null });
  }
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 380, width: "92%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("fonds_edit_payment_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <Field label={t("member")}><input disabled value={member.nom} style={{ ...inputStyle, background: "#F1F2F4", cursor: "not-allowed" }} /></Field>
        <Field label={t("amount_paid")}><input type="number" step="0.01" style={inputStyle} value={montant} onChange={(e) => setMontant(e.target.value)} /></Field>
        <Field label={t("fonds_col_pay_date")}><input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 16 }}>{t("fonds_edit_payment_hint")}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={handleSave}>{t("action_save")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
        </div>
      </div>
    </div>
  );
}

// Explication en clair AVANT la demande de permission native du navigateur
// (suite 82, 2026-09-28) — voir le commentaire sur handleBellClick, dans
// MainApp, pour le pourquoi. Ce n'est PAS la demande de permission
// elle-même (celle-ci reste affichée par le navigateur, hors de notre
// contrôle) : juste une explication, dans la langue de l'utilisateur,
// affichée juste avant, pour que la demande du navigateur qui suit ait du
// sens.
function PushPromptModal({ t, onConfirm, onClose }) {
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 380, width: "92%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("push_prompt_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <p style={{ fontSize: 13, color: "#555", lineHeight: 1.5, marginTop: 0, marginBottom: 18 }}>{t("push_prompt_body")}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={onConfirm}>{t("push_prompt_confirm")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("push_prompt_cancel")}</Btn>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Modifier une dépense de Fonds urgence/secours déjà enregistrée — date,
// description et montant, tous modifiables (suite 51, 2026-09-11).
// Enregistrer déclenche toujours une resynchronisation de la répartition
// (voir modifierDepense) sur la liste actuelle d'adhérents éligibles, que
// le montant ait changé ou non — plus besoin d'un bouton "Recalculer"
// séparé.
// =====================================================================
function DepenseEditModal({ depense, onClose, onSave, t, paidCount = 0 }) {
  const [date, setDate] = useState(depense.date || "");
  const [description, setDescription] = useState(depense.description || "");
  const [montant, setMontant] = useState(String(depense.montant ?? ""));
  function handleSave() {
    if (!date || !montant) return;
    onSave({ date, description, montant: Number(montant) });
  }
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 380, width: "92%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("fonds_edit_expense_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <Field label={t("date")}><input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t("description")}><input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label={t("fonds_amount_total")}><input type="number" step="0.01" style={inputStyle} value={montant} onChange={(e) => setMontant(e.target.value)} /></Field>
        <p style={{ fontSize: 11, color: "#686F7D", marginTop: -8, marginBottom: 16 }}>{t("fonds_edit_expense_hint")}</p>
        {paidCount > 0 && (
          <p style={{ fontSize: 11.5, color: TEAL, background: TEAL_LIGHT, borderRadius: 8, padding: "8px 10px", marginTop: -8, marginBottom: 16 }}>
            {t("fonds_edit_expense_paid_frozen").replace("{n}", String(paidCount))}
          </p>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={handleSave}>{t("action_save")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Modifier un adhérent — mêmes champs que "Ajouter un adhérent", préremplis
// avec les valeurs actuelles, validés en une seule fois par un bouton
// "Enregistrer" (plutôt que des cases modifiables directement dans le
// tableau, qui manquaient de place pour l'adresse/les compétences/le
// bénévolat et créaient trop de petites cases côte à côte).
// =====================================================================
function EditMemberModal({ member, onClose, onSave, t }) {
  const [form, setForm] = useState({
    nom: member.nom || "", email: member.email || "", telephone: member.telephone || "", sexe: member.sexe || "", dateAdhesion: member.date_adhesion || "",
    statut: member.statut || "Actif", dateNaissance: member.date_naissance || "",
    quartier: member.quartier || "", competences: member.competences || "",
    disponibleBenevolat: !!member.disponible_benevolat,
  });
  function handleSave() {
    if (!form.nom.trim()) return;
    onSave(member.id, {
      nom: form.nom.trim(),
      email: form.email.trim() || null,
      telephone: form.telephone.trim() || null,
      sexe: form.sexe || null,
      date_adhesion: form.dateAdhesion || null,
      statut: form.statut,
      date_naissance: form.dateNaissance || null,
      quartier: form.quartier.trim() || null,
      competences: form.competences.trim() || null,
      disponible_benevolat: form.disponibleBenevolat,
    });
    onClose();
  }
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 640, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("mem_edit_title")} — {member.nom}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 20 }}>
          <Field label={t("mem_fullname")}><input style={inputStyle} value={form.nom} onChange={(e) => setForm((p) => ({ ...p, nom: e.target.value }))} /></Field>
          <Field label={t("mem_email")}><input style={inputStyle} value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></Field>
          <Field label={t("mem_phone")}><input type="tel" style={inputStyle} value={form.telephone} onChange={(e) => setForm((p) => ({ ...p, telephone: e.target.value }))} placeholder={t("mem_phone_placeholder")} /></Field>
          <Field label={t("mem_sexe")}>
            <select style={inputStyle} value={form.sexe} onChange={(e) => setForm((p) => ({ ...p, sexe: e.target.value }))}>
              <option value="">{t("mem_sexe_placeholder")}</option>
              <option value="M">{t("mem_sexe_m")}</option>
              <option value="F">{t("mem_sexe_f")}</option>
            </select>
          </Field>
          <Field label={t("mem_join_date")}><input type="date" style={inputStyle} value={form.dateAdhesion} onChange={(e) => setForm((p) => ({ ...p, dateAdhesion: e.target.value }))} /></Field>
          <Field label={t("mem_status")}>
            <select style={inputStyle} value={form.statut} onChange={(e) => setForm((p) => ({ ...p, statut: e.target.value }))}>
              <option>Actif</option><option>Inactif</option>
            </select>
          </Field>
          <Field label={t("mem_birthdate")}><input type="date" style={inputStyle} value={form.dateNaissance} onChange={(e) => setForm((p) => ({ ...p, dateNaissance: e.target.value }))} /></Field>
          <Field label={t("mem_address")}><input style={inputStyle} value={form.quartier} onChange={(e) => setForm((p) => ({ ...p, quartier: e.target.value }))} /></Field>
          <Field label={t("mem_skills")}><input style={inputStyle} value={form.competences} onChange={(e) => setForm((p) => ({ ...p, competences: e.target.value }))} placeholder={t("mem_skills_placeholder")} /></Field>
          <Field label={t("mem_volunteer")}>
            <select style={inputStyle} value={form.disponibleBenevolat ? "oui" : "non"} onChange={(e) => setForm((p) => ({ ...p, disponibleBenevolat: e.target.value === "oui" }))}>
              <option value="non">{t("mem_no")}</option><option value="oui">{t("mem_yes")}</option>
            </select>
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={handleSave}>{t("action_save")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("tont_decharge_close")}</Btn>
        </div>
      </div>
    </div>
  );
}

function MemberHistoryModal({ memberId, onClose, t, lang, members, moneyF, depenseFondsMap, fundFilter, canDeleteVersement, onCancelVersement }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const member = members.find((m) => m.id === memberId);

  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      const paymentTables = ["fonds_recouvrements", "loans", "loan_repayments"];
      const [membersRes, ...paymentResArr] = await Promise.all([
        supabase.from("activity_log").select("*").eq("table_name", "members").eq("record_id", memberId).order("created_at", { ascending: false }),
        ...paymentTables.map((tbl) =>
          supabase.from("activity_log").select("*").eq("table_name", tbl).eq("details->>member_id", memberId).order("created_at", { ascending: false })
        ),
      ]);
      const combined = [membersRes, ...paymentResArr].flatMap((r) => r.data || []);
      combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setLogs(combined);
      setLoading(false);
    }
    loadHistory();
  }, [memberId, reloadKey]);

  async function handleCancel(delta) {
    const ok = await onCancelVersement(delta);
    if (ok) setReloadKey((k) => k + 1);
  }

  // Quand fundFilter est actif ("urgence" ou "secours"), on ne garde que les entrées
  // qui concernent ce fonds précis (versements de la quote-part et recouvrements liés
  // aux dépenses de ce fonds) ; le reste (statut, autres champs, prêts, autre fonds...) est masqué.
  function describeChange(log) {
    const fondFieldsByFund = {
      urgence: ["fonds_urgence_paye", "fonds_urgence_date_paiement"],
      secours: ["fonds_secours_paye", "fonds_secours_date_paiement"],
      // Vue "Historique de l'adhérent" (ouverte depuis l'onglet Adhérents) : uniquement les
      // champs liés au profil/à l'adhésion — tout ce qui touche aux paiements (inscription,
      // collation, fonds, prêts) en est exclu, ces informations ayant leur propre historique
      // dans leurs onglets respectifs.
      adhesion: ["nom", "email", "telephone", "sexe", "date_adhesion", "date_naissance", "quartier", "competences", "disponible_benevolat", "motif_desactivation", "date_desactivation"],
    };
    const isAdhesionView = fundFilter === "adhesion";
    if (log.table_name === "fonds_recouvrements") {
      const ancien = log.details?.ancien;
      const nouveau = log.details?.nouveau;
      const fonds = depenseFondsMap[nouveau?.depense_id];
      if (fundFilter && fonds !== fundFilter) return null;
      if (log.action === "UPDATE" && ancien && nouveau && !ancien.paye && nouveau.paye) {
        const fundLabel = fonds === "urgence" ? t("nav_urgence") : fonds === "secours" ? t("nav_secours") : "";
        return { text: t("mem_hist_recouv_paid").replace("{fund}", fundLabel).replace("{amount}", moneyF(nouveau.quote_part)), versement: null };
      }
      return null;
    }
    if (fundFilter) {
      // Prêts et emprunts : sans lien avec les fonds urgence/secours, exclus de la vue filtrée.
      if (log.table_name === "loans" || log.table_name === "loan_repayments") return null;
    } else {
      if (log.table_name === "loans") {
        if (log.action === "INSERT") return { text: t("mem_hist_loan_granted").replace("{amount}", moneyF(log.details?.nouveau?.montant_pret)), versement: null };
        if (log.action === "UPDATE" && log.details?.ancien?.statut !== "rembourse" && log.details?.nouveau?.statut === "rembourse") {
          return { text: t("mem_hist_loan_repaid_full"), versement: null };
        }
        return null;
      }
      if (log.table_name === "loan_repayments") {
        if (log.action === "INSERT") return { text: t("mem_hist_loan_repayment").replace("{amount}", moneyF(log.details?.nouveau?.montant)), versement: null };
        return null;
      }
    }
    if (log.action === "INSERT") return (!fundFilter || isAdhesionView) ? { text: t("mem_hist_created"), versement: null } : null;
    if (log.action === "UPDATE" && log.details?.ancien && log.details?.nouveau) {
      const ancien = log.details.ancien;
      const nouveau = log.details.nouveau;
      const lines = [];
      let versement = null;
      const fieldLabels = {
        email: "Courriel", telephone: "Téléphone", sexe: "Sexe", quartier: "Adresse", competences: "Compétences",
        date_naissance: "Date de naissance", date_adhesion: "Date d'adhésion",
        disponible_benevolat: "Bénévolat", nom: "Nom",
        motif_desactivation: "Motif", date_desactivation: "Date de désactivation",
        photo_url: "Photo", inscription_paye: "Inscription payée", inscription_date: "Date d'inscription",
        collation_montant_paye: "Présence payée", fonds_urgence_paye: "Fonds urgence payé",
        fonds_secours_paye: "Fonds secours payé", fonds_urgence_date_paiement: "Date de paiement (Fonds urgence)",
        fonds_secours_date_paiement: "Date de paiement (Fonds secours)", bio: "Bio",
      };
      const skipFields = ["id", "created_at", "statut"];
      const allowedFields = fundFilter ? fondFieldsByFund[fundFilter] : null;

      if ((!fundFilter || isAdhesionView) && ancien.statut !== nouveau.statut) {
        let line = t("mem_hist_status_changed").replace("{old}", ancien.statut).replace("{new}", nouveau.statut);
        lines.push(line);
      }

      Object.keys(nouveau).forEach((key) => {
        if (skipFields.includes(key)) return;
        if (allowedFields && !allowedFields.includes(key)) return;
        if (ancien[key] === nouveau[key]) return;
        const label = fieldLabels[key] || key;
        if (key === "photo_url") {
          lines.push(nouveau[key] ? "Photo ajoutée/modifiée" : "Photo supprimée");
          return;
        }
        if (key === "disponible_benevolat") {
          lines.push(`Bénévolat : ${nouveau[key] ? "Oui" : "Non"}`);
          return;
        }
        if (key === "sexe") {
          lines.push(`Sexe : ${nouveau[key] === "M" ? "Masculin" : nouveau[key] === "F" ? "Féminin" : "—"}`);
          return;
        }
        if ((fundFilter === "urgence" || fundFilter === "secours") && key === fondFieldsByFund[fundFilter][0]) {
          const delta = Number(nouveau[key] || 0) - Number(ancien[key] || 0);
          if (delta > 0) versement = { fonds: fundFilter, delta };
        }
        const oldVal = ancien[key] === null || ancien[key] === "" ? "—" : String(ancien[key]);
        const newVal = nouveau[key] === null || nouveau[key] === "" ? "—" : String(nouveau[key]);
        lines.push(`${label} : ${t("mem_hist_from_to").replace("{old}", oldVal).replace("{new}", newVal)}`);
      });

      if (fundFilter && lines.length === 0) return null;
      return { text: lines.length > 0 ? lines.join(" · ") : t("mem_hist_field_changed"), versement };
    }
    return (!fundFilter || isAdhesionView) ? { text: log.action, versement: null } : null;
  }
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 600, width: "90%", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>
            {t("mem_history_title")} — {member?.nom}
            {(fundFilter === "urgence" || fundFilter === "secours") && <span style={{ fontSize: 12, fontWeight: 400, color: "#686F7D", marginLeft: 8 }}>({fundFilter === "urgence" ? t("nav_urgence") : t("nav_secours")})</span>}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {fundFilter === "adhesion" && member && (
          <div style={{ background: "#FBF6EC", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12.5, color: "#333", display: "flex", flexDirection: "column", gap: 4 }}>
            <div><b>{t("mem_phone")}</b> : {member.telephone || "—"}</div>
            <div><b>{t("mem_sexe")}</b> : {sexeLabel(member.sexe, t)}</div>
            <div><b>{t("mem_address")}</b> : {member.quartier || "—"}</div>
            <div><b>{t("mem_skills")}</b> : {member.competences || "—"}</div>
            <div><b>{t("mem_volunteer")}</b> : {member.disponible_benevolat ? t("mem_yes") : t("mem_no")}</div>
          </div>
        )}
        {loading ? (
          <p>{t("loading")}</p>
        ) : (() => {
          const visibleLogs = logs.map((l) => ({ l, desc: describeChange(l) })).filter((e) => e.desc);
          if (visibleLogs.length === 0) return <p style={{ color: "#686F7D", fontStyle: "italic" }}>{t("mem_history_no_activity")}</p>;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {visibleLogs.map(({ l, desc }) => (
                <div key={l.id} style={{ borderBottom: "1px solid #EEE", paddingBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#333" }}>{desc.text}</div>
                    <div style={{ fontSize: 11, color: "#686F7D", marginTop: 2 }}>{new Date(l.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</div>
                  </div>
                  {desc.versement && canDeleteVersement && (
                    <button onClick={() => handleCancel(desc.versement.delta)} style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Trash2 size={11} /> {t("fonds_delete_btn")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// Fiche complète de l'adhérent : vue consolidée, en lecture, de toutes les rubriques
// où l'adhérent contribue ou peut avoir un solde (inscription, tontine, collation,
// fonds d'urgence, fonds de secours, emprunts), ouverte via l'icône Wallet du tableau
// des Adhérents. Demande directe de l'utilisateur : « faire en sorte que soit lisible
// toutes les rubriques liées à cet adhérent ». Chaque section affiche un résumé payé/dû ;
// les sections urgence/secours/adhésion renvoient vers leur historique détaillé déjà
// existant (les autres rubriques ne sont pas journalisées dans activity_log, donc pas
// de lien "historique" pour elles).
function RubriqueBlock({ title, status, children }) {
  return (
    <div style={{ border: "1px solid #EEE", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
        <h4 style={{ fontSize: 13, margin: 0, color: "var(--primary)" }}>{title}</h4>
        {status}
      </div>
      {children}
    </div>
  );
}

function BalancePill({ paid, due, t }) {
  const ok = paid >= due;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, color: ok ? TEAL : "#8A5A00", background: ok ? TEAL_LIGHT : "#FBF3D9", border: `1.5px solid ${ok ? TEAL : "#D9B84A"}` }}>
      {ok ? t("mem_full_profile_uptodate") : t("mem_full_profile_pending")}
    </span>
  );
}

// =====================================================================
// Texte de présentation d'une photo de la galerie (suite 2026-10-06,
// demande explicite de l'utilisateur) — titre + description + lien
// optionnel, affichés dans le panneau latéral du diaporama plutôt qu'en
// simple surimpression. Voir sql/2026-10-06_galerie_photos_legendes.sql
// (colonnes description/lien_url/lien_label) et updateGalleryPhoto dans
// MainApp. Les trois champs sont facultatifs — une photo sans aucun
// texte reste affichable exactement comme avant.
// =====================================================================
function GalleryPhotoEditModal({ photo, t, onSave, onClose }) {
  const [legende, setLegende] = useState(photo.legende || "");
  const [description, setDescription] = useState(photo.description || "");
  const [lienUrl, setLienUrl] = useState(photo.lien_url || "");
  const [lienLabel, setLienLabel] = useState(photo.lien_label || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({
      legende: legende.trim() || null,
      description: description.trim() || null,
      lien_url: lienUrl.trim() || null,
      lien_label: lienLabel.trim() || null,
    });
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 14, padding: 24, maxWidth: 420, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, margin: 0 }}>{t("cfg_gallery_edit_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <img src={photo.url} alt="" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 8, marginBottom: 14 }} />
        <Field label={t("cfg_gallery_field_titre")}>
          <input style={inputStyle} value={legende} onChange={(e) => setLegende(e.target.value)} maxLength={80} placeholder={t("cfg_gallery_field_titre_placeholder")} />
        </Field>
        <Field label={t("cfg_gallery_field_description")}>
          <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} placeholder={t("cfg_gallery_field_description_placeholder")} />
        </Field>
        <p style={{ fontSize: 11, color: "#9AA2B5", margin: "0 0 10px" }}>{t("cfg_gallery_field_link_hint")}</p>
        <Field label={t("cfg_gallery_field_link_url")}>
          <input style={inputStyle} value={lienUrl} onChange={(e) => setLienUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label={t("cfg_gallery_field_link_label")}>
          <input style={inputStyle} value={lienLabel} onChange={(e) => setLienLabel(e.target.value)} maxLength={40} placeholder={t("cfg_gallery_field_link_label_placeholder")} />
        </Field>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <Btn onClick={handleSave} disabled={saving}>{saving ? t("saving_indicator") : t("sec_personal_account_save")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("tont_decharge_close")}</Btn>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Carte de membre numérique (QR code) — Phase 4, suite 91, 2026-09-28
// Affiche un QR code encodant l'adresse publique de vérification
// (?verify=<jeton>) : n'importe quel appareil photo peut le scanner et
// ouvrir cette adresse, aucun module de scan à construire dans
// l'application (choix confirmé par l'utilisateur via AskUserQuestion).
// Le jeton (members.verification_token) est distinct de members.id —
// scanner la carte d'un membre ne permet jamais de lister les autres.
// =====================================================================
// 2026-10-10 (signalé par l'utilisateur) : la carte à l'écran reprend
// exactement le modèle du badge PDF (evenementsPlus.dessinerBadgeMembre) —
// bandeau à la couleur de l'association avec logo, photo, rôle, « membre
// depuis », validité, QR et mentions légales. Une seule carte pour les
// événements et comme badge de présentation.
function MemberCardModal({ member, association, t, onClose, roleLabel }) {
  const { lang } = useLang();
  const P = txtEvPlus(lang);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [emisLe, setEmisLe] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    supabase.from("member_card_tokens").select("emis_le").eq("member_id", member.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setEmisLe(data?.emis_le || null); });
    return () => { cancelled = true; };
  }, [member.id]);
  // Code protégé de la carte (sql/2026-10-10c) : lu par mon_jeton_carte(),
  // lisible seulement par le membre lui-même — l'ancienne colonne
  // members.verification_token, lisible par tous, ne sert plus. Repli sur
  // elle tant que le script n'est pas exécuté.
  const [cardToken, setCardToken] = useState(null);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc("mon_jeton_carte").then(({ data, error }) => {
      if (!cancelled) setCardToken(!error && data ? data : member.verification_token);
    });
    return () => { cancelled = true; };
  }, [member.verification_token]);
  const verifyUrl = cardToken ? `${window.location.origin}/?verify=${cardToken}` : "";

  useEffect(() => {
    if (!verifyUrl) return;
    let cancelled = false;
    import("qrcode").then((QRCode) => {
      QRCode.toDataURL(verifyUrl, { width: 220, margin: 1 }).then((url) => {
        if (!cancelled) setQrDataUrl(url);
      });
    }).catch(() => { /* module QR indisponible : la carte reste affichable sans QR */ });
    return () => { cancelled = true; };
  }, [verifyUrl]);

  // Impression (suite 2026-10-06, demande explicite de l'utilisateur) —
  // même patron que ReceiptModal/DechargeModal plus bas : portail direct
  // vers document.body, indispensable pour que le sélecteur CSS
  // "body > *:not(.membercard-print-root)" ci-dessous cache bien tout le
  // reste de la page SANS cacher la carte elle-même (qui, sans portail,
  // serait un descendant de ce "tout le reste" et disparaîtrait avec).
  // themeVarsFor(association) redéclare --primary/--primary-dark/--accent
  // sur cette racine : le portail sort cette carte de l'arbre themé
  // (voir le <div style={{...theme}}> dans AuthenticatedApp) qui les
  // fournissait jusqu'ici par héritage CSS normal.
  return createPortal(
    <div className="membercard-print-root" style={{ ...themeVarsFor(association), position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <style>{`
        @media print {
          body > *:not(.membercard-print-root) { display: none !important; }
          .membercard-print-root { position: static !important; background: white !important; padding: 0 !important; display: block !important; }
          .membercard-no-print { display: none !important; }
          .membercard-card { box-shadow: none !important; width: 440px !important; max-width: 440px !important; margin: 24px auto !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      <div className="membercard-card" style={{ background: "white", borderRadius: 14, maxWidth: 440, width: "94%", overflow: "hidden", border: "1px solid #C8CDD6", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }} onClick={(e) => e.stopPropagation()}>
        {/* Bandeau à la couleur de l'association */}
        <div style={{ background: "var(--primary)", color: "white", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
          {association?.logo_url && <img src={association.logo_url} alt="" style={{ height: 34, maxWidth: 70, objectFit: "contain", background: "white", borderRadius: 6, padding: 2 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{association?.nom}</div>
            <div style={{ fontSize: 10, letterSpacing: ".06em", opacity: 0.9 }}>{P.card}</div>
          </div>
          <button className="membercard-no-print" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 17, color: "white" }} aria-label={t("action_close")}>✕</button>
        </div>
        {/* Photo à gauche, renseignements au centre, QR à droite */}
        <div style={{ display: "flex", gap: 12, padding: 14, alignItems: "flex-start" }}>
          {member.photo_url ? (
            <img src={member.photo_url} alt="" style={{ width: 72, height: 72, objectFit: "cover", border: "2px solid var(--primary)", flexShrink: 0 }} />
          ) : (
            <div style={{ width: 72, height: 72, background: "#F2F3F6", border: "2px solid var(--primary)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 22, flexShrink: 0 }}>
              {initialsOf(member.nom).slice(0, 2) || "?"}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#000", lineHeight: 1.2 }}>{member.nom}</div>
            <div style={{ fontSize: 12, fontWeight: 700, fontStyle: "italic", margin: "3px 0 6px" }}>{roleLabel || P.member}</div>
            {(() => {
              const j = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(String(member.date_adhesion || ""));
              return j ? <div style={{ fontSize: 11.5, color: "#333" }}>{P.since.replace("{d}", new Date(+j[1], +j[2] - 1, +j[3]).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA"))}</div> : null;
            })()}
            {(() => {
              const fin = finValiditeBadge(association, emisLe);
              const expiree = fin && fin < new Date();
              return (
                <div style={{ fontSize: 11.5, fontWeight: 700, color: expiree ? RED : "#000", marginTop: 2 }}>
                  {fin ? P.validUntil.replace("{d}", fin.toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA", { day: "numeric", month: "long", year: "numeric" })) : P.valid.replace("{y}", String(new Date().getFullYear()))}
                </div>
              );
            })()}
            <div style={{ fontSize: 11, color: member.statut === "Actif" ? TEAL : RED, fontWeight: 600, marginTop: 6 }}>
              {member.statut === "Actif" ? t("ms_card_status_active") : t("ms_card_status_inactive")}
            </div>
          </div>
          <div style={{ flexShrink: 0 }}>
            {qrDataUrl ? <img src={qrDataUrl} alt="QR" style={{ width: 118, height: 118, display: "block" }} />
              : <div style={{ width: 118, height: 118, display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA2B5", fontSize: 11 }}>{t("load_generic")}</div>}
          </div>
        </div>
        {/* Mentions légales */}
        {mentionsLegales(association).length > 0 && (
          <div style={{ fontSize: 9, color: "#333", padding: "0 14px 10px", lineHeight: 1.35 }}>{mentionsLegales(association).join(" - ")}</div>
        )}
        <p className="membercard-no-print" style={{ fontSize: 10.5, color: "#6B7280", margin: 0, padding: "8px 14px", borderTop: "1px solid #EEF0F3", textAlign: "center" }}>{t("ms_card_help")}</p>
        <div className="membercard-no-print" style={{ display: "flex", gap: 10, padding: "0 14px 14px", justifyContent: "center", flexWrap: "wrap" }}>
          <Btn onClick={() => window.print()}><Printer size={14} /> {t("fin_print_btn")}</Btn>
          <Btn variant="outline" disabled={pdfBusy || !cardToken} onClick={async () => {
            setPdfBusy(true);
            try { await downloadMemberBadgesPdf([{ ...member, verification_token: cardToken, emis_le: emisLe, role_label: roleLabel || P.member }], { association, lang, fileName: "mon_badge_membre.pdf" }); }
            catch (e) { alert(friendlyError(e, t)); }
            finally { setPdfBusy(false); }
          }}><Download size={14} /> PDF</Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}

function MemberFullProfileModal({
  member, onClose, t, moneyF,
  inscriptionMontant, tontineMontantSeance, SEANCES,
  collationDu, collationTotalMois, tontineTotal,
  fuRecouvrements, fsRecouvrements, fuDepenses, fsDepenses,
  loans, onOpenHistory,
}) {
  if (!member) return null;
  const mId = member.id;
  const inscPaid = Number(member.inscription_paye || 0);
  const tontinePaid = tontineTotal(mId);
  const tontineDueTotal = SEANCES.length * tontineMontantSeance;
  const collPaid = collationTotalMois(mId);
  const collDueTotal = collationDu(mId);
  const urgPaid = Number(member.fonds_urgence_paye || 0);
  const secPaid = Number(member.fonds_secours_paye || 0);
  const myRecUrg = fuRecouvrements.filter((r) => r.member_id === mId);
  const myRecSec = fsRecouvrements.filter((r) => r.member_id === mId);
  const myLoans = loans.filter((l) => l.member_id === mId);
  const urgDueTotal = myRecUrg.reduce((s, r) => s + Number(r.quote_part || 0), 0);
  const secDueTotal = myRecSec.reduce((s, r) => s + Number(r.quote_part || 0), 0);
  const depenseLabel = (depId, list) => (list.find((d) => d.id === depId)?.description) || t("mem_full_profile_expense_default");

  const lineStyle = { display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#444", padding: "4px 0", borderBottom: "1px solid #F3F3F1" };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 680, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("mem_full_profile_title")} — {member.nom}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        <RubriqueBlock title={t("mem_full_profile_section_adhesion")}>
          <div style={{ fontSize: 12.5, color: "#333", display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            <div><b>{t("mem_phone")}</b> : {member.telephone || "—"}</div>
            <div><b>{t("mem_sexe")}</b> : {sexeLabel(member.sexe, t)}</div>
            <div><b>{t("mem_email")}</b> : {member.email || "—"}</div>
            <div><b>{t("mem_address")}</b> : {member.quartier || "—"}</div>
            <div><b>{t("mem_skills")}</b> : {member.competences || "—"}</div>
            <div><b>{t("mem_volunteer")}</b> : {member.disponible_benevolat ? t("mem_yes") : t("mem_no")}</div>
            <div><b>{t("mem_col_join")}</b> : {member.date_adhesion || "—"}</div>
          </div>
          <button onClick={() => onOpenHistory("adhesion")} style={{ background: "none", border: "none", color: "var(--primary)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>
            {t("mem_full_profile_view_history")}
          </button>
        </RubriqueBlock>

        <RubriqueBlock title={t("nav_inscription")} status={<BalancePill paid={inscPaid} due={inscriptionMontant} t={t} />}>
          <div style={lineStyle}><span>{t("mem_full_profile_paid")}</span><span>{moneyF(inscPaid)}</span></div>
          <div style={{ ...lineStyle, borderBottom: "none" }}><span>{t("mem_full_profile_due")}</span><span>{moneyF(inscriptionMontant)}</span></div>
        </RubriqueBlock>

        <RubriqueBlock title={t("nav_tontine")} status={<BalancePill paid={tontinePaid} due={tontineDueTotal} t={t} />}>
          <div style={lineStyle}><span>{t("mem_full_profile_paid")}</span><span>{moneyF(tontinePaid)}</span></div>
          <div style={{ ...lineStyle, borderBottom: "none" }}><span>{t("mem_full_profile_due")}</span><span>{moneyF(tontineDueTotal)}</span></div>
        </RubriqueBlock>

        <RubriqueBlock title={t("nav_collation")} status={<BalancePill paid={collPaid} due={collDueTotal} t={t} />}>
          <div style={lineStyle}><span>{t("mem_full_profile_paid")}</span><span>{moneyF(collPaid)}</span></div>
          <div style={{ ...lineStyle, borderBottom: "none" }}><span>{t("mem_full_profile_due")}</span><span>{moneyF(collDueTotal)}</span></div>
        </RubriqueBlock>

        <RubriqueBlock title={t("nav_urgence")} status={<BalancePill paid={urgPaid} due={urgDueTotal} t={t} />}>
          <div style={lineStyle}><span>{t("mem_full_profile_paid")}</span><span>{moneyF(urgPaid)}</span></div>
          {myRecUrg.length === 0 ? (
            <p style={{ fontSize: 12, color: "#686F7D", fontStyle: "italic", margin: "4px 0" }}>{t("mem_full_profile_no_recouv")}</p>
          ) : myRecUrg.map((r) => (
            <div key={r.id} style={lineStyle}>
              <span>{depenseLabel(r.depense_id, fuDepenses)}</span>
              <span>{moneyF(r.quote_part)} {r.paye ? "✓" : `(${t("mem_full_profile_pending")})`}</span>
            </div>
          ))}
          <button onClick={() => onOpenHistory("urgence")} style={{ background: "none", border: "none", color: "var(--primary)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, marginTop: 8 }}>
            {t("mem_full_profile_view_history")}
          </button>
        </RubriqueBlock>

        <RubriqueBlock title={t("nav_secours")} status={<BalancePill paid={secPaid} due={secDueTotal} t={t} />}>
          <div style={lineStyle}><span>{t("mem_full_profile_paid")}</span><span>{moneyF(secPaid)}</span></div>
          {myRecSec.length === 0 ? (
            <p style={{ fontSize: 12, color: "#686F7D", fontStyle: "italic", margin: "4px 0" }}>{t("mem_full_profile_no_recouv")}</p>
          ) : myRecSec.map((r) => (
            <div key={r.id} style={lineStyle}>
              <span>{depenseLabel(r.depense_id, fsDepenses)}</span>
              <span>{moneyF(r.quote_part)} {r.paye ? "✓" : `(${t("mem_full_profile_pending")})`}</span>
            </div>
          ))}
          <button onClick={() => onOpenHistory("secours")} style={{ background: "none", border: "none", color: "var(--primary)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, marginTop: 8 }}>
            {t("mem_full_profile_view_history")}
          </button>
        </RubriqueBlock>

        <RubriqueBlock title={t("nav_loans")}>
          {myLoans.length === 0 ? (
            <p style={{ fontSize: 12, color: "#686F7D", fontStyle: "italic", margin: "4px 0" }}>{t("mem_full_profile_no_loans")}</p>
          ) : myLoans.map((l) => (
            <div key={l.id} style={lineStyle}>
              <span>{moneyF(l.montant_pret)} · {Number(l.taux_interet) || 0}% · {l.date_echeance || "—"}</span>
              <span>{l.statut === "rembourse" ? t("loan_status_rembourse") : t("loan_status_actif")}</span>
            </div>
          ))}
        </RubriqueBlock>
      </div>
    </div>
  );
}

function RecouvrementHistoryModal({ memberId, fonds, onClose, t, members, moneyF, recouvrements, depenses, canEdit, onMarkPaid }) {
  const member = members.find((m) => m.id === memberId);
  const depenseById = {};
  (depenses || []).forEach((d) => { depenseById[d.id] = d; });
  const rows = (recouvrements || [])
    .filter((r) => r.member_id === memberId)
    .map((r) => ({ r, d: depenseById[r.depense_id] }))
    .sort((a, b) => new Date(b.d?.date || 0) - new Date(a.d?.date || 0));
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 600, width: "90%", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>
            {t("fonds_recovery_history_title")} — {member?.nom}
            <span style={{ fontSize: 12, fontWeight: 400, color: "#686F7D", marginLeft: 8 }}>({fonds === "urgence" ? t("nav_urgence") : t("nav_secours")})</span>
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {rows.length === 0 ? (
          <p style={{ color: "#686F7D", fontStyle: "italic" }}>{t("mem_history_no_activity")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map(({ r, d }) => (
              <div key={r.id} style={{ borderBottom: "1px solid #EEE", paddingBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 13, color: "#333" }}>{d?.description || "—"} — {moneyF(r.quote_part)}</div>
                  <div style={{ fontSize: 11, color: "#686F7D", marginTop: 2 }}>
                    {d?.date || "—"}
                    {r.paye && r.date_paiement ? ` · ${t("fonds_col_pay_date")} : ${r.date_paiement}` : ""}
                  </div>
                </div>
                {r.paye ? (
                  <span style={{ fontSize: 11, fontWeight: 700, color: TEAL, flexShrink: 0 }}>{t("paid")}</span>
                ) : canEdit ? (
                  <button onClick={() => onMarkPaid(r.id)} style={{ fontSize: 11, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", flexShrink: 0 }}>{t("fonds_mark_paid")}</button>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 700, color: RED, flexShrink: 0 }}>{t("unpaid")}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}