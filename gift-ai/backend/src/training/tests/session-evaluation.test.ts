import { describe, expect, it, vi } from "vitest";
import { resolveSessionEvaluation } from "../session-evaluation.js";
import type { LLMProvider } from "../../llm/base.js";
import type { ClientState, EvaluationResult, TrainingScenario } from "../types.js";
import { DEFAULT_CLIENT_STATE } from "../types.js";

const scenario: TrainingScenario = {
  id: "test",
  name: "Test",
  description: "",
  difficulty: "basic",
  trainingSkill: "qualification",
  buyerProfile: { gender: "female", ageRange: "30-40", country: "RU", city: "Moscow", personality: "", urgencyLevel: "medium" },
  recipientProfile: { relation: "grandfather", ageRange: "70+", interests: [], personality: "" },
  occasion: "birthday",
  initialMessage: "Нужен подарок дедушке на дату рождения",
  hiddenFacts: [],
  factsAvailableInitially: [],
  primaryObjection: { type: "clarity", text: "", hiddenReason: "" },
  secondaryObjections: [],
  purchaseConditions: [],
  failureConditions: [],
  initialClientState: DEFAULT_CLIENT_STATE,
  idealDialogueStages: [],
  tags: [],
};

const technicalFallback: EvaluationResult = {
  totalScore: 50,
  categoryScores: {
    qualification: 10,
    recommendation: 10,
    productClarity: 7,
    visual: 5,
    pricing: 7,
    closing: 5,
    objectionHandling: 5,
  },
  strengths: [],
  mistakes: ["Не удалось получить оценку от AI — технический сбой"],
  missedQuestions: [],
  clientEmotions: [],
  turningPoints: [],
  stateChanges: [],
  betterReplies: [],
  finalResult: "incomplete",
};

describe("resolveSessionEvaluation", () => {
  it("uses rule-based scoring when manager never replied", async () => {
    const llm = { evaluateSession: vi.fn() } as unknown as LLMProvider;
    const history = [{ author: "client", text: scenario.initialMessage }];

    const result = await resolveSessionEvaluation(llm, {
      scenario,
      history,
      stateHistory: [],
      finalState: DEFAULT_CLIENT_STATE,
      hintsUsed: 0,
      manuallyFinished: true,
    });

    expect(llm.evaluateSession).not.toHaveBeenCalled();
    expect(result.mistakes[0]).toMatch(/не ответил/i);
    expect(result.mistakes.some((m) => /технический сбой/i.test(m))).toBe(false);
  });

  it("replaces LLM technical fallback with rule-based scoring", async () => {
    const llm = {
      evaluateSession: vi.fn().mockResolvedValue(technicalFallback),
    } as unknown as LLMProvider;
    const history = [
      { author: "client", text: scenario.initialMessage },
      { author: "employee", text: "все будет хорошо!" },
    ];

    const result = await resolveSessionEvaluation(llm, {
      scenario,
      history,
      stateHistory: [],
      finalState: DEFAULT_CLIENT_STATE,
      hintsUsed: 0,
      manuallyFinished: true,
    });

    expect(result.mistakes.some((m) => /технический сбой/i.test(m))).toBe(false);
    expect(result.totalScore).toBeLessThanOrEqual(35);
  });
});
