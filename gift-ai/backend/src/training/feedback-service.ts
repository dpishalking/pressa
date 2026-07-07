import { getDb } from "../db/client.js";
import { logger } from "../logger.js";
import { config } from "../config.js";

export type SessionFeedback = {
  sessionId: string;
  userId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

export function getSessionFeedback(sessionId: string): SessionFeedback | null {
  const row = getDb()
    .prepare("SELECT session_id, user_id, rating, comment, created_at FROM training_session_feedback WHERE session_id = ?")
    .get(sessionId) as { session_id: string; user_id: string; rating: number; comment: string | null; created_at: string } | undefined;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

export function submitSessionFeedback(opts: {
  sessionId: string;
  userId: string;
  rating: number;
  comment?: string;
}): SessionFeedback {
  const { sessionId, userId, rating, comment } = opts;
  if (rating < 1 || rating > 5) throw new Error("Rating must be 1-5");

  const db = getDb();
  const session = db.prepare("SELECT id, user_id, status FROM training_sessions WHERE id = ?")
    .get(sessionId) as { id: string; user_id: string; status: string } | undefined;
  if (!session) throw new Error("Session not found");
  if (session.user_id !== userId) throw new Error("Session does not belong to user");
  if (session.status !== "completed") throw new Error("Session is not completed");

  const now = new Date().toISOString();
  const trimmedComment = comment?.trim() || null;

  db.prepare(`
    INSERT INTO training_session_feedback (session_id, user_id, rating, comment, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      rating = excluded.rating,
      comment = excluded.comment,
      created_at = excluded.created_at
  `).run(sessionId, userId, rating, trimmedComment, now);

  return { sessionId, userId, rating, comment: trimmedComment, createdAt: now };
}

async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = config.TRAINER_NOTIFY_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (e) {
    logger.warn("Feedback notify failed", { chatId, error: String(e) });
  }
}

export async function notifySessionFeedback(opts: {
  sessionId: string;
  employeeName: string;
  scenarioName: string;
  score: number | null;
  rating: number;
  comment: string | null;
}): Promise<void> {
  const stars = "⭐".repeat(opts.rating);
  const lines = [
    "💬 <b>Обратная связь после ролевки</b>",
    "",
    `👤 ${opts.employeeName}`,
    `📋 ${opts.scenarioName}`,
    opts.score != null ? `📊 Оценка AI: ${opts.score}/100` : "",
    `Оценка студента: ${stars} (${opts.rating}/5)`,
  ].filter(Boolean);

  if (opts.comment) {
    lines.push("", `<i>${opts.comment.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</i>`);
  }

  const text = lines.join("\n");
  const recipients = new Set<string>(config.TRAINER_NOTIFY_TELEGRAM_IDS);

  const db = getDb();
  const session = db.prepare(`
    SELECT u.team_id, u.telegram_id FROM training_sessions s
    JOIN training_users u ON u.id = s.user_id WHERE s.id = ?
  `).get(opts.sessionId) as { team_id: string | null; telegram_id: string } | undefined;

  if (session?.team_id) {
    const team = db.prepare("SELECT manager_telegram_id FROM training_teams WHERE id = ?")
      .get(session.team_id) as { manager_telegram_id: string | null } | undefined;
    if (team?.manager_telegram_id) recipients.add(team.manager_telegram_id);
  }
  if (session?.telegram_id) recipients.delete(session.telegram_id);

  for (const chatId of recipients) {
    await sendTelegram(chatId, text);
  }
}
