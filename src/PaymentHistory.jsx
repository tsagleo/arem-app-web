// =====================================================================
// PaymentHistory.jsx — Historique global des paiements (Bureau)
// Regroupe les quote-parts fonds urgence/secours payées, les dons
// enregistrés et les prêts/remboursements, à partir de activity_log.
// Développé par Omnia Trade Solutions
// =====================================================================
import React, { useMemo, useState } from "react";
import { History } from "lucide-react";
import { Card, Table, td } from "./shared";

function normalizeEntry(log, { members, depenseFondsMap, t, moneyF }) {
  const nouveau = log.details?.nouveau;
  const ancien = log.details?.ancien;

  if (log.table_name === "fonds_recouvrements") {
    if (!(log.action === "UPDATE" && ancien && nouveau && !ancien.paye && nouveau.paye)) return null;
    const fonds = depenseFondsMap[nouveau.depense_id];
    const typeKey = fonds === "urgence" ? "pay_type_recouv_urgence" : fonds === "secours" ? "pay_type_recouv_secours" : null;
    if (!typeKey) return null;
    const member = members.find((m) => m.id === (log.details?.member_id || nouveau.member_id));
    return { id: log.id, date: nouveau.date_paiement || log.created_at, typeKey, typeLabel: t(typeKey), who: member?.nom || "—", amount: Number(nouveau.quote_part) || 0 };
  }
  if (log.table_name === "donations") {
    if (log.action !== "INSERT") return null;
    return { id: log.id, date: nouveau.date || log.created_at, typeKey: "pay_type_don", typeLabel: t("pay_type_don"), who: nouveau.donateur_nom || "—", amount: Number(nouveau.montant) || 0 };
  }
  if (log.table_name === "loans") {
    if (log.action !== "INSERT") return null;
    const member = members.find((m) => m.id === (log.details?.member_id || nouveau.member_id));
    return { id: log.id, date: nouveau.date_pret || log.created_at, typeKey: "pay_type_pret", typeLabel: t("pay_type_pret"), who: member?.nom || "—", amount: Number(nouveau.montant_pret) || 0 };
  }
  if (log.table_name === "loan_repayments") {
    if (log.action !== "INSERT") return null;
    const member = members.find((m) => m.id === log.details?.member_id);
    return { id: log.id, date: nouveau.date || log.created_at, typeKey: "pay_type_remboursement", typeLabel: t("pay_type_remboursement"), who: member?.nom || "—", amount: Number(nouveau.montant) || 0 };
  }
  return null;
}

export default function PaymentHistory({ activityLog, members, depenseFondsMap, t, lang, moneyF }) {
  const [typeFilter, setTypeFilter] = useState("all");

  const entries = useMemo(() => {
    return (activityLog || [])
      .map((l) => normalizeEntry(l, { members, depenseFondsMap, t, moneyF }))
      .filter(Boolean)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [activityLog, members, depenseFondsMap, t, moneyF]);

  const types = useMemo(() => {
    const seen = new Map();
    entries.forEach((e) => { if (!seen.has(e.typeKey)) seen.set(e.typeKey, e.typeLabel); });
    return Array.from(seen.entries());
  }, [entries]);

  const filtered = typeFilter === "all" ? entries : entries.filter((e) => e.typeKey === typeFilter);

  return (
    <Card style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, display: "flex", alignItems: "center", gap: 8, margin: 0 }}><History size={16} /> {t("pay_hist_title")}</h3>
        {types.length > 0 && (
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1.5px solid #DCE0E8", fontSize: 12.5 }}>
            <option value="all">{t("pay_hist_filter_all")}</option>
            {types.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        )}
      </div>
      <Table head={[t("pay_hist_col_date"), t("pay_hist_col_type"), t("pay_hist_col_who"), t("pay_hist_col_amount")]}>
        {filtered.map((e) => (
          <tr key={e.id}>
            <td style={td}>{e.date ? new Date(e.date).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA") : "—"}</td>
            <td style={td}>{e.typeLabel}</td>
            <td style={{ ...td, fontWeight: 600, color: "var(--primary)" }}>{e.who}</td>
            <td style={td}>{moneyF(e.amount)}</td>
          </tr>
        ))}
        {filtered.length === 0 && <tr><td colSpan={4} style={{ ...td, color: "#686F7D", fontStyle: "italic" }}>{t("pay_hist_no_data")}</td></tr>}
      </Table>
    </Card>
  );
}
