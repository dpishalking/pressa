import {
  listBitrixContactsByIds,
  listBitrixDeals,
  resolveBitrixUserNames,
} from "./bitrix-client.js";
import { DEFAULT_THRESHOLDS, type DealInDialogueRow } from "./bitrix-action-lists.js";
import { clientWaitingSince, DEAL_STAGE_IN_DIALOG } from "./deal-in-dialogue.js";
import { fetchSessionChat, findLatestOpenLineSessionForOwners } from "./bitrix-openlines.js";
import { isOpenLineSessionAlertable, isOpenLineSessionOpen } from "./session-crm-status.js";
import type { ActionsExportConfig } from "../analytics/actions-config.js";
import { loadFxConverter } from "../analytics/fx-rates.js";
import {
  DEAL_IN_DIALOGUE_HEADERS,
  dealsInDialogueTab,
  writeSheetContent,
} from "../sheets/analytics-write.js";
import { dealInDialogueSheetRows } from "./action-sheet-rows.js";
import type { GoogleServiceAccount } from "../sheets/google-auth.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.STATS_TIMEZONE ?? "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function phoneFromContact(contact?: { PHONE?: Array<{ VALUE?: string }> }): string {
  if (!contact?.PHONE?.length) return "";
  return contact.PHONE.find((row) => row.VALUE)?.VALUE?.trim() ?? "";
}

export async function buildDealsInDialogueDirect(
  account: GoogleServiceAccount,
  cfg: ActionsExportConfig,
): Promise<{ stale: number; totalInDialogue: number }> {
  const minHours = DEFAULT_THRESHOLDS.dealInDialogueNoResponseHours;
  const fx = await loadFxConverter({
    baseCurrency: cfg.baseCurrency,
    date: formatToday(),
    overrides: cfg.fxOverrides,
  });

  const deals = await listBitrixDeals(
    { STAGE_ID: DEAL_STAGE_IN_DIALOG, STAGE_SEMANTIC_ID: "P" },
    ["CONTACT_ID", "LEAD_ID", "ASSIGNED_BY_ID"],
  );
  const contactIds = [
    ...new Set(deals.map((deal) => String(deal.CONTACT_ID ?? "")).filter((id) => id && id !== "0")),
  ];
  const contacts = new Map(
    (await listBitrixContactsByIds(contactIds)).map((contact) => [String(contact.ID), contact]),
  );

  const rows: DealInDialogueRow[] = [];

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i]!;
    const session = await findLatestOpenLineSessionForOwners([
      { ownerTypeId: "2", ownerId: String(deal.ID) },
      { ownerTypeId: "1", ownerId: String(deal.LEAD_ID ?? "") },
      { ownerTypeId: "3", ownerId: String(deal.CONTACT_ID ?? "") },
    ]);

    if (session && isOpenLineSessionOpen(session) && (await isOpenLineSessionAlertable(session))) {
      const stats = await fetchSessionChat(session);
      const clientMessages = stats.messages.filter((m) => m.author === "client");
      const managerMessages = stats.messages.filter((m) => m.author === "manager");
      const waiting = clientWaitingSince(clientMessages, managerMessages, minHours);

      if (waiting) {
        const contactId = String(deal.CONTACT_ID ?? "");
        const managerId = session.responsibleId || String(deal.ASSIGNED_BY_ID ?? "");
        const amount = Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0;

        rows.push({
          dealId: String(deal.ID),
          title: deal.TITLE ?? "",
          amountEur: fx.convert(amount, deal.CURRENCY_ID),
          channel: session.channel,
          clientLabel: session.clientLabel,
          waitingHours: waiting.waitingHours,
          lastClientMessage: waiting.lastClientMessage,
          managerName: managerId,
          phone: phoneFromContact(contacts.get(contactId)),
          contactId,
        });
      }
    }

    if (i + 1 < deals.length) await sleep(120);
  }

  const managerNames = await resolveBitrixUserNames([
    ...new Set(rows.map((row) => row.managerName).filter((id) => /^\d+$/.test(id))),
  ]);
  for (const row of rows) {
    row.managerName = managerNames.get(row.managerName) ?? row.managerName;
    if (!row.phone && row.contactId) {
      row.phone = phoneFromContact(contacts.get(row.contactId));
    }
  }

  rows.sort((a, b) => b.waitingHours - a.waitingHours);

  await writeSheetContent(
    account,
    cfg.sheetId,
    dealsInDialogueTab(),
    DEAL_IN_DIALOGUE_HEADERS,
    dealInDialogueSheetRows(rows, cfg.baseCurrency),
  );

  return { stale: rows.length, totalInDialogue: deals.length };
}
