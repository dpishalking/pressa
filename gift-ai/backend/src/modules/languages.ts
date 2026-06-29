export type BotLanguage = "ru" | "lv" | "et" | "lt" | "en";

export const BOT_LANGUAGES: { id: BotLanguage; title: string; promptName: string }[] = [
  { id: "ru", title: "🇷🇺 Русский", promptName: "русском" },
  { id: "lv", title: "🇱🇻 Latviešu", promptName: "латышском (latviešu)" },
  { id: "et", title: "🇪🇪 Eesti", promptName: "эстонском (eesti)" },
  { id: "lt", title: "🇱🇹 Lietuvių", promptName: "литовском (lietuvių)" },
  { id: "en", title: "🇬🇧 English", promptName: "английском (English)" },
];

export function normalizeLanguage(raw?: string | null): BotLanguage {
  const id = raw?.trim().toLowerCase();
  if (id === "lv" || id === "et" || id === "lt" || id === "en") return id;
  return "ru";
}

export function languagePromptName(lang: BotLanguage): string {
  return BOT_LANGUAGES.find((l) => l.id === lang)?.promptName ?? "русском";
}
