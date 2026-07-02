import { getGoogleAccessToken, loadServiceAccount } from "./google-auth.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export async function readSheetTab(opts: {
  serviceAccountJson: string;
  spreadsheetId: string;
  tabTitle: string;
}): Promise<string[][]> {
  const account = loadServiceAccount(opts.serviceAccountJson);
  const token = await getGoogleAccessToken(account);
  const range = `'${opts.tabTitle.replace(/'/g, "''")}'`;
  const res = await fetch(
    `${SHEETS_API}/${opts.spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = (await res.json()) as { values?: string[][]; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Sheets read failed: HTTP ${res.status}`);
  return json.values ?? [];
}

export function rowsToObjects(headers: readonly string[], rows: string[][]): Record<string, string>[] {
  const headerIndex = new Map(headers.map((h, i) => [h, i]));
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    for (const [header, idx] of headerIndex) {
      obj[header] = row[idx] ?? "";
    }
    return obj;
  });
}

export function parseNumber(value: string | undefined): number {
  if (!value?.trim()) return 0;
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}
