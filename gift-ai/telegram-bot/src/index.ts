import { Bot } from "grammy";

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = (process.env.API_URL ?? "http://localhost:3100").replace(/\/$/, "");

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

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
    const { reply } = await apiPost<{ reply: string }>("/chat/start", {
      channel: "telegram",
      channelUserId: channelUserId(ctx),
      telegramUsername: telegramUsername(ctx),
    });
    await ctx.reply(reply);
  } catch (e) {
    console.error(e);
    await ctx.reply("Сервис временно недоступен. Попробуйте позже.");
  }
});

bot.command("cancel", async (ctx) => {
  try {
    const { reply } = await apiPost<{ reply: string }>("/chat/start", {
      channel: "telegram",
      channelUserId: channelUserId(ctx),
      telegramUsername: telegramUsername(ctx),
    });
    await ctx.reply("Начали заново.\n\n" + reply);
  } catch {
    await ctx.reply("Не удалось сбросить диалог.");
  }
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  try {
    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    const result = await apiPost<{ reply: string; isComplete: boolean }>("/chat/message", {
      channel: "telegram",
      channelUserId: channelUserId(ctx),
      text,
      telegramUsername: telegramUsername(ctx),
    });
    await ctx.reply(result.reply);
    if (result.isComplete) {
      await ctx.reply(
        "✅ Вся информация передана менеджеру. Он свяжется с вами и поможет оформить заказ — без повторных вопросов.",
      );
    }
  } catch (e) {
    console.error(e);
    await ctx.reply("Не удалось обработать сообщение. Попробуйте ещё раз.");
  }
});

bot.catch((err) => console.error("Bot error:", err));

bot.start({
  onStart: (info) => console.log(`✅ @${info.username} — gift consultant bot`),
});
