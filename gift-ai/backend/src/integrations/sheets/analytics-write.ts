import { getGoogleAccessToken, type GoogleServiceAccount } from "./google-auth.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export const LEAD_HEADERS = [
  "ID",
  "Дата создания",
  "Дата изменения",
  "Название",
  "Статус",
  "Сумма",
  "Валюта",
  "Страна",
  "Источник",
  "Менеджер ID",
  "Комментарий",
] as const;

export const DEAL_HEADERS = [
  "ID",
  "Дата создания",
  "Дата изменения",
  "Дата закрытия",
  "Название",
  "Стадия",
  "Сумма",
  "Валюта",
  "Страна",
  "Источник",
  "Менеджер ID",
  "Комментарий",
] as const;

/** Единый лист: лиды и сделки всех стран */
export const COMBINED_HEADERS = [
  "Тип",
  "ID",
  "Дата создания",
  "Дата изменения",
  "Дата закрытия",
  "Название",
  "Статус / стадия",
  "Сумма",
  "Валюта",
  "Страна",
  "Источник",
  "Менеджер ID",
  "Комментарий",
] as const;

/** Сводка лидов и продаж по странам за месяц */
export const SALES_SUMMARY_HEADERS = [
  "Страна",
  "Лидов",
  "Сделок",
  "Сумма",
  "Валюта",
  "Средний чек",
] as const;

/** Сводка продаж по подаркам/товарам за месяц */
export const PRODUCT_SUMMARY_HEADERS = [
  "Подарок",
  "Сделок",
  "Сумма",
  "Валюта",
  "Средний чек",
] as const;

export const CHANNEL_SUMMARY_HEADERS = [
  "Канал",
  "Сессии ОЛ",
  "Лидов",
  "Доля лидов, %",
  "Сделок",
  "Сумма",
  "Валюта",
  "Средний чек",
  "Доля выручки, %",
  "Конверсия лид→сделка, %",
] as const;

export const MANAGER_SUMMARY_HEADERS = [
  "Менеджер",
  "Лидов",
  "Доля лидов, %",
  "Сделок",
  "Сумма",
  "Валюта",
  "Средний чек",
  "Доля выручки, %",
  "Конверсия лид→сделка, %",
] as const;

export const MANAGER_COUNTRY_HEADERS = [
  "Страна",
  "Лидов",
  "Сделок",
  "Сумма",
  "Валюта",
  "Средний чек",
] as const;

export const MANAGER_DEAL_HEADERS = [
  "ID",
  "Дата закрытия",
  "Название",
  "Сумма",
  "Валюта",
  "Страна",
  "Источник",
] as const;

export const ACTIONS_SUMMARY_HEADERS = ["Метрика", "Значение"] as const;

export const UNPAID_INVOICE_HEADERS = [
  "Счёт",
  "Сделка",
  "Клиент",
  "Сумма",
  "Валюта",
  "Дата",
  "Дней без оплаты",
  "Менеджер",
  "Телефон",
] as const;

export const UNANSWERED_CHAT_HEADERS = [
  "Сессия",
  "Канал",
  "Клиент",
  "Менеджер",
  "Ждёт (ч)",
  "Последнее сообщение",
] as const;

export const STALE_DEAL_HEADERS = [
  "Сделка",
  "Название",
  "Стадия",
  "Сумма",
  "Валюта",
  "Дней без движения",
  "Менеджер",
  "Телефон",
] as const;

export const UNPROCESSED_LEAD_HEADERS = [
  "Лид",
  "Название",
  "Источник",
  "Страна",
  "Создан",
  "Часов без обработки",
  "Менеджер",
  "Телефон",
] as const;

export const SLOW_RESPONSE_HEADERS = [
  "Сессия",
  "Канал",
  "Менеджер",
  "Первый ответ (мин)",
  "Дата",
] as const;

export function actionsSummaryTab(): string {
  return "Сводка дня";
}

export function unpaidInvoicesTab(): string {
  return "Счета без оплаты";
}

export function unansweredChatsTab(): string {
  return "Чаты без ответа";
}

export function staleDealsTab(): string {
  return "Зависшие сделки";
}

export function unprocessedLeadsTab(): string {
  return "Необработанные лиды";
}

export function slowResponsesTab(): string {
  return "Медленный ответ";
}

export const LTV_OVERVIEW_HEADERS = ["Метрика", "Значение"] as const;

export const CUSTOMER_LTV_HEADERS = [
  "Контакт ID",
  "Имя",
  "Телефон",
  "Email",
  "Страна",
  "Когорта",
  "Первая покупка",
  "Покупок",
  "LTV",
  "Тип",
] as const;

export const COHORT_REVENUE_HEADERS = ["Когорта", "Клиентов"] as const;
export const COHORT_RETENTION_HEADERS = ["Когорта", "Клиентов"] as const;

/** Процент для Google Sheets */
export function sheetPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

export function ltvOverviewSheetTab(): string {
  return "LTV сводка";
}

export function customerLtvSheetTab(): string {
  return "Клиенты LTV";
}

export function cohortRevenueSheetTab(): string {
  return "Когорты выручка";
}

export function cohortRetentionSheetTab(): string {
  return "Когорты повтор";
}

export function cohortMatrixHeaders(maxOffset: number): string[] {
  return ["Когорта", "Клиентов", ...Array.from({ length: maxOffset + 1 }, (_, i) => `M+${i}`)];
}

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

export type SheetCell = string | number;

/** Защита от формул Google Sheets (= в начале → #ERROR!) */
export function sheetText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[=+\-@]/.test(trimmed)) return `'${trimmed}`;
  return trimmed;
}

/** Число для Google Sheets — без «13857.00», можно навесить формат € */
export function sheetAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export type AnalyticsLeadRow = {
  id: string;
  dateCreate: string;
  dateModify: string;
  title: string;
  status: string;
  amount: string | number;
  currency: string;
  country: string;
  source: string;
  managerId: string;
  comments: string;
};

export type AnalyticsDealRow = {
  id: string;
  dateCreate: string;
  dateModify: string;
  closeDate: string;
  title: string;
  stage: string;
  amount: string | number;
  currency: string;
  country: string;
  source: string;
  managerId: string;
  comments: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastSheetsWriteAt = 0;
const SHEETS_WRITE_GAP_MS = 1200;

async function throttleSheetsWrite(): Promise<void> {
  const wait = SHEETS_WRITE_GAP_MS - (Date.now() - lastSheetsWriteAt);
  if (wait > 0) await sleep(wait);
  lastSheetsWriteAt = Date.now();
}

async function sheetsFetch(url: string, init: RequestInit, write = false): Promise<Response> {
  if (write) await throttleSheetsWrite();
  const res = await fetch(url, init);
  if (write && res.status === 429) {
    await sleep(65_000);
    await throttleSheetsWrite();
    return fetch(url, init);
  }
  return res;
}

function sheetsHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function sanitizeSheetTitle(tag: string): string {
  const cleaned = tag.replace(/[:\\/?*\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  return cleaned || "Без названия";
}

export function countrySheetTab(countryTag: string, kind: "leads" | "deals"): string {
  const suffix = kind === "leads" ? "лиды" : "продажи";
  return sanitizeSheetTitle(`${countryTag} — ${suffix}`);
}

export function combinedSheetTab(range: { from: string; to: string }): string {
  const lastDay = addDaysIso(range.to, -1);
  const label = range.from === lastDay ? range.from : `${range.from} — ${lastDay}`;
  return sanitizeSheetTitle(`Выгрузка ${label}`);
}

export function summarySheetTab(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const name = MONTH_NAMES_RU[month - 1] ?? yearMonth;
  return sanitizeSheetTitle(`Сводка ${name} ${year}`);
}

export function productSummarySheetTab(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const name = MONTH_NAMES_RU[month - 1] ?? yearMonth;
  return sanitizeSheetTitle(`Подарки ${name} ${year}`);
}

export function channelSummarySheetTab(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const name = MONTH_NAMES_RU[month - 1] ?? yearMonth;
  return sanitizeSheetTitle(`Каналы ${name} ${year}`);
}

export function managerSummarySheetTab(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const name = MONTH_NAMES_RU[month - 1] ?? yearMonth;
  return sanitizeSheetTitle(`Менеджеры ${name} ${year}`);
}

export function managerDetailSheetTab(managerLabel: string, yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const name = MONTH_NAMES_RU[month - 1] ?? yearMonth;
  return sanitizeSheetTitle(`${managerLabel} — ${name} ${year}`);
}

export function monthLabelRu(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const name = MONTH_NAMES_RU[month - 1] ?? yearMonth;
  return `${name} ${year}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function columnLetter(count: number): string {
  let n = count;
  let label = "";
  while (n > 0) {
    n -= 1;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label || "A";
}

export function tabRange(tabTitle: string, a1: string, b1: string): string {
  return `'${tabTitle.replace(/'/g, "''")}'!${a1}:${b1}`;
}

async function getSpreadsheetMeta(token: string, sheetId: string): Promise<{ sheetId: number; title: string }[]> {
  const res = await sheetsFetch(`${SHEETS_API}/${sheetId}?fields=sheets.properties`, {
    headers: sheetsHeaders(token),
  });
  const json = (await res.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(json.error?.message ?? `Sheets meta failed: HTTP ${res.status}`);
  return (json.sheets ?? [])
    .map((sheet) => ({
      sheetId: sheet.properties?.sheetId ?? 0,
      title: sheet.properties?.title ?? "",
    }))
    .filter((sheet) => sheet.title);
}

async function createSheetTabs(token: string, spreadsheetId: string, titles: string[]): Promise<void> {
  if (!titles.length) return;
  const res = await sheetsFetch(
    `${SHEETS_API}/${spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      headers: sheetsHeaders(token),
      body: JSON.stringify({
        requests: titles.map((title) => ({ addSheet: { properties: { title } } })),
      }),
    },
    true,
  );
  const json = (await res.json()) as { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Create sheet tabs failed: HTTP ${res.status}`);
}

async function createSheetTab(token: string, spreadsheetId: string, title: string): Promise<void> {
  await createSheetTabs(token, spreadsheetId, [title]);
}

async function ensureHeaders(
  token: string,
  spreadsheetId: string,
  tabTitle: string,
  headers: readonly string[],
): Promise<void> {
  const endCol = String.fromCharCode(64 + headers.length);
  const range = `'${tabTitle.replace(/'/g, "''")}'!A1:${endCol}1`;
  const res = await sheetsFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: sheetsHeaders(token),
      body: JSON.stringify({ values: [headers] }),
    },
    true,
  );
  const json = (await res.json()) as { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Write headers failed: HTTP ${res.status}`);
}

export async function prepareAnalyticsWorkbook(
  account: GoogleServiceAccount,
  spreadsheetId: string,
  tabs: Array<{ title: string; headers: readonly string[] }>,
): Promise<void> {
  const token = await getGoogleAccessToken(account);
  const existing = new Set((await getSpreadsheetMeta(token, spreadsheetId)).map((tab) => tab.title));
  const missing = tabs.map((tab) => tab.title).filter((title) => !existing.has(title));

  for (let i = 0; i < missing.length; i += 10) {
    await createSheetTabs(token, spreadsheetId, missing.slice(i, i + 10));
  }

  for (const tab of tabs) {
    if (existing.has(tab.title)) continue;
    await ensureHeaders(token, spreadsheetId, tab.title, tab.headers);
  }
}

export async function ensureAnalyticsSheetTab(
  account: GoogleServiceAccount,
  spreadsheetId: string,
  tabTitle: string,
  headers: readonly string[],
): Promise<string> {
  const token = await getGoogleAccessToken(account);
  const tabs = await getSpreadsheetMeta(token, spreadsheetId);
  if (!tabs.some((tab) => tab.title === tabTitle)) {
    await createSheetTab(token, spreadsheetId, tabTitle);
  } else {
    return tabTitle;
  }
  await ensureHeaders(token, spreadsheetId, tabTitle, headers);
  return tabTitle;
}

export async function readExistingIds(
  account: GoogleServiceAccount,
  spreadsheetId: string,
  tabTitle: string,
): Promise<Set<string>> {
  const token = await getGoogleAccessToken(account);
  const range = `'${tabTitle.replace(/'/g, "''")}'!A2:A`;
  const res = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
    headers: sheetsHeaders(token),
  });
  const json = (await res.json()) as { values?: string[][]; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Read IDs failed: HTTP ${res.status}`);

  const ids = new Set<string>();
  for (const row of json.values ?? []) {
    const id = row[0]?.trim();
    if (id) ids.add(id);
  }
  return ids;
}

export async function appendRows(
  account: GoogleServiceAccount,
  spreadsheetId: string,
  tabTitle: string,
  rows: SheetCell[][],
): Promise<number> {
  if (!rows.length) return 0;

  const token = await getGoogleAccessToken(account);
  const range = `'${tabTitle.replace(/'/g, "''")}'!A:Z`;
  const res = await sheetsFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: sheetsHeaders(token),
      body: JSON.stringify({ values: rows }),
    },
    true,
  );
  const json = (await res.json()) as { updates?: { updatedRows?: number }; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Append rows failed: HTTP ${res.status}`);
  return json.updates?.updatedRows ?? rows.length;
}

export async function appendLeadRows(
  account: GoogleServiceAccount,
  spreadsheetId: string,
  tabTitle: string,
  rows: AnalyticsLeadRow[],
): Promise<number> {
  return appendRows(
    account,
    spreadsheetId,
    tabTitle,
    rows.map((row) => [
      row.id,
      row.dateCreate,
      row.dateModify,
      row.title,
      row.status,
      row.amount,
      row.currency,
      row.country,
      row.source,
      row.managerId,
      row.comments,
    ]),
  );
}

export async function appendDealRows(
  account: GoogleServiceAccount,
  spreadsheetId: string,
  tabTitle: string,
  rows: AnalyticsDealRow[],
): Promise<number> {
  return appendRows(
    account,
    spreadsheetId,
    tabTitle,
    rows.map((row) => [
      row.id,
      row.dateCreate,
      row.dateModify,
      row.closeDate,
      row.title,
      row.stage,
      row.amount,
      row.currency,
      row.country,
      row.source,
      row.managerId,
      row.comments,
    ]),
  );
}

export function leadToCombinedRow(row: AnalyticsLeadRow): SheetCell[] {
  return [
    "Лид",
    row.id,
    row.dateCreate,
    row.dateModify,
    "",
    row.title,
    row.status,
    row.amount,
    row.currency,
    row.country,
    row.source,
    row.managerId,
    row.comments,
  ];
}

export function dealToCombinedRow(row: AnalyticsDealRow): SheetCell[] {
  return [
    "Сделка",
    row.id,
    row.dateCreate,
    row.dateModify,
    row.closeDate,
    row.title,
    row.stage,
    row.amount,
    row.currency,
    row.country,
    row.source,
    row.managerId,
    row.comments,
  ];
}

/** Перезаписывает вкладку произвольной сеткой (без фиксированных заголовков) */
export async function writeRawSheetTab(
  account: GoogleServiceAccount,
  spreadsheetId: string,
  tabTitle: string,
  rows: SheetCell[][],
): Promise<number> {
  const token = await getGoogleAccessToken(account);
  await prepareAnalyticsWorkbook(account, spreadsheetId, [{ title: tabTitle, headers: ["A"] }]);

  const clearRange = encodeURIComponent(tabRange(tabTitle, "A1", "Z100000"));
  const clearRes = await sheetsFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${clearRange}:clear`,
    { method: "POST", headers: sheetsHeaders(token) },
    true,
  );
  if (!clearRes.ok) {
    const json = (await clearRes.json()) as { error?: { message?: string } };
    throw new Error(json.error?.message ?? `Clear sheet failed: HTTP ${clearRes.status}`);
  }

  if (!rows.length) return 0;

  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 1);
  const dataRange = encodeURIComponent(tabRange(tabTitle, "A1", `${columnLetter(maxCols)}${rows.length}`));
  const res = await sheetsFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${dataRange}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: sheetsHeaders(token),
      body: JSON.stringify({ values: rows }),
    },
    true,
  );
  const json = (await res.json()) as { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Write sheet failed: HTTP ${res.status}`);
  return rows.length;
}

/** Перезаписывает вкладку целиком — один запрос на данные */
export async function writeSheetContent(
  account: GoogleServiceAccount,
  spreadsheetId: string,
  tabTitle: string,
  headers: readonly string[],
  rows: SheetCell[][],
): Promise<number> {
  const token = await getGoogleAccessToken(account);
  await prepareAnalyticsWorkbook(account, spreadsheetId, [{ title: tabTitle, headers }]);

  const clearRange = encodeURIComponent(tabRange(tabTitle, "A2", `${columnLetter(headers.length)}100000`));
  const clearRes = await sheetsFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${clearRange}:clear`,
    { method: "POST", headers: sheetsHeaders(token) },
    true,
  );
  if (!clearRes.ok) {
    const json = (await clearRes.json()) as { error?: { message?: string } };
    throw new Error(json.error?.message ?? `Clear sheet failed: HTTP ${clearRes.status}`);
  }

  const values = [headers, ...rows];
  if (values.length === 1) {
    const headerRange = encodeURIComponent(tabRange(tabTitle, "A1", `${columnLetter(headers.length)}1`));
    const res = await sheetsFetch(
      `${SHEETS_API}/${spreadsheetId}/values/${headerRange}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: sheetsHeaders(token),
        body: JSON.stringify({ values: [headers] }),
      },
      true,
    );
    const json = (await res.json()) as { error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `Write headers failed: HTTP ${res.status}`);
    return 0;
  }

  const dataRange = encodeURIComponent(
    tabRange(tabTitle, "A1", `${columnLetter(headers.length)}${values.length}`),
  );
  const res = await sheetsFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${dataRange}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: sheetsHeaders(token),
      body: JSON.stringify({ values }),
    },
    true,
  );
  const json = (await res.json()) as { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Write sheet failed: HTTP ${res.status}`);
  return rows.length;
}

// Backward-compatible aliases
export const ensureCountrySheetTab = (
  account: GoogleServiceAccount,
  spreadsheetId: string,
  countryTag: string,
) => ensureAnalyticsSheetTab(account, spreadsheetId, countrySheetTab(countryTag, "leads"), LEAD_HEADERS);

export const readExistingLeadIds = readExistingIds;
