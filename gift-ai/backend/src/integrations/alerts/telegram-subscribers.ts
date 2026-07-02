import { getDb } from "../../db/client.js";

export type TelegramSubscriber = {
  chatId: string;
  username: string;
  firstName: string;
  subscribedAt: string;
};

export function listTelegramSubscribers(): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT chat_id FROM rop_telegram_subscribers ORDER BY subscribed_at ASC")
    .all() as Array<{ chat_id: string }>;
  return rows.map((row) => row.chat_id);
}

export function getTelegramSubscriber(chatId: string): TelegramSubscriber | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT chat_id, username, first_name, subscribed_at FROM rop_telegram_subscribers WHERE chat_id = ?",
    )
    .get(chatId) as
    | { chat_id: string; username: string; first_name: string; subscribed_at: string }
    | undefined;

  if (!row) return null;
  return {
    chatId: row.chat_id,
    username: row.username,
    firstName: row.first_name,
    subscribedAt: row.subscribed_at,
  };
}

export function addTelegramSubscriber(opts: {
  chatId: string;
  username?: string;
  firstName?: string;
}): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO rop_telegram_subscribers (chat_id, username, first_name, subscribed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       username = excluded.username,
       first_name = excluded.first_name`,
  ).run(opts.chatId, opts.username ?? "", opts.firstName ?? "", now);
}

export function listTelegramSubscriberDetails(): TelegramSubscriber[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT chat_id, username, first_name, subscribed_at FROM rop_telegram_subscribers ORDER BY subscribed_at ASC",
    )
    .all() as Array<{
    chat_id: string;
    username: string;
    first_name: string;
    subscribed_at: string;
  }>;

  return rows.map((row) => ({
    chatId: row.chat_id,
    username: row.username,
    firstName: row.first_name,
    subscribedAt: row.subscribed_at,
  }));
}
