const PRODUCTION_API_URL = "https://pressa-production-d394.up.railway.app";
const LEGACY_VPS_URL = "http://85.92.111.202:3100";

export const API_URL = (
  process.env.API_URL ??
  process.env.TRAINER_API_URL ??
  PRODUCTION_API_URL
).replace(/\/$/, "");
const TRAINER_BASE = `${API_URL}/trainer`;

console.log(`[trainer-bot] API_URL=${API_URL}`);
if (API_URL.includes("85.92.111.202") || API_URL === LEGACY_VPS_URL.replace(/\/$/, "")) {
  console.error(
    "[trainer-bot] ⚠️ API_URL points to legacy VPS — set API_URL=https://pressa-production-d394.up.railway.app on Railway",
  );
}

export async function verifyBackendConnection(): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`health ${res.status}`);
    const data = (await res.json()) as { ok?: boolean };
    if (!data.ok) throw new Error("health not ok");
    console.log(`[trainer-bot] ✓ Backend reachable at ${API_URL}`);
  } catch (e) {
    console.error(`[trainer-bot] ✗ Backend unreachable at ${API_URL}:`, e);
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${TRAINER_BASE}${path}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(`${TRAINER_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${TRAINER_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export type TrainingScenarioSafe = {
  id: string;
  name: string;
  description: string;
  mode: string;
  difficulty: string;
  trainingSkill: string;
  occasion: string;
  initialMessage: string;
  idealDialogueStages: string[];
};

export type TrainingSession = {
  id: string;
  userId: string;
  scenarioId: string;
  mode: string;
  status: string;
  score: number | null;
  result: string | null;
  hintsUsed: number;
  hintMode: boolean;
  clientState: Record<string, number>;
};

export type EvaluationResult = {
  totalScore: number;
  categoryScores: Record<string, number>;
  strengths: string[];
  mistakes: string[];
  missedQuestions: string[];
  clientEmotions: string[];
  turningPoints: Array<{ messageIndex: number; type: string; description: string }>;
  stateChanges: Array<{ turn: number; changes: Array<{ field: string; delta: number; reason: string }> }>;
  betterReplies: Array<{ originalText: string; suggestion: string; reason: string }>;
  finalResult: string;
  clientFeeling?: string;
  exampleNextMessage?: string;
};

export type ProcessModeAResult = {
  mode: "mode_a";
  clientReply: string;
  clientState: Record<string, number>;
  stateChanges: Array<{ field: string; delta: number; reason: string }>;
  moodLabel: string;
  isPurchaseReady: boolean;
  isLost: boolean;
  turnIndex: number;
  hint?: {
    currentStage: string;
    knownFacts: string[];
    unknownFacts: string[];
    suggestion: string;
    clientMoodLabel: string;
  };
};

export type ProcessModeBResult = {
  mode: "mode_b";
  managerReply: string;
  clientState: Record<string, number>;
  turnIndex: number;
};

export type ProcessResult = ProcessModeAResult | ProcessModeBResult;

// API functions
export const trainerApi = {
  registerUser: (
    telegramId: number,
    fullName: string,
    username: string,
    inviteToken?: string,
    lmsExternalId?: string,
  ) =>
    apiPost<{
      userId: string;
      user?: {
        id: string;
        full_name: string;
        team_id: string | null;
        service_tag: string | null;
        team_name: string | null;
        lms_external_id: string | null;
      };
    }>("/users/register", {
      telegramId: String(telegramId),
      fullName,
      username,
      ...(inviteToken ? { inviteToken } : {}),
      ...(lmsExternalId ? { lmsExternalId } : {}),
    }),

  getScenarios: (difficulty?: string, skill?: string) =>
    apiGet<{ scenarios: TrainingScenarioSafe[]; total: number }>(
      `/scenarios?${new URLSearchParams({ ...(difficulty ? { difficulty } : {}), ...(skill ? { skill } : {}) }).toString()}`,
    ),

  getScenario: (id: string) =>
    apiGet<TrainingScenarioSafe>(`/scenarios/${id}`),

  generateScenario: (template: string, excludeScenarioId?: string) =>
    apiPost<{ scenarioId: string; scenario: TrainingScenarioSafe; generated: boolean }>(
      "/scenarios/generate",
      { template, ...(excludeScenarioId ? { excludeScenarioId } : {}) },
      60_000,
    ),

  startFromTemplate: (
    userId: string,
    template: string,
    mode: "mode_a" | "mode_b" = "mode_a",
  ) =>
    apiPost<{
      sessionId: string;
      scenarioId: string;
      scenario: TrainingScenarioSafe;
      initialMessage: string;
      initialManagerReply?: string;
      clientState: Record<string, number>;
    }>("/sessions/start-from-template", { userId, template, mode }, 60_000),

  startSession: (userId: string, scenarioId: string, mode: "mode_a" | "mode_b", hintMode?: boolean) =>
    apiPost<{
      sessionId: string;
      scenario: TrainingScenarioSafe;
      initialMessage: string;
      initialManagerReply?: string;
      clientState: Record<string, number>;
    }>(
      "/sessions/start",
      { userId, scenarioId, mode, hintMode },
    ),

  sendMessage: (sessionId: string, text: string) =>
    apiPost<ProcessResult>(`/sessions/${sessionId}/message`, { text }),

  finishSession: (sessionId: string) =>
    apiPost<{ evaluation: EvaluationResult }>(`/sessions/${sessionId}/finish`, {}, 120_000),

  getSession: (sessionId: string) =>
    apiGet<{ session: TrainingSession; messages: Array<{ author: string; text: string; turn_index: number }> }>(
      `/sessions/${sessionId}`,
    ),

  getProgress: (userId: string) =>
    apiGet<{
      totalSessions: number;
      averageScore: number;
      bestScore: number;
      skillScores: Record<string, { score: number; attempts: number }>;
      weakSkills: string[];
      completedScenarios: string[];
      successRate: number;
      streakDays: number;
    }>(`/users/${userId}/progress`),

  getActiveSession: (userId: string) =>
    apiGet<{ active: false } | { active: true; sessionId: string; scenarioId: string; mode: "mode_a" | "mode_b" }>(
      `/users/${userId}/active-session`,
    ),

  getHistory: (userId: string) =>
    apiGet<{ sessions: Array<Record<string, unknown>> }>(`/users/${userId}/history`),

  getLeaderboard: () =>
    apiGet<{ leaderboard: Array<{ userId: string; fullName: string; averageScore: number; totalSessions: number; bestScore: number }> }>(
      "/leaderboard",
    ),

  getEvaluation: (sessionId: string) =>
    apiGet<{ evaluation: EvaluationResult }>(`/sessions/${sessionId}/evaluation`),
};
