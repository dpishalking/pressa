import { config } from "../../config.js";

export type ChatExportConfig = {
  sheetId: string;
  serviceAccountJson: string;
};

export function chatExportConfig(): ChatExportConfig {
  if (!config.BITRIX24_WEBHOOK_URL) {
    throw new Error("BITRIX24_WEBHOOK_URL не настроен");
  }
  if (!config.ANALYTICS_CHAT_SHEET_ID) {
    throw new Error("ANALYTICS_CHAT_SHEET_ID не настроен — создайте таблицу: npm run create-chat-sheet");
  }
  if (!config.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON не настроен");
  }

  return {
    sheetId: config.ANALYTICS_CHAT_SHEET_ID,
    serviceAccountJson: config.GOOGLE_SERVICE_ACCOUNT_JSON,
  };
}
