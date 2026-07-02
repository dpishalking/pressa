import { logger } from "../../logger.js";
import type { RopAlertsConfig } from "./alerts-config.js";
import { isWithinRopAlertWindow } from "./alert-hours.js";
import { getTelegramSubscriber } from "./telegram-subscribers.js";
import { subscriberWantsAlert, type AlertTypeKey } from "./subscriber-settings.js";
import { markAlertDeliveredToChat, wasAlertDeliveredToChat } from "./alert-store.js";

export type TelegramAlertSendResult = {
  delivered: boolean;
  /** Все подписчики подключились позже события — алерт больше не повторять. */
  skippedAll: boolean;
  /** Все активные подписчики получили алерт (для per-subscriber доставки). */
  allDelivered: boolean;
};

function isRelevantForSubscriber(chatId: string, relevantAt: string): boolean {
  const sub = getTelegramSubscriber(chatId);
  if (!sub) return true;

  const eventTs = Date.parse(relevantAt);
  const subTs = Date.parse(sub.subscribedAt);
  if (!Number.isFinite(eventTs) || !Number.isFinite(subTs)) return true;
  return eventTs >= subTs;
}

function eligibleChatIds(cfg: RopAlertsConfig, alertType?: AlertTypeKey): string[] {
  return cfg.telegramChatIds.filter((chatId) => !alertType || subscriberWantsAlert(chatId, alertType));
}

export async function sendTelegramAlert(
  cfg: RopAlertsConfig,
  text: string,
  opts?: {
    relevantAt?: string;
    alertType?: AlertTypeKey;
    /** Уникальный ключ события — доставка отслеживается отдельно по каждому chat_id. */
    alertKey?: string;
    /** Отправлять вне окна дневных алертов (например, оплаты). */
    ignoreAlertWindow?: boolean;
    ignoreSubscribedAt?: boolean;
  },
): Promise<TelegramAlertSendResult> {
  if (!opts?.ignoreAlertWindow && !isWithinRopAlertWindow(cfg)) {
    logger.debug("ROP alert skipped outside Moscow hours", {
      from: cfg.alertFromHour,
      to: cfg.alertToHour,
    });
    return { delivered: false, skippedAll: false, allDelivered: false };
  }

  const token = cfg.telegramBotToken;
  const chatIds = eligibleChatIds(cfg, opts?.alertType);
  if (!token || !chatIds.length) return { delivered: false, skippedAll: false, allDelivered: false };

  const relevantAt = opts?.relevantAt ?? new Date().toISOString();
  let delivered = false;
  let eligible = 0;
  let pending = 0;

  for (const chatId of chatIds) {
    if (!opts?.ignoreSubscribedAt && !isRelevantForSubscriber(chatId, relevantAt)) continue;
    if (opts?.alertKey && wasAlertDeliveredToChat(opts.alertKey, chatId)) continue;
    eligible += 1;
    pending += 1;

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; description?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.description ?? `HTTP ${res.status}`);
      }
      delivered = true;
      pending -= 1;
      if (opts?.alertKey && opts.alertType) {
        markAlertDeliveredToChat(opts.alertKey, chatId, opts.alertType);
      }
    } catch (error) {
      logger.error("Telegram alert failed", {
        chatId,
        alertKey: opts?.alertKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (eligible === 0 && !opts?.ignoreSubscribedAt) {
    return { delivered: false, skippedAll: true, allDelivered: false };
  }

  const allDelivered = opts?.alertKey ? pending === 0 && eligible > 0 : delivered;

  return { delivered, skippedAll: false, allDelivered };
}

export function shouldFinalizeAlert(result: TelegramAlertSendResult): boolean {
  return result.delivered || result.skippedAll;
}

export function shouldFinalizePerSubscriberAlert(result: TelegramAlertSendResult): boolean {
  return result.allDelivered;
}

/** Вечерний дайджест — вне окна дневных алертов, без фильтра subscribed_at. */
export async function sendTelegramDigest(cfg: RopAlertsConfig, text: string): Promise<boolean> {
  const token = cfg.telegramBotToken;
  const chatIds = cfg.telegramChatIds;
  if (!token || !chatIds.length) return false;

  let delivered = false;

  for (const chatId of chatIds) {
    if (!subscriberWantsAlert(chatId, "daily_digest")) continue;

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; description?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.description ?? `HTTP ${res.status}`);
      }
      delivered = true;
    } catch (error) {
      logger.error("Telegram digest failed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return delivered;
}

export function eur(amount: number): string {
  return `€${Math.round(amount).toLocaleString("ru-RU")}`;
}

export function portalLink(cfg: RopAlertsConfig, path: string): string {
  if (!cfg.portalUrl) return path;
  return `${cfg.portalUrl}${path}`;
}
