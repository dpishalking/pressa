/**
 * Максимальная автонастройка алертов РОПа:
 * - дописывает .env (токен Telegram, chat id, outbound token, portal URL)
 * - проверяет Bitrix и шлёт тест в Telegram
 * - печатает готовую инструкцию для Bitrix (единственный ручной шаг)
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile, numericTelegramIds, patchEnvFile } from "./env-file.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(scriptDir, "..");
const backendEnvPath = resolve(backendDir, ".env");
const telegramEnvPath = resolve(backendDir, "../telegram-bot/.env");

function derivePortalUrl(webhookUrl: string): string {
  try {
    return webhookUrl ? new URL(webhookUrl).origin : "";
  } catch {
    return "";
  }
}

function generateOutboundToken(): string {
  return randomBytes(24).toString("hex");
}

async function sendTestTelegram(botToken: string, chatIds: string[]): Promise<void> {
  for (const chatId of chatIds) {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: [
          "✅ Алерты РОПа настроены",
          "",
          "Вы будете получать уведомления о:",
          "• крупных лидах без ответа",
          "• счетах без оплаты",
          "• VIP-клиентах в чате",
        ].join("\n"),
      }),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) {
      throw new Error(`Telegram ${chatId}: ${json.description ?? res.status}`);
    }
    console.log(`  ✓ Telegram тест → ${chatId}`);
  }
}

async function checkBitrix(webhookUrl: string): Promise<void> {
  const res = await fetch(`${webhookUrl.replace(/\/$/, "")}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const json = (await res.json()) as { result?: { NAME?: string }; error?: string };
  if (!res.ok || json.error) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  console.log(`  ✓ Bitrix: ${json.result?.NAME ?? "OK"}`);
}

function printBitrixInstructions(opts: {
  webhookUrl: string;
  outboundToken: string;
  portalUrl: string;
}): void {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  ЕДИНСТВЕННЫЙ РУЧНОЙ ШАГ — исходящий webhook в Bitrix24");
  console.log("══════════════════════════════════════════════════════════\n");
  console.log("1. Откройте:");
  console.log(`   ${opts.portalUrl}/devops/edit/out-hook/0/\n`);
  console.log("   (или: Разработчикам → Другое → Исходящий webhook → Добавить)\n");
  console.log("2. URL обработчика:");
  console.log(`   ${opts.webhookUrl}\n`);
  console.log("3. События (отметьте все):");
  for (const event of [
    "ONCRMLEADADD",
    "ONCRMLEADUPDATE",
    "ONCRMDYNAMICITEMADD",
    "ONCRMDYNAMICITEMUPDATE",
    "ONIMCONNECTORMESSAGEADD",
  ]) {
    console.log(`   • ${event}`);
  }
  console.log("\n4. Сохраните. Скопируйте «Код приложения» / Application token в .env:");
  console.log(`   BITRIX24_OUTBOUND_TOKEN=${opts.outboundToken}`);
  console.log("\n   (если Bitrix сгенерирует другой токен — замените в .env)\n");
  console.log("5. После сохранения в Bitrix перезапустите API:");
  console.log("   ./scripts/install-backend-service.sh\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const publicUrlArg = args.find((a) => a.startsWith("--public-url="))?.slice("--public-url=".length);

  console.log("=== Bootstrap алертов РОПа ===\n");

  const backendEnv = loadEnvFile(backendEnvPath);
  const telegramEnv = loadEnvFile(telegramEnvPath);

  const bitrixWebhook = backendEnv.BITRIX24_WEBHOOK_URL?.trim();
  if (!bitrixWebhook) {
    console.error("❌ BITRIX24_WEBHOOK_URL не задан в gift-ai/backend/.env");
    process.exit(1);
  }

  const botToken =
    backendEnv.ROP_ALERTS_TELEGRAM_BOT_TOKEN?.trim() ||
    telegramEnv.BOT_TOKEN?.trim() ||
    "";
  const chatIds = numericTelegramIds(
    backendEnv.ROP_ALERTS_TELEGRAM_CHAT_IDS || telegramEnv.ADMIN_TELEGRAM_IDS,
  );

  if (!botToken) {
    console.error("❌ Нет токена Telegram. Задайте BOT_TOKEN в gift-ai/telegram-bot/.env");
    process.exit(1);
  }
  if (!chatIds.length) {
    console.error("❌ Нет chat id. Добавьте числовой ADMIN_TELEGRAM_IDS в telegram-bot/.env");
    console.error("   (узнать id: напишите @userinfobot в Telegram)");
    process.exit(1);
  }

  const outboundToken = backendEnv.BITRIX24_OUTBOUND_TOKEN?.trim() || generateOutboundToken();
  const portalUrl = backendEnv.BITRIX24_PORTAL_URL?.trim() || derivePortalUrl(bitrixWebhook);
  const publicApiUrl = (
    publicUrlArg ||
    backendEnv.PUBLIC_API_URL?.trim() ||
    "http://localhost:3100"
  ).replace(/\/$/, "");

  const updates: Record<string, string> = {
    ROP_ALERTS_ENABLED: "true",
    ROP_ALERTS_TELEGRAM_BOT_TOKEN: botToken,
    ROP_ALERTS_TELEGRAM_CHAT_IDS: chatIds.join(","),
    BITRIX24_OUTBOUND_TOKEN: outboundToken,
    BITRIX24_PORTAL_URL: portalUrl,
    PUBLIC_API_URL: publicApiUrl,
  };

  const changed = patchEnvFile(backendEnvPath, updates);
  console.log("Обновлён .env:", changed.join(", ") || "(без изменений)");

  console.log("\nПроверки:");
  await checkBitrix(bitrixWebhook);
  await sendTestTelegram(botToken, chatIds);

  const handlerUrl = `${publicApiUrl}/webhooks/bitrix`;
  printBitrixInstructions({
    webhookUrl: handlerUrl,
    outboundToken,
    portalUrl,
  });

  if (publicApiUrl.includes("localhost")) {
    console.log("⚠️  Bitrix не достучится до localhost.");
    console.log("   Запустите: ./scripts/install-rop-alerts.sh");
    console.log("   Скрипт поднимет API и попробует cloudflared-туннель.\n");
  } else {
    console.log(`Публичный URL: ${publicApiUrl}`);
    console.log(`Webhook:       ${handlerUrl}\n`);
  }
}

main().catch((error) => {
  console.error("❌", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
