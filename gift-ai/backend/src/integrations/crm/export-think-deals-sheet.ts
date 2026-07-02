import { listBitrixDeals } from "./bitrix-client.js";
import { resolveBitrixUserNames } from "./bitrix-client.js";
import { DEFAULT_THRESHOLDS, buildThinkDeals, THINK_DEAL_STAGE_ID, type ThinkDealRow } from "./bitrix-action-lists.js";
import type { ActionsExportConfig } from "../analytics/actions-config.js";
import { loadFxConverter } from "../analytics/fx-rates.js";
import {
  THINK_DEAL_HEADERS,
  thinkDealsExpiredTab,
  thinkDealsTab,
  sheetAmount,
  sheetText,
  writeSheetDataOnly,
} from "../sheets/analytics-write.js";
import type { GoogleServiceAccount } from "../sheets/google-auth.js";

function formatToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.STATS_TIMEZONE ?? "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function thinkIssueLabel(issue: ThinkDealRow["issue"], closeDate: string, today: string): string {
  const thinkDays = DEFAULT_THRESHOLDS.thinkDealMaxOverdueDays;
  if (issue === "no_task") {
    return closeDate && closeDate >= today ? "Нет дела (есть дата в CRM)" : "Нет дела";
  }
  if (issue === "expired") return `Закрыть (>${thinkDays} дн)`;
  return "Просрочен контакт";
}

function thinkRows(rows: ThinkDealRow[], baseCurrency: string): (string | number)[][] {
  const today = formatToday();
  return rows.map((row) => [
    row.dealId,
    sheetText(row.title),
    sheetAmount(row.amountEur),
    baseCurrency,
    row.nextContactDate || "—",
    row.taskDeadline || "—",
    row.daysOverdue,
    thinkIssueLabel(row.issue, row.nextContactDate, today),
    sheetText(row.managerName),
    sheetText(row.phone),
  ]);
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
  for (const row of [...active, ...expired]) {
    row.managerName = managerNames.get(row.managerName) ?? row.managerName;
  }

  await writeSheetDataOnly(
    account,
    cfg.sheetId,
    thinkDealsTab(),
    THINK_DEAL_HEADERS.length,
    thinkRows(active, cfg.baseCurrency),
  );

  await writeSheetDataOnly(
    account,
    cfg.sheetId,
    thinkDealsExpiredTab(),
    THINK_DEAL_HEADERS.length,
    thinkRows(expired, cfg.baseCurrency),
  );

  return { active: active.length, expired: expired.length, total };
}
