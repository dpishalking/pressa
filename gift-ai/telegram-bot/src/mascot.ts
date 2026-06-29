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

export function mascotImagePath(scene: MascotScene): string | null {
  const file = path.join(ASSETS_DIR, `${scene}.jpg`);
  return existsSync(file) ? file : null;
}
