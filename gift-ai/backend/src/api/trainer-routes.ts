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
  getActiveSessionForUser,
} from "../training/training-service.js";
import { getScenarioFromDb } from "../training/scenario-loader.js";
import { generateScenarioForTemplate } from "../training/scenario-templates.js";
import { importConversations, listImportedScenarioFiles } from "../training/conversation-importer.js";
import { createInvite, buildInviteLink, getInvite } from "../training/invite-service.js";
import {
  createManager,
  getManagerPracticeLinks,
  ensureManagerPracticeLinks,
  listManagers,
  listManagerSessionsByExternalId,
  getLmsLinkStatus,
} from "../training/manager-service.js";
import { listActiveSessions, listRecentSessions, getAdminSessionDetail } from "../training/admin-monitor.js";
import { submitSessionFeedback, notifySessionFeedback } from "../training/feedback-service.js";
import { config } from "../config.js";
import { getDb } from "../db/client.js";
import { logger } from "../logger.js";

export const trainerRouter = new Hono();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeInviteToken(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("inv_")) return trimmed;
  if (trimmed.startsWith("inv-")) return trimmed.replace(/^inv-/, "inv_");
  return null;
}

function renderPracticePage(botLink: string, backUrl: string, managerName?: string): string {
  const safeBack = escapeHtml(backUrl || "#");
  const greeting = managerName
    ? `<p class="greeting">Персональная ссылка для <strong>${escapeHtml(managerName)}</strong></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Практика — Retro Pressa</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fafafa; color: #1a1a1a; margin: 0; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 48px; }
    .back { display: inline-flex; align-items: center; gap: 8px; color: #666; text-decoration: none; font-size: 14px; margin-bottom: 32px; }
    .back:hover { color: #1a1a1a; }
    .eyebrow { color: #c0392b; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }
    h1 { font-size: clamp(2rem, 5vw, 3rem); margin: 8px 0 0; line-height: 1.1; }
    .card { margin-top: 40px; background: #fff; border: 1px solid #ececec; border-radius: 16px; padding: 28px 24px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
    .card p { color: #444; line-height: 1.65; font-size: 17px; margin: 0; }
    .greeting { margin-top: 12px !important; font-size: 15px !important; color: #666 !important; }
    ul { margin: 20px 0 0; padding-left: 0; list-style: none; color: #555; line-height: 1.7; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; margin-top: 28px; padding: 16px 24px; background: #2481cc; color: #fff; text-decoration: none; border-radius: 12px; font-size: 16px; font-weight: 600; }
    .btn:hover { background: #1a6ead; }
    h2 { margin-top: 48px; font-size: 1.5rem; }
    .muted { color: #888; font-size: 14px; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <a class="back" href="${safeBack}">← К этапам обучения</a>
    <p class="eyebrow">Обучение менеджеров</p>
    <h1>Практика</h1>
    ${greeting}
    <div class="card">
      <p>В тренажёрном боте вы отрабатываете навыки продаж в безопасной атмосфере: ведёте диалог с AI-клиентом, получаете обратную связь и разбор после каждой ролевки. Никакого давления от реального клиента — только практика и рост.</p>
      <ul>
        <li>• Отработка квалификации, рекомендаций и работы с возражениями</li>
        <li>• Ролевки на реальных сценариях Retro Pressa</li>
        <li>• Оценка и подсказки от искусственного интеллекта после диалога</li>
      </ul>
      <a class="btn" href="${escapeHtml(botLink)}" target="_blank" rel="noopener noreferrer">Открыть тренажёр в Telegram ↗</a>
    </div>
    <h2>Тесты</h2>
    <p class="muted">Раздел в разработке.</p>
  </div>
</body>
</html>`;
}

trainerRouter.get("/practice", (c) => {
  const backUrl = c.req.query("back") ?? "#";
  const managerExternalId = c.req.query("manager")?.trim();
  const managerName = c.req.query("name")?.trim();

  if (managerExternalId) {
    const links = managerName
      ? ensureManagerPracticeLinks({
          externalId: managerExternalId,
          fullName: managerName,
          serviceTag: c.req.query("service") ?? undefined,
        })
      : getManagerPracticeLinks(managerExternalId);

    if (!links) {
      return c.text("Менеджер не найден. Обратитесь к администратору обучения.", 404);
    }
    return c.html(renderPracticePage(links.botLink, backUrl, links.manager.fullName));
  }

  const invite = normalizeInviteToken(c.req.query("invite") ?? c.req.query("start") ?? c.req.query("token"));
  const botUsername = (config.TRAINER_BOT_USERNAME || process.env.TRAINER_BOT_USERNAME || "dushnila12_bot").replace(/^@/, "");
  const botLink = invite ? buildInviteLink(botUsername, invite) : `https://t.me/${botUsername}`;
  return c.html(renderPracticePage(botLink, backUrl));
});

trainerRouter.get("/managers/:externalId/practice", (c) => {
  const externalId = c.req.param("externalId");
  const fullName = c.req.query("name")?.trim();
  const serviceTag = c.req.query("service") ?? undefined;

  const links = fullName
    ? ensureManagerPracticeLinks({ externalId, fullName, serviceTag })
    : getManagerPracticeLinks(externalId);

  if (!links) return c.json({ error: "Manager not found" }, 404);
  return c.json(links);
});

trainerRouter.post("/managers", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);

  try {
    const body = await c.req.json() as {
      externalId: string;
      fullName: string;
      serviceTag?: string;
      managerTelegramId?: string;
    };

    if (!body.externalId?.trim() || !body.fullName?.trim()) {
      return c.json({ error: "externalId and fullName required" }, 400);
    }

    const links = createManager({
      externalId: body.externalId.trim(),
      fullName: body.fullName.trim(),
      serviceTag: body.serviceTag,
      managerTelegramId: body.managerTelegramId,
    });

    return c.json(links);
  } catch (e) {
    logger.error("create manager error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.get("/managers", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const managers = listManagers();
  return c.json({ managers });
});

trainerRouter.get("/managers/:externalId/sessions", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);

  try {
    const externalId = c.req.param("externalId");
    const sessions = listManagerSessionsByExternalId(externalId);
    return c.json({ sessions });
  } catch (e) {
    logger.error("list manager sessions error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.get("/managers/:externalId/lms-status", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);

  try {
    const externalId = c.req.param("externalId");
    return c.json(getLmsLinkStatus(externalId));
  } catch (e) {
    logger.error("get lms link status error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

function requireAdmin(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const key = c.req.header("x-admin-key") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(key && key === config.ADMIN_API_KEY);
}

// ─── User Registration ────────────────────────────────────────────────────────

trainerRouter.post("/users/register", async (c) => {
  try {
    const body = await c.req.json() as {
      telegramId: string;
      fullName: string;
      username?: string;
      inviteToken?: string;
      lmsExternalId?: string;
    };
    const { telegramId, fullName, username = "", inviteToken, lmsExternalId } = body;
    if (!telegramId || !fullName) return c.json({ error: "telegramId and fullName required" }, 400);

    const linkedExternalId = lmsExternalId?.trim();
    if (linkedExternalId) {
      ensureManagerPracticeLinks({
        externalId: linkedExternalId,
        fullName: fullName.trim(),
        serviceTag: "retro-pressa",
      });
    }

    const userId = getOrCreateUser(
      String(telegramId),
      fullName,
      username,
      inviteToken?.trim() || undefined,
      lmsExternalId?.trim() || undefined,
    );
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

trainerRouter.post("/scenarios/generate", async (c) => {
  try {
    const body = await c.req.json() as {
      template?: string;
      type?: string;
      scenarioType?: string;
      kind?: string;
      excludeScenarioId?: string;
    };
    const template = body.template ?? body.type ?? body.scenarioType ?? body.kind ?? "gift_search";
    const result = await generateScenarioForTemplate(template, {
      excludeScenarioId: body.excludeScenarioId,
    });
    const { hiddenFacts: _, ...safeScenario } = result.scenario;
    return c.json({
      scenarioId: result.scenarioId,
      scenario: safeScenario,
      generated: result.generated,
    });
  } catch (e) {
    logger.error("generate scenario error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.post("/sessions/start-from-template", async (c) => {
  try {
    const body = await c.req.json() as {
      userId?: string;
      telegramId?: string;
      fullName?: string;
      username?: string;
      template?: string;
      type?: string;
      scenarioType?: string;
      kind?: string;
      mode?: string;
    };
    const template = body.template ?? body.type ?? body.scenarioType ?? body.kind ?? "gift_search";

    let userId = body.userId?.trim();
    if (!userId && body.telegramId) {
      userId = getOrCreateUser(
        String(body.telegramId),
        body.fullName?.trim() || "Пользователь",
        body.username?.trim() || "",
      );
    }
    if (!userId) return c.json({ error: "userId or telegramId required" }, 400);

    const mode = body.mode === "mode_b" ? "mode_b" : "mode_a";
    const { scenarioId } = await generateScenarioForTemplate(template);
    const result = await startSession({ userId, scenarioId, mode });
    const { hiddenFacts: _, ...safeScenario } = result.scenario;

    return c.json({
      sessionId: result.sessionId,
      scenarioId,
      scenario: safeScenario,
      initialMessage: result.initialMessage,
      initialManagerReply: result.initialManagerReply,
      clientState: result.clientState,
    });
  } catch (e) {
    logger.error("start from template error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
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
      initialManagerReply: result.initialManagerReply,
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

trainerRouter.post("/sessions/:sessionId/feedback", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json() as { userId: string; rating: number; comment?: string };
    if (!body.userId || !body.rating) return c.json({ error: "userId and rating required" }, 400);

    const feedback = submitSessionFeedback({
      sessionId,
      userId: body.userId,
      rating: body.rating,
      comment: body.comment,
    });

    const db = getDb();
    const meta = db.prepare(`
      SELECT u.full_name, sc.name AS scenario_name, s.score
      FROM training_sessions s
      JOIN training_users u ON u.id = s.user_id
      JOIN training_scenarios sc ON sc.id = s.scenario_id
      WHERE s.id = ?
    `).get(sessionId) as { full_name: string; scenario_name: string; score: number | null } | undefined;

    if (meta) {
      void notifySessionFeedback({
        sessionId,
        employeeName: meta.full_name,
        scenarioName: meta.scenario_name,
        score: meta.score,
        rating: feedback.rating,
        comment: feedback.comment,
      });
    }

    return c.json({ feedback });
  } catch (e) {
    logger.error("submit feedback error", { error: String(e) });
    const msg = String(e);
    if (/not found|does not belong|not completed|rating must/i.test(msg)) {
      return c.json({ error: msg }, 400);
    }
    return c.json({ error: msg }, 500);
  }
});

// ─── Progress ─────────────────────────────────────────────────────────────────

trainerRouter.get("/users/:userId/active-session", async (c) => {
  try {
    const userId = c.req.param("userId");
    const active = getActiveSessionForUser(userId);
    if (!active) return c.json({ active: false });
    return c.json({ active: true, ...active });
  } catch (e) {
    logger.error("get active session error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

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

// ─── Admin: Invites ───────────────────────────────────────────────────────────

trainerRouter.post("/admin/invites", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);

  try {
    const body = await c.req.json() as {
      teamName: string;
      serviceTag?: string;
      managerTelegramId?: string;
      presetFullName?: string;
      maxUses?: number;
      expiresAt?: string;
    };

    if (!body.teamName?.trim()) return c.json({ error: "teamName required" }, 400);

    const invite = createInvite({
      teamName: body.teamName.trim(),
      serviceTag: body.serviceTag,
      managerTelegramId: body.managerTelegramId,
      presetFullName: body.presetFullName,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt,
    });

    const botUsername = config.TRAINER_BOT_USERNAME || process.env.TRAINER_BOT_USERNAME || "";
    const inviteLink = botUsername ? buildInviteLink(botUsername, invite.token) : null;
    const publicBase = (config.PUBLIC_API_URL || `http://localhost:${config.PORT}`).replace(/\/$/, "");
    const practicePageUrl = `${publicBase}/trainer/practice?invite=${invite.token}`;

    return c.json({ invite, inviteLink, practicePageUrl });
  } catch (e) {
    logger.error("create invite error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.get("/admin/invites/:token", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);

  const token = c.req.param("token");
  const invite = getInvite(token);
  if (!invite) return c.json({ error: "Invite not found" }, 404);

  const botUsername = config.TRAINER_BOT_USERNAME || process.env.TRAINER_BOT_USERNAME || "";
  const inviteLink = botUsername ? buildInviteLink(botUsername, invite.token) : null;
  const publicBase = (config.PUBLIC_API_URL || `http://localhost:${config.PORT}`).replace(/\/$/, "");
  const practicePageUrl = `${publicBase}/trainer/practice?invite=${invite.token}`;

  return c.json({ invite, inviteLink, practicePageUrl });
});

// ─── Admin: Session Monitor ───────────────────────────────────────────────────

trainerRouter.get("/admin/sessions/active", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  try {
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 50);
    return c.json({ sessions: listActiveSessions(limit) });
  } catch (e) {
    logger.error("admin active sessions error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.get("/admin/sessions/recent", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  try {
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 50);
    return c.json({ sessions: listRecentSessions(limit) });
  } catch (e) {
    logger.error("admin recent sessions error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

trainerRouter.get("/admin/sessions/:sessionId", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  try {
    const detail = getAdminSessionDetail(c.req.param("sessionId"));
    if (!detail) return c.json({ error: "Session not found" }, 404);
    return c.json(detail);
  } catch (e) {
    logger.error("admin session detail error", { error: String(e) });
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Admin: Team Analytics ────────────────────────────────────────────────────

trainerRouter.get("/admin/team-analytics", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
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
