import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import { getSession, setSession } from "./session.js";
import {
  mainMenuKeyboard,
  templateScenarioKeyboard,
  inSessionKeyboard,
  postSessionKeyboard,
  feedbackRatingKeyboard,
  feedbackSkipCommentKeyboard,
  SESSION_BUTTONS_HELP,
} from "./keyboards.js";
import { trainerApi, verifyBackendConnection } from "./api.js";
import {
  adminConfigured,
  isTrainerAdmin,
  showAdminMenu,
  showAdminSummary,
  showActiveSessions,
  showRecentSessions,
  showSessionDetail,
} from "./admin.js";
import {
  formatEvaluation,
  difficultyLabel,
  skillLabel,
  moodEmoji,
  escapeHtml,
} from "./format.js";

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

function parseStartPayload(text: string | undefined): { inviteToken?: string; lmsExternalId?: string } | null {
  if (!text) return null;
  const payload = text.split(/\s+/)[1]?.trim();
  if (!payload) return null;
  if (payload.startsWith("link_")) {
    return { lmsExternalId: decodeURIComponent(payload.slice(5)) };
  }
  if (payload.startsWith("inv_")) return { inviteToken: payload };
  if (payload.startsWith("inv-")) return { inviteToken: payload.replace(/^inv-/, "inv_") };
  return null;
}

async function ensureUser(
  ctx: { from?: { id?: number; first_name?: string; last_name?: string; username?: string } },
  startPayload?: { inviteToken?: string; lmsExternalId?: string } | null,
): Promise<{ userId: string; user?: { full_name: string; team_name: string | null; service_tag: string | null; lms_external_id: string | null } }> {
  const uid = userId(ctx);
  const session = getSession(uid);
  const inviteToken = startPayload?.inviteToken;
  const lmsExternalId = startPayload?.lmsExternalId ?? session.lmsExternalId;
  if (startPayload?.lmsExternalId) {
    setSession(uid, { lmsExternalId: startPayload.lmsExternalId });
  }
  if (session.userId && !inviteToken && !lmsExternalId) return { userId: session.userId };

  try {
    const result = await trainerApi.registerUser(
      Number(uid),
      fullName(ctx),
      username(ctx),
      inviteToken,
      lmsExternalId,
    );
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
    try {
      const cached = await trainerApi.getEvaluation(sessionId);
      evaluation = cached.evaluation;
    } catch {
      await ctx.reply("Не удалось завершить тренировку. Попробуйте ещё раз.");
      return;
    }
  }

  setSession(uid, {
    screen: "awaiting_evaluation",
    pendingEvaluationSessionId: sessionId,
    currentSessionId: undefined,
  });

  const evalText = formatEvaluation(evaluation);
  try {
    await ctx.reply(evalText, { parse_mode: "HTML" });
  } catch (e) {
    console.error("[finish session reply]", e);
    const plain = evalText.replace(/<[^>]+>/g, "");
    try {
      await ctx.reply(plain);
    } catch {
      await ctx.reply(`Результат: ${evaluation.totalScore ?? "?"}/100`);
    }
  }

  await promptStudentFeedback(ctx, uid, sessionId);
}

async function promptStudentFeedback(ctx: Context, uid: string, sessionId: string): Promise<void> {
  setSession(uid, {
    screen: "awaiting_feedback",
    pendingFeedbackSessionId: sessionId,
    pendingFeedbackRating: undefined,
  });
  await ctx.reply(
    "💬 <b>Как прошла ролевка?</b>\n\nОцените от 1 до 5 — ваш отзыв увидит наставник.",
    { parse_mode: "HTML", reply_markup: feedbackRatingKeyboard(sessionId) },
  );
}

async function finishFeedbackFlow(ctx: Context, uid: string, thanksText = "Спасибо за отзыв!"): Promise<void> {
  setSession(uid, {
    screen: "awaiting_evaluation",
    pendingFeedbackSessionId: undefined,
    pendingFeedbackRating: undefined,
  });
  await ctx.reply(thanksText, { reply_markup: postSessionKeyboard() });
}

async function submitStudentFeedback(
  ctx: Context,
  uid: string,
  sessionId: string,
  rating: number,
  comment?: string,
): Promise<void> {
  const internalId = getSession(uid).userId ?? (await ensureUser(ctx)).userId;
  try {
    await trainerApi.submitFeedback(sessionId, internalId, rating, comment);
  } catch (e) {
    console.error("[submit feedback]", e);
  }
  await finishFeedbackFlow(ctx, uid);
}

async function showTemplateScenarioMenu(ctx: Context): Promise<void> {
  await ctx.reply(
    `<b>Выберите тип ситуации</b>\n\n` +
      `Каждый раз подбирается <b>новая тема</b> из базы сценариев (папа, мама, супруг, юбилей, возражения и др.).\n\n` +
      `🎲 <b>Случайная тема</b> — любой сценарий из 30+ вариантов.\n\n` +
      `📅 <b>Клиент указал дату</b> — знает дату рождения, но не понимает формат (газета, репродукция, журнал).\n\n` +
      `🎁 <b>Клиент ищет подарок</b> — общий запрос «нужен подарок», нужна квалификация и рекомендация.`,
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

  await ctx.reply("⏳ Подбираю новый сценарий…");
  const previousScenarioId = getSession(uid).lastScenarioId;
  let generated;
  try {
    generated = await trainerApi.generateScenario(template, previousScenarioId);
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
    lastScenarioId: generated.scenarioId,
    currentMode: mode,
  });

  const scenario = result.scenario;
  let introText = `<b>🎭 ${escapeHtml(scenario.name)}</b>\n`;
  introText += `${difficultyLabel(scenario.difficulty)} · ${skillLabel(scenario.trainingSkill)}\n\n`;
  if (scenario.description) {
    introText += `${escapeHtml(scenario.description)}\n\n`;
  }
  introText += `💼 Вы — менеджер. AI — клиент.\n\n`;
  introText += `<b>═══ Начало диалога ═══</b>`;

  await ctx.reply(introText, { parse_mode: "HTML" });
  await ctx.reply(SESSION_BUTTONS_HELP, {
    parse_mode: "HTML",
    reply_markup: inSessionKeyboard(mode, false),
  });
  await showSessionDialogStart(ctx, mode, result, false);
}

const MAIN_MENU_TEXT =
  "🎓 <b>Тренажёр Retro Pressa</b>\n\nОтработай диалог с клиентом в ролевке.\n\nНажми «Начать ролевку» и выбери сценарий.";

function resetToMainMenuSession(uid: string): void {
  setSession(uid, {
    screen: "main_menu",
    currentSessionId: undefined,
    pendingEvaluationSessionId: undefined,
    pendingFeedbackSessionId: undefined,
    pendingFeedbackRating: undefined,
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
  const startPayload = parseStartPayload(ctx.message?.text) ?? undefined;

  try {
    const { userId: internalUserId, user } = await ensureUser(ctx, startPayload);

    if (startPayload?.lmsExternalId && user) {
      const linkedId = user.lms_external_id ?? null;
      if (linkedId === startPayload.lmsExternalId) {
        await ctx.reply(
          "✅ Аккаунт привязан к кабинету Retro Pressa. Результаты ролевок будут видны вашему руководителю.",
        );
      } else {
        await ctx.reply(
          "⚠️ Не удалось привязать аккаунт к кабинету. Откройте бота ещё раз по персональной ссылке с этапа «Практика».",
        );
      }
    } else if (startPayload?.inviteToken && user) {
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
  const adminHint = isTrainerAdmin(ctx) ? "\n/admin — панель наставника" : "";
  await ctx.reply(
    `<b>🎓 Тренажёр Retro Pressa</b>

/train — начать ролевую тренировку
/finish — завершить текущий диалог
/start — главное меню${adminHint}`,
    { parse_mode: "HTML", reply_markup: mainMenuKeyboard() },
  );
});

bot.command("admin", async (ctx) => {
  if (!isTrainerAdmin(ctx)) {
    await ctx.reply("Нет доступа.");
    return;
  }
  if (!adminConfigured()) {
    await ctx.reply("Админ-панель не настроена. Нужны ADMIN_API_KEY и ADMIN_TELEGRAM_IDS на Railway.");
    return;
  }
  setSession(userId(ctx), { screen: "admin_panel" });
  await showAdminMenu(ctx);
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

    const session = getSession(uid);

    if (data.startsWith("admin:")) {
      if (!isTrainerAdmin(ctx)) {
        await ctx.reply("Нет доступа.");
        return;
      }
      if (data === "admin:menu") {
        setSession(uid, { screen: "admin_panel" });
        await showAdminMenu(ctx);
        return;
      }
      if (data === "admin:summary") {
        await showAdminSummary(ctx);
        return;
      }
      if (data === "admin:active") {
        await showActiveSessions(ctx);
        return;
      }
      if (data === "admin:recent") {
        await showRecentSessions(ctx);
        return;
      }
      if (data.startsWith("admin:session:")) {
        await showSessionDetail(ctx, data.slice("admin:session:".length));
        return;
      }
    }

    if (data.startsWith("feedback:")) {
      const parts = data.split(":");
      const feedbackSessionId = parts[1];
      const action = parts[2];
      if (!feedbackSessionId) return;

      if (action === "skip") {
        await finishFeedbackFlow(ctx, uid, "Хорошо, продолжайте тренировки!");
        return;
      }
      if (action === "done" && session.pendingFeedbackRating) {
        await submitStudentFeedback(ctx, uid, feedbackSessionId, session.pendingFeedbackRating);
        return;
      }
      const rating = Number(action);
      if (rating >= 1 && rating <= 5) {
        setSession(uid, {
          screen: "awaiting_feedback_comment",
          pendingFeedbackSessionId: feedbackSessionId,
          pendingFeedbackRating: rating,
        });
        await ctx.reply(
          `Спасибо! ${"⭐".repeat(rating)}\n\nНапишите комментарий одним сообщением или нажмите кнопку ниже.`,
          { reply_markup: feedbackSkipCommentKeyboard(feedbackSessionId) },
        );
        return;
      }
    }

    if (data === "menu:train") {
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

    if (data === "session:help") {
      const session = getSession(uid);
      await ctx.reply(SESSION_BUTTONS_HELP, {
        parse_mode: "HTML",
        reply_markup: inSessionKeyboard(session.currentMode ?? "mode_a", session.hintMode ?? false),
      });
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

  if (session.screen === "awaiting_feedback_comment" && session.pendingFeedbackSessionId && session.pendingFeedbackRating) {
    await submitStudentFeedback(
      ctx,
      uid,
      session.pendingFeedbackSessionId,
      session.pendingFeedbackRating,
      text,
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
    await verifyBackendConnection();
    if (adminConfigured()) {
      console.log("[trainer-bot] ✓ Admin panel enabled");
    } else {
      console.warn("[trainer-bot] Admin panel disabled — set ADMIN_API_KEY + ADMIN_TELEGRAM_IDS");
    }
    try {
      await bot.api.setMyCommands([
        { command: "start", description: "Главное меню" },
        { command: "train", description: "Начать ролевую тренировку" },
        { command: "finish", description: "Завершить текущую тренировку" },
        { command: "help", description: "Помощь" },
      ]);
      console.log("✅ Bot commands set");
    } catch (e) {
      console.warn("⚠️ Could not set bot commands:", e);
    }
  },
});
