import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GIFTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "gifts");
const PHOTO_EXTS = ["jpg", "jpeg", "png", "webp"] as const;

/** Путь к главному фото подарка (имя файла = externalId.jpg). */
export function giftPhotoPath(externalId: string): string | null {
  const paths = giftPhotoPaths(externalId);
  return paths[0] ?? null;
}

/**
 * Все фото подарка: externalId.jpg + externalId-2.jpg, externalId-3.jpg, …
 * Сортировка: основное, затем по номеру суффикса.
 */
export function giftPhotoPaths(externalId: string): string[] {
  if (!externalId || !existsSync(GIFTS_DIR)) return [];

  const files = readdirSync(GIFTS_DIR);
  const matched: Array<{ path: string; order: number }> = [];

  for (const file of files) {
    const lower = file.toLowerCase();
    const ext = PHOTO_EXTS.find((e) => lower.endsWith(`.${e}`));
    if (!ext) continue;

    const base = file.slice(0, -(ext.length + 1));
    if (base === externalId) {
      matched.push({ path: path.join(GIFTS_DIR, file), order: 1 });
      continue;
    }

    const suffix = base.match(new RegExp(`^${escapeRegExp(externalId)}-(\\d+)$`));
    if (suffix) {
      matched.push({ path: path.join(GIFTS_DIR, file), order: Number(suffix[1]) });
    }
  }

  return matched.sort((a, b) => a.order - b.order).map((m) => m.path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
