import { config } from "../../config.js";
import { Bitrix24Adapter, NoopCrmAdapter } from "./bitrix24.js";
import type { CrmAdapter } from "./types.js";

export function createCrmAdapter(): CrmAdapter {
  if (config.CRM_PROVIDER === "bitrix24") return new Bitrix24Adapter();
  return new NoopCrmAdapter();
}

export const crmAdapter = createCrmAdapter();
