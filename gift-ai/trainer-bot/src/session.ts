export type TrainerScreen =
  | "main_menu"
  | "select_mode"
  | "select_difficulty"
  | "select_skill"
  | "in_session"
  | "awaiting_evaluation"
  | "awaiting_feedback"
  | "awaiting_feedback_comment"
  | "admin_panel"
  | "progress"
  | "history"
  | "leaderboard"
  | "quick_exercise";

export interface TrainerSession {
  userId?: string;
  lmsExternalId?: string;
  screen: TrainerScreen;
  currentSessionId?: string;
  currentScenarioId?: string;
  lastScenarioId?: string;
  currentMode?: "mode_a" | "mode_b";
  pendingDifficulty?: string;
  pendingSkill?: string;
  hintMode?: boolean;
  pendingEvaluationSessionId?: string;
  pendingFeedbackSessionId?: string;
  pendingFeedbackRating?: number;
  lastMessageIds: number[];
}

const sessions = new Map<string, TrainerSession>();

export function getSession(uid: string): TrainerSession {
  const existing = sessions.get(uid);
  if (existing) return existing;
  const fresh: TrainerSession = {
    screen: "main_menu",
    lastMessageIds: [],
  };
  sessions.set(uid, fresh);
  return fresh;
}

export function setSession(uid: string, patch: Partial<TrainerSession>): TrainerSession {
  const current = getSession(uid);
  const updated = { ...current, ...patch };
  sessions.set(uid, updated);
  return updated;
}
