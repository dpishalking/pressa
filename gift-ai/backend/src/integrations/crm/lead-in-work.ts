import { bitrixCall } from "./bitrix-client.js";

/** «Лид взят в работу / Lead is taken» */
export const LEAD_IN_WORK_STATUS_ID = "IN_PROCESS";

const LEAD_ENTITY_TYPE_ID = 1;

export async function leadTakenInWorkAt(leadId: string): Promise<string | null> {
  const response = await bitrixCall("crm.stagehistory.list", {
    entityTypeId: LEAD_ENTITY_TYPE_ID,
    filter: { OWNER_ID: Number.parseInt(leadId, 10) },
  });

  const items =
    (response.result as { items?: Array<{ STATUS_ID?: string; CREATED_TIME?: string }> } | undefined)?.items ??
    [];

  let takenAt: string | null = null;
  for (const item of items) {
    if (item.STATUS_ID === LEAD_IN_WORK_STATUS_ID && item.CREATED_TIME) {
      takenAt = item.CREATED_TIME;
    }
  }
  return takenAt;
}

export type LeadInWorkRow = {
  leadId: string;
  title: string;
  sourceName: string;
  country: string;
  inWorkSince: string;
  hoursInWork: number;
  managerName: string;
  phone: string;
  contactId: string;
};
