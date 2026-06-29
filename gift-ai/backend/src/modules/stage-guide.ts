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

/** Короткая воронка: повод → получатель → сроки → бюджет → (рекомендация) → контакты */
function stageFromFields(fields: QualificationFields): ConsultationStage {
  if (!FILLED(fields.occasion)) return 1;
  if (!FILLED(fields.recipient) && !FILLED(fields.relationship)) return 2;
  if (!FILLED(fields.urgency) && !FILLED(fields.eventDate)) return 3;
  if (!FILLED(fields.budget)) return 4;
  if (!hasGiftDirection(fields)) return 8;
  if (!FILLED(fields.phone) && !FILLED(fields.clientName)) return 10;
  return 10;
}

export function stageLabel(stage: ConsultationStage): string {
  const labels: Record<number, string> = {
    1: "повод",
    2: "кому подарок",
    3: "сроки и доставка",
    4: "бюджет",
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
      return "👤 Кому дарите и сколько лет?";
    case 3:
      return "📅 К какой дате нужен подарок и в какой город доставлять?";
    case 4:
      return "💰 Какой бюджет закладываете?";
    case 8:
      return fields.catalogGiftInterest
        ? "☎️ Оставьте имя и телефон — передам менеджеру, он уточнит детали и оформит заказ."
        : "🎁 Кратко предложу вариант из каталога. Оставьте имя и телефон — менеджер свяжется и доработает идею.";
    case 10:
      return "☎️ Оставьте имя и телефон — передам менеджеру, он свяжется с вами.";
    default:
      return "☎️ Оставьте имя и телефон — передам менеджеру.";
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
  if (hasGiftDirection(fields)) done.push("направление подарка ✓");

  const budgetNote =
    next === 4
      ? "\nБЮДЖЕТ: не предлагай готовые вилки — один короткий вопрос."
      : "";

  const depthNote =
    "\nНЕ спрашивай про хобби, истории из жизни, мечты, увлечения и «что она любит» — это задаст менеджер. Если клиент сам написал — сохрани в comments, но не углубляйся.";

  return `Сейчас этап ${next} (${stageLabel(next)}). Уже собрано: ${done.length ? done.join(", ") : "пока мало"}.
ОБЯЗАТЕЛЬНО задай следующий короткий вопрос по этапу ${next}. Не заканчивай сообщение без вопроса (кроме финала с контактами).
Подсказка вопроса: «${questionForStage(next, fields)}»${budgetNote}${depthNote}`;
}
