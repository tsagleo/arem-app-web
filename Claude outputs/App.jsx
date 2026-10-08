import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Users, LayoutDashboard, HeartHandshake, FileBarChart, Plus, ShieldCheck,
  CheckCircle2, Circle, Coffee, LifeBuoy, IdCard, Loader2, AlertTriangle,
 Bell, FileText, History, Settings, Printer, LogOut, Download, Eye, EyeOff, Trash2, Pencil,
  Landmark, Rss, Kanban, CalendarDays, Gift, Vote,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { LangProvider, LanguageSwitcher, useLang } from "./shared";
import Gouvernance from "./Gouvernance.jsx";
import VieAssociative from "./VieAssociative.jsx";
import Projets from "./Projets";
import Evenements from "./Evenements";
import FinancesElargies from "./FinancesElargies";
import PaymentHistory from "./PaymentHistory";
import FinanceSynthese from "./FinanceSynthese";

// =====================================================================
// CONSTANTES
// =====================================================================
const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const MONTH_KEYS = ["m_jan", "m_feb", "m_mar", "m_apr", "m_may", "m_jun", "m_jul", "m_aug", "m_sep", "m_oct", "m_nov", "m_dec"];
const SEANCES = Array.from({ length: 12 }, (_, i) => i + 1);
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
  inscription: "Inscription", tontine: "Tontine (Cotisation)", collation: "Collation (Présence)",
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

// Fonds de secours uniquement : un adhérent n'est soumis au recouvrement
// d'une dépense que s'il a déjà acquitté son fonds de secours (200 $) ET,
// le cas échéant, terminé la période de probation de son association
// (comptée depuis sa date d'adhésion). Sans période de probation renseignée
// pour l'association (valeur par défaut), seule la condition de paiement
// s'applique — le recouvrement démarre dès que le fonds de secours est payé.
function estEligibleRecouvrementSecours(member, association) {
  const paye = Number(member?.fonds_secours_paye || 0);
  if (paye < 200 - 0.005) return false;
  const probationJours = Number(association?.periode_probation_secours_jours || 0);
  if (probationJours > 0 && member?.date_adhesion) {
    const dateEligible = new Date(member.date_adhesion);
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
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA");
  }
  return s.length > 70 ? s.slice(0, 67) + "…" : s;
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
function Card({ children, style }) {
  return <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 4px 18px rgba(31,56,100,0.08)", borderTop: "3px solid transparent", ...style }}>{children}</div>;
}
function RuleBox({ children }) {
  return <div style={{ background: "#FBF3D9", border: "1px solid #EEDDA0", borderRadius: 10, padding: "12px 16px", marginBottom: 18, fontSize: 13, color: "#8a6d1a" }}>{children}</div>;
}
function StatCard({ label, value, accent, icon: Icon }) {
  return (
    <Card style={{ borderTopColor: accent || "var(--accent)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 700, color: TEAL, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        {Icon && <Icon size={14} />}{label}
      </div>
      <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 22, color: "var(--primary)" }}>{value}</div>
    </Card>
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

// =====================================================================
// ÉCRAN D'AUTHENTIFICATION (connexion + création d'association)
// =====================================================================
function AuthScreen() {
  const { t } = useLang();
  const [mode, setMode] = useState("login"); // 'login' | 'signup' | 'mfa'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nomComplet, setNomComplet] = useState("");
  const [nomAssociation, setNomAssociation] = useState("");
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
  if (error) { setErr(error.message); return; }
  setResetSent(true);
}

  async function handleLogin(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setBusy(false); setErr(error.message); return; }
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
    if (e1) { setBusy(false); setErr(e1.message); return; }
    const { error: e2 } = await supabase.auth.mfa.verify({ factorId: mfaFactorId, challengeId: challenge.id, code: mfaCode });
    setBusy(false);
    if (e2) setErr(t("auth_wrong_code"));
    // Si succès, onAuthStateChange (dans PlatformAppInner) détecte automatiquement la session pleinement authentifiée.
  }

  async function handleSignup(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      // 1) Créer le compte utilisateur
      const { data: signUpData, error: e1 } = await supabase.auth.signUp({ email, password });
      if (e1) throw e1;
      const userId = signUpData.user?.id;
      if (!userId) throw new Error(t("auth_confirm_email_first"));

      // 2) Créer l'association
      const { data: assoc, error: e2 } = await supabase.from("associations").insert({ nom: nomAssociation }).select().single();
      if (e2) throw e2;

      // 3) Créer l'abonnement d'essai
      await supabase.from("subscriptions").insert({
        association_id: assoc.id, plan: "essai", statut: "actif",
        date_fin_periode: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
      });

      // 4) Créer le profil bureau_president
      const { error: e3 } = await supabase.from("profiles").insert({
        id: userId, association_id: assoc.id, role: "bureau_president", nom_complet: nomComplet,
      });
      if (e3) throw e3;

    setErr(t("auth_account_created"));
      setMode("login");
    } catch (error) {
      setErr(error.message || String(error));
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
            <Field label={t("auth_password")}><input type="password" required minLength={6} style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            {err && <p style={{ color: err.startsWith("Compte créé") ? TEAL : RED, fontSize: 12.5, marginBottom: 12 }}>{err}</p>}
            <Btn type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", background: "#C9A227", color: "#152645" }}>
              {busy ? "Création…" : "Créer l'association (essai 30 jours)"}
            </Btn>
            <p style={{ fontSize: 12.5, marginTop: 16, color: "#5B6270" }}>
              Déjà inscrit(e) ? <a href="#" onClick={(e) => { e.preventDefault(); setMode("login"); setErr(""); }} style={{ color: TEAL, fontWeight: 600 }}>Se connecter</a>
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
    if (error) { setMsg(error.message); setEnrolling(false); return; }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
  }
  async function confirmEnroll() {
    setMsg("");
    const { data: challenge, error: e1 } = await supabase.auth.mfa.challenge({ factorId });
    if (e1) { setMsg(e1.message); return; }
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

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const { data: prof, error: e1 } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
      if (e1) throw e1;
      setProfile(prof);
      if (prof.association_id) {
        const [{ data: assoc, error: e2 }, { data: sub }] = await Promise.all([
          supabase.from("associations").select("*").eq("id", prof.association_id).single(),
          supabase.from("subscriptions").select("*").eq("association_id", prof.association_id).order("created_at", { ascending: false }).limit(1).single(),
        ]);
        if (e2) throw e2;
        setAssociation(assoc);
        setSubscription(sub || null);
      }
    } catch (e) {
      setErr(t("load_profile_error") + " " + (e.message || String(e)));
    } finally {
      setLoading(false);
    }
  }, [session.user.id]);

  useEffect(() => { load(); }, [load]);

 if (loading) return <FullPageLoader text={t("load_space")} />;
if (err) return <FullPageLoader text={err} />;
if (!profile) return <FullPageLoader text={t("load_profile_missing")} />;

  const primary = association?.couleur_primaire || "#1F3864";
  const accent = association?.couleur_accent || "#C9A227";
  const primaryDark = shade(primary, -18);

  const theme = { "--primary": primary, "--primary-dark": primaryDark, "--accent": accent };

  if (profile.role === "super_admin") {
    return (
      <div style={{ ...theme, minHeight: "100vh" }}>
        <SuperAdminPanel profile={profile} onLogout={() => supabase.auth.signOut()} />
      </div>
    );
  }

  return (
    <div style={{ ...theme, minHeight: "100vh" }}>
      <MainApp profile={profile} association={association} subscription={subscription}
        onAssociationChange={setAssociation} onLogout={() => supabase.auth.signOut()} />
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
                      <select value={sub?.plan || "essai"} onChange={(e) => sub && updateSub(sub.id, { plan: e.target.value })} style={{ ...inputStyle, padding: "3px 6px", fontSize: 12 }}>
                       <option value="essai">{t("sa_plan_trial")}</option><option value="standard">{t("sa_plan_standard")}</option><option value="premium">{t("sa_plan_premium")}</option>
                      </select>
                    </td>
                    <td style={td}>
                      <select value={sub?.statut || "actif"} onChange={(e) => sub && updateSub(sub.id, { statut: e.target.value })} style={{ ...inputStyle, padding: "3px 6px", fontSize: 12 }}>
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
  const [tab, setTab] = useState(profile.role === "adherent" ? "monespace" : "dashboard");
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const isBureau = ["bureau_president", "bureau_secretaire", "bureau_tresorier"].includes(profile.role);
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
  const [documents, setDocuments] = useState([]);
  const [donations, setDonations] = useState([]);
  const [loans, setLoans] = useState([]);
  const [loanRepayments, setLoanRepayments] = useState([]);
  const [bureauProfiles, setBureauProfiles] = useState([]);
  const [deletionRequests, setDeletionRequests] = useState([]);

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
      ]);
      const [mem, colPres, tonPres, seancesData, depensesData, recouvrementsData, ann, log, docs, dons, lns, repays, bProfiles, delReqs] = results.map((r) => r.data || []);
      const firstError = results.find((r) => r.error)?.error;
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
      setErrorMsg(t("load_profile_error") + " " + (e.message || String(e)));
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

  // ---------- Fiche Collation ----------
  const COLLATION_MENSUEL = 10;
  function collationMontant(memberId, mois) { return Number(collationPres.find((r) => r.member_id === memberId && r.mois === mois)?.montant || 0); }
  function collationTotalMois(memberId) { return MONTHS.reduce((s, mo) => s + collationMontant(memberId, mo), 0); }
  function collationMoisTotal(mois) { return visibleMembers.reduce((s, m) => s + collationMontant(m.id, mois), 0); }
  function collationDu(memberId) { return MONTHS.length * COLLATION_MENSUEL; }
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
    if (error) setErrorMsg("Erreur : " + error.message);
  }

  // ---------- Fiche Tontine ----------
  function tontineMontant(memberId, seance) { return Number(tontinePres.find((r) => r.member_id === memberId && r.seance === seance)?.montant || 0); }
  function tontineTotal(memberId) { return SEANCES.reduce((s, se) => s + tontineMontant(memberId, se), 0); }
  function tontineSeanceTotal(seance) { return visibleMembers.reduce((s, m) => s + tontineMontant(m.id, seance), 0); }
  const tontineTotalVerse = members.reduce((s, m) => s + tontineTotal(m.id), 0);
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
    if (error) setErrorMsg("Erreur : " + error.message);
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
    const nbContrib = activeMembers.filter((m) => tontineMontant(m.id, newSeance.numero) > 0).length;
    setSaving(true);
    const { data, error } = await supabase.from("tontine_seances").insert({
      association_id: profile.association_id, type: "tontine", numero: newSeance.numero, date: newSeance.date || null, nb_contrib: nbContrib,
      beneficiaire_id: newSeance.beneficiaireId || null, decharge_signee: newSeance.dechargeSignee,
      date_decharge: newSeance.dechargeSignee ? (newSeance.date || null) : null,
    }).select().single()
    setSaving(false);
    if (error) { setErrorMsg("Erreur : " + error.message); return; }
    setSeances((prev) => [...prev, data]);
    setNewSeance({ numero: newSeance.numero + 1, date: "", beneficiaireId: "", dechargeSignee: false });
  }

  const collationMoisDisponibles = MONTHS.filter((mo) => !collationSeances.some((s) => s.mois === mo));
  const [newCollAttrib, setNewCollAttrib] = useState({ mois: MONTHS[0], date: "", beneficiaireId: "", dechargeSignee: false });
  useEffect(() => {
    if (collationMoisDisponibles.length && !collationMoisDisponibles.includes(newCollAttrib.mois)) {
      setNewCollAttrib((s) => ({ ...s, mois: collationMoisDisponibles[0] }));
    }
  }, [collationSeances.length]);

  async function addCollationAttribution() {
    if (!canEditRubrique("collation")) return;
    if (collationSeances.some((s) => s.mois === newCollAttrib.mois)) {
      setErrorMsg(t("coll_mois_taken"));
      return;
    }
    const nbContrib = activeMembers.filter((m) => collationMontant(m.id, newCollAttrib.mois) > 0).length;
    setSaving(true);
    const { data, error } = await supabase.from("tontine_seances").insert({
      association_id: profile.association_id, type: "collation", mois: newCollAttrib.mois,
      numero: 1000 + MONTHS.indexOf(newCollAttrib.mois), date: newCollAttrib.date || null, nb_contrib: nbContrib,
      beneficiaire_id: newCollAttrib.beneficiaireId || null, decharge_signee: newCollAttrib.dechargeSignee,
      date_decharge: newCollAttrib.dechargeSignee ? (newCollAttrib.date || null) : null,
    }).select().single();
    setSaving(false);
    if (error) { setErrorMsg("Erreur : " + error.message); return; }
    setSeances((prev) => [...prev, data]);
    setNewCollAttrib({ mois: MONTHS[0], date: "", beneficiaireId: "", dechargeSignee: false });
  }

  const [dechargeSeanceId, setDechargeSeanceId] = useState(null);
  async function markDechargeSigned(seanceId) {
    if (!canEditRubrique("tontine")) return;
    setSaving(true);
    const { error } = await supabase.from("tontine_seances").update({ decharge_signee: true, date_decharge: todayISO() }).eq("id", seanceId);
    setSaving(false);
    if (error) { setErrorMsg("Erreur : " + error.message); return; }
    setSeances((prev) => prev.map((s) => (s.id === seanceId ? { ...s, decharge_signee: true, date_decharge: todayISO() } : s)));
  }
  async function savePieceIdentite(seanceId, valeur) {
    if (!canEditRubrique("tontine")) return;
    setSaving(true);
    const { error } = await supabase.from("tontine_seances").update({ beneficiaire_piece_identite: valeur || null }).eq("id", seanceId);
    setSaving(false);
    if (error) { setErrorMsg("Erreur : " + error.message); return; }
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
    if (error) { setErrorMsg("Erreur : " + error.message); return; }
    setSeances((prev) => prev.filter((s) => s.id !== seanceId));
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
    if (error) { setErrorMsg("Erreur : " + error.message); return; }
    setDeletionRequests((prev) => prev.map((r) => (r.id === req.id ? { ...r, statut: "approuvee", reviewed_by: profile.id, reviewed_at: new Date().toISOString() } : r)));
    await loadAll();
  }
  async function rejectDeletionRequest(req) {
    if (association?.approbateur_suppression_id !== profile.id) return;
    const motif = window.prompt(t("del_req_reject_reason_prompt")) || "";
    setSaving(true);
    const { error } = await supabase.from("deletion_requests").update({ statut: "rejetee", reviewed_by: profile.id, reviewed_at: new Date().toISOString(), motif_rejet: motif || null }).eq("id", req.id);
    setSaving(false);
    if (error) { setErrorMsg("Erreur : " + error.message); return; }
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
    if (error) { setErrorMsg("Erreur : " + error.message); return false; }
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
    // leur période de probation (comptée depuis leur date d'adhésion) ET déjà
    // acquitté leur fonds de secours sont soumis au recouvrement. Sans
    // période de probation renseignée pour l'association, le recouvrement
    // s'applique dès que le fonds de secours est payé (comportement par
    // défaut). Le fonds d'urgence n'est pas concerné par cette règle.
    const beneficiaires = fonds === "secours" ? activeMembers.filter((m) => estEligibleRecouvrementSecours(m, association)) : activeMembers;
    const montant = Number(draft.montant);
    const quotePart = beneficiaires.length > 0 ? montant / beneficiaires.length : 0;
    setSaving(true);
    const { data: depense, error: e1 } = await supabase.from("fonds_depenses").insert({
      association_id: profile.association_id, fonds, date: draft.date, description: draft.description,
      montant, nb_actifs_snapshot: beneficiaires.length,
    }).select().single();
    if (e1) { setSaving(false); setErrorMsg("Erreur : " + e1.message); return; }
    const rows = beneficiaires.map((m) => ({
      association_id: profile.association_id, depense_id: depense.id, member_id: m.id,
      quote_part: Math.round(quotePart * 100) / 100, paye: false,
    }));
    const { data: recs, error: e2 } = rows.length > 0
      ? await supabase.from("fonds_recouvrements").insert(rows).select()
      : { data: [], error: null };
    setSaving(false);
    if (e2) { setErrorMsg("Erreur : " + e2.message); return; }
    if (fonds === "urgence") { setFuDepenses((p) => [...p, depense]); setFuRecouvrements((p) => [...p, ...recs]); setFuDraft({ date: "", description: "", montant: "" }); }
    else { setFsDepenses((p) => [...p, depense]); setFsRecouvrements((p) => [...p, ...recs]); setFsDraft({ date: "", description: "", montant: "" }); }
  }

  async function marquerRecouvrementPaye(fonds, id) {
    const rubriqueKey = fonds === "urgence" ? "fonds_urgence" : "fonds_secours";
    if (!canEditRubrique(rubriqueKey)) return;
    const setFn = fonds === "urgence" ? setFuRecouvrements : setFsRecouvrements;
    setFn((prev) => prev.map((r) => (r.id === id ? { ...r, paye: true } : r)));
    setSaving(true);
    const { error } = await supabase.from("fonds_recouvrements").update({ paye: true, date_paiement: todayISO() }).eq("id", id);
    setSaving(false);
    if (error) setErrorMsg("Erreur : " + error.message);
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
    if (eRec) { setSaving(false); setErrorMsg("Erreur : " + eRec.message); return; }
    const { error: eDep } = await supabase.from("fonds_depenses").delete().eq("id", depenseId);
    setSaving(false);
    if (eDep) { setErrorMsg("Erreur : " + eDep.message); return; }
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
    if (error) setErrorMsg("Erreur d'enregistrement : " + error.message);
  }

  const [newMemberForm, setNewMemberForm] = useState({ nom: "", email: "", dateAdhesion: "", statut: "Actif", dateNaissance: "", quartier: "", competences: "", disponibleBenevolat: false });
  const [deleteMotifs, setDeleteMotifs] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const [editMemberId, setEditMemberId] = useState(null);
  const [historyMemberId, setHistoryMemberId] = useState(null);
  const [historyFundFilter, setHistoryFundFilter] = useState(null);
  const [recouvHistoryMemberId, setRecouvHistoryMemberId] = useState(null);
  const [recouvHistoryFund, setRecouvHistoryFund] = useState(null);
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
    setSaving(true);
    const { data, error } = await supabase.from("members").insert({
  association_id: profile.association_id,
  nom: newMemberForm.nom, email: newMemberForm.email,
  date_adhesion: newMemberForm.dateAdhesion || null, statut: newMemberForm.statut,
  date_naissance: newMemberForm.dateNaissance || null, quartier: newMemberForm.quartier || null,
  competences: newMemberForm.competences || null, disponible_benevolat: newMemberForm.disponibleBenevolat,
}).select().single();
    setSaving(false);
    if (error) { setErrorMsg("Erreur d'ajout : " + error.message); return; }
    setMembers((prev) => [...prev, data]);
    setNewMemberForm({ nom: "", email: "", dateAdhesion: "", statut: "Actif" });
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
    if (error) setErrorMsg("Erreur : " + error.message);
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
    if (error) setErrorMsg("Erreur : " + error.message);
    else setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, statut: "Actif", motif_desactivation: null } : m)));
  }
  async function permanentlyDeleteMember(id) {
    if (!isBureau) return;
    setSaving(true);
    const { error } = await supabase.from("members").delete().eq("id", id);
    setSaving(false);
    if (error) { setErrorMsg("Erreur : " + error.message); return; }
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }

  // ---------- Annonces ----------
  const [newAnn, setNewAnn] = useState({ titre: "", message: "", urgent: false });
  async function publishAnnouncement() {
    if (!isBureau || !newAnn.titre.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.from("announcements").insert({
      association_id: profile.association_id, titre: newAnn.titre, message: newAnn.message,
      urgent: newAnn.urgent, created_by: profile.id,
    }).select().single();
    setSaving(false);
    if (!error) { setAnnouncements((p) => [data, ...p]); setNewAnn({ titre: "", message: "", urgent: false }); }
  }
  const [editingAnnId, setEditingAnnId] = useState(null);
  async function updateAnnouncement(id, patch) {
    const { error } = await supabase.from("announcements").update(patch).eq("id", id);
    if (!error) setAnnouncements((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }
  async function deleteAnnouncement(id) {
    if (!window.confirm(t("ann_confirm_delete"))) return;
    await supabase.from("announcements").delete().eq("id", id);
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
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
    setSaving(true);
    const path = `${profile.association_id}/${Date.now()}_${file.name}`;
    const { error: uploadErr } = await supabase.storage.from("documents").upload(path, file);
    if (uploadErr) { setSaving(false); setErrorMsg("Erreur de téléversement : " + uploadErr.message); return; }
    const { data, error } = await supabase.from("documents").insert({
      association_id: profile.association_id, nom: file.name, storage_path: path,
      rubrique: uploadRubrique, uploaded_by: profile.id,
    }).select().single();
    setSaving(false);
    if (!error) setDocuments((p) => [data, ...p]);
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
  async function saveBranding() {
    if (!isBureau) return;
    setSaving(true);
    const { data, error } = await supabase.from("associations").update({
      nom: brandDraft.nom, logo_url: brandDraft.logo_url, devise_texte: brandDraft.devise_texte,
      devise_monetaire: brandDraft.devise_monetaire, couleur_primaire: brandDraft.couleur_primaire, couleur_accent: brandDraft.couleur_accent,
      periode_probation_secours_jours: brandDraft.periode_probation_secours_jours ? Number(brandDraft.periode_probation_secours_jours) : null,
      approbateur_suppression_id: brandDraft.approbateur_suppression_id || null,
    }).eq("id", profile.association_id).select().single();
    setSaving(false);
    if (!error) onAssociationChange(data);
  }

  // ---------- Navigation par rôle ----------
  const navItems = [];
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
  { id: "gouvernance", label: t("nav_governance"), icon: Landmark },
  { id: "vieassociative", label: t("nav_community"), icon: Rss },
  { id: "projets", label: t("nav_projects"), icon: Kanban },
  { id: "evenements", label: t("nav_events"), icon: CalendarDays },
  { id: "dons", label: t("nav_donations"), icon: Gift },
  { id: "emprunts", label: t("nav_loans"), icon: Vote },
  { id: "documents", label: t("nav_documents"), icon: FileText },
  { id: "annonces", label: t("nav_announcements"), icon: Bell },
  { id: "journal", label: t("nav_activity"), icon: History },
  { id: "demandes_suppression", label: t("nav_del_requests"), icon: AlertTriangle },
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
      { id: "annonces", label: t("nav_announcements"), icon: Bell },
      { id: "securite", label: t("sec_title"), icon: ShieldCheck },
    );
  }

  if (loading) return <FullPageLoader text={t("load_data")} />;

  const me = isAdherent ? members.find((m) => m.id === profile.member_id) : null;

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
              return (
                <button key={n.id} onClick={() => setTab(n.id)} style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "6px 9px", borderRadius: 7, border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: 600, background: active ? "rgba(255,255,255,.14)" : "transparent",
                  color: active ? "var(--accent)" : "rgba(255,255,255,.8)", position: "relative",
                }}>
                  <Icon size={12} /> {n.label}
                  {showBadge && <span style={{ background: RED, color: "white", borderRadius: 999, fontSize: 9.5, fontWeight: 700, minWidth: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{deletionRequests.filter((r) => r.statut === "en_attente").length}</span>}
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
            ? [t("mem_col_name"), t("mem_email"), t("mem_col_join"), t("mem_birthdate"), t("mem_col_delete_date"), t("mem_col_action")]
            : [t("mem_col_name"), t("mem_email"), t("mem_col_join"), t("mem_birthdate"), t("mem_status"), t("mem_col_action")]}>
            {members.filter((m) => showArchived ? m.statut === "Supprimé" : m.statut !== "Supprimé").map((m) => (
              <tr key={m.id}>
                <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>
                  {showArchived ? (
                    <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => { setHistoryMemberId(m.id); setHistoryFundFilter("adhesion"); }}>{m.nom}</span>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ cursor: "pointer", textDecoration: "underline" }} title={t("mem_edit_title")} onClick={() => setEditMemberId(m.id)}>{m.nom}</span>
                      <button onClick={() => { setHistoryMemberId(m.id); setHistoryFundFilter("adhesion"); }} title={t("mem_view_history")} style={{ background: "none", border: "none", cursor: "pointer", color: "#999", display: "flex", flexShrink: 0 }}>
                        <History size={14} />
                      </button>
                    </div>
                  )}
                </td>
                <td style={td}>{m.email}</td>
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
          <RuleBox>{t("insc_rule")}</RuleBox>
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
          <RuleBox>{t("tont_rule")}</RuleBox>
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

          <Table head={[t("tont_col_seance"), t("tont_col_contributors"), t("tont_col_pot"), t("tont_beneficiary"), t("tont_col_date_reception"), t("tont_col_discharge"), t("tont_col_actions")]}>
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
            {tontineSeances.length === 0 && <tr><td colSpan={7} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
          </Table>
        </Section></Container>
      )}

      {/* ================= FICHE COLLATION ================= */}
      {tab === "collation" && (isBureau || (isResponsable && profile.rubrique_assignee === "collation")) && (
        <Container><Section>
          <h2 style={{ marginBottom: 14 }}>{t("collation_title")}</h2>
          <RuleBox>{t("collation_rule")}</RuleBox>
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
               {MONTH_KEYS.map((mk, i) => <th key={MONTHS[i]} style={{ background: "var(--primary)", color: "white", padding: "6px 6px", textAlign: "center" }}>{t(mk)}</th>)}
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
                      {MONTHS.map((mo) => (
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
                  {MONTHS.map((mo) => (
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
                  {collationMoisDisponibles.map((mo) => <option key={mo} value={mo}>{t(MONTH_KEYS[MONTHS.indexOf(mo)])}</option>)}
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

          <Table head={[t("coll_col_mois"), t("tont_col_contributors"), t("tont_col_pot"), t("tont_beneficiary"), t("tont_col_date_reception"), t("tont_col_discharge"), t("tont_col_actions")]}>
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
            {collationSeances.length === 0 && <tr><td colSpan={7} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
          </Table>
        </Section></Container>
      )}

      {/* ================= FICHES FONDS ================= */}
      {(tab === "urgence" || tab === "secours") && (isBureau || (isResponsable && profile.rubrique_assignee === (tab === "urgence" ? "fonds_urgence" : "fonds_secours"))) && (() => {
        const isUrgence = tab === "urgence";
        const fondsCode = isUrgence ? "urgence" : "secours";
        const memberKey = isUrgence ? "fonds_urgence" : "fonds_secours";
        const montantFixe = isUrgence ? 25 : 200;
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
            <RuleBox>{isUrgence ? t("fonds_urgence_rule") : t("fonds_secours_rule")}</RuleBox>
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
                const draftKey = fondsCode + "-" + m.id;
                return (
                  <tr key={m.id}>
                   <td style={{ ...td, fontWeight: 600, color: "var(--primary)", cursor: "pointer", textDecoration: "underline" }} onClick={() => { setHistoryMemberId(m.id); setHistoryFundFilter(fondsCode); }}>{m.nom}</td>
                    <td style={td}>{moneyF(montantFixe)}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>{moneyF(paye)}</div>
                      {editable && (
                        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                          <input type="number" placeholder={t("fonds_add_versement_placeholder")} value={versementDrafts[draftKey] || ""} onChange={(e) => setVersementDrafts((prev) => ({ ...prev, [draftKey]: e.target.value }))} style={{ ...inputStyle, width: 72, padding: "3px 6px", fontSize: 12 }} />
                          <button onClick={() => ajouterVersementFonds(fondsCode, m.id)} style={{ fontSize: 11, fontWeight: 600, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>{t("fonds_add_versement_btn")}</button>
                        </div>
                      )}
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
                        <button onClick={() => supprimerDepense(fondsCode, d.id)} style={{ fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Trash2 size={11} /> {t("fonds_delete_btn")}
                        </button>
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
                        <select value={d.rubrique} onChange={(e) => updateDocumentCategory(d.id, e.target.value)} style={{ ...inputStyle, padding: "3px 6px", fontSize: 11, width: "auto" }}>
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
                      onSave={(patch) => { updateAnnouncement(a.id, patch); setEditingAnnId(null); }}
                      onCancel={() => setEditingAnnId(null)}
                      t={t} inputStyle={inputStyle}
                    />
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <h3 style={{ fontSize: 15, margin: 0 }}>{a.titre}</h3>
                          {a.urgent && <Pill color={RED} bg="#FBE4E1">{t("ann_urgent_pill")}</Pill>}
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

      {/* ================= CONFIGURATION (marque blanche) ================= */}
      {tab === "config" && isBureau && (
        <Container><Section>
        <h2 style={{ marginBottom: 20 }}>{t("cfg_title")}</h2>
          <Card style={{ maxWidth: 480 }}>
            <Field label={t("cfg_org_name")}><input style={inputStyle} value={brandDraft.nom || ""} onChange={(e) => setBrandDraft({ ...brandDraft, nom: e.target.value })} /></Field>
            <Field label={t("cfg_logo_url")}><input style={inputStyle} value={brandDraft.logo_url || ""} onChange={(e) => setBrandDraft({ ...brandDraft, logo_url: e.target.value })} placeholder="https://…" /></Field>
           <Field label={t("cfg_slogan")}><input style={inputStyle} value={brandDraft.devise_texte || ""} onChange={(e) => setBrandDraft({ ...brandDraft, devise_texte: e.target.value })} /></Field>
            <Field label={t("cfg_currency_code")}><input style={inputStyle} value={brandDraft.devise_monetaire || ""} onChange={(e) => setBrandDraft({ ...brandDraft, devise_monetaire: e.target.value })} placeholder="CAD, XOF, EUR…" /></Field>
           <Field label={t("cfg_primary_color")}><input type="color" style={{ ...inputStyle, height: 40 }} value={brandDraft.couleur_primaire || "#1F3864"} onChange={(e) => setBrandDraft({ ...brandDraft, couleur_primaire: e.target.value })} /></Field>
           <Field label={t("cfg_accent_color")}><input type="color" style={{ ...inputStyle, height: 40 }} value={brandDraft.couleur_accent || "#C9A227"} onChange={(e) => setBrandDraft({ ...brandDraft, couleur_accent: e.target.value })} /></Field>
           <Btn onClick={saveBranding}>{t("action_save")}</Btn>
          </Card>

          <Card style={{ maxWidth: 480, marginTop: 22 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_secours_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_secours_intro")}</p>
            <Field label={t("cfg_probation_secours")}>
              <input type="number" min="0" style={inputStyle} value={brandDraft.periode_probation_secours_jours ?? ""} onChange={(e) => setBrandDraft({ ...brandDraft, periode_probation_secours_jours: e.target.value })} placeholder="0" />
            </Field>
            <p style={{ fontSize: 11.5, color: "#999", marginTop: -8, marginBottom: 14 }}>{t("cfg_probation_secours_help")}</p>
            <Btn onClick={saveBranding}>{t("action_save")}</Btn>
          </Card>

          <Card style={{ maxWidth: 480, marginTop: 22 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t("cfg_approbateur_title")}</h3>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{t("cfg_approbateur_intro")}</p>
            <Field label={t("cfg_approbateur_label")}>
              <select style={inputStyle} value={brandDraft.approbateur_suppression_id || ""} onChange={(e) => setBrandDraft({ ...brandDraft, approbateur_suppression_id: e.target.value })}>
                <option value="">{t("cfg_approbateur_none")}</option>
                {bureauProfiles.map((p) => <option key={p.id} value={p.id}>{p.nom_complet || p.id.slice(0, 8)} — {t(ROLE_KEY_MAP[p.role])}</option>)}
              </select>
            </Field>
            <Btn onClick={saveBranding}>{t("action_save")}</Btn>
          </Card>
        </Section></Container>
      )}

      {/* ================= MON ESPACE (adhérent) ================= */}
      {tab === "monespace" && isAdherent && (
        <Container><Section>
          <h2 style={{ marginBottom: 6 }}>{t("ms_title")}</h2>
         <p style={{ color: "#5B6270", marginBottom: 20 }}>{me ? `${t("ms_welcome")} ${me.nom}.` : t("ms_not_linked")}</p>
          {me && (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }} className="no-print">
               <Btn variant="outline" onClick={() => window.print()}><Printer size={14} /> {t("ms_print_btn")}</Btn>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14 }}>
                <StatCard label={t("ms_inscription")} value={`${moneyF(me.inscription_paye)} / ${moneyF(inscriptionMontant)}`} icon={IdCard} />
              <StatCard label={t("ms_tontine_paid")} value={moneyF(tontineTotal(me.id))} icon={HeartHandshake} accent={TEAL} />
                <StatCard label={t("ms_collation")} value={`${moneyF(collationTotalMois(me.id))} / ${moneyF(collationDu(me.id))}`} icon={Coffee} />
               <StatCard label={t("ms_fonds_urgence")} value={`${moneyF(me.fonds_urgence_paye)} / ${moneyF(25)}`} icon={ShieldCheck} accent={TEAL} />
                <StatCard label={t("ms_fonds_secours")} value={`${moneyF(me.fonds_secours_paye)} / ${moneyF(200)}`} icon={LifeBuoy} />
              </div>
              <h3 style={{ fontSize: 15, margin: "24px 0 10px" }}>{t("ms_recoveries_title")}</h3>
              <Table head={[t("ms_col_fund"), t("ms_col_quotepart"), t("ms_col_status")]}>
               {[...fuRecouvrements.map((r) => ({ ...r, fonds: t("ms_urgence") })), ...fsRecouvrements.map((r) => ({ ...r, fonds: t("ms_secours") }))]
                  .filter((r) => r.member_id === me.id)
                  .map((r) => (
                    <tr key={r.id}><td style={td}>{r.fonds}</td><td style={td}>{moneyF(r.quote_part)}</td><td style={{ ...td, color: r.paye ? TEAL : RED, fontWeight: 700 }}>{r.paye ? t("paid") : t("unpaid")}</td></tr>
                  ))}
              </Table>
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
        return <EditMemberModal member={m} onClose={() => setEditMemberId(null)} onSave={(id, patch) => patchMember(id, patch)} t={t} />;
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
            canEdit={canEditRubrique(isCollation ? "collation" : "tontine")}
            onClose={() => setDechargeSeanceId(null)}
            onMarkSigned={() => markDechargeSigned(s.id)}
            onSavePiece={(valeur) => savePieceIdentite(s.id, valeur)}
          />
        );
      })()}
    </div>
  );
}

function DechargeModal({ seance, association, docTitle, body, t, lang, canEdit, onClose, onMarkSigned, onSavePiece }) {
  const todayFormatted = new Date().toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA");
  return createPortal(
    <div className="decharge-print-root" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }} onClick={onClose}>
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
        <h3 style={{ marginBottom: 4 }}>{association?.nom}</h3>
        <h4 style={{ marginBottom: 20, fontWeight: 600 }}>{docTitle}</h4>
        <p style={{ fontSize: 14, lineHeight: 1.7 }}>{body}</p>
        <div style={{ marginTop: 50 }}>
          <div style={{ borderTop: "1px solid #333", paddingTop: 6, fontSize: 12, maxWidth: 280 }}>{t("tont_decharge_signature")}</div>
        </div>
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
// Modifier une annonce — édition en ligne dans la carte elle-même
// (même pattern que EditPostForm pour le fil d'actualité de Vie associative).
// =====================================================================
function EditAnnouncementForm({ announcement, onSave, onCancel, t, inputStyle }) {
  const [titre, setTitre] = useState(announcement.titre || "");
  const [message, setMessage] = useState(announcement.message || "");
  const [urgent, setUrgent] = useState(!!announcement.urgent);
  function handleSave() {
    if (!titre.trim()) return;
    onSave({ titre: titre.trim(), message, urgent });
  }
  return (
    <div>
      <input style={{ ...inputStyle, marginBottom: 8, fontWeight: 600 }} value={titre} onChange={(e) => setTitre(e.target.value)} />
      <textarea style={{ ...inputStyle, minHeight: 80, marginBottom: 8 }} value={message} onChange={(e) => setMessage(e.target.value)} />
      <select style={{ ...inputStyle, marginBottom: 10, maxWidth: 160 }} value={urgent ? "oui" : "non"} onChange={(e) => setUrgent(e.target.value === "oui")}>
        <option value="non">{t("mem_no")}</option><option value="oui">{t("mem_yes")}</option>
      </select>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleSave} style={{ fontSize: 11, color: "white", background: "var(--primary)", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>{t("action_save")}</button>
        <button onClick={onCancel} style={{ fontSize: 11, color: "var(--primary)", background: "none", border: "1px solid var(--primary)", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>{t("action_cancel")}</button>
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
    nom: member.nom || "", email: member.email || "", dateAdhesion: member.date_adhesion || "",
    statut: member.statut || "Actif", dateNaissance: member.date_naissance || "",
    quartier: member.quartier || "", competences: member.competences || "",
    disponibleBenevolat: !!member.disponible_benevolat,
  });
  function handleSave() {
    if (!form.nom.trim()) return;
    onSave(member.id, {
      nom: form.nom.trim(),
      email: form.email.trim() || null,
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
      adhesion: ["nom", "email", "date_adhesion", "date_naissance", "quartier", "competences", "disponible_benevolat", "motif_desactivation", "date_desactivation"],
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
        email: "Courriel", quartier: "Adresse", competences: "Compétences",
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