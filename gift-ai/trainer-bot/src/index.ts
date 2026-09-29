import { Bot, GrammyError, type Context } from "grammy";
import { isTrainerAdmin } from "./admin.js";
import { replySmartdesk, showSmartdeskMenu, type SmartdeskFormat } from "./smartdesk.js";

const BOT_TOKEN = process.env.TRAINER_BOT_TOKEN ?? process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

function deny(ctx: Context): Promise<unknown> {
  return ctx.reply(`Нет доступа. Ваш Telegram id: ${ctx.from?.id ?? "неизвестен"}.`);
}

bot.command("start", async (ctx) => {
  if (!isTrainerAdmin(ctx)) {
    await deny(ctx);
    return;
  }
  await showSmartdeskMenu(ctx);
});

bot.command("help", async (ctx) => {
  if (!isTrainerAdmin(ctx)) {
    await deny(ctx);
    return;
  }
  await showSmartdeskMenu(ctx);
});

bot.command("report", async (ctx) => {
  if (!isTrainerAdmin(ctx)) {
    await deny(ctx);
    return;
  }
  await showSmartdeskMenu(ctx);
});

bot.command("queue", async (ctx) => {
  if (!isTrainerAdmin(ctx)) {
    await deny(ctx);
    return;
  }
  await replySmartdesk(ctx, "queue");
});

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!isTrainerAdmin(ctx)) {
    await ctx.answerCallbackQuery({ text: "Нет доступа", show_alert: true });
    return;
  }

  if (data === "sd:menu") {
    await ctx.answerCallbackQuery();
    await showSmartdeskMenu(ctx);
    return;
  }

  if (data.startsWith("sd:")) {
    const format = data.slice(3);
    if (format !== "queue" && format !== "managers" && format !== "inboxes" && format !== "report") {
      await ctx.answerCallbackQuery({ text: "Неизвестный формат" });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Собираю…" });
    await replySmartdesk(ctx, format as SmartdeskFormat);
    return;
  }

  await ctx.answerCallbackQuery();
  await showSmartdeskMenu(ctx);
});

bot.on("message:text", async (ctx) => {
  if (!isTrainerAdmin(ctx)) {
    await deny(ctx);
    return;
  }
  await showSmartdeskMenu(ctx);
});

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError && e.error_code === 409) {
    console.error("409 Conflict: два процесса с одним токеном бота");
    return;
  }
  console.error("Bot error:", err);
});

await bot.api.deleteWebhook().catch(() => {});

bot.start({
  onStart: async (botInfo) => {
    console.log(`@${botInfo.username} — SmartDesk`);
    try {
      await bot.api.setMyCommands([
        { command: "start", description: "Меню SmartDesk" },
        { command: "queue", description: "Очередь" },
        { command: "report", description: "Отчёты" },
        { command: "help", description: "Помощь" },
      ]);
    } catch (e) {
      console.warn("Could not set bot commands:", e);
    }
  },
});
