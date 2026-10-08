import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Users, LayoutDashboard, HeartHandshake, FileBarChart, Plus, ShieldCheck,
  CheckCircle2, Circle, Coffee, LifeBuoy, IdCard, Loader2, AlertTriangle,
 Bell, FileText, History, Settings, Printer, LogOut, Download, Eye, EyeOff, Trash2, Pencil,
  Landmark, Rss, Kanban, CalendarDays, Gift, Vote, Building2, KeyRound, Copy, RefreshCw, CreditCard, X, ChevronDown,
  MoreVertical, Ban, Receipt, FileSignature, Upload, BarChart3, Wallet, Flower2,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { LangProvider, LanguageSwitcher, useLang, friendlyError } from "./shared";
import PresentationAssociation from "./PresentationAssociation";
import GestionAcces from "./GestionAcces.jsx";
import Gouvernance from "./Gouvernance.jsx";
import VieAssociative from "./VieAssociative.jsx";
import Projets from "./Projets";
import Evenements from "./Evenements";
import Sondages from "./Sondages";
import Funeraire from "./Funeraire";
import FinancesElargies from "./FinancesElargies";
import PaymentHistory from "./PaymentHistory";
import FinanceSynthese from "./FinanceSynthese";

// =====================================================================
// CONSTANTES
// =====================================================================
const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const MONTH_KEYS = ["m_jan", "m_feb", "m_mar", "m_apr", "m_may", "m_jun", "m_jul", "m_aug", "m_sep", "m_oct", "m_nov", "m_dec"];
// Fréquence des réunions (Cotisation/Collation) : nombre de séances suivies par an selon la
// fréquence choisie par l'association (par défaut "mois" = comportement historique inchangé).
const PERIODES_PAR_AN = { semaine: 52, quinzaine: 26, trois_semaines: 17, mois: 12 };
const FREQ_LABEL_PREFIX = { semaine: "Semaine", quinzaine: "Quinzaine", trois_semaines: "Période" };
const TEAL = "#2E8B74";
const TEAL_LIGHT = "#E4F2EE";
const RED = "#C0392B";
const AMBER = "#B8860B";
const CHARCOAL = "#2A2A2A";
const BG = "#F8F8F6";
const GOLD_LIGHT = "#E8CE7A";

const ROLE_LABELS = {
  super_admin: "Super-administrateur",
  bureau_president: "Président(e)",
  bureau_secretaire: "Secrétaire",
  bureau_tresorier: "Trésorier(ère)",
  responsable_rubrique: "Responsable de rubrique",
  adherent: "Adhérent",
};
const RUBRIQUE_LABELS = {
  inscription: "Inscription", tontine: "Cotisation", collation: "Collation (Présence)",
  fonds_urgence: "Fonds d'urgence", fonds_secours: "Fonds de secours",
};const ROLE_KEY_MAP = {
  super_admin: "role_super_admin", bureau_president: "role_bureau_president",
  bureau_secretaire: "role_bureau_secretaire", bureau_tresorier: "role_bureau_tresorier",
  responsable_rubrique: "role_responsable_rubrique", adherent: "role_adherent",
};
const RUBRIQUE_KEY_MAP = {
  inscription: "nav_inscription", tontine: "nav_tontine", collation: "nav_collation",
  fonds_urgence: "nav_urgence", fonds_secours: "nav_secours",
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
  finances: "doc_cat_finances",
  vie_associative: "doc_cat_vie_associative",
  projets: "doc_cat_projets",
  evenements: "doc_cat_evenements",
  dons: "doc_cat_dons",
  emprunts: "doc_cat_emprunts",
  autre: "doc_cat_autre",
};

function money(n, devise = "CAD") {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}
function uid() { return Math.random().toString(36).slice(2, 10); }
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
  posts: "jrn_table_posts", elections: "jrn_table_elections",
  election_candidats: "jrn_table_election_candidats", election_votes: "jrn_table_election_votes",
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
  if (action === "INSERT") return "#2E8B74";
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
  return <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 4px 18px rgba(31,56,100,0.08)", borderTop: "3px solid transparent", ...style }} {...rest}>{children}</div>;
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
function Field({ label, children }) {
  return <div style={{ marginBottom: 14 }}><label style={{ display: "block", fontWeight: 600, fontSize: 13, color: "var(--primary)", marginBottom: 5 }}>{label}</label>{children}</div>;
}
const inputStyle = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #DCE0E8", fontSize: 14, fontFamily: "inherit", background: "white", boxSizing: "border-box" };
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
function Table({ head, children }) {
  return (
    <div style={{ overflowX: "auto", background: "white", borderRadius: 12, boxShadow: "0 4px 18px rgba(31,56,100,0.08)" }}>
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
      <PlatformAppInner />
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

if (authLoading) return <FullPageLoader text={t("load_generic")} />;
  if (!session) return <AuthScreen />;
  return <AuthenticatedApp session={session} />;
}

function FullPageLoader({ text }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: BG, fontFamily: "Inter, sans-serif", flexDirection: "column", gap: 12 }}>
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <Loader2 size={28} color="#1F3864" className="spin" />
      <p style={{ color: "#1F3864", fontWeight: 600 }}>{text}</p>
    </div>
  );
}

function BlockedAccountScreen() {
  const { t } = useLang();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: BG, fontFamily: "Inter, sans-serif", flexDirection: "column", gap: 14, padding: 24, textAlign: "center" }}>
      <ShieldCheck size={36} color={RED} />
      <h2 style={{ color: "#1F3864", margin: 0 }}>{t("blocked_title")}</h2>
      <p style={{ color: "#5B6270", maxWidth: 380, margin: 0 }}>{t("blocked_text")}</p>
      <Btn onClick={() => supabase.auth.signOut()} style={{ background: "#1F3864", color: "white" }}>{t("action_logout")}</Btn>
    </div>
  );
}

// =====================================================================
// ÉCRAN D'AUTHENTIFICATION (connexion + création d'association)
// =====================================================================
function AuthScreen() {
  const { t } = useLang();
  const [mode, setMode] = useState("login"); // 'login' | 'signup' | 'join' | 'mfa'
  const [email, setEmail] = useState("");
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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(150deg,#1F3864,#152645)", fontFamily: "Inter, sans-serif", padding: 20 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap');`}</style>
      <div style={{ background: "white", borderRadius: 16, padding: 36, width: 420, maxWidth: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
       <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <div style={{ width: 36, height: 36, borderRadius: 10, background: "#1F3864", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <HeartHandshake size={18} color="#C9A227" />
    </div>
    <span style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 19, color: "#1F3864" }}>{t("auth_platform_title")}</span>
  </div>
  <div style={{ background: "#1F3864", borderRadius: 6 }}><LanguageSwitcher /></div>
</div>

        {mode === "login" && (
          <form onSubmit={handleLogin}>
           <h2 style={{ fontFamily: "Poppins, sans-serif", fontSize: 18, marginBottom: 16, color: "#1F3864" }}>{t("auth_login_title")}</h2>
            <Field label={t("auth_email")}><input type="email" required style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label={t("auth_password")}>
  <div style={{ position: "relative" }}>
    <input type={showPassword ? "text" : "password"} required style={{ ...inputStyle, paddingRight: 40 }} value={password} onChange={(e) => setPassword(e.target.value)} />
    <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#999", padding: 0 }}>
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
            <Btn type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", background: "#C9A227", color: "#152645" }}>
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
          <h2 style={{ fontFamily: "Poppins, sans-serif", fontSize: 18, marginBottom: 8, color: "#1F3864" }}>{t("auth_mfa_title")}</h2>
           <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 16 }}>{t("auth_mfa_desc")}</p>
           <Field label={t("sec_verif_code")}><input required maxLength={6} style={inputStyle} value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="123456" /></Field>
            {err && <p style={{ color: RED, fontSize: 12.5, marginBottom: 12 }}>{err}</p>}
            <Btn type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", background: "#C9A227", color: "#152645" }}>
             {busy ? t("auth_verifying") : t("auth_verify_btn")}
            </Btn>
          </form>
        )}
        {mode === "signup" && (
          <form onSubmit={handleSignup}>
            <h2 style={{ fontFamily: "Poppins, sans-serif", fontSize: 18, marginBottom: 16, color: "#1F3864" }}>{t("auth_signup_title")}</h2>
            <Field label={t("auth_org_name")}><input required style={inputStyle} value={nomAssociation} onChange={(e) => setNomAssociation(e.target.value)} /></Field>
            <Field label={t("auth_full_name")}><input required style={inputStyle} value={nomComplet} onChange={(e) => setNomComplet(e.target.value)} /></Field>
            <Field label={t("auth_email")}><input type="email" required style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={t("auth_password")}>
              <div style={{ position: "relative" }}>
                <input type={showPassword ? "text" : "password"} required minLength={6} style={{ ...inputStyle, paddingRight: 40 }} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#999", padding: 0 }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            {err && <p style={{ color: err.startsWith("Compte créé") ? TEAL : RED, fontSize: 12.5, marginBottom: 12 }}>{err}</p>}
            <Btn type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", background: "#C9A227", color: "#152645" }}>
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
            <h2 style={{ fontFamily: "Poppins, sans-serif", fontSize: 18, marginBottom: 6, color: "#1F3864" }}>{t("auth_join_title")}</h2>
            <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 16 }}>{t("auth_join_desc")}</p>
            <Field label={t("auth_invite_code")}><input required style={{ ...inputStyle, textTransform: "uppercase" }} value={codeInvitation} onChange={(e) => setCodeInvitation(e.target.value.toUpperCase())} placeholder="EX1234AB" /></Field>
            <Field label={t("auth_full_name_join")}><input required style={inputStyle} value={nomComplet} onChange={(e) => setNomComplet(e.target.value)} /></Field>
            <Field label={t("auth_email")}><input type="email" required style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={t("auth_password")}>
              <div style={{ position: "relative" }}>
                <input type={showPassword ? "text" : "password"} required minLength={6} style={{ ...inputStyle, paddingRight: 40 }} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#999", padding: 0 }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            {err && <p style={{ color: err.startsWith("Compte créé") ? TEAL : RED, fontSize: 12.5, marginBottom: 12 }}>{err}</p>}
            <Btn type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", background: "#C9A227", color: "#152645" }}>
              {busy ? "…" : t("auth_join_btn")}
            </Btn>
            <p style={{ fontSize: 12.5, marginTop: 16, color: "#5B6270" }}>
              <a href="#" onClick={(e) => { e.preventDefault(); setMode("login"); setErr(""); }} style={{ color: TEAL, fontWeight: 600 }}>{t("auth_back_login")}</a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// APPLICATION AUTHENTIFIÉE — charge le profil puis route par rôle
// =====================================================================
// =====================================================================
// SÉCURITÉ — activation de l'authentification à deux facteurs (TOTP)
// =====================================================================
function SecuritySettings() {
  const { t } = useLang();
  const [factors, setFactors] = useState([]);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState(null);
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

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

  return (
    <Container><Section>
     <h2 style={{ marginBottom: 14 }}>{t("sec_title")}</h2>
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

        if (pending) {
          const rpcCall = pending.mode === "join"
            ? supabase.rpc("join_association_with_code", { p_code: pending.code, p_nom_complet: pending.nomComplet })
            : supabase.rpc("create_association_for_new_user", { p_nom_association: pending.nomAssociation, p_nom_complet: pending.nomComplet });
          const { error: rpcErr } = await rpcCall;
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
      if (prof.association_id && !prof.compte_bloque) {
        const [{ data: assoc, error: e2 }, { data: sub }] = await Promise.all([
          supabase.from("associations").select("*").eq("id", prof.association_id).single(),
          supabase.from("subscriptions").select("*").eq("association_id", prof.association_id).order("created_at", { ascending: false }).limit(1).single(),
        ]);
        if (e2) throw e2;
        setAssociation(assoc);
        setSubscription(sub || null);
      }
    } catch (e) {
      setErr(t("load_profile_error") + " " + friendlyError(e, t));
    } finally {
      setLoading(false);
    }
  }, [session.user.id]);

  useEffect(() => { load(); }, [load]);

 if (loading) return <FullPageLoader text={t("load_space")} />;
if (err) return <FullPageLoader text={err} />;
if (!profile) return <FullPageLoader text={t("load_profile_missing")} />;
if (profile.compte_bloque) return <BlockedAccountScreen />;

  const primary = association?.couleur_primaire || "#1F3864";
  const accent = association?.couleur_accent || "#C9A227";
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
        onAssociationChange={setAssociation} onLogout={confirmLogout} />
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
  const primary = association?.couleur_primaire || "#1F3864";
  const accent = association?.couleur_accent || "#C9A227";
  return { "--primary": primary, "--primary-dark": shade(primary, -18), "--accent": accent };
}

// =====================================================================
// PANNEAU SUPER-ADMINISTRATEUR
// =====================================================================
function SuperAdminPanel({ profile, onLogout }) {
  const { t } = useLang();
  const [associations, setAssociations] = useState([]);
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newAssoc, setNewAssoc] = useState({ nom: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: a }, { data: s }] = await Promise.all([
      supabase.from("associations").select("*").order("created_at", { ascending: false }),
      supabase.from("subscriptions").select("*"),
    ]);
    setAssociations(a || []); setSubs(s || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createAssociation() {
    if (!newAssoc.nom.trim()) return;
    if (!window.confirm(t("sa_confirm_create_org").replace("{nom}", newAssoc.nom.trim()))) return;
    const { data, error } = await supabase.from("associations").insert({ nom: newAssoc.nom }).select().single();
    if (!error) {
      await supabase.from("subscriptions").insert({ association_id: data.id, plan: "essai", statut: "actif" });
      setNewAssoc({ nom: "" });
      load();
    }
  }
  async function updateSub(subId, patch) {
    await supabase.from("subscriptions").update(patch).eq("id", subId);
    load();
  }

 if (loading) return <FullPageLoader text={t("load_superadmin")} />;

  return (
    <div style={{ fontFamily: "Inter, sans-serif", background: BG, minHeight: "100vh" }}>
      <header style={{ background: "#1F3864", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, color: "white", fontSize: 18 }}>{t("sa_header_title")}</span>
      <Btn variant="outlineWhite" onClick={onLogout}><LogOut size={14} /> {t("action_logout")}</Btn>
      </header>
      <Container>
        <Section>
         <h2 style={{ fontFamily: "Poppins, sans-serif", color: "#1F3864", marginBottom: 20 }}>{t("sa_orgs_title")}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 22 }}>
            <Card style={{ borderTopColor: "#C9A227" }}>
             <h3 style={{ fontSize: 14, marginBottom: 12, color: "#1F3864" }}>{t("sa_create_org")}</h3>
             <Field label={t("sa_name")}><input style={inputStyle} value={newAssoc.nom} onChange={(e) => setNewAssoc({ nom: e.target.value })} /></Field>
              <Btn onClick={createAssociation} style={{ background: "#C9A227", color: "#152645" }}><Plus size={14} /> {t("sa_create_btn")}</Btn>
            </Card>
           <Table head={[t("sa_col_org"), t("sa_col_created"), t("sa_col_plan"), t("sa_col_status"), t("sa_col_period_end"), t("sa_col_actions")]}>
              {associations.map((a) => {
                const sub = subs.find((s) => s.association_id === a.id);
                return (
                  <tr key={a.id}>
                    <td style={{ ...td, fontWeight: 600, color: "#1F3864" }}>{a.nom}</td>
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
                    <td style={td}><span style={{ fontSize: 11, color: "#999" }}>ID: {a.id.slice(0, 8)}…</span></td>
                  </tr>
                );
              })}
            </Table>
          </div>
          <p style={{ fontSize: 12, color: "#999", marginTop: 20, maxWidth: 700 }}>
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
function MainApp({ profile, association, subscription, onAssociationChange, onLogout }) {
 const { t, lang } = useLang();
  const [tab, setTab] = useState("apercu");
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
    } catch {}
  }

  const isBureau = ["bureau_president", "bureau_secretaire", "bureau_tresorier"].includes(profile.role);
  const isPresident = profile.role === "bureau_president";
  const isResponsable = profile.role === "responsable_rubrique";
  const isAdherent = profile.role === "adherent";
  function canEditRubrique(name) { return isBureau || (isResponsable && profile.rubrique_assignee === name); }

  const [members, setMembers] = useState([]);
  const [collationPres, setCollationPres] = useState([]);
  const [tontinePres, setTontinePres] = useState([]);
  const [seances, setSeances] = useState([]);
  const [fuDepenses, setFuDepenses] = useState([]);
  const [fsDepenses, setFsDepenses] = useState([]);
  const [fuRecouvrements, setFuRecouvrements] = useState([]);
  const [fsRecouvrements, setFsRecouvrements] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [announcementAcks, setAnnouncementAcks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [donations, setDonations] = useState([]);
  const [loans, setLoans] = useState([]);
  const [loanRepayments, setLoanRepayments] = useState([]);
  const [bureauProfiles, setBureauProfiles] = useState([]);
  const [deletionRequests, setDeletionRequests] = useState([]);
  const [pendingLinkRequestsCount, setPendingLinkRequestsCount] = useState(0);
  const [interacClaims, setInteracClaims] = useState([]);
  const [paymentTransactions, setPaymentTransactions] = useState([]);

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
      ]);
      const [mem, colPres, tonPres, seancesData, depensesData, recouvrementsData, ann, log, docs, dons, lns, repays, bProfiles, delReqs] = results.slice(0, 14).map((r) => r.data || []);
      setPendingLinkRequestsCount(results[14]?.count || 0);
      // Requêtes tolérantes : ne bloquent pas le chargement du reste de
      // l'application si ces tables (suites 49-50, 64) n'existent pas
      // encore (script SQL pas encore exécuté) — se contentent d'une liste
      // vide dans ce cas plutôt que de faire échouer tout loadAll().
      setInteracClaims(results[15]?.error ? [] : (results[15]?.data || []));
      setPaymentTransactions(results[16]?.error ? [] : (results[16]?.data || []));
      setAnnouncementAcks(results[17]?.error ? [] : (results[17]?.data || []));
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

  const activeMembers = members.filter((m) => m.statut === "Actif");const visibleMembers = members.filter((m) => m.statut !== "Supprimé");
  const nbActifs = activeMembers.length;
  const devise = association?.devise_monetaire || "CAD";
  const moneyF = (n) => money(n, devise);
  const depenseFondsMap = Object.fromEntries([...fuDepenses, ...fsDepenses].map((d) => [d.id, d.fonds]));

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
  function collationDu(memberId) { return periodKeys.length * COLLATION_MENSUEL; }
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
  function nextUnpaidMois(memberId) { return periodKeys.find((mo) => collationMontant(memberId, mo) <= 0) ?? null; }
  function beneficiaryCount(memberId) { return seances.filter((s) => s.beneficiaire_id === memberId).length; }
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
  const [versementDrafts, setVersementDrafts] = useState({});

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
    const beneficiaires = fonds === "secours" ? activeMembers.filter((m) => estEligibleRecouvrementSecours(m, association)) : activeMembers;
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
    const beneficiaires = fonds === "secours" ? activeMembers.filter((m) => estEligibleRecouvrementSecours(m, association)) : activeMembers;
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

  async function ajouterVersementFonds(fonds, memberId) {
    const memberKey = fonds === "urgence" ? "fonds_urgence" : "fonds_secours";
    if (!canEditRubrique(memberKey)) return;
    const draftKey = fonds + "-" + memberId;
    const montant = Number(versementDrafts[draftKey]);
    if (!montant || montant <= 0) { setErrorMsg(t("fonds_versement_invalide")); return; }
    const m = members.find((x) => x.id === memberId);
    const nouveauTotal = Number(m?.[memberKey + "_paye"] || 0) + montant;
    await patchMember(memberId, { [memberKey + "_paye"]: nouveauTotal, [memberKey + "_date_paiement"]: todayISO() });
    setVersementDrafts((prev) => ({ ...prev, [draftKey]: "" }));
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
  function confirmedInteracClaims(type) {
    return memberInteracClaims(type).filter((c) => c.statut === "confirme");
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
  const [brandDraft, setBrandDraft] = useState(association || {});
  useEffect(() => { setBrandDraft(association || {}); }, [association]);
  const [savedCard, setSavedCard] = useState(null);
  async function saveBranding(cardId) {
    if (!isBureau) return;
    const cardLabels = {
      branding: t("cfg_branding_card_title"),
      montants: t("cfg_montants_title"),
      funeraire: t("cfg_funeraire_title"),
      secours: t("cfg_secours_title"),
      approbateur: t("cfg_approbateur_title"),
      signataires: t("cfg_signataires_title"),
    };
    if (cardId === "funeraire" && brandDraft.funeraire_main_levee_actif === false && !brandDraft.funeraire_organisme_tiers_actif) {
      alert(t("cfg_funeraire_au_moins_un_requis"));
      return;
    }
    if (!window.confirm(t("cfg_confirm_save_section").replace("{section}", cardLabels[cardId] || cardId))) return;
    setSaving(true); setErrorMsg("");
    const { data, error } = await supabase.from("associations").update({
      nom: brandDraft.nom, logo_url: brandDraft.logo_url, devise_texte: brandDraft.devise_texte,
      devise_monetaire: brandDraft.devise_monetaire, couleur_primaire: brandDraft.couleur_primaire, couleur_accent: brandDraft.couleur_accent,
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
      funeraire_main_levee_actif: brandDraft.funeraire_main_levee_actif !== false,
      funeraire_organisme_tiers_actif: !!brandDraft.funeraire_organisme_tiers_actif,
      funeraire_periode_probation_jours: brandDraft.funeraire_periode_probation_jours ? Number(brandDraft.funeraire_periode_probation_jours) : null,
      funeraire_montant_inscription: brandDraft.funeraire_montant_inscription ? Number(brandDraft.funeraire_montant_inscription) : null,
      funeraire_montant_deces: brandDraft.funeraire_montant_deces ? Number(brandDraft.funeraire_montant_deces) : null,
      funeraire_montant_recharge: brandDraft.funeraire_montant_recharge ? Number(brandDraft.funeraire_montant_recharge) : null,
      funeraire_seuil_alerte: brandDraft.funeraire_seuil_alerte ? Number(brandDraft.funeraire_seuil_alerte) : null,
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

  // ---------- Navigation par rôle ----------
  const navItems = [{ id: "apercu", label: t("nav_apercu"), icon: Building2 }];
  if (isBureau) {
    navItems.push(
  { id: "dashboard", label: t("nav_dashboard"), icon: LayoutDashboard },
  { id: "membres", label: t("nav_members"), icon: Users },
  { id: "inscription", label: t("nav_inscription"), icon: IdCard },
  { id: "tontine", label: t("nav_tontine"), icon: HeartHandshake },
  { id: "collation", label: t("nav_collation"), icon: Coffee },
  { id: "urgence", label: t("nav_urgence"), icon: ShieldCheck },
  { id: "secours", label: t("nav_secours"), icon: LifeBuoy },
  { id: "finances", label: t("nav_finances"), icon: FileBarChart },
  { id: "paiements_interac", label: t("nav_interac"), icon: CreditCard },
  { id: "gouvernance", label: t("nav_governance"), icon: Landmark },
  { id: "vieassociative", label: t("nav_community"), icon: Rss },
  { id: "projets", label: t("nav_projects"), icon: Kanban },
  { id: "evenements", label: t("nav_events"), icon: CalendarDays },
  { id: "sondages", label: t("nav_polls"), icon: BarChart3 },
  { id: "funeraire", label: t("nav_funeraire"), icon: Flower2 },
  { id: "dons", label: t("nav_donations"), icon: Gift },
  { id: "emprunts", label: t("nav_loans"), icon: Vote },
  { id: "documents", label: t("nav_documents"), icon: FileText },
  { id: "annonces", label: t("nav_announcements"), icon: Bell },
  { id: "journal", label: t("nav_activity"), icon: History },
  { id: "demandes_suppression", label: t("nav_del_requests"), icon: AlertTriangle },
  { id: "acces", label: t("nav_access"), icon: KeyRound },
  { id: "config", label: t("nav_config"), icon: Settings },
  { id: "securite", label: t("sec_title"), icon: ShieldCheck },
);
  } else if (isResponsable) {
    const r = profile.rubrique_assignee;
    navItems.push({ id: "dashboard", label: t("nav_dashboard"), icon: LayoutDashboard });
   if (r) navItems.push({ id: r === "fonds_urgence" ? "urgence" : r === "fonds_secours" ? "secours" : r, label: t(RUBRIQUE_KEY_MAP[r]), icon: IdCard });
    navItems.push(
      { id: "vieassociative", label: t("nav_community"), icon: Rss },{ id: "gouvernance", label: t("nav_governance"), icon: Landmark },
    { id: "projets", label: t("nav_projects"), icon: Kanban },
    { id: "finances", label: t("nav_finances"), icon: FileBarChart },
      { id: "evenements", label: t("nav_events"), icon: CalendarDays },
      { id: "sondages", label: t("nav_polls"), icon: BarChart3 },
      { id: "funeraire", label: t("nav_funeraire"), icon: Flower2 },
      { id: "documents", label: t("nav_documents"), icon: FileText },
      { id: "annonces", label: t("nav_announcements"), icon: Bell },
      { id: "securite", label: t("sec_title"), icon: ShieldCheck },
    );
 } else if (isAdherent) {
    navItems.push(
      { id: "monespace", label: t("nav_myspace"), icon: Users },
      { id: "gouvernance", label: t("nav_governance"), icon: Landmark },
      { id: "vieassociative", label: t("nav_community"), icon: Rss },
      { id: "evenements", label: t("nav_events"), icon: CalendarDays },
      { id: "sondages", label: t("nav_polls"), icon: BarChart3 },
      { id: "funeraire", label: t("nav_funeraire"), icon: Flower2 },
      { id: "annonces", label: t("nav_announcements"), icon: Bell },
      { id: "securite", label: t("sec_title"), icon: ShieldCheck },
    );
  }

  if (loading) return <FullPageLoader text={t("load_data")} />;

  const me = isAdherent ? members.find((m) => m.id === profile.member_id) : null;
  const memberLoan = me ? loans.find((l) => l.member_id === me.id && l.statut === "actif") : null;
  const memberLoanSolde = memberLoan ? Math.max(0, loanTotalDueFor(memberLoan) - loanRepaidFor(memberLoan.id)) : 0;
  const memberDonTotal = me ? interacClaims.filter((c) => c.member_id === me.id && c.type === "don" && c.statut === "confirme").reduce((s, c) => s + Number(c.montant_recu ?? c.montant), 0) : 0;

  return (
    <div style={{ fontFamily: "Inter, -apple-system, sans-serif", background: BG, color: CHARCOAL, minHeight: "100vh" }} className="app-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap');
        * { box-sizing: border-box; }
        h1,h2,h3 { font-family: 'Poppins', sans-serif; color: var(--primary); margin: 0; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: white; }
        }
        .print-only { display: none; }
      `}</style>

      {subscription && subscription.statut !== "actif" && (
       <Banner tone="warn">{t("sub_status_banner").replace("{statut}", subscription.statut)}</Banner>
      )}
      {errorMsg && <Banner tone="warn">{errorMsg}</Banner>}
     {saving && <div className="no-print" style={{ background: TEAL_LIGHT, color: TEAL, padding: "4px 24px", fontSize: 11, textAlign: "right" }}>{t("saving_indicator")}</div>}

      <header className="no-print" style={{ background: "var(--primary)", position: "sticky", top: 0, zIndex: 10, boxShadow: "0 2px 14px rgba(0,0,0,.12)" }}>
        <Container style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {association?.logo_url ? <img src={association.logo_url} alt="" style={{ height: 30, borderRadius: 6 }} /> : (
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid var(--accent)" }}>
                <HeartHandshake size={15} color="var(--accent)" />
              </div>
            )}
            <span style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, color: "white", fontSize: 16 }}>{association?.nom || t("org_default")}</span>
          </div>
          <nav style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            {navItems.map((n) => {
              const Icon = n.icon; const active = tab === n.id;
              const showBadge = n.id === "demandes_suppression" && association?.approbateur_suppression_id === profile.id
                && deletionRequests.filter((r) => r.statut === "en_attente").length > 0;
              const showAccesBadge = n.id === "acces" && pendingLinkRequestsCount > 0;
              const interacPendingCount = interacClaims.filter((c) => c.statut === "en_attente").length;
              const showInteracBadge = n.id === "paiements_interac" && interacPendingCount > 0;
              return (
                <button key={n.id} onClick={() => setTab(n.id)} style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "6px 9px", borderRadius: 7, border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: 600, background: active ? "rgba(255,255,255,.14)" : "transparent",
                  color: active ? "var(--accent)" : "rgba(255,255,255,.8)", position: "relative",
                }}>
                  <Icon size={12} /> {n.label}
                  {showBadge && <span style={{ background: RED, color: "white", borderRadius: 999, fontSize: 9.5, fontWeight: 700, minWidth: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{deletionRequests.filter((r) => r.statut === "en_attente").length}</span>}
                  {showAccesBadge && <span style={{ background: RED, color: "white", borderRadius: 999, fontSize: 9.5, fontWeight: 700, minWidth: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{pendingLinkRequestsCount}</span>}
                  {showInteracBadge && <span style={{ background: RED, color: "white", borderRadius: 999, fontSize: 9.5, fontWeight: 700, minWidth: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{interacPendingCount}</span>}
                </button>
              );
            })}
          </nav>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LanguageSwitcher />
            <span style={{ fontSize: 11.5, color: "rgba(255,255,255,.7)" }}>{profile.nom_complet || profile.id.slice(0, 8)} · {t(ROLE_KEY_MAP[profile.role])}</span>
            <button onClick={onLogout} style={{ background: "none", border: "none", color: "rgba(255,255,255,.8)", cursor: "pointer" }}><LogOut size={15} /></button>
          </div>
        </Container>
      </header>

      {/* ================= VUE D'ENSEMBLE (page d'accueil) ================= */}
      {tab === "apercu" && (
        <PresentationAssociation
          profile={profile}
          association={association}
          members={visibleMembers}
          fuSolde={fuSolde}
          fsSolde={fsSolde}
          continueLabel={isAdherent ? t("apercu_continue_myspace") : t("apercu_continue_dashboard")}
          onContinue={(target) => setTab(target || (isAdherent ? "monespace" : "dashboard"))}
        />
      )}

      {/* ================= TABLEAU DE BORD ================= */}
      {tab === "dashboard" && (isBureau || isResponsable) && (
        <Container><Section>
         <h2 style={{ marginBottom: 4 }}>{t("dash_title")}</h2>
         <p style={{ color: "#5B6270", marginBottom: 20 }}>{lang === "en" ? (association?.devise_texte_en || association?.devise_texte) : association?.devise_texte}</p>
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
                      <button onClick={() => setFullProfileMemberId(m.id)} title={t("mem_view_full_profile")} style={{ background: "none", border: "none", cursor: "pointer", color: "#999", display: "flex", flexShrink: 0 }}>
                        <Wallet size={14} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ cursor: "pointer", textDecoration: "underline" }} title={t("mem_edit_title")} onClick={() => setEditMemberId(m.id)}>{m.nom}</span>
                      <button onClick={() => { setHistoryMemberId(m.id); setHistoryFundFilter("adhesion"); }} title={t("mem_view_history")} style={{ background: "none", border: "none", cursor: "pointer", color: "#999", display: "flex", flexShrink: 0 }}>
                        <History size={14} />
                      </button>
                      <button onClick={() => setFullProfileMemberId(m.id)} title={t("mem_view_full_profile")} style={{ background: "none", border: "none", cursor: "pointer", color: "#999", display: "flex", flexShrink: 0 }}>
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
                    <span style={{ display: "inline-block", padding: "6px 10px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: m.statut === "Actif" ? TEAL : "#B8860B", background: m.statut === "Actif" ? TEAL_LIGHT : "#FBF3D9", border: `1.5px solid ${m.statut === "Actif" ? TEAL : "#D9B84A"}` }}>
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
            {visibleMembers.length === 0 && <tr><td colSpan={5} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
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
          <div style={{ overflowX: "auto", background: "white", borderRadius: 12, boxShadow: "0 4px 18px rgba(31,56,100,0.08)", marginBottom: 24 }}>
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
                  <td style={{ ...td, color: s.versement_methode ? TEAL : (ben ? RED : "#999"), fontWeight: 700 }}>
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
            {tontineSeances.length === 0 && <tr><td colSpan={8} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
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
          <div style={{ overflowX: "auto", background: "white", borderRadius: 12, boxShadow: "0 4px 18px rgba(31,56,100,0.08)" }}>
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
                      {periodKeys.map((mo) => (
                        <td key={mo} style={{ ...td, textAlign: "center" }}>
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
                  <td style={{ ...td, color: s.versement_methode ? TEAL : (ben ? RED : "#999"), fontWeight: 700 }}>
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
            {collationSeances.length === 0 && <tr><td colSpan={8} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
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
                          <button onClick={() => setEditFondsPaiement({ fonds: fondsCode, memberId: m.id })} style={{ background: "none", border: "none", cursor: "pointer", color: "#999", padding: 2, display: "inline-flex" }} aria-label={t("action_edit")} title={t("fonds_edit_payment_title")}>
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
                  {depenses.length === 0 && <tr><td colSpan={5} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
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
                  {lignes.length === 0 && <tr><td colSpan={5} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
                </Table>
              );
            })()}
          </Section></Container>
        );
      })()}

      {/* ================= ÉTATS FINANCIERS (+ impression) ================= */}
      {tab === "finances" && isBureau && (
        <Container><Section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }} className="no-print">
           <h2>{t("fin_title")}</h2>
           <Btn variant="outline" onClick={() => window.print()}><Printer size={15} /> {t("fin_print_btn")}</Btn>
          </div>
          <div id="printable-bilan">
            <h3 style={{ marginBottom: 4 }}>{association?.nom}</h3>
            <p style={{ fontSize: 12, color: "#999", marginBottom: 16 }}>{t("fin_edited_on")} {new Date().toLocaleDateString("fr-CA")}</p>
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
          <PaymentHistory activityLog={activityLog} members={visibleMembers} depenseFondsMap={depenseFondsMap} t={t} lang={lang} moneyF={moneyF} />
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
                  <p style={{ fontSize: 11.5, color: "#999" }}>{t("doc_privacy_note")}</p>
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
                {filteredDocuments.length === 0 && <tr><td colSpan={4} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("doc_no_document")}</td></tr>}
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
          <div style={{ display: "grid", gridTemplateColumns: isBureau ? "1fr 1.4fr" : "1fr", gap: 22 }}>
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
                <p style={{ fontSize: 11, color: "#999", marginTop: 10 }}>{t("ann_email_note")}</p>
              </Card>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
                      <p style={{ fontSize: 11, color: "#999", marginTop: 8 }}>{new Date(a.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</p>
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
             {announcements.length === 0 && <p style={{ color: "#999", fontStyle: "italic" }}>{t("ann_no_announcement")}</p>}
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
           {activityLog.length === 0 && <tr><td colSpan={6} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("jrn_no_activity")}</td></tr>}
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
            {enAttente.length === 0 && <tr><td colSpan={4} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("del_req_none")}</td></tr>}
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
                  {r.motif_rejet && <div style={{ fontSize: 11, color: "#999", fontWeight: 400 }}>{r.motif_rejet}</div>}
                </td>
              </tr>
            ))}
            {traitees.length === 0 && <tr><td colSpan={4} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("del_req_none")}</td></tr>}
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
          {enAttente.length > 0 && <p style={{ fontSize: 11.5, color: "#999", marginBottom: 10, maxWidth: 640 }}>{t("interac_claims_partial_help")}</p>}
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
                  <div style={{ fontSize: 10.5, color: "#999", marginTop: 2 }}>{t("interac_claims_requested_prefix")} {moneyF(c.montant)}</div>
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
            {enAttente.length === 0 && <tr><td colSpan={6} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("interac_claims_none")}</td></tr>}
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
                <td style={{ ...td, color: c.statut === "confirme" ? TEAL : c.statut === "annule" ? "#999" : RED, fontWeight: 700 }}>
                  {c.statut === "confirme" ? t("interac_claims_status_confirmed") : c.statut === "annule" ? t("interac_claims_status_cancelled") : t("interac_claims_status_rejected")}
                  {c.commentaire_bureau && <div style={{ fontSize: 11, color: "#999", fontWeight: 400 }}>{c.commentaire_bureau}</div>}
                </td>
              </tr>
              );
            })}
            {traitees.length === 0 && <tr><td colSpan={5} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("interac_claims_none")}</td></tr>}
          </Table>
        </Section></Container>
        );
      })()}

      {/* ================= CONFIGURATION (marque blanche) ================= */}
      {tab === "acces" && isBureau && (
        <GestionAcces profile={profile} association={association} isPresident={isPresident}
          onPendingCountChange={setPendingLinkRequestsCount} />
      )}

      {tab === "config" && isBureau && (
        <Container><Section>
        <h2 style={{ marginBottom: 20 }}>{t("cfg_title")}</h2>
          <Card style={{ maxWidth: 480 }}>
            <Field label={t("cfg_org_name")}><input style={inputStyle} value={brandDraft.nom || ""} onChange={(e) => setBrandDraft({ ...brandDraft, nom: e.target.value })} /></Field>
            <Field label={t("cfg_logo_url")}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                {brandDraft.logo_url && <img src={brandDraft.logo_url} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", border: "1px solid #E4E6EA" }} />}
                <Btn variant="outline" onClick={() => logoFileInputRef.current?.click()}>{t("cfg_logo_upload_btn")}</Btn>
              </div>
              <input style={inputStyle} value={brandDraft.logo_url || ""} onChange={(e) => setBrandDraft({ ...brandDraft, logo_url: e.target.value })} placeholder="https://…" />
              <p style={{ fontSize: 11, color: "#999", marginTop: 4 }}>{t("cfg_logo_help")}</p>
            </Field>
            <input
              type="file" accept="image/*" ref={logoFileInputRef} style={{ display: "none" }}
              onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadLogo(file); e.target.value = ""; }}
            />
           <Field label={t("cfg_slogan")}><input style={inputStyle} value={brandDraft.devise_texte || ""} onChange={(e) => setBrandDraft({ ...brandDraft, devise_texte: e.target.value })} /></Field>
            <Field label={t("cfg_currency_code")}><input style={inputStyle} value={brandDraft.devise_monetaire || ""} onChange={(e) => setBrandDraft({ ...brandDraft, devise_monetaire: e.target.value })} placeholder="CAD, XOF, EUR…" /></Field>
           <Field label={t("cfg_primary_color")}><input type="color" style={{ ...inputStyle, height: 40 }} value={brandDraft.couleur_primaire || "#1F3864"} onChange={(e) => setBrandDraft({ ...brandDraft, couleur_primaire: e.target.value })} /></Field>
           <Field label={t("cfg_accent_color")}><input type="color" style={{ ...inputStyle, height: 40 }} value={brandDraft.couleur_accent || "#C9A227"} onChange={(e) => setBrandDraft({ ...brandDraft, couleur_accent: e.target.value })} /></Field>
           <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
             <Btn onClick={() => saveBranding("branding")}>{t("action_save")}</Btn>
             {savedCard === "branding" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
           </div>
          </Card>

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
            <p style={{ fontSize: 11, color: "#999", marginTop: -8, marginBottom: 14 }}>{t("cfg_montants_help")}</p>
            <Field label={t("cfg_frequence_label")}>
              <select style={inputStyle} value={brandDraft.frequence_reunions || "mois"} onChange={(e) => setBrandDraft({ ...brandDraft, frequence_reunions: e.target.value })}>
                <option value="semaine">{t("cfg_freq_semaine")}</option>
                <option value="quinzaine">{t("cfg_freq_quinzaine")}</option>
                <option value="trois_semaines">{t("cfg_freq_trois_semaines")}</option>
                <option value="mois">{t("cfg_freq_mois")}</option>
              </select>
            </Field>
            <p style={{ fontSize: 11, color: "#999", marginTop: -8, marginBottom: 14 }}>{t("cfg_frequence_help")}</p>
            <Field label={t("cfg_interac_email_label")}>
              <input type="email" style={inputStyle} value={brandDraft.interac_email || ""} onChange={(e) => setBrandDraft({ ...brandDraft, interac_email: e.target.value })} placeholder="paiements@monassociation.org" />
            </Field>
            <p style={{ fontSize: 11, color: "#999", marginTop: -8, marginBottom: 14 }}>{t("cfg_interac_email_help")}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Btn onClick={() => saveBranding("montants")}>{t("action_save")}</Btn>
              {savedCard === "montants" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
            </div>
          </Card>

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
            <p style={{ fontSize: 11, color: "#999", marginTop: -8, marginBottom: 14 }}>{t("cfg_funeraire_plans_help")}</p>
            {brandDraft.funeraire_main_levee_actif === false && !brandDraft.funeraire_organisme_tiers_actif && (
              <p style={{ fontSize: 11.5, color: RED, fontWeight: 600, marginTop: -10, marginBottom: 14 }}>{t("cfg_funeraire_au_moins_un_requis")}</p>
            )}
            <Field label={t("cfg_funeraire_montant_inscription")}>
              <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.funeraire_montant_inscription ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, funeraire_montant_inscription: e.target.value })} placeholder="50" />
            </Field>
            <p style={{ fontSize: 11, color: "#999", marginTop: -8, marginBottom: 14 }}>{t("cfg_funeraire_montant_inscription_help")}</p>
            {!!brandDraft.funeraire_organisme_tiers_actif && (
              <>
                <Field label={t("cfg_funeraire_periode_probation")}>
                  <input type="number" min="0" style={inputStyle} value={brandDraft.funeraire_periode_probation_jours ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, funeraire_periode_probation_jours: e.target.value })} placeholder="0" />
                </Field>
                <p style={{ fontSize: 11, color: "#999", marginTop: -8, marginBottom: 14 }}>{t("cfg_funeraire_periode_probation_help")}</p>
                <Field label={t("cfg_funeraire_montant_deces")}>
                  <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.funeraire_montant_deces ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, funeraire_montant_deces: e.target.value })} placeholder="1500" />
                </Field>
                <p style={{ fontSize: 11, color: "#999", marginTop: -8, marginBottom: 14 }}>{t("cfg_funeraire_montant_deces_help")}</p>
                <Field label={t("cfg_funeraire_montant_recharge")}>
                  <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.funeraire_montant_recharge ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, funeraire_montant_recharge: e.target.value })} placeholder="20" />
                </Field>
                <p style={{ fontSize: 11, color: "#999", marginTop: -8, marginBottom: 14 }}>{t("cfg_funeraire_montant_recharge_help")}</p>
                <Field label={t("cfg_funeraire_seuil_alerte")}>
                  <input type="number" min="0" step="0.01" style={inputStyle} value={brandDraft.funeraire_seuil_alerte ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, funeraire_seuil_alerte: e.target.value })} placeholder="500" />
                </Field>
                <p style={{ fontSize: 11, color: "#999", marginTop: -8, marginBottom: 14 }}>{t("cfg_funeraire_seuil_alerte_help")}</p>
              </>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Btn onClick={() => saveBranding("funeraire")}>{t("action_save")}</Btn>
              {savedCard === "funeraire" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
            </div>
          </Card>

          <Card style={{ maxWidth: 480, marginTop: 22, opacity: isPresident ? 1 : 0.55 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_invite_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_invite_intro")}</p>
            <Field label={t("cfg_invite_label")}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input readOnly style={{ ...inputStyle, fontWeight: 700, letterSpacing: 1, background: "#F8F8F6" }} value={brandDraft.code_invitation || association?.code_invitation || ""} />
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

          <Card style={{ maxWidth: 480, marginTop: 22, opacity: isPresident ? 1 : 0.55 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_secours_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_secours_intro")}</p>
            <Field label={t("cfg_probation_secours")}>
              <input type="number" min="0" disabled={!isPresident} style={{ ...inputStyle, ...(isPresident ? {} : { background: "#F1F2F4", cursor: "not-allowed" }) }} value={brandDraft.periode_probation_secours_jours ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, periode_probation_secours_jours: e.target.value })} placeholder="0" />
            </Field>
            <p style={{ fontSize: 11.5, color: "#999", marginTop: -8, marginBottom: 14 }}>{t("cfg_probation_secours_help")}</p>
            {isPresident ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Btn onClick={() => saveBranding("secours")}>{t("action_save")}</Btn>
                {savedCard === "secours" && <span style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>{t("cfg_saved_msg")}</span>}
              </div>
            ) : (
              <p style={{ fontSize: 11.5, color: RED, fontWeight: 600 }}>{t("cfg_president_only_note")}</p>
            )}
          </Card>

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
                const avatarInitials = initialsOf(me.nom).slice(0, 2) || "?";
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
                        <div style={{ width: 50, height: 50, borderRadius: "50%", background: "linear-gradient(155deg, var(--primary), var(--primary-dark))", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Poppins, sans-serif", fontWeight: 600, fontSize: 16, flexShrink: 0, boxShadow: "0 3px 10px rgba(31,56,100,.25)" }}>
                          {avatarInitials}
                        </div>
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
                      <div style={{ display: "flex", gap: 10 }} className="no-print">
                        <Btn variant="outline" onClick={() => setFullProfileMemberId(me.id)}><Wallet size={14} /> {t("ms_full_profile_btn")}</Btn>
                        <Btn variant="outline" onClick={() => setShowAllHistory((v) => !v)}><History size={14} /> {t("ms_all_history_toggle_btn")}</Btn>
                        <Btn variant="outline" onClick={() => window.print()}><Printer size={14} /> {t("ms_print_btn")}</Btn>
                      </div>
                    </div>

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
                      <button onClick={() => { setSelectedPayType(null); setSelectedRecouvrement(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#999", padding: 2 }} aria-label={t("action_close")}>
                        <X size={18} />
                      </button>
                    </div>

                    <button onClick={() => setShowTxDetail((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", color: "var(--primary)", fontSize: 12.5, fontWeight: 600, padding: 0, marginBottom: showTxDetail ? 10 : 14 }}>
                      <ChevronDown size={14} style={{ transform: showTxDetail ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
                      {showTxDetail ? t("ms_tx_detail_toggle_hide") : t("ms_tx_detail_toggle_show")}
                    </button>
                    {showTxDetail && (
                      <div style={{ marginBottom: 14, maxHeight: 220, overflowY: "auto", border: "1px solid #EEE", borderRadius: 8 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left", padding: "6px 8px", background: "#F8F8F6", position: "sticky", top: 0 }}>{t("interac_claims_col_date")}</th>
                              <th style={{ textAlign: "left", padding: "6px 8px", background: "#F8F8F6", position: "sticky", top: 0 }}>{t("ms_tx_detail_col_detail")}</th>
                              <th style={{ textAlign: "right", padding: "6px 8px", background: "#F8F8F6", position: "sticky", top: 0 }}>{t("interac_claims_col_amount")}</th>
                              <th style={{ textAlign: "right", padding: "6px 8px", background: "#F8F8F6", position: "sticky", top: 0 }}>{t("ms_tx_detail_col_method")}</th>
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
                                    color={row.methode === "stripe" ? "var(--primary)" : row.methode === "interac" ? TEAL : "#999"}
                                    bg={row.methode === "stripe" ? "#EEF1F8" : row.methode === "interac" ? TEAL_LIGHT : "#F1F2F4"}
                                  >
                                    {row.methode === "stripe" ? t("ms_tx_method_stripe") : row.methode === "interac" ? t("ms_tx_method_interac") : t("ms_tx_method_manuel")}
                                  </Pill>
                                </td>
                              </tr>
                            ))}
                            {txRows.length === 0 && (
                              <tr><td colSpan={4} style={{ padding: "10px 8px", color: "#999", fontStyle: "italic", textAlign: "center" }}>{t("ms_tx_detail_none")}</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {memberInteracClaims(selectedPayType, selectedRecouvrement?.id).length > 0 && (() => {
                      const claimRows = memberInteracClaims(selectedPayType, selectedRecouvrement?.id);
                      const statusStyle = {
                        en_attente: { label: t("interac_claims_status_pending"), color: "#B8860B", bg: "#FBF3DA" },
                        confirme: { label: t("interac_claims_status_confirmed"), color: TEAL, bg: TEAL_LIGHT },
                        rejete: { label: t("interac_claims_status_rejected"), color: RED, bg: "#FBE4E1" },
                        annule: { label: t("interac_claims_status_cancelled"), color: "#999", bg: "#F1F2F4" },
                      };
                      return (
                        <>
                          <button onClick={() => setShowInteracHistory((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", color: "var(--primary)", fontSize: 12.5, fontWeight: 600, padding: 0, marginBottom: showInteracHistory ? 10 : 14 }}>
                            <ChevronDown size={14} style={{ transform: showInteracHistory ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
                            {showInteracHistory ? t("ms_interac_history_toggle_hide") : t("ms_interac_history_toggle_show")}
                          </button>
                          {showInteracHistory && (
                            <div style={{ marginBottom: 14, maxHeight: 220, overflowY: "auto", border: "1px solid #EEE", borderRadius: 8 }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                                <thead>
                                  <tr>
                                    <th style={{ textAlign: "left", padding: "6px 8px", background: "#F8F8F6", position: "sticky", top: 0 }}>{t("interac_claims_col_date")}</th>
                                    <th style={{ textAlign: "right", padding: "6px 8px", background: "#F8F8F6", position: "sticky", top: 0 }}>{t("interac_claims_col_amount")}</th>
                                    <th style={{ textAlign: "left", padding: "6px 8px", background: "#F8F8F6", position: "sticky", top: 0 }}>{t("interac_claims_col_status")}</th>
                                    <th style={{ textAlign: "right", padding: "6px 8px", background: "#F8F8F6", position: "sticky", top: 0 }}>{t("interac_claims_col_file")}</th>
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
                        <p style={{ fontSize: 11, color: "#999", marginTop: 10 }}>{t("ms_pay_online_help")}</p>
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
                              <input readOnly style={{ ...inputStyle, background: "#F8F8F6" }} value={interacEmail} />
                              <Btn variant="outline" onClick={() => copyInteracText(interacEmail)}><Copy size={13} /></Btn>
                            </div>
                          </Field>
                          <Field label={t("ms_interac_reference_label")}>
                            <div style={{ display: "flex", gap: 8 }}>
                              <input readOnly style={{ ...inputStyle, background: "#F8F8F6" }} value={interacReference} />
                              <Btn variant="outline" onClick={() => copyInteracText(interacReference)}><Copy size={13} /></Btn>
                            </div>
                          </Field>
                          {!isFreeAmount && <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--primary)", marginBottom: 4 }}>{t("ms_interac_amount_label")} {moneyF(montantDue)}</p>}
                          {interacCopyMsg && <p style={{ fontSize: 12, color: TEAL, fontWeight: 600 }}>{interacCopyMsg}</p>}
                          <p style={{ fontSize: 11.5, color: "#999", marginTop: 8, marginBottom: 14 }}>{t("ms_interac_note")}</p>
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
                    <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid #EEE", borderRadius: 8 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "6px 8px", background: "#F8F8F6", position: "sticky", top: 0 }}>{t("interac_claims_col_date")}</th>
                            <th style={{ textAlign: "left", padding: "6px 8px", background: "#F8F8F6", position: "sticky", top: 0 }}>{t("ms_all_history_col_rubrique")}</th>
                            <th style={{ textAlign: "right", padding: "6px 8px", background: "#F8F8F6", position: "sticky", top: 0 }}>{t("interac_claims_col_amount")}</th>
                            <th style={{ textAlign: "right", padding: "6px 8px", background: "#F8F8F6", position: "sticky", top: 0 }}>{t("ms_tx_detail_col_method")}</th>
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
                                  {periodeLabel && <span style={{ color: "#999" }}> — {periodeLabel}</span>}
                                </td>
                                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{moneyF(tx.montant)}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                                  <Pill
                                    color={tx.methode === "stripe" ? "var(--primary)" : tx.methode === "interac" ? TEAL : "#999"}
                                    bg={tx.methode === "stripe" ? "#EEF1F8" : tx.methode === "interac" ? TEAL_LIGHT : "#F1F2F4"}
                                  >
                                    {tx.methode === "stripe" ? t("ms_tx_method_stripe") : tx.methode === "interac" ? t("ms_tx_method_interac") : t("ms_tx_method_manuel")}
                                  </Pill>
                                </td>
                              </tr>
                            );
                          })}
                          {allRows.length === 0 && (
                            <tr><td colSpan={4} style={{ padding: "10px 8px", color: "#999", fontStyle: "italic", textAlign: "center" }}>{t("ms_all_history_none")}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                );
              })()}

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
        <VieAssociative profile={profile} isBureau={isBureau} announcements={announcements} onGoToAnnonces={() => setTab("annonces")} />
      )}
      {tab === "projets" && isBureau && (
        <Projets profile={profile} isBureau={isBureau} />
      )}
      {tab === "evenements" && (isBureau || isResponsable || isAdherent) && (
        <Evenements profile={profile} isBureau={isBureau} />
      )}

      {tab === "sondages" && (isBureau || isResponsable || isAdherent) && (
        <Sondages profile={profile} isBureau={isBureau} />
      )}
      {tab === "funeraire" && (isBureau || isResponsable || isAdherent) && (
        <Funeraire profile={profile} isBureau={isBureau} isPresident={isPresident} association={association} />
      )}
      {tab === "dons" && isBureau && (
        <FinancesElargies profile={profile} isBureau={isBureau} mode="dons" association={association} />
      )}
      {tab === "emprunts" && isBureau && (
        <FinancesElargies profile={profile} isBureau={isBureau} mode="emprunts" association={association} />
      )}
      {tab === "securite" && <SecuritySettings />}

      <footer className="no-print" style={{ background: "var(--primary-dark)", color: "rgba(255,255,255,.6)", padding: "18px 0", marginTop: 20 }}>
        <Container style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
          <span>&copy; {new Date().getFullYear()} {association?.nom}</span>
         <span>{t("footer_dev_by")} <b style={{ color: "var(--accent)" }}>Omnia Trade Solutions</b></span>
        </Container>
      </footer>

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
        <h4 style={{ marginBottom: 20, fontWeight: 600 }}>{t("ms_receipt_title")}</h4>
        {transactions.length === 0 ? (
          <p style={{ color: "#999", fontStyle: "italic" }}>{t("ms_receipt_none")}</p>
        ) : (
          transactions.map((tx, i) => (
            <div key={tx.id} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: i < transactions.length - 1 ? "1px solid #EEE" : "none" }}>
              {tx.numero_recu != null && (
                <p style={{ fontSize: 11.5, margin: "0 0 6px", color: "#999", fontWeight: 600, letterSpacing: 0.3 }}>{t("ms_receipt_number_label")} {String(tx.numero_recu).padStart(6, "0")}</p>
              )}
              <p style={{ fontSize: 13.5, margin: "4px 0" }}><b>{t("ms_receipt_member_label")}</b> {member?.nom}</p>
              <p style={{ fontSize: 13.5, margin: "4px 0" }}><b>{t("ms_receipt_type_label")}</b> {typeLabel}{tx.periode && tx.periode !== "octroi" && type !== "recouvrement" ? ` — ${tx.periode}` : ""}</p>
              <p style={{ fontSize: 13.5, margin: "4px 0" }}><b>{t("ms_receipt_date_label")}</b> {new Date(tx.created_at).toLocaleDateString(locale)}</p>
              <p style={{ fontSize: 15, margin: "4px 0", fontWeight: 700, color: TEAL }}>{t("ms_receipt_amount_label")} {moneyF(tx.montant)}</p>
              <p style={{ fontSize: 11.5, margin: "4px 0", color: "#999" }}><b>{t("ms_receipt_reference_label")}</b> {receiptReference(tx, interacClaims, t, locale)}</p>
            </div>
          ))
        )}
        <p style={{ fontSize: 11, color: "#999", marginTop: 10 }}>{t("ms_receipt_footer")}</p>
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
          <p style={{ fontSize: 10.5, color: "#999", fontStyle: "italic", marginTop: 10 }}>{t("ms_receipt_electronic_signature_note")}</p>
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
function LoanTermsModal({ loan, association, t, lang, moneyF, loanInterestFor, loanTotalDueFor, loanRepaidFor, onClose }) {
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
        <h4 style={{ marginBottom: 8, fontWeight: 600 }}>{docTitle}</h4>
        {seance.numero_decharge != null && (
          <p style={{ fontSize: 11.5, margin: "0 0 16px", color: "#999", fontWeight: 600, letterSpacing: 0.3 }}>{t("tont_decharge_number_label")} {String(seance.numero_decharge).padStart(6, "0")}</p>
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
          <p style={{ fontSize: 10.5, color: "#999", fontStyle: "italic", marginTop: 10 }}>{t("ms_receipt_electronic_signature_note")}</p>
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
        <p style={{ fontSize: 11, color: "#999", marginTop: -4, marginBottom: 16 }}>{t("tont_versement_help")}</p>
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
        <p style={{ fontSize: 11, color: "#999", marginTop: -8, marginBottom: 16 }}>{t("fonds_edit_payment_hint")}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={handleSave}>{t("action_save")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
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
        <p style={{ fontSize: 11, color: "#999", marginTop: -8, marginBottom: 16 }}>{t("fonds_edit_expense_hint")}</p>
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
        collation_montant_paye: "Collation payée", fonds_urgence_paye: "Fonds urgence payé",
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
            {(fundFilter === "urgence" || fundFilter === "secours") && <span style={{ fontSize: 12, fontWeight: 400, color: "#999", marginLeft: 8 }}>({fundFilter === "urgence" ? t("nav_urgence") : t("nav_secours")})</span>}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {fundFilter === "adhesion" && member && (
          <div style={{ background: "#F8F8F6", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12.5, color: "#333", display: "flex", flexDirection: "column", gap: 4 }}>
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
          if (visibleLogs.length === 0) return <p style={{ color: "#999", fontStyle: "italic" }}>{t("mem_history_no_activity")}</p>;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {visibleLogs.map(({ l, desc }) => (
                <div key={l.id} style={{ borderBottom: "1px solid #EEE", paddingBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#333" }}>{desc.text}</div>
                    <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{new Date(l.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</div>
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
    <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, color: ok ? TEAL : "#B8860B", background: ok ? TEAL_LIGHT : "#FBF3D9", border: `1.5px solid ${ok ? TEAL : "#D9B84A"}` }}>
      {ok ? t("mem_full_profile_uptodate") : t("mem_full_profile_pending")}
    </span>
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
            <p style={{ fontSize: 12, color: "#999", fontStyle: "italic", margin: "4px 0" }}>{t("mem_full_profile_no_recouv")}</p>
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
            <p style={{ fontSize: 12, color: "#999", fontStyle: "italic", margin: "4px 0" }}>{t("mem_full_profile_no_recouv")}</p>
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
            <p style={{ fontSize: 12, color: "#999", fontStyle: "italic", margin: "4px 0" }}>{t("mem_full_profile_no_loans")}</p>
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

function RecouvrementHistoryModal({ memberId, fonds, onClose, t, lang, members, moneyF, recouvrements, depenses, canEdit, onMarkPaid }) {
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
            <span style={{ fontSize: 12, fontWeight: 400, color: "#999", marginLeft: 8 }}>({fonds === "urgence" ? t("nav_urgence") : t("nav_secours")})</span>
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {rows.length === 0 ? (
          <p style={{ color: "#999", fontStyle: "italic" }}>{t("mem_history_no_activity")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map(({ r, d }) => (
              <div key={r.id} style={{ borderBottom: "1px solid #EEE", paddingBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 13, color: "#333" }}>{d?.description || "—"} — {moneyF(r.quote_part)}</div>
                  <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
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