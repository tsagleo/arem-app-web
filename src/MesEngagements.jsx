// =====================================================================
// MesEngagements.jsx — « Mon espace » : mes engagements de bénévole et
// mon badge de membre (2026-10-10)
// =====================================================================
// Signalé par l'utilisateur : une fois une tâche de bénévolat prise,
// rien n'apparaissait dans l'espace de l'adhérent. Cet encart liste ses
// engagements à venir (statut : en attente / confirmé / retrait demandé)
// avec le retrait encadré (délai de prévenance — se_retirer_benevolat),
// et propose son badge de membre (carte + badge d'entrée aux événements).
// Voir sql/2026-10-10b_evenements_benevolat_cartes.sql et evenementsPlus.js.
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import { HandHeart, IdCard } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Btn, useLang, friendlyError, formatEventDateTime, TEAL, RED } from "./shared";
import { txtEvPlus, retraitSurDemande, downloadMemberBadgesPdf } from "./evenementsPlus";

const TXT = {
  fr: { title: "Mes engagements de bénévole", empty: "Aucun engagement à venir. Les tâches ouvertes sont dans Événements → Bénévolat." },
  en: { title: "My volunteer commitments", empty: "No upcoming commitment. Open tasks are under Events → Volunteering." },
};

export default function MesEngagements({ me, association }) {
  const { t, lang } = useLang();
  const P = txtEvPlus(lang);
  const T = TXT[lang === "en" ? "en" : "fr"];
  const [rows, setRows] = useState([]);
  const meId = me?.id;

  const load = useCallback(async () => {
    if (!meId) return;
    const { data: sig, error } = await supabase.from("event_volunteer_signups").select("*").eq("member_id", meId);
    if (error || !sig?.length) { setRows([]); return; }
    const { data: tasks } = await supabase.from("event_volunteer_tasks").select("*").in("id", sig.map((s) => s.task_id));
    const { data: evs } = await supabase.from("events").select("*").in("id", [...new Set((tasks || []).map((tk) => tk.event_id))]);
    const now = Date.now() - 6 * 3600000;
    setRows(sig.map((s) => {
      const task = (tasks || []).find((tk) => tk.id === s.task_id);
      const ev = (evs || []).find((e) => e.id === task?.event_id);
      return { s, task, ev };
    }).filter((r) => r.task && r.ev && new Date(r.ev.date_debut).getTime() >= now)
      .sort((a, b) => String(a.ev.date_debut).localeCompare(String(b.ev.date_debut))));
  }, [meId]);
  useEffect(() => { load(); }, [load]);

  async function retirer(r) {
    let motif = null;
    if (retraitSurDemande(r.ev, r.s)) {
      motif = window.prompt(P.withdrawLateInfo.replace("{h}", String(r.ev.benevolat_delai_heures ?? 72)), "");
      if (motif === null) return;
    } else if (!window.confirm(P.withdrawFreeConfirm)) return;
    const { data, error } = await supabase.rpc("se_retirer_benevolat", { p_signup_id: r.s.id, p_motif: motif });
    if (error) { alert(error.code === "P0001" ? error.message : friendlyError(error, t)); return; }
    if (data === "retrait_demande") alert(P.withdrawRequested);
    load();
  }
  async function annulerRetrait(r) {
    const { error } = await supabase.rpc("annuler_retrait_benevolat", { p_signup_id: r.s.id });
    if (error) { alert(friendlyError(error, t)); return; }
    load();
  }
  async function monBadge() {
    try {
      // Code protégé de ma carte (sql/2026-10-10c), repli sur l'ancien.
      const { data: jeton } = await supabase.rpc("mon_jeton_carte");
      const { data: carte } = await supabase.from("member_card_tokens").select("emis_le").eq("member_id", me.id).maybeSingle();
      await downloadMemberBadgesPdf([{ ...me, verification_token: jeton || me.verification_token, emis_le: carte?.emis_le || null, role_label: P.member }], { association, lang, fileName: "mon_badge_membre.pdf" });
    } catch (e) { alert(friendlyError(e, t)); }
  }

  return (
    <div style={{ background: "white", border: "1px solid #E7E9F1", borderRadius: 12, padding: "15px 18px", marginBottom: 22, boxShadow: "0 3px 12px rgba(31,56,100,0.06)" }} className="no-print">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}><HandHeart size={16} color={TEAL} /> {T.title}</div>
        <Btn variant="outline" onClick={monBadge} style={{ padding: "5px 12px", fontSize: 12 }}><IdCard size={13} /> {P.myBadge}</Btn>
      </div>
      {rows.length === 0 && <p style={{ fontSize: 12.5, color: "#686F7D", fontStyle: "italic", margin: 0 }}>{T.empty}</p>}
      {rows.map((r) => {
        const st = r.s.statut || "confirme";
        return (
          <div key={r.s.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid #F0F1F3" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{r.task.titre}</div>
              <div style={{ fontSize: 12, color: "#5B6270" }}>{r.ev.titre} · {formatEventDateTime(r.ev.date_debut, lang)}</div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: st === "confirme" ? TEAL : "#8A6D00", marginTop: 2 }}>{P["st_" + st]}</div>
            </div>
            {st === "retrait_demande" ? (
              <button onClick={() => annulerRetrait(r)} style={{ background: "none", border: "none", color: TEAL, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{P.cancelWithdraw}</button>
            ) : (
              <button onClick={() => retirer(r)} style={{ background: "none", border: "none", color: RED, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{retraitSurDemande(r.ev, r.s) ? P.askWithdraw : P.withdraw}</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
