import { randomUUID } from "node:crypto";
import { getDb } from "../db/client.js";
import type {
  ConsultationStage,
  Conversation,
  ConversationMessage,
  LeadScoreBand,
  QualificationFields,
} from "../types/index.js";
import { EMPTY_QUALIFICATION } from "../types/index.js";
import { sanitizeAssistantMessage } from "./engine-response-parser.js";

function parseFields(json: string): QualificationFields {
  try {
    return { ...EMPTY_QUALIFICATION, ...JSON.parse(json) };
  } catch {
    return { ...EMPTY_QUALIFICATION };
  }
}

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    channel: String(row.channel),
    channelUserId: String(row.channel_user_id),
    stage: Number(row.stage) as ConsultationStage,
    fields: parseFields(String(row.fields_json)),
    leadScore: Number(row.lead_score),
    leadScoreBand: String(row.lead_score_band) as LeadScoreBand,
    status: String(row.status) as Conversation["status"],
    summary: String(row.summary),
    bitrixLeadId: row.bitrix_lead_id ? String(row.bitrix_lead_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ConversationMemory {
  getOrCreate(channel: string, channelUserId: string): Conversation {
    const db = getDb();
    const existing = db
      .prepare(
        `SELECT * FROM conversations WHERE channel = ? AND channel_user_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(channel, channelUserId);
    if (existing) return rowToConversation(existing as Record<string, unknown>);

    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO conversations (id, channel, channel_user_id, stage, fields_json, lead_score, lead_score_band, status, summary, created_at, updated_at)
       VALUES (?, ?, ?, 1, '{}', 0, 'interested', 'active', '', ?, ?)`,
    ).run(id, channel, channelUserId, now, now);
    return this.getById(id)!;
  }

  getById(id: string): Conversation | null {
    const row = getDb().prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    return row ? rowToConversation(row as Record<string, unknown>) : null;
  }

  listAll(limit = 100): Conversation[] {
    const rows = getDb()
      .prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?")
      .all(limit);
    return rows.map((r) => rowToConversation(r as Record<string, unknown>));
  }

  update(
    id: string,
    patch: Partial<
      Pick<Conversation, "stage" | "fields" | "leadScore" | "leadScoreBand" | "status" | "summary" | "bitrixLeadId">
    >,
  ): Conversation | null {
    const current = this.getById(id);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
      fields: patch.fields ? { ...current.fields, ...patch.fields } : current.fields,
      updatedAt: new Date().toISOString(),
    };
    getDb()
      .prepare(
        `UPDATE conversations SET stage = ?, fields_json = ?, lead_score = ?, lead_score_band = ?,
         status = ?, summary = ?, bitrix_lead_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        next.stage,
        JSON.stringify(next.fields),
        next.leadScore,
        next.leadScoreBand,
        next.status,
        next.summary,
        next.bitrixLeadId,
        next.updatedAt,
        id,
      );
    return this.getById(id);
  }

  addMessage(conversationId: string, role: ConversationMessage["role"], content: string): ConversationMessage {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    getDb()
      .prepare("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, conversationId, role, content, createdAt);
    getDb()
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(createdAt, conversationId);
    return { id, conversationId, role, content, createdAt };
  }

  getMessages(conversationId: string): ConversationMessage[] {
    const rows = getDb()
      .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
      .all(conversationId);
    return rows.map((r) => ({
      id: String((r as Record<string, unknown>).id),
      conversationId,
      role: String((r as Record<string, unknown>).role) as ConversationMessage["role"],
      content: String((r as Record<string, unknown>).content),
      createdAt: String((r as Record<string, unknown>).created_at),
    }));
  }

  formatTranscript(conversationId: string): string {
    return this.getMessages(conversationId)
      .map((m) => {
        const content = m.role === "assistant" ? sanitizeAssistantMessage(m.content) : m.content;
        return `${m.role === "user" ? "Клиент" : "Ассистент"}: ${content}`;
      })
      .join("\n\n");
  }

  reset(channel: string, channelUserId: string): Conversation {
    const db = getDb();
    db.prepare(
      `UPDATE conversations SET status = 'abandoned', updated_at = ? WHERE channel = ? AND channel_user_id = ? AND status = 'active'`,
    ).run(new Date().toISOString(), channel, channelUserId);
    return this.getOrCreate(channel, channelUserId);
  }
}

export const conversationMemory = new ConversationMemory();
