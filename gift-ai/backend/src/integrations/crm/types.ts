import type { LeadPayload } from "../../types/index.js";

export type CrmLeadResult = {
  success: boolean;
  leadId: string | null;
  error?: string;
};

export interface CrmAdapter {
  readonly name: string;
  createLead(payload: LeadPayload): Promise<CrmLeadResult>;
}
