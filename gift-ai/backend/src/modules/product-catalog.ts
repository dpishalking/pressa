/**
 * Канонические ID продуктов = имена файлов фото в telegram-bot/assets/gifts/<id>.jpg
 * Тексты подтягиваются из Google Sheets, фото — из репозитория.
 */
export type CanonicalProduct = {
  externalId: string;
  defaultName: string;
  aliases: string[];
};

export const CANONICAL_PRODUCTS: CanonicalProduct[] = [
  {
    externalId: "newspaper-from-date",
    defaultName: "Оригинал газеты со дня рождения",
    aliases: [
      "оригинал газеты со дня рождения",
      "газета из дня рождения",
      "издание из важной даты",
      "газета из дня рождения / издание из важной даты",
      "оригинальная газета",
      "orģināla avīze",
    ],
  },
  {
    externalId: "life-book",
    defaultName: "Книга жизни в заголовках газет",
    aliases: [
      "книга жизни",
      "книга жизни в заголовках газет",
      "книга жизни / книга жизни в заголовках газет",
      "dzīves grāmata avīžu virsrakstos",
    ],
  },
  {
    externalId: "personal-newspaper",
    defaultName: "Персональная газета о человеке",
    aliases: [
      "персонализированная газета partypagee",
      "персональная газета о человеке",
      "персонализированная газета",
      "partypagee",
      "поздравительная газета",
      "apsveikuma avīze",
      "персонализированная газета - 8 страницы",
      "персонализированная газета - 4 страницы",
      "персонализированная газета - 12 страниц",
    ],
  },
  {
    externalId: "glossy-magazine",
    defaultName: "Именной глянцевый журнал",
    aliases: [
      "глянцевый журнал о человеке",
      "именной глянцевый журнал",
      "глянцевый журнал",
      "оригинальный журнал",
      "oriģināls žurnāls",
      "поздравительный журнал (остаток)",
      "поздравительный журнал (аванс)",
      "apsveikuma žurnāls (atlikums)",
      "apsveikuma žurnāls (avanss)",
    ],
  },
  {
    externalId: "memory-book",
    defaultName: "Книга воспоминаний",
    aliases: ["книга воспоминаний"],
  },
  {
    externalId: "discovery-passport",
    defaultName: "Паспорт Открытий",
    aliases: ["паспорт открытий"],
  },
  {
    externalId: "joke-passport",
    defaultName: "Паспорт Алкоголика (18+)",
    aliases: ["паспорт алкоголика", "паспорт алкоголика (18+)"],
  },
  {
    externalId: "family-subscription",
    defaultName: "Семейная газета по подписке",
    aliases: ["подписка", "семейная газета по подписке", "семейная газета"],
  },
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^продукт:\s*/i, "")
    .replace(/\s*-\s*$/g, "")
    .trim();
}

export function resolveProductExternalId(name: string): string {
  const n = norm(name);
  if (!n) return "";

  for (const p of CANONICAL_PRODUCTS) {
    if (norm(p.defaultName) === n) return p.externalId;
    for (const alias of p.aliases) {
      if (norm(alias) === n) return p.externalId;
    }
  }

  for (const p of CANONICAL_PRODUCTS) {
    for (const alias of [p.defaultName, ...p.aliases]) {
      const a = norm(alias);
      if (a.length > 8 && (n.includes(a) || a.includes(n))) return p.externalId;
    }
  }

  return "";
}

export function canonicalExternalIds(): string[] {
  return CANONICAL_PRODUCTS.map((p) => p.externalId);
}

export function defaultNameForExternalId(externalId: string): string | null {
  return CANONICAL_PRODUCTS.find((p) => p.externalId === externalId)?.defaultName ?? null;
}

export const NO_PRODUCT_LABEL = "Без товара";

/** Имя подарка для сводки: каноническое из каталога или как в CRM */
export function displayProductName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return NO_PRODUCT_LABEL;
  const id = resolveProductExternalId(trimmed);
  if (id) return defaultNameForExternalId(id) ?? trimmed;
  return trimmed;
}
