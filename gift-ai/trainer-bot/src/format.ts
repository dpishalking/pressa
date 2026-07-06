import type { EvaluationResult } from "./api.js";

export function scoreEmoji(score: number): string {
  if (score >= 85) return "🌟";
  if (score >= 70) return "✅";
  if (score >= 55) return "📈";
  return "⚠️";
}

export function difficultyLabel(d: string): string {
  const map: Record<string, string> = {
    basic: "🟢 Базовый",
    medium: "🟡 Средний",
    hard: "🔴 Сложный",
    expert: "⚫ Эксперт",
  };
  return map[d] ?? d;
}

export function skillLabel(s: string): string {
  const map: Record<string, string> = {
    qualification: "Квалификация",
    recommendation: "Рекомендация",
    productClarity: "Продукт",
    visualSelling: "Визуал",
    pricing: "Расчёт",
    closing: "Закрытие",
    objectionHandling: "Возражения",
    empathy: "Эмпатия",
    dialogueControl: "Ведение диалога",
    followUp: "Follow-up",
  };
  return map[s] ?? s;
}

export function moodEmoji(mood: string): string {
  const map: Record<string, string> = {
    "очень раздражён": "😤",
    "раздражён": "😒",
    "готов купить": "🤩",
    "заинтересован": "😊",
    "перегружен вариантами": "😵",
    "осторожен": "🤔",
    "нейтрален": "😐",
  };
  return map[mood] ?? "😐";
}

function normalizeEvaluation(raw: EvaluationResult): EvaluationResult {
  const mistakes = (Array.isArray(raw.mistakes) ? raw.mistakes : []).filter(
    (m) => !/технический сбой|не удалось получить оценку/i.test(m),
  );
  const e: EvaluationResult = {
    totalScore: Number.isFinite(raw.totalScore) ? raw.totalScore : 0,
    categoryScores: raw.categoryScores ?? {},
    strengths: Array.isArray(raw.strengths) ? raw.strengths : [],
    mistakes,
    missedQuestions: Array.isArray(raw.missedQuestions) ? raw.missedQuestions : [],
    clientEmotions: Array.isArray(raw.clientEmotions) ? raw.clientEmotions : [],
    turningPoints: Array.isArray(raw.turningPoints) ? raw.turningPoints : [],
    stateChanges: Array.isArray(raw.stateChanges) ? raw.stateChanges : [],
    betterReplies: Array.isArray(raw.betterReplies) ? raw.betterReplies : [],
    finalResult: raw.finalResult ?? "incomplete",
    clientFeeling: raw.clientFeeling,
    exampleNextMessage: raw.exampleNextMessage,
  };

  if (
    mistakes.length === 0 &&
    e.strengths.length === 0 &&
    e.totalScore <= 55 &&
    e.finalResult === "incomplete"
  ) {
    e.mistakes = ["Не удалось получить развёрнутую оценку — попробуйте завершить снова"];
  }

  return e;
}

export function formatEvaluation(raw: EvaluationResult): string {
  const e = normalizeEvaluation(raw);
  const emoji = scoreEmoji(e.totalScore);
  const resultLabel: Record<string, string> = {
    ready_to_order: "клиент готов оформить заказ",
    interested: "клиент заинтересован",
    thinking: "клиент думает",
    lost: "клиент ушёл",
    abandoned: "клиент перестал отвечать",
    incomplete: "диалог не завершён",
  };

  const lines: string[] = [
    `${emoji} <b>${e.totalScore}/100</b> — ${resultLabel[e.finalResult] ?? e.finalResult}`,
  ];

  for (const s of e.strengths.slice(0, 2)) {
    lines.push(`✅ ${escapeHtml(truncateAtWord(s, 140))}`);
  }

  for (const m of e.mistakes.slice(0, 2)) {
    lines.push(`⚠️ ${escapeHtml(truncateAtWord(m, 140))}`);
  }

  return lines.join("\n");
}

/** Full suggestion text — send as a separate message so it is never cut off mid-word. */
export function formatEvaluationTip(raw: EvaluationResult): string | null {
  const e = normalizeEvaluation(raw);
  const tip =
    e.betterReplies[0]?.suggestion?.trim() ||
    e.exampleNextMessage?.trim() ||
    e.missedQuestions[0]?.trim();
  if (!tip) return null;
  return `💡 ${escapeHtml(tip)}`;
}

function truncateAtWord(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut}…`;
}

export function formatProgress(p: {
  totalSessions: number;
  averageScore: number;
  bestScore: number;
  skillScores: Record<string, { score: number; attempts: number }>;
  weakSkills: string[];
  successRate: number;
  streakDays: number;
}): string {
  let text = `<b>📊 Ваш прогресс</b>\n\n`;
  text += `🎯 Тренировок: <b>${p.totalSessions}</b>\n`;
  text += `📈 Средний балл: <b>${p.averageScore}/100</b>\n`;
  text += `🏆 Лучший результат: <b>${p.bestScore}/100</b>\n`;
  text += `✅ Успешных продаж: <b>${p.successRate}%</b>\n`;
  if (p.streakDays > 0) {
    text += `🔥 Серия: <b>${p.streakDays} дн.</b>\n`;
  }
  text += "\n";

  const skills = Object.entries(p.skillScores);
  if (skills.length > 0) {
    text += `<b>💪 Навыки:</b>\n`;
    for (const [skill, data] of skills.sort(([, a], [, b]) => b.score - a.score)) {
      const bar = data.score >= 80 ? "🟩" : data.score >= 60 ? "🟨" : "🟥";
      text += `${bar} ${skillLabel(skill)}: ${Math.round(data.score)}/100 (${data.attempts} попыток)\n`;
    }
    text += "\n";
  }

  if (p.weakSkills.length > 0) {
    text += `<b>📚 Рекомендуемые тренировки:</b>\n`;
    for (const skill of p.weakSkills.slice(0, 3)) {
      text += `• ${skillLabel(skill)}\n`;
    }
  }

  return text;
}

export function formatLeaderboard(
  board: Array<{ userId: string; fullName: string; averageScore: number; totalSessions: number; bestScore: number }>,
): string {
  let text = `<b>🏆 Рейтинг команды</b>\n\n`;
  const medals = ["🥇", "🥈", "🥉"];

  for (let i = 0; i < board.length; i++) {
    const entry = board[i];
    const medal = medals[i] ?? `${i + 1}.`;
    text += `${medal} <b>${entry.fullName}</b>\n`;
    text += `   Ср. балл: ${entry.averageScore} | Тренировок: ${entry.totalSessions}\n`;
  }

  return text || "Рейтинг пока пуст. Проведите первую тренировку!";
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
