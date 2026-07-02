import {
  exportBitrixManagerDashboards,
  exportBitrixManagerDashboardsForMonths,
} from "./integrations/analytics/bitrix-manager-export.js";
import { logger } from "./logger.js";

function parseArgs(argv: string[]): { month?: string; months?: string[] } {
  let month: string | undefined;
  const months: string[] = [];

  for (const arg of argv) {
    if (arg.startsWith("--month=")) month = arg.slice("--month=".length);
    if (arg.startsWith("--months=")) {
      months.push(...arg.slice("--months=".length).split(",").map((value) => value.trim()).filter(Boolean));
    }
  }

  if (months.length) return { months };
  return { month: month ?? new Date().toISOString().slice(0, 7) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  logger.info("Starting manager dashboards export", args);

  if (args.months?.length) {
    console.log(JSON.stringify(await exportBitrixManagerDashboardsForMonths({ months: args.months }), null, 2));
    return;
  }

  console.log(JSON.stringify(await exportBitrixManagerDashboards({ month: args.month }), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
