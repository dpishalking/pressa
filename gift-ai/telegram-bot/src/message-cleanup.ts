import type { Context } from "grammy";
import { getSession, setSession } from "./session.js";

export function userIdFromCtx(ctx: Context): string {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "");
}

export async function deleteMessages(ctx: Context, messageIds: number[]): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || !messageIds.length) return;
  const unique = [...new Set(messageIds)];
  await Promise.all(unique.map((id) => ctx.api.deleteMessage(chatId, id).catch(() => {})));
}

/** Удаляет все отслеживаемые сообщения бота в текущем чате. */
export async function rewindBotMessages(ctx: Context): Promise<void> {
  const uid = userIdFromCtx(ctx);
  const { botMessageIds = [] } = getSession(uid);
  await deleteMessages(ctx, botMessageIds);
  setSession(uid, { botMessageIds: [] });
}

/** Перед сменой экрана: чистим историю бота и сообщение с нажатой кнопкой. */
export async function clearBotScreen(ctx: Context): Promise<void> {
  const uid = userIdFromCtx(ctx);
  const { botMessageIds = [] } = getSession(uid);
  const toDelete = [...botMessageIds];

  const cbMsg = ctx.callbackQuery?.message;
  if (cbMsg && "message_id" in cbMsg) {
    toDelete.push(cbMsg.message_id);
  }

  await deleteMessages(ctx, toDelete);
  setSession(uid, { botMessageIds: [] });
}

export function trackBotMessage(uid: string, messageId: number): void {
  const session = getSession(uid);
  const ids = [...(session.botMessageIds ?? []), messageId];
  setSession(uid, { botMessageIds: ids });
}

export function trackBotMessages(uid: string, messageIds: number[]): void {
  for (const id of messageIds) trackBotMessage(uid, id);
}
