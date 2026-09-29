import { InlineKeyboard, type Context } from "grammy";
import { isTrainerAdmin } from "./admin.js";

const EXPORT_URL = (process.env.SMARTDESK_EXPORT_URL ?? "https://rp-bi.site/api/smartdesk/export").replace(/\/$/, "");
const EXPORT_SECRET = (process.env.SMARTDESK_EXPORT_SECRET ?? "").trim();

export type SmartdeskFormat = "queue" | "managers" | "inboxes" | "report";

export const SMARTDESK_MENU =
  "<b>Отчёты SmartDesk</b>\n\n" +
  "Очередь — кто ждёт ответа прямо сейчас.\n" +
  "Менеджеры — диалоги и скорость за сегодня.\n" +
  "Источники — WhatsApp, Instagram, почта, Telegram.\n" +
  "Сводка — менеджеры и источники вместе.";

export function smartdeskMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Очередь", "sd:queue")
    .text("Сводка", "sd:report").row()
    .text("Менеджеры", "sd:managers")
    .text("Источники", "sd:inboxes");
}

function chunks(text: string, limit = 3900): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const cut = rest.lastIndexOf("\n", limit);
    const at = cut > 200 ? cut : limit;
    parts.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function loadExport(command: SmartdeskFormat): Promise<string> {
  if (!EXPORT_SECRET) throw new Error("SMARTDESK_EXPORT_SECRET is empty");
  const response = await fetch(EXPORT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-smartdesk-secret": EXPORT_SECRET,
    },
    body: JSON.stringify({ command }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`SmartDesk export ${response.status}`);
  const body = (await response.json()) as { text?: string };
  if (!body.text) throw new Error("SmartDesk export is empty");
  return body.text;
}

export async function showSmartdeskMenu(ctx: Context): Promise<void> {
  if (!isTrainerAdmin(ctx)) {
    await ctx.reply("Нет доступа. Отчёт SmartDesk только для наставника.");
    return;
  }
  await ctx.reply(SMARTDESK_MENU, {
    parse_mode: "HTML",
    reply_markup: smartdeskMenuKeyboard(),
  });
}

const STATUS: Record<SmartdeskFormat, string> = {
  queue: "Смотрю очередь SmartDesk…",
  managers: "Собираю менеджеров за сегодня…",
  inboxes: "Собираю источники за сегодня…",
  report: "Собираю сводку SmartDesk…",
};

export async function replySmartdesk(ctx: Context, command: SmartdeskFormat): Promise<void> {
  if (!isTrainerAdmin(ctx)) {
    await ctx.reply("Нет доступа. Отчёт SmartDesk только для наставника.");
    return;
  }
  await ctx.reply(STATUS[command]);
  try {
    const text = await loadExport(command);
    const parts = chunks(text);
    for (let index = 0; index < parts.length; index += 1) {
      const last = index === parts.length - 1;
      await ctx.reply(parts[index], last ? { reply_markup: smartdeskMenuKeyboard() } : undefined);
    }
  } catch (error) {
    console.error("[smartdesk]", error instanceof Error ? error.message : error);
    await ctx.reply("Не удалось снять данные из SmartDesk. Проверьте секрет и что дашборд уже задеплоен.", {
      reply_markup: smartdeskMenuKeyboard(),
    });
  }
}
