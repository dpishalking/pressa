import { buildCustomerLtv, type CustomerLtvBuildResult } from "../crm/bitrix-customer-ltv.js";
import {
  cohortMatrixHeaders,
  CUSTOMER_LTV_HEADERS,
  LTV_OVERVIEW_HEADERS,
  cohortRetentionSheetTab,
  cohortRevenueSheetTab,
  customerLtvSheetTab,
  ltvOverviewSheetTab,
  sheetAmount,
  sheetPct,
  writeSheetContent,
  type SheetCell,
} from "../sheets/analytics-write.js";
import { loadServiceAccount } from "../sheets/google-auth.js";
import { analyticsExportConfig, type AnalyticsExportConfig } from "./config.js";
import { logger } from "../../logger.js";

export type BitrixLtvExportSummary = {
  sheetTabs: {
    overview: string;
    customers: string;
    cohortRevenue: string;
    cohortRetention: string;
  };
  overview: CustomerLtvBuildResult["overview"];
  totalCustomers: number;
  totalDeals: number;
  baseCurrency: string;
};

function overviewRows(result: CustomerLtvBuildResult): SheetCell[][] {
  const { overview: o, baseCurrency } = result;
  return [
    ["Всего клиентов", o.totalCustomers],
    ["Клиентов с 1 покупкой", o.oneTimeCustomers],
    ["Клиентов с 2+ покупками", o.repeatCustomers],
    ["Доля повторных клиентов, %", sheetPct(o.repeatCustomers / Math.max(o.totalCustomers, 1) * 100)],
    ["Выручка одноразовых, EUR", sheetAmount(o.revenueOneTimeEur)],
    ["Выручка повторных, EUR", sheetAmount(o.revenueRepeatEur)],
    ["Доля выручки от повторных, %", sheetPct(o.repeatRevenueSharePct)],
    ["Доля выручки топ-20% клиентов, %", sheetPct(o.top20CustomersSharePct)],
    ["Средний LTV, EUR", sheetAmount(o.avgLtvEur)],
    ["Медианный LTV, EUR", sheetAmount(o.medianLtvEur)],
    ["Общая выручка, EUR", sheetAmount(o.totalRevenueEur)],
    ["Валюта отчёта", baseCurrency],
    ["Сделок WON в расчёте", result.totalDeals],
  ];
}

function customerRows(customers: CustomerLtvBuildResult["customers"]): SheetCell[][] {
  return customers.map((customer) => [
    customer.contactId,
    customer.name,
    customer.phone,
    customer.email,
    customer.country,
    customer.cohortMonth,
    customer.firstOrderDate,
    customer.orderCount,
    sheetAmount(customer.ltvEur),
    customer.orderCount > 1 ? "Повторный" : "Одноразовый",
  ]);
}

function cohortRevenueMatrix(result: CustomerLtvBuildResult): SheetCell[][] {
  return result.cohorts.map((cohort) => [
    cohort.cohortMonth,
    cohort.cohortSize,
    ...cohort.cells.map((cell) => sheetAmount(cell.cumulativeRevenueEur)),
  ]);
}

function cohortRetentionMatrix(result: CustomerLtvBuildResult): SheetCell[][] {
  return result.cohorts.map((cohort) => [
    cohort.cohortMonth,
    cohort.cohortSize,
    ...cohort.cells.map((cell) => sheetPct(cell.retentionPct)),
  ]);
}

export async function exportBitrixLtvCohorts(opts?: {
  config?: AnalyticsExportConfig;
  maxCohortOffset?: number;
}): Promise<BitrixLtvExportSummary> {
  const cfg = opts?.config ?? analyticsExportConfig();
  const account = loadServiceAccount(cfg.serviceAccountJson);

  const result = await buildCustomerLtv({
    config: cfg,
    maxCohortOffset: opts?.maxCohortOffset,
    onProgress: (stage, done, total) => {
      if (done % 500 === 0 || done === total) {
        logger.info("LTV export progress", { stage, done, total });
      }
    },
  });

  const tabs = {
    overview: ltvOverviewSheetTab(),
    customers: customerLtvSheetTab(),
    cohortRevenue: cohortRevenueSheetTab(),
    cohortRetention: cohortRetentionSheetTab(),
  };

  await writeSheetContent(account, cfg.sheetId, tabs.overview, LTV_OVERVIEW_HEADERS, overviewRows(result));
  await writeSheetContent(account, cfg.sheetId, tabs.customers, CUSTOMER_LTV_HEADERS, customerRows(result.customers));
  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs.cohortRevenue,
    cohortMatrixHeaders(result.maxMonthOffset),
    cohortRevenueMatrix(result),
  );
  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs.cohortRetention,
    cohortMatrixHeaders(result.maxMonthOffset),
    cohortRetentionMatrix(result),
  );

  logger.info("LTV cohort export written", {
    sheetId: cfg.sheetId,
    customers: result.customers.length,
    repeatRevenueSharePct: result.overview.repeatRevenueSharePct.toFixed(1),
  });

  return {
    sheetTabs: tabs,
    overview: result.overview,
    totalCustomers: result.customers.length,
    totalDeals: result.totalDeals,
    baseCurrency: result.baseCurrency,
  };
}
