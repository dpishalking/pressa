import type { BotLanguage } from "./languages.js";

export type BotScreen = "menu" | "catalog" | "consult";

export type UserSession = {
  language: BotLanguage;
  screen: BotScreen;
  /** Каталог во время консультации — не сбрасывать собранные поля. */
  catalogFromConsult?: boolean;
  /** ID сообщений бота в текущем экране — удаляем при навигации или новом ответе. */
  botMessageIds?: number[];
};

const sessions = new Map<string, UserSession>();

export function getSession(uid: string): UserSession {
  return sessions.get(uid) ?? { language: "ru", screen: "menu" };
}

export function setSession(uid: string, patch: Partial<UserSession>): UserSession {
  const next = { ...getSession(uid), ...patch };
  sessions.set(uid, next);
  return next;
}
