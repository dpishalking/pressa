import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price_min INTEGER NOT NULL DEFAULT 0,
  price_max INTEGER NOT NULL DEFAULT 0,
  emotions TEXT NOT NULL DEFAULT '[]',
  suitable_for TEXT NOT NULL DEFAULT '[]',
  occasions TEXT NOT NULL DEFAULT '[]',
  lead_time_days INTEGER NOT NULL DEFAULT 7,
  personalization TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  cases TEXT NOT NULL DEFAULT '',
  reviews TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  stage INTEGER NOT NULL DEFAULT 1,
  fields_json TEXT NOT NULL DEFAULT '{}',
  lead_score INTEGER NOT NULL DEFAULT 0,
  lead_score_band TEXT NOT NULL DEFAULT 'interested',
  status TEXT NOT NULL DEFAULT 'active',
  summary TEXT NOT NULL DEFAULT '',
  bitrix_lead_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_channel_user
  ON conversations(channel, channel_user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  payload_json TEXT NOT NULL,
  crm_provider TEXT,
  crm_lead_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  conversation_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(channel, channel_user_id);

CREATE TABLE IF NOT EXISTS rop_alert_sent (
  alert_key TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL,
  sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rop_alert_watch (
  id TEXT PRIMARY KEY,
  watch_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  check_after TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rop_alert_watch_pending
  ON rop_alert_watch(status, check_after);

CREATE TABLE IF NOT EXISTS rop_telegram_subscribers (
  chat_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  subscribed_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  paused_until TEXT,
  notify_leads INTEGER NOT NULL DEFAULT 1,
  notify_chats INTEGER NOT NULL DEFAULT 1,
  notify_invoices INTEGER NOT NULL DEFAULT 1,
  notify_lost_deals INTEGER NOT NULL DEFAULT 1,
  notify_vip INTEGER NOT NULL DEFAULT 1,
  notify_daily_digest INTEGER NOT NULL DEFAULT 1
);
`;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = path.resolve(config.DATABASE_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  try {
    db.exec(`ALTER TABLE gifts ADD COLUMN external_id TEXT`);
  } catch {
    /* column exists */
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_gifts_external_id ON gifts(external_id) WHERE external_id IS NOT NULL`);
  for (const sql of [
    `ALTER TABLE rop_telegram_subscribers ADD COLUMN active INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE rop_telegram_subscribers ADD COLUMN paused_until TEXT`,
    `ALTER TABLE rop_telegram_subscribers ADD COLUMN notify_leads INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE rop_telegram_subscribers ADD COLUMN notify_chats INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE rop_telegram_subscribers ADD COLUMN notify_invoices INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE rop_telegram_subscribers ADD COLUMN notify_lost_deals INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE rop_telegram_subscribers ADD COLUMN notify_vip INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE rop_telegram_subscribers ADD COLUMN notify_daily_digest INTEGER NOT NULL DEFAULT 1`,
  ]) {
    try {
      db.exec(sql);
    } catch {
      /* column exists */
    }
  }
  logger.info("Database initialized", { path: dbPath });
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}
