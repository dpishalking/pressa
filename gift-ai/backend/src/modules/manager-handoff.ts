import { defaultNameForExternalId } from "./product-catalog.js";
import type { BotLanguage } from "./languages.js";
import type { QualificationFields } from "../types/index.js";

export const MANAGER_TELEGRAM_USERNAME = "Retro_Pressa";

export type ManagerHandoff = {
  url: string;
  buttonLabel: string;
  prompt: string;
  draftMessage: string;
};

const PRODUCT_OPENING: Partial<Record<string, Partial<Record<BotLanguage, string>>>> = {
  "newspaper-from-date": {
    ru: "Здравствуйте! Хочу заказать оригинальную газету со дня рождения",
    en: "Hello! I'd like to order an original newspaper from a birth date",
  },
  "life-book": {
    ru: "Здравствуйте! Хочу заказать книгу жизни",
    en: "Hello! I'd like to order a book of life",
  },
  "personal-newspaper": {
    ru: "Здравствуйте! Хочу заказать персональную газету о человеке",
    en: "Hello! I'd like to order a personal newspaper about someone",
  },
  "glossy-magazine": {
    ru: "Здравствуйте! Хочу заказать именной глянцевый журнал",
    en: "Hello! I'd like to order a personalized glossy magazine",
  },
  "memory-book": {
    ru: "Здравствуйте! Хочу заказать книгу воспоминаний",
    en: "Hello! I'd like to order a memory book",
  },
  "discovery-passport": {
    ru: "Здравствуйте! Хочу заказать Паспорт Открытий",
    en: "Hello! I'd like to order a Passport of Discoveries",
  },
  "joke-passport": {
    ru: "Здравствуйте! Хочу заказать шуточный паспорт (18+)",
    en: "Hello! I'd like to order a joke passport (18+)",
  },
  "family-subscription": {
    ru: "Здравствуйте! Хочу оформить семейную газету по подписке",
    en: "Hello! I'd like to set up a family newspaper subscription",
  },
};

const LABELS: Record<BotLanguage, Record<string, string>> = {
  ru: {
    occasion: "Повод",
    recipient: "Кому",
    date: "Нужен к",
    city: "Город доставки",
    budget: "Бюджет",
    details: "Детали",
    telegram: "Мой Telegram",
    fallbackGift: "Здравствуйте! Хочу заказать",
    button: "✉️ Написать менеджеру",
    prompt: "☎️ Нажмите кнопку ниже — откроется чат с менеджером, текст заявки уже будет готов.",
  },
  en: {
    occasion: "Occasion",
    recipient: "Recipient",
    date: "Needed by",
    city: "Delivery city",
    budget: "Budget",
    details: "Details",
    telegram: "My Telegram",
    fallbackGift: "Hello! I'd like to order",
    button: "✉️ Message our manager",
    prompt: "☎️ Tap the button below — a chat with our manager will open with your request pre-filled.",
  },
  lv: {
    occasion: "Iemesls",
    recipient: "Kam",
    date: "Vajag līdz",
    city: "Piegādes pilsēta",
    budget: "Budžets",
    details: "Detaļas",
    telegram: "Mans Telegram",
    fallbackGift: "Sveiki! Vēlos pasūtīt",
    button: "✉️ Rakstīt menedžerim",
    prompt: "☎️ Nospiediet pogu — atvērsies čats ar menedžeri ar sagatavotu ziņu.",
  },
  et: {
    occasion: "Põhjus",
    recipient: "Kellele",
    date: "Vaja kuupäevaks",
    city: "Tarne linn",
    budget: "Eelarve",
    details: "Detailid",
    telegram: "Minu Telegram",
    fallbackGift: "Tere! Soovin tellida",
    button: "✉️ Kirjuta haldurile",
    prompt: "☎️ Vajutage nuppu — avaneb vestlus halduriga koos ettevalmistatud sõnumiga.",
  },
  lt: {
    occasion: "Proga",
    recipient: "Kam",
    date: "Reikia iki",
    city: "Pristatymo miestas",
    budget: "Biudžetas",
    details: "Detalės",
    telegram: "Mano Telegram",
    fallbackGift: "Sveiki! Noriu užsakyti",
    button: "✉️ Rašyti vadybininkui",
    prompt: "☎️ Paspauskite mygtuką — atsidarys pokalbis su vadybininku ir paruoštu tekstu.",
  },
};

function line(label: string, value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return `${label}: ${v}`;
}

function giftExternalId(fields: QualificationFields): string {
  return fields.recommendedGiftId?.trim() || "";
}

function giftName(fields: QualificationFields): string {
  const fromFields = fields.recommendedGiftName?.trim() || fields.catalogGiftInterest?.trim();
  if (fromFields) return fromFields;
  const id = giftExternalId(fields);
  return (id && defaultNameForExternalId(id)) || "подарок Retro Pressa";
}

function openingLine(fields: QualificationFields, lang: BotLanguage): string {
  const id = giftExternalId(fields);
  const localized = id ? PRODUCT_OPENING[id]?.[lang] ?? PRODUCT_OPENING[id]?.ru : undefined;
  if (localized) return localized;
  const L = LABELS[lang] ?? LABELS.ru;
  return `${L.fallbackGift} «${giftName(fields)}»`;
}

function detailsBlock(fields: QualificationFields): string {
  const parts = [
    fields.desiredEmotions,
    fields.interests,
    fields.hobbies,
    fields.comments,
    fields.story,
  ]
    .map((p) => p?.trim())
    .filter(Boolean);
  return [...new Set(parts)].join("; ");
}

export function buildManagerDraftMessage(fields: QualificationFields, lang: BotLanguage): string {
  const L = LABELS[lang] ?? LABELS.ru;
  const recipient = [fields.recipient, fields.relationship, fields.recipientAge && `${fields.recipientAge} лет`]
    .filter(Boolean)
    .join(", ")
    .replace(/,\s*$/, "");

  const lines = [
    openingLine(fields, lang),
    "",
    line(L.occasion, fields.occasion),
    line(L.recipient, recipient),
    line(L.date, fields.eventDate || fields.urgency),
    line(L.city, fields.city || fields.country),
    line(L.budget, fields.budget),
    line(L.details, detailsBlock(fields)),
    line(L.telegram, fields.telegram),
  ].filter(Boolean) as string[];

  return lines.join("\n").slice(0, 3500);
}

export function buildManagerHandoff(fields: QualificationFields, lang: BotLanguage): ManagerHandoff {
  const L = LABELS[lang] ?? LABELS.ru;
  const draftMessage = buildManagerDraftMessage(fields, lang);
  const url = `https://t.me/${MANAGER_TELEGRAM_USERNAME}?text=${encodeURIComponent(draftMessage)}`;
  return {
    url,
    buttonLabel: L.button,
    prompt: L.prompt,
    draftMessage,
  };
}

export function hasHandoffBasics(fields: QualificationFields): boolean {
  const hasRecipient = Boolean(fields.recipient?.trim() || fields.relationship?.trim());
  const hasTiming = Boolean(fields.eventDate?.trim() || fields.urgency?.trim());
  const hasGift = Boolean(
    fields.recommendedGiftName?.trim() ||
      fields.recommendedGiftId?.trim() ||
      fields.catalogGiftInterest?.trim(),
  );
  return Boolean(fields.occasion?.trim() && hasRecipient && fields.budget?.trim() && hasTiming && hasGift);
}

/** Убирает просьбу оставить телефон из ответа модели перед handoff. */
export function stripPhoneCollectionAsk(reply: string): string {
  return reply
    .replace(/\n{2,}☎️[^\n]*(?:\n[^\n]*)*$/i, "")
    .replace(/\n{2,}[^\n]*(?:телефон|номер|phone)[^\n]*\?[^\n]*$/i, "")
    .replace(/Оставьте[^?]*\?/gi, "")
    .trim();
}
