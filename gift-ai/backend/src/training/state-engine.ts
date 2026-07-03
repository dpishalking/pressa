import type { ClientState, ClassifiedAction, ManagerActionTag, StateChange, StateThresholds } from "./types.js";
import { DEFAULT_STATE_THRESHOLDS } from "./types.js";

type StateRule = {
  condition: (action: ClassifiedAction) => boolean;
  changes: Partial<Record<keyof ClientState, number>>;
  reason: string;
};

const STATE_RULES: StateRule[] = [
  // Qualification actions
  {
    condition: (a) => a.actions.includes("asked_recipient"),
    changes: { emotionalFit: 10, trust: 5 },
    reason: "Менеджер выяснил, кому предназначен подарок",
  },
  {
    condition: (a) => a.actions.includes("asked_occasion"),
    changes: { trust: 5, clarity: 5 },
    reason: "Менеджер уточнил повод",
  },
  {
    condition: (a) => a.actions.includes("asked_deadline"),
    changes: { trust: 5, clarity: 5 },
    reason: "Менеджер выяснил срок вручения",
  },
  {
    condition: (a) => a.actions.includes("asked_delivery"),
    changes: { trust: 3, clarity: 5 },
    reason: "Менеджер уточнил детали доставки",
  },
  {
    condition: (a) => a.actions.includes("asked_interests"),
    changes: { emotionalFit: 8, trust: 5 },
    reason: "Менеджер спросил об интересах получателя",
  },
  {
    condition: (a) => a.actions.includes("asked_emotion"),
    changes: { emotionalFit: 10, trust: 5 },
    reason: "Менеджер уточнил желаемую эмоцию",
  },
  // Recommendation
  {
    condition: (a) => a.actions.includes("gave_personal_recommendation"),
    changes: { clarity: 15, trust: 10, emotionalFit: 8, choiceOverload: -15 },
    reason: "Менеджер дал одну персональную рекомендацию с объяснением",
  },
  {
    condition: (a) => a.actions.includes("gave_product_explanation"),
    changes: { clarity: 12, trust: 5 },
    reason: "Менеджер объяснил разницу между форматами продукта",
  },
  // Visual
  {
    condition: (a) => a.actions.includes("sent_visual"),
    changes: { clarity: 10, trust: 8, emotionalFit: 5 },
    reason: "Менеджер показал фотографии/примеры",
  },
  // Pricing
  {
    condition: (a) => a.actions.includes("gave_full_pricing"),
    changes: { clarity: 15, trust: 8, priceAcceptance: 8, readinessToBuy: 10 },
    reason: "Менеджер назвал товар, доставку, итог и срок",
  },
  {
    condition: (a) => a.actions.includes("gave_partial_pricing"),
    changes: { clarity: 3 },
    reason: "Менеджер назвал только стоимость товара без доставки",
  },
  // Closing
  {
    condition: (a) => a.actions.includes("asked_closing_question"),
    changes: { readinessToBuy: 8, clarity: 5 },
    reason: "Менеджер задал конкретный вопрос о переходе к оформлению",
  },
  // Objection handling
  {
    condition: (a) => a.actions.includes("handled_objection"),
    changes: { trust: 10, readinessToBuy: 10, irritation: -8 },
    reason: "Менеджер корректно обработал возражение",
  },
  // Empathy
  {
    condition: (a) => a.actions.includes("showed_empathy"),
    changes: { trust: 8, emotionalFit: 5 },
    reason: "Менеджер проявил эмпатию и понял ситуацию клиента",
  },
  // Follow-up
  {
    condition: (a) => a.actions.includes("gave_follow_up"),
    changes: { trust: 5, interest: 5 },
    reason: "Менеджер написал follow-up",
  },
  // Negative actions
  {
    condition: (a) => a.actions.includes("sent_catalogue_dump"),
    changes: { choiceOverload: 20, clarity: -10, readinessToBuy: -10 },
    reason: "Менеджер отправил длинный список вариантов без рекомендации",
  },
  {
    condition: (a) => a.ignoredClientQuestion,
    changes: { irritation: 15, trust: -10 },
    reason: "Менеджер проигнорировал вопрос клиента",
  },
  {
    condition: (a) => a.actions.includes("applied_pressure"),
    changes: { irritation: 15, trust: -20 },
    reason: "Менеджер давит или использует искусственный дефицит",
  },
  {
    condition: (a) => a.actions.includes("gave_questionnaire"),
    changes: { irritation: 8, trust: -5 },
    reason: "Менеджер задал анкету из множества вопросов одним сообщением",
  },
  {
    condition: (a) => a.unsupportedPromise,
    changes: { trust: -10 },
    reason: "Менеджер дал обещание без обоснования",
  },
];

// Quality modifiers
const QUALITY_MODIFIERS = {
  // High naturalness bonus
  naturalness: (score: number): Partial<Record<keyof ClientState, number>> =>
    score > 0.8 ? { trust: 3 } : score < 0.3 ? { irritation: 5, trust: -3 } : {},
  // High pressure penalty
  pressure: (score: number): Partial<Record<keyof ClientState, number>> =>
    score > 0.7 ? { irritation: 10, trust: -10, readinessToBuy: -5 } : {},
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function applyStateRules(
  currentState: ClientState,
  action: ClassifiedAction,
): { newState: ClientState; changes: StateChange[] } {
  const changes: StateChange[] = [];
  const delta: Partial<Record<keyof ClientState, number>> = {};

  for (const rule of STATE_RULES) {
    if (rule.condition(action)) {
      for (const [field, value] of Object.entries(rule.changes) as Array<[keyof ClientState, number]>) {
        delta[field] = (delta[field] ?? 0) + value;
        if (Math.abs(value) >= 3) {
          changes.push({ field, delta: value, reason: rule.reason });
        }
      }
    }
  }

  // Apply quality modifiers
  for (const [key, modFn] of Object.entries(QUALITY_MODIFIERS) as Array<
    [keyof typeof QUALITY_MODIFIERS, (n: number) => Partial<Record<keyof ClientState, number>>]
  >) {
    const score = action.quality[key as keyof typeof action.quality];
    const mods = modFn(score);
    for (const [field, value] of Object.entries(mods) as Array<[keyof ClientState, number]>) {
      delta[field] = (delta[field] ?? 0) + value;
    }
  }

  const newState = { ...currentState };
  for (const [field, value] of Object.entries(delta) as Array<[keyof ClientState, number]>) {
    newState[field] = clamp(newState[field] + value);
  }

  return { newState, changes };
}

export function checkPurchaseReady(
  state: ClientState,
  thresholds: Partial<StateThresholds> = {},
): boolean {
  const t = { ...DEFAULT_STATE_THRESHOLDS, ...thresholds };
  return (
    state.trust >= t.trustMin &&
    state.clarity >= t.clarityMin &&
    state.emotionalFit >= t.emotionalFitMin &&
    state.readinessToBuy >= t.readinessToBuyMin &&
    state.irritation < t.irritationMax
  );
}

export function checkLost(state: ClientState): boolean {
  return state.irritation >= 80 || (state.trust <= 10 && state.interest <= 10);
}

export function getStateMoodLabel(state: ClientState): string {
  if (state.irritation >= 70) return "очень раздражён";
  if (state.irritation >= 50) return "раздражён";
  if (state.readinessToBuy >= 70 && state.trust >= 60) return "готов купить";
  if (state.trust >= 60 && state.clarity >= 70) return "заинтересован";
  if (state.choiceOverload >= 60) return "перегружен вариантами";
  if (state.trust < 30) return "осторожен";
  return "нейтрален";
}
