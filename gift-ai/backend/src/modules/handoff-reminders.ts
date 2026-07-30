import { randomUUID } from "node:crypto";
import { getDb } from "../db/client.js";
import { logger } from "../logger.js";
import { normalizeLanguage, type BotLanguage } from "./languages.js";
import type { QualificationFields } from "../types/index.js";

export type HandoffReminder = {
  id: string;
  conversationId: string;
  channel: string;
  channelUserId: string;
  step: number;
  sendAfter: string;
  status: "pending" | "sent" | "cancelled";
  handoffUrl: string;
  buttonLabel: string;
  language: BotLanguage;
  timezone: string;
  createdAt: string;
};

const REMINDER_TEXTS: Record<BotLanguage, string[]> = {
  ru: [
    "🎁 Ваша заявка уже собрана: повод, кому, бюджет и эмоция.\nНапишите менеджеру — по этим критериям сразу начнём подбор и подготовим подарок.\n⬇️ Кнопка ниже",
    "✨ Чтобы успеть к дате, лучше передать заявку сейчас.\nМенеджер подберёт вариант под ваш бюджет и нужную эмоцию — можно стартовать сегодня.\n✉️ Написать менеджеру",
    "💛 Мы уже знаем, что для вас важно в этом подарке.\nОстался один шаг: отправьте заявку менеджеру — и начнём персональный подбор.\n⬇️ Нажмите кнопку",
    "⏰ Коротко: критерии подарка готовы, осталось написать менеджеру.\nПосле сообщения сразу запустим подбор и подскажем, какой вариант лучше подойдёт.\n✉️ Написать менеджеру — и можно начинать",
  ],
  en: [
    "🎁 Your request is ready: occasion, recipient, budget and emotion.\nMessage the manager — we’ll start selecting the gift based on these criteria.\n⬇️ Button below",
    "✨ To make the date, it’s better to send the request now.\nThe manager will match your budget and desired emotion — we can start today.\n✉️ Message the manager",
    "💛 We already know what matters in this gift for you.\nOne step left: send the request to the manager and we’ll start a personal selection.\n⬇️ Tap the button",
    "⏰ Short version: gift criteria are ready — just message the manager.\nAfter that we’ll start selecting and suggest the best fit.\n✉️ Message the manager to begin",
  ],
  lv: [
    "🎁 Jūsu pieteikums jau ir sagatavots: iemesls, kam, budžets un emocija.\nUzrakstiet menedžerim — pēc šiem kritērijiem uzreiz sāksim izvēli.\n⬇️ Poga zemāk",
    "✨ Lai paspētu līdz datumam, labāk nodot pieteikumu tagad.\nMenedžeris piemeklēs variantu budžetam un emocijai — varam sākt šodien.\n✉️ Rakstīt menedžerim",
    "💛 Mēs jau zinām, kas jums šajā dāvanā ir svarīgi.\nAtlicis viens solis: nosūtiet pieteikumu menedžerim — un sāksim personīgo izvēli.\n⬇️ Nospiediet pogu",
    "⏰ Īsi: dāvanas kritēriji ir gatavi — atliek uzrakstīt menedžerim.\nPēc ziņas uzreiz sāksim izvēli un ieteiksim labāko variantu.\n✉️ Rakstīt menedžerim",
  ],
  et: [
    "🎁 Teie päring on valmis: põhjus, saaja, eelarve ja emotsioon.\nKirjutage haldurile — nende kriteeriumide järgi alustame kohe valikut.\n⬇️ Nupp all",
    "✨ Kuupäevaks jõudmiseks on parem päring nüüd saata.\nHaldur sobitab eelarve ja soovitud emotsiooni — saame alustada täna.\n✉️ Kirjuta haldurile",
    "💛 Teame juba, mis on selles kingituses teile oluline.\nÜks samm jäänud: saatke päring haldurile ja alustame personaalset valikut.\n⬇️ Vajutage nuppu",
    "⏰ Lühidalt: kingikriteeriumid on valmis — jääb vaid haldurile kirjutada.\nPärast sõnumit alustame valikut ja soovitame parima variandi.\n✉️ Kirjuta haldurile",
  ],
  lt: [
    "🎁 Jūsų užklausa jau paruošta: proga, kam, biudžetas ir emocija.\nParašykite vadybininkui — pagal šiuos kriterijus iškart pradėsime atranką.\n⬇️ Mygtukas žemiau",
    "✨ Kad spėtumėte iki datos, geriau perduoti užklausą dabar.\nVadybininkas parinks variantą pagal biudžetą ir emociją — galime pradėti šiandien.\n✉️ Rašyti vadybininkui",
    "💛 Jau žinome, kas jums šioje dovanėje svarbu.\nLiko vienas žingsnis: nusiųskite užklausą vadybininkui — ir pradėsime asmeninę atranką.\n⬇️ Paspauskite mygtuką",
    "⏰ Trumpai: dovanos kriterijai paruošti — beliko parašyti vadybininkui.\nPo žinutės iškart pradėsime atranką ir pasiūlysime geriausią variantą.\n✉️ Rašyti vadybininkui",
  ],
};

const DEFAULT_TZ = process.env.HANDOFF_REMINDER_TZ?.trim() || "Europe/Riga";
const QUIET_START_HOUR = 22; // inclusive local
const QUIET_END_HOUR = 10; // exclusive local — resume at 10:00
const STEP_HOURS = [1, 2, 3, 4] as const;

export function ensureHandoffReminderSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS handoff_reminders (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      channel_user_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      send_after TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      handoff_url TEXT NOT NULL DEFAULT '',
      button_label TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'ru',
      timezone TEXT NOT NULL DEFAULT 'Europe/Riga',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_handoff_reminders_due
      ON handoff_reminders(status, send_after);
    CREATE INDEX IF NOT EXISTS idx_handoff_reminders_conv
      ON handoff_reminders(conversation_id, status);
  `);
}

function localParts(date: Date, timeZone: string): { hour: number; y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    hour,
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
  };
}

/** Approximate UTC instant for local Y-M-D H:00 in timezone. */
function zonedLocalToUtc(opts: {
  timeZone: string;
  year: number;
  month: number;
  day: number;
  hour: number;
}): Date {
  const guess = new Date(Date.UTC(opts.year, opts.month - 1, opts.day, opts.hour, 0, 0));
  const asLocal = localParts(guess, opts.timeZone);
  const desiredAsMinutes = opts.hour * 60;
  const actualAsMinutes = asLocal.hour * 60;
  const deltaMin = desiredAsMinutes - actualAsMinutes;
  // Also adjust day drift
  let dayDelta = 0;
  if (asLocal.y !== opts.year || asLocal.m !== opts.month || asLocal.d !== opts.day) {
    const actualDay = Date.UTC(asLocal.y, asLocal.m - 1, asLocal.d);
    const desiredDay = Date.UTC(opts.year, opts.month - 1, opts.day);
    dayDelta = (desiredDay - actualDay) / 60_000;
  }
  return new Date(guess.getTime() + (deltaMin + dayDelta) * 60_000);
}

function addLocalDays(parts: { y: number; m: number; d: number }, days: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + days));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** If local time is >=22:00 or <10:00, move to next allowed morning 10:00. */
export function pushOutOfQuietHours(date: Date, timeZone: string): Date {
  const local = localParts(date, timeZone);
  if (local.hour >= QUIET_START_HOUR) {
    const next = addLocalDays(local, 1);
    return zonedLocalToUtc({ timeZone, year: next.y, month: next.m, day: next.d, hour: QUIET_END_HOUR });
  }
  if (local.hour < QUIET_END_HOUR) {
    return zonedLocalToUtc({
      timeZone,
      year: local.y,
      month: local.m,
      day: local.d,
      hour: QUIET_END_HOUR,
    });
  }
  return date;
}

export function resolveReminderTimezone(fields?: Partial<QualificationFields>): string {
  const country = (fields?.country ?? "").toLowerCase();
  const city = (fields?.city ?? "").toLowerCase();
  if (/латви|latvi|риг|riga/.test(`${country} ${city}`)) return "Europe/Riga";
  if (/эстон|eston|таллин|tallinn/.test(`${country} ${city}`)) return "Europe/Tallinn";
  if (/литв|lithuan|вильн|vilnius/.test(`${country} ${city}`)) return "Europe/Vilnius";
  if (/беларус|минск|belarus/.test(`${country} ${city}`)) return "Europe/Minsk";
  if (/украин|киев|київ|kyiv|ukraine/.test(`${country} ${city}`)) return "Europe/Kyiv";
  if (/росси|moscow|москв|спб|питер|russia/.test(`${country} ${city}`)) return "Europe/Moscow";
  if (/герман|berlin|deutsch|germany/.test(`${country} ${city}`)) return "Europe/Berlin";
  if (/польш|warsaw|poland/.test(`${country} ${city}`)) return "Europe/Warsaw";
  return DEFAULT_TZ;
}

export function buildReminderSchedule(from = new Date(), timeZone = DEFAULT_TZ): Date[] {
  const out: Date[] = [];
  let prev = from;
  for (const hours of STEP_HOURS) {
    let candidate = pushOutOfQuietHours(new Date(from.getTime() + hours * 3_600_000), timeZone);
    if (candidate.getTime() <= prev.getTime()) {
      candidate = pushOutOfQuietHours(new Date(prev.getTime() + 3_600_000), timeZone);
    }
    // Keep at least ~1h gap after quiet-hour collapse
    if (candidate.getTime() - prev.getTime() < 50 * 60_000) {
      candidate = pushOutOfQuietHours(new Date(prev.getTime() + 3_600_000), timeZone);
    }
    out.push(candidate);
    prev = candidate;
  }
  return out;
}

export function reminderText(step: number, language: BotLanguage): string {
  const list = REMINDER_TEXTS[language] ?? REMINDER_TEXTS.ru;
  return list[Math.max(0, Math.min(list.length - 1, step - 1))] ?? list[0]!;
}

export function cancelHandoffReminders(opts: {
  conversationId?: string;
  channel?: string;
  channelUserId?: string;
}): number {
  ensureHandoffReminderSchema();
  const db = getDb();
  const now = new Date().toISOString();
  if (opts.conversationId) {
    const result = db
      .prepare(
        `UPDATE handoff_reminders SET status = 'cancelled', updated_at = ?
         WHERE conversation_id = ? AND status = 'pending'`,
      )
      .run(now, opts.conversationId);
    return result.changes;
  }
  if (opts.channel && opts.channelUserId) {
    const result = db
      .prepare(
        `UPDATE handoff_reminders SET status = 'cancelled', updated_at = ?
         WHERE channel = ? AND channel_user_id = ? AND status = 'pending'`,
      )
      .run(now, opts.channel, opts.channelUserId);
    return result.changes;
  }
  return 0;
}

export function scheduleHandoffReminders(opts: {
  conversationId: string;
  channel: string;
  channelUserId: string;
  handoffUrl: string;
  buttonLabel: string;
  language?: string;
  fields?: Partial<QualificationFields>;
}): { scheduled: number; timezone: string; sendAfter: string[] } {
  ensureHandoffReminderSchema();
  cancelHandoffReminders({ conversationId: opts.conversationId });
  cancelHandoffReminders({ channel: opts.channel, channelUserId: opts.channelUserId });

  const language = normalizeLanguage(opts.language);
  const timezone = resolveReminderTimezone(opts.fields);
  const times = buildReminderSchedule(new Date(), timezone);
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO handoff_reminders (
      id, conversation_id, channel, channel_user_id, step, send_after, status,
      handoff_url, button_label, language, timezone, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
  );

  const sendAfter: string[] = [];
  const tx = db.transaction(() => {
    times.forEach((time, index) => {
      const iso = time.toISOString();
      sendAfter.push(iso);
      insert.run(
        randomUUID(),
        opts.conversationId,
        opts.channel,
        opts.channelUserId,
        index + 1,
        iso,
        opts.handoffUrl,
        opts.buttonLabel,
        language,
        timezone,
        now,
        now,
      );
    });
  });
  tx();

  logger.info("Handoff reminders scheduled", {
    conversationId: opts.conversationId,
    channelUserId: opts.channelUserId,
    timezone,
    sendAfter,
  });
  return { scheduled: times.length, timezone, sendAfter };
}

function mapReminderRow(row: Record<string, unknown>): HandoffReminder {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    channel: String(row.channel),
    channelUserId: String(row.channel_user_id),
    step: Number(row.step),
    sendAfter: String(row.send_after),
    status: String(row.status) as HandoffReminder["status"],
    handoffUrl: String(row.handoff_url ?? ""),
    buttonLabel: String(row.button_label ?? ""),
    language: normalizeLanguage(String(row.language ?? "ru")),
    timezone: String(row.timezone ?? DEFAULT_TZ),
    createdAt: String(row.created_at),
  };
}

export function listDueHandoffReminders(limit = 20): Array<HandoffReminder & { text: string }> {
  ensureHandoffReminderSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM handoff_reminders
       WHERE status = 'pending' AND send_after <= ?
       ORDER BY send_after ASC
       LIMIT ?`,
    )
    .all(now, Math.min(50, Math.max(1, limit))) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const reminder = mapReminderRow(row);
    return { ...reminder, text: reminderText(reminder.step, reminder.language) };
  });
}

export function markHandoffReminderSent(id: string): void {
  ensureHandoffReminderSchema();
  getDb()
    .prepare(`UPDATE handoff_reminders SET status = 'sent', updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
}

export function markHandoffReminderCancelled(id: string): void {
  ensureHandoffReminderSchema();
  getDb()
    .prepare(`UPDATE handoff_reminders SET status = 'cancelled', updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
}
