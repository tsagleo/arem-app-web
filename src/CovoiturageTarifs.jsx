// =====================================================================
// CovoiturageTarifs.jsx — Grille tarifaire du covoiturage par tranches de
// MINUTES (2026-10-09, sql/2026-10-09b_covoiturage_vehicule_tarifs.sql).
//
// - Le bureau définit « de X min à Y min = montant », sans trou ni
//   chevauchement, plus une dernière tranche « au-delà » obligatoire.
// - Prix PAR PASSAGER, calculé sur la durée ESTIMÉE et figé à la
//   réservation (côté base). Le conducteur peut baisser ou offrir, jamais
//   dépasser la grille (contrôlé aussi en base).
// - Chaque enregistrement crée une nouvelle VERSION (historique conservé).
// - Il s'agit d'une « contribution aux frais de carburant » : le
//   covoiturage ne doit pas générer de revenu.
//
// Les fonctions prixSelonGrille / validerGrille reproduisent EXACTEMENT
// covoiturage_prix_grille / enregistrer_grille_tarifaire_covoiturage (SQL)
// pour afficher le prix avant la réservation ; la base reste l'arbitre.
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Save, Fuel, History, AlertTriangle, Check } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Card, Btn, Field, Pill, inputStyle, money, useLang, friendlyError, TEAL, TEAL_LIGHT, RED } from "./shared";

export const TXT_TARIFS = {
  fr: {
    title: "Grille tarifaire du covoiturage",
    intro: "Contribution aux frais de carburant, par passager, selon la durée ESTIMÉE du trajet. Le prix est calculé et affiché au passager avant qu'il réserve, puis figé à la réservation. Le conducteur peut baisser ou offrir le trajet, jamais dépasser la grille. Le covoiturage ne doit pas générer de revenu.",
    no_grid: "Aucune grille active : chaque conducteur fixe librement son prix.",
    active_version: "Version {v} active depuis le {date}",
    tranches: "Tranches",
    from: "De (min)",
    to: "À (min)",
    amount: "Montant / passager",
    add_row: "Ajouter une tranche",
    beyond_title: "Au-delà de la dernière tranche (obligatoire)",
    beyond_base: "Montant de base",
    beyond_every: "Puis toutes les (min)",
    beyond_plus: "Ajouter",
    beyond_help: "Au-delà de {a} min : {base}, puis + {plus} toutes les {n} minutes supplémentaires.",
    options_title: "Options",
    opt_wait: "Frais d'attente (le temps d'attente au point de rendez-vous est déjà mesuré)",
    opt_wait_free: "Gratuit pendant (min)",
    opt_wait_per_min: "Puis par minute",
    opt_wait_cap: "Plafond (facultatif)",
    opt_solid: "Tarif solidaire (réduction en %)",
    opt_solid_pct: "Réduction (%)",
    opt_solid_students: "Étudiants",
    opt_solid_seniors: "Aînés",
    opt_solid_events: "Trajets vers les événements de l'association (automatique)",
    opt_real: "Frais réels déclarés par le conducteur (péage, stationnement)",
    save: "Enregistrer une nouvelle version",
    saving: "Enregistrement…",
    saved: "Grille enregistrée (nouvelle version).",
    disable: "Désactiver la grille (prix libre)",
    disable_confirm: "Désactiver la grille ? Les conducteurs fixeront de nouveau leur prix librement. L'historique est conservé.",
    history: "Historique des versions",
    history_row: "v{v} · {date} · {n} tranche(s)",
    err_empty: "Ajoutez au moins une tranche.",
    err_first: "La première tranche doit commencer à 0 minute.",
    err_gap: "Tranche {i} : elle doit commencer à {prev} min (pas de trou ni de chevauchement).",
    err_order: "Tranche {i} : la fin doit être supérieure au début.",
    err_amount: "Tranche {i} : montant manquant ou négatif.",
    err_beyond: "La tranche « au-delà » est obligatoire (montant de base, durée ≥ 1 min, montant ajouté ≥ 0).",
    err_pct: "Le pourcentage solidaire doit être entre 0 et 100.",
    preview: "Aperçu",
    preview_minutes: "Durée estimée (min)",
    preview_result: "Contribution par passager : {m}",
    sql_missing: "La grille n'est pas encore disponible : le script SQL 2026-10-09b doit être exécuté dans Supabase.",
    fuel_note: "Contribution aux frais de carburant",
  },
  en: {
    title: "Carpool price grid",
    intro: "Fuel cost contribution, per passenger, based on the ESTIMATED trip duration. The price is computed and shown to the passenger before booking, then locked at booking. Drivers may lower the price or offer the ride for free, never exceed the grid. Carpooling must not generate income.",
    no_grid: "No active grid: each driver sets their own price.",
    active_version: "Version {v} active since {date}",
    tranches: "Brackets",
    from: "From (min)",
    to: "To (min)",
    amount: "Amount / passenger",
    add_row: "Add a bracket",
    beyond_title: "Beyond the last bracket (required)",
    beyond_base: "Base amount",
    beyond_every: "Then every (min)",
    beyond_plus: "Add",
    beyond_help: "Beyond {a} min: {base}, then + {plus} every {n} additional minutes.",
    options_title: "Options",
    opt_wait: "Waiting fee (waiting time at pickup is already measured)",
    opt_wait_free: "Free for (min)",
    opt_wait_per_min: "Then per minute",
    opt_wait_cap: "Cap (optional)",
    opt_solid: "Solidarity rate (% discount)",
    opt_solid_pct: "Discount (%)",
    opt_solid_students: "Students",
    opt_solid_seniors: "Seniors",
    opt_solid_events: "Rides to the association's events (automatic)",
    opt_real: "Actual costs declared by the driver (tolls, parking)",
    save: "Save as a new version",
    saving: "Saving…",
    saved: "Grid saved (new version).",
    disable: "Disable the grid (free pricing)",
    disable_confirm: "Disable the grid? Drivers will set their own price again. History is kept.",
    history: "Version history",
    history_row: "v{v} · {date} · {n} bracket(s)",
    err_empty: "Add at least one bracket.",
    err_first: "The first bracket must start at 0 minutes.",
    err_gap: "Bracket {i}: it must start at {prev} min (no gap or overlap).",
    err_order: "Bracket {i}: the end must be greater than the start.",
    err_amount: "Bracket {i}: missing or negative amount.",
    err_beyond: "The “beyond” bracket is required (base amount, step ≥ 1 min, added amount ≥ 0).",
    err_pct: "The solidarity percentage must be between 0 and 100.",
    preview: "Preview",
    preview_minutes: "Estimated duration (min)",
    preview_result: "Contribution per passenger: {m}",
    sql_missing: "The grid is not available yet: the SQL script 2026-10-09b must be run in Supabase.",
    fuel_note: "Fuel cost contribution",
  },
};

// Même calcul que public.covoiturage_prix_grille (SQL).
export function prixSelonGrille(grille, minutes) {
  if (!grille || minutes == null || !isFinite(minutes)) return null;
  const m = Math.max(0, Math.ceil(Number(minutes)));
  const tranches = [...(grille.tranches || [])].sort((a, b) => Number(a.de) - Number(b.de));
  let last = 0;
  for (const tr of tranches) {
    if (m <= Number(tr.a)) return { montant: Math.round(Number(tr.montant) * 100) / 100, de: Number(tr.de), a: Number(tr.a), au_dela: false, minutes: m, version: grille.version, grille_id: grille.id };
    last = Number(tr.a);
  }
  const n = Math.floor((m - last) / Math.max(1, Number(grille.au_dela_par_min) || 1));
  const montant = Number(grille.au_dela_montant) + n * Number(grille.au_dela_montant_par_tranche || 0);
  return { montant: Math.round(montant * 100) / 100, de: last, a: null, au_dela: true, tranches_sup: n, minutes: m, version: grille.version, grille_id: grille.id };
}

// Libellé lisible d'une tranche appliquée (jsonb tranche_appliquee).
export function trancheLabel(tr, lang) {
  if (!tr) return "—";
  const en = lang === "en";
  if (tr.au_dela) return en ? `beyond ${tr.de} min (v${tr.version ?? "?"})` : `au-delà de ${tr.de} min (v${tr.version ?? "?"})`;
  return en ? `${tr.de}–${tr.a} min (v${tr.version ?? "?"})` : `${tr.de} à ${tr.a} min (v${tr.version ?? "?"})`;
}

// Même validation que enregistrer_grille_tarifaire_covoiturage (SQL).
export function validerGrille(rows, beyond, options, L) {
  if (!rows.length) return L.err_empty;
  const sorted = [...rows].sort((a, b) => Number(a.de) - Number(b.de));
  let prev = 0;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.de === "" || r.a === "" || r.montant === "" || r.de == null || r.a == null || r.montant == null) return L.err_amount.replace("{i}", i + 1);
    if (Number(r.de) !== prev) return i === 0 ? L.err_first : L.err_gap.replace("{i}", i + 1).replace("{prev}", prev);
    if (!(Number(r.a) > Number(r.de))) return L.err_order.replace("{i}", i + 1);
    if (!(Number(r.montant) >= 0)) return L.err_amount.replace("{i}", i + 1);
    prev = Number(r.a);
  }
  if (beyond.montant === "" || !(Number(beyond.montant) >= 0) || !(Number(beyond.par_min) >= 1) || !(Number(beyond.plus || 0) >= 0)) return L.err_beyond;
  if (options.solidaire_actif && !(Number(options.solidaire_pct) >= 0 && Number(options.solidaire_pct) <= 100)) return L.err_pct;
  return null;
}

const DEFAULT_ROWS = [
  { de: 0, a: 15, montant: 3 },
  { de: 15, a: 30, montant: 5 },
  { de: 30, a: 60, montant: 8 },
];

export default function GrilleTarifaireCovoiturage({ profile, association, onSaved }) {
  const { lang } = useLang();
  const L = TXT_TARIFS[lang === "en" ? "en" : "fr"];
  const devise = association?.devise_monetaire || "CAD";
  const [grilles, setGrilles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sqlMissing, setSqlMissing] = useState(false);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [beyond, setBeyond] = useState({ montant: 12, par_min: 15, plus: 2 });
  const [options, setOptions] = useState({
    attente_actif: false, attente_franchise_min: 5, attente_montant_par_min: 0.25, attente_plafond: "",
    solidaire_actif: false, solidaire_pct: 25, solidaire_etudiants: true, solidaire_aines: true, solidaire_evenements: true,
    frais_reels_actif: false,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ tone: "", text: "" });
  const [previewMin, setPreviewMin] = useState(25);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("carpool_tarif_grilles").select("*")
      .eq("association_id", profile.association_id).order("version", { ascending: false });
    if (error) { setSqlMissing(true); setLoading(false); return; }
    setGrilles(data || []);
    const active = (data || []).find((g) => g.actif);
    if (active) {
      setRows((active.tranches || []).map((r) => ({ de: Number(r.de), a: Number(r.a), montant: Number(r.montant) })));
      setBeyond({ montant: Number(active.au_dela_montant), par_min: Number(active.au_dela_par_min), plus: Number(active.au_dela_montant_par_tranche) });
      setOptions({
        attente_actif: active.attente_actif, attente_franchise_min: active.attente_franchise_min, attente_montant_par_min: Number(active.attente_montant_par_min), attente_plafond: active.attente_plafond ?? "",
        solidaire_actif: active.solidaire_actif, solidaire_pct: Number(active.solidaire_pct), solidaire_etudiants: active.solidaire_etudiants, solidaire_aines: active.solidaire_aines, solidaire_evenements: active.solidaire_evenements,
        frais_reels_actif: active.frais_reels_actif,
      });
    }
    setLoading(false);
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  const active = grilles.find((g) => g.actif);
  const validationError = validerGrille(rows, beyond, options, L);
  const lastA = rows.length ? Math.max(...rows.map((r) => Number(r.a) || 0)) : 0;
  const draftGrille = { tranches: rows, au_dela_montant: beyond.montant, au_dela_par_min: beyond.par_min, au_dela_montant_par_tranche: beyond.plus, version: (active?.version || 0) + 1 };
  const preview = validationError ? null : prixSelonGrille(draftGrille, Number(previewMin));

  function setRow(i, key, value) { setRows((p) => p.map((r, j) => (j === i ? { ...r, [key]: value } : r))); }
  function addRow() {
    setRows((p) => {
      const end = p.length ? Math.max(...p.map((r) => Number(r.a) || 0)) : 0;
      return [...p, { de: end, a: end + 15, montant: "" }];
    });
  }
  function removeRow(i) { setRows((p) => p.filter((_, j) => j !== i)); }
  function setOpt(key, value) { setOptions((p) => ({ ...p, [key]: value })); }

  async function save() {
    if (validationError) { setMsg({ tone: "err", text: validationError }); return; }
    setSaving(true); setMsg({ tone: "", text: "" });
    const tranches = [...rows].sort((a, b) => Number(a.de) - Number(b.de)).map((r) => ({ de: Number(r.de), a: Number(r.a), montant: Number(r.montant) }));
    const { error } = await supabase.rpc("enregistrer_grille_tarifaire_covoiturage", {
      p_tranches: tranches,
      p_au_dela_montant: Number(beyond.montant),
      p_au_dela_par_min: Number(beyond.par_min),
      p_au_dela_montant_par_tranche: Number(beyond.plus || 0),
      p_options: { ...options, attente_plafond: options.attente_plafond === "" ? null : Number(options.attente_plafond) },
    });
    setSaving(false);
    if (error) { setMsg({ tone: "err", text: friendlyError(error) }); return; }
    setMsg({ tone: "ok", text: L.saved });
    await load();
    onSaved?.();
  }
  async function disable() {
    if (!window.confirm(L.disable_confirm)) return;
    const { error } = await supabase.rpc("desactiver_grille_tarifaire_covoiturage");
    if (error) { setMsg({ tone: "err", text: friendlyError(error) }); return; }
    await load();
    onSaved?.();
  }

  const dateFmt = (iso) => { try { return new Date(iso).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA"); } catch { return iso; } };
  const small = { ...inputStyle, padding: "7px 9px", fontSize: 13 };
  const check = { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" };

  if (loading) return null;
  return (
    <Card style={{ maxWidth: 720, marginTop: 22 }}>
      <h3 style={{ fontSize: 14, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><Fuel size={16} color={TEAL} /> {L.title}</h3>
      <p style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>{L.intro}</p>
      {sqlMissing ? (
        <p style={{ fontSize: 12.5, color: RED }}><AlertTriangle size={13} /> {L.sql_missing}</p>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            {active
              ? <Pill color={TEAL} bg={TEAL_LIGHT}><Check size={11} style={{ marginRight: 4 }} />{L.active_version.replace("{v}", active.version).replace("{date}", dateFmt(active.created_at))}</Pill>
              : <Pill color="#8A5A00" bg="#FDF3DF">{L.no_grid}</Pill>}
          </div>

          <h4 style={{ fontSize: 12.5, marginBottom: 6 }}>{L.tranches}</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.3fr 32px", gap: 6, fontSize: 11, color: "#8A8F98" }}>
              <span>{L.from}</span><span>{L.to}</span><span>{L.amount} ({devise})</span><span />
            </div>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.3fr 32px", gap: 6 }}>
                <input type="number" min="0" style={small} value={r.de} onChange={(e) => setRow(i, "de", e.target.value === "" ? "" : Number(e.target.value))} />
                <input type="number" min="1" style={small} value={r.a} onChange={(e) => setRow(i, "a", e.target.value === "" ? "" : Number(e.target.value))} />
                <input type="number" min="0" step="0.01" style={small} value={r.montant} onChange={(e) => setRow(i, "montant", e.target.value === "" ? "" : Number(e.target.value))} />
                <button type="button" onClick={() => removeRow(i)} style={{ background: "none", border: "none", cursor: "pointer", color: RED }} aria-label="supprimer"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <Btn variant="outline" style={{ padding: "5px 12px", fontSize: 12, marginBottom: 14 }} onClick={addRow}><Plus size={12} /> {L.add_row}</Btn>

          <h4 style={{ fontSize: 12.5, marginBottom: 6 }}>{L.beyond_title}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 4 }}>
            <Field label={`${L.beyond_base} (${devise})`}><input type="number" min="0" step="0.01" style={small} value={beyond.montant} onChange={(e) => setBeyond((p) => ({ ...p, montant: e.target.value === "" ? "" : Number(e.target.value) }))} /></Field>
            <Field label={L.beyond_every}><input type="number" min="1" style={small} value={beyond.par_min} onChange={(e) => setBeyond((p) => ({ ...p, par_min: e.target.value === "" ? "" : Number(e.target.value) }))} /></Field>
            <Field label={`${L.beyond_plus} (${devise})`}><input type="number" min="0" step="0.01" style={small} value={beyond.plus} onChange={(e) => setBeyond((p) => ({ ...p, plus: e.target.value === "" ? "" : Number(e.target.value) }))} /></Field>
          </div>
          <p style={{ fontSize: 11.5, color: "#5B6270", marginTop: -4, marginBottom: 14 }}>
            {L.beyond_help.replace("{a}", lastA).replace("{base}", money(beyond.montant || 0, devise)).replace("{plus}", money(beyond.plus || 0, devise)).replace("{n}", beyond.par_min || "?")}
          </p>

          <h4 style={{ fontSize: 12.5, marginBottom: 8 }}>{L.options_title}</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            <label style={check}><input type="checkbox" checked={!!options.attente_actif} onChange={(e) => setOpt("attente_actif", e.target.checked)} /> {L.opt_wait}</label>
            {options.attente_actif && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginLeft: 24 }}>
                <Field label={L.opt_wait_free}><input type="number" min="0" style={small} value={options.attente_franchise_min} onChange={(e) => setOpt("attente_franchise_min", Number(e.target.value))} /></Field>
                <Field label={`${L.opt_wait_per_min} (${devise})`}><input type="number" min="0" step="0.01" style={small} value={options.attente_montant_par_min} onChange={(e) => setOpt("attente_montant_par_min", Number(e.target.value))} /></Field>
                <Field label={L.opt_wait_cap}><input type="number" min="0" step="0.01" style={small} value={options.attente_plafond} onChange={(e) => setOpt("attente_plafond", e.target.value)} /></Field>
              </div>
            )}
            <label style={check}><input type="checkbox" checked={!!options.solidaire_actif} onChange={(e) => setOpt("solidaire_actif", e.target.checked)} /> {L.opt_solid}</label>
            {options.solidaire_actif && (
              <div style={{ marginLeft: 24, display: "flex", flexDirection: "column", gap: 6 }}>
                <Field label={L.opt_solid_pct}><input type="number" min="0" max="100" style={{ ...small, maxWidth: 120 }} value={options.solidaire_pct} onChange={(e) => setOpt("solidaire_pct", Number(e.target.value))} /></Field>
                <label style={check}><input type="checkbox" checked={!!options.solidaire_etudiants} onChange={(e) => setOpt("solidaire_etudiants", e.target.checked)} /> {L.opt_solid_students}</label>
                <label style={check}><input type="checkbox" checked={!!options.solidaire_aines} onChange={(e) => setOpt("solidaire_aines", e.target.checked)} /> {L.opt_solid_seniors}</label>
                <label style={check}><input type="checkbox" checked={!!options.solidaire_evenements} onChange={(e) => setOpt("solidaire_evenements", e.target.checked)} /> {L.opt_solid_events}</label>
              </div>
            )}
            <label style={check}><input type="checkbox" checked={!!options.frais_reels_actif} onChange={(e) => setOpt("frais_reels_actif", e.target.checked)} /> {L.opt_real}</label>
          </div>

          <div style={{ background: "#F6F8FA", borderRadius: 10, padding: "10px 12px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 12 }}>{L.preview}</strong>
            <span style={{ fontSize: 12 }}>{L.preview_minutes}</span>
            <input type="number" min="0" style={{ ...small, width: 90 }} value={previewMin} onChange={(e) => setPreviewMin(e.target.value)} />
            {preview && <span style={{ fontSize: 12.5, fontWeight: 700, color: TEAL }}>{L.preview_result.replace("{m}", money(preview.montant, devise))} · {trancheLabel(preview, lang)}</span>}
          </div>

          {(msg.text || validationError) && (
            <p style={{ fontSize: 12.5, color: msg.tone === "ok" ? TEAL : RED, marginBottom: 10 }}>{msg.text || validationError}</p>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn onClick={save} disabled={saving || !!validationError}><Save size={13} /> {saving ? L.saving : L.save}</Btn>
            {active && <Btn variant="outline" onClick={disable}>{L.disable}</Btn>}
          </div>

          {grilles.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ fontSize: 12.5, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><History size={13} /> {L.history}</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {grilles.map((g) => (
                  <div key={g.id} style={{ fontSize: 11.5, color: g.actif ? TEAL : "#5B6270" }}>
                    {L.history_row.replace("{v}", g.version).replace("{date}", dateFmt(g.created_at)).replace("{n}", (g.tranches || []).length)}
                    {" — "}{(g.tranches || []).map((r) => `${r.de}-${r.a}: ${money(r.montant, devise)}`).join(" · ")}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
