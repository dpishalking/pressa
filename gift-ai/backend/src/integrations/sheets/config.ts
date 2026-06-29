import { config } from "../../config.js";

export function sheetSyncConfig() {
  const gids = config.GOOGLE_SHEET_GIDS.split(",").map((s: string) => s.trim()).filter(Boolean);
  const csvUrls = config.GOOGLE_SHEET_CSV_URL.split(/[\n,]/).map((s: string) => s.trim()).filter(Boolean);

  return {
    sheetId: config.GOOGLE_SHEET_ID.trim() || undefined,
    gids: gids.length ? gids : undefined,
    csvUrl: csvUrls[0],
    csvUrls: csvUrls.length > 1 ? csvUrls : undefined,
  };
}

export function sheetSyncEnabled(): boolean {
  const c = sheetSyncConfig();
  return Boolean(c.sheetId || c.csvUrl || c.csvUrls?.length);
}
