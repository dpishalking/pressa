import { getScenarioFromDb, listScenariosFromDb } from "./scenario-loader.js";
import type { TrainingScenario } from "./types.js";

const TEMPLATE_SCENARIO_IDS: Record<string, string[]> = {
  knows_date: ["s05-knows-date"],
  date: ["s05-knows-date"],
  gift_search: ["s01-papa-60", "s03-mama-yubiley", "s02-muzh-birthday"],
  gift: ["s01-papa-60", "s03-mama-yubiley", "s02-muzh-birthday"],
};

function normalizeTemplate(template: string): string {
  return template.trim().toLowerCase().replace(/-/g, "_");
}

function pickScenarioId(template: string): string {
  const key = normalizeTemplate(template);
  const ids = TEMPLATE_SCENARIO_IDS[key] ?? TEMPLATE_SCENARIO_IDS.gift_search;
  return ids[Math.floor(Math.random() * ids.length)];
}

export async function generateScenarioForTemplate(template: string): Promise<{
  scenarioId: string;
  scenario: TrainingScenario;
  generated: boolean;
}> {
  const scenarioId = pickScenarioId(template);
  let scenario = getScenarioFromDb(scenarioId);

  if (!scenario) {
    const fallback = listScenariosFromDb({ publishedOnly: true, limit: 20 });
    if (!fallback.length) throw new Error("No scenarios available");
    scenario = fallback[Math.floor(Math.random() * fallback.length)];
  }

  return { scenarioId: scenario.id, scenario, generated: false };
}
