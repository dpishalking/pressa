import { config } from "../../config.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";
import { ropAlertsConfig, ropAlertsEnabled } from "./alerts-config.js";
import { addTelegramSubscriber } from "./telegram-subscribers.js";
import { eur } from "./telegram-notify.js";
import { ropAlertWindowLabel } from "./alert-hours.js";

type TelegramUpdate = {
  message?: {
    chat: { id: number; type?: string };
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
  };
};

async function reply(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const json = (await res.json()) as { ok?: boolean; description?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.description ?? `HTTP ${res.status}`);
  }
}

function helpText(): string {
  return [
    "Retro Pressa CSO — алерты из Bitrix24",
    "",
    "Уведомления:",
    "• лид без ответа 30 мин (только свежие, до 7 дн.)",
    "• чат без ответа 30 мин (до 3 дн.)",
    "• счёт ≥ €1000 без оплаты 2 дня",
    "• VIP-клиент (LTV) написал в чат",
    "",
    `Часы алертов: ${ropAlertWindowLabel(config.ROP_ALERTS_FROM_HOUR_MSK, config.ROP_ALERTS_TO_HOUR_MSK)}`,
    "",
    "Команды:",
    "/start — подписаться",
    "/status — пороги и статус",
    "/help — эта справка",
  ].join("\n");
}

export async function handleCsoBotUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text?.trim()) return;

  const token = config.ROP_ALERTS_TELEGRAM_BOT_TOKEN.trim();
  if (!token) return;

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const command = text.split(/\s+/)[0]?.toLowerCase() ?? "";

  if (command === "/start") {
    addTelegramSubscriber({
      chatId,
      username: message.from?.username,
      firstName: message.from?.first_name,
    });

    await reply(
      token,
      chatId,
      [
        "✅ Вы подписаны на алерты РОПа",
        "",
        "Бот @rpcs0_bot будет присылать срочные сигналы из Bitrix24.",
        "",
        helpText(),
      ].join("\n"),
    );
    logger.info("CSO bot subscriber added", { chatId, username: message.from?.username });
    return;
  }

  if (command === "/status") {
    if (!ropAlertsEnabled()) {
      await reply(
        token,
        chatId,
        "⚠️ Алерты ещё не полностью настроены на сервере.\nНапишите /start — вы в списке получателей.",
      );
      return;
    }

    const cfg = ropAlertsConfig();
    await reply(
      token,
      chatId,
      [
        "📊 Статус алертов",
        "",
        `Лид без ответа: ${cfg.leadNoResponseMinutes} мин (не старше ${cfg.leadMaxAgeDays} дн.)`,
        `Чат без ответа: ${cfg.chatNoResponseMinutes} мин (не старше ${cfg.chatMaxAgeDays} дн.)`,
        `Счёт без оплаты: ≥ ${eur(cfg.invoiceMinEur)}, ${cfg.invoiceUnpaidDays} дн.`,
        `VIP LTV: ≥ ${eur(cfg.vipLtvMinEur)}`,
        `Часы: ${ropAlertWindowLabel(cfg.alertFromHour, cfg.alertToHour)}`,
        "",
        "Bitrix webhook → API → этот чат",
      ].join("\n"),
    );
    return;
  }

  if (command === "/help") {
    await reply(token, chatId, helpText());
  }
}

export async function syncCsoBotWebhook(): Promise<void> {
  const token = config.ROP_ALERTS_TELEGRAM_BOT_TOKEN.trim();
  const publicUrl = config.PUBLIC_API_URL.trim().replace(/\/$/, "");
  if (!token || !publicUrl || publicUrl.includes("localhost")) return;

  const webhookUrl = `${publicUrl}/webhooks/telegram-cso`;
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] }),
  });
  const json = (await res.json()) as { ok?: boolean; description?: string };
  if (!json.ok) {
    logger.warn("CSO bot webhook setup failed", { error: json.description });
    return;
  }
  logger.info("CSO bot webhook set", { webhookUrl });
}
