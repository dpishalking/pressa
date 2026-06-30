/**
 * Инструкция по настройке алертов РОПа в Telegram.
 *
 * 1. Создайте бота через @BotFather, добавьте его в чат РОПа.
 * 2. Узнайте chat_id: напишите боту, откройте
 *    https://api.telegram.org/bot<TOKEN>/getUpdates
 * 3. В .env backend:
 *    ROP_ALERTS_ENABLED=true
 *    ROP_ALERTS_TELEGRAM_BOT_TOKEN=...
 *    ROP_ALERTS_TELEGRAM_CHAT_IDS=-1001234567890
 *    BITRIX24_OUTBOUND_TOKEN=<секрет из Bitrix>
 *    BITRIX24_PORTAL_URL=https://bb-wood.bitrix24.eu
 * 4. Запустите backend с публичным URL (Railway, ngrok, VPS).
 * 5. Bitrix24 → Разработчикам → Другое → Исходящий webhook:
 *    URL: https://<ваш-хост>/webhooks/bitrix
 *    События:
 *      - ONCRMLEADADD
 *      - ONCRMLEADUPDATE
 *      - ONCRMDYNAMICITEMADD
 *      - ONCRMDYNAMICITEMUPDATE
 *      - ONIMCONNECTORMESSAGEADD
 * 6. Тест:
 *    curl -X POST http://localhost:3100/admin/rop-alerts/test -H "x-admin-key: ..."
 */

import { ropAlertsConfig, ropAlertsEnabled } from "../src/integrations/alerts/alerts-config.js";

function main(): void {
  console.log("=== Настройка алертов РОПа ===\n");
  console.log("Включено:", ropAlertsEnabled() ? "да" : "нет");

  if (!ropAlertsEnabled()) {
    console.log("\nДобавьте в .env:");
    console.log("  ROP_ALERTS_ENABLED=true");
    console.log("  ROP_ALERTS_TELEGRAM_BOT_TOKEN=<от BotFather>");
    console.log("  ROP_ALERTS_TELEGRAM_CHAT_IDS=<id чата>");
    console.log("  BITRIX24_WEBHOOK_URL=<входящий webhook CRM>");
    console.log("  BITRIX24_OUTBOUND_TOKEN=<токен исходящего webhook>");
    console.log("  BITRIX24_PORTAL_URL=https://ваш-портал.bitrix24.eu");
    process.exit(1);
  }

  const cfg = ropAlertsConfig();
  console.log("\nПороги:");
  console.log(`  Лид без ответа: ≥ €${cfg.leadMinEur}, ${cfg.leadNoResponseMinutes} мин`);
  console.log(`  Счёт без оплаты: ≥ €${cfg.invoiceMinEur}, ${cfg.invoiceUnpaidDays} дн.`);
  console.log(`  VIP LTV: ≥ €${cfg.vipLtvMinEur}`);
  console.log(`\nWebhook Bitrix → POST /webhooks/bitrix`);
  console.log(`Telegram чаты: ${cfg.telegramChatIds.join(", ")}`);
  console.log(`\nТест: POST /admin/rop-alerts/test (x-admin-key)`);
}

main();
