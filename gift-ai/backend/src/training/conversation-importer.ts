import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";
import { getLLMProvider } from "../llm/gemini-provider.js";
import { upsertScenariosToDb } from "./scenario-loader.js";
import {
  loadConversations as _loadConversations,
  formatConversationForPrompt,
  isSalesDialogue as _isSalesDialogue,
} from "./conversation-sampler.js";
import type { ExportedConversation } from "./conversation-sampler.js";
import type { TrainingScenario, Difficulty, SkillKey } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMPORTED_SCENARIOS_DIR = path.resolve(
  __dirname,
  "../../scenarios/imported",
);

export interface ImportOptions {
  filePath: string;
  /** Max number of scenarios to generate in this run */
  limit?: number;
  difficulty?: Difficulty;
  skill?: SkillKey;
  /** Skip dialogues that already have a generated scenario file */
  skipExisting?: boolean;
}

export interface ImportResult {
  processed: number;
  generated: number;
  skipped: number;
  failed: number;
  scenarios: Array<{ dialogId: string; scenarioId: string; name: string }>;
  errors: Array<{ dialogId: string; error: string }>;
}

function getExistingIds(): Set<string> {
  try {
    const files = fs.readdirSync(IMPORTED_SCENARIOS_DIR);
    return new Set(
      files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, "").replace(/^imported-/, "")),
    );
  } catch {
    return new Set();
  }
}

function normalizeImportedScenario(
  partial: Partial<TrainingScenario>,
  dialogId: string,
): TrainingScenario | null {
  if (!partial.name || !partial.buyerProfile) {
    return null;
  }

  const id = `imported-${dialogId}`;

  return {
    id,
    name: partial.name,
    description: partial.description ?? `Сценарий из реального диалога #${dialogId}`,
    mode: partial.mode ?? "mode_a",
    difficulty: partial.difficulty ?? "medium",
    trainingSkill: partial.trainingSkill ?? "qualification",
    tags: partial.tags ?? ["imported", "real"],
    occasion: partial.occasion ?? "birthday",
    buyerProfile: partial.buyerProfile,
    recipientProfile: partial.recipientProfile ?? {
      relation: "father",
      ageRange: "50-65",
      interests: [],
    },
    initialMessage: partial.initialMessage ?? "Здравствуйте, меня интересует ваш продукт",
    hiddenFacts: partial.hiddenFacts ?? [],
    factsAvailableInitially: partial.factsAvailableInitially ?? [],
    primaryObjection: partial.primaryObjection ?? {
      type: "price",
      text: "Дороговато...",
      hiddenReason: "Неуверенность в ценности подарка",
    },
    secondaryObjections: partial.secondaryObjections ?? [],
    purchaseConditions: partial.purchaseConditions ?? ["Менеджер назвал итоговую сумму"],
    failureConditions: partial.failureConditions ?? ["irritation > 80"],
    initialClientState: partial.initialClientState ?? {
      trust: 40,
      interest: 60,
      clarity: 20,
      emotionalFit: 30,
      readinessToBuy: 20,
      irritation: 0,
      choiceOverload: 0,
    },
    stateThresholds: partial.stateThresholds ?? {
      readinessToBuyMin: 70,
      trustMin: 60,
      clarityMin: 50,
      emotionalFitMin: 50,
      irritationMax: 80,
    },
    idealDialogueStages: partial.idealDialogueStages ?? [],
    sourceType: "imported",
    isPublished: false,
  };
}

/**
 * Run the full import pipeline:
 * 1. Load & filter sales-relevant conversations
 * 2. Anonymize dialogue text
 * 3. Generate scenario via LLM
 * 4. Save to JSON file and upsert to DB
 */
export async function importConversations(opts: ImportOptions): Promise<ImportResult> {
  const {
    filePath,
    limit = 10,
    difficulty,
    skill,
    skipExisting = true,
  } = opts;

  fs.mkdirSync(IMPORTED_SCENARIOS_DIR, { recursive: true });

  const result: ImportResult = {
    processed: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
    scenarios: [],
    errors: [],
  };

  // Load conversations
  const all = _loadConversations(filePath);
  const salesDialogues = all.filter((c) => _isSalesDialogue(c));

  logger.info("Starting conversation import", {
    total: all.length,
    salesDialogues: salesDialogues.length,
    limit,
  });

  const existingIds = skipExisting ? getExistingIds() : new Set<string>();
  const llm = getLLMProvider();

  let generated = 0;

  for (const conv of salesDialogues) {
    if (generated >= limit) break;

    result.processed++;

    if (skipExisting && existingIds.has(conv.dialog_id)) {
      result.skipped++;
      continue;
    }

    const formatted = formatConversationForPrompt(conv);

    try {
      logger.info("Generating scenario from dialogue", { dialogId: conv.dialog_id });

      const partial = await llm.generateScenario({
        sourceDialogue: formatted,
        difficulty,
        skill,
      });

      const scenario = normalizeImportedScenario(partial, conv.dialog_id);

      if (!scenario) {
        result.failed++;
        result.errors.push({
          dialogId: conv.dialog_id,
          error: "LLM returned incomplete scenario (missing name or buyerProfile)",
        });
        continue;
      }

      // Save JSON file
      const filename = `imported-${conv.dialog_id}.json`;
      const filepath = path.join(IMPORTED_SCENARIOS_DIR, filename);
      fs.writeFileSync(filepath, JSON.stringify(scenario, null, 2), "utf-8");

      // Upsert to DB
      upsertScenariosToDb([scenario]);

      result.generated++;
      generated++;
      result.scenarios.push({
        dialogId: conv.dialog_id,
        scenarioId: scenario.id,
        name: scenario.name,
      });

      logger.info("Scenario generated and saved", {
        dialogId: conv.dialog_id,
        scenarioId: scenario.id,
        name: scenario.name,
      });

      // Throttle to avoid rate limiting
      if (generated < limit) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result.failed++;
      result.errors.push({ dialogId: conv.dialog_id, error: errorMsg });
      logger.warn("Failed to generate scenario", {
        dialogId: conv.dialog_id,
        error: errorMsg,
      });
    }
  }

  logger.info("Import complete", result as unknown as Record<string, unknown>);
  return result;
}

/** List already-imported scenario files */
export function listImportedScenarioFiles(): string[] {
  try {
    return fs
      .readdirSync(IMPORTED_SCENARIOS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(IMPORTED_SCENARIOS_DIR, f));
  } catch {
    return [];
  }
}
