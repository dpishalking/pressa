import type { RopAlertsConfig } from "./alerts-config.js";

export function moscowTimeParts(now = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  return {
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0),
    minute: Number(parts.find((p) => p.type === "minute")?.value ?? 0),
  };
}

/** Алерты РОПу: с alertFromHour:00 до alertToHour:00 по Москве (конец не включая). */
export function isWithinRopAlertWindow(cfg: RopAlertsConfig, now = new Date()): boolean {
  const { hour, minute } = moscowTimeParts(now);
  const nowMinutes = hour * 60 + minute;
  const fromMinutes = cfg.alertFromHour * 60;
  const toMinutes = cfg.alertToHour * 60;
  return nowMinutes >= fromMinutes && nowMinutes < toMinutes;
}

export function ropAlertWindowLabel(fromHour: number, toHour: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(fromHour)}:00–${pad(toHour)}:00 МСК`;
}

export function moscowDateString(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}
