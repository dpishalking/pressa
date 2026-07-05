import { Hono } from "hono";
import { config } from "../config.js";
import { chatSummarySheetTab, CHAT_SUMMARY_HEADERS } from "../integrations/sheets/chat-analytics-write.js";
import {
  BITRIX_LINK_HEADER,
  bitrixDealLink,
  bitrixLeadLink,
  bitrixLostDialogueLink,
  bitrixOpenLineLink,
  bitrixUnpaidInvoiceLink,
} from "../integrations/crm/bitrix-links.js";
import type { ActionListsResult } from "../integrations/crm/bitrix-action-lists.js";
import {
  CHANNEL_SUMMARY_HEADERS,
  channelSummarySheetTab,
  MANAGER_SUMMARY_HEADERS,
  managerSummarySheetTab,
} from "../integrations/sheets/analytics-write.js";
import { parseNumber, readSheetTab, rowsToObjects } from "../integrations/sheets/sheets-read.js";
import {
  buildForecast,
  buildOverview,
  dashboardSheetsConfig,
  fetchActionLists,
} from "../modules/dashboard-service.js";
import { getDashboardPlan, upsertDashboardPlan } from "../modules/dashboard-plans.js";

const CACHE_TTL_MS = 3 * 60 * 1000;

type CacheEntry<T> = { data: T; expiresAt: number };

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.data;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function invalidateCache(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

function currentMonth(): string {
  const tz = process.env.STATS_TIMEZONE ?? "Europe/Moscow";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

function parseMonth(query: string | undefined): string {
  const month = query?.trim() || currentMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("month must be YYYY-MM");
  return month;
}

export const dashboard = new Hono();

dashboard.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  const allowed = config.DASHBOARD_ORIGIN.trim();
  if (allowed && origin === allowed) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
    c.header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  } else if (!allowed) {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
    c.header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  }
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

dashboard.use("*", async (c, next) => {
  const key = c.req.header("x-admin-key");
  if (key !== config.ADMIN_API_KEY) return c.json({ error: "unauthorized" }, 401);
  await next();
});

dashboard.get("/overview", async (c) => {
  try {
    const month = parseMonth(c.req.query("month"));
    const refresh = c.req.query("refresh") === "1";
    const cacheKey = `overview:${month}`;
    if (!refresh) {
      const cached = getCached<Awaited<ReturnType<typeof buildOverview>>>(cacheKey);
      if (cached) return c.json({ ...cached, cached: true });
    }
    const data = await buildOverview(month);
    setCache(cacheKey, data);
    return c.json({ ...data, cached: false });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function withBitrixLinks(result: ActionListsResult): ActionListsResult & {
  unpaidInvoices: Array<ActionListsResult["unpaidInvoices"][0] & { bitrixLink: string }>;
  unansweredChats: Array<ActionListsResult["unansweredChats"][0] & { bitrixLink: string }>;
  thinkDeals: Array<ActionListsResult["thinkDeals"][0] & { bitrixLink: string }>;
  thinkDealsExpired: Array<ActionListsResult["thinkDealsExpired"][0] & { bitrixLink: string }>;
  staleDeals: Array<ActionListsResult["staleDeals"][0] & { bitrixLink: string }>;
  unprocessedLeads: Array<ActionListsResult["unprocessedLeads"][0] & { bitrixLink: string }>;
  leadsInWorkStale: Array<ActionListsResult["leadsInWorkStale"][0] & { bitrixLink: string }>;
  dealsInDialogueStale: Array<ActionListsResult["dealsInDialogueStale"][0] & { bitrixLink: string }>;
} {
  return {
    ...result,
    unpaidInvoices: result.unpaidInvoices.map((row) => ({
      ...row,
      bitrixLink: bitrixUnpaidInvoiceLink(row),
    })),
    unansweredChats: result.unansweredChats.map((row) => ({
      ...row,
      bitrixLink: bitrixLostDialogueLink(row),
    })),
    thinkDeals: result.thinkDeals.map((row) => ({ ...row, bitrixLink: bitrixDealLink(row.dealId) })),
    thinkDealsExpired: result.thinkDealsExpired.map((row) => ({
      ...row,
      bitrixLink: bitrixDealLink(row.dealId),
    })),
    staleDeals: result.staleDeals.map((row) => ({
      ...row,
      bitrixLink:
        row.entityType === "deal" ? bitrixDealLink(row.entityId) : bitrixLeadLink(row.entityId),
    })),
    unprocessedLeads: result.unprocessedLeads.map((row) => ({
      ...row,
      bitrixLink: bitrixLeadLink(row.leadId),
    })),
    leadsInWorkStale: result.leadsInWorkStale.map((row) => ({
      ...row,
      bitrixLink: bitrixLeadLink(row.leadId),
    })),
    dealsInDialogueStale: result.dealsInDialogueStale.map((row) => ({
      ...row,
      bitrixLink: bitrixDealLink(row.dealId),
    })),
  };
}

dashboard.get("/actions", async (c) => {
  try {
    const refresh = c.req.query("refresh") === "1";
    const cacheKey = "actions";
    if (!refresh) {
      const cached = getCached<Awaited<ReturnType<typeof fetchActionLists>>>(cacheKey);
      if (cached) return c.json({ ...cached, cached: true });
    }
    const data = withBitrixLinks(await fetchActionLists());
    setCache(cacheKey, data);
    return c.json({ ...data, cached: false });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

dashboard.get("/chats", async (c) => {
  try {
    const month = parseMonth(c.req.query("month"));
    const cacheKey = `chats:${month}`;
    const refresh = c.req.query("refresh") === "1";
    if (!refresh) {
      const cached = getCached<unknown>(cacheKey);
      if (cached) return c.json(cached);
    }
    const cfg = dashboardSheetsConfig();
    if (!cfg.chatSheetId) return c.json({ error: "ANALYTICS_CHAT_SHEET_ID не настроен" }, 400);
    const tab = chatSummarySheetTab(month);
    const values = await readSheetTab({
      serviceAccountJson: cfg.serviceAccountJson,
      spreadsheetId: cfg.chatSheetId,
      tabTitle: tab,
    });
    const [headerRow, ...dataRows] = values;
    if (!headerRow?.length) {
      return c.json({ month, tab, rows: [], kpis: emptyChatKpis() });
    }
    const rows: Record<string, string>[] = rowsToObjects(CHAT_SUMMARY_HEADERS, dataRows).map((r) => ({
      ...r,
      bitrixLink: r[BITRIX_LINK_HEADER] || bitrixOpenLineLink(r["Сессия"]),
    }));
    const responseTimes = rows
      .map((r) => parseNumber(r["Первый ответ (мин)"]))
      .filter((v) => v > 0);
    const slowCount = responseTimes.filter((v) => v > 30).length;
    const kpis = {
      sessions: rows.length,
      avgFirstResponseMin: responseTimes.length
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : 0,
      slowResponsePct: responseTimes.length ? Math.round((slowCount / responseTimes.length) * 100) : 0,
      totalMessages: rows.reduce((s, r) => s + parseNumber(r["Сообщений"]), 0),
    };
    const payload = { month, tab, rows, kpis, cached: false };
    setCache(cacheKey, payload);
    return c.json(payload);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function emptyChatKpis() {
  return { sessions: 0, avgFirstResponseMin: 0, slowResponsePct: 0, totalMessages: 0 };
}

dashboard.get("/managers", async (c) => {
  try {
    const month = parseMonth(c.req.query("month"));
    const cacheKey = `managers:${month}`;
    const refresh = c.req.query("refresh") === "1";
    if (!refresh) {
      const cached = getCached<unknown>(cacheKey);
      if (cached) return c.json(cached);
    }
    const cfg = dashboardSheetsConfig();
    if (!cfg.managersSheetId) return c.json({ error: "MANAGERS_SHEET_ID не настроен" }, 400);
    const tab = managerSummarySheetTab(month);
    const values = await readSheetTab({
      serviceAccountJson: cfg.serviceAccountJson,
      spreadsheetId: cfg.managersSheetId,
      tabTitle: tab,
    });
    const [, ...dataRows] = values;
    const rows = rowsToObjects(MANAGER_SUMMARY_HEADERS, dataRows).map((r) => ({
      manager: r["Менеджер"],
      leads: parseNumber(r["Лидов"]),
      leadsSharePct: parseNumber(r["Доля лидов, %"]),
      deals: parseNumber(r["Сделок"]),
      revenue: parseNumber(r["Сумма"]),
      currency: r["Валюта"] || "EUR",
      avgCheck: parseNumber(r["Средний чек"]),
      revenueSharePct: parseNumber(r["Доля выручки, %"]),
      conversionPct: parseNumber(r["Конверсия лид→сделка, %"]),
    }));
    const payload = { month, tab, rows, cached: false };
    setCache(cacheKey, payload);
    return c.json(payload);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

dashboard.get("/traffic", async (c) => {
  try {
    const month = parseMonth(c.req.query("month"));
    const cacheKey = `traffic:${month}`;
    const refresh = c.req.query("refresh") === "1";
    if (!refresh) {
      const cached = getCached<unknown>(cacheKey);
      if (cached) return c.json(cached);
    }
    const cfg = dashboardSheetsConfig();
    if (!cfg.analyticsSheetId) return c.json({ error: "ANALYTICS_SHEET_ID не настроен" }, 400);
    const tab = channelSummarySheetTab(month);
    const values = await readSheetTab({
      serviceAccountJson: cfg.serviceAccountJson,
      spreadsheetId: cfg.analyticsSheetId,
      tabTitle: tab,
    });
    const [, ...dataRows] = values;
    const rows = rowsToObjects(CHANNEL_SUMMARY_HEADERS, dataRows).map((r) => ({
      channel: r["Канал"],
      sessions: parseNumber(r["Сессии ОЛ"]),
      leads: parseNumber(r["Лидов"]),
      leadsSharePct: parseNumber(r["Доля лидов, %"]),
      deals: parseNumber(r["Сделок"]),
      revenue: parseNumber(r["Сумма"]),
      currency: r["Валюта"] || "EUR",
      avgCheck: parseNumber(r["Средний чек"]),
      revenueSharePct: parseNumber(r["Доля выручки, %"]),
      conversionPct: parseNumber(r["Конверсия лид→сделка, %"]),
    }));
    const totals = rows.reduce(
      (acc, r) => ({
        sessions: acc.sessions + r.sessions,
        leads: acc.leads + r.leads,
        deals: acc.deals + r.deals,
        revenue: acc.revenue + r.revenue,
      }),
      { sessions: 0, leads: 0, deals: 0, revenue: 0 },
    );
    const payload = { month, tab, rows, totals, cached: false };
    setCache(cacheKey, payload);
    return c.json(payload);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

dashboard.get("/plan", (c) => {
  try {
    const month = parseMonth(c.req.query("month"));
    const plan = getDashboardPlan(month);
    return c.json({ month, plan });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

dashboard.put("/plan", async (c) => {
  try {
    const body = await c.req.json<{ month?: string; leads?: number; deals?: number; revenueEur?: number }>();
    const month = parseMonth(body.month);
    const plan = upsertDashboardPlan({
      month,
      leads: Number(body.leads) || 0,
      deals: Number(body.deals) || 0,
      revenueEur: Number(body.revenueEur) || 0,
    });
    invalidateCache("overview:");
    return c.json({ plan });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

dashboard.get("/forecast", async (c) => {
  try {
    const month = parseMonth(c.req.query("month"));
    const refresh = c.req.query("refresh") === "1";
    const cacheKey = `forecast:${month}`;
    if (!refresh) {
      const cached = getCached<Awaited<ReturnType<typeof buildForecast>>>(cacheKey);
      if (cached) return c.json({ ...cached, cached: true });
    }
    const data = await buildForecast(month);
    setCache(cacheKey, data);
    return c.json({ ...data, cached: false });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
