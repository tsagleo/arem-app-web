// =====================================================================
// CarrefourPublic.jsx — Carrefour du savoir hors de sa rubrique (2026-10-10)
// =====================================================================
//  • ClassesPubliques : vitrine publique (?pub=<slug>) — classes ouvertes
//    au public, inscription sans compte (fonction savoir_inscription_publique,
//    liste d'attente automatique, champ piège anti-robot) ;
//  • AgendaClasses : rubrique Événements — prochaines séances des classes
//    ouvertes, ajout au calendrier.
// Base : sql/2026-10-10n_carrefour_complements.sql. Silencieux si absent.
// =====================================================================
import { useState, useEffect } from "react";
import { School, Calendar, CheckCircle2 } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Card, Btn, Field, inputStyle, formatEventDateTime, TEAL } from "./shared";
import { telechargerIcs } from "./carrefourOutils";

const TX = {
  fr: {
    pub_title: "Classes ouvertes au public", by: "Animée par {nom}", next: "Prochaine séance : {d}", sessions: "{n} séance(s)", seats: "{n} place(s) restante(s)",
    full: "Complet — liste d'attente", register: "S'inscrire", name: "Nom complet", email: "Courriel", phone: "Téléphone (facultatif)", send: "Envoyer mon inscription",
    ok: "Inscription enregistrée ! L'animateur vous contactera.", wait: "Classe complète : vous êtes sur la liste d'attente.",
    mode_distance: "En ligne", mode_presentiel: "En personne", mode_hybride: "Hybride",
    agenda: "Classes du Carrefour du savoir", agenda_help: "Prochaines séances des classes ouvertes — inscriptions dans le Carrefour du savoir.", ics: "Ajouter au calendrier",
  },
  en: {
    pub_title: "Classes open to the public", by: "Led by {nom}", next: "Next session: {d}", sessions: "{n} session(s)", seats: "{n} seat(s) left",
    full: "Full — waiting list", register: "Register", name: "Full name", email: "Email", phone: "Phone (optional)", send: "Send my registration",
    ok: "Registration saved! The facilitator will contact you.", wait: "Class full: you are on the waiting list.",
    mode_distance: "Online", mode_presentiel: "In person", mode_hybride: "Hybrid",
    agenda: "Learning hub classes", agenda_help: "Upcoming sessions of open classes — register in the Learning hub.", ics: "Add to calendar",
  },
};

function InscriptionPublique({ T, c }) {
  const [f, setF] = useState({ nom: "", courriel: "", telephone: "", piege: "" });
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  async function envoyer(e) {
    e.preventDefault();
    setBusy(true); setRes(null);
    const { data, error } = await supabase.rpc("savoir_inscription_publique", { p_classe_id: c.id, p_nom: f.nom, p_courriel: f.courriel, p_telephone: f.telephone, p_piege: f.piege || null });
    setBusy(false);
    setRes(error ? { err: error.message } : { statut: data });
  }
  if (res?.statut) return <p style={{ color: TEAL, fontWeight: 600, fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><CheckCircle2 size={15} /> {res.statut === "attente" ? T.wait : T.ok}</p>;
  return (
    <form onSubmit={envoyer} style={{ marginTop: 8 }}>
      <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.piege} onChange={(e) => setF({ ...f, piege: e.target.value })} style={{ position: "absolute", left: -9999, opacity: 0, height: 0, width: 0 }} />
      <Field label={T.name}><input required style={inputStyle} value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Field>
      <Field label={T.email}><input required type="email" style={inputStyle} value={f.courriel} onChange={(e) => setF({ ...f, courriel: e.target.value })} /></Field>
      <Field label={T.phone}><input type="tel" style={inputStyle} value={f.telephone} onChange={(e) => setF({ ...f, telephone: e.target.value })} /></Field>
      {res?.err && <p style={{ color: "#C0392B", fontSize: 12.5 }}>{res.err}</p>}
      <Btn type="submit" disabled={busy}>{T.send}</Btn>
    </form>
  );
}

export function ClassesPubliques({ slug, lang }) {
  const T = TX[lang === "en" ? "en" : "fr"];
  const [classes, setClasses] = useState([]);
  const [ouverte, setOuverte] = useState(null);
  useEffect(() => {
    let annule = false;
    supabase.from("public_classes").select("*").eq("slug_public", slug).then(({ data, error }) => { if (!annule && !error) setClasses(data || []); });
    return () => { annule = true; };
  }, [slug]);
  if (classes.length === 0) return null;
  return (
    <>
      <h3 style={{ fontSize: 15, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><School size={16} /> {T.pub_title}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14, marginBottom: 30 }}>
        {classes.map((c) => {
          const reste = c.capacite ? Math.max(0, c.capacite - Number(c.places_prises || 0)) : null;
          return (
            <Card key={c.id}>
              <h4 style={{ fontSize: 14.5, marginBottom: 6 }}>{c.titre}</h4>
              <div style={{ fontSize: 12, color: "#333", marginBottom: 4 }}>{T["mode_" + c.mode]}{c.lieu ? ` · ${c.lieu}` : ""} · {T.sessions.replace("{n}", c.nb_seances || 0)}</div>
              {c.prochaine_seance && <div style={{ fontSize: 12, color: "#333", marginBottom: 4 }}>📅 {T.next.replace("{d}", formatEventDateTime(c.prochaine_seance, lang))}</div>}
              {c.animateur_nom && <div style={{ fontSize: 12, color: "#5B6270", marginBottom: 4 }}>{T.by.replace("{nom}", c.animateur_nom)}</div>}
              {c.description && <p style={{ fontSize: 12, color: "#5B6270", margin: "6px 0" }}>{c.description}</p>}
              {reste !== null && <div style={{ fontSize: 12.5, fontWeight: 700, color: reste > 0 ? TEAL : "#B7791F", marginBottom: 6 }}>{reste > 0 ? T.seats.replace("{n}", reste) : T.full}</div>}
              {ouverte === c.id ? <InscriptionPublique T={T} c={c} /> : <Btn onClick={() => setOuverte(c.id)}>{T.register}</Btn>}
            </Card>
          );
        })}
      </div>
    </>
  );
}

export function AgendaClasses({ profile, lang }) {
  const T = TX[lang === "en" ? "en" : "fr"];
  const [items, setItems] = useState([]);
  useEffect(() => {
    let annule = false;
    (async () => {
      const { data: classes, error } = await supabase.from("savoir_classes").select("id, titre, lieu, lien_visio, mode").eq("association_id", profile.association_id).eq("statut", "ouverte");
      if (error || !classes?.length || annule) return;
      const { data: seances } = await supabase.from("savoir_classe_seances").select("*").in("classe_id", classes.map((c) => c.id)).eq("statut", "prevue").gte("debut", new Date().toISOString()).order("debut").limit(8);
      if (!annule) setItems((seances || []).map((s) => ({ s, c: classes.find((c) => c.id === s.classe_id) })));
    })();
    return () => { annule = true; };
  }, [profile.association_id]);
  if (items.length === 0) return null;
  return (
    <Card style={{ padding: 16, marginTop: 18 }}>
      <div style={{ fontWeight: 700, fontSize: 14, display: "flex", gap: 7, alignItems: "center" }}><School size={16} /> {T.agenda}</div>
      <p style={{ fontSize: 12, color: "#686F7D", margin: "2px 0 8px" }}>{T.agenda_help}</p>
      {items.map(({ s, c }) => (
        <div key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderTop: "1px solid #EEF0F3", flexWrap: "wrap", fontSize: 13 }}>
          <Calendar size={13} color="var(--primary)" />
          <span style={{ minWidth: 170 }}>{formatEventDateTime(s.debut, lang)}</span>
          <b style={{ flex: 1 }}>{c?.titre}{s.sujet ? ` — ${s.sujet}` : ""}</b>
          <button onClick={() => telechargerIcs([{ id: s.id, debut: s.debut, duree_min: s.duree_min, titre: `${c?.titre || ""}${s.sujet ? ` — ${s.sujet}` : ""}`, lieu: c?.lieu, url: c?.lien_visio }], "seance.ics")}
            style={{ fontSize: 12, fontWeight: 600, color: TEAL, background: "none", border: "none", cursor: "pointer" }}>{T.ics}</button>
        </div>
      ))}
    </Card>
  );
}
