import React, { useState, useEffect, useCallback } from "react";
import {
  Users, LayoutDashboard, HeartHandshake, FileBarChart, Home,
  Plus, ShieldCheck, ArrowRight, CheckCircle2, Circle, Coffee, LifeBuoy, IdCard, Loader2, AlertTriangle,
} from "lucide-react";
import { supabase } from "./supabaseClient";

const NAVY = "#1F3864";
const NAVY_DARK = "#152645";
const GOLD = "#C9A227";
const GOLD_LIGHT = "#E8CE7A";
const TEAL = "#2E8B74";
const TEAL_LIGHT = "#E4F2EE";
const CHARCOAL = "#2A2A2A";
const BG = "#F8F8F6";
const RED = "#C0392B";

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const SEANCES = Array.from({ length: 12 }, (_, i) => i + 1);

function money(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------- UI primitives (identiques à la version démo) ----------------
function Section({ children, style }) { return <section style={{ padding: "36px 0", ...style }}>{children}</section>; }
function Container({ children, style }) { return <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px", ...style }}>{children}</div>; }
function Pill({ children, color = TEAL, bg = TEAL_LIGHT }) {
  return <span style={{ display: "inline-block", background: bg, color, fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", padding: "4px 12px", borderRadius: 999 }}>{children}</span>;
}
function Card({ children, style }) {
  return <div style={{ background: "white", borderRadius: 12, padding: 22, boxShadow: "0 4px 18px rgba(31,56,100,0.08)", borderTop: "3px solid transparent", ...style }}>{children}</div>;
}
function RuleBox({ children }) {
  return (
    <div style={{ background: "#FBF3D9", border: "1px solid #EEDDA0", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#8a6d1a" }}>
      <b>RÈGLE — </b>{children}
    </div>
  );
}
function StatCard({ label, value, accent = GOLD, icon: Icon }) {
  return (
    <Card style={{ borderTopColor: accent }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: TEAL, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        {Icon && <Icon size={14} />}{label}
      </div>
      <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 24, color: NAVY }}>{value}</div>
    </Card>
  );
}
function Field({ label, children }) {
  return <div style={{ marginBottom: 14 }}><label style={{ display: "block", fontWeight: 600, fontSize: 13, color: NAVY, marginBottom: 5 }}>{label}</label>{children}</div>;
}
const inputStyle = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #DCE0E8", fontSize: 14, fontFamily: "inherit", background: "white", boxSizing: "border-box" };
function Btn({ children, onClick, variant = "primary", disabled, style }) {
  const base = { display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 999, fontWeight: 600, fontSize: 14, cursor: disabled ? "not-allowed" : "pointer", border: "none", opacity: disabled ? 0.6 : 1 };
  const variants = {
    primary: { background: GOLD, color: NAVY_DARK },
    outline: { background: "transparent", color: NAVY, border: `2px solid ${NAVY}` },
    outlineWhite: { background: "transparent", color: "white", border: "2px solid rgba(255,255,255,.6)" },
  };
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant], ...style }}>{children}</button>;
}
function Table({ head, children }) {
  return (
    <div style={{ overflowX: "auto", background: "white", borderRadius: 12, boxShadow: "0 4px 18px rgba(31,56,100,0.08)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead><tr>{head.map((h) => <th key={h} style={{ textAlign: "left", background: NAVY, color: "white", padding: "7px 9px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".03em" }}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const td = { padding: "7px 9px", borderBottom: "1px solid #EEE" };

export default function AremApp() {
  const [tab, setTab] = useState("vitrine");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const [members, setMembers] = useState([]);
  const [collationPres, setCollationPres] = useState([]); // [{member_id, mois, present}]
  const [tontinePres, setTontinePres] = useState([]); // [{member_id, seance, present}]
  const [seances, setSeances] = useState([]);
  const [fuDepenses, setFuDepenses] = useState([]);
  const [fsDepenses, setFsDepenses] = useState([]);
  const [fuRecouvrements, setFuRecouvrements] = useState([]);
  const [fsRecouvrements, setFsRecouvrements] = useState([]);

  // ---------------- Chargement initial depuis Supabase ----------------
  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const [
        { data: mem, error: e1 },
        { data: colPres, error: e2 },
        { data: tonPres, error: e3 },
        { data: seancesData, error: e4 },
        { data: depensesData, error: e5 },
        { data: recouvrementsData, error: e6 },
      ] = await Promise.all([
        supabase.from("members").select("*").order("nom"),
        supabase.from("collation_presences").select("*"),
        supabase.from("tontine_presences").select("*"),
        supabase.from("tontine_seances").select("*").order("numero"),
        supabase.from("fonds_depenses").select("*").order("date"),
        supabase.from("fonds_recouvrements").select("*"),
      ]);
      const firstError = e1 || e2 || e3 || e4 || e5 || e6;
      if (firstError) throw firstError;

      setMembers(mem || []);
      setCollationPres(colPres || []);
      setTontinePres(tonPres || []);
      setSeances(seancesData || []);
      setFuDepenses((depensesData || []).filter((d) => d.fonds === "urgence"));
      setFsDepenses((depensesData || []).filter((d) => d.fonds === "secours"));
      const depenseFondsMap = Object.fromEntries((depensesData || []).map((d) => [d.id, d.fonds]));
      setFuRecouvrements((recouvrementsData || []).filter((r) => depenseFondsMap[r.depense_id] === "urgence"));
      setFsRecouvrements((recouvrementsData || []).filter((r) => depenseFondsMap[r.depense_id] === "secours"));
    } catch (err) {
      setErrorMsg(
        "Impossible de charger les données. Vérifiez que supabaseClient.js contient bien votre URL et votre clé, " +
        "et que le script arem_schema.sql a été exécuté. Détail : " + (err.message || String(err))
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const activeMembers = members.filter((m) => m.statut === "Actif");
  const nbActifs = activeMembers.length;

  function presentMap(list, memberId, keyField) {
    const row = list.find((r) => r.member_id === memberId && (keyField ? r[keyField] : true));
    return row;
  }

  // ---------------- Mise à jour d'un adhérent (colonnes directes) ----------------
  async function patchMember(id, patch) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m))); // optimiste
    setSaving(true);
    const { error } = await supabase.from("members").update(patch).eq("id", id);
    setSaving(false);
    if (error) setErrorMsg("Erreur d'enregistrement : " + error.message);
  }

  async function addMember(newMember) {
    setSaving(true);
    const { data, error } = await supabase.from("members").insert({
      nom: newMember.nom, email: newMember.email, date_adhesion: newMember.dateAdhesion || null, statut: newMember.statut,
    }).select().single();
    setSaving(false);
    if (error) { setErrorMsg("Erreur d'ajout : " + error.message); return; }
    setMembers((prev) => [...prev, data]);
  }

  // ---------------- Fiche Collation ----------------
  function collationValue(memberId, mois) {
    return collationPres.find((r) => r.member_id === memberId && r.mois === mois)?.present || false;
  }
  function collationCount(memberId) {
    return MONTHS.filter((mo) => collationValue(memberId, mo)).length;
  }
  function collationDu(memberId) { return collationCount(memberId) * 10; }
  const collationTotalDu = members.reduce((s, m) => s + collationDu(m.id), 0);
  const collationTotalPaye = members.reduce((s, m) => s + Number(m.collation_montant_paye || 0), 0);

  async function toggleCollation(memberId, mois, checked) {
    setCollationPres((prev) => {
      const exists = prev.find((r) => r.member_id === memberId && r.mois === mois);
      if (exists) return prev.map((r) => (r === exists ? { ...r, present: checked } : r));
      return [...prev, { member_id: memberId, mois, present: checked }];
    });
    setSaving(true);
    const { error } = await supabase.from("collation_presences")
      .upsert({ member_id: memberId, mois, present: checked }, { onConflict: "member_id,mois" });
    setSaving(false);
    if (error) setErrorMsg("Erreur : " + error.message);
  }

  // ---------------- Fiche Tontine ----------------
  function tontineValue(memberId, seance) {
    return tontinePres.find((r) => r.member_id === memberId && r.seance === seance)?.present || false;
  }
  function tontineCount(memberId) {
    return SEANCES.filter((s) => tontineValue(memberId, s)).length;
  }
  const tontineTotalVerse = members.reduce((s, m) => s + tontineCount(m.id) * 100, 0);
  function beneficiaryCount(memberId) {
    return seances.filter((s) => s.beneficiaire_id === memberId).length;
  }

  async function toggleTontine(memberId, seance, checked) {
    setTontinePres((prev) => {
      const exists = prev.find((r) => r.member_id === memberId && r.seance === seance);
      if (exists) return prev.map((r) => (r === exists ? { ...r, present: checked } : r));
      return [...prev, { member_id: memberId, seance, present: checked }];
    });
    setSaving(true);
    const { error } = await supabase.from("tontine_presences")
      .upsert({ member_id: memberId, seance, present: checked }, { onConflict: "member_id,seance" });
    setSaving(false);
    if (error) setErrorMsg("Erreur : " + error.message);
  }

  const [newSeance, setNewSeance] = useState({ numero: 1, date: "", beneficiaireId: "", dechargeSignee: false });
  useEffect(() => { setNewSeance((s) => ({ ...s, numero: seances.length + 1 })); }, [seances.length]);

  async function addSeance() {
    const nbContrib = activeMembers.filter((m) => tontineValue(m.id, newSeance.numero)).length;
    setSaving(true);
    const { data, error } = await supabase.from("tontine_seances").insert({
      numero: newSeance.numero, date: newSeance.date || null, nb_contrib: nbContrib,
      beneficiaire_id: newSeance.beneficiaireId || null, decharge_signee: newSeance.dechargeSignee,
      date_decharge: newSeance.dechargeSignee ? (newSeance.date || null) : null,
    }).select().single();
    setSaving(false);
    if (error) { setErrorMsg("Erreur : " + error.message); return; }
    setSeances((prev) => [...prev, data]);
    setNewSeance({ numero: newSeance.numero + 1, date: "", beneficiaireId: "", dechargeSignee: false });
  }

  // ---------------- Fiches Fonds (urgence / secours) ----------------
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
  const fuQuotePart = fuDraft.montant && nbActifs > 0 ? Number(fuDraft.montant) / nbActifs : 0;
  const fsQuotePart = fsDraft.montant && nbActifs > 0 ? Number(fsDraft.montant) / nbActifs : 0;

  async function enregistrerDepense(fonds) {
    const draft = fonds === "urgence" ? fuDraft : fsDraft;
    const quotePart = fonds === "urgence" ? fuQuotePart : fsQuotePart;
    if (!draft.date || !draft.montant) return;
    setSaving(true);
    const { data: depense, error: e1 } = await supabase.from("fonds_depenses").insert({
      fonds, date: draft.date, description: draft.description, montant: Number(draft.montant), nb_actifs_snapshot: nbActifs,
    }).select().single();
    if (e1) { setSaving(false); setErrorMsg("Erreur : " + e1.message); return; }

    const rows = activeMembers.map((m) => ({
      depense_id: depense.id, member_id: m.id, quote_part: Math.round(quotePart * 100) / 100, paye: false,
    }));
    const { data: recs, error: e2 } = await supabase.from("fonds_recouvrements").insert(rows).select();
    setSaving(false);
    if (e2) { setErrorMsg("Erreur : " + e2.message); return; }

    if (fonds === "urgence") {
      setFuDepenses((prev) => [...prev, depense]);
      setFuRecouvrements((prev) => [...prev, ...recs]);
      setFuDraft({ date: "", description: "", montant: "" });
    } else {
      setFsDepenses((prev) => [...prev, depense]);
      setFsRecouvrements((prev) => [...prev, ...recs]);
      setFsDraft({ date: "", description: "", montant: "" });
    }
  }

  async function marquerRecouvrementPaye(fonds, id) {
    const setFn = fonds === "urgence" ? setFuRecouvrements : setFsRecouvrements;
    setFn((prev) => prev.map((r) => (r.id === id ? { ...r, paye: true } : r)));
    setSaving(true);
    const { error } = await supabase.from("fonds_recouvrements").update({ paye: true, date_paiement: new Date().toISOString().slice(0, 10) }).eq("id", id);
    setSaving(false);
    if (error) setErrorMsg("Erreur : " + error.message);
  }

  // ---------------- Formulaire nouvel adhérent ----------------
  const [newMemberForm, setNewMemberForm] = useState({ nom: "", email: "", dateAdhesion: "", statut: "Actif" });
  async function handleAddMember() {
    if (!newMemberForm.nom.trim()) return;
    await addMember(newMemberForm);
    setNewMemberForm({ nom: "", email: "", dateAdhesion: "", statut: "Actif" });
  }

  // ---------------- Agrégats pour les états financiers ----------------
  const inscriptionTotalDu = members.length * 25;
  const inscriptionTotalPaye = members.reduce((s, m) => s + Number(m.inscription_paye || 0), 0);
  const totalRevenusHorsTontine = inscriptionTotalPaye + collationTotalPaye
    + members.reduce((s, m) => s + Number(m.fonds_urgence_paye || 0), 0)
    + members.reduce((s, m) => s + Number(m.fonds_secours_paye || 0), 0)
    + fuRecouvrements.filter((r) => r.paye).reduce((s, r) => s + Number(r.quote_part), 0)
    + fsRecouvrements.filter((r) => r.paye).reduce((s, r) => s + Number(r.quote_part), 0);
  const totalDepenses = fuDepenses.reduce((s, d) => s + Number(d.montant), 0) + fsDepenses.reduce((s, d) => s + Number(d.montant), 0);
  const excedent = totalRevenusHorsTontine - totalDepenses;

  const nav = [
    { id: "vitrine", label: "Vitrine", icon: Home },
    { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { id: "membres", label: "Adhérents", icon: Users },
    { id: "inscription", label: "Inscription", icon: IdCard },
    { id: "tontine", label: "Tontine", icon: HeartHandshake },
    { id: "collation", label: "Collation", icon: Coffee },
    { id: "urgence", label: "Fonds urgence", icon: ShieldCheck },
    { id: "secours", label: "Fonds secours", icon: LifeBuoy },
    { id: "finances", label: "États financiers", icon: FileBarChart },
  ];

  if (loading) {
    return (
      <div style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BG, fontFamily: "Inter, sans-serif", flexDirection: "column", gap: 12, padding: 40 }}>
        <Loader2 size={28} color={NAVY} className="spin" />
        <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ color: NAVY, fontWeight: 600 }}>Chargement des données AREM depuis Supabase…</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "Inter, -apple-system, sans-serif", background: BG, color: CHARCOAL, minHeight: "100%" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap');
        * { box-sizing: border-box; }
        h1,h2,h3 { font-family: 'Poppins', sans-serif; color: ${NAVY}; margin: 0; }
      `}</style>

      {errorMsg && (
        <div style={{ background: "#FBE4E1", color: RED, padding: "10px 24px", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={16} /> {errorMsg}
        </div>
      )}
      {saving && (
        <div style={{ background: TEAL_LIGHT, color: TEAL, padding: "4px 24px", fontSize: 11.5, textAlign: "right" }}>Enregistrement…</div>
      )}

      {/* ---------------- HEADER / NAV ---------------- */}
      <header style={{ background: NAVY, position: "sticky", top: 0, zIndex: 10, boxShadow: "0 2px 14px rgba(0,0,0,.12)" }}>
        <Container style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${GOLD}` }}>
              <HeartHandshake size={16} color={GOLD} />
            </div>
            <span style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, color: "white", fontSize: 17 }}>AREM</span>
          </div>
          <nav style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            {nav.map((n) => {
              const Icon = n.icon;
              const active = tab === n.id;
              return (
                <button key={n.id} onClick={() => setTab(n.id)} style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "7px 10px", borderRadius: 7,
                  border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                  background: active ? "rgba(201,162,39,0.16)" : "transparent",
                  color: active ? GOLD : "rgba(255,255,255,.8)",
                }}>
                  <Icon size={13} /> {n.label}
                </button>
              );
            })}
          </nav>
        </Container>
      </header>

      {/* ---------------- VITRINE ---------------- */}
      {tab === "vitrine" && (
        <>
          <div style={{ background: `linear-gradient(150deg, ${NAVY} 0%, ${NAVY_DARK} 70%)`, color: "white" }}>
            <Container>
              <Section style={{ padding: "64px 0 52px" }}>
                <Pill color={GOLD_LIGHT} bg="rgba(255,255,255,.1)">Entraide &amp; solidarité communautaire</Pill>
                <h1 style={{ color: "white", fontSize: 34, marginTop: 16, maxWidth: 640, lineHeight: 1.15 }}>
                  Cinq rubriques, cinq fiches indépendantes — une transparence totale.
                </h1>
                <p style={{ color: "rgba(255,255,255,.8)", fontSize: 15.5, maxWidth: 580, marginTop: 14 }}>
                  Inscription, Tontine, Collation, Fonds d'urgence et Fonds de secours — les données sont maintenant
                  enregistrées de façon permanente dans une vraie base de données.
                </p>
                <div style={{ display: "flex", gap: 14, marginTop: 24, flexWrap: "wrap" }}>
                  <Btn onClick={() => setTab("dashboard")}>Voir le tableau de bord <ArrowRight size={16} /></Btn>
                  <Btn variant="outlineWhite" onClick={() => setTab("membres")}>Devenir membre</Btn>
                </div>
              </Section>
            </Container>
          </div>
          <Container>
            <Section>
              <h2 style={{ fontSize: 22, marginBottom: 6 }}>Les cinq fiches indépendantes</h2>
              <p style={{ color: "#5B6270", maxWidth: 680, marginBottom: 22 }}>Chaque rubrique a sa propre fiche de suivi, ses propres champs et ses propres calculs.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px,1fr))", gap: 16 }}>
                {[
                  ["Inscription", "25 $ — versement unique, obligatoire pour tout nouvel adhérent", TEAL, IdCard],
                  ["Tontine (Cotisation)", "100 $/mois — la cagnotte de chaque séance est remise à un bénéficiaire contre décharge", GOLD, HeartHandshake],
                  ["Collation (Présence)", "10 $/mois — obligatoire pour tous les adhérents", TEAL, Coffee],
                  ["Fonds d'urgence", "25 $/an, obligatoire — recouvrement des dépenses au prorata", GOLD, ShieldCheck],
                  ["Fonds de secours", "200 $ — versement unique — recouvrement des dépenses au prorata", TEAL, LifeBuoy],
                ].map(([title, desc, accent, Icon]) => (
                  <Card key={title} style={{ borderTopColor: accent }}>
                    <Icon size={20} color={accent} style={{ marginBottom: 8 }} />
                    <h3 style={{ fontSize: 15, marginBottom: 6 }}>{title}</h3>
                    <p style={{ color: "#5B6270", fontSize: 12.5, margin: 0 }}>{desc}</p>
                  </Card>
                ))}
              </div>
            </Section>
          </Container>
        </>
      )}

      {/* ---------------- TABLEAU DE BORD ---------------- */}
      {tab === "dashboard" && (
        <Container>
          <Section>
            <h2 style={{ marginBottom: 4 }}>Tableau de bord</h2>
            <p style={{ color: "#5B6270", marginBottom: 20 }}>Données en direct depuis Supabase.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px,1fr))", gap: 14, marginBottom: 26 }}>
              <StatCard label="Adhérents actifs" value={nbActifs} icon={Users} />
              <StatCard label="Inscriptions reçues" value={money(inscriptionTotalPaye)} icon={IdCard} accent={TEAL} />
              <StatCard label="Tontine versée (cumul)" value={money(tontineTotalVerse)} icon={HeartHandshake} />
              <StatCard label="Collation payée" value={money(collationTotalPaye)} icon={Coffee} accent={TEAL} />
              <StatCard label="Solde Fonds d'urgence" value={money(fuSolde)} icon={ShieldCheck} />
              <StatCard label="Solde Fonds de secours" value={money(fsSolde)} icon={LifeBuoy} accent={TEAL} />
            </div>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Détail par adhérent</h3>
            <Table head={["Adhérent", "Statut", "Inscription", "Tontine versée", "Collation payée", "Fonds urgence", "Fonds secours"]}>
              {members.map((m) => (
                <tr key={m.id}>
                  <td style={{ ...td, fontWeight: 600, color: NAVY }}>{m.nom}</td>
                  <td style={td}>
                    <span style={{ color: m.statut === "Actif" ? TEAL : "#999", fontWeight: 600 }}>
                      {m.statut === "Actif" ? <CheckCircle2 size={12} style={{ verticalAlign: -2, marginRight: 4 }} /> : <Circle size={12} style={{ verticalAlign: -2, marginRight: 4 }} />}
                      {m.statut}
                    </span>
                  </td>
                  <td style={td}>{money(m.inscription_paye)} / {money(25)}</td>
                  <td style={td}>{money(tontineCount(m.id) * 100)} ({tontineCount(m.id)} séances)</td>
                  <td style={td}>{money(m.collation_montant_paye)} / {money(collationDu(m.id))}</td>
                  <td style={td}>{money(m.fonds_urgence_paye)} / {money(25)}</td>
                  <td style={td}>{money(m.fonds_secours_paye)} / {money(200)}</td>
                </tr>
              ))}
            </Table>
          </Section>
        </Container>
      )}

      {/* ---------------- ADHÉRENTS ---------------- */}
      {tab === "membres" && (
        <Container>
          <Section>
            <h2 style={{ marginBottom: 20 }}>Adhérents</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 22 }}>
              <Card>
                <h3 style={{ fontSize: 14, marginBottom: 12 }}>Ajouter un adhérent</h3>
                <Field label="Nom complet"><input style={inputStyle} value={newMemberForm.nom} onChange={(e) => setNewMemberForm({ ...newMemberForm, nom: e.target.value })} placeholder="Nom et prénom" /></Field>
                <Field label="Courriel"><input style={inputStyle} value={newMemberForm.email} onChange={(e) => setNewMemberForm({ ...newMemberForm, email: e.target.value })} placeholder="courriel@exemple.com" /></Field>
                <Field label="Date d'adhésion"><input type="date" style={inputStyle} value={newMemberForm.dateAdhesion} onChange={(e) => setNewMemberForm({ ...newMemberForm, dateAdhesion: e.target.value })} /></Field>
                <Field label="Statut">
                  <select style={inputStyle} value={newMemberForm.statut} onChange={(e) => setNewMemberForm({ ...newMemberForm, statut: e.target.value })}>
                    <option>Actif</option><option>Inactif</option>
                  </select>
                </Field>
                <Btn onClick={handleAddMember} disabled={saving}><Plus size={15} /> Ajouter</Btn>
              </Card>
              <Table head={["Nom", "Courriel", "Adhésion", "Statut"]}>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td style={{ ...td, fontWeight: 600, color: NAVY }}>{m.nom}</td>
                    <td style={td}>{m.email}</td>
                    <td style={td}>{m.date_adhesion}</td>
                    <td style={td}>
                      <select value={m.statut} onChange={(e) => patchMember(m.id, { statut: e.target.value })} style={{ ...inputStyle, padding: "4px 8px", fontSize: 12 }}>
                        <option>Actif</option><option>Inactif</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          </Section>
        </Container>
      )}

      {/* ---------------- FICHE INSCRIPTION ---------------- */}
      {tab === "inscription" && (
        <Container>
          <Section>
            <h2 style={{ marginBottom: 14 }}>Fiche indépendante — Inscription</h2>
            <RuleBox>25 $ — paiement UNIQUE, obligatoire pour tout nouvel adhérent, non renouvelable.</RuleBox>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 20 }}>
              <StatCard label="Total dû" value={money(inscriptionTotalDu)} />
              <StatCard label="Total payé" value={money(inscriptionTotalPaye)} accent={TEAL} />
              <StatCard label="Solde en souffrance" value={money(inscriptionTotalDu - inscriptionTotalPaye)} accent={RED} />
            </div>
            <Table head={["Adhérent", "Date d'adhésion", "Montant dû", "Montant payé", "Date de paiement", "Statut", "Solde"]}>
              {members.map((m) => {
                const solde = 25 - Number(m.inscription_paye || 0);
                const statut = solde <= 0 ? "Payé" : m.inscription_paye > 0 ? "Partiel" : "Non payé";
                return (
                  <tr key={m.id}>
                    <td style={{ ...td, fontWeight: 600, color: NAVY }}>{m.nom}</td>
                    <td style={td}>{m.date_adhesion}</td>
                    <td style={td}>{money(25)}</td>
                    <td style={td}>
                      <input type="number" defaultValue={m.inscription_paye} onBlur={(e) => patchMember(m.id, { inscription_paye: Number(e.target.value) })} style={{ ...inputStyle, width: 90, padding: "4px 8px" }} />
                    </td>
                    <td style={td}>
                      <input type="date" defaultValue={m.inscription_date_paiement || ""} onBlur={(e) => patchMember(m.id, { inscription_date_paiement: e.target.value || null })} style={{ ...inputStyle, padding: "4px 8px" }} />
                    </td>
                    <td style={{ ...td, color: statut === "Payé" ? TEAL : statut === "Partiel" ? GOLD : RED, fontWeight: 700 }}>{statut}</td>
                    <td style={td}>{money(solde)}</td>
                  </tr>
                );
              })}
            </Table>
          </Section>
        </Container>
      )}

      {/* ---------------- FICHE TONTINE ---------------- */}
      {tab === "tontine" && (
        <Container>
          <Section>
            <h2 style={{ marginBottom: 14 }}>Fiche indépendante — Tontine (Cotisation)</h2>
            <RuleBox>100 $/mois par adhérent. À la fin de chaque séance, la cagnotte est remise à un membre bénéficiaire contre décharge.</RuleBox>

            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Tableau A — Contributions par séance</h3>
            <div style={{ overflowX: "auto", marginBottom: 26, background: "white", borderRadius: 12, boxShadow: "0 4px 18px rgba(31,56,100,0.08)" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr>
                  <th style={{ background: NAVY, color: "white", padding: "6px 10px", position: "sticky", left: 0 }}>Adhérent</th>
                  {SEANCES.map((s) => <th key={s} style={{ background: NAVY, color: "white", padding: "6px 8px", textAlign: "center" }}>S{s}</th>)}
                  <th style={{ background: NAVY, color: "white", padding: "6px 10px" }}>Total versé</th>
                </tr></thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td style={{ ...td, fontWeight: 600, color: NAVY, position: "sticky", left: 0, background: "white" }}>{m.nom}</td>
                      {SEANCES.map((s) => (
                        <td key={s} style={{ ...td, textAlign: "center" }}>
                          <input type="checkbox" checked={tontineValue(m.id, s)} onChange={(e) => toggleTontine(m.id, s, e.target.checked)} />
                        </td>
                      ))}
                      <td style={{ ...td, fontWeight: 700 }}>{money(tontineCount(m.id) * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 22 }}>
              <Card>
                <h3 style={{ fontSize: 14, marginBottom: 12 }}>Tableau B — Attribuer la cagnotte d'une séance</h3>
                <Field label="No de séance"><input type="number" style={inputStyle} value={newSeance.numero} onChange={(e) => setNewSeance({ ...newSeance, numero: Number(e.target.value) })} /></Field>
                <Field label="Date"><input type="date" style={inputStyle} value={newSeance.date} onChange={(e) => setNewSeance({ ...newSeance, date: e.target.value })} /></Field>
                <Field label="Bénéficiaire">
                  <select style={inputStyle} value={newSeance.beneficiaireId} onChange={(e) => setNewSeance({ ...newSeance, beneficiaireId: e.target.value })}>
                    <option value="">— Choisir —</option>
                    {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.nom} (bénéficiaire {beneficiaryCount(m.id)}x)</option>)}
                  </select>
                </Field>
                <Field label="Décharge signée">
                  <select style={inputStyle} value={newSeance.dechargeSignee ? "Oui" : "Non"} onChange={(e) => setNewSeance({ ...newSeance, dechargeSignee: e.target.value === "Oui" })}>
                    <option>Non</option><option>Oui</option>
                  </select>
                </Field>
                <div style={{ background: TEAL_LIGHT, borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 12.5, color: "#3A5049" }}>
                  Montant du pot pour cette séance : <b>{money(activeMembers.filter((m) => tontineValue(m.id, newSeance.numero)).length * 100)}</b>
                </div>
                <Btn onClick={addSeance} disabled={saving}><Plus size={15} /> Attribuer la cagnotte</Btn>
              </Card>
              <Table head={["Séance", "Date", "Contributeurs", "Montant du pot", "Bénéficiaire", "Décharge"]}>
                {seances.map((s) => (
                  <tr key={s.id}>
                    <td style={td}>{s.numero}</td>
                    <td style={td}>{s.date}</td>
                    <td style={td}>{s.nb_contrib ?? "—"}</td>
                    <td style={td}>{money((s.nb_contrib ?? 0) * 100)}</td>
                    <td style={{ ...td, fontWeight: 600, color: NAVY }}>{members.find((m) => m.id === s.beneficiaire_id)?.nom || "—"}</td>
                    <td style={{ ...td, color: s.decharge_signee ? TEAL : RED, fontWeight: 700 }}>{s.decharge_signee ? "Signée" : "En attente"}</td>
                  </tr>
                ))}
              </Table>
            </div>

            <h3 style={{ fontSize: 14, margin: "24px 0 10px" }}>Tableau C — Rotation des bénéficiaires (équité)</h3>
            <Table head={["Adhérent", "Nb fois bénéficiaire"]}>
              {members.map((m) => (
                <tr key={m.id}><td style={{ ...td, fontWeight: 600, color: NAVY }}>{m.nom}</td><td style={td}>{beneficiaryCount(m.id)}</td></tr>
              ))}
            </Table>
          </Section>
        </Container>
      )}

      {/* ---------------- FICHE COLLATION ---------------- */}
      {tab === "collation" && (
        <Container>
          <Section>
            <h2 style={{ marginBottom: 14 }}>Fiche indépendante — Collation (Présence)</h2>
            <RuleBox>10 $/mois par adhérent — OBLIGATOIRE pour tous.</RuleBox>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 20 }}>
              <StatCard label="Total dû" value={money(collationTotalDu)} />
              <StatCard label="Total payé" value={money(collationTotalPaye)} accent={TEAL} />
              <StatCard label="Solde" value={money(collationTotalDu - collationTotalPaye)} accent={RED} />
            </div>
            <div style={{ overflowX: "auto", background: "white", borderRadius: 12, boxShadow: "0 4px 18px rgba(31,56,100,0.08)" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr>
                  <th style={{ background: NAVY, color: "white", padding: "6px 10px", position: "sticky", left: 0 }}>Adhérent</th>
                  {MONTHS.map((mo) => <th key={mo} style={{ background: NAVY, color: "white", padding: "6px 6px", textAlign: "center" }}>{mo}</th>)}
                  <th style={{ background: NAVY, color: "white", padding: "6px 10px" }}>Dû</th>
                  <th style={{ background: NAVY, color: "white", padding: "6px 10px" }}>Payé</th>
                  <th style={{ background: NAVY, color: "white", padding: "6px 10px" }}>Solde</th>
                </tr></thead>
                <tbody>
                  {members.map((m) => {
                    const du = collationDu(m.id);
                    const solde = du - Number(m.collation_montant_paye || 0);
                    return (
                      <tr key={m.id}>
                        <td style={{ ...td, fontWeight: 600, color: NAVY, position: "sticky", left: 0, background: "white" }}>{m.nom}</td>
                        {MONTHS.map((mo) => (
                          <td key={mo} style={{ ...td, textAlign: "center" }}>
                            <input type="checkbox" checked={collationValue(m.id, mo)} onChange={(e) => toggleCollation(m.id, mo, e.target.checked)} />
                          </td>
                        ))}
                        <td style={td}>{money(du)}</td>
                        <td style={td}>
                          <input type="number" defaultValue={m.collation_montant_paye} onBlur={(e) => patchMember(m.id, { collation_montant_paye: Number(e.target.value) })} style={{ ...inputStyle, width: 80, padding: "4px 6px" }} />
                        </td>
                        <td style={{ ...td, color: solde > 0 ? RED : TEAL, fontWeight: 700 }}>{money(solde)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </Container>
      )}

      {/* ---------------- FICHES FONDS ---------------- */}
      {(tab === "urgence" || tab === "secours") && (() => {
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
        const totalContribPaye = members.reduce((s, m) => s + Number(m[memberKey + "_paye"] || 0), 0);
        return (
          <Container>
            <Section>
              <h2 style={{ marginBottom: 14 }}>Fiche indépendante — {isUrgence ? "Fonds d'urgence" : "Fonds de secours"}</h2>
              <RuleBox>
                {isUrgence
                  ? "25 $/an par adhérent, OBLIGATOIRE pour tous. Recouvrement des dépenses au prorata du nombre d'adhérents actifs."
                  : "200 $ par adhérent — versement UNIQUE. Recouvrement des dépenses au prorata du nombre d'adhérents actifs."}
              </RuleBox>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 22 }}>
                <StatCard label="Contributions reçues" value={money(totalContribPaye)} accent={TEAL} />
                <StatCard label="Dépenses totales" value={money(depenses.reduce((s, d) => s + Number(d.montant), 0))} accent={RED} />
                <StatCard label="Solde du fonds" value={money(solde)} accent={solde < 0 ? RED : GOLD} />
              </div>

              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Tableau A — Contributions des adhérents ({montantFixe} $ {isUrgence ? "/an" : "unique"})</h3>
              <Table head={["Adhérent", "Montant dû", "Montant payé", "Date de paiement", "Solde"]}>
                {members.map((m) => {
                  const s = montantFixe - Number(m[memberKey + "_paye"] || 0);
                  return (
                    <tr key={m.id}>
                      <td style={{ ...td, fontWeight: 600, color: NAVY }}>{m.nom}</td>
                      <td style={td}>{money(montantFixe)}</td>
                      <td style={td}>
                        <input type="number" defaultValue={m[memberKey + "_paye"]} onBlur={(e) => patchMember(m.id, { [memberKey + "_paye"]: Number(e.target.value) })} style={{ ...inputStyle, width: 90, padding: "4px 8px" }} />
                      </td>
                      <td style={td}>
                        <input type="date" defaultValue={m[memberKey + "_date_paiement"] || ""} onBlur={(e) => patchMember(m.id, { [memberKey + "_date_paiement"]: e.target.value || null })} style={{ ...inputStyle, padding: "4px 8px" }} />
                      </td>
                      <td style={{ ...td, color: s > 0 ? RED : TEAL, fontWeight: 700 }}>{money(s)}</td>
                    </tr>
                  );
                })}
              </Table>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 22, marginTop: 24 }}>
                <Card>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>Tableau B — Enregistrer une dépense</h3>
                  <Field label="Date"><input type="date" style={inputStyle} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
                  <Field label="Description"><input style={inputStyle} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
                  <Field label="Montant total ($)"><input type="number" style={inputStyle} value={draft.montant} onChange={(e) => setDraft({ ...draft, montant: e.target.value })} /></Field>
                  <div style={{ background: TEAL_LIGHT, borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 12.5, color: "#3A5049" }}>
                    Quote-part par adhérent actif ({nbActifs}) : <b>{money(quotePart)}</b>
                  </div>
                  <Btn onClick={() => enregistrerDepense(fondsCode)} disabled={saving}><Plus size={15} /> Enregistrer et créer les recouvrements</Btn>
                </Card>
                <Table head={["Date", "Description", "Montant", "Quote-part/adh."]}>
                  {depenses.map((d) => (
                    <tr key={d.id}>
                      <td style={td}>{d.date}</td><td style={td}>{d.description}</td>
                      <td style={td}>{money(d.montant)}</td>
                      <td style={td}>{money(d.montant / Math.max(d.nb_actifs_snapshot || nbActifs, 1))}</td>
                    </tr>
                  ))}
                </Table>
              </div>

              <h3 style={{ fontSize: 14, margin: "24px 0 10px" }}>Tableau C — Recouvrement par adhérent</h3>
              <Table head={["Adhérent", "Quote-part", "Statut", ""]}>
                {recouvrements.map((r) => {
                  const m = members.find((mm) => mm.id === r.member_id);
                  return (
                    <tr key={r.id}>
                      <td style={{ ...td, fontWeight: 600, color: NAVY }}>{m ? m.nom : "—"}</td>
                      <td style={td}>{money(r.quote_part)}</td>
                      <td style={{ ...td, color: r.paye ? TEAL : RED, fontWeight: 700 }}>{r.paye ? "Payé" : "Non payé"}</td>
                      <td style={td}>
                        {!r.paye && <button onClick={() => marquerRecouvrementPaye(fondsCode, r.id)} style={{ fontSize: 11, color: TEAL, background: "none", border: `1px solid ${TEAL}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer" }}>Marquer payé</button>}
                      </td>
                    </tr>
                  );
                })}
                {recouvrements.length === 0 && <tr><td colSpan={4} style={{ ...td, color: "#999", fontStyle: "italic" }}>Aucun recouvrement pour l'instant.</td></tr>}
              </Table>
            </Section>
          </Container>
        );
      })()}

      {/* ---------------- ÉTATS FINANCIERS ---------------- */}
      {tab === "finances" && (
        <Container>
          <Section>
            <h2 style={{ marginBottom: 20 }}>États financiers consolidés</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
              <Card>
                <h3 style={{ fontSize: 15, marginBottom: 12 }}>État des résultats</h3>
                {[
                  ["Inscriptions", inscriptionTotalPaye],
                  ["Collation", collationTotalPaye],
                  ["Contributions Fonds d'urgence", members.reduce((s, m) => s + Number(m.fonds_urgence_paye || 0), 0)],
                  ["Contributions Fonds de secours", members.reduce((s, m) => s + Number(m.fonds_secours_paye || 0), 0)],
                  ["Recouvrements Fonds d'urgence", fuRecouvrements.filter((r) => r.paye).reduce((s, r) => s + Number(r.quote_part), 0)],
                  ["Recouvrements Fonds de secours", fsRecouvrements.filter((r) => r.paye).reduce((s, r) => s + Number(r.quote_part), 0)],
                ].map(([label, val]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span>{label}</span><span>{money(val)}</span></div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, borderTop: "1px solid #DDD", marginTop: 6, paddingTop: 6 }}>
                  <span>Total des revenus (hors Tontine)</span><span>{money(totalRevenusHorsTontine)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "10px 0 4px", color: RED }}><span>Dépenses Fonds d'urgence</span><span>{money(fuDepenses.reduce((s, d) => s + Number(d.montant), 0))}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", color: RED }}><span>Dépenses Fonds de secours</span><span>{money(fsDepenses.reduce((s, d) => s + Number(d.montant), 0))}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, background: TEAL_LIGHT, marginTop: 10, padding: 10, borderRadius: 8 }}>
                  <span>Excédent (insuffisance)</span><span>{money(excedent)}</span>
                </div>
              </Card>
              <Card>
                <h3 style={{ fontSize: 15, marginBottom: 12 }}>Bilan simplifié</h3>
                <div style={{ fontSize: 12, fontWeight: 700, color: TEAL, textTransform: "uppercase", marginBottom: 6 }}>Fonds propres</div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span>Solde Fonds d'urgence</span><span>{money(fuSolde)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span>Solde Fonds de secours</span><span>{money(fsSolde)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span>Fonds général (Inscription + Collation)</span><span>{money(excedent - fuSolde - fsSolde)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, borderTop: "1px solid #DDD", marginTop: 6, paddingTop: 6 }}>
                  <span>Total des fonds propres</span><span>{money(excedent)}</span>
                </div>
                <p style={{ fontSize: 11.5, color: "#999", marginTop: 14, fontStyle: "italic" }}>
                  La Tontine n'apparaît pas dans le bilan : la cagnotte de chaque séance est intégralement redistribuée et ne fait jamais partie des fonds propres collectifs.
                </p>
              </Card>
            </div>
          </Section>
        </Container>
      )}

      <footer style={{ background: NAVY_DARK, color: "rgba(255,255,255,.6)", padding: "20px 0", marginTop: 20 }}>
        <Container style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 12.5 }}>
          <span>&copy; 2026 AREM — Système de gestion associative (données persistantes via Supabase)</span>
          <span>Développé par <b style={{ color: GOLD_LIGHT }}>Omnia Trade Solutions</b></span>
        </Container>
      </footer>
    </div>
  );
}
