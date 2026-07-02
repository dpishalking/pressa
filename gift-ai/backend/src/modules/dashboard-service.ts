import { listBitrixDeals, listBitrixLeads } from "../integrations/crm/bitrix-client.js";
import { buildActionLists, type ActionListsResult } from "../integrations/crm/bitrix-action-lists.js";
import { buildDailyDigestStats, type DailyDigestStats } from "../integrations/alerts/daily-digest.js";
import { ropAlertsConfig } from "../integrations/alerts/alerts-config.js";
import { actionsExportConfig } from "../integrations/analytics/actions-config.js";
import { monthRange } from "../integrations/analytics/date-ranges.js";
import { loadFxConverter } from "../integrations/analytics/fx-rates.js";
import { config } from "../config.js";
import { getDashboardPlan, type DashboardPlan } from "./dashboard-plans.js";

function buildWonDealFilter(range: { from: string; to: string }, salesStageIds: string[]): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    ">=CLOSEDATE": range.from,
    "<CLOSEDATE": range.to,
  };
  if (salesStageIds.length === 1) filter["=STAGE_ID"] = salesStageIds[0];
  else if (salesStageIds.length > 1) filter["@STAGE_ID"] = salesStageIds;
  return filter;
}

export type MonthFact = {
  month: string;
  leads: number;
  deals: number;
  revenueEur: number;
};

export async function buildMonthFact(month: string): Promise<MonthFact> {
  const range = monthRange(month);
  const cfg = ropAlertsConfig();
  const fx = await loadFxConverter({
    baseCurrency: cfg.baseCurrency,
    date: range.from,
    overrides: cfg.fxOverrides,
  });
  const [leads, wonDeals] = await Promise.all([
    listBitrixLeads({ ">=DATE_CREATE": range.from, "<DATE_CREATE": range.to }, []),
    listBitrixDeals(buildWonDealFilter(range, cfg.salesStageIds), []),
  ]);
  const revenueEur = wonDeals.reduce(
    (sum, deal) => sum + fx.convert(Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0, deal.CURRENCY_ID),
    0,
  );
  return { month, leads: leads.length, deals: wonDeals.length, revenueEur };
}

export type ForecastMetric = {
  label: string;
  plan: number | null;
  fact: number;
  forecast: number;
  completionPercent: number | null;
  unit: "count" | "eur";
};

export type ForecastPayload = {
  month: string;
  plan: DashboardPlan | null;
  fact: MonthFact;
  elapsedDays: number;
  daysInMonth: number;
  metrics: ForecastMetric[];
};

function daysInMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function elapsedDaysInMonth(yearMonth: string, now = new Date()): number {
  const [y, m] = yearMonth.split("-").map(Number);
  const today = new Date(now.toLocaleString("en-US", { timeZone: process.env.STATS_TIMEZONE ?? "Europe/Moscow" }));
  if (today.getFullYear() !== y || today.getMonth() + 1 !== m) {
    const dim = daysInMonth(yearMonth);
    const [cy, cm] = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`.split("-").map(Number);
    if (cy > y || (cy === y && cm > m)) return dim;
    return 0;
  }
  return today.getDate();
}

function runRate(fact: number, elapsed: number, total: number): number {
  if (elapsed <= 0) return fact;
  return Math.round((fact / elapsed) * total);
}

function metricRow(
  label: string,
  planVal: number | null,
  factVal: number,
  elapsed: number,
  total: number,
  unit: "count" | "eur",
): ForecastMetric {
  const forecast = runRate(factVal, elapsed, total);
  const completionPercent = planVal && planVal > 0 ? Math.round((factVal / planVal) * 100) : null;
  return { label, plan: planVal, fact: factVal, forecast, completionPercent, unit };
}

export async function buildForecast(month: string): Promise<ForecastPayload> {
  const plan = getDashboardPlan(month);
  const fact = await buildMonthFact(month);
  const dim = daysInMonth(month);
  const elapsed = elapsedDaysInMonth(month);
  return {
    month,
    plan,
    fact,
    elapsedDays: elapsed,
    daysInMonth: dim,
    metrics: [
      metricRow("Лиды", plan?.leads ?? null, fact.leads, elapsed, dim, "count"),
      metricRow("Сделки", plan?.deals ?? null, fact.deals, elapsed, dim, "count"),
      metricRow("Выручка", plan?.revenueEur ?? null, Math.round(fact.revenueEur), elapsed, dim, "eur"),
    ],
  };
}

export async function fetchActionLists(): Promise<ActionListsResult> {
  return buildActionLists({ config: actionsExportConfig() });
}

export async function fetchTodayStats(): Promise<DailyDigestStats> {
  return buildDailyDigestStats(ropAlertsConfig());
}

export type OverviewPayload = {
  month: string;
  today: DailyDigestStats;
  monthFact: MonthFact;
  actionCounts: ActionListsResult["summary"];
  fetchedAt: string;
};

export async function buildOverview(month: string): Promise<OverviewPayload> {
  const [today, monthFact, actions] = await Promise.all([
    fetchTodayStats(),
    buildMonthFact(month),
    fetchActionLists(),
  ]);
  return {
    month,
    today,
    monthFact,
    actionCounts: actions.summary,
    fetchedAt: new Date().toISOString(),
  };
}

export function dashboardSheetsConfig() {
  if (!config.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON не настроен");
  }
  return {
    serviceAccountJson: config.GOOGLE_SERVICE_ACCOUNT_JSON,
    chatSheetId: config.ANALYTICS_CHAT_SHEET_ID,
    managersSheetId: config.MANAGERS_SHEET_ID,
    analyticsSheetId: config.ANALYTICS_SHEET_ID,
  };
}
