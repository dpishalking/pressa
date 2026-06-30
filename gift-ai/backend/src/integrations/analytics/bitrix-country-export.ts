import {
  countryDisplayValue,
  countryRawValues,
  findFieldByTitle,
  getDealFieldMap,
  getLeadFieldMap,
  listBitrixDeals,
  listBitrixLeads,
  listBitrixStatusLabels,
  probeCountryFilter,
  type BitrixDeal,
  type BitrixLead,
  type CrmFieldMeta,
} from "../crm/bitrix-client.js";
import {
  appendDealRows,
  appendLeadRows,
  combinedSheetTab,
  COMBINED_HEADERS,
  countrySheetTab,
  dealToCombinedRow,
  DEAL_HEADERS,
  leadToCombinedRow,
  LEAD_HEADERS,
  prepareAnalyticsWorkbook,
  readExistingIds,
  SALES_SUMMARY_HEADERS,
  sheetAmount,
  summarySheetTab,
  type SheetCell,
  writeSheetContent,
  type AnalyticsDealRow,
  type AnalyticsLeadRow,
} from "../sheets/analytics-write.js";
import { loadServiceAccount } from "../sheets/google-auth.js";
import { analyticsExportConfig, type AnalyticsExportConfig } from "./config.js";
import { loadFxConverter, type FxConverter } from "./fx-rates.js";
import { logger } from "../../logger.js";

export type ExportDateRange = {
  from: string;
  to: string;
};

export type EntityExportResult = {
  sheetTab: string;
  fetched: number;
  appended: number;
  skipped: number;
};

export type CountryExportResult = {
  countryTag: string;
  leads: EntityExportResult;
  deals: EntityExportResult;
};

export type BitrixCountryExportSummary = {
  range: ExportDateRange;
  countries: CountryExportResult[];
  totalAppended: number;
  countryField: string;
};

export type BitrixCombinedExportSummary = {
  range: ExportDateRange;
  sheetTab: string;
  leads: number;
  deals: number;
  totalRows: number;
  countries: string[];
};

export type SalesSummaryRow = {
  country: string;
  leadCount: number;
  count: number;
  amount: number;
  currency: string;
  avgCheck: number;
};

export type BitrixSalesSummaryExportSummary = {
  range: ExportDateRange;
  month: string;
  sheetTab: string;
  rows: SalesSummaryRow[];
  totalLeads: number;
  totalDeals: number;
  totalAmountByCurrency: Record<string, number>;
};

const STATS_TZ = process.env.STATS_TIMEZONE ?? "Europe/Moscow";

export const NO_COUNTRY_LABEL = "Без страны";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBitrixDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STATS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function yesterdayRange(): ExportDateRange {
  const today = formatBitrixDate(new Date());
  const yesterday = addDaysIso(today, -1);
  return { from: yesterday, to: today };
}

export function todayRange(now = new Date()): ExportDateRange {
  const today = formatBitrixDate(now);
  const tomorrow = addDaysIso(today, 1);
  return { from: today, to: tomorrow };
}

export function monthRange(yearMonth: string): ExportDateRange {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error(`Некорректный месяц: ${yearMonth}. Используйте формат YYYY-MM, например 2026-06`);
  }
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const to = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { from, to };
}

type CountryEntity = { ID: string; [key: string]: string | string[] | undefined };

function matchesCountry(
  entity: CountryEntity,
  fieldCode: string,
  fieldMeta: Record<string, CrmFieldMeta>,
  countryName: string,
): boolean {
  const values = countryRawValues(entity[fieldCode]);
  if (!values.length) return false;
  return values.some((raw) => {
    const display = countryDisplayValue(fieldMeta, fieldCode, raw);
    return display.toLowerCase() === countryName.toLowerCase();
  });
}

type CountryFilterCache = Map<string, Record<string, unknown>>;

async function countryFilterFor(
  cache: CountryFilterCache,
  method: "crm.lead.list" | "crm.deal.list",
  fieldCode: string,
  countryName: string,
  fieldMeta: Record<string, CrmFieldMeta>,
): Promise<Record<string, unknown>> {
  const key = `${method}:${fieldCode}:${countryName}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const probed = await probeCountryFilter(method, fieldCode, countryName, fieldMeta);
  cache.set(key, probed.filter);
  if (probed.total > 0) {
    logger.info("Country filter resolved", { method, countryName, filter: probed.filter, total: probed.total });
  }
  return probed.filter;
}

function mapLeadRow(
  lead: BitrixLead,
  statusLabels: Map<string, string>,
  sourceLabels: Map<string, string>,
  countryField: string,
  leadFields: Record<string, CrmFieldMeta>,
  fx?: FxConverter,
): AnalyticsLeadRow {
  const rawAmount = parseAmount(lead.OPPORTUNITY);
  const rawCurrency = lead.CURRENCY_ID?.trim() || fx?.baseCurrency || "EUR";
  const amount = fx ? sheetAmount(fx.convert(rawAmount, rawCurrency)) : (lead.OPPORTUNITY ?? "");
  const currency = fx ? fx.baseCurrency : (lead.CURRENCY_ID ?? "");

  return {
    id: String(lead.ID),
    dateCreate: lead.DATE_CREATE ?? "",
    dateModify: lead.DATE_MODIFY ?? "",
    title: lead.TITLE ?? [lead.NAME, lead.LAST_NAME].filter(Boolean).join(" ").trim(),
    status: statusLabels.get(lead.STATUS_ID ?? "") ?? lead.STATUS_ID ?? "",
    amount,
    currency,
    country: countryDisplayValue(leadFields, countryField, lead[countryField]),
    source: sourceLabels.get(lead.SOURCE_ID ?? "") ?? lead.SOURCE_ID ?? "",
    managerId: lead.ASSIGNED_BY_ID ?? "",
    comments: (lead.COMMENTS ?? "").replace(/\s+/g, " ").trim().slice(0, 5000),
  };
}

function mapDealRow(
  deal: BitrixDeal,
  stageLabels: Map<string, string>,
  sourceLabels: Map<string, string>,
  countryField: string,
  dealFields: Record<string, CrmFieldMeta>,
  fx?: FxConverter,
): AnalyticsDealRow {
  const rawAmount = parseAmount(deal.OPPORTUNITY);
  const rawCurrency = deal.CURRENCY_ID?.trim() || fx?.baseCurrency || "EUR";
  const amount = fx ? sheetAmount(fx.convert(rawAmount, rawCurrency)) : (deal.OPPORTUNITY ?? "");
  const currency = fx ? fx.baseCurrency : (deal.CURRENCY_ID ?? "");

  return {
    id: String(deal.ID),
    dateCreate: deal.DATE_CREATE ?? "",
    dateModify: deal.DATE_MODIFY ?? "",
    closeDate: deal.CLOSEDATE ?? "",
    title: deal.TITLE ?? "",
    stage: stageLabels.get(deal.STAGE_ID ?? "") ?? deal.STAGE_ID ?? "",
    amount,
    currency,
    country: countryDisplayValue(dealFields, countryField, deal[countryField]),
    source: sourceLabels.get(deal.SOURCE_ID ?? "") ?? deal.SOURCE_ID ?? "",
    managerId: deal.ASSIGNED_BY_ID ?? "",
    comments: (deal.COMMENTS ?? "").replace(/\s+/g, " ").trim().slice(0, 5000),
  };
}

export async function createExportFx(cfg: AnalyticsExportConfig, range: ExportDateRange): Promise<FxConverter> {
  const rateDate = addDaysIso(range.to, -1);
  return loadFxConverter({
    baseCurrency: cfg.baseCurrency,
    date: rateDate,
    overrides: cfg.fxOverrides,
  });
}

async function fetchEntitiesByCountry<T extends CountryEntity>(opts: {
  listFn: (filter: Record<string, unknown>, extraSelect: string[]) => Promise<T[]>;
  listMethod: "crm.lead.list" | "crm.deal.list";
  countryName: string;
  countryField: string;
  fieldMeta: Record<string, CrmFieldMeta>;
  range: ExportDateRange;
  filterCache: CountryFilterCache;
}): Promise<T[]> {
  const countryFilter = await countryFilterFor(
    opts.filterCache,
    opts.listMethod,
    opts.countryField,
    opts.countryName,
    opts.fieldMeta,
  );

  const created = await opts.listFn(
    {
      ">=DATE_CREATE": opts.range.from,
      "<DATE_CREATE": opts.range.to,
      ...countryFilter,
    },
    [opts.countryField],
  );

  const modified = await opts.listFn(
    {
      ">=DATE_MODIFY": opts.range.from,
      "<DATE_MODIFY": opts.range.to,
      ...countryFilter,
    },
    [opts.countryField],
  );

  const byId = new Map<string, T>();
  for (const entity of [...created, ...modified]) {
    if (matchesCountry(entity, opts.countryField, opts.fieldMeta, opts.countryName)) {
      byId.set(String(entity.ID), entity);
    }
  }
  return [...byId.values()];
}

async function fetchSalesDealsByCountry(opts: {
  countryName: string;
  countryField: string;
  fieldMeta: Record<string, CrmFieldMeta>;
  range: ExportDateRange;
  filterCache: CountryFilterCache;
  salesStageIds: string[];
}): Promise<BitrixDeal[]> {
  const countryFilter = await countryFilterFor(
    opts.filterCache,
    "crm.deal.list",
    opts.countryField,
    opts.countryName,
    opts.fieldMeta,
  );

  const filter: Record<string, unknown> = buildSalesDealFilter({
    range: opts.range,
    countryField: opts.countryField,
    countryFilter,
    salesStageIds: opts.salesStageIds,
  });

  const deals = await listBitrixDeals(filter, [opts.countryField]);
  return deals.filter((deal) =>
    matchesCountry(deal, opts.countryField, opts.fieldMeta, opts.countryName),
  );
}

function parseAmount(value: string | undefined): number {
  const amount = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(amount) ? amount : 0;
}

function salesSummaryToRows(rows: SalesSummaryRow[], baseCurrency: string): SheetCell[][] {
  const noCountry = rows.find((row) => row.country === NO_COUNTRY_LABEL);
  const rest = rows.filter((row) => row.country !== NO_COUNTRY_LABEL);
  const sorted = [...rest].sort((a, b) => b.count - a.count || a.country.localeCompare(b.country, "ru"));
  const ordered = noCountry ? [...sorted, noCountry] : sorted;

  const sheetRows: SheetCell[][] = ordered.map((row) => [
    row.country,
    row.country === NO_COUNTRY_LABEL ? "—" : row.leadCount,
    row.count,
    sheetAmount(row.amount),
    baseCurrency,
    row.count ? sheetAmount(row.avgCheck) : 0,
  ]);

  const totalLeads = rows
    .filter((row) => row.country !== NO_COUNTRY_LABEL)
    .reduce((sum, row) => sum + row.leadCount, 0);
  const totalDeals = rows.reduce((sum, row) => sum + row.count, 0);
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);

  sheetRows.push([
    "ИТОГО",
    totalLeads,
    totalDeals,
    sheetAmount(totalAmount),
    baseCurrency,
    totalDeals ? sheetAmount(totalAmount / totalDeals) : 0,
  ]);

  return sheetRows;
}

function aggregateSalesByCountry(
  deals: BitrixDeal[],
  fx: FxConverter,
): Pick<SalesSummaryRow, "count" | "amount" | "currency" | "avgCheck"> {
  let total = 0;
  for (const deal of deals) {
    total += fx.convert(parseAmount(deal.OPPORTUNITY), deal.CURRENCY_ID);
  }

  return {
    count: deals.length,
    amount: total,
    currency: fx.baseCurrency,
    avgCheck: deals.length ? total / deals.length : 0,
  };
}

async function fetchLeadsByCountryCreatedInRange(opts: {
  countryName: string;
  countryField: string;
  fieldMeta: Record<string, CrmFieldMeta>;
  range: ExportDateRange;
  filterCache: CountryFilterCache;
}): Promise<BitrixLead[]> {
  const countryFilter = await countryFilterFor(
    opts.filterCache,
    "crm.lead.list",
    opts.countryField,
    opts.countryName,
    opts.fieldMeta,
  );

  const leads = await listBitrixLeads(
    {
      ">=DATE_CREATE": opts.range.from,
      "<DATE_CREATE": opts.range.to,
      ...countryFilter,
    },
    [opts.countryField],
  );

  return leads.filter((lead) =>
    matchesCountry(lead, opts.countryField, opts.fieldMeta, opts.countryName),
  );
}

function buildSalesDealFilter(opts: {
  range: ExportDateRange;
  countryField: string;
  countryFilter: Record<string, unknown>;
  salesStageIds: string[];
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    ">=CLOSEDATE": opts.range.from,
    "<CLOSEDATE": opts.range.to,
    ...opts.countryFilter,
  };

  if (opts.salesStageIds.length === 1) {
    filter["=STAGE_ID"] = opts.salesStageIds[0];
  } else if (opts.salesStageIds.length > 1) {
    filter["@STAGE_ID"] = opts.salesStageIds;
  } else {
    filter.CATEGORY_ID = 0;
    filter.STAGE_SEMANTIC_ID = "S";
  }

  return filter;
}

async function fetchSalesDealsWithoutCountry(opts: {
  countryField: string;
  range: ExportDateRange;
  salesStageIds: string[];
}): Promise<BitrixDeal[]> {
  return listBitrixDeals(
    buildSalesDealFilter({
      range: opts.range,
      countryField: opts.countryField,
      countryFilter: { [opts.countryField]: false },
      salesStageIds: opts.salesStageIds,
    }),
    [opts.countryField],
  );
}

async function exportEntityBatch<T extends CountryEntity, R>(opts: {
  account: ReturnType<typeof loadServiceAccount>;
  sheetId: string;
  tabTitle: string;
  headers: readonly string[];
  entities: T[];
  existingIds: Set<string>;
  mapRow: (entity: T) => R;
  append: (rows: R[]) => Promise<number>;
}): Promise<EntityExportResult> {
  const fresh = opts.entities.filter((entity) => !opts.existingIds.has(String(entity.ID))).map(opts.mapRow);
  const appended = await opts.append(fresh);
  return {
    sheetTab: opts.tabTitle,
    fetched: opts.entities.length,
    appended,
    skipped: opts.entities.length - fresh.length,
  };
}

async function readIdsForTabs(
  account: ReturnType<typeof loadServiceAccount>,
  sheetId: string,
  countries: string[],
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  for (const countryName of countries) {
    for (const kind of ["leads", "deals"] as const) {
      const tab = countrySheetTab(countryName, kind);
      map.set(tab, await readExistingIds(account, sheetId, tab));
      await sleep(300);
    }
  }
  return map;
}

async function resolveCountryFields(cfg: AnalyticsExportConfig): Promise<{
  leadField: string;
  dealField: string;
  leadFields: Record<string, CrmFieldMeta>;
  dealFields: Record<string, CrmFieldMeta>;
}> {
  const [leadFields, dealFields] = await Promise.all([getLeadFieldMap(), getDealFieldMap()]);

  const leadField = cfg.leadCountryField ?? findFieldByTitle(leadFields, "Страна");
  const dealField = cfg.dealCountryField ?? findFieldByTitle(dealFields, "Страна");

  if (!leadField) {
    throw new Error(
      'Не найдено поле «Страна» в лидах. Укажите BITRIX_COUNTRY_FIELD=UF_CRM_... в .env',
    );
  }
  if (!dealField) {
    throw new Error(
      'Не найдено поле «Страна» в сделках. Укажите BITRIX_DEAL_COUNTRY_FIELD=UF_CRM_... в .env',
    );
  }

  return { leadField, dealField, leadFields, dealFields };
}

export async function exportBitrixAnalyticsByCountryTags(opts?: {
  range?: ExportDateRange;
  countryTags?: string[];
  config?: AnalyticsExportConfig;
}): Promise<BitrixCountryExportSummary> {
  const cfg = opts?.config ?? analyticsExportConfig();
  const range = opts?.range ?? yesterdayRange();
  const countries = opts?.countryTags ?? cfg.countryTags;
  const account = loadServiceAccount(cfg.serviceAccountJson);

  const { leadField, dealField, leadFields, dealFields } = await resolveCountryFields(cfg);
  const fx = await createExportFx(cfg, range);

  await prepareAnalyticsWorkbook(
    account,
    cfg.sheetId,
    countries.flatMap((countryName) => [
      { title: countrySheetTab(countryName, "leads"), headers: LEAD_HEADERS },
      { title: countrySheetTab(countryName, "deals"), headers: DEAL_HEADERS },
    ]),
  );

  const [leadStatusLabels, dealStageLabels, sourceLabels] = await Promise.all([
    listBitrixStatusLabels("STATUS"),
    listBitrixStatusLabels("DEAL_STAGE"),
    listBitrixStatusLabels("SOURCE"),
  ]);

  const results: CountryExportResult[] = [];
  const filterCache: CountryFilterCache = new Map();
  const existingIdsByTab = await readIdsForTabs(account, cfg.sheetId, countries);

  for (const countryName of countries) {
    const [leads, deals] = await Promise.all([
      fetchEntitiesByCountry({
        listFn: listBitrixLeads,
        listMethod: "crm.lead.list",
        countryName,
        countryField: leadField,
        fieldMeta: leadFields,
        range,
        filterCache,
      }),
      fetchEntitiesByCountry({
        listFn: listBitrixDeals,
        listMethod: "crm.deal.list",
        countryName,
        countryField: dealField,
        fieldMeta: dealFields,
        range,
        filterCache,
      }),
    ]);

    const leadsTab = countrySheetTab(countryName, "leads");
    const dealsTab = countrySheetTab(countryName, "deals");

    const [leadsResult, dealsResult] = await Promise.all([
      exportEntityBatch({
        account,
        sheetId: cfg.sheetId,
        tabTitle: leadsTab,
        headers: LEAD_HEADERS,
        entities: leads,
        existingIds: existingIdsByTab.get(leadsTab) ?? new Set(),
        mapRow: (lead) => mapLeadRow(lead, leadStatusLabels, sourceLabels, leadField, leadFields, fx),
        append: (rows) => appendLeadRows(account, cfg.sheetId, leadsTab, rows),
      }),
      exportEntityBatch({
        account,
        sheetId: cfg.sheetId,
        tabTitle: dealsTab,
        headers: DEAL_HEADERS,
        entities: deals,
        existingIds: existingIdsByTab.get(dealsTab) ?? new Set(),
        mapRow: (deal) => mapDealRow(deal, dealStageLabels, sourceLabels, dealField, dealFields, fx),
        append: (rows) => appendDealRows(account, cfg.sheetId, dealsTab, rows),
      }),
    ]);

    const result: CountryExportResult = {
      countryTag: countryName,
      leads: leadsResult,
      deals: dealsResult,
    };
    results.push(result);
    logger.info("Country analytics export", { ...result, countryField: leadField });
  }

  return {
    range,
    countries: results,
    totalAppended: results.reduce((sum, row) => sum + row.leads.appended + row.deals.appended, 0),
    countryField: leadField,
  };
}

function sortByDateCreateDesc(rows: SheetCell[][]): SheetCell[][] {
  return [...rows].sort((a, b) => String(b[2] ?? "").localeCompare(String(a[2] ?? "")));
}

export async function exportBitrixAnalyticsCombined(opts?: {
  range?: ExportDateRange;
  countryTags?: string[];
  config?: AnalyticsExportConfig;
  sheetTab?: string;
}): Promise<BitrixCombinedExportSummary> {
  const cfg = opts?.config ?? analyticsExportConfig();
  const range = opts?.range ?? yesterdayRange();
  const countries = opts?.countryTags ?? cfg.countryTags;
  const account = loadServiceAccount(cfg.serviceAccountJson);
  const sheetTab = opts?.sheetTab ?? combinedSheetTab(range);

  const { leadField, dealField, leadFields, dealFields } = await resolveCountryFields(cfg);
  const fx = await createExportFx(cfg, range);

  const [leadStatusLabels, dealStageLabels, sourceLabels] = await Promise.all([
    listBitrixStatusLabels("STATUS"),
    listBitrixStatusLabels("DEAL_STAGE"),
    listBitrixStatusLabels("SOURCE"),
  ]);

  const filterCache: CountryFilterCache = new Map();
  const leadRows: AnalyticsLeadRow[] = [];
  const dealRows: AnalyticsDealRow[] = [];

  for (const countryName of countries) {
    const [leads, deals] = await Promise.all([
      fetchEntitiesByCountry({
        listFn: listBitrixLeads,
        listMethod: "crm.lead.list",
        countryName,
        countryField: leadField,
        fieldMeta: leadFields,
        range,
        filterCache,
      }),
      fetchEntitiesByCountry({
        listFn: listBitrixDeals,
        listMethod: "crm.deal.list",
        countryName,
        countryField: dealField,
        fieldMeta: dealFields,
        range,
        filterCache,
      }),
    ]);

    for (const lead of leads) {
      leadRows.push(mapLeadRow(lead, leadStatusLabels, sourceLabels, leadField, leadFields, fx));
    }
    for (const deal of deals) {
      dealRows.push(mapDealRow(deal, dealStageLabels, sourceLabels, dealField, dealFields, fx));
    }

    logger.info("Country data fetched for combined export", {
      countryName,
      leads: leads.length,
      deals: deals.length,
    });
  }

  const combinedRows = sortByDateCreateDesc([
    ...leadRows.map(leadToCombinedRow),
    ...dealRows.map(dealToCombinedRow),
  ]);

  const written = await writeSheetContent(account, cfg.sheetId, sheetTab, COMBINED_HEADERS, combinedRows);

  logger.info("Combined analytics export written", {
    sheetTab,
    range,
    leads: leadRows.length,
    deals: dealRows.length,
    written,
  });

  return {
    range,
    sheetTab,
    leads: leadRows.length,
    deals: dealRows.length,
    totalRows: written,
    countries,
  };
}

export async function exportBitrixSalesSummary(opts?: {
  month?: string;
  range?: ExportDateRange;
  countryTags?: string[];
  config?: AnalyticsExportConfig;
  sheetTab?: string;
  salesStageIds?: string[];
}): Promise<BitrixSalesSummaryExportSummary> {
  const cfg = opts?.config ?? analyticsExportConfig();
  const month = opts?.month ?? opts?.range?.from.slice(0, 7) ?? "";
  const range = opts?.range ?? (month ? monthRange(month) : yesterdayRange());
  const countries = opts?.countryTags ?? cfg.countryTags;
  const account = loadServiceAccount(cfg.serviceAccountJson);
  const sheetTab = opts?.sheetTab ?? summarySheetTab(month || range.from.slice(0, 7));

  const { leadField, dealField, leadFields, dealFields } = await resolveCountryFields(cfg);
  const fx = await createExportFx(cfg, range);
  const salesStageIds = opts?.salesStageIds ?? cfg.salesStageIds;
  const filterCache: CountryFilterCache = new Map();
  const summaryRows: SalesSummaryRow[] = [];

  for (const countryName of countries) {
    try {
      const [leads, deals] = await Promise.all([
        fetchLeadsByCountryCreatedInRange({
          countryName,
          countryField: leadField,
          fieldMeta: leadFields,
          range,
          filterCache,
        }),
        fetchSalesDealsByCountry({
          countryName,
          countryField: dealField,
          fieldMeta: dealFields,
          range,
          filterCache,
          salesStageIds,
        }),
      ]);

      const aggregated = aggregateSalesByCountry(deals, fx);
      summaryRows.push({ country: countryName, leadCount: leads.length, ...aggregated });

      logger.info("Sales summary fetched", {
        countryName,
        leads: leads.length,
        deals: deals.length,
        amountEur: aggregated.amount,
        fxDate: fx.rateDate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Sales summary skipped country", { countryName, error: message });
      summaryRows.push({
        country: countryName,
        leadCount: 0,
        count: 0,
        amount: 0,
        currency: fx.baseCurrency,
        avgCheck: 0,
      });
    }
  }

  try {
    const deals = await fetchSalesDealsWithoutCountry({
      countryField: dealField,
      range,
      salesStageIds,
    });
    const aggregated = aggregateSalesByCountry(deals, fx);
    summaryRows.push({ country: NO_COUNTRY_LABEL, leadCount: 0, ...aggregated });
    logger.info("Sales summary fetched", {
      countryName: NO_COUNTRY_LABEL,
      leads: 0,
      deals: deals.length,
      amountEur: aggregated.amount,
      fxDate: fx.rateDate,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Sales summary skipped country", { countryName: NO_COUNTRY_LABEL, error: message });
    summaryRows.push({
      country: NO_COUNTRY_LABEL,
      leadCount: 0,
      count: 0,
      amount: 0,
      currency: fx.baseCurrency,
      avgCheck: 0,
    });
  }

  const totalAmount = summaryRows.reduce((sum, row) => sum + row.amount, 0);
  const totalLeads = summaryRows
    .filter((row) => row.country !== NO_COUNTRY_LABEL)
    .reduce((sum, row) => sum + row.leadCount, 0);
  const totalAmountByCurrency = { [fx.baseCurrency]: totalAmount };

  const written = await writeSheetContent(
    account,
    cfg.sheetId,
    sheetTab,
    SALES_SUMMARY_HEADERS,
    salesSummaryToRows(summaryRows, fx.baseCurrency),
  );

  logger.info("Sales summary written", {
    sheetTab,
    range,
    salesStageIds,
    baseCurrency: fx.baseCurrency,
    fxDate: fx.rateDate,
    countries: summaryRows.length,
    totalLeads,
    totalDeals: summaryRows.reduce((sum, row) => sum + row.count, 0),
    totalAmount,
    written,
  });

  return {
    range,
    month: month || range.from.slice(0, 7),
    sheetTab,
    rows: summaryRows,
    totalLeads,
    totalDeals: summaryRows.reduce((sum, row) => sum + row.count, 0),
    totalAmountByCurrency,
  };
}

export async function exportBitrixSalesSummariesForMonths(opts: {
  months: string[];
  countryTags?: string[];
  config?: AnalyticsExportConfig;
}): Promise<BitrixSalesSummaryExportSummary[]> {
  const results: BitrixSalesSummaryExportSummary[] = [];
  for (const month of opts.months) {
    results.push(
      await exportBitrixSalesSummary({
        month,
        countryTags: opts.countryTags,
        config: opts.config,
      }),
    );
    await sleep(3000);
  }
  return results;
}

/** @deprecated use exportBitrixAnalyticsByCountryTags */
export const exportBitrixLeadsByCountryTags = exportBitrixAnalyticsByCountryTags;
