import type { Context } from "grammy";
import { InputFile } from "grammy";
import { smartFormatReply, type FormatOpts } from "./format.js";
import { mascotImagePath, type MascotScene } from "./mascot.js";
import { trackBotMessages, userIdFromCtx } from "./message-cleanup.js";

const CAPTION_LIMIT = 1024;

async function sendTextMessage(
  ctx: Context,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
  formatOpts?: FormatOpts,
): Promise<void> {
  const uid = userIdFromCtx(ctx);
  const html = smartFormatReply(text, formatOpts);

  try {
    const msg = await ctx.reply(html, { parse_mode: "HTML", ...extra });
    trackBotMessages(uid, [msg.message_id]);
    return;
  } catch (e) {
    console.error("[html reply failed]", e);
    const msg = await ctx.reply(text, extra);
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
  await replyWithPhotoFiles(ctx, [photoPath], text, extra, opts);
}

/** Одно фото или альбом (до 10). У media group нельзя повесить кнопки — они идут отдельным коротким сообщением. */
export async function replyWithPhotoFiles(
  ctx: Context,
  photoPaths: string[],
  text: string,
  extra?: Parameters<Context["reply"]>[1],
  opts?: PhotoReplyOpts & FormatOpts,
): Promise<void> {
  const paths = photoPaths.filter(Boolean).slice(0, 10);
  if (!paths.length) {
    await sendTextMessage(ctx, text, extra, opts);
    return;
  }

  if (paths.length === 1) {
    await replyWithSinglePhoto(ctx, paths[0]!, text, extra, opts);
    return;
  }

  const uid = userIdFromCtx(ctx);
  const captionSource = opts?.caption?.trim() || text;
  const captionHtml = smartFormatReply(captionSource, opts).slice(0, CAPTION_LIMIT);
  // Полный ответ уже в подписи альбома — не дублируем. Отдельный followUp (напр. описание в каталоге) оставляем.
  const explicitFollowUp = opts?.followUp?.trim();
  const followUp =
    explicitFollowUp && explicitFollowUp !== captionSource
      ? explicitFollowUp
      : extra
        ? "Выберите действие:"
        : "";

  try {
    await ctx.api.sendChatAction(ctx.chat!.id, "upload_photo");
    const media = paths.map((photoPath, index) => ({
      type: "photo" as const,
      media: new InputFile(photoPath),
      ...(index === 0
        ? {
            caption: captionHtml,
            parse_mode: "HTML" as const,
          }
        : {}),
    }));
    const album = await ctx.replyWithMediaGroup(media);
    trackBotMessages(
      uid,
      album.map((m) => m.message_id),
    );
    if (followUp) {
      await sendTextMessage(ctx, followUp, extra, opts);
    }
  } catch (e) {
    console.error("[photo album send failed]", e);
    await replyWithSinglePhoto(ctx, paths[0]!, text, extra, opts);
  }
}

async function replyWithSinglePhoto(
  ctx: Context,
  photoPath: string,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
  opts?: PhotoReplyOpts & FormatOpts,
): Promise<void> {
  const html = smartFormatReply(text, opts);
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
          const msg = await ctx.replyWithPhoto(photo, { caption: text.slice(0, CAPTION_LIMIT), ...extra });
          trackBotMessages(uid, [msg.message_id]);
          return;
        } catch (e2) {
          console.error("[photo plain caption failed]", e2);
        }
      }
    }

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
