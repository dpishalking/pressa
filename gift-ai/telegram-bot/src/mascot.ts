import { existsSync, readdirSync } from "node:fs";
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

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function findAssetsDir(): string {
  const candidates = [
    path.join(MODULE_DIR, "..", "assets", "mascot"),
    path.join(process.cwd(), "assets", "mascot"),
    path.join(process.cwd(), "telegram-bot", "assets", "mascot"),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "welcome.jpg"))) return dir;
  }
  return candidates[0];
}

const ASSETS_DIR = findAssetsDir();

/** Индекс следующего варианта по пользователю и сцене (round-robin). */
const nextVariantIndex = new Map<string, number>();

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

/** Следующий вариант маскота; перебирает все картинки сцены по кругу. */
export function mascotImagePath(scene: MascotScene, userId?: string): string | null {
  const variants = resolveVariantPaths(scene);
  if (!variants.length) return null;
  if (!userId || variants.length === 1) return variants[0];

  const key = `${userId}:${scene}`;
  const idx = nextVariantIndex.get(key) ?? 0;
  const picked = variants[idx % variants.length]!;
  nextVariantIndex.set(key, (idx + 1) % variants.length);

  if (process.env.LOG_MASCOT_PICK === "1") {
    console.log("[mascot]", scene, path.basename(picked), `(${idx + 1}/${variants.length})`);
  }

  return picked;
}

export function resetMascotRotation(userId: string): void {
  for (const scene of Object.keys(SCENE_VARIANTS) as MascotScene[]) {
    nextVariantIndex.delete(`${userId}:${scene}`);
  }
}

/** Лог при старте бота — проверка, что новые jpg реально на диске (Railway). */
export function logMascotInventory(): void {
  const scenes = Object.keys(SCENE_VARIANTS) as MascotScene[];
  const counts = Object.fromEntries(scenes.map((scene) => [scene, resolveVariantPaths(scene).length]));
  const onDisk = existsSync(ASSETS_DIR)
    ? readdirSync(ASSETS_DIR).filter((f) => f.endsWith(".jpg")).length
    : 0;
  console.log(`🖼 Mascot dir: ${ASSETS_DIR}`);
  console.log(`🖼 Mascot jpg on disk: ${onDisk} (expected ~28)`);
  console.log(`🖼 Variants per scene:`, JSON.stringify(counts));
  if (onDisk < 20) {
    console.warn("⚠️ Мало файлов маскота — redeploy бота или проверьте assets/mascot в образе");
  }
}
