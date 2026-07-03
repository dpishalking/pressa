import { getDb } from "../db/client.js";
import { logger } from "../logger.js";

interface GiftRow {
  id: string;
  name: string;
  description: string;
  price_min: number;
  price_max: number;
  emotions: string;
  suitable_for: string;
  occasions: string;
  lead_time_days: number;
  personalization: string;
  active: number;
}

let _catalogCache: string | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/**
 * Returns a compact human-readable text summary of the active product catalog
 * from the gifts table. Cached for 5 minutes.
 */
export function getProductCatalogText(): string {
  if (_catalogCache && Date.now() - _cacheTs < CACHE_TTL_MS) {
    return _catalogCache;
  }

  try {
    const db = getDb();
    const gifts = db
      .prepare("SELECT * FROM gifts WHERE active = 1 ORDER BY price_min ASC")
      .all() as GiftRow[];

    if (gifts.length === 0) {
      _catalogCache = "Каталог продуктов временно недоступен.";
      _cacheTs = Date.now();
      return _catalogCache;
    }

    const lines: string[] = ["## Актуальный каталог продуктов Retro Pressa\n"];

    for (const g of gifts) {
      let emotions: string[] = [];
      let suitableFor: string[] = [];
      let occasions: string[] = [];

      try { emotions = JSON.parse(g.emotions); } catch { /* skip */ }
      try { suitableFor = JSON.parse(g.suitable_for); } catch { /* skip */ }
      try { occasions = JSON.parse(g.occasions); } catch { /* skip */ }

      const priceRange =
        g.price_min === g.price_max
          ? `${g.price_min} EUR`
          : `${g.price_min}–${g.price_max} EUR`;

      lines.push(`### ${g.name}`);
      lines.push(`Цена: ${priceRange} | Срок изготовления: ${g.lead_time_days} дней`);
      if (g.description) lines.push(g.description);
      if (emotions.length) lines.push(`Эмоции: ${emotions.join(", ")}`);
      if (suitableFor.length) lines.push(`Подходит для: ${suitableFor.join(", ")}`);
      if (occasions.length) lines.push(`Поводы: ${occasions.join(", ")}`);
      if (g.personalization) lines.push(`Персонализация: ${g.personalization}`);
      lines.push("");
    }

    _catalogCache = lines.join("\n");
    _cacheTs = Date.now();
    return _catalogCache;
  } catch (err) {
    logger.warn("Failed to load product catalog", { error: String(err) });
    return "Каталог продуктов временно недоступен.";
  }
}

/** Invalidate the catalog cache (call after products are updated). */
export function invalidateCatalogCache(): void {
  _catalogCache = null;
  _cacheTs = 0;
}
