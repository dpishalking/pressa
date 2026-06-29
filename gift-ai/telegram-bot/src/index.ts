import { Bot, type Context } from "grammy";
import { giftPhotoPath } from "./gift-photos.js";
import { smartFormatReply } from "./format.js";
import { t } from "./i18n.js";
import {
  catalogGiftKeyboard,
  catalogListKeyboard,
  languageKeyboard,
  mainMenuKeyboard,
} from "./keyboards.js";
import { languageTitle, normalizeLanguage, type BotLanguage } from "./languages.js";
import { sceneForStage } from "./mascot.js";
import { replyWithMascot, replyWithPhotoFile } from "./reply-with-mascot.js";
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
  needsMenu?: boolean;
};

const shownGiftByUser = new Map<string, string>();

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

async function resetBackendMenu(ctx: Context): Promise<void> {
  await apiPost("/chat/menu", apiIdentity(ctx));
}

async function showMainMenu(ctx: Context, language?: BotLanguage): Promise<void> {
  const uid = channelUserId(ctx);
  const session = getSession(uid);
  const lang = language ?? session.language;
  setSession(uid, { language: lang, screen: "menu" });
  shownGiftByUser.delete(uid);

  await resetBackendMenu(ctx);

  const s = t(lang);
  await replyWithMascot(ctx, `${s.menuWelcome}\n\n${s.menuPrompt}`, sceneForStage(1, { isStart: true }), {
    reply_markup: mainMenuKeyboard(lang),
  });
}

async function showCatalog(ctx: Context): Promise<void> {
  const uid = channelUserId(ctx);
  const { language } = setSession(uid, { screen: "catalog" });
  const s = t(language);

  const { items } = await apiGet<{ items: CatalogItem[] }>("/catalog");
  if (!items.length) {
    await ctx.reply(smartFormatReply("Каталог пока пуст."), {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(language),
    });
    return;
  }

  await ctx.reply(smartFormatReply(s.catalogTitle), {
    parse_mode: "HTML",
    reply_markup: catalogListKeyboard(items, language),
  });
}

async function showCatalogGift(ctx: Context, externalId: string): Promise<void> {
  const uid = channelUserId(ctx);
  const { language } = getSession(uid);
  const s = t(language);

  const { items } = await apiGet<{ items: CatalogItem[] }>("/catalog");
  const gift = items.find((g) => g.externalId === externalId);
  if (!gift) {
    await showCatalog(ctx);
    return;
  }

  const text = `<b>${gift.name}</b>\n\n${gift.description}\n\n💰 ${gift.priceLabel}`;
  const photo = giftPhotoPath(gift.externalId);
  const markup = { reply_markup: catalogGiftKeyboard(gift.externalId, language) };

  if (photo) {
    await replyWithPhotoFile(ctx, photo, text, markup);
  } else {
    await ctx.reply(smartFormatReply(text), { parse_mode: "HTML", ...markup });
  }
}

async function beginConsultation(ctx: Context, catalogGiftExternalId?: string): Promise<void> {
  const uid = channelUserId(ctx);
  const { language } = getSession(uid);
  setSession(uid, { screen: "consult" });
  shownGiftByUser.delete(uid);

  const result = await apiPost<ChatResponse>("/chat/begin", {
    ...apiIdentity(ctx),
    language,
    catalogGiftExternalId,
  });

  await replyWithMascot(ctx, result.reply, sceneForStage(1, { isStart: true }));
}

async function handleUserText(ctx: Context, text: string): Promise<void> {
  const uid = channelUserId(ctx);
  const session = getSession(uid);

  if (session.screen !== "consult") {
    await ctx.reply(smartFormatReply(t(session.language).useMenuHint), {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(session.language),
    });
    return;
  }

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

  if (showGiftPhoto && gift && giftPhoto) {
    await replyWithPhotoFile(ctx, giftPhoto, result.reply);
    shownGiftByUser.set(uid, gift.externalId);
  } else {
    const scene = sceneForStage(result.stage, { isComplete: result.isComplete });
    await replyWithMascot(ctx, result.reply, scene);
  }

  if (result.isComplete) {
    await ctx.reply(smartFormatReply(t(session.language).completeHandoff), { parse_mode: "HTML" });
    await showMainMenu(ctx);
  }
}

function isOverloadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : "";
  return /503|429|UNAVAILABLE|high demand/i.test(msg);
}

async function replyChatError(ctx: Context, e: unknown): Promise<void> {
  console.error(e);
  if (isOverloadError(e)) {
    await ctx.reply("Сейчас AI перегружен. Подождите 10–20 секунд и отправьте сообщение ещё раз — я на месте.");
    return;
  }
  await ctx.reply("Не удалось обработать сообщение. Попробуйте ещё раз.");
}

async function handleVoiceMessage(ctx: Context): Promise<void> {
  const session = getSession(channelUserId(ctx));
  if (session.screen !== "consult") {
    await ctx.reply(smartFormatReply(t(session.language).useMenuHint), {
      parse_mode: "HTML",
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
    await ctx.reply(smartFormatReply(`🎤 Услышал: «${preview}»`), { parse_mode: "HTML" });

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

    if (data === "menu:lang") {
      await ctx.reply(smartFormatReply(t(session.language).menuLang), {
        parse_mode: "HTML",
        reply_markup: languageKeyboard(session.language),
      });
      return;
    }

    if (data.startsWith("lang:")) {
      const lang = normalizeLanguage(data.slice(5));
      setSession(uid, { language: lang });
      await ctx.reply(smartFormatReply(t(lang).langSaved(languageTitle(lang))), {
        parse_mode: "HTML",
        reply_markup: mainMenuKeyboard(lang),
      });
      return;
    }

    if (data.startsWith("cat:view:")) {
      await showCatalogGift(ctx, data.slice("cat:view:".length));
      return;
    }

    if (data.startsWith("cat:pick:")) {
      await beginConsultation(ctx, data.slice("cat:pick:".length));
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

bot.catch((err) => console.error("Bot error:", err));

bot.start({
  onStart: (info) => {
    console.log(`✅ @${info.username} — gift consultant bot`);
    if (!isTranscribeAvailable()) {
      console.warn("⚠️  Voice disabled — check BOT_TOKEN and API_URL");
    }
  },
});
