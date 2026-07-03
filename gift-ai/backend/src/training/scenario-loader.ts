import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/client.js";
import { logger } from "../logger.js";
import type { TrainingScenario } from "./types.js";
import { DEFAULT_CLIENT_STATE, DEFAULT_STATE_THRESHOLDS } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scenarios live at backend/scenarios/
const SCENARIOS_DIR = path.resolve(__dirname, "../../scenarios");

export function loadScenariosFromFiles(): TrainingScenario[] {
  const scenarios: TrainingScenario[] = [];
  if (!fs.existsSync(SCENARIOS_DIR)) return scenarios;

  for (const difficulty of ["basic", "medium", "hard", "expert"]) {
    const dir = path.join(SCENARIOS_DIR, difficulty);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), "utf-8");
        const data = JSON.parse(raw) as Partial<TrainingScenario>;
        const scenario = normalizeScenario(data);
        scenarios.push(scenario);
      } catch (e) {
        logger.warn("Failed to load scenario file", { file, error: String(e) });
      }
    }
  }
  return scenarios;
}

function normalizeScenario(raw: Partial<TrainingScenario>): TrainingScenario {
  return {
    id: raw.id ?? generateId(),
    name: raw.name ?? "Без названия",
    description: raw.description ?? "",
    mode: raw.mode ?? "mode_a",
    difficulty: raw.difficulty ?? "basic",
    trainingSkill: raw.trainingSkill ?? "qualification",
    buyerProfile: raw.buyerProfile ?? {},
    recipientProfile: raw.recipientProfile ?? {},
    occasion: raw.occasion ?? "",
    initialMessage: raw.initialMessage ?? "",
    hiddenFacts: raw.hiddenFacts ?? [],
    factsAvailableInitially: raw.factsAvailableInitially ?? [],
    primaryObjection: raw.primaryObjection ?? { type: "none", text: "" },
    secondaryObjections: raw.secondaryObjections ?? [],
    purchaseConditions: raw.purchaseConditions ?? [],
    failureConditions: raw.failureConditions ?? [],
    initialClientState: { ...DEFAULT_CLIENT_STATE, ...(raw.initialClientState ?? {}) },
    stateThresholds: { ...DEFAULT_STATE_THRESHOLDS, ...(raw.stateThresholds ?? {}) },
    idealDialogueStages: raw.idealDialogueStages ?? [],
    scoringOverrides: raw.scoringOverrides,
    tags: raw.tags ?? [],
    isPublished: raw.isPublished ?? true,
    sourceType: raw.sourceType ?? "manual",
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function upsertScenariosToDb(scenarios: TrainingScenario[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO training_scenarios (
      id, name, description, mode, difficulty, training_skill,
      buyer_profile_json, recipient_profile_json, occasion, initial_message,
      hidden_facts_json, facts_available_initially_json,
      primary_objection_json, secondary_objections_json,
      purchase_conditions_json, failure_conditions_json,
      initial_client_state_json, state_thresholds_json,
      ideal_dialogue_stages_json, scoring_overrides_json, tags_json,
      source_type, is_published, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  const upsertMany = db.transaction((items: TrainingScenario[]) => {
    for (const s of items) {
      stmt.run(
        s.id, s.name, s.description, s.mode, s.difficulty, s.trainingSkill,
        JSON.stringify(s.buyerProfile), JSON.stringify(s.recipientProfile), s.occasion, s.initialMessage,
        JSON.stringify(s.hiddenFacts), JSON.stringify(s.factsAvailableInitially),
        JSON.stringify(s.primaryObjection), JSON.stringify(s.secondaryObjections),
        JSON.stringify(s.purchaseConditions), JSON.stringify(s.failureConditions),
        JSON.stringify(s.initialClientState), JSON.stringify(s.stateThresholds),
        JSON.stringify(s.idealDialogueStages), JSON.stringify(s.scoringOverrides ?? {}), JSON.stringify(s.tags ?? []),
        s.sourceType, s.isPublished ? 1 : 0, s.createdAt ?? new Date().toISOString(), s.updatedAt ?? new Date().toISOString(),
      );
    }
  });

  upsertMany(scenarios);
  logger.info("Scenarios upserted to DB", { count: scenarios.length });
}

export function getScenarioFromDb(id: string): TrainingScenario | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM training_scenarios WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToScenario(row);
}

export function listScenariosFromDb(opts: {
  difficulty?: string;
  skill?: string;
  publishedOnly?: boolean;
  limit?: number;
}): TrainingScenario[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.difficulty) { conditions.push("difficulty = ?"); params.push(opts.difficulty); }
  if (opts.skill) { conditions.push("training_skill = ?"); params.push(opts.skill); }
  if (opts.publishedOnly) { conditions.push("is_published = 1"); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ? `LIMIT ${opts.limit}` : "";
  const rows = db.prepare(`SELECT * FROM training_scenarios ${where} ORDER BY difficulty, name ${limit}`).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowToScenario);
}

function rowToScenario(row: Record<string, unknown>): TrainingScenario {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    mode: (row.mode as TrainingScenario["mode"]) ?? "mode_a",
    difficulty: (row.difficulty as TrainingScenario["difficulty"]) ?? "basic",
    trainingSkill: (row.training_skill as TrainingScenario["trainingSkill"]) ?? "qualification",
    buyerProfile: JSON.parse(String(row.buyer_profile_json ?? "{}")),
    recipientProfile: JSON.parse(String(row.recipient_profile_json ?? "{}")),
    occasion: String(row.occasion ?? ""),
    initialMessage: String(row.initial_message),
    hiddenFacts: JSON.parse(String(row.hidden_facts_json ?? "[]")),
    factsAvailableInitially: JSON.parse(String(row.facts_available_initially_json ?? "[]")),
    primaryObjection: JSON.parse(String(row.primary_objection_json ?? "{}")),
    secondaryObjections: JSON.parse(String(row.secondary_objections_json ?? "[]")),
    purchaseConditions: JSON.parse(String(row.purchase_conditions_json ?? "[]")),
    failureConditions: JSON.parse(String(row.failure_conditions_json ?? "[]")),
    initialClientState: JSON.parse(String(row.initial_client_state_json ?? "{}")),
    stateThresholds: JSON.parse(String(row.state_thresholds_json ?? "{}")),
    idealDialogueStages: JSON.parse(String(row.ideal_dialogue_stages_json ?? "[]")),
    scoringOverrides: JSON.parse(String(row.scoring_overrides_json ?? "{}")),
    tags: JSON.parse(String(row.tags_json ?? "[]")),
    isPublished: Boolean(row.is_published),
    sourceType: (row.source_type as TrainingScenario["sourceType"]) ?? "manual",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
