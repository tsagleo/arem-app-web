// =====================================================================
// LiaisonCompte.jsx — liaison d'un compte à sa fiche adhérent, sans SQL
// =====================================================================
// Voir src/liaisonTextes.js (textes) et
// sql/2026-10-09a_liaison_compte_fondateur.sql (lier_mon_compte_fiche).
//  • CompteNonRelieBanner : bandeau en haut de l'application tant que le
//    compte connecté n'est relié à aucune fiche.
//  • LierMonCompteCard    : dans Gestion des accès, le membre du bureau
//    (fondateur) relie lui-même son compte à sa fiche, existante ou créée
//    sur place.
//  • AideDemandeAdhesion  : explications pour la personne qui rejoint
//    avec le code d'invitation.
//  • AideTraitementDemandes : marche à suivre pour le bureau qui confirme.
// =====================================================================
import { useState, useEffect } from "react";
import { Link2, Info, UserPlus } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Card, Btn, Field, inputStyle, useLang, friendlyError, TEAL, TEAL_LIGHT, RED } from "./shared";
import { txtLiaison, fichesNomProche } from "./liaisonTextes";

const BUREAU_ROLES = ["bureau_president", "bureau_secretaire", "bureau_tresorier"];
const fill = (s, vars) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);
const messageErreur = (error, t) => (error?.code === "P0001" ? error.message : friendlyError(error, t));

export function CompteNonRelieBanner({ profile, onOpen }) {
  const { lang } = useLang();
  const L = txtLiaison(lang);
  if (!profile || profile.member_id || !profile.association_id || profile.role === "super_admin") return null;
  const bureau = BUREAU_ROLES.includes(profile.role);
  return (
    <div className="no-print" style={{ background: "#FFF6E0", color: "#7A5300", padding: "8px 24px", fontSize: 12.5, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <Link2 size={14} />
      <span style={{ flex: 1, minWidth: 220 }}>{bureau ? L.banner_bureau : L.banner_adherent}</span>
      {bureau && onOpen && (
        <button onClick={onOpen} style={{ background: "#7A5300", color: "white", border: "none", borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          {L.banner_bureau_btn}
        </button>
      )}
    </div>
  );
}

export function LierMonCompteCard({ profile }) {
  const { t, lang } = useLang();
  const L = txtLiaison(lang);
  const [fiches, setFiches] = useState([]); // fiches de l'association sans compte relié
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState("existante");
  const [choix, setChoix] = useState("");
  const [f, setF] = useState({ nom: profile.nom_complet || "", email: "", telephone: "", date_adhesion: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    let annule = false;
    (async () => {
      const [{ data: mem }, { data: profs }, { data: u }] = await Promise.all([
        supabase.from("members").select("id,nom,email,telephone,statut").eq("association_id", profile.association_id).order("nom"),
        supabase.from("profiles").select("member_id").eq("association_id", profile.association_id),
        supabase.auth.getUser(),
      ]);
      if (annule) return;
      const relies = new Set((profs || []).map((p) => p.member_id).filter(Boolean));
      const libres = (mem || []).filter((m) => !relies.has(m.id) && m.statut !== "Supprimé");
      const mail = u?.user?.email || "";
      setFiches(libres);
      setEmail(mail);
      setF((p) => ({ ...p, email: p.email || mail }));
      if (libres.length === 0) setMode("nouvelle");
    })();
    return () => { annule = true; };
  }, [profile.association_id]);

  if (profile.member_id || !BUREAU_ROLES.includes(profile.role)) return null;

  const parCourriel = email ? fiches.filter((m) => (m.email || "").toLowerCase() === email.toLowerCase()) : [];
  const suggestions = [...new Map([...parCourriel, ...fichesNomProche(profile.nom_complet, fiches)].map((m) => [m.id, m])).values()];

  async function lier(memberId, nom) {
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("lier_mon_compte_fiche", { p_member_id: memberId });
    setBusy(false);
    if (error) { setMsg(messageErreur(error, t)); return false; }
    setOk(fill(L.self_linked_ok, { nom }) + " " + L.self_done);
    // Le profil (member_id) est chargé au démarrage de l'application :
    // on recharge pour que toutes les rubriques le voient.
    setTimeout(() => window.location.reload(), 1800);
    return true;
  }
  async function lierExistante() {
    const fiche = fiches.find((m) => m.id === choix);
    if (!fiche || !window.confirm(fill(L.self_confirm, { nom: fiche.nom }))) return;
    await lier(fiche.id, fiche.nom);
  }
  async function creerEtLier() {
    const nom = f.nom.trim();
    if (!nom) { setMsg(L.self_missing_name); return; }
    if (!window.confirm(fill(L.self_create_confirm, { nom }))) return;
    setBusy(true); setMsg("");
    const { data, error } = await supabase.from("members").insert({
      association_id: profile.association_id, nom, email: f.email.trim() || null, telephone: f.telephone.trim() || null,
      date_adhesion: f.date_adhesion || null, statut: "Actif",
    }).select("id").single();
    setBusy(false);
    if (error) { setMsg(messageErreur(error, t)); return; }
    await lier(data.id, nom);
  }

  const radio = (val, label) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginBottom: 6 }}>
      <input type="radio" checked={mode === val} onChange={() => setMode(val)} /> {label}
    </label>
  );

  return (
    <Card style={{ marginBottom: 22, border: `2px solid ${TEAL}` }}>
      <h3 style={{ fontSize: 15, margin: "0 0 6px", display: "flex", alignItems: "center", gap: 8 }}><Link2 size={16} color={TEAL} /> {L.self_title}</h3>
      <p style={{ fontSize: 12.5, color: "#4A5468", margin: "0 0 6px" }}>{L.self_intro}</p>
      <p style={{ fontSize: 12, color: "#7A5300", margin: "0 0 12px" }}>{L.self_warning}</p>
      {ok && <p style={{ background: TEAL_LIGHT, color: TEAL, padding: "8px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600 }}>{ok}</p>}
      {msg && <p style={{ background: "#FBE4E1", color: RED, padding: "8px 12px", borderRadius: 8, fontSize: 12.5 }}>{msg}</p>}

      {!ok && (
        <>
          {radio("existante", L.self_option_existing)}
          {mode === "existante" && (
            <div style={{ margin: "4px 0 12px 24px" }}>
              {fiches.length === 0 ? <p style={{ fontSize: 12, color: "#686F7D" }}>{L.self_none_available}</p> : (
                <>
                  {suggestions.length > 0 && (
                    <div style={{ fontSize: 12, marginBottom: 8 }}>
                      <b>{L.self_suggested} :</b>{" "}
                      {suggestions.map((m) => (
                        <button key={m.id} onClick={() => setChoix(m.id)} style={{ margin: "2px 4px", border: `1px solid ${TEAL}`, background: choix === m.id ? TEAL_LIGHT : "white", color: TEAL, borderRadius: 999, padding: "2px 10px", fontSize: 12, cursor: "pointer" }}>
                          {m.nom}{m.email ? ` (${m.email})` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select style={{ ...inputStyle, width: 320, maxWidth: "100%" }} value={choix} onChange={(e) => setChoix(e.target.value)}>
                      <option value="">{L.self_pick}</option>
                      {fiches.map((m) => <option key={m.id} value={m.id}>{m.nom}{m.email ? ` (${m.email})` : ""}{m.telephone ? ` · ${m.telephone}` : ""}</option>)}
                    </select>
                    <Btn disabled={!choix || busy} onClick={lierExistante}><Link2 size={14} /> {L.self_link_btn}</Btn>
                  </div>
                </>
              )}
            </div>
          )}
          {radio("nouvelle", L.self_option_new)}
          {mode === "nouvelle" && (
            <div style={{ margin: "4px 0 0 24px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 14px" }}>
                <Field label={L.self_f_nom}><input style={inputStyle} value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Field>
                <Field label={L.self_f_email}><input type="email" style={inputStyle} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
                <Field label={L.self_f_tel}><input type="tel" style={inputStyle} value={f.telephone} onChange={(e) => setF({ ...f, telephone: e.target.value })} /></Field>
                <Field label={L.self_f_date}><input type="date" style={inputStyle} value={f.date_adhesion} onChange={(e) => setF({ ...f, date_adhesion: e.target.value })} /></Field>
              </div>
              <Btn disabled={busy} onClick={creerEtLier}><UserPlus size={14} /> {L.self_create_btn}</Btn>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Etapes({ titre, etapes }) {
  return (
    <div style={{ background: TEAL_LIGHT, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: TEAL, display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}><Info size={14} /> {titre}</div>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: "#2F3A4A", lineHeight: 1.55 }}>
        {etapes.map((e, i) => <li key={i}>{e}</li>)}
      </ol>
    </div>
  );
}

export function AideDemandeAdhesion() {
  const { lang } = useLang();
  const L = txtLiaison(lang);
  return <Etapes titre={L.join_help_title} etapes={[L.join_help_1, L.join_help_2, L.join_help_3]} />;
}

export function AideTraitementDemandes() {
  const { lang } = useLang();
  const L = txtLiaison(lang);
  return <Etapes titre={L.req_help_title} etapes={[L.req_help_1, L.req_help_2, L.req_help_3, L.req_help_4]} />;
}
