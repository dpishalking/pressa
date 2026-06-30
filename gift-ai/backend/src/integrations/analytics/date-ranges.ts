export type ExportDateRange = {
  from: string;
  to: string;
};

const STATS_TZ = process.env.STATS_TIMEZONE ?? "Europe/Moscow";

function formatBitrixDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STATS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function yesterdayRange(): ExportDateRange {
  const today = formatBitrixDate(new Date());
  const yesterday = addDaysIso(today, -1);
  return { from: yesterday, to: today };
}

export function todayRange(now = new Date()): ExportDateRange {
  const today = formatBitrixDate(now);
  const tomorrow = addDaysIso(today, 1);
  return { from: today, to: tomorrow };
}

export function monthRange(yearMonth: string): ExportDateRange {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error(`Некорректный месяц: ${yearMonth}. Используйте формат YYYY-MM, например 2026-06`);
  }
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const to = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { from, to };
}
