import { collectSessionChats, type SessionChatStats } from "../crm/bitrix-openlines.js";
import { bitrixSessionLink, bitrixOpenLineLink } from "../crm/bitrix-links.js";
import { writeChatSheets, chatSummarySheetTab, chatMessagesSheetTab } from "../sheets/chat-analytics-write.js";
import { sheetText, type SheetCell } from "../sheets/analytics-write.js";
import { loadServiceAccount } from "../sheets/google-auth.js";
import { chatExportConfig } from "./chat-config.js";
import { monthRange, type ExportDateRange } from "./bitrix-country-export.js";
import { logger } from "../../logger.js";

export type BitrixChatExportSummary = {
  range: ExportDateRange;
  month: string;
  sessions: number;
  messages: number;
  sheetTabs: { summary: string; messages: string };
};

const AUTHOR_LABEL: Record<string, string> = {
  client: "Клиент",
  manager: "Менеджер",
  system: "Система",
};

function sessionSummaryRows(stats: SessionChatStats[]): SheetCell[][] {
  return stats.map((row) => [
    row.session.sessionId,
    row.session.created.slice(0, 10),
    row.session.channel,
    row.session.clientLabel,
    row.session.ownerTypeId === "1" ? row.session.ownerId : "",
    row.session.responsibleId,
    row.totalCount,
    row.clientCount,
    row.managerCount,
    row.systemCount,
    row.firstResponseMinutes ?? "",
    bitrixSessionLink(row.session),
  ]);
}

function sessionMessageRows(stats: SessionChatStats[]): SheetCell[][] {
  const rows: SheetCell[][] = [];
  for (const session of stats) {
    for (const message of session.messages) {
      if (message.author === "system" || !message.text.trim()) continue;
      rows.push([
        session.session.sessionId,
        message.date,
        AUTHOR_LABEL[message.author] ?? message.author,
        sheetText(message.text.slice(0, 5000)),
        bitrixOpenLineLink(session.session.sessionId),
      ]);
    }
  }
  return rows;
}

export async function exportBitrixChats(opts?: {
  month?: string;
  range?: ExportDateRange;
  limit?: number;
}): Promise<BitrixChatExportSummary> {
  const cfg = chatExportConfig();
  const month = opts?.month ?? opts?.range?.from.slice(0, 7) ?? "";
  const range = opts?.range ?? (month ? monthRange(month) : { from: "", to: "" });
  const account = loadServiceAccount(cfg.serviceAccountJson);

  const stats = await collectSessionChats({
    range,
    limit: opts?.limit,
    onProgress: (done, total, sessionId) => {
      if (done % 50 === 0 || done === total) {
        logger.info("Chat export progress", { done, total, sessionId, month });
      }
    },
  });

  const summaryRows = sessionSummaryRows(stats);
  const messageRows = sessionMessageRows(stats);
  const yearMonth = month || range.from.slice(0, 7);

  const written = await writeChatSheets({
    account,
    spreadsheetId: cfg.sheetId,
    yearMonth,
    summaryRows,
    messageRows,
  });

  const sheetTabs = {
    summary: chatSummarySheetTab(yearMonth),
    messages: chatMessagesSheetTab(yearMonth),
  };

  logger.info("Chat export written", {
    month: yearMonth,
    range,
    sessions: written.summaryWritten,
    messages: written.messagesWritten,
    sheetId: cfg.sheetId,
  });

  return {
    range,
    month: yearMonth,
    sessions: written.summaryWritten,
    messages: written.messagesWritten,
    sheetTabs,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function exportBitrixChatsForMonths(opts: {
  months: string[];
  limit?: number;
}): Promise<BitrixChatExportSummary[]> {
  const results: BitrixChatExportSummary[] = [];
  for (const month of opts.months) {
    results.push(await exportBitrixChats({ month, limit: opts.limit }));
    await sleep(3000);
  }
  return results;
}
