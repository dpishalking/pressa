import { randomUUID } from "node:crypto";
import { getDb } from "../db/client.js";
import { logger } from "../logger.js";
import { formatTelegramContact } from "./telegram-contact.js";
import type { QualificationFields } from "../types/index.js";

export type PendingAdminAlert = {
  id: string;
  text: string;
  createdAt: string;
};

function formatRecipient(fields: QualificationFields): string {
  const parts = [fields.recipient, fields.relationship, fields.recipientAge ? `${fields.recipientAge} лет` : ""]
    .map((v) => v?.trim())
    .filter(Boolean) as string[];
  const uniq: string[] = [];
  for (const p of parts) {
    if (!uniq.some((u) => u.toLowerCase() === p.toLowerCase())) uniq.push(p);
  }
  return uniq.join(", ") || "—";
}

export function ensureAdminAlertSchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS admin_alerts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'handoff_interest',
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_alerts_pending
      ON admin_alerts(status, created_at);
  `);
}

export function buildHandoffAdminAlert(opts: {
  channelUserId: string;
  fields: QualificationFields;
}): string {
  const telegram = formatTelegramContact({
    telegram: opts.fields.telegram,
    channelUserId: opts.channelUserId,
  });
  const gift = opts.fields.recommendedGiftName || opts.fields.catalogGiftInterest || "—";
  return [
    "🆕 Интерес в gift-боте (ждёт менеджера)",
    "",
    `🎂 Повод: ${opts.fields.occasion || "—"}`,
    `👔 Кому: ${formatRecipient(opts.fields)}`,
    `🎁 Подарок: ${gift}`,
    `💰 Бюджет: ${opts.fields.budget || "—"}`,
    `✨ Эмоция: ${opts.fields.desiredEmotions || "—"}`,
    `💛 Особенно дорого: ${opts.fields.story || "—"}`,
    `📍 Город: ${opts.fields.city || opts.fields.country || "—"}`,
    `📅 Дата: ${opts.fields.eventDate || opts.fields.urgency || "—"}`,
    `💬 Telegram: ${telegram || "—"}`,
    "",
    "Клиент ещё не нажал «Написать менеджеру». В CRM не создаём — ждём кнопку.",
  ].join("\n");
}

/** Очередь для gift telegram-bot: он шлёт админам из ADMIN_TELEGRAM_IDS. */
export function enqueueHandoffAdminAlert(opts: {
  channelUserId: string;
  fields: QualificationFields;
}): void {
  ensureAdminAlertSchema();
  const now = new Date().toISOString();
  const text = buildHandoffAdminAlert(opts);
  getDb()
    .prepare(
      `INSERT INTO admin_alerts (id, kind, text, status, created_at, updated_at)
       VALUES (?, 'handoff_interest', ?, 'pending', ?, ?)`,
    )
    .run(randomUUID(), text, now, now);
  logger.info("Handoff admin alert enqueued", { channelUserId: opts.channelUserId });
}

export function listPendingAdminAlerts(limit = 20): PendingAdminAlert[] {
  ensureAdminAlertSchema();
  const rows = getDb()
    .prepare(
      `SELECT id, text, created_at FROM admin_alerts
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(Math.min(50, Math.max(1, limit))) as Array<{ id: string; text: string; created_at: string }>;
  return rows.map((r) => ({ id: r.id, text: r.text, createdAt: r.created_at }));
}

export function markAdminAlertSent(id: string): void {
  ensureAdminAlertSchema();
  getDb()
    .prepare(`UPDATE admin_alerts SET status = 'sent', updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
}
