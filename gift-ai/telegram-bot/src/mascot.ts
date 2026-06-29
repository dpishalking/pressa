import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MascotScene =
  | "welcome"
  | "occasion"
  | "recipient"
  | "delivery"
  | "budget"
  | "emotions"
  | "interests"
  | "offer"
  | "compare"
  | "contacts"
  | "done";

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "mascot");

/** Несколько картинок на сцену — ротация без повтора подряд. */
const SCENE_VARIANTS: Record<MascotScene, string[]> = {
  welcome: ["welcome", "welcome-2", "welcome-3"],
  occasion: ["occasion", "occasion-2"],
  recipient: ["recipient", "recipient-2"],
  delivery: ["delivery", "delivery-2"],
  budget: ["budget", "budget-2"],
  emotions: ["emotions", "emotions-2"],
  interests: ["interests", "interests-2", "interests-3", "thinking", "waiting"],
  offer: ["offer", "offer-2", "offer-3"],
  compare: ["compare", "compare-2"],
  contacts: ["contacts", "contacts-2"],
  done: ["done", "done-2", "thanks"],
};

const lastPickByUserScene = new Map<string, string>();

/** Какая поза маскота подходит этапу консультации (1–10). */
export function sceneForStage(stage: number, opts?: { isComplete?: boolean; isStart?: boolean }): MascotScene {
  if (opts?.isComplete) return "done";
  if (opts?.isStart) return "welcome";

  switch (stage) {
    case 1:
      return "occasion";
    case 2:
      return "recipient";
    case 3:
      return "delivery";
    case 4:
      return "budget";
    case 5:
      return "emotions";
    case 6:
    case 7:
      return "interests";
    case 8:
      return "offer";
    case 9:
      return "compare";
    case 10:
      return "contacts";
    default:
      return "welcome";
  }
}

function resolveVariantPaths(scene: MascotScene): string[] {
  return SCENE_VARIANTS[scene]
    .map((name) => path.join(ASSETS_DIR, `${name}.jpg`))
    .filter((file) => existsSync(file));
}

/** Случайный вариант маскота; не повторяет последний для этого пользователя и сцены. */
export function mascotImagePath(scene: MascotScene, userId?: string): string | null {
  const variants = resolveVariantPaths(scene);
  if (!variants.length) return null;
  if (variants.length === 1) return variants[0];

  const key = userId ? `${userId}:${scene}` : "";
  const last = key ? lastPickByUserScene.get(key) : undefined;
  const pool = last ? variants.filter((v) => v !== last) : variants;
  const picked = pool[Math.floor(Math.random() * pool.length)] ?? variants[0];

  if (key) lastPickByUserScene.set(key, picked);
  return picked;
}

export function resetMascotRotation(userId: string): void {
  for (const scene of Object.keys(SCENE_VARIANTS) as MascotScene[]) {
    lastPickByUserScene.delete(`${userId}:${scene}`);
  }
}
