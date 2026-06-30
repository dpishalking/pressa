import { logger } from "../../logger.js";

const FX_API = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@";

export function normalizeCurrency(code: string | undefined): string {
  const trimmed = (code ?? "").trim().toUpperCase();
  if (!trimmed || trimmed === "—") return "";
  return trimmed;
}

function parseFxDate(isoDate: string): string {
  return isoDate.slice(0, 10);
}

async function fetchEurRateTable(date: string): Promise<Record<string, number>> {
  const parsedDate = parseFxDate(date);
  const urls = [
    `${FX_API}${parsedDate}/v1/currencies/eur.json`,
    `${FX_API}latest/v1/currencies/eur.json`,
  ];

  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) continue;
    const json = (await res.json()) as { eur?: Record<string, number>; date?: string };
    if (json.eur && Object.keys(json.eur).length) {
      logger.info("FX rates loaded", { date: json.date ?? parsedDate, source: url.includes("latest") ? "latest" : parsedDate });
      return json.eur;
    }
  }

  throw new Error(`Не удалось загрузить курсы валют на ${parsedDate}`);
}

export class FxConverter {
  private readonly rates = new Map<string, number>();
  private readonly eurTable: Record<string, number>;

  constructor(
    readonly baseCurrency: string,
    readonly rateDate: string,
    eurTable: Record<string, number>,
    overrides: Record<string, number> = {},
  ) {
    this.eurTable = eurTable;
    this.rates.set(this.baseCurrency, 1);
    for (const [code, rate] of Object.entries(overrides)) {
      const normalized = normalizeCurrency(code);
      if (normalized && Number.isFinite(rate) && rate > 0) {
        this.rates.set(normalized, rate);
      }
    }
  }

  convert(amount: number, fromCurrency: string | undefined): number {
    if (!Number.isFinite(amount) || amount === 0) return 0;

    const code = normalizeCurrency(fromCurrency) || this.baseCurrency;
    if (code === this.baseCurrency) return amount;

    const rate = this.resolveRate(code);
    return amount * rate;
  }

  private resolveRate(code: string): number {
    const cached = this.rates.get(code);
    if (cached != null) return cached;

    if (this.baseCurrency !== "EUR") {
      throw new Error(
        `Автокурс для ${code} → ${this.baseCurrency} не поддерживается. Задайте ANALYTICS_FX_OVERRIDES.`,
      );
    }

    const unitsPerEur = this.eurTable[code.toLowerCase()];
    if (!unitsPerEur || !Number.isFinite(unitsPerEur)) {
      throw new Error(
        `Нет курса для ${code} → ${this.baseCurrency}. Добавьте в ANALYTICS_FX_OVERRIDES, например {"${code}":0.3}`,
      );
    }

    const rate = 1 / unitsPerEur;
    this.rates.set(code, rate);
    return rate;
  }
}

export async function loadFxConverter(opts: {
  baseCurrency?: string;
  date: string;
  overrides?: Record<string, number>;
}): Promise<FxConverter> {
  const baseCurrency = normalizeCurrency(opts.baseCurrency) || "EUR";
  const rateDate = parseFxDate(opts.date);
  const eurTable = await fetchEurRateTable(rateDate);
  return new FxConverter(baseCurrency, rateDate, eurTable, opts.overrides ?? {});
}
