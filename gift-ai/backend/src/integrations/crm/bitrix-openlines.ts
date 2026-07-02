import { bitrixCall } from "./bitrix-client.js";
import type { ExportDateRange } from "../analytics/date-ranges.js";

export type OpenLineSession = {
  activityId: string;
  sessionId: string;
  subject: string;
  channel: string;
  clientLabel: string;
  created: string;
  ownerTypeId: string;
  ownerId: string;
  responsibleId: string;
  completed: boolean;
};

export type ChatAuthor = "system" | "client" | "manager";

export type ParsedChatMessage = {
  id: string;
  date: string;
  senderId: string;
  author: ChatAuthor;
  text: string;
};

export type SessionChatStats = {
  session: OpenLineSession;
  messages: ParsedChatMessage[];
  totalCount: number;
  clientCount: number;
  managerCount: number;
  systemCount: number;
  firstClientAt?: string;
  firstResponseMinutes?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSubject(subject: string): { clientLabel: string; channel: string } {
  const match = subject.match(/Open Channel chat:\s*"(.+)"\s*\((.+)\)\s*$/i);
  if (match) return { clientLabel: match[1].trim(), channel: match[2].trim() };
  const channelMatch = subject.match(/\(([^)]+)\)\s*$/);
  return {
    clientLabel: subject.replace(/^Open Channel chat:\s*/i, "").trim(),
    channel: channelMatch?.[1]?.trim() ?? "unknown",
  };
}

export async function listOpenLineSessions(range: ExportDateRange): Promise<OpenLineSession[]> {
  const items: OpenLineSession[] = [];
  let start = 0;

  while (true) {
    const response = await bitrixCall("crm.activity.list", {
      filter: {
        PROVIDER_ID: "IMOPENLINES_SESSION",
        ">=CREATED": range.from,
        "<CREATED": range.to,
      },
      select: [
        "ID",
        "SUBJECT",
        "CREATED",
        "ASSOCIATED_ENTITY_ID",
        "OWNER_TYPE_ID",
        "OWNER_ID",
        "RESPONSIBLE_ID",
        "COMPLETED",
      ],
      order: { CREATED: "ASC" },
      start,
    });

    const batch = (response.result as Array<Record<string, string>> | undefined) ?? [];
    for (const row of batch) {
      const sessionId = String(row.ASSOCIATED_ENTITY_ID ?? "").trim();
      if (!sessionId) continue;
      const subject = row.SUBJECT ?? "";
      const { clientLabel, channel } = parseSubject(subject);
      items.push({
        activityId: String(row.ID),
        sessionId,
        subject,
        channel,
        clientLabel,
        created: row.CREATED ?? "",
        ownerTypeId: String(row.OWNER_TYPE_ID ?? ""),
        ownerId: String(row.OWNER_ID ?? ""),
        responsibleId: String(row.RESPONSIBLE_ID ?? ""),
        completed: String(row.COMPLETED ?? "").toUpperCase() === "Y",
      });
    }

    const total = Number(response.total ?? 0);
    start += batch.length;
    if (!batch.length || start >= total) break;
    await sleep(250);
  }

  return items;
}

function activityToSession(row: Record<string, string>): OpenLineSession {
  const subject = row.SUBJECT ?? "";
  const { clientLabel, channel } = parseSubject(subject);
  return {
    activityId: String(row.ID),
    sessionId: String(row.ASSOCIATED_ENTITY_ID ?? ""),
    subject,
    channel,
    clientLabel,
    created: row.CREATED ?? "",
    ownerTypeId: String(row.OWNER_TYPE_ID ?? ""),
    ownerId: String(row.OWNER_ID ?? ""),
    responsibleId: String(row.RESPONSIBLE_ID ?? ""),
    completed: String(row.COMPLETED ?? "").toUpperCase() === "Y",
  };
}

export async function findLatestOpenLineSessionForOwners(
  owners: Array<{ ownerTypeId: string; ownerId: string }>,
): Promise<OpenLineSession | null> {
  for (const { ownerTypeId, ownerId } of owners) {
    if (!ownerId || ownerId === "0") continue;

    const response = await bitrixCall("crm.activity.list", {
      filter: {
        PROVIDER_ID: "IMOPENLINES_SESSION",
        OWNER_TYPE_ID: ownerTypeId,
        OWNER_ID: ownerId,
      },
      select: [
        "ID",
        "SUBJECT",
        "CREATED",
        "ASSOCIATED_ENTITY_ID",
        "OWNER_TYPE_ID",
        "OWNER_ID",
        "RESPONSIBLE_ID",
        "COMPLETED",
      ],
      order: { CREATED: "DESC" },
      start: 0,
    });

    const row = (response.result as Array<Record<string, string>> | undefined)?.[0];
    if (row?.ASSOCIATED_ENTITY_ID) return activityToSession(row);
  }
  return null;
}

export async function findOpenLineSessionBySessionId(sessionId: string): Promise<OpenLineSession | null> {
  const response = await bitrixCall("crm.activity.list", {
    filter: {
      PROVIDER_ID: "IMOPENLINES_SESSION",
      ASSOCIATED_ENTITY_ID: sessionId,
    },
    select: [
      "ID",
      "SUBJECT",
      "CREATED",
      "ASSOCIATED_ENTITY_ID",
      "OWNER_TYPE_ID",
      "OWNER_ID",
      "RESPONSIBLE_ID",
      "COMPLETED",
    ],
    order: { CREATED: "DESC" },
    start: 0,
  });

  const row = (response.result as Array<Record<string, string>> | undefined)?.[0];
  if (!row) return null;

  const session = activityToSession(row);
  if (!session.sessionId) session.sessionId = sessionId;
  return session;
}

function stripBbCode(text: string): string {
  return text
    .replace(/\[USER=\d+[^\]]*\]([^\[]*?)\[\/USER\]/gi, "$1")
    .replace(/\[URL=[^\]]*\]([^\[]*?)\[\/URL\]/gi, "$1")
    .replace(/\[\/(?:b|i|u|s)\]/gi, "")
    .replace(/\[(?:b|i|u|s)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripInvisibleChars(text: string): string {
  return text.replace(/[\u3164\u200b\uFEFF]/g, " ").replace(/\s+/g, " ").trim();
}

const MANAGER_OUTGOING_PATTERNS = [
  /я\s+менеджер\s+retro[- ]?pressa/i,
  /спасибо,\s*что\s+оставили\s+заявку/i,
  /с\s+удовольствием\s+поможем\s+подобрать/i,
  /скажите,\s*дата\s+указана\s+верно/i,
  /ваш\s+заказ\s+был\s+отправлен/i,
  /оплату\s+получили/i,
  /приступаем\s+к\s+обработке/i,
  /высылаю\s+реквизиты/i,
  /оплата\s+в\s+российских\s+рублях/i,
  /жду\s+ответ\s+от\s+офиса/i,
  /извините\s+за\s+долгий\s+ответ/i,
  /желаю\s+скорейшего\s+выздоровления/i,
  /как\s+только\s+заказ\s+будет\s+отправлен/i,
];

function looksLikeManagerOutgoing(text: string): boolean {
  const normalized = stripInvisibleChars(text).toLowerCase();
  if (!normalized) return false;
  return MANAGER_OUTGOING_PATTERNS.some((p) => p.test(normalized));
}

function stripWazzupEnvelope(text: string): { text: string; hintedAuthor?: ChatAuthor; systemOnly?: boolean } {
  if (/^===\s*SYSTEM\s+WZ\s*===/i.test(text.trim())) {
    return { text: text.trim(), systemOnly: true };
  }

  let cleaned = stripInvisibleChars(text.split(/===\s*SYSTEM\s+WZ\s*===/i)[0] ?? text);

  const embeddedOutgoing = cleaned.match(/^(.*?)===\s*Исходящее сообщение[^=]*===\s*(.*)$/is);
  if (embeddedOutgoing) {
    const body = stripInvisibleChars(embeddedOutgoing[2] ?? embeddedOutgoing[1] ?? "");
    return { text: body, hintedAuthor: "manager" };
  }

  const outgoing = cleaned.match(/^===\s*Исходящее сообщение[^=]*===\s*(.*)$/is);
  if (outgoing) return { text: stripInvisibleChars(outgoing[1]), hintedAuthor: "manager" };
  const incoming = cleaned.match(/^===\s*Входящее сообщение[^=]*===\s*(.*)$/is);
  if (incoming) return { text: stripInvisibleChars(incoming[1]), hintedAuthor: "client" };
  const outgoingEn = cleaned.match(/^===\s*Outgoing message[^=]*===\s*(.*)$/is);
  if (outgoingEn) return { text: stripInvisibleChars(outgoingEn[1]), hintedAuthor: "manager" };
  const incomingEn = cleaned.match(/^===\s*Incoming message[^=]*===\s*(.*)$/is);
  if (incomingEn) return { text: stripInvisibleChars(incomingEn[1]), hintedAuthor: "client" };

  if (looksLikeManagerOutgoing(cleaned)) {
    return { text: cleaned, hintedAuthor: "manager" };
  }

  return { text: cleaned };
}

function isNoiseMessage(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return true;
  if (text.startsWith(">>")) return true;
  if (normalized.includes("вам что-то прислали")) return true;
  if (normalized.includes("такой формат сообщений пока не поддерживается")) return true;
  return false;
}

function isSystemMessage(msg: Record<string, unknown>, text: string): boolean {
  const senderId = String(msg.senderid ?? msg.senderId ?? "");
  if (senderId === "0") return true;

  const params = msg.params as Record<string, unknown> | undefined;
  if (params?.componentId) return true;

  const normalized = text.toLowerCase();
  if (!normalized) return true;
  if (isNoiseMessage(text)) return true;

  const systemPatterns = [
    "conversation #",
    " started",
    "contact information saved",
    "contact was created",
    "new lead was created",
    "новый лид",
    "контактная информация",
    "контакт создан",
    "диалог заверш",
    "dialog finished",
    "перенаправлен",
    "перенаправлено",
    "направлено на",
    "направлено всем",
    "redirected to",
    "redirected",
    "transferred to",
    "transferred",
    "assigned to all",
    "assigned to",
    "пометил текущий диалог как спам",
    "пометила текущий диалог как спам",
    "marked the current dialog as spam",
    "обращение перенаправлено",
    "обращение направлено",
    "обращение также направлено",
    "enquiry transferred",
    "enquiry redirected",
    "enquiry assigned",
    "участников очереди",
    "по правилам очереди",
    "all agents in the queue",
    "according to queuing rules",
    "начал работу с диалогом",
    "начала работу с диалогом",
    "started working with the dialog",
    "диалог снят с оператора",
    "data received from open channel",
    "получены данные из открытой линии",
    "link to original post",
    "ссылка на исходный пост",
    "wazzup24.com",
    "=== system wz ===",
    "пропущенный звонок от клиента",
    "missed call from client",
    "сейчас этому клиенту нельзя отправить шаблон",
    "crm's responsible person",
    "ответственного в crm",
  ];
  return systemPatterns.some((p) => normalized.includes(p));
}

function classifyAuthor(
  msg: Record<string, unknown>,
  senderId: string,
  responsibleId: string,
  text: string,
  hinted?: ChatAuthor,
): ChatAuthor {
  if (hinted) return hinted;
  if (senderId === "0") return "system";

  const params = msg.params as Record<string, unknown> | undefined;
  if (!params?.connectorMid) return "manager";
  if (looksLikeManagerOutgoing(text)) return "manager";
  if (responsibleId && senderId === responsibleId) return "manager";
  return "client";
}

function parseHistoryMessages(
  raw: Record<string, unknown>,
  responsibleId: string,
): ParsedChatMessage[] {
  const bucket = raw.message as Record<string, Record<string, unknown>> | undefined;
  if (!bucket) return [];

  const parsed: ParsedChatMessage[] = [];
  for (const msg of Object.values(bucket)) {
    const senderId = String(msg.senderid ?? msg.senderId ?? "");
    const rawText = stripBbCode(String(msg.text ?? msg.textlegacy ?? ""));
    const { text, hintedAuthor, systemOnly } = stripWazzupEnvelope(rawText);
    const system = systemOnly || isSystemMessage(msg, text);
    const author: ChatAuthor = system ? "system" : classifyAuthor(msg, senderId, responsibleId, text, hintedAuthor);

    if (!text || author === "system" || isNoiseMessage(text)) continue;

    parsed.push({
      id: String(msg.id ?? ""),
      date: String(msg.date ?? ""),
      senderId,
      author,
      text,
    });
  }

  parsed.sort((a, b) => a.date.localeCompare(b.date));
  return parsed;
}

function minutesBetween(fromIso: string, toIso: string): number | undefined {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return undefined;
  return Math.round((to - from) / 60_000);
}

export function summarizeSessionChat(session: OpenLineSession, messages: ParsedChatMessage[]): SessionChatStats {
  const clientMessages = messages.filter((m) => m.author === "client" && m.text);
  const managerMessages = messages.filter((m) => m.author === "manager" && m.text);
  const systemCount = messages.filter((m) => m.author === "system").length;

  const firstClient = clientMessages[0];
  const firstManagerAfterClient = firstClient
    ? managerMessages.find((m) => m.date >= firstClient.date)
    : managerMessages[0];

  return {
    session,
    messages,
    totalCount: messages.filter((m) => m.text).length,
    clientCount: clientMessages.length,
    managerCount: managerMessages.length,
    systemCount,
    firstClientAt: firstClient?.date,
    firstResponseMinutes:
      firstClient && firstManagerAfterClient
        ? minutesBetween(firstClient.date, firstManagerAfterClient.date)
        : undefined,
  };
}

export async function fetchSessionChat(session: OpenLineSession): Promise<SessionChatStats> {
  const response = await bitrixCall("imopenlines.session.history.get", {
    SESSION_ID: session.sessionId,
  });
  const messages = parseHistoryMessages((response.result as Record<string, unknown>) ?? {}, session.responsibleId);
  return summarizeSessionChat(session, messages);
}

export async function collectSessionChats(opts: {
  range: ExportDateRange;
  limit?: number;
  onProgress?: (done: number, total: number, sessionId: string) => void;
}): Promise<SessionChatStats[]> {
  const sessions = await listOpenLineSessions(opts.range);
  const slice = opts.limit ? sessions.slice(0, opts.limit) : sessions;
  const results: SessionChatStats[] = [];

  for (let i = 0; i < slice.length; i++) {
    const session = slice[i]!;
    results.push(await fetchSessionChat(session));
    opts.onProgress?.(i + 1, slice.length, session.sessionId);
    if (i + 1 < slice.length) await sleep(120);
  }

  return results;
}
