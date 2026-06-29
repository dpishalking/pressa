import { Bot } from "grammy";
import { giftPhotoPath } from "./gift-photos.js";
import { smartFormatReply } from "./format.js";
import { sceneForStage } from "./mascot.js";
import { replyWithMascot, replyWithPhotoFile } from "./reply-with-mascot.js";

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

type ChatResponse = {
  reply: string;
  stage: number;
  isComplete?: boolean;
  recommendedGift?: RecommendedGift;
};

// Какой подарок уже показан фото-карточкой пользователю — чтобы не дублировать.
const shownGiftByUser = new Map<string, string>();

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

bot.command("start", async (ctx) => {
  try {
    shownGiftByUser.delete(channelUserId(ctx));
    const { reply } = await apiPost<ChatResponse>("/chat/start", {
      channel: "telegram",
      channelUserId: channelUserId(ctx),
      telegramUsername: telegramUsername(ctx),
    });
    await replyWithMascot(ctx, reply, sceneForStage(1, { isStart: true }));
  } catch (e) {
    console.error(e);
    await ctx.reply("Сервис временно недоступен. Попробуйте позже.");
  }
});

bot.command("stickers", async (ctx) => {
  await ctx.reply(smartFormatReply(`🎨 Стикеры с Пресся:\n${STICKER_PACK_URL}`), { parse_mode: "HTML" });
});

bot.command("cancel", async (ctx) => {
  try {
    shownGiftByUser.delete(channelUserId(ctx));
    const { reply } = await apiPost<ChatResponse>("/chat/start", {
      channel: "telegram",
      channelUserId: channelUserId(ctx),
      telegramUsername: telegramUsername(ctx),
    });
    await replyWithMascot(ctx, "Начали заново.\n\n" + reply, sceneForStage(1, { isStart: true }));
  } catch {
    await ctx.reply("Не удалось сбросить диалог.");
  }
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  try {
    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    const result = await apiPost<ChatResponse & { isComplete: boolean }>("/chat/message", {
      channel: "telegram",
      channelUserId: channelUserId(ctx),
      text,
      telegramUsername: telegramUsername(ctx),
    });

    const uid = channelUserId(ctx);
    const gift = result.recommendedGift ?? null;
    const giftPhoto = gift ? giftPhotoPath(gift.externalId) : null;
    const isNewGift = Boolean(gift && shownGiftByUser.get(uid) !== gift.externalId);

    if (gift && giftPhoto && isNewGift) {
      await replyWithPhotoFile(ctx, giftPhoto, result.reply);
      shownGiftByUser.set(uid, gift.externalId);
    } else {
      const scene = sceneForStage(result.stage, { isComplete: result.isComplete });
      await replyWithMascot(ctx, result.reply, scene);
    }

    if (result.isComplete) {
      await ctx.reply(
        smartFormatReply(
          "✅ Вся информация передана менеджеру. Он свяжется с вами и поможет оформить заказ — без повторных вопросов.",
        ),
        { parse_mode: "HTML" },
      );
    }
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "";
    if (/503|429|UNAVAILABLE|high demand/i.test(msg)) {
      await ctx.reply("Сейчас AI перегружен. Подождите 10–20 секунд и отправьте сообщение ещё раз — я на месте.");
      return;
    }
    await ctx.reply("Не удалось обработать сообщение. Попробуйте ещё раз.");
  }
});

bot.catch((err) => console.error("Bot error:", err));

bot.start({
  onStart: (info) => console.log(`✅ @${info.username} — gift consultant bot`),
});
