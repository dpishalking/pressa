import { InlineKeyboard } from "grammy";

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎭 Начать ролевку", "menu:train").row()
    .text("⚡ Быстрая тренировка", "menu:quick").row()
    .text("📊 Мой прогресс", "menu:progress")
    .text("📜 История", "menu:history").row()
    .text("🏆 Рейтинг команды", "menu:leaderboard").row()
    .text("❓ Помощь", "menu:help");
}

export function modeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💼 Режим A: Я — менеджер", "mode:mode_a").row()
    .text("👤 Режим B: AI — менеджер", "mode:mode_b").row()
    .text("⬅️ Назад", "menu:main");
}

export function difficultyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🟢 Базовый", "diff:basic")
    .text("🟡 Средний", "diff:medium").row()
    .text("🔴 Сложный", "diff:hard")
    .text("⚫ Эксперт", "diff:expert").row()
    .text("🎲 Случайный", "diff:random").row()
    .text("⬅️ Назад", "menu:train");
}

export function skillKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔍 Квалификация", "skill:qualification").row()
    .text("💎 Рекомендация", "skill:recommendation").row()
    .text("📦 Продукт", "skill:productClarity").row()
    .text("📸 Визуал", "skill:visualSelling").row()
    .text("💰 Расчёт", "skill:pricing").row()
    .text("🤝 Закрытие", "skill:closing").row()
    .text("💬 Возражения", "skill:objectionHandling").row()
    .text("🎲 Случайный навык", "skill:random").row()
    .text("⬅️ Назад", "menu:train");
}

export function scenarioListKeyboard(
  scenarios: Array<{ id: string; name: string; difficulty: string }>,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const diffEmoji: Record<string, string> = {
    basic: "🟢",
    medium: "🟡",
    hard: "🔴",
    expert: "⚫",
  };
  for (const s of scenarios.slice(0, 8)) {
    const emoji = diffEmoji[s.difficulty] ?? "⚪";
    kb.text(`${emoji} ${s.name}`, `scenario:${s.id}`).row();
  }
  kb.text("⬅️ Назад", "menu:train");
  return kb;
}

export function inSessionKeyboard(hintMode: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (hintMode) {
    kb.text("💡 Подсказка", "session:hint").row();
  }
  return kb
    .text("📸 [Отправить фото]", "session:action:photo")
    .text("💰 [Расчёт]", "session:action:pricing").row()
    .text("🏷️ [Показать товар]", "session:action:show_product").row()
    .text("🏁 Завершить диалог", "session:finish");
}

export function postSessionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔁 Повторить сценарий", "session:repeat").row()
    .text("➡️ Следующий сценарий", "session:next").row()
    .text("🏠 Главное меню", "menu:main");
}

export function quickExercisesKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔍 Выяснить получателя", "quick:recipient").row()
    .text("💎 Персональная рекомендация", "quick:recommendation").row()
    .text("📦 Объяснить оригинал/репродукцию", "quick:product_clarity").row()
    .text("💬 Обработать «дорого»", "quick:expensive").row()
    .text("💬 Обработать «я подумаю»", "quick:need_to_think").row()
    .text("👻 Вернуть молчащего клиента", "quick:follow_up").row()
    .text("💰 Назвать полный расчёт", "quick:full_pricing").row()
    .text("🤝 Закрыть на оформление", "quick:closing").row()
    .text("⬅️ Назад", "menu:main");
}
