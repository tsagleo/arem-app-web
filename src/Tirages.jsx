// =====================================================================
// Tirages.jsx — Tirages au sort vérifiables, vécus en direct
// =====================================================================
// Demande de l'utilisateur (2026-10-08) : tirer au sort l'ordre de
// passage de la tontine, en direct, pour que tous les adhérents
// connectés vivent la scène ; pas de tombola payante. Voir
// sql/2026-10-08r_tirages_au_sort.sql pour le mécanisme
// « engagement / révélation » qui empêche toute manipulation :
//   préparé → empreinte publiée ; lancé → ordre figé par le serveur ;
//   dévoilé numéro par numéro (temps réel) ; terminé → graine publiée,
//   vérifiable par chacun dans son propre navigateur (verifierTirage).
// Toute écriture passe par des fonctions RPC gardées par is_bureau().
//
// Suite du même jour (retours de l'utilisateur après un premier essai) :
//  • plein écran : mode « projection » qui se quitte par bouton ou Échap
//    (l'ancien bouton ne savait qu'entrer en plein écran) ;
//  • durée du défilement réglable (0 à 60 s, sql s), ralentissant vers
//    la fin pour le suspense ;
//  • son (roulement + carillon), « Votre numéro », nombre de membres qui
//    regardent, touches Espace/→ pour tirer, procès-verbal PDF, partage
//    WhatsApp.
// =====================================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Dices, Plus, X, Radio, ShieldCheck, Maximize2, Minimize2, Play, SkipForward, FastForward, Ban, CheckCircle2, AlertTriangle, Volume2, VolumeX, Eye, FileDown, MessageCircle, Timer, PartyPopper } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, inputStyle, useLang, friendlyError, formatEventDateTime, whatsappShareUrl, TEAL, TEAL_LIGHT, RED } from "./shared";

const DUREES = [0, 5, 10, 15, 20, 30, 40, 60];
const GOLD = "#F4D06F";

const TXT = {
  fr: {
    title: "Tirages au sort",
    intro: "Tirages vérifiables, vécus en direct par tous les membres connectés. Une fois lancé, un tirage ne peut plus être modifié ni relancé.",
    new_btn: "Nouveau tirage",
    f_title: "Titre",
    f_title_default: "Ordre de passage de la tontine",
    f_type: "Type de tirage",
    type_tontine: "Ordre de passage (tontine)",
    type_libre: "Tirage libre (gagnants)",
    f_nb: "Nombre de gagnants",
    f_participants: "Participants",
    all: "Tous", none: "Aucun",
    selected: "{n} sélectionné(s)",
    prepare_btn: "Préparer le tirage",
    confirm_prepare: "Préparer le tirage « {titre} » avec {n} participants ? La liste ne pourra plus être modifiée.",
    min_two: "Choisissez au moins deux participants.",
    st_prepare: "Prêt — pas encore lancé",
    st_en_cours: "EN DIRECT",
    st_termine: "Terminé",
    st_annule: "Annulé",
    fingerprint: "Empreinte publiée avant le tirage",
    fingerprint_help: "Cette empreinte verrouille le hasard dès la préparation. La clé secrète correspondante sera révélée à la fin : chacun pourra vérifier qu'elle correspond.",
    launch_btn: "Lancer le tirage en direct",
    confirm_launch: "Lancer « {titre} » ? L'ordre sera fixé définitivement par le serveur. Les membres connectés verront les numéros apparaître en direct.",
    next_btn: "Tirer le numéro suivant",
    all_btn: "Tout dévoiler",
    confirm_all: "Dévoiler tous les numéros restants d'un coup ?",
    cancel_btn: "Annuler le tirage",
    cancel_prompt: "Motif de l'annulation (obligatoire, visible par tous) :",
    fullscreen: "Projeter en plein écran",
    exit_fullscreen: "Quitter le plein écran (Échap)",
    number: "N°",
    winner: "Gagnant",
    waiting_next: "En attente du prochain numéro…",
    waiting_start: "Le tirage n'a pas encore commencé.",
    remaining: "{n} restant(s)",
    participants_n: "{n} participants",
    by: "Préparé par {nom}",
    launched: "Lancé le {date}",
    finished: "Terminé le {date}",
    cancelled_reason: "Annulé : {motif}",
    seed: "Clé secrète révélée",
    verify_btn: "Vérifier ce tirage",
    verify_ok: "Vérifié sur cet appareil : la clé correspond à l'empreinte publiée, et l'ordre a bien été calculé à partir d'elle. Personne n'a pu le modifier.",
    verify_ko: "La vérification a échoué : contactez le bureau.",
    verify_unavailable: "Vérification impossible dans ce navigateur (connexion sécurisée requise).",
    empty: "Aucun tirage pour le moment.",
    live_banner: "Un tirage est en direct !",
    tontine_hint: "L'ordre obtenu sera proposé automatiquement comme bénéficiaire de chaque séance de tontine.",
    duration: "Durée du défilement",
    duration_help: "Temps pendant lequel les noms défilent avant que chaque numéro se pose. Simple mise en scène : le résultat est fixé dès le lancement.",
    d_0: "Instantané", d_s: "{n} secondes", d_60: "1 minute",
    sound_on: "Son activé", sound_off: "Activer le son",
    viewers: "{n} membre(s) connecté(s)",
    you_participate: "Vous participez à ce tirage.",
    your_number: "Votre numéro : {n}",
    your_win: "Vous êtes tiré(e) au sort !",
    keys_hint: "Astuce : touche Espace ou → pour tirer le numéro suivant (fonctionne avec une télécommande de présentation).",
    pdf_btn: "Procès-verbal (PDF)",
    share_btn: "Partager sur WhatsApp",
    share_header: "🎲 Résultat du tirage « {titre} »",
    share_footer: "Tirage vérifiable dans Unia (empreinte publiée avant le tirage).",
    pdf_title: "Procès-verbal de tirage au sort",
    pdf_type: "Type",
    pdf_prepared: "Préparé par",
    pdf_launched: "Lancé le",
    pdf_finished: "Terminé le",
    pdf_participants: "Nombre de participants",
    pdf_method: "Méthode : avant le tirage, le serveur a publié l'empreinte SHA-256 d'une clé secrète aléatoire. Au lancement, l'ordre a été calculé en classant chaque participant selon SHA-256(clé:identifiant). La clé, révélée à la fin, permet à chacun de refaire le calcul et de vérifier le résultat.",
    pdf_position: "Rang",
    pdf_name: "Nom",
    pdf_sign: "Signatures",
    pdf_president: "Président(e)",
    pdf_secretary: "Secrétaire",
    pdf_witness: "Témoin",
  },
  en: {
    title: "Random draws",
    intro: "Verifiable draws, watched live by every signed-in member. Once launched, a draw can no longer be changed or re-run.",
    new_btn: "New draw",
    f_title: "Title",
    f_title_default: "Tontine payout order",
    f_type: "Draw type",
    type_tontine: "Payout order (tontine)",
    type_libre: "Free draw (winners)",
    f_nb: "Number of winners",
    f_participants: "Participants",
    all: "All", none: "None",
    selected: "{n} selected",
    prepare_btn: "Prepare the draw",
    confirm_prepare: "Prepare “{titre}” with {n} participants? The list can no longer be changed.",
    min_two: "Select at least two participants.",
    st_prepare: "Ready — not launched yet",
    st_en_cours: "LIVE",
    st_termine: "Finished",
    st_annule: "Cancelled",
    fingerprint: "Fingerprint published before the draw",
    fingerprint_help: "This fingerprint locks in the randomness as soon as the draw is prepared. The matching secret key is revealed at the end so anyone can check it.",
    launch_btn: "Start the live draw",
    confirm_launch: "Start “{titre}”? The order will be fixed for good by the server. Signed-in members will see the numbers appear live.",
    next_btn: "Draw the next number",
    all_btn: "Reveal everything",
    confirm_all: "Reveal all remaining numbers at once?",
    cancel_btn: "Cancel the draw",
    cancel_prompt: "Reason for cancelling (required, visible to everyone):",
    fullscreen: "Project full screen",
    exit_fullscreen: "Exit full screen (Esc)",
    number: "No.",
    winner: "Winner",
    waiting_next: "Waiting for the next number…",
    waiting_start: "The draw has not started yet.",
    remaining: "{n} left",
    participants_n: "{n} participants",
    by: "Prepared by {nom}",
    launched: "Started {date}",
    finished: "Finished {date}",
    cancelled_reason: "Cancelled: {motif}",
    seed: "Revealed secret key",
    verify_btn: "Verify this draw",
    verify_ok: "Verified on this device: the key matches the published fingerprint, and the order was computed from it. Nobody could have changed it.",
    verify_ko: "Verification failed: please contact the board.",
    verify_unavailable: "Verification is not possible in this browser (a secure connection is required).",
    empty: "No draws yet.",
    live_banner: "A draw is live!",
    tontine_hint: "The resulting order will be suggested automatically as the recipient of each tontine session.",
    duration: "Roll duration",
    duration_help: "How long names roll before each number lands. Presentation only: the result is fixed as soon as the draw starts.",
    d_0: "Instant", d_s: "{n} seconds", d_60: "1 minute",
    sound_on: "Sound on", sound_off: "Turn sound on",
    viewers: "{n} member(s) watching",
    you_participate: "You are taking part in this draw.",
    your_number: "Your number: {n}",
    your_win: "You have been drawn!",
    keys_hint: "Tip: press Space or → to draw the next number (works with a presentation clicker).",
    pdf_btn: "Official record (PDF)",
    share_btn: "Share on WhatsApp",
    share_header: "🎲 Result of the draw “{titre}”",
    share_footer: "Verifiable draw in Unia (fingerprint published before the draw).",
    pdf_title: "Random draw official record",
    pdf_type: "Type",
    pdf_prepared: "Prepared by",
    pdf_launched: "Started",
    pdf_finished: "Finished",
    pdf_participants: "Number of participants",
    pdf_method: "Method: before the draw, the server published the SHA-256 fingerprint of a random secret key. When the draw started, the order was computed by ranking each participant by SHA-256(key:identifier). The key, revealed at the end, lets anyone redo the computation and verify the result.",
    pdf_position: "Rank",
    pdf_name: "Name",
    pdf_sign: "Signatures",
    pdf_president: "President",
    pdf_secretary: "Secretary",
    pdf_witness: "Witness",
  },
};

function dureeLabel(L, d) {
  if (d === 0) return L.d_0;
  if (d === 60) return L.d_60;
  return L.d_s.replace("{n}", String(d));
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Refait, dans le navigateur, exactement le calcul de lancer_tirage() :
// SHA-256(graine) doit égaler l'engagement publié, et l'ordre doit être le
// tri des participants par SHA-256(graine:member_id) (comparaison par
// code de caractère, comme `collate "C"` côté base).
async function verifierTirage(tirage) {
  if (!globalThis.crypto?.subtle) return "unavailable";
  if (!tirage.graine || !tirage.resultat) return "ko";
  if ((await sha256Hex(tirage.graine)) !== tirage.engagement) return "ko";
  const cles = await Promise.all(tirage.participants.map(async (p) => ({ id: p.member_id, h: await sha256Hex(`${tirage.graine}:${p.member_id}`) })));
  cles.sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
  const attendu = cles.map((c) => c.id).join(",");
  const obtenu = [...tirage.resultat].sort((a, b) => a.position - b.position).map((r) => r.member_id).join(",");
  return attendu === obtenu ? "ok" : "ko";
}

function nbAReveler(tirage) {
  const total = tirage.resultat?.length ?? tirage.participants.length;
  return tirage.type === "libre" ? Math.min(tirage.nb_gagnants, total) : total;
}

function ordreDe(tirage) {
  return [...(tirage.resultat || [])].sort((a, b) => a.position - b.position).slice(0, nbAReveler(tirage));
}

// ---------- Son (Web Audio, aucun fichier à charger) ----------
// Un « tic » à chaque nom qui défile, un carillon quand le numéro se pose.
// Les navigateurs bloquent le son tant que la personne n'a pas cliqué sur
// la page : d'où le bouton « Activer le son », désactivé par défaut.
let audioCtx = null;
function bip(freq, dureeMs, volume = 0.06, type = "square") {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dureeMs / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + dureeMs / 1000);
  } catch { /* audio indisponible : on continue sans son */ }
}
function carillon() {
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => bip(f, 380, 0.08, "triangle"), i * 110));
}

function StatutPill({ statut, L }) {
  const styles = {
    prepare: { background: "#EEF1F6", color: "#4A5468" },
    en_cours: { background: RED, color: "white" },
    termine: { background: TEAL_LIGHT, color: TEAL },
    annule: { background: "#F3E8E8", color: "#8A3B3B" },
  };
  return (
    <span style={{ ...styles[statut], fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 10px", display: "inline-flex", alignItems: "center", gap: 5, letterSpacing: 0.3 }}>
      {statut === "en_cours" && <span className="tirage-pulse" style={{ width: 7, height: 7, borderRadius: 999, background: "white" }} />}
      {L["st_" + statut]}
    </span>
  );
}

function DureeSelect({ L, value, onChange, disabled, dark }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: dark ? "rgba(255,255,255,.8)" : "#4A5468" }}>
      <Timer size={13} />
      <select value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 12, ...(dark ? { background: "rgba(255,255,255,.12)", color: "white", borderColor: "rgba(255,255,255,.25)" } : {}) }}>
        {DUREES.map((d) => <option key={d} value={d} style={{ color: "#2A2A2A" }}>{dureeLabel(L, d)}</option>)}
      </select>
    </label>
  );
}

// ---------- Scène du direct ----------
// Quand `revele` augmente (clic du bureau, reçu en temps réel), le dernier
// numéro « roule » parmi les noms encore en lice pendant duree_animation
// secondes, en ralentissant vers la fin, avant de se poser — même
// animation sur tous les écrans.
function LiveStage({ tirage, L, isBureau, onNext, onAll, onDuree, busy, myMemberId, viewers, son, setSon }) {
  const ordre = ordreDe(tirage);
  const total = ordre.length;
  const revele = tirage.revele;
  const duree = tirage.duree_animation ?? 5;
  const [rolling, setRolling] = useState(null); // nom affiché pendant l'animation
  const [immersif, setImmersif] = useState(false);
  const dernierVu = useRef(revele);
  const sonRef = useRef(son);
  useEffect(() => { sonRef.current = son; }, [son]);

  useEffect(() => {
    if (revele <= dernierVu.current) { dernierVu.current = revele; return; }
    dernierVu.current = revele;
    const enLice = ordre.slice(revele - 1).map((r) => r.nom);
    if (duree === 0 || enLice.length <= 1) { if (sonRef.current) carillon(); return; }
    const totalMs = duree * 1000;
    const debut = Date.now();
    let timer;
    const tick = () => {
      const ecoule = Date.now() - debut;
      if (ecoule >= totalMs) { setRolling(null); if (sonRef.current) carillon(); return; }
      setRolling(enLice[Math.floor(Math.random() * enLice.length)]);
      if (sonRef.current) bip(880, 35, 0.03);
      const p = ecoule / totalMs;
      timer = setTimeout(tick, 70 + 430 * p * p); // ralentit vers la fin
    };
    tick();
    return () => { clearTimeout(timer); setRolling(null); };
    // ordre est dérivé de tirage.resultat, figé dès le lancement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revele]);

  // Plein écran : la scène passe en calque fixe sur toute la fenêtre (marche
  // partout, y compris sur iPhone), et on demande en plus le vrai plein
  // écran du navigateur quand il est disponible. Sortie : bouton, Échap,
  // ou sortie du plein écran par le navigateur.
  const entrer = () => {
    setImmersif(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const sortir = useCallback(() => {
    setImmersif(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    if (!immersif) return;
    const onFs = () => { if (!document.fullscreenElement) setImmersif(false); };
    const onKey = (e) => { if (e.key === "Escape") sortir(); };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("fullscreenchange", onFs); document.removeEventListener("keydown", onKey); };
  }, [immersif, sortir]);

  // Raccourcis du bureau : Espace, → ou Page suivante (télécommandes de
  // présentation) tirent le numéro suivant — sauf pendant une saisie.
  const enDirect = tirage.statut === "en_cours";
  const peutTirer = isBureau && enDirect && !busy && !rolling;
  useEffect(() => {
    if (!peutTirer) return;
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
      if (e.key === " " || e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); onNext(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [peutTirer, onNext]);

  const courant = revele > 0 ? ordre[revele - 1] : null;
  const visibles = ordre.slice(0, revele);
  const monRang = myMemberId ? ordre.findIndex((r) => r.member_id === myMemberId) + 1 : 0;
  const participe = myMemberId && tirage.participants.some((p) => p.member_id === myMemberId);
  const monNumeroVisible = monRang > 0 && monRang <= revele && !(rolling && monRang === revele);
  const courantEstMoi = courant && courant.member_id === myMemberId && !rolling;

  const big = immersif;
  const stageStyle = {
    background: "radial-gradient(ellipse at top, #1B2F4D 0%, #0F1B2D 70%)", color: "white", borderRadius: big ? 0 : 16,
    padding: big ? "28px clamp(16px, 4vw, 48px)" : "22px 20px", overflow: "auto",
    ...(big ? { position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column" } : {}),
  };

  const scene = (
    <div style={stageStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <StatutPill statut={tirage.statut} L={L} />
          {big && <span style={{ fontWeight: 700, fontSize: 18 }}>{tirage.titre}</span>}
          <span style={{ fontSize: 13, opacity: 0.75 }}>{L.remaining.replace("{n}", String(Math.max(total - revele, 0)))}</span>
          {enDirect && viewers > 0 && <span style={{ fontSize: 13, opacity: 0.75, display: "inline-flex", alignItems: "center", gap: 5 }}><Eye size={13} /> {L.viewers.replace("{n}", String(viewers))}</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {isBureau && enDirect && <DureeSelect L={L} value={duree} onChange={onDuree} disabled={busy} dark />}
          <button onClick={() => { if (!son) bip(660, 60, 0.04); setSon(!son); }} style={stageBtn}>
            {son ? <Volume2 size={13} /> : <VolumeX size={13} />} {son ? L.sound_on : L.sound_off}
          </button>
          {big
            ? <button onClick={sortir} style={{ ...stageBtn, background: "rgba(255,255,255,.22)" }}><Minimize2 size={13} /> {L.exit_fullscreen}</button>
            : <button onClick={entrer} style={stageBtn}><Maximize2 size={13} /> {L.fullscreen}</button>}
        </div>
      </div>

      {participe && (
        <div style={{ textAlign: "center", fontSize: 13, marginBottom: 6, color: monNumeroVisible ? GOLD : "rgba(255,255,255,.7)", fontWeight: monNumeroVisible ? 700 : 400 }}>
          {monNumeroVisible ? (tirage.type === "libre" ? L.your_win : L.your_number.replace("{n}", String(monRang))) : L.you_participate}
        </div>
      )}

      <div style={{ textAlign: "center", padding: big ? "4vh 0 5vh" : "14px 0 22px", flex: big ? "0 0 auto" : undefined }}>
        {courant || rolling ? (
          <>
            <div style={{ fontSize: big ? "clamp(18px, 2.4vw, 28px)" : 15, letterSpacing: 2, opacity: 0.7, textTransform: "uppercase" }}>
              {tirage.type === "libre" ? L.winner : L.number} {revele}
            </div>
            <div key={rolling ? "r" : `n${revele}`} className={rolling ? "" : "tirage-land"}
              style={{ fontSize: big ? "clamp(40px, 8vw, 110px)" : "clamp(28px, 6vw, 52px)", fontWeight: 800, marginTop: 8, color: rolling ? "rgba(255,255,255,.55)" : GOLD, minHeight: big ? 130 : 64, lineHeight: 1.1 }}>
              {rolling || courant.nom}
            </div>
            {courantEstMoi && <div className="tirage-land" style={{ marginTop: 6, color: GOLD, display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}><PartyPopper size={18} /> {tirage.type === "libre" ? L.your_win : L.your_number.replace("{n}", String(revele))}</div>}
          </>
        ) : (
          <div style={{ fontSize: big ? 24 : 16, opacity: 0.7 }}>{enDirect ? L.waiting_next : L.waiting_start}</div>
        )}
      </div>

      {isBureau && enDirect && (
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <Btn onClick={onNext} disabled={!peutTirer} style={big ? { fontSize: 16, padding: "12px 22px" } : undefined}><SkipForward size={big ? 18 : 14} /> {L.next_btn}</Btn>
            <Btn variant="outline" onClick={onAll} disabled={!peutTirer} style={{ color: "white", borderColor: "rgba(255,255,255,.35)" }}><FastForward size={14} /> {L.all_btn}</Btn>
          </div>
          <p style={{ fontSize: 11.5, opacity: 0.6, margin: "8px 0 0" }}>{L.keys_hint}</p>
        </div>
      )}

      {visibles.length > 0 && (
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${big ? 230 : 190}px, 1fr))`, gap: 8 }}>
          {visibles.map((r) => {
            const moi = r.member_id === myMemberId;
            const enAttente = rolling && r.position === revele;
            return (
              <li key={r.member_id} style={{ background: moi ? "rgba(244,208,111,.18)" : "rgba(255,255,255,.07)", border: moi ? `1px solid ${GOLD}` : "1px solid transparent", borderRadius: 10, padding: big ? "10px 14px" : "8px 12px", display: "flex", gap: 10, alignItems: "baseline", opacity: enAttente ? 0.25 : 1 }}>
                <span style={{ fontWeight: 800, color: GOLD, minWidth: 28, fontSize: big ? 18 : 14 }}>{r.position}</span>
                <span style={{ fontSize: big ? 17 : 14 }}>{enAttente ? "…" : r.nom}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
  // En plein écran, la scène est rendue directement dans <body> : aucun
  // parent (carte, conteneur défilant) ne peut la rogner ni la bloquer.
  return big ? createPortal(scene, document.body) : scene;
}
const stageBtn = { background: "rgba(255,255,255,.12)", color: "white", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 };

// ---------- Procès-verbal PDF ----------
async function exporterPv(tirage, association, L, lang) {
  const [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const { jsPDF } = jsPDFmod;
  const autoTable = autoTableMod.default || autoTableMod;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const x = 40;
  let y = 50;
  doc.setFontSize(16); doc.setFont(undefined, "bold");
  doc.text(association?.nom || "", x, y); y += 22;
  doc.setFontSize(13);
  doc.text(L.pdf_title, x, y); y += 18;
  doc.setFontSize(12);
  doc.text(tirage.titre, x, y); y += 20;
  doc.setFont(undefined, "normal"); doc.setFontSize(10);
  const lignes = [
    [L.pdf_type, tirage.type === "tontine" ? L.type_tontine : `${L.type_libre} (${tirage.nb_gagnants})`],
    [L.pdf_prepared, tirage.cree_par_nom || "—"],
    [L.pdf_launched, tirage.lance_le ? formatEventDateTime(tirage.lance_le, lang) : "—"],
    [L.pdf_finished, tirage.termine_le ? formatEventDateTime(tirage.termine_le, lang) : "—"],
    [L.pdf_participants, String(tirage.participants.length)],
  ];
  lignes.forEach(([k, v]) => { doc.text(`${k} : ${v}`, x, y); y += 14; });
  y += 4;
  doc.setFontSize(8.5);
  doc.text(`${L.fingerprint} : ${tirage.engagement}`, x, y); y += 12;
  if (tirage.graine) { doc.text(`${L.seed} : ${tirage.graine}`, x, y); y += 12; }
  const methode = doc.splitTextToSize(L.pdf_method, 530);
  doc.text(methode, x, y); y += methode.length * 11 + 6;
  autoTable(doc, {
    startY: y,
    head: [[L.pdf_position, L.pdf_name]],
    body: ordreDe(tirage).map((r) => [String(r.position), r.nom]),
    styles: { fontSize: 10 },
    headStyles: { fillColor: [14, 124, 102] },
    margin: { left: x, right: x },
  });
  y = (doc.lastAutoTable?.finalY || y) + 36;
  if (y > 680) { doc.addPage(); y = 60; }
  doc.setFontSize(11); doc.setFont(undefined, "bold");
  doc.text(L.pdf_sign, x, y); y += 40;
  doc.setFont(undefined, "normal"); doc.setFontSize(9.5);
  [L.pdf_president, L.pdf_secretary, `${L.pdf_witness} 1`, `${L.pdf_witness} 2`].forEach((role, i) => {
    const cx = x + (i % 2) * 270;
    const cy = y + Math.floor(i / 2) * 60;
    doc.line(cx, cy, cx + 220, cy);
    doc.text(role, cx, cy + 12);
  });
  doc.save(`${(tirage.titre || "tirage").replace(/[^a-z0-9]+/gi, "_")}_PV.pdf`);
}

function texteWhatsApp(tirage, L) {
  const lignes = ordreDe(tirage).map((r) => `${r.position}. ${r.nom}`);
  return [L.share_header.replace("{titre}", tirage.titre), "", ...lignes, "", L.share_footer].join("\n");
}

function TirageCard({ tirage, L, lang, t, isBureau, onChanged, association, myMemberId, viewers, son, setSon }) {
  const [busy, setBusy] = useState(false);
  const [verif, setVerif] = useState(null);

  async function rpc(fn, args, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onChanged();
  }
  function annuler() {
    const motif = window.prompt(L.cancel_prompt);
    if (!motif || !motif.trim()) return;
    rpc("annuler_tirage", { p_id: tirage.id, p_motif: motif.trim() });
  }
  async function verifier() { setVerif("…"); setVerif(await verifierTirage(tirage)); }
  const onNext = useCallback(() => rpc("reveler_suivant", { p_id: tirage.id }), [tirage.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lance = tirage.statut === "en_cours" || tirage.statut === "termine" || (tirage.statut === "annule" && tirage.resultat);
  const termine = tirage.statut === "termine";

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <h3 style={{ fontSize: 16, margin: "0 0 4px" }}>{tirage.titre}</h3>
          <div style={{ fontSize: 12, color: "#686F7D", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>{tirage.type === "tontine" ? L.type_tontine : `${L.type_libre} · ${tirage.nb_gagnants}`}</span>
            <span>{L.participants_n.replace("{n}", String(tirage.participants.length))}</span>
            {tirage.cree_par_nom && <span>{L.by.replace("{nom}", tirage.cree_par_nom)}</span>}
            {tirage.lance_le && <span>{L.launched.replace("{date}", formatEventDateTime(tirage.lance_le, lang))}</span>}
            {tirage.termine_le && <span>{L.finished.replace("{date}", formatEventDateTime(tirage.termine_le, lang))}</span>}
          </div>
        </div>
        {tirage.statut !== "en_cours" && <StatutPill statut={tirage.statut} L={L} />}
      </div>

      {tirage.statut === "annule" && (
        <p style={{ fontSize: 13, color: "#8A3B3B", margin: "0 0 10px" }}>{L.cancelled_reason.replace("{motif}", tirage.motif_annulation || "—")}</p>
      )}

      <div style={{ background: "#F6F7F9", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#4A5468", textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 6 }}><ShieldCheck size={13} /> {L.fingerprint}</div>
        <code style={{ fontSize: 11.5, wordBreak: "break-all", color: "#2A2A2A" }}>{tirage.engagement}</code>
        {tirage.statut === "prepare" && <p style={{ fontSize: 12, color: "#686F7D", margin: "6px 0 0" }}>{L.fingerprint_help}</p>}
        {tirage.graine && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#4A5468", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 8 }}>{L.seed}</div>
            <code style={{ fontSize: 11.5, wordBreak: "break-all", color: "#2A2A2A" }}>{tirage.graine}</code>
          </>
        )}
      </div>

      {tirage.statut === "prepare" && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {tirage.participants.map((p) => (
              <span key={p.member_id} style={{ fontSize: 12, background: p.member_id === myMemberId ? "#FBF0CC" : TEAL_LIGHT, color: TEAL, borderRadius: 999, padding: "3px 10px", fontWeight: p.member_id === myMemberId ? 700 : 400 }}>{p.nom}</span>
            ))}
          </div>
          {isBureau && (
            <>
              <div style={{ marginBottom: 12 }}>
                <DureeSelect L={L} value={tirage.duree_animation ?? 5} disabled={busy} onChange={(d) => rpc("definir_duree_tirage", { p_id: tirage.id, p_duree: d })} />
                <p style={{ fontSize: 11.5, color: "#8A8F98", margin: "4px 0 0" }}>{L.duration_help}</p>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Btn onClick={() => rpc("lancer_tirage", { p_id: tirage.id }, L.confirm_launch.replace("{titre}", tirage.titre))} disabled={busy}><Play size={14} /> {L.launch_btn}</Btn>
                <Btn variant="outline" onClick={annuler} disabled={busy}><Ban size={14} /> {L.cancel_btn}</Btn>
              </div>
            </>
          )}
        </>
      )}

      {lance && (
        <LiveStage
          tirage={tirage} L={L} isBureau={isBureau} busy={busy} myMemberId={myMemberId} viewers={viewers} son={son} setSon={setSon}
          onNext={onNext}
          onAll={() => rpc("reveler_tout", { p_id: tirage.id }, L.confirm_all)}
          onDuree={(d) => rpc("definir_duree_tirage", { p_id: tirage.id, p_duree: d })}
        />
      )}

      {tirage.statut === "en_cours" && isBureau && (
        <div style={{ marginTop: 10 }}>
          <button onClick={annuler} disabled={busy} style={{ background: "none", border: "none", color: RED, fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}>{L.cancel_btn}</button>
        </div>
      )}

      {(termine || (tirage.graine && tirage.resultat)) && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {tirage.graine && <Btn variant="outline" onClick={verifier}><ShieldCheck size={14} /> {L.verify_btn}</Btn>}
          {termine && <Btn variant="outline" onClick={() => exporterPv(tirage, association, L, lang).catch((e) => alert(friendlyError(e, t)))}><FileDown size={14} /> {L.pdf_btn}</Btn>}
          {termine && (
            <a href={whatsappShareUrl(texteWhatsApp(tirage, L))} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#128C4A", border: "1px solid rgba(37,211,102,.6)", borderRadius: 8, padding: "7px 12px", textDecoration: "none" }}>
              <MessageCircle size={14} /> {L.share_btn}
            </a>
          )}
        </div>
      )}
      {verif === "ok" && <p style={{ fontSize: 12.5, color: TEAL, display: "flex", gap: 6, alignItems: "flex-start", margin: "10px 0 0" }}><CheckCircle2 size={15} style={{ flexShrink: 0 }} /> {L.verify_ok}</p>}
      {verif === "ko" && <p style={{ fontSize: 12.5, color: RED, display: "flex", gap: 6, alignItems: "center", margin: "10px 0 0" }}><AlertTriangle size={15} /> {L.verify_ko}</p>}
      {verif === "unavailable" && <p style={{ fontSize: 12.5, color: "#686F7D", margin: "10px 0 0" }}>{L.verify_unavailable}</p>}
    </Card>
  );
}

function NouveauTirageForm({ L, t, members, onCreated, onClose }) {
  const actifs = members.filter((m) => m.statut === "Actif");
  const [titre, setTitre] = useState(`${L.f_title_default} ${new Date().getFullYear()}`);
  const [type, setType] = useState("tontine");
  const [nb, setNb] = useState(1);
  const [duree, setDuree] = useState(5);
  const [ids, setIds] = useState(() => new Set(actifs.map((m) => m.id)));
  const [busy, setBusy] = useState(false);

  function toggle(id) { setIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }

  async function preparer() {
    if (ids.size < 2) { alert(L.min_two); return; }
    if (!window.confirm(L.confirm_prepare.replace("{titre}", titre.trim()).replace("{n}", String(ids.size)))) return;
    setBusy(true);
    const { data: id, error } = await supabase.rpc("preparer_tirage", { p_titre: titre.trim(), p_type: type, p_member_ids: [...ids], p_nb_gagnants: Number(nb) || 1 });
    if (!error && duree !== 5) await supabase.rpc("definir_duree_tirage", { p_id: id, p_duree: duree });
    setBusy(false);
    if (error) { alert(friendlyError(error, t)); return; }
    onCreated();
  }

  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>{L.new_btn}</h3>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#686F7D" }} aria-label="Fermer"><X size={18} /></button>
      </div>
      <Field label={L.f_title}><input style={inputStyle} value={titre} onChange={(e) => setTitre(e.target.value)} /></Field>
      <Field label={L.f_type}>
        <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="tontine">{L.type_tontine}</option>
          <option value="libre">{L.type_libre}</option>
        </select>
      </Field>
      {type === "tontine" && <p style={{ fontSize: 12, color: "#686F7D", margin: "-4px 0 10px" }}>{L.tontine_hint}</p>}
      {type === "libre" && (
        <Field label={L.f_nb}><input type="number" min={1} max={Math.max(ids.size, 1)} style={inputStyle} value={nb} onChange={(e) => setNb(e.target.value)} /></Field>
      )}
      <Field label={L.duration}>
        <DureeSelect L={L} value={duree} onChange={setDuree} />
        <p style={{ fontSize: 11.5, color: "#8A8F98", margin: "4px 0 0" }}>{L.duration_help}</p>
      </Field>
      <Field label={`${L.f_participants} — ${L.selected.replace("{n}", String(ids.size))}`}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button type="button" onClick={() => setIds(new Set(actifs.map((m) => m.id)))} style={{ fontSize: 12, background: "none", border: "1px solid #D5D9E0", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>{L.all}</button>
          <button type="button" onClick={() => setIds(new Set())} style={{ fontSize: 12, background: "none", border: "1px solid #D5D9E0", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>{L.none}</button>
        </div>
        <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #E4E7EC", borderRadius: 8, padding: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 4 }}>
          {actifs.map((m) => (
            <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 4px", cursor: "pointer" }}>
              <input type="checkbox" checked={ids.has(m.id)} onChange={() => toggle(m.id)} /> {m.nom}
            </label>
          ))}
        </div>
      </Field>
      <Btn onClick={preparer} disabled={busy || !titre.trim()}><Dices size={14} /> {L.prepare_btn}</Btn>
    </Card>
  );
}

export default function Tirages({ profile, isBureau, association }) {
  const { t, lang } = useLang();
  const L = TXT[lang === "en" ? "en" : "fr"];
  const [tirages, setTirages] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [son, setSon] = useState(false);

  const load = useCallback(async () => {
    const [{ data: tr }, { data: mb }] = await Promise.all([
      supabase.from("tirages").select("*").eq("association_id", profile.association_id).order("created_at", { ascending: false }),
      isBureau ? supabase.from("members").select("id, nom, statut").eq("association_id", profile.association_id).order("nom") : Promise.resolve({ data: [] }),
    ]);
    setTirages(tr || []);
    setMembers(mb || []);
    setLoading(false);
  }, [profile.association_id, isBureau]);
  useEffect(() => { load(); }, [load]);

  // Temps réel : chaque changement d'un tirage (lancement, numéro dévoilé,
  // fin) arrive sur tous les écrans ouverts. Le même canal compte, via la
  // « présence » Supabase, combien de membres ont la rubrique ouverte.
  useEffect(() => {
    const channel = supabase
      .channel(`tirages-${profile.association_id}`, { config: { presence: { key: profile.id } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "tirages", filter: `association_id=eq.${profile.association_id}` }, (payload) => {
        const row = payload.new;
        if (!row?.id) return;
        setTirages((prev) => (prev.some((x) => x.id === row.id) ? prev.map((x) => (x.id === row.id ? row : x)) : [row, ...prev]));
      })
      .on("presence", { event: "sync" }, () => setViewers(Object.keys(channel.presenceState()).length))
      .subscribe((status) => { if (status === "SUBSCRIBED") channel.track({ at: Date.now() }); });
    return () => { supabase.removeChannel(channel); };
  }, [profile.association_id, profile.id]);

  // Filet de sécurité si le temps réel est bloqué (réseau filtré, etc.) :
  // relecture toutes les 4 s tant qu'un tirage est en direct.
  const enDirect = tirages.some((x) => x.statut === "en_cours");
  useEffect(() => {
    if (!enDirect) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [enDirect, load]);

  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  const ordonnes = [...tirages].sort((a, b) => (a.statut === "en_cours" ? -1 : 0) - (b.statut === "en_cours" ? -1 : 0));

  return (
    <Container>
      <Section>
        <style>{`
          @keyframes tirage-pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
          .tirage-pulse { animation: tirage-pulse 1.1s ease-in-out infinite; }
          @keyframes tirage-land { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.12); opacity: 1 } 100% { transform: scale(1) } }
          .tirage-land { animation: tirage-land .55s ease-out; }
        `}</style>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <h2 style={{ fontSize: 22, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 10 }}><Dices size={22} /> {L.title}</h2>
            <p style={{ fontSize: 13, color: "#686F7D", margin: 0, maxWidth: 620 }}>{L.intro}</p>
          </div>
          {isBureau && !showForm && <Btn onClick={() => setShowForm(true)}><Plus size={14} /> {L.new_btn}</Btn>}
        </div>

        {enDirect && (
          <div style={{ background: RED, color: "white", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Radio size={16} className="tirage-pulse" /> {L.live_banner}
          </div>
        )}

        {showForm && isBureau && (
          <NouveauTirageForm L={L} t={t} members={members} onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); load(); }} />
        )}

        {ordonnes.length === 0 && !showForm && <p style={{ color: "#686F7D", fontStyle: "italic" }}>{L.empty}</p>}
        {ordonnes.map((x) => (
          <TirageCard key={x.id} tirage={x} L={L} lang={lang} t={t} isBureau={isBureau} onChanged={load}
            association={association} myMemberId={profile.member_id} viewers={viewers} son={son} setSon={setSon} />
        ))}
      </Section>
    </Container>
  );
}
