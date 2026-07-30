import type { ConsultationStage, QualificationFields } from "../types/index.js";

const FILLED = (v: string) => Boolean(v?.trim());

/** Какой этап сейчас не закрыт по собранным полям */
export function resolveNextStage(fields: QualificationFields, conversationStage: number): ConsultationStage {
  const fromFields = stageFromFields(fields);
  if (conversationStage > fromFields) return Math.min(10, conversationStage) as ConsultationStage;
  return fromFields;
}

function hasGiftDirection(fields: QualificationFields): boolean {
  return (
    FILLED(fields.recommendedGiftName) ||
    FILLED(fields.recommendedGiftId) ||
    FILLED(fields.catalogGiftInterest)
  );
}

/** Воронка: повод → получатель → сроки → бюджет → эмоция → что дорого → рекомендация → контакты */
function stageFromFields(fields: QualificationFields): ConsultationStage {
  if (!FILLED(fields.occasion)) return 1;
  if (!FILLED(fields.recipient) && !FILLED(fields.relationship)) return 2;
  if (!FILLED(fields.urgency) && !FILLED(fields.eventDate)) return 3;
  if (!FILLED(fields.budget)) return 4;
  if (!FILLED(fields.desiredEmotions)) return 5;
  if (!FILLED(fields.story)) return 6;
  if (!hasGiftDirection(fields)) return 8;
  return 10;
}

export function stageLabel(stage: ConsultationStage): string {
  const labels: Record<number, string> = {
    1: "повод",
    2: "кому из близких мужчин",
    3: "сроки и доставка",
    4: "бюджет",
    5: "желаемая эмоция",
    6: "что особенно дорого",
    8: "краткая рекомендация",
    10: "контакты для менеджера",
  };
  return labels[stage] ?? "";
}

/** Вопрос по этапу — подстраховка, если модель «зависла» */
export function questionForStage(stage: ConsultationStage, fields: QualificationFields): string {
  switch (stage) {
    case 1:
      return "🎂 По какому поводу подарок?";
    case 2:
      return "👔 Кому именно дарите — папе, дедушке, мужу, брату, сыну, другу? Сколько лет?";
    case 3:
      return "📅 К какой дате нужен подарок и в какой город доставлять?";
    case 4:
      return "💰 Какой бюджет закладываете?";
    case 5:
      return "✨ Какую эмоцию хотите вызвать у него этим подарком?";
    case 6:
      return "💛 Что в нём для вас особенно дорого или ценно?";
    case 8:
      return fields.catalogGiftInterest
        ? "☎️ Нажмите кнопку ниже — откроется чат с менеджером, текст заявки уже будет готов."
        : "🎁 Кратко предложу вариант из каталога — затем передам менеджеру.";
    case 10:
      return "☎️ Нажмите кнопку ниже — откроется чат с менеджером, текст заявки уже будет готов.";
    default:
      return "☎️ Нажмите кнопку ниже — откроется чат с менеджером.";
  }
}

export function replyHasQuestion(text: string): boolean {
  return /[?？]/.test(text) || /расскажите|скажите|какой|какая|какие|когда|где|сколько|есть ли|хотите|готовы|можете|оставьте/i.test(text);
}

const NUDGE_RE =
  /что дальше|что далее|и дальше|ну\??$|продолж|двигай|следующ|что у вас|что можете|покажите|какие варианты|что есть|что предлагаете/i;

export function isNudgeMessage(text: string): boolean {
  return NUDGE_RE.test(text.trim());
}

const REPEAT_RE =
  /не понял|не поняла|не понятно|неясно|повтори|повторите|ещ[её] раз|объясни|объясните|что ты имел|что вы имели|переформулируй|скажи иначе|не расслышал/i;

export function isRepeatRequest(text: string): boolean {
  return REPEAT_RE.test(text.trim());
}

const CATALOG_PITCH_RE = /что у вас|что можете|покажите|какие варианты|что есть|что предлагаете|прайс|каталог/i;

export function isCatalogQuestion(text: string): boolean {
  return CATALOG_PITCH_RE.test(text.trim());
}

export function ensureForwardReply(
  reply: string,
  stage: ConsultationStage,
  fields: QualificationFields,
  isComplete: boolean,
): string {
  if (isComplete) return reply.trim();
  const text = reply.trim();
  if (replyHasQuestion(text)) return text;

  const q = questionForStage(stage, fields);
  const bridge = text.endsWith(".") || text.endsWith("!") || text.endsWith("…") ? " " : ". ";
  return `${text}${bridge}${q}`;
}

export function buildStageHint(fields: QualificationFields, conversationStage: number): string {
  const next = resolveNextStage(fields, conversationStage);
  const done: string[] = [];
  if (FILLED(fields.occasion)) done.push("повод ✓");
  if (FILLED(fields.recipient) || FILLED(fields.relationship)) done.push("получатель ✓");
  if (FILLED(fields.urgency) || FILLED(fields.eventDate)) done.push("сроки ✓");
  if (FILLED(fields.budget)) done.push("бюджет ✓");
  if (FILLED(fields.desiredEmotions)) done.push("эмоция ✓");
  if (FILLED(fields.story)) done.push("что дорого ✓");
  if (hasGiftDirection(fields)) done.push("направление подарка ✓");

  const budgetNote =
    next === 4
      ? "\nБЮДЖЕТ: не предлагай готовые вилки — один короткий вопрос."
      : "";

  const emotionNote =
    next === 5
      ? "\nЭМОЦИЯ: один короткий вопрос — удивить, растрогать, вызвать гордость, ностальгию и т.п. Не углубляйся."
      : "";

  const dearNote =
    next === 6
      ? "\nЧТО ДОРОГО: один короткий вопрос про то, что для клиента особенно ценно в этом человеке. Ответ сохрани в story. Не превращай в длинное интервью."
      : "";

  const depthNote =
    "\nНЕ спрашивай про хобби, мечты и длинные истории из жизни сверх этапов 5–6. Подарок всегда для мужчины (папа, дедушка, муж, брат, сын, друг). Если клиент сам написал детали — сохрани в comments/story, но не углубляйся.";

  return `Сейчас этап ${next} (${stageLabel(next)}). Уже собрано: ${done.length ? done.join(", ") : "пока мало"}.
ОБЯЗАТЕЛЬНО задай следующий короткий вопрос по этапу ${next}. Не заканчивай сообщение без вопроса (кроме финала с контактами).
Подсказка вопроса: «${questionForStage(next, fields)}»${budgetNote}${emotionNote}${dearNote}${depthNote}`;
}
