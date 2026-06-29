import { serve } from "@hono/node-server";
import { api } from "./api/routes.js";
import { config } from "./config.js";
import { getDb } from "./db/client.js";
import { syncGiftsFromSheetUrl } from "./integrations/sheets/sync.js";
import { logger } from "./logger.js";
import { seedGifts } from "./seed.js";

getDb();
seedGifts();

if (config.GOOGLE_SHEET_CSV_URL) {
  syncGiftsFromSheetUrl(config.GOOGLE_SHEET_CSV_URL).catch((e) => {
    logger.warn("Sheet sync on startup failed", { error: String(e) });
  });
}

serve(
  {
    fetch: api.fetch,
    port: config.PORT,
  },
  () => {
    logger.info("Gift AI API started", {
      port: config.PORT,
      crm: config.CRM_PROVIDER,
    });
  },
);
