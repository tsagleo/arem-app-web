// =====================================================================
// ParametresBadges.jsx — Configuration → Adhésion : validité des badges
// (cartes de membre) — 2026-10-10
// =====================================================================
// Demande de l'utilisateur : la durée ou la date de validité des badges
// est réglée par l'association. Voir sql/2026-10-10d_badges_validite.sql
// (une carte périmée n'est plus acceptée nulle part).
// =====================================================================
import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { Card, Btn, Field, inputStyle, useLang, friendlyError } from "./shared";

const TXT = {
  fr: {
    title: "Validité des badges (cartes de membre)",
    intro: "Durée pendant laquelle le badge d'un membre est accepté (entrée des événements, présences, achats groupés, vérification). Une fois la date passée, le badge est refusé : il faut en imprimer un nouveau.",
    mode: "Le badge est valable…",
    annee: "pour l'année en cours (jusqu'au 31 décembre)",
    date: "jusqu'à une date fixe",
    duree: "pendant une durée à partir de sa remise",
    dateLabel: "Valable jusqu'au",
    dureeLabel: "Durée de validité (mois)",
    save: "Enregistrer",
    confirm: "Enregistrer la validité des badges ?",
    saved: "Validité des badges enregistrée.",
    missing: "Indiquez la date ou la durée.",
    sql: "Réglage indisponible : exécutez d'abord sql/2026-10-10d_badges_validite.sql dans Supabase.",
  },
  en: {
    title: "Badge validity (membership cards)",
    intro: "How long a member's badge is accepted (event entry, attendance, group buying, verification). After that date the badge is refused and a new one must be printed.",
    mode: "The badge is valid…",
    annee: "for the current year (until December 31)",
    date: "until a fixed date",
    duree: "for a period starting when it is issued",
    dateLabel: "Valid until",
    dureeLabel: "Validity period (months)",
    save: "Save",
    confirm: "Save the badge validity?",
    saved: "Badge validity saved.",
    missing: "Enter the date or the period.",
    sql: "Setting unavailable: first run sql/2026-10-10d_badges_validite.sql in Supabase.",
  },
};

export default function ParametresBadges({ association, onAssociationChange }) {
  const { t, lang } = useLang();
  const L = TXT[lang === "en" ? "en" : "fr"];
  const [f, setF] = useState({ mode: "annee", date: "", mois: "" });
  const [msg, setMsg] = useState("");
  useEffect(() => {
    setF({
      mode: association?.badge_validite_mode || "annee",
      date: association?.badge_valide_jusqu_au || "",
      mois: association?.badge_duree_mois ?? "",
    });
  }, [association?.badge_validite_mode, association?.badge_valide_jusqu_au, association?.badge_duree_mois]);

  async function save() {
    if ((f.mode === "date" && !f.date) || (f.mode === "duree" && !Number(f.mois))) { setMsg(L.missing); return; }
    if (!window.confirm(L.confirm)) return;
    setMsg("");
    const { data, error } = await supabase.from("associations").update({
      badge_validite_mode: f.mode,
      badge_valide_jusqu_au: f.mode === "date" ? f.date : null,
      badge_duree_mois: f.mode === "duree" ? Number(f.mois) : null,
    }).eq("id", association.id).select().single();
    if (error) { setMsg(error.code === "PGRST204" || /column/i.test(error.message || "") ? L.sql : friendlyError(error, t)); return; }
    onAssociationChange?.(data);
    setMsg(L.saved);
  }

  const radio = (val, label) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 6, cursor: "pointer" }}>
      <input type="radio" checked={f.mode === val} onChange={() => setF({ ...f, mode: val })} /> {label}
    </label>
  );
  return (
    <Card style={{ maxWidth: 480, marginTop: 22 }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>{L.title}</h3>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{L.intro}</p>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{L.mode}</div>
      {radio("annee", L.annee)}
      {radio("date", L.date)}
      {f.mode === "date" && (
        <div style={{ marginLeft: 24 }}>
          <Field label={L.dateLabel}><input type="date" style={inputStyle} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
      )}
      {radio("duree", L.duree)}
      {f.mode === "duree" && (
        <div style={{ marginLeft: 24 }}>
          <Field label={L.dureeLabel}><input type="number" min={1} max={120} style={inputStyle} value={f.mois} onChange={(e) => setF({ ...f, mois: e.target.value })} placeholder="12" /></Field>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <Btn onClick={save}>{L.save}</Btn>
        {msg && <span style={{ fontSize: 12, color: "#5B6270" }}>{msg}</span>}
      </div>
    </Card>
  );
}
