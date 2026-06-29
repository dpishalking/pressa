import { parseCsv } from "./csv.js";
import { isRetroPressaSheet, parseRetroPressaSheet } from "./retro-pressa-sheet.js";
import { logger } from "../../logger.js";
import { knowledgeBase } from "../../modules/knowledge-base.js";
import type { SheetGiftRow } from "../../types/index.js";

export type { SheetGiftRow };

const HEADER_MAP: Record<string, keyof SheetGiftRow | "skip"> = {
  id: "externalId",
  артикул: "externalId",
  sku: "externalId",
  код: "externalId",
  название: "name",
  name: "name",
  подарок: "name",
  описание: "description",
  description: "description",
  цена_от: "priceMin",
  "цена от": "priceMin",
  price_min: "priceMin",
  pricemin: "priceMin",
  цена_до: "priceMax",
  "цена до": "priceMax",
  price_max: "priceMax",
  pricemax: "priceMax",
  цена: "priceMin",
  price: "priceMin",
  эмоции: "emotions",
  emotions: "emotions",
  кому: "suitableFor",
  "кому подходит": "suitableFor",
  suitable_for: "suitableFor",
  suitablefor: "suitableFor",
  аудитория: "suitableFor",
  поводы: "occasions",
  occasions: "occasions",
  повод: "occasions",
  срок: "leadTimeDays",
  "срок дней": "leadTimeDays",
  "срок изготовления": "leadTimeDays",
  lead_time: "leadTimeDays",
  lead_time_days: "leadTimeDays",
  leadtimedays: "leadTimeDays",
  персонализация: "personalization",
  personalization: "personalization",
  фото: "photoUrl",
  photo: "photoUrl",
  photo_url: "photoUrl",
  ссылка_на_фото: "photoUrl",
  кейсы: "cases",
  cases: "cases",
  отзывы: "reviews",
  reviews: "reviews",
  активен: "active",
  active: "active",
  включен: "active",
};

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,;|/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePriceRange(raw: string): { min: number; max: number } {
  const t = raw.trim();
  const range = t.match(/(\d[\d\s]*)\s*[-–—]\s*(\d[\d\s]*)/);
  if (range) {
    return {
      min: Number(range[1].replace(/\s/g, "")),
      max: Number(range[2].replace(/\s/g, "")),
    };
  }
  const n = Number(t.replace(/[^\d]/g, ""));
  return { min: n, max: n };
}

function parseActive(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (!t) return true;
  return ["1", "true", "yes", "да", "y", "+", "активен"].includes(t);
}

function rowToGift(headers: string[], cells: string[]): SheetGiftRow | null {
  const data: Partial<Record<keyof SheetGiftRow, string>> = {};

  headers.forEach((h, i) => {
    const key = HEADER_MAP[normHeader(h)];
    if (!key || key === "skip") return;
    const val = (cells[i] ?? "").trim();
    if (val) data[key] = val;
  });

  if (!data.name?.trim()) return null;

  const priceRaw = data.priceMin ?? "";
  const price = parsePriceRange(priceRaw);
  const priceMaxRaw = data.priceMax;
  const priceMax = priceMaxRaw ? Number(priceMaxRaw.replace(/[^\d]/g, "")) || price.max : price.max;

  return {
    externalId: (data.externalId ?? data.name).trim(),
    name: data.name.trim(),
    description: (data.description ?? "").trim(),
    priceMin: price.min,
    priceMax,
    emotions: splitList(data.emotions ?? ""),
    suitableFor: splitList(data.suitableFor ?? ""),
    occasions: splitList(data.occasions ?? ""),
    leadTimeDays: Number((data.leadTimeDays ?? "7").replace(/[^\d]/g, "")) || 7,
    personalization: (data.personalization ?? "").trim(),
    photoUrl: (data.photoUrl ?? "").trim(),
    cases: (data.cases ?? "").trim(),
    reviews: (data.reviews ?? "").trim(),
    active: parseActive(data.active ?? "да"),
  };
}

export function parseGiftsFromCsv(csvText: string): SheetGiftRow[] {
  if (isRetroPressaSheet(csvText)) {
    return parseRetroPressaSheet(csvText);
  }

  const rows = parseCsv(csvText.trim());
  if (rows.length < 2) return [];

  const headers = rows[0];
  const gifts: SheetGiftRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const gift = rowToGift(headers, rows[i]);
    if (gift) gifts.push(gift);
  }

  return gifts;
}

export async function fetchSheetCsv(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Не удалось загрузить таблицу: HTTP ${res.status}`);
  }
  const text = await res.text();
  if (text.includes("<!DOCTYPE html") || text.includes("<html")) {
    throw new Error("Таблица недоступна. Откройте доступ: «все, у кого есть ссылка» или опубликуйте лист в веб.");
  }
  return text;
}

export async function syncGiftsFromSheetUrl(url: string): Promise<{ imported: number; updated: number; total: number }> {
  const csv = await fetchSheetCsv(url);
  const rows = parseGiftsFromCsv(csv);
  if (!rows.length) {
    throw new Error("В таблице нет строк с подарками. Проверьте заголовки и первую строку.");
  }

  let imported = 0;
  let updated = 0;

  for (const row of rows) {
    const result = knowledgeBase.upsertFromSheet(row);
    if (result.created) imported++;
    else updated++;
  }

  logger.info("Sheet sync complete", { imported, updated, total: rows.length });
  return { imported, updated, total: rows.length };
}
