import { Bot, GrammyError, type Context } from "grammy";
import { configureBotProfile } from "./bot-profile.js";
import { giftLabel } from "./gift-emojis.js";
import { giftPhotoPath } from "./gift-photos.js";
import { smartFormatReply } from "./format.js";
import { t } from "./i18n.js";
import {
  catalogGiftKeyboard,
  catalogListKeyboard,
  languageKeyboard,
  mainMenuKeyboard,
  managerHandoffKeyboard,
} from "./keyboards.js";
import { languageTitle, normalizeLanguage, type BotLanguage } from "./languages.js";
import { resetMascotRotation, sceneForStage } from "./mascot.js";
import { replyWithMascot, replyWithPhotoFile } from "./reply-with-mascot.js";
import { clearBotScreen, rewindBotMessages, trackBotMessage, userIdFromCtx } from "./message-cleanup.js";
import { enqueueUserTask } from "./user-queue.js";
import { getSession, setSession } from "./session.js";
import { isTranscribeAvailable, mimeForTelegramAudio, transcribeTelegramFile } from "./transcribe.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = (process.env.API_URL ?? "http://localhost:3100").replace(/\/$/, "");

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

const STICKER_PACK_URL =
  process.env.STICKER_PACK_URL ?? "https://t.me/addstickers/retro_pressa_gifts_by_rpgifts_bot";

const bot = new Bot(BOT_TOKEN);

type RecommendedGift = { id: string; externalId: string; name: string } | null;

type CatalogItem = {
  id: string;
  externalId: string;
  name: string;
  description: string;
  priceLabel: string;
  emotions: string[];
};

type ChatResponse = {
  reply: string;
  stage: number;
  isComplete?: boolean;
  recommendedGift?: RecommendedGift;
  managerHandoff?: { url: string; buttonLabel: string; prompt: string; draftMessage: string };
  needsMenu?: boolean;
};

const shownGiftByUser = new Map<string, string>();

async function apiGet<T>(path: string, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function channelUserId(ctx: { from?: { id?: number }; chat?: { id?: number } }): string {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "");
}

function telegramUsername(ctx: { from?: { username?: string } }): string | undefined {
  return ctx.from?.username;
}

function apiIdentity(ctx: Context) {
  return {
    channel: "telegram",
    channelUserId: channelUserId(ctx),
    telegramUsername: telegramUsername(ctx),
  };
}

type ChatStatus = {
  inConsultation: boolean;
  stage: number;
  language: string;
};

/** Восстанавливает режим консультации после перезапуска бота (сессия в памяти сбрасывается). */
async function syncConsultScreen(ctx: Context): Promise<boolean> {
  const uid = channelUserId(ctx);
  const session = getSession(uid);
  if (session.screen === "consult") return true;

  const status = await apiGet<ChatStatus>(
    `/chat/status?channel=telegram&channelUserId=${encodeURIComponent(uid)}`,
  );
  if (!status.inConsultation) return false;

  setSession(uid, {
    screen: "consult",
    language: normalizeLanguage(status.language),
  });
  return true;
}

async function sendTrackedReply(
  ctx: Context,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
): Promise<void> {
  const msg = await ctx.reply(smartFormatReply(text), { parse_mode: "HTML", ...extra });
  trackBotMessage(userIdFromCtx(ctx), msg.message_id);
}

async function resetBackendMenu(ctx: Context): Promise<void> {
  await apiPost("/chat/menu", apiIdentity(ctx));
}

async function showMainMenu(ctx: Context, language?: BotLanguage): Promise<void> {
  await clearBotScreen(ctx);

  const uid = channelUserId(ctx);
  const session = getSession(uid);
  const lang = language ?? session.language;
  setSession(uid, { language: lang, screen: "menu", catalogFromConsult: false });
  shownGiftByUser.delete(uid);

  const s = t(lang);
  await replyWithMascot(ctx, `${s.menuWelcome}\n\n${s.menuPrompt}`, sceneForStage(1, { isStart: true }), {
    reply_markup: mainMenuKeyboard(lang),
  });

  void resetBackendMenu(ctx).catch((e) => console.warn("[menu reset]", e));
}

async function showCatalog(ctx: Context, opts?: { fromConsult?: boolean }): Promise<void> {
  await clearBotScreen(ctx);

  const uid = channelUserId(ctx);
  const fromConsult = Boolean(opts?.fromConsult);
  const { language } = setSession(uid, { screen: "catalog", catalogFromConsult: fromConsult });
  const s = t(language);

  const { items } = await apiGet<{ items: CatalogItem[] }>(`/catalog?lang=${language}`);
  if (!items.length) {
    await sendTrackedReply(ctx, "Каталог пока пуст.", {
      reply_markup: mainMenuKeyboard(language),
    });
    return;
  }

  await sendTrackedReply(ctx, fromConsult ? s.catalogKeepContextTitle : s.catalogTitle, {
    reply_markup: catalogListKeyboard(items, language, { consult: fromConsult }),
  });
}

async function showCatalogGift(ctx: Context, externalId: string, opts?: { fromConsult?: boolean }): Promise<void> {
  await clearBotScreen(ctx);

  const uid = channelUserId(ctx);
  const session = getSession(uid);
  const fromConsult = Boolean(opts?.fromConsult ?? session.catalogFromConsult);
  const { language } = session;
  const s = t(language);

  const { items } = await apiGet<{ items: CatalogItem[] }>(`/catalog?lang=${language}`);
  const gift = items.find((g) => g.externalId === externalId);
  if (!gift) {
    await showCatalog(ctx, { fromConsult });
    return;
  }

  const displayName = giftLabel(gift.externalId, gift.name);
  const caption = `<b>${displayName}</b>\n\n💰 ${gift.priceLabel}`;
  const text = gift.description;
  const photo = giftPhotoPath(gift.externalId);
  const markup = { reply_markup: catalogGiftKeyboard(gift.externalId, language, { consult: fromConsult }) };

  if (photo) {
    if (!fromConsult) shownGiftByUser.set(uid, gift.externalId);
    await replyWithPhotoFile(ctx, photo, text, markup, {
      caption,
      followUp: gift.description,
    });
  } else {
    await sendTrackedReply(ctx, text, markup);
  }
}

async function showHandoffRecommendation(
  ctx: Context,
  result: {
    reply: string;
    stage: number;
    recommendedGift?: RecommendedGift;
    managerHandoff: { url: string; buttonLabel: string };
  },
): Promise<void> {
  const uid = channelUserId(ctx);
  const session = getSession(uid);
  setSession(uid, { screen: "consult", catalogFromConsult: false });

  const gift = result.recommendedGift ?? null;
  const giftPhoto = gift ? giftPhotoPath(gift.externalId) : null;
  const handoffMarkup = {
    reply_markup: managerHandoffKeyboard(
      result.managerHandoff.url,
      result.managerHandoff.buttonLabel,
      session.language,
    ),
  };

  if (gift && giftPhoto) {
    await replyWithPhotoFile(ctx, giftPhoto, result.reply, handoffMarkup, { stage: result.stage });
    shownGiftByUser.set(uid, gift.externalId);
  } else {
    const scene = sceneForStage(result.stage);
    await replyWithMascot(ctx, result.reply, scene, handoffMarkup, { stage: result.stage });
  }
}

async function switchConsultationGift(ctx: Context, externalId: string): Promise<void> {
  await clearBotScreen(ctx);
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");

  const result = await apiPost<ChatResponse & { managerHandoff: NonNullable<ChatResponse["managerHandoff"]> }>(
    "/chat/switch-gift",
    { ...apiIdentity(ctx), catalogGiftExternalId: externalId },
  );

  await showHandoffRecommendation(ctx, result);
}

async function showConsultHandoff(ctx: Context): Promise<void> {
  const uid = channelUserId(ctx);
  const result = await apiGet<{
    reply: string;
    stage: number;
    recommendedGift?: RecommendedGift;
    managerHandoff: { url: string; buttonLabel: string };
  }>(`/chat/handoff?channel=telegram&channelUserId=${encodeURIComponent(uid)}`);

  await clearBotScreen(ctx);
  await showHandoffRecommendation(ctx, result);
}

async function beginConsultation(ctx: Context, catalogGiftExternalId?: string): Promise<void> {
  await clearBotScreen(ctx);

  const uid = channelUserId(ctx);
  resetMascotRotation(uid);
  const { language } = getSession(uid);
  setSession(uid, { screen: "consult", catalogFromConsult: false });
  if (catalogGiftExternalId) {
    shownGiftByUser.set(uid, catalogGiftExternalId);
  } else {
    shownGiftByUser.delete(uid);
  }

  const result = await apiPost<ChatResponse>("/chat/begin", {
    ...apiIdentity(ctx),
    language,
    catalogGiftExternalId,
  });

  await replyWithMascot(ctx, result.reply, sceneForStage(1, { isStart: true }), undefined, { stage: 1 });
}

async function handleUserText(ctx: Context, text: string): Promise<void> {
  const uid = channelUserId(ctx);
  await enqueueUserTask(uid, () => handleUserTextInner(ctx, text));
}

async function handleUserTextInner(ctx: Context, text: string): Promise<void> {
  const uid = channelUserId(ctx);
  const session = getSession(uid);

  if (!(await syncConsultScreen(ctx))) {
    await rewindBotMessages(ctx);
    await sendTrackedReply(ctx, t(session.language).useMenuHint, {
      reply_markup: mainMenuKeyboard(session.language),
    });
    return;
  }

  await rewindBotMessages(ctx);
  await ctx.api.sendChatAction(ctx.chat!.id, "typing");
  const result = await apiPost<ChatResponse & { isComplete: boolean }>("/chat/message", {
    ...apiIdentity(ctx),
    text,
  });

  if (result.needsMenu) {
    await showMainMenu(ctx);
    return;
  }

  const gift = result.recommendedGift ?? null;
  const giftPhoto = gift ? giftPhotoPath(gift.externalId) : null;
  const isNewGift = Boolean(gift && shownGiftByUser.get(uid) !== gift.externalId);
  const showGiftPhoto = Boolean(gift && giftPhoto && isNewGift && result.stage >= 8);
  const handoffMarkup = result.managerHandoff
    ? { reply_markup: managerHandoffKeyboard(result.managerHandoff.url, result.managerHandoff.buttonLabel, session.language) }
    : undefined;

  if (showGiftPhoto && gift && giftPhoto) {
    await replyWithPhotoFile(ctx, giftPhoto, result.reply, handoffMarkup, { stage: result.stage });
    shownGiftByUser.set(uid, gift.externalId);
  } else {
    const scene = sceneForStage(result.stage, { isComplete: result.isComplete });
    await replyWithMascot(ctx, result.reply, scene, handoffMarkup, { stage: result.stage });
  }

  if (result.managerHandoff) {
    setSession(uid, { screen: "consult", catalogFromConsult: false });
    return;
  }

  if (result.isComplete) {
    shownGiftByUser.delete(uid);
    setSession(uid, { screen: "menu" });
    await resetBackendMenu(ctx);
    return;
  }
}

function isOverloadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : "";
  return /503|429|UNAVAILABLE|high demand|timeout|aborted/i.test(msg);
}

async function replyChatError(ctx: Context, e: unknown): Promise<void> {
  console.error(e);
  if (isOverloadError(e)) {
    await ctx.reply("Сейчас AI перегружен или отвечает слишком долго. Подождите 10–20 секунд и отправьте сообщение ещё раз — я на месте.");
    return;
  }
  await ctx.reply("Не удалось обработать сообщение. Попробуйте ещё раз.");
}

async function handleVoiceMessage(ctx: Context): Promise<void> {
  const session = getSession(channelUserId(ctx));
  if (!(await syncConsultScreen(ctx))) {
    await rewindBotMessages(ctx);
    await sendTrackedReply(ctx, t(session.language).useMenuHint, {
      reply_markup: mainMenuKeyboard(session.language),
    });
    return;
  }

  if (!isTranscribeAvailable()) {
    await ctx.reply("Голосовые пока недоступны — напишите текстом.");
    return;
  }

  const voice = ctx.message?.voice ?? ctx.message?.audio;
  if (!voice) return;

  const status = await ctx.reply("🎤 Слушаю…");

  try {
    const file = await ctx.api.getFile(voice.file_id);
    if (!file.file_path) throw new Error("Telegram не вернул путь к файлу.");

    const mime = mimeForTelegramAudio(ctx.message?.audio?.mime_type);
    const text = await transcribeTelegramFile(file.file_path, mime);

    await ctx.api.deleteMessage(ctx.chat!.id, status.message_id).catch(() => {});

    if (!text) {
      await ctx.reply("Не разобрал голосовое — попробуйте ещё раз или напишите текстом.");
      return;
    }

    const preview = text.length > 120 ? `${text.slice(0, 117).trim()}…` : text;
    await sendTrackedReply(ctx, `🎤 Услышал: «${preview}»`);

    await handleUserText(ctx, text);
  } catch (e) {
    await ctx.api.deleteMessage(ctx.chat!.id, status.message_id).catch(() => {});
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("GEMINI_API_KEY")) {
      await ctx.reply("Распознавание голоса не настроено. Напишите текстом.");
      return;
    }
    if (isOverloadError(e)) {
      await ctx.reply("Сейчас AI перегружен. Подождите и отправьте голосовое ещё раз или напишите текстом.");
      return;
    }
    console.error("[voice]", e);
    await ctx.reply("Не удалось распознать голосовое. Попробуйте ещё раз или напишите текстом.");
  }
}

bot.command("start", async (ctx) => {
  try {
    await showMainMenu(ctx);
  } catch (e) {
    console.error(e);
    await ctx.reply("Сервис временно недоступен. Попробуйте позже.");
  }
});

bot.command("stickers", async (ctx) => {
  await ctx.reply(smartFormatReply(`🎨 Стикеры с Чернилькой:\n${STICKER_PACK_URL}`), { parse_mode: "HTML" });
});

bot.command("cancel", async (ctx) => {
  try {
    await showMainMenu(ctx);
  } catch {
    await ctx.reply("Не удалось сбросить диалог.");
  }
});

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery().catch(() => {});

  try {
    const uid = channelUserId(ctx);
    const session = getSession(uid);

    if (data === "menu:main") {
      await showMainMenu(ctx);
      return;
    }

    if (data === "menu:consult") {
      await beginConsultation(ctx);
      return;
    }

    if (data === "menu:catalog") {
      await showCatalog(ctx);
      return;
    }

    if (data === "consult:catalog") {
      await showCatalog(ctx, { fromConsult: true });
      return;
    }

    if (data === "consult:back") {
      await showConsultHandoff(ctx);
      return;
    }

    if (data === "menu:lang") {
      await clearBotScreen(ctx);
      await sendTrackedReply(ctx, t(session.language).menuLang, {
        reply_markup: languageKeyboard(session.language),
      });
      return;
    }

    if (data.startsWith("lang:")) {
      const lang = normalizeLanguage(data.slice(5));
      setSession(uid, { language: lang });
      await clearBotScreen(ctx);
      await sendTrackedReply(ctx, t(lang).langSaved(languageTitle(lang)), {
        reply_markup: mainMenuKeyboard(lang),
      });
      return;
    }

    if (data.startsWith("cat:view:")) {
      await showCatalogGift(ctx, data.slice("cat:view:".length));
      return;
    }

    if (data.startsWith("cat:consult:view:")) {
      await showCatalogGift(ctx, data.slice("cat:consult:view:".length), { fromConsult: true });
      return;
    }

    if (data.startsWith("cat:pick:")) {
      await beginConsultation(ctx, data.slice("cat:pick:".length));
      return;
    }

    if (data.startsWith("cat:consult:pick:")) {
      await switchConsultationGift(ctx, data.slice("cat:consult:pick:".length));
      return;
    }
  } catch (e) {
    console.error("[callback]", e);
    await ctx.reply("Что-то пошло не так. Попробуйте /start.");
  }
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  try {
    await handleUserText(ctx, text);
  } catch (e) {
    await replyChatError(ctx, e);
  }
});

bot.on("message:voice", async (ctx) => {
  try {
    console.log("[voice] received", channelUserId(ctx), ctx.message?.voice?.duration);
    await handleVoiceMessage(ctx);
  } catch (e) {
    await replyChatError(ctx, e);
  }
});

bot.on("message:audio", async (ctx) => {
  try {
    console.log("[audio] received", channelUserId(ctx));
    await handleVoiceMessage(ctx);
  } catch (e) {
    await replyChatError(ctx, e);
  }
});

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError && e.error_code === 409) {
    console.error("⚠️ 409 Conflict: два процесса с одним BOT_TOKEN — остановите локальный npm run dev:bot");
    return;
  }
  console.error("Bot error:", err);
});

await bot.api.deleteWebhook().catch(() => {});

bot.start({
  onStart: async (botInfo) => {
    console.log(`✅ @${botInfo.username} — gift consultant bot`);
    try {
      await configureBotProfile(bot.api);
      console.log("✅ Bot profile description synced");
    } catch (e) {
      console.warn("⚠️  Could not sync bot profile description:", e);
    }
    if (!isTranscribeAvailable()) {
      console.warn("⚠️  Voice disabled — check BOT_TOKEN and API_URL");
    }
  },
});
