import { listOpenLineSessions } from "../crm/bitrix-openlines.js";
import {
  listBitrixDeals,
  listBitrixLeads,
  listBitrixStatusLabels,
} from "../crm/bitrix-client.js";
import type { AnalyticsExportConfig } from "./config.js";
import type { ExportDateRange } from "./bitrix-country-export.js";
import type { FxConverter } from "./fx-rates.js";
import {
  CHANNEL_BUCKETS,
  normalizeCrmChannel,
  normalizeOpenLineChannel,
  sortChannelRows,
  type ChannelBucket,
} from "./channel-buckets.js";
import { logger } from "../../logger.js";

export type ChannelSummaryRow = {
  channel: ChannelBucket;
  openLineSessions: number;
  leads: number;
  deals: number;
  revenueEur: number;
  avgCheck: number;
  leadToDealPct: number;
  leadSharePct: number;
  revenueSharePct: number;
};

function emptyBucket(channel: ChannelBucket): ChannelSummaryRow {
  return {
    channel,
    openLineSessions: 0,
    leads: 0,
    deals: 0,
    revenueEur: 0,
    avgCheck: 0,
    leadToDealPct: 0,
    leadSharePct: 0,
    revenueSharePct: 0,
  };
}

function buildSalesDealFilter(
  range: ExportDateRange,
  salesStageIds: string[],
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    ">=CLOSEDATE": range.from,
    "<CLOSEDATE": range.to,
  };
  if (salesStageIds.length === 1) {
    filter["=STAGE_ID"] = salesStageIds[0];
  } else if (salesStageIds.length > 1) {
    filter["@STAGE_ID"] = salesStageIds;
  }
  return filter;
}

export async function buildChannelSummary(opts: {
  range: ExportDateRange;
  config: AnalyticsExportConfig;
  fx: FxConverter;
}): Promise<{ rows: ChannelSummaryRow[]; totalLeads: number; totalDeals: number; totalRevenueEur: number }> {
  const [sourceLabels, leads, deals, sessions] = await Promise.all([
    listBitrixStatusLabels("SOURCE"),
    listBitrixLeads(
      { ">=DATE_CREATE": opts.range.from, "<DATE_CREATE": opts.range.to },
      ["SOURCE_DESCRIPTION"],
    ),
    listBitrixDeals(buildSalesDealFilter(opts.range, opts.config.salesStageIds), ["SOURCE_DESCRIPTION"]),
    listOpenLineSessions(opts.range),
  ]);

  const buckets = new Map<ChannelBucket, ChannelSummaryRow>(
    CHANNEL_BUCKETS.map((channel) => [channel, emptyBucket(channel)]),
  );

  const bump = (channel: ChannelBucket, patch: Partial<ChannelSummaryRow>): void => {
    const row = buckets.get(channel) ?? emptyBucket(channel);
    buckets.set(channel, {
      ...row,
      openLineSessions: row.openLineSessions + (patch.openLineSessions ?? 0),
      leads: row.leads + (patch.leads ?? 0),
      deals: row.deals + (patch.deals ?? 0),
      revenueEur: row.revenueEur + (patch.revenueEur ?? 0),
    });
  };

  for (const session of sessions) {
    bump(normalizeOpenLineChannel(session.channel), { openLineSessions: 1 });
  }

  for (const lead of leads) {
    const label = sourceLabels.get(lead.SOURCE_ID ?? "") ?? lead.SOURCE_ID ?? "";
    bump(normalizeCrmChannel(lead.SOURCE_ID, label, String(lead.SOURCE_DESCRIPTION ?? "")), {
      leads: 1,
    });
  }

  for (const deal of deals) {
    const label = sourceLabels.get(deal.SOURCE_ID ?? "") ?? deal.SOURCE_ID ?? "";
    const amount = opts.fx.convert(
      Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0,
      deal.CURRENCY_ID,
    );
    bump(normalizeCrmChannel(deal.SOURCE_ID, label, String(deal.SOURCE_DESCRIPTION ?? "")), {
      deals: 1,
      revenueEur: amount,
    });
  }

  const totalLeads = leads.length;
  const totalDeals = deals.length;
  const totalRevenueEur = deals.reduce(
    (sum, deal) =>
      sum +
      opts.fx.convert(Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0, deal.CURRENCY_ID),
    0,
  );

  const rows = sortChannelRows(
    [...buckets.values()]
      .filter((row) => row.openLineSessions > 0 || row.leads > 0 || row.deals > 0)
      .map((row) => ({
        ...row,
        avgCheck: row.deals ? row.revenueEur / row.deals : 0,
        leadToDealPct: row.leads ? (row.deals / row.leads) * 100 : 0,
        leadSharePct: totalLeads ? (row.leads / totalLeads) * 100 : 0,
        revenueSharePct: totalRevenueEur ? (row.revenueEur / totalRevenueEur) * 100 : 0,
      })),
  );

  logger.info("Channel summary built", {
    range: opts.range,
    leads: totalLeads,
    deals: totalDeals,
    sessions: sessions.length,
    channels: rows.length,
  });

  return { rows, totalLeads, totalDeals, totalRevenueEur };
}
