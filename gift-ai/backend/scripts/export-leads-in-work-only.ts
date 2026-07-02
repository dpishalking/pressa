import { buildLeadsInWorkDirect } from "../src/integrations/crm/export-leads-in-work-sheet.js";
import { actionsExportConfig } from "../src/integrations/analytics/actions-config.js";
import { loadServiceAccount } from "../src/integrations/sheets/google-auth.js";

async function main(): Promise<void> {
  const cfg = actionsExportConfig();
  const account = loadServiceAccount(cfg.serviceAccountJson);
  const result = await buildLeadsInWorkDirect(account, cfg);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
