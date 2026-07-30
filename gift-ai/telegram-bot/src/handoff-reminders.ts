import { InlineKeyboard } from "grammy";

const API_URL = (process.env.API_URL ?? "http://localhost:3100").replace(/\/$/, "");
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? "";

export type DueHandoffReminder = {
  id: string;
  conversationId: string;
  channel: string;
  channelUserId: string;
  step: number;
  sendAfter: string;
  handoffUrl: string;
  buttonLabel: string;
  language: string;
  timezone: string;
  text: string;
};

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!ADMIN_API_KEY) throw new Error("ADMIN_API_KEY не настроен на боте");
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": ADMIN_API_KEY,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchDueHandoffReminders(limit = 20): Promise<DueHandoffReminder[]> {
  if (!ADMIN_API_KEY) return [];
  const data = await adminFetch<{ items: DueHandoffReminder[] }>(`/admin/handoff-reminders/due?limit=${limit}`);
  return data.items ?? [];
}

export async function markHandoffReminderSent(id: string): Promise<void> {
  if (!ADMIN_API_KEY) return;
  await adminFetch(`/admin/handoff-reminders/${encodeURIComponent(id)}/sent`, { method: "POST", body: "{}" });
}

export function reminderHandoffKeyboard(buttonLabel: string, _handoffUrl: string): InlineKeyboard {
  // Callback so we can cancel further reminders on click (URL-кнопка клик не ловится).
  return new InlineKeyboard().text(buttonLabel || "✉️ Написать менеджеру", "handoff:open");
}
