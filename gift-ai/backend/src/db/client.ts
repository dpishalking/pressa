import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY,
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
`;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = path.resolve(config.DATABASE_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  logger.info("Database initialized", { path: dbPath });
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}
