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
      });
    }

    const total = Number(response.total ?? 0);
    start += batch.length;
    if (!batch.length || start >= total) break;
    await sleep(250);
  }

  return items;
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
    ],
    order: { CREATED: "DESC" },
    start: 0,
  });

  const row = (response.result as Array<Record<string, string>> | undefined)?.[0];
  if (!row) return null;

  const subject = row.SUBJECT ?? "";
  const { clientLabel, channel } = parseSubject(subject);
  return {
    activityId: String(row.ID),
    sessionId: String(row.ASSOCIATED_ENTITY_ID ?? sessionId),
    subject,
    channel,
    clientLabel,
    created: row.CREATED ?? "",
    ownerTypeId: String(row.OWNER_TYPE_ID ?? ""),
    ownerId: String(row.OWNER_ID ?? ""),
    responsibleId: String(row.RESPONSIBLE_ID ?? ""),
  };
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

function stripWazzupEnvelope(text: string): { text: string; hintedAuthor?: ChatAuthor } {
  const embeddedOutgoing = text.match(/===\s*Исходящее сообщение[^=]*===\s*(.*)$/is);
  if (embeddedOutgoing) return { text: embeddedOutgoing[1].trim(), hintedAuthor: "manager" };

  const outgoing = text.match(/^===\s*Исходящее сообщение[^=]*===\s*(.*)$/is);
  if (outgoing) return { text: outgoing[1].trim(), hintedAuthor: "manager" };
  const incoming = text.match(/^===\s*Входящее сообщение[^=]*===\s*(.*)$/is);
  if (incoming) return { text: incoming[1].trim(), hintedAuthor: "client" };
  const outgoingEn = text.match(/^===\s*Outgoing message[^=]*===\s*(.*)$/is);
  if (outgoingEn) return { text: outgoingEn[1].trim(), hintedAuthor: "manager" };
  const incomingEn = text.match(/^===\s*Incoming message[^=]*===\s*(.*)$/is);
  if (incomingEn) return { text: incomingEn[1].trim(), hintedAuthor: "client" };
  return { text };
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
    "crm's responsible person",
    "ответственного в crm",
  ];
  return systemPatterns.some((p) => normalized.includes(p));
}

function classifyAuthor(
  msg: Record<string, unknown>,
  senderId: string,
  responsibleId: string,
  hinted?: ChatAuthor,
): ChatAuthor {
  if (hinted) return hinted;
  if (senderId === "0") return "system";

  const params = msg.params as Record<string, unknown> | undefined;
  if (!params?.connectorMid) return "manager";
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
    const { text, hintedAuthor } = stripWazzupEnvelope(rawText);
    const system = isSystemMessage(msg, text);
    const author: ChatAuthor = system ? "system" : classifyAuthor(msg, senderId, responsibleId, hintedAuthor);

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
