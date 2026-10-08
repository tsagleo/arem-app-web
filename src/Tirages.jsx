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
// =====================================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { Dices, Plus, X, Radio, ShieldCheck, Maximize2, Play, SkipForward, FastForward, Ban, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, inputStyle, useLang, friendlyError, formatEventDateTime, TEAL, TEAL_LIGHT, RED } from "./shared";

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
    cancel_btn: "Annuler",
    cancel_prompt: "Motif de l'annulation (obligatoire, visible par tous) :",
    fullscreen: "Plein écran",
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
    cancel_btn: "Cancel",
    cancel_prompt: "Reason for cancelling (required, visible to everyone):",
    fullscreen: "Full screen",
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
  },
};

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

// ---------- Scène du direct ----------
// Quand `revele` augmente (clic du bureau, reçu en temps réel), le dernier
// numéro « roule » parmi les noms encore en lice pendant ~2 s avant de se
// poser — même animation sur tous les écrans.
function LiveStage({ tirage, L, isBureau, onNext, onAll, busy }) {
  const stageRef = useRef(null);
  const ordre = [...(tirage.resultat || [])].sort((a, b) => a.position - b.position);
  const total = nbAReveler(tirage);
  const revele = tirage.revele;
  const [rolling, setRolling] = useState(null); // nom affiché pendant l'animation
  const dernierVu = useRef(revele);

  useEffect(() => {
    if (revele <= dernierVu.current) { dernierVu.current = revele; return; }
    dernierVu.current = revele;
    const enLice = ordre.slice(revele - 1).map((r) => r.nom);
    if (enLice.length <= 1) return;
    let i = 0;
    setRolling(enLice[0]);
    const timer = setInterval(() => {
      i += 1;
      setRolling(enLice[Math.floor(Math.random() * enLice.length)]);
      if (i >= 18) { clearInterval(timer); setRolling(null); }
    }, 110);
    return () => { clearInterval(timer); setRolling(null); };
    // ordre est dérivé de tirage.resultat, figé dès le lancement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revele]);

  const courant = revele > 0 ? ordre[revele - 1] : null;
  const visibles = ordre.slice(0, revele);
  const enDirect = tirage.statut === "en_cours";

  function pleinEcran() {
    const el = stageRef.current;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
  }

  return (
    <div ref={stageRef} style={{ background: "#0F1B2D", color: "white", borderRadius: 16, padding: "22px 20px", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatutPill statut={tirage.statut} L={L} />
          <span style={{ fontSize: 13, opacity: 0.75 }}>{L.remaining.replace("{n}", String(Math.max(total - revele, 0)))}</span>
        </div>
        <button onClick={pleinEcran} style={{ background: "rgba(255,255,255,.12)", color: "white", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Maximize2 size={13} /> {L.fullscreen}
        </button>
      </div>

      <div style={{ textAlign: "center", padding: "18px 0 26px" }}>
        {courant || rolling ? (
          <>
            <div style={{ fontSize: 15, letterSpacing: 2, opacity: 0.7, textTransform: "uppercase" }}>
              {tirage.type === "libre" ? L.winner : L.number} {revele}
            </div>
            <div key={rolling ? "r" : `n${revele}`} className={rolling ? "" : "tirage-land"} style={{ fontSize: "clamp(28px, 6vw, 52px)", fontWeight: 800, marginTop: 8, color: rolling ? "rgba(255,255,255,.55)" : "#F4D06F", minHeight: 64 }}>
              {rolling || courant.nom}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 16, opacity: 0.7 }}>{enDirect ? L.waiting_next : L.waiting_start}</div>
        )}
      </div>

      {isBureau && enDirect && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 }}>
          <Btn onClick={onNext} disabled={busy || !!rolling}><SkipForward size={14} /> {L.next_btn}</Btn>
          <Btn variant="outline" onClick={onAll} disabled={busy || !!rolling} style={{ color: "white", borderColor: "rgba(255,255,255,.35)" }}><FastForward size={14} /> {L.all_btn}</Btn>
        </div>
      )}

      {visibles.length > 0 && (
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
          {visibles.map((r) => (
            <li key={r.member_id} style={{ background: "rgba(255,255,255,.07)", borderRadius: 10, padding: "8px 12px", display: "flex", gap: 10, alignItems: "baseline", opacity: rolling && r.position === revele ? 0.35 : 1 }}>
              <span style={{ fontWeight: 800, color: "#F4D06F", minWidth: 28 }}>{r.position}</span>
              <span style={{ fontSize: 14 }}>{r.nom}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TirageCard({ tirage, L, lang, t, isBureau, onChanged }) {
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

  const lance = tirage.statut === "en_cours" || tirage.statut === "termine" || (tirage.statut === "annule" && tirage.resultat);

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
              <span key={p.member_id} style={{ fontSize: 12, background: TEAL_LIGHT, color: TEAL, borderRadius: 999, padding: "3px 10px" }}>{p.nom}</span>
            ))}
          </div>
          {isBureau && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn onClick={() => rpc("lancer_tirage", { p_id: tirage.id }, L.confirm_launch.replace("{titre}", tirage.titre))} disabled={busy}><Play size={14} /> {L.launch_btn}</Btn>
              <Btn variant="outline" onClick={annuler} disabled={busy}><Ban size={14} /> {L.cancel_btn}</Btn>
            </div>
          )}
        </>
      )}

      {lance && (
        <LiveStage
          tirage={tirage} L={L} isBureau={isBureau} busy={busy}
          onNext={() => rpc("reveler_suivant", { p_id: tirage.id })}
          onAll={() => rpc("reveler_tout", { p_id: tirage.id }, L.confirm_all)}
        />
      )}

      {tirage.statut === "en_cours" && isBureau && (
        <div style={{ marginTop: 10 }}>
          <button onClick={annuler} disabled={busy} style={{ background: "none", border: "none", color: RED, fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}>{L.cancel_btn}</button>
        </div>
      )}

      {tirage.graine && tirage.resultat && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Btn variant="outline" onClick={verifier}><ShieldCheck size={14} /> {L.verify_btn}</Btn>
          {verif === "ok" && <span style={{ fontSize: 12.5, color: TEAL, display: "inline-flex", gap: 6, alignItems: "flex-start", maxWidth: 560 }}><CheckCircle2 size={15} style={{ flexShrink: 0 }} /> {L.verify_ok}</span>}
          {verif === "ko" && <span style={{ fontSize: 12.5, color: RED, display: "inline-flex", gap: 6, alignItems: "center" }}><AlertTriangle size={15} /> {L.verify_ko}</span>}
          {verif === "unavailable" && <span style={{ fontSize: 12.5, color: "#686F7D" }}>{L.verify_unavailable}</span>}
        </div>
      )}
    </Card>
  );
}

function NouveauTirageForm({ L, t, members, onCreated, onClose }) {
  const actifs = members.filter((m) => m.statut === "Actif");
  const [titre, setTitre] = useState(`${L.f_title_default} ${new Date().getFullYear()}`);
  const [type, setType] = useState("tontine");
  const [nb, setNb] = useState(1);
  const [ids, setIds] = useState(() => new Set(actifs.map((m) => m.id)));
  const [busy, setBusy] = useState(false);

  function toggle(id) { setIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }

  async function preparer() {
    if (ids.size < 2) { alert(L.min_two); return; }
    if (!window.confirm(L.confirm_prepare.replace("{titre}", titre.trim()).replace("{n}", String(ids.size)))) return;
    setBusy(true);
    const { error } = await supabase.rpc("preparer_tirage", { p_titre: titre.trim(), p_type: type, p_member_ids: [...ids], p_nb_gagnants: Number(nb) || 1 });
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

export default function Tirages({ profile, isBureau }) {
  const { t, lang } = useLang();
  const L = TXT[lang === "en" ? "en" : "fr"];
  const [tirages, setTirages] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

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
  // fin) arrive sur tous les écrans ouverts. Filet de sécurité : si un
  // tirage est en direct, on relit aussi toutes les 4 s, au cas où le
  // temps réel serait bloqué (réseau d'entreprise, etc.).
  useEffect(() => {
    const channel = supabase
      .channel(`tirages-${profile.association_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tirages", filter: `association_id=eq.${profile.association_id}` }, (payload) => {
        const row = payload.new;
        if (!row?.id) return;
        setTirages((prev) => (prev.some((x) => x.id === row.id) ? prev.map((x) => (x.id === row.id ? row : x)) : [row, ...prev]));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile.association_id]);

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
          <TirageCard key={x.id} tirage={x} L={L} lang={lang} t={t} isBureau={isBureau} onChanged={load} />
        ))}
      </Section>
    </Container>
  );
}
