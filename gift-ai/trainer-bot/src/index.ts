import { Bot, GrammyError, InlineKeyboard } from "grammy";
import { getSession, setSession } from "./session.js";
import {
  mainMenuKeyboard,
  modeKeyboard,
  difficultyKeyboard,
  skillKeyboard,
  scenarioListKeyboard,
  inSessionKeyboard,
  postSessionKeyboard,
  quickExercisesKeyboard,
} from "./keyboards.js";
import { trainerApi } from "./api.js";
import {
  formatEvaluation,
  formatProgress,
  formatLeaderboard,
  difficultyLabel,
  skillLabel,
  scoreEmoji,
  moodEmoji,
  escapeHtml,
} from "./format.js";
import { QUICK_EXERCISES } from "./quick-exercises.js";

const BOT_TOKEN = process.env.TRAINER_BOT_TOKEN ?? process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("TRAINER_BOT_TOKEN is required");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function userId(ctx: { from?: { id?: number } }): string {
  return String(ctx.from?.id ?? "");
}

function fullName(ctx: { from?: { first_name?: string; last_name?: string } }): string {
  const f = ctx.from?.first_name ?? "";
  const l = ctx.from?.last_name ?? "";
  return `${f} ${l}`.trim() || "Пользователь";
}

function username(ctx: { from?: { username?: string } }): string {
  return ctx.from?.username ?? "";
}

async function ensureUser(ctx: { from?: { id?: number; first_name?: string; last_name?: string; username?: string } }): Promise<string> {
  const uid = userId(ctx);
  const session = getSession(uid);
  if (session.userId) return session.userId;

  try {
    const result = await trainerApi.registerUser(Number(uid), fullName(ctx), username(ctx));
    setSession(uid, { userId: result.userId });
    return result.userId;
  } catch (e) {
    console.error("[ensureUser]", e);
    throw e;
  }
}

async function showMainMenu(ctx: { reply: (text: string, opts?: Record<string, unknown>) => Promise<{ message_id: number }> }, uid: string): Promise<void> {
  setSession(uid, { screen: "main_menu" });
  await ctx.reply(
    "🎓 <b>Тренажёр менеджеров Retro Pressa</b>\n\nОтрабатывай навыки продаж на реальных сценариях.\n\nВыбери действие:",
    { parse_mode: "HTML", reply_markup: mainMenuKeyboard() },
  );
}

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const uid = userId(ctx);
  try {
    await ensureUser(ctx);
    await showMainMenu(ctx, uid);
  } catch (e) {
    console.error("[start]", e);
    await ctx.reply("Не удалось подключиться к серверу. Попробуйте позже.");
  }
});

bot.command("train", async (ctx) => {
  const uid = userId(ctx);
  try {
    await ensureUser(ctx);
    setSession(uid, { screen: "select_mode" });
    await ctx.reply(
      "🎭 <b>Начать ролевку</b>\n\nВыберите режим тренировки:",
      { parse_mode: "HTML", reply_markup: modeKeyboard() },
    );
  } catch (e) {
    console.error("[train]", e);
    await ctx.reply("Ошибка. Попробуйте /start");
  }
});

bot.command("quick", async (ctx) => {
  const uid = userId(ctx);
  try {
    await ensureUser(ctx);
    setSession(uid, { screen: "quick_exercise" });
    await ctx.reply(
      "⚡ <b>Быстрые тренировки</b>\n\nКороткие упражнения на 3–5 минут. Выбери навык:",
      { parse_mode: "HTML", reply_markup: quickExercisesKeyboard() },
    );
  } catch (e) {
    await ctx.reply("Ошибка. Попробуйте /start");
  }
});

bot.command("progress", async (ctx) => {
  const uid = userId(ctx);
  try {
    const internalId = await ensureUser(ctx);
    const progress = await trainerApi.getProgress(internalId);
    await ctx.reply(formatProgress(progress), {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🏠 Меню", "menu:main"),
    });
  } catch (e) {
    console.error("[progress]", e);
    await ctx.reply("Не удалось загрузить прогресс.");
  }
});

bot.command("history", async (ctx) => {
  const uid = userId(ctx);
  try {
    const internalId = await ensureUser(ctx);
    const data = await trainerApi.getHistory(internalId);
    const sessions = data.sessions;

    if (sessions.length === 0) {
      await ctx.reply("Тренировок пока нет. Начни первую!", { reply_markup: mainMenuKeyboard() });
      return;
    }

    let text = "<b>📜 История тренировок</b>\n\n";
    for (const s of sessions.slice(0, 10)) {
      const score = s.score ? `${scoreEmoji(Number(s.score))} ${s.score}/100` : "—";
      text += `• ${s.scenario_name} (${difficultyLabel(String(s.difficulty))})\n`;
      text += `  ${score} · ${new Date(String(s.started_at)).toLocaleDateString("ru-RU")}\n`;
    }

    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🏠 Меню", "menu:main"),
    });
  } catch (e) {
    console.error("[history]", e);
    await ctx.reply("Не удалось загрузить историю.");
  }
});

bot.command("rating", async (ctx) => {
  try {
    const data = await trainerApi.getLeaderboard();
    await ctx.reply(formatLeaderboard(data.leaderboard), {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🏠 Меню", "menu:main"),
    });
  } catch (e) {
    await ctx.reply("Не удалось загрузить рейтинг.");
  }
});

bot.command("finish", async (ctx) => {
  const uid = userId(ctx);
  const session = getSession(uid);
  if (!session.currentSessionId) {
    await ctx.reply("Нет активной тренировки.", { reply_markup: mainMenuKeyboard() });
    return;
  }
  try {
    await ctx.reply("⏳ Оцениваю вашу работу… Это займёт несколько секунд.");
    const result = await trainerApi.finishSession(session.currentSessionId);
    setSession(uid, { screen: "awaiting_evaluation", pendingEvaluationSessionId: session.currentSessionId, currentSessionId: undefined });
    await ctx.reply(formatEvaluation(result.evaluation), {
      parse_mode: "HTML",
      reply_markup: postSessionKeyboard(),
    });
  } catch (e) {
    console.error("[finish]", e);
    await ctx.reply("Не удалось завершить тренировку.");
  }
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `<b>🎓 Тренажёр Retro Pressa</b>

Команды:
/train — начать ролевую тренировку
/quick — быстрые упражнения (3–5 мин)
/progress — ваш прогресс и навыки
/history — история тренировок
/rating — рейтинг команды
/finish — завершить текущую тренировку
/help — эта справка

<b>Режимы тренировки:</b>
<b>Режим A</b> — вы играете менеджера, AI — клиента. Клиент не раскрывает всю информацию сразу.
<b>Режим B</b> — AI показывает эталонную продажу, вы играете клиента. После оцените, что сработало.`,
    { parse_mode: "HTML", reply_markup: mainMenuKeyboard() },
  );
});

// ─── Callback Queries ─────────────────────────────────────────────────────────

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const uid = userId(ctx);

  try {
    await ctx.answerCallbackQuery().catch(() => {});

    // Main menu navigation
    if (data === "menu:main") {
      await showMainMenu(ctx, uid);
      return;
    }

    if (data === "menu:train") {
      setSession(uid, { screen: "select_mode" });
      await ctx.reply(
        "🎭 <b>Начать ролевку</b>\n\nВыберите режим:",
        { parse_mode: "HTML", reply_markup: modeKeyboard() },
      );
      return;
    }

    if (data === "menu:quick") {
      setSession(uid, { screen: "quick_exercise" });
      await ctx.reply(
        "⚡ <b>Быстрые тренировки</b>\n\nВыберите навык для отработки:",
        { parse_mode: "HTML", reply_markup: quickExercisesKeyboard() },
      );
      return;
    }

    if (data === "menu:progress") {
      const internalId = await ensureUser(ctx);
      const progress = await trainerApi.getProgress(internalId);
      await ctx.reply(formatProgress(progress), {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🏠 Меню", "menu:main"),
      });
      return;
    }

    if (data === "menu:history") {
      const internalId = await ensureUser(ctx);
      const historyData = await trainerApi.getHistory(internalId);
      const sessions = historyData.sessions;

      if (sessions.length === 0) {
        await ctx.reply("Тренировок пока нет. Начни первую!", { reply_markup: mainMenuKeyboard() });
        return;
      }

      let text = "<b>📜 История тренировок</b>\n\n";
      for (const s of sessions.slice(0, 10)) {
        const score = s.score ? `${scoreEmoji(Number(s.score))} ${s.score}/100` : "—";
        text += `• ${s.scenario_name} (${difficultyLabel(String(s.difficulty))})\n`;
        text += `  ${score} · ${new Date(String(s.started_at)).toLocaleDateString("ru-RU")}\n`;
      }

      await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🏠 Меню", "menu:main"),
      });
      return;
    }

    if (data === "menu:leaderboard") {
      const leaderboardData = await trainerApi.getLeaderboard();
      await ctx.reply(formatLeaderboard(leaderboardData.leaderboard), {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🏠 Меню", "menu:main"),
      });
      return;
    }

    if (data === "menu:help") {
      await ctx.reply(
        "<b>📖 Помощь</b>\n\n/train — ролевка\n/quick — быстрые упражнения\n/progress — прогресс\n/finish — завершить тренировку",
        { parse_mode: "HTML", reply_markup: mainMenuKeyboard() },
      );
      return;
    }

    // Mode selection
    if (data.startsWith("mode:")) {
      const mode = data.slice("mode:".length) as "mode_a" | "mode_b";
      setSession(uid, { currentMode: mode, screen: "select_difficulty" });

      const modeLabel = mode === "mode_a"
        ? "💼 Режим A: вы — менеджер, AI — клиент"
        : "👤 Режим B: AI — менеджер, вы — клиент";

      await ctx.reply(
        `${modeLabel}\n\n<b>Выберите уровень сложности:</b>`,
        { parse_mode: "HTML", reply_markup: difficultyKeyboard() },
      );
      return;
    }

    // Difficulty selection
    if (data.startsWith("diff:")) {
      const diff = data.slice("diff:".length);
      const session = getSession(uid);
      setSession(uid, { pendingDifficulty: diff === "random" ? undefined : diff, screen: "select_skill" });

      await ctx.reply(
        `${difficultyLabel(diff === "random" ? "random" : diff)}\n\n<b>Выберите навык для отработки:</b>`,
        { parse_mode: "HTML", reply_markup: skillKeyboard() },
      );
      return;
    }

    // Skill selection → load scenarios
    if (data.startsWith("skill:")) {
      const skill = data.slice("skill:".length);
      const session = getSession(uid);

      try {
        const internalId = await ensureUser(ctx);
        const scenariosData = await trainerApi.getScenarios(
          skill === "random" ? undefined : session.pendingDifficulty,
          skill === "random" ? undefined : skill,
        );

        if (scenariosData.scenarios.length === 0) {
          await ctx.reply("Сценариев для выбранных параметров не найдено. Попробуйте другой уровень или навык.", {
            reply_markup: difficultyKeyboard(),
          });
          return;
        }

        setSession(uid, { pendingSkill: skill === "random" ? undefined : skill });
        await ctx.reply(
          `<b>Выберите сценарий:</b>`,
          {
            parse_mode: "HTML",
            reply_markup: scenarioListKeyboard(scenariosData.scenarios),
          },
        );
      } catch (e) {
        console.error("[skill selection]", e);
        await ctx.reply("Не удалось загрузить сценарии. Попробуйте ещё раз.");
      }
      return;
    }

    // Scenario selection → start session
    if (data.startsWith("scenario:")) {
      const scenarioId = data.slice("scenario:".length);
      const session = getSession(uid);

      try {
        const internalId = await ensureUser(ctx);
        const mode = session.currentMode ?? "mode_a";

        await ctx.reply("⏳ Загружаю сценарий…");
        const result = await trainerApi.startSession(internalId, scenarioId, mode);

        setSession(uid, {
          screen: "in_session",
          currentSessionId: result.sessionId,
          currentScenarioId: scenarioId,
        });

        const scenario = result.scenario;
        const modeDesc = mode === "mode_a"
          ? "💼 Вы — менеджер. AI — клиент.\n\nKлиент НЕ раскрывает сразу всю информацию. Квалифицируйте через диалог.\n\nДля завершения: /finish или кнопка «Завершить»."
          : "👤 Вы — клиент. AI — менеджер.\n\nПосмотрите, как работает сильный менеджер.\n\nДля завершения: /finish";

        let introText = `<b>🎭 Сценарий: ${escapeHtml(scenario.name)}</b>\n`;
        introText += `${difficultyLabel(scenario.difficulty)} · ${skillLabel(scenario.trainingSkill)}\n\n`;
        introText += `${modeDesc}\n\n`;
        introText += `<b>═══ Начало диалога ═══</b>`;

        await ctx.reply(introText, { parse_mode: "HTML" });

        // Send first client message
        await ctx.reply(
          `👤 <b>Клиент:</b>\n${escapeHtml(result.initialMessage)}`,
          { parse_mode: "HTML", reply_markup: inSessionKeyboard(result.scenario.mode === "mode_a") },
        );
      } catch (e) {
        console.error("[start scenario]", e);
        await ctx.reply("Не удалось запустить сценарий. Попробуйте ещё раз.", { reply_markup: mainMenuKeyboard() });
      }
      return;
    }

    // In-session actions (simulated actions)
    if (data.startsWith("session:action:")) {
      const action = data.slice("session:action:".length);
      const session = getSession(uid);
      if (!session.currentSessionId) return;

      const actionMessages: Record<string, string> = {
        photo: "[Менеджер отправил фотографии продукта]",
        pricing: "[Менеджер отправил полный расчёт: товар + персонализация + доставка + итог + срок]",
        show_product: "[Менеджер показал описание товара с примерами]",
      };

      const actionText = actionMessages[action] ?? `[${action}]`;

      try {
        const result = await trainerApi.sendMessage(session.currentSessionId, actionText);

        const stateText = result.stateChanges.length > 0
          ? `\n<i>📊 ${result.stateChanges.map((c) => `${c.field} ${c.delta > 0 ? "+" : ""}${c.delta}`).join(", ")}</i>`
          : "";

        await ctx.reply(
          `💼 <b>Вы:</b>\n<i>${escapeHtml(actionText)}</i>${stateText}`,
          { parse_mode: "HTML" },
        );

        await ctx.reply(
          `👤 <b>Клиент</b> ${moodEmoji(result.moodLabel)}:\n${escapeHtml(result.clientReply)}`,
          { parse_mode: "HTML", reply_markup: inSessionKeyboard(true) },
        );

        if (result.isPurchaseReady) {
          await ctx.reply("🎉 <b>Клиент готов оформить заказ!</b>\n\nОтличная работа! Нажмите «Завершить» чтобы получить разбор.", {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard().text("🏁 Завершить и получить разбор", "session:finish"),
          });
        } else if (result.isLost) {
          await ctx.reply("❌ <b>Клиент ушёл.</b>\n\nНажмите «Завершить» чтобы посмотреть, что пошло не так.", {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard().text("🏁 Завершить и получить разбор", "session:finish"),
          });
        }
      } catch (e) {
        console.error("[session action]", e);
        await ctx.reply("Не удалось обработать действие.");
      }
      return;
    }

    if (data === "session:hint") {
      // Hint is sent along with message processing if hintMode is on
      await ctx.answerCallbackQuery({ text: "Подсказка придёт вместе со следующим ответом клиента" });
      return;
    }

    if (data === "session:finish") {
      const session = getSession(uid);
      if (!session.currentSessionId) {
        await ctx.reply("Нет активной тренировки.", { reply_markup: mainMenuKeyboard() });
        return;
      }
      try {
        await ctx.reply("⏳ Оцениваю вашу работу… Это займёт 10–20 секунд.");
        const result = await trainerApi.finishSession(session.currentSessionId);
        setSession(uid, {
          screen: "awaiting_evaluation",
          pendingEvaluationSessionId: session.currentSessionId,
          currentSessionId: undefined,
        });
        await ctx.reply(formatEvaluation(result.evaluation), {
          parse_mode: "HTML",
          reply_markup: postSessionKeyboard(),
        });
      } catch (e) {
        console.error("[finish session]", e);
        await ctx.reply("Не удалось завершить тренировку. Попробуйте ещё раз.");
      }
      return;
    }

    if (data === "session:repeat") {
      const session = getSession(uid);
      const scenarioId = session.currentScenarioId;
      if (!scenarioId) {
        await showMainMenu(ctx, uid);
        return;
      }
      // Re-trigger scenario start
      await ctx.reply("Перезапускаю сценарий…");
      try {
        const internalId = await ensureUser(ctx);
        const mode = session.currentMode ?? "mode_a";
        const result = await trainerApi.startSession(internalId, scenarioId, mode);
        setSession(uid, {
          screen: "in_session",
          currentSessionId: result.sessionId,
          currentScenarioId: scenarioId,
        });
        await ctx.reply(
          `🔁 Повторяем сценарий: <b>${escapeHtml(result.scenario.name)}</b>`,
          { parse_mode: "HTML" },
        );
        await ctx.reply(
          `👤 <b>Клиент:</b>\n${escapeHtml(result.initialMessage)}`,
          { parse_mode: "HTML", reply_markup: inSessionKeyboard(false) },
        );
      } catch (e) {
        await ctx.reply("Не удалось перезапустить.", { reply_markup: mainMenuKeyboard() });
      }
      return;
    }

    if (data === "session:next") {
      setSession(uid, { screen: "select_difficulty" });
      await ctx.reply(
        "Выберите следующий уровень:",
        { reply_markup: difficultyKeyboard() },
      );
      return;
    }

    // Quick exercises
    if (data.startsWith("quick:")) {
      const exerciseId = data.slice("quick:".length);
      const exercise = QUICK_EXERCISES[exerciseId];
      if (!exercise) {
        await ctx.reply("Упражнение не найдено.", { reply_markup: mainMenuKeyboard() });
        return;
      }

      setSession(uid, { screen: "quick_exercise", currentScenarioId: `quick:${exerciseId}` });

      await ctx.reply(
        `⚡ <b>${escapeHtml(exercise.name)}</b>\n\n${escapeHtml(exercise.description)}\n\n<b>Задание:</b>\n${escapeHtml(exercise.prompt)}\n\n✍️ Напишите ваш ответ:`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("⬅️ Назад", "menu:quick"),
        },
      );
      return;
    }
  } catch (e) {
    console.error("[callback]", data, e);
    await ctx.reply("Что-то пошло не так. Попробуйте /start").catch(() => {});
  }
});

// ─── Text Messages ────────────────────────────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  const uid = userId(ctx);
  const session = getSession(uid);

  // Quick exercise mode
  if (session.screen === "quick_exercise" && session.currentScenarioId?.startsWith("quick:")) {
    const exerciseId = session.currentScenarioId.slice("quick:".length);
    const exercise = QUICK_EXERCISES[exerciseId];

    await ctx.reply(
      `✅ <b>Ваш ответ получен!</b>\n\n<b>💡 Совет:</b>\n${escapeHtml(exercise?.successTip ?? "Хорошая попытка! Продолжайте практиковаться.")}`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🔁 Повторить", `quick:${exerciseId}`)
          .text("📋 Все упражнения", "menu:quick").row()
          .text("🏠 Меню", "menu:main"),
      },
    );
    return;
  }

  // In active training session
  if (session.screen === "in_session" && session.currentSessionId) {
    try {
      await ctx.api.sendChatAction(ctx.chat.id, "typing");
      const result = await trainerApi.sendMessage(session.currentSessionId, text);

      // Show state changes if significant
      const significantChanges = result.stateChanges.filter((c) => Math.abs(c.delta) >= 5);
      let stateText = "";
      if (significantChanges.length > 0) {
        stateText = `\n<i>📊 ${significantChanges.map((c) => `${c.field} ${c.delta > 0 ? "+" : ""}${c.delta}`).join(", ")}</i>`;
      }

      await ctx.reply(
        `👤 <b>Клиент</b> ${moodEmoji(result.moodLabel)}:\n${escapeHtml(result.clientReply)}${stateText}`,
        {
          parse_mode: "HTML",
          reply_markup: inSessionKeyboard(session.hintMode ?? false),
        },
      );

      // Show hint if provided
      if (result.hint) {
        const h = result.hint;
        let hintText = `💡 <b>Подсказка</b>\n`;
        hintText += `Этап: <i>${escapeHtml(h.currentStage)}</i>\n`;
        if (h.unknownFacts.length > 0) {
          hintText += `\nЕщё не выяснено:\n`;
          for (const f of h.unknownFacts.slice(0, 3)) {
            hintText += `• <i>${escapeHtml(f)}</i>\n`;
          }
        }
        hintText += `\n➡️ <b>${escapeHtml(h.suggestion)}</b>`;
        await ctx.reply(hintText, { parse_mode: "HTML" });
      }

      if (result.isPurchaseReady) {
        await ctx.reply("🎉 <b>Клиент готов оформить заказ!</b>\n\nОтличная работа! Нажмите «Завершить» для разбора.", {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("🏁 Завершить и получить разбор", "session:finish"),
        });
      } else if (result.isLost) {
        await ctx.reply("❌ <b>Клиент ушёл.</b>\n\nНажмите «Завершить» чтобы разобрать диалог.", {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("🏁 Завершить и получить разбор", "session:finish"),
        });
      }
    } catch (e) {
      console.error("[in session message]", e);
      const msg = e instanceof Error ? e.message : "";
      if (/timeout|503|429/i.test(msg)) {
        await ctx.reply("AI временно перегружен. Подождите 10 секунд и отправьте сообщение ещё раз.");
      } else {
        await ctx.reply("Не удалось обработать сообщение. Попробуйте ещё раз.");
      }
    }
    return;
  }

  // Not in session — show menu
  await showMainMenu(ctx, uid);
});

// ─── Error handler ────────────────────────────────────────────────────────────

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError && e.error_code === 409) {
    console.error("⚠️ 409 Conflict: два процесса с одним TRAINER_BOT_TOKEN");
    return;
  }
  console.error("Bot error:", err);
});

// ─── Start ────────────────────────────────────────────────────────────────────

await bot.api.deleteWebhook().catch(() => {});

bot.start({
  onStart: async (botInfo) => {
    console.log(`✅ @${botInfo.username} — Retro Pressa Trainer Bot`);
    try {
      await bot.api.setMyCommands([
        { command: "start", description: "Главное меню" },
        { command: "train", description: "Начать ролевую тренировку" },
        { command: "quick", description: "Быстрые упражнения (3–5 мин)" },
        { command: "progress", description: "Мой прогресс" },
        { command: "history", description: "История тренировок" },
        { command: "rating", description: "Рейтинг команды" },
        { command: "finish", description: "Завершить текущую тренировку" },
        { command: "help", description: "Помощь" },
      ]);
      console.log("✅ Bot commands set");
    } catch (e) {
      console.warn("⚠️ Could not set bot commands:", e);
    }
  },
});
