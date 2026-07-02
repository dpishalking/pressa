import { config } from "../../config.js";
import { logger } from "../../logger.js";
import { ropAlertsConfig, ropAlertsEnabled } from "./alerts-config.js";
import { addTelegramSubscriber, getTelegramSubscriber } from "./telegram-subscribers.js";
import { eur } from "./telegram-notify.js";
import { ropAlertWindowLabel } from "./alert-hours.js";
import {
  getSubscriberSettings,
  setSubscriberActive,
  setSubscriberAlertToggle,
  setSubscriberPause,
  toggleLabel,
  type AlertTypeKey,
} from "./subscriber-settings.js";
import { buildDailyDigestStats, formatDailyDigestMessage } from "./daily-digest.js";

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

function settingsText(chatId: string): string {
  const s = getSubscriberSettings(chatId);
  const paused =
    s.pausedUntil && Date.parse(s.pausedUntil) > Date.now()
      ? `да, до ${s.pausedUntil.slice(11, 16)} МСК`
      : "нет";

  return [
    "⚙️ Ваши настройки",
    "",
    `Статус: ${s.active ? "подключены" : "отключены"}`,
    `Пауза: ${paused}`,
    "",
    `Лиды без ответа — ${toggleLabel(s.leads)}`,
    `Чаты без ответа — ${toggleLabel(s.chats)}`,
    `Счета без оплаты — ${toggleLabel(s.invoices)}`,
    `Проигранные сделки — ${toggleLabel(s.lostDeals)}`,
    `VIP в чате — ${toggleLabel(s.vip)}`,
    `Итоги дня (22:00) — ${toggleLabel(s.dailyDigest)}`,
    "",
    "Как изменить:",
    "/leads on | /leads off",
    "/chats on | /chats off",
    "/invoices on | /invoices off",
    "/deals on | /deals off",
    "/vip on | /vip off",
    "/digest on | /digest off",
    "",
    "/pause — тишина до завтра 9:00",
    "/resume — снова получать",
    "/stop — отписаться",
  ].join("\n");
}

function helpText(): string {
  return [
    "📖 Команды бота",
    "",
    "/start — подключиться (только новые алерты)",
    "/settings — ваши переключатели",
    "/status — пороги системы (общие)",
    "/help — эта справка",
    "",
    "Типы уведомлений:",
    "/leads on|off — лиды без ответа",
    "/chats on|off — чаты без ответа",
    "/invoices on|off — счета без оплаты",
    "/deals on|off — проигранные сделки",
    "/vip on|off — VIP-клиенты",
    "/digest — итоги сегодня (сейчас)",
    "/digest on|off — авто-отправка в 22:00",
    "",
    "/pause — не беспокоить до утра",
    "/resume — снять паузу",
    "/stop — отписаться",
    "",
    `Общие часы алертов: ${ropAlertWindowLabel(config.ROP_ALERTS_FROM_HOUR_MSK, config.ROP_ALERTS_TO_HOUR_MSK)}`,
  ].join("\n");
}

function parseToggle(parts: string[]): boolean | null {
  const arg = parts[1]?.toLowerCase();
  if (arg === "on" || arg === "1" || arg === "вкл") return true;
  if (arg === "off" || arg === "0" || arg === "выкл") return false;
  return null;
}

const TOGGLE_COMMANDS: Record<string, AlertTypeKey> = {
  "/leads": "leads",
  "/chats": "chats",
  "/invoices": "invoices",
  "/deals": "lost_deals",
  "/vip": "vip",
  "/digest": "daily_digest",
};

function nextMorningMskIso(): string {
  const fromHour = config.ROP_ALERTS_FROM_HOUR_MSK;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const mo = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");

  const targetDay = h >= fromHour ? d + 1 : d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${y}-${mo}-${pad(targetDay)}T${pad(fromHour)}:00:00+03:00`).toISOString();
}

export async function handleCsoBotUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text?.trim()) return;

  const token = config.ROP_ALERTS_TELEGRAM_BOT_TOKEN.trim();
  if (!token) return;

  const chatId = String(message.chat.id);
  const parts = message.text.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() ?? "";

  if (command === "/start") {
    addTelegramSubscriber({
      chatId,
      username: message.from?.username,
      firstName: message.from?.first_name,
    });
    setSubscriberActive(chatId, true);
    setSubscriberPause(chatId, null);

    await reply(
      token,
      chatId,
      [
        "✅ Вы подключены",
        "",
        "Настройте, что получать: /settings",
        "Справка по командам: /help",
        "",
        "Алерты по лидам приходят всем подписчикам. Остальные сигналы — только новые с момента входа.",
      ].join("\n"),
    );
    logger.info("CSO bot subscriber added", { chatId, username: message.from?.username });
    return;
  }

  if (command === "/settings") {
    if (!getTelegramSubscriber(chatId)) {
      await reply(token, chatId, "Сначала подключитесь: /start");
      return;
    }
    await reply(token, chatId, settingsText(chatId));
    return;
  }

  if (command === "/status") {
    if (!ropAlertsEnabled()) {
      await reply(token, chatId, "⚠️ Система алертов на сервере не активна.\n/start — оставить себя в списке.");
      return;
    }

    const cfg = ropAlertsConfig();
    await reply(
      token,
      chatId,
      [
        "📊 Пороги системы (для всех)",
        "",
        `Лид без ответа: ${cfg.leadNoResponseMinutes} мин`,
        `Чат без ответа: ${cfg.chatNoResponseMinutes} мин`,
        `Счёт: ${cfg.invoiceMinEur > 0 ? `от ${eur(cfg.invoiceMinEur)}` : "любая сумма"}, ${cfg.invoiceUnpaidDays} дн.`,
        `Проигранная сделка: от ${eur(cfg.lostDealMinEur)}`,
        `VIP LTV: от ${eur(cfg.vipLtvMinEur)}`,
        `Часы: ${ropAlertWindowLabel(cfg.alertFromHour, cfg.alertToHour)}`,
        "",
        "Ваши переключатели: /settings",
      ].join("\n"),
    );
    return;
  }

  if (command === "/help") {
    await reply(token, chatId, helpText());
    return;
  }

  if (command === "/stop") {
    setSubscriberActive(chatId, false);
    await reply(token, chatId, "🔕 Вы отписаны.\n\nСнова подключиться: /start");
    return;
  }

  if (command === "/resume") {
    setSubscriberActive(chatId, true);
    setSubscriberPause(chatId, null);
    await reply(token, chatId, "▶️ Уведомления снова включены.\n\n/settings — проверить типы");
    return;
  }

  if (command === "/pause") {
    const until = nextMorningMskIso();
    setSubscriberPause(chatId, until);
    await reply(token, chatId, `⏸ Пауза до завтра ${config.ROP_ALERTS_FROM_HOUR_MSK}:00 МСК.\n\n/resume — отменить раньше`);
    return;
  }

  if (command === "/digest" && parts.length === 1) {
    if (!getTelegramSubscriber(chatId)) {
      await reply(token, chatId, "Сначала подключитесь: /start");
      return;
    }
    if (!ropAlertsEnabled()) {
      await reply(token, chatId, "⚠️ Дайджест недоступен — алерты на сервере не настроены.");
      return;
    }
    try {
      const cfg = ropAlertsConfig();
      const stats = await buildDailyDigestStats(cfg);
      await reply(token, chatId, formatDailyDigestMessage(stats));
    } catch (error) {
      logger.error("CSO bot digest command failed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      await reply(token, chatId, "Не удалось собрать дайджест. Попробуйте позже.");
    }
    return;
  }

  const toggleKey = TOGGLE_COMMANDS[command];
  if (toggleKey) {
    if (!getTelegramSubscriber(chatId)) {
      await reply(token, chatId, "Сначала подключитесь: /start");
      return;
    }
    const enabled = parseToggle(parts);
    if (enabled === null) {
      await reply(token, chatId, `Укажите: ${command} on  или  ${command} off`);
      return;
    }
    setSubscriberAlertToggle(chatId, toggleKey, enabled);
    await reply(token, chatId, [`Готово: ${command} ${enabled ? "on" : "off"}`, "", settingsText(chatId)].join("\n"));
    return;
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

export async function syncCsoBotCommands(): Promise<void> {
  const token = config.ROP_ALERTS_TELEGRAM_BOT_TOKEN.trim();
  if (!token) return;

  const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: [
        { command: "start", description: "Подключиться к алертам" },
        { command: "settings", description: "Ваши настройки уведомлений" },
        { command: "digest", description: "Итоги дня сейчас" },
        { command: "help", description: "Список команд" },
        { command: "status", description: "Пороги системы" },
        { command: "pause", description: "Пауза до утра" },
        { command: "stop", description: "Отписаться" },
      ],
    }),
  });
  const json = (await res.json()) as { ok?: boolean; description?: string };
  if (!json.ok) {
    logger.warn("CSO bot commands setup failed", { error: json.description });
  }
}
