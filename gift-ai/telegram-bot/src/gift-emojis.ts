import type { BotLanguage } from "./languages.js";
import { giftName } from "./gift-names.js";

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

export function giftLabel(externalId: string, name: string, lang: BotLanguage = "ru"): string {
  return `${giftEmoji(externalId)} ${giftName(externalId, lang, name)}`;
}
