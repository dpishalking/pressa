// ─── Difficulty & Mode ───────────────────────────────────────────────────────

export type Difficulty = "basic" | "medium" | "hard" | "expert";
export type TrainingMode = "mode_a" | "mode_b"; // A = employee as manager, B = AI as manager
export type SessionStatus = "active" | "completed" | "abandoned";
export type SessionResult = "sale" | "lost" | "timeout" | "incomplete";
export type FinalResult = "ready_to_order" | "interested" | "thinking" | "lost" | "abandoned" | "incomplete";
export type UserRole = "employee" | "rop" | "admin";
export type SkillKey =
  | "qualification"
  | "recommendation"
  | "productClarity"
  | "visualSelling"
  | "pricing"
  | "closing"
  | "objectionHandling"
  | "empathy"
  | "dialogueControl"
  | "followUp";

// ─── Client State (0–100 numeric values) ─────────────────────────────────────

export interface ClientState {
  interest: number;
  trust: number;
  clarity: number;
  emotionalFit: number;
  urgency: number;
  priceAcceptance: number;
  readinessToBuy: number;
  irritation: number;
  choiceOverload: number;
}

export const DEFAULT_CLIENT_STATE: ClientState = {
  interest: 40,
  trust: 30,
  clarity: 20,
  emotionalFit: 20,
  urgency: 30,
  priceAcceptance: 30,
  readinessToBuy: 20,
  irritation: 0,
  choiceOverload: 0,
};

export interface StateThresholds {
  trustMin: number;
  clarityMin: number;
  emotionalFitMin: number;
  readinessToBuyMin: number;
  irritationMax: number;
}

export const DEFAULT_STATE_THRESHOLDS: StateThresholds = {
  trustMin: 60,
  clarityMin: 70,
  emotionalFitMin: 60,
  readinessToBuyMin: 70,
  irritationMax: 50,
};

// ─── Scenario Types ───────────────────────────────────────────────────────────

export interface BuyerProfile {
  gender?: string;
  ageRange?: string;
  country?: string;
  city?: string;
  language?: string;
  personality?: string;
  urgencyLevel?: string;
}

export interface RecipientProfile {
  relation?: string;
  ageRange?: string;
  interests?: string[];
  personality?: string;
}

export interface Objection {
  type: string;
  text: string;
  hiddenReason?: string;
  triggerCondition?: string;
}

export interface ScenarioCondition {
  field: string;
  operator: "gte" | "lte" | "gt" | "lt" | "eq";
  value: number;
}

export interface TrainingScenario {
  id: string;
  name: string;
  description: string;
  mode: TrainingMode;
  difficulty: Difficulty;
  trainingSkill: SkillKey;
  buyerProfile: BuyerProfile;
  recipientProfile: RecipientProfile;
  occasion: string;
  initialMessage: string;
  hiddenFacts: string[];
  factsAvailableInitially: string[];
  primaryObjection: Objection;
  secondaryObjections: Objection[];
  purchaseConditions: string[];
  failureConditions: string[];
  initialClientState: Partial<ClientState>;
  stateThresholds: Partial<StateThresholds>;
  idealDialogueStages: string[];
  scoringOverrides?: Partial<ScoringWeights>;
  tags?: string[];
  isPublished: boolean;
  sourceType: "manual" | "generated" | "imported";
  createdAt?: string;
  updatedAt?: string;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export interface ScoringWeights {
  qualification: number;
  recommendation: number;
  productClarity: number;
  visual: number;
  pricing: number;
  closing: number;
  objectionHandling: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  qualification: 20,
  recommendation: 20,
  productClarity: 15,
  visual: 10,
  pricing: 15,
  closing: 10,
  objectionHandling: 10,
};

export interface CategoryScores {
  qualification: number;
  recommendation: number;
  productClarity: number;
  visual: number;
  pricing: number;
  closing: number;
  objectionHandling: number;
}

// ─── Action Classification ────────────────────────────────────────────────────

export type ManagerActionTag =
  | "asked_recipient"
  | "asked_occasion"
  | "asked_deadline"
  | "asked_delivery"
  | "asked_interests"
  | "asked_emotion"
  | "asked_budget"
  | "gave_personal_recommendation"
  | "gave_product_explanation"
  | "sent_visual"
  | "gave_full_pricing"
  | "gave_partial_pricing"
  | "asked_closing_question"
  | "handled_objection"
  | "sent_catalogue_dump"
  | "ignored_client_question"
  | "applied_pressure"
  | "gave_questionnaire"
  | "made_unsupported_promise"
  | "showed_empathy"
  | "gave_follow_up";

export interface ActionQuality {
  naturalness: number;
  relevance: number;
  pressure: number;
}

export interface ClassifiedAction {
  actions: ManagerActionTag[];
  quality: ActionQuality;
  ignoredClientQuestion: boolean;
  unsupportedPromise: boolean;
  raw?: string;
}

// ─── State Change ─────────────────────────────────────────────────────────────

export interface StateChange {
  field: keyof ClientState;
  delta: number;
  reason: string;
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

export interface TurningPoint {
  messageIndex: number;
  type: "positive" | "negative";
  description: string;
  stateChange?: Partial<ClientState>;
}

export interface BetterReply {
  originalText: string;
  suggestion: string;
  reason: string;
}

export interface EvaluationResult {
  totalScore: number;
  categoryScores: CategoryScores;
  strengths: string[];
  mistakes: string[];
  missedQuestions: string[];
  clientEmotions: string[];
  turningPoints: TurningPoint[];
  stateChanges: Array<{ turn: number; changes: StateChange[] }>;
  betterReplies: BetterReply[];
  finalResult: FinalResult;
  clientFeeling?: string;
  exampleNextMessage?: string;
}

// ─── DB Row Types ─────────────────────────────────────────────────────────────

export interface TrainingUserRow {
  id: string;
  telegram_id: string;
  full_name: string;
  username: string;
  role: UserRole;
  team_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface TrainingSessionRow {
  id: string;
  user_id: string;
  scenario_id: string;
  mode: TrainingMode;
  status: SessionStatus;
  score: number | null;
  client_state_json: string;
  result: SessionResult | null;
  hints_used: number;
  started_at: string;
  completed_at: string | null;
}

export interface TrainingMessageRow {
  id: string;
  session_id: string;
  author: "employee" | "client" | "system";
  text: string;
  classified_actions_json: string | null;
  state_before_json: string | null;
  state_after_json: string | null;
  turn_index: number;
  created_at: string;
}

export interface EvaluationRow {
  id: string;
  session_id: string;
  total_score: number;
  category_scores_json: string;
  strengths_json: string;
  mistakes_json: string;
  missed_questions_json: string;
  client_emotions_json: string;
  turning_points_json: string;
  state_changes_json: string;
  better_replies_json: string;
  final_result: FinalResult;
  client_feeling: string | null;
  example_next_message: string | null;
  raw_response: string | null;
  created_at: string;
}

export interface SkillScoreRow {
  id: string;
  user_id: string;
  skill: SkillKey;
  score: number;
  attempts: number;
  updated_at: string;
}

export interface TrainingAssignmentRow {
  id: string;
  assigned_by: string;
  assigned_to_user_id: string | null;
  assigned_to_team_id: string | null;
  scenario_id: string;
  due_date: string | null;
  status: "pending" | "completed" | "overdue";
  note: string | null;
  completed_at: string | null;
  created_at: string;
}

// ─── Quick Exercise ───────────────────────────────────────────────────────────

export interface QuickExercise {
  id: string;
  name: string;
  description: string;
  skill: SkillKey;
  prompt: string;
  idealResponseExample: string;
  successCriteria: string[];
  durationMinutes: number;
}
