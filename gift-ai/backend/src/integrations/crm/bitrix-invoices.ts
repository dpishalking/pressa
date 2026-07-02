import {
  bitrixCall,
  countryDisplayValue,
  countryRawValues,
  type CrmFieldMeta,
} from "./bitrix-client.js";

export const SMART_INVOICE_ENTITY_TYPE_ID = 31;
/** Оплачено — победа. */
export const INVOICE_STAGE_PAID = "DT31_2:P";
/** Отправлено клиенту — ждём оплату. */
export const INVOICE_STAGE_SENT = "DT31_2:S";
/** Не оплачено — проигрыш, в отчёты не включаем. */
export const INVOICE_STAGE_LOST = "DT31_2:D";
/** @deprecated используйте INVOICE_STAGE_LOST */
export const INVOICE_STAGE_UNPAID = INVOICE_STAGE_LOST;

/** Сделка на стадии «Выставление счета» — классический сценарий ожидания оплаты. */
export const INVOICE_PENDING_DEAL_STAGE_ID = "1";
/** Самовывоз / оплата в офисе — сделка часто сразу в производстве, счёт всё равно ждёт оплаты. */
export const DEAL_STAGE_PRODUCTION = "UC_SONEPG";

export function isInvoiceAwaitingPayment(deal?: {
  STAGE_ID?: string;
  STAGE_SEMANTIC_ID?: string;
} | null): boolean {
  if (!deal) return false;
  // Исключаем только завершённые сделки (won/lost). Производство — не исключаем:
  // при самовывозе сделка уже в производстве, но счёт ещё «отправлен» и не оплачен.
  if (deal.STAGE_SEMANTIC_ID === "S" || deal.STAGE_SEMANTIC_ID === "F") return false;
  return deal.STAGE_SEMANTIC_ID === "P";
}

/** Дата отправки счёта клиенту — movedTime при переходе в «Отправлено», иначе createdTime. */
export function invoiceSentAt(invoice: { stageId?: string; movedTime?: string; createdTime?: string }): string {
  if (invoice.stageId === INVOICE_STAGE_SENT && invoice.movedTime) return invoice.movedTime;
  return invoice.createdTime ?? "";
}

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
  movedTime?: string;
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

export async function listInvoicesCreatedInRange(range: InvoiceDateRange): Promise<BitrixInvoice[]> {
  const items: BitrixInvoice[] = [];
  let start = 0;

  while (true) {
    const response = await bitrixCall("crm.item.list", {
      entityTypeId: SMART_INVOICE_ENTITY_TYPE_ID,
      filter: {
        ">=createdTime": range.from,
        "<createdTime": range.to,
      },
      select: ["id", "title", "stageId", "opportunity", "currencyId", "parentId2", "createdTime", "movedTime"],
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
        movedTime: row.movedTime != null ? String(row.movedTime) : undefined,
      });
    }

    const total = Number(response.total ?? 0);
    start += batch.length;
    if (!batch.length || start >= total) break;
    await sleep(300);
  }

  return items;
}

/** Счета на стадии «Отправлено клиенту», опционально старше minDaysSinceSent дней с момента отправки. */
export async function listSentInvoices(minDaysSinceSent = 0): Promise<BitrixInvoice[]> {
  const filter: Record<string, unknown> = { stageId: INVOICE_STAGE_SENT };

  const items: BitrixInvoice[] = [];
  let start = 0;

  while (true) {
    const response = await bitrixCall("crm.item.list", {
      entityTypeId: SMART_INVOICE_ENTITY_TYPE_ID,
      filter,
      select: ["id", "title", "stageId", "opportunity", "currencyId", "parentId2", "createdTime", "movedTime"],
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
        movedTime: row.movedTime != null ? String(row.movedTime) : undefined,
      });
    }

    const total = Number(response.total ?? 0);
    start += batch.length;
    if (!batch.length || start >= total) break;
    await sleep(300);
  }

  if (minDaysSinceSent <= 0) return items;

  const cutoffMs = Date.now() - minDaysSinceSent * 86_400_000;
  return items.filter((invoice) => {
    const sentAt = Date.parse(invoiceSentAt(invoice));
    return Number.isFinite(sentAt) && sentAt < cutoffMs;
  });
}

/** @deprecated используйте listSentInvoices */
export async function listUnpaidInvoices(): Promise<BitrixInvoice[]> {
  return listSentInvoices(0);
}

/** Дата оплаты — movedTime при переходе в «Оплачено». */
export function invoicePaidAt(invoice: { stageId?: string; movedTime?: string; createdTime?: string }): string {
  if (invoice.stageId === INVOICE_STAGE_PAID && invoice.movedTime) return invoice.movedTime;
  return invoice.createdTime ?? "";
}

export async function listRecentlyPaidInvoices(sinceIso: string): Promise<BitrixInvoice[]> {
  const items: BitrixInvoice[] = [];
  let start = 0;

  while (true) {
    const response = await bitrixCall("crm.item.list", {
      entityTypeId: SMART_INVOICE_ENTITY_TYPE_ID,
      filter: {
        stageId: INVOICE_STAGE_PAID,
        ">=movedTime": sinceIso,
      },
      select: ["id", "title", "stageId", "opportunity", "currencyId", "parentId2", "createdTime", "movedTime"],
      order: { movedTime: "DESC" },
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
        movedTime: row.movedTime != null ? String(row.movedTime) : undefined,
      });
    }

    const total = Number(response.total ?? 0);
    start += batch.length;
    if (!batch.length || start >= total) break;
    await sleep(300);
  }

  return items;
}

export async function listRecentlySentInvoices(sinceIso: string): Promise<BitrixInvoice[]> {
  const items: BitrixInvoice[] = [];
  let start = 0;

  while (true) {
    const response = await bitrixCall("crm.item.list", {
      entityTypeId: SMART_INVOICE_ENTITY_TYPE_ID,
      filter: {
        stageId: INVOICE_STAGE_SENT,
        ">=movedTime": sinceIso,
      },
      select: ["id", "title", "stageId", "opportunity", "currencyId", "parentId2", "createdTime", "movedTime"],
      order: { movedTime: "DESC" },
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
        movedTime: row.movedTime != null ? String(row.movedTime) : undefined,
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
    movedTime: item.movedTime != null ? String(item.movedTime) : undefined,
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

    if (invoice.stageId === INVOICE_STAGE_LOST) {
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
