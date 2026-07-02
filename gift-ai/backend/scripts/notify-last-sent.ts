import { listRecentlySentInvoices } from "../src/integrations/crm/bitrix-invoices.js";
import { fireInvoiceSentAlert } from "../src/integrations/alerts/rop-alerts.js";
import { clearAlertSent } from "../src/integrations/alerts/alert-store.js";
import { ropAlertsConfig, ropAlertsEnabled } from "../src/integrations/alerts/alerts-config.js";

async function main(): Promise<void> {
  if (!ropAlertsEnabled()) {
    throw new Error("ROP alerts не настроены — проверьте .env");
  }

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const invoices = await listRecentlySentInvoices(since);
  if (!invoices.length) {
    console.log("Нет выставленных счетов за последние 30 дней");
    process.exit(1);
  }

  const latest = invoices[0]!;
  console.log(
    `Последний выставленный счёт: #${latest.id}, ${latest.title ?? "—"}, ${latest.movedTime ?? latest.createdTime}, ${latest.opportunity} ${latest.currencyId}`,
  );

  clearAlertSent(`invoice_sent:${latest.id}`);
  await fireInvoiceSentAlert(String(latest.id), ropAlertsConfig());
  console.log("Уведомление отправлено в Telegram");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
