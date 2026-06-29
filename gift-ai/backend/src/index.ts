import { serve } from "@hono/node-server";
import { api } from "./api/routes.js";
import { config } from "./config.js";
import { getDb } from "./db/client.js";
import { logger } from "./logger.js";
import { seedGifts } from "./seed.js";

getDb();
seedGifts();

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
