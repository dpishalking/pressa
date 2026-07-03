import {
  countryDisplayValue,
  findFieldByTitle,
  getLeadFieldMap,
  listBitrixContactsByIds,
  listBitrixDeals,
  listBitrixLeads,
  listBitrixStatusLabels,
  resolveBitrixUserNames,
  type BitrixContact,
  type BitrixDeal,
  type BitrixLead,
} from "./bitrix-client.js";
import { listSentInvoices, isInvoiceAwaitingPayment, invoiceSentAt, type BitrixInvoice } from "./bitrix-invoices.js";
import { fetchSessionChat, findLatestOpenLineSessionForOwners, listOpenLineSessions } from "./bitrix-openlines.js";
import { buildLostDialogueRow, type LostDialogueRow } from "./lost-dialogue.js";
import { LEAD_IN_WORK_STATUS_ID, leadTakenInWorkAt, listLeadOpenContactTodos, hasNonOverdueContactTask, type LeadInWorkRow } from "./lead-in-work.js";
import { LEAD_NEW_STATUS_ID, isLeadEligibleForNoResponseAlert, managerRepliedToLeadInChat } from "./lead-no-response.js";
import {
  clientWaitingSince,
  DEAL_STAGE_IN_DIALOG,
  type DealInDialogueRow,
} from "./deal-in-dialogue.js";
import {
  clientGhostedSince,
  isFollowUpSalesDealStage,
} from "./deal-client-no-reply.js";
import {
  listDealOpenTodos,
  pickFutureTodoDeadline,
  pickLatestPastTodoDeadline,
} from "./think-deal-followup.js";
import {
  isOpenLineSessionAlertable,
  isOpenLineSessionOpen,
  resolveSessionCrmContext,
  SessionCrmCache,
} from "./session-crm-status.js";
import type { ActionsExportConfig } from "../analytics/actions-config.js";
import type { ExportDateRange } from "../analytics/bitrix-country-export.js";
import { yesterdayRange } from "../analytics/bitrix-country-export.js";
import { loadFxConverter, type FxConverter } from "../analytics/fx-rates.js";
import { logger } from "../../logger.js";

export type ActionListsThresholds = {
  dealStaleDays: number;
  leadUnprocessedHours: number;
  invoiceSentMinDays: number;
  /** Окно поиска потерянных диалогов (дней назад). */
  lostDialogueWindowDays: number;
  /** Мин. часов без ответа менеджера клиенту для потерянного диалога. */
  lostDialogueMinHours: number;
  /** Мин. дней просрочки контакта на стадии «Я подумаю»; дольше — закрыть. */
  thinkDealMaxOverdueDays: number;
  /** Мин. часов без ответа клиента после сообщения менеджера (лист «Клиент не ответил»). */
  clientNoReplyMinHours: number;
  /** Окно поиска чатов для «клиент не ответил» (дней назад). */
  clientNoReplyWindowDays: number;
  /** Мин. часов в статусе «Лид взят в работу». */
  leadInWorkStaleHours: number;
  /** Мин. часов без ответа клиенту на стадии «В диалоге». */
  dealInDialogueNoResponseHours: number;
};

export const DEFAULT_THRESHOLDS: ActionListsThresholds = {
  dealStaleDays: 3,
  leadUnprocessedHours: 6,
  invoiceSentMinDays: 2,
  lostDialogueWindowDays: 14,
  lostDialogueMinHours: 2,
  thinkDealMaxOverdueDays: 15,
  clientNoReplyMinHours: 24,
  clientNoReplyWindowDays: 14,
  leadInWorkStaleHours: 24,
  dealInDialogueNoResponseHours: 24,
};

export type UnpaidInvoiceRow = {
  invoiceId: number;
  dealId: number;
  clientName: string;
  amountEur: number;
  createdDate: string;
  daysUnpaid: number;
  managerName: string;
  phone: string;
};

export type UnansweredChatRow = LostDialogueRow;

/** Стадия «Клиент думает» (= «Я подумаю») — нужно открытое дело (CRM_TODO) с датой контакта. */
export const THINK_DEAL_STAGE_ID = "PREPARATION";

export type ThinkDealRow = {
  dealId: string;
  title: string;
  amountEur: number;
  nextContactDate: string;
  taskDeadline: string;
  daysOverdue: number;
  issue: "no_task" | "overdue" | "expired";
  managerName: string;
  phone: string;
};

export type StaleDealRow = {
  entityType: "deal" | "lead";
  entityId: string;
  dealId: string;
  title: string;
  stageName: string;
  amountEur: number;
  waitingHours: number;
  lastManagerMessage: string;
  lastManagerAt: string;
  channel: string;
  clientLabel: string;
  managerName: string;
  phone: string;
};

export type UnprocessedLeadRow = {
  leadId: string;
  title: string;
  sourceName: string;
  country: string;
  createdAt: string;
  stageName: string;
  hoursWaiting: number;
  managerName: string;
  phone: string;
  contactId: string;
};

export type { LeadInWorkRow, DealInDialogueRow };

export type DailySummary = {
  updatedAt: string;
  unpaidInvoicesCount: number;
  unpaidInvoicesEur: number;
  staleDealsCount: number;
  staleDealsEur: number;
  unansweredChatsCount: number;
  thinkDealsCount: number;
  thinkDealsEur: number;
  thinkDealsExpiredCount: number;
  unprocessedLeadsCount: number;
  leadsInWorkStaleCount: number;
  dealsInDialogueStaleCount: number;
  yesterdayLeads: number;
  yesterdaySessions: number;
  yesterdayDeals: number;
  yesterdayConversionPct: number;
};

export type ActionListsResult = {
  summary: DailySummary;
  unpaidInvoices: UnpaidInvoiceRow[];
  unansweredChats: UnansweredChatRow[];
  thinkDeals: ThinkDealRow[];
  thinkDealsExpired: ThinkDealRow[];
  staleDeals: StaleDealRow[];
  unprocessedLeads: UnprocessedLeadRow[];
  leadsInWorkStale: LeadInWorkRow[];
  dealsInDialogueStale: DealInDialogueRow[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.STATS_TIMEZONE ?? "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function recentDaysRange(days: number): ExportDateRange {
  const today = formatToday();
  return { from: addDaysIso(today, -days), to: addDaysIso(today, 1) };
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function daysBetween(fromIso: string, toDate = new Date()): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.floor((toDate.getTime() - from) / 86_400_000));
}

function hoursBetween(fromIso: string, toDate = new Date()): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.round((toDate.getTime() - from) / 3_600_000));
}

function phoneFromContact(contact?: BitrixContact): string {
  if (!contact?.PHONE?.length) return "";
  return contact.PHONE.find((row) => row.VALUE)?.VALUE?.trim() ?? "";
}

function phoneFromLead(lead: BitrixLead): string {
  const phone = lead.PHONE;
  if (!Array.isArray(phone)) return "";
  const first = phone[0] as { VALUE?: string } | undefined;
  return first?.VALUE?.trim() ?? "";
}

function contactName(contact?: BitrixContact): string {
  if (!contact) return "";
  return [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ").trim();
}

async function loadDealsByIds(dealIds: number[]): Promise<Map<number, BitrixDeal>> {
  const map = new Map<number, BitrixDeal>();
  const unique = [...new Set(dealIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const deals = await listBitrixDeals({ "@ID": chunk.map(String) }, ["CONTACT_ID", "STAGE_ID", "STAGE_SEMANTIC_ID"]);
    for (const deal of deals) {
      map.set(Number(deal.ID), deal);
    }
    if (i + 50 < unique.length) await sleep(200);
  }
  return map;
}

async function buildUnpaidInvoices(
  fx: FxConverter,
  users: Map<string, string>,
  contacts: Map<string, BitrixContact>,
  minDaysSinceSent: number,
): Promise<UnpaidInvoiceRow[]> {
  const invoices = await listSentInvoices(minDaysSinceSent);
  const dealIds = invoices.map((inv) => inv.parentDealId).filter((id): id is number => Boolean(id));
  const deals = await loadDealsByIds(dealIds);

  const rows: UnpaidInvoiceRow[] = [];
  for (const invoice of invoices) {
    if (!invoice.parentDealId) continue;
    const deal = deals.get(invoice.parentDealId);
    if (!isInvoiceAwaitingPayment(deal)) continue;

    const contactId = String(deal?.CONTACT_ID ?? "");
    const contact = contactId ? contacts.get(contactId) : undefined;
    const sentTime = invoiceSentAt(invoice);
    const createdDate = sentTime.slice(0, 10);

    rows.push({
      invoiceId: invoice.id,
      dealId: invoice.parentDealId,
      clientName: contactName(contact) || deal?.TITLE || invoice.title || "",
      amountEur: fx.convert(invoice.opportunity ?? 0, invoice.currencyId),
      createdDate,
      daysUnpaid: daysBetween(sentTime || createdDate),
      managerName: users.get(String(deal?.ASSIGNED_BY_ID ?? "")) ?? String(deal?.ASSIGNED_BY_ID ?? ""),
      phone: phoneFromContact(contact),
    });
  }

  return rows.sort((a, b) => b.amountEur - a.amountEur);
}

async function buildClientNoReplyDeals(
  fx: FxConverter,
  users: Map<string, string>,
  stageLabels: Map<string, string>,
  leadStatusLabels: Map<string, string>,
  minHours: number,
  onProgress?: (done: number, total: number) => void,
): Promise<StaleDealRow[]> {
  const [leads, deals] = await Promise.all([
    listBitrixLeads({ STATUS_ID: LEAD_IN_WORK_STATUS_ID }, ["PHONE", "CONTACT_ID"]),
    listBitrixDeals(
      { STAGE_SEMANTIC_ID: "P" },
      ["CONTACT_ID", "LEAD_ID", "STAGE_ID", "OPPORTUNITY", "CURRENCY_ID", "TITLE", "ASSIGNED_BY_ID"],
    ),
  ]);

  const salesDeals = deals.filter((deal) => isFollowUpSalesDealStage(deal.STAGE_ID ?? ""));
  const dealLeadIds = new Set(
    salesDeals.map((deal) => String(deal.LEAD_ID ?? "")).filter((id) => id && id !== "0"),
  );

  type Candidate = { kind: "lead" | "deal"; lead?: BitrixLead; deal?: BitrixDeal; id: string };
  const candidates: Candidate[] = [];
  for (const deal of salesDeals) candidates.push({ kind: "deal", deal, id: String(deal.ID) });
  for (const lead of leads) {
    if (dealLeadIds.has(String(lead.ID))) continue;
    candidates.push({ kind: "lead", lead, id: String(lead.ID) });
  }

  const crmCache = new SessionCrmCache();
  const rows: StaleDealRow[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const owners =
      candidate.kind === "deal"
        ? [
            { ownerTypeId: "2" as const, ownerId: candidate.id },
            { ownerTypeId: "1" as const, ownerId: String(candidate.deal?.LEAD_ID ?? "") },
            { ownerTypeId: "3" as const, ownerId: String(candidate.deal?.CONTACT_ID ?? "") },
          ]
        : [
            { ownerTypeId: "1" as const, ownerId: candidate.id },
            { ownerTypeId: "3" as const, ownerId: String(candidate.lead?.CONTACT_ID ?? "") },
          ];

    const session = await findLatestOpenLineSessionForOwners(
      owners.filter((owner) => owner.ownerId && owner.ownerId !== "0"),
    );
    if (!session) {
      onProgress?.(i + 1, candidates.length);
      if (i + 1 < candidates.length) await sleep(80);
      continue;
    }
    if (!(await isOpenLineSessionAlertable(session, crmCache))) {
      onProgress?.(i + 1, candidates.length);
      if (i + 1 < candidates.length) await sleep(80);
      continue;
    }

    const stats = await fetchSessionChat(session);
    const clientMessages = stats.messages.filter((message) => message.author === "client" && message.text);
    const managerMessages = stats.messages.filter((message) => message.author === "manager" && message.text);
    const ghosted = clientGhostedSince(
      clientMessages,
      managerMessages,
      minHours,
      stats.instagramPostComment,
    );

    if (ghosted) {
      const ctx = await resolveSessionCrmContext(session, crmCache);
      const managerId =
        session.responsibleId ||
        String(candidate.deal?.ASSIGNED_BY_ID ?? candidate.lead?.ASSIGNED_BY_ID ?? "");
      const managerName = users.get(managerId) ?? managerId;

      if (candidate.kind === "deal" && candidate.deal) {
        const amount = Number.parseFloat(candidate.deal.OPPORTUNITY ?? "0") || 0;
        rows.push({
          entityType: "deal",
          entityId: candidate.id,
          dealId: candidate.id,
          title: candidate.deal.TITLE ?? session.clientLabel,
          stageName: stageLabels.get(candidate.deal.STAGE_ID ?? "") ?? candidate.deal.STAGE_ID ?? "",
          amountEur: fx.convert(amount, candidate.deal.CURRENCY_ID),
          waitingHours: ghosted.waitingHours,
          lastManagerMessage: ghosted.lastManagerMessage.slice(0, 200),
          lastManagerAt: ghosted.lastManagerAt.slice(0, 16).replace("T", " "),
          channel: session.channel,
          clientLabel: session.clientLabel,
          managerName,
          phone: ctx.phone,
        });
      } else if (candidate.kind === "lead" && candidate.lead) {
        rows.push({
          entityType: "lead",
          entityId: candidate.id,
          dealId: "",
          title: candidate.lead.TITLE ?? session.clientLabel,
          stageName: leadStatusLabels.get(candidate.lead.STATUS_ID ?? "") ?? candidate.lead.STATUS_ID ?? "",
          amountEur: 0,
          waitingHours: ghosted.waitingHours,
          lastManagerMessage: ghosted.lastManagerMessage.slice(0, 200),
          lastManagerAt: ghosted.lastManagerAt.slice(0, 16).replace("T", " "),
          channel: session.channel,
          clientLabel: session.clientLabel,
          managerName,
          phone: ctx.phone || phoneFromLead(candidate.lead),
        });
      }
    }

    onProgress?.(i + 1, candidates.length);
    if (i + 1 < candidates.length) await sleep(80);
  }

  return rows.sort((a, b) => b.waitingHours - a.waitingHours || b.amountEur - a.amountEur);
}

export async function buildThinkDeals(
  fx: FxConverter,
  users: Map<string, string>,
  contacts: Map<string, BitrixContact>,
  maxOverdueDays: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ active: ThinkDealRow[]; expired: ThinkDealRow[] }> {
  const deals = await listBitrixDeals({ STAGE_ID: THINK_DEAL_STAGE_ID }, ["CONTACT_ID", "CLOSEDATE"]);
  const today = formatToday();
  const active: ThinkDealRow[] = [];
  const expired: ThinkDealRow[] = [];

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i]!;
    const closeDate = String(deal.CLOSEDATE ?? "").slice(0, 10);
    const todos = await listDealOpenTodos(String(deal.ID));
    const futureTask = pickFutureTodoDeadline(todos, today);

    if (futureTask) {
      onProgress?.(i + 1, deals.length);
      if (i + 1 < deals.length) await sleep(80);
      continue;
    }

    const pastTask = pickLatestPastTodoDeadline(todos, today);
    const referenceDate = pastTask || (closeDate && closeDate < today ? closeDate : "");
    const daysOverdue = referenceDate
      ? daysBetween(referenceDate)
      : daysBetween(deal.DATE_MODIFY ?? deal.DATE_CREATE ?? "");

    let issue: ThinkDealRow["issue"] = "no_task";
    if (referenceDate) {
      issue = daysOverdue > maxOverdueDays ? "expired" : "overdue";
    }

    const contactId = String(deal.CONTACT_ID ?? "");
    const contact = contactId ? contacts.get(contactId) : undefined;
    const amount = Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0;

    const row: ThinkDealRow = {
      dealId: String(deal.ID),
      title: deal.TITLE ?? "",
      amountEur: fx.convert(amount, deal.CURRENCY_ID),
      nextContactDate: closeDate,
      taskDeadline: pastTask || todos[0]?.deadline.slice(0, 10) || "",
      daysOverdue,
      issue,
      managerName: users.get(String(deal.ASSIGNED_BY_ID ?? "")) ?? String(deal.ASSIGNED_BY_ID ?? ""),
      phone: phoneFromContact(contact),
    };

    if (issue === "expired") expired.push(row);
    else active.push(row);

    onProgress?.(i + 1, deals.length);
    if (i + 1 < deals.length) await sleep(80);
  }

  const sort = (rows: ThinkDealRow[]) =>
    rows.sort((a, b) => {
      if (a.issue !== b.issue) {
        if (a.issue === "no_task") return -1;
        if (b.issue === "no_task") return 1;
      }
      return b.daysOverdue - a.daysOverdue || b.amountEur - a.amountEur;
    });

  return { active: sort(active), expired: sort(expired) };
}

export async function enrichThinkDealPhones(rows: ThinkDealRow[]): Promise<void> {
  if (rows.length === 0) return;

  const dealIds = rows.map((row) => Number.parseInt(row.dealId, 10)).filter(Boolean);
  const dealsById = await loadDealsByIds(dealIds);
  const contactIds = new Set<string>();
  for (const deal of dealsById.values()) {
    const id = String(deal.CONTACT_ID ?? "");
    if (id && id !== "0") contactIds.add(id);
  }

  const contacts = new Map(
    (await listBitrixContactsByIds([...contactIds])).map((contact) => [String(contact.ID), contact]),
  );

  for (const row of rows) {
    const deal = dealsById.get(Number.parseInt(row.dealId, 10));
    const contact = deal?.CONTACT_ID ? contacts.get(String(deal.CONTACT_ID)) : undefined;
    if (contact) row.phone = phoneFromContact(contact);
  }
}

async function buildUnprocessedLeads(
  users: Map<string, string>,
  contacts: Map<string, BitrixContact>,
  sourceLabels: Map<string, string>,
  statusLabels: Map<string, string>,
  leadCountryField: string,
  leadFieldMeta: Awaited<ReturnType<typeof getLeadFieldMap>>,
  hours: number,
  onProgress?: (done: number, total: number) => void,
): Promise<UnprocessedLeadRow[]> {
  const leads = await listBitrixLeads(
    {
      STATUS_ID: LEAD_NEW_STATUS_ID,
      STATUS_SEMANTIC_ID: "P",
      "<DATE_CREATE": hoursAgoIso(hours),
    },
    ["PHONE", "CONTACT_ID", leadCountryField],
  );

  const rows: UnprocessedLeadRow[] = [];
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;
    const leadId = String(lead.ID);
    const created = lead.DATE_CREATE ?? "";

    if (created && (await managerRepliedToLeadInChat(leadId, created))) {
      onProgress?.(i + 1, leads.length);
      if (i + 1 < leads.length) await sleep(120);
      continue;
    }

    if (!(await isLeadEligibleForNoResponseAlert(leadId))) {
      onProgress?.(i + 1, leads.length);
      if (i + 1 < leads.length) await sleep(120);
      continue;
    }

    const contactId = String(lead.CONTACT_ID ?? "");
    const contact = contactId ? contacts.get(contactId) : undefined;
    const phone = phoneFromLead(lead) || phoneFromContact(contact);

    rows.push({
      leadId,
      title: lead.TITLE ?? [lead.NAME, lead.LAST_NAME].filter(Boolean).join(" "),
      sourceName: sourceLabels.get(lead.SOURCE_ID ?? "") ?? lead.SOURCE_ID ?? "",
      country: countryDisplayValue(leadFieldMeta, leadCountryField, lead[leadCountryField]),
      createdAt: created.slice(0, 16).replace("T", " "),
      stageName: statusLabels.get(lead.STATUS_ID ?? "") ?? lead.STATUS_ID ?? "",
      hoursWaiting: hoursBetween(created),
      managerName: users.get(String(lead.ASSIGNED_BY_ID ?? "")) ?? String(lead.ASSIGNED_BY_ID ?? ""),
      phone,
      contactId,
    });

    onProgress?.(i + 1, leads.length);
    if (i + 1 < leads.length) await sleep(120);
  }

  return rows.sort((a, b) => b.hoursWaiting - a.hoursWaiting);
}

async function buildLeadsInWorkStale(
  users: Map<string, string>,
  contacts: Map<string, BitrixContact>,
  sourceLabels: Map<string, string>,
  leadCountryField: string,
  leadFieldMeta: Awaited<ReturnType<typeof getLeadFieldMap>>,
  minHours: number,
  onProgress?: (done: number, total: number) => void,
): Promise<LeadInWorkRow[]> {
  const leads = await listBitrixLeads({ STATUS_ID: LEAD_IN_WORK_STATUS_ID }, ["PHONE", "CONTACT_ID", leadCountryField]);
  const rows: LeadInWorkRow[] = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;
    const takenAt = await leadTakenInWorkAt(String(lead.ID));
    const hoursInWork = hoursBetween(takenAt ?? lead.DATE_MODIFY ?? lead.DATE_CREATE ?? "");
    if (hoursInWork < minHours) continue;

    const contactTodos = await listLeadOpenContactTodos(String(lead.ID));
    if (hasNonOverdueContactTask(contactTodos)) continue;

    const contactId = String(lead.CONTACT_ID ?? "");
    const contact = contactId ? contacts.get(contactId) : undefined;

    rows.push({
      leadId: String(lead.ID),
      title: lead.TITLE ?? [lead.NAME, lead.LAST_NAME].filter(Boolean).join(" "),
      sourceName: sourceLabels.get(lead.SOURCE_ID ?? "") ?? lead.SOURCE_ID ?? "",
      country: countryDisplayValue(leadFieldMeta, leadCountryField, lead[leadCountryField]),
      inWorkSince: (takenAt ?? lead.DATE_MODIFY ?? lead.DATE_CREATE ?? "").slice(0, 16).replace("T", " "),
      hoursInWork,
      managerName: users.get(String(lead.ASSIGNED_BY_ID ?? "")) ?? String(lead.ASSIGNED_BY_ID ?? ""),
      phone: phoneFromLead(lead) || phoneFromContact(contact),
      contactId,
    });

    onProgress?.(i + 1, leads.length);
    if (i + 1 < leads.length) await sleep(120);
  }

  return rows.sort((a, b) => b.hoursInWork - a.hoursInWork);
}

async function buildDealsInDialogueStale(
  fx: FxConverter,
  users: Map<string, string>,
  contacts: Map<string, BitrixContact>,
  minHours: number,
  onProgress?: (done: number, total: number) => void,
): Promise<DealInDialogueRow[]> {
  const deals = await listBitrixDeals(
    { STAGE_ID: DEAL_STAGE_IN_DIALOG, STAGE_SEMANTIC_ID: "P" },
    ["CONTACT_ID", "LEAD_ID"],
  );
  const rows: DealInDialogueRow[] = [];

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i]!;
    const session = await findLatestOpenLineSessionForOwners([
      { ownerTypeId: "2", ownerId: String(deal.ID) },
      { ownerTypeId: "1", ownerId: String(deal.LEAD_ID ?? "") },
      { ownerTypeId: "3", ownerId: String(deal.CONTACT_ID ?? "") },
    ]);

    if (session && isOpenLineSessionOpen(session)) {
      const stats = await fetchSessionChat(session);
      const clientMessages = stats.messages.filter((m) => m.author === "client");
      const managerMessages = stats.messages.filter((m) => m.author === "manager");
      const waiting = clientWaitingSince(clientMessages, managerMessages, minHours);

      if (waiting) {
        const contactId = String(deal.CONTACT_ID ?? "");
        const contact = contactId ? contacts.get(contactId) : undefined;
        const amount = Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0;
        const managerId = session.responsibleId || String(deal.ASSIGNED_BY_ID ?? "");

        rows.push({
          dealId: String(deal.ID),
          title: deal.TITLE ?? "",
          amountEur: fx.convert(amount, deal.CURRENCY_ID),
          channel: session.channel,
          clientLabel: session.clientLabel,
          waitingHours: waiting.waitingHours,
          lastClientMessage: waiting.lastClientMessage,
          managerName: users.get(managerId) ?? managerId,
          phone: phoneFromContact(contact),
          contactId,
        });
      }
    }

    onProgress?.(i + 1, deals.length);
    if (i + 1 < deals.length) await sleep(120);
  }

  return rows.sort((a, b) => b.waitingHours - a.waitingHours);
}

async function scanLostDialogues(
  range: ExportDateRange,
  users: Map<string, string>,
  thresholds: ActionListsThresholds,
  onProgress?: (done: number, total: number) => void,
): Promise<LostDialogueRow[]> {
  const sessions = await listOpenLineSessions(range);
  const lost: LostDialogueRow[] = [];
  const crmCache = new SessionCrmCache();

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]!;
    if (!isOpenLineSessionOpen(session)) continue;
    if (!(await isOpenLineSessionAlertable(session, crmCache))) continue;

    const stats = await fetchSessionChat(session);
    const managerName = users.get(session.responsibleId) ?? session.responsibleId;
    const row = buildLostDialogueRow(session, stats, managerName, thresholds.lostDialogueMinHours);
    if (row) {
      const ctx = await resolveSessionCrmContext(session, crmCache);
      row.dealId = ctx.dealId;
      row.leadId = ctx.leadId;
      row.phone = ctx.phone;
      lost.push(row);
    }

    onProgress?.(i + 1, sessions.length);
    if (i + 1 < sessions.length) await sleep(100);
  }

  lost.sort((a, b) => b.waitingHours - a.waitingHours);
  return lost;
}

export async function buildUnprocessedLeadsList(opts?: {
  thresholds?: ActionListsThresholds;
  config?: Pick<ActionsExportConfig, "leadCountryField">;
  onProgress?: (done: number, total: number) => void;
}): Promise<UnprocessedLeadRow[]> {
  const thresholds = opts?.thresholds ?? DEFAULT_THRESHOLDS;

  const [sourceLabels, leadStatusLabels, leadFields] = await Promise.all([
    listBitrixStatusLabels("SOURCE"),
    listBitrixStatusLabels("STATUS"),
    getLeadFieldMap(),
  ]);
  const users = new Map<string, string>();
  const leadCountryField =
    opts?.config?.leadCountryField ?? findFieldByTitle(leadFields, "Страна") ?? "UF_CRM_COUNTRY";

  const rows = await buildUnprocessedLeads(
    users,
    new Map(),
    sourceLabels,
    leadStatusLabels,
    leadCountryField,
    leadFields,
    thresholds.leadUnprocessedHours,
    opts?.onProgress,
  );

  await enrichManagerNames({
    unpaidInvoices: [],
    staleDeals: [],
    unprocessedLeads: rows,
    leadsInWorkStale: [],
    dealsInDialogueStale: [],
    unansweredChats: [],
    thinkDeals: [],
    thinkDealsExpired: [],
  });

  return rows;
}

export async function buildLostDialoguesList(opts?: {
  thresholds?: ActionListsThresholds;
  onProgress?: (done: number, total: number) => void;
}): Promise<LostDialogueRow[]> {
  const thresholds = opts?.thresholds ?? DEFAULT_THRESHOLDS;
  const range = recentDaysRange(thresholds.lostDialogueWindowDays);
  const users = new Map<string, string>();
  const rows = await scanLostDialogues(range, users, thresholds, opts?.onProgress);
  await enrichManagerNames({
    unpaidInvoices: [],
    staleDeals: [],
    unprocessedLeads: [],
    leadsInWorkStale: [],
    dealsInDialogueStale: [],
    unansweredChats: rows,
    thinkDeals: [],
    thinkDealsExpired: [],
  });
  return rows;
}

function buildSalesDealFilter(range: ExportDateRange, salesStageIds: string[]): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    ">=CLOSEDATE": range.from,
    "<CLOSEDATE": range.to,
  };
  if (salesStageIds.length === 1) {
    filter["=STAGE_ID"] = salesStageIds[0];
  } else if (salesStageIds.length > 1) {
    filter["@STAGE_ID"] = salesStageIds;
  }
  return filter;
}

async function enrichManagerNames(result: {
  unpaidInvoices: UnpaidInvoiceRow[];
  staleDeals: StaleDealRow[];
  unprocessedLeads: UnprocessedLeadRow[];
  leadsInWorkStale: LeadInWorkRow[];
  dealsInDialogueStale: DealInDialogueRow[];
  unansweredChats: UnansweredChatRow[];
  thinkDeals: ThinkDealRow[];
  thinkDealsExpired: ThinkDealRow[];
}): Promise<void> {
  const ids = new Set<string>();
  const maybeId = (value: string) => {
    if (value && /^\d+$/.test(value)) ids.add(value);
  };

  for (const row of result.unpaidInvoices) maybeId(row.managerName);
  for (const row of result.staleDeals) maybeId(row.managerName);
  for (const row of result.unprocessedLeads) maybeId(row.managerName);
  for (const row of result.leadsInWorkStale) maybeId(row.managerName);
  for (const row of result.dealsInDialogueStale) maybeId(row.managerName);
  for (const row of result.unansweredChats) maybeId(row.managerName);
  for (const row of result.thinkDeals) maybeId(row.managerName);
  for (const row of result.thinkDealsExpired) maybeId(row.managerName);

  const names = await resolveBitrixUserNames([...ids]);
  const label = (value: string) => (names.get(value) ?? value);

  for (const row of result.unpaidInvoices) row.managerName = label(row.managerName);
  for (const row of result.staleDeals) row.managerName = label(row.managerName);
  for (const row of result.unprocessedLeads) row.managerName = label(row.managerName);
  for (const row of result.leadsInWorkStale) row.managerName = label(row.managerName);
  for (const row of result.dealsInDialogueStale) row.managerName = label(row.managerName);
  for (const row of result.unansweredChats) row.managerName = label(row.managerName);
  for (const row of result.thinkDeals) row.managerName = label(row.managerName);
  for (const row of result.thinkDealsExpired) row.managerName = label(row.managerName);
}

export async function buildActionLists(opts: {
  config: ActionsExportConfig;
  thresholds?: ActionListsThresholds;
  onProgress?: (stage: string, done: number, total: number) => void;
}): Promise<ActionListsResult> {
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const yesterday = yesterdayRange();
  const lostDialogueRange = recentDaysRange(thresholds.lostDialogueWindowDays);

  const [sourceLabels, stageLabels, leadStatusLabels, leadFields] = await Promise.all([
    listBitrixStatusLabels("SOURCE"),
    listBitrixStatusLabels("DEAL_STAGE"),
    listBitrixStatusLabels("STATUS"),
    getLeadFieldMap(),
  ]);
  const users = new Map<string, string>();

  const leadCountryField =
    opts.config.leadCountryField ?? findFieldByTitle(leadFields, "Страна") ?? "UF_CRM_COUNTRY";

  const fx = await loadFxConverter({
    baseCurrency: opts.config.baseCurrency,
    date: formatToday(),
    overrides: opts.config.fxOverrides,
  });

  opts.onProgress?.("invoices", 0, 1);
  const unpaidInvoices = await buildUnpaidInvoices(fx, users, new Map(), thresholds.invoiceSentMinDays);
  opts.onProgress?.("invoices", 1, 1);

  opts.onProgress?.("deals", 0, 1);
  const [staleDeals, thinkSplit] = await Promise.all([
    buildClientNoReplyDeals(
      fx,
      users,
      stageLabels,
      leadStatusLabels,
      thresholds.clientNoReplyMinHours,
      (done, total) => opts.onProgress?.("client_no_reply", done, total),
    ),
    buildThinkDeals(
      fx,
      users,
      new Map(),
      thresholds.thinkDealMaxOverdueDays,
      (done, total) => opts.onProgress?.("think_deals", done, total),
    ),
  ]);
  const thinkDeals = thinkSplit.active;
  const thinkDealsExpired = thinkSplit.expired;
  opts.onProgress?.("deals", 1, 1);

  opts.onProgress?.("leads", 0, 1);
  const [unprocessedLeads, leadsInWorkStale] = await Promise.all([
    buildUnprocessedLeads(
      users,
      new Map(),
      sourceLabels,
      leadStatusLabels,
      leadCountryField,
      leadFields,
      thresholds.leadUnprocessedHours,
    ),
    buildLeadsInWorkStale(
      users,
      new Map(),
      sourceLabels,
      leadCountryField,
      leadFields,
      thresholds.leadInWorkStaleHours,
      (done, total) => opts.onProgress?.("leads_in_work", done, total),
    ),
  ]);
  opts.onProgress?.("leads", 1, 1);

  const contactIds = new Set<string>();
  const dealIds = [
    ...unpaidInvoices.map((row) => row.dealId),
    ...staleDeals
      .filter((row) => row.entityType === "deal" && row.dealId)
      .map((row) => Number.parseInt(row.dealId, 10))
      .filter(Boolean),
    ...thinkDeals.map((row) => Number.parseInt(row.dealId, 10)).filter(Boolean),
    ...thinkDealsExpired.map((row) => Number.parseInt(row.dealId, 10)).filter(Boolean),
  ];
  const dealsById = await loadDealsByIds(dealIds);
  for (const deal of dealsById.values()) {
    const id = String(deal.CONTACT_ID ?? "");
    if (id && id !== "0") contactIds.add(id);
  }
  for (const row of unprocessedLeads) {
    if (row.contactId) contactIds.add(row.contactId);
  }
  for (const row of leadsInWorkStale) {
    if (row.contactId) contactIds.add(row.contactId);
  }
  for (const deal of await listBitrixDeals({ STAGE_ID: DEAL_STAGE_IN_DIALOG }, ["CONTACT_ID"])) {
    const id = String(deal.CONTACT_ID ?? "");
    if (id && id !== "0") contactIds.add(id);
  }

  const contacts = new Map(
    (await listBitrixContactsByIds([...contactIds])).map((contact) => [String(contact.ID), contact]),
  );

  for (const row of unpaidInvoices) {
    const deal = dealsById.get(row.dealId);
    const contact = deal?.CONTACT_ID ? contacts.get(String(deal.CONTACT_ID)) : undefined;
    if (contact) {
      row.clientName = contactName(contact) || row.clientName;
      row.phone = phoneFromContact(contact);
    }
  }
  for (const row of staleDeals) {
    if (row.phone) continue;
    if (row.entityType !== "deal" || !row.dealId) continue;
    const deal = dealsById.get(Number.parseInt(row.dealId, 10));
    const contact = deal?.CONTACT_ID ? contacts.get(String(deal.CONTACT_ID)) : undefined;
    if (contact) row.phone = phoneFromContact(contact);
  }
  await enrichThinkDealPhones([...thinkDeals, ...thinkDealsExpired]);
  for (const row of unprocessedLeads) {
    if (!row.phone && row.contactId) {
      row.phone = phoneFromContact(contacts.get(row.contactId));
    }
  }
  for (const row of leadsInWorkStale) {
    if (!row.phone && row.contactId) {
      row.phone = phoneFromContact(contacts.get(row.contactId));
    }
  }

  const dealsInDialogueStale = await buildDealsInDialogueStale(
    fx,
    users,
    contacts,
    thresholds.dealInDialogueNoResponseHours,
    (done, total) => opts.onProgress?.("deals_in_dialogue", done, total),
  );

  for (const row of dealsInDialogueStale) {
    if (!row.phone && row.contactId) {
      row.phone = phoneFromContact(contacts.get(row.contactId));
    }
  }

  const lostDialogues = await scanLostDialogues(
    lostDialogueRange,
    users,
    thresholds,
    (done, total) => opts.onProgress?.("lost_dialogues", done, total),
  );

  const partial = {
    unpaidInvoices,
    staleDeals,
    thinkDeals,
    thinkDealsExpired,
    unprocessedLeads,
    leadsInWorkStale,
    dealsInDialogueStale,
    unansweredChats: lostDialogues,
  };
  await enrichManagerNames(partial);

  const [yesterdayLeads, yesterdaySessions, yesterdayDeals] = await Promise.all([
    listBitrixLeads({ ">=DATE_CREATE": yesterday.from, "<DATE_CREATE": yesterday.to }, []),
    listOpenLineSessions(yesterday),
    listBitrixDeals(buildSalesDealFilter(yesterday, opts.config.salesStageIds), []),
  ]);

  const summary: DailySummary = {
    updatedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    unpaidInvoicesCount: unpaidInvoices.length,
    unpaidInvoicesEur: unpaidInvoices.reduce((sum, row) => sum + row.amountEur, 0),
    staleDealsCount: staleDeals.length,
    staleDealsEur: staleDeals.reduce((sum, row) => sum + row.amountEur, 0),
    unansweredChatsCount: lostDialogues.length,
    thinkDealsCount: thinkDeals.length,
    thinkDealsEur: thinkDeals.reduce((sum, row) => sum + row.amountEur, 0),
    thinkDealsExpiredCount: thinkDealsExpired.length,
    unprocessedLeadsCount: unprocessedLeads.length,
    leadsInWorkStaleCount: leadsInWorkStale.length,
    dealsInDialogueStaleCount: dealsInDialogueStale.length,
    yesterdayLeads: yesterdayLeads.length,
    yesterdaySessions: yesterdaySessions.length,
    yesterdayDeals: yesterdayDeals.length,
    yesterdayConversionPct: yesterdayLeads.length
      ? (yesterdayDeals.length / yesterdayLeads.length) * 100
      : 0,
  };

  logger.info("Action lists built", {
    unpaid: summary.unpaidInvoicesCount,
    stale: summary.staleDealsCount,
    unanswered: summary.unansweredChatsCount,
    think: summary.thinkDealsCount,
    thinkExpired: summary.thinkDealsExpiredCount,
    leads: summary.unprocessedLeadsCount,
    leadsInWork: summary.leadsInWorkStaleCount,
    dealsInDialogue: summary.dealsInDialogueStaleCount,
  });

  return {
    summary,
    unpaidInvoices,
    unansweredChats: lostDialogues,
    thinkDeals,
    thinkDealsExpired,
    staleDeals,
    unprocessedLeads,
    leadsInWorkStale,
    dealsInDialogueStale,
  };
}
