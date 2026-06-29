import type { ConversationMessage, QualificationFields } from "../types/index.js";

const FILLED = (v: string) => Boolean(v?.trim());

function joinUserText(messages: ConversationMessage[], latest?: string): string {
  const parts = messages.filter((m) => m.role === "user").map((m) => m.content.trim());
  if (latest?.trim()) parts.push(latest.trim());
  return parts.join("\n");
}

function pickOccasion(text: string): string {
  const lower = text.toLowerCase();
  if (/день рождения|\bдр\b|юбилей/.test(lower)) {
    const age = text.match(/(\d{1,3})\s*лет/);
    return age ? `день рождения, ${age[1]} лет` : "день рождения";
  }
  if (/годовщин/.test(lower)) return "годовщина";
  if (/свадьб/.test(lower)) return "свадьба";
  if (/новый год|\bнг\b/.test(lower)) return "Новый год";
  if (/8\s*марта/.test(lower)) return "8 марта";
  if (/23\s*феврал/.test(lower)) return "23 февраля";
  if (/выпускн/.test(lower)) return "выпускной";
  if (/корпоратив/.test(lower)) return "корпоратив";
  if (/рождени[ея]\s+реб/.test(lower)) return "рождение ребёнка";
  if (/предложени/.test(lower)) return "предложение";
  return "";
}

function pickRelationship(text: string): string {
  const rules: [RegExp, string][] = [
    [/мам[аеуыёй]/i, "мама"],
    [/пап[аеуыёй]/i, "папа"],
    [/бабушк/i, "бабушка"],
    [/дедушк/i, "дедушка"],
    [/жен[аеуыёй]/i, "жена"],
    [/муж[аеуёй]/i, "муж"],
    [/дочь|дочк/i, "дочь"],
    [/сын[аауёй]|сыну/i, "сын"],
    [/подруг/i, "подруга"],
    [/друг[аеуёй]/i, "друг"],
    [/коллег/i, "коллега"],
  ];
  const lower = text.toLowerCase();
  for (const [re, label] of rules) {
    if (re.test(lower)) return label;
  }
  return "";
}

function pickRecipientAge(text: string): string {
  const m = text.match(/(\d{1,3})\s*лет/);
  return m ? m[1] : "";
}

function pickInterests(text: string): Partial<QualificationFields> {
  const patch: Partial<QualificationFields> = {};
  const chunks: string[] = [];

  if (/кмс|кандидат\s+в\s+мастера/i.test(text)) chunks.push("КМС");
  if (/санк|санки|саночн/i.test(text)) chunks.push("санки");
  if (/спорт/i.test(text)) chunks.push("спорт");

  if (chunks.length) {
    patch.hobbies = chunks.join(", ");
    patch.interests = chunks.join(", ");
  }
  if (/кмс|санк/i.test(text)) {
    patch.story = text.trim().slice(0, 300);
  }
  return patch;
}

/** Достаём пропущенные поля из всей переписки — если Gemini их не сохранил в JSON. */
export function recoverFieldsFromTranscript(
  messages: ConversationMessage[],
  current: QualificationFields,
  latestUserText?: string,
): Partial<QualificationFields> {
  const all = joinUserText(messages, latestUserText);
  if (!all.trim()) return {};

  const patch: Partial<QualificationFields> = {};

  if (!FILLED(current.occasion)) {
    const occasion = pickOccasion(all);
    if (occasion) patch.occasion = occasion;
  }

  if (!FILLED(current.relationship)) {
    const relationship = pickRelationship(all);
    if (relationship) patch.relationship = relationship;
  }

  if (!FILLED(current.recipient) && patch.relationship) {
    patch.recipient = patch.relationship;
  }

  if (!FILLED(current.recipientAge)) {
    const age = pickRecipientAge(all);
    if (age) patch.recipientAge = age;
  }

  if (!FILLED(current.recipientGender) && /\bу не[её]\b|\bей\b|\bнеё\b|\bженщин/i.test(all)) {
    patch.recipientGender = "женщина";
  }
  if (!FILLED(current.recipientGender) && /\bу него\b|\bему\b|\bмужчин/i.test(all)) {
    patch.recipientGender = "мужчина";
  }

  if (!FILLED(current.interests) || !FILLED(current.hobbies)) {
    const interests = pickInterests(latestUserText?.trim() || all);
    if (!FILLED(current.interests) && interests.interests) patch.interests = interests.interests;
    if (!FILLED(current.hobbies) && interests.hobbies) patch.hobbies = interests.hobbies;
    if (!FILLED(current.story) && interests.story) patch.story = interests.story;
  }

  return patch;
}
