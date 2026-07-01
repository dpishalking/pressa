import { exportBitrixActionLists } from "./integrations/analytics/bitrix-actions-export.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  logger.info("Starting ROP actions export");
  const result = await exportBitrixActionLists();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
