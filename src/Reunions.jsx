// =====================================================================
// Reunions.jsx — Réunions & webinaires (conseil, assemblée générale,
// comité, webinaire public) avec visioconférence Jitsi Meet (libre,
// gratuite, serveur public meet.jit.si) — voir
// sql/2026-10-06_reunions_webinaires.sql +
// sql/2026-10-06c_reunions_options_avancees.sql.
//
// "Rejoindre" ouvre la salle Jitsi dans un nouvel onglet (même principe
// que events.lien_reunion dans Evenements.jsx). L'ordre du jour et le
// procès-verbal sont déposés dans le coffre Documents existant (bucket
// "documents"), réservé au Bureau.
//
// Options avancées (suite, demandées par l'utilisateur) :
//   - Transcription/notes en direct, GRATUITE : reconnaissance vocale du
//     navigateur (Web Speech API, Chrome/Edge seulement — aucune clé
//     API, aucun coût), éditable à la main, utilisable comme base du
//     procès-verbal. Ne capte que le micro de l'appareil qui a ouvert
//     cette page (pas chaque participant distant séparément).
//   - Rappel automatique par courriel avant la réunion, respectant le
//     fuseau horaire de l'association (associations.fuseau_horaire)
//     pour l'heure affichée dans le courriel.
//   - Réunions récurrentes (hebdomadaire/mensuel), générées côté client
//     en convertissant chaque occurrence via le fuseau horaire de
//     l'association, pour que "19h" reste 19h heure locale de
//     l'association d'une occurrence à l'autre (y compris autour d'un
//     changement d'heure).
//   - Suivi du quorum pour les assemblées générales (seuil configurable
//     par réunion, comparé aux présences pointées).
//   - Export de la feuille de présence en PDF (jsPDF + jspdf-autotable,
//     déjà utilisés ailleurs dans l'application — aucune nouvelle
//     dépendance).
// =====================================================================
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Video, Plus, Pencil, Trash2, Calendar, Users, FileText, Upload, ExternalLink, CheckCircle2, XCircle, Clock, Link2, Mic, Square, FileDown, Repeat, Percent, Save, FileSignature } from "lucide-react";
import { supabase } from "./supabaseClient";
import { enTeteOfficiel, piedsDePageOfficiels, couleurAssociation } from "./pdfOfficiel";
import { Section, Container, Card, Btn, Field, StatCard, Pill, inputStyle, useLang, friendlyError, RED, TEAL, TEAL_LIGHT, toDatetimeLocal, datetimeLocalToISO } from "./shared";

const AMBER = "#8A5A00";
const AMBER_LIGHT = "#FDF3DF";
const overlay = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 };
const TYPE_COLORS = { conseil: "var(--primary)", assemblee_generale: AMBER, comite: "#5B6270", webinaire_public: TEAL };

function slugify(s) {
  return (s || "assoc").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24) || "assoc";
}
// Nom de fichier sûr pour une clé de stockage Supabase : les accents (é, è,
// ê…) et apostrophes dans un nom de fichier réel (ex. "Rapport_d'impact_
// Collecte_de_vêtements_hiver.pdf") font échouer l'upload avec "Invalid key"
// — le stockage objet n'accepte pas tous les caractères Unicode. On
// normalise la partie "nom" (sans l'extension) en ASCII sûr, en conservant
// l'extension telle quelle (en la nettoyant aussi, par précaution).
function safeFileName(name) {
  const raw = (name || "fichier").toString();
  const dot = raw.lastIndexOf(".");
  const base = dot > 0 ? raw.slice(0, dot) : raw;
  const ext = dot > 0 ? raw.slice(dot + 1) : "";
  const safeBase = base.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "fichier";
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
  return safeExt ? `${safeBase}.${safeExt}` : safeBase;
}
function generateJitsiRoom(association) {
  const base = slugify(association?.nom);
  const rand = Math.random().toString(36).slice(2, 8);
  return `https://meet.jit.si/${base}-${rand}`;
}
function formatDateTime(iso, lang) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(lang === "en" ? "en-CA" : "fr-CA", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
}
function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; const v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16); });
}

// ---------- Réunions récurrentes : conversion fuseau horaire ----------
// Préserve la même heure LOCALE (fuseau horaire de l'association) d'une
// occurrence à l'autre, plutôt qu'un simple décalage fixe en millisecondes
// qui dériverait autour d'un changement d'heure (DST).
function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), hh: Number(parts.hour === "24" ? "0" : parts.hour), mm: Number(parts.minute) };
}
function zonedTimeToUtc(y, m, d, hh, mm, timeZone) {
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(guess, timeZone);
    const guessedUtcForSameWallTime = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    const target = Date.UTC(y, m - 1, d, hh, mm);
    guess = new Date(guess.getTime() + (target - guessedUtcForSameWallTime));
  }
  return guess;
}
function addDaysLocal(parts, n) {
  const dt = new Date(parts.y, parts.m - 1, parts.d);
  dt.setDate(dt.getDate() + n);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), hh: parts.hh, mm: parts.mm };
}
function addMonthsLocal(parts, n) {
  let { y, m, d, hh, mm } = parts;
  m += n;
  while (m > 12) { m -= 12; y += 1; }
  const daysInMonth = new Date(y, m, 0).getDate();
  return { y, m, d: Math.min(d, daysInMonth), hh, mm };
}
function computeRecurrenceOccurrences(baseDate, pattern, count, timeZone) {
  const tz = timeZone || "UTC";
  const result = [baseDate];
  let cur = zonedParts(baseDate, tz);
  for (let i = 1; i < count; i++) {
    cur = pattern === "hebdomadaire" ? addDaysLocal(cur, 7) : addMonthsLocal(cur, 1);
    result.push(zonedTimeToUtc(cur.y, cur.m, cur.d, cur.hh, cur.mm, tz));
  }
  return result;
}

// ---------- Transcription en direct (Web Speech API, gratuite) ----------
function getSpeechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export default function Reunions({ profile, isBureau, association }) {
  const { t, lang } = useLang();
  const [meetings, setMeetings] = useState([]);
  const [rsvps, setRsvps] = useState([]);
  const [members, setMembers] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState(null);
  const [attendeesOpenId, setAttendeesOpenId] = useState(null);
  const [savingUpload, setSavingUpload] = useState(false);
  const [transcriptionOpenId, setTranscriptionOpenId] = useState(null);
  const [transcriptDrafts, setTranscriptDrafts] = useState({});
  const [recordingId, setRecordingId] = useState(null);
  const recognitionRef = useRef(null);

  const speechSupported = !!getSpeechRecognitionCtor();

  function reportError(error) {
    if (error) { console.error("[Reunions]", error); setErrorMsg(friendlyError(error, t)); return true; }
    return false;
  }

  const load = useCallback(async () => {
    setLoading(true);
    const [meetRes, rsvpRes, memRes, docRes] = await Promise.all([
      supabase.from("meetings").select("*").eq("association_id", profile.association_id).order("date_heure"),
      supabase.from("meeting_rsvps").select("*"),
      supabase.from("members").select("id,nom,statut").order("nom"),
      supabase.from("documents").select("id,nom,storage_path,rubrique").eq("association_id", profile.association_id).in("rubrique", ["ordre_du_jour_reunion", "pv_reunion"]),
    ]);
    // Requêtes tolérantes : listes vides tant que les scripts SQL n'ont
    // pas été exécutés.
    setMeetings(meetRes?.error ? [] : (meetRes.data || []));
    setRsvps(rsvpRes?.error ? [] : (rsvpRes.data || []));
    setMembers((memRes.data || []).filter((m) => m.statut !== "Supprimé"));
    setDocs(docRes?.error ? [] : (docRes.data || []));
    setLoading(false);
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  // Arrête proprement la reconnaissance vocale si le composant se démonte.
  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  const now = Date.now();
  const upcoming = meetings.filter((m) => m.statut !== "annulee" && new Date(m.date_heure).getTime() >= now);
  const past = meetings.filter((m) => m.statut === "terminee" || (m.statut !== "annulee" && new Date(m.date_heure).getTime() < now));

  const thisMonthCount = useMemo(() => {
    const d = new Date();
    return meetings.filter((m) => { const md = new Date(m.date_heure); return md.getMonth() === d.getMonth() && md.getFullYear() === d.getFullYear(); }).length;
  }, [meetings]);
  const cumulativeAttendees = rsvps.filter((r) => r.statut === "confirme" || r.statut === "present").length;
  const avgAttendanceRate = useMemo(() => {
    const rates = [];
    past.forEach((m) => {
      const mr = rsvps.filter((r) => r.meeting_id === m.id);
      const invited = mr.filter((r) => r.statut === "confirme" || r.statut === "present");
      if (invited.length === 0) return;
      const present = mr.filter((r) => r.statut === "present").length;
      rates.push((present / invited.length) * 100);
    });
    if (!rates.length) return null;
    return Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
  }, [past, rsvps]);

  function memberNom(id) { return members.find((m) => m.id === id)?.nom || "—"; }
  function meetingRsvps(id) { return rsvps.filter((r) => r.meeting_id === id); }
  function myRsvp(id) { return rsvps.find((r) => r.meeting_id === id && r.member_id === profile.member_id); }
  function docFor(id) { return docs.find((d) => d.id === id); }
  function quorumInfo(m) {
    if (m.type_reunion !== "assemblee_generale" || !m.quorum_requis_pourcentage) return null;
    const present = meetingRsvps(m.id).filter((r) => r.statut === "present").length;
    const activeCount = members.length;
    const pct = activeCount > 0 ? Math.round((present / activeCount) * 100) : 0;
    return { pct, required: m.quorum_requis_pourcentage, reached: pct >= m.quorum_requis_pourcentage };
  }

  async function createMeeting(form) {
    const baseDate = new Date(form.date_heure);
    const count = form.recurrence_regle !== "aucune" ? Math.max(1, Math.min(24, Number(form.occurrences) || 1)) : 1;
    const tz = association?.fuseau_horaire || "UTC";
    const occurrences = count > 1 ? computeRecurrenceOccurrences(baseDate, form.recurrence_regle, count, tz) : [baseDate];
    const rootId = uuid();
    const rows = occurrences.map((d, i) => ({
      id: i === 0 ? rootId : uuid(),
      association_id: profile.association_id, titre: form.titre.trim(), type_reunion: form.type_reunion,
      date_heure: d.toISOString(), lien_visio: form.lien_visio.trim() || null, notes: form.notes.trim() || null,
      created_by: profile.member_id || null,
      rappel_heures_avant: Math.max(1, Number(form.rappel_heures_avant) || 2),
      recurrence_regle: form.recurrence_regle,
      recurrence_parent_id: i === 0 ? null : rootId,
      quorum_requis_pourcentage: form.type_reunion === "assemblee_generale" && form.quorum ? Number(form.quorum) : null,
    }));
    const { data, error } = await supabase.from("meetings").insert(rows).select();
    if (reportError(error)) return false;
    setMeetings((p) => [...p, ...(data || [])].sort((a, b) => new Date(a.date_heure) - new Date(b.date_heure)));
    return true;
  }
  async function updateMeeting(id, patch) {
    const { error } = await supabase.from("meetings").update(patch).eq("id", id);
    if (reportError(error)) return;
    setMeetings((p) => p.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }
  async function deleteMeeting(id) {
    if (!window.confirm(t("reu_confirm_delete"))) return;
    const { error } = await supabase.from("meetings").delete().eq("id", id);
    if (reportError(error)) return;
    setMeetings((p) => p.filter((m) => m.id !== id));
  }
  async function deleteSeries(m) {
    if (!window.confirm(t("reu_confirm_delete_series"))) return;
    const rootId = m.recurrence_parent_id || m.id;
    const { error } = await supabase.from("meetings").delete().or(`id.eq.${rootId},recurrence_parent_id.eq.${rootId}`);
    if (reportError(error)) return;
    setMeetings((p) => p.filter((x) => x.id !== rootId && x.recurrence_parent_id !== rootId));
  }
  async function setMyRsvp(meetingId, statut) {
    if (!profile.member_id) return;
    const { error } = await supabase.from("meeting_rsvps").upsert(
      { meeting_id: meetingId, association_id: profile.association_id, member_id: profile.member_id, statut, updated_at: new Date().toISOString() },
      { onConflict: "meeting_id,member_id" }
    );
    if (reportError(error)) return;
    setRsvps((prev) => {
      const others = prev.filter((r) => !(r.meeting_id === meetingId && r.member_id === profile.member_id));
      return [...others, { meeting_id: meetingId, association_id: profile.association_id, member_id: profile.member_id, statut }];
    });
  }
  async function markPresent(meetingId, memberId, present) {
    const statut = present ? "present" : "confirme";
    const { error } = await supabase.from("meeting_rsvps").upsert(
      { meeting_id: meetingId, association_id: profile.association_id, member_id: memberId, statut, updated_at: new Date().toISOString() },
      { onConflict: "meeting_id,member_id" }
    );
    if (reportError(error)) return;
    setRsvps((prev) => {
      const others = prev.filter((r) => !(r.meeting_id === meetingId && r.member_id === memberId));
      return [...others, { meeting_id: meetingId, association_id: profile.association_id, member_id: memberId, statut }];
    });
  }
  async function uploadMeetingDoc(meeting, slot, file) {
    if (!file) return;
    setSavingUpload(true);
    const rubrique = slot === "ordre_jour" ? "ordre_du_jour_reunion" : "pv_reunion";
    const path = `${profile.association_id}/${Date.now()}_${safeFileName(file.name)}`;
    const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
    if (upErr) { setSavingUpload(false); reportError(upErr); return; }
    const { data, error } = await supabase.from("documents").insert({
      association_id: profile.association_id, nom: `${meeting.titre} — ${file.name}`, storage_path: path, rubrique, uploaded_by: profile.id,
    }).select().single();
    setSavingUpload(false);
    if (reportError(error)) return;
    setDocs((p) => [...p, data]);
    const field = slot === "ordre_jour" ? "doc_ordre_jour_id" : "doc_pv_id";
    await updateMeeting(meeting.id, { [field]: data.id });
  }
  async function viewDoc(docId) {
    const doc = docFor(docId);
    if (!doc) return;
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60);
    if (!error && data) window.open(data.signedUrl, "_blank");
  }

  // ---------- Transcription ----------
  function draftFor(m) { return transcriptDrafts[m.id] ?? (m.transcription_text || ""); }
  function setDraft(meetingId, text) { setTranscriptDrafts((p) => ({ ...p, [meetingId]: text })); }
  function startRecording(m) {
    const SR = getSpeechRecognitionCtor();
    if (!SR) return;
    recognitionRef.current?.stop();
    const rec = new SR();
    rec.lang = lang === "en" ? "en-US" : "fr-FR";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      let chunk = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) chunk += ev.results[i][0].transcript + " ";
      }
      if (chunk) setTranscriptDrafts((p) => ({ ...p, [m.id]: (p[m.id] ?? (m.transcription_text || "")) + chunk }));
    };
    rec.onerror = () => setRecordingId(null);
    rec.onend = () => setRecordingId((cur) => (cur === m.id ? null : cur));
    recognitionRef.current = rec;
    rec.start();
    setRecordingId(m.id);
  }
  function stopRecording() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecordingId(null);
  }
  async function saveTranscription(meetingId) {
    await updateMeeting(meetingId, { transcription_text: transcriptDrafts[meetingId] ?? "" });
  }
  async function transcriptionToPv(meeting) {
    const text = draftFor(meeting);
    if (!text || !text.trim()) return;
    const file = new File([text], `PV_${slugify(meeting.titre)}.txt`, { type: "text/plain" });
    await saveTranscription(meeting.id);
    await uploadMeetingDoc(meeting, "pv", file);
  }

  // ---------- Export PDF de la feuille de présence ----------
  async function exportAttendancePdf(m) {
    const [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const { jsPDF } = jsPDFmod;
    const autoTable = autoTableMod.default || autoTableMod;
    const doc = new jsPDF({ unit: "pt", format: "letter" });
  // Logo + mentions légales (pdfOfficiel.js) — demande de l'utilisateur
    // (2026-10-09) : sur tous les documents générés, pour leur authenticité.
    const yDebut = await enTeteOfficiel(doc, association, { titre: t("reu_pdf_title"), sousTitre: `${m.titre} - ${formatDateTime(m.date_heure, lang)}` });

    const mr = meetingRsvps(m.id);
    const rows = mr.map((r) => [memberNom(r.member_id), t("reu_statut_" + r.statut)]);
    autoTable(doc, {
      startY: yDebut,
      head: [[t("reu_pdf_col_name"), t("reu_pdf_col_status")]],
      body: rows.length ? rows : [[t("reu_attendees_empty"), ""]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: couleurAssociation(association) },
    });
    let y = (doc.lastAutoTable?.finalY || yDebut) + 20;
    const present = mr.filter((r) => r.statut === "present").length;
    const confirmedCount = mr.filter((r) => r.statut === "confirme" || r.statut === "present").length;
    doc.setFontSize(9);
    doc.text(`${t("reu_attendees_count").replace("{n}", confirmedCount)} — ${t("reu_present_yes")} : ${present}`, 40, y);
    y += 16;
    const q = quorumInfo(m);
    if (q) {
      doc.text((q.reached ? t("reu_quorum_reached") : t("reu_quorum_not_reached")).replace("{pct}", q.pct).replace("{req}", q.required), 40, y);
      y += 16;
    }
    doc.setFontSize(8); doc.setTextColor(140, 140, 140);
    doc.text(t("reu_pdf_generated_on").replace("{date}", new Date().toLocaleString(lang === "en" ? "en-CA" : "fr-CA")), 40, y);
    piedsDePageOfficiels(doc, association, { texte: t("reu_pdf_title") });
    doc.save(`presence_${slugify(m.titre)}.pdf`);
  }

  if (loading) return <Container><Section><p style={{ color: "#686F7D" }}>{t("loading")}</p></Section></Container>;

  return (
    <Container>
      <Section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><Video size={22} color="var(--primary)" /> {t("nav_meetings")}</h2>
            <p style={{ color: "#686F7D", fontSize: 13.5, maxWidth: 580, margin: 0 }}>{t("reu_intro")}</p>
          </div>
          {isBureau && <Btn onClick={() => setShowCreate(true)}><Plus size={14} /> {t("reu_new_btn")}</Btn>}
        </div>

        {errorMsg && <p style={{ color: RED, fontSize: 13, marginBottom: 14 }}>{errorMsg}</p>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 20 }}>
          <StatCard label={t("reu_stat_month")} value={thisMonthCount} icon={Calendar} />
          <StatCard label={t("reu_stat_attendance")} value={avgAttendanceRate == null ? "—" : `${avgAttendanceRate}%`} icon={CheckCircle2} accent={TEAL} />
          <StatCard label={t("reu_stat_cumulative")} value={cumulativeAttendees} icon={Users} />
        </div>

        <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#9AA2B5", marginBottom: 10 }}>{t("reu_upcoming_title")}</h3>
        {upcoming.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13, marginBottom: 20 }}>{t("reu_upcoming_empty")}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
          {upcoming.map((m) => (
            <MeetingCard key={m.id} m={m} t={t} lang={lang} isBureau={isBureau} profile={profile}
              rsvps={meetingRsvps(m.id)} myRsvp={myRsvp(m.id)} members={members} memberNom={memberNom}
              docFor={docFor} onView={viewDoc} savingUpload={savingUpload}
              attendeesOpen={attendeesOpenId === m.id} onToggleAttendees={() => setAttendeesOpenId((id) => (id === m.id ? null : m.id))}
              onRsvp={(s) => setMyRsvp(m.id, s)} onMarkPresent={(memberId, p) => markPresent(m.id, memberId, p)}
              onUpload={(slot, file) => uploadMeetingDoc(m, slot, file)}
              onEdit={() => setEditingMeeting(m)} onDelete={() => deleteMeeting(m.id)}
              onCancel={() => updateMeeting(m.id, { statut: "annulee" })}
              quorum={quorumInfo(m)} onExportPdf={() => exportAttendancePdf(m)}
              onDeleteSeries={() => deleteSeries(m)}
              speechSupported={speechSupported}
              transcriptionOpen={transcriptionOpenId === m.id}
              onToggleTranscription={() => setTranscriptionOpenId((id) => (id === m.id ? null : m.id))}
              recording={recordingId === m.id}
              draft={draftFor(m)} onDraftChange={(txt) => setDraft(m.id, txt)}
              onStartRecording={() => startRecording(m)} onStopRecording={stopRecording}
              onSaveTranscription={() => saveTranscription(m.id)} onUseAsPv={() => transcriptionToPv(m)}
            />
          ))}
        </div>

        <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#9AA2B5", marginBottom: 10 }}>{t("reu_past_title")}</h3>
        {past.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{t("reu_past_empty")}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {past.slice().reverse().map((m) => {
            const mr = meetingRsvps(m.id);
            const invited = mr.filter((r) => r.statut === "confirme" || r.statut === "present").length;
            const present = mr.filter((r) => r.statut === "present").length;
            const rate = invited > 0 ? Math.round((present / invited) * 100) : null;
            const q = quorumInfo(m);
            return (
              <Card key={m.id} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{m.titre}</div>
                    <div style={{ fontSize: 11.5, color: "#8A8F98" }}>{formatDateTime(m.date_heure, lang)}</div>
                    {q && (
                      <div style={{ marginTop: 4 }}>
                        <Pill color={q.reached ? TEAL : RED} bg={q.reached ? TEAL_LIGHT : "#FCEAEA"}>
                          <Percent size={10} style={{ marginRight: 3 }} />
                          {(q.reached ? t("reu_quorum_reached") : t("reu_quorum_not_reached")).replace("{pct}", q.pct).replace("{req}", q.required)}
                        </Pill>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    {m.doc_pv_id ? <button onClick={() => viewDoc(m.doc_pv_id)} style={linkBtn("var(--primary)")}><FileText size={12} /> {t("reu_pv_link")}</button> : isBureau && (
                      <label style={{ ...linkBtn("var(--primary)"), cursor: savingUpload ? "not-allowed" : "pointer" }}>
                        <Upload size={12} /> {t("reu_pv_upload")}
                        <input type="file" style={{ display: "none" }} disabled={savingUpload} onChange={(e) => uploadMeetingDoc(m, "pv", e.target.files?.[0])} />
                      </label>
                    )}
                    <button onClick={() => exportAttendancePdf(m)} style={linkBtn("#5B6270")}><FileDown size={12} /> {t("reu_export_pdf_btn")}</button>
                    {rate != null && <span style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 13, color: TEAL }}>{rate}%</span>}
                    {isBureau && (
                      <>
                        {m.recurrence_regle !== "aucune" && <button onClick={() => deleteSeries(m)} title={t("reu_delete_series_btn")} style={linkBtn(AMBER)}><Repeat size={11} /></button>}
                        <button onClick={() => setEditingMeeting(m)} style={linkBtn("var(--primary)")}><Pencil size={11} /></button>
                        <button onClick={() => deleteMeeting(m.id)} style={linkBtn(RED)}><Trash2 size={11} /></button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </Section>

      {showCreate && (
        <CreateMeetingModal t={t} association={association} onClose={() => setShowCreate(false)}
          onCreate={async (f) => { if (await createMeeting(f)) setShowCreate(false); }}
        />
      )}
      {editingMeeting && (
        <EditMeetingModal t={t} meeting={editingMeeting} onClose={() => setEditingMeeting(null)}
          onSave={async (patch) => { await updateMeeting(editingMeeting.id, patch); setEditingMeeting(null); }}
        />
      )}
    </Container>
  );
}

function linkBtn(color) {
  return { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color, background: "none", border: "none", cursor: "pointer", padding: 0 };
}

function MeetingCard({
  m, t, lang, isBureau, profile, rsvps, myRsvp, memberNom, onView, savingUpload,
  attendeesOpen, onToggleAttendees, onRsvp, onMarkPresent, onUpload, onEdit, onDelete, onCancel,
  quorum, onExportPdf, onDeleteSeries,
  speechSupported, transcriptionOpen, onToggleTranscription, recording, draft, onDraftChange,
  onStartRecording, onStopRecording, onSaveTranscription, onUseAsPv,
}) {
  const confirmed = rsvps.filter((r) => r.statut === "confirme" || r.statut === "present");
  return (
    <Card style={{ borderTopColor: TYPE_COLORS[m.type_reunion] || "var(--primary)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "#182233" }}>{m.titre}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "#5B6270", margin: "6px 0" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={12} /> {formatDateTime(m.date_heure, lang)}</span>
            <Pill color={TYPE_COLORS[m.type_reunion] || "var(--primary)"} bg="#F1F2F4">{t("reu_type_" + m.type_reunion)}</Pill>
            {m.recurrence_regle !== "aucune" && <Pill color={AMBER} bg={AMBER_LIGHT}><Repeat size={11} style={{ marginRight: 3 }} />{t("reu_recurrence_" + m.recurrence_regle)}</Pill>}
            {quorum && (
              <Pill color={quorum.reached ? TEAL : RED} bg={quorum.reached ? TEAL_LIGHT : "#FCEAEA"}>
                <Percent size={10} style={{ marginRight: 3 }} />
                {(quorum.reached ? t("reu_quorum_reached") : t("reu_quorum_not_reached")).replace("{pct}", quorum.pct).replace("{req}", quorum.required)}
              </Pill>
            )}
          </div>
          {m.doc_ordre_jour_id && <button onClick={() => onView(m.doc_ordre_jour_id)} style={linkBtn("var(--primary)")}><FileText size={12} /> {t("reu_agenda_link")}</button>}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={onToggleAttendees} style={linkBtn("#5B6270")}><Users size={12} /> {t("reu_attendees_count").replace("{n}", confirmed.length)}</button>
            <button onClick={onExportPdf} style={linkBtn("#5B6270")}><FileDown size={12} /> {t("reu_export_pdf_btn")}</button>
            {isBureau && <button onClick={onToggleTranscription} style={linkBtn(TEAL)}><Mic size={12} /> {t("reu_transcription_btn")}</button>}
          </div>
          {attendeesOpen && (
            <div style={{ marginTop: 8, background: "#F8F7F4", borderRadius: 8, padding: 10, fontSize: 12 }}>
              {confirmed.length === 0 && <span style={{ color: "#8A8F98", fontStyle: "italic" }}>{t("reu_attendees_empty")}</span>}
              {confirmed.map((r) => (
                <div key={r.member_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                  <span>{memberNom(r.member_id)}</span>
                  {isBureau && (
                    <button onClick={() => onMarkPresent(r.member_id, r.statut !== "present")} style={linkBtn(r.statut === "present" ? TEAL : "#8A8F98")}>
                      {r.statut === "present" ? t("reu_present_yes") : t("reu_present_mark")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {transcriptionOpen && isBureau && (
            <div style={{ marginTop: 10, background: "#F8F7F4", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#182233", marginBottom: 6 }}>{t("reu_transcription_title")}</div>
              {!speechSupported && <p style={{ fontSize: 11.5, color: AMBER, marginBottom: 8 }}>{t("reu_transcription_unsupported")}</p>}
              <textarea
                style={{ ...inputStyle, minHeight: 110, width: "100%", fontFamily: "inherit" }}
                value={draft} onChange={(e) => onDraftChange(e.target.value)}
                placeholder={t("reu_transcription_placeholder")}
              />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                {speechSupported && (
                  recording ? (
                    <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12, color: RED, borderColor: RED }} onClick={onStopRecording}><Square size={12} /> {t("reu_transcription_stop")}</Btn>
                  ) : (
                    <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={onStartRecording}><Mic size={12} /> {t("reu_transcription_start")}</Btn>
                  )
                )}
                {recording && <span style={{ fontSize: 11, color: RED, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>● {t("reu_transcription_recording")}</span>}
                <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={onSaveTranscription}><Save size={12} /> {t("reu_transcription_save_btn")}</Btn>
                {!m.doc_pv_id && <Btn style={{ padding: "6px 12px", fontSize: 12 }} onClick={onUseAsPv}><FileSignature size={12} /> {t("reu_transcription_use_as_pv_btn")}</Btn>}
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", flexShrink: 0 }}>
          {m.lien_visio && (
            <a href={m.lien_visio} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--accent)", color: "var(--primary-dark)", fontWeight: 700, fontSize: 12.5, borderRadius: 999, padding: "8px 16px", textDecoration: "none" }}>
              <ExternalLink size={13} /> {t("reu_join_btn")}
            </a>
          )}
          {profile.member_id && (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => onRsvp("confirme")} style={{ ...linkBtn(myRsvp?.statut === "confirme" || myRsvp?.statut === "present" ? TEAL : "#8A8F98") }}><CheckCircle2 size={13} /> {t("reu_rsvp_yes")}</button>
              <button onClick={() => onRsvp("decline")} style={{ ...linkBtn(myRsvp?.statut === "decline" ? RED : "#8A8F98") }}><XCircle size={13} /> {t("reu_rsvp_no")}</button>
            </div>
          )}
          {isBureau && (
            <div style={{ display: "flex", gap: 8 }}>
              {m.recurrence_regle !== "aucune" && <button onClick={onDeleteSeries} title={t("reu_delete_series_btn")} style={linkBtn(AMBER)}><Repeat size={11} /></button>}
              <button onClick={onEdit} style={linkBtn("var(--primary)")}><Pencil size={11} /></button>
              <button onClick={onCancel} style={linkBtn(AMBER)}>{t("reu_cancel_btn")}</button>
              <button onClick={onDelete} style={linkBtn(RED)}><Trash2 size={11} /></button>
            </div>
          )}
          {isBureau && !m.doc_ordre_jour_id && (
            <label style={{ ...linkBtn("var(--primary)"), cursor: savingUpload ? "not-allowed" : "pointer" }}>
              <Upload size={11} /> {t("reu_agenda_upload")}
              <input type="file" style={{ display: "none" }} disabled={savingUpload} onChange={(e) => onUpload("ordre_jour", e.target.files?.[0])} />
            </label>
          )}
        </div>
      </div>
    </Card>
  );
}

function CreateMeetingModal({ t, association, onClose, onCreate }) {
  const [form, setForm] = useState({
    titre: "", type_reunion: "conseil", date_heure: "", lien_visio: "", notes: "",
    rappel_heures_avant: 2, recurrence_regle: "aucune", occurrences: 6, quorum: 50,
  });
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!form.titre.trim() || !form.date_heure) return;
    setSaving(true);
    await onCreate(form);
    setSaving(false);
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ marginBottom: 14 }}>{t("reu_new_btn")}</h3>
        <Field label={t("reu_field_title")}><input style={inputStyle} value={form.titre} onChange={(e) => setForm((p) => ({ ...p, titre: e.target.value }))} /></Field>
        <Field label={t("reu_field_type")}>
          <select style={inputStyle} value={form.type_reunion} onChange={(e) => setForm((p) => ({ ...p, type_reunion: e.target.value }))}>
            <option value="conseil">{t("reu_type_conseil")}</option>
            <option value="assemblee_generale">{t("reu_type_assemblee_generale")}</option>
            <option value="comite">{t("reu_type_comite")}</option>
            <option value="webinaire_public">{t("reu_type_webinaire_public")}</option>
          </select>
        </Field>
        <Field label={t("reu_field_datetime")}><input type="datetime-local" style={inputStyle} value={form.date_heure} onChange={(e) => setForm((p) => ({ ...p, date_heure: e.target.value }))} /></Field>
        <Field label={t("reu_field_link")}>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={inputStyle} value={form.lien_visio} onChange={(e) => setForm((p) => ({ ...p, lien_visio: e.target.value }))} placeholder="https://meet.jit.si/..." />
            <Btn variant="outline" style={{ whiteSpace: "nowrap" }} onClick={() => setForm((p) => ({ ...p, lien_visio: generateJitsiRoom(association) }))}><Link2 size={13} /> {t("reu_generate_link")}</Btn>
          </div>
          <p style={{ fontSize: 11, color: "#8A8F98", marginTop: 4 }}>{t("reu_field_link_hint")}</p>
        </Field>
        <Field label={t("reu_field_rappel_heures")}>
          <input type="number" min="1" max="168" style={inputStyle} value={form.rappel_heures_avant} onChange={(e) => setForm((p) => ({ ...p, rappel_heures_avant: e.target.value }))} />
          <p style={{ fontSize: 11, color: "#8A8F98", marginTop: 4 }}>{t("reu_field_rappel_help")}</p>
        </Field>
        <Field label={t("reu_field_recurrence")}>
          <select style={inputStyle} value={form.recurrence_regle} onChange={(e) => setForm((p) => ({ ...p, recurrence_regle: e.target.value }))}>
            <option value="aucune">{t("reu_recurrence_aucune")}</option>
            <option value="hebdomadaire">{t("reu_recurrence_hebdomadaire")}</option>
            <option value="mensuel">{t("reu_recurrence_mensuel")}</option>
          </select>
        </Field>
        {form.recurrence_regle !== "aucune" && (
          <Field label={t("reu_field_occurrences")}>
            <input type="number" min="2" max="24" style={inputStyle} value={form.occurrences} onChange={(e) => setForm((p) => ({ ...p, occurrences: e.target.value }))} />
            <p style={{ fontSize: 11, color: "#8A8F98", marginTop: 4 }}>{t("reu_field_occurrences_help")}</p>
          </Field>
        )}
        {form.type_reunion === "assemblee_generale" && (
          <Field label={t("reu_field_quorum")}>
            <input type="number" min="1" max="100" style={inputStyle} value={form.quorum} onChange={(e) => setForm((p) => ({ ...p, quorum: e.target.value }))} />
            <p style={{ fontSize: 11, color: "#8A8F98", marginTop: 4 }}>{t("reu_field_quorum_help")}</p>
          </Field>
        )}
        <Field label={t("reu_field_notes")}><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
          <Btn onClick={submit} disabled={saving}>{saving ? t("loading") : t("action_publish")}</Btn>
        </div>
      </div>
    </div>
  );
}

function EditMeetingModal({ t, meeting, onClose, onSave }) {
  const [form, setForm] = useState({
    titre: meeting.titre, date_heure: toDatetimeLocal(meeting.date_heure),
    lien_visio: meeting.lien_visio || "", notes: meeting.notes || "",
    rappel_heures_avant: meeting.rappel_heures_avant || 2,
    quorum: meeting.quorum_requis_pourcentage ?? "",
  });
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ marginBottom: 14 }}>{t("action_edit")}</h3>
        <Field label={t("reu_field_title")}><input style={inputStyle} value={form.titre} onChange={(e) => setForm((p) => ({ ...p, titre: e.target.value }))} /></Field>
        <Field label={t("reu_field_datetime")}><input type="datetime-local" style={inputStyle} value={form.date_heure} onChange={(e) => setForm((p) => ({ ...p, date_heure: e.target.value }))} /></Field>
        <Field label={t("reu_field_link")}><input style={inputStyle} value={form.lien_visio} onChange={(e) => setForm((p) => ({ ...p, lien_visio: e.target.value }))} /></Field>
        <Field label={t("reu_field_rappel_heures")}><input type="number" min="1" max="168" style={inputStyle} value={form.rappel_heures_avant} onChange={(e) => setForm((p) => ({ ...p, rappel_heures_avant: e.target.value }))} /></Field>
        {meeting.type_reunion === "assemblee_generale" && (
          <Field label={t("reu_field_quorum")}><input type="number" min="1" max="100" style={inputStyle} value={form.quorum} onChange={(e) => setForm((p) => ({ ...p, quorum: e.target.value }))} /></Field>
        )}
        <Field label={t("reu_field_notes")}><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
          <Btn variant="outline" onClick={onClose}>{t("action_cancel")}</Btn>
          <Btn onClick={() => onSave({
            titre: form.titre.trim(), date_heure: datetimeLocalToISO(form.date_heure), lien_visio: form.lien_visio.trim() || null, notes: form.notes.trim() || null,
            rappel_heures_avant: Math.max(1, Number(form.rappel_heures_avant) || 2),
            ...(meeting.type_reunion === "assemblee_generale" ? { quorum_requis_pourcentage: form.quorum === "" ? null : Number(form.quorum) } : {}),
          })}>{t("action_save")}</Btn>
        </div>
      </div>
    </div>
  );
}
