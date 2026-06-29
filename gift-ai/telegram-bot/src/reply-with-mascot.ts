import type { Context } from "grammy";
import { InputFile } from "grammy";
import { mascotImagePath, type MascotScene } from "./mascot.js";

const CAPTION_LIMIT = 1024;

export async function replyWithMascot(ctx: Context, text: string, scene: MascotScene): Promise<void> {
  const photoPath = mascotImagePath(scene);
  if (!photoPath) {
    await ctx.reply(text);
    return;
  }

  try {
    await ctx.api.sendChatAction(ctx.chat!.id, "upload_photo");
    const photo = new InputFile(photoPath);

    if (text.length <= CAPTION_LIMIT) {
      await ctx.replyWithPhoto(photo, { caption: text });
      return;
    }

    await ctx.replyWithPhoto(photo);
    await ctx.reply(text);
  } catch (e) {
    console.error("[mascot photo failed]", scene, e);
    await ctx.reply(text);
  }
}
