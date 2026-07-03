import { Hono } from "hono";
import {
  getOrCreateUser,
  getUserByTelegramId,
  startSession,
  processEmployeeMessage,
  processBModeMessage,
  finishSession,
  getUserProgress,
  getLeaderboard,
  listScenariosFromDb,
} from "../training/training-service.js";
import { getScenarioFromDb } from "../training/scenario-loader.js";
import { importConversations, listImportedScenarioFiles } from "../training/conversation-importer.js";
import { config } from "../config.js";
import { getDb } from "../db/client.js";
import { logger } from "../logger.js";

export const trainerRouter = new Hono();

// ─── User Registration ────────────────────────────────────────────────────────

trainerRouter.post("/users/register", async (c) => {
  try {
    const body = await c.req.json() as { telegramId: string; fullName: string; username?: string };
    const { telegramId, fullName, username = "" } = body;
    if (!telegramId || !fullName) return c.json({ error: "telegramId and fullName required" }, 400);

    const userId = getOrCreateUser(String(telegramId), fullName, username);
    const user = getUserByTelegramId(String(telegramId));
    return c.json({ userId, user });
  } catch (e) {
    logger.error("register user error", { error: String(e) });
    return c.json({ error: "Internal error" }, 500);
  }
});

trainerRouter.get("/users/:telegramId", async (c) => {
  const telegramId = c.req.param("telegramId");
  const user = getUserByTelegramId(telegramId);
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(user);
});

// ─── Scenarios ────────────────────────────────────────────────────────────────

trainerRouter.get("/scenarios", async (c) => {
  try {
    const { difficulty, skill, published } = c.req.query();
    const scenarios = listScenariosFromDb({
      difficulty,
      skill,
      publishedOnly: published !== "false",
    });
    return c.json({ scenarios, total: scenarios.length });
  } catch (e) {
    logger.error("list scenarios error", { error: String(e) });
    return c.json({ error: "Internal error" }, 500);
  }
});

trainerRouter.get("/scenarios/:id", async (c) => {
  const id = c.req.param("id");
  const scenario = getScenarioFromDb(id);
  if (!scenario) return c.json({ error: "Scenario not found" }, 404);

  // Never expose hidden facts to client
  const { hiddenFacts: _, ...safeScenario } = scenario;
  return c.json(safeScenario);
});

// ─── Sessions ─────────────────────────────────────────────────────────────────

trainerRouter.post("/sessions/start", async (c) => {
  try {
    const body = await c.req.json() as {
      userId: string;
      scenarioId: string;
      mode?: string;
      hintMode?: boolean;
    };
    const { userId, scenarioId, mode = "mode_a", hintMode = false } = body;

    if (!userId || !scenarioId) return c.json({ error: "userId and scenarioId required" }, 400);
    if (mode !== "mode_a" && mode !== "mode_b") return c.json({ error: "mode must be mode_a or mode_b" }, 400);

    const result = await startSession({
      userId,
      scenarioId,
      mode: mode as "mode_a" | "mode_b",
      hintMode,
    });

    // Return safe scenario (no hidden facts)
    const { hiddenFacts: _, ...safeScenario } = result.scenario;

    return c.json({
      sessionId: result.sessionId,
      scenario: safeScenario,
      initialMessage: result.initialMessage,
      clientState: result.clientState,
    });
  } catch (e) {
    logger.error("start session error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.post("/sessions/:sessionId/message", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json() as { text: string };
    const { text } = body;

    if (!text?.trim()) return c.json({ error: "text required" }, 400);

    const session = getDb().prepare("SELECT mode FROM training_sessions WHERE id = ? AND status = 'active'")
      .get(sessionId) as { mode: string } | undefined;
    if (!session) return c.json({ error: "Session not found or not active" }, 404);

    if (session.mode === "mode_a") {
      const result = await processEmployeeMessage(sessionId, text.trim());
      return c.json(result);
    } else {
      const result = await processBModeMessage(sessionId, text.trim());
      return c.json(result);
    }
  } catch (e) {
    logger.error("process message error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.post("/sessions/:sessionId/finish", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const evaluation = await finishSession(sessionId);
    return c.json({ evaluation });
  } catch (e) {
    logger.error("finish session error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.get("/sessions/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const db = getDb();
    const session = db.prepare("SELECT * FROM training_sessions WHERE id = ?").get(sessionId) as Record<string, unknown> | undefined;
    if (!session) return c.json({ error: "Session not found" }, 404);

    const messages = db.prepare("SELECT author, text, turn_index, created_at FROM training_messages WHERE session_id = ? ORDER BY turn_index")
      .all(sessionId) as Array<{ author: string; text: string; turn_index: number; created_at: string }>;

    return c.json({
      session: {
        id: session.id,
        userId: session.user_id,
        scenarioId: session.scenario_id,
        mode: session.mode,
        status: session.status,
        score: session.score,
        result: session.result,
        hintsUsed: session.hints_used,
        hintMode: Boolean(session.hint_mode),
        clientState: JSON.parse(String(session.client_state_json)),
        startedAt: session.started_at,
        completedAt: session.completed_at,
      },
      messages,
    });
  } catch (e) {
    logger.error("get session error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.get("/sessions/:sessionId/evaluation", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const db = getDb();
    const eval_ = db.prepare("SELECT * FROM training_evaluations WHERE session_id = ?").get(sessionId) as Record<string, unknown> | undefined;
    if (!eval_) return c.json({ error: "Evaluation not found" }, 404);

    return c.json({
      evaluation: {
        totalScore: eval_.total_score,
        categoryScores: JSON.parse(String(eval_.category_scores_json)),
        strengths: JSON.parse(String(eval_.strengths_json)),
        mistakes: JSON.parse(String(eval_.mistakes_json)),
        missedQuestions: JSON.parse(String(eval_.missed_questions_json)),
        clientEmotions: JSON.parse(String(eval_.client_emotions_json)),
        turningPoints: JSON.parse(String(eval_.turning_points_json)),
        stateChanges: JSON.parse(String(eval_.state_changes_json)),
        betterReplies: JSON.parse(String(eval_.better_replies_json)),
        finalResult: eval_.final_result,
        clientFeeling: eval_.client_feeling,
        exampleNextMessage: eval_.example_next_message,
      },
    });
  } catch (e) {
    logger.error("get evaluation error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Progress ─────────────────────────────────────────────────────────────────

trainerRouter.get("/users/:userId/progress", async (c) => {
  try {
    const userId = c.req.param("userId");
    const progress = getUserProgress(userId);
    return c.json(progress);
  } catch (e) {
    logger.error("get progress error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.get("/users/:userId/history", async (c) => {
  try {
    const userId = c.req.param("userId");
    const db = getDb();
    const sessions = db.prepare(`
      SELECT s.id, s.scenario_id, s.mode, s.status, s.score, s.result, s.hints_used, s.started_at, s.completed_at,
             sc.name as scenario_name, sc.difficulty
      FROM training_sessions s
      JOIN training_scenarios sc ON sc.id = s.scenario_id
      WHERE s.user_id = ?
      ORDER BY s.started_at DESC
      LIMIT 50
    `).all(userId) as Array<Record<string, unknown>>;

    return c.json({ sessions });
  } catch (e) {
    logger.error("get history error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Leaderboard ──────────────────────────────────────────────────────────────

trainerRouter.get("/leaderboard", async (c) => {
  try {
    const { teamId } = c.req.query();
    const leaderboard = getLeaderboard(teamId);
    return c.json({ leaderboard });
  } catch (e) {
    logger.error("get leaderboard error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Admin: Team Analytics ────────────────────────────────────────────────────

trainerRouter.get("/admin/team-analytics", async (c) => {
  try {
    const db = getDb();

    // Overall team stats
    const teamStats = db.prepare(`
      SELECT
        COUNT(DISTINCT u.id) as total_users,
        COUNT(s.id) as total_sessions,
        AVG(s.score) as avg_score,
        SUM(CASE WHEN s.result = 'sale' THEN 1 ELSE 0 END) as successful_sessions
      FROM training_users u
      LEFT JOIN training_sessions s ON s.user_id = u.id AND s.status = 'completed'
      WHERE u.is_active = 1
    `).get() as { total_users: number; total_sessions: number; avg_score: number | null; successful_sessions: number };

    // Per-user skill heatmap
    const skillData = db.prepare(`
      SELECT u.id, u.full_name, ss.skill, ss.score, ss.attempts
      FROM training_users u
      LEFT JOIN skill_scores ss ON ss.user_id = u.id
      WHERE u.is_active = 1
      ORDER BY u.full_name, ss.skill
    `).all() as Array<{ id: string; full_name: string; skill: string; score: number; attempts: number }>;

    // Build heatmap structure
    const users: Record<string, { fullName: string; skills: Record<string, number> }> = {};
    for (const row of skillData) {
      if (!users[row.id]) users[row.id] = { fullName: row.full_name, skills: {} };
      if (row.skill) users[row.id].skills[row.skill] = row.score;
    }

    // Team weak skills
    const weakSkills = db.prepare(`
      SELECT skill, AVG(score) as avg_score
      FROM skill_scores
      GROUP BY skill
      ORDER BY avg_score ASC
      LIMIT 3
    `).all() as Array<{ skill: string; avg_score: number }>;

    // Common mistakes from evaluations
    const recentEvals = db.prepare(`
      SELECT mistakes_json FROM training_evaluations ORDER BY created_at DESC LIMIT 20
    `).all() as Array<{ mistakes_json: string }>;

    const allMistakes: string[] = [];
    for (const e of recentEvals) {
      try {
        const mistakes = JSON.parse(e.mistakes_json) as string[];
        allMistakes.push(...mistakes);
      } catch { /* skip */ }
    }

    // Count frequency of mistake keywords
    const mistakeFreq: Record<string, number> = {};
    for (const m of allMistakes) {
      const key = m.slice(0, 50);
      mistakeFreq[key] = (mistakeFreq[key] ?? 0) + 1;
    }
    const topMistakes = Object.entries(mistakeFreq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([text, count]) => ({ text, count }));

    // At-risk employees (low avg score or no recent training)
    const atRisk = db.prepare(`
      SELECT u.id, u.full_name,
             AVG(s.score) as avg_score,
             MAX(s.started_at) as last_session,
             COUNT(s.id) as total
      FROM training_users u
      LEFT JOIN training_sessions s ON s.user_id = u.id AND s.status = 'completed'
      WHERE u.is_active = 1
      GROUP BY u.id
      HAVING avg_score < 60 OR total < 3
      ORDER BY avg_score ASC
      LIMIT 10
    `).all() as Array<{ id: string; full_name: string; avg_score: number | null; last_session: string | null; total: number }>;

    return c.json({
      teamStats: {
        totalUsers: teamStats.total_users,
        totalSessions: teamStats.total_sessions,
        averageScore: teamStats.avg_score ? Math.round(teamStats.avg_score) : 0,
        successRate: teamStats.total_sessions
          ? Math.round((teamStats.successful_sessions / teamStats.total_sessions) * 100)
          : 0,
      },
      heatmap: Object.entries(users).map(([id, data]) => ({ id, ...data })),
      weakSkills,
      topMistakes,
      atRisk,
    });
  } catch (e) {
    logger.error("team analytics error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Admin: Assignments ───────────────────────────────────────────────────────

trainerRouter.post("/admin/assignments", async (c) => {
  try {
    const body = await c.req.json() as {
      assignedBy: string;
      assignedToUserId?: string;
      assignedToTeamId?: string;
      scenarioId: string;
      dueDate?: string;
      note?: string;
    };

    const db = getDb();
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    db.prepare(`
      INSERT INTO training_assignments (id, assigned_by, assigned_to_user_id, assigned_to_team_id, scenario_id, due_date, status, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      id,
      body.assignedBy,
      body.assignedToUserId ?? null,
      body.assignedToTeamId ?? null,
      body.scenarioId,
      body.dueDate ?? null,
      body.note ?? null,
      new Date().toISOString(),
    );

    return c.json({ assignmentId: id, status: "created" });
  } catch (e) {
    logger.error("create assignment error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.get("/admin/assignments/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");
    const db = getDb();
    const assignments = db.prepare(`
      SELECT a.*, sc.name as scenario_name, sc.difficulty, sc.training_skill
      FROM training_assignments a
      JOIN training_scenarios sc ON sc.id = a.scenario_id
      WHERE a.assigned_to_user_id = ? AND a.status != 'completed'
      ORDER BY a.due_date ASC, a.created_at DESC
    `).all(userId) as Array<Record<string, unknown>>;

    return c.json({ assignments });
  } catch (e) {
    logger.error("get assignments error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Admin: Import real conversations ─────────────────────────────────────────

trainerRouter.post("/admin/import-conversations", async (c) => {
  try {
    const body = await c.req.json() as {
      filePath?: string;
      limit?: number;
      difficulty?: string;
      skill?: string;
      skipExisting?: boolean;
    };

    const filePath = body.filePath ?? config.CONVERSATIONS_EXPORT_PATH;
    const limit = typeof body.limit === "number" ? body.limit : 5;
    const skipExisting = body.skipExisting !== false;

    logger.info("Starting conversation import via API", { filePath, limit });

    const result = await importConversations({
      filePath,
      limit,
      difficulty: body.difficulty as never,
      skill: body.skill as never,
      skipExisting,
    });

    return c.json(result);
  } catch (e) {
    logger.error("import-conversations error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.get("/admin/import-conversations/list", async (c) => {
  try {
    const files = listImportedScenarioFiles();
    return c.json({ files, count: files.length });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Admin: Scenario management ───────────────────────────────────────────────

trainerRouter.patch("/admin/scenarios/:id/publish", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json() as { published: boolean };
    const db = getDb();
    db.prepare("UPDATE training_scenarios SET is_published = ?, updated_at = ? WHERE id = ?")
      .run(body.published ? 1 : 0, new Date().toISOString(), id);
    return c.json({ status: "updated" });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});
