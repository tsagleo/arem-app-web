// =====================================================================
// PublicShowcase.jsx — Vitrine publique (Phase 4, suite 91, 2026-09-28)
// Seule partie de l'application accessible SANS connexion. Deux modes,
// selon les paramètres d'adresse lus par App.jsx (PlatformAppInner) :
//   - ?pub=<slug>    → page de présentation + calendrier public +
//                       formulaire de demande d'adhésion, pour UNE
//                       association précise (identifiée par son slug).
//   - ?verify=<jeton> → vérification minimale d'une carte de membre
//                       (nom, photo, actif/inactif) — jamais listable,
//                       jamais d'autre donnée personnelle.
//
// N'interroge jamais les tables existantes directement : uniquement les
// vues/fonctions dédiées créées par sql/2026-09-28i_vitrine_publique.sql
// (public_association_profile, public_board_members, public_events,
// verify_member_card), qui ne projettent que des colonnes sûres — voir
// ce script pour le détail de ce choix de sécurité.
// =====================================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { Landmark, Users2, CalendarDays, MapPin, Send, CheckCircle2, LogIn, Flag } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, useLang, LanguageSwitcher, TextSizeControl, money, friendlyError, inputStyle, BG, TEAL, TEAL_LIGHT, RED, formatEventDateTime } from "./shared";


function goToLogin() {
  window.location.href = window.location.origin + window.location.pathname;
}

// Anti-abus (plan qualité technique 2026-10-08, point 4.1) : horodatage de
// l'affichage d'un formulaire public, exprimé en heure SERVEUR. La politique
// RLS d'insertion compare cette valeur à now() côté base (rejet si moins de
// 3 s ou plus de 24 h) — prendre l'horloge du visiteur faisait rejeter les
// demandes légitimes des appareils mal réglés (correctif
// sql/2026-10-08n_antiabus_heure_serveur.sql). On mémorise l'instant
// d'affichage côté client, puis l'écart avec l'horloge serveur dès que
// heure_serveur() répond ; si l'appel échoue (fonction pas encore déployée,
// réseau), on retombe sur l'horloge du visiteur, comme avant.
function useFormulaireDebuteLe() {
  const ref = useRef({ debutClient: null, ecartServeur: 0 });
  useEffect(() => {
    ref.current.debutClient = Date.now();
    supabase.rpc("heure_serveur").then(({ data, error }) => {
      if (!error && data) ref.current.ecartServeur = new Date(data).getTime() - Date.now();
    });
  }, []);
  return useCallback(() => new Date((ref.current.debutClient ?? Date.now()) + ref.current.ecartServeur).toISOString(), []);
}

// Une insertion refusée par la politique RLS (42501) sur un formulaire
// public signifie en pratique « envoyé trop vite » (ou champ piège rempli) —
// message actionnable plutôt que le « permission refusée » générique.
function publicFormError(error, t) {
  return error?.code === "42501" ? t("pub_form_blocked") : friendlyError(error, t);
}

function PublicHeader({ nom, logoUrl }) {
  const { t } = useLang();
  return (
    <div style={{ background: "linear-gradient(150deg,#1F3864,#152645)", padding: "18px 0" }}>
      <Container style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {logoUrl ? (
            <img src={logoUrl} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover" }} />
          ) : (
            <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Landmark size={17} color="white" />
            </div>
          )}
          <span style={{ color: "white", fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 16 }}>{nom}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TextSizeControl />
          <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 6 }}><LanguageSwitcher /></div>
          <button onClick={goToLogin} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid rgba(255,255,255,.4)", color: "white", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, cursor: "pointer" }}>
            <LogIn size={13} /> {t("pub_footer_login_link")}
          </button>
        </div>
      </Container>
    </div>
  );
}

// ---------------------------------------------------------------------
// Mode ?verify=<jeton> — vérification d'une carte de membre
// ---------------------------------------------------------------------
function MemberVerification({ token }) {
  const { t } = useLang();
  const [result, setResult] = useState(undefined); // undefined = chargement, null = introuvable
  useEffect(() => {
    supabase.rpc("verify_member_card", { p_token: token }).then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      setResult(row || null);
    });
  }, [token]);

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "Inter, sans-serif", display: "flex", flexDirection: "column" }}>
      <PublicHeader nom={t("pub_verify_title")} logoUrl={null} />
      <Container style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
        <Card style={{ maxWidth: 340, width: "100%", textAlign: "center", padding: 28 }}>
          {result === undefined ? (
            <p style={{ color: "#9AA2B5" }}>{t("load_generic")}</p>
          ) : result === null ? (
            <p style={{ color: RED, fontWeight: 600 }}>{t("pub_verify_not_found")}</p>
          ) : (
            <>
              {result.photo_url ? (
                <img src={result.photo_url} alt="" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", margin: "0 auto 12px" }} />
              ) : (
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--primary,#1F3864)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 22, margin: "0 auto 12px" }}>
                  {(result.nom || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </div>
              )}
              <h3 style={{ fontSize: 17, marginBottom: 4 }}>{result.nom}</h3>
              <p style={{ fontSize: 12.5, color: "#9AA2B5", marginBottom: 12 }}>{result.association_nom}</p>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: result.actif ? TEAL : RED }}>
                <CheckCircle2 size={15} /> {result.actif ? t("pub_verify_active") : t("pub_verify_inactive")}
              </div>
            </>
          )}
        </Card>
      </Container>
    </div>
  );
}

// ---------------------------------------------------------------------
// Mode ?pub=<slug> — présentation, calendrier, formulaire d'adhésion
// ---------------------------------------------------------------------
function ShowcasePage({ slug }) {
  const { t, lang } = useLang();
  const [profile, setProfile] = useState(undefined); // undefined = chargement, null = introuvable
  const [board, setBoard] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({ nom: "", courriel: "", telephone: "", sexe: "", dateNaissance: "", quartier: "", message: "", piege: "" });
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null); // null | "ok" | error message
  // Anti-abus : voir useFormulaireDebuteLe en tête de fichier.
  const formulaireDebuteLe = useFormulaireDebuteLe();

  const load = useCallback(async () => {
    const { data: prof } = await supabase.from("public_association_profile").select("*").eq("slug_public", slug).maybeSingle();
    setProfile(prof || null);
    if (prof) {
      const [{ data: bm }, { data: ev }] = await Promise.all([
        supabase.from("public_board_members").select("*").eq("slug_public", slug).order("mandat_debut", { ascending: false }),
        supabase.from("public_events").select("*").eq("slug_public", slug).order("date_debut"),
      ]);
      setBoard(bm || []);
      setEvents(ev || []);
    }
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  async function submitJoin(e) {
    e.preventDefault();
    if (!form.nom.trim() || !form.courriel.trim()) return;
    setSending(true); setSendResult(null);
    const { error } = await supabase.from("membership_requests").insert({
      association_id: profile.association_id,
      nom: form.nom.trim(), courriel: form.courriel.trim(),
      telephone: form.telephone.trim() || null, message: form.message.trim() || null,
      sexe: form.sexe || null, date_naissance: form.dateNaissance || null, quartier: form.quartier.trim() || null,
      piege: form.piege || null, formulaire_debute_le: formulaireDebuteLe(),
    });
    setSending(false);
    if (error) { setSendResult(publicFormError(error, t)); return; }
    setSendResult("ok");
    setForm({ nom: "", courriel: "", telephone: "", sexe: "", dateNaissance: "", quartier: "", message: "", piege: "" });
  }

  if (profile === undefined) {
    return <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "#9AA2B5" }}>{t("load_generic")}</p></div>;
  }
  if (profile === null) {
    return (
      <div style={{ minHeight: "100vh", background: BG, fontFamily: "Inter, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Card style={{ maxWidth: 380, textAlign: "center" }}>
          <h3 style={{ marginBottom: 8 }}>{t("pub_not_found_title")}</h3>
          <p style={{ color: "#5B6270", fontSize: 13.5, marginBottom: 16 }}>{t("pub_not_found_text")}</p>
          <Btn onClick={goToLogin}>{t("pub_footer_login_link")}</Btn>
        </Card>
      </div>
    );
  }


  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "Inter, -apple-system, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap');`}</style>
      <PublicHeader nom={profile.nom} logoUrl={profile.logo_url} />

      <Container><Section>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "Poppins, sans-serif", fontSize: 26, color: "#1F3864", margin: 0 }}>{profile.nom}</h1>
        </div>
        {profile.devise_texte && <p style={{ color: "#5B6270", fontSize: 14, marginBottom: 26 }}>{profile.devise_texte}</p>}

        {(profile.mission || profile.vision || profile.valeurs) && (
          <Card style={{ marginBottom: 26 }}>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>{t("gov_vision_mission")}</h3>
            {profile.mission && <p style={{ fontSize: 13, marginBottom: 8 }}><strong>{t("gov_mission")} : </strong>{profile.mission}</p>}
            {profile.vision && <p style={{ fontSize: 13, marginBottom: 8 }}><strong>{t("gov_vision")} : </strong>{profile.vision}</p>}
            {profile.valeurs && <p style={{ fontSize: 13, marginBottom: 0 }}><strong>{t("gov_values")} : </strong>{profile.valeurs}</p>}
          </Card>
        )}

        {board.length > 0 && (
          <>
            <h3 style={{ fontSize: 15, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><Users2 size={16} /> {t("pub_board_title")}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 30 }}>
              {board.map((b, i) => (
                <Card key={i} style={{ textAlign: "center", padding: 16 }}>
                  {b.photo_url ? (
                    <img src={b.photo_url} alt="" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", margin: "0 auto 8px" }} />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#1F3864", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, margin: "0 auto 8px" }}>
                      {(b.nom || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                    </div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{b.nom}</div>
                  <div style={{ fontSize: 11.5, color: "#9AA2B5" }}>{b.poste}</div>
                </Card>
              ))}
            </div>
          </>
        )}

        <h3 style={{ fontSize: 15, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><CalendarDays size={16} /> {t("pub_events_title")}</h3>
        {events.length === 0 ? (
          <p style={{ color: "#9AA2B5", fontSize: 13, marginBottom: 30 }}>{t("pub_events_empty")}</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14, marginBottom: 30 }}>
            {events.map((ev) => (
              <Card key={ev.id}>
                <h4 style={{ fontSize: 14.5, marginBottom: 6 }}>{ev.titre}</h4>
                <div style={{ fontSize: 12, color: "#333", marginBottom: 4 }}>📅 {formatEventDateTime(ev.date_debut, lang)}</div>
                {ev.lieu && <div style={{ fontSize: 12, color: "#333", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}><MapPin size={11} /> {ev.lieu}</div>}
                {ev.description && <p style={{ fontSize: 12, color: "#5B6270", marginTop: 8, marginBottom: 8 }}>{ev.description}</p>}
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--primary,#1F3864)" }}>
                  {ev.prix > 0 ? money(ev.prix, profile.devise_monetaire) : t("pub_event_free")}
                </div>
              </Card>
            ))}
          </div>
        )}

        <Card style={{ maxWidth: 480 }}>
          <h3 style={{ fontSize: 15, marginBottom: 4 }}>{t("pub_join_title")}</h3>
          <p style={{ fontSize: 12.5, color: "#888", marginBottom: 16 }}>{t("pub_join_intro")}</p>
          {sendResult === "ok" ? (
            <p style={{ color: TEAL, fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={16} /> {t("pub_join_success")}</p>
          ) : (
            <form onSubmit={submitJoin}>
              {/* Champ piège anti-robot (plan qualité technique 2026-10-08,
                  point 4.1) : masqué à l'écran pour un humain, mais présent
                  dans le DOM — un robot qui remplit tous les champs le
                  remplit aussi, ce qui le trahit (voir la clause RLS de
                  membership_requests). Jamais display:none seul (certains
                  robots le détectent) : hors-écran + invisible + exclu de
                  la tabulation. */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
                <label htmlFor="pub_join_site_web">Site web</label>
                <input id="pub_join_site_web" type="text" tabIndex={-1} autoComplete="off" value={form.piege} onChange={(e) => setForm({ ...form, piege: e.target.value })} />
              </div>
              <Field label={t("pub_join_name")}><input required style={inputStyle} value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} /></Field>
              <Field label={t("pub_join_email")}><input type="email" required style={inputStyle} value={form.courriel} onChange={(e) => setForm({ ...form, courriel: e.target.value })} /></Field>
              <Field label={t("pub_join_phone")}><input style={inputStyle} value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} /></Field>
              <Field label={t("mem_sexe")}>
                <select style={inputStyle} value={form.sexe} onChange={(e) => setForm({ ...form, sexe: e.target.value })}>
                  <option value="">{t("mem_sexe_placeholder")}</option>
                  <option value="M">{t("mem_sexe_m")}</option>
                  <option value="F">{t("mem_sexe_f")}</option>
                </select>
              </Field>
              <Field label={t("mem_birthdate")}><input type="date" style={inputStyle} value={form.dateNaissance} onChange={(e) => setForm({ ...form, dateNaissance: e.target.value })} /></Field>
              <Field label={t("mem_address")}><input style={inputStyle} value={form.quartier} onChange={(e) => setForm({ ...form, quartier: e.target.value })} /></Field>
              <Field label={t("pub_join_message")}><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
              {sendResult && sendResult !== "ok" && <p style={{ color: RED, fontSize: 12, marginBottom: 10 }}>{sendResult}</p>}
              <Btn type="submit" disabled={sending}><Send size={14} /> {t("pub_join_submit")}</Btn>
            </form>
          )}
        </Card>
      </Section></Container>
    </div>
  );
}

// ---------------------------------------------------------------------
// Mode ?pub=<slug>&projet=<id> — page de suivi public d'un projet
// (progression + jalons uniquement, jamais de budget ni de liste de
// tâches). Même patron que ShowcasePage : uniquement des vues dédiées
// (public_project_progress, public_project_milestones), doublement
// conditionnées côté SQL (vitrine_active ET projects.public_suivi).
// Complément « modernisation Projets » (2026-09-30).
// ---------------------------------------------------------------------
function ProjectPublicPage({ projectId }) {
  const { t } = useLang();
  const [progress, setProgress] = useState(undefined); // undefined = chargement, null = introuvable/non public
  const [milestones, setMilestones] = useState([]);

  const load = useCallback(async () => {
    const { data: pr } = await supabase.from("public_project_progress").select("*").eq("project_id", projectId).maybeSingle();
    setProgress(pr || null);
    if (pr) {
      const { data: ms } = await supabase.from("public_project_milestones").select("*").eq("project_id", projectId).order("ordre");
      setMilestones(ms || []);
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (progress === undefined) {
    return <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "#9AA2B5" }}>{t("load_generic")}</p></div>;
  }
  if (progress === null) {
    return (
      <div style={{ minHeight: "100vh", background: BG, fontFamily: "Inter, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Card style={{ maxWidth: 380, textAlign: "center" }}>
          <h3 style={{ marginBottom: 8 }}>{t("pub_not_found_title")}</h3>
          <p style={{ color: "#5B6270", fontSize: 13.5, marginBottom: 16 }}>{t("pub_project_not_found_text")}</p>
          <Btn onClick={goToLogin}>{t("pub_footer_login_link")}</Btn>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "Inter, -apple-system, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap');`}</style>
      <PublicHeader nom={progress.association_nom} logoUrl={progress.association_logo_url} />
      <Container><Section>
        <h1 style={{ fontFamily: "Poppins, sans-serif", fontSize: 24, color: "#1F3864", marginBottom: 4 }}>{progress.nom}</h1>
        {progress.association_devise_texte && <p style={{ color: "#5B6270", fontSize: 13, marginBottom: 20 }}>{progress.association_devise_texte}</p>}
        {progress.description && <p style={{ fontSize: 13.5, color: "#333", marginBottom: 24, maxWidth: 640 }}>{progress.description}</p>}

        <Card style={{ marginBottom: 24, maxWidth: 480 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8A8F98", textTransform: "uppercase", marginBottom: 8 }}>{t("pub_project_progress_label")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, height: 10, borderRadius: 999, background: "#E7EAF2", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress.avancement}%`, background: TEAL }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#1F3864" }}>{progress.avancement}%</span>
          </div>
        </Card>

        {milestones.length > 0 && (
          <>
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>{t("proj_milestones_title")}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 480 }}>
              {milestones.map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "white" }}>
                  <Flag size={14} color={m.statut === "atteint" ? TEAL : "#8A5A00"} />
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{m.titre}</div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: m.statut === "atteint" ? TEAL_LIGHT : "#EAEDF6", color: m.statut === "atteint" ? TEAL : "#5B6B94" }}>{t("proj_milestone_status_" + m.statut)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Section></Container>
    </div>
  );
}

// ---------------------------------------------------------------------
// Mode ?pub=<slug>&evenement=<id> — page publique dédiée à un événement
// (fiche + programme informatif + formulaire d'inscription SANS compte,
// une prise de coordonnées, pas un paiement en ligne — voir note en tête
// de sql/2026-09-30_evenements_modernisation.sql). Même patron exact que
// ProjectPublicPage ci-dessus : uniquement des vues dédiées
// (public_event_detail, public_event_sessions), doublement conditionnées
// côté SQL (vitrine_active ET events.public_inscription). Complément
// « modernisation Événements » (2026-09-30).
// ---------------------------------------------------------------------
function EventPublicPage({ eventId }) {
  const { t, lang } = useLang();
  const [ev, setEv] = useState(undefined); // undefined = chargement, null = introuvable/non public
  const [sessions, setSessions] = useState([]);
  const [form, setForm] = useState({ nom: "", courriel: "", telephone: "", nb_personnes: 1, message: "", piege: "" });
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null); // null | "ok" | error message
  // Anti-abus : voir useFormulaireDebuteLe en tête de fichier.
  const formulaireDebuteLe = useFormulaireDebuteLe();

  const load = useCallback(async () => {
    const { data } = await supabase.from("public_event_detail").select("*").eq("event_id", eventId).maybeSingle();
    setEv(data || null);
    if (data) {
      const { data: s } = await supabase.from("public_event_sessions").select("*").eq("event_id", eventId).order("ordre");
      setSessions(s || []);
    }
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  async function submitRegistration(e) {
    e.preventDefault();
    if (!form.nom.trim() || !form.courriel.trim()) return;
    setSending(true); setSendResult(null);
    const { error } = await supabase.from("event_public_registrations").insert({
      association_id: ev.association_id ?? null, event_id: eventId,
      nom: form.nom.trim(), courriel: form.courriel.trim(), telephone: form.telephone.trim() || null,
      nb_personnes: Number(form.nb_personnes) || 1, message: form.message.trim() || null,
      piege: form.piege || null, formulaire_debute_le: formulaireDebuteLe(),
    });
    setSending(false);
    if (error) { setSendResult(publicFormError(error, t)); return; }
    setSendResult("ok");
    setForm({ nom: "", courriel: "", telephone: "", nb_personnes: 1, message: "", piege: "" });
  }

  if (ev === undefined) {
    return <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "#9AA2B5" }}>{t("load_generic")}</p></div>;
  }
  if (ev === null) {
    return (
      <div style={{ minHeight: "100vh", background: BG, fontFamily: "Inter, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Card style={{ maxWidth: 380, textAlign: "center" }}>
          <h3 style={{ marginBottom: 8 }}>{t("pub_not_found_title")}</h3>
          <p style={{ color: "#5B6270", fontSize: 13.5, marginBottom: 16 }}>{t("pub_event_not_found_text")}</p>
          <Btn onClick={goToLogin}>{t("pub_footer_login_link")}</Btn>
        </Card>
      </div>
    );
  }

  const full = ev.places_restantes === 0;

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "Inter, -apple-system, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap');`}</style>
      <PublicHeader nom={ev.association_nom} logoUrl={ev.association_logo_url} />
      <Container><Section>
        <h1 style={{ fontFamily: "Poppins, sans-serif", fontSize: 24, color: "#1F3864", marginBottom: 4 }}>{ev.titre}</h1>
        {ev.association_devise_texte && <p style={{ color: "#5B6270", fontSize: 13, marginBottom: 20 }}>{ev.association_devise_texte}</p>}

        <Card style={{ marginBottom: 24, maxWidth: 480 }}>
          <div style={{ fontSize: 12.5, color: "#333", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><CalendarDays size={14} /> {formatEventDateTime(ev.date_debut, lang)}</div>
          {ev.lieu && <div style={{ fontSize: 12.5, color: "#333", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><MapPin size={14} /> {ev.lieu}</div>}
          {ev.description && <p style={{ fontSize: 13, color: "#5B6270", marginTop: 10, marginBottom: 10 }}>{ev.description}</p>}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--primary,#1F3864)" }}>{ev.prix > 0 ? money(ev.prix, ev.association_devise_monetaire) : t("pub_event_free")}</span>
            {ev.capacite_max != null && (
              <span style={{ fontSize: 12, fontWeight: 600, color: full ? RED : TEAL }}>{full ? t("pub_event_full") : t("pub_event_places_restantes").replace("{n}", String(ev.places_restantes))}</span>
            )}
          </div>
        </Card>

        {sessions.length > 0 && (
          <>
            <h3 style={{ fontSize: 15, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><CalendarDays size={16} /> {t("pub_event_sessions_title")}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 480, marginBottom: 30 }}>
              {sessions.map((s, i) => (
                <div key={i} style={{ padding: "10px 12px", borderRadius: 8, background: "white" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.titre}</div>
                  {s.date_debut && <div style={{ fontSize: 11.5, color: "#9AA2B5" }}>{formatEventDateTime(s.date_debut, lang)}{s.lieu ? ` · ${s.lieu}` : ""}</div>}
                  {s.description && <div style={{ fontSize: 12, color: "#5B6270", marginTop: 3 }}>{s.description}</div>}
                </div>
              ))}
            </div>
          </>
        )}

        <Card style={{ maxWidth: 480 }}>
          <h3 style={{ fontSize: 15, marginBottom: 4 }}>{t("pub_event_register_title")}</h3>
          {sendResult === "ok" ? (
            <p style={{ color: TEAL, fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={16} /> {t("pub_event_register_success")}</p>
          ) : (
            <form onSubmit={submitRegistration}>
              {/* Champ piège anti-robot — voir le commentaire équivalent
                  dans ShowcasePage ci-dessus. */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
                <label htmlFor="pub_event_site_web">Site web</label>
                <input id="pub_event_site_web" type="text" tabIndex={-1} autoComplete="off" value={form.piege} onChange={(e) => setForm({ ...form, piege: e.target.value })} />
              </div>
              <Field label={t("pub_join_name")}><input required style={inputStyle} value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} /></Field>
              <Field label={t("pub_join_email")}><input type="email" required style={inputStyle} value={form.courriel} onChange={(e) => setForm({ ...form, courriel: e.target.value })} /></Field>
              <Field label={t("pub_join_phone")}><input style={inputStyle} value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} /></Field>
              <Field label={t("pub_event_nb_people_label")}><input type="number" min={1} style={inputStyle} value={form.nb_personnes} onChange={(e) => setForm({ ...form, nb_personnes: e.target.value })} /></Field>
              <Field label={t("pub_join_message")}><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
              {sendResult && sendResult !== "ok" && <p style={{ color: RED, fontSize: 12, marginBottom: 10 }}>{sendResult}</p>}
              <Btn type="submit" disabled={sending}><Send size={14} /> {t("pub_event_register_submit")}</Btn>
            </form>
          )}
        </Card>
      </Section></Container>
    </div>
  );
}

export default function PublicShowcase({ slug, verifyToken, projectId, eventId }) {
  if (verifyToken) return <MemberVerification token={verifyToken} />;
  if (projectId) return <ProjectPublicPage projectId={projectId} />;
  if (eventId) return <EventPublicPage eventId={eventId} />;
  return <ShowcasePage slug={slug} />;
}
