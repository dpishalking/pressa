import { exportBitrixChats, exportBitrixChatsForMonths } from "./integrations/analytics/bitrix-chat-export.js";
import { monthRange } from "./integrations/analytics/bitrix-country-export.js";
import { chatExportConfig } from "./integrations/analytics/chat-config.js";
import { logger } from "./logger.js";

function parseArgs(argv: string[]): {
  month?: string;
  months?: string[];
  limit?: number;
} {
  let month: string | undefined;
  const months: string[] = [];
  let limit: number | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--month=")) month = arg.slice("--month=".length);
    if (arg.startsWith("--months=")) {
      months.push(...arg.slice("--months=".length).split(",").map((m) => m.trim()).filter(Boolean));
    }
    if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(value) && value > 0) limit = value;
    }
  }

  return { month, months: months.length ? months : undefined, limit };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = chatExportConfig();

  logger.info("Starting Bitrix chat export", {
    month: args.month,
    months: args.months,
    limit: args.limit,
    sheetId: cfg.sheetId,
  });

  const result = args.months?.length
    ? await exportBitrixChatsForMonths({ months: args.months, limit: args.limit })
    : await exportBitrixChats({
        month: args.month,
        range: args.month ? monthRange(args.month) : undefined,
        limit: args.limit,
      });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
