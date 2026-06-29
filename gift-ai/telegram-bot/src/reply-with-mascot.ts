import type { Context } from "grammy";
import { InputFile } from "grammy";
import { managerLinkHtml } from "./handoff.js";
import { smartFormatReply, type FormatOpts } from "./format.js";
import { mascotImagePath, type MascotScene } from "./mascot.js";
import { trackBotMessages, userIdFromCtx } from "./message-cleanup.js";

const CAPTION_LIMIT = 1024;

function formatHtml(text: string, opts?: FormatOpts): string {
  const html = smartFormatReply(text, opts);
  if (!opts?.managerHandoff) return html;
  return `${html}\n\n${managerLinkHtml(opts.managerHandoff)}`;
}

function plainWithManagerLink(text: string, opts?: FormatOpts): string {
  if (!opts?.managerHandoff) return text;
  return `${text}\n\n${opts.managerHandoff.url}`;
}

async function sendTextMessage(
  ctx: Context,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
  formatOpts?: FormatOpts,
): Promise<void> {
  const uid = userIdFromCtx(ctx);
  const html = formatHtml(text, formatOpts);

  try {
    const msg = await ctx.reply(html, { parse_mode: "HTML", ...extra });
    trackBotMessages(uid, [msg.message_id]);
    return;
  } catch (e) {
    console.error("[html reply failed]", e);
  }

  try {
    const msg = await ctx.reply(plainWithManagerLink(text, formatOpts), extra);
    trackBotMessages(uid, [msg.message_id]);
  } catch (e) {
    console.error("[plain reply failed]", e);
    const msg = await ctx.reply(text.slice(0, 4000), extra);
    trackBotMessages(uid, [msg.message_id]);
  }
}

type PhotoReplyOpts = {
  caption?: string;
  followUp?: string;
};

export async function replyWithPhotoFile(
  ctx: Context,
  photoPath: string,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
  opts?: PhotoReplyOpts & FormatOpts,
): Promise<void> {
  const html = formatHtml(text, opts);
  const photo = new InputFile(photoPath);
  const uid = userIdFromCtx(ctx);

  try {
    await ctx.api.sendChatAction(ctx.chat!.id, "upload_photo");

    if (html.length <= CAPTION_LIMIT) {
      try {
        const msg = await ctx.replyWithPhoto(photo, { caption: html, parse_mode: "HTML", ...extra });
        trackBotMessages(uid, [msg.message_id]);
        return;
      } catch (e) {
        console.error("[photo html caption failed]", e);
        try {
          const plain = plainWithManagerLink(text, opts);
          const msg = await ctx.replyWithPhoto(photo, { caption: plain.slice(0, CAPTION_LIMIT), ...extra });
          trackBotMessages(uid, [msg.message_id]);
          return;
        } catch (e2) {
          console.error("[photo plain caption failed]", e2);
        }
      }
    }

    // Подпись не влезает (часто из‑за длинной ссылки на менеджера) — фото отдельно, текст следом.
    const photoMsg = await ctx.replyWithPhoto(photo);
    trackBotMessages(uid, [photoMsg.message_id]);
    await sendTextMessage(ctx, text, extra, opts);
  } catch (e) {
    console.error("[photo send failed]", e);
    await sendTextMessage(ctx, text, extra, opts);
  }
}

export async function replyWithMascot(
  ctx: Context,
  text: string,
  scene: MascotScene,
  extra?: Parameters<Context["reply"]>[1],
  formatOpts?: FormatOpts,
): Promise<void> {
  const photoPath = mascotImagePath(scene, userIdFromCtx(ctx));
  if (!photoPath) {
    await sendTextMessage(ctx, text, extra, formatOpts);
    return;
  }
  await replyWithPhotoFile(ctx, photoPath, text, extra, formatOpts);
}
