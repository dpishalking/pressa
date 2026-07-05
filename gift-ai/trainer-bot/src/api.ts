const API_URL = (process.env.API_URL ?? "http://localhost:3100").replace(/\/$/, "");
const TRAINER_BASE = `${API_URL}/trainer`;

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
  registerUser: (telegramId: number, fullName: string, username: string, inviteToken?: string) =>
    apiPost<{
      userId: string;
      user?: {
        id: string;
        full_name: string;
        team_id: string | null;
        service_tag: string | null;
        team_name: string | null;
      };
    }>("/users/register", {
      telegramId: String(telegramId),
      fullName,
      username,
      ...(inviteToken ? { inviteToken } : {}),
    }),

  getScenarios: (difficulty?: string, skill?: string) =>
    apiGet<{ scenarios: TrainingScenarioSafe[]; total: number }>(
      `/scenarios?${new URLSearchParams({ ...(difficulty ? { difficulty } : {}), ...(skill ? { skill } : {}) }).toString()}`,
    ),

  getScenario: (id: string) =>
    apiGet<TrainingScenarioSafe>(`/scenarios/${id}`),

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
