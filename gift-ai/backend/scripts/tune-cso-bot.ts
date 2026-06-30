/**
 * Настройка бота @rpcs0_bot (Retro Pressa CSO) для алертов РОПа.
 * Использование: npm run tune-cso-bot
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { patchEnvFile } from "./env-file.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(scriptDir, "..");
const envPath = resolve(backendDir, ".env");

const BOT_TOKEN = process.argv[2]?.trim() || process.env.ROP_ALERTS_TELEGRAM_BOT_TOKEN?.trim() || "";

async function telegramApi(method: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  if (!BOT_TOKEN) {
    console.error("❌ Укажите токен: npm run tune-cso-bot -- <BOT_TOKEN>");
    process.exit(1);
  }

  if (!existsSync(envPath)) {
    console.error("❌ Нет gift-ai/backend/.env");
    process.exit(1);
  }

  const changed = patchEnvFile(envPath, {
    ROP_ALERTS_ENABLED: "true",
    ROP_ALERTS_TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  });
  console.log("✓ .env:", changed.join(", ") || "токен уже был");

  const me = (await telegramApi("getMe")) as { ok?: boolean; result?: { username?: string; first_name?: string } };
  if (!me.ok) {
    console.error("❌ Неверный токен Telegram");
    process.exit(1);
  }
  console.log(`✓ Бот: @${me.result?.username} (${me.result?.first_name})`);

  await telegramApi("setMyCommands", {
    commands: [
      { command: "start", description: "Подключиться к алертам" },
      { command: "settings", description: "Ваши настройки уведомлений" },
      { command: "help", description: "Список команд" },
      { command: "status", description: "Пороги системы" },
      { command: "pause", description: "Пауза до утра" },
      { command: "stop", description: "Отписаться" },
    ],
  });
  await telegramApi("setMyDescription", {
    description:
      "Операционные алерты для руководителя продаж Retro Pressa: крупные лиды, счета без оплаты, VIP-клиенты в чате. Данные из Bitrix24.",
  });
  await telegramApi("setMyShortDescription", {
    short_description: "Алерты РОПа из Bitrix24",
  });
  console.log("✓ Команды и описание бота обновлены");

  const env = patchEnvFile(envPath, {});
  void env;

  const { loadEnvFile } = await import("./env-file.js");
  const vars = loadEnvFile(envPath);
  const publicUrl = vars.PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

  if (publicUrl && !publicUrl.includes("localhost")) {
    const webhook = `${publicUrl}/webhooks/telegram-cso`;
    const wh = await telegramApi("setWebhook", {
      url: webhook,
      allowed_updates: ["message"],
    });
    if (wh.ok) {
      console.log(`✓ Webhook: ${webhook}`);
    } else {
      console.warn("⚠️ Webhook:", wh.description);
    }
  } else {
    await telegramApi("deleteWebhook", { drop_pending_updates: true });
    console.log("⚠️ PUBLIC_API_URL не задан — webhook не установлен");
    console.log("   Для локальной отладки: напишите боту /start после запуска API");
  }

  console.log("\n════════════════════════════════════════");
  console.log("  Откройте @rpcs0_bot в Telegram и нажмите /start");
  console.log("════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error("❌", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
