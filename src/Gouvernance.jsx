// =====================================================================
// Gouvernance.jsx — Vision/mission, composition du bureau, élections
// Développé par Omnia Trade Solutions
// =====================================================================
import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Vote, Users2, Landmark, Printer, Trash2 } from "lucide-react";
import { supabase } from "./supabaseClient";
import {
  Section, Container, Card, Btn, Field, Table, td, RuleBox, Banner, inputStyle, useLang, RED, SignatureLine, friendlyError, OrgLegalSubline, datetimeLocalToISO, formatEventDateTime,
} from "./shared";

export default function Gouvernance({ profile, isBureau, association }) {
  const [info, setInfo] = useState(null);
  const [boardMembers, setBoardMembers] = useState([]);
  const [members, setMembers] = useState([]);
  const [elections, setElections] = useState([]);
  const [candidats, setCandidats] = useState([]);
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const { t, lang } = useLang();

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: gi }, { data: bm }, { data: mem, error: memErr }, { data: el }, { data: cand }, { data: vt }] = await Promise.all([
      supabase.from("governance_info").select("*").eq("association_id", profile.association_id).maybeSingle(),
      supabase.from("board_members").select("*").eq("association_id", profile.association_id),
      // Pas de filtre association_id ici : comme pour la liste des adhérents ailleurs dans
      // l'application, on s'appuie sur les politiques RLS de Supabase pour le scoping —
      // un filtre client-side redondant ici empêchait la liste de se charger.
      supabase.from("members").select("id,nom,statut").order("nom"),
      supabase.from("elections").select("*").eq("association_id", profile.association_id).order("date_debut", { ascending: false }),
      supabase.from("election_candidats").select("*"),
      supabase.from("election_votes").select("*"),
    ]);
   if (memErr) setErrorMsg(friendlyError(memErr, t));
   setInfo(gi); setBoardMembers(bm || []); setMembers((mem || []).filter((m) => m.statut !== "Supprimé"));
    setElections(el || []); setCandidats(cand || []); setVotes(vt || []);
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

  // ---------- Élections ----------
  const [newElection, setNewElection] = useState({ titre: "", description: "", date_debut: "", date_fin: "" });
  async function createElection() {
    if (!newElection.titre || !newElection.date_debut || !newElection.date_fin) return;
    if (!window.confirm(t("gov_confirm_create_election").replace("{titre}", newElection.titre))) return;
    const { data, error } = await supabase.from("elections").insert({ association_id: profile.association_id, ...newElection, date_debut: datetimeLocalToISO(newElection.date_debut), date_fin: datetimeLocalToISO(newElection.date_fin), statut: "ouverte" }).select().single();
    if (!error) { setElections((p) => [data, ...p]); setNewElection({ titre: "", description: "", date_debut: "", date_fin: "" }); }
  }
  const [candDraft, setCandDraft] = useState({}); // { electionId: {member_id, poste_vise} }
  async function addCandidat(electionId) {
    const d = candDraft[electionId];
    if (!d?.member_id) return;
    const nomCandidat = members.find((m) => m.id === d.member_id)?.nom || "";
    if (!window.confirm(t("gov_confirm_add_candidate").replace("{nom}", nomCandidat))) return;
    const { data, error } = await supabase.from("election_candidats").insert({ election_id: electionId, member_id: d.member_id, poste_vise: d.poste_vise || "" }).select().single();
    if (!error) { setCandidats((p) => [...p, data]); setCandDraft((p) => ({ ...p, [electionId]: {} })); }
  }
  async function deleteCandidat(candidatId) {
    if (!window.confirm(t("gov_confirm_delete_candidat"))) return;
    // Supprime d'abord l'historique des votes liés à ce candidat (sinon ils
    // resteraient orphelins et fausseraient les décomptes), puis le candidat.
    const { error: voteErr } = await supabase.from("election_votes").delete().eq("candidat_id", candidatId);
    if (voteErr) { setErrorMsg(friendlyError(voteErr, t)); return; }
    const { error } = await supabase.from("election_candidats").delete().eq("id", candidatId);
    if (!error) {
      setCandidats((p) => p.filter((c) => c.id !== candidatId));
      setVotes((p) => p.filter((v) => v.candidat_id !== candidatId));
    } else setErrorMsg(friendlyError(error, t));
  }
  async function deleteElection(electionId) {
    if (!window.confirm(t("gov_confirm_delete_election"))) return;
    // Supprime l'historique complet rattaché à l'élection (votes puis candidats)
    // avant l'élection elle-même, pour ne laisser aucun enregistrement orphelin.
    const candIds = candidats.filter((c) => c.election_id === electionId).map((c) => c.id);
    if (candIds.length > 0) {
      const { error: voteErr } = await supabase.from("election_votes").delete().in("candidat_id", candIds);
      if (voteErr) { setErrorMsg(friendlyError(voteErr, t)); return; }
    }
    const { error: candErr } = await supabase.from("election_candidats").delete().eq("election_id", electionId);
    if (candErr) { setErrorMsg(friendlyError(candErr, t)); return; }
    const { error } = await supabase.from("elections").delete().eq("id", electionId);
    if (!error) {
      setElections((p) => p.filter((e) => e.id !== electionId));
      setCandidats((p) => p.filter((c) => c.election_id !== electionId));
      setVotes((p) => p.filter((v) => !candIds.includes(v.candidat_id)));
      setPvElectionId((p) => (p === electionId ? null : p));
    } else setErrorMsg(friendlyError(error, t));
  }
  async function voteFor(electionId, candidatId) {
   if (!profile.member_id) { setErrorMsg(t("gov_not_linked")); return; }
    const nomCandidat = members.find((m) => m.id === candidats.find((c) => c.id === candidatId)?.member_id)?.nom || "";
    if (!window.confirm(t("gov_confirm_vote").replace("{nom}", nomCandidat))) return;
    const { data, error } = await supabase.from("election_votes")
      .insert({ election_id: electionId, candidat_id: candidatId, voter_member_id: profile.member_id }).select().single();
    if (!error) setVotes((p) => [...p, data]);
    else setErrorMsg(error.message.includes("duplicate") ? t("gov_already_voted") : friendlyError(error, t));
  }
  function voteCount(candidatId) { return votes.filter((v) => v.candidat_id === candidatId).length; }
  function hasVoted(electionId) { return votes.some((v) => v.election_id === electionId && v.voter_member_id === profile.member_id); }

  // Statut "effectif" : une élection encore marquée "ouverte" en base mais dont la
  // date de fermeture est dépassée doit être traitée comme fermée immédiatement à
  // l'affichage, même avant que la mise à jour automatique en base (ci-dessous) ait fini.
  function effectiveStatut(el) {
    if (el.statut === "ouverte" && el.date_fin && new Date(el.date_fin) < new Date()) return "fermée";
    return el.statut;
  }

  // ---------- Clôture automatique des élections échues ----------
  // Dès que la date de fermeture d'une élection est dépassée, son statut passe
  // automatiquement de "ouverte" à "fermée" en base (une seule écriture, sans
  // action requise du Bureau). Cet effet se relance à chaque changement de la
  // liste des élections mais converge après une seule passe : une fois le statut
  // mis à "fermée", l'élection ne fait plus partie du filtre "expired".
  useEffect(() => {
    const expired = elections.filter((el) => el.statut === "ouverte" && el.date_fin && new Date(el.date_fin) < new Date());
    if (expired.length === 0) return;
    (async () => {
      for (const el of expired) {
        const { data, error } = await supabase.from("elections").update({ statut: "fermée" }).eq("id", el.id).select().single();
        if (!error && data) setElections((p) => p.map((e) => (e.id === el.id ? data : e)));
      }
    })();
  }, [elections]);

  // ---------- Procès-verbal (résultats) ----------
  const [pvElectionId, setPvElectionId] = useState(null);
  const pvElection = elections.find((el) => el.id === pvElectionId) || null;

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

      {/* Élections */}
      <h3 style={{ fontSize: 15, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}><Vote size={16} /> {t("gov_elections_title")}</h3>
      {isBureau && (
        <Card style={{ marginBottom: 20, maxWidth: 520 }}>
          <h4 style={{ fontSize: 13, marginBottom: 10 }}>{t("gov_create_election")}</h4>
          <Field label={t("gov_title_field")}><input style={inputStyle} value={newElection.titre} onChange={(e) => setNewElection({ ...newElection, titre: e.target.value })} /></Field>
          <Field label={t("description")}><input style={inputStyle} value={newElection.description} onChange={(e) => setNewElection({ ...newElection, description: e.target.value })} /></Field>
          <Field label={t("gov_opening")}><input type="datetime-local" style={inputStyle} value={newElection.date_debut} onChange={(e) => setNewElection({ ...newElection, date_debut: e.target.value })} /></Field>
          <Field label={t("gov_closing")}><input type="datetime-local" style={inputStyle} value={newElection.date_fin} onChange={(e) => setNewElection({ ...newElection, date_fin: e.target.value })} /></Field>
          <Btn onClick={createElection}>{t("gov_create_election_btn")}</Btn>
        </Card>
      )}

      {elections.map((el) => {
        const cands = candidats.filter((c) => c.election_id === el.id);
        const totalVotes = cands.reduce((s, c) => s + voteCount(c.id), 0);
        return (
          <Card key={el.id} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ fontSize: 14 }}>{el.titre}</h4>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: effectiveStatut(el) === "ouverte" ? "#1F8A5C" : "#686F7D", fontWeight: 700, textTransform: "uppercase" }}>{effectiveStatut(el)}</span>
                {isBureau && (
                  <button onClick={() => deleteElection(el.id)} title={t("gov_delete_election_btn")} style={{ fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Trash2 size={11} /> {t("gov_delete_election_btn")}
                  </button>
                )}
              </div>
            </div>
            <p style={{ fontSize: 12.5, color: "#5B6270" }}>{el.description}</p>
            <RuleBox>{t("gov_from")} {formatEventDateTime(el.date_debut, lang)} {t("gov_to")} {formatEventDateTime(el.date_fin, lang)}</RuleBox>

            <div style={{ marginBottom: 12 }}>
              <Btn variant="outline" onClick={() => setPvElectionId(el.id)} style={{ padding: "5px 12px", fontSize: 12 }}>
                <Printer size={13} /> {t("gov_pv_btn")}
              </Btn>
            </div>

            {isBureau && (
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <select style={{ ...inputStyle, width: 200 }} value={candDraft[el.id]?.member_id || ""} onChange={(e) => setCandDraft((p) => ({ ...p, [el.id]: { ...p[el.id], member_id: e.target.value } }))}>
                 <option value="">{t("gov_add_candidate")}</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                </select>
                <input style={{ ...inputStyle, width: 160 }} placeholder={t("gov_target_position")} value={candDraft[el.id]?.poste_vise || ""} onChange={(e) => setCandDraft((p) => ({ ...p, [el.id]: { ...p[el.id], poste_vise: e.target.value } }))} />
                <Btn onClick={() => addCandidat(el.id)}>Ajouter</Btn>
              </div>
            )}

           <Table head={[t("gov_col_candidate"), t("gov_col_target_position"), t("gov_col_votes"), t("gov_col_pct"), ""]}>
              {cands.map((c) => {
                const v = voteCount(c.id);
                const pct = totalVotes > 0 ? Math.round((v / totalVotes) * 100) : 0;
                return (
                  <tr key={c.id}>
                    <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>{members.find((m) => m.id === c.member_id)?.nom || "—"}</td>
                    <td style={td}>{c.poste_vise}</td>
                    <td style={td}>{v}</td>
                    <td style={td}>{pct}%</td>
                    <td style={{ ...td, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {effectiveStatut(el) === "ouverte" && !hasVoted(el.id) && profile.role === "adherent" && (
                        <Btn onClick={() => voteFor(el.id, c.id)} style={{ padding: "5px 12px", fontSize: 12 }}>{t("gov_vote_btn")}</Btn>
                      )}
                      {isBureau && (
                        <button onClick={() => deleteCandidat(c.id)} style={{ fontSize: 11, fontWeight: 600, color: RED, background: "none", border: `1px solid ${RED}`, borderRadius: 999, padding: "2px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Trash2 size={11} /> {t("gov_delete_btn")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        );
      })}
      {elections.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic" }}>{t("no_data")}</p>}

      {pvElection && (
        <ElectionPVModal
          election={pvElection}
          candidats={candidats.filter((c) => c.election_id === pvElection.id)}
          votes={votes.filter((v) => v.election_id === pvElection.id)}
          members={members}
          association={association}
          effectiveStatutLabel={effectiveStatut(pvElection)}
          t={t} lang={lang}
          onClose={() => setPvElectionId(null)}
        />
      )}
    </Section></Container>
  );
}

// =====================================================================
// Procès-verbal (PV) des résultats d'une élection — vue imprimable isolée,
// reprenant le pattern déjà utilisé pour les décharges (DechargeModal dans
// App.jsx) : un portail plein écran dont seul le contenu est visible à
// l'impression (le reste du DOM est masqué via `body > *:not(.pv-print-root)`).
// =====================================================================
function ElectionPVModal({ election, candidats, votes, members, association, effectiveStatutLabel, t, lang, onClose }) {
  const nameOf = (memberId) => members.find((m) => m.id === memberId)?.nom || "—";
  const voteCount = (candidatId) => votes.filter((v) => v.candidat_id === candidatId).length;
  const totalVotes = candidats.reduce((s, c) => s + voteCount(c.id), 0);
  const totalVoters = new Set(votes.map((v) => v.voter_member_id)).size;

  const postes = [...new Set(candidats.map((c) => c.poste_vise || t("gov_pv_no_position")))];
  const todayFormatted = new Date().toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA");
  const generatedOn = new Date().toLocaleString(lang === "en" ? "en-CA" : "fr-CA");

  return createPortal(
    <div className="pv-print-root" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }} onClick={onClose}>
      <style>{`
        @media print {
          body > *:not(.pv-print-root) { display: none !important; }
          .pv-print-root { position: static !important; background: white !important; padding: 0 !important; display: block !important; }
          .pv-no-print { display: none !important; }
          .pv-card { box-shadow: none !important; max-height: none !important; overflow: visible !important; width: 100% !important; max-width: 100% !important; }
        }
      `}</style>
      <div className="pv-card" style={{ background: "white", borderRadius: 12, padding: 32, maxWidth: 640, width: "94%", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="pv-no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("gov_pv_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        <h3 style={{ marginBottom: 4 }}>{association?.nom}</h3>
        <OrgLegalSubline association={association} />
        <h4 style={{ marginBottom: 4, fontWeight: 600 }}>{t("gov_pv_title")}</h4>
        <p style={{ fontSize: 12, color: "#686F7D", marginBottom: 16 }}>{t("gov_pv_generated_on")} {generatedOn}</p>

        <h4 style={{ fontSize: 15, marginBottom: 4 }}>{election.titre}</h4>
        {election.description && <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 8 }}>{election.description}</p>}
        <RuleBox>
          {t("gov_from")} {formatEventDateTime(election.date_debut, lang)} {t("gov_to")} {formatEventDateTime(election.date_fin, lang)}
          <br />{t("gov_pv_status")} : <b>{effectiveStatutLabel}</b>
        </RuleBox>

        <p style={{ fontSize: 13, marginTop: 12 }}>
          <b>{t("gov_pv_total_votes")}</b> : {totalVotes} &nbsp;•&nbsp; <b>{t("gov_pv_total_voters")}</b> : {totalVoters}
        </p>

        {postes.map((poste) => {
          const postCands = candidats.filter((c) => (c.poste_vise || t("gov_pv_no_position")) === poste);
          const postTotal = postCands.reduce((s, c) => s + voteCount(c.id), 0);
          const maxV = postTotal > 0 ? Math.max(...postCands.map((c) => voteCount(c.id))) : 0;
          const winners = postTotal > 0 ? postCands.filter((c) => voteCount(c.id) === maxV) : [];
          return (
            <div key={poste} style={{ marginTop: 18 }}>
              <h5 style={{ fontSize: 13, marginBottom: 8 }}>{poste}</h5>
              <Table head={[t("gov_col_candidate"), t("gov_col_votes"), t("gov_col_pct"), ""]}>
                {postCands.map((c) => {
                  const v = voteCount(c.id);
                  const pct = postTotal > 0 ? Math.round((v / postTotal) * 100) : 0;
                  const isWinner = postTotal > 0 && v === maxV;
                  return (
                    <tr key={c.id}>
                      <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>{nameOf(c.member_id)}</td>
                      <td style={td}>{v}</td>
                      <td style={td}>{pct}%</td>
                      <td style={{ ...td, fontWeight: 700, color: "#1F8A5C" }}>{isWinner ? (winners.length > 1 ? t("gov_pv_tie") : t("gov_pv_winner")) : ""}</td>
                    </tr>
                  );
                })}
              </Table>
              {postTotal === 0 && <p style={{ fontSize: 12, color: "#686F7D", fontStyle: "italic", marginTop: 4 }}>{t("gov_pv_no_votes")}</p>}
            </div>
          );
        })}
        {postes.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", marginTop: 12 }}>{t("no_data")}</p>}

        <div style={{ marginTop: 50 }}>
          <p style={{ fontSize: 11.5, color: "#5B6270", fontStyle: "italic", marginBottom: 18 }}>{t("gov_pv_esignature_notice")}</p>
          <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
            <SignatureLine label={t("gov_pv_signature_president")} printClass="pv-no-print" t={t} />
            <SignatureLine label={t("gov_pv_signature_secretaire")} printClass="pv-no-print" t={t} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#5B6270", marginTop: 6 }}>{t("date")} : <b>{todayFormatted}</b></div>

        <div className="pv-no-print" style={{ display: "flex", gap: 10, marginTop: 30 }}>
          <Btn onClick={() => window.print()}><Printer size={14} /> {t("fin_print_btn")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("tont_decharge_close")}</Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}
