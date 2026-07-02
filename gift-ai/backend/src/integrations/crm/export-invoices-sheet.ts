import {
  listBitrixContactsByIds,
  listBitrixDeals,
  resolveBitrixUserNames,
} from "./bitrix-client.js";
import {
  DEFAULT_THRESHOLDS,
  type UnpaidInvoiceRow,
} from "./bitrix-action-lists.js";
import { listSentInvoices, isInvoiceAwaitingPayment, invoiceSentAt } from "./bitrix-invoices.js";
import type { ActionsExportConfig } from "../analytics/actions-config.js";
import { loadFxConverter } from "../analytics/fx-rates.js";
import {
  UNPAID_INVOICE_HEADERS,
  unpaidInvoicesTab,
  writeSheetContent,
} from "../sheets/analytics-write.js";
import { unpaidInvoiceSheetRows } from "./action-sheet-rows.js";
import type { GoogleServiceAccount } from "../sheets/google-auth.js";

function formatToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.STATS_TIMEZONE ?? "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysBetween(fromIso: string, toDate = new Date()): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.floor((toDate.getTime() - from) / 86_400_000));
}

function phoneFromContact(contact?: { PHONE?: Array<{ VALUE?: string }> }): string {
  if (!contact?.PHONE?.length) return "";
  return contact.PHONE.find((row) => row.VALUE)?.VALUE?.trim() ?? "";
}

function contactName(contact?: { NAME?: string; LAST_NAME?: string }): string {
  if (!contact) return "";
  return [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ").trim();
}

export async function buildUnpaidInvoicesDirect(
  account: GoogleServiceAccount,
  cfg: ActionsExportConfig,
): Promise<{ unpaid: number; production: number }> {
  const minDays = DEFAULT_THRESHOLDS.invoiceSentMinDays;
  const fx = await loadFxConverter({
    baseCurrency: cfg.baseCurrency,
    date: formatToday(),
    overrides: cfg.fxOverrides,
  });

  const invoices = await listSentInvoices(minDays);
  const dealIds = [...new Set(invoices.map((inv) => inv.parentDealId).filter(Boolean))] as number[];

  const deals = new Map<number, Awaited<ReturnType<typeof listBitrixDeals>>[0]>();
  for (let i = 0; i < dealIds.length; i += 50) {
    const chunk = dealIds.slice(i, i + 50);
    for (const deal of await listBitrixDeals({ "@ID": chunk.map(String) }, ["CONTACT_ID", "STAGE_ID", "STAGE_SEMANTIC_ID", "ASSIGNED_BY_ID", "TITLE"])) {
      deals.set(Number(deal.ID), deal);
    }
  }

  const contactIds = [...new Set([...deals.values()].map((d) => String(d.CONTACT_ID ?? "")).filter((id) => id && id !== "0"))];
  const contacts = new Map(
    (await listBitrixContactsByIds(contactIds)).map((c) => [String(c.ID), c]),
  );

  const managerIds = [...new Set([...deals.values()].map((d) => String(d.ASSIGNED_BY_ID ?? "")).filter((id) => /^\d+$/.test(id)))];
  const managerNames = await resolveBitrixUserNames(managerIds);

  const rows: UnpaidInvoiceRow[] = [];
  let production = 0;

  for (const invoice of invoices) {
    if (!invoice.parentDealId) continue;
    const deal = deals.get(invoice.parentDealId);
    if (!isInvoiceAwaitingPayment(deal)) continue;
    if (deal?.STAGE_ID === "UC_SONEPG") production++;

    const contact = deal?.CONTACT_ID ? contacts.get(String(deal.CONTACT_ID)) : undefined;
    const sentTime = invoiceSentAt(invoice);
    const createdDate = sentTime.slice(0, 10);

    rows.push({
      invoiceId: invoice.id,
      dealId: invoice.parentDealId,
      clientName: contactName(contact) || deal?.TITLE || invoice.title || "",
      amountEur: fx.convert(invoice.opportunity ?? 0, invoice.currencyId),
      createdDate,
      daysUnpaid: daysBetween(sentTime || createdDate),
      managerName: managerNames.get(String(deal?.ASSIGNED_BY_ID ?? "")) ?? String(deal?.ASSIGNED_BY_ID ?? ""),
      phone: phoneFromContact(contact),
    });
  }

  rows.sort((a, b) => b.amountEur - a.amountEur);

  await writeSheetContent(
    account,
    cfg.sheetId,
    unpaidInvoicesTab(),
    UNPAID_INVOICE_HEADERS,
    unpaidInvoiceSheetRows(rows, cfg.baseCurrency),
  );

  return { unpaid: rows.length, production };
}
