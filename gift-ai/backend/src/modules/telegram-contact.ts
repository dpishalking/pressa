/** @username if set, otherwise numeric Telegram user id (id:123456789). */
export function formatTelegramContact(opts: {
  username?: string;
  telegram?: string;
  channelUserId?: string;
}): string {
  const fromField = opts.telegram?.trim();
  if (fromField?.startsWith("@")) return fromField;

  const raw = opts.username?.trim().replace(/^@/, "");
  if (raw) return `@${raw}`;

  if (fromField?.startsWith("id:")) return fromField;

  const id = opts.channelUserId?.trim();
  return id ? `id:${id}` : fromField ?? "";
}
