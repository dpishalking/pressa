const GIFT_EMOJI: Record<string, string> = {
  "glossy-magazine": "✨",
  "memory-book": "📔",
  "life-book": "📖",
  "newspaper-from-date": "🎂",
  "joke-passport": "🥃",
  "discovery-passport": "🧭",
  "personal-newspaper": "📰",
  "family-subscription": "👨‍👩‍👧",
};

export function giftEmoji(externalId: string): string {
  return GIFT_EMOJI[externalId] ?? "🎁";
}

/** Название уже локализовано в API — добавляем только эмодзи. */
export function giftLabel(externalId: string, name: string): string {
  return `${giftEmoji(externalId)} ${name}`;
}
