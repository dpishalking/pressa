import type { BotLanguage } from "./languages.js";

export type BotScreen = "menu" | "catalog" | "consult";

export type UserSession = {
  language: BotLanguage;
  screen: BotScreen;
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
