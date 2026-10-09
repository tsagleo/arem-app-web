// =====================================================================
// Gouvernance.jsx — Vision/mission, composition du bureau, élections
// Développé par Omnia Trade Solutions
// =====================================================================
// Refonte de la présentation (2026-10-10, demande de l'utilisateur :
// « trop touffu à l'ouverture, tâches ouvertes et éparpillées ») :
//  • trois onglets — Vue d'ensemble · Bureau · Élections — au lieu d'une
//    seule longue page ;
//  • formulaires repliés derrière un bouton (« Modifier », « Ajouter un
//    membre du bureau ») au lieu d'être ouverts en permanence ;
//  • bureau présenté en cartes (photo, poste, mandat, échéance), anciens
//    mandats repliés ;
//  • élections en lignes compactes qui se déroulent d'un clic (Elections.jsx).
// Toute la logique (chargement, enregistrements) est inchangée.
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import { Vote, Users2, Landmark, Trash2, Pencil, Plus, Eye, Target, Gem, ChevronDown, ChevronRight, CalendarClock } from "lucide-react";
import { supabase } from "./supabaseClient";
import {
  Section, Container, Card, Btn, Field, Banner, inputStyle, useLang, RED, TEAL, TEAL_LIGHT, friendlyError,
} from "./shared";
import Elections from "./Elections";

const TXT = {
  fr: {
    tab_overview: "Vue d'ensemble", tab_board: "Bureau", tab_elections: "Élections",
    intro: "Identité, instances et élections de l'association.",
    edit: "Modifier", cancel: "Annuler",
    board_now: "Bureau en fonction",
    board_empty: "Aucun membre du bureau enregistré.",
    see_board: "Voir le bureau",
    see_elections: "Voir les élections",
    elections_card: "Élections",
    elections_card_text: "Organisation des scrutins, comité électoral, vote secret, résultats et procès-verbaux.",
    add_board: "Ajouter un membre du bureau",
    in_office: "En fonction",
    ends_soon: "Fin de mandat dans {n} jour(s)",
    ended: "Mandat terminé",
    since: "Depuis le {d}",
    until: "jusqu'au {d}",
    no_end: "sans date de fin",
    past: "Anciens membres du bureau ({n})",
    alert_soon: "{n} mandat(s) arrivent à échéance dans les 60 prochains jours : pensez à organiser l'élection.",
  },
  en: {
    tab_overview: "Overview", tab_board: "Board", tab_elections: "Elections",
    intro: "Identity, governing bodies and elections of the association.",
    edit: "Edit", cancel: "Cancel",
    board_now: "Current board",
    board_empty: "No board member recorded.",
    see_board: "View the board",
    see_elections: "View elections",
    elections_card: "Elections",
    elections_card_text: "Organizing ballots, election committee, secret ballot, results and minutes.",
    add_board: "Add a board member",
    in_office: "In office",
    ends_soon: "Term ends in {n} day(s)",
    ended: "Term ended",
    since: "Since {d}",
    until: "until {d}",
    no_end: "no end date",
    past: "Former board members ({n})",
    alert_soon: "{n} term(s) end within the next 60 days: plan the election.",
  },
};

const ONGLET_CLE = "unia.gouvernance.onglet";
function lireOnglet() {
  try { return localStorage.getItem(ONGLET_CLE) || "apercu"; } catch { return "apercu"; }
}

// Date seule (AAAA-MM-JJ) lue en heure locale.
function dateLocale(s) {
  const j = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(String(s || ""));
  return j ? new Date(+j[1], +j[2] - 1, +j[3]) : null;
}

function Avatar({ url, nom, size = 44 }) {
  const ini = String(nom || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return url
    ? <img src={url} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
    : <span style={{ width: size, height: size, borderRadius: "50%", background: TEAL_LIGHT, color: TEAL, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.36, flexShrink: 0 }}>{ini}</span>;
}

export default function Gouvernance({ profile, isBureau, association }) {
  const [info, setInfo] = useState(null);
  const [boardMembers, setBoardMembers] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const { t, lang } = useLang();
  const G = TXT[lang === "en" ? "en" : "fr"];
  const [onglet, setOngletState] = useState(lireOnglet);
  const setOnglet = (o) => { setOngletState(o); try { localStorage.setItem(ONGLET_CLE, o); } catch { /* stockage indisponible */ } };

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: gi }, { data: bm }, { data: mem, error: memErr }] = await Promise.all([
      supabase.from("governance_info").select("*").eq("association_id", profile.association_id).maybeSingle(),
      supabase.from("board_members").select("*").eq("association_id", profile.association_id),
      // Pas de filtre association_id ici : comme pour la liste des adhérents ailleurs dans
      // l'application, on s'appuie sur les politiques RLS de Supabase pour le scoping —
      // un filtre client-side redondant ici empêchait la liste de se charger.
      supabase.from("members").select("id,nom,statut,photo_url").order("nom"),
    ]);
    if (memErr) setErrorMsg(friendlyError(memErr, t));
    setInfo(gi); setBoardMembers(bm || []); setMembers((mem || []).filter((m) => m.statut !== "Supprimé"));
    setLoading(false);
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  // ---------- Vision / mission / valeurs ----------
  const [draft, setDraft] = useState({ vision: "", mission: "", valeurs: "" });
  const [editInfo, setEditInfo] = useState(false);
  useEffect(() => { if (info) setDraft(info); }, [info]);
  async function saveInfo() {
    if (!window.confirm(t("gov_confirm_save_info"))) return;
    const { data, error } = await supabase.from("governance_info")
      .upsert({ association_id: profile.association_id, ...draft }, { onConflict: "association_id" })
      .select().single();
    if (!error) { setInfo(data); setEditInfo(false); } else setErrorMsg(friendlyError(error, t));
  }

  // ---------- Composition du bureau ----------
  const [newBoard, setNewBoard] = useState({ member_id: "", poste: "", mandat_debut: "", mandat_fin: "" });
  const [showAddBoard, setShowAddBoard] = useState(false);
  const [showPast, setShowPast] = useState(false);
  async function addBoardMember() {
    if (!newBoard.member_id || !newBoard.poste) return;
    const nomMembre = members.find((m) => m.id === newBoard.member_id)?.nom || "";
    if (!window.confirm(t("gov_confirm_add_board_member").replace("{nom}", nomMembre).replace("{poste}", newBoard.poste))) return;
    const { data, error } = await supabase.from("board_members").insert({ association_id: profile.association_id, ...newBoard }).select().single();
    if (!error) { setBoardMembers((p) => [...p, data]); setNewBoard({ member_id: "", poste: "", mandat_debut: "", mandat_fin: "" }); setShowAddBoard(false); }
    else setErrorMsg(friendlyError(error, t));
  }
  async function deleteBoardMember(id) {
    if (!window.confirm(t("gov_confirm_delete_board_member"))) return;
    const { error } = await supabase.from("board_members").delete().eq("id", id);
    if (!error) setBoardMembers((p) => p.filter((b) => b.id !== id));
    else setErrorMsg(friendlyError(error, t));
  }

  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  // Mandats : en fonction / bientôt terminés / terminés.
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const fmt = (d) => (d ? d.toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA", { day: "numeric", month: "long", year: "numeric" }) : "");
  const mandats = boardMembers.map((b) => {
    const fin = dateLocale(b.mandat_fin);
    const jours = fin ? Math.round((fin - auj) / 86400000) : null;
    const m = members.find((x) => x.id === b.member_id);
    return { ...b, fin, jours, termine: fin != null && jours < 0, nom: m?.nom || "—", photo: m?.photo_url || null };
  });
  const actuels = mandats.filter((b) => !b.termine).sort((a, b) => String(a.poste).localeCompare(String(b.poste)));
  const anciens = mandats.filter((b) => b.termine).sort((a, b) => b.fin - a.fin);
  const bientot = actuels.filter((b) => b.jours != null && b.jours <= 60);

  const ongletBtn = (id, label, Icon) => (
    <button key={id} onClick={() => setOnglet(id)} style={{
      display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 13.5, padding: "10px 18px", borderRadius: 11, border: "none", cursor: "pointer",
      color: onglet === id ? "#fff" : "rgba(42,42,42,.6)", background: onglet === id ? "var(--primary)" : "transparent",
    }}><Icon size={15} /> {label}</button>
  );

  const carteMandat = (b, discret = false) => (
    <Card key={b.id} style={{ padding: 16, display: "flex", gap: 12, alignItems: "center", opacity: discret ? 0.75 : 1 }}>
      <Avatar url={b.photo} nom={b.nom} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{b.nom}</div>
        <div style={{ fontSize: 12.5, color: "var(--primary)", fontWeight: 600 }}>{b.poste}</div>
        <div style={{ fontSize: 11.5, color: "#5B6270", marginTop: 2 }}>
          {b.mandat_debut ? G.since.replace("{d}", fmt(dateLocale(b.mandat_debut))) : ""}
          {b.fin ? ` · ${G.until.replace("{d}", fmt(b.fin))}` : ` · ${G.no_end}`}
        </div>
        <div style={{ marginTop: 4 }}>
          {b.termine
            ? <span style={{ fontSize: 10.5, fontWeight: 700, color: "#686F7D" }}>{G.ended}</span>
            : b.jours != null && b.jours <= 60
              ? <span style={{ fontSize: 10.5, fontWeight: 700, color: "#B7791F" }}>{G.ends_soon.replace("{n}", String(b.jours))}</span>
              : <span style={{ fontSize: 10.5, fontWeight: 700, color: TEAL }}>{G.in_office}</span>}
        </div>
      </div>
      {isBureau && (
        <button onClick={() => deleteBoardMember(b.id)} title={t("gov_delete_btn")} style={{ background: "none", border: "none", color: RED, cursor: "pointer", padding: 4, display: "flex" }}><Trash2 size={14} /></button>
      )}
    </Card>
  );

  const carteValeur = (Icon, titre, texte, vide) => (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13, color: "var(--primary)", marginBottom: 8 }}><Icon size={16} /> {titre}</div>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: texte ? "#2F3A4A" : "#9AA2B5", fontStyle: texte ? "normal" : "italic", whiteSpace: "pre-wrap" }}>{texte || vide}</p>
    </Card>
  );

  const lienBtn = { marginTop: 12, background: "none", border: "none", color: TEAL, fontWeight: 600, fontSize: 12.5, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 4 };

  return (
    <Container><Section>
      {errorMsg && <Banner tone="warn">{errorMsg}</Banner>}
      <h2 style={{ marginBottom: 4 }}>{t("nav_governance")}</h2>
      <p style={{ fontSize: 13, color: "#5B6270", margin: "0 0 16px" }}>{G.intro}</p>

      <Card style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: 8, marginBottom: 22 }}>
        {ongletBtn("apercu", G.tab_overview, Landmark)}
        {ongletBtn("bureau", G.tab_board, Users2)}
        {ongletBtn("elections", G.tab_elections, Vote)}
      </Card>

      {/* ---------------- Vue d'ensemble ---------------- */}
      {onglet === "apercu" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 15, margin: 0, display: "flex", alignItems: "center", gap: 8 }}><Landmark size={16} /> {t("gov_vision_mission")}</h3>
              {isBureau && !editInfo && <Btn variant="outline" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setEditInfo(true)}><Pencil size={13} /> {G.edit}</Btn>}
            </div>
            {editInfo ? (
              <Card>
                <Field label={t("gov_vision")}><textarea style={{ ...inputStyle, minHeight: 70 }} value={draft.vision || ""} onChange={(e) => setDraft({ ...draft, vision: e.target.value })} /></Field>
                <Field label={t("gov_mission")}><textarea style={{ ...inputStyle, minHeight: 70 }} value={draft.mission || ""} onChange={(e) => setDraft({ ...draft, mission: e.target.value })} /></Field>
                <Field label={t("gov_values")}><textarea style={{ ...inputStyle, minHeight: 70 }} value={draft.valeurs || ""} onChange={(e) => setDraft({ ...draft, valeurs: e.target.value })} /></Field>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn onClick={saveInfo}>{t("action_save")}</Btn>
                  <Btn variant="outline" onClick={() => { setDraft(info || {}); setEditInfo(false); }}>{G.cancel}</Btn>
                </div>
              </Card>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
                {carteValeur(Eye, t("gov_vision"), info?.vision, t("gov_not_provided"))}
                {carteValeur(Target, t("gov_mission"), info?.mission, t("gov_not_provided"))}
                {carteValeur(Gem, t("gov_values"), info?.valeurs, t("gov_not_provided_pl"))}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
            <Card style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13, color: "var(--primary)", marginBottom: 10 }}><Users2 size={16} /> {G.board_now}</div>
              {actuels.length === 0 ? <p style={{ fontSize: 12.5, color: "#9AA2B5", fontStyle: "italic", margin: 0 }}>{G.board_empty}</p> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {actuels.slice(0, 6).map((b) => (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar url={b.photo} nom={b.nom} size={30} />
                      <div style={{ fontSize: 13 }}><b>{b.nom}</b> <span style={{ color: "#5B6270" }}>· {b.poste}</span></div>
                    </div>
                  ))}
                </div>
              )}
              {bientot.length > 0 && <p style={{ fontSize: 11.5, color: "#B7791F", fontWeight: 600, margin: "10px 0 0" }}>{G.alert_soon.replace("{n}", String(bientot.length))}</p>}
              <button onClick={() => setOnglet("bureau")} style={lienBtn}>{G.see_board} <ChevronRight size={13} /></button>
            </Card>
            <Card style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13, color: "var(--primary)", marginBottom: 10 }}><Vote size={16} /> {G.elections_card}</div>
              <p style={{ fontSize: 12.5, color: "#5B6270", margin: 0 }}>{G.elections_card_text}</p>
              <button onClick={() => setOnglet("elections")} style={lienBtn}>{G.see_elections} <ChevronRight size={13} /></button>
            </Card>
          </div>
        </div>
      )}

      {/* ---------------- Bureau ---------------- */}
      {onglet === "bureau" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <h3 style={{ fontSize: 15, margin: 0, display: "flex", alignItems: "center", gap: 8 }}><Users2 size={16} /> {t("gov_board_title")}</h3>
            {isBureau && !showAddBoard && <Btn style={{ padding: "6px 14px", fontSize: 12.5 }} onClick={() => setShowAddBoard(true)}><Plus size={14} /> {G.add_board}</Btn>}
          </div>
          {bientot.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FFF6E0", color: "#7A5300", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, marginBottom: 14 }}>
              <CalendarClock size={15} /> {G.alert_soon.replace("{n}", String(bientot.length))}
            </div>
          )}
          {isBureau && showAddBoard && (
            <Card style={{ marginBottom: 16, maxWidth: 640 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 14px" }}>
                <Field label={t("member")}>
                  <select style={inputStyle} value={newBoard.member_id} onChange={(e) => setNewBoard({ ...newBoard, member_id: e.target.value })}>
                    <option value="">{t("gov_choose")}</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                  </select>
                </Field>
                <Field label={t("gov_position")}><input style={inputStyle} value={newBoard.poste} onChange={(e) => setNewBoard({ ...newBoard, poste: e.target.value })} placeholder={t("gov_position_placeholder")} /></Field>
                <Field label={t("gov_mandate_start")}><input type="date" style={inputStyle} value={newBoard.mandat_debut} onChange={(e) => setNewBoard({ ...newBoard, mandat_debut: e.target.value })} /></Field>
                <Field label={t("gov_mandate_end")}><input type="date" style={inputStyle} value={newBoard.mandat_fin} onChange={(e) => setNewBoard({ ...newBoard, mandat_fin: e.target.value })} /></Field>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn onClick={addBoardMember}>{t("action_add")}</Btn>
                <Btn variant="outline" onClick={() => setShowAddBoard(false)}>{G.cancel}</Btn>
              </div>
            </Card>
          )}
          {actuels.length === 0 && <p style={{ fontSize: 13, color: "#9AA2B5", fontStyle: "italic" }}>{G.board_empty}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {actuels.map((b) => carteMandat(b))}
          </div>
          {anciens.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <button onClick={() => setShowPast((v) => !v)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 13, fontWeight: 600, color: "#5B6270", display: "inline-flex", alignItems: "center", gap: 6 }}>
                {showPast ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {G.past.replace("{n}", String(anciens.length))}
              </button>
              {showPast && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 10 }}>
                  {anciens.map((b) => carteMandat(b, true))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------------- Élections ---------------- */}
      {onglet === "elections" && (
        <Elections profile={profile} isBureau={isBureau} association={association} members={members} t={t} lang={lang} />
      )}
    </Section></Container>
  );
}
