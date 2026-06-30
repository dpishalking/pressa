import { config } from "../../config.js";
import { logger } from "../../logger.js";

export function bitrixWebhookBase(): string {
  const url = config.BITRIX24_WEBHOOK_URL.replace(/\/$/, "");
  if (!url) throw new Error("BITRIX24_WEBHOOK_URL не настроен");
  return url;
}

export async function bitrixCall(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`${bitrixWebhookBase()}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok || json.error) {
        throw new Error(String(json.error_description ?? json.error ?? res.status));
      }
      return json;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export type CrmFieldMeta = {
  type?: string;
  title?: string;
  listLabel?: string;
  isMultiple?: boolean;
  items?: Array<{ ID?: string; VALUE?: string }>;
};

export type BitrixEntity = {
  ID: string;
  DATE_CREATE?: string;
  DATE_MODIFY?: string;
  TITLE?: string;
  STATUS_ID?: string;
  STAGE_ID?: string;
  OPPORTUNITY?: string;
  CURRENCY_ID?: string;
  TAGS?: string;
  SOURCE_ID?: string;
  ASSIGNED_BY_ID?: string;
  COMMENTS?: string;
  CLOSEDATE?: string;
  NAME?: string;
  LAST_NAME?: string;
  [key: string]: string | string[] | undefined;
};

export type BitrixLead = BitrixEntity;
export type BitrixDeal = BitrixEntity;

export type BitrixContact = BitrixEntity & {
  PHONE?: Array<{ VALUE?: string; VALUE_TYPE?: string }>;
  EMAIL?: Array<{ VALUE?: string; VALUE_TYPE?: string }>;
};

const LEAD_SELECT = [
  "ID",
  "DATE_CREATE",
  "DATE_MODIFY",
  "TITLE",
  "STATUS_ID",
  "OPPORTUNITY",
  "CURRENCY_ID",
  "TAGS",
  "SOURCE_ID",
  "ASSIGNED_BY_ID",
  "COMMENTS",
  "NAME",
  "LAST_NAME",
] as const;

const DEAL_SELECT = [
  "ID",
  "DATE_CREATE",
  "DATE_MODIFY",
  "CLOSEDATE",
  "TITLE",
  "STAGE_ID",
  "OPPORTUNITY",
  "CURRENCY_ID",
  "TAGS",
  "SOURCE_ID",
  "ASSIGNED_BY_ID",
  "COMMENTS",
  "CONTACT_ID",
] as const;

async function listBitrixPaged<T>(
  method: string,
  filter: Record<string, unknown>,
  select: readonly string[],
): Promise<T[]> {
  const items: T[] = [];
  let start = 0;

  while (true) {
    const response = await bitrixCall(method, {
      filter,
      select: [...select],
      order: { DATE_CREATE: "ASC" },
      start,
    });

    const batch = (response.result as T[] | undefined) ?? [];
    items.push(...batch);

    const total = Number(response.total ?? 0);
    start += batch.length;
    if (!batch.length || start >= total) break;
    await sleep(350);
  }

  return items;
}

export async function getLeadFieldMap(): Promise<Record<string, CrmFieldMeta>> {
  const response = await bitrixCall("crm.lead.fields", {});
  return (response.result as Record<string, CrmFieldMeta>) ?? {};
}

export async function getDealFieldMap(): Promise<Record<string, CrmFieldMeta>> {
  const response = await bitrixCall("crm.deal.fields", {});
  return (response.result as Record<string, CrmFieldMeta>) ?? {};
}

export function findFieldByTitle(fields: Record<string, CrmFieldMeta>, title: string): string | null {
  const wanted = title.trim().toLowerCase();
  for (const [code, meta] of Object.entries(fields)) {
    const label = (meta.title ?? meta.listLabel ?? "").trim().toLowerCase();
    if (label === wanted) return code;
  }
  return null;
}

export function countryEnumId(
  fields: Record<string, CrmFieldMeta>,
  fieldCode: string,
  countryName: string,
): string | null {
  const meta = fields[fieldCode];
  if (!meta?.items?.length) return null;
  const item = meta.items.find((row) => (row.VALUE ?? "").toLowerCase() === countryName.toLowerCase());
  return item?.ID ?? null;
}

export function countryFilterValue(
  fields: Record<string, CrmFieldMeta>,
  fieldCode: string,
  countryName: string,
): string {
  return countryEnumId(fields, fieldCode, countryName) ?? countryName;
}

export function countryRawValues(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw.map((value) => String(value)).filter(Boolean);
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function countryDisplayValue(
  fields: Record<string, CrmFieldMeta>,
  fieldCode: string,
  raw: string | string[] | undefined,
): string {
  const values = countryRawValues(raw);
  if (!values.length) return "";
  const meta = fields[fieldCode];
  return values
    .map((value) => {
      if (meta?.type === "enumeration" && meta.items?.length) {
        const item = meta.items.find((row) => row.ID === value || row.VALUE === value);
        return item?.VALUE ?? value;
      }
      return value;
    })
    .join(", ");
}

export function buildCountryFilterCandidates(
  fields: Record<string, CrmFieldMeta>,
  fieldCode: string,
  countryName: string,
): Record<string, unknown>[] {
  const meta = fields[fieldCode];
  const enumId = countryEnumId(fields, fieldCode, countryName);
  const candidates: Record<string, unknown>[] = [];

  if (enumId) {
    candidates.push({ [`=${fieldCode}`]: enumId });
    candidates.push({ [fieldCode]: enumId });
  }
  candidates.push({ [`=${fieldCode}`]: countryName });
  candidates.push({ [fieldCode]: countryName });

  if (meta?.isMultiple && enumId) {
    candidates.push({ [`=${fieldCode}`]: [enumId] });
  }

  const seen = new Set<string>();
  return candidates.filter((filter) => {
    const key = JSON.stringify(filter);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function probeCountryFilter(
  method: "crm.lead.list" | "crm.deal.list",
  fieldCode: string,
  countryName: string,
  fields: Record<string, CrmFieldMeta>,
): Promise<{ filter: Record<string, unknown>; total: number }> {
  const enumId = countryEnumId(fields, fieldCode, countryName);
  const candidates = buildCountryFilterCandidates(fields, fieldCode, countryName);

  let best: { filter: Record<string, unknown>; total: number } | null = null;

  for (const filter of candidates) {
    const response = await bitrixCall(method, {
      filter,
      select: ["ID"],
      start: 0,
    });
    const total = Number(response.total ?? 0);
    if (total <= 0) continue;

    const usesEnumId =
      enumId != null && JSON.stringify(filter).includes(enumId);
    if (!best) {
      best = { filter, total };
      continue;
    }

    const bestUsesEnumId =
      enumId != null && JSON.stringify(best.filter).includes(enumId);
    if (usesEnumId && !bestUsesEnumId) {
      best = { filter, total };
      continue;
    }
    if (usesEnumId === bestUsesEnumId && total < best.total) {
      best = { filter, total };
    }
    await sleep(200);
  }

  if (best) return best;

  const fallback = buildCountryFilterCandidates(fields, fieldCode, countryName)[0] ?? {
    [`=${fieldCode}`]: countryFilterValue(fields, fieldCode, countryName),
  };
  return { filter: fallback, total: 0 };
}

export async function listCountryEnumValues(
  fields: Record<string, CrmFieldMeta>,
  fieldCode: string,
): Promise<Array<{ id: string; name: string }>> {
  const meta = fields[fieldCode];
  return (meta?.items ?? [])
    .filter((row) => row.ID && row.VALUE)
    .map((row) => ({ id: row.ID!, name: row.VALUE! }));
}

export async function listBitrixLeads(
  filter: Record<string, unknown>,
  extraSelect: string[] = [],
): Promise<BitrixLead[]> {
  const select = [...new Set([...LEAD_SELECT, ...extraSelect])];
  return listBitrixPaged<BitrixLead>("crm.lead.list", filter, select);
}

export async function getBitrixLeadById(id: string | number): Promise<BitrixLead | null> {
  const response = await bitrixCall("crm.lead.get", { id: String(id) });
  const lead = response.result as BitrixLead | undefined;
  return lead?.ID ? lead : null;
}

export async function getBitrixDealById(id: string | number): Promise<BitrixDeal | null> {
  const response = await bitrixCall("crm.deal.get", { id: String(id) });
  const deal = response.result as BitrixDeal | undefined;
  return deal?.ID ? deal : null;
}

export async function listBitrixDeals(
  filter: Record<string, unknown>,
  extraSelect: string[] = [],
): Promise<BitrixDeal[]> {
  const select = [...new Set([...DEAL_SELECT, ...extraSelect])];
  return listBitrixPaged<BitrixDeal>("crm.deal.list", filter, select);
}

export async function listBitrixContactsByIds(
  ids: string[],
  extraSelect: string[] = [],
): Promise<BitrixContact[]> {
  const select = [...new Set(["ID", "NAME", "LAST_NAME", "PHONE", "EMAIL", ...extraSelect])];
  const results: BitrixContact[] = [];
  const uniqueIds = [...new Set(ids.filter(Boolean))];

  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    const batch = await listBitrixPaged<BitrixContact>(
      "crm.contact.list",
      { "@ID": chunk },
      select,
    );
    results.push(...batch);
    if (i + 50 < uniqueIds.length) await sleep(250);
  }

  return results;
}

export async function listAllWonDeals(
  salesStageIds: string[],
  extraSelect: string[] = [],
): Promise<BitrixDeal[]> {
  if (salesStageIds.length === 1) {
    return listBitrixDeals({ STAGE_ID: salesStageIds[0] }, extraSelect);
  }

  const deals: BitrixDeal[] = [];
  for (const stageId of salesStageIds) {
    deals.push(...(await listBitrixDeals({ STAGE_ID: stageId }, extraSelect)));
    await sleep(200);
  }
  return deals;
}

export async function listBitrixStatusLabels(
  entityId: "STATUS" | "SOURCE" | "DEAL_STAGE",
): Promise<Map<string, string>> {
  const response = await bitrixCall("crm.status.list", {
    filter: { ENTITY_ID: entityId },
  });
  const rows = (response.result as Array<{ STATUS_ID?: string; NAME?: string }> | undefined) ?? [];
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.STATUS_ID) map.set(row.STATUS_ID, row.NAME ?? row.STATUS_ID);
  }
  return map;
}

export async function resolveBitrixUserNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.map((id) => id.trim()).filter((id) => id && id !== "0"))];
  if (!unique.length) return map;

  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50).map((id) => Number.parseInt(id, 10)).filter(Number.isFinite);
    if (!chunk.length) continue;

    try {
      const response = await bitrixCall("im.user.list.get", { ID: chunk });
      const bucket = (response.result as Record<string, { name?: string; first_name?: string; last_name?: string }>) ?? {};
      for (const [id, user] of Object.entries(bucket)) {
        const name =
          user.name?.trim() ||
          [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
          id;
        map.set(String(id), name);
      }
    } catch (error) {
      logger.warn("im.user.list.get failed", {
        error: error instanceof Error ? error.message : String(error),
        chunkSize: chunk.length,
      });
    }

    if (i + 50 < unique.length) await sleep(200);
  }

  const missing = unique.filter((id) => !map.has(id));
  for (let i = 0; i < missing.length; i += 1) {
    const id = missing[i]!;
    try {
      const response = await bitrixCall("user.get", { ID: Number.parseInt(id, 10) });
      const batch = (response.result as Array<{ ID?: string; NAME?: string; LAST_NAME?: string }> | undefined) ?? [];
      const user = batch[0];
      if (user?.ID) {
        map.set(String(user.ID), [user.NAME, user.LAST_NAME].filter(Boolean).join(" ").trim() || String(user.ID));
      }
    } catch (error) {
      logger.warn("user.get by ID failed", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (i + 1 < missing.length) await sleep(120);
  }

  for (const id of unique) {
    if (!map.has(id)) map.set(id, id);
  }

  return map;
}

/** @deprecated Inbound webhooks cannot call user.get — use resolveBitrixUserNames */
export async function listBitrixUsers(): Promise<Map<string, string>> {
  try {
    const map = new Map<string, string>();
    let start = 0;
    while (true) {
      const response = await bitrixCall("user.get", {
        ACTIVE: true,
        start,
      });
      const batch = (response.result as Array<{ ID?: string; NAME?: string; LAST_NAME?: string }> | undefined) ?? [];
      for (const user of batch) {
        const id = String(user.ID ?? "");
        if (!id) continue;
        map.set(id, [user.NAME, user.LAST_NAME].filter(Boolean).join(" ").trim() || id);
      }
      const total = Number(response.total ?? 0);
      start += batch.length;
      if (!batch.length || start >= total) break;
      await sleep(200);
    }
    return map;
  } catch (error) {
    logger.warn("user.get недоступен — используем im.user.list.get по ID", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
