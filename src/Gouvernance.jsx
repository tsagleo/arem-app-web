// =====================================================================
// Gouvernance.jsx — Vision/mission, composition du bureau, élections
// Développé par Omnia Trade Solutions
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import { Vote, Users2, Landmark, Trash2 } from "lucide-react";
import { supabase } from "./supabaseClient";
import {
  Section, Container, Card, Btn, Field, Table, td, Banner, inputStyle, useLang, RED, friendlyError,
} from "./shared";
import Elections from "./Elections";

export default function Gouvernance({ profile, isBureau, association }) {
  const [info, setInfo] = useState(null);
  const [boardMembers, setBoardMembers] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const { t, lang } = useLang();

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
  useEffect(() => { if (info) setDraft(info); }, [info]);
  async function saveInfo() {
    if (!window.confirm(t("gov_confirm_save_info"))) return;
    const { data, error } = await supabase.from("governance_info")
      .upsert({ association_id: profile.association_id, ...draft }, { onConflict: "association_id" })
      .select().single();
    if (!error) setInfo(data); else setErrorMsg(friendlyError(error, t));
  }

  // ---------- Composition du bureau ----------
  const [newBoard, setNewBoard] = useState({ member_id: "", poste: "", mandat_debut: "", mandat_fin: "" });
  async function addBoardMember() {
    if (!newBoard.member_id || !newBoard.poste) return;
    const nomMembre = members.find((m) => m.id === newBoard.member_id)?.nom || "";
    if (!window.confirm(t("gov_confirm_add_board_member").replace("{nom}", nomMembre).replace("{poste}", newBoard.poste))) return;
    const { data, error } = await supabase.from("board_members").insert({ association_id: profile.association_id, ...newBoard }).select().single();
    if (!error) { setBoardMembers((p) => [...p, data]); setNewBoard({ member_id: "", poste: "", mandat_debut: "", mandat_fin: "" }); }
  }
  async function deleteBoardMember(id) {
    if (!window.confirm(t("gov_confirm_delete_board_member"))) return;
    const { error } = await supabase.from("board_members").delete().eq("id", id);
    if (!error) setBoardMembers((p) => p.filter((b) => b.id !== id));
    else setErrorMsg(friendlyError(error, t));
  }

  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  return (
    <Container><Section>
      {errorMsg && <Banner tone="warn">{errorMsg}</Banner>}
      <h2 style={{ marginBottom: 20 }}>{t("nav_governance")}</h2>

      {/* Vision / Mission / Valeurs */}
      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}><Landmark size={16} /> {t("gov_vision_mission")}</h3>
        {isBureau ? (
          <>
           <Field label={t("gov_vision")}><textarea style={{ ...inputStyle, minHeight: 70 }} value={draft.vision || ""} onChange={(e) => setDraft({ ...draft, vision: e.target.value })} /></Field>
            <Field label={t("gov_mission")}><textarea style={{ ...inputStyle, minHeight: 70 }} value={draft.mission || ""} onChange={(e) => setDraft({ ...draft, mission: e.target.value })} /></Field>
           <Field label={t("gov_values")}><textarea style={{ ...inputStyle, minHeight: 70 }} value={draft.valeurs || ""} onChange={(e) => setDraft({ ...draft, valeurs: e.target.value })} /></Field>
            <Btn onClick={saveInfo}>{t("action_save")}</Btn>
          </>
        ) : (
          <>
            <p><b>{t("gov_vision")} : </b>{info?.vision || t("gov_not_provided")}</p>
<p><b>{t("gov_mission")} : </b>{info?.mission || t("gov_not_provided")}</p>
<p><b>{t("gov_values")} : </b>{info?.valeurs || t("gov_not_provided_pl")}</p>
          </>
        )}
      </Card>

      {/* Composition du bureau */}
    <h3 style={{ fontSize: 15, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}><Users2 size={16} /> {t("gov_board_title")}</h3>
      <div style={{ display: "grid", gridTemplateColumns: isBureau ? "1fr 1.4fr" : "1fr", gap: 22, marginBottom: 26 }}>
        {isBureau && (
          <Card>
           <Field label={t("member")}>
              <select style={inputStyle} value={newBoard.member_id} onChange={(e) => setNewBoard({ ...newBoard, member_id: e.target.value })}>
                <option value="">{t("gov_choose")}</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
              </select>
            </Field>
          <Field label={t("gov_position")}><input style={inputStyle} value={newBoard.poste} onChange={(e) => setNewBoard({ ...newBoard, poste: e.target.value })} placeholder={t("gov_position_placeholder")} /></Field>
            <Field label={t("gov_mandate_start")}><input type="date" style={inputStyle} value={newBoard.mandat_debut} onChange={(e) => setNewBoard({ ...newBoard, mandat_debut: e.target.value })} /></Field>
<Field label={t("gov_mandate_end")}><input type="date" style={inputStyle} value={newBoard.mandat_fin} onChange={(e) => setNewBoard({ ...newBoard, mandat_fin: e.target.value })} /></Field>
            <Btn onClick={addBoardMember}>{t("action_add")}</Btn>
          </Card>
        )}
        <Table head={isBureau ? [t("member"), t("gov_col_position"), t("gov_col_start"), t("gov_col_end"), t("gov_col_actions")] : [t("member"), t("gov_col_position"), t("gov_col_start"), t("gov_col_end")]}>
          {boardMembers.map((b) => (
            <tr key={b.id}>
              <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>{members.find((m) => m.id === b.member_id)?.nom || "—"}</td>
              <td style={td}>{b.poste}</td><td style={td}>{b.mandat_debut}</td><td style={td}>{b.mandat_fin || t("gov_ongoing")}</td>
              {isBureau && (
                <td style={td}>
                  <button onClick={() => deleteBoardMember(b.id)} style={{ fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Trash2 size={11} /> {t("gov_delete_btn")}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </Table>
      </div>

      {/* Élections : comité électoral, calendrier, vote secret (voir Elections.jsx) */}
      <h3 style={{ fontSize: 15, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}><Vote size={16} /> {t("gov_elections_title")}</h3>
      <Elections profile={profile} isBureau={isBureau} association={association} members={members} t={t} lang={lang} />
    </Section></Container>
  );
}