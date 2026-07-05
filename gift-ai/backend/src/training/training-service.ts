import { getDb } from "../db/client.js";
import { logger } from "../logger.js";
import { getLLMProvider } from "../llm/gemini-provider.js";
import { applyStateRules, checkLost, checkPurchaseReady, getStateMoodLabel } from "./state-engine.js";
import { getScenarioFromDb, listScenariosFromDb } from "./scenario-loader.js";
import { redeemInvite } from "./invite-service.js";
import { notifyTrainingSessionComplete } from "./training-notify.js";
import type {
  TrainingScenario,
  ClientState,
  TrainingMode,
  SessionStatus,
  SkillKey,
  EvaluationResult,
  UserRole,
  ClassifiedAction,
  StateChange,
} from "./types.js";
import { DEFAULT_CLIENT_STATE } from "./types.js";

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── User Registration ────────────────────────────────────────────────────────

export function getOrCreateUser(
  telegramId: string,
  fullName: string,
  username: string,
  inviteToken?: string,
): string {
  const db = getDb();
  let teamId: string | null = null;
  let serviceTag: string | null = null;
  let resolvedName = fullName;

  const existing = db.prepare("SELECT id, team_id FROM training_users WHERE telegram_id = ?")
    .get(telegramId) as { id: string; team_id: string | null } | undefined;

  const shouldRedeemInvite = Boolean(inviteToken && (!existing || !existing.team_id));

  if (shouldRedeemInvite && inviteToken) {
    try {
      const redeemed = redeemInvite(inviteToken);
      teamId = redeemed.teamId;
      serviceTag = redeemed.serviceTag;
      if (redeemed.presetFullName) resolvedName = redeemed.presetFullName;
    } catch (e) {
      logger.warn("Invite redemption failed", { inviteToken, error: String(e) });
    }
  }

  if (existing) {
    db.prepare(`
      UPDATE training_users
      SET full_name = ?, username = ?, team_id = COALESCE(?, team_id),
          service_tag = COALESCE(?, service_tag), updated_at = ?
      WHERE telegram_id = ?
    `).run(resolvedName, username, teamId, serviceTag, new Date().toISOString(), telegramId);
    return existing.id;
  }

  const id = genId();
  db.prepare(`
    INSERT INTO training_users (id, telegram_id, full_name, username, role, team_id, service_tag, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'employee', ?, ?, 1, ?, ?)
  `).run(id, telegramId, resolvedName, username, teamId, serviceTag, new Date().toISOString(), new Date().toISOString());
  return id;
}

export function getUserById(userId: string): { id: string; role: UserRole; full_name: string } | null {
  const db = getDb();
  return db.prepare("SELECT id, role, full_name FROM training_users WHERE id = ?").get(userId) as { id: string; role: UserRole; full_name: string } | null;
}

export function getUserByTelegramId(telegramId: string): {
  id: string;
  role: UserRole;
  full_name: string;
  team_id: string | null;
  service_tag: string | null;
  team_name: string | null;
} | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT u.id, u.role, u.full_name, u.team_id, u.service_tag, t.name AS team_name
    FROM training_users u
    LEFT JOIN training_teams t ON t.id = u.team_id
    WHERE u.telegram_id = ?
  `).get(telegramId) as {
    id: string;
    role: UserRole;
    full_name: string;
    team_id: string | null;
    service_tag: string | null;
    team_name: string | null;
  } | undefined;
  return row ?? null;
}

// ─── Session Lifecycle ────────────────────────────────────────────────────────

export interface StartSessionOpts {
  userId: string;
  scenarioId: string;
  mode: TrainingMode;
  hintMode?: boolean;
}

export interface StartSessionResult {
  sessionId: string;
  scenario: TrainingScenario;
  initialMessage: string;
  initialManagerReply?: string;
  clientState: ClientState;
}

export async function startSession(opts: StartSessionOpts): Promise<StartSessionResult> {
  const { userId, scenarioId, mode, hintMode = false } = opts;
  const db = getDb();

  const scenario = getScenarioFromDb(scenarioId);
  if (!scenario) throw new Error(`Scenario not found: ${scenarioId}`);

  // Abandon any existing active session
  db.prepare("UPDATE training_sessions SET status = 'abandoned', completed_at = ? WHERE user_id = ? AND status = 'active'")
    .run(new Date().toISOString(), userId);

  const sessionId = genId();
  const initialState: ClientState = { ...DEFAULT_CLIENT_STATE, ...scenario.initialClientState };

  db.prepare(`
    INSERT INTO training_sessions (id, user_id, scenario_id, mode, status, client_state_json, hints_used, hint_mode, started_at)
    VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?)
  `).run(sessionId, userId, scenarioId, mode, JSON.stringify(initialState), hintMode ? 1 : 0, new Date().toISOString());

  // Save initial client message
  await saveMessage(sessionId, "client", scenario.initialMessage, 0);

  let initialManagerReply: string | undefined;
  if (mode === "mode_b") {
    const llm = getLLMProvider();
    initialManagerReply = await llm.generateManagerReply({
      scenario,
      history: [{ author: "client", text: scenario.initialMessage }],
      clientState: initialState,
    });
    await saveMessage(sessionId, "employee", initialManagerReply, 1);
  }

  return {
    sessionId,
    scenario,
    initialMessage: scenario.initialMessage,
    initialManagerReply,
    clientState: initialState,
  };
}

export function getActiveSessionForUser(userId: string): {
  sessionId: string;
  scenarioId: string;
  mode: TrainingMode;
} | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, scenario_id, mode FROM training_sessions
    WHERE user_id = ? AND status = 'active'
    ORDER BY started_at DESC LIMIT 1
  `).get(userId) as { id: string; scenario_id: string; mode: TrainingMode } | undefined;

  if (!row) return null;
  return { sessionId: row.id, scenarioId: row.scenario_id, mode: row.mode };
}

export interface ProcessMessageResult {
  clientReply: string;
  clientState: ClientState;
  stateChanges: StateChange[];
  moodLabel: string;
  isPurchaseReady: boolean;
  isLost: boolean;
  turnIndex: number;
  hint?: { currentStage: string; knownFacts: string[]; unknownFacts: string[]; suggestion: string; clientMoodLabel: string };
}

function buildFallbackClientReply(): string {
  return "Понял вас. Подскажите, пожалуйста: для кого подарок и к какой дате нужно успеть? Хочу предложить подходящий формат.";
}

export async function processEmployeeMessage(
  sessionId: string,
  employeeText: string,
): Promise<ProcessMessageResult> {
  const db = getDb();

  const session = db.prepare("SELECT * FROM training_sessions WHERE id = ? AND status = 'active'")
    .get(sessionId) as Record<string, unknown> | undefined;

  if (!session) throw new Error("Session not found or not active");

  const scenario = getScenarioFromDb(String(session.scenario_id));
  if (!scenario) throw new Error("Scenario not found");

  const currentState: ClientState = JSON.parse(String(session.client_state_json));
  const history = getSessionHistory(sessionId);
  const turnIndex = history.length;

  // Save employee message
  await saveMessage(sessionId, "employee", employeeText, turnIndex);

  // Classify manager action
  const llm = getLLMProvider();
  const classified = await llm.classifyManagerAction({
    managerText: employeeText,
    history,
    clientState: currentState,
    scenario,
  });

  // Apply state rules
  const revealedFacts = getRevealedFacts(sessionId);
  const { newState, changes } = applyStateRules(currentState, classified);

  // Check fact revelation (naive: if manager asked about X and client state improves emotionalFit/clarity, reveal facts)
  const newRevealedFacts = updateRevealedFacts(sessionId, classified, scenario, revealedFacts);

  // Generate client reply
  let clientReply: string;
  try {
    clientReply = await llm.generateClientReply({
      scenario,
      history: [...history, { author: "employee", text: employeeText }],
      clientState: newState,
      lastManagerAction: classified,
      revealedFacts: newRevealedFacts,
    });
  } catch (e) {
    logger.warn("generateClientReply failed, using fallback reply", { sessionId, error: String(e) });
    clientReply = buildFallbackClientReply();
  }

  // Save client message (with state before/after)
  const clientTurnIndex = turnIndex + 1;
  db.prepare(`
    INSERT INTO training_messages (id, session_id, author, text, classified_actions_json, state_before_json, state_after_json, state_changes_json, turn_index, created_at)
    VALUES (?, ?, 'client', ?, NULL, ?, ?, ?, ?, ?)
  `).run(
    genId(), sessionId, clientReply,
    JSON.stringify(currentState),
    JSON.stringify(newState),
    JSON.stringify(changes),
    clientTurnIndex,
    new Date().toISOString(),
  );

  // Update employee message with classified actions and state info
  db.prepare(`
    UPDATE training_messages
    SET classified_actions_json = ?, state_before_json = ?, state_after_json = ?, state_changes_json = ?
    WHERE session_id = ? AND author = 'employee' AND turn_index = ?
  `).run(
    JSON.stringify(classified),
    JSON.stringify(currentState),
    JSON.stringify(newState),
    JSON.stringify(changes),
    sessionId,
    turnIndex,
  );

  // Update session state
  db.prepare("UPDATE training_sessions SET client_state_json = ? WHERE id = ?")
    .run(JSON.stringify(newState), sessionId);

  const isPurchaseReady = checkPurchaseReady(newState, scenario.stateThresholds);
  const isLost = checkLost(newState);

  if (isPurchaseReady || isLost) {
    db.prepare("UPDATE training_sessions SET status = 'completed', result = ?, completed_at = ? WHERE id = ?")
      .run(isPurchaseReady ? "sale" : "lost", new Date().toISOString(), sessionId);
  }

  // Generate hint if hint mode is enabled
  let hint: ProcessMessageResult["hint"];
  if (session.hint_mode) {
    hint = await llm.generateHint({
      scenario,
      history: getSessionHistory(sessionId),
      clientState: newState,
      revealedFacts: newRevealedFacts,
    });

    db.prepare("UPDATE training_sessions SET hints_used = hints_used + 1 WHERE id = ?")
      .run(sessionId);
  }

  return {
    clientReply,
    clientState: newState,
    stateChanges: changes,
    moodLabel: getStateMoodLabel(newState),
    isPurchaseReady,
    isLost,
    turnIndex: clientTurnIndex,
    hint,
  };
}

export async function processBModeMessage(
  sessionId: string,
  clientText: string,
): Promise<{ managerReply: string; clientState: ClientState; turnIndex: number }> {
  const db = getDb();

  const session = db.prepare("SELECT * FROM training_sessions WHERE id = ? AND status = 'active'")
    .get(sessionId) as Record<string, unknown> | undefined;
  if (!session) throw new Error("Session not found or not active");

  const scenario = getScenarioFromDb(String(session.scenario_id));
  if (!scenario) throw new Error("Scenario not found");

  const currentState: ClientState = JSON.parse(String(session.client_state_json));
  const history = getSessionHistory(sessionId);
  const turnIndex = history.length;

  await saveMessage(sessionId, "client", clientText, turnIndex);

  const llm = getLLMProvider();
  const managerReply = await llm.generateManagerReply({
    scenario,
    history: [...history, { author: "client", text: clientText }],
    clientState: currentState,
  });

  await saveMessage(sessionId, "employee", managerReply, turnIndex + 1);

  return {
    managerReply,
    clientState: currentState,
    turnIndex: turnIndex + 1,
  };
}

export async function finishSession(sessionId: string): Promise<EvaluationResult> {
  const db = getDb();

  const session = db.prepare("SELECT * FROM training_sessions WHERE id = ?")
    .get(sessionId) as Record<string, unknown> | undefined;
  if (!session) throw new Error("Session not found");

  // Mark complete if still active
  if (session.status === "active") {
    db.prepare("UPDATE training_sessions SET status = 'completed', result = 'incomplete', completed_at = ? WHERE id = ?")
      .run(new Date().toISOString(), sessionId);
  }

  const scenario = getScenarioFromDb(String(session.scenario_id));
  if (!scenario) throw new Error("Scenario not found");

  const history = getSessionHistory(sessionId);
  const finalState: ClientState = JSON.parse(String(session.client_state_json));
  const hintsUsed = Number(session.hints_used) ?? 0;

  // Build state history from messages
  const messages = db.prepare("SELECT * FROM training_messages WHERE session_id = ? ORDER BY turn_index")
    .all(sessionId) as Array<Record<string, unknown>>;
  const stateHistory = messages
    .filter((m) => m.state_after_json)
    .map((m) => ({
      turn: Number(m.turn_index),
      state: JSON.parse(String(m.state_after_json)) as ClientState,
    }));

  const llm = getLLMProvider();
  const evaluation = await llm.evaluateSession({
    scenario,
    history,
    stateHistory,
    finalState,
    hintsUsed,
  });

  // Save evaluation
  const evalId = genId();
  db.prepare(`
    INSERT OR REPLACE INTO training_evaluations (
      id, session_id, total_score, category_scores_json, strengths_json, mistakes_json,
      missed_questions_json, client_emotions_json, turning_points_json, state_changes_json,
      better_replies_json, final_result, client_feeling, example_next_message, raw_response, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    evalId, sessionId, evaluation.totalScore,
    JSON.stringify(evaluation.categoryScores),
    JSON.stringify(evaluation.strengths),
    JSON.stringify(evaluation.mistakes),
    JSON.stringify(evaluation.missedQuestions),
    JSON.stringify(evaluation.clientEmotions),
    JSON.stringify(evaluation.turningPoints),
    JSON.stringify(evaluation.stateChanges),
    JSON.stringify(evaluation.betterReplies),
    evaluation.finalResult,
    evaluation.clientFeeling ?? null,
    evaluation.exampleNextMessage ?? null,
    null,
    new Date().toISOString(),
  );

  // Update session score
  db.prepare("UPDATE training_sessions SET score = ? WHERE id = ?")
    .run(evaluation.totalScore, sessionId);

  // Update skill scores
  await updateSkillScores(String(session.user_id), evaluation);

  void notifyTrainingSessionComplete(sessionId, evaluation).catch((e) => {
    logger.warn("Training notify failed", { sessionId, error: String(e) });
  });

  return evaluation;
}

// ─── Skill Progress ───────────────────────────────────────────────────────────

async function updateSkillScores(userId: string, evaluation: EvaluationResult): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  const skillMap: Record<string, number> = {
    qualification: evaluation.categoryScores.qualification / 20 * 100,
    recommendation: evaluation.categoryScores.recommendation / 20 * 100,
    productClarity: evaluation.categoryScores.productClarity / 15 * 100,
    visualSelling: evaluation.categoryScores.visual / 10 * 100,
    pricing: evaluation.categoryScores.pricing / 15 * 100,
    closing: evaluation.categoryScores.closing / 10 * 100,
    objectionHandling: evaluation.categoryScores.objectionHandling / 10 * 100,
  };

  for (const [skill, score] of Object.entries(skillMap)) {
    const existing = db.prepare("SELECT score, attempts FROM skill_scores WHERE user_id = ? AND skill = ?")
      .get(userId, skill) as { score: number; attempts: number } | undefined;

    if (existing) {
      // Exponential moving average (weight recent performance 30%)
      const newScore = existing.score * 0.7 + score * 0.3;
      db.prepare("UPDATE skill_scores SET score = ?, attempts = ?, updated_at = ? WHERE user_id = ? AND skill = ?")
        .run(Math.round(newScore), existing.attempts + 1, now, userId, skill);
    } else {
      db.prepare("INSERT INTO skill_scores (id, user_id, skill, score, attempts, updated_at) VALUES (?, ?, ?, ?, 1, ?)")
        .run(genId(), userId, skill, Math.round(score), now);
    }
  }
}

export function getUserSkillScores(userId: string): Record<SkillKey, { score: number; attempts: number }> {
  const db = getDb();
  const rows = db.prepare("SELECT skill, score, attempts FROM skill_scores WHERE user_id = ?")
    .all(userId) as Array<{ skill: string; score: number; attempts: number }>;

  const defaults: Record<string, { score: number; attempts: number }> = {};
  for (const row of rows) {
    defaults[row.skill] = { score: row.score, attempts: row.attempts };
  }
  return defaults as Record<SkillKey, { score: number; attempts: number }>;
}

export function getUserProgress(userId: string): {
  totalSessions: number;
  averageScore: number;
  bestScore: number;
  skillScores: Record<SkillKey, { score: number; attempts: number }>;
  weakSkills: SkillKey[];
  completedScenarios: string[];
  successRate: number;
  streakDays: number;
} {
  const db = getDb();

  const sessions = db.prepare(`
    SELECT score, result, started_at, scenario_id
    FROM training_sessions
    WHERE user_id = ? AND status = 'completed'
    ORDER BY started_at DESC
  `).all(userId) as Array<{ score: number | null; result: string; started_at: string; scenario_id: string }>;

  const scores = sessions.filter((s) => s.score !== null).map((s) => s.score as number);
  const totalSessions = sessions.length;
  const averageScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const bestScore = scores.length ? Math.max(...scores) : 0;
  const completedScenarios = [...new Set(sessions.map((s) => s.scenario_id))];
  const successCount = sessions.filter((s) => s.result === "sale").length;
  const successRate = totalSessions ? Math.round((successCount / totalSessions) * 100) : 0;

  // Calculate streak
  const dates = sessions.map((s) => s.started_at.slice(0, 10));
  const uniqueDates = [...new Set(dates)].sort().reverse();
  let streakDays = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < uniqueDates.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    if (uniqueDates[i] === expected.toISOString().slice(0, 10)) {
      streakDays++;
    } else break;
  }

  const skillScores = getUserSkillScores(userId);
  const weakSkills = Object.entries(skillScores)
    .sort(([, a], [, b]) => a.score - b.score)
    .slice(0, 3)
    .map(([k]) => k as SkillKey);

  return {
    totalSessions,
    averageScore,
    bestScore,
    skillScores,
    weakSkills,
    completedScenarios,
    successRate,
    streakDays,
  };
}

// ─── Helper functions ─────────────────────────────────────────────────────────

function saveMessage(sessionId: string, author: string, text: string, turnIndex: number): Promise<void> {
  const db = getDb();
  db.prepare(`
    INSERT INTO training_messages (id, session_id, author, text, turn_index, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(genId(), sessionId, author, text, turnIndex, new Date().toISOString());
  return Promise.resolve();
}

export function getSessionHistory(sessionId: string): Array<{ author: string; text: string }> {
  const db = getDb();
  const rows = db.prepare("SELECT author, text FROM training_messages WHERE session_id = ? ORDER BY turn_index")
    .all(sessionId) as Array<{ author: string; text: string }>;
  return rows;
}

function getRevealedFacts(sessionId: string): string[] {
  const db = getDb();
  const session = db.prepare("SELECT scenario_id FROM training_sessions WHERE id = ?")
    .get(sessionId) as { scenario_id: string } | undefined;
  if (!session) return [];

  const scenario = getScenarioFromDb(session.scenario_id);
  if (!scenario) return [];

  // Facts that were explicitly disclosed are tracked by looking at what actions the manager took
  const actions = db.prepare(`
    SELECT classified_actions_json FROM training_messages
    WHERE session_id = ? AND classified_actions_json IS NOT NULL
    ORDER BY turn_index
  `).all(sessionId) as Array<{ classified_actions_json: string }>;

  const revealed: string[] = [...scenario.factsAvailableInitially];

  for (const row of actions) {
    const classified = JSON.parse(row.classified_actions_json) as ClassifiedAction;
    // Basic heuristic: if manager asked about specific topics, reveal related facts
    if (classified.actions.includes("asked_recipient")) {
      const recipientFacts = scenario.hiddenFacts.filter(
        (f) => f.toLowerCase().includes("получател") || f.toLowerCase().includes("муж") ||
               f.toLowerCase().includes("папа") || f.toLowerCase().includes("мама"),
      );
      revealed.push(...recipientFacts);
    }
    if (classified.actions.includes("asked_birth_date")) {
      const birthDateFacts = scenario.hiddenFacts.filter(
        (f) => /родил|рождения|\d{1,2}[.\s]\d{1,2}[.\s]\d{4}/i.test(f),
      );
      revealed.push(...birthDateFacts);
    }
    if (classified.actions.includes("asked_deadline")) {
      const deadlineFacts = scenario.hiddenFacts.filter(
        (f) => f.toLowerCase().includes("срок") || f.toLowerCase().includes("дата") ||
               f.toLowerCase().includes("вручен"),
      );
      revealed.push(...deadlineFacts);
    }
    if (classified.actions.includes("asked_budget")) {
      const budgetFacts = scenario.hiddenFacts.filter(
        (f) => f.toLowerCase().includes("бюджет") || f.toLowerCase().includes("€") ||
               f.toLowerCase().includes("руб"),
      );
      revealed.push(...budgetFacts);
    }
  }

  return [...new Set(revealed)];
}

function updateRevealedFacts(
  sessionId: string,
  classified: ClassifiedAction,
  scenario: TrainingScenario,
  current: string[],
): string[] {
  const newFacts = [...current];

  if (classified.actions.includes("asked_birth_date")) {
    const birthDateFacts = scenario.hiddenFacts.filter(
      (f) => /родил|рождения|birth|\d{1,2}[.\s]\d{1,2}[.\s]\d{4}/i.test(f),
    );
    newFacts.push(...birthDateFacts);
  }
  if (classified.actions.includes("asked_recipient") || classified.actions.includes("asked_interests")) {
    const facts = scenario.hiddenFacts.filter(
      (f) => f.toLowerCase().includes("получател") || f.toLowerCase().includes("интерес"),
    );
    newFacts.push(...facts);
  }
  if (classified.actions.includes("asked_deadline")) {
    const facts = scenario.hiddenFacts.filter(
      (f) => f.toLowerCase().includes("срок") || f.toLowerCase().includes("дата"),
    );
    newFacts.push(...facts);
  }
  if (classified.actions.includes("asked_budget")) {
    const facts = scenario.hiddenFacts.filter(
      (f) => f.toLowerCase().includes("бюджет"),
    );
    newFacts.push(...facts);
  }

  return [...new Set(newFacts)];
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export function getLeaderboard(teamId?: string): Array<{
  userId: string;
  fullName: string;
  averageScore: number;
  totalSessions: number;
  bestScore: number;
}> {
  const db = getDb();

  const query = teamId
    ? `SELECT u.id, u.full_name, avg(s.score) as avg_score, count(s.id) as total, max(s.score) as best
       FROM training_users u
       LEFT JOIN training_sessions s ON s.user_id = u.id AND s.status = 'completed' AND s.score IS NOT NULL
       WHERE u.team_id = ? AND u.is_active = 1
       GROUP BY u.id ORDER BY avg_score DESC NULLS LAST LIMIT 20`
    : `SELECT u.id, u.full_name, avg(s.score) as avg_score, count(s.id) as total, max(s.score) as best
       FROM training_users u
       LEFT JOIN training_sessions s ON s.user_id = u.id AND s.status = 'completed' AND s.score IS NOT NULL
       WHERE u.is_active = 1
       GROUP BY u.id ORDER BY avg_score DESC NULLS LAST LIMIT 20`;

  const rows = (teamId ? db.prepare(query).all(teamId) : db.prepare(query).all()) as Array<{
    id: string; full_name: string; avg_score: number | null; total: number; best: number | null;
  }>;

  return rows.map((r) => ({
    userId: r.id,
    fullName: r.full_name,
    averageScore: r.avg_score ? Math.round(r.avg_score) : 0,
    totalSessions: r.total,
    bestScore: r.best ?? 0,
  }));
}

export { listScenariosFromDb };
