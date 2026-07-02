import { config } from "../../config.js";

export type ManagersExportConfig = {
  sheetId: string;
  serviceAccountJson: string;
  baseCurrency: string;
  fxOverrides: Record<string, number>;
  salesStageIds: string[];
  leadCountryField?: string;
  dealCountryField?: string;
};

function parseFxOverrides(raw: string): Record<string, number> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, number> = {};
    for (const [code, value] of Object.entries(parsed)) {
      const rate = typeof value === "number" ? value : Number.parseFloat(String(value));
      if (Number.isFinite(rate) && rate > 0) result[code.toUpperCase()] = rate;
    }
    return result;
  } catch {
    throw new Error("ANALYTICS_FX_OVERRIDES должен быть JSON");
  }
}

export function managersExportConfig(): ManagersExportConfig {
  if (!config.BITRIX24_WEBHOOK_URL) {
    throw new Error("BITRIX24_WEBHOOK_URL не настроен");
  }
  if (!config.MANAGERS_SHEET_ID) {
    throw new Error("MANAGERS_SHEET_ID не настроен — укажите ID Google-таблицы для дашбордов менеджеров");
  }
  if (!config.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON не настроен");
  }

  return {
    sheetId: config.MANAGERS_SHEET_ID,
    serviceAccountJson: config.GOOGLE_SERVICE_ACCOUNT_JSON,
    baseCurrency: config.ANALYTICS_BASE_CURRENCY.trim().toUpperCase() || "EUR",
    fxOverrides: parseFxOverrides(config.ANALYTICS_FX_OVERRIDES),
    salesStageIds: config.ANALYTICS_SALES_STAGE_IDS.length ? config.ANALYTICS_SALES_STAGE_IDS : ["WON"],
    leadCountryField: config.BITRIX_COUNTRY_FIELD.trim() || undefined,
    dealCountryField: config.BITRIX_DEAL_COUNTRY_FIELD.trim() || undefined,
  };
}
