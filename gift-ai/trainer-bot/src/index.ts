import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import { getSession, setSession } from "./session.js";
import {
  mainMenuKeyboard,
  modeKeyboard,
  difficultyKeyboard,
  skillKeyboard,
  scenarioListKeyboard,
  templateScenarioKeyboard,
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

function parseStartPayload(text: string | undefined): string | null {
  if (!text) return null;
  const payload = text.split(/\s+/)[1]?.trim();
  if (!payload) return null;
  if (payload.startsWith("inv_")) return payload;
  if (payload.startsWith("inv-")) return payload.replace(/^inv-/, "inv_");
  return null;
}

async function ensureUser(
  ctx: { from?: { id?: number; first_name?: string; last_name?: string; username?: string } },
  inviteToken?: string,
): Promise<{ userId: string; user?: { full_name: string; team_name: string | null; service_tag: string | null } }> {
  const uid = userId(ctx);
  const session = getSession(uid);
  if (session.userId && !inviteToken) return { userId: session.userId };

  try {
    const result = await trainerApi.registerUser(Number(uid), fullName(ctx), username(ctx), inviteToken);
    setSession(uid, { userId: result.userId });
    return { userId: result.userId, user: result.user };
  } catch (e) {
    console.error("[ensureUser]", e);
    throw e;
  }
}

async function restoreActiveSession(uid: string, internalUserId: string, force = false): Promise<void> {
  const session = getSession(uid);
  if (!force && session.screen === "in_session" && session.currentSessionId) return;

  try {
    const active = await trainerApi.getActiveSession(internalUserId);
    if (!active.active) {
      if (session.screen === "in_session") {
        setSession(uid, { screen: "main_menu", currentSessionId: undefined });
      }
      return;
    }

    setSession(uid, {
      screen: "in_session",
      currentSessionId: active.sessionId,
      currentScenarioId: active.scenarioId,
      currentMode: active.mode,
    });
  } catch (e) {
    console.error("[restoreActiveSession]", e);
  }
}

async function finishTraining(ctx: Context, uid: string): Promise<void> {
  let internalId: string;
  try {
    ({ userId: internalId } = await ensureUser(ctx));
  } catch (e) {
    console.error("[finish ensureUser]", e);
    await ctx.reply("Не удалось подключиться к серверу. Попробуйте позже.");
    return;
  }

  await restoreActiveSession(uid, internalId, true);
  const session = getSession(uid);
  if (!session.currentSessionId) {
    await ctx.reply("Нет активной тренировки.", { reply_markup: mainMenuKeyboard() });
    return;
  }

  const sessionId = session.currentSessionId;
  await ctx.reply("⏳ Оцениваю вашу работу… Это займёт 10–20 секунд.");

  let evaluation;
  try {
    const result = await trainerApi.finishSession(sessionId);
    evaluation = result.evaluation;
  } catch (e) {
    console.error("[finish session api]", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/404|Session not found|500.*Session not found/i.test(msg)) {
      resetToMainMenuSession(uid);
      await ctx.reply(
        "Сессия устарела или уже завершена. Нажмите /train и начните сценарий заново.",
        { reply_markup: mainMenuKeyboard() },
      );
      return;
    }
    await ctx.reply("Не удалось завершить тренировку. Попробуйте ещё раз.");
    return;
  }

  setSession(uid, {
    screen: "awaiting_evaluation",
    pendingEvaluationSessionId: sessionId,
    currentSessionId: undefined,
  });

  const evalText = formatEvaluation(evaluation);
  try {
    await ctx.reply(evalText, {
      parse_mode: "HTML",
      reply_markup: postSessionKeyboard(),
    });
  } catch (e) {
    console.error("[finish session reply]", e);
    const plain = evalText.replace(/<[^>]+>/g, "");
    try {
      await ctx.reply(plain, { reply_markup: postSessionKeyboard() });
    } catch {
      await ctx.reply(
        `Результат: ${evaluation.totalScore ?? "?"}/100`,
        { reply_markup: postSessionKeyboard() },
      );
    }
  }
}

async function showTemplateScenarioMenu(ctx: Context): Promise<void> {
  await ctx.reply(
    `<b>Выберите сценарий:</b>\n\n` +
      `📅 <b>Клиент указал дату</b> — проверь архив и предложи формат\n` +
      `🎁 <b>Клиент ищет подарок</b> — выяви потребность и предложи вариант`,
    {
      parse_mode: "HTML",
      reply_markup: templateScenarioKeyboard(),
    },
  );
}

async function startTemplateTraining(ctx: Context, uid: string, template: string): Promise<void> {
  const { userId: internalId } = await ensureUser(ctx);
  await restoreActiveSession(uid, internalId);
  const active = getSession(uid);
  if (active.currentSessionId && active.screen === "in_session") {
    await ctx.reply(
      "Тренировка уже идёт. Напишите следующее сообщение или нажмите «Завершить».",
      { reply_markup: inSessionKeyboard(active.currentMode ?? "mode_a", active.hintMode ?? false) },
    );
    return;
  }

  await ctx.reply("⏳ Загружаю сценарий…");
  let generated;
  try {
    generated = await trainerApi.generateScenario(template);
  } catch (e) {
    console.error("[generateScenario]", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch failed|ECONNREFUSED|localhost|API 5/i.test(msg)) {
      await ctx.reply(
        "Сервер тренажёра недоступен. Администратору: проверьте API_URL на Railway (должен быть https://pressa-production-d394.up.railway.app).",
        { reply_markup: templateScenarioKeyboard() },
      );
      return;
    }
    throw e;
  }
  const mode: "mode_a" | "mode_b" = "mode_a";
  const result = await trainerApi.startSession(internalId, generated.scenarioId, mode);

  setSession(uid, {
    screen: "in_session",
    currentSessionId: result.sessionId,
    currentScenarioId: generated.scenarioId,
    currentMode: mode,
  });

  const scenario = result.scenario;
  let introText = `<b>🎭 Сценарий: ${escapeHtml(scenario.name)}</b>\n`;
  introText += `${difficultyLabel(scenario.difficulty)} · ${skillLabel(scenario.trainingSkill)}\n\n`;
  introText += `💼 Вы — менеджер. AI — клиент.\n\nКлиент НЕ раскрывает сразу всю информацию. Квалифицируйте через диалог.\n\nДля завершения: /finish или кнопка «Завершить».\n\n`;
  introText += `<b>═══ Начало диалога ═══</b>`;

  await ctx.reply(introText, { parse_mode: "HTML" });
  await showSessionDialogStart(ctx, mode, result, false);
}

const MAIN_MENU_TEXT =
  "🎓 <b>Тренажёр Retro Pressa</b>\n\nОтработай диалог с клиентом в ролевке.\n\nНажми «Начать ролевку» и выбери сценарий.";

function resetToMainMenuSession(uid: string): void {
  setSession(uid, {
    screen: "main_menu",
    currentSessionId: undefined,
    pendingEvaluationSessionId: undefined,
    pendingDifficulty: undefined,
    pendingSkill: undefined,
  });
}

async function showMainMenu(ctx: Context, uid: string): Promise<void> {
  resetToMainMenuSession(uid);

  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {
      // Старое сообщение — не критично
    }
  }

  await ctx.reply(MAIN_MENU_TEXT, {
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard(),
  });
}

async function showSessionDialogStart(
  ctx: { reply: (text: string, opts?: Record<string, unknown>) => Promise<{ message_id: number }> },
  mode: "mode_a" | "mode_b",
  result: { initialMessage: string; initialManagerReply?: string },
  hintMode = false,
): Promise<void> {
  if (mode === "mode_a") {
    await ctx.reply(
      `👤 <b>Клиент:</b>\n${escapeHtml(result.initialMessage)}`,
      { parse_mode: "HTML", reply_markup: inSessionKeyboard("mode_a", hintMode) },
    );
    return;
  }

  await ctx.reply(
    `👤 <b>Клиент написал:</b>\n<i>${escapeHtml(result.initialMessage)}</i>`,
    { parse_mode: "HTML" },
  );

  if (result.initialManagerReply) {
    await ctx.reply(
      `💼 <b>Менеджер (AI):</b>\n${escapeHtml(result.initialManagerReply)}\n\n✍️ Продолжайте диалог <b>от лица клиента</b>.`,
      { parse_mode: "HTML", reply_markup: inSessionKeyboard("mode_b") },
    );
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const uid = userId(ctx);
  const inviteToken = parseStartPayload(ctx.message?.text) ?? undefined;

  try {
    const { userId: internalUserId, user } = await ensureUser(ctx, inviteToken);

    if (inviteToken && user) {
      const serviceLabel = user.service_tag === "yourstorymagazine" ? "YourStory Magazine" : "Retro Pressa";
      const lines = [
        `👋 Привет, <b>${escapeHtml(user.full_name)}</b>!`,
        user.team_name ? `Вы в команде <b>${escapeHtml(user.team_name)}</b>.` : "",
        user.service_tag ? `Сервис: <b>${escapeHtml(serviceLabel)}</b>.` : "",
        "",
        "Можно начинать тренировки — выберите действие ниже.",
      ].filter(Boolean);

      await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    }

    await restoreActiveSession(uid, internalUserId);
    await showMainMenu(ctx, uid);
  } catch (e) {
    console.error("[start]", e);
    await ctx.reply("Не удалось подключиться к серверу. Попробуйте позже.");
  }
});

bot.command("train", async (ctx) => {
  const uid = userId(ctx);
  try {
    const { userId: internalId } = await ensureUser(ctx);
    await restoreActiveSession(uid, internalId);
    const restored = getSession(uid);
    if (restored.currentSessionId && restored.screen === "in_session") {
      await ctx.reply(
        "Тренировка уже идёт. Напишите следующее сообщение или нажмите «Завершить».",
        { reply_markup: inSessionKeyboard(restored.currentMode ?? "mode_a", restored.hintMode ?? false) },
      );
      return;
    }
    setSession(uid, { screen: "select_mode", currentSessionId: undefined, currentScenarioId: undefined });
    await showTemplateScenarioMenu(ctx);
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
    const { userId: internalId } = await ensureUser(ctx);
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
    const { userId: internalId } = await ensureUser(ctx);
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
  try {
    await finishTraining(ctx, uid);
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
    // Main menu — отвечаем сразу, чтобы Telegram не «зависал» на кнопке
    if (data === "menu:main") {
      await ctx.answerCallbackQuery({ text: "Главное меню" });
      await showMainMenu(ctx, uid);
      return;
    }

    await ctx.answerCallbackQuery().catch(() => {});

    if (data === "menu:train") {
      const session = getSession(uid);
      const { userId: internalId } = await ensureUser(ctx);
      await restoreActiveSession(uid, internalId);
      const restored = getSession(uid);
      if (restored.currentSessionId && restored.screen === "in_session") {
        await ctx.reply(
          "Тренировка уже идёт. Просто напишите следующее сообщение в чат или нажмите «Завершить диалог».",
          { reply_markup: inSessionKeyboard(restored.currentMode ?? "mode_a", restored.hintMode ?? false) },
        );
        return;
      }

      setSession(uid, { screen: "select_mode", currentSessionId: undefined, currentScenarioId: undefined });
      await showTemplateScenarioMenu(ctx);
      return;
    }

    if (data.startsWith("template:")) {
      const template = data.slice("template:".length);
      try {
        await startTemplateTraining(ctx, uid, template);
      } catch (e) {
        console.error("[template scenario]", template, e);
        await ctx.reply("Не удалось запустить сценарий. Попробуйте ещё раз.", {
          reply_markup: templateScenarioKeyboard(),
        });
      }
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
      const { userId: internalId } = await ensureUser(ctx);
      const progress = await trainerApi.getProgress(internalId);
      await ctx.reply(formatProgress(progress), {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🏠 Меню", "menu:main"),
      });
      return;
    }

    if (data === "menu:history") {
      const { userId: internalId } = await ensureUser(ctx);
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
        const { userId: internalId } = await ensureUser(ctx);
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
        const { userId: internalId } = await ensureUser(ctx);
        const mode = session.currentMode ?? "mode_a";

        await ctx.reply("⏳ Загружаю сценарий…");
        const result = await trainerApi.startSession(internalId, scenarioId, mode);

        setSession(uid, {
          screen: "in_session",
          currentSessionId: result.sessionId,
          currentScenarioId: scenarioId,
          currentMode: mode,
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
        await showSessionDialogStart(ctx, mode, result, session.hintMode ?? false);
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

      if (session.currentMode === "mode_b") {
        await ctx.answerCallbackQuery({ text: "Доступно только в режиме A" });
        return;
      }

      const actionMessages: Record<string, string> = {
        photo: "[Менеджер отправил фотографии продукта]",
        pricing: "[Менеджер отправил полный расчёт: товар + персонализация + доставка + итог + срок]",
        show_product: "[Менеджер показал описание товара с примерами]",
      };

      const actionText = actionMessages[action] ?? `[${action}]`;

      try {
        const result = await trainerApi.sendMessage(session.currentSessionId, actionText);
        if (!("clientReply" in result)) {
          await ctx.reply("Это действие доступно только в режиме A.");
          return;
        }

        await ctx.reply(
          `💼 <b>Вы:</b>\n<i>${escapeHtml(actionText)}</i>`,
          { parse_mode: "HTML" },
        );

        await ctx.reply(
          `👤 <b>Клиент</b> ${moodEmoji(result.moodLabel)}:\n${escapeHtml(result.clientReply)}`,
          { parse_mode: "HTML", reply_markup: inSessionKeyboard("mode_a", session.hintMode ?? false) },
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
      try {
        await finishTraining(ctx, uid);
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
        const { userId: internalId } = await ensureUser(ctx);
        const mode = session.currentMode ?? "mode_a";
        const result = await trainerApi.startSession(internalId, scenarioId, mode);
        setSession(uid, {
          screen: "in_session",
          currentSessionId: result.sessionId,
          currentScenarioId: scenarioId,
          currentMode: mode,
        });
        await ctx.reply(
          `🔁 Повторяем сценарий: <b>${escapeHtml(result.scenario.name)}</b>`,
          { parse_mode: "HTML" },
        );
        await showSessionDialogStart(ctx, mode, result, session.hintMode ?? false);
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
  let session = getSession(uid);

  try {
    const { userId: internalId } = await ensureUser(ctx);
    await restoreActiveSession(uid, internalId);
    session = getSession(uid);
  } catch {
    await ctx.reply("Не удалось подключиться к серверу. Запустите backend и попробуйте снова.");
    return;
  }

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
    const mode = session.currentMode ?? "mode_a";

    try {
      await ctx.api.sendChatAction(ctx.chat.id, "typing");
      const result = await trainerApi.sendMessage(session.currentSessionId, text);

      if (mode === "mode_b") {
        if (!("managerReply" in result)) {
          throw new Error("Unexpected API response for mode B");
        }

        await ctx.reply(
          `👤 <b>Вы (клиент):</b>\n${escapeHtml(text)}`,
          { parse_mode: "HTML" },
        );

        await ctx.reply(
          `💼 <b>Менеджер (AI):</b>\n${escapeHtml(result.managerReply)}`,
          {
            parse_mode: "HTML",
            reply_markup: inSessionKeyboard("mode_b"),
          },
        );
        return;
      }

      if (!("clientReply" in result)) {
        throw new Error("Unexpected API response for mode A");
      }

      await ctx.reply(
        `👤 <b>Клиент</b> ${moodEmoji(result.moodLabel)}:\n${escapeHtml(result.clientReply)}`,
        {
          parse_mode: "HTML",
          reply_markup: inSessionKeyboard("mode_a", session.hintMode ?? false),
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
      } else if (/500|fetch failed|ECONNREFUSED|API/i.test(msg)) {
        await ctx.reply("Сервер тренажёра недоступен. Проверьте, что backend запущен (npm run dev), и отправьте сообщение снова.");
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
