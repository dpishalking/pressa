import { listBitrixDeals, resolveBitrixUserNames } from "./bitrix-client.js";
import {
  DEFAULT_THRESHOLDS,
  buildThinkDeals,
  enrichThinkDealPhones,
  THINK_DEAL_STAGE_ID,
} from "./bitrix-action-lists.js";
import type { ActionsExportConfig } from "../analytics/actions-config.js";
import { loadFxConverter } from "../analytics/fx-rates.js";
import { THINK_DEAL_HEADERS, deleteSheetTabs, thinkDealsTab, writeSheetContent } from "../sheets/analytics-write.js";
import { thinkDealSheetRows } from "./action-sheet-rows.js";
import type { GoogleServiceAccount } from "../sheets/google-auth.js";

function formatToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.STATS_TIMEZONE ?? "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function buildThinkDealsDirect(
  account: GoogleServiceAccount,
  cfg: ActionsExportConfig,
): Promise<{ active: number; expired: number; total: number }> {
  const fx = await loadFxConverter({
    baseCurrency: cfg.baseCurrency,
    date: formatToday(),
    overrides: cfg.fxOverrides,
  });

  const total = (await listBitrixDeals({ STAGE_ID: THINK_DEAL_STAGE_ID }, [])).length;
  const { active, expired } = await buildThinkDeals(
    fx,
    new Map(),
    new Map(),
    DEFAULT_THRESHOLDS.thinkDealMaxOverdueDays,
  );

  const managerIds = [
    ...new Set(
      [...active, ...expired]
        .map((row) => row.managerName)
        .filter((id) => /^\d+$/.test(id)),
    ),
  ];
  const managerNames = await resolveBitrixUserNames(managerIds);
  for (const row of active) {
    row.managerName = managerNames.get(row.managerName) ?? row.managerName;
  }

  await enrichThinkDealPhones(active);

  await writeSheetContent(
    account,
    cfg.sheetId,
    thinkDealsTab(),
    THINK_DEAL_HEADERS,
    thinkDealSheetRows(active, cfg.baseCurrency),
  );

  await deleteSheetTabs(account, cfg.sheetId, ["Я подумаю", "Я подумаю закрыть"]);

  return { active: active.length, expired: expired.length, total };
}
