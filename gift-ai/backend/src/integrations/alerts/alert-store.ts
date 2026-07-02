import { randomUUID } from "node:crypto";
import { getDb } from "../../db/client.js";

export type AlertWatchStatus = "pending" | "done" | "cancelled";

export function wasAlertSent(alertKey: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT alert_key FROM rop_alert_sent WHERE alert_key = ?").get(alertKey) as
    | { alert_key: string }
    | undefined;
  return Boolean(row);
}

export function markAlertSent(alertKey: string, alertType: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO rop_alert_sent (alert_key, alert_type, sent_at)
     VALUES (?, ?, ?)
     ON CONFLICT(alert_key) DO UPDATE SET sent_at = excluded.sent_at`,
  ).run(alertKey, alertType, new Date().toISOString());
}

export function clearAlertSent(alertKey: string): void {
  const db = getDb();
  db.prepare("DELETE FROM rop_alert_sent WHERE alert_key = ?").run(alertKey);
  db.prepare("DELETE FROM rop_alert_delivery WHERE alert_key = ?").run(alertKey);
}

export function wasAlertDeliveredToChat(alertKey: string, chatId: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT alert_key FROM rop_alert_delivery WHERE alert_key = ? AND chat_id = ?")
    .get(alertKey, chatId) as { alert_key: string } | undefined;
  return Boolean(row);
}

export function markAlertDeliveredToChat(alertKey: string, chatId: string, alertType: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO rop_alert_delivery (alert_key, chat_id, alert_type, sent_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(alert_key, chat_id) DO UPDATE SET sent_at = excluded.sent_at`,
  ).run(alertKey, chatId, alertType, new Date().toISOString());
}

export function allEligibleChatsDelivered(alertKey: string, chatIds: string[]): boolean {
  if (!chatIds.length) return false;
  return chatIds.every((chatId) => wasAlertDeliveredToChat(alertKey, chatId));
}

export function upsertWatch(opts: {
  watchType: string;
  entityId: string;
  checkAfter: string;
  payload?: Record<string, unknown>;
}): void {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `SELECT id FROM rop_alert_watch
       WHERE watch_type = ? AND entity_id = ? AND status = 'pending'`,
    )
    .get(opts.watchType, opts.entityId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE rop_alert_watch
       SET check_after = ?, payload_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(opts.checkAfter, JSON.stringify(opts.payload ?? {}), now, existing.id);
    return;
  }

  db.prepare(
    `INSERT INTO rop_alert_watch (id, watch_type, entity_id, check_after, payload_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    randomUUID(),
    opts.watchType,
    opts.entityId,
    opts.checkAfter,
    JSON.stringify(opts.payload ?? {}),
    now,
    now,
  );
}

export function cancelWatch(watchType: string, entityId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE rop_alert_watch
     SET status = 'cancelled', updated_at = ?
     WHERE watch_type = ? AND entity_id = ? AND status = 'pending'`,
  ).run(now, watchType, entityId);
}

export function completeWatch(id: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE rop_alert_watch SET status = 'done', updated_at = ? WHERE id = ?`,
  ).run(new Date().toISOString(), id);
}

export type PendingWatch = {
  id: string;
  watchType: string;
  entityId: string;
  checkAfter: string;
  payload: Record<string, unknown>;
};

export function listDueWatches(limit = 50): PendingWatch[] {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT id, watch_type, entity_id, check_after, payload_json
       FROM rop_alert_watch
       WHERE status = 'pending' AND check_after <= ?
       ORDER BY check_after ASC
       LIMIT ?`,
    )
    .all(now, limit) as Array<{
    id: string;
    watch_type: string;
    entity_id: string;
    check_after: string;
    payload_json: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    watchType: row.watch_type,
    entityId: row.entity_id,
    checkAfter: row.check_after,
    payload: JSON.parse(row.payload_json || "{}") as Record<string, unknown>,
  }));
}
