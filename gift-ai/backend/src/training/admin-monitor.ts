import { getDb } from "../db/client.js";

export type ActiveSessionRow = {
  sessionId: string;
  userId: string;
  fullName: string;
  username: string;
  scenarioId: string;
  scenarioName: string;
  mode: string;
  startedAt: string;
  messageCount: number;
  lastMessageAt: string | null;
  lastPreview: string | null;
};

export type RecentSessionRow = {
  sessionId: string;
  userId: string;
  fullName: string;
  scenarioName: string;
  score: number | null;
  result: string | null;
  completedAt: string | null;
  feedbackRating: number | null;
  feedbackComment: string | null;
};

export type AdminSessionDetail = {
  session: {
    id: string;
    userId: string;
    fullName: string;
    username: string;
    scenarioName: string;
    mode: string;
    status: string;
    score: number | null;
    result: string | null;
    startedAt: string;
    completedAt: string | null;
  };
  messages: Array<{ author: string; text: string; turnIndex: number; createdAt: string }>;
  evaluation: {
    totalScore: number;
    strengths: string[];
    mistakes: string[];
    finalResult: string;
  } | null;
  feedback: { rating: number; comment: string | null; createdAt: string } | null;
};

export function listActiveSessions(limit = 20): ActiveSessionRow[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      s.id AS session_id,
      s.user_id,
      u.full_name,
      u.username,
      s.scenario_id,
      sc.name AS scenario_name,
      s.mode,
      s.started_at,
      (SELECT COUNT(*) FROM training_messages m WHERE m.session_id = s.id) AS message_count,
      (SELECT MAX(m.created_at) FROM training_messages m WHERE m.session_id = s.id) AS last_message_at,
      (SELECT m.text FROM training_messages m WHERE m.session_id = s.id ORDER BY m.turn_index DESC LIMIT 1) AS last_preview
    FROM training_sessions s
    JOIN training_users u ON u.id = s.user_id
    JOIN training_scenarios sc ON sc.id = s.scenario_id
    WHERE s.status = 'active'
    ORDER BY s.started_at DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    sessionId: String(r.session_id),
    userId: String(r.user_id),
    fullName: String(r.full_name),
    username: String(r.username ?? ""),
    scenarioId: String(r.scenario_id),
    scenarioName: String(r.scenario_name),
    mode: String(r.mode),
    startedAt: String(r.started_at),
    messageCount: Number(r.message_count),
    lastMessageAt: r.last_message_at ? String(r.last_message_at) : null,
    lastPreview: r.last_preview ? String(r.last_preview) : null,
  }));
}

export function listRecentSessions(limit = 20): RecentSessionRow[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      s.id AS session_id,
      s.user_id,
      u.full_name,
      sc.name AS scenario_name,
      s.score,
      s.result,
      s.completed_at,
      f.rating AS feedback_rating,
      f.comment AS feedback_comment
    FROM training_sessions s
    JOIN training_users u ON u.id = s.user_id
    JOIN training_scenarios sc ON sc.id = s.scenario_id
    LEFT JOIN training_session_feedback f ON f.session_id = s.id
    WHERE s.status = 'completed'
    ORDER BY COALESCE(s.completed_at, s.started_at) DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    sessionId: String(r.session_id),
    userId: String(r.user_id),
    fullName: String(r.full_name),
    scenarioName: String(r.scenario_name),
    score: r.score != null ? Number(r.score) : null,
    result: r.result ? String(r.result) : null,
    completedAt: r.completed_at ? String(r.completed_at) : null,
    feedbackRating: r.feedback_rating != null ? Number(r.feedback_rating) : null,
    feedbackComment: r.feedback_comment ? String(r.feedback_comment) : null,
  }));
}

export function getAdminSessionDetail(sessionId: string): AdminSessionDetail | null {
  const db = getDb();
  const session = db.prepare(`
    SELECT s.*, u.full_name, u.username, sc.name AS scenario_name
    FROM training_sessions s
    JOIN training_users u ON u.id = s.user_id
    JOIN training_scenarios sc ON sc.id = s.scenario_id
    WHERE s.id = ?
  `).get(sessionId) as Record<string, unknown> | undefined;
  if (!session) return null;

  const messages = db.prepare(`
    SELECT author, text, turn_index, created_at
    FROM training_messages
    WHERE session_id = ?
    ORDER BY turn_index
  `).all(sessionId) as Array<{ author: string; text: string; turn_index: number; created_at: string }>;

  const evalRow = db.prepare("SELECT * FROM training_evaluations WHERE session_id = ?")
    .get(sessionId) as Record<string, unknown> | undefined;

  const feedbackRow = db.prepare("SELECT rating, comment, created_at FROM training_session_feedback WHERE session_id = ?")
    .get(sessionId) as { rating: number; comment: string | null; created_at: string } | undefined;

  return {
    session: {
      id: String(session.id),
      userId: String(session.user_id),
      fullName: String(session.full_name),
      username: String(session.username ?? ""),
      scenarioName: String(session.scenario_name),
      mode: String(session.mode),
      status: String(session.status),
      score: session.score != null ? Number(session.score) : null,
      result: session.result ? String(session.result) : null,
      startedAt: String(session.started_at),
      completedAt: session.completed_at ? String(session.completed_at) : null,
    },
    messages: messages.map((m) => ({
      author: m.author,
      text: m.text,
      turnIndex: m.turn_index,
      createdAt: m.created_at,
    })),
    evaluation: evalRow
      ? {
          totalScore: Number(evalRow.total_score),
          strengths: JSON.parse(String(evalRow.strengths_json)) as string[],
          mistakes: JSON.parse(String(evalRow.mistakes_json)) as string[],
          finalResult: String(evalRow.final_result),
        }
      : null,
    feedback: feedbackRow
      ? { rating: feedbackRow.rating, comment: feedbackRow.comment, createdAt: feedbackRow.created_at }
      : null,
  };
}
