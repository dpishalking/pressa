import { config } from "../config.js";
import { getDb } from "../db/client.js";
import { logger } from "../logger.js";
import type { EvaluationResult } from "./types.js";
import { getScenarioFromDb } from "./scenario-loader.js";

async function sendTrainerTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const token = config.TRAINER_NOTIFY_BOT_TOKEN;
  if (!token) {
    logger.warn("Trainer notify skipped: TRAINER_NOTIFY_BOT_TOKEN not set");
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) {
      throw new Error(json.description ?? `HTTP ${res.status}`);
    }
    return true;
  } catch (error) {
    logger.error("Trainer notify failed", {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function serviceLabel(tag: string): string {
  const map: Record<string, string> = {
    "retro-pressa": "Retro Pressa",
    "yourstorymagazine": "YourStory Magazine",
  };
  return map[tag] ?? tag;
}

function formatManagerSummary(opts: {
  employeeName: string;
  serviceTag: string | null;
  teamName: string | null;
  scenarioName: string;
  score: number;
  evaluation: EvaluationResult;
}): string {
  const mistakes = opts.evaluation.mistakes.slice(0, 3);
  const strengths = opts.evaluation.strengths.slice(0, 2);
  const lines = [
    "🎓 <b>Результат тренировки</b>",
    "",
    `👤 ${opts.employeeName}`,
    opts.teamName ? `👥 Команда: ${opts.teamName}` : "",
    opts.serviceTag ? `🏷 Сервис: ${serviceLabel(opts.serviceTag)}` : "",
    `📋 Сценарий: ${opts.scenarioName}`,
    `📊 Оценка: <b>${opts.evaluation.totalScore}/100</b>`,
  ].filter(Boolean);

  if (strengths.length) {
    lines.push("", "✅ Сильные стороны:");
    for (const s of strengths) lines.push(`• ${s}`);
  }
  if (mistakes.length) {
    lines.push("", "⚠️ Ошибки:");
    for (const m of mistakes) lines.push(`• ${m}`);
  }

  return lines.join("\n");
}

export async function notifyTrainingSessionComplete(sessionId: string, evaluation: EvaluationResult): Promise<void> {
  const db = getDb();
  const session = db.prepare(`
    SELECT s.user_id, s.scenario_id, u.full_name, u.team_id, u.service_tag, u.telegram_id
    FROM training_sessions s
    JOIN training_users u ON u.id = s.user_id
    WHERE s.id = ?
  `).get(sessionId) as {
    user_id: string;
    scenario_id: string;
    full_name: string;
    team_id: string | null;
    service_tag: string | null;
    telegram_id: string;
  } | undefined;

  if (!session) return;

  const scenario = getScenarioFromDb(session.scenario_id);
  let teamName: string | null = null;
  let managerTelegramId: string | null = null;

  if (session.team_id) {
    const team = db.prepare("SELECT name, manager_telegram_id FROM training_teams WHERE id = ?")
      .get(session.team_id) as { name: string; manager_telegram_id: string | null } | undefined;
    teamName = team?.name ?? null;
    managerTelegramId = team?.manager_telegram_id ?? null;
  }

  const text = formatManagerSummary({
    employeeName: session.full_name,
    serviceTag: session.service_tag,
    teamName,
    scenarioName: scenario?.name ?? session.scenario_id,
    score: evaluation.totalScore,
    evaluation,
  });

  const recipients = new Set<string>();
  if (managerTelegramId) recipients.add(managerTelegramId);
  for (const chatId of config.TRAINER_NOTIFY_TELEGRAM_IDS) {
    recipients.add(chatId);
  }
  // Не дублируем отчёт менеджеру в его же чат с ботом — у него уже есть разбор в диалоге
  if (session.telegram_id) {
    recipients.delete(session.telegram_id);
  }

  if (!recipients.size) {
    logger.debug("Trainer notify skipped: no recipients configured", { sessionId });
    return;
  }

  for (const chatId of recipients) {
    await sendTrainerTelegramMessage(chatId, text);
  }
}
