import { getBitrixLeadById, type BitrixLead } from "./bitrix-client.js";
import { fetchSessionChat, findLatestOpenLineSessionForOwners } from "./bitrix-openlines.js";

/** «Новый лид / New lead» — ещё не взят в работу. */
export const LEAD_NEW_STATUS_ID = "NEW";

function minutesBetween(fromIso: string, toDate = new Date()): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.round((toDate.getTime() - from) / 60_000));
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

/** Нужен ли алерт «лид без ответа»: NEW, прошло ≥ minMinutes, менеджер не писал в чат. */
export async function leadNeedsNoResponseAlert(
  leadId: string,
  minMinutes: number,
): Promise<{ alert: boolean; lead?: BitrixLead; waitingMinutes?: number }> {
  const lead = await getBitrixLeadById(leadId);
  if (!lead || !isLeadNewStatus(lead)) return { alert: false };

  const created = lead.DATE_CREATE ?? "";
  const waitingMinutes = minutesBetween(created);
  if (waitingMinutes < minMinutes) return { alert: false, lead, waitingMinutes };

  if (created && (await managerRepliedToLeadInChat(leadId, created))) {
    return { alert: false, lead, waitingMinutes };
  }

  return { alert: true, lead, waitingMinutes };
}
