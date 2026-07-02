import {
  countryDisplayValue,
  findFieldByTitle,
  getLeadFieldMap,
  listBitrixContactsByIds,
  listBitrixLeads,
  listBitrixStatusLabels,
  resolveBitrixUserNames,
} from "./bitrix-client.js";
import { DEFAULT_THRESHOLDS, type LeadInWorkRow } from "./bitrix-action-lists.js";
import { LEAD_IN_WORK_STATUS_ID, leadTakenInWorkAt } from "./lead-in-work.js";
import type { ActionsExportConfig } from "../analytics/actions-config.js";
import {
  LEAD_IN_WORK_HEADERS,
  leadsInWorkTab,
  sheetText,
  writeSheetContent,
} from "../sheets/analytics-write.js";
import type { GoogleServiceAccount } from "../sheets/google-auth.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hoursBetween(fromIso: string, toDate = new Date()): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.floor((toDate.getTime() - from) / 3_600_000));
}

function phoneFromLead(lead: { PHONE?: Array<{ VALUE?: string }> }): string {
  if (!lead.PHONE?.length) return "";
  return lead.PHONE.find((row) => row.VALUE)?.VALUE?.trim() ?? "";
}

function phoneFromContact(contact?: { PHONE?: Array<{ VALUE?: string }> }): string {
  if (!contact?.PHONE?.length) return "";
  return contact.PHONE.find((row) => row.VALUE)?.VALUE?.trim() ?? "";
}

export async function buildLeadsInWorkDirect(
  account: GoogleServiceAccount,
  cfg: ActionsExportConfig,
): Promise<{ stale: number; totalInWork: number }> {
  const minHours = DEFAULT_THRESHOLDS.leadInWorkStaleHours;
  const [sourceLabels, leadFields] = await Promise.all([
    listBitrixStatusLabels("SOURCE"),
    getLeadFieldMap(),
  ]);

  const leadCountryField =
    cfg.leadCountryField ?? findFieldByTitle(leadFields, "Страна") ?? "UF_CRM_COUNTRY";

  const leads = await listBitrixLeads({ STATUS_ID: LEAD_IN_WORK_STATUS_ID }, ["PHONE", "CONTACT_ID", leadCountryField]);
  const rows: LeadInWorkRow[] = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;
    const takenAt = await leadTakenInWorkAt(String(lead.ID));
    const hoursInWork = hoursBetween(takenAt ?? lead.DATE_MODIFY ?? lead.DATE_CREATE ?? "");
    if (hoursInWork < minHours) continue;

    const contactId = String(lead.CONTACT_ID ?? "");
    rows.push({
      leadId: String(lead.ID),
      title: lead.TITLE ?? [lead.NAME, lead.LAST_NAME].filter(Boolean).join(" "),
      sourceName: sourceLabels.get(lead.SOURCE_ID ?? "") ?? lead.SOURCE_ID ?? "",
      country: countryDisplayValue(leadFields, leadCountryField, lead[leadCountryField]),
      inWorkSince: (takenAt ?? lead.DATE_MODIFY ?? lead.DATE_CREATE ?? "").slice(0, 16).replace("T", " "),
      hoursInWork,
      managerName: String(lead.ASSIGNED_BY_ID ?? ""),
      phone: phoneFromLead(lead),
      contactId,
    });

    if (i + 1 < leads.length) await sleep(120);
  }

  const contactIds = [...new Set(rows.map((row) => row.contactId).filter(Boolean))];
  const contacts = new Map(
    (await listBitrixContactsByIds(contactIds)).map((contact) => [String(contact.ID), contact]),
  );

  const managerIds = [...new Set(rows.map((row) => row.managerName).filter((id) => /^\d+$/.test(id)))];
  const managerNames = await resolveBitrixUserNames(managerIds);

  for (const row of rows) {
    row.managerName = managerNames.get(row.managerName) ?? row.managerName;
    if (!row.phone && row.contactId) {
      row.phone = phoneFromContact(contacts.get(row.contactId));
    }
  }

  rows.sort((a, b) => b.hoursInWork - a.hoursInWork);

  await writeSheetContent(
    account,
    cfg.sheetId,
    leadsInWorkTab(),
    LEAD_IN_WORK_HEADERS,
    rows.map((row) => [
      row.leadId,
      sheetText(row.title),
      sheetText(row.sourceName),
      sheetText(row.country),
      row.inWorkSince,
      row.hoursInWork,
      sheetText(row.managerName),
      sheetText(row.phone),
    ]),
  );

  return { stale: rows.length, totalInWork: leads.length };
}
