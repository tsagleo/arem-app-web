// =====================================================================
// CovoiturageEtats.jsx — États du covoiturage (2026-10-09)
//
// - Fiche trajet : durée estimée et réelle, distance, tranche appliquée,
//   montant figé, frais, paiement.
// - Relevé MENSUEL par conducteur et par passager (chacun voit les siens ;
//   le bureau peut choisir n'importe quel membre).
// - Tableau de bord de l'association (bureau) : trajets, km, CO2 évité,
//   montants (dus / payés / en attente).
// - Exports PDF et CSV de la vue affichée.
// Rappel : il s'agit d'une contribution aux frais de carburant réglée de
// membre à membre ; l'association ne détient jamais l'argent.
// =====================================================================
import { useState, useMemo } from "react";
import { FileText, Download, BarChart3, Leaf, Car, Users, Wallet, X } from "lucide-react";
import { Card, Btn, Pill, StatCard, inputStyle, money, TEAL, TEAL_LIGHT } from "./shared";
import { trancheLabel } from "./covoiturageOutils";

const AMBER = "#8A5A00";
const AMBER_LIGHT = "#FDF3DF";
const CO2_KG_PAR_KM = 0.2; // même estimation que le bandeau d'impact (Phase C)
const STATUTS_RETENUS = ["acceptee", "en_route", "arrivee", "a_bord", "terminee"];
const overlay = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 };

const TXT_ETATS = {
  fr: {
    title: "États",
    view_driver: "Relevé conducteur",
    view_passenger: "Relevé passager",
    view_dashboard: "Tableau de bord association",
    month: "Mois",
    member: "Membre",
    me: "Moi",
    empty: "Aucun trajet confirmé sur cette période.",
    col_date: "Date", col_route: "Trajet", col_driver: "Conducteur", col_passenger: "Passager",
    col_est: "Durée estimée", col_real: "Durée réelle", col_km: "Distance", col_tranche: "Tranche",
    col_amount: "Montant dû", col_payment: "Paiement", col_statut: "Statut",
    tot_trips: "Trajets", tot_km: "Km", tot_due: "Total dû", tot_paid: "Payé", tot_unpaid: "En attente",
    co2: "CO2 évité (kg)",
    export_csv: "CSV", export_pdf: "PDF",
    pay_non_paye: "Non payé", pay_declare_paye: "Déclaré payé", pay_paye: "Payé", pay_offert: "Offert",
    fuel_note: "Contribution aux frais de carburant, réglée directement entre membres (espèces ou Interac). L'association ne détient jamais l'argent.",
    by_driver: "Par conducteur",
    fiche_title: "Fiche trajet",
    f_vehicle: "Véhicule", f_seats: "Places", f_unit: "Prix par passager (figé)", f_grid_max: "Maximum selon la grille",
    f_solidaire: "Tarif solidaire", f_wait: "Frais d'attente", f_real: "Frais réels", f_mode: "Mode", f_paid_on: "Payé le",
    f_wait_time: "Temps d'attente", f_close: "Fermer",
    pdf_title_driver: "Relevé conducteur — {nom} — {mois}",
    pdf_title_passenger: "Relevé passager — {nom} — {mois}",
    pdf_title_dashboard: "Tableau de bord covoiturage — {mois}",
    solid_etudiant: "étudiant", solid_aine: "aîné", solid_evenement: "événement",
  },
  en: {
    title: "Statements",
    view_driver: "Driver statement",
    view_passenger: "Passenger statement",
    view_dashboard: "Association dashboard",
    month: "Month",
    member: "Member",
    me: "Me",
    empty: "No confirmed ride in this period.",
    col_date: "Date", col_route: "Route", col_driver: "Driver", col_passenger: "Passenger",
    col_est: "Estimated time", col_real: "Actual time", col_km: "Distance", col_tranche: "Bracket",
    col_amount: "Amount due", col_payment: "Payment", col_statut: "Status",
    tot_trips: "Rides", tot_km: "Km", tot_due: "Total due", tot_paid: "Paid", tot_unpaid: "Outstanding",
    co2: "CO2 avoided (kg)",
    export_csv: "CSV", export_pdf: "PDF",
    pay_non_paye: "Unpaid", pay_declare_paye: "Reported paid", pay_paye: "Paid", pay_offert: "Free",
    fuel_note: "Fuel cost contribution, paid directly between members (cash or Interac). The association never holds the money.",
    by_driver: "By driver",
    fiche_title: "Ride sheet",
    f_vehicle: "Vehicle", f_seats: "Seats", f_unit: "Price per passenger (locked)", f_grid_max: "Grid maximum",
    f_solidaire: "Solidarity rate", f_wait: "Waiting fee", f_real: "Actual costs", f_mode: "Method", f_paid_on: "Paid on",
    f_wait_time: "Waiting time", f_close: "Close",
    pdf_title_driver: "Driver statement — {nom} — {mois}",
    pdf_title_passenger: "Passenger statement — {nom} — {mois}",
    pdf_title_dashboard: "Carpool dashboard — {mois}",
    solid_etudiant: "student", solid_aine: "senior", solid_evenement: "event",
  },
};

function fmtMin(m) {
  if (m == null || !isFinite(m)) return "—";
  const r = Math.round(m);
  if (r < 60) return `${r} min`;
  return `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")}`;
}
function fmtDate(iso, lang) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(lang === "en" ? "en-CA" : "fr-CA", { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; }
}
function monthKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function currentMonth() { return monthKey(new Date().toISOString()); }

// Une ligne d'état par réservation, toutes données dérivées au même endroit.
function buildEtatRow(b, offers, members, vehicules) {
  const offer = offers.find((o) => o.id === b.offer_id) || null;
  const driver = offer ? members.find((m) => m.id === offer.member_id) || null : null;
  const passenger = members.find((m) => m.id === b.passenger_member_id) || null;
  const vehicule = offer?.vehicule_id ? vehicules.find((v) => v.id === offer.vehicule_id) || null : null;
  const date = offer?.date_heure || b.created_at;
  const dureeReelleMin = b.a_bord_at && b.terminee_at ? (new Date(b.terminee_at) - new Date(b.a_bord_at)) / 60000 : null;
  const attenteMin = b.arrivee_at && b.a_bord_at ? (new Date(b.a_bord_at) - new Date(b.arrivee_at)) / 60000 : null;
  const distM = b.distance_m ?? b.distance_estimee_m ?? offer?.distance_estimee_m ?? null;
  const km = distM != null ? Number(distM) / 1000 : null;
  const montantDu = b.montant_du != null ? Number(b.montant_du) : (offer?.prix_place != null ? Number(offer.prix_place) * (b.seats_reserved || 1) : 0);
  return {
    booking: b, offer, driver, passenger, vehicule, date,
    dureeEstMin: b.duree_estimee_min ?? offer?.duree_estimee_min ?? null,
    dureeReelleMin, attenteMin, km, montantDu,
    paiement: b.paiement_statut || (montantDu > 0 ? "non_paye" : "offert"),
  };
}

function totals(rows) {
  const t = { trips: rows.length, km: 0, kmPassagers: 0, due: 0, paid: 0, unpaid: 0 };
  for (const r of rows) {
    if (r.km != null) { t.km += r.km; t.kmPassagers += r.km * (r.booking.seats_reserved || 1); }
    t.due += r.montantDu;
    if (r.paiement === "paye") t.paid += r.montantDu;
    else if (r.paiement !== "offert") t.unpaid += r.montantDu;
  }
  return t;
}

function routeText(r) { return r.offer ? `${r.offer.point_depart} -> ${r.offer.point_arrivee}` : "—"; }

export default function EtatsPanel({ t, lang, devise, profile, isBureau, bookings, offers, members, vehicules }) {
  const E = TXT_ETATS[lang === "en" ? "en" : "fr"];
  const [view, setView] = useState("driver"); // driver | passenger | dashboard
  const [month, setMonth] = useState(currentMonth());
  const [memberId, setMemberId] = useState(profile.member_id || "");
  const [fiche, setFiche] = useState(null);

  const allRows = useMemo(
    () => bookings.filter((b) => STATUTS_RETENUS.includes(b.statut)).map((b) => buildEtatRow(b, offers, members, vehicules)),
    [bookings, offers, members, vehicules]
  );
  const monthRows = useMemo(() => allRows.filter((r) => !month || monthKey(r.date) === month).sort((a, b) => new Date(a.date) - new Date(b.date)), [allRows, month]);
  const targetId = isBureau ? memberId : profile.member_id;
  const rows = useMemo(() => {
    if (view === "dashboard") return monthRows;
    if (view === "driver") return monthRows.filter((r) => r.driver?.id === targetId);
    return monthRows.filter((r) => r.passenger?.id === targetId);
  }, [view, monthRows, targetId]);
  const tot = totals(rows);
  const targetNom = members.find((m) => m.id === targetId)?.nom || "—";
  const byDriver = useMemo(() => {
    const map = new Map();
    for (const r of monthRows) {
      const k = r.driver?.id || "?";
      if (!map.has(k)) map.set(k, { nom: r.driver?.nom || "—", rows: [] });
      map.get(k).rows.push(r);
    }
    return [...map.values()].map((v) => ({ nom: v.nom, ...totals(v.rows) })).sort((a, b) => b.trips - a.trips);
  }, [monthRows]);

  const payLabel = (p) => E["pay_" + p] || p;
  const columns = [
    { k: "date", h: E.col_date, v: (r) => fmtDate(r.date, lang) },
    { k: "route", h: E.col_route, v: routeText },
    ...(view !== "driver" ? [{ k: "driver", h: E.col_driver, v: (r) => r.driver?.nom || "—" }] : []),
    ...(view !== "passenger" ? [{ k: "passenger", h: E.col_passenger, v: (r) => r.passenger?.nom || r.booking.passenger_nom || "—" }] : []),
    { k: "est", h: E.col_est, v: (r) => fmtMin(r.dureeEstMin) },
    { k: "real", h: E.col_real, v: (r) => fmtMin(r.dureeReelleMin) },
    { k: "km", h: E.col_km, v: (r) => (r.km != null ? `${r.km.toFixed(1)} km` : "—") },
    { k: "tranche", h: E.col_tranche, v: (r) => (r.booking.tranche_appliquee ? trancheLabel(r.booking.tranche_appliquee, lang) : "—") },
    { k: "amount", h: E.col_amount, v: (r) => money(r.montantDu, devise) },
    { k: "payment", h: E.col_payment, v: (r) => payLabel(r.paiement) },
  ];
  const title = view === "dashboard"
    ? E.pdf_title_dashboard.replace("{mois}", month || "—")
    : (view === "driver" ? E.pdf_title_driver : E.pdf_title_passenger).replace("{nom}", targetNom).replace("{mois}", month || "—");
  const fileBase = `covoiturage-${view}-${month || "tout"}`;

  function exportCsv() {
    const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = [columns.map((c) => esc(c.h)).join(";"), ...rows.map((r) => columns.map((c) => esc(c.v(r))).join(";"))];
    lines.push("");
    lines.push([esc(E.tot_trips), esc(tot.trips), esc(E.tot_km), esc(tot.km.toFixed(1)), esc(E.tot_due), esc(money(tot.due, devise)), esc(E.tot_paid), esc(money(tot.paid, devise)), esc(E.tot_unpaid), esc(money(tot.unpaid, devise))].join(";"));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileBase}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function exportPdf() {
    let jsPDFmod, autoTableMod;
    try { [jsPDFmod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]); }
    catch { window.alert(t("rap_missing_deps")); return; }
    const { jsPDF } = jsPDFmod;
    const autoTable = autoTableMod.default;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(13);
    doc.text(title, 14, 15);
    doc.setFontSize(8.5);
    doc.text(E.fuel_note, 14, 21);
    doc.text(`${E.tot_trips}: ${tot.trips}   ${E.tot_km}: ${tot.km.toFixed(1)}   ${E.co2}: ${Math.round(tot.kmPassagers * CO2_KG_PAR_KM)}   ${E.tot_due}: ${money(tot.due, devise)}   ${E.tot_paid}: ${money(tot.paid, devise)}   ${E.tot_unpaid}: ${money(tot.unpaid, devise)}`, 14, 26);
    autoTable(doc, {
      startY: 31,
      head: [columns.map((c) => c.h)],
      body: rows.map((r) => columns.map((c) => c.v(r))),
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [14, 124, 102] },
    });
    if (view === "dashboard" && byDriver.length) {
      autoTable(doc, {
        head: [[E.by_driver, E.tot_trips, E.tot_km, E.tot_due, E.tot_paid, E.tot_unpaid]],
        body: byDriver.map((d) => [d.nom, d.trips, d.km.toFixed(1), money(d.due, devise), money(d.paid, devise), money(d.unpaid, devise)]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [31, 56, 100] },
      });
    }
    doc.save(`${fileBase}.pdf`);
  }

  const tabStyle = (active) => ({ fontWeight: 600, fontSize: 12.5, color: active ? "#fff" : "#5B6270", background: active ? "var(--primary)" : "transparent", border: active ? "none" : "1px solid #DCE0E8", borderRadius: 999, padding: "7px 14px", cursor: "pointer" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={() => setView("driver")} style={tabStyle(view === "driver")}><Car size={12} /> {E.view_driver}</button>
        <button onClick={() => setView("passenger")} style={tabStyle(view === "passenger")}><Users size={12} /> {E.view_passenger}</button>
        {isBureau && <button onClick={() => setView("dashboard")} style={tabStyle(view === "dashboard")}><BarChart3 size={12} /> {E.view_dashboard}</button>}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>{E.month}
          <input type="month" style={{ ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 12.5 }} value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        {isBureau && view !== "dashboard" && (
          <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>{E.member}
            <select style={{ ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 12.5 }} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              {profile.member_id && <option value={profile.member_id}>{E.me}</option>}
              {[...members].sort((a, b) => (a.nom || "").localeCompare(b.nom || "")).filter((m) => m.id !== profile.member_id).map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
          </label>
        )}
        <div style={{ flex: 1 }} />
        <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={exportCsv} disabled={!rows.length}><Download size={12} /> {E.export_csv}</Btn>
        <Btn variant="outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={exportPdf} disabled={!rows.length}><FileText size={12} /> {E.export_pdf}</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
        <StatCard label={E.tot_trips} value={tot.trips} icon={Car} accent={TEAL} />
        <StatCard label={E.tot_km} value={Math.round(tot.km)} icon={BarChart3} />
        {view === "dashboard" && <StatCard label={E.co2} value={Math.round(tot.kmPassagers * CO2_KG_PAR_KM)} icon={Leaf} accent={TEAL} />}
        <StatCard label={E.tot_due} value={money(tot.due, devise)} icon={Wallet} />
        <StatCard label={E.tot_paid} value={money(tot.paid, devise)} icon={Wallet} accent={TEAL} />
        <StatCard label={E.tot_unpaid} value={money(tot.unpaid, devise)} icon={Wallet} accent={tot.unpaid > 0 ? AMBER : undefined} />
      </div>
      <p style={{ fontSize: 11.5, color: "#5B6270", margin: 0 }}>{E.fuel_note}</p>

      {rows.length === 0 ? (
        <p style={{ color: "#686F7D", fontStyle: "italic", fontSize: 13 }}>{E.empty}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#8A8F98", fontSize: 11 }}>{columns.map((c) => <th key={c.k} style={{ padding: "6px 8px" }}>{c.h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.booking.id} onClick={() => setFiche(r)} style={{ borderTop: "1px solid #F1F2F4", cursor: "pointer" }}>
                  {columns.map((c) => (
                    <td key={c.k} style={{ padding: "6px 8px", whiteSpace: c.k === "route" ? "normal" : "nowrap" }}>
                      {c.k === "payment" ? <PayPill p={r.paiement} label={payLabel(r.paiement)} /> : c.v(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "dashboard" && byDriver.length > 0 && (
        <Card>
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>{E.by_driver}</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ textAlign: "left", color: "#8A8F98", fontSize: 11 }}><th>{E.col_driver}</th><th>{E.tot_trips}</th><th>{E.tot_km}</th><th>{E.tot_due}</th><th>{E.tot_paid}</th><th>{E.tot_unpaid}</th></tr></thead>
            <tbody>
              {byDriver.map((d) => (
                <tr key={d.nom} style={{ borderTop: "1px solid #F1F2F4" }}>
                  <td style={{ padding: "5px 0" }}>{d.nom}</td><td>{d.trips}</td><td>{d.km.toFixed(1)}</td><td>{money(d.due, devise)}</td><td>{money(d.paid, devise)}</td><td style={{ color: d.unpaid > 0 ? AMBER : undefined }}>{money(d.unpaid, devise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {fiche && <FicheTrajetModal E={E} lang={lang} devise={devise} row={fiche} onClose={() => setFiche(null)} />}
    </div>
  );
}

function PayPill({ p, label }) {
  const map = { paye: [TEAL, TEAL_LIGHT], offert: [TEAL, TEAL_LIGHT], declare_paye: ["#1F3864", "#EEF1F8"], non_paye: [AMBER, AMBER_LIGHT] };
  const [c, bg] = map[p] || map.non_paye;
  return <Pill color={c} bg={bg}>{label}</Pill>;
}

export function FicheTrajetModal({ E: Eprop, lang, devise, row, onClose }) {
  const E = Eprop || TXT_ETATS[lang === "en" ? "en" : "fr"];
  const b = row.booking;
  const line = (label, value) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid #F1F2F4" }}>
      <span style={{ color: "#5B6270" }}>{label}</span><strong style={{ textAlign: "right" }}>{value}</strong>
    </div>
  );
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}><FileText size={16} color={TEAL} /> {E.fiche_title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={16} /></button>
        </div>
        {line(E.col_date, fmtDate(row.date, lang))}
        {line(E.col_route, routeText(row))}
        {line(E.col_driver, row.driver?.nom || "—")}
        {line(E.col_passenger, row.passenger?.nom || b.passenger_nom || "—")}
        {row.vehicule && line(E.f_vehicle, [row.vehicule.marque, row.vehicule.modele, row.vehicule.couleur].filter(Boolean).join(" "))}
        {line(E.f_seats, b.seats_reserved || 1)}
        {line(E.col_est, fmtMin(row.dureeEstMin))}
        {line(E.col_real, fmtMin(row.dureeReelleMin))}
        {line(E.f_wait_time, fmtMin(row.attenteMin))}
        {line(E.col_km, row.km != null ? `${row.km.toFixed(1)} km` : "—")}
        {line(E.col_tranche, b.tranche_appliquee ? trancheLabel(b.tranche_appliquee, lang) : "—")}
        {b.prix_grille_unitaire != null && line(E.f_grid_max, money(b.prix_grille_unitaire, devise))}
        {b.prix_unitaire != null && line(E.f_unit, money(b.prix_unitaire, devise))}
        {b.tarif_solidaire_pct != null && line(E.f_solidaire, `-${Number(b.tarif_solidaire_pct)} % (${E["solid_" + b.tarif_solidaire_motif] || b.tarif_solidaire_motif})`)}
        {Number(b.frais_attente) > 0 && line(E.f_wait, money(b.frais_attente, devise))}
        {Number(b.frais_reels) > 0 && line(E.f_real, `${money(b.frais_reels, devise)}${b.frais_reels_description ? ` (${b.frais_reels_description})` : ""}`)}
        {line(E.col_amount, money(row.montantDu, devise))}
        {line(E.col_payment, <PayPill p={row.paiement} label={E["pay_" + row.paiement] || row.paiement} />)}
        {b.paiement_mode && line(E.f_mode, b.paiement_mode === "interac" ? "Interac" : (lang === "en" ? "Cash" : "Espèces"))}
        {b.paye_le && line(E.f_paid_on, fmtDate(b.paye_le, lang))}
        <p style={{ fontSize: 11, color: "#8A8F98", marginTop: 10 }}>{E.fuel_note}</p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn variant="outline" onClick={onClose}>{E.f_close}</Btn>
        </div>
      </div>
    </div>
  );
}
