import type { Context } from "grammy";
import { InputFile } from "grammy";
import { smartFormatReply } from "./format.js";
import { mascotImagePath, type MascotScene } from "./mascot.js";

const CAPTION_LIMIT = 1024;

async function sendHtml(ctx: Context, text: string, extra?: Parameters<Context["reply"]>[1]) {
  const html = smartFormatReply(text);
  try {
    await ctx.reply(html, { parse_mode: "HTML", ...extra });
  } catch (e) {
    console.error("[html reply failed]", e);
    await ctx.reply(text, extra);
  }
}

async function replyWithPhotoAndCaption(ctx: Context, photoPath: string, text: string, logTag: string): Promise<void> {
  const html = smartFormatReply(text);
  const photo = new InputFile(photoPath);

  try {
    await ctx.api.sendChatAction(ctx.chat!.id, "upload_photo");
    if (html.length <= CAPTION_LIMIT) {
      try {
        await ctx.replyWithPhoto(photo, { caption: html, parse_mode: "HTML" });
        return;
      } catch (e) {
        console.error(`[${logTag} html caption failed]`, e);
        await ctx.replyWithPhoto(photo, { caption: text });
        return;
      }
    }
    await ctx.replyWithPhoto(photo);
    await sendHtml(ctx, text);
  } catch (e) {
    console.error(`[${logTag} photo failed]`, e);
    await sendHtml(ctx, text);
  }
}

export async function replyWithPhotoFile(ctx: Context, photoPath: string, text: string): Promise<void> {
  await replyWithPhotoAndCaption(ctx, photoPath, text, "gift");
}

export async function replyWithMascot(ctx: Context, text: string, scene: MascotScene): Promise<void> {
  const photoPath = mascotImagePath(scene);
  if (!photoPath) {
    await sendHtml(ctx, text);
    return;
  }
  await replyWithPhotoAndCaption(ctx, photoPath, text, "mascot");
}
