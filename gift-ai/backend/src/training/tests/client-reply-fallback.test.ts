import { describe, expect, it } from "vitest";
import { buildFallbackClientReply, looksLikeManagerReply, sanitizeClientReply } from "../client-reply-fallback.js";
import type { ClientState, TrainingScenario } from "../types.js";
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
  initialMessage:
    "Добрый день! Я ищу подарок дедушке. Он родился 20 февраля 1950 года. У вас можно заказать что-то по дате рождения?",
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

describe("buildFallbackClientReply", () => {
  it("responds as client when manager is off-topic", () => {
    const history = [{ author: "client", text: scenario.initialMessage }];
    const reply = buildFallbackClientReply({
      employeeText: "вы любите кубики?",
      history,
      clientState: DEFAULT_CLIENT_STATE,
      scenario,
    });

    expect(reply).toMatch(/дедуш/i);
    expect(reply).not.toMatch(/для кого подарок/i);
    expect(reply).not.toMatch(/хочу предложить/i);
  });

  it("shows irritation when manager is off-topic and client is annoyed", () => {
    const irritated: ClientState = { ...DEFAULT_CLIENT_STATE, irritation: 60 };
    const reply = buildFallbackClientReply({
      employeeText: "ок",
      history: [{ author: "client", text: scenario.initialMessage }],
      clientState: irritated,
      scenario,
    });

    expect(reply).toMatch(/странн|не понял|подарок/i);
  });

  it("replaces manager-voice LLM reply with client fallback", () => {
    const history = [{ author: "client", text: scenario.initialMessage }];
    const badLlmReply =
      "Понял вас. Подскажите, пожалуйста: для кого подарок и к какой дате нужно успеть? Хочу предложить подходящий формат.";
    expect(looksLikeManagerReply(badLlmReply)).toBe(true);

    const reply = sanitizeClientReply(badLlmReply, {
      employeeText: "бублики любит",
      history,
      clientState: DEFAULT_CLIENT_STATE,
      scenario,
    });

    expect(reply).toMatch(/дедуш/i);
    expect(reply).not.toMatch(/хочу предложить/i);
  });
});
