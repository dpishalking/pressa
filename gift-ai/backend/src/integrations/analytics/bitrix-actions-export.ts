import { buildActionLists, DEFAULT_THRESHOLDS, type ActionListsResult } from "../crm/bitrix-action-lists.js";
import {
  dealInDialogueSheetRows,
  leadInWorkSheetRows,
  lostDialogueSheetRows,
  staleDealSheetRows,
  thinkDealSheetRows,
  unpaidInvoiceSheetRows,
  unprocessedLeadSheetRows,
} from "../crm/action-sheet-rows.js";
import { actionsExportConfig } from "./actions-config.js";
import {
  ACTIONS_SUMMARY_HEADERS,
  LOST_DIALOGUE_HEADERS,
  THINK_DEAL_HEADERS,
  STALE_DEAL_HEADERS,
  UNPAID_INVOICE_HEADERS,
  UNPROCESSED_LEAD_HEADERS,
  LEAD_IN_WORK_HEADERS,
  DEAL_IN_DIALOGUE_HEADERS,
  actionsSummaryTab,
  lostDialoguesTab,
  thinkDealsTab,
  deleteSheetTabs,
  staleDealsTab,
  unprocessedLeadsTab,
  leadsInWorkTab,
  dealsInDialogueTab,
  unpaidInvoicesTab,
  sheetAmount,
  sheetPct,
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
  const thinkDays = DEFAULT_THRESHOLDS.thinkDealMaxOverdueDays;
  return [
    ["Обновлено", s.updatedAt],
    ["Неоплаченных счетов", s.unpaidInvoicesCount],
    ["Сумма неоплаченных счетов", sheetAmount(s.unpaidInvoicesEur)],
    [`Клиент не ответил (>${DEFAULT_THRESHOLDS.clientNoReplyMinHours}ч)`, s.staleDealsCount],
    ["Сумма (сделки без ответа)", sheetAmount(s.staleDealsEur)],
    ["Потерянных диалогов", s.unansweredChatsCount],
    [`«Я подумаю» (до ${thinkDays} дн)`, s.thinkDealsCount],
    ["Сумма «Я подумаю»", sheetAmount(s.thinkDealsEur)],
    [`«Я подумаю» закрыть (>${thinkDays} дн)`, s.thinkDealsExpiredCount],
    ["Необработанных лидов", s.unprocessedLeadsCount],
    [`Лид в работе >${DEFAULT_THRESHOLDS.leadInWorkStaleHours}ч`, s.leadsInWorkStaleCount],
    [`В диалоге без ответа >${DEFAULT_THRESHOLDS.dealInDialogueNoResponseHours}ч`, s.dealsInDialogueStaleCount],
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
    lostDialoguesTab(),
    thinkDealsTab(),
    staleDealsTab(),
    unprocessedLeadsTab(),
    leadsInWorkTab(),
    dealsInDialogueTab(),
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
    unpaidInvoiceSheetRows(result.unpaidInvoices, cfg.baseCurrency),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[2]!,
    LOST_DIALOGUE_HEADERS,
    lostDialogueSheetRows(result.unansweredChats),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[3]!,
    THINK_DEAL_HEADERS,
    thinkDealSheetRows(result.thinkDeals, cfg.baseCurrency),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[4]!,
    STALE_DEAL_HEADERS,
    staleDealSheetRows(result.staleDeals, cfg.baseCurrency),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[5]!,
    UNPROCESSED_LEAD_HEADERS,
    unprocessedLeadSheetRows(result.unprocessedLeads),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[6]!,
    LEAD_IN_WORK_HEADERS,
    leadInWorkSheetRows(result.leadsInWorkStale),
  );

  await writeSheetContent(
    account,
    cfg.sheetId,
    tabs[7]!,
    DEAL_IN_DIALOGUE_HEADERS,
    dealInDialogueSheetRows(result.dealsInDialogueStale, cfg.baseCurrency),
  );

  const removedTabs = await deleteSheetTabs(account, cfg.sheetId, [
    "Я подумаю",
    "Я подумаю закрыть",
    "Зависшие сделки",
    "Медленный ответ",
  ]);
  if (removedTabs.length) {
    logger.info("Removed legacy think-deal tabs", { removedTabs });
  }

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
