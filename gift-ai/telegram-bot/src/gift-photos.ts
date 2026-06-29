import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GIFTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "gifts");

/** Путь к фото подарка по externalId (имя файла = externalId.jpg). */
export function giftPhotoPath(externalId: string): string | null {
  if (!externalId) return null;
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const file = path.join(GIFTS_DIR, `${externalId}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}
