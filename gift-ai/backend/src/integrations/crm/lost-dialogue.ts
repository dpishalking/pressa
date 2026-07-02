import type { ParsedChatMessage } from "./bitrix-openlines.js";
import type { OpenLineSession } from "./bitrix-openlines.js";

export type LostDialogueRow = {
  sessionId: string;
  channel: string;
  clientLabel: string;
  dealId: string;
  leadId: string;
  phone: string;
  managerName: string;
  waitingHours: number;
  dateMention: string;
  lastClientMessage: string;
};

const DATE_PATTERNS = [
  /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/,
  /\b\d{1,2}\s+(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)\w*\s*(?:\d{4})?\b/i,
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,?\s+\d{4})?\b/i,
  /\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i,
  /\b(?:19|20)\d{2}\s*(?:г\.?|year)?\b/i,
  /\b(?:др|день рождения|birthday)\s*[:\s]?\s*\d/i,
  /\b\d{1,2}\s+(?:July|June|January|February|March|April|August|September|October|November|December)\s+\d{4}\b/i,
];

const ORDER_KEYWORDS = [
  "газет",
  "journal",
  "magazine",
  "журнал",
  "подар",
  "gift",
  "заказ",
  "order",
  "репр",
  "reproduc",
  "original",
  "издан",
  "retro",
  "pressa",
  "правda",
  "правда",
  "pravda",
  "prawda",
  "commemor",
  "annivers",
  "день рожд",
  "birthday",
  "выпуск",
  "номер",
  "newspaper",
  "postcard",
  "открытк",
  "книг",
  " book",
  "pumiti",
  "пумити",
  "достав",
  "shipping",
  "deliver",
  "стоим",
  "price",
  "цен",
  "€",
  "eur",
  "руб",
  "оплат",
  "сколько",
  "how much",
  "можно подар",
  "хочу",
  "want",
  "need",
  "ищу",
  "looking for",
  "есть ли",
  "do you have",
  "retropressa",
  "www.",
  "http",
];

const ACK_ONLY_PATTERNS = [
  /^[\d\s👍❤️🔥😍🙂]+$/,
  /^(?:ok|okay|да|yes|спасибо|thanks|thank you|благодар|merci|dziękuję)[!.?\s]*$/i,
  /^(?:hi|hello|hey|привет|здравствуйте|добрый день|добрый вечер|доброе утро)[!.?\s]*$/i,
];

const QUESTION_START =
  /^(?:как|сколько|где|когда|почему|зачем|можно|можете|есть ли|что|какой|какая|какие|which|what|where|when|why|how|can you|could you|do you|is it|are there|would you|please tell|подскаж|уточн|интересует|скажите|tell me)/i;

/** После этого часа (МСК) «потерянность» считается с утра следующего дня. */
export const LOST_DIALOGUE_EVENING_CUTOFF_HOUR = 21;
/** С какого часа (МСК) следующего дня начинаем отсчёт для вечерних сообщений. */
export const LOST_DIALOGUE_MORNING_START_HOUR = 10;

const STATS_TIMEZONE = process.env.STATS_TIMEZONE ?? "Europe/Moscow";

function moscowDateParts(iso: string): { year: number; month: number; day: number; hour: number } {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: STATS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: pick("year"), month: pick("month"), day: pick("day"), hour: pick("hour") };
}

/** 10:00 МСК в указанный календарный день. */
function moscowWallClockMs(year: number, month: number, day: number, hour: number): number {
  // Москва UTC+3 круглый год
  return Date.UTC(year, month - 1, day, hour - 3, 0, 0);
}

/** Часы ожидания с учётом вечернего grace period (сообщения после 21:00 МСК). */
export function lostDialogueWaitingHours(lastClientAt: string, nowMs = Date.now()): number {
  const { year, month, day, hour } = moscowDateParts(lastClientAt);
  let countFromMs = Date.parse(lastClientAt);

  if (hour >= LOST_DIALOGUE_EVENING_CUTOFF_HOUR) {
    const nextDayAnchor = new Date(Date.UTC(year, month - 1, day + 1));
    const nextParts = moscowDateParts(nextDayAnchor.toISOString());
    countFromMs = moscowWallClockMs(
      nextParts.year,
      nextParts.month,
      nextParts.day,
      LOST_DIALOGUE_MORNING_START_HOUR,
    );
  }

  if (nowMs < countFromMs) return 0;
  return Math.max(0, Math.round((nowMs - countFromMs) / 3_600_000));
}

export function isInstagramPostCommentSession(stats: { instagramPostComment?: boolean }): boolean {
  return Boolean(stats.instagramPostComment);
}

function normalize(text: string): string {
  return text.replace(/[\u3164\u200b\uFEFF]/g, " ").replace(/\s+/g, " ").trim();
}

function isPassiveThanksOrClosing(text: string): boolean {
  const n = normalize(text).toLowerCase();
  if (!n || /\?/.test(n)) return false;

  if (/(?:^|[\s,.!])нет(?:[\s,.!]|$)/.test(n) && /(?:благодар|спасибо)/.test(n)) return true;
  if (/(?:благодар|спасибо)/.test(n) && /(?:ожидаю|жду)\s+(?:обратн|ответ|информац|трек|доставк|звон)/.test(n)) {
    return true;
  }

  // «Спасибо, буду ждать» — клиент подтвердил ожидание, ответ не требуется
  if (
    /(?:благодар|спасибо|thanks)/.test(n) &&
    /(?:буду\s+)?(?:жду|ждать|ожидаю)/.test(n) &&
    !/(?:ответ|обратн|когда|сколько|звон|информац|связ)/.test(n)
  ) {
    return true;
  }

  // «Спасибо, дорого / извините» — вежливый отказ
  if (
    /(?:благодар|спасибо|thanks)/.test(n) &&
    /(?:дорог|не\s+(?:буду|нужно|интерес|подходит|актуальн)|передумал|откаж|извините|sorry)/.test(n)
  ) {
    return true;
  }

  const stripped = n.replace(/[\s🙏🙌👍❤️😊🙂]+/g, " ").trim();
  return /^(?:благодар\w*|спасибо|thanks(?:\s+you)?|merci|dziękuję)[!.?\s]*$/.test(stripped);
}

export function extractDateMention(texts: string[]): string | null {
  const combined = texts.map(normalize).filter(Boolean).join(" ");
  if (!combined) return null;

  for (const pattern of DATE_PATTERNS) {
    const match = combined.match(pattern);
    if (match) return match[0].trim();
  }
  return null;
}

export function isOrderRelatedConversation(clientTexts: string[]): boolean {
  const combined = clientTexts.map(normalize).join(" ").toLowerCase();
  if (!combined) return false;
  return ORDER_KEYWORDS.some((kw) => combined.includes(kw.toLowerCase()));
}

/** Последнее сообщение клиента требует ответа менеджера (вопрос / заявка), а не «спасибо» или «привет». */
export function clientMessageNeedsManagerResponse(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized || normalized.length < 4) return false;
  if (ACK_ONLY_PATTERNS.some((p) => p.test(normalized))) return false;
  if (isPassiveThanksOrClosing(normalized)) return false;
  if (/\?/.test(normalized)) return true;
  if (QUESTION_START.test(normalized)) return true;
  if (isOrderRelatedConversation([normalized])) return true;
  return normalized.length >= 20;
}

/**
 * Потерянный диалог = клиент написал последним, менеджер не ответил, прошло ≥ minWaitingHours.
 * Не включает случаи, когда клиент не отвечает на сообщение менеджера.
 */
export function isLostDialogue(opts: {
  clientMessages: ParsedChatMessage[];
  managerMessages: ParsedChatMessage[];
  minWaitingHours: number;
  instagramPostComment?: boolean;
}): { lost: boolean; dateMention: string | null; lastClientMessage: string | null; waitingHours: number } {
  const lastClient = opts.clientMessages.at(-1);
  const lastManager = opts.managerMessages.at(-1);

  if (opts.instagramPostComment) {
    return { lost: false, dateMention: null, lastClientMessage: lastClient?.text ?? null, waitingHours: 0 };
  }

  const clientWaiting =
    Boolean(lastClient) && (!lastManager || lastClient!.date > lastManager.date);

  if (!clientWaiting || !lastClient) {
    return { lost: false, dateMention: null, lastClientMessage: null, waitingHours: 0 };
  }

  const waitingHours = lostDialogueWaitingHours(lastClient.date);

  if (waitingHours < opts.minWaitingHours) {
    return { lost: false, dateMention: null, lastClientMessage: lastClient.text, waitingHours };
  }

  if (!clientMessageNeedsManagerResponse(lastClient.text)) {
    return { lost: false, dateMention: null, lastClientMessage: lastClient.text, waitingHours };
  }

  const clientTexts = opts.clientMessages.map((m) => m.text).filter(Boolean);
  const dateMention = extractDateMention(clientTexts);

  return {
    lost: true,
    dateMention,
    lastClientMessage: lastClient.text,
    waitingHours,
  };
}

export function buildLostDialogueRow(
  session: OpenLineSession,
  stats: { messages: ParsedChatMessage[]; instagramPostComment?: boolean },
  managerName: string,
  minWaitingHours: number,
): LostDialogueRow | null {
  const clientMessages = stats.messages.filter((m) => m.author === "client");
  const managerMessages = stats.messages.filter((m) => m.author === "manager");

  const check = isLostDialogue({
    clientMessages,
    managerMessages,
    minWaitingHours,
    instagramPostComment: stats.instagramPostComment,
  });
  if (!check.lost || !check.lastClientMessage) return null;

  return {
    sessionId: session.sessionId,
    channel: session.channel,
    clientLabel: session.clientLabel,
    dealId: "",
    leadId: "",
    phone: "",
    managerName,
    waitingHours: check.waitingHours,
    dateMention: check.dateMention ?? "",
    lastClientMessage: check.lastClientMessage.slice(0, 200),
  };
}
