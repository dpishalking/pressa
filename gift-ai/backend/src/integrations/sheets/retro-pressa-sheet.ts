import { parseCsv } from "./csv.js";
import type { SheetGiftRow } from "../../types/index.js";

const EMOTION_WORDS = [
  "удивление",
  "ностальгия",
  "любовь",
  "гордость",
  "уважение",
  "благодарность",
  "вдохновение",
  "радость",
  "слёзы счастья",
  "слезы счастья",
  "вау",
  "теплота",
  "счастье",
];

const AUDIENCE_WORDS = [
  "папа",
  "папе",
  "мама",
  "маме",
  "дедушка",
  "дедушке",
  "бабушка",
  "бабушке",
  "жена",
  "жене",
  "муж",
  "мужу",
  "родители",
  "руководитель",
  "коллега",
  "учитель",
  "тренер",
  "друг",
  "юбиляр",
  "семья",
  "дети",
  "внуки",
];

const OCCASION_WORDS = [
  "день рождения",
  "юбилей",
  "годовщина",
  "свадьба",
  "новый год",
  "корпоратив",
  "выпускной",
];

import { resolveProductExternalId } from "../../modules/product-catalog.js";
import { buildEngagingCatalogDescription } from "../../modules/catalog-copy.js";

function pickKeywords(text: string, dict: string[]): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const w of dict) {
    if (lower.includes(w)) found.add(w);
  }
  return [...found];
}

const AUDIENCE_NORMALIZE: Record<string, string> = {
  папе: "папа",
  маме: "мама",
  дедушке: "дедушка",
  бабушке: "бабушка",
  жене: "жена",
  мужу: "муж",
};

function normalizeAudience(list: string[]): string[] {
  return [...new Set(list.map((w) => AUDIENCE_NORMALIZE[w] ?? w))];
}

function isHeaderRow(row: string[]): boolean {
  const joined = row.join(" ").toLowerCase();
  return joined.includes("простыми словами") || joined.includes("короткое название");
}

function parseProductName(cell: string): string {
  return cell
    .replace(/^Продукт:\s*/i, "")
    .replace(/\s*-\s*$/, "")
    .split("/")[0]
    .trim();
}

function buildDescription(parts: {
  simple?: string;
  idea?: string;
  pain?: string;
  forWho?: string;
}): string {
  return buildEngagingCatalogDescription(parts);
}

export function isRetroPressaSheet(csvText: string): boolean {
  return /^Продукт:/m.test(csvText) || csvText.includes("Что это такое простыми словами");
}

export function parseRetroPressaSheet(csvText: string): SheetGiftRow[] {
  const rows = parseCsv(csvText);
  const gifts: SheetGiftRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const col0 = (rows[i][0] ?? "").trim();
    if (!/^Продукт:/i.test(col0)) continue;

    let name = parseProductName(col0);
    const headerName = name;
    let dataRow = rows[i];
    const hasInlineData = Boolean((rows[i][1] ?? "").trim().length > 40);

    if (!hasInlineData) {
      if (
        i + 2 < rows.length &&
        isHeaderRow(rows[i + 1]) &&
        /^Продукт:/i.test(rows[i + 2][0] ?? "")
      ) {
        continue;
      }
      let j = i + 1;
      while (j < rows.length && isHeaderRow(rows[j])) j++;
      if (j < rows.length && (rows[j][1] ?? "").trim()) {
        dataRow = rows[j];
      }
      name = headerName;
    }

    if (!name || name.length < 3) continue;

    const simple = (dataRow[1] ?? "").trim();
    const forWho = (dataRow[2] ?? "").trim();
    const pain = (dataRow[3] ?? "").trim();
    const idea = (dataRow[4] ?? "").trim();
    const whyNow = (dataRow[5] ?? "").trim();
    const howItWorks = (dataRow[6] ?? "").trim();
    const benefits = (dataRow[7] ?? "").trim();

    if (!simple && !forWho && !idea) continue;

    const fullText = [simple, forWho, pain, idea, whyNow, howItWorks, benefits].join(" ");
    const externalId = resolveProductExternalId(name) || resolveProductExternalId(headerName) || "";
    if (!externalId) continue;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    gifts.push({
      externalId,
      name,
      description: buildDescription({
        simple,
        idea,
        forWho,
      }),
      priceMin: 0,
      priceMax: 0,
      emotions: pickKeywords(fullText, EMOTION_WORDS),
      suitableFor: normalizeAudience(pickKeywords(forWho || fullText, AUDIENCE_WORDS)),
      occasions: pickKeywords(fullText, OCCASION_WORDS),
      leadTimeDays: 14,
      personalization: howItWorks.slice(0, 500),
      photoUrl: "",
      cases: benefits.slice(0, 1000),
      reviews: "",
      active: true,
    });
  }

  return gifts;
}
