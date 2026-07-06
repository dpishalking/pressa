import type { EvaluationResult } from "./types.js";

export interface ReconcileOpts {
  /** Session ended via «Завершить» while still active (not auto lost/sale). */
  manuallyFinished?: boolean;
}

const NONSENSE_REPLY =
  /^(ок(ей)?|да|нет|хорошо|всё\s+будет\s+хорошо|все\s+будет\s+хорошо|понятно|спасибо|ладно|угу|ага|отлично|супер|норм)[!.?\s]*$/iu;

const STRENGTH_EVIDENCE: Array<{ claim: RegExp; evidence: RegExp }> = [
  { claim: /возражен/i, evidence: /возраж|сомнен|дорог|подума|не\s+увер|понимаю/i },
  { claim: /продукт|предлож|рекоменд/i, evidence: /газет|архив|репродук|подар|комплект|журнал|оригинал|вариант/i },
  { claim: /визуал|фото/i, evidence: /фото|показ|визуал|отправ|пример/i },
  { claim: /уточн|вопрос|спросил|квалификац/i, evidence: /\?|уточн|подскаж|какой|когда|где|сколько|интерес|повод|получ/i },
  { claim: /дат|архив|год\s+рожд/i, evidence: /дат|год|архив|числ|месяц/i },
  { claim: /цен|расч|достав/i, evidence: /руб|₽|цен|стоим|достав|итого|срок/i },
  { claim: /эмпат|поздрав/i, evidence: /поздрав|рад|юбил|важн|особен/i },
];

function filterStrengths(strengths: string[], managerLower: string): string[] {
  return strengths.filter((s) => {
    for (const { claim, evidence } of STRENGTH_EVIDENCE) {
      if (claim.test(s) && !evidence.test(managerLower)) return false;
    }
    return true;
  });
}

function isWeakManagerReply(managerTexts: string[]): boolean {
  if (managerTexts.length === 0) return true;
  if (managerTexts.length > 2) return false;

  const combined = managerTexts.join(" ").trim();
  if (combined.length < 50) return true;
  return managerTexts.some((t) => NONSENSE_REPLY.test(t.trim()));
}

function defaultExampleReply(clientContext: string): string {
  if (/дат|год|архив|юбил|рожд/i.test(clientContext)) {
    return "Поздравляю с юбилеем! Подскажите, пожалуйста, точную дату рождения — день, месяц и год. Тогда проверю архив и предложу подарок, который её растрогает.";
  }
  return "Спасибо за обращение! Расскажите, пожалуйста, для кого подарок и какой повод — так подберу что-то по-настоящему особенное.";
}

function isTruncatedTip(tip: string): boolean {
  const t = tip.trim();
  if (!t) return true;
  return !/[.!?]$/.test(t);
}

function ensureCompleteTip(result: EvaluationResult, clientLastText: string): void {
  const tip =
    result.betterReplies[0]?.suggestion?.trim() ||
    result.exampleNextMessage?.trim() ||
    "";
  if (!isTruncatedTip(tip)) return;

  const replacement = defaultExampleReply(clientLastText);
  result.exampleNextMessage = replacement;
  if (result.betterReplies[0]) {
    result.betterReplies[0] = { ...result.betterReplies[0], suggestion: replacement };
  }
}

/**
 * Post-process LLM evaluation so strengths and finalResult match actual manager messages.
 */
export function reconcileEvaluationWithHistory(
  evaluation: EvaluationResult,
  history: Array<{ author: string; text: string }>,
  opts: ReconcileOpts = {},
): EvaluationResult {
  const result: EvaluationResult = {
    ...evaluation,
    strengths: [...(evaluation.strengths ?? [])],
    mistakes: [...(evaluation.mistakes ?? [])],
    betterReplies: [...(evaluation.betterReplies ?? [])],
  };

  const managerTexts = history
    .filter((m) => m.author === "employee")
    .map((m) => m.text.trim())
    .filter(Boolean);
  const managerLower = managerTexts.join("\n").toLowerCase();
  const lastAuthor = history.length > 0 ? history[history.length - 1].author : null;
  const clientLastText =
    [...history].reverse().find((m) => m.author === "client")?.text ?? "";
  const clientContext = history
    .filter((m) => m.author === "client")
    .map((m) => m.text)
    .join(" ");

  if (managerTexts.length === 0) {
    result.strengths = [];
    result.totalScore = Math.min(result.totalScore, 10);
    result.finalResult = "lost";
    if (!result.mistakes.some((m) => /не ответил|молчал/i.test(m))) {
      result.mistakes.unshift("Менеджер не ответил клиенту");
    }
    ensureCompleteTip(result, clientContext);
    return result;
  }

  result.strengths = filterStrengths(result.strengths, managerLower);

  const weakReply = isWeakManagerReply(managerTexts);
  if (weakReply) {
    result.strengths = [];
    result.totalScore = Math.min(result.totalScore, 35);
    if (!result.mistakes.some((m) => /не по теме|шаблон|игнорир|не ответил/i.test(m))) {
      result.mistakes.unshift("Ответ не по теме — клиент ждёт помощь с подарком");
    }
  }

  if (opts.manuallyFinished && lastAuthor === "client" && result.finalResult === "abandoned") {
    result.finalResult = weakReply || result.totalScore < 45 ? "lost" : "thinking";
  }

  if (lastAuthor === "client" && managerTexts.length <= 1 && result.finalResult === "abandoned") {
    result.finalResult = "lost";
  }

  ensureCompleteTip(result, clientContext);

  return result;
}
