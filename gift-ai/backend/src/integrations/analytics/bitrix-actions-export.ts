import { buildActionLists, type ActionListsResult } from "../crm/bitrix-action-lists.js";
import { actionsExportConfig } from "./actions-config.js";
import {
  ACTIONS_SUMMARY_HEADERS,
  SLOW_RESPONSE_HEADERS,
  STALE_DEAL_HEADERS,
  UNANSWERED_CHAT_HEADERS,
  UNPAID_INVOICE_HEADERS,
  UNPROCESSED_LEAD_HEADERS,
  actionsSummaryTab,
  slowResponsesTab,
  staleDealsTab,
  unansweredChatsTab,
  unpaidInvoicesTab,
  unprocessedLeadsTab,
  sheetAmount,
  sheetPct,
  sheetText,
  writeSheetContent,
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
  return [
    ["Обновлено", s.updatedAt],
    ["Неоплаченных счетов", s.unpaidInvoicesCount],
    ["Сумма неоплаченных счетов", sheetAmount(s.unpaidInvoicesEur)],
    ["Зависших сделок", s.staleDealsCount],
    ["Сумма зависших сделок", sheetAmount(s.staleDealsEur)],
    ["Чатов без ответа", s.unansweredChatsCount],
    ["Необработанных лидов", s.unprocessedLeadsCount],
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
    unansweredChatsTab(),
    staleDealsTab(),
    unprocessedLeadsTab(),
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
    UNANSWERED_CHAT_HEADERS,
    result.unansweredChats.map((row) => [
      row.sessionId,
      row.channel,
      sheetText(row.clientLabel),
      sheetText(row.managerName),
      row.waitingHours,
      sheetText(row.lastClientMessage),
    ]),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[3]!,
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
    tabs[4]!,
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
    tabs[5]!,
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
    stale: result.summary.staleDealsCount,
    leads: result.summary.unprocessedLeadsCount,
  });

  return {
    sheetId: cfg.sheetId,
    sheetTabs: tabs,
    summary: result.summary,
  };
}
