import { buildLostDialoguesList } from "./bitrix-action-lists.js";
import { lostDialogueSheetRows } from "./lost-dialogue-sheet.js";
import {
  LOST_DIALOGUE_HEADERS,
  lostDialoguesTab,
  writeSheetContent,
} from "../sheets/analytics-write.js";
import type { GoogleServiceAccount } from "../sheets/google-auth.js";

export async function buildLostDialoguesDirect(
  account: GoogleServiceAccount,
  sheetId: string,
): Promise<{ lost: number }> {
  const rows = await buildLostDialoguesList({
    onProgress: (done, total) => {
      if (done % 100 === 0 || done === total) {
        console.error(`lost dialogues: ${done}/${total}`);
      }
    },
  });

  await writeSheetContent(
    account,
    sheetId,
    lostDialoguesTab(),
    LOST_DIALOGUE_HEADERS,
    lostDialogueSheetRows(rows),
  );

  return { lost: rows.length };
}
