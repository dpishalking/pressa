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
import { listSentInvoices, type BitrixInvoice } from "./bitrix-invoices.js";
import { fetchSessionChat, listOpenLineSessions } from "./bitrix-openlines.js";
import type { ActionsExportConfig } from "../analytics/actions-config.js";
import type { ExportDateRange } from "../analytics/bitrix-country-export.js";
import { yesterdayRange } from "../analytics/bitrix-country-export.js";
import { loadFxConverter, type FxConverter } from "../analytics/fx-rates.js";
import { logger } from "../../logger.js";

export type ActionListsThresholds = {
  chatWindowDays: number;
  dealStaleDays: number;
  leadUnprocessedHours: number;
  slowResponseMinutes: number;
  /** Мин. дней с даты создания счёта на стадии «Отправлено клиенту». */
  invoiceSentMinDays: number;
};

export const DEFAULT_THRESHOLDS: ActionListsThresholds = {
  chatWindowDays: 3,
  dealStaleDays: 3,
  leadUnprocessedHours: 6,
  slowResponseMinutes: 30,
  invoiceSentMinDays: 3,
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

export type UnansweredChatRow = {
  sessionId: string;
  channel: string;
  clientLabel: string;
  managerName: string;
  waitingHours: number;
  lastClientMessage: string;
};

export type StaleDealRow = {
  dealId: string;
  title: string;
  stageName: string;
  amountEur: number;
  daysStale: number;
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

export type SlowResponseRow = {
  sessionId: string;
  channel: string;
  managerName: string;
  firstResponseMinutes: number;
  sessionDate: string;
};

export type DailySummary = {
  updatedAt: string;
  unpaidInvoicesCount: number;
  unpaidInvoicesEur: number;
  staleDealsCount: number;
  staleDealsEur: number;
  unansweredChatsCount: number;
  unprocessedLeadsCount: number;
  slowResponsesCount: number;
  avgFirstResponseMinutes: number;
  yesterdayLeads: number;
  yesterdaySessions: number;
  yesterdayDeals: number;
  yesterdayConversionPct: number;
};

export type ActionListsResult = {
  summary: DailySummary;
  unpaidInvoices: UnpaidInvoiceRow[];
  unansweredChats: UnansweredChatRow[];
  staleDeals: StaleDealRow[];
  unprocessedLeads: UnprocessedLeadRow[];
  slowResponses: SlowResponseRow[];
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
    const deals = await listBitrixDeals({ "@ID": chunk.map(String) }, ["CONTACT_ID"]);
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
    const contactId = String(deal?.CONTACT_ID ?? "");
    const contact = contactId ? contacts.get(contactId) : undefined;
    const createdDate = (invoice.createdTime ?? "").slice(0, 10);

    rows.push({
      invoiceId: invoice.id,
      dealId: invoice.parentDealId,
      clientName: contactName(contact) || deal?.TITLE || invoice.title || "",
      amountEur: fx.convert(invoice.opportunity ?? 0, invoice.currencyId),
      createdDate,
      daysUnpaid: daysBetween(invoice.createdTime ?? createdDate),
      managerName: users.get(String(deal?.ASSIGNED_BY_ID ?? "")) ?? String(deal?.ASSIGNED_BY_ID ?? ""),
      phone: phoneFromContact(contact),
    });
  }

  return rows.sort((a, b) => b.amountEur - a.amountEur);
}

async function buildStaleDeals(
  fx: FxConverter,
  users: Map<string, string>,
  contacts: Map<string, BitrixContact>,
  staleDays: number,
  stageLabels: Map<string, string>,
): Promise<StaleDealRow[]> {
  const deals = await listBitrixDeals({ STAGE_SEMANTIC_ID: "P" }, ["CONTACT_ID"]);
  const rows: StaleDealRow[] = [];

  for (const deal of deals) {
    const daysStale = daysBetween(deal.DATE_MODIFY ?? deal.DATE_CREATE ?? "");
    if (daysStale < staleDays) continue;

    const contactId = String(deal.CONTACT_ID ?? "");
    const contact = contactId ? contacts.get(contactId) : undefined;
    const amount = Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0;

    rows.push({
      dealId: String(deal.ID),
      title: deal.TITLE ?? "",
      stageName: stageLabels.get(deal.STAGE_ID ?? "") ?? deal.STAGE_ID ?? "",
      amountEur: fx.convert(amount, deal.CURRENCY_ID),
      daysStale,
      managerName: users.get(String(deal.ASSIGNED_BY_ID ?? "")) ?? String(deal.ASSIGNED_BY_ID ?? ""),
      phone: phoneFromContact(contact),
    });
  }

  return rows.sort((a, b) => b.amountEur - a.amountEur);
}

async function buildUnprocessedLeads(
  users: Map<string, string>,
  contacts: Map<string, BitrixContact>,
  sourceLabels: Map<string, string>,
  statusLabels: Map<string, string>,
  leadCountryField: string,
  leadFieldMeta: Awaited<ReturnType<typeof getLeadFieldMap>>,
  hours: number,
): Promise<UnprocessedLeadRow[]> {
  const leads = await listBitrixLeads(
    {
      STATUS_SEMANTIC_ID: "P",
      "<DATE_CREATE": hoursAgoIso(hours),
    },
    ["PHONE", "CONTACT_ID", leadCountryField],
  );

  const rows: UnprocessedLeadRow[] = [];
  for (const lead of leads) {
    const contactId = String(lead.CONTACT_ID ?? "");
    const contact = contactId ? contacts.get(contactId) : undefined;
    const phone = phoneFromLead(lead) || phoneFromContact(contact);

    rows.push({
      leadId: String(lead.ID),
      title: lead.TITLE ?? [lead.NAME, lead.LAST_NAME].filter(Boolean).join(" "),
      sourceName: sourceLabels.get(lead.SOURCE_ID ?? "") ?? lead.SOURCE_ID ?? "",
      country: countryDisplayValue(leadFieldMeta, leadCountryField, lead[leadCountryField]),
      createdAt: (lead.DATE_CREATE ?? "").slice(0, 16).replace("T", " "),
      stageName: statusLabels.get(lead.STATUS_ID ?? "") ?? lead.STATUS_ID ?? "",
      hoursWaiting: hoursBetween(lead.DATE_CREATE ?? ""),
      managerName: users.get(String(lead.ASSIGNED_BY_ID ?? "")) ?? String(lead.ASSIGNED_BY_ID ?? ""),
      phone,
      contactId,
    });
  }

  return rows.sort((a, b) => b.hoursWaiting - a.hoursWaiting);
}

async function scanRecentSessions(
  range: ExportDateRange,
  users: Map<string, string>,
  thresholds: ActionListsThresholds,
  onProgress?: (done: number, total: number) => void,
): Promise<{ unanswered: UnansweredChatRow[]; slow: SlowResponseRow[]; avgFirstResponse: number }> {
  const sessions = await listOpenLineSessions(range);
  const unanswered: UnansweredChatRow[] = [];
  const slow: SlowResponseRow[] = [];
  const responseTimes: number[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]!;
    const stats = await fetchSessionChat(session);
    const clientMessages = stats.messages.filter((m) => m.author === "client");
    const managerMessages = stats.messages.filter((m) => m.author === "manager");
    const lastClient = clientMessages.at(-1);
    const lastManager = managerMessages.at(-1);
    const managerName = users.get(session.responsibleId) ?? session.responsibleId;

    if (stats.firstResponseMinutes != null) {
      responseTimes.push(stats.firstResponseMinutes);
      if (stats.firstResponseMinutes > thresholds.slowResponseMinutes) {
        slow.push({
          sessionId: session.sessionId,
          channel: session.channel,
          managerName,
          firstResponseMinutes: stats.firstResponseMinutes,
          sessionDate: session.created.slice(0, 10),
        });
      }
    }

    const clientWaiting =
      lastClient &&
      (!lastManager || lastClient.date > lastManager.date);

    if (clientWaiting) {
      unanswered.push({
        sessionId: session.sessionId,
        channel: session.channel,
        clientLabel: session.clientLabel,
        managerName,
        waitingHours: hoursBetween(lastClient.date),
        lastClientMessage: lastClient.text.slice(0, 200),
      });
    }

    onProgress?.(i + 1, sessions.length);
    if (i + 1 < sessions.length) await sleep(100);
  }

  unanswered.sort((a, b) => b.waitingHours - a.waitingHours);
  slow.sort((a, b) => b.firstResponseMinutes - a.firstResponseMinutes);

  const avgFirstResponse =
    responseTimes.length
      ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
      : 0;

  return { unanswered, slow, avgFirstResponse };
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
  unansweredChats: UnansweredChatRow[];
  slowResponses: SlowResponseRow[];
}): Promise<void> {
  const ids = new Set<string>();
  const maybeId = (value: string) => {
    if (value && /^\d+$/.test(value)) ids.add(value);
  };

  for (const row of result.unpaidInvoices) maybeId(row.managerName);
  for (const row of result.staleDeals) maybeId(row.managerName);
  for (const row of result.unprocessedLeads) maybeId(row.managerName);
  for (const row of result.unansweredChats) maybeId(row.managerName);
  for (const row of result.slowResponses) maybeId(row.managerName);

  const names = await resolveBitrixUserNames([...ids]);
  const label = (value: string) => (names.get(value) ?? value);

  for (const row of result.unpaidInvoices) row.managerName = label(row.managerName);
  for (const row of result.staleDeals) row.managerName = label(row.managerName);
  for (const row of result.unprocessedLeads) row.managerName = label(row.managerName);
  for (const row of result.unansweredChats) row.managerName = label(row.managerName);
  for (const row of result.slowResponses) row.managerName = label(row.managerName);
}

export async function buildActionLists(opts: {
  config: ActionsExportConfig;
  thresholds?: ActionListsThresholds;
  onProgress?: (stage: string, done: number, total: number) => void;
}): Promise<ActionListsResult> {
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const yesterday = yesterdayRange();
  const chatRange = recentDaysRange(thresholds.chatWindowDays);

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
  const staleDeals = await buildStaleDeals(fx, users, new Map(), thresholds.dealStaleDays, stageLabels);
  opts.onProgress?.("deals", 1, 1);

  opts.onProgress?.("leads", 0, 1);
  const unprocessedLeads = await buildUnprocessedLeads(
    users,
    new Map(),
    sourceLabels,
    leadStatusLabels,
    leadCountryField,
    leadFields,
    thresholds.leadUnprocessedHours,
  );
  opts.onProgress?.("leads", 1, 1);

  const contactIds = new Set<string>();
  const dealIds = [
    ...unpaidInvoices.map((row) => row.dealId),
    ...staleDeals.map((row) => Number.parseInt(row.dealId, 10)).filter(Boolean),
  ];
  const dealsById = await loadDealsByIds(dealIds);
  for (const deal of dealsById.values()) {
    const id = String(deal.CONTACT_ID ?? "");
    if (id && id !== "0") contactIds.add(id);
  }
  for (const row of unprocessedLeads) {
    if (row.contactId) contactIds.add(row.contactId);
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
    const deal = dealsById.get(Number.parseInt(row.dealId, 10));
    const contact = deal?.CONTACT_ID ? contacts.get(String(deal.CONTACT_ID)) : undefined;
    if (contact) row.phone = phoneFromContact(contact);
  }
  for (const row of unprocessedLeads) {
    if (!row.phone && row.contactId) {
      row.phone = phoneFromContact(contacts.get(row.contactId));
    }
  }

  const { unanswered, slow, avgFirstResponse } = await scanRecentSessions(
    chatRange,
    users,
    thresholds,
    (done, total) => opts.onProgress?.("chats", done, total),
  );

  const partial = {
    unpaidInvoices,
    staleDeals,
    unprocessedLeads,
    unansweredChats: unanswered,
    slowResponses: slow,
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
    unansweredChatsCount: unanswered.length,
    unprocessedLeadsCount: unprocessedLeads.length,
    slowResponsesCount: slow.length,
    avgFirstResponseMinutes: avgFirstResponse,
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
    leads: summary.unprocessedLeadsCount,
    slow: summary.slowResponsesCount,
  });

  return {
    summary,
    unpaidInvoices,
    unansweredChats: unanswered,
    staleDeals,
    unprocessedLeads,
    slowResponses: slow,
  };
}
