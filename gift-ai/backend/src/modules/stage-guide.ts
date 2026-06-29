import type { ConsultationStage, QualificationFields } from "../types/index.js";

const FILLED = (v: string) => Boolean(v?.trim());

/** Какой этап сейчас не закрыт по собранным полям */
export function resolveNextStage(fields: QualificationFields, conversationStage: number): ConsultationStage {
  const fromFields = stageFromFields(fields);
  // Не откатываемся назад, если диалог уже продвинулся дальше (контекст в переписке есть).
  if (conversationStage > fromFields) return Math.min(10, conversationStage) as ConsultationStage;
  return fromFields;
}

function stageFromFields(fields: QualificationFields): ConsultationStage {
  if (!FILLED(fields.occasion)) return 1;
  if (!FILLED(fields.recipient) && !FILLED(fields.relationship)) return 2;
  if (!FILLED(fields.urgency) && !FILLED(fields.eventDate)) return 3;
  if (!FILLED(fields.budget)) return 4;
  if (!FILLED(fields.desiredEmotions)) return 5;
  if (!FILLED(fields.interests) && !FILLED(fields.hobbies) && !FILLED(fields.story)) return 6;
  if (!FILLED(fields.recommendedGiftName)) return 8;
  if (!FILLED(fields.phone) && !FILLED(fields.clientName)) return 10;
  return 8;
}

export function stageLabel(stage: ConsultationStage): string {
  const labels: Record<number, string> = {
    1: "повод",
    2: "кому подарок",
    3: "сроки и доставка",
    4: "бюджет",
    5: "эмоции от подарка",
    6: "интересы и история",
    7: "тип личности (внутренний)",
    8: "рекомендация подарка",
    9: "сравнение вариантов",
    10: "контакты для менеджера",
  };
  return labels[stage] ?? "";
}

/** Вопрос по этапу — подстраховка, если модель «зависла» */
export function questionForStage(stage: ConsultationStage, fields: QualificationFields): string {
  switch (stage) {
    case 1:
      return "🎂 По какому поводу выбираете подарок?";
    case 2:
      return "👤 Расскажите, кому подарок — кем вам приходится и сколько лет?";
    case 3:
      return "📅 Когда нужен подарок и в какой город доставлять?";
    case 4:
      return "💰 Какой бюджет примерно закладываете?";
    case 5:
      return "❤️ Что получатель должен почувствовать, когда откроет подарок?";
    case 6:
      return "🎯 Чем увлекается, чем гордится, что для него важно в жизни?";
    case 8:
      return "🎁 Хотите, предложу вариант из каталога — или сначала расскажете ещё пару деталей?";
    case 9:
      return "⚖️ Какой из вариантов ближе — или рассказать разницу подробнее?";
    case 10:
      return "☎️ Оставьте имя и телефон — передам менеджеру, он поможет оформить.";
    default:
      return "💬 Расскажите ещё немного — я слушаю.";
  }
}

export function replyHasQuestion(text: string): boolean {
  return /[?？]/.test(text) || /расскажите|скажите|какой|какая|какие|когда|где|сколько|чем|что именно|есть ли|хотите|готовы|можете|оставьте/i.test(text);
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

/**
 * Каждый ответ (кроме финала) должен вести клиента дальше — с вопросом.
 */
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
  if (FILLED(fields.desiredEmotions)) done.push("эмоции ✓");
  if (FILLED(fields.interests) || FILLED(fields.hobbies)) done.push("интересы ✓");
  if (FILLED(fields.recommendedGiftName)) done.push("подарок ✓");

  const budgetNote =
    next === 4
      ? "\nБЮДЖЕТ: не предлагай готовые вилки и примеры сумм — только один короткий открытый вопрос."
      : "";

  return `Сейчас этап ${next} (${stageLabel(next)}). Уже собрано: ${done.length ? done.join(", ") : "пока мало"}.
ОБЯЗАТЕЛЬНО задай следующий вопрос по этапу ${next}. Не заканчивай сообщение без вопроса.
Подсказка вопроса: «${questionForStage(next, fields)}»${budgetNote}`;
}
