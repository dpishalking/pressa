import { getLLMProvider } from "../llm/gemini-provider.js";
import { logger } from "../logger.js";
import {
  getScenarioFromDb,
  listScenariosFromDb,
  normalizeTrainingScenario,
  upsertScenariosToDb,
} from "./scenario-loader.js";
import type { TrainingScenario } from "./types.js";

export type ScenarioTemplate = "date_archive" | "gift_qualification";

const TEMPLATE_META: Record<
  ScenarioTemplate,
  { skill: TrainingScenario["trainingSkill"]; brief: string; fallbackIds: string[] }
> = {
  date_archive: {
    skill: "productClarity",
    brief: `Клиент указывает дату рождения получателя (или спрашивает про заказ «по дате»).
Менеджер должен: уточнить полную дату (день, месяц, год), проверить/объяснить наличие в архиве, предложить подходящий формат (оригинал, репродукция, поздравительная газета).`,
    fallbackIds: ["s05-knows-date", "s09-no-exact-date", "s27-no-exact-birthdate", "s02-muzh-birthday"],
  },
  gift_qualification: {
    skill: "qualification",
    brief: `Клиент ищет подарок, но не знает что выбрать.
Менеджер должен: выявить получателя, повод, интересы, бюджет и сроки — затем предложить один конкретный вариант с объяснением.`,
    fallbackIds: ["s01-papa-60", "s03-mama-yubiley", "s04-wants-original", "s08-regional", "s11-budget-limited"],
  },
};

const BUYERS = [
  "женщина 28–35, заказывает впервые",
  "мужчина 40–50, хочет удивить близкого",
  "дочь 22–30, живёт в другом городе",
  "сын 35–45, заказывает из-за рубежа",
  "жена 30–40, ищет трогательный подарок",
];

const RECIPIENTS = [
  "отец, 55–65, ностальгирует по СССР",
  "мама, 50–60, любит читать",
  "дедушка, 70–80, ветеран",
  "бабушка, 65–75, ценит семейные воспоминания",
  "муж, 35–45, увлекается спортом",
  "коллега, 40–50, уходит на пенсию",
  "брат, 25–35, любит историю",
];

const LOCATIONS = [
  "Москва, Россия",
  "Санкт-Петербург, Россия",
  "Казань, Россия",
  "Новосибирск, Россия",
  "Алматы, Казахстан",
  "Минск, Беларусь",
  "Берлин, Германия",
  "Тель-Авив, Израиль",
];

const OCCASIONS = [
  "юбилей",
  "день рождения",
  "годовщина свадьбы",
  "выход на пенсию",
  "новоселье",
  "8 марта",
  "23 февраля",
];

const DATES = [
  "3 апреля 1952",
  "17 июня 1960",
  "8 ноября 1945",
  "25 декабря 1970",
  "14 февраля 1958",
  "1 мая 1963",
  "22 сентября 1948",
  "5 марта 1975",
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function liveScenarioId(template: ScenarioTemplate): string {
  return `live-${template}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickFallbackScenario(template: ScenarioTemplate): TrainingScenario | null {
  const ids = TEMPLATE_META[template].fallbackIds;
  const shuffled = [...ids].sort(() => Math.random() - 0.5);
  for (const id of shuffled) {
    const scenario = getScenarioFromDb(id);
    if (scenario) {
      return {
        ...scenario,
        id: liveScenarioId(template),
        sourceType: "generated",
        isPublished: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }
  const fromDb = listScenariosFromDb({ publishedOnly: true, limit: 20 });
  const fallback = fromDb[Math.floor(Math.random() * fromDb.length)];
  if (!fallback) return null;
  return {
    ...fallback,
    id: liveScenarioId(template),
    sourceType: "generated",
    isPublished: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function generateLiveScenario(template: ScenarioTemplate): Promise<TrainingScenario> {
  const meta = TEMPLATE_META[template];
  const seed = {
    uniqueToken: Math.random().toString(36).slice(2, 10),
    buyer: pick(BUYERS),
    recipient: pick(RECIPIENTS),
    location: pick(LOCATIONS),
    occasion: pick(OCCASIONS),
    date: pick(DATES),
  };

  try {
    const llm = getLLMProvider();
    const partial = await llm.generateLiveScenario({
      template,
      templateBrief: meta.brief,
      trainingSkill: meta.skill,
      seed,
    });

    if (!partial.initialMessage?.trim() || !partial.name?.trim()) {
      throw new Error("LLM returned incomplete scenario");
    }

    const scenario = normalizeTrainingScenario({
      ...partial,
      id: liveScenarioId(template),
      mode: "mode_a",
      difficulty: partial.difficulty ?? "basic",
      trainingSkill: partial.trainingSkill ?? meta.skill,
      sourceType: "generated",
      isPublished: false,
      tags: [...(partial.tags ?? []), "live", template],
    });

    upsertScenariosToDb([scenario]);
    logger.info("Live scenario generated", { template, id: scenario.id, name: scenario.name });
    return scenario;
  } catch (e) {
    logger.warn("Live scenario generation failed, using fallback", { template, error: String(e) });
    const fallback = pickFallbackScenario(template);
    if (!fallback) throw new Error("No scenarios available for fallback");
    upsertScenariosToDb([fallback]);
    return fallback;
  }
}
