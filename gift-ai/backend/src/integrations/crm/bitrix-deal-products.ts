import { bitrixCall, listBitrixDeals, type BitrixDeal } from "./bitrix-client.js";
import { displayProductName, NO_PRODUCT_LABEL } from "../../modules/product-catalog.js";
import type { FxConverter } from "../analytics/fx-rates.js";
import type { ExportDateRange } from "../analytics/bitrix-country-export.js";

export type DealProductRow = {
  productName: string;
  lineAmount: number;
};

export type ProductSummaryRow = {
  product: string;
  count: number;
  amount: number;
  currency: string;
  avgCheck: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAmount(value: string | undefined): number {
  const amount = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(amount) ? amount : 0;
}

export async function listWonDealsClosedInRange(opts: {
  range: ExportDateRange;
  salesStageIds: string[];
}): Promise<BitrixDeal[]> {
  const filter: Record<string, unknown> = {
    ">=CLOSEDATE": opts.range.from,
    "<CLOSEDATE": opts.range.to,
  };

  if (opts.salesStageIds.length === 1) {
    filter["=STAGE_ID"] = opts.salesStageIds[0];
  } else if (opts.salesStageIds.length > 1) {
    filter["@STAGE_ID"] = opts.salesStageIds;
  } else {
    filter.CATEGORY_ID = 0;
    filter.STAGE_SEMANTIC_ID = "S";
  }

  return listBitrixDeals(filter, []);
}

export async function fetchDealProductRows(dealId: string): Promise<DealProductRow[]> {
  const response = await bitrixCall("crm.deal.productrows.get", { id: dealId });
  const rows = (response.result as Array<Record<string, unknown>> | undefined) ?? [];

  return rows.map((row) => {
    const rawName = String(row.PRODUCT_NAME ?? row.ORIGINAL_PRODUCT_NAME ?? "").trim();
    const quantity = Number(row.QUANTITY ?? 1) || 1;
    const price = Number(row.PRICE ?? 0) || 0;
    const discount = Number(row.DISCOUNT_SUM ?? 0) || 0;
    return {
      productName: displayProductName(rawName),
      lineAmount: price * quantity - discount,
    };
  });
}

export async function buildProductSummary(opts: {
  range: ExportDateRange;
  salesStageIds: string[];
  fx: FxConverter;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ rows: ProductSummaryRow[]; uniqueDeals: number }> {
  const deals = await listWonDealsClosedInRange({
    range: opts.range,
    salesStageIds: opts.salesStageIds,
  });

  const buckets = new Map<string, { count: number; amount: number }>();

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i]!;
    const currency = deal.CURRENCY_ID?.trim() || opts.fx.baseCurrency;
    const dealAmount = opts.fx.convert(parseAmount(deal.OPPORTUNITY), currency);
    const rows = await fetchDealProductRows(deal.ID);

    if (!rows.length) {
      const key = NO_PRODUCT_LABEL;
      const bucket = buckets.get(key) ?? { count: 0, amount: 0 };
      bucket.count += 1;
      bucket.amount += dealAmount;
      buckets.set(key, bucket);
    } else {
      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.productName)) continue;
        seen.add(row.productName);

        const lineEur = opts.fx.convert(row.lineAmount, currency);
        const amount = lineEur > 0 ? lineEur : dealAmount / rows.length;
        const bucket = buckets.get(row.productName) ?? { count: 0, amount: 0 };
        bucket.count += 1;
        bucket.amount += amount;
        buckets.set(row.productName, bucket);
      }
    }

    opts.onProgress?.(i + 1, deals.length);
    if (i + 1 < deals.length) await sleep(150);
  }

  const summaryRows: ProductSummaryRow[] = [...buckets.entries()].map(([product, bucket]) => ({
    product,
    count: bucket.count,
    amount: bucket.amount,
    currency: opts.fx.baseCurrency,
    avgCheck: bucket.count ? bucket.amount / bucket.count : 0,
  }));

  const noProduct = summaryRows.find((row) => row.product === NO_PRODUCT_LABEL);
  const rest = summaryRows
    .filter((row) => row.product !== NO_PRODUCT_LABEL)
    .sort((a, b) => b.count - a.count || a.product.localeCompare(b.product, "ru"));
  return {
    rows: noProduct ? [...rest, noProduct] : rest,
    uniqueDeals: deals.length,
  };
}
