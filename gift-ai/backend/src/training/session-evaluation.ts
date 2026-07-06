import { logger } from "../logger.js";
import type { LLMProvider } from "../llm/base.js";
import {
  buildRuleBasedEvaluation,
  isTechnicalFallbackEvaluation,
  reconcileEvaluationWithHistory,
} from "./evaluation-reconcile.js";
import type { ClientState, EvaluationResult, TrainingScenario } from "./types.js";

export async function resolveSessionEvaluation(
  llm: LLMProvider,
  opts: {
    scenario: TrainingScenario;
    history: Array<{ author: string; text: string }>;
    stateHistory: Array<{ turn: number; state: ClientState }>;
    finalState: ClientState;
    hintsUsed: number;
    manuallyFinished: boolean;
  },
): Promise<EvaluationResult> {
  const rbOpts = {
    hintsUsed: opts.hintsUsed,
    manuallyFinished: opts.manuallyFinished,
    finalState: opts.finalState,
  };
  const reconcileOpts = { manuallyFinished: opts.manuallyFinished };

  const managerTurns = opts.history.filter((m) => m.author === "employee").length;
  if (managerTurns === 0) {
    return reconcileEvaluationWithHistory(
      buildRuleBasedEvaluation(opts.history, rbOpts),
      opts.history,
      reconcileOpts,
    );
  }

  try {
    const rawEvaluation = await llm.evaluateSession({
      scenario: opts.scenario,
      history: opts.history,
      stateHistory: opts.stateHistory,
      finalState: opts.finalState,
      hintsUsed: opts.hintsUsed,
    });
    const baseEvaluation = isTechnicalFallbackEvaluation(rawEvaluation)
      ? buildRuleBasedEvaluation(opts.history, rbOpts)
      : rawEvaluation;
    return reconcileEvaluationWithHistory(baseEvaluation, opts.history, reconcileOpts);
  } catch (error) {
    logger.warn("Session evaluation failed, using rule-based scoring", { error: String(error) });
    return reconcileEvaluationWithHistory(
      buildRuleBasedEvaluation(opts.history, rbOpts),
      opts.history,
      reconcileOpts,
    );
  }
}
