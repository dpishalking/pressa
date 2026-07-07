import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { API_URL } from "./api.js";
import { escapeHtml } from "./format.js";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? "";

function parseAdminAllowlist(raw: string): { ids: Set<string>; usernames: Set<string> } {
  const ids = new Set<string>();
  const usernames = new Set<string>();
  for (const entry of raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)) {
    const normalized = entry.replace(/^@/, "");
    if (/^\d+$/.test(normalized)) ids.add(normalized);
    else usernames.add(normalized.toLowerCase());
  }
  return { ids, usernames };
}

const ADMIN_ALLOWLIST = parseAdminAllowlist(
  process.env.ADMIN_TELEGRAM_IDS ?? process.env.TRAINER_NOTIFY_TELEGRAM_IDS ?? "",
);

export function isTrainerAdmin(ctx: Context): boolean {
  const { ids, usernames } = ADMIN_ALLOWLIST;
  if (!ids.size && !usernames.size) return false;
  const id = String(ctx.from?.id ?? "");
  if (ids.has(id)) return true;
  const username = ctx.from?.username?.toLowerCase() ?? "";
  return Boolean(username && usernames.has(username));
}

export function adminConfigured(): boolean {
  return Boolean(ADMIN_API_KEY && (ADMIN_ALLOWLIST.ids.size || ADMIN_ALLOWLIST.usernames.size));
}

async function adminFetch<T>(path: string): Promise<T> {
  if (!ADMIN_API_KEY) throw new Error("ADMIN_API_KEY не настроен на боте");
  const res = await fetch(`${API_URL}/trainer${path}`, {
    headers: { "x-admin-key": ADMIN_API_KEY },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export function adminMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Сводка", "admin:summary").row()
    .text("🟢 Сейчас в практике", "admin:active").row()
    .text("📋 Последние ролевки", "admin:recent").row()
    .text("🔄 Обновить", "admin:menu");
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} д назад`;
}

function truncate(text: string, max = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export async function showAdminMenu(ctx: Context): Promise<void> {
  await ctx.reply(
    "<b>🛠 Админ-панель тренажёра</b>\n\nСледите за практикой студентов и читайте их обратную связь после ролевок.",
    { parse_mode: "HTML", reply_markup: adminMenuKeyboard() },
  );
}

export async function showAdminSummary(ctx: Context): Promise<void> {
  const data = await adminFetch<{
    teamStats: { totalUsers: number; totalSessions: number; averageScore: number; successRate: number };
    weakSkills: Array<{ skill: string; avg_score: number }>;
    topMistakes: Array<{ text: string; count: number }>;
    atRisk: Array<{ full_name: string; avg_score: number | null; total: number }>;
  }>("/admin/team-analytics");

  const lines = [
    "<b>📊 Сводка команды</b>",
    "",
    `👥 Студентов: ${data.teamStats.totalUsers}`,
    `🎭 Ролевок: ${data.teamStats.totalSessions}`,
    `📈 Средний балл: ${data.teamStats.averageScore}/100`,
    `✅ Успешных: ${data.teamStats.successRate}%`,
  ];

  if (data.weakSkills.length) {
    lines.push("", "<b>Слабые навыки:</b>");
    for (const s of data.weakSkills.slice(0, 3)) {
      lines.push(`• ${s.skill}: ${Math.round(s.avg_score)}%`);
    }
  }

  if (data.topMistakes.length) {
    lines.push("", "<b>Частые ошибки:</b>");
    for (const m of data.topMistakes.slice(0, 3)) {
      lines.push(`• ${escapeHtml(truncate(m.text, 80))} (${m.count})`);
    }
  }

  if (data.atRisk.length) {
    lines.push("", "<b>⚠️ Нужно внимание:</b>");
    for (const u of data.atRisk.slice(0, 5)) {
      const score = u.avg_score != null ? `${Math.round(u.avg_score)}/100` : "нет оценок";
      lines.push(`• ${escapeHtml(u.full_name)} — ${score}, ${u.total} ролевок`);
    }
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: adminMenuKeyboard() });
}

export async function showActiveSessions(ctx: Context): Promise<void> {
  const data = await adminFetch<{
    sessions: Array<{
      sessionId: string;
      fullName: string;
      scenarioName: string;
      messageCount: number;
      startedAt: string;
      lastPreview: string | null;
    }>;
  }>("/admin/sessions/active?limit=15");

  if (!data.sessions.length) {
    await ctx.reply("🟢 Сейчас никто не проходит практику.", { reply_markup: adminMenuKeyboard() });
    return;
  }

  const kb = new InlineKeyboard();
  const lines = ["<b>🟢 Сейчас в практике</b>", ""];
  for (const s of data.sessions) {
    lines.push(
      `• <b>${escapeHtml(s.fullName)}</b> — ${escapeHtml(truncate(s.scenarioName, 40))}`,
      `  ${s.messageCount} сообщ. · ${formatRelativeTime(s.startedAt)}`,
      s.lastPreview ? `  «${escapeHtml(truncate(s.lastPreview, 50))}»` : "",
      "",
    );
    kb.text(`👁 ${truncate(s.fullName, 12)}`, `admin:session:${s.sessionId}`).row();
  }
  kb.text("⬅️ Назад", "admin:menu");

  await ctx.reply(lines.filter(Boolean).join("\n"), { parse_mode: "HTML", reply_markup: kb });
}

export async function showRecentSessions(ctx: Context): Promise<void> {
  const data = await adminFetch<{
    sessions: Array<{
      sessionId: string;
      fullName: string;
      scenarioName: string;
      score: number | null;
      completedAt: string | null;
      feedbackRating: number | null;
      feedbackComment: string | null;
    }>;
  }>("/admin/sessions/recent?limit=15");

  if (!data.sessions.length) {
    await ctx.reply("📋 Завершённых ролевок пока нет.", { reply_markup: adminMenuKeyboard() });
    return;
  }

  const kb = new InlineKeyboard();
  const lines = ["<b>📋 Последние ролевки</b>", ""];
  for (const s of data.sessions) {
    const score = s.score != null ? `${s.score}/100` : "—";
    const stars = s.feedbackRating ? " " + "⭐".repeat(s.feedbackRating) : "";
    lines.push(
      `• <b>${escapeHtml(s.fullName)}</b> — ${score}${stars}`,
      `  ${escapeHtml(truncate(s.scenarioName, 40))} · ${formatRelativeTime(s.completedAt)}`,
      s.feedbackComment ? `  💬 «${escapeHtml(truncate(s.feedbackComment, 60))}»` : "",
      "",
    );
    kb.text(`👁 ${truncate(s.fullName, 12)}`, `admin:session:${s.sessionId}`).row();
  }
  kb.text("⬅️ Назад", "admin:menu");

  await ctx.reply(lines.filter(Boolean).join("\n"), { parse_mode: "HTML", reply_markup: kb });
}

export async function showSessionDetail(ctx: Context, sessionId: string): Promise<void> {
  const data = await adminFetch<{
    session: {
      fullName: string;
      scenarioName: string;
      status: string;
      score: number | null;
      startedAt: string;
      completedAt: string | null;
    };
    messages: Array<{ author: string; text: string }>;
    evaluation: { totalScore: number; mistakes: string[] } | null;
    feedback: { rating: number; comment: string | null } | null;
  }>(`/admin/sessions/${sessionId}`);

  const { session, messages, evaluation, feedback } = data;
  const statusLabel =
    session.status === "active" ? "🟢 в процессе" : session.status === "completed" ? "✅ завершена" : session.status;

  const lines = [
    `<b>👁 ${escapeHtml(session.fullName)}</b>`,
    `📋 ${escapeHtml(session.scenarioName)}`,
    `${statusLabel}${session.score != null ? ` · ${session.score}/100` : ""}`,
    "",
    "<b>Диалог:</b>",
  ];

  for (const m of messages.slice(-12)) {
    const who = m.author === "employee" ? "💼" : m.author === "client" ? "👤" : "•";
    lines.push(`${who} ${escapeHtml(truncate(m.text, 120))}`);
  }

  if (evaluation?.mistakes.length) {
    lines.push("", "<b>Ошибки AI:</b>");
    for (const mistake of evaluation.mistakes.slice(0, 3)) {
      lines.push(`• ${escapeHtml(truncate(mistake, 100))}`);
    }
  }

  if (feedback) {
    lines.push("", `<b>Обратная связь:</b> ${"⭐".repeat(feedback.rating)} (${feedback.rating}/5)`);
    if (feedback.comment) lines.push(`💬 ${escapeHtml(feedback.comment)}`);
  }

  const kb = new InlineKeyboard()
    .text("🟢 Активные", "admin:active")
    .text("📋 Последние", "admin:recent").row()
    .text("⬅️ Меню", "admin:menu");

  const text = lines.join("\n");
  if (text.length > 4000) {
    await ctx.reply(text.slice(0, 4000) + "…", { parse_mode: "HTML", reply_markup: kb });
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  }
}
