// =====================================================================
// FinanceSynthese.jsx — Synthèse globale et analyse financière (Bureau)
// Vue d'ensemble chiffrée (revenus, dépenses, excédent, soldes des fonds)
// avec graphiques en barres et une analyse textuelle générée
// automatiquement à partir des chiffres courants de l'association.
// Développé par Omnia Trade Solutions
// =====================================================================
import React, { useState } from "react";
import { TrendingUp, TrendingDown, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, StatCard, TEAL, TEAL_LIGHT, RED } from "./shared";

const AMBER = "#8A5A00";
// Palette catégorielle validée (contraste + daltonisme), ordre fixe — jamais recyclée par rang.
const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

function BarRow({ label, value, max, total, color, moneyF }) {
  const [hover, setHover] = useState(false);
  const widthPct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 1.5 : 0) : 0;
  const pctOfTotal = total > 0 ? (value / total) * 100 : 0;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", borderRadius: 6, background: hover ? "#F3F5F4" : "transparent" }}
    >
      <div style={{ width: 168, flexShrink: 0, fontSize: 12.5, color: "#333" }}>{label}</div>
      <div style={{ flex: 1, height: 16, background: "#EEF0EF", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${widthPct}%`, height: "100%", background: color, borderRadius: "0 4px 4px 0", transition: "width .3s ease" }} />
      </div>
      <div style={{ width: 138, flexShrink: 0, textAlign: "right", fontSize: 12.5, fontWeight: 700, color: "#222" }}>
        {moneyF(value)}
        <span style={{ fontWeight: 400, color: "#686F7D", marginLeft: 5 }}>({pctOfTotal.toFixed(0)}%)</span>
      </div>
    </div>
  );
}

function BreakdownChart({ title, items, moneyF, noDataLabel }) {
  const colored = items.map((it, i) => ({ ...it, color: CATEGORICAL[i % CATEGORICAL.length] }));
  const visible = colored.filter((it) => it.value > 0);
  const max = Math.max(1, ...colored.map((it) => it.value));
  const total = colored.reduce((s, it) => s + it.value, 0);
  return (
    <Card>
      <h4 style={{ fontSize: 13.5, fontWeight: 700, color: "#333", marginBottom: 10 }}>{title}</h4>
      {visible.length === 0 ? (
        <p style={{ fontSize: 12, color: "#686F7D", fontStyle: "italic" }}>{noDataLabel}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {visible.map((it) => (
            <BarRow key={it.key} label={it.label} value={it.value} max={max} total={total} color={it.color} moneyF={moneyF} />
          ))}
        </div>
      )}
    </Card>
  );
}

function SemanticBarChart({ title, items, moneyF }) {
  const max = Math.max(1, ...items.map((it) => Math.abs(it.value)));
  return (
    <Card>
      <h4 style={{ fontSize: 13.5, fontWeight: 700, color: "#333", marginBottom: 10 }}>{title}</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map((it) => {
          const widthPct = (Math.abs(it.value) / max) * 100;
          return (
            <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px" }}>
              <div style={{ width: 168, flexShrink: 0, fontSize: 12.5, color: "#333" }}>{it.label}</div>
              <div style={{ flex: 1, height: 16, background: "#EEF0EF", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${widthPct}%`, height: "100%", background: it.color, borderRadius: "0 4px 4px 0" }} />
              </div>
              <div style={{ width: 138, flexShrink: 0, textAlign: "right", fontSize: 13, fontWeight: 700, color: it.color }}>
                {moneyF(it.value)}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function FinanceSynthese({
  t, lang, moneyF,
  revenueBreakdown, expenseBreakdown,
  totalRevenus, totalDepenses, excedent,
  fuSolde, fsSolde, generalFund,
  contribUrgencePaye, contribUrgenceDue, contribSecoursPaye, contribSecoursDue,
  nbActifs,
}) {
  const marge = totalRevenus > 0 ? (excedent / totalRevenus) * 100 : 0;
  const topRevenue = [...revenueBreakdown].sort((a, b) => b.value - a.value)[0];
  const topExpense = [...expenseBreakdown].sort((a, b) => b.value - a.value)[0];
  const pctUrgence = contribUrgenceDue > 0 ? Math.min(100, (contribUrgencePaye / contribUrgenceDue) * 100) : 0;
  const pctSecours = contribSecoursDue > 0 ? Math.min(100, (contribSecoursPaye / contribSecoursDue) * 100) : 0;

  const attentionItems = [];
  if (excedent < 0) attentionItems.push(t("fin_synth_attention_deficit"));
  if (fuSolde < 0) attentionItems.push(t("fin_synth_attention_urgence"));
  if (fsSolde < 0) attentionItems.push(t("fin_synth_attention_secours"));
  if (generalFund < 0) attentionItems.push(t("fin_synth_attention_general"));

  const dateStr = new Date().toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA");

  return (
    <div style={{ marginTop: 30 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
        {excedent >= 0 ? <TrendingUp size={17} color={TEAL} /> : <TrendingDown size={17} color={RED} />}
        {t("fin_synth_title")}
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 14, marginBottom: 18 }}>
        <StatCard label={t("fin_total_revenue")} value={moneyF(totalRevenus)} accent={TEAL} />
        <StatCard label={t("fin_total_expenses")} value={moneyF(totalDepenses)} accent={RED} />
        <StatCard label={t("fin_surplus")} value={moneyF(excedent)} accent={excedent >= 0 ? TEAL : RED} />
        <StatCard label={t("fin_synth_margin")} value={`${marge.toFixed(1)}%`} accent={marge >= 0 ? TEAL : RED} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }}>
        <BreakdownChart title={t("fin_synth_revenue_breakdown")} items={revenueBreakdown} moneyF={moneyF} noDataLabel={t("no_data")} />
        <BreakdownChart title={t("fin_synth_expense_breakdown")} items={expenseBreakdown} moneyF={moneyF} noDataLabel={t("no_data")} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }}>
        <SemanticBarChart
          title={t("fin_synth_comparison")}
          moneyF={moneyF}
          items={[
            { label: t("fin_total_revenue"), value: totalRevenus, color: TEAL },
            { label: t("fin_total_expenses"), value: totalDepenses, color: RED },
            { label: t("fin_surplus"), value: excedent, color: excedent >= 0 ? TEAL : RED },
          ]}
        />
        <SemanticBarChart
          title={t("fin_synth_fund_balances")}
          moneyF={moneyF}
          items={[
            { label: t("fin_balance_urgence"), value: fuSolde, color: fuSolde >= 0 ? TEAL : RED },
            { label: t("fin_balance_secours"), value: fsSolde, color: fsSolde >= 0 ? TEAL : RED },
            { label: t("fin_general_fund"), value: generalFund, color: generalFund >= 0 ? TEAL : RED },
          ]}
        />
      </div>

      <Card>
        <h4 style={{ fontSize: 13.5, fontWeight: 700, color: "#333", marginBottom: 10 }}>{t("fin_synth_analysis_title")}</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, lineHeight: 1.6, color: "#3A3F45" }}>
          <p style={{ margin: 0 }}>
            {t("fin_synth_overview")
              .replace("{date}", dateStr)
              .replace("{revenus}", moneyF(totalRevenus))
              .replace("{depenses}", moneyF(totalDepenses))
              .replace("{excedent}", moneyF(excedent))
              .replace("{marge}", marge.toFixed(1))}
          </p>
          {topRevenue && topRevenue.value > 0 && (
            <p style={{ margin: 0 }}>
              {t("fin_synth_top_revenue")
                .replace("{label}", topRevenue.label)
                .replace("{valeur}", moneyF(topRevenue.value))
                .replace("{pct}", totalRevenus > 0 ? ((topRevenue.value / totalRevenus) * 100).toFixed(0) : "0")}
            </p>
          )}
          {topExpense && topExpense.value > 0 ? (
            <p style={{ margin: 0 }}>
              {t("fin_synth_top_expense")
                .replace("{label}", topExpense.label)
                .replace("{valeur}", moneyF(topExpense.value))
                .replace("{pct}", totalDepenses > 0 ? ((topExpense.value / totalDepenses) * 100).toFixed(0) : "0")}
            </p>
          ) : (
            <p style={{ margin: 0 }}>{t("fin_synth_no_expense")}</p>
          )}
          <p style={{ margin: 0 }}>
            {t("fin_synth_fund_urgence").replace("{solde}", moneyF(fuSolde)).replace("{pct}", pctUrgence.toFixed(0)).replace("{n}", nbActifs)}
            {" "}
            {t("fin_synth_fund_secours").replace("{solde}", moneyF(fsSolde)).replace("{pct}", pctSecours.toFixed(0))}
          </p>
          <p style={{ margin: 0 }}>{t("fin_synth_general_fund").replace("{valeur}", moneyF(generalFund))}</p>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 4, padding: 10, borderRadius: 8, background: attentionItems.length === 0 ? TEAL_LIGHT : "#FBE4E1" }}>
            {attentionItems.length === 0 ? <CheckCircle2 size={16} color={TEAL} style={{ flexShrink: 0, marginTop: 1 }} /> : <AlertTriangle size={16} color={RED} style={{ flexShrink: 0, marginTop: 1 }} />}
            <p style={{ margin: 0, fontWeight: 600 }}>
              {attentionItems.length === 0 ? t("fin_synth_conclusion_healthy") : t("fin_synth_conclusion_attention").replace("{items}", attentionItems.join(", "))}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
