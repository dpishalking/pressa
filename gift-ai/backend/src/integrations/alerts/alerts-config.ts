import { config } from "../../config.js";
import { listTelegramSubscribers } from "./telegram-subscribers.js";

export type RopAlertsConfig = {
  enabled: boolean;
  telegramBotToken: string;
  telegramChatIds: string[];
  outboundToken: string;
  portalUrl: string;
  leadMinEur: number;
  leadNoResponseMinutes: number;
  chatNoResponseMinutes: number;
  leadMaxAgeDays: number;
  chatMaxAgeDays: number;
  alertFromHour: number;
  alertToHour: number;
  invoiceMinEur: number;
  invoiceUnpaidDays: number;
  lostDealMinEur: number;
  vipLtvMinEur: number;
  pollIntervalSec: number;
  baseCurrency: string;
  fxOverrides: Record<string, number>;
  salesStageIds: string[];
};

function parseFxOverrides(raw: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const part of raw.split(",")) {
    const [code, value] = part.split("=").map((s) => s.trim());
    const rate = Number(value);
    if (code && Number.isFinite(rate) && rate > 0) map[code.toUpperCase()] = rate;
  }
  return map;
}

export function resolveTelegramChatIds(): string[] {
  const fromEnv = config.ROP_ALERTS_TELEGRAM_CHAT_IDS;
  const fromDb = listTelegramSubscribers();
  return [...new Set([...fromEnv, ...fromDb])];
}

export function ropAlertsEnabled(): boolean {
  return Boolean(
    config.ROP_ALERTS_ENABLED &&
      config.BITRIX24_WEBHOOK_URL &&
      config.ROP_ALERTS_TELEGRAM_BOT_TOKEN &&
      resolveTelegramChatIds().length,
  );
}

export function ropAlertsConfig(): RopAlertsConfig {
  if (!ropAlertsEnabled()) {
    throw new Error(
      "Алерты РОПа не настроены: нужны ROP_ALERTS_ENABLED=true, BITRIX24_WEBHOOK_URL, ROP_ALERTS_TELEGRAM_BOT_TOKEN, ROP_ALERTS_TELEGRAM_CHAT_IDS",
    );
  }

  return {
    enabled: true,
    telegramBotToken: config.ROP_ALERTS_TELEGRAM_BOT_TOKEN,
    telegramChatIds: resolveTelegramChatIds(),
    outboundToken: config.BITRIX24_OUTBOUND_TOKEN,
    portalUrl: config.BITRIX24_PORTAL_URL.replace(/\/$/, ""),
    leadMinEur: config.ROP_ALERT_LEAD_MIN_EUR,
    leadNoResponseMinutes: config.ROP_ALERT_LEAD_NO_RESPONSE_MINUTES,
    chatNoResponseMinutes: config.ROP_ALERT_CHAT_NO_RESPONSE_MINUTES,
    leadMaxAgeDays: config.ROP_ALERT_LEAD_MAX_AGE_DAYS,
    chatMaxAgeDays: config.ROP_ALERT_CHAT_MAX_AGE_DAYS,
    alertFromHour: config.ROP_ALERTS_FROM_HOUR_MSK,
    alertToHour: config.ROP_ALERTS_TO_HOUR_MSK,
    invoiceMinEur: config.ROP_ALERT_INVOICE_MIN_EUR,
    invoiceUnpaidDays: config.ROP_ALERT_INVOICE_UNPAID_DAYS,
    lostDealMinEur: config.ROP_ALERT_LOST_DEAL_MIN_EUR,
    vipLtvMinEur: config.ROP_ALERT_VIP_LTV_MIN_EUR,
    pollIntervalSec: config.ROP_ALERTS_POLL_INTERVAL_SEC,
    baseCurrency: config.ANALYTICS_BASE_CURRENCY.trim().toUpperCase() || "EUR",
    fxOverrides: parseFxOverrides(config.ANALYTICS_FX_OVERRIDES),
    salesStageIds: config.ANALYTICS_SALES_STAGE_IDS.length ? config.ANALYTICS_SALES_STAGE_IDS : ["WON"],
  };
}
