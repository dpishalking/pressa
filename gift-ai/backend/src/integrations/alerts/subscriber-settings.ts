import { getDb } from "../../db/client.js";
import { getTelegramSubscriber } from "./telegram-subscribers.js";

export type AlertTypeKey = "leads" | "chats" | "invoices" | "invoice_sent" | "payments" | "lost_deals" | "vip" | "daily_digest";

export type SubscriberSettings = {
  chatId: string;
  active: boolean;
  pausedUntil: string | null;
  leads: boolean;
  chats: boolean;
  invoices: boolean;
  invoiceSent: boolean;
  payments: boolean;
  lostDeals: boolean;
  vip: boolean;
  dailyDigest: boolean;
};

const DEFAULTS: Omit<SubscriberSettings, "chatId"> = {
  active: true,
  pausedUntil: null,
  leads: false,
  chats: false,
  invoices: true,
  invoiceSent: true,
  payments: true,
  lostDeals: true,
  vip: true,
  dailyDigest: true,
};

function rowToSettings(row: {
  chat_id: string;
  active: number;
  paused_until: string | null;
  notify_leads: number;
  notify_chats: number;
  notify_invoices: number;
  notify_invoice_sent: number;
  notify_payments: number;
  notify_lost_deals: number;
  notify_vip: number;
  notify_daily_digest: number;
}): SubscriberSettings {
  return {
    chatId: row.chat_id,
    active: row.active !== 0,
    pausedUntil: row.paused_until,
    leads: row.notify_leads !== 0,
    chats: row.notify_chats !== 0,
    invoices: row.notify_invoices !== 0,
    invoiceSent: row.notify_invoice_sent !== 0,
    payments: row.notify_payments !== 0,
    lostDeals: row.notify_lost_deals !== 0,
    vip: row.notify_vip !== 0,
    dailyDigest: row.notify_daily_digest !== 0,
  };
}

export function ensureSubscriberSettings(chatId: string): SubscriberSettings {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT chat_id, active, paused_until, notify_leads, notify_chats, notify_invoices, notify_invoice_sent, notify_payments, notify_lost_deals, notify_vip, notify_daily_digest
       FROM rop_telegram_subscribers WHERE chat_id = ?`,
    )
    .get(chatId) as
    | {
        chat_id: string;
        active: number;
        paused_until: string | null;
        notify_leads: number;
        notify_chats: number;
        notify_invoices: number;
        notify_invoice_sent: number;
        notify_payments: number;
        notify_lost_deals: number;
        notify_vip: number;
        notify_daily_digest: number;
      }
    | undefined;

  if (existing) return rowToSettings(existing);

  return { chatId, ...DEFAULTS };
}

export function getSubscriberSettings(chatId: string): SubscriberSettings {
  return ensureSubscriberSettings(chatId);
}

export function setSubscriberActive(chatId: string, active: boolean): void {
  const db = getDb();
  db.prepare("UPDATE rop_telegram_subscribers SET active = ? WHERE chat_id = ?").run(active ? 1 : 0, chatId);
}

export function setSubscriberPause(chatId: string, until: string | null): void {
  const db = getDb();
  db.prepare("UPDATE rop_telegram_subscribers SET paused_until = ? WHERE chat_id = ?").run(until, chatId);
}

export function setSubscriberAlertToggle(chatId: string, key: AlertTypeKey, enabled: boolean): void {
  const column = {
    leads: "notify_leads",
    chats: "notify_chats",
    invoices: "notify_invoices",
    invoice_sent: "notify_invoice_sent",
    payments: "notify_payments",
    lost_deals: "notify_lost_deals",
    vip: "notify_vip",
    daily_digest: "notify_daily_digest",
  }[key];

  const db = getDb();
  db.prepare(`UPDATE rop_telegram_subscribers SET ${column} = ? WHERE chat_id = ?`).run(enabled ? 1 : 0, chatId);
}

export function subscriberWantsAlert(chatId: string, alertType: AlertTypeKey): boolean {
  const sub = getTelegramSubscriber(chatId);
  if (!sub) return false;

  const settings = getSubscriberSettings(chatId);
  if (!settings.active) return false;
  if (settings.pausedUntil && Date.parse(settings.pausedUntil) > Date.now()) return false;

  switch (alertType) {
    case "leads":
      return settings.leads;
    case "chats":
      return settings.chats;
    case "invoices":
      return settings.invoices;
    case "invoice_sent":
      return settings.invoiceSent;
    case "payments":
      return settings.payments;
    case "lost_deals":
      return settings.lostDeals;
    case "vip":
      return settings.vip;
    case "daily_digest":
      return settings.dailyDigest;
  }
}

export function toggleLabel(on: boolean): string {
  return on ? "вкл ✓" : "выкл";
}
