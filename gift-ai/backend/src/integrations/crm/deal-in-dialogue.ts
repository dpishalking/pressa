import type { ParsedChatMessage } from "./bitrix-openlines.js";
import { clientMessageNeedsManagerResponse } from "./lost-dialogue.js";

/** «В диалоге» */
export const DEAL_STAGE_IN_DIALOG = "UC_8ZC4BD";

export type DealInDialogueRow = {
  dealId: string;
  title: string;
  amountEur: number;
  channel: string;
  clientLabel: string;
  waitingHours: number;
  lastClientMessage: string;
  managerName: string;
  phone: string;
  contactId: string;
};

export function clientWaitingSince(
  clientMessages: ParsedChatMessage[],
  managerMessages: ParsedChatMessage[],
  minHours: number,
): { waiting: boolean; waitingHours: number; lastClientMessage: string; lastClientAt: string } | null {
  const lastClient = clientMessages.at(-1);
  const lastManager = managerMessages.at(-1);

  const clientWaiting =
    Boolean(lastClient) && (!lastManager || lastClient!.date > lastManager.date);

  if (!clientWaiting || !lastClient) return null;

  if (!clientMessageNeedsManagerResponse(lastClient.text)) return null;

  const waitingHours = Math.max(
    0,
    Math.round((Date.now() - Date.parse(lastClient.date)) / 3_600_000),
  );

  if (waitingHours < minHours) return null;

  return {
    waiting: true,
    waitingHours,
    lastClientMessage: lastClient.text,
    lastClientAt: lastClient.date,
  };
}
