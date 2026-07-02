import { buildChannelSummary, type ChannelSummaryRow } from "./bitrix-channel-summary.js";
import {
  CHANNEL_SUMMARY_HEADERS,
  channelSummarySheetTab,
  sheetAmount,
  sheetPct,
  writeSheetContent,
  type SheetCell,
} from "../sheets/analytics-write.js";
import { loadServiceAccount } from "../sheets/google-auth.js";
import { analyticsExportConfig, type AnalyticsExportConfig } from "./config.js";
import { createExportFx, monthRange, type ExportDateRange } from "./bitrix-country-export.js";
import { logger } from "../../logger.js";

export type BitrixChannelExportSummary = {
  range: ExportDateRange;
  month: string;
  sheetTab: string;
  rows: ChannelSummaryRow[];
  totalLeads: number;
  totalDeals: number;
  totalRevenueEur: number;
};

function channelSummaryToRows(
  rows: ChannelSummaryRow[],
  baseCurrency: string,
  totals: { totalLeads: number; totalDeals: number; totalRevenueEur: number; totalSessions: number },
): SheetCell[][] {
  const sheetRows: SheetCell[][] = rows.map((row) => [
    row.channel,
    row.openLineSessions,
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
    totals.totalSessions,
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

export async function exportBitrixChannelSummary(opts?: {
  month?: string;
  range?: ExportDateRange;
  config?: AnalyticsExportConfig;
  sheetTab?: string;
  salesStageIds?: string[];
}): Promise<BitrixChannelExportSummary> {
  const cfg = opts?.config ?? analyticsExportConfig();
  const month = opts?.month ?? opts?.range?.from.slice(0, 7) ?? "";
  const range = opts?.range ?? (month ? monthRange(month) : { from: "", to: "" });
  const account = loadServiceAccount(cfg.serviceAccountJson);
  const sheetTab = opts?.sheetTab ?? channelSummarySheetTab(month || range.from.slice(0, 7));
  const fx = await createExportFx(cfg, range);

  const { rows, totalLeads, totalDeals, totalRevenueEur } = await buildChannelSummary({
    range,
    config: { ...cfg, salesStageIds: opts?.salesStageIds ?? cfg.salesStageIds },
    fx,
  });

  const totalSessions = rows.reduce((sum, row) => sum + row.openLineSessions, 0);

  const written = await writeSheetContent(
    account,
    cfg.sheetId,
    sheetTab,
    CHANNEL_SUMMARY_HEADERS,
    channelSummaryToRows(rows, fx.baseCurrency, {
      totalLeads,
      totalDeals,
      totalRevenueEur,
      totalSessions,
    }),
  );

  logger.info("Channel summary written", {
    sheetTab,
    range,
    baseCurrency: fx.baseCurrency,
    channels: rows.length,
    totalLeads,
    totalDeals,
    totalRevenueEur,
    written,
  });

  return {
    range,
    month: month || range.from.slice(0, 7),
    sheetTab,
    rows,
    totalLeads,
    totalDeals,
    totalRevenueEur,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function exportBitrixChannelSummariesForMonths(opts: {
  months: string[];
  config?: AnalyticsExportConfig;
}): Promise<BitrixChannelExportSummary[]> {
  const results: BitrixChannelExportSummary[] = [];
  for (const month of opts.months) {
    results.push(await exportBitrixChannelSummary({ month, config: opts.config }));
    await sleep(3000);
  }
  return results;
}
