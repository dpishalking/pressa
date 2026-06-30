import { todayRange } from "../analytics/date-ranges.js";
import { loadFxConverter } from "../analytics/fx-rates.js";
import { listBitrixDeals, listBitrixLeads } from "../crm/bitrix-client.js";
import {
  INVOICE_STAGE_PAID,
  listInvoicesCreatedInRange,
} from "../crm/bitrix-invoices.js";
import { listOpenLineSessions } from "../crm/bitrix-openlines.js";
import { logger } from "../../logger.js";
import type { RopAlertsConfig } from "./alerts-config.js";
import { ropAlertsConfig } from "./alerts-config.js";
import { moscowDateString, moscowTimeParts } from "./alert-hours.js";
import { markAlertSent, wasAlertSent } from "./alert-store.js";
import { eur, sendTelegramDigest } from "./telegram-notify.js";

export type DailyDigestStats = {
  date: string;
  leads: number;
  wonDeals: number;
  wonRevenueEur: number;
  lostDeals: number;
  lostAmountEur: number;
  chatSessions: number;
  invoicesCreated: number;
  invoicesPaid: number;
  invoicesPaidEur: number;
};

function buildWonDealFilter(range: { from: string; to: string }, salesStageIds: string[]): Record<string, unknown> {
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

function buildLostDealFilter(range: { from: string; to: string }): Record<string, unknown> {
  return {
    STAGE_SEMANTIC_ID: "F",
    ">=CLOSEDATE": range.from,
    "<CLOSEDATE": range.to,
  };
}

function formatDigestDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export async function buildDailyDigestStats(cfg: RopAlertsConfig, now = new Date()): Promise<DailyDigestStats> {
  const range = todayRange(now);
  const fx = await loadFxConverter({
    baseCurrency: cfg.baseCurrency,
    date: range.from,
    overrides: cfg.fxOverrides,
  });

  const [leads, wonDeals, lostDeals, sessions, invoices] = await Promise.all([
    listBitrixLeads({ ">=DATE_CREATE": range.from, "<DATE_CREATE": range.to }, []),
    listBitrixDeals(buildWonDealFilter(range, cfg.salesStageIds), []),
    listBitrixDeals(buildLostDealFilter(range), []),
    listOpenLineSessions(range),
    listInvoicesCreatedInRange(range),
  ]);

  const wonRevenueEur = wonDeals.reduce(
    (sum, deal) => sum + fx.convert(Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0, deal.CURRENCY_ID),
    0,
  );
  const lostAmountEur = lostDeals.reduce(
    (sum, deal) => sum + fx.convert(Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0, deal.CURRENCY_ID),
    0,
  );

  let invoicesPaid = 0;
  let invoicesPaidEur = 0;
  for (const invoice of invoices) {
    if (invoice.stageId !== INVOICE_STAGE_PAID) continue;
    invoicesPaid += 1;
    invoicesPaidEur += fx.convert(invoice.opportunity ?? 0, invoice.currencyId);
  }

  return {
    date: range.from,
    leads: leads.length,
    wonDeals: wonDeals.length,
    wonRevenueEur,
    lostDeals: lostDeals.length,
    lostAmountEur,
    chatSessions: sessions.length,
    invoicesCreated: invoices.length,
    invoicesPaid,
    invoicesPaidEur,
  };
}

export function formatDailyDigestMessage(stats: DailyDigestStats): string {
  const avgCheck = stats.wonDeals > 0 ? stats.wonRevenueEur / stats.wonDeals : 0;
  const lines = [
    `📊 Итоги дня · ${formatDigestDateLabel(stats.date)}`,
    "",
    `Лиды: ${stats.leads}`,
    `Выиграно сделок: ${stats.wonDeals} · ${eur(stats.wonRevenueEur)}`,
    `Проиграно сделок: ${stats.lostDeals}${stats.lostDeals > 0 ? ` · ${eur(stats.lostAmountEur)}` : ""}`,
    "",
    `Диалоги Open Lines: ${stats.chatSessions}`,
    `Счета выставлено: ${stats.invoicesCreated} (оплачено ${stats.invoicesPaid} · ${eur(stats.invoicesPaidEur)})`,
  ];

  if (stats.wonDeals > 0) {
    lines.push("", `Средний чек: ${eur(avgCheck)}`);
  }

  lines.push("", "Настройки: /settings");
  return lines.join("\n");
}

export async function maybeSendDailyDigest(cfg?: RopAlertsConfig, now = new Date()): Promise<boolean> {
  const settings = cfg ?? ropAlertsConfig();
  if (!settings.dailyDigestEnabled) return false;

  const { hour } = moscowTimeParts(now);
  if (hour !== settings.dailyDigestHourMsk) return false;

  const date = moscowDateString(now);
  const alertKey = `daily_digest:${date}`;
  if (wasAlertSent(alertKey)) return false;

  try {
    const stats = await buildDailyDigestStats(settings, now);
    const text = formatDailyDigestMessage(stats);
    const delivered = await sendTelegramDigest(settings, text);
    if (delivered) {
      markAlertSent(alertKey, "daily_digest");
      logger.info("Daily digest sent", { digestDate: date, ...stats });
      return true;
    }
  } catch (error) {
    logger.error("Daily digest failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return false;
}
