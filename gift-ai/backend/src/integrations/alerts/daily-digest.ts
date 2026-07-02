import { todayRange } from "../analytics/date-ranges.js";
import { countLeadTraffic } from "../analytics/lead-traffic.js";
import { loadFxConverter } from "../analytics/fx-rates.js";
import { listBitrixDeals, listBitrixLeads, listBitrixStatusLabels } from "../crm/bitrix-client.js";
import {
  INVOICE_STAGE_LOST,
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
  leadsPaid: number;
  leadsOrganic: number;
  wonDeals: number;
  wonRevenueEur: number;
  lostDeals: number;
  lostAmountEur: number;
  chatSessions: number;
  /** Счета, созданные сегодня (без отменённых). */
  invoicesIssued: number;
  invoicesIssuedEur: number;
  /** Оплаченные счета из выставленных сегодня. */
  invoicesReceived: number;
  invoicesReceivedEur: number;
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

  const [sourceLabels, statusLabels, leads, wonDeals, lostDeals, sessions, invoices] = await Promise.all([
    listBitrixStatusLabels("SOURCE"),
    listBitrixStatusLabels("STATUS"),
    listBitrixLeads(
      { ">=DATE_CREATE": range.from, "<DATE_CREATE": range.to },
      ["SOURCE_DESCRIPTION", "UTM_SOURCE", "UTM_MEDIUM", "UTM_CAMPAIGN", "STATUS_ID"],
    ),
    listBitrixDeals(buildWonDealFilter(range, cfg.salesStageIds), []),
    listBitrixDeals(buildLostDealFilter(range), []),
    listOpenLineSessions(range),
    listInvoicesCreatedInRange(range),
  ]);

  const leadTraffic = countLeadTraffic(leads, sourceLabels, statusLabels);

  const wonRevenueEur = wonDeals.reduce(
    (sum, deal) => sum + fx.convert(Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0, deal.CURRENCY_ID),
    0,
  );
  const lostAmountEur = lostDeals.reduce(
    (sum, deal) => sum + fx.convert(Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0, deal.CURRENCY_ID),
    0,
  );

  let invoicesIssued = 0;
  let invoicesIssuedEur = 0;
  let invoicesReceived = 0;
  let invoicesReceivedEur = 0;
  for (const invoice of invoices) {
    if (invoice.stageId === INVOICE_STAGE_LOST) continue;

    const amountEur = fx.convert(invoice.opportunity ?? 0, invoice.currencyId);
    invoicesIssued += 1;
    invoicesIssuedEur += amountEur;

    if (invoice.stageId === INVOICE_STAGE_PAID) {
      invoicesReceived += 1;
      invoicesReceivedEur += amountEur;
    }
  }

  return {
    date: range.from,
    leads: leadTraffic.marketingTotal,
    leadsPaid: leadTraffic.traffic,
    leadsOrganic: leadTraffic.organic,
    wonDeals: wonDeals.length,
    wonRevenueEur,
    lostDeals: lostDeals.length,
    lostAmountEur,
    chatSessions: sessions.length,
    invoicesIssued,
    invoicesIssuedEur,
    invoicesReceived,
    invoicesReceivedEur,
  };
}

export function formatDailyDigestMessage(stats: DailyDigestStats): string {
  const avgCheck = stats.wonDeals > 0 ? stats.wonRevenueEur / stats.wonDeals : 0;
  const lines = [
    `📊 Итоги дня · ${formatDigestDateLabel(stats.date)}`,
    "",
    `Лиды: ${stats.leads}`,
    `· трафик: ${stats.leadsPaid}`,
    `· органика: ${stats.leadsOrganic}`,
    `Выиграно сделок: ${stats.wonDeals} · ${eur(stats.wonRevenueEur)}`,
    `Проиграно сделок: ${stats.lostDeals}${stats.lostDeals > 0 ? ` · ${eur(stats.lostAmountEur)}` : ""}`,
    "",
    `Диалоги Open Lines: ${stats.chatSessions}`,
    `Счета выставлено: ${stats.invoicesIssued} · ${eur(stats.invoicesIssuedEur)}`,
    `Деньги получено: ${stats.invoicesReceived} · ${eur(stats.invoicesReceivedEur)}`,
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
