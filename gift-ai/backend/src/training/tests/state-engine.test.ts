import { describe, it, expect } from "vitest";
import { applyStateRules, checkPurchaseReady, checkLost, getStateMoodLabel } from "../state-engine.js";
import type { ClientState, ClassifiedAction } from "../types.js";
import { DEFAULT_CLIENT_STATE } from "../types.js";

function makeAction(overrides: Partial<ClassifiedAction> = {}): ClassifiedAction {
  return {
    actions: [],
    quality: { naturalness: 0.7, relevance: 0.7, pressure: 0 },
    ignoredClientQuestion: false,
    unsupportedPromise: false,
    ...overrides,
  };
}

describe("applyStateRules", () => {
  it("increases emotionalFit and trust when manager asked about recipient", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE };
    const action = makeAction({ actions: ["asked_recipient"] });
    const { newState, changes } = applyStateRules(state, action);

    expect(newState.emotionalFit).toBeGreaterThan(state.emotionalFit);
    expect(newState.trust).toBeGreaterThan(state.trust);
    expect(changes.some((c) => c.field === "emotionalFit")).toBe(true);
  });

  it("increases choiceOverload and decreases readinessToBuy for catalogue dump", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE, choiceOverload: 10 };
    const action = makeAction({ actions: ["sent_catalogue_dump"] });
    const { newState } = applyStateRules(state, action);

    expect(newState.choiceOverload).toBeGreaterThan(state.choiceOverload);
    expect(newState.readinessToBuy).toBeLessThan(state.readinessToBuy);
  });

  it("increases irritation when manager ignored client question", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE, irritation: 20 };
    const action = makeAction({ ignoredClientQuestion: true });
    const { newState } = applyStateRules(state, action);

    expect(newState.irritation).toBeGreaterThan(state.irritation);
    expect(newState.trust).toBeLessThan(state.trust);
  });

  it("gives full pricing bonus to clarity, trust, priceAcceptance, readinessToBuy", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE };
    const action = makeAction({ actions: ["gave_full_pricing"] });
    const { newState } = applyStateRules(state, action);

    expect(newState.clarity).toBeGreaterThan(state.clarity);
    expect(newState.trust).toBeGreaterThan(state.trust);
    expect(newState.priceAcceptance).toBeGreaterThan(state.priceAcceptance);
    expect(newState.readinessToBuy).toBeGreaterThan(state.readinessToBuy);
  });

  it("decreases choiceOverload for personal recommendation", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE, choiceOverload: 60 };
    const action = makeAction({ actions: ["gave_personal_recommendation"] });
    const { newState } = applyStateRules(state, action);

    expect(newState.choiceOverload).toBeLessThan(state.choiceOverload);
    expect(newState.clarity).toBeGreaterThan(state.clarity);
  });

  it("clamps values between 0 and 100", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE, irritation: 95 };
    const action = makeAction({ actions: ["applied_pressure"], quality: { naturalness: 0.1, relevance: 0.3, pressure: 0.9 } });
    const { newState } = applyStateRules(state, action);

    for (const value of Object.values(newState)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it("applies pressure modifier from quality.pressure", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE };
    const action = makeAction({ quality: { naturalness: 0.7, relevance: 0.7, pressure: 0.9 } });
    const { newState } = applyStateRules(state, action);

    expect(newState.irritation).toBeGreaterThan(state.irritation);
  });
});

describe("checkPurchaseReady", () => {
  it("returns true when all thresholds met", () => {
    const state: ClientState = {
      ...DEFAULT_CLIENT_STATE,
      trust: 65,
      clarity: 75,
      emotionalFit: 65,
      readinessToBuy: 75,
      irritation: 20,
    };
    expect(checkPurchaseReady(state)).toBe(true);
  });

  it("returns false when trust below threshold", () => {
    const state: ClientState = {
      ...DEFAULT_CLIENT_STATE,
      trust: 40,
      clarity: 75,
      emotionalFit: 65,
      readinessToBuy: 75,
      irritation: 20,
    };
    expect(checkPurchaseReady(state)).toBe(false);
  });

  it("returns false when irritation too high", () => {
    const state: ClientState = {
      ...DEFAULT_CLIENT_STATE,
      trust: 65,
      clarity: 75,
      emotionalFit: 65,
      readinessToBuy: 75,
      irritation: 60,
    };
    expect(checkPurchaseReady(state)).toBe(false);
  });

  it("respects custom thresholds", () => {
    const state: ClientState = {
      ...DEFAULT_CLIENT_STATE,
      trust: 50,
      clarity: 60,
      emotionalFit: 50,
      readinessToBuy: 60,
      irritation: 20,
    };
    expect(checkPurchaseReady(state, { trustMin: 40, clarityMin: 55, emotionalFitMin: 40, readinessToBuyMin: 55, irritationMax: 50 })).toBe(true);
  });
});

describe("checkLost", () => {
  it("returns true when irritation very high", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE, irritation: 85 };
    expect(checkLost(state)).toBe(true);
  });

  it("returns true when trust and interest both very low", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE, trust: 5, interest: 5 };
    expect(checkLost(state)).toBe(true);
  });

  it("returns false for normal state", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE };
    expect(checkLost(state)).toBe(false);
  });
});

describe("getStateMoodLabel", () => {
  it("returns очень раздражён for high irritation", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE, irritation: 75 };
    expect(getStateMoodLabel(state)).toBe("очень раздражён");
  });

  it("returns готов купить for high readiness and trust", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE, readinessToBuy: 75, trust: 65 };
    expect(getStateMoodLabel(state)).toBe("готов купить");
  });

  it("returns перегружен вариантами for high choiceOverload", () => {
    const state: ClientState = { ...DEFAULT_CLIENT_STATE, choiceOverload: 65 };
    expect(getStateMoodLabel(state)).toBe("перегружен вариантами");
  });
});
