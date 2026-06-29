import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_PRODUCTS } from "./product-catalog.js";

const GIFTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "telegram-bot", "assets", "gifts");

/** Есть ли файл фото для канонического externalId (проверка при деплое). */
export function hasGiftPhotoFile(externalId: string): boolean {
  if (!externalId) return false;
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    if (existsSync(path.join(GIFTS_DIR, `${externalId}.${ext}`))) return true;
  }
  return false;
}

export function listCanonicalProductsWithPhotos(): Array<{ externalId: string; name: string; hasPhoto: boolean }> {
  return CANONICAL_PRODUCTS.map((p) => ({
    externalId: p.externalId,
    name: p.defaultName,
    hasPhoto: hasGiftPhotoFile(p.externalId),
  }));
}
