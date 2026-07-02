import { config } from "../../config.js";
import type { OpenLineSession } from "./bitrix-openlines.js";

export const BITRIX_LINK_HEADER = "Ссылка Bitrix";

const CRM_OWNER_CONTACT = "3";
const CRM_OWNER_LEAD = "1";
const CRM_OWNER_DEAL = "2";

export function bitrixPortalBase(): string {
  return config.BITRIX24_PORTAL_URL.replace(/\/$/, "");
}

export function bitrixPortalPath(path: string): string {
  const base = bitrixPortalBase();
  if (!base) return "";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function isLinkId(value: string | number | undefined | null): value is string | number {
  if (value == null) return false;
  const s = String(value).trim();
  return Boolean(s) && s !== "0" && s !== "—";
}

export function bitrixLeadLink(id: string | number | undefined | null): string {
  return isLinkId(id) ? bitrixPortalPath(`/crm/lead/details/${id}/`) : "";
}

export function bitrixDealLink(id: string | number | undefined | null): string {
  return isLinkId(id) ? bitrixPortalPath(`/crm/deal/details/${id}/`) : "";
}

export function bitrixContactLink(id: string | number | undefined | null): string {
  return isLinkId(id) ? bitrixPortalPath(`/crm/contact/details/${id}/`) : "";
}

export function bitrixInvoiceLink(id: string | number | undefined | null): string {
  return isLinkId(id) ? bitrixPortalPath(`/crm/type/31/details/${id}/`) : "";
}

export function bitrixOpenLineLink(sessionId: string | number | undefined | null): string {
  return isLinkId(sessionId) ? bitrixPortalPath(`/online/?IM_HISTORY=imol|${sessionId}`) : "";
}

export function bitrixSessionLink(
  session: Pick<OpenLineSession, "sessionId" | "ownerTypeId" | "ownerId">,
): string {
  const { ownerTypeId, ownerId, sessionId } = session;
  if (ownerTypeId === CRM_OWNER_LEAD) {
    const link = bitrixLeadLink(ownerId);
    if (link) return link;
  }
  if (ownerTypeId === CRM_OWNER_CONTACT) {
    const link = bitrixContactLink(ownerId);
    if (link) return link;
  }
  if (ownerTypeId === CRM_OWNER_DEAL) {
    const link = bitrixDealLink(ownerId);
    if (link) return link;
  }
  return bitrixOpenLineLink(sessionId);
}

/** Приоритет: сделка → лид → диалог Open Lines */
export function bitrixLostDialogueLink(row: {
  sessionId: string;
  dealId?: string;
  leadId?: string;
}): string {
  const deal = bitrixDealLink(row.dealId);
  if (deal) return deal;
  const lead = bitrixLeadLink(row.leadId);
  if (lead) return lead;
  return bitrixOpenLineLink(row.sessionId);
}

/** Счёт → сделка */
export function bitrixUnpaidInvoiceLink(row: { invoiceId: number; dealId: number }): string {
  return bitrixInvoiceLink(row.invoiceId) || bitrixDealLink(row.dealId);
}
