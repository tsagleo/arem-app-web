// =====================================================================
// Sondages.jsx — Sondages à choix unique pour les adhérents
// =====================================================================
// Suite 62 (2026-09-12), à la demande de l'utilisateur : « une option de
// faire des sondages ». Le Bureau crée une question avec au moins deux
// options ; tous les adhérents votent une seule fois chacun (le vote peut
// être changé jusqu'à la clôture) ; les résultats (votes + pourcentage
// par option) sont visibles par tous, en tout temps, pour la
// transparence. Suit le même modèle que les autres modules du projet :
// composant autonome, chargement de ses propres données, gestion
// d'erreur par `alert(...)`.
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import { BarChart3, Plus, Trash2, X, Lock, CheckCircle2, Clock } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, inputStyle, useLang, RED, TEAL, TEAL_LIGHT, CHARCOAL, friendlyError } from "./shared";

// ---------- Réforme de design (2026-09-30), même traitement que la
// refonte Événements : pastille de filtre En cours/Clos, formulaire de
// création repliable, cartes de résultats modernisées. Logique métier
// (vote unique modifiable, clôture, suppression) inchangée. ----------
function pillFilterStyle(active) {
  return active
    ? { fontWeight: 600, fontSize: 13, color: "#fff", background: TEAL, border: "1px solid transparent", borderRadius: 999, padding: "8px 16px", cursor: "pointer" }
    : { fontWeight: 600, fontSize: 13, color: "rgba(42,42,42,.55)", background: "transparent", border: "1px solid rgba(42,42,42,.14)", borderRadius: 999, padding: "8px 16px", cursor: "pointer" };
}

export default function Sondages({ profile, isBureau }) {
  const [polls, setPolls] = useState([]);
  const [options, setOptions] = useState([]);
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const { t, lang } = useLang();

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: o }, { data: v }] = await Promise.all([
      supabase.from("polls").select("*").eq("association_id", profile.association_id).order("created_at", { ascending: false }),
      supabase.from("poll_options").select("*").eq("association_id", profile.association_id).order("position"),
      supabase.from("poll_votes").select("*").eq("association_id", profile.association_id),
    ]);
    setPolls(p || []); setOptions(o || []); setVotes(v || []);
    setLoading(false);
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  // ---------- Création d'un sondage (Bureau) ----------
  const [newQuestion, setNewQuestion] = useState("");
  const [newOptions, setNewOptions] = useState(["", ""]);
  const [newClosesAt, setNewClosesAt] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [pollFilter, setPollFilter] = useState("active");

  function updateNewOption(i, val) {
    setNewOptions((prev) => prev.map((o, idx) => (idx === i ? val : o)));
  }
  function addOptionField() { setNewOptions((prev) => [...prev, ""]); }
  function removeOptionField(i) { setNewOptions((prev) => prev.filter((_, idx) => idx !== i)); }

  async function createPoll() {
    const question = newQuestion.trim();
    const cleanOptions = newOptions.map((o) => o.trim()).filter(Boolean);
    if (!question || cleanOptions.length < 2) { alert(t("poll_error_min_options")); return; }
    if (!window.confirm(t("poll_confirm_create").replace("{question}", question))) return;
    const { data: poll, error } = await supabase.from("polls").insert({
      association_id: profile.association_id, question, created_by: profile.id,
      created_by_nom: profile.nom_complet, closes_at: newClosesAt ? new Date(newClosesAt).toISOString() : null,
    }).select().single();
    if (error) { alert(t("poll_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
    const rows = cleanOptions.map((texte, position) => ({
      poll_id: poll.id, association_id: profile.association_id, texte, position,
    }));
    const { data: opts, error: e2 } = await supabase.from("poll_options").insert(rows).select();
    if (e2) { alert(t("poll_error_generic") + " " + friendlyError(e2, t)); console.error(e2); return; }
    setPolls((prev) => [poll, ...prev]);
    setOptions((prev) => [...prev, ...(opts || [])]);
    setNewQuestion(""); setNewOptions(["", ""]); setNewClosesAt("");
    setShowCreateForm(false);
  }

  async function deletePoll(pollId) {
    if (!window.confirm(t("poll_confirm_delete"))) return;
    const { error } = await supabase.from("polls").delete().eq("id", pollId);
    if (error) { alert(t("poll_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
    setPolls((prev) => prev.filter((p) => p.id !== pollId));
    setOptions((prev) => prev.filter((o) => o.poll_id !== pollId));
    setVotes((prev) => prev.filter((v) => v.poll_id !== pollId));
  }

  async function closePoll(pollId) {
    const poll = polls.find((p) => p.id === pollId);
    if (!window.confirm(t("poll_confirm_close").replace("{question}", poll?.question || ""))) return;
    const { error } = await supabase.from("polls").update({ closed: true }).eq("id", pollId);
    if (error) { alert(t("poll_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
    setPolls((prev) => prev.map((p) => (p.id === pollId ? { ...p, closed: true } : p)));
  }

  function myVote(pollId) { return votes.find((v) => v.poll_id === pollId && v.member_profile_id === profile.id); }

  async function vote(pollId, optionId) {
    const existing = myVote(pollId);
    if (existing && existing.option_id === optionId) return;
    const opt = options.find((o) => o.id === optionId);
    if (!window.confirm(t("poll_confirm_vote").replace("{option}", opt?.texte || ""))) return;
    if (existing) {
      const { error } = await supabase.from("poll_votes").update({ option_id: optionId }).eq("id", existing.id);
      if (error) { alert(t("poll_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
      setVotes((prev) => prev.map((v) => (v.id === existing.id ? { ...v, option_id: optionId } : v)));
    } else {
      const { data, error } = await supabase.from("poll_votes").insert({
        poll_id: pollId, option_id: optionId, association_id: profile.association_id, member_profile_id: profile.id,
      }).select().single();
      if (error) { alert(t("poll_error_generic") + " " + friendlyError(error, t)); console.error(error); return; }
      setVotes((prev) => [...prev, data]);
    }
  }

  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  // isClosed d'un sondage : même formule que pollOptions ci-dessous, reprise
  // ici pour le comptage des pastilles de filtre et le tri des listes.
  function pollIsClosed(poll) { return poll.closed || (poll.closes_at && new Date(poll.closes_at) < new Date()); }
  const activePolls = polls.filter((p) => !pollIsClosed(p));
  const closedPolls = polls.filter((p) => pollIsClosed(p));
  const visiblePolls = pollFilter === "active" ? activePolls : closedPolls;

  return (
    <Container><Section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}><BarChart3 size={20} /> {t("nav_polls")}</h2>
        {isBureau && (
          <Btn variant={showCreateForm ? "outline" : "primary"} onClick={() => setShowCreateForm((v) => !v)}>
            <Plus size={14} style={{ transform: showCreateForm ? "rotate(45deg)" : "none", transition: "transform .15s" }} />
            {showCreateForm ? t("action_close") : t("poll_create_title")}
          </Btn>
        )}
      </div>

      {isBureau && showCreateForm && (
        <Card style={{ marginBottom: 24, borderTop: `3px solid ${TEAL}`, padding: 22 }}>
          <h3 style={{ fontSize: 14, marginBottom: 16, fontFamily: "Poppins, sans-serif", color: CHARCOAL }}>{t("poll_create_title")}</h3>
          <Field label={t("poll_question")}>
            <input style={inputStyle} value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder={t("poll_question_placeholder")} />
          </Field>
          <Field label={t("poll_options_label")}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {newOptions.map((o, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    style={inputStyle} value={o} placeholder={t("poll_option_placeholder").replace("{n}", String(i + 1))}
                    onChange={(e) => updateNewOption(i, e.target.value)}
                  />
                  {newOptions.length > 2 && (
                    <button onClick={() => removeOptionField(i)} style={{ background: "none", border: "none", color: RED, cursor: "pointer", display: "flex", flexShrink: 0 }} title={t("action_delete")}>
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={addOptionField} style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: TEAL, background: "none", border: "1px dashed #C7CDD3", borderRadius: 8, padding: "7px 14px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Plus size={13} /> {t("poll_add_option_btn")}
            </button>
          </Field>
          <Field label={t("poll_closes_at_label")}>
            <input type="datetime-local" style={inputStyle} value={newClosesAt} onChange={(e) => setNewClosesAt(e.target.value)} />
          </Field>
          <p style={{ fontSize: 11, color: "#9AA2B5", margin: "-8px 0 18px" }}>{t("poll_closes_at_hint")}</p>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={createPoll}><Plus size={14} /> {t("poll_create_btn")}</Btn>
            <Btn variant="outline" onClick={() => setShowCreateForm(false)}>{t("action_close")}</Btn>
          </div>
        </Card>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <button onClick={() => setPollFilter("active")} style={pillFilterStyle(pollFilter === "active")}>{lang === "en" ? "Active" : "En cours"} · {activePolls.length}</button>
        <button onClick={() => setPollFilter("closed")} style={pillFilterStyle(pollFilter === "closed")}>{t("poll_closed_pill")} · {closedPolls.length}</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {visiblePolls.map((poll) => {
          const pollOptions = options.filter((o) => o.poll_id === poll.id);
          const pollVotes = votes.filter((v) => v.poll_id === poll.id);
          const totalVotes = pollVotes.length;
          const mine = myVote(poll.id);
          const isClosed = pollIsClosed(poll);
          return (
            <Card key={poll.id} style={{ padding: "20px 22px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <h4 style={{ margin: 0, fontFamily: "Poppins, sans-serif", fontSize: 15.5, fontWeight: 700, color: CHARCOAL }}>{poll.question}</h4>
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em",
                    padding: "4px 10px", borderRadius: 999, flexShrink: 0,
                    background: isClosed ? "#ECEDE9" : TEAL_LIGHT, color: isClosed ? "#6B6F76" : TEAL,
                  }}>
                    {isClosed ? t("poll_closed_pill") : (lang === "en" ? "Active" : "En cours")}
                  </span>
                </div>
                {isBureau && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {!poll.closed && (
                      <button onClick={() => closePoll(poll.id)} title={t("poll_close_btn")} style={{ width: 26, height: 26, borderRadius: "50%", background: "none", border: "1px solid #DADFE3", color: "#5B6270", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                        <Lock size={12} />
                      </button>
                    )}
                    <button onClick={() => deletePoll(poll.id)} title={t("action_delete")} style={{ width: 26, height: 26, borderRadius: "50%", background: "none", border: "1px solid #E8B9B2", color: RED, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                <span style={{ fontSize: 11.5, color: "#9AA2B5" }}>
                  {t("poll_created_by")} {poll.created_by_nom || "—"} · {new Date(poll.created_at).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA")}
                  {isClosed && poll.closes_at ? ` · ${t("poll_closed_pill")} ${new Date(poll.closes_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}` : ""}
                </span>
                {!isClosed && poll.closes_at && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#6B6F76", background: "#F1F2F0", padding: "3px 9px", borderRadius: 999 }}>
                    <Clock size={11} /> {t("poll_closes_at_prefix")} {new Date(poll.closes_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}
                  </span>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {pollOptions.map((opt) => {
                  const count = pollVotes.filter((v) => v.option_id === opt.id).length;
                  const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                  const isMine = mine?.option_id === opt.id;
                  return (
                    <div key={opt.id}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                        {!isClosed && (
                          <button
                            onClick={() => vote(poll.id, opt.id)}
                            title={t("poll_vote_btn")}
                            style={{
                              width: 19, height: 19, borderRadius: "50%", flexShrink: 0, cursor: "pointer", padding: 0,
                              border: `1.5px solid ${isMine ? TEAL : "#C7CDD3"}`, background: isMine ? TEAL : "white",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >
                            {isMine && <CheckCircle2 size={12} color="white" />}
                          </button>
                        )}
                        {isClosed && isMine && <CheckCircle2 size={15} color={TEAL} style={{ flexShrink: 0, width: 19 }} />}
                        {isClosed && !isMine && <span style={{ width: 19, flexShrink: 0 }} />}
                        <span style={{ fontSize: 13.5, fontWeight: isMine ? 700 : 500, color: isMine ? TEAL : CHARCOAL, flex: 1 }}>{opt.texte}</span>
                        <span style={{ fontSize: 12, color: "#9AA2B5", fontVariantNumeric: "tabular-nums" }}>{count} · {pct}%</span>
                      </div>
                      <div style={{ height: 7, borderRadius: 999, background: "#EEF0EE", overflow: "hidden", marginLeft: 29 }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: isMine ? TEAL : "#DCE3E8", borderRadius: 999, transition: "width .3s ease" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11.5, color: "#9AA2B5", marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(42,42,42,.06)" }}>
                {t("poll_total_votes").replace("{n}", String(totalVotes))}
              </div>
            </Card>
          );
        })}
        {visiblePolls.length === 0 && <p style={{ color: "#9AA2B5", fontStyle: "italic" }}>{t("poll_no_polls")}</p>}
      </div>
    </Section></Container>
  );
}
