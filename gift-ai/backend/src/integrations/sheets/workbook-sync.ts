import { unzipSync, strFromU8 } from "fflate";
import { buildSheetExportUrl } from "./csv.js";
import { htmlTableToCsv, sheetSlugFromFilename } from "./html.js";
import { fetchSheetCsv, parseGiftsFromCsv } from "./sync.js";
import { logger } from "../../logger.js";
import { knowledgeBase } from "../../modules/knowledge-base.js";
import { canonicalExternalIds } from "../../modules/product-catalog.js";
import type { SheetGiftRow } from "../../types/index.js";

const CANONICAL = new Set(canonicalExternalIds());

function dedupeByExternalId(rows: SheetGiftRow[]): SheetGiftRow[] {
  const byId = new Map<string, SheetGiftRow>();
  for (const row of rows) {
    if (!CANONICAL.has(row.externalId)) continue;
    byId.set(row.externalId, row);
  }
  return [...byId.values()];
}

function finalizeCatalogSync(): void {
  const deactivated = knowledgeBase.deactivateNonCanonicalGifts();
  if (deactivated) {
    logger.info("Deactivated non-canonical catalog items", { deactivated });
  }
}

export function workbookZipUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=zip`;
}

export async function fetchWorkbookZip(sheetId: string): Promise<Uint8Array> {
  const res = await fetch(workbookZipUrl(sheetId), { redirect: "follow" });
  if (!res.ok) throw new Error(`Не удалось скачать таблицу (zip): HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error("Ответ не похож на ZIP. Проверьте доступ к таблице.");
  }
  return buf;
}

export function parseGiftsFromWorkbookZip(zipData: Uint8Array): { sheet: string; gifts: SheetGiftRow[] }[] {
  const files = unzipSync(zipData);
  const results: { sheet: string; gifts: SheetGiftRow[] }[] = [];

  for (const [filename, data] of Object.entries(files)) {
    if (!filename.endsWith(".html") || filename.includes("resources/")) continue;
    const html = strFromU8(data);
    const csv = htmlTableToCsv(html);
    const gifts = dedupeByExternalId(parseGiftsFromCsv(csv));
    if (gifts.length) {
      results.push({ sheet: sheetSlugFromFilename(filename), gifts });
    }
  }

  return results;
}

export async function syncGiftsFromWorkbook(sheetId: string): Promise<{
  imported: number;
  updated: number;
  total: number;
  sheets: string[];
}> {
  const zip = await fetchWorkbookZip(sheetId);
  const parsed = parseGiftsFromWorkbookZip(zip);
  if (!parsed.length) {
    throw new Error("В таблице не найдено листов с продуктами.");
  }

  let imported = 0;
  let updated = 0;
  let total = 0;

  for (const { sheet, gifts } of parsed) {
    for (const row of gifts) {
      const result = knowledgeBase.upsertFromSheet(row);
      if (result.created) imported++;
      else updated++;
      total++;
    }
    logger.info("Sheet tab synced", { sheet, count: gifts.length });
  }

  finalizeCatalogSync();

  return { imported, updated, total, sheets: parsed.map((p) => p.sheet) };
}

export async function syncGiftsFromGids(
  sheetId: string,
  gids: string[],
): Promise<{ imported: number; updated: number; total: number; sheets: string[] }> {
  let imported = 0;
  let updated = 0;
  let total = 0;
  const sheets: string[] = [];

  for (const gid of gids) {
    const url = buildSheetExportUrl(sheetId, gid);
    const csv = await fetchSheetCsv(url);
    const gifts = dedupeByExternalId(parseGiftsFromCsv(csv));
    if (!gifts.length) continue;
    sheets.push(`gid-${gid}`);
    for (const row of gifts) {
      const result = knowledgeBase.upsertFromSheet(row);
      if (result.created) imported++;
      else updated++;
      total++;
    }
  }

  if (!total) throw new Error("На указанных листах (gid) не найдено продуктов.");
  finalizeCatalogSync();
  return { imported, updated, total, sheets };
}

export async function syncGiftsFromConfig(opts: {
  sheetId?: string;
  gids?: string[];
  csvUrl?: string;
  csvUrls?: string[];
}): Promise<{ imported: number; updated: number; total: number; sheets: string[] }> {
  if (opts.sheetId && !opts.gids?.length) {
    return syncGiftsFromWorkbook(opts.sheetId);
  }
  if (opts.sheetId && opts.gids?.length) {
    return syncGiftsFromGids(opts.sheetId, opts.gids);
  }

  const urls = [...(opts.csvUrls ?? []), ...(opts.csvUrl ? [opts.csvUrl] : [])].filter(Boolean);
  if (!urls.length) {
    throw new Error("Не задан GOOGLE_SHEET_ID или GOOGLE_SHEET_CSV_URL");
  }

  let imported = 0;
  let updated = 0;
  let total = 0;
  const sheets: string[] = [];

  for (const url of urls) {
    const csv = await fetchSheetCsv(url);
    const gifts = dedupeByExternalId(parseGiftsFromCsv(csv));
    if (!gifts.length) continue;
    sheets.push(url.slice(-20));
    for (const row of gifts) {
      const result = knowledgeBase.upsertFromSheet(row);
      if (result.created) imported++;
      else updated++;
      total++;
    }
  }

  if (!total) throw new Error("В CSV не найдено продуктов.");
  finalizeCatalogSync();
  return { imported, updated, total, sheets };
}
