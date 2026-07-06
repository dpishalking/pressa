import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callGemini } from "../integrations/ai/gemini.js";
import { logger } from "../logger.js";
import { getProductCatalogText } from "../training/catalog-loader.js";
import { sampleConversations, buildFewShotBlock } from "../training/conversation-sampler.js";
import { config } from "../config.js";
import type {
  LLMProvider,
  GenerateClientReplyOpts,
  GenerateManagerReplyOpts,
  ClassifyManagerActionOpts,
  EvaluateSessionOpts,
  GenerateScenarioOpts,
  GenerateLiveScenarioOpts,
  GenerateHintOpts,
  HintResult,
} from "./base.js";
import type {
  ClassifiedAction,
  EvaluationResult,
  TrainingScenario,
  ClientState,
} from "../training/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "prompts");

function loadPrompt(filename: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, filename), "utf-8");
}

function formatHistory(history: Array<{ author: string; text: string }>): string {
  return history
    .map((m) => {
      const label = m.author === "employee" ? "Менеджер" : m.author === "client" ? "Клиент" : "Система";
      return `${label}: ${m.text}`;
    })
    .join("\n");
}

function formatClientState(state: ClientState): string {
  return Object.entries(state)
    .map(([k, v]) => `${k}: ${Math.round(v)}`)
    .join(", ");
}

let _fewShotCache: string | null = null;
let _fewShotTs = 0;
const FEW_SHOT_TTL_MS = 10 * 60 * 1000;

function getFewShotExamples(): string {
  if (_fewShotCache && Date.now() - _fewShotTs < FEW_SHOT_TTL_MS) {
    return _fewShotCache;
  }
  try {
    const exportPath = config.CONVERSATIONS_EXPORT_PATH;
    if (!exportPath || !fs.existsSync(exportPath)) {
      _fewShotCache = "";
      _fewShotTs = Date.now();
      return "";
    }
    const samples = sampleConversations(exportPath, 4, 10);
    _fewShotCache = buildFewShotBlock(samples);
    _fewShotTs = Date.now();
    return _fewShotCache;
  } catch (err) {
    logger.warn("Failed to build few-shot examples", { error: String(err) });
    _fewShotCache = "";
    return "";
  }
}

function injectContext(template: string, withFewShot = false): string {
  const catalog = getProductCatalogText();
  let result = template.replace("{{PRODUCT_CATALOG}}", catalog);
  if (withFewShot) {
    const examples = getFewShotExamples();
    result = result.replace("{{REAL_DIALOGUE_EXAMPLES}}", examples);
  }
  return result;
}

function parseJsonSafe<T>(text: string, fallback: T): T {
  // strip possible markdown code fences
  const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    logger.warn("LLM returned invalid JSON", { preview: text.slice(0, 300) });
    return fallback;
  }
}

function parseEvaluationJson(text: string): EvaluationResult | null {
  const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  try {
    return JSON.parse(cleaned) as EvaluationResult;
  } catch {
    return null;
  }
}

export class GeminiLLMProvider implements LLMProvider {
  async generateClientReply(opts: GenerateClientReplyOpts): Promise<string> {
    const { scenario, history, clientState, lastManagerAction, revealedFacts } = opts;
    const template = injectContext(loadPrompt("system-client-simulator.md"), true);

    const unrevealedFacts = scenario.hiddenFacts.filter((f) => !revealedFacts.includes(f));

    const system = template
      .replace("{{CLIENT_PROFILE}}", JSON.stringify(scenario.buyerProfile, null, 2))
      .replace("{{HIDDEN_FACTS}}", scenario.hiddenFacts.join("\n"))
      .replace("{{INITIAL_FACTS}}", scenario.factsAvailableInitially.join("\n"))
      .replace("{{UNREVEALED_FACTS}}", unrevealedFacts.join("\n"))
      .replace("{{trust}}", String(Math.round(clientState.trust)))
      .replace("{{interest}}", String(Math.round(clientState.interest)))
      .replace("{{clarity}}", String(Math.round(clientState.clarity)))
      .replace("{{emotionalFit}}", String(Math.round(clientState.emotionalFit)))
      .replace("{{readinessToBuy}}", String(Math.round(clientState.readinessToBuy)))
      .replace("{{irritation}}", String(Math.round(clientState.irritation)))
      .replace("{{choiceOverload}}", String(Math.round(clientState.choiceOverload)))
      .replace(
        "{{LAST_MANAGER_ACTION}}",
        lastManagerAction ? JSON.stringify(lastManagerAction.actions) : "начало диалога",
      )
      .replace("{{PRIMARY_OBJECTION}}", JSON.stringify(scenario.primaryObjection))
      .replace("{{SECONDARY_OBJECTIONS}}", JSON.stringify(scenario.secondaryObjections))
      .replace("{{PURCHASE_CONDITIONS}}", scenario.purchaseConditions.join("\n"))
      .replace("{{FAILURE_CONDITIONS}}", scenario.failureConditions.join("\n"));

    const user = formatHistory(history);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await callGemini({ system, user, json: false });
        const text = result.text.trim();
        if (text) return text;
      } catch (e) {
        logger.warn("generateClientReply attempt failed", { attempt, error: String(e) });
        if (attempt === 2) throw e;
      }
    }

    throw new Error("Gemini returned empty client reply");
  }

  async generateManagerReply(opts: GenerateManagerReplyOpts): Promise<string> {
    const { scenario, history, clientState } = opts;
    const template = injectContext(loadPrompt("system-manager-simulator.md"));

    const system = template
      .replace("{{CLIENT_PROFILE}}", JSON.stringify({ ...scenario.buyerProfile, occasion: scenario.occasion, recipient: scenario.recipientProfile }, null, 2))
      .replace("{{DIALOGUE_HISTORY}}", formatHistory(history))
      .replace("{{trust}}", String(Math.round(clientState.trust)))
      .replace("{{clarity}}", String(Math.round(clientState.clarity)))
      .replace("{{emotionalFit}}", String(Math.round(clientState.emotionalFit)));

    const lastClientMsg = [...history].reverse().find((m) => m.author === "client");
    const user = lastClientMsg?.text ?? "Начало диалога";

    const result = await callGemini({ system, user, json: false });
    return result.text.trim();
  }

  async classifyManagerAction(opts: ClassifyManagerActionOpts): Promise<ClassifiedAction> {
    const { managerText, history, clientState, scenario } = opts;
    const template = loadPrompt("system-action-classifier.md");

    const system = template
      .replace("{{DIALOGUE_HISTORY}}", formatHistory(history.slice(-10)))
      .replace("{{MANAGER_TEXT}}", managerText)
      .replace("{{CLIENT_STATE}}", formatClientState(clientState));

    const fallback: ClassifiedAction = {
      actions: [],
      quality: { naturalness: 0.5, relevance: 0.5, pressure: 0 },
      ignoredClientQuestion: false,
      unsupportedPromise: false,
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await callGemini({ system, user: managerText, json: true });
        const parsed = parseJsonSafe<ClassifiedAction>(result.text, fallback);
        parsed.raw = result.text;
        return parsed;
      } catch (e) {
        logger.warn("classifyManagerAction attempt failed", { attempt, error: String(e) });
        if (attempt === 2) return fallback;
      }
    }
    return fallback;
  }

  async evaluateSession(opts: EvaluateSessionOpts): Promise<EvaluationResult> {
    const { scenario, history, stateHistory, finalState, hintsUsed } = opts;
    const evalHistory = history.slice(-24);
    const evalStateHistory = stateHistory.slice(-12);
    const template = injectContext(loadPrompt("system-evaluator.md"), true);

    const scenarioSummary = {
      name: scenario.name,
      difficulty: scenario.difficulty,
      primaryObjection: scenario.primaryObjection,
      purchaseConditions: scenario.purchaseConditions,
      failureConditions: scenario.failureConditions,
      idealStages: scenario.idealDialogueStages,
    };

    const system = template
      .replace("{{SCENARIO}}", JSON.stringify(scenarioSummary, null, 2))
      .replace("{{DIALOGUE_HISTORY}}", formatHistory(evalHistory))
      .replace("{{STATE_HISTORY}}", JSON.stringify(evalStateHistory, null, 2))
      .replace("{{FINAL_STATE}}", formatClientState(finalState));

    const hintsNote = hintsUsed > 0 ? `\n\nВажно: менеджер использовал ${hintsUsed} подсказок. Учти это при оценке (лёгкий штраф -2 за каждую подсказку).` : "";

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

    const normalizeEvaluation = (parsed: EvaluationResult): EvaluationResult => {
      parsed.totalScore = Math.max(0, Math.min(100, parsed.totalScore ?? 50));
      if (hintsUsed > 0) {
        parsed.totalScore = Math.max(0, parsed.totalScore - hintsUsed * 2);
      }
      parsed.categoryScores = parsed.categoryScores ?? technicalFallback.categoryScores;
      parsed.strengths = Array.isArray(parsed.strengths) ? parsed.strengths : [];
      parsed.mistakes = Array.isArray(parsed.mistakes) ? parsed.mistakes : [];
      parsed.missedQuestions = Array.isArray(parsed.missedQuestions) ? parsed.missedQuestions : [];
      parsed.clientEmotions = Array.isArray(parsed.clientEmotions) ? parsed.clientEmotions : [];
      parsed.turningPoints = Array.isArray(parsed.turningPoints) ? parsed.turningPoints : [];
      parsed.stateChanges = Array.isArray(parsed.stateChanges) ? parsed.stateChanges : [];
      parsed.betterReplies = Array.isArray(parsed.betterReplies) ? parsed.betterReplies : [];
      parsed.finalResult = parsed.finalResult ?? "incomplete";
      return parsed;
    };

    const attempts: Array<{ system: string; user: string; maxOutputTokens: number }> = [
      {
        system,
        user: `Оцени диалог менеджера.${hintsNote}`,
        maxOutputTokens: 8192,
      },
      {
        system: `${system}\n\nВажно: верни компактный JSON — strengths до 3 пунктов, mistakes до 5, turningPoints до 3, betterReplies до 2.`,
        user: `Оцени диалог менеджера. Будь кратким.${hintsNote}`,
        maxOutputTokens: 8192,
      },
    ];

    for (let attempt = 0; attempt < attempts.length; attempt++) {
      const cfg = attempts[attempt]!;
      try {
        const result = await callGemini({
          system: cfg.system,
          user: cfg.user,
          json: true,
          timeoutMs: 90_000,
          maxOutputTokens: cfg.maxOutputTokens,
          preferFallbackModel: true,
        });
        const parsed = parseEvaluationJson(result.text);
        if (!parsed) {
          logger.warn("evaluateSession invalid JSON", {
            attempt,
            finishReason: result.finishReason,
            preview: result.text.slice(0, 300),
          });
          continue;
        }
        return normalizeEvaluation(parsed);
      } catch (e) {
        logger.warn("evaluateSession attempt failed", { attempt, error: String(e) });
      }
    }

    return technicalFallback;
  }

  async generateScenario(opts: GenerateScenarioOpts): Promise<Partial<TrainingScenario>> {
    const { sourceDialogue, difficulty, skill } = opts;
    const template = loadPrompt("system-scenario-generator.md");

    const system = template.replace("{{SOURCE_DIALOGUE}}", sourceDialogue);
    const user = `Создай сценарий${difficulty ? ` уровня ${difficulty}` : ""}${skill ? ` для навыка ${skill}` : ""} на основе диалога выше.`;

    const result = await callGemini({ system, user, json: true });
    return parseJsonSafe<Partial<TrainingScenario>>(result.text, {});
  }

  async generateLiveScenario(opts: GenerateLiveScenarioOpts): Promise<Partial<TrainingScenario>> {
    const templateType =
      opts.template === "date_archive"
        ? "Проверка архива по дате рождения"
        : "Выявление потребности и предложение подарка";

    let system = loadPrompt("system-scenario-generator-live.md")
      .replace(/\{\{TEMPLATE_TYPE\}\}/g, templateType)
      .replace(/\{\{TEMPLATE_BRIEF\}\}/g, opts.templateBrief)
      .replace(/\{\{TRAINING_SKILL\}\}/g, opts.trainingSkill)
      .replace(/\{\{UNIQUE_TOKEN\}\}/g, opts.seed.uniqueToken)
      .replace(/\{\{BUYER_HINT\}\}/g, opts.seed.buyer)
      .replace(/\{\{RECIPIENT_HINT\}\}/g, opts.seed.recipient)
      .replace(/\{\{LOCATION_HINT\}\}/g, opts.seed.location)
      .replace(/\{\{OCCASION_HINT\}\}/g, opts.seed.occasion)
      .replace(/\{\{DATE_HINT\}\}/g, opts.seed.date);

    const user =
      "Сгенерируй полностью новый сценарий. initialMessage должен звучать по-разному от типовых примеров.";

    const result = await callGemini({ system, user, json: true, timeoutMs: 45_000 });
    return parseJsonSafe<Partial<TrainingScenario>>(result.text, {});
  }

  async generateHint(opts: GenerateHintOpts): Promise<HintResult> {
    const { scenario, history, clientState, revealedFacts } = opts;
    const template = loadPrompt("system-hint.md");

    const unrevealedFacts = scenario.hiddenFacts.filter((f) => !revealedFacts.includes(f));

    const system = template
      .replace("{{SCENARIO}}", `${scenario.name}: ${scenario.description}`)
      .replace("{{DIALOGUE_HISTORY}}", formatHistory(history.slice(-8)))
      .replace("{{trust}}", String(Math.round(clientState.trust)))
      .replace("{{interest}}", String(Math.round(clientState.interest)))
      .replace("{{clarity}}", String(Math.round(clientState.clarity)))
      .replace("{{emotionalFit}}", String(Math.round(clientState.emotionalFit)))
      .replace("{{readinessToBuy}}", String(Math.round(clientState.readinessToBuy)))
      .replace("{{irritation}}", String(Math.round(clientState.irritation)))
      .replace("{{choiceOverload}}", String(Math.round(clientState.choiceOverload)))
      .replace("{{REVEALED_FACTS}}", revealedFacts.join("\n") || "Пока ничего не выяснено")
      .replace("{{UNREVEALED_FACTS}}", unrevealedFacts.join("\n") || "Вся основная информация выяснена");

    const fallback: HintResult = {
      currentStage: "Квалификация",
      knownFacts: revealedFacts,
      unknownFacts: unrevealedFacts,
      suggestion: "Уточните ключевые детали у клиента",
      clientMoodLabel: "нейтрален",
    };

    try {
      const result = await callGemini({ system, user: "Дай подсказку", json: true });
      return parseJsonSafe<HintResult>(result.text, fallback);
    } catch {
      return fallback;
    }
  }
}

let _provider: GeminiLLMProvider | null = null;

export function getLLMProvider(): GeminiLLMProvider {
  if (!_provider) _provider = new GeminiLLMProvider();
  return _provider;
}
