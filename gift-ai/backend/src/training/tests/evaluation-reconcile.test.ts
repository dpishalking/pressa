import { describe, expect, it } from "vitest";
import {
  reconcileEvaluationWithHistory,
  buildRuleBasedEvaluation,
  isTechnicalFallbackEvaluation,
} from "../evaluation-reconcile.js";
import type { EvaluationResult } from "../types.js";

const baseEval = (): EvaluationResult => ({
  totalScore: 35,
  categoryScores: {
    qualification: 5,
    recommendation: 5,
    productClarity: 5,
    visual: 0,
    pricing: 0,
    closing: 0,
    objectionHandling: 10,
  },
  strengths: ["Попытался обработать возражение", "Предложил продукт, связанный с датой рождения"],
  mistakes: ["Не задал уточняющих вопросов", "Не предложил визуал"],
  missedQuestions: [],
  clientEmotions: [],
  turningPoints: [],
  stateChanges: [],
  betterReplies: [],
  finalResult: "abandoned",
  exampleNextMessage:
    "Поздравляю с таким важным юбилеем! Конечно, можем предложить кое-что особенное. Чтобы подобрать идеальный подарок для мамы, подскажите, пожалуйста, её точную д",
});

describe("reconcileEvaluationWithHistory", () => {
  it("removes false strengths for off-topic short reply", () => {
    const history = [
      { author: "client", text: "Маме 70 лет, хотим подарок по году рождения" },
      { author: "employee", text: "все будет хорошо!" },
      { author: "client", text: "А что вы можете предложить?" },
    ];

    const out = reconcileEvaluationWithHistory(baseEval(), history, { manuallyFinished: true });

    expect(out.strengths).toEqual([]);
    expect(out.finalResult).toBe("lost");
    expect(out.mistakes[0]).toMatch(/не по теме/i);
    expect(out.exampleNextMessage).toMatch(/дату рождения/i);
  });

  it("keeps strengths backed by manager text", () => {
    const history = [
      { author: "client", text: "Нужен подарок" },
      {
        author: "employee",
        text: "Поздравляю! Подскажите точную дату рождения — проверю архив газет.",
      },
    ];

    const evalWithStrength: EvaluationResult = {
      ...baseEval(),
      totalScore: 55,
      strengths: ["Уточнил дату рождения для проверки архива"],
      finalResult: "thinking",
    };

    const out = reconcileEvaluationWithHistory(evalWithStrength, history);
    expect(out.strengths).toHaveLength(1);
  });

  it("detects technical fallback from LLM", () => {
    expect(
      isTechnicalFallbackEvaluation({
        ...baseEval(),
        mistakes: ["Не удалось получить оценку от AI — технический сбой"],
      }),
    ).toBe(true);
  });

  it("builds rule-based evaluation when LLM fails", () => {
    const history = [
      { author: "client", text: "Маме 70 лет, хотим подарок по году рождения" },
      { author: "employee", text: "все будет хорошо!" },
      { author: "client", text: "А что вы можете предложить?" },
    ];

    const out = buildRuleBasedEvaluation(history, { manuallyFinished: true });

    expect(out.totalScore).toBeLessThanOrEqual(35);
    expect(out.strengths).toEqual([]);
    expect(out.mistakes[0]).toMatch(/не по теме/i);
    expect(out.exampleNextMessage).toMatch(/дату рождения/i);
    expect(out.finalResult).toBe("lost");
  });
});
