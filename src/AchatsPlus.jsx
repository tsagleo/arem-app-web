// =====================================================================
// AchatsPlus.jsx — achats groupés « nouvelle génération » (2026-10-10)
// =====================================================================
// Demandé par l'utilisateur après ses tests (« on ne sait pas quoi faire
// ensuite », « le scan ne prend pas », fiches en double…) :
//   • FriseAchat : les 7 étapes et « À vous de jouer » selon le rôle ;
//   • SondagePanel, DevisPanel : sondage d'intérêt, devis comparés et votés ;
//   • CreneauxPanel, SuiviPanel, AvisPanel : retrait, expédition, avis ;
//   • FacturePanel, LimitePaiementPanel, PayerCarte : argent ;
//   • RemiseVisuelle : confirmation de remise en grand (photo, son, vibration) ;
//   • DoublonsMembres : détection et fusion des fiches en double (Adhérents).
// Base : sql/2026-10-10p_achats_nouvelle_generation.sql.
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, Circle, ArrowRight, Users, FileText, Truck, Star, CalendarClock, CreditCard, Plus, Trash2, ThumbsUp, Award, Copy } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Card, Btn, Field, inputStyle, friendlyError, money, formatEventDateTime, toDatetimeLocal, datetimeLocalToISO, TEAL, TEAL_LIGHT, RED, useLang } from "./shared";
import { toast } from "./achatsOutils";

const MUTED = "#686F7D";
const AMBER = "#B7791F";
const fill = (s, v) => Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(String(x)), s || "");
const errTxt = (e, t) => (e?.code === "P0001" && e.message ? e.message : friendlyError(e, t));
const petit = { padding: "5px 11px", fontSize: 12 };
const titreH4 = { margin: "0 0 8px", fontSize: 14.5, display: "flex", alignItems: "center", gap: 6 };

// Chaque action réussie est confirmée à l'écran (message vert), chaque
// échec affiché en rouge avec son motif.
const OK_PAR_DEFAUT = { fr: "✓ Enregistré", en: "✓ Saved" };
function useRpc(t, onReload) {
  const { lang } = useLang();
  const [busy, setBusy] = useState(false);
  return [busy, async (fn, args, confirmMsg, okMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return null;
    setBusy(true);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { toast(errTxt(error, t), true); return null; }
    toast(okMsg || OK_PAR_DEFAUT[lang === "en" ? "en" : "fr"]);
    onReload?.();
    return data ?? true;
  }];
}

// =====================================================================
// Frise des étapes + prochaine action
// =====================================================================
const ORDRE = { sondage: 0, propose: 0, ouvert: 1, confirme: 2, commande: 3, livre: 4, cloture: 6 };
export function FriseAchat({ L, a, maSous, sous, mouvements, gestionnaire, isBureau, profile, devise, aPayer }) {
  const etape = a.statut === "livre" && a.bilan_saisi_le ? 5 : ORDRE[a.statut] ?? 0;
  const retenus = sous.filter((s) => s.statut === "retenu");
  const aValiderParMoi = mouvements.filter((m) => m.achat_id === a.id && m.statut === "recu" && m.recu_par !== profile.id && m.member_id !== profile.member_id).length;
  const impayes = retenus.filter((s) => s.impaye).length;
  let msg = "";
  if (a.statut === "annule" || a.statut === "refuse") msg = L.n_annule;
  else if (a.statut === "sondage") msg = gestionnaire ? L.n_sondage_g : L.n_sondage_m;
  else if (a.statut === "propose") msg = isBureau ? L.n_propose_g : L.n_propose_m;
  else if (a.statut === "ouvert") msg = gestionnaire ? L.n_ouvert_g : maSous?.statut === "inscrit" ? L.n_ouvert_inscrit : L.n_ouvert_m;
  else if (a.statut === "confirme") msg = gestionnaire ? (impayes > 0 ? fill(L.n_confirme_g, { n: impayes }) : L.n_confirme_g_ok) : aPayer > 0 ? fill(L.n_confirme_m, { m: money(aPayer, devise) }) : L.n_confirme_ok;
  else if (a.statut === "commande") msg = gestionnaire ? L.n_commande_g : L.n_commande_m;
  else if (a.statut === "livre") msg = a.bilan_saisi_le && isBureau ? L.n_bilan_attente : gestionnaire ? L.n_livre_g : L.n_livre_m;
  else if (a.statut === "cloture") msg = L.n_cloture;
  const annule = a.statut === "annule" || a.statut === "refuse";
  return (
    <Card style={{ marginBottom: 16, padding: 16 }}>
      {!annule && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, overflowX: "auto", paddingBottom: 6 }}>
          {L.etapes.map((lib, i) => (
            <div key={lib} style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 92 }}>
                {i < etape ? <CheckCircle2 size={20} color={TEAL} /> : i === etape ? <Circle size={20} color="var(--primary)" fill="var(--primary)" /> : <Circle size={20} color="#C8CDD6" />}
                <span style={{ fontSize: 10.5, textAlign: "center", marginTop: 3, fontWeight: i === etape ? 700 : 500, color: i <= etape ? "#222" : MUTED }}>{lib}</span>
              </div>
              {i < L.etapes.length - 1 && <div style={{ width: 18, height: 2, background: i < etape ? TEAL : "#DDE1E7", marginBottom: 14 }} />}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: annule ? "#FBE4E1" : "#EEF5FB", borderRadius: 10, padding: "10px 12px", marginTop: annule ? 0 : 8 }}>
        <ArrowRight size={18} color={annule ? RED : "var(--primary)"} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: ".05em" }}>{L.next_title}</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{msg}</div>
          {isBureau && aValiderParMoi > 0 && <div style={{ fontSize: 13, color: AMBER, fontWeight: 600, marginTop: 3 }}>⚖️ {fill(L.n_valider, { n: aValiderParMoi })}</div>}
        </div>
      </div>
    </Card>
  );
}

// =====================================================================
// Sondage d'intérêt
// =====================================================================
export function SondagePanel({ L, t, a, u, isBureau, gestionnaire, profile, aucuneSouscription, onReload }) {
  const [totaux, setTotaux] = useState(null);
  const [liste, setListe] = useState([]);
  const [qte, setQte] = useState("");
  const [date, setDate] = useState("");
  const [mode, setMode] = useState("priorite");
  const [heures, setHeures] = useState(48);
  const charger = useCallback(async () => {
    const [{ data: tt }, { data: li }] = await Promise.all([
      supabase.rpc("achats_interets_totaux"),
      supabase.from("achats_interets").select("*").eq("achat_id", a.id).order("created_at"),
    ]);
    setTotaux((tt || []).find((x) => x.achat_id === a.id) || { nb: 0, total: 0 });
    setListe(li || []);
  }, [a.id]);
  const [busy, rpc] = useRpc(t, () => { charger(); onReload(); });
  useEffect(() => { if (a.statut === "sondage") charger(); }, [a.statut, charger]);

  if (a.statut !== "sondage") {
    if (isBureau && ["propose", "ouvert"].includes(a.statut) && aucuneSouscription) {
      return <div style={{ marginBottom: 16 }}><Btn variant="outline" disabled={busy} onClick={() => rpc("achats_passer_en_sondage", { p_id: a.id }, L.sd_launch_confirm)}>📊 {L.sd_launch}</Btn></div>;
    }
    return null;
  }
  const mine = liste.find((x) => x.member_id === profile.member_id);
  return (
    <Card style={{ marginBottom: 16, borderTopColor: AMBER }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>📊 {L.sd_title}</h3>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 10px" }}>{L.sd_help}</p>
      {totaux && <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>{fill(L.sd_total, { n: totaux.nb || 0, q: Number(totaux.total || 0), u, s: Number(a.seuil_min) })}</p>}
      {profile.member_id && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          {mine && <span style={{ fontSize: 13, color: TEAL, fontWeight: 700, marginBottom: 14 }}>{fill(L.sd_mine, { q: Number(mine.quantite), u })}</span>}
          <div style={{ width: 160 }}><Field label={L.sd_qty}><input type="number" min="0" step="any" style={inputStyle} value={qte} onChange={(e) => setQte(e.target.value)} placeholder={mine ? String(Number(mine.quantite)) : ""} /></Field></div>
          <div style={{ marginBottom: 14, display: "flex", gap: 8 }}>
            <Btn disabled={busy || !(Number(qte) > 0)} onClick={async () => { if (await rpc("achats_declarer_interet", { p_id: a.id, p_quantite: Number(qte) })) setQte(""); }}>{L.sd_save}</Btn>
            {mine && <Btn variant="outline" disabled={busy} onClick={() => rpc("achats_declarer_interet", { p_id: a.id, p_quantite: 0 })}>{L.sd_remove}</Btn>}
          </div>
        </div>
      )}
      {gestionnaire && liste.length > 0 && <p style={{ fontSize: 12.5, color: MUTED, margin: "4px 0 10px" }}><Users size={12} /> {L.sd_list} : {liste.map((x) => `${x.member_nom} (${Number(x.quantite)})`).join(", ")}</p>}
      {isBureau && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px solid #EEF0F3", paddingTop: 10 }}>
          <div style={{ width: 240 }}><Field label={L.sd_deadline}><input type="datetime-local" style={inputStyle} min={toDatetimeLocal(new Date().toISOString())} value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
          <div style={{ width: 280 }}><Field label={L.ac_mode}><select style={inputStyle} value={mode} onChange={(e) => setMode(e.target.value)}><option value="priorite">{L.ac_priorite}</option><option value="tous">{L.ac_tous}</option><option value="reserve">{L.ac_reserve}</option></select></Field></div>
          {mode === "priorite" && <div style={{ width: 150 }}><Field label={L.ac_hours}><input type="number" min="1" style={inputStyle} value={heures} onChange={(e) => setHeures(e.target.value)} /></Field></div>}
          <div style={{ marginBottom: 14 }}><Btn disabled={busy || !date} onClick={() => rpc("achats_ouvrir_souscriptions", { p_id: a.id, p_date_limite: datetimeLocalToISO(date), p_mode: mode, p_heures: Number(heures) || 48 })}>{L.sd_open}</Btn></div>
        </div>
      )}
    </Card>
  );
}

// =====================================================================
// Devis comparés
// =====================================================================
export function DevisPanel({ L, t, a, u, devise, isBureau, gestionnaire, profile, aucuneSouscription, onReload }) {
  const [devis, setDevis] = useState([]);
  const [votes, setVotes] = useState([]);
  const [f, setF] = useState(null);
  const charger = useCallback(async () => {
    const [{ data: d }, { data: v }] = await Promise.all([
      supabase.from("achats_devis").select("*").eq("achat_id", a.id).order("prix_unitaire"),
      supabase.from("achats_devis_votes").select("devis_id, member_id").eq("achat_id", a.id),
    ]);
    setDevis(d || []); setVotes(v || []);
  }, [a.id]);
  const [busy, rpc] = useRpc(t, () => { charger(); onReload(); });
  useEffect(() => { charger(); }, [charger]);
  // Devis figés dès qu'un membre a souscrit (sql/2026-10-10r).
  const modifiable = ["sondage", "propose"].includes(a.statut) || (a.statut === "ouvert" && aucuneSouscription);
  if (!modifiable && devis.length === 0) return null;
  if (!gestionnaire && devis.length === 0) return null;
  const monVote = votes.find((v) => v.member_id === profile.member_id)?.devis_id;
  const coutTotal = (d) => Number(d.prix_unitaire) * Number(a.seuil_min) + Number(d.frais);
  const moinsCher = devis.length > 1 ? devis.reduce((m, d) => (coutTotal(d) < coutTotal(m) ? d : m), devis[0]).id : null;
  return (
    <Card style={{ marginBottom: 16 }}>
      <h4 style={titreH4}><FileText size={15} /> {L.dv_title}</h4>
      {devis.length === 0 && <p style={{ fontSize: 13, color: MUTED, fontStyle: "italic" }}>{L.dv_empty}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {devis.map((d) => {
          const n = votes.filter((v) => v.devis_id === d.id).length;
          return (
            <div key={d.id} style={{ border: d.retenu ? `2px solid ${TEAL}` : "1px solid #E4E7EC", borderRadius: 10, padding: 12, background: d.retenu ? TEAL_LIGHT : "white" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}><b>{d.fournisseur}</b>{d.retenu && <span style={{ fontSize: 11, fontWeight: 700, color: TEAL }}>✓ {L.dv_kept}</span>}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--primary)" }}>{money(d.prix_unitaire, devise)} <span style={{ fontSize: 11.5, color: MUTED, fontWeight: 500 }}>/ {u}</span></div>
              <div style={{ fontSize: 12, color: MUTED }}>{L.dv_fees} : {money(d.frais, devise)}{d.delai ? ` · ${L.dv_delay} : ${d.delai}` : ""}</div>
              {moinsCher === d.id && <div style={{ fontSize: 11.5, fontWeight: 700, color: TEAL, marginTop: 2 }}>💰 {L.dv_cheapest}</div>}
              {d.note && <div style={{ fontSize: 12, marginTop: 4 }}>{d.note}</div>}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                {modifiable && profile.member_id && <Btn variant={monVote === d.id ? undefined : "outline"} style={petit} disabled={busy} onClick={() => rpc("achats_voter_devis", { p_devis: d.id })}><ThumbsUp size={12} /> {L.dv_vote}</Btn>}
                <span style={{ fontSize: 12, color: MUTED }}>{fill(L.dv_votes, { n })}</span>
                {isBureau && modifiable && !d.retenu && <Btn style={petit} disabled={busy} onClick={() => rpc("achats_retenir_devis", { p_devis: d.id }, L.dv_keep_confirm)}>{L.dv_keep}</Btn>}
                {gestionnaire && modifiable && !d.retenu && <button style={{ background: "none", border: "none", color: RED, cursor: "pointer" }} onClick={() => rpc("achats_supprimer_devis", { p_devis: d.id })}><Trash2 size={13} /></button>}
              </div>
            </div>
          );
        })}
      </div>
      {gestionnaire && modifiable && (f ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0 10px", marginTop: 12, alignItems: "end" }}>
          <Field label={L.dv_supplier}><input style={inputStyle} value={f.fournisseur} onChange={(e) => setF({ ...f, fournisseur: e.target.value })} /></Field>
          <Field label={L.dv_price}><input type="number" min="0" step="0.01" style={inputStyle} value={f.prix} onChange={(e) => setF({ ...f, prix: e.target.value })} /></Field>
          <Field label={L.dv_fees}><input type="number" min="0" step="0.01" style={inputStyle} value={f.frais} onChange={(e) => setF({ ...f, frais: e.target.value })} /></Field>
          <Field label={L.dv_delay}><input style={inputStyle} value={f.delai} onChange={(e) => setF({ ...f, delai: e.target.value })} /></Field>
          <Field label={L.dv_note}><input style={inputStyle} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          <div style={{ marginBottom: 14, display: "flex", gap: 6 }}>
            <Btn style={petit} disabled={busy || !f.fournisseur.trim() || !(Number(f.prix) > 0)} onClick={async () => { if (await rpc("achats_ajouter_devis", { p_id: a.id, p_fournisseur: f.fournisseur, p_prix: Number(f.prix), p_frais: Number(f.frais) || 0, p_delai: f.delai, p_note: f.note })) setF(null); }}>{L.dv_add}</Btn>
            <Btn variant="outline" style={petit} onClick={() => setF(null)}>✕</Btn>
          </div>
        </div>
      ) : <Btn variant="outline" style={{ ...petit, marginTop: 10 }} onClick={() => setF({ fournisseur: "", prix: "", frais: "", delai: "", note: "" })}><Plus size={12} /> {L.dv_add}</Btn>)}
    </Card>
  );
}

// =====================================================================
// Créneaux et lieux de retrait
// =====================================================================
export function CreneauxPanel({ L, t, lang, a, gestionnaire, maSous, sous, onReload }) {
  const [creneaux, setCreneaux] = useState([]);
  const [f, setF] = useState(null);
  const charger = useCallback(async () => {
    const { data } = await supabase.from("achats_creneaux").select("*").eq("achat_id", a.id).order("debut");
    setCreneaux(data || []);
  }, [a.id]);
  const [busy, rpc] = useRpc(t, () => { charger(); onReload(); });
  useEffect(() => { charger(); }, [charger]);
  const pertinent = ["confirme", "commande", "livre"].includes(a.statut);
  if (!pertinent && creneaux.length === 0) return null;
  if (!gestionnaire && maSous?.statut !== "retenu") return null;
  if (!gestionnaire && creneaux.length === 0) return null;
  const heure = (d) => new Date(d).toLocaleTimeString(lang === "en" ? "en-CA" : "fr-CA", { hour: "2-digit", minute: "2-digit" });
  return (
    <Card style={{ marginBottom: 16 }}>
      <h4 style={titreH4}><CalendarClock size={15} /> {L.cr_title}</h4>
      {creneaux.length === 0 && <p style={{ fontSize: 13, color: MUTED, fontStyle: "italic" }}>{L.cr_empty}</p>}
      {creneaux.map((c) => {
        const n = sous.filter((s) => s.creneau_id === c.id).length;
        const plein = c.capacite && n >= c.capacite;
        const moi = maSous?.creneau_id === c.id;
        return (
          <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid #EEF0F3", flexWrap: "wrap", fontSize: 13 }}>
            <b style={{ minWidth: 200 }}>{formatEventDateTime(c.debut, lang)} – {heure(c.fin)}</b>
            <span style={{ flex: 1 }}>📍 {c.lieu}</span>
            <span style={{ fontSize: 12, color: MUTED }}>{fill(L.cr_count, { n })}{c.capacite ? ` / ${c.capacite}` : ""}</span>
            {maSous?.statut === "retenu" && !maSous.remis_le && (moi
              ? <span style={{ fontWeight: 700, color: TEAL }}>✓ {L.cr_chosen}</span>
              : <Btn style={petit} disabled={busy || plein} onClick={() => rpc("achats_choisir_creneau", { p_id: a.id, p_creneau: c.id })}>{plein ? L.cr_full : L.cr_choose}</Btn>)}
            {gestionnaire && <button style={{ background: "none", border: "none", color: RED, cursor: "pointer" }} onClick={() => rpc("achats_supprimer_creneau", { p_creneau: c.id })}><Trash2 size={13} /></button>}
          </div>
        );
      })}
      {gestionnaire && (f ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0 10px", marginTop: 10, alignItems: "end" }}>
          <Field label={L.cr_place}><input style={inputStyle} value={f.lieu} onChange={(e) => setF({ ...f, lieu: e.target.value })} /></Field>
          <Field label={L.cr_start}><input type="datetime-local" style={inputStyle} value={f.debut} onChange={(e) => setF({ ...f, debut: e.target.value })} /></Field>
          <Field label={L.cr_end}><input type="datetime-local" style={inputStyle} value={f.fin} onChange={(e) => setF({ ...f, fin: e.target.value })} /></Field>
          <Field label={L.cr_cap}><input type="number" min="1" style={inputStyle} value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value })} /></Field>
          <div style={{ marginBottom: 14, display: "flex", gap: 6 }}>
            <Btn style={petit} disabled={busy || !f.lieu.trim() || !f.debut || !f.fin} onClick={async () => { if (await rpc("achats_ajouter_creneau", { p_id: a.id, p_lieu: f.lieu, p_debut: datetimeLocalToISO(f.debut), p_fin: datetimeLocalToISO(f.fin), p_capacite: Number(f.cap) || 0 })) setF(null); }}>{L.cr_add}</Btn>
            <Btn variant="outline" style={petit} onClick={() => setF(null)}>✕</Btn>
          </div>
        </div>
      ) : <Btn variant="outline" style={{ ...petit, marginTop: 10 }} onClick={() => setF({ lieu: a.porteur_nom ? "" : "", debut: "", fin: "", cap: "" })}><Plus size={12} /> {L.cr_add}</Btn>)}
    </Card>
  );
}

// =====================================================================
// Suivi d'expédition
// =====================================================================
export function SuiviPanel({ L, t, lang, a, gestionnaire, onReload }) {
  const [etapes, setEtapes] = useState([]);
  const [f, setF] = useState({ etape: "", lieu: "", note: "", numero: a.suivi_numero || "", transporteur: a.suivi_transporteur || "" });
  const charger = useCallback(async () => {
    const { data } = await supabase.from("achats_suivi").select("*").eq("achat_id", a.id).order("created_at", { ascending: false });
    setEtapes(data || []);
  }, [a.id]);
  const [busy, rpc] = useRpc(t, () => { charger(); onReload(); });
  useEffect(() => { charger(); }, [charger]);
  if (!["confirme", "commande", "livre", "cloture"].includes(a.statut)) return null;
  if (!gestionnaire && etapes.length === 0 && !a.suivi_numero) return null;
  return (
    <Card style={{ marginBottom: 16 }}>
      <h4 style={titreH4}><Truck size={15} /> {L.sv_title}</h4>
      {(a.suivi_numero || a.suivi_transporteur) && <p style={{ fontSize: 13, margin: "0 0 8px" }}>{a.suivi_transporteur && <b>{a.suivi_transporteur}</b>}{a.suivi_numero && <> · {L.sv_number} : <code>{a.suivi_numero}</code></>}</p>}
      {etapes.length === 0 && <p style={{ fontSize: 13, color: MUTED, fontStyle: "italic" }}>{L.sv_empty}</p>}
      <div style={{ borderLeft: `3px solid ${TEAL}`, paddingLeft: 12, marginLeft: 4 }}>
        {etapes.map((e, i) => (
          <div key={e.id} style={{ marginBottom: 10, position: "relative" }}>
            <span style={{ position: "absolute", left: -19, top: 3, width: 11, height: 11, borderRadius: "50%", background: i === 0 ? TEAL : "#C8CDD6" }} />
            <div style={{ fontSize: 13.5, fontWeight: i === 0 ? 700 : 600 }}>{e.etape}{e.lieu ? ` — ${e.lieu}` : ""}</div>
            <div style={{ fontSize: 11.5, color: MUTED }}>{formatEventDateTime(e.created_at, lang)}{e.note ? ` · ${e.note}` : ""}</div>
          </div>
        ))}
      </div>
      {gestionnaire && a.statut !== "cloture" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0 10px", marginTop: 10, alignItems: "end" }}>
          <Field label={L.sv_carrier}><input style={inputStyle} value={f.transporteur} onChange={(e) => setF({ ...f, transporteur: e.target.value })} /></Field>
          <Field label={L.sv_number}><input style={inputStyle} value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} /></Field>
          <Field label={L.sv_step}><input style={inputStyle} value={f.etape} onChange={(e) => setF({ ...f, etape: e.target.value })} /></Field>
          <Field label={L.sv_place}><input style={inputStyle} value={f.lieu} onChange={(e) => setF({ ...f, lieu: e.target.value })} /></Field>
          <div style={{ marginBottom: 14 }}><Btn style={petit} disabled={busy || !(f.etape.trim() || f.numero.trim() || f.transporteur.trim())} onClick={async () => {
            if (await rpc("achats_ajouter_suivi", { p_id: a.id, p_etape: f.etape, p_lieu: f.lieu, p_note: f.note, p_numero: f.numero, p_transporteur: f.transporteur })) setF({ ...f, etape: "", lieu: "", note: "" });
          }}>{L.sv_add}</Btn></div>
        </div>
      )}
    </Card>
  );
}

// =====================================================================
// Avis sur le fournisseur
// =====================================================================
export function NoteFournisseur({ L, fournisseur }) {
  const [res, setRes] = useState(null);
  useEffect(() => {
    let annule = false;
    if (!fournisseur) return undefined;
    supabase.from("achats_avis").select("note_qualite, note_delai").eq("fournisseur", fournisseur).then(({ data }) => {
      if (annule || !data?.length) return;
      const moy = (k) => (data.reduce((s, x) => s + x[k], 0) / data.length).toFixed(1);
      setRes({ q: moy("note_qualite"), d: moy("note_delai"), n: data.length });
    });
    return () => { annule = true; };
  }, [fournisseur]);
  if (!res) return null;
  return <span style={{ fontSize: 12, color: AMBER, fontWeight: 600 }}><Star size={11} fill={AMBER} /> {fill(L.av_summary, { f: fournisseur, q: res.q, d: res.d, n: res.n })}</span>;
}

export function AvisPanel({ L, t, a, maSous, onReload }) {
  const [f, setF] = useState({ q: 5, d: 5, c: "" });
  const [envoye, setEnvoye] = useState(false);
  const [busy, rpc] = useRpc(t, onReload);
  if (!["livre", "cloture"].includes(a.statut) || maSous?.statut !== "retenu") return null;
  const sel = (k) => <select style={{ ...inputStyle, width: 120 }} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}</select>;
  return (
    <Card style={{ marginBottom: 16 }}>
      <h4 style={titreH4}><Star size={15} /> {L.av_title}{a.fournisseur ? ` — ${a.fournisseur}` : ""}</h4>
      {envoye ? <p style={{ color: TEAL, fontWeight: 600, fontSize: 13 }}>{L.av_mine}</p> : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label={L.av_quality}>{sel("q")}</Field>
          <Field label={L.av_delay}>{sel("d")}</Field>
          <div style={{ flex: 1, minWidth: 200 }}><Field label={L.av_comment}><input style={inputStyle} value={f.c} onChange={(e) => setF({ ...f, c: e.target.value })} /></Field></div>
          <div style={{ marginBottom: 14 }}><Btn style={petit} disabled={busy} onClick={async () => { if (await rpc("achats_donner_avis", { p_id: a.id, p_qualite: f.q, p_delai: f.d, p_commentaire: f.c })) setEnvoye(true); }}>{L.av_send}</Btn></div>
        </div>
      )}
    </Card>
  );
}

// =====================================================================
// Argent : facture, date limite, carte
// =====================================================================
export function FacturePanel({ L, t, a, gestionnaire, profile, onReload }) {
  const [busy, setBusy] = useState(false);
  async function joindre(file) {
    if (!file) return;
    setBusy(true);
    const path = `${profile.association_id}/${a.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabase.storage.from("achats-factures").upload(path, file);
    if (error) { setBusy(false); alert(errTxt(error, t)); return; }
    const { error: e2 } = await supabase.rpc("achats_joindre_facture", { p_id: a.id, p_path: path });
    setBusy(false);
    if (e2) { alert(errTxt(e2, t)); return; }
    onReload();
  }
  async function voir() {
    const { data, error } = await supabase.storage.from("achats-factures").createSignedUrl(a.facture_path, 300);
    if (error) { alert(errTxt(error, t)); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "8px 0 12px", padding: 10, background: "#F7F8FA", borderRadius: 10 }}>
      <FileText size={15} />
      <b style={{ fontSize: 13 }}>{L.fa_title}</b>
      {a.facture_path ? <Btn variant="outline" style={petit} onClick={voir}>{L.fa_see}</Btn> : <span style={{ fontSize: 12.5, color: MUTED }}>{L.fa_none}</span>}
      {gestionnaire && a.statut !== "cloture" && (
        <label style={{ fontSize: 12, fontWeight: 600, color: TEAL, border: `1px solid ${TEAL}`, borderRadius: 999, padding: "5px 11px", cursor: busy ? "wait" : "pointer" }}>
          {L.fa_add}<input type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => joindre(e.target.files?.[0])} />
        </label>
      )}
    </div>
  );
}

export function LimitePaiementPanel({ L, t, lang, a, gestionnaire, onReload }) {
  const [d, setD] = useState(a.date_limite_paiement ? toDatetimeLocal(a.date_limite_paiement) : "");
  const [busy, rpc] = useRpc(t, onReload);
  if (a.statut !== "confirme") return null;
  if (!gestionnaire) return a.date_limite_paiement ? <p style={{ fontSize: 13.5, fontWeight: 700, color: AMBER, margin: "0 0 12px" }}>⏰ {fill(L.lp_current, { d: formatEventDateTime(a.date_limite_paiement, lang) })}</p> : null;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", margin: "8px 0 12px", padding: 10, background: "#FDF8EE", borderRadius: 10 }}>
      <div style={{ width: 240 }}><Field label={`⏰ ${L.lp_title}`}><input type="datetime-local" style={inputStyle} value={d} onChange={(e) => setD(e.target.value)} /></Field></div>
      <div style={{ marginBottom: 14 }}><Btn style={petit} disabled={busy || !d} onClick={() => rpc("achats_fixer_limite_paiement", { p_id: a.id, p_date: datetimeLocalToISO(d) }, null, "✓ " + fill(L.lp_done, { d: formatEventDateTime(datetimeLocalToISO(d), lang) }))}>{L.lp_set}</Btn></div>
      {a.date_limite_paiement && <p style={{ fontSize: 13, fontWeight: 700, color: TEAL, margin: "0 0 14px", width: "100%" }}>✓ {fill(L.lp_done, { d: formatEventDateTime(a.date_limite_paiement, lang) })}</p>}
      <p style={{ fontSize: 12, color: MUTED, margin: "0 0 14px", flex: 1, minWidth: 200 }}>{L.lp_help}</p>
    </div>
  );
}

export function PayerCarte({ L, t, a }) {
  const [busy, setBusy] = useState(false);
  async function payer() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", { body: { type: "achat_groupe", achat_id: a.id } });
      if (error) throw error;
      if (data?.error) { alert(data.error); return; }
      if (data?.url) { window.location.href = data.url; return; }
    } catch (e) { alert(errTxt(e, t)); } finally { setBusy(false); }
  }
  return <Btn variant="outline" disabled={busy} onClick={payer}><CreditCard size={14} /> {busy ? L.pay_card_redirect : L.pay_card}</Btn>;
}

// =====================================================================
// Remise : confirmation visuelle (photo en grand, son, vibration)
// =====================================================================
export function RemiseVisuelle({ L, remise }) {
  if (!remise) return null;
  const ok = !remise.tone;
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 12, padding: 14, borderRadius: 14, background: ok ? TEAL_LIGHT : "#FDF3E1", border: `2px solid ${ok ? TEAL : AMBER}` }}>
      {remise.photo_url ? <img src={remise.photo_url} alt="" style={{ width: 74, height: 74, borderRadius: 12, objectFit: "cover" }} />
        : <div style={{ width: 74, height: 74, borderRadius: 12, background: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>{ok ? <CheckCircle2 size={36} color={TEAL} /> : <Award size={30} color={AMBER} />}</div>}
      <div>
        <div style={{ fontSize: 19, fontWeight: 800, color: ok ? TEAL : AMBER }}>{remise.text}</div>
        {remise.proxy && <div style={{ fontSize: 13.5, marginTop: 2 }}>{fill(L.rm_by_proxy, { nom: remise.proxy })}</div>}
      </div>
    </div>
  );
}

// =====================================================================
// Fiches en double (Adhérents)
// =====================================================================
export function DoublonsMembres({ L, t, lang, onMerged }) {
  const [paires, setPaires] = useState([]);
  const [busy, setBusy] = useState(false);
  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc("membres_doublons");
    if (!error) setPaires(data || []);
  }, []);
  useEffect(() => { charger(); }, [charger]);
  async function fusionner(garder, retirer, nomG, nomR) {
    if (!window.confirm(fill(L.db_confirm, { g: nomG, r: nomR }))) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("fusionner_fiches_membres", { p_garder: garder, p_retirer: retirer });
    setBusy(false);
    if (error) { alert(errTxt(error, t)); return; }
    alert(fill(L.db_done, { n: (data || []).reduce((s, x) => s + Number(x.transferes || 0), 0) }));
    charger(); onMerged?.();
  }
  if (paires.length === 0) return null;
  const d = (x) => new Date(x).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA");
  return (
    <Card style={{ marginBottom: 16, borderTop: `3px solid ${AMBER}` }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15, display: "flex", gap: 8, alignItems: "center" }}><Copy size={16} color={AMBER} /> {L.db_title} · {paires.length}</h3>
      <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 10px" }}>{L.db_help}</p>
      {paires.map((p) => (
        <div key={p.id_a + p.id_b} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "10px 0", borderTop: "1px solid #EEF0F3" }}>
          {[["a", "b"], ["b", "a"]].map(([x, y]) => (
            <div key={x} style={{ background: "#F7F8FA", borderRadius: 10, padding: 10 }}>
              <b style={{ fontSize: 13.5 }}>{p["nom_" + x]}</b>
              <div style={{ fontSize: 12, color: MUTED }}>{p["email_" + x] || "—"} · {fill(L.db_created, { d: d(p["cree_" + x]) })}</div>
              <Btn style={{ ...petit, marginTop: 6 }} disabled={busy} onClick={() => fusionner(p["id_" + x], p["id_" + y], p["nom_" + x], p["nom_" + y])}>{L.db_keep}</Btn>
            </div>
          ))}
          <div style={{ gridColumn: "1 / -1", fontSize: 11.5, color: AMBER, fontWeight: 600 }}>{L["db_reason_" + p.raison]}</div>
        </div>
      ))}
    </Card>
  );
}


// =====================================================================
// Accès aux souscriptions après le sondage : bandeau, rattrapage, retour
// arrière (sql/2026-10-10q). onAcces(peutSouscrire, quantiteProposee).
// =====================================================================
export function AccesPanel({ L, t, lang, a, isBureau, gestionnaire, profile, aucunInscrit, onAcces, onReload }) {
  const [interets, setInterets] = useState([]);
  const [qte, setQte] = useState("");
  const charger = useCallback(async () => {
    const { data } = await supabase.from("achats_interets").select("*").eq("achat_id", a.id);
    setInterets(data || []);
  }, [a.id]);
  const [busy, rpc] = useRpc(t, () => { charger(); onReload(); });
  useEffect(() => { if (a.statut === "ouvert") charger(); }, [a.statut, charger]);
  const mode = a.acces_mode || "tous";
  const prioriteActive = mode === "priorite" && a.priorite_jusqu_au && new Date(a.priorite_jusqu_au) > new Date();
  const restreint = mode === "reserve" || prioriteActive;
  const mien = interets.find((x) => x.member_id === profile.member_id);
  const accepte = !!mien?.accepte;
  useEffect(() => { onAcces?.(!restreint || accepte, mien?.accepte ? Number(mien.quantite) : null); }, [restreint, accepte, mien, onAcces]);
  if (a.statut !== "ouvert") return null;
  // Personne ne statue sur sa propre demande.
  const demandes = interets.filter((x) => x.tardif && !x.accepte && x.member_id !== profile.member_id);
  if (!restreint && !isBureau) return null;
  return (
    <Card style={{ marginBottom: 16, borderTopColor: restreint ? "#6B3FA0" : TEAL }}>
      {restreint && (
        <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: "#6B3FA0" }}>
          🔒 {mode === "reserve" ? L.ac_banner_reserve : fill(L.ac_banner_priorite, { d: formatEventDateTime(a.priorite_jusqu_au, lang) })}
        </p>
      )}
      {restreint && profile.member_id && (accepte
        ? <p style={{ fontSize: 13, color: TEAL, fontWeight: 600, margin: "0 0 6px" }}>✓ {L.ac_accepted}</p>
        : mien ? <p style={{ fontSize: 13, color: AMBER, fontWeight: 600, margin: "0 0 6px" }}>⏳ {L.ac_pending}</p>
          : (
            <div style={{ marginBottom: 6 }}>
              <p style={{ fontSize: 13, margin: "0 0 6px" }}>{L.ac_ask}</p>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ width: 160 }}><Field label={L.ac_ask_qty}><input type="number" min="0" step="any" style={inputStyle} value={qte} onChange={(e) => setQte(e.target.value)} /></Field></div>
                <div style={{ marginBottom: 14 }}><Btn disabled={busy || !(Number(qte) > 0)} onClick={async () => { if (await rpc("achats_demander_participation", { p_id: a.id, p_quantite: Number(qte) })) setQte(""); }}>{L.ac_ask_btn}</Btn></div>
              </div>
            </div>
          ))}
      {gestionnaire && demandes.length > 0 && (
        <div style={{ borderTop: "1px solid #EEF0F3", paddingTop: 8, marginTop: 6 }}>
          <b style={{ fontSize: 13 }}>{L.ac_requests} · {demandes.length}</b>
          {demandes.map((x) => (
            <div key={x.member_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", flexWrap: "wrap", fontSize: 13 }}>
              <span style={{ flex: 1 }}>{x.member_nom} — {Number(x.quantite)}</span>
              <Btn style={petit} disabled={busy} onClick={() => rpc("achats_statuer_participation", { p_id: a.id, p_member: x.member_id, p_ok: true })}>{L.ac_accept}</Btn>
              <button style={{ background: "none", border: "none", color: RED, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }} onClick={() => rpc("achats_statuer_participation", { p_id: a.id, p_member: x.member_id, p_ok: false })}>{L.ac_refuse}</button>
            </div>
          ))}
        </div>
      )}
      {isBureau && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {aucunInscrit && <Btn variant="outline" style={petit} disabled={busy} onClick={() => rpc("achats_revenir_au_sondage", { p_id: a.id }, L.ac_back_confirm)}>← {L.ac_back}</Btn>}
          {restreint && <Btn variant="outline" style={petit} disabled={busy} onClick={() => rpc("achats_changer_acces", { p_id: a.id, p_mode: "tous" }, L.ac_open_all_confirm)}>🔓 {L.ac_open_all}</Btn>}
        </div>
      )}
    </Card>
  );
}
