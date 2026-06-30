import { logger } from "../../logger.js";
import type { RopAlertsConfig } from "./alerts-config.js";
import { isWithinRopAlertWindow } from "./alert-hours.js";
import { getTelegramSubscriber } from "./telegram-subscribers.js";
import { subscriberWantsAlert, type AlertTypeKey } from "./subscriber-settings.js";

export type TelegramAlertSendResult = {
  delivered: boolean;
  /** Все подписчики подключились позже события — алерт больше не повторять. */
  skippedAll: boolean;
};

function isRelevantForSubscriber(chatId: string, relevantAt: string): boolean {
  const sub = getTelegramSubscriber(chatId);
  if (!sub) return true;

  const eventTs = Date.parse(relevantAt);
  const subTs = Date.parse(sub.subscribedAt);
  if (!Number.isFinite(eventTs) || !Number.isFinite(subTs)) return true;
  return eventTs >= subTs;
}

export async function sendTelegramAlert(
  cfg: RopAlertsConfig,
  text: string,
  opts?: { relevantAt?: string; alertType?: AlertTypeKey },
): Promise<TelegramAlertSendResult> {
  if (!isWithinRopAlertWindow(cfg)) {
    logger.debug("ROP alert skipped outside Moscow hours", {
      from: cfg.alertFromHour,
      to: cfg.alertToHour,
    });
    return { delivered: false, skippedAll: false };
  }

  const token = cfg.telegramBotToken;
  const chatIds = cfg.telegramChatIds;
  if (!token || !chatIds.length) return { delivered: false, skippedAll: false };

  const relevantAt = opts?.relevantAt ?? new Date().toISOString();
  let delivered = false;
  let eligible = 0;

  for (const chatId of chatIds) {
    if (!isRelevantForSubscriber(chatId, relevantAt)) continue;
    if (opts?.alertType && !subscriberWantsAlert(chatId, opts.alertType)) continue;
    eligible += 1;

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
      logger.error("Telegram alert failed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (eligible === 0) {
    return { delivered: false, skippedAll: true };
  }
  return { delivered, skippedAll: false };
}

export function shouldFinalizeAlert(result: TelegramAlertSendResult): boolean {
  return result.delivered || result.skippedAll;
}

export function eur(amount: number): string {
  return `€${Math.round(amount).toLocaleString("ru-RU")}`;
}

export function portalLink(cfg: RopAlertsConfig, path: string): string {
  if (!cfg.portalUrl) return path;
  return `${cfg.portalUrl}${path}`;
}
