export type BotLanguage = "ru" | "lv" | "et" | "lt" | "en";

export const BOT_LANGUAGES: { id: BotLanguage; title: string }[] = [
  { id: "ru", title: "🇷🇺 Русский" },
  { id: "lv", title: "🇱🇻 Latviešu" },
  { id: "et", title: "🇪🇪 Eesti" },
  { id: "lt", title: "🇱🇹 Lietuvių" },
  { id: "en", title: "🇬🇧 English" },
];

export function normalizeLanguage(raw?: string | null): BotLanguage {
  const id = raw?.trim().toLowerCase();
  if (id === "lv" || id === "et" || id === "lt" || id === "en") return id;
  return "ru";
}

export function languageTitle(lang: BotLanguage): string {
  return BOT_LANGUAGES.find((l) => l.id === lang)?.title ?? "🇷🇺 Русский";
}
