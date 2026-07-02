import type { ParsedChatMessage } from "./bitrix-openlines.js";
import { lostDialogueWaitingHours } from "./lost-dialogue.js";

const THINK_DEAL_STAGE_ID = "PREPARATION";

const QUESTION_START =
  /^(?:как|сколько|где|когда|почему|зачем|можно|можете|есть ли|что|какой|какая|какие|which|what|where|when|why|how|can you|could you|do you|is it|are there|would you|please tell|подскаж|уточн|интересует|скажите|tell me|актуален)/i;

const MANAGER_CLOSING_ONLY = [
  /^(?:спасибо|благодар\w*|thanks(?:\s+you)?|merci)[!.?\s]*$/i,
  /^(?:добрый\s+(?:день|вечер|утро)|доброе\s+утро|здравствуйте|hi|hello|hey)[!.?\s]*$/i,
];

function normalize(text: string): string {
  return text.replace(/[\u3164\u200b\uFEFF]/g, " ").replace(/\s+/g, " ").trim();
}

export function managerMessageNeedsClientResponse(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized || normalized.length < 8) return false;
  if (MANAGER_CLOSING_ONLY.some((pattern) => pattern.test(normalized))) return false;
  if (/\?/.test(normalized)) return true;
  if (QUESTION_START.test(normalized)) return true;
  if (
    /(?:актуален|интересует|подскажите|уточните|жду\s+(?:ваш|ответ)|напишите|ответьте|ожидаю|confirm|пожалуйста)/i.test(
      normalized,
    )
  ) {
    return true;
  }
  return normalized.length >= 30;
}

/** Стадии, где имеет смысл пушить клиента за ответом (не производство и не «я подумаю»). */
export function isFollowUpSalesDealStage(stageId: string): boolean {
  if (!stageId) return false;
  if (stageId === THINK_DEAL_STAGE_ID) return false;
  if (stageId.startsWith("C4:")) return false;
  if (stageId.startsWith("C2:")) return false;
  return true;
}

/**
 * Менеджер написал последним, клиент молчит ≥ minWaitingHours.
 * Зеркало «клиент ждёт менеджера» из deal-in-dialogue.ts.
 */
export function clientGhostedSince(
  clientMessages: ParsedChatMessage[],
  managerMessages: ParsedChatMessage[],
  minWaitingHours: number,
  instagramPostComment?: boolean,
): {
  waiting: boolean;
  waitingHours: number;
  lastManagerMessage: string;
  lastManagerAt: string;
} | null {
  if (instagramPostComment) return null;

  const lastClient = clientMessages.at(-1);
  const lastManager = managerMessages.at(-1);

  const managerWaiting =
    Boolean(lastManager) && (!lastClient || lastManager!.date > lastClient.date);

  if (!managerWaiting || !lastManager?.text) return null;
  if (!managerMessageNeedsClientResponse(lastManager.text)) return null;

  const waitingHours = lostDialogueWaitingHours(lastManager.date);
  if (waitingHours < minWaitingHours) return null;

  return {
    waiting: true,
    waitingHours,
    lastManagerMessage: lastManager.text,
    lastManagerAt: lastManager.date,
  };
}
