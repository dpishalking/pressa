import {
  bitrixCall,
  countryDisplayValue,
  countryRawValues,
  type CrmFieldMeta,
} from "./bitrix-client.js";

export const SMART_INVOICE_ENTITY_TYPE_ID = 31;
export const INVOICE_STAGE_PAID = "DT31_2:P";
export const INVOICE_STAGE_UNPAID = "DT31_2:D";

export type InvoiceDateRange = {
  from: string;
  to: string;
};

export type BitrixInvoice = {
  id: number;
  title?: string;
  stageId?: string;
  opportunity?: number;
  currencyId?: string;
  parentDealId?: number;
  createdTime?: string;
};

export type InvoiceCountryBucket = {
  invoicesCount: number;
  invoicesAmount: number;
  cancelledCount: number;
  cancelledAmount: number;
  paidAmount: number;
  netRevenue: number;
};

const EMPTY_BUCKET: InvoiceCountryBucket = {
  invoicesCount: 0,
  invoicesAmount: 0,
  cancelledCount: 0,
  cancelledAmount: 0,
  paidAmount: 0,
  netRevenue: 0,
};

async function listInvoicesCreatedInRange(range: InvoiceDateRange): Promise<BitrixInvoice[]> {
  const items: BitrixInvoice[] = [];
  let start = 0;

  while (true) {
    const response = await bitrixCall("crm.item.list", {
      entityTypeId: SMART_INVOICE_ENTITY_TYPE_ID,
      filter: {
        ">=createdTime": range.from,
        "<createdTime": range.to,
      },
      select: ["id", "title", "stageId", "opportunity", "currencyId", "parentId2", "createdTime"],
      order: { createdTime: "ASC" },
      start,
    });

    const batch = (response.result as { items?: Array<Record<string, unknown>> } | undefined)?.items ?? [];
    for (const row of batch) {
      items.push({
        id: Number(row.id),
        title: row.title != null ? String(row.title) : undefined,
        stageId: row.stageId != null ? String(row.stageId) : undefined,
        opportunity: Number(row.opportunity ?? 0),
        currencyId: row.currencyId != null ? String(row.currencyId) : undefined,
        parentDealId: row.parentId2 ? Number(row.parentId2) : undefined,
        createdTime: row.createdTime != null ? String(row.createdTime) : undefined,
      });
    }

    const total = Number(response.total ?? 0);
    start += batch.length;
    if (!batch.length || start >= total) break;
    await sleep(300);
  }

  return items;
}

export async function listUnpaidInvoices(): Promise<BitrixInvoice[]> {
  const items: BitrixInvoice[] = [];
  let start = 0;

  while (true) {
    const response = await bitrixCall("crm.item.list", {
      entityTypeId: SMART_INVOICE_ENTITY_TYPE_ID,
      filter: { stageId: INVOICE_STAGE_UNPAID },
      select: ["id", "title", "stageId", "opportunity", "currencyId", "parentId2", "createdTime"],
      order: { createdTime: "ASC" },
      start,
    });

    const batch = (response.result as { items?: Array<Record<string, unknown>> } | undefined)?.items ?? [];
    for (const row of batch) {
      items.push({
        id: Number(row.id),
        title: row.title != null ? String(row.title) : undefined,
        stageId: row.stageId != null ? String(row.stageId) : undefined,
        opportunity: Number(row.opportunity ?? 0),
        currencyId: row.currencyId != null ? String(row.currencyId) : undefined,
        parentDealId: row.parentId2 ? Number(row.parentId2) : undefined,
        createdTime: row.createdTime != null ? String(row.createdTime) : undefined,
      });
    }

    const total = Number(response.total ?? 0);
    start += batch.length;
    if (!batch.length || start >= total) break;
    await sleep(300);
  }

  return items;
}

export async function getBitrixInvoiceById(id: number): Promise<BitrixInvoice | null> {
  const response = await bitrixCall("crm.item.get", {
    entityTypeId: SMART_INVOICE_ENTITY_TYPE_ID,
    id,
  });
  const row = response.result as { item?: Record<string, unknown> } | undefined;
  const item = row?.item;
  if (!item?.id) return null;

  return {
    id: Number(item.id),
    title: item.title != null ? String(item.title) : undefined,
    stageId: item.stageId != null ? String(item.stageId) : undefined,
    opportunity: Number(item.opportunity ?? 0),
    currencyId: item.currencyId != null ? String(item.currencyId) : undefined,
    parentDealId: item.parentId2 ? Number(item.parentId2) : undefined,
    createdTime: item.createdTime != null ? String(item.createdTime) : undefined,
  };
}

async function loadDealCountryMap(
  dealIds: number[],
  dealCountryField: string,
): Promise<Map<number, string | string[] | undefined>> {
  const map = new Map<number, string | string[] | undefined>();
  const unique = [...new Set(dealIds.filter(Boolean))];

  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const response = await bitrixCall("crm.deal.list", {
      filter: { "@ID": chunk },
      select: ["ID", dealCountryField],
      start: 0,
    });
    const deals = (response.result as Array<Record<string, string | string[] | undefined>> | undefined) ?? [];
    for (const deal of deals) {
      map.set(Number(deal.ID), deal[dealCountryField]);
    }
    await sleep(200);
  }

  return map;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function buildInvoiceBucketsByCountry(opts: {
  range: InvoiceDateRange;
  countries: string[];
  dealCountryField: string;
  dealFieldMeta: Record<string, CrmFieldMeta>;
  convertAmount: (amount: number, currency?: string) => number;
  noCountryLabel: string;
}): Promise<Map<string, InvoiceCountryBucket>> {
  const invoices = await listInvoicesCreatedInRange(opts.range);
  const dealIds = invoices.map((inv) => inv.parentDealId).filter((id): id is number => Boolean(id));
  const dealCountries = await loadDealCountryMap(dealIds, opts.dealCountryField);

  const buckets = new Map<string, InvoiceCountryBucket>();
  for (const country of [...opts.countries, opts.noCountryLabel]) {
    buckets.set(country, { ...EMPTY_BUCKET });
  }

  function resolveCountryName(dealId?: number): string {
    if (!dealId) return opts.noCountryLabel;
    const raw = dealCountries.get(dealId);
    const values = countryRawValues(raw);
    if (!values.length) return opts.noCountryLabel;
    const display = countryDisplayValue(opts.dealFieldMeta, opts.dealCountryField, raw);
    if (!display.trim()) return opts.noCountryLabel;
    const matched = opts.countries.find((c) => c.toLowerCase() === display.toLowerCase());
    return matched ?? opts.noCountryLabel;
  }

  for (const invoice of invoices) {
    const countryName = resolveCountryName(invoice.parentDealId);
    const bucket = buckets.get(countryName) ?? { ...EMPTY_BUCKET };
    const amountEur = opts.convertAmount(invoice.opportunity ?? 0, invoice.currencyId);

    bucket.invoicesCount += 1;
    bucket.invoicesAmount += amountEur;

    if (invoice.stageId === INVOICE_STAGE_UNPAID) {
      bucket.cancelledCount += 1;
      bucket.cancelledAmount += amountEur;
    }
    if (invoice.stageId === INVOICE_STAGE_PAID) {
      bucket.paidAmount += amountEur;
    }

    bucket.netRevenue = bucket.paidAmount - bucket.cancelledAmount;
    buckets.set(countryName, bucket);
  }

  return buckets;
}
