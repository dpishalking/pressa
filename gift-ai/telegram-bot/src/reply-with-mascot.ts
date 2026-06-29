import type { Context } from "grammy";
import { InputFile } from "grammy";
import { smartFormatReply, type FormatOpts } from "./format.js";
import { mascotImagePath, type MascotScene } from "./mascot.js";

const CAPTION_LIMIT = 1024;

async function sendHtml(
  ctx: Context,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
  formatOpts?: FormatOpts,
) {
  const html = smartFormatReply(text, formatOpts);
  try {
    await ctx.reply(html, { parse_mode: "HTML", ...extra });
  } catch (e) {
    console.error("[html reply failed]", e);
    await ctx.reply(text, extra);
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

  try {
    await ctx.api.sendChatAction(ctx.chat!.id, "upload_photo");
    if (html.length <= CAPTION_LIMIT) {
      try {
        await ctx.replyWithPhoto(photo, { caption: html, parse_mode: "HTML", ...extra });
        return;
      } catch (e) {
        console.error("[gift html caption failed]", e);
        await ctx.replyWithPhoto(photo, { caption: text, ...extra });
        return;
      }
    }
    if (opts?.caption && captionHtml.length <= CAPTION_LIMIT) {
      const followUp = (opts.followUp ?? text).trim();
      const photoOpts = followUp
        ? { caption: captionHtml, parse_mode: "HTML" as const }
        : { caption: captionHtml, parse_mode: "HTML" as const, ...extra };
      try {
        await ctx.replyWithPhoto(photo, photoOpts);
      } catch (e) {
        console.error("[gift short caption failed]", e);
        await ctx.replyWithPhoto(photo, followUp ? { caption: opts.caption } : { caption: opts.caption, ...extra });
      }
      if (followUp) await sendHtml(ctx, followUp, extra, opts);
      return;
    }
    await ctx.replyWithPhoto(photo);
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
