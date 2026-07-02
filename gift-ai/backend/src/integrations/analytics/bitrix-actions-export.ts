import { buildActionLists, DEFAULT_THRESHOLDS, type ActionListsResult, type ThinkDealRow } from "../crm/bitrix-action-lists.js";
import { lostDialogueSheetRows } from "../crm/lost-dialogue-sheet.js";
import { actionsExportConfig } from "./actions-config.js";
import {
  ACTIONS_SUMMARY_HEADERS,
  LOST_DIALOGUE_HEADERS,
  THINK_DEAL_HEADERS,
  SLOW_RESPONSE_HEADERS,
  STALE_DEAL_HEADERS,
  UNPAID_INVOICE_HEADERS,
  UNPROCESSED_LEAD_HEADERS,
  LEAD_IN_WORK_HEADERS,
  DEAL_IN_DIALOGUE_HEADERS,
  actionsSummaryTab,
  lostDialoguesTab,
  thinkDealsTab,
  thinkDealsExpiredTab,
  slowResponsesTab,
  staleDealsTab,
  unprocessedLeadsTab,
  leadsInWorkTab,
  dealsInDialogueTab,
  unpaidInvoicesTab,
  sheetAmount,
  sheetPct,
  sheetText,
  writeSheetContent,
  writeSheetDataOnly,
  type SheetCell,
} from "../sheets/analytics-write.js";
import { loadServiceAccount } from "../sheets/google-auth.js";
import { logger } from "../../logger.js";

export type BitrixActionsExportSummary = {
  sheetId: string;
  sheetTabs: string[];
  summary: ActionListsResult["summary"];
};

function summaryRows(result: ActionListsResult, baseCurrency: string): SheetCell[][] {
  const s = result.summary;
  const thinkDays = DEFAULT_THRESHOLDS.thinkDealMaxOverdueDays;
  return [
    ["Обновлено", s.updatedAt],
    ["Неоплаченных счетов", s.unpaidInvoicesCount],
    ["Сумма неоплаченных счетов", sheetAmount(s.unpaidInvoicesEur)],
    ["Зависших сделок", s.staleDealsCount],
    ["Сумма зависших сделок", sheetAmount(s.staleDealsEur)],
    ["Потерянных диалогов", s.unansweredChatsCount],
    [`«Я подумаю» (до ${thinkDays} дн)`, s.thinkDealsCount],
    ["Сумма «Я подумаю»", sheetAmount(s.thinkDealsEur)],
    [`«Я подумаю» закрыть (>${thinkDays} дн)`, s.thinkDealsExpiredCount],
    ["Необработанных лидов", s.unprocessedLeadsCount],
    [`Лид в работе >${DEFAULT_THRESHOLDS.leadInWorkStaleHours}ч`, s.leadsInWorkStaleCount],
    [`В диалоге без ответа >${DEFAULT_THRESHOLDS.dealInDialogueNoResponseHours}ч`, s.dealsInDialogueStaleCount],
    ["Медленных ответов (>30 мин)", s.slowResponsesCount],
    ["Средний первый ответ (мин)", s.avgFirstResponseMinutes],
    ["--- Вчера ---", ""],
    ["Лидов вчера", s.yesterdayLeads],
    ["Сессий ОЛ вчера", s.yesterdaySessions],
    ["Сделок WON вчера", s.yesterdayDeals],
    ["Конверсия лид→сделка вчера, %", sheetPct(s.yesterdayConversionPct)],
    ["Валюта", baseCurrency],
  ];
}

function thinkIssueLabel(issue: ThinkDealRow["issue"], closeDate: string, today: string): string {
  const thinkDays = DEFAULT_THRESHOLDS.thinkDealMaxOverdueDays;
  if (issue === "no_task") {
    return closeDate && closeDate >= today ? "Нет дела (есть дата в CRM)" : "Нет дела";
  }
  if (issue === "expired") return `Закрыть (>${thinkDays} дн)`;
  return "Просрочен контакт";
}

function thinkDealRows(rows: ThinkDealRow[], baseCurrency: string): SheetCell[][] {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.STATS_TIMEZONE ?? "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return rows.map((row) => [
    row.dealId,
    sheetText(row.title),
    sheetAmount(row.amountEur),
    baseCurrency,
    row.nextContactDate || "—",
    row.taskDeadline || "—",
    row.daysOverdue,
    thinkIssueLabel(row.issue, row.nextContactDate, today),
    sheetText(row.managerName),
    sheetText(row.phone),
  ]);
}

export async function exportBitrixActionLists(): Promise<BitrixActionsExportSummary> {
  const cfg = actionsExportConfig();
  const account = loadServiceAccount(cfg.serviceAccountJson);

  const result = await buildActionLists({
    config: cfg,
    onProgress: (stage, done, total) => {
      if (done % 50 === 0 || done === total) {
        logger.info("Actions export progress", { stage, done, total });
      }
    },
  });

  const tabs = [
    actionsSummaryTab(),
    unpaidInvoicesTab(),
    lostDialoguesTab(),
    thinkDealsTab(),
    thinkDealsExpiredTab(),
    staleDealsTab(),
    unprocessedLeadsTab(),
    leadsInWorkTab(),
    dealsInDialogueTab(),
    slowResponsesTab(),
  ];

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[0]!,
    ACTIONS_SUMMARY_HEADERS,
    summaryRows(result, cfg.baseCurrency),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[1]!,
    UNPAID_INVOICE_HEADERS,
    result.unpaidInvoices.map((row) => [
      row.invoiceId,
      row.dealId,
      sheetText(row.clientName),
      sheetAmount(row.amountEur),
      cfg.baseCurrency,
      row.createdDate,
      row.daysUnpaid,
      sheetText(row.managerName),
      sheetText(row.phone),
    ]),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[2]!,
    LOST_DIALOGUE_HEADERS,
    lostDialogueSheetRows(result.unansweredChats),
  );

  await writeSheetDataOnly(
    account,
    cfg.sheetId,
    tabs[3]!,
    THINK_DEAL_HEADERS.length,
    thinkDealRows(result.thinkDeals, cfg.baseCurrency),
  );

  await writeSheetDataOnly(
    account,
    cfg.sheetId,
    tabs[4]!,
    THINK_DEAL_HEADERS.length,
    thinkDealRows(result.thinkDealsExpired, cfg.baseCurrency),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[5]!,
    STALE_DEAL_HEADERS,
    result.staleDeals.map((row) => [
      row.dealId,
      sheetText(row.title),
      sheetText(row.stageName),
      sheetAmount(row.amountEur),
      cfg.baseCurrency,
      row.daysStale,
      sheetText(row.managerName),
      sheetText(row.phone),
    ]),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[6]!,
    UNPROCESSED_LEAD_HEADERS,
    result.unprocessedLeads.map((row) => [
      row.leadId,
      sheetText(row.title),
      sheetText(row.sourceName),
      sheetText(row.country),
      row.createdAt,
      sheetText(row.stageName),
      row.hoursWaiting,
      sheetText(row.managerName),
      sheetText(row.phone),
    ]),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[7]!,
    LEAD_IN_WORK_HEADERS,
    result.leadsInWorkStale.map((row) => [
      row.leadId,
      sheetText(row.title),
      sheetText(row.sourceName),
      sheetText(row.country),
      row.inWorkSince,
      row.hoursInWork,
      sheetText(row.managerName),
      sheetText(row.phone),
    ]),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[8]!,
    DEAL_IN_DIALOGUE_HEADERS,
    result.dealsInDialogueStale.map((row) => [
      row.dealId,
      sheetText(row.title),
      sheetAmount(row.amountEur),
      cfg.baseCurrency,
      sheetText(row.channel),
      sheetText(row.clientLabel),
      row.waitingHours,
      sheetText(row.lastClientMessage),
      sheetText(row.managerName),
      sheetText(row.phone),
    ]),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[9]!,
    SLOW_RESPONSE_HEADERS,
    result.slowResponses.map((row) => [
      row.sessionId,
      row.channel,
      sheetText(row.managerName),
      row.firstResponseMinutes,
      row.sessionDate,
    ]),
  );

  logger.info("Actions export written", {
    sheetId: cfg.sheetId,
    unpaid: result.summary.unpaidInvoicesCount,
    unanswered: result.summary.unansweredChatsCount,
    think: result.summary.thinkDealsCount,
    thinkExpired: result.summary.thinkDealsExpiredCount,
    stale: result.summary.staleDealsCount,
    leads: result.summary.unprocessedLeadsCount,
    leadsInWork: result.summary.leadsInWorkStaleCount,
    dealsInDialogue: result.summary.dealsInDialogueStaleCount,
  });

  return {
    sheetId: cfg.sheetId,
    sheetTabs: tabs,
    summary: result.summary,
  };
}
