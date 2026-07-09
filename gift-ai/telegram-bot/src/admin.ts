import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { escHtml } from "./format.js";

const API_URL = (process.env.API_URL ?? "http://localhost:3100").replace(/\/$/, "");
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? "";

function parseAdminAllowlist(raw: string): { ids: Set<string>; usernames: Set<string> } {
  const ids = new Set<string>();
  const usernames = new Set<string>();
  for (const entry of raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)) {
    const normalized = entry.replace(/^@/, "");
    if (/^\d+$/.test(normalized)) ids.add(normalized);
    else usernames.add(normalized.toLowerCase());
  }
  return { ids, usernames };
}

const ADMIN_ALLOWLIST = parseAdminAllowlist(process.env.ADMIN_TELEGRAM_IDS ?? "");

export type BotApplication = {
  id: string;
  channelUserId: string;
  occasion: string;
  recipient: string;
  gift: string;
  budget: string;
  telegram: string;
  status: string;
  createdAt: string;
};

export type BotStats = {
  period: "all" | "today";
  uniqueVisitors: number;
  botStarts: number;
  consultStarts: number;
  catalogOpens: number;
  userMessages: number;
  applicationsReady: number;
  managerClicks: number;
  leadsStored: number;
  crmLeads: number;
  activeConsultations: number;
  abandoned: number;
  avgLeadScore: number;
  funnel: {
    visitors: number;
    consult: number;
    handoff: number;
    managerClick: number;
    consultRate: number;
    handoffRate: number;
    clickRate: number;
  };
  topOccasions: [string, number][];
  topGifts: [string, number][];
  recentApplications: BotApplication[];
};

export type ApplicationsList = {
  period: "all" | "today";
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: BotApplication[];
};

export function isBotAdmin(ctx: Context): boolean {
  const { ids, usernames } = ADMIN_ALLOWLIST;
  if (!ids.size && !usernames.size) return false;
  const id = String(ctx.from?.id ?? "");
  if (ids.has(id)) return true;
  const username = ctx.from?.username?.toLowerCase() ?? "";
  return Boolean(username && usernames.has(username));
}

export function adminConfigured(): boolean {
  const { ids, usernames } = ADMIN_ALLOWLIST;
  return Boolean(ADMIN_API_KEY && (ids.size || usernames.size));
}

async function adminFetch<T>(path: string): Promise<T> {
  if (!ADMIN_API_KEY) throw new Error("ADMIN_API_KEY не настроен на боте");
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "x-admin-key": ADMIN_API_KEY },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function recordBotEvent(opts: {
  channel: string;
  channelUserId: string;
  eventType: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!ADMIN_API_KEY) {
    console.warn("[analytics] ADMIN_API_KEY не задан на боте — часть событий не пишется");
    return;
  }
  try {
    await fetch(`${API_URL}/admin/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": ADMIN_API_KEY },
      body: JSON.stringify(opts),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.warn("[analytics]", e);
  }
}

function formatTopList(items: [string, number][]): string {
  if (!items.length) return "—";
  return items.map(([name, n]) => `• ${escHtml(name)} — ${n}`).join("\n");
}

function formatApplicationEntry(app: BotApplication, index: number): string {
  const date = app.createdAt.slice(0, 10);
  const recipientLine =
    app.recipient && app.recipient !== "—" ? `\n   👔 ${escHtml(app.recipient)}` : "";
  return `${index}. ${escHtml(app.occasion)} · ${escHtml(app.gift)}${recipientLine}\n   💰 ${escHtml(app.budget)} · ${escHtml(app.telegram)}\n   📅 ${date}`;
}

function formatRecent(apps: BotApplication[]): string {
  if (!apps.length) return "Пока нет заявок.";
  return apps.map((a, i) => formatApplicationEntry(a, i + 1)).join("\n\n");
}

export function formatStatsMessage(stats: BotStats): string {
  const periodLabel = stats.period === "today" ? "сегодня" : "всего";
  return [
    `📊 <b>Статистика бота</b> (${periodLabel})`,
    "",
    `👥 Уникальных посетителей: <b>${stats.uniqueVisitors}</b>`,
    `🚀 Сессий (/start и диалоги): <b>${stats.botStarts}</b>`,
    `🎁 Начали подбор: <b>${stats.consultStarts}</b>`,
    `📋 Открыли каталог: <b>${stats.catalogOpens}</b>`,
    `💬 Сообщений от клиентов: <b>${stats.userMessages}</b>`,
    "",
    `📝 Заявки готовы: <b>${stats.applicationsReady}</b>`,
    `✉️ Нажали «Менеджеру»: <b>${stats.managerClicks}</b>`,
    `📤 Лиды сохранены: <b>${stats.leadsStored}</b> (CRM: ${stats.crmLeads})`,
    "",
    `🟢 Активных диалогов: <b>${stats.activeConsultations}</b>`,
    `⏸ Брошено: <b>${stats.abandoned}</b>`,
    `⭐ Средний lead score: <b>${stats.avgLeadScore}</b>`,
    "",
    "<b>Воронка</b>",
    `зашли → подбор: <b>${stats.funnel.consultRate}%</b> (${stats.funnel.consult}/${stats.funnel.visitors})`,
    `подбор → заявка: <b>${stats.funnel.handoffRate}%</b> (${stats.funnel.handoff}/${stats.funnel.consult})`,
    `заявка → менеджер: <b>${stats.funnel.clickRate}%</b> (${stats.funnel.managerClick}/${stats.funnel.handoff})`,
    "",
    "<b>Топ поводов</b>",
    formatTopList(stats.topOccasions),
    "",
    "<b>Топ подарков</b>",
    formatTopList(stats.topGifts),
    "",
    "<b>Последние заявки</b>",
    formatRecent(stats.recentApplications),
  ].join("\n");
}

export function formatApplicationsMessage(list: ApplicationsList): string {
  const periodLabel = list.period === "today" ? "сегодня" : "всего";
  const pageLabel = list.totalPages > 1 ? `, стр. ${list.page + 1}/${list.totalPages}` : "";
  const header = `📋 <b>Заявки</b> (${periodLabel}: ${list.total}${pageLabel})`;

  if (!list.items.length) {
    return `${header}\n\nПока нет заявок.`;
  }

  const startIndex = list.page * list.pageSize + 1;
  const body = list.items.map((app, i) => formatApplicationEntry(app, startIndex + i)).join("\n\n");
  return `${header}\n\n${body}`;
}

export function adminStatsKeyboard(period: "all" | "today"): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text("📋 Заявки", `admin:apps:${period}:0`).row();
  if (period === "all") {
    kb.text("📅 Сегодня", "admin:stats:today").text("🔄 Обновить", "admin:stats:all");
  } else {
    kb.text("📊 Всего", "admin:stats:all").text("🔄 Обновить", "admin:stats:today");
  }
  return kb;
}

export function adminApplicationsKeyboard(list: ApplicationsList): InlineKeyboard {
  const { period, page, totalPages } = list;
  const kb = new InlineKeyboard();

  if (totalPages > 1) {
    if (page > 0) kb.text("◀️ Назад", `admin:apps:${period}:${page - 1}`);
    if (page < totalPages - 1) kb.text("Вперёд ▶️", `admin:apps:${period}:${page + 1}`);
    if (page > 0 || page < totalPages - 1) kb.row();
  }

  if (period === "all") {
    kb.text("📅 Сегодня", "admin:apps:today:0").text("🔄 Обновить", `admin:apps:all:${page}`);
  } else {
    kb.text("📊 Всего", "admin:apps:all:0").text("🔄 Обновить", `admin:apps:today:${page}`);
  }
  kb.row().text("⬅️ Статистика", `admin:stats:${period}`);
  return kb;
}

export async function fetchBotStats(period: "all" | "today"): Promise<BotStats> {
  return adminFetch<BotStats>(`/admin/stats?period=${period}`);
}

export async function fetchApplications(period: "all" | "today", page = 0): Promise<ApplicationsList> {
  return adminFetch<ApplicationsList>(`/admin/applications?period=${period}&page=${page}&pageSize=10`);
}

export async function sendAdminPanel(ctx: Context, period: "all" | "today" = "all"): Promise<void> {
  const stats = await fetchBotStats(period);
  const text = formatStatsMessage(stats);
  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: adminStatsKeyboard(period),
  });
}

export async function sendApplicationsList(
  ctx: Context,
  period: "all" | "today" = "all",
  page = 0,
): Promise<void> {
  const list = await fetchApplications(period, page);
  const text = formatApplicationsMessage(list);
  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: adminApplicationsKeyboard(list),
  });
}

export async function editAdminPanel(
  ctx: Context,
  period: "all" | "today",
): Promise<void> {
  const stats = await fetchBotStats(period);
  const text = formatStatsMessage(stats);
  await ctx.editMessageText(text, {
    parse_mode: "HTML",
    reply_markup: adminStatsKeyboard(period),
  });
}

export async function editApplicationsList(
  ctx: Context,
  period: "all" | "today",
  page = 0,
): Promise<void> {
  const list = await fetchApplications(period, page);
  const text = formatApplicationsMessage(list);
  await ctx.editMessageText(text, {
    parse_mode: "HTML",
    reply_markup: adminApplicationsKeyboard(list),
  });
}
