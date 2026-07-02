import { getGoogleAccessToken, type GoogleServiceAccount } from "./google-auth.js";
import {
  columnLetter,
  prepareAnalyticsWorkbook,
  tabRange,
  type SheetCell,
} from "./analytics-write.js";
import { BITRIX_LINK_HEADER } from "../crm/bitrix-links.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

const MONTH_NAMES_RU = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
] as const;

export const CHAT_SUMMARY_HEADERS = [
  "Сессия",
  "Дата",
  "Канал",
  "Клиент",
  "Лид",
  "Менеджер",
  "Сообщений",
  "От клиента",
  "От менеджера",
  "Системных",
  "Первый ответ (мин)",
  BITRIX_LINK_HEADER,
] as const;

export const CHAT_MESSAGE_HEADERS = ["Сессия", "Дата", "Автор", "Текст", BITRIX_LINK_HEADER] as const;

export function chatSummarySheetTab(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const name = MONTH_NAMES_RU[month - 1] ?? yearMonth;
  return `Чаты ${name} ${year}`.slice(0, 90);
}

export function chatMessagesSheetTab(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const name = MONTH_NAMES_RU[month - 1] ?? yearMonth;
  return `Сообщения ${name} ${year}`.slice(0, 90);
}

let lastSheetsWriteAt = 0;
const SHEETS_WRITE_GAP_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(): Promise<void> {
  const wait = SHEETS_WRITE_GAP_MS - (Date.now() - lastSheetsWriteAt);
  if (wait > 0) await sleep(wait);
  lastSheetsWriteAt = Date.now();
}

async function sheetsPut(
  token: string,
  spreadsheetId: string,
  range: string,
  values: SheetCell[][],
): Promise<void> {
  await throttle();
  const res = await fetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    },
  );
  const json = (await res.json()) as { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Sheets write failed: HTTP ${res.status}`);
}

async function sheetsClear(token: string, spreadsheetId: string, range: string): Promise<void> {
  await throttle();
  const res = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const json = (await res.json()) as { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Sheets clear failed: HTTP ${res.status}`);
}

async function ensureSheetRows(
  token: string,
  spreadsheetId: string,
  tabTitle: string,
  minRows: number,
): Promise<void> {
  const res = await fetch(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as {
    sheets?: Array<{
      properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number } };
    }>;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(json.error?.message ?? `Sheets meta failed: HTTP ${res.status}`);

  const sheet = json.sheets?.find((tab) => tab.properties?.title === tabTitle);
  const sheetId = sheet?.properties?.sheetId;
  const rowCount = sheet?.properties?.gridProperties?.rowCount ?? 1000;
  if (!sheetId || minRows <= rowCount) return;

  await throttle();
  const update = await fetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          appendDimension: {
            sheetId,
            dimension: "ROWS",
            length: minRows - rowCount,
          },
        },
      ],
    }),
  });
  const updateJson = (await update.json()) as { error?: { message?: string } };
  if (!update.ok) throw new Error(updateJson.error?.message ?? `Expand sheet failed: HTTP ${update.status}`);
}

export async function writeChatSheets(opts: {
  account: GoogleServiceAccount;
  spreadsheetId: string;
  yearMonth: string;
  summaryRows: SheetCell[][];
  messageRows: SheetCell[][];
}): Promise<{ summaryWritten: number; messagesWritten: number }> {
  const summaryTab = chatSummarySheetTab(opts.yearMonth);
  const messagesTab = chatMessagesSheetTab(opts.yearMonth);
  const token = await getGoogleAccessToken(opts.account);

  await prepareAnalyticsWorkbook(opts.account, opts.spreadsheetId, [
    { title: summaryTab, headers: CHAT_SUMMARY_HEADERS },
    { title: messagesTab, headers: CHAT_MESSAGE_HEADERS },
  ]);

  const messageRowCount = opts.messageRows.length + 1;
  const summaryRowCount = opts.summaryRows.length + 1;
  await ensureSheetRows(token, opts.spreadsheetId, messagesTab, messageRowCount);
  await ensureSheetRows(token, opts.spreadsheetId, summaryTab, summaryRowCount);

  await sheetsClear(
    token,
    opts.spreadsheetId,
    tabRange(summaryTab, "A2", `${columnLetter(CHAT_SUMMARY_HEADERS.length)}${summaryRowCount}`),
  );
  await sheetsClear(
    token,
    opts.spreadsheetId,
    tabRange(messagesTab, "A2", `${columnLetter(CHAT_MESSAGE_HEADERS.length)}${messageRowCount}`),
  );

  const summaryValues = [[...CHAT_SUMMARY_HEADERS], ...opts.summaryRows];
  await sheetsPut(
    token,
    opts.spreadsheetId,
    tabRange(summaryTab, "A1", `${columnLetter(CHAT_SUMMARY_HEADERS.length)}${summaryValues.length}`),
    summaryValues,
  );

  const headerRow = [[...CHAT_MESSAGE_HEADERS]];
  await sheetsPut(
    token,
    opts.spreadsheetId,
    tabRange(messagesTab, "A1", `${columnLetter(CHAT_MESSAGE_HEADERS.length)}1`),
    headerRow,
  );

  const chunkSize = 4000;
  let messagesWritten = 0;
  for (let i = 0; i < opts.messageRows.length; i += chunkSize) {
    const chunk = opts.messageRows.slice(i, i + chunkSize);
    const startRow = i + 2;
    const endRow = startRow + chunk.length - 1;
    await sheetsPut(
      token,
      opts.spreadsheetId,
      tabRange(messagesTab, `A${startRow}`, `${columnLetter(CHAT_MESSAGE_HEADERS.length)}${endRow}`),
      chunk,
    );
    messagesWritten += chunk.length;
  }

  return { summaryWritten: opts.summaryRows.length, messagesWritten };
}
