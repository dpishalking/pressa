import { getBitrixDealById, getBitrixLeadById, listBitrixContactsByIds, listBitrixDeals, type BitrixContact, type BitrixDeal, type BitrixLead } from "./bitrix-client.js";
import type { OpenLineSession } from "./bitrix-openlines.js";

const CRM_OWNER_DEAL = "2";
const CRM_OWNER_LEAD = "1";
const CRM_OWNER_CONTACT = "3";

export type SessionCrmContext = {
  phone: string;
  dealId: string;
  leadId: string;
};

function phoneFromEntity(entity?: { PHONE?: Array<{ VALUE?: string }> } | null): string {
  if (!entity?.PHONE?.length) return "";
  return entity.PHONE.find((row) => row.VALUE)?.VALUE?.trim() ?? "";
}

function semanticId(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isActiveCrmSemantic(semantic?: string): boolean {
  return semantic === "P";
}

export class SessionCrmCache {
  private deals = new Map<string, BitrixDeal | null>();
  private leads = new Map<string, BitrixLead | null>();
  private contacts = new Map<string, BitrixContact | null>();
  private contactHasActiveDeal = new Map<string, boolean>();
  private contactActiveDealId = new Map<string, string>();

  async deal(id: string): Promise<BitrixDeal | null> {
    if (!this.deals.has(id)) {
      this.deals.set(id, await getBitrixDealById(id));
    }
    return this.deals.get(id) ?? null;
  }

  async lead(id: string): Promise<BitrixLead | null> {
    if (!this.leads.has(id)) {
      this.leads.set(id, await getBitrixLeadById(id));
    }
    return this.leads.get(id) ?? null;
  }

  async contact(id: string): Promise<BitrixContact | null> {
    if (!id || id === "0") return null;
    if (!this.contacts.has(id)) {
      const batch = await listBitrixContactsByIds([id]);
      this.contacts.set(id, batch[0] ?? null);
    }
    return this.contacts.get(id) ?? null;
  }

  async activeDealIdForContact(contactId: string): Promise<string> {
    if (!this.contactActiveDealId.has(contactId)) {
      const deals = await listBitrixDeals({ CONTACT_ID: contactId, STAGE_SEMANTIC_ID: "P" }, ["ID"]);
      this.contactActiveDealId.set(contactId, deals[0]?.ID ? String(deals[0].ID) : "");
      this.contactHasActiveDeal.set(contactId, deals.length > 0);
    }
    return this.contactActiveDealId.get(contactId) ?? "";
  }

  async hasActiveDealForContact(contactId: string): Promise<boolean> {
    if (!this.contactHasActiveDeal.has(contactId)) {
      await this.activeDealIdForContact(contactId);
    }
    return this.contactHasActiveDeal.get(contactId) ?? false;
  }
}

/** Алерт только если сделка/лид ещё в работе (semantic P), не WON/LOST. */
export async function isOpenLineSessionAlertable(
  session: OpenLineSession,
  cache?: SessionCrmCache,
): Promise<boolean> {
  const { ownerTypeId, ownerId } = session;
  if (!ownerId || ownerId === "0") return true;

  if (ownerTypeId === CRM_OWNER_DEAL) {
    const deal = cache ? await cache.deal(ownerId) : await getBitrixDealById(ownerId);
    return deal ? isActiveCrmSemantic(semanticId(deal.STAGE_SEMANTIC_ID)) : true;
  }

  if (ownerTypeId === CRM_OWNER_LEAD) {
    const lead = cache ? await cache.lead(ownerId) : await getBitrixLeadById(ownerId);
    return lead ? isActiveCrmSemantic(semanticId(lead.STATUS_SEMANTIC_ID)) : true;
  }

  if (ownerTypeId === CRM_OWNER_CONTACT) {
    return cache ? cache.hasActiveDealForContact(ownerId) : (await listBitrixDeals({ CONTACT_ID: ownerId, STAGE_SEMANTIC_ID: "P" }, ["ID"])).length > 0;
  }

  return true;
}

export function isOpenLineSessionOpen(session: OpenLineSession): boolean {
  return !session.completed;
}

/** Телефон и ID сделки/лида по привязке чата в CRM. */
export async function resolveSessionCrmContext(
  session: OpenLineSession,
  cache?: SessionCrmCache,
): Promise<SessionCrmContext> {
  const empty: SessionCrmContext = { phone: "", dealId: "", leadId: "" };
  const { ownerTypeId, ownerId } = session;
  if (!ownerId || ownerId === "0") return empty;

  if (ownerTypeId === CRM_OWNER_DEAL) {
    const deal = cache ? await cache.deal(ownerId) : await getBitrixDealById(ownerId);
    if (!deal) return { ...empty, dealId: ownerId };

    let phone = "";
    const contactId = String(deal.CONTACT_ID ?? "");
    if (contactId && contactId !== "0") {
      const contact = cache ? await cache.contact(contactId) : (await listBitrixContactsByIds([contactId]))[0];
      phone = phoneFromEntity(contact);
    }

    const leadId = String(deal.LEAD_ID ?? "");
    return {
      phone,
      dealId: ownerId,
      leadId: leadId && leadId !== "0" ? leadId : "",
    };
  }

  if (ownerTypeId === CRM_OWNER_LEAD) {
    const lead = cache ? await cache.lead(ownerId) : await getBitrixLeadById(ownerId);
    let phone = phoneFromEntity(lead ?? undefined);
    const contactId = String(lead?.CONTACT_ID ?? "");
    if (!phone && contactId && contactId !== "0") {
      const contact = cache ? await cache.contact(contactId) : (await listBitrixContactsByIds([contactId]))[0];
      phone = phoneFromEntity(contact);
    }
    return { phone, dealId: "", leadId: ownerId };
  }

  if (ownerTypeId === CRM_OWNER_CONTACT) {
    const contact = cache ? await cache.contact(ownerId) : (await listBitrixContactsByIds([ownerId]))[0];
    const dealId = cache
      ? await cache.activeDealIdForContact(ownerId)
      : String((await listBitrixDeals({ CONTACT_ID: ownerId, STAGE_SEMANTIC_ID: "P" }, ["ID"]))[0]?.ID ?? "");
    return {
      phone: phoneFromEntity(contact ?? undefined),
      dealId,
      leadId: "",
    };
  }

  return empty;
}
