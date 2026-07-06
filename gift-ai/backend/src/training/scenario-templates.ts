import { getScenarioFromDb, listScenariosFromDb } from "./scenario-loader.js";
import type { TrainingScenario } from "./types.js";

/** Все опубликованные сценарии — для случайного выбора без повторов темы. */
const ALL_SCENARIO_IDS = [
  "s01-papa-60",
  "s02-muzh-birthday",
  "s03-mama-yubiley",
  "s04-wants-original",
  "s05-knows-date",
  "s06-original-vs-reproduction",
  "s07-wants-photos",
  "s08-regional",
  "s09-no-exact-date",
  "s10-germany",
  "s11-budget-limited",
  "s12-consult-relatives",
  "s13-choose-between-two",
  "s14-expensive",
  "s15-need-to-think",
  "s16-come-back-later",
  "s17-urgent-7days",
  "s18-prepayment-distrust",
  "s19-catalogue-overload",
  "s20-stopped-responding",
  "s21-irritated-long-wait",
  "s22-competitor",
  "s23-another-country",
  "s24-three-family-members",
  "s25-urgency-budget-distrust",
  "s26-vip-has-everything",
  "s27-no-exact-birthdate",
  "s28-nonexistent-product",
  "s29-many-relatives-discuss",
  "s30-technical-questions",
  "s31-israel",
  "s32-recipient-not-interested-in-history",
  "s33-wrong-payment-method",
  "s34-wrong-offer",
];

const TEMPLATE_SCENARIO_IDS: Record<string, string[]> = {
  knows_date: [
    "s05-knows-date",
    "s04-wants-original",
    "s06-original-vs-reproduction",
    "s09-no-exact-date",
    "s27-no-exact-birthdate",
    "s07-wants-photos",
    "s10-germany",
    "s23-another-country",
  ],
  date: [
    "s05-knows-date",
    "s04-wants-original",
    "s06-original-vs-reproduction",
    "s09-no-exact-date",
    "s27-no-exact-birthdate",
  ],
  gift_search: ALL_SCENARIO_IDS,
  gift: ALL_SCENARIO_IDS,
  random: ALL_SCENARIO_IDS,
};

function normalizeTemplate(template: string): string {
  return template.trim().toLowerCase().replace(/-/g, "_");
}

function pickFromPool(pool: string[], excludeScenarioId?: string): string {
  const filtered = excludeScenarioId ? pool.filter((id) => id !== excludeScenarioId) : pool;
  const candidates = filtered.length > 0 ? filtered : pool;
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

function pickScenarioId(template: string, excludeScenarioId?: string): string {
  const key = normalizeTemplate(template);
  const pool = TEMPLATE_SCENARIO_IDS[key] ?? TEMPLATE_SCENARIO_IDS.gift_search;
  return pickFromPool(pool, excludeScenarioId);
}

export async function generateScenarioForTemplate(
  template: string,
  opts?: { excludeScenarioId?: string },
): Promise<{
  scenarioId: string;
  scenario: TrainingScenario;
  generated: boolean;
}> {
  const scenarioId = pickScenarioId(template, opts?.excludeScenarioId?.trim());
  let scenario = getScenarioFromDb(scenarioId);

  if (!scenario) {
    const fallback = listScenariosFromDb({ publishedOnly: true, limit: 50 });
    if (!fallback.length) throw new Error("No scenarios available");
    const withoutRepeat = opts?.excludeScenarioId
      ? fallback.filter((item) => item.id !== opts.excludeScenarioId)
      : fallback;
    scenario = (withoutRepeat.length ? withoutRepeat : fallback)[
      Math.floor(Math.random() * (withoutRepeat.length ? withoutRepeat.length : fallback.length))
    ]!;
  }

  return { scenarioId: scenario.id, scenario, generated: false };
}
