import { getDb } from "../db/client.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { buildInviteLink, createInvite, getInvite } from "./invite-service.js";

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type TrainingManager = {
  id: string;
  externalId: string;
  fullName: string;
  serviceTag: string;
  inviteToken: string;
  createdAt: string;
  updatedAt: string;
};

export type ManagerPracticeLinks = {
  manager: TrainingManager;
  botLink: string;
  practicePageUrl: string;
  inviteToken: string;
};

function mapManagerRow(row: Record<string, unknown>): TrainingManager {
  return {
    id: String(row.id),
    externalId: String(row.external_id),
    fullName: String(row.full_name),
    serviceTag: String(row.service_tag ?? "retro-pressa"),
    inviteToken: String(row.invite_token),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function botUsername(): string {
  return (config.TRAINER_BOT_USERNAME || process.env.TRAINER_BOT_USERNAME || "dushnila12_bot").replace(/^@/, "");
}

function publicApiBase(): string {
  return (config.PUBLIC_API_URL || `http://localhost:${config.PORT}`).replace(/\/$/, "");
}

export function buildManagerPracticeLinks(manager: TrainingManager): ManagerPracticeLinks {
  const botLink = buildInviteLink(botUsername(), manager.inviteToken);
  const practicePageUrl = `${publicApiBase()}/trainer/practice?manager=${encodeURIComponent(manager.externalId)}`;
  return { manager, botLink, practicePageUrl, inviteToken: manager.inviteToken };
}

export function getManagerByExternalId(externalId: string): TrainingManager | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM training_managers WHERE external_id = ?").get(externalId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapManagerRow(row) : null;
}

export function getManagerById(id: string): TrainingManager | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM training_managers WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapManagerRow(row) : null;
}

export function createManager(opts: {
  externalId: string;
  fullName: string;
  serviceTag?: string;
  managerTelegramId?: string;
}): ManagerPracticeLinks {
  const db = getDb();
  const externalId = opts.externalId.trim();
  const fullName = opts.fullName.trim();
  if (!externalId) throw new Error("externalId required");
  if (!fullName) throw new Error("fullName required");

  const existing = getManagerByExternalId(externalId);
  if (existing) {
    if (opts.fullName && existing.fullName !== fullName) {
      db.prepare("UPDATE training_managers SET full_name = ?, updated_at = ? WHERE id = ?")
        .run(fullName, new Date().toISOString(), existing.id);
      existing.fullName = fullName;
    }
    return buildManagerPracticeLinks(existing);
  }

  const invite = createInvite({
    teamName: fullName,
    presetFullName: fullName,
    serviceTag: opts.serviceTag ?? "retro-pressa",
    managerTelegramId: opts.managerTelegramId,
    maxUses: 10,
  });

  const id = genId();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO training_managers (id, external_id, full_name, service_tag, invite_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, externalId, fullName, opts.serviceTag ?? "retro-pressa", invite.token, now, now);

  const manager = getManagerById(id)!;
  logger.info("Training manager created", { externalId, fullName, inviteToken: invite.token });

  return buildManagerPracticeLinks(manager);
}

export function getManagerPracticeLinks(externalId: string): ManagerPracticeLinks | null {
  const manager = getManagerByExternalId(externalId);
  if (!manager) return null;
  const invite = getInvite(manager.inviteToken);
  if (!invite?.isActive) return null;
  return buildManagerPracticeLinks(manager);
}

/** Creates manager + invite if missing (for LMS auto-provision on practice stage). */
export function ensureManagerPracticeLinks(opts: {
  externalId: string;
  fullName: string;
  serviceTag?: string;
}): ManagerPracticeLinks {
  const existing = getManagerPracticeLinks(opts.externalId);
  if (existing) return existing;
  return createManager({
    externalId: opts.externalId,
    fullName: opts.fullName,
    serviceTag: opts.serviceTag,
  });
}

export function listManagers(): TrainingManager[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM training_managers ORDER BY full_name ASC").all() as Array<Record<string, unknown>>;
  return rows.map(mapManagerRow);
}
