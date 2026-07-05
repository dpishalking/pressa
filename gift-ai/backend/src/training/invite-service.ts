import { getDb } from "../db/client.js";
import { logger } from "../logger.js";

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function genToken(): string {
  return `inv_${Math.random().toString(36).slice(2, 10)}`;
}

export type TrainingInvite = {
  token: string;
  teamId: string;
  teamName: string;
  presetFullName: string | null;
  serviceTag: string;
  maxUses: number;
  useCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
};

export type RedeemInviteResult = {
  teamId: string;
  teamName: string;
  serviceTag: string;
  presetFullName: string | null;
  managerTelegramId: string | null;
};

export function getOrCreateTeam(opts: {
  name: string;
  serviceTag?: string;
  managerTelegramId?: string;
}): string {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM training_teams WHERE name = ?").get(opts.name) as { id: string } | undefined;
  if (existing) {
    if (opts.managerTelegramId) {
      db.prepare("UPDATE training_teams SET manager_telegram_id = ? WHERE id = ?")
        .run(opts.managerTelegramId, existing.id);
    }
    return existing.id;
  }

  const id = genId();
  db.prepare(`
    INSERT INTO training_teams (id, name, manager_user_id, manager_telegram_id, service_tag, created_at)
    VALUES (?, ?, NULL, ?, ?, ?)
  `).run(
    id,
    opts.name,
    opts.managerTelegramId ?? null,
    opts.serviceTag ?? "retro-pressa",
    new Date().toISOString(),
  );
  return id;
}

export function createInvite(opts: {
  teamName: string;
  serviceTag?: string;
  managerTelegramId?: string;
  presetFullName?: string;
  createdByUserId?: string;
  maxUses?: number;
  expiresAt?: string;
}): TrainingInvite {
  const db = getDb();
  const teamId = getOrCreateTeam({
    name: opts.teamName,
    serviceTag: opts.serviceTag,
    managerTelegramId: opts.managerTelegramId,
  });

  const token = genToken();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO training_invites (
      token, team_id, preset_full_name, service_tag, created_by_user_id,
      max_uses, use_count, expires_at, is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, ?)
  `).run(
    token,
    teamId,
    opts.presetFullName ?? null,
    opts.serviceTag ?? "retro-pressa",
    opts.createdByUserId ?? null,
    opts.maxUses ?? 1,
    opts.expiresAt ?? null,
    now,
  );

  return getInvite(token)!;
}

export function getInvite(token: string): TrainingInvite | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT i.*, t.name AS team_name, t.manager_telegram_id
    FROM training_invites i
    JOIN training_teams t ON t.id = i.team_id
    WHERE i.token = ?
  `).get(token) as Record<string, unknown> | undefined;

  if (!row) return null;
  return mapInviteRow(row);
}

function mapInviteRow(row: Record<string, unknown>): TrainingInvite {
  return {
    token: String(row.token),
    teamId: String(row.team_id),
    teamName: String(row.team_name),
    presetFullName: row.preset_full_name ? String(row.preset_full_name) : null,
    serviceTag: String(row.service_tag ?? "retro-pressa"),
    maxUses: Number(row.max_uses),
    useCount: Number(row.use_count),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    isActive: Boolean(row.is_active),
    createdAt: String(row.created_at),
  };
}

export function redeemInvite(token: string): RedeemInviteResult {
  const db = getDb();
  const invite = getInvite(token);
  if (!invite) throw new Error("Invite not found");
  if (!invite.isActive) throw new Error("Invite is inactive");
  if (invite.expiresAt && Date.parse(invite.expiresAt) < Date.now()) {
    throw new Error("Invite expired");
  }
  if (invite.useCount >= invite.maxUses) throw new Error("Invite already used");

  db.prepare("UPDATE training_invites SET use_count = use_count + 1 WHERE token = ?").run(token);

  const team = db.prepare("SELECT manager_telegram_id FROM training_teams WHERE id = ?")
    .get(invite.teamId) as { manager_telegram_id: string | null } | undefined;

  logger.info("Training invite redeemed", { token, teamId: invite.teamId, serviceTag: invite.serviceTag });

  return {
    teamId: invite.teamId,
    teamName: invite.teamName,
    serviceTag: invite.serviceTag,
    presetFullName: invite.presetFullName,
    managerTelegramId: team?.manager_telegram_id ?? null,
  };
}

export function parseStartPayload(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("inv_")) return trimmed;
  if (trimmed.startsWith("inv-")) return trimmed.replace(/^inv-/, "inv_");
  return null;
}

export function buildInviteLink(botUsername: string, token: string): string {
  const user = botUsername.replace(/^@/, "");
  return `https://t.me/${user}?start=${token}`;
}
