import {
  countryDisplayValue,
  findFieldByTitle,
  getDealFieldMap,
  listAllWonDeals,
  listBitrixContactsByIds,
  type BitrixContact,
  type BitrixDeal,
} from "./bitrix-client.js";
import type { AnalyticsExportConfig } from "../analytics/config.js";
import { loadFxConverter, type FxConverter } from "../analytics/fx-rates.js";
import { logger } from "../../logger.js";

export type CustomerOrder = {
  dealId: string;
  closeDate: string;
  amountEur: number;
};

export type CustomerProfile = {
  contactId: string;
  name: string;
  phone: string;
  email: string;
  country: string;
  cohortMonth: string;
  firstOrderDate: string;
  orders: CustomerOrder[];
  orderCount: number;
  ltvEur: number;
};

export type LtvOverview = {
  totalCustomers: number;
  oneTimeCustomers: number;
  repeatCustomers: number;
  revenueOneTimeEur: number;
  revenueRepeatEur: number;
  repeatRevenueSharePct: number;
  avgLtvEur: number;
  medianLtvEur: number;
  top20CustomersSharePct: number;
  totalRevenueEur: number;
};

export type CohortMonthRow = {
  cohortMonth: string;
  cohortSize: number;
  cells: Array<{
    monthOffset: number;
    activeCustomers: number;
    retentionPct: number;
    revenueEur: number;
    cumulativeRevenueEur: number;
    revenuePerCustomerEur: number;
  }>;
};

export type CustomerLtvBuildResult = {
  customers: CustomerProfile[];
  overview: LtvOverview;
  cohorts: CohortMonthRow[];
  maxMonthOffset: number;
  baseCurrency: string;
  totalDeals: number;
};

function parseCloseDate(iso: string | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function monthOffset(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function primaryPhone(contact: BitrixContact): string {
  const phones = contact.PHONE ?? [];
  const value = phones.find((row) => row.VALUE)?.VALUE ?? "";
  return value.replace(/\s+/g, "").trim();
}

function primaryEmail(contact: BitrixContact): string {
  const emails = contact.EMAIL ?? [];
  return (emails.find((row) => row.VALUE)?.VALUE ?? "").trim().toLowerCase();
}

function contactName(contact: BitrixContact): string {
  return [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ").trim();
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

async function fxForMonth(
  cache: Map<string, FxConverter>,
  month: string,
  cfg: AnalyticsExportConfig,
): Promise<FxConverter> {
  const cached = cache.get(month);
  if (cached) return cached;

  const fx = await loadFxConverter({
    baseCurrency: cfg.baseCurrency,
    date: `${month}-15`,
    overrides: cfg.fxOverrides,
  });
  cache.set(month, fx);
  return fx;
}

export async function buildCustomerLtv(opts: {
  config: AnalyticsExportConfig;
  maxCohortOffset?: number;
  onProgress?: (stage: string, done: number, total: number) => void;
}): Promise<CustomerLtvBuildResult> {
  const cfg = opts.config;
  const maxOffset = opts.maxCohortOffset ?? 12;
  const dealFields = await getDealFieldMap();
  const countryField =
    cfg.dealCountryField ?? findFieldByTitle(dealFields, "Страна") ?? "UF_CRM_COUNTRY";

  opts.onProgress?.("deals", 0, 1);
  const deals = await listAllWonDeals(cfg.salesStageIds, [countryField]);
  opts.onProgress?.("deals", 1, 1);

  const contactIds = [
    ...new Set(
      deals
        .map((deal) => String(deal.CONTACT_ID ?? "").trim())
        .filter((id) => id && id !== "0"),
    ),
  ];

  opts.onProgress?.("contacts", 0, contactIds.length);
  const contacts = await listBitrixContactsByIds(contactIds, [countryField]);
  const contactMap = new Map(contacts.map((contact) => [String(contact.ID), contact]));
  opts.onProgress?.("contacts", contactIds.length, contactIds.length);

  const fxCache = new Map<string, FxConverter>();
  const ordersByContact = new Map<string, CustomerOrder[]>();
  const dealMap = new Map(deals.map((deal) => [String(deal.ID), deal]));

  for (const deal of deals) {
    const contactId = String(deal.CONTACT_ID ?? "").trim();
    if (!contactId || contactId === "0") continue;

    const closeDate = parseCloseDate(deal.CLOSEDATE);
    if (!closeDate) continue;

    const amount = Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0;
    const fx = await fxForMonth(fxCache, monthKey(closeDate), cfg);
    const amountEur = fx.convert(amount, deal.CURRENCY_ID);

    const order: CustomerOrder = {
      dealId: String(deal.ID),
      closeDate,
      amountEur,
    };

    const bucket = ordersByContact.get(contactId) ?? [];
    bucket.push(order);
    ordersByContact.set(contactId, bucket);
  }

  const customers: CustomerProfile[] = [];

  for (const [contactId, orders] of ordersByContact) {
    orders.sort((a, b) => a.closeDate.localeCompare(b.closeDate));
    const contact = contactMap.get(contactId);
    const firstOrderDate = orders[0]!.closeDate;
    const cohortMonth = monthKey(firstOrderDate);
    const ltvEur = orders.reduce((sum, order) => sum + order.amountEur, 0);

    const dealCountry = countryDisplayValue(
      dealFields,
      countryField,
      dealMap.get(orders[0]!.dealId)?.[countryField],
    );

    customers.push({
      contactId,
      name: contact ? contactName(contact) : "",
      phone: contact ? primaryPhone(contact) : "",
      email: contact ? primaryEmail(contact) : "",
      country: dealCountry || (contact ? countryDisplayValue(dealFields, countryField, contact[countryField]) : ""),
      cohortMonth,
      firstOrderDate,
      orders,
      orderCount: orders.length,
      ltvEur,
    });
  }

  customers.sort((a, b) => b.ltvEur - a.ltvEur);

  const totalRevenueEur = customers.reduce((sum, customer) => sum + customer.ltvEur, 0);
  const oneTime = customers.filter((c) => c.orderCount === 1);
  const repeat = customers.filter((c) => c.orderCount > 1);
  const revenueOneTimeEur = oneTime.reduce((sum, c) => sum + c.ltvEur, 0);
  const revenueRepeatEur = repeat.reduce((sum, c) => sum + c.ltvEur, 0);

  const top20Count = Math.max(1, Math.ceil(customers.length * 0.2));
  const top20Revenue = customers.slice(0, top20Count).reduce((sum, c) => sum + c.ltvEur, 0);

  const overview: LtvOverview = {
    totalCustomers: customers.length,
    oneTimeCustomers: oneTime.length,
    repeatCustomers: repeat.length,
    revenueOneTimeEur,
    revenueRepeatEur,
    repeatRevenueSharePct: totalRevenueEur ? (revenueRepeatEur / totalRevenueEur) * 100 : 0,
    avgLtvEur: customers.length ? totalRevenueEur / customers.length : 0,
    medianLtvEur: median(customers.map((c) => c.ltvEur)),
    top20CustomersSharePct: totalRevenueEur ? (top20Revenue / totalRevenueEur) * 100 : 0,
    totalRevenueEur,
  };

  const cohortMonths = [...new Set(customers.map((c) => c.cohortMonth))].sort();
  const cohorts: CohortMonthRow[] = [];

  for (const cohortMonth of cohortMonths) {
    const cohortCustomers = customers.filter((c) => c.cohortMonth === cohortMonth);
    const cohortSize = cohortCustomers.length;
    const cells: CohortMonthRow["cells"] = [];

    let cumulativeRevenue = 0;
    for (let offset = 0; offset <= maxOffset; offset += 1) {
      let activeCustomers = 0;
      let revenueEur = 0;

      for (const customer of cohortCustomers) {
        const monthRevenue = customer.orders
          .filter((order) => monthOffset(cohortMonth, monthKey(order.closeDate)) === offset)
          .reduce((sum, order) => sum + order.amountEur, 0);
        if (monthRevenue > 0) {
          activeCustomers += 1;
          revenueEur += monthRevenue;
        }
      }

      cumulativeRevenue += revenueEur;
      cells.push({
        monthOffset: offset,
        activeCustomers,
        retentionPct: cohortSize ? (activeCustomers / cohortSize) * 100 : 0,
        revenueEur,
        cumulativeRevenueEur: cumulativeRevenue,
        revenuePerCustomerEur: cohortSize ? cumulativeRevenue / cohortSize : 0,
      });
    }

    cohorts.push({ cohortMonth, cohortSize, cells });
  }

  logger.info("Customer LTV built", {
    customers: customers.length,
    deals: deals.length,
    cohorts: cohorts.length,
    repeatRevenueSharePct: overview.repeatRevenueSharePct.toFixed(1),
  });

  return {
    customers,
    overview,
    cohorts,
    maxMonthOffset: maxOffset,
    baseCurrency: cfg.baseCurrency,
    totalDeals: deals.length,
  };
}
