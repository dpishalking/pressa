import type { LostDialogueRow } from "./lost-dialogue.js";
import { sheetText } from "../sheets/analytics-write.js";

export function lostDialogueSheetRows(rows: LostDialogueRow[]): (string | number)[][] {
  return rows.map((row) => [
    row.sessionId,
    row.channel,
    sheetText(row.clientLabel),
    row.dealId || "—",
    row.leadId || "—",
    sheetText(row.phone),
    sheetText(row.managerName),
    row.waitingHours,
    sheetText(row.dateMention || "—"),
    sheetText(row.lastClientMessage),
  ]);
}
