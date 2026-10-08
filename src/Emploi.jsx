// =====================================================================
// Emploi.jsx — Emploi & carrière : offres d'emploi/bénévolat publiées
// par le Bureau, candidatures des membres, score de correspondance avec
// les compétences déjà déclarées dans la fiche membre (members.competences)
// — voir sql/2026-10-06_emploi_carriere.sql.
//
// CV/lettre de motivation stockés dans le bucket privé dédié
// "job-applications" (pas dans le coffre Documents, réservé au Bureau en
// écriture — voir en-tête du script SQL). La candidature passe par la
// fonction postuler_offre_emploi() plutôt qu'un insert direct, pour que
// l'auteur de l'offre soit notifié automatiquement.
// =====================================================================
import { useState, useEffect, useCallback, useMemo } from "react";
import { Briefcase, Plus, Pencil, Trash2, CheckCircle2, Send, FileText, Paperclip } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, StatCard, Pill, inputStyle, useLang, friendlyError, RED, TEAL, TEAL_LIGHT, foldText } from "./shared";

const AMBER = "#8A5A00";
const overlay = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 };

function daysAgo(iso, t) {
  const n = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  if (n === 0) return t("emp_posted_today");
  if (n === 1) return t("emp_posted_1_day");
  return t("emp_posted_n_days").replace("{n}", n);
}
function parseCompetences(text) {
  return (text || "").split(",").map((s) => s.trim()).filter(Boolean);
}
function matchScore(memberCompetencesText, requisesArr) {
  const requises = (requisesArr || []).map((s) => foldText(s));
  if (requises.length === 0) return null;
  const mine = new Set(parseCompetences(memberCompetencesText).map((s) => foldText(s)));
  let matched = 0;
  requises.forEach((r) => { if (mine.has(r) || [...mine].some((m) => m.includes(r) || r.includes(m))) matched++; });
  return Math.round((matched / requises.length) * 100);
}
function matchedSet(memberCompetencesText, requisesArr) {
  const mine = new Set(parseCompetences(memberCompetencesText).map((s) => foldText(s)));
  return new Set((requisesArr || []).filter((r) => {
    const fr = foldText(r);
    return mine.has(fr) || [...mine].some((m) => m.includes(fr) || fr.includes(m));
  }));
}

export default function Emploi({ profile, isBureau, association }) {
  const { t } = useLang();
  const canManage = isBureau || profile.role === "responsable_rubrique";
  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [myCompetences, setMyCompetences] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [applyingJob, setApplyingJob] = useState(null);
  const [expandedAppsJobId, setExpandedAppsJobId] = useState(null);

  function reportError(error) {
    if (error) { console.error("[Emploi]", error); setErrorMsg(friendlyError(error, t)); return true; }
    return false;
  }

  const load = useCallback(async () => {
    setLoading(true);
    const [jobRes, appRes, meRes] = await Promise.all([
      supabase.from("job_postings").select("*").eq("association_id", profile.association_id).order("created_at", { ascending: false }),
      supabase.from("job_applications").select("*"),
      profile.member_id ? supabase.from("members").select("competences").eq("id", profile.member_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    // Requêtes tolérantes : listes vides tant que
    // sql/2026-10-06_emploi_carriere.sql n'a pas été exécuté.
    setJobs(jobRes?.error ? [] : (jobRes.data || []));
    setApplications(appRes?.error ? [] : (appRes.data || []));
    setMyCompetences(meRes?.data?.competences || "");
    setLoading(false);
    setSelectedJobId((cur) => cur || (jobRes?.data || []).find((j) => j.statut === "active")?.id || null);
  }, [profile.association_id, profile.member_id]);
  useEffect(() => { load(); }, [load]);

  const activeJobs = jobs.filter((j) => j.statut === "active");
  const myApplications = applications.filter((a) => a.member_id === profile.member_id);
  const applicationsThisMonth = useMemo(() => {
    const d = new Date();
    return applications.filter((a) => { const ad = new Date(a.created_at); return ad.getMonth() === d.getMonth() && ad.getFullYear() === d.getFullYear(); }).length;
  }, [applications]);
  const avgMatch = useMemo(() => {
    if (!myCompetences) return null;
    const scores = activeJobs.map((j) => matchScore(myCompetences, j.competences_requises)).filter((s) => s != null);
    if (!scores.length) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }, [activeJobs, myCompetences]);

  function hasApplied(jobId) { return myApplications.some((a) => a.job_id === jobId); }
  function jobApplications(jobId) { return applications.filter((a) => a.job_id === jobId); }
  const selectedJob = jobs.find((j) => j.id === selectedJobId) || null;

  async function createJob(form) {
    const { data, error } = await supabase.from("job_postings").insert({
      association_id: profile.association_id, titre: form.titre.trim(), organisation: form.organisation.trim() || null,
      lieu: form.lieu.trim() || null, type_contrat: form.type_contrat, description: form.description.trim() || null,
      competences_requises: parseCompetences(form.competences), expire_le: form.expire_le || null, created_by: profile.member_id || null,
    }).select().single();
    if (reportError(error)) return false;
    setJobs((p) => [data, ...p]); setSelectedJobId(data.id);
    return true;
  }
  async function updateJob(id, patch) {
    const { error } = await supabase.from("job_postings").update(patch).eq("id", id);
    if (reportError(error)) return;
    setJobs((p) => p.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }
  async function deleteJob(id) {
    if (!window.confirm(t("emp_confirm_delete"))) return;
    const { error } = await supabase.from("job_postings").delete().eq("id", id);
    if (reportError(error)) return;
    setJobs((p) => p.filter((j) => j.id !== id));
    if (selectedJobId === id) setSelectedJobId(null);
  }
  async function setApplicationStatut(appId, statut) {
    const { error } = await supabase.from("job_applications").update({ statut }).eq("id", appId);
    if (reportError(error)) return;
    setApplications((p) => p.map((a) => (a.id === appId ? { ...a, statut } : a)));
  }
  async function viewAttachment(path) {
    if (!path) return;
    const { data, error } = await supabase.storage.from("job-applications").createSignedUrl(path, 60);
    if (!error && data) window.open(data.signedUrl, "_blank");
  }
  async function submitApplication(job, form) {
    if (!profile.member_id) return false;
    let cvPath = null, lettrePath = null;
    if (form.cvFile) {
      cvPath = `${profile.association_id}/${profile.member_id}/${Date.now()}_cv_${form.cvFile.name}`;
      const { error } = await supabase.storage.from("job-applications").upload(cvPath, form.cvFile);
      if (reportError(error)) return false;
    }
    if (form.lettreFile) {
      lettrePath = `${profile.association_id}/${profile.member_id}/${Date.now()}_lettre_${form.lettreFile.name}`;
      const { error } = await supabase.storage.from("job-applications").upload(lettrePath, form.lettreFile);
      if (reportError(error)) return false;
    }
    const { data, error } = await supabase.rpc("postuler_offre_emploi", {
      p_job_id: job.id, p_cv_path: cvPath, p_cv_nom: form.cvFile?.name || null,
      p_lettre_path: lettrePath, p_lettre_nom: form.lettreFile?.name || null, p_message: form.message.trim() || null,
    });
    if (reportError(error)) return false;
    const status = data?.[0]?.status;
    if (status === "deja_postule") { alert(t("emp_already_applied")); return true; }
    if (status !== "ok") { alert(t("emp_apply_failed")); return false; }
    setApplications((p) => [...p, {
      id: `local-${Date.now()}`, job_id: job.id, association_id: profile.association_id, member_id: profile.member_id,
      member_nom: profile.nom_complet, cv_path: cvPath, lettre_path: lettrePath, message: form.message, statut: "envoyee", created_at: new Date().toISOString(),
    }]);
    return true;
  }

  if (loading) return <Container><Section><p style={{ color: "#686F7D" }}>{t("loading")}</p></Section></Container>;

  return (
    <Container>
      <Section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><Briefcase size={22} color="var(--accent)" /> {t("nav_jobs")}</h2>
            <p style={{ color: "#686F7D", fontSize: 13.5, maxWidth: 580, margin: 0 }}>{t("emp_intro")}</p>
          </div>
          {canManage && <Btn onClick={() => setShowCreate(true)}><Plus size={14} /> {t("emp_new_btn")}</Btn>}
        </div>

        {errorMsg && <p style={{ color: RED, fontSize: 13, marginBottom: 14 }}>{errorMsg}</p>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 20 }}>
          <StatCard label={t("emp_stat_active")} value={activeJobs.length} icon={Briefcase} />
          <StatCard label={canManage ? t("emp_stat_applications_received") : t("emp_stat_my_applications")} value={canManage ? applicationsThisMonth : myApplications.length} icon={Send} accent={TEAL} />
          {avgMatch != null && <StatCard label={t("emp_stat_avg_match")} value={`${avgMatch}%`} icon={CheckCircle2} />}
        </div>

        {activeJobs.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{t("emp_jobs_empty")}</p>}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(280px,1fr)", gap: 20, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {jobs.map((j) => {
              const score = myCompetences ? matchScore(myCompetences, j.competences_requises) : null;
              const matched = matchedSet(myCompetences, j.competences_requises);
              const applied = hasApplied(j.id);
              const apps = jobApplications(j.id);
              return (
                <Card key={j.id} style={{ borderTopColor: j.statut === "active" ? "var(--accent)" : "#DCE0E8", opacity: j.statut === "active" ? 1 : 0.65, cursor: "pointer" }} onClick={() => setSelectedJobId(j.id)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{j.titre}</div>
                      <div style={{ fontSize: 12, color: "#8A8F98" }}>{j.organisation || association?.nom} {j.lieu ? `· ${j.lieu}` : ""}</div>
                    </div>
                    {score != null && <span style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 12.5, padding: "4px 11px", borderRadius: 999, background: score >= 70 ? TEAL_LIGHT : "#F7ECD9", color: score >= 70 ? TEAL : AMBER, flexShrink: 0 }}>{score}% {t("emp_match_label")}</span>}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0" }}>
                    <Pill color="#182233" bg="#F1F2F4">{t("emp_type_" + j.type_contrat)}</Pill>
                    <Pill color="#8A8F98" bg="#F1F2F4">{daysAgo(j.created_at, t)}</Pill>
                    {j.statut !== "active" && <Pill color={RED} bg="#FBEAE8">{t("emp_statut_fermee")}</Pill>}
                  </div>
                  {j.competences_requises?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                      {j.competences_requises.map((c, i) => (
                        <span key={i} style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999, background: matched.has(c) ? TEAL_LIGHT : "#EEF1F8", color: matched.has(c) ? TEAL : "var(--primary)" }}>
                          {matched.has(c) ? "✓ " : ""}{c}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                    {profile.member_id && j.statut === "active" && (applied
                      ? <Pill color={TEAL} bg={TEAL_LIGHT}>{t("emp_applied_pill")}</Pill>
                      : <Btn style={{ padding: "7px 14px", fontSize: 12.5 }} onClick={() => setApplyingJob(j)}><Send size={12} /> {t("emp_apply_btn")}</Btn>)}
                    {canManage && (
                      <>
                        <button onClick={() => setExpandedAppsJobId((id) => (id === j.id ? null : j.id))} style={linkBtn("#5B6270")}>{t("emp_applications_count").replace("{n}", apps.length)}</button>
                        <button onClick={() => setEditingJob(j)} style={linkBtn("var(--primary)")}><Pencil size={11} /></button>
                        <button onClick={() => updateJob(j.id, { statut: j.statut === "active" ? "fermee" : "active" })} style={linkBtn(AMBER)}>{j.statut === "active" ? t("emp_close_btn") : t("emp_reopen_btn")}</button>
                        <button onClick={() => deleteJob(j.id)} style={linkBtn(RED)}><Trash2 size={11} /></button>
                      </>
                    )}
                  </div>
                  {canManage && expandedAppsJobId === j.id && (
                    <div style={{ marginTop: 12, borderTop: "1px solid #EEE", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }} onClick={(e) => e.stopPropagation()}>
                      {apps.length === 0 && <span style={{ fontSize: 12, color: "#8A8F98", fontStyle: "italic" }}>{t("emp_applications_empty")}</span>}
                      {apps.map((a) => (
                        <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 12.5, flexWrap: "wrap" }}>
                          <span>{a.member_nom}</span>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            {a.cv_path && <button onClick={() => viewAttachment(a.cv_path)} style={linkBtn("var(--primary)")}><FileText size={11} /> CV</button>}
                            {a.lettre_path && <button onClick={() => viewAttachment(a.lettre_path)} style={linkBtn("var(--primary)")}><FileText size={11} /> {t("emp_cover_letter")}</button>}
                            <select value={a.statut} onChange={(e) => setApplicationStatut(a.id, e.target.value)} style={{ fontSize: 11.5, border: "1px solid #DCE0E8", borderRadius: 6, padding: "3px 6px" }}>
                              <option value="envoyee">{t("emp_app_statut_envoyee")}</option>
                              <option value="vue">{t("emp_app_statut_vue")}</option>
                              <option value="retenue">{t("emp_app_statut_retenue")}</option>
                              <option value="refusee">{t("emp_app_statut_refusee")}</option>
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          {selectedJob && (
            <JobDetail job={selectedJob} t={t} association={association} myCompetences={myCompetences}
              applied={hasApplied(selectedJob.id)} canApply={!!profile.member_id && selectedJob.statut === "active"}
              onApply={() => setApplyingJob(selectedJob)} />
          )}
        </div>
      </Section>

      {showCreate && <JobFormModal t={t} title={t("emp_new_btn")} onClose={() => setShowCreate(false)} onSave={async (f) => { if (await createJob(f)) setShowCreate(false); }} />}
      {editingJob && (
        <JobFormModal t={t} title={t("action_edit")} job={editingJob} onClose={() => setEditingJob(null)}
          onSave={async (f) => { await updateJob(editingJob.id, { titre: f.titre.trim(), organisation: f.organisation.trim() || null, lieu: f.lieu.trim() || null, type_contrat: f.type_contrat, description: f.description.trim() || null, competences_requises: parseCompetences(f.competences), expire_le: f.expire_le || null }); setEditingJob(null); }}
        />
      )}
      {applyingJob && <ApplyModal t={t} job={applyingJob} onClose={() => setApplyingJob(null)} onSubmit={async (f) => { if (await submitApplication(applyingJob, f)) setApplyingJob(null); }} />}
    </Container>
  );
}

function linkBtn(color) {
  return { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color, background: "none", border: "none", cursor: "pointer", padding: 0 };
}

function JobDetail({ job, t, association, myCompetences, applied, canApply, onApply }) {
  const matched = matchedSet(myCompetences, job.competences_requises);
  return (
    <Card>
      <h3 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 18, margin: "0 0 4px" }}>{job.titre}</h3>
      <div style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 14 }}>{job.organisation || association?.nom} {job.lieu ? `· ${job.lieu}` : ""} · {t("emp_type_" + job.type_contrat)}</div>
      {job.description && (
        <div style={{ marginBottom: 16 }}>
          <b style={{ display: "block", fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", color: "#9AA2B5", marginBottom: 6 }}>{t("emp_detail_description")}</b>
          <p style={{ fontSize: 12.5, color: "#5B6270", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>{job.description}</p>
        </div>
      )}
      {job.competences_requises?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <b style={{ display: "block", fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", color: "#9AA2B5", marginBottom: 6 }}>{t("emp_detail_skills")}</b>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {job.competences_requises.map((c, i) => (
              <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: matched.has(c) ? TEAL_LIGHT : "#EEF1F8", color: matched.has(c) ? TEAL : "var(--primary)" }}>
                {matched.has(c) ? "✓ " : ""}{c}
              </span>
            ))}
          </div>
        </div>
      )}
      {canApply && (applied ? <Pill color={TEAL} bg={TEAL_LIGHT}>{t("emp_applied_pill")}</Pill> : (
        <Btn onClick={onApply} style={{ width: "100%", justifyContent: "center" }}><Send size={14} /> {t("emp_apply_btn")}</Btn>
      ))}
    </Card>
  );
}

function JobFormModal({ t, title, job, onClose, onSave }) {
  const [form, setForm] = useState({
    titre: job?.titre || "", organisation: job?.organisation || "", lieu: job?.lieu || "",
    type_contrat: job?.type_contrat || "cdi", description: job?.description || "",
    competences: (job?.competences_requises || []).join(", "), expire_le: job?.expire_le || "",
  });
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!form.titre.trim()) return;
    setSaving(true); await onSave(form); setSaving(false);
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 520, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ marginBottom: 14 }}>{title}</h3>
        <Field label={t("emp_field_title")}><input style={inputStyle} value={form.titre} onChange={(e) => setForm((p) => ({ ...p, titre: e.target.value }))} /></Field>
        <Field label={t("emp_field_org")}><input style={inputStyle} value={form.organisation} onChange={(e) => setForm((p) => ({ ...p, organisation: e.target.value }))} placeholder={t("emp_field_org_placeholder")} /></Field>
        <Field label={t("emp_field_location")}><input style={inputStyle} value={form.lieu} onChange={(e) => setForm((p) => ({ ...p, lieu: e.target.value }))} /></Field>
        <Field label={t("emp_field_contract")}>
          <select style={inputStyle} value={form.type_contrat} onChange={(e) => setForm((p) => ({ ...p, type_contrat: e.target.value }))}>
            <option value="cdi">{t("emp_type_cdi")}</option>
            <option value="cdd">{t("emp_type_cdd")}</option>
            <option value="stage">{t("emp_type_stage")}</option>
            <option value="benevolat">{t("emp_type_benevolat")}</option>
            <option value="temps_partiel">{t("emp_type_temps_partiel")}</option>
          </select>
        </Field>
        <Field label={t("emp_field_description")}><textarea style={{ ...inputStyle, minHeight: 90 }} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></Field>
        <Field label={t("emp_field_skills")}>
          <input style={inputStyle} value={form.competences} onChange={(e) => setForm((p) => ({ ...p, competences: e.target.value }))} placeholder={t("emp_field_skills_placeholder")} />
        </Field>
        <Field label={t("emp_field_expiry")}><input type="date" style={inputStyle} value={form.expire_le} onChange={(e) => setForm((p) => ({ ...p, expire_le: e.target.value }))} /></Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
          <Btn onClick={submit} disabled={saving}>{saving ? t("loading") : t("action_save")}</Btn>
        </div>
      </div>
    </div>
  );
}

function ApplyModal({ t, job, onClose, onSubmit }) {
  const [message, setMessage] = useState("");
  const [cvFile, setCvFile] = useState(null);
  const [lettreFile, setLettreFile] = useState(null);
  const [saving, setSaving] = useState(false);
  async function submit() {
    setSaving(true);
    await onSubmit({ message, cvFile, lettreFile });
    setSaving(false);
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ marginBottom: 4 }}>{t("emp_apply_btn")}</h3>
        <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 14 }}>{job.titre}</p>
        <Field label={t("emp_apply_cv")}>
          <label style={fileLabel}>
            <Paperclip size={13} /> {cvFile ? cvFile.name : t("emp_apply_choose_file")}
            <input type="file" style={{ display: "none" }} onChange={(e) => setCvFile(e.target.files?.[0] || null)} />
          </label>
        </Field>
        <Field label={t("emp_apply_cover_letter")}>
          <label style={fileLabel}>
            <Paperclip size={13} /> {lettreFile ? lettreFile.name : t("emp_apply_choose_file")}
            <input type="file" style={{ display: "none" }} onChange={(e) => setLettreFile(e.target.files?.[0] || null)} />
          </label>
        </Field>
        <Field label={t("emp_apply_message")}><textarea style={{ ...inputStyle, minHeight: 80 }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("emp_apply_message_placeholder")} /></Field>
        <p style={{ fontSize: 11, color: "#8A8F98", marginBottom: 10 }}>{t("emp_apply_storage_note")}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
          <Btn onClick={submit} disabled={saving}><Send size={13} /> {saving ? t("loading") : t("emp_apply_submit")}</Btn>
        </div>
      </div>
    </div>
  );
}
const fileLabel = { display: "flex", alignItems: "center", gap: 8, border: "1.5px dashed #DCE0E8", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: "var(--primary)", cursor: "pointer" };
