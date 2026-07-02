import { buildUnprocessedLeadsList } from "./bitrix-action-lists.js";
import type { ActionsExportConfig } from "../analytics/actions-config.js";
import {
  UNPROCESSED_LEAD_HEADERS,
  unprocessedLeadsTab,
  writeSheetContent,
} from "../sheets/analytics-write.js";
import { unprocessedLeadSheetRows } from "./action-sheet-rows.js";
import type { GoogleServiceAccount } from "../sheets/google-auth.js";

export async function buildUnprocessedLeadsDirect(
  account: GoogleServiceAccount,
  cfg: ActionsExportConfig,
): Promise<{ unprocessed: number }> {
  const rows = await buildUnprocessedLeadsList({
    config: cfg,
    onProgress: (done, total) => {
      if (done % 5 === 0 || done === total) {
        console.error(`unprocessed leads: ${done}/${total}`);
      }
    },
  });

  await writeSheetContent(
    account,
    cfg.sheetId,
    unprocessedLeadsTab(),
    UNPROCESSED_LEAD_HEADERS,
    unprocessedLeadSheetRows(rows),
  );

  return { unprocessed: rows.length };
}
