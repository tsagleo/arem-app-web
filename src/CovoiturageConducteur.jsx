// =====================================================================
// CovoiturageConducteur.jsx — Conducteur et véhicule identifiés
// (2026-10-09, sql/2026-10-09b_covoiturage_vehicule_tarifs.sql).
//
// - Fiche conducteur : photo de profil (OBLIGATOIRE pour publier une
//   offre — contrôlé aussi en base), téléphone, véhicule(s) (marque,
//   modèle, couleur, année, places, plaque, photo).
// - Documents FACULTATIFS, fournis à la demande du bureau (permis,
//   assurance, immatriculation) : bucket PRIVÉ « carpool-documents »,
//   visible seulement du conducteur et du bureau, date d'expiration et
//   rappel automatique 30 jours avant.
// - Badge « Conducteur vérifié ✓ » accordé par le bureau après contrôle
//   (réutilise members.covoiturage_verifie, sql/2026-10-08e).
// - La plaque n'est lisible (RLS) que par le conducteur, le bureau et les
//   passagers dont la réservation est confirmée.
// =====================================================================
import { useState } from "react";
import { Car, Camera, Phone, ShieldCheck, FileText, Upload, Trash2, Plus, Check, X, AlertTriangle, Send, Pencil } from "lucide-react";
import { supabase } from "./supabaseClient";
import { covErr, DOC_TYPES, useTxtConducteur, openSignedFile, useSignedUrl, vehiculeLabel } from "./covoiturageOutils";
import { Card, Btn, Field, Pill, inputStyle, useLang, TEAL, TEAL_LIGHT, RED } from "./shared";

const AMBER = "#8A5A00";
const AMBER_LIGHT = "#FDF3DF";
const overlay = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 };
function safeName(name) { return (name || "fichier").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80); }

export function VehiculePhoto({ path, size = 56 }) {
  const url = useSignedUrl("carpool-vehicules", path);
  if (!url) return <div style={{ width: size, height: size * 0.7, borderRadius: 8, background: "#F1F2F4", display: "flex", alignItems: "center", justifyContent: "center" }}><Car size={size / 3} color="#9AA2B5" /></div>;
  return <img src={url} alt="" style={{ width: size, height: size * 0.7, borderRadius: 8, objectFit: "cover" }} />;
}

export function DriverAvatar({ photoUrl, nom, size = 32 }) {
  if (photoUrl) return <img src={photoUrl} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  const initials = (nom || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return <div style={{ width: size, height: size, borderRadius: "50%", background: TEAL_LIGHT, color: TEAL, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, flexShrink: 0 }}>{initials}</div>;
}

function docExpiryInfo(doc) {
  if (!doc?.expire_le) return null;
  const days = Math.round((new Date(doc.expire_le + "T12:00:00") - new Date()) / 86400000);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "ok";
}

function DocStatusPill({ doc, T }) {
  if (!doc) return <Pill color="#8A8F98" bg="#F1F2F4">{T.doc_none}</Pill>;
  const map = { demande: [AMBER, AMBER_LIGHT], soumis: ["#1F3864", "#EEF1F8"], valide: [TEAL, TEAL_LIGHT], refuse: [RED, "#FCEAEA"] };
  const [c, bg] = map[doc.statut] || map.soumis;
  const exp = docExpiryInfo(doc);
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      <Pill color={c} bg={bg}>{T["doc_statut_" + doc.statut]}</Pill>
      {exp === "expiring" && <Pill color={AMBER} bg={AMBER_LIGHT}>{T.doc_expiring}</Pill>}
      {exp === "expired" && <Pill color={RED} bg="#FCEAEA">{T.doc_expired}</Pill>}
    </span>
  );
}

// ---------------------------------------------------------------------
// Fiche conducteur (le membre lui-même)
// ---------------------------------------------------------------------
export function FicheConducteurModal({ profile, me, vehicules, plaques, documents, onClose, onChanged }) {
  const T = useTxtConducteur();
  const { t } = useLang();
  const [phone, setPhone] = useState(me?.telephone || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ tone: "", text: "" });
  const [editingVehicle, setEditingVehicle] = useState(null); // null | {} (nouveau) | vehicule
  const myVehicles = vehicules.filter((v) => v.member_id === profile.member_id);
  const myDocs = documents.filter((d) => d.member_id === profile.member_id);

  function report(error) {
    if (!error) return false;
    console.error("[Covoiturage conducteur]", error);
    setMsg({ tone: "err", text: /maj_profil_conducteur|carpool_|does not exist|schema cache/i.test(error.message || "") ? T.sql_missing : covErr(error, t) });
    return true;
  }

  async function uploadPhoto(file) {
    if (!file) return;
    setBusy(true); setMsg({ tone: "", text: "" });
    const path = `members/${profile.association_id}/${profile.member_id}_${Date.now()}_${safeName(file.name)}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (report(upErr)) { setBusy(false); return; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const { error } = await supabase.rpc("maj_profil_conducteur_covoiturage", { p_photo_url: data.publicUrl, p_telephone: null });
    setBusy(false);
    if (report(error)) return;
    setMsg({ tone: "ok", text: T.saved });
    onChanged?.();
  }
  async function savePhone() {
    setBusy(true); setMsg({ tone: "", text: "" });
    const { error } = await supabase.rpc("maj_profil_conducteur_covoiturage", { p_photo_url: null, p_telephone: phone.trim() });
    setBusy(false);
    if (report(error)) return;
    setMsg({ tone: "ok", text: T.saved });
    onChanged?.();
  }
  async function deleteVehicle(v) {
    if (!window.confirm(T.delete_vehicle_confirm)) return;
    const { error } = await supabase.from("carpool_vehicules").delete().eq("id", v.id);
    if (report(error)) return;
    if (v.photo_path) await supabase.storage.from("carpool-vehicules").remove([v.photo_path]);
    onChanged?.();
  }

  async function uploadDoc(type, file, expireLe) {
    if (!file) return;
    setBusy(true); setMsg({ tone: "", text: "" });
    const path = `${profile.association_id}/${profile.member_id}/${type}_${Date.now()}_${safeName(file.name)}`;
    const { error: upErr } = await supabase.storage.from("carpool-documents").upload(path, file, { upsert: false });
    if (report(upErr)) { setBusy(false); return; }
    const existing = myDocs.find((d) => d.type === type && d.statut !== "refuse") || myDocs.find((d) => d.type === type);
    const patch = { fichier_path: path, fichier_nom: file.name, expire_le: expireLe || null };
    const { error } = existing
      ? await supabase.from("carpool_documents_conducteur").update(patch).eq("id", existing.id)
      : await supabase.from("carpool_documents_conducteur").insert({ ...patch, association_id: profile.association_id, member_id: profile.member_id, type });
    setBusy(false);
    if (report(error)) return;
    if (existing?.fichier_path && existing.fichier_path !== path) await supabase.storage.from("carpool-documents").remove([existing.fichier_path]);
    setMsg({ tone: "ok", text: T.saved });
    onChanged?.();
  }
  async function updateDocExpiry(doc, expireLe) {
    const { error } = await supabase.from("carpool_documents_conducteur").update({ expire_le: expireLe || null }).eq("id", doc.id);
    if (!report(error)) onChanged?.();
  }
  async function deleteDoc(doc) {
    if (!window.confirm(T.doc_delete_confirm)) return;
    const { error } = await supabase.from("carpool_documents_conducteur").delete().eq("id", doc.id);
    if (report(error)) return;
    if (doc.fichier_path) await supabase.storage.from("carpool-documents").remove([doc.fichier_path]);
    onChanged?.();
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 620, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><Car size={18} color={TEAL} /> {T.title}</h3>
        <p style={{ fontSize: 12.5, color: "#5B6270", marginBottom: 12 }}>{T.intro}</p>
        <div style={{ marginBottom: 14 }}>
          {me?.covoiturage_verifie
            ? <Pill color={TEAL} bg={TEAL_LIGHT}><ShieldCheck size={11} style={{ marginRight: 4 }} />{T.verified}</Pill>
            : <Pill color="#8A8F98" bg="#F1F2F4">{T.not_verified}</Pill>}
        </div>
        {msg.text && <p style={{ fontSize: 12.5, color: msg.tone === "ok" ? TEAL : RED, marginBottom: 10 }}>{msg.text}</p>}

        {/* Photo + téléphone */}
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <DriverAvatar photoUrl={me?.photo_url} nom={me?.nom} size={72} />
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Camera size={12} /> {me?.photo_url ? T.photo_change : T.photo_add}
              <input type="file" accept="image/*" style={{ display: "none" }} disabled={busy} onChange={(e) => uploadPhoto(e.target.files?.[0])} />
            </label>
            {!me?.photo_url && <span style={{ fontSize: 11, color: RED, maxWidth: 140, textAlign: "center" }}>{T.photo_required}</span>}
          </div>
          <div style={{ flex: "1 1 240px" }}>
            <Field label={T.phone}>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={inputStyle} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="506-555-0123" />
                <Btn variant="outline" onClick={savePhone} disabled={busy || !phone.trim() || phone.trim() === (me?.telephone || "")}><Phone size={13} /></Btn>
              </div>
            </Field>
            <p style={{ fontSize: 11, color: "#8A8F98", marginTop: -8 }}>{T.phone_hint}</p>
          </div>
        </div>

        {/* Véhicules */}
        <h4 style={{ fontSize: 13.5, marginBottom: 8 }}>{T.vehicles}</h4>
        {myVehicles.length === 0 && !editingVehicle && <p style={{ fontSize: 12.5, color: "#8A8F98", fontStyle: "italic" }}>{T.vehicle_none}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
          {myVehicles.map((v) => (
            <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#F6F8FA", borderRadius: 10, padding: "8px 10px" }}>
              <VehiculePhoto path={v.photo_path} />
              <div style={{ flex: 1, fontSize: 12.5 }}>
                <div style={{ fontWeight: 700 }}>{vehiculeLabel(v)}</div>
                <div style={{ color: "#5B6270" }}>{T.seats} : {v.places} · {T.plate} : {plaques.find((p) => p.vehicule_id === v.id)?.plaque || "—"}</div>
              </div>
              <button onClick={() => setEditingVehicle(v)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)" }}><Pencil size={14} /></button>
              <button onClick={() => deleteVehicle(v)} style={{ background: "none", border: "none", cursor: "pointer", color: RED }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        {editingVehicle ? (
          <VehicleForm profile={profile} vehicle={editingVehicle.id ? editingVehicle : null}
            plaque={editingVehicle.id ? plaques.find((p) => p.vehicule_id === editingVehicle.id)?.plaque || "" : ""}
            T={T} onCancel={() => setEditingVehicle(null)} onSaved={() => { setEditingVehicle(null); onChanged?.(); }} onError={report} />
        ) : (
          <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12, marginBottom: 18 }} onClick={() => setEditingVehicle({})}><Plus size={12} /> {T.vehicle_add}</Btn>
        )}

        {/* Documents */}
        <h4 style={{ fontSize: 13.5, margin: "8px 0 4px" }}>{T.documents}</h4>
        <p style={{ fontSize: 11.5, color: "#5B6270", marginBottom: 10 }}>{T.documents_intro}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {DOC_TYPES.map((type) => (
            <DocRow key={type} type={type} T={T} busy={busy}
              doc={myDocs.filter((d) => d.type === type).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]}
              onUpload={uploadDoc} onExpiry={updateDocExpiry} onDelete={deleteDoc} />
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn variant="outline" onClick={onClose}>{T.close}</Btn>
        </div>
      </div>
    </div>
  );
}

function DocRow({ type, doc, T, busy, onUpload, onExpiry, onDelete }) {
  const [expire, setExpire] = useState(doc?.expire_le || "");
  return (
    <div style={{ border: "1px solid #E4E6EA", borderRadius: 10, padding: "8px 12px", background: doc?.statut === "demande" ? AMBER_LIGHT : "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <strong style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5 }}><FileText size={13} /> {T["doc_" + type]}</strong>
        <DocStatusPill doc={doc} T={T} />
      </div>
      {doc?.note && <div style={{ fontSize: 11.5, color: "#5B6270", marginBottom: 6 }}>« {doc.note} »</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: "#5B6270" }}>{T.doc_expires}</span>
        <input type="date" style={{ ...inputStyle, width: "auto", padding: "5px 8px", fontSize: 12 }} value={expire}
          onChange={(e) => setExpire(e.target.value)} onBlur={() => { if (doc?.fichier_path && expire !== (doc.expire_le || "")) onExpiry(doc, expire); }} />
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)", cursor: busy ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Upload size={12} /> {T.doc_upload}
          <input type="file" accept="image/*,application/pdf" style={{ display: "none" }} disabled={busy} onChange={(e) => onUpload(type, e.target.files?.[0], expire)} />
        </label>
        {doc?.fichier_path && <button onClick={() => openSignedFile("carpool-documents", doc.fichier_path)} style={{ fontSize: 12, fontWeight: 600, color: TEAL, background: "none", border: "none", cursor: "pointer" }}>{T.doc_view}</button>}
        {doc && doc.statut !== "demande" && <button onClick={() => onDelete(doc)} style={{ background: "none", border: "none", cursor: "pointer", color: RED }}><Trash2 size={12} /></button>}
      </div>
    </div>
  );
}

function VehicleForm({ profile, vehicle, plaque: plaqueInit, T, onCancel, onSaved, onError }) {
  const [form, setForm] = useState({
    marque: vehicle?.marque || "", modele: vehicle?.modele || "", couleur: vehicle?.couleur || "",
    annee: vehicle?.annee || "", places: vehicle?.places || 3, plaque: plaqueInit || "",
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const valid = form.marque.trim() && form.modele.trim() && form.couleur.trim() && Number(form.places) >= 1;

  async function save() {
    if (!valid) return;
    setSaving(true);
    const row = {
      marque: form.marque.trim(), modele: form.modele.trim(), couleur: form.couleur.trim(),
      annee: form.annee === "" ? null : Number(form.annee), places: Math.min(8, Math.max(1, Number(form.places) || 1)),
    };
    let saved;
    if (vehicle) {
      const { data, error } = await supabase.from("carpool_vehicules").update(row).eq("id", vehicle.id).select().single();
      if (onError(error)) { setSaving(false); return; }
      saved = data;
    } else {
      const { data, error } = await supabase.from("carpool_vehicules").insert({ ...row, association_id: profile.association_id, member_id: profile.member_id }).select().single();
      if (onError(error)) { setSaving(false); return; }
      saved = data;
    }
    if (form.plaque.trim()) {
      const { error } = await supabase.from("carpool_vehicule_plaques").upsert({ vehicule_id: saved.id, association_id: profile.association_id, plaque: form.plaque.trim().toUpperCase() });
      if (onError(error)) { setSaving(false); return; }
    } else if (vehicle) {
      await supabase.from("carpool_vehicule_plaques").delete().eq("vehicule_id", saved.id);
    }
    if (file) {
      const path = `${profile.association_id}/${profile.member_id}/${saved.id}_${Date.now()}_${safeName(file.name)}`;
      const { error: upErr } = await supabase.storage.from("carpool-vehicules").upload(path, file, { upsert: true });
      if (onError(upErr)) { setSaving(false); return; }
      const { error } = await supabase.from("carpool_vehicules").update({ photo_path: path }).eq("id", saved.id);
      if (onError(error)) { setSaving(false); return; }
      if (vehicle?.photo_path) await supabase.storage.from("carpool-vehicules").remove([vehicle.photo_path]);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <div style={{ background: "#F6F8FA", borderRadius: 12, padding: 12, marginBottom: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
        <Field label={T.brand}><input style={inputStyle} value={form.marque} onChange={set("marque")} placeholder="Toyota" /></Field>
        <Field label={T.model}><input style={inputStyle} value={form.modele} onChange={set("modele")} placeholder="Corolla" /></Field>
        <Field label={T.color}><input style={inputStyle} value={form.couleur} onChange={set("couleur")} /></Field>
        <Field label={T.year}><input type="number" min="1950" max="2100" style={inputStyle} value={form.annee} onChange={set("annee")} /></Field>
        <Field label={T.seats}><input type="number" min="1" max="8" style={inputStyle} value={form.places} onChange={set("places")} /></Field>
        <Field label={T.plate}><input style={inputStyle} value={form.plaque} onChange={set("plaque")} /></Field>
      </div>
      <p style={{ fontSize: 11, color: "#8A8F98", marginTop: -6, marginBottom: 8 }}>{T.plate_hint}</p>
      <Field label={T.vehicle_photo}><input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onCancel}><X size={13} /></Btn>
        <Btn onClick={save} disabled={saving || !valid}><Check size={13} /> {T.save}</Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Volet bureau : conducteurs, véhicules, documents, badge vérifié
// ---------------------------------------------------------------------
export function ConducteursAdmin({ members, offers, vehicules, plaques, documents, onToggleVerify, onChanged }) {
  const T = useTxtConducteur();
  const { t } = useLang();
  const [msg, setMsg] = useState("");
  const driverIds = new Set([...vehicules.map((v) => v.member_id), ...offers.map((o) => o.member_id), ...documents.map((d) => d.member_id)]);
  const drivers = members.filter((m) => driverIds.has(m.id)).sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));

  async function requestDocs(m) {
    const note = window.prompt(T.admin_request_prompt);
    if (note === null) return;
    const { data, error } = await supabase.rpc("demander_documents_covoiturage", { p_member_id: m.id, p_types: DOC_TYPES, p_note: note || null });
    if (error) { setMsg(covErr(error, t)); return; }
    setMsg(T.admin_requested.replace("{n}", data ?? 0));
    onChanged?.();
  }
  async function review(doc, ok) {
    const note = ok ? null : window.prompt(T.admin_refuse_prompt);
    if (!ok && note === null) return;
    const { error } = await supabase.rpc("valider_document_covoiturage", { p_document_id: doc.id, p_valide: ok, p_note: note || null });
    if (error) { setMsg(covErr(error, t)); return; }
    onChanged?.();
  }

  return (
    <div>
      <h3 style={{ fontSize: 15, marginBottom: 4 }}>{T.admin_title}</h3>
      <p style={{ fontSize: 12, color: "#5B6270", marginBottom: 10 }}>{T.admin_intro}</p>
      {msg && <p style={{ fontSize: 12.5, color: TEAL, marginBottom: 8 }}>{msg}</p>}
      {drivers.length === 0 && <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{T.admin_empty}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {drivers.map((m) => {
          const vs = vehicules.filter((v) => v.member_id === m.id);
          const ds = documents.filter((d) => d.member_id === m.id);
          return (
            <Card key={m.id} style={{ borderTopColor: m.covoiturage_verifie ? TEAL : "#DCE0E8" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <DriverAvatar photoUrl={m.photo_url} nom={m.nom} size={40} />
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{m.nom}</div>
                  <div style={{ fontSize: 11.5, color: "#5B6270" }}>{m.telephone || "—"}{!m.photo_url && <span style={{ color: RED }}> · {T.admin_no_photo}</span>}</div>
                </div>
                {m.covoiturage_verifie && <Pill color={TEAL} bg={TEAL_LIGHT}><ShieldCheck size={11} style={{ marginRight: 3 }} />{T.verified}</Pill>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                {vs.length === 0 && <span style={{ fontSize: 12, color: "#8A8F98" }}>{T.admin_no_vehicle}</span>}
                {vs.map((v) => (
                  <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <VehiculePhoto path={v.photo_path} size={44} />
                    <span>{vehiculeLabel(v)} · {T.seats} : {v.places} · {T.plate} : <strong>{plaques.find((p) => p.vehicule_id === v.id)?.plaque || "—"}</strong></span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                {DOC_TYPES.map((type) => {
                  const doc = ds.filter((d) => d.type === type).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
                  return (
                    <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                      <span style={{ minWidth: 130 }}>{T["doc_" + type]}</span>
                      <DocStatusPill doc={doc} T={T} />
                      {doc?.expire_le && <span style={{ color: "#5B6270" }}>{T.doc_expires} {doc.expire_le}</span>}
                      {doc?.fichier_path && <button onClick={() => openSignedFile("carpool-documents", doc.fichier_path)} style={{ fontSize: 12, fontWeight: 600, color: TEAL, background: "none", border: "none", cursor: "pointer" }}>{T.doc_view}</button>}
                      {doc?.fichier_path && doc.statut === "soumis" && (
                        <>
                          <button onClick={() => review(doc, true)} style={{ fontSize: 12, fontWeight: 600, color: TEAL, background: "none", border: "none", cursor: "pointer" }}><Check size={11} /> {T.admin_validate}</button>
                          <button onClick={() => review(doc, false)} style={{ fontSize: 12, fontWeight: 600, color: RED, background: "none", border: "none", cursor: "pointer" }}><X size={11} /> {T.admin_refuse}</button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button onClick={() => requestDocs(m)} style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}><Send size={11} /> {T.admin_request_docs}</button>
                <button onClick={() => onToggleVerify(m.id, m.nom, !m.covoiturage_verifie)} style={{ fontSize: 12, fontWeight: 600, color: m.covoiturage_verifie ? "#8A8F98" : TEAL, background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <ShieldCheck size={11} /> {m.covoiturage_verifie ? T.admin_revoke : T.admin_grant}
                </button>
                {ds.some((d) => docExpiryInfo(d) === "expired") && <span style={{ fontSize: 11.5, color: RED, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={11} /> {T.doc_expired}</span>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
