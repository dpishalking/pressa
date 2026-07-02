import { bitrixCall } from "./bitrix-client.js";

/** «Лид взят в работу / Lead is taken» */
export const LEAD_IN_WORK_STATUS_ID = "IN_PROCESS";

const LEAD_ENTITY_TYPE_ID = 1;

export type LeadContactTask = {
  id: string;
  subject: string;
  deadline: string;
};

function formatToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.STATS_TIMEZONE ?? "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Дело «Связаться с клиентом» и аналоги. */
export function isContactTaskSubject(subject: string): boolean {
  return /связ/i.test(subject) || /contact\s+(the\s+)?client/i.test(subject);
}

export async function listLeadOpenContactTodos(leadId: string): Promise<LeadContactTask[]> {
  const response = await bitrixCall("crm.activity.list", {
    filter: {
      OWNER_TYPE_ID: String(LEAD_ENTITY_TYPE_ID),
      OWNER_ID: leadId,
      COMPLETED: "N",
      PROVIDER_ID: "CRM_TODO",
    },
    select: ["ID", "SUBJECT", "DEADLINE"],
    order: { DEADLINE: "ASC" },
  });

  return ((response.result as Array<Record<string, string>> | undefined) ?? [])
    .map((row) => ({
      id: String(row.ID),
      subject: row.SUBJECT ?? "",
      deadline: row.DEADLINE ?? "",
    }))
    .filter((row) => row.deadline && isContactTaskSubject(row.subject));
}

/** Есть непросроченное дело на связь — лид не считаем «зависшим». */
export function hasNonOverdueContactTask(todos: LeadContactTask[], today = formatToday()): boolean {
  return todos.some((todo) => todo.deadline.slice(0, 10) >= today);
}

export async function leadTakenInWorkAt(leadId: string): Promise<string | null> {
  const response = await bitrixCall("crm.stagehistory.list", {
    entityTypeId: LEAD_ENTITY_TYPE_ID,
    filter: { OWNER_ID: Number.parseInt(leadId, 10) },
  });

  const items =
    (response.result as { items?: Array<{ STATUS_ID?: string; CREATED_TIME?: string }> } | undefined)?.items ??
    [];

  let takenAt: string | null = null;
  for (const item of items) {
    if (item.STATUS_ID === LEAD_IN_WORK_STATUS_ID && item.CREATED_TIME) {
      takenAt = item.CREATED_TIME;
    }
  }
  return takenAt;
}

export type LeadInWorkRow = {
  leadId: string;
  title: string;
  sourceName: string;
  country: string;
  inWorkSince: string;
  hoursInWork: number;
  managerName: string;
  phone: string;
  contactId: string;
};
