import type { Context } from "grammy";
import { InputFile } from "grammy";
import { smartFormatReply, type FormatOpts } from "./format.js";
import { mascotImagePath, type MascotScene } from "./mascot.js";
import { trackBotMessages, userIdFromCtx } from "./message-cleanup.js";

const CAPTION_LIMIT = 1024;

async function sendHtml(
  ctx: Context,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
  formatOpts?: FormatOpts,
): Promise<number | undefined> {
  const html = smartFormatReply(text, formatOpts);
  try {
    const msg = await ctx.reply(html, { parse_mode: "HTML", ...extra });
    trackBotMessages(userIdFromCtx(ctx), [msg.message_id]);
    return msg.message_id;
  } catch (e) {
    console.error("[html reply failed]", e);
    const msg = await ctx.reply(text, extra);
    trackBotMessages(userIdFromCtx(ctx), [msg.message_id]);
    return msg.message_id;
  }
}

type PhotoReplyOpts = {
  /** Короткая подпись к фото, если полный текст не влезает в лимит Telegram (1024). */
  caption?: string;
  /** Текст отдельным сообщением после фото (без дублирования подписи). */
  followUp?: string;
};

export async function replyWithPhotoFile(
  ctx: Context,
  photoPath: string,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
  opts?: PhotoReplyOpts & FormatOpts,
): Promise<void> {
  const html = smartFormatReply(text, opts);
  const captionHtml = smartFormatReply(opts?.caption ?? text, opts);
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
        console.error("[gift html caption failed]", e);
        const msg = await ctx.replyWithPhoto(photo, { caption: text, ...extra });
        trackBotMessages(uid, [msg.message_id]);
        return;
      }
    }
    if (opts?.caption && captionHtml.length <= CAPTION_LIMIT) {
      const followUp = (opts.followUp ?? text).trim();
      const photoOpts = followUp
        ? { caption: captionHtml, parse_mode: "HTML" as const }
        : { caption: captionHtml, parse_mode: "HTML" as const, ...extra };
      try {
        const msg = await ctx.replyWithPhoto(photo, photoOpts);
        trackBotMessages(uid, [msg.message_id]);
      } catch (e) {
        console.error("[gift short caption failed]", e);
        const msg = await ctx.replyWithPhoto(photo, followUp ? { caption: opts.caption } : { caption: opts.caption, ...extra });
        trackBotMessages(uid, [msg.message_id]);
      }
      if (followUp) await sendHtml(ctx, followUp, extra, opts);
      return;
    }
    const msg = await ctx.replyWithPhoto(photo);
    trackBotMessages(uid, [msg.message_id]);
    await sendHtml(ctx, text, extra, opts);
  } catch (e) {
    console.error("[gift photo failed]", e);
    await sendHtml(ctx, text, extra, opts);
  }
}

export async function replyWithMascot(
  ctx: Context,
  text: string,
  scene: MascotScene,
  extra?: Parameters<Context["reply"]>[1],
  formatOpts?: FormatOpts,
): Promise<void> {
  const photoPath = mascotImagePath(scene);
  if (!photoPath) {
    await sendHtml(ctx, text, extra, formatOpts);
    return;
  }
  await replyWithPhotoFile(ctx, photoPath, text, extra, formatOpts);
}
