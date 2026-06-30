import { listBitrixDeals } from "../crm/bitrix-client.js";
import { loadFxConverter } from "../analytics/fx-rates.js";
import type { RopAlertsConfig } from "./alerts-config.js";

const ltvCache = new Map<string, { value: number; expiresAt: number }>();
const CACHE_TTL_MS = 15 * 60_000;

export async function getContactLtvEur(contactId: string, cfg: RopAlertsConfig): Promise<number> {
  const key = contactId.trim();
  if (!key || key === "0") return 0;

  const cached = ltvCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const fx = await loadFxConverter({
    baseCurrency: cfg.baseCurrency,
    date: new Date().toISOString().slice(0, 10),
    overrides: cfg.fxOverrides,
  });

  let total = 0;
  if (cfg.salesStageIds.length === 1) {
    const deals = await listBitrixDeals(
      { CONTACT_ID: key, STAGE_ID: cfg.salesStageIds[0] },
      ["OPPORTUNITY", "CURRENCY_ID"],
    );
    for (const deal of deals) {
      total += fx.convert(Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0, deal.CURRENCY_ID);
    }
  } else {
    for (const stageId of cfg.salesStageIds) {
      const deals = await listBitrixDeals(
        { CONTACT_ID: key, STAGE_ID: stageId },
        ["OPPORTUNITY", "CURRENCY_ID"],
      );
      for (const deal of deals) {
        total += fx.convert(Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0, deal.CURRENCY_ID);
      }
    }
  }

  ltvCache.set(key, { value: total, expiresAt: Date.now() + CACHE_TTL_MS });
  return total;
}
