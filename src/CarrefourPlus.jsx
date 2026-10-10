// =====================================================================
// CarrefourPlus.jsx — compléments du Carrefour du savoir (2026-10-10)
// =====================================================================
// Demandés par l'utilisateur (« exécuter les 5 points à la fois » et
// « organiser encore plus et ranger » Mon espace) :
//   • Mon espace : onglet rangé par rubriques (documents officiels,
//     compétences, parcours, classes, favoris, historique, questions,
//     préférences), une seule attestation de bénévolat cumulée ;
//   • quiz de validation des étapes (passage et édition) ;
//   • supports de cours des classes ;
//   • pilotage : modération des signalements, statistiques par ressource,
//     suivi des mentorats.
// Base : sql/2026-10-10n_carrefour_complements.sql.
// =====================================================================
import { useState, useEffect } from "react";
import {
  Award, BookOpen, Route, School, Star, Clock, Calendar, MessageCircleQuestion, Settings2, CheckCircle2, Download,
  FileText, Plus, Trash2, ExternalLink, Flag, EyeOff, BarChart3, Briefcase, Video,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { Card, Btn, Field, inputStyle, friendlyError, formatEventDateTime, TEAL, TEAL_LIGHT, RED } from "./shared";
import { exporterAttestation } from "./jeunessePdf";
import { telechargerIcs, ouvrirFichier } from "./carrefourOutils";

const AMBER = "#B7791F";
const GREY = "#686F7D";
const DOM_COULEUR = { academique: "#2B6CB0", professionnel: "#1F8A5C", personnel: "#9C4221", vie_pratique: "#6B46C1" };
const DOMAINES = ["academique", "professionnel", "personnel", "vie_pratique"];
const PUBLICS = ["eleves", "etudiants", "universitaires", "travailleurs", "chercheurs_emploi", "entrepreneurs", "parents", "aines", "nouveaux_arrivants"];
const small = { padding: "6px 12px", fontSize: 12.5 };
const muted = { fontSize: 12.5, color: GREY, margin: 0 };
const linkBtn = (color) => ({ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color, background: "none", border: "none", cursor: "pointer", padding: 0 });
const chip = (on, color = "var(--primary)") => ({ fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: on ? "1px solid transparent" : "1px solid #DCE0E8", background: on ? color : "white", color: on ? "white" : "#4A5468" });
const heures = (min) => Math.round((min / 60) * 10) / 10;
const signataire = (a) => (a?.signataire1_nom ? { nom: a.signataire1_nom, titre: a.signataire1_titre || "" } : null);

function Tuile({ icon: Icon, label, value, color }) {
  return (
    <div style={{ background: "white", borderRadius: 12, padding: "12px 14px", boxShadow: "0 2px 10px rgba(31,56,100,0.06)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: GREY, textTransform: "uppercase", letterSpacing: ".04em", display: "flex", gap: 5, alignItems: "center" }}><Icon size={12} /> {label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, color: color || "var(--primary)" }}>{value}</div>
    </div>
  );
}
function Rubrique({ icon: Icon, titre, n, children, action }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14, display: "flex", gap: 7, alignItems: "center" }}><Icon size={16} color="var(--primary)" /> {titre}{n > 0 && <span style={{ fontSize: 11, color: GREY, fontWeight: 600 }}>· {n}</span>}</div>
        {action}
      </div>
      {children}
    </Card>
  );
}
function Vide({ texte, bouton, onClick }) {
  return (
    <div style={{ textAlign: "center", padding: "10px 6px" }}>
      <p style={{ ...muted, fontStyle: "italic", marginBottom: bouton ? 8 : 0 }}>{texte}</p>
      {bouton && <Btn variant="outline" style={small} onClick={onClick}>{bouton}</Btn>}
    </div>
  );
}
function Ligne({ children }) { return <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid #EEF0F3", flexWrap: "wrap" }}>{children}</div>; }

// =====================================================================
// Mon espace
// =====================================================================
// benevoles : lignes de heuresBenevoles() concernant le membre connecté.
export function MonEspaceTab({ S, t, lang, profile, association, d, publiees, favIds, faits, benevoles, prefs, onSavePrefs, onOpen, goTab }) {
  const [p, setP] = useState(prefs);
  const [msg, setMsg] = useState("");
  useEffect(() => { setP(prefs); }, [prefs]);
  const loc = lang === "en" ? "en-CA" : "fr-CA";

  const parcours = d.parcours.filter((x) => x.statut === "publie").map((x) => {
    const ids = d.etapes.filter((e) => e.parcours_id === x.id).map((e) => e.id);
    return { p: x, n: ids.filter((id) => faits.has(id)).length, total: ids.length };
  });
  const enCours = parcours.filter((x) => x.n > 0 && x.n < x.total);
  const finis = parcours.filter((x) => x.total > 0 && x.n === x.total);
  const mesInscr = d.inscriptions.filter((i) => i.profile_id === profile.id && i.statut !== "retire");
  const mesClasses = mesInscr.map((i) => ({ i, c: d.classes.find((c) => c.id === i.classe_id) })).filter((x) => x.c);
  const seancesAVenir = d.seances.filter((s) => s.statut === "prevue" && new Date(s.debut) > new Date() && mesInscr.some((i) => i.classe_id === s.classe_id && i.statut === "inscrit"));
  const attestationsCls = mesClasses.map(({ c }) => {
    const realisees = d.seances.filter((s) => s.classe_id === c.id && s.statut === "realisee");
    const presentes = realisees.filter((s) => d.presences.some((x) => x.seance_id === s.id && x.profile_id === profile.id && x.present));
    return { c, realisees, presentes };
  }).filter((x) => x.presentes.length > 0);
  const totalMin = benevoles.reduce((a, v) => a + v.minutes, 0);
  const favoris = publiees.filter((r) => favIds.has(r.id));
  const recents = [...new Map(d.consultations.map((c) => [c.ressource_id, c])).values()]
    .map((c) => ({ c, r: publiees.find((r) => r.id === c.ressource_id) })).filter((x) => x.r).slice(0, 8);
  const mesQuestions = d.questions.filter((q) => q.auteur_id === profile.id);
  const nbDocs = (totalMin > 0 ? 1 : 0) + finis.length + attestationsCls.length;

  function attBenevolat() {
    const parts = benevoles.map((v) => `${heures(v.minutes)} h de ${v.role === "mentor" ? S.role_tutorat : S.role_classes} (${v.nb} séance(s))`);
    const depuis = benevoles.map((v) => v.depuis).filter(Boolean).sort()[0];
    exporterAttestation({
      titre: S.att_ben_title, intro: S.att_ben_intro, nom: profile.nom_complet || "", intitule: S.att_ben_line,
      lignes: [`${heures(totalMin)} h de bénévolat au total${depuis ? ` depuis ${new Date(depuis).toLocaleDateString(loc, { month: "long", year: "numeric" })}` : ""}`, parts.join(" - ")],
      signataire: signataire(association), association, lang, reference: `V-${new Date().getFullYear()}-${String(profile.id).slice(0, 6).toUpperCase()}`, fileName: "attestation_benevolat.pdf",
    }).catch((e) => alert(friendlyError(e, t)));
  }
  function attParcours(x) {
    exporterAttestation({
      titre: S.att_par_title, intro: S.att_par_intro, nom: profile.nom_complet || "", intitule: `${S.att_par_line} « ${x.p.titre} »`,
      lignes: [`${S["dom_" + x.p.domaine]} - ${S["niv_" + x.p.niveau]} - ${x.total} ${S.par_steps.toLowerCase()}`],
      signataire: signataire(association), association, lang, reference: `P-${String(x.p.id).slice(0, 8).toUpperCase()}`, fileName: "certificat_parcours.pdf",
    }).catch((e) => alert(friendlyError(e, t)));
  }
  function attClasse(x) {
    const min = x.presentes.reduce((a, s) => a + s.duree_min, 0);
    exporterAttestation({
      titre: S.att_cls_title, intro: S.att_cls_intro, nom: profile.nom_complet || "", intitule: `${S.att_cls_line} « ${x.c.titre} »`,
      lignes: [S.att_cls_detail.replace("{p}", x.presentes.length).replace("{t}", x.realisees.length).replace("{h}", heures(min)), x.c.animateur_nom ? S.cls_by.replace("{nom}", x.c.animateur_nom) : ""],
      signataire: signataire(association), association, lang, reference: `C-${String(x.c.id).slice(0, 8).toUpperCase()}`, fileName: "attestation_classe.pdf",
    }).catch((e) => alert(friendlyError(e, t)));
  }
  const toggle = (k, v) => setP((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <Tuile icon={Star} label={S.k_favs} value={favoris.length} />
        <Tuile icon={Route} label={S.k_cours} value={enCours.length} />
        <Tuile icon={CheckCircle2} label={S.k_finis} value={finis.length} color={TEAL} />
        <Tuile icon={School} label={S.k_cls} value={mesClasses.length} />
        <Tuile icon={Clock} label={S.k_hben} value={`${heures(totalMin)} h`} />
        <Tuile icon={Award} label={S.k_docs} value={nbDocs} color={AMBER} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 14, alignItems: "start" }}>
        <Rubrique icon={Award} titre={S.me_docs} n={nbDocs}>
          {nbDocs === 0 && <Vide texte={S.me_docs_vide} />}
          {totalMin > 0 && (
            <Ligne>
              <FileText size={18} color={AMBER} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{S.doc_ben}</div>
                <div style={{ fontSize: 11.5, color: GREY }}>{S.doc_ben_sub.replace("{h}", heures(totalMin)).replace("{d}", benevoles.length > 1 ? ` (${benevoles.map((v) => `${v.role === "mentor" ? S.role_tutorat : S.role_classes} ${heures(v.minutes)} h`).join(" · ")})` : "")}</div>
              </div>
              <Btn variant="outline" style={small} onClick={attBenevolat}><Download size={13} /> {S.download}</Btn>
            </Ligne>
          )}
          {finis.map((x) => (
            <Ligne key={x.p.id}>
              <FileText size={18} color={DOM_COULEUR[x.p.domaine]} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13.5 }}>{S.doc_par}</div><div style={{ fontSize: 11.5, color: GREY }}>{x.p.titre}</div></div>
              <Btn variant="outline" style={small} onClick={() => attParcours(x)}><Download size={13} /> {S.download}</Btn>
            </Ligne>
          ))}
          {attestationsCls.map((x) => (
            <Ligne key={x.c.id}>
              <FileText size={18} color={DOM_COULEUR[x.c.domaine]} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13.5 }}>{S.doc_cls}</div><div style={{ fontSize: 11.5, color: GREY }}>{x.c.titre} · {x.presentes.length}/{x.realisees.length}</div></div>
              <Btn variant="outline" style={small} onClick={() => attClasse(x)}><Download size={13} /> {S.download}</Btn>
            </Ligne>
          ))}
        </Rubrique>

        <Rubrique icon={CheckCircle2} titre={S.me_skills} n={finis.length}>
          {finis.length === 0 ? <Vide texte={S.me_skills_vide} bouton={S.see_paths} onClick={() => goTab("parcours")} /> : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {finis.map((x) => <span key={x.p.id} style={{ fontSize: 12.5, fontWeight: 700, color: "white", background: DOM_COULEUR[x.p.domaine], borderRadius: 999, padding: "6px 12px" }}>✓ {x.p.titre}</span>)}
            </div>
          )}
        </Rubrique>

        <Rubrique icon={Route} titre={S.me_paths} n={enCours.length}>
          {enCours.length === 0 ? <Vide texte={S.me_paths_vide} bouton={S.see_paths} onClick={() => goTab("parcours")} /> : enCours.map((x) => (
            <Ligne key={x.p.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{x.p.titre}</div>
                <div style={{ height: 6, background: "#EEF0F3", borderRadius: 999, marginTop: 5 }}><div style={{ width: `${(x.n / x.total) * 100}%`, height: "100%", background: "var(--primary)", borderRadius: 999 }} /></div>
                <div style={{ fontSize: 11, color: GREY, marginTop: 3 }}>{S.par_progress.replace("{a}", x.n).replace("{b}", x.total)}</div>
              </div>
              <Btn variant="outline" style={small} onClick={() => goTab("parcours")}>{S.resume} →</Btn>
            </Ligne>
          ))}
        </Rubrique>

        <Rubrique icon={School} titre={S.me_classes} n={mesClasses.length}
          action={seancesAVenir.length > 0 && <button style={linkBtn(TEAL)} onClick={() => telechargerIcs(seancesAVenir.map((s) => { const c = d.classes.find((x) => x.id === s.classe_id); return { id: s.id, debut: s.debut, duree_min: s.duree_min, titre: `${c?.titre || ""}${s.sujet ? ` — ${s.sujet}` : ""}`, lieu: c?.lieu, url: c?.lien_visio }; }), "mes_classes.ics")}><Calendar size={13} /> {S.ics_all}</button>}>
          {mesClasses.length === 0 ? <Vide texte={S.me_classes_vide} bouton={S.see_classes} onClick={() => goTab("classes")} /> : mesClasses.map(({ i, c }) => {
            const prochaine = d.seances.filter((s) => s.classe_id === c.id && s.statut === "prevue" && new Date(s.debut) > new Date())[0];
            return (
              <Ligne key={i.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.titre}</div>
                  <div style={{ fontSize: 11.5, color: GREY }}>{prochaine ? S.next.replace("{d}", formatEventDateTime(prochaine.debut, lang)) : S["st_" + c.statut]}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: i.statut === "attente" ? AMBER : TEAL, background: i.statut === "attente" ? "#FDF3E1" : TEAL_LIGHT, borderRadius: 999, padding: "2px 9px" }}>{i.statut === "attente" ? S.waitlist : S.registered}</span>
                {prochaine && c.lien_visio && i.statut === "inscrit" && <a href={c.lien_visio} target="_blank" rel="noreferrer" style={{ ...linkBtn(TEAL), textDecoration: "none" }}><Video size={13} /></a>}
              </Ligne>
            );
          })}
        </Rubrique>

        <Rubrique icon={Star} titre={S.me_favs} n={favoris.length}>
          {favoris.length === 0 ? <Vide texte={S.me_favs_vide} bouton={S.explore} onClick={() => goTab("ressources")} /> : favoris.map((r) => (
            <Ligne key={r.id}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: DOM_COULEUR[r.domaine], flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{r.titre}</div><div style={{ fontSize: 11, color: GREY }}>{S["dom_" + r.domaine]} · {S["type_" + r.type]}</div></div>
              <button style={linkBtn(TEAL)} onClick={() => onOpen(r)}><ExternalLink size={13} /> {S.res_open}</button>
            </Ligne>
          ))}
        </Rubrique>

        <Rubrique icon={Clock} titre={S.me_recent} n={recents.length}>
          {recents.length === 0 ? <Vide texte={S.me_recent_vide} bouton={S.explore} onClick={() => goTab("ressources")} /> : recents.map(({ c, r }) => (
            <Ligne key={r.id}>
              <BookOpen size={14} color={DOM_COULEUR[r.domaine]} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{r.titre}</div><div style={{ fontSize: 11, color: GREY }}>{formatEventDateTime(c.created_at, lang)}</div></div>
              <button style={linkBtn(TEAL)} onClick={() => onOpen(r)}><ExternalLink size={13} /></button>
            </Ligne>
          ))}
        </Rubrique>

        <Rubrique icon={MessageCircleQuestion} titre={S.me_questions} n={mesQuestions.length}>
          {mesQuestions.length === 0 ? <Vide texte={S.me_questions_vide} bouton={S.ask} onClick={() => goTab("questions")} /> : mesQuestions.map((q) => (
            <Ligne key={q.id}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, cursor: "pointer" }} onClick={() => goTab("questions")}>{q.titre}</div>
              <span style={{ fontSize: 11.5, color: GREY }}>{S.q_answers.replace("{n}", d.reponses.filter((r) => r.question_id === q.id).length)}</span>
              {q.resolue && <span style={{ fontSize: 11, fontWeight: 700, color: TEAL }}>✓ {S.q_solved}</span>}
            </Ligne>
          ))}
        </Rubrique>

        <Rubrique icon={Settings2} titre={S.me_prefs}>
          <div style={{ fontSize: 12, fontWeight: 700, color: GREY, marginBottom: 6 }}>{S.me_iam}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>{PUBLICS.map((x) => <button key={x} style={chip(p.publics.includes(x))} onClick={() => toggle("publics", x)}>{S["pub_" + x]}</button>)}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: GREY, marginBottom: 6 }}>{S.me_interests}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>{DOMAINES.map((x) => <button key={x} style={chip(p.domaines.includes(x), DOM_COULEUR[x])} onClick={() => toggle("domaines", x)}>{S["dom_" + x]}</button>)}</div>
          <label style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 12, alignItems: "flex-start" }}><input type="checkbox" style={{ marginTop: 3 }} checked={p.notifications} onChange={(e) => setP({ ...p, notifications: e.target.checked })} /> {S.me_notif}</label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Btn style={small} onClick={async () => { const ok = await onSavePrefs(p); if (ok) { setMsg(S.me_saved); setTimeout(() => setMsg(""), 2500); } }}>{S.me_save}</Btn>
            {msg && <span style={{ fontSize: 12, color: TEAL, fontWeight: 600 }}>{msg}</span>}
          </div>
        </Rubrique>
      </div>
    </div>
  );
}

// =====================================================================
// Quiz
// =====================================================================
export function QuizPasser({ S, t, etape, nb, onDone }) {
  const [ouvert, setOuvert] = useState(false);
  const [qs, setQs] = useState([]);
  const [rep, setRep] = useState({});
  const [res, setRes] = useState(null);
  async function ouvrir() {
    setOuvert(!ouvert); setRes(null); setRep({});
    if (!ouvert) {
      const { data, error } = await supabase.rpc("savoir_quiz", { p_etape_id: etape.id });
      if (error) { alert(friendlyError(error, t)); return; }
      setQs(data || []);
    }
  }
  async function valider() {
    const { data, error } = await supabase.rpc("savoir_valider_quiz", { p_etape_id: etape.id, p_reponses: qs.map((q) => (rep[q.id] ?? -1)) });
    if (error) { alert(friendlyError(error, t)); return; }
    setRes(data);
    if (data?.reussi) onDone();
  }
  return (
    <div style={{ marginTop: 6 }}>
      <button style={linkBtn(AMBER)} onClick={ouvrir}>📝 {S.quiz_take.replace("{n}", nb)}</button>
      {ouvert && (
        <div style={{ background: "#FDF8EE", borderRadius: 8, padding: 10, marginTop: 6 }}>
          {qs.map((q, i) => (
            <div key={q.id} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{i + 1}. {q.question}</div>
              {(q.choix || []).map((c, k) => (
                <label key={k} style={{ display: "flex", gap: 6, fontSize: 13, marginBottom: 2, cursor: "pointer" }}>
                  <input type="radio" name={`q-${q.id}`} checked={rep[q.id] === k} onChange={() => setRep({ ...rep, [q.id]: k })} /> {c}
                </label>
              ))}
            </div>
          ))}
          <Btn style={small} disabled={qs.length === 0 || qs.some((q) => rep[q.id] == null)} onClick={valider}>{S.quiz_submit}</Btn>
          {res && <p style={{ fontSize: 13, fontWeight: 700, color: res.reussi ? TEAL : RED, margin: "8px 0 0" }}>{(res.reussi ? S.quiz_ok : S.quiz_ko).replace("{s}", res.score).replace("{seuil}", res.seuil)}</p>}
        </div>
      )}
    </div>
  );
}

export function QuizEditor({ S, t, profile, etape, onChanged }) {
  const [ouvert, setOuvert] = useState(false);
  const [qs, setQs] = useState([]);
  const [f, setF] = useState({ question: "", choix: "", bonne: 0 });
  const [seuil, setSeuil] = useState(etape.quiz_seuil || 70);
  async function charger() {
    const { data, error } = await supabase.from("savoir_quiz_questions").select("*").eq("etape_id", etape.id).order("ordre");
    if (error) { alert(friendlyError(error, t)); return; }
    setQs(data || []);
  }
  async function ajouter() {
    const choix = f.choix.split("\n").map((x) => x.trim()).filter(Boolean);
    if (!f.question.trim() || choix.length < 2) return;
    const { error } = await supabase.from("savoir_quiz_questions").insert({ association_id: profile.association_id, etape_id: etape.id, ordre: qs.length + 1, question: f.question.trim(), choix, bonne_reponse: Math.min(Number(f.bonne) || 0, choix.length - 1) });
    if (error) { alert(friendlyError(error, t)); return; }
    setF({ question: "", choix: "", bonne: 0 }); charger(); onChanged();
  }
  async function supprimer(q) {
    const { error } = await supabase.from("savoir_quiz_questions").delete().eq("id", q.id);
    if (error) { alert(friendlyError(error, t)); return; }
    charger(); onChanged();
  }
  async function enregistrerSeuil() {
    const { error } = await supabase.from("savoir_parcours_etapes").update({ quiz_seuil: Math.min(100, Math.max(1, Number(seuil) || 70)) }).eq("id", etape.id);
    if (error) alert(friendlyError(error, t)); else onChanged();
  }
  const choix = f.choix.split("\n").map((x) => x.trim()).filter(Boolean);
  return (
    <div style={{ marginTop: 6 }}>
      <button style={linkBtn(GREY)} onClick={() => { setOuvert(!ouvert); if (!ouvert) charger(); }}>⚙️ {S.quiz_edit}</button>
      {ouvert && (
        <div style={{ background: "#F4F6FA", borderRadius: 8, padding: 10, marginTop: 6 }}>
          {qs.length === 0 && <p style={{ ...muted, marginBottom: 8 }}>{S.quiz_none}</p>}
          {qs.map((q, i) => (
            <div key={q.id} style={{ fontSize: 12.5, marginBottom: 6, display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}><b>{i + 1}. {q.question}</b><div style={{ color: GREY }}>{q.choix.map((c, k) => (k === q.bonne_reponse ? `✓ ${c}` : c)).join(" · ")}</div></div>
              <button style={linkBtn(RED)} onClick={() => supprimer(q)}><Trash2 size={13} /></button>
            </div>
          ))}
          <Field label={S.quiz_q}><input style={inputStyle} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} /></Field>
          <Field label={S.quiz_choices}><textarea style={{ ...inputStyle, minHeight: 60 }} value={f.choix} onChange={(e) => setF({ ...f, choix: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <Field label={S.quiz_good}><select style={{ ...inputStyle, width: 220 }} value={f.bonne} onChange={(e) => setF({ ...f, bonne: e.target.value })}>{choix.map((c, k) => <option key={k} value={k}>{c}</option>)}</select></Field>
            <div style={{ marginBottom: 14 }}><Btn style={small} disabled={!f.question.trim() || choix.length < 2} onClick={ajouter}><Plus size={13} /> {S.quiz_add}</Btn></div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <Field label={S.quiz_threshold}><input type="number" min={1} max={100} style={{ ...inputStyle, width: 100 }} value={seuil} onChange={(e) => setSeuil(e.target.value)} /></Field>
            <div style={{ marginBottom: 14 }}><Btn variant="outline" style={small} onClick={enregistrerSeuil}>OK</Btn></div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Supports de cours d'une classe
// =====================================================================
export function SupportsClasse({ S, t, lang, profile, classe, anime, supports, seances, onChanged }) {
  const [f, setF] = useState({ titre: "", seance_id: "", url: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const mes = supports.filter((x) => x.classe_id === classe.id);
  async function ajouter() {
    if (!f.titre.trim()) return;
    if (!f.url.trim() && !file) { alert(S.sup_need); return; }
    setBusy(true);
    try {
      let storage_path = null;
      if (file) {
        storage_path = `${profile.association_id}/supports/${classe.id}/${Date.now()}_${file.name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
        const { error } = await supabase.storage.from("savoir-ressources").upload(storage_path, file);
        if (error) throw error;
      }
      const { error } = await supabase.from("savoir_supports").insert({ association_id: profile.association_id, classe_id: classe.id, seance_id: f.seance_id || null, titre: f.titre.trim(), url: f.url.trim() || null, storage_path });
      if (error) throw error;
      setF({ titre: "", seance_id: "", url: "" }); setFile(null); onChanged();
    } catch (e) { alert(friendlyError(e, t)); } finally { setBusy(false); }
  }
  async function supprimer(x) {
    const { error } = await supabase.from("savoir_supports").delete().eq("id", x.id);
    if (error) { alert(friendlyError(error, t)); return; }
    if (x.storage_path) supabase.storage.from("savoir-ressources").remove([x.storage_path]).then(() => {});
    onChanged();
  }
  const ouvrir = (x) => (x.storage_path ? ouvrirFichier("savoir-ressources", x.storage_path).catch((e) => alert(friendlyError(e, t))) : window.open(x.url, "_blank", "noopener"));
  return (
    <div style={{ marginTop: 10, background: "#F8F9FB", borderRadius: 8, padding: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6, display: "flex", gap: 6, alignItems: "center" }}><FileText size={13} /> {S.sup_title}</div>
      {mes.length === 0 && <p style={muted}>{S.sup_empty}</p>}
      {mes.map((x) => {
        const s = seances.find((y) => y.id === x.seance_id);
        return (
          <div key={x.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "3px 0" }}>
            <button style={linkBtn(TEAL)} onClick={() => ouvrir(x)}><ExternalLink size={12} /> {x.titre}</button>
            {s && <span style={{ fontSize: 11, color: GREY }}>· {formatEventDateTime(s.debut, lang)}</span>}
            {anime && <button style={{ ...linkBtn(RED), marginLeft: "auto" }} onClick={() => supprimer(x)}><Trash2 size={12} /></button>}
          </div>
        );
      })}
      {anime && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginTop: 8, alignItems: "end" }}>
          <input style={inputStyle} placeholder={S.sup_name} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} />
          <select style={inputStyle} value={f.seance_id} onChange={(e) => setF({ ...f, seance_id: e.target.value })}>
            <option value="">{S.sup_all}</option>
            {seances.filter((s) => s.classe_id === classe.id).map((s) => <option key={s.id} value={s.id}>{formatEventDateTime(s.debut, lang)}{s.sujet ? ` — ${s.sujet}` : ""}</option>)}
          </select>
          <input style={inputStyle} placeholder={`${S.sup_url} (https://…)`} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
          <input type="file" style={inputStyle} onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Btn style={small} disabled={busy || !f.titre.trim()} onClick={ajouter}><Plus size={13} /> {S.sup_add}</Btn>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Pilotage : modération, statistiques, suivi des mentorats
// =====================================================================
export function PilotagePlus({ S, t, lang, profile, d, stats, onChanged }) {
  const ouverts = d.signalements.filter((x) => x.statut === "ouvert");
  async function act(fn) { const { error } = await fn(); if (error) { alert(friendlyError(error, t)); return false; } onChanged(); return true; }
  function masquer(x) {
    const cible = {
      question: () => supabase.from("savoir_questions").update({ masquee: true }).eq("id", x.cible_id),
      reponse: () => supabase.from("savoir_reponses").update({ masquee: true }).eq("id", x.cible_id),
      ressource: () => supabase.from("savoir_ressources").update({ statut: "refusee" }).eq("id", x.cible_id),
      classe: () => supabase.from("savoir_classes").update({ statut: "annulee" }).eq("id", x.cible_id),
    }[x.cible_type];
    return act(cible).then((ok) => ok && cloturer(x, "traite"));
  }
  const cloturer = (x, statut) => act(() => supabase.from("savoir_signalements").update({ statut, traite_par_nom: profile.nom_complet, traite_le: new Date().toISOString() }).eq("id", x.id));
  const parId = Object.fromEntries((stats || []).map((s) => [s.ressource_id, s]));
  const publiees = d.ressources.filter((r) => r.statut === "publiee");
  const top = publiees.filter((r) => Number(parId[r.id]?.vues || 0) > 0).sort((a, b) => Number(parId[b.id].vues) - Number(parId[a.id].vues)).slice(0, 10);
  const jamais = publiees.filter((r) => !Number(parId[r.id]?.vues || 0));
  return (
    <>
      <Card style={{ padding: 16, borderLeft: `4px solid ${ouverts.length ? RED : TEAL}` }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, display: "flex", gap: 7, alignItems: "center" }}><Flag size={15} color={ouverts.length ? RED : TEAL} /> {S.mod_title} {ouverts.length > 0 && `· ${ouverts.length}`}</div>
        {ouverts.length === 0 && <p style={{ ...muted, color: TEAL, fontWeight: 600 }}>{S.mod_empty}</p>}
        {ouverts.map((x) => (
          <Ligne key={x.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13 }}><b>{S["type_" + x.cible_type]}</b> — {x.apercu}</div>
              <div style={{ fontSize: 12, color: RED }}>« {x.motif} »</div>
              <div style={{ fontSize: 11, color: GREY }}>{S.mod_by.replace("{nom}", x.auteur_nom || "—").replace("{d}", formatEventDateTime(x.created_at, lang))}</div>
            </div>
            <Btn style={small} onClick={() => masquer(x)}><EyeOff size={13} /> {S.mod_hide}</Btn>
            <button style={linkBtn(TEAL)} onClick={() => cloturer(x, "traite")}>{S.mod_done}</button>
            <button style={linkBtn(GREY)} onClick={() => cloturer(x, "rejete")}>{S.mod_reject}</button>
          </Ligne>
        ))}
      </Card>
      <Card style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, display: "flex", gap: 7, alignItems: "center" }}><BarChart3 size={15} /> {S.st_title}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: GREY, marginBottom: 4 }}>{S.st_top}</div>
            {top.length === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{S.none}</p>}
            {top.map((r, i) => (
              <Ligne key={r.id}>
                <b style={{ width: 18, color: GREY }}>{i + 1}</b>
                <span style={{ flex: 1, fontSize: 13 }}>{r.titre}</span>
                <span style={{ fontSize: 11.5, color: GREY }}>{parId[r.id].vues} {S.st_views} · {parId[r.id].lecteurs} {S.st_readers} · {parId[r.id].favoris} {S.st_favs}</span>
              </Ligne>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: GREY, marginBottom: 4 }}>{S.st_never} · {jamais.length}</div>
            {jamais.slice(0, 12).map((r) => <Ligne key={r.id}><span style={{ fontSize: 13 }}>{r.titre}</span><span style={{ fontSize: 11, color: GREY, marginLeft: "auto" }}>{S["dom_" + r.domaine]}</span></Ligne>)}
          </div>
        </div>
      </Card>
      <Card style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, display: "flex", gap: 7, alignItems: "center" }}><Briefcase size={15} /> {S.sv_title}</div>
        <p style={{ ...muted, marginBottom: 8 }}>{S.sv_help}</p>
        {d.mentorats.length === 0 && <p style={{ ...muted, fontStyle: "italic" }}>{S.sv_none}</p>}
        {d.mentorats.map((x) => (
          <Ligne key={x.id}>
            <span style={{ flex: 1, fontSize: 13 }}><b>{d.mentorsPro.find((m) => m.id === x.mentor_id)?.nom || "—"}</b> → {x.mentore_nom || "—"}</span>
            <span style={{ fontSize: 11.5, color: GREY }}>{S["mst_" + x.statut]}</span>
            {x.suivi_demande && <span style={{ fontSize: 11.5, fontWeight: 700, color: AMBER }}>{S.sv_asked.replace("{nom}", x.suivi_demande_par || "—")}</span>}
          </Ligne>
        ))}
      </Card>
    </>
  );
}
