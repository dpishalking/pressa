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

export function formatEvaluation(e: EvaluationResult): string {
  const emoji = scoreEmoji(e.totalScore);
  const resultLabel: Record<string, string> = {
    ready_to_order: "🎉 Клиент готов оформить заказ",
    interested: "✨ Клиент заинтересован",
    thinking: "🤔 Клиент думает",
    lost: "❌ Клиент ушёл",
    abandoned: "👻 Клиент перестал отвечать",
    incomplete: "⏸️ Диалог не завершён",
  };

  let text = `${emoji} <b>Результат тренировки: ${e.totalScore}/100</b>\n`;
  text += `${resultLabel[e.finalResult] ?? e.finalResult}\n\n`;

  // Category scores
  text += `<b>📊 Оценка по категориям:</b>\n`;
  const categories = [
    ["qualification", "Квалификация", 20],
    ["recommendation", "Рекомендация", 20],
    ["productClarity", "Продукт", 15],
    ["visual", "Визуал", 10],
    ["pricing", "Расчёт", 15],
    ["closing", "Закрытие", 10],
    ["objectionHandling", "Возражения", 10],
  ] as Array<[string, string, number]>;

  for (const [key, label, max] of categories) {
    const score = e.categoryScores[key] ?? 0;
    const pct = Math.round((score / max) * 100);
    const bar = pct >= 80 ? "🟩" : pct >= 50 ? "🟨" : "🟥";
    text += `${bar} ${label}: ${score}/${max}\n`;
  }
  text += "\n";

  if (e.strengths.length > 0) {
    text += `<b>💪 Сильные стороны:</b>\n`;
    for (const s of e.strengths.slice(0, 3)) {
      text += `✅ ${s}\n`;
    }
    text += "\n";
  }

  if (e.mistakes.length > 0) {
    text += `<b>⚠️ Ключевые ошибки:</b>\n`;
    for (const m of e.mistakes.slice(0, 3)) {
      text += `❌ ${m}\n`;
    }
    text += "\n";
  }

  if (e.missedQuestions.length > 0) {
    text += `<b>❓ Пропущенные вопросы:</b>\n`;
    for (const q of e.missedQuestions.slice(0, 3)) {
      text += `• ${q}\n`;
    }
    text += "\n";
  }

  if (e.clientFeeling) {
    text += `<b>🧠 Клиент чувствовал:</b>\n${e.clientFeeling}\n\n`;
  }

  if (e.betterReplies.length > 0) {
    const br = e.betterReplies[0];
    text += `<b>💡 Лучший ответ вместо:</b>\n`;
    text += `<i>«${br.originalText.slice(0, 80)}»</i>\n`;
    text += `<b>→ Можно было:</b> ${br.suggestion}\n`;
    text += `<i>${br.reason}</i>\n\n`;
  }

  if (e.exampleNextMessage) {
    text += `<b>📝 Следующий шаг:</b>\n${e.exampleNextMessage}\n`;
  }

  return text;
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
