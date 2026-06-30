import { serve } from "@hono/node-server";
import { api } from "./api/routes.js";
import { config } from "./config.js";
import { getDb } from "./db/client.js";
import { syncGiftsFromConfig } from "./integrations/sheets/workbook-sync.js";
import { sheetSyncConfig, sheetSyncEnabled } from "./integrations/sheets/config.js";
import { knowledgeBase } from "./modules/knowledge-base.js";
import { logger } from "./logger.js";
import { seedGifts } from "./seed.js";
import { startRopAlertsWorker } from "./integrations/alerts/alert-worker.js";
import { syncCsoBotWebhook, syncCsoBotCommands } from "./integrations/alerts/cso-bot.js";

getDb();
seedGifts();

if (sheetSyncEnabled()) {
  syncGiftsFromConfig(sheetSyncConfig())
    .then((r) => {
      logger.info("Sheet sync on startup complete", r);
    })
    .catch((e) => {
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
    startRopAlertsWorker();
    void syncCsoBotWebhook();
    void syncCsoBotCommands();
  },
);
