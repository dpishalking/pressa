import { getBitrixLeadById, type BitrixLead } from "./bitrix-client.js";
import { fetchSessionChat, findLatestOpenLineSessionForOwners, type SessionChatStats } from "./bitrix-openlines.js";

/** «Новый лид / New lead» — ещё не взят в работу. */
export const LEAD_NEW_STATUS_ID = "NEW";

/** Прямой запрос о покупке / заказе (для комментариев Instagram). */
const PURCHASE_INTENT_KEYWORDS = [
  "купить",
  "куплю",
  "покупк",
  "заказ",
  "заказать",
  "оформить",
  "how to buy",
  "how to order",
  "want to buy",
  "want to order",
  "place an order",
  "place order",
  "make an order",
  "сколько стоит",
  "how much",
  "price",
  "стоимость",
  "прайс",
  "хочу заказ",
  "хочу куп",
  "как заказ",
  "как куп",
  "можно заказ",
  "можно куп",
  "can i order",
  "can i buy",
  "сделать заказ",
  "оплат",
];

function minutesBetween(fromIso: string, toDate = new Date()): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.round((toDate.getTime() - from) / 60_000));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Комментарий к посту в Instagram с явным запросом о покупке или заказе. */
export function hasDirectPurchaseIntent(texts: string[]): boolean {
  const combined = normalizeText(texts.filter(Boolean).join(" "));
  if (!combined) return false;
  return PURCHASE_INTENT_KEYWORDS.some((kw) => combined.includes(kw));
}

/** Комментарий к посту Instagram без запроса о покупке — не алертить. */
export function shouldSkipInstagramCommentAlert(
  stats: Pick<SessionChatStats, "instagramPostComment" | "messages">,
): boolean {
  if (!stats.instagramPostComment) return false;
  const clientTexts = stats.messages.filter((m) => m.author === "client").map((m) => m.text);
  return !hasDirectPurchaseIntent(clientTexts);
}

/** Лид считается необработанным только в статусе NEW (не IN_PROCESS и т.д.). */
export function isLeadNewStatus(lead: Pick<BitrixLead, "STATUS_ID" | "STATUS_SEMANTIC_ID">): boolean {
  return lead.STATUS_SEMANTIC_ID === "P" && lead.STATUS_ID === LEAD_NEW_STATUS_ID;
}

/** Менеджер уже ответил в чате Open Lines после создания лида. */
export async function managerRepliedToLeadInChat(leadId: string, sinceIso: string): Promise<boolean> {
  const session = await findLatestOpenLineSessionForOwners([{ ownerTypeId: "1", ownerId: leadId }]);
  if (!session) return false;

  const stats = await fetchSessionChat(session);
  return stats.messages.some(
    (message) => message.author === "manager" && message.date >= sinceIso,
  );
}

function instagramCommentWithoutPurchaseIntent(stats: SessionChatStats): boolean {
  return shouldSkipInstagramCommentAlert(stats);
}

/**
 * Комментарии к постам Instagram не алертим, если нет прямого запроса о покупке/заказе.
 * Direct-сообщения и лиды без чата (сайт и т.д.) — без изменений.
 */
export async function isLeadEligibleForNoResponseAlert(leadId: string): Promise<boolean> {
  const session = await findLatestOpenLineSessionForOwners([{ ownerTypeId: "1", ownerId: leadId }]);
  if (!session) return true;

  const stats = await fetchSessionChat(session);
  return !instagramCommentWithoutPurchaseIntent(stats);
}

/** Нужен ли алерт «лид без ответа»: NEW, прошло ≥ minMinutes, менеджер не писал в чат. */
export async function leadNeedsNoResponseAlert(
  leadId: string,
  minMinutes: number,
): Promise<{ alert: boolean; lead?: BitrixLead; waitingMinutes?: number; skipReason?: string }> {
  const lead = await getBitrixLeadById(leadId);
  if (!lead || !isLeadNewStatus(lead)) return { alert: false };

  const created = lead.DATE_CREATE ?? "";
  const waitingMinutes = minutesBetween(created);
  if (waitingMinutes < minMinutes) return { alert: false, lead, waitingMinutes };

  const session = await findLatestOpenLineSessionForOwners([{ ownerTypeId: "1", ownerId: leadId }]);
  if (session) {
    const stats = await fetchSessionChat(session);
    if (instagramCommentWithoutPurchaseIntent(stats)) {
      return { alert: false, lead, waitingMinutes, skipReason: "instagram_comment" };
    }
    if (created && stats.messages.some((m) => m.author === "manager" && m.date >= created)) {
      return { alert: false, lead, waitingMinutes };
    }
  }

  return { alert: true, lead, waitingMinutes };
}
