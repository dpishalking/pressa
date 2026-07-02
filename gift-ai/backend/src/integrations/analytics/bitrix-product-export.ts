import { buildProductSummary, type ProductSummaryRow } from "../crm/bitrix-deal-products.js";
import {
  PRODUCT_SUMMARY_HEADERS,
  productSummarySheetTab,
  sheetAmount,
  writeSheetContent,
  type SheetCell,
} from "../sheets/analytics-write.js";
import { loadServiceAccount } from "../sheets/google-auth.js";
import { analyticsExportConfig, type AnalyticsExportConfig } from "./config.js";
import { createExportFx, monthRange, type ExportDateRange } from "./bitrix-country-export.js";
import { logger } from "../../logger.js";

export type BitrixProductSummaryExportSummary = {
  range: ExportDateRange;
  month: string;
  sheetTab: string;
  rows: ProductSummaryRow[];
  totalDeals: number;
  totalAmountByCurrency: Record<string, number>;
};

function productSummaryToRows(
  rows: ProductSummaryRow[],
  baseCurrency: string,
  uniqueDeals: number,
): SheetCell[][] {
  const sheetRows: SheetCell[][] = rows.map((row) => [
    row.product,
    row.count,
    sheetAmount(row.amount),
    baseCurrency,
    row.count ? sheetAmount(row.avgCheck) : 0,
  ]);

  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);

  sheetRows.push([
    "ИТОГО",
    uniqueDeals,
    sheetAmount(totalAmount),
    baseCurrency,
    uniqueDeals ? sheetAmount(totalAmount / uniqueDeals) : 0,
  ]);

  return sheetRows;
}

export async function exportBitrixProductSummary(opts?: {
  month?: string;
  range?: ExportDateRange;
  config?: AnalyticsExportConfig;
  sheetTab?: string;
  salesStageIds?: string[];
}): Promise<BitrixProductSummaryExportSummary> {
  const cfg = opts?.config ?? analyticsExportConfig();
  const month = opts?.month ?? opts?.range?.from.slice(0, 7) ?? "";
  const range = opts?.range ?? (month ? monthRange(month) : { from: "", to: "" });
  const account = loadServiceAccount(cfg.serviceAccountJson);
  const sheetTab = opts?.sheetTab ?? productSummarySheetTab(month || range.from.slice(0, 7));
  const salesStageIds = opts?.salesStageIds ?? cfg.salesStageIds;
  const fx = await createExportFx(cfg, range);

  const { rows: summaryRows, uniqueDeals } = await buildProductSummary({
    range,
    salesStageIds,
    fx,
    onProgress: (done, total) => {
      if (done % 50 === 0 || done === total) {
        logger.info("Product summary progress", { done, total, month: month || range.from.slice(0, 7) });
      }
    },
  });

  const totalAmount = summaryRows.reduce((sum, row) => sum + row.amount, 0);

  const written = await writeSheetContent(
    account,
    cfg.sheetId,
    sheetTab,
    PRODUCT_SUMMARY_HEADERS,
    productSummaryToRows(summaryRows, fx.baseCurrency, uniqueDeals),
  );

  logger.info("Product summary written", {
    sheetTab,
    range,
    salesStageIds,
    baseCurrency: fx.baseCurrency,
    fxDate: fx.rateDate,
    products: summaryRows.length,
    totalDeals: uniqueDeals,
    totalAmount,
    written,
  });

  return {
    range,
    month: month || range.from.slice(0, 7),
    sheetTab,
    rows: summaryRows,
    totalDeals: uniqueDeals,
    totalAmountByCurrency: { [fx.baseCurrency]: totalAmount },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function exportBitrixProductSummariesForMonths(opts: {
  months: string[];
  config?: AnalyticsExportConfig;
}): Promise<BitrixProductSummaryExportSummary[]> {
  const results: BitrixProductSummaryExportSummary[] = [];
  for (const month of opts.months) {
    results.push(await exportBitrixProductSummary({ month, config: opts.config }));
    await sleep(3000);
  }
  return results;
}
