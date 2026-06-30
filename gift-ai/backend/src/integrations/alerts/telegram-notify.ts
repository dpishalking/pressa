import { logger } from "../../logger.js";
import type { RopAlertsConfig } from "./alerts-config.js";
import { isWithinRopAlertWindow } from "./alert-hours.js";

export async function sendTelegramAlert(cfg: RopAlertsConfig, text: string): Promise<boolean> {
  if (!isWithinRopAlertWindow(cfg)) {
    logger.debug("ROP alert skipped outside Moscow hours", {
      from: cfg.alertFromHour,
      to: cfg.alertToHour,
    });
    return false;
  }

  const token = cfg.telegramBotToken;
  const chatIds = cfg.telegramChatIds;
  if (!token || !chatIds.length) return false;

  let sent = false;
  for (const chatId of chatIds) {
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
      sent = true;
    } catch (error) {
      logger.error("Telegram alert failed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return sent;
}

export function eur(amount: number): string {
  return `€${Math.round(amount).toLocaleString("ru-RU")}`;
}

export function portalLink(cfg: RopAlertsConfig, path: string): string {
  if (!cfg.portalUrl) return path;
  return `${cfg.portalUrl}${path}`;
}
