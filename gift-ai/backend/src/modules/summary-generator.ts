import { callGemini } from "../integrations/ai/gemini.js";
import type { LeadPayload } from "../types/index.js";
import { bandLabel } from "./lead-scoring.js";

const SUMMARY_PROMPT = `Ты — аналитик продаж. Составь краткое саммари диалога для менеджера (5–8 предложений).
Укажи: повод, получателя, эмоциональную цель, бюджет, рекомендованный подарок и почему, готовность к покупке, что уточнить менеджеру.
Пиши по-русски, деловым языком, без воды.`;

export class SummaryGenerator {
  async generate(payload: LeadPayload): Promise<string> {
    const user = `ДАННЫЕ ЛИДА:
${JSON.stringify(
  {
    ...payload,
    leadScoreLabel: bandLabel(payload.leadScoreBand),
  },
  null,
  2,
)}

ПЕРЕПИСКА:
${payload.fullTranscript}`;

    try {
      const { text } = await callGemini({ system: SUMMARY_PROMPT, user });
      return text;
    } catch {
      return [
        `Клиент: ${payload.clientName || "не указан"}. Повод: ${payload.occasion || "—"}.`,
        `Получатель: ${payload.recipient || "—"} (${payload.relationship || "—"}).`,
        `Бюджет: ${payload.budget || "—"}. Эмоции: ${payload.desiredEmotions || "—"}.`,
        `Рекомендация: ${payload.recommendedGiftName || "—"}. ${payload.recommendationReason || ""}`,
        `Lead score: ${payload.leadScore} (${bandLabel(payload.leadScoreBand)}).`,
      ].join(" ");
    }
  }
}

export const summaryGenerator = new SummaryGenerator();
