import {
  exportBitrixAnalyticsByCountryTags,
  exportBitrixAnalyticsCombined,
  exportBitrixSalesSummariesForMonths,
  exportBitrixSalesSummary,
  monthRange,
  yesterdayRange,
  type ExportDateRange,
} from "./integrations/analytics/bitrix-country-export.js";
import {
  exportBitrixProductSummariesForMonths,
  exportBitrixProductSummary,
} from "./integrations/analytics/bitrix-product-export.js";
import { exportBitrixLtvCohorts } from "./integrations/analytics/bitrix-ltv-export.js";
import {
  exportBitrixChannelSummariesForMonths,
  exportBitrixChannelSummary,
} from "./integrations/analytics/bitrix-channel-export.js";
import { analyticsExportConfig } from "./integrations/analytics/config.js";
import { logger } from "./logger.js";

type ExportMode = "combined" | "by-country" | "summary" | "products" | "channels" | "ltv" | "all";

function parseArgs(argv: string[]): {
  range?: ExportDateRange;
  countryTags?: string[];
  mode: ExportMode;
  month?: string;
  months?: string[];
} {
  let from: string | undefined;
  let to: string | undefined;
  let month: string | undefined;
  const months: string[] = [];
  let mode: ExportMode = "combined";
  const countryTags: string[] = [];

  for (const arg of argv) {
    if (arg === "--by-country") mode = "by-country";
    if (arg === "--combined") mode = "combined";
    if (arg === "--summary") mode = "summary";
    if (arg === "--products") mode = "products";
    if (arg === "--channels") mode = "channels";
    if (arg === "--ltv") mode = "ltv";
    if (arg === "--all") mode = "all";
    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (value === "by-country" || value === "combined" || value === "summary" || value === "products" || value === "channels" || value === "ltv" || value === "all") {
        mode = value;
      }
    }
    if (arg.startsWith("--month=")) month = arg.slice("--month=".length);
    if (arg.startsWith("--months=")) {
      months.push(...arg.slice("--months=".length).split(",").map((m) => m.trim()).filter(Boolean));
    }
    if (arg.startsWith("--from=")) from = arg.slice("--from=".length);
    if (arg.startsWith("--to=")) to = arg.slice("--to=".length);
    if (arg.startsWith("--date=")) {
      from = arg.slice("--date=".length);
      const [year, monthNum, day] = from.split("-").map(Number);
      const next = new Date(Date.UTC(year, monthNum - 1, day + 1));
      to = next.toISOString().slice(0, 10);
    }
    if (arg.startsWith("--tags=")) {
      countryTags.push(...arg.slice("--tags=".length).split(",").map((tag) => tag.trim()).filter(Boolean));
    }
  }

  const tags = countryTags.length ? countryTags : undefined;

  if (months.length) {
    return { countryTags: tags, mode: mode === "combined" ? "summary" : mode, months };
  }

  if (month) {
    return { range: monthRange(month), countryTags: tags, mode: mode === "combined" ? "summary" : mode, month };
  }

  if (from && to) return { range: { from, to }, countryTags: tags, mode };
  if (from && !to) {
    const [year, monthNum, day] = from.split("-").map(Number);
    const next = new Date(Date.UTC(year, monthNum - 1, day + 1));
    return {
      range: { from, to: next.toISOString().slice(0, 10) },
      countryTags: tags,
      mode,
    };
  }
  return { countryTags: tags, mode };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = analyticsExportConfig();
  const range = args.range ?? yesterdayRange();

  logger.info("Starting Bitrix analytics export", {
    range,
    mode: args.mode,
    countries: args.countryTags ?? cfg.countryTags,
    sheetId: cfg.sheetId,
  });

  if (args.months?.length) {
    if (args.mode === "products") {
      console.log(JSON.stringify(await exportBitrixProductSummariesForMonths({ months: args.months, config: cfg }), null, 2));
      return;
    }
    if (args.mode === "channels") {
      console.log(JSON.stringify(await exportBitrixChannelSummariesForMonths({ months: args.months, config: cfg }), null, 2));
      return;
    }
    if (args.mode === "all") {
      const country = await exportBitrixSalesSummariesForMonths({
        months: args.months,
        countryTags: args.countryTags,
        config: cfg,
      });
      const products = await exportBitrixProductSummariesForMonths({ months: args.months, config: cfg });
      console.log(JSON.stringify({ country, products }, null, 2));
      return;
    }
    console.log(
      JSON.stringify(
        await exportBitrixSalesSummariesForMonths({
          months: args.months,
          countryTags: args.countryTags,
          config: cfg,
        }),
        null,
        2,
      ),
    );
    return;
  }

  if (args.mode === "ltv") {
    console.log(JSON.stringify(await exportBitrixLtvCohorts({ config: cfg }), null, 2));
    return;
  }

  if (args.mode === "channels") {
    console.log(
      JSON.stringify(
        await exportBitrixChannelSummary({
          range,
          month: args.month,
          config: cfg,
        }),
        null,
        2,
      ),
    );
    return;
  }

  if (args.mode === "products") {
    console.log(
      JSON.stringify(
        await exportBitrixProductSummary({
          range,
          month: args.month,
          config: cfg,
        }),
        null,
        2,
      ),
    );
    return;
  }

  const summary =
    args.mode === "summary"
      ? await exportBitrixSalesSummary({
          range,
          month: args.month,
          countryTags: args.countryTags,
          config: cfg,
        })
      : args.mode === "combined"
        ? await exportBitrixAnalyticsCombined({
            range,
            countryTags: args.countryTags,
            config: cfg,
          })
        : await exportBitrixAnalyticsByCountryTags({
            range,
            countryTags: args.countryTags,
            config: cfg,
          });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
