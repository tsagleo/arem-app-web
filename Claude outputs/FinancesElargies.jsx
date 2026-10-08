// =====================================================================
// FinancesElargies.jsx — Dons, Emprunts, Budgets de projets
// Développé par Omnia Trade Solutions
// =====================================================================
import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Gift, Landmark, Plus, Printer, FileText, Pencil, Trash2, History } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Section, Container, Card, Btn, Field, Table, td, inputStyle, money, todayISO, useLang, RuleBox, RED, SignatureLine } from "./shared";

export default function FinancesElargies({ profile, isBureau, mode, association }) {
  // mode: 'dons' | 'emprunts'
  const [members, setMembers] = useState([]);
  const [donations, setDonations] = useState([]);
  const [loans, setLoans] = useState([]);
  const [repayments, setRepayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const { t, lang } = useLang();
  const devise = "CAD";

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: mem }, { data: dons }, { data: lns }, { data: rep }] = await Promise.all([
      supabase.from("members").select("id,nom").order("nom"),
      supabase.from("donations").select("*").eq("association_id", profile.association_id).order("date", { ascending: false }),
      supabase.from("loans").select("*").eq("association_id", profile.association_id).order("date_pret", { ascending: false }),
      supabase.from("loan_repayments").select("*"),
    ]);
    setMembers((mem || []).filter((m) => m.statut !== "Supprimé")); setDonations(dons || []); setLoans(lns || []); setRepayments(rep || []);
    setLoading(false);
  }, [profile.association_id]);
  useEffect(() => { load(); }, [load]);

  // ---------- Approbation des suppressions (transactions financières) ----------
  // Même mécanisme que dans App.jsx (dépenses de fonds, séances de tontine/
  // collation) : si l'association a désigné un approbateur et que ce n'est
  // pas la personne connectée, la suppression n'a pas lieu immédiatement —
  // une demande est créée dans `deletion_requests`, à approuver depuis
  // l'onglet "Demandes de suppression" (App.jsx).
  async function requestOrDelete({ tableName, recordId, description }, performDelete) {
    const approverId = association?.approbateur_suppression_id;
    if (!approverId || approverId === profile.id) {
      await performDelete();
      return true;
    }
    const { error } = await supabase.from("deletion_requests").insert({
      association_id: profile.association_id, table_name: tableName, record_id: recordId,
      description, requested_by: profile.id, requested_by_nom: profile.nom_complet,
    });
    if (error) { alert("Erreur : " + error.message); return false; }
    alert(t("del_req_sent_alert").replace("{name}", t("del_req_sent_alert_fallback")));
    return false;
  }

  // ---------- Dons ----------
  const [newDon, setNewDon] = useState({ donateur_nom: "", donateur_email: "", montant: "", message: "" });
  async function addDonation() {
    if (!newDon.donateur_nom.trim() || !newDon.montant) return;
    const { data, error } = await supabase.from("donations").insert({
      association_id: profile.association_id, donateur_nom: newDon.donateur_nom, donateur_email: newDon.donateur_email,
      montant: Number(newDon.montant), message: newDon.message, date: todayISO(),
    }).select().single();
    if (!error) { setDonations((p) => [data, ...p]); setNewDon({ donateur_nom: "", donateur_email: "", montant: "", message: "" }); }
  }
  async function toggleRecu(id, val) {
    await supabase.from("donations").update({ recu_emis: val }).eq("id", id);
    setDonations((prev) => prev.map((d) => (d.id === id ? { ...d, recu_emis: val } : d)));
  }
  const totalDons = donations.reduce((s, d) => s + Number(d.montant), 0);

  // ---------- Modifier / Supprimer un don ----------
  const [editingDon, setEditingDon] = useState(null);
  async function updateDonation(id, patch) {
    const { error } = await supabase.from("donations").update(patch).eq("id", id);
    if (!error) setDonations((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }
  async function deleteDonation(id) {
    if (!window.confirm(t("don_confirm_delete"))) return;
    const d = donations.find((x) => x.id === id);
    const description = t("del_desc_donation")
      .replace("{donateur}", d?.donateur_nom || "—").replace("{amount}", money(d?.montant || 0, devise)).replace("{date}", d?.date || "");
    await requestOrDelete({ tableName: "donations", recordId: id, description }, async () => {
      await supabase.from("donations").delete().eq("id", id);
      setDonations((prev) => prev.filter((x) => x.id !== id));
    });
  }

  // ---------- Reçu de don (imprimable / téléchargeable) ----------
  const [receiptDonId, setReceiptDonId] = useState(null);

  // ---------- Emprunts ----------
  const [newLoan, setNewLoan] = useState({ member_id: "", montant_pret: "", taux_interet: "0", date_echeance: "" });
  async function addLoan() {
    if (!newLoan.member_id || !newLoan.montant_pret) return;
    const { data, error } = await supabase.from("loans").insert({
      association_id: profile.association_id, member_id: newLoan.member_id, montant_pret: Number(newLoan.montant_pret),
      taux_interet: Number(newLoan.taux_interet) || 0, date_pret: todayISO(), date_echeance: newLoan.date_echeance || null,
    }).select().single();
    if (!error) { setLoans((p) => [data, ...p]); setNewLoan({ member_id: "", montant_pret: "", taux_interet: "0", date_echeance: "" }); }
  }
  function loanRepaid(loanId) { return repayments.filter((r) => r.loan_id === loanId).reduce((s, r) => s + Number(r.montant), 0); }
  // Intérêts simples (taux appliqué une fois sur le capital, tel qu'accordé au prêt) —
  // le "capital avec les intérêts produits" est donc le montant réellement dû à recouvrer.
  function loanInterest(l) { return Number(l.montant_pret) * (Number(l.taux_interet) || 0) / 100; }
  function loanTotalDue(l) { return Number(l.montant_pret) + loanInterest(l); }
  const [repayDraft, setRepayDraft] = useState({});
  async function addRepayment(loanId) {
    const montant = Number(repayDraft[loanId]);
    if (!montant) return;
    const { data, error } = await supabase.from("loan_repayments").insert({
      loan_id: loanId, association_id: profile.association_id, montant, date: todayISO(),
    }).select().single();
    if (!error) {
      setRepayments((p) => [...p, data]);
      setRepayDraft((p) => ({ ...p, [loanId]: "" }));
      const loan = loans.find((l) => l.id === loanId);
      // Le prêt n'est considéré remboursé qu'une fois le capital ET les intérêts couverts.
      if (loan && loanRepaid(loanId) + montant >= loanTotalDue(loan)) {
        await supabase.from("loans").update({ statut: "rembourse" }).eq("id", loanId);
        setLoans((prev) => prev.map((l) => (l.id === loanId ? { ...l, statut: "rembourse" } : l)));
      }
    }
  }

  // ---------- Modifier / Supprimer un prêt ----------
  const [editingLoan, setEditingLoan] = useState(null);
  const [historyLoanId, setHistoryLoanId] = useState(null);
  async function updateLoan(id, patch) {
    const { error } = await supabase.from("loans").update(patch).eq("id", id);
    if (!error) setLoans((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  async function deleteLoan(id) {
    if (!window.confirm(t("loan_confirm_delete"))) return;
    const l0 = loans.find((x) => x.id === id);
    const emprunteur = members.find((m) => m.id === l0?.member_id)?.nom || "—";
    const description = t("del_desc_loan").replace("{emprunteur}", emprunteur).replace("{amount}", money(l0?.montant_pret || 0, devise));
    await requestOrDelete({ tableName: "loans", recordId: id, description }, async () => {
      // Suppression en cascade : les remboursements du prêt d'abord, puis le prêt lui-même.
      await supabase.from("loan_repayments").delete().eq("loan_id", id);
      await supabase.from("loans").delete().eq("id", id);
      setRepayments((prev) => prev.filter((r) => r.loan_id !== id));
      setLoans((prev) => prev.filter((x) => x.id !== id));
    });
  }

  if (loading) return <Container><Section><p>{t("loading")}</p></Section></Container>;

  if (mode === "dons") {
    return (
      <Container><Section>
        <h2 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><Gift size={20} /> {t("nav_donations")}</h2>
        <RuleBox>{t("don_rule")}</RuleBox>
        <div style={{ marginBottom: 20 }}>
          <b>{t("don_total_received")} </b>{money(totalDons, devise)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isBureau ? "1fr 1.4fr" : "1fr", gap: 22 }}>
          {isBureau && (
            <Card>
              <h3 style={{ fontSize: 13, marginBottom: 10 }}>{t("don_record_title")}</h3>
              <Field label={t("don_donor_name")}><input style={inputStyle} value={newDon.donateur_nom} onChange={(e) => setNewDon({ ...newDon, donateur_nom: e.target.value })} /></Field>
              <Field label={t("don_donor_email")}><input style={inputStyle} value={newDon.donateur_email} onChange={(e) => setNewDon({ ...newDon, donateur_email: e.target.value })} /></Field>
              <Field label={t("don_amount")}><input type="number" style={inputStyle} value={newDon.montant} onChange={(e) => setNewDon({ ...newDon, montant: e.target.value })} /></Field>
              <Field label={t("don_message")}><input style={inputStyle} value={newDon.message} onChange={(e) => setNewDon({ ...newDon, message: e.target.value })} /></Field>
              <Btn onClick={addDonation}><Plus size={14} /> {t("action_save")}</Btn>
            </Card>
          )}
          <Table head={[t("don_col_donor"), t("don_col_amount"), t("don_col_date"), t("don_col_receipt"), "", ...(isBureau ? [t("don_col_actions")] : [])]}>
            {donations.map((d) => (
              <tr key={d.id}>
                <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>{d.donateur_nom}</td>
                <td style={td}>{money(d.montant, devise)}</td>
                <td style={td}>{d.date}</td>
                <td style={{ ...td, color: d.recu_emis ? "#2E8B74" : "#C0392B", fontWeight: 700 }}>{d.recu_emis ? t("mem_yes") : t("mem_no")}</td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button onClick={() => setReceiptDonId(d.id)} title={t("don_receipt_btn")} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, border: "1px solid var(--primary)", color: "var(--primary)", background: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <FileText size={11} /> {t("don_receipt_btn")}
                    </button>
                    {isBureau && !d.recu_emis && <button onClick={() => toggleRecu(d.id, true)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, border: "1px solid #2E8B74", color: "#2E8B74", background: "none", cursor: "pointer" }}>{t("don_mark_issued")}</button>}
                  </div>
                </td>
                {isBureau && (
                  <td style={td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => setEditingDon(d)} title={t("don_edit_btn")} style={{ width: 22, height: 22, borderRadius: "50%", background: "none", border: "1px solid #DDD", color: "var(--primary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                        <Pencil size={11} />
                      </button>
                      <button onClick={() => deleteDonation(d.id)} title={t("don_delete_btn")} style={{ width: 22, height: 22, borderRadius: "50%", background: "none", border: `1px solid ${RED}`, color: RED, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {donations.length === 0 && <tr><td colSpan={6} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
          </Table>
        </div>

        {editingDon && (
          <EditDonationModal donation={editingDon} onClose={() => setEditingDon(null)} onSave={updateDonation} t={t} />
        )}
        {receiptDonId && (() => {
          const d = donations.find((x) => x.id === receiptDonId);
          if (!d) return null;
          return (
            <DonReceiptModal
              donation={d} association={association} t={t} lang={lang}
              onClose={() => setReceiptDonId(null)}
              onPrinted={() => { if (!d.recu_emis) toggleRecu(d.id, true); }}
            />
          );
        })()}
      </Section></Container>
    );
  }

  // mode === 'emprunts'
  return (
    <Container><Section>
      <h2 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><Landmark size={20} /> {t("nav_loans")}</h2>
      <RuleBox>{t("loan_rule")}</RuleBox>
      {isBureau && (
        <Card style={{ marginBottom: 22, maxWidth: 520 }}>
          <h3 style={{ fontSize: 13, marginBottom: 10 }}>{t("loan_grant_title")}</h3>
          <Field label={t("loan_member_field")}>
            <select style={inputStyle} value={newLoan.member_id} onChange={(e) => setNewLoan({ ...newLoan, member_id: e.target.value })}>
              <option value="">{t("proj_choose")}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
          </Field>
          <Field label={t("loan_amount_field")}><input type="number" style={inputStyle} value={newLoan.montant_pret} onChange={(e) => setNewLoan({ ...newLoan, montant_pret: e.target.value })} /></Field>
          <Field label={t("loan_interest_field")}><input type="number" style={inputStyle} value={newLoan.taux_interet} onChange={(e) => setNewLoan({ ...newLoan, taux_interet: e.target.value })} /></Field>
          <Field label={t("loan_due_field")}><input type="date" style={inputStyle} value={newLoan.date_echeance} onChange={(e) => setNewLoan({ ...newLoan, date_echeance: e.target.value })} /></Field>
          <Btn onClick={addLoan}><Plus size={14} /> {t("loan_grant_btn")}</Btn>
        </Card>
      )}
      <Table head={[
        t("loan_col_member"), t("loan_col_lent"), t("loan_col_rate"), t("loan_col_interest"), t("loan_col_total_due"),
        t("loan_col_repaid"), t("loan_col_balance"), t("loan_col_loan_date"), t("loan_col_due"), t("loan_col_status"),
        t("loan_col_repay"), ...(isBureau ? [t("loan_col_actions")] : []),
      ]}>
        {loans.map((l) => {
          const repaid = loanRepaid(l.id);
          const interet = loanInterest(l);
          const totalDue = loanTotalDue(l);
          const solde = totalDue - repaid;
          return (
            <tr key={l.id}>
              <td style={td}>
                <button onClick={() => setHistoryLoanId(l.id)} title={t("loan_hist_btn")} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600, color: "var(--primary)", textDecoration: "underline", fontSize: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <History size={11} /> {members.find((m) => m.id === l.member_id)?.nom || "—"}
                </button>
              </td>
              <td style={td}>{money(l.montant_pret, devise)}</td>
              <td style={td}>{Number(l.taux_interet) || 0}%</td>
              <td style={td}>{money(interet, devise)}</td>
              <td style={{ ...td, fontWeight: 600 }}>{money(totalDue, devise)}</td>
              <td style={td}>{money(repaid, devise)}</td>
              <td style={{ ...td, fontWeight: 700, color: solde > 0 ? "#C0392B" : "#2E8B74" }}>{money(Math.max(solde, 0), devise)}</td>
              <td style={td}>{l.date_pret || "—"}</td>
              <td style={td}>{l.date_echeance || "—"}</td>
              <td style={td}>{l.statut === "actif" ? t("loan_status_actif") : l.statut === "rembourse" ? t("loan_status_rembourse") : l.statut}</td>
              <td style={td}>
                {isBureau && l.statut === "actif" && (
                  <div style={{ display: "flex", gap: 4 }}>
                    <input type="number" placeholder={t("loan_repay_placeholder")} value={repayDraft[l.id] || ""} onChange={(e) => setRepayDraft((p) => ({ ...p, [l.id]: e.target.value }))} style={{ ...inputStyle, width: 80, padding: "3px 6px", fontSize: 11 }} />
                    <button onClick={() => addRepayment(l.id)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, border: "1px solid #2E8B74", color: "#2E8B74", background: "none", cursor: "pointer" }}>{t("loan_repay_btn")}</button>
                  </div>
                )}
              </td>
              {isBureau && (
                <td style={td}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => setEditingLoan(l)} title={t("loan_edit_btn")} style={{ width: 22, height: 22, borderRadius: "50%", background: "none", border: "1px solid #DDD", color: "var(--primary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                      <Pencil size={11} />
                    </button>
                    <button onClick={() => deleteLoan(l.id)} title={t("loan_delete_btn")} style={{ width: 22, height: 22, borderRadius: "50%", background: "none", border: `1px solid ${RED}`, color: RED, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          );
        })}
        {loans.length === 0 && <tr><td colSpan={12} style={{ ...td, color: "#999", fontStyle: "italic" }}>{t("no_data")}</td></tr>}
      </Table>

      {editingLoan && (
        <EditLoanModal loan={editingLoan} members={members} onClose={() => setEditingLoan(null)} onSave={updateLoan} t={t} />
      )}
      {historyLoanId && (() => {
        const l = loans.find((x) => x.id === historyLoanId);
        if (!l) return null;
        return (
          <LoanHistoryModal
            loan={l} borrowerName={members.find((m) => m.id === l.member_id)?.nom || "—"}
            members={members} onClose={() => setHistoryLoanId(null)} t={t} lang={lang}
          />
        );
      })()}
    </Section></Container>
  );
}

function EditDonationModal({ donation, onClose, onSave, t }) {
  const [form, setForm] = useState({
    donateur_nom: donation.donateur_nom || "", donateur_email: donation.donateur_email || "",
    montant: donation.montant ?? "", message: donation.message || "", date: donation.date || todayISO(),
  });
  function handleSave() {
    if (!form.donateur_nom.trim() || !form.montant) return;
    onSave(donation.id, {
      donateur_nom: form.donateur_nom.trim(), donateur_email: form.donateur_email.trim() || null,
      montant: Number(form.montant), message: form.message.trim() || null, date: form.date,
    });
    onClose();
  }
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 480, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("don_edit_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <Field label={t("don_donor_name")}><input style={inputStyle} value={form.donateur_nom} onChange={(e) => setForm((p) => ({ ...p, donateur_nom: e.target.value }))} /></Field>
        <Field label={t("don_donor_email")}><input style={inputStyle} value={form.donateur_email} onChange={(e) => setForm((p) => ({ ...p, donateur_email: e.target.value }))} /></Field>
        <Field label={t("don_amount")}><input type="number" style={inputStyle} value={form.montant} onChange={(e) => setForm((p) => ({ ...p, montant: e.target.value }))} /></Field>
        <Field label={t("date")}><input type="date" style={inputStyle} value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} /></Field>
        <Field label={t("don_message")}><input style={inputStyle} value={form.message} onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))} /></Field>
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <Btn onClick={handleSave}>{t("action_save")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_close")}</Btn>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// DonReceiptModal — reçu de don imprimable / téléchargeable (même pattern
// que DechargeModal dans App.jsx et ElectionPVModal dans Gouvernance.jsx :
// portail plein écran dont seul le contenu est visible à l'impression).
// =====================================================================
function DonReceiptModal({ donation, association, t, lang, onClose, onPrinted }) {
  const todayFormatted = new Date().toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA");
  const dateDon = donation.date ? new Date(donation.date).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA") : "—";
  const receiptNo = `D-${new Date(donation.date || Date.now()).getFullYear()}-${String(donation.id).slice(0, 8).toUpperCase()}`;
  function handlePrint() { onPrinted?.(); window.print(); }
  return createPortal(
    <div className="don-print-root" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }} onClick={onClose}>
      <style>{`
        @media print {
          body > *:not(.don-print-root) { display: none !important; }
          .don-print-root { position: static !important; background: white !important; padding: 0 !important; display: block !important; }
          .don-no-print { display: none !important; }
          .don-card { box-shadow: none !important; max-height: none !important; overflow: visible !important; width: 100% !important; max-width: 100% !important; }
        }
      `}</style>
      <div className="don-card" style={{ background: "white", borderRadius: 12, padding: 32, maxWidth: 560, width: "94%", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="don-no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("don_receipt_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        <h3 style={{ marginBottom: 4 }}>{association?.nom}</h3>
        <h4 style={{ marginBottom: 4, fontWeight: 600 }}>{t("don_receipt_title")}</h4>
        <p style={{ fontSize: 12, color: "#999", marginBottom: 20 }}>{t("don_receipt_number_label")} : {receiptNo}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
          <div><b>{t("don_col_donor")} :</b> {donation.donateur_nom}</div>
          {donation.donateur_email && <div><b>{t("don_donor_email")} :</b> {donation.donateur_email}</div>}
          <div><b>{t("don_amount")} :</b> {money(donation.montant, "CAD")}</div>
          <div><b>{t("date")} :</b> {dateDon}</div>
          {donation.message && <div><b>{t("don_receipt_message_label")} :</b> {donation.message}</div>}
        </div>

        <p style={{ fontSize: 13, color: "#5B6270", marginTop: 24 }}>{t("don_receipt_thanks")}</p>

        <div style={{ marginTop: 50 }}>
          <p style={{ fontSize: 11.5, color: "#5B6270", fontStyle: "italic", marginBottom: 18 }}>{t("gov_pv_esignature_notice")}</p>
          <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
            <SignatureLine label={t("gov_pv_signature_president")} printClass="don-no-print" t={t} />
            <SignatureLine label={t("don_receipt_signature_tresorier")} printClass="don-no-print" t={t} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#5B6270", marginTop: 6 }}>{t("don_receipt_issued_on")} : <b>{todayFormatted}</b></div>

        <div className="don-no-print" style={{ display: "flex", gap: 10, marginTop: 30 }}>
          <Btn onClick={handlePrint}><Printer size={14} /> {t("fin_print_btn")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("tont_decharge_close")}</Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}

function EditLoanModal({ loan, members, onClose, onSave, t }) {
  const [form, setForm] = useState({
    member_id: loan.member_id || "", montant_pret: loan.montant_pret ?? "",
    taux_interet: loan.taux_interet ?? 0, date_echeance: loan.date_echeance || "", statut: loan.statut || "actif",
  });
  function handleSave() {
    if (!form.member_id || !form.montant_pret) return;
    onSave(loan.id, {
      member_id: form.member_id, montant_pret: Number(form.montant_pret),
      taux_interet: Number(form.taux_interet) || 0, date_echeance: form.date_echeance || null, statut: form.statut,
    });
    onClose();
  }
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 480, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("loan_edit_title")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <Field label={t("loan_member_field")}>
          <select style={inputStyle} value={form.member_id} onChange={(e) => setForm((p) => ({ ...p, member_id: e.target.value }))}>
            <option value="">{t("proj_choose")}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select>
        </Field>
        <Field label={t("loan_amount_field")}><input type="number" style={inputStyle} value={form.montant_pret} onChange={(e) => setForm((p) => ({ ...p, montant_pret: e.target.value }))} /></Field>
        <Field label={t("loan_interest_field")}><input type="number" style={inputStyle} value={form.taux_interet} onChange={(e) => setForm((p) => ({ ...p, taux_interet: e.target.value }))} /></Field>
        <Field label={t("loan_due_field")}><input type="date" style={inputStyle} value={form.date_echeance} onChange={(e) => setForm((p) => ({ ...p, date_echeance: e.target.value }))} /></Field>
        <Field label={t("loan_col_status")}>
          <select style={inputStyle} value={form.statut} onChange={(e) => setForm((p) => ({ ...p, statut: e.target.value }))}>
            <option value="actif">{t("loan_status_actif")}</option>
            <option value="rembourse">{t("loan_status_rembourse")}</option>
          </select>
        </Field>
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <Btn onClick={handleSave}>{t("action_save")}</Btn>
          <Btn variant="outline" onClick={onClose}>{t("action_close")}</Btn>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// LoanHistoryModal — historique complet lié à un prêt : octroi, modifications
// (capital, taux, échéance, emprunteur, statut) et chaque remboursement
// enregistré, reconstitué à partir du journal d'activité (`activity_log`,
// déjà alimenté automatiquement pour les tables "loans" et "loan_repayments" —
// voir MemberHistoryModal dans App.jsx qui l'utilise déjà, côté membre).
// =====================================================================
function LoanHistoryModal({ loan, borrowerName, members, onClose, t, lang }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      const [loanRes, repayRes] = await Promise.all([
        supabase.from("activity_log").select("*").eq("table_name", "loans").eq("record_id", loan.id).order("created_at", { ascending: false }),
        // Les remboursements n'ont pas de "member_id" propre indexé dans `details` (contrairement
        // aux tables utilisées par MemberHistoryModal) : on filtre donc sur l'enregistrement complet
        // capturé par le déclencheur (`details.nouveau`/`details.ancien`), qui contient toujours loan_id.
        supabase.from("activity_log").select("*").eq("table_name", "loan_repayments")
          .or(`details->nouveau->>loan_id.eq.${loan.id},details->ancien->>loan_id.eq.${loan.id}`)
          .order("created_at", { ascending: false }),
      ]);
      const combined = [...(loanRes.data || []), ...(repayRes.data || [])];
      combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setLogs(combined);
      setLoading(false);
    }
    loadHistory();
  }, [loan.id]);

  function nameOf(memberId) { return members.find((m) => m.id === memberId)?.nom || "—"; }
  function statusLabel(s) { return s === "actif" ? t("loan_status_actif") : s === "rembourse" ? t("loan_status_rembourse") : s; }

  function describe(log) {
    if (log.table_name === "loan_repayments") {
      if (log.action === "INSERT") return t("loan_hist_repayment").replace("{amount}", money(log.details?.nouveau?.montant, "CAD"));
      if (log.action === "DELETE") return t("loan_hist_repayment_removed");
      return null;
    }
    // table_name === "loans"
    if (log.action === "INSERT") return t("loan_hist_granted").replace("{amount}", money(log.details?.nouveau?.montant_pret, "CAD"));
    if (log.action === "DELETE") return t("loan_hist_deleted");
    if (log.action === "UPDATE" && log.details?.ancien && log.details?.nouveau) {
      const a = log.details.ancien, n = log.details.nouveau;
      const lines = [];
      if (a.statut !== n.statut) {
        lines.push(n.statut === "rembourse" ? t("loan_hist_repaid_full") : t("loan_hist_status_changed").replace("{status}", statusLabel(n.statut)));
      }
      if (Number(a.montant_pret) !== Number(n.montant_pret)) {
        lines.push(t("loan_hist_amount_changed").replace("{old}", money(a.montant_pret, "CAD")).replace("{new}", money(n.montant_pret, "CAD")));
      }
      if (Number(a.taux_interet || 0) !== Number(n.taux_interet || 0)) {
        lines.push(t("loan_hist_rate_changed").replace("{old}", Number(a.taux_interet) || 0).replace("{new}", Number(n.taux_interet) || 0));
      }
      if ((a.date_echeance || "") !== (n.date_echeance || "")) {
        lines.push(t("loan_hist_due_changed").replace("{old}", a.date_echeance || "—").replace("{new}", n.date_echeance || "—"));
      }
      if (a.member_id !== n.member_id) {
        lines.push(t("loan_hist_borrower_changed").replace("{old}", nameOf(a.member_id)).replace("{new}", nameOf(n.member_id)));
      }
      return lines.length ? lines.join(" — ") : null;
    }
    return null;
  }

  const entries = logs.map((log) => ({ log, text: describe(log) })).filter((e) => e.text);

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 560, width: "92%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{t("loan_hist_title")} — {borrowerName}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {loading ? (
          <p style={{ color: "#999" }}>{t("loading")}</p>
        ) : entries.length === 0 ? (
          <p style={{ color: "#999", fontStyle: "italic" }}>{t("loan_hist_empty")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {entries.map(({ log, text }) => (
              <div key={log.id} style={{ borderBottom: "1px solid #EEE", paddingBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#999", marginBottom: 2 }}>{new Date(log.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</div>
                <div style={{ fontSize: 13, color: "#333" }}>{text}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <Btn variant="outline" onClick={onClose}>{t("action_close")}</Btn>
        </div>
      </div>
    </div>
  );
}
