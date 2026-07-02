import {
  buildManagerSummary,
  type ManagerDashboard,
  type ManagerSummaryRow,
} from "./bitrix-manager-summary.js";
import { managersExportConfig, type ManagersExportConfig } from "./managers-config.js";
import {
  MANAGER_COUNTRY_HEADERS,
  MANAGER_DEAL_HEADERS,
  MANAGER_SUMMARY_HEADERS,
  managerDetailSheetTab,
  managerSummarySheetTab,
  monthLabelRu,
  sheetAmount,
  sheetPct,
  sheetText,
  writeRawSheetTab,
  writeSheetContent,
  type SheetCell,
} from "../sheets/analytics-write.js";
import { loadServiceAccount } from "../sheets/google-auth.js";
import { bitrixDealLink } from "../crm/bitrix-links.js";
import { monthRange, type ExportDateRange } from "./bitrix-country-export.js";
import { logger } from "../../logger.js";

export type BitrixManagerExportSummary = {
  range: ExportDateRange;
  month: string;
  summaryTab: string;
  managerTabs: string[];
  managers: number;
  totalLeads: number;
  totalDeals: number;
  totalRevenueEur: number;
};

function managerSummaryToRows(
  rows: ManagerSummaryRow[],
  baseCurrency: string,
  totals: { totalLeads: number; totalDeals: number; totalRevenueEur: number },
): SheetCell[][] {
  const sheetRows: SheetCell[][] = rows.map((row) => [
    sheetText(row.managerName),
    row.leads,
    sheetPct(row.leadSharePct),
    row.deals,
    sheetAmount(row.revenueEur),
    baseCurrency,
    row.deals ? sheetAmount(row.avgCheck) : 0,
    sheetPct(row.revenueSharePct),
    sheetPct(row.leadToDealPct),
  ]);

  sheetRows.push([
    "ИТОГО",
    totals.totalLeads,
    100,
    totals.totalDeals,
    sheetAmount(totals.totalRevenueEur),
    baseCurrency,
    totals.totalDeals ? sheetAmount(totals.totalRevenueEur / totals.totalDeals) : 0,
    100,
    totals.totalLeads ? sheetPct((totals.totalDeals / totals.totalLeads) * 100) : 0,
  ]);

  return sheetRows;
}

function managerDashboardRows(dashboard: ManagerDashboard, month: string, baseCurrency: string): SheetCell[][] {
  const { summary, countries, deals } = dashboard;
  const monthLabel = monthLabelRu(month);
  const rows: SheetCell[][] = [
    [`Дашборд: ${dashboard.managerName}`, "", `Период: ${monthLabel}`],
    [],
    ["Показатели", "Значение"],
    ["Лидов", summary.leads],
    ["Сделок (WON)", summary.deals],
    ["Выручка", sheetAmount(summary.revenueEur)],
    ["Валюта", baseCurrency],
    ["Средний чек", summary.deals ? sheetAmount(summary.avgCheck) : 0],
    ["Конверсия лид→сделка, %", sheetPct(summary.leadToDealPct)],
    ["Доля лидов, %", sheetPct(summary.leadSharePct)],
    ["Доля выручки, %", sheetPct(summary.revenueSharePct)],
    [],
    [...MANAGER_COUNTRY_HEADERS],
    ...countries.map((row) => [
      row.country,
      row.leads,
      row.deals,
      sheetAmount(row.revenueEur),
      baseCurrency,
      row.deals ? sheetAmount(row.avgCheck) : 0,
    ]),
    [],
    [...MANAGER_DEAL_HEADERS],
    ...deals.map((row) => [
      row.id,
      row.closeDate,
      sheetText(row.title),
      sheetAmount(row.amountEur),
      baseCurrency,
      row.country,
      sheetText(row.source),
      bitrixDealLink(row.id),
    ]),
  ];

  return rows;
}

export async function exportBitrixManagerDashboards(opts?: {
  month?: string;
  range?: ExportDateRange;
  config?: ManagersExportConfig;
  salesStageIds?: string[];
}): Promise<BitrixManagerExportSummary> {
  const cfg = opts?.config ?? managersExportConfig();
  const month = opts?.month ?? opts?.range?.from.slice(0, 7) ?? "";
  const range = opts?.range ?? (month ? monthRange(month) : { from: "", to: "" });
  const account = loadServiceAccount(cfg.serviceAccountJson);
  const summaryTab = managerSummarySheetTab(month || range.from.slice(0, 7));

  const result = await buildManagerSummary({
    month,
    range,
    config: cfg,
    salesStageIds: opts?.salesStageIds,
  });

  await writeSheetContent(
    account,
    cfg.sheetId,
    summaryTab,
    MANAGER_SUMMARY_HEADERS,
    managerSummaryToRows(
      result.managers.map((row) => row.summary),
      result.baseCurrency,
      {
        totalLeads: result.totalLeads,
        totalDeals: result.totalDeals,
        totalRevenueEur: result.totalRevenueEur,
      },
    ),
  );

  const managerTabs: string[] = [];
  for (const dashboard of result.managers) {
    const tabTitle = managerDetailSheetTab(dashboard.managerName, month || range.from.slice(0, 7));
    await writeRawSheetTab(
      account,
      cfg.sheetId,
      tabTitle,
      managerDashboardRows(dashboard, month || range.from.slice(0, 7), result.baseCurrency),
    );
    managerTabs.push(tabTitle);
  }

  logger.info("Manager dashboards written", {
    summaryTab,
    month: month || range.from.slice(0, 7),
    range,
    managers: result.managers.length,
    totalLeads: result.totalLeads,
    totalDeals: result.totalDeals,
    totalRevenueEur: result.totalRevenueEur,
    sheetId: cfg.sheetId,
  });

  return {
    range,
    month: month || range.from.slice(0, 7),
    summaryTab,
    managerTabs,
    managers: result.managers.length,
    totalLeads: result.totalLeads,
    totalDeals: result.totalDeals,
    totalRevenueEur: result.totalRevenueEur,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function exportBitrixManagerDashboardsForMonths(opts: {
  months: string[];
  config?: ManagersExportConfig;
}): Promise<BitrixManagerExportSummary[]> {
  const results: BitrixManagerExportSummary[] = [];
  for (const month of opts.months) {
    results.push(await exportBitrixManagerDashboards({ month, config: opts.config }));
    await sleep(3000);
  }
  return results;
}
