import { callGemini } from "../integrations/ai/gemini.js";
import { CONSULTANT_SYSTEM_PROMPT } from "./prompts.js";
import { knowledgeBase } from "./knowledge-base.js";
import {
  buildStageHint,
  ensureForwardReply,
  isCatalogQuestion,
  isNudgeMessage,
  resolveNextStage,
} from "./stage-guide.js";
import type { Conversation, EngineResponse, QualificationFields } from "../types/index.js";
import { EMPTY_QUALIFICATION } from "../types/index.js";

function buildUserPrompt(opts: {
  conversation: Conversation;
  userMessage: string;
  emotionHints: string[];
  history: string;
}): string {
  const { conversation, userMessage, emotionHints, history } = opts;
  const catalog = knowledgeBase.formatForPrompt();

  const stageHint = buildStageHint(conversation.fields, conversation.stage);
  const userNote = isNudgeMessage(userMessage)
    ? "Клиент ждёт продолжения («что дальше») — продолжи консультацию, извинись кратко и задай следующий вопрос."
    : isCatalogQuestion(userMessage)
      ? "Клиент хочет увидеть каталог сразу — объясни, что подберёшь точнее после пары вопросов, и задай текущий вопрос."
      : "";

  return `КАТАЛОГ ПОДАРКОВ (используй ТОЛЬКО эти ID):
${catalog}

ТЕКУЩЕЕ СОСТОЯНИЕ:
Этап: ${conversation.stage}
Собранные поля: ${JSON.stringify(conversation.fields, null, 2)}
Lead score: ${conversation.leadScore}

${stageHint}
${userNote ? `\nСИГНАЛ: ${userNote}` : ""}

АНАЛИЗ ЭМОЦИЙ:
${emotionHints.length ? emotionHints.join("\n") : "нейтрально"}

ИСТОРИЯ ДИАЛОГА:
${history || "(начало диалога)"}

НОВОЕ СООБЩЕНИЕ КЛИЕНТА:
${userMessage}

Ответь JSON согласно инструкции. Поле reply ОБЯЗАНО заканчиваться вопросом (кроме isComplete=true).`;
}

function mergeFields(current: QualificationFields, patch: Partial<QualificationFields>): QualificationFields {
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    const key = k as keyof QualificationFields;
    if (v && String(v).trim()) {
      const key = k as keyof QualificationFields;
      if (key === "personalityType") {
        next.personalityType = String(v).trim() as QualificationFields["personalityType"];
      } else {
        next[key] = String(v).trim() as QualificationFields[typeof key];
      }
    }
  }
  return next;
}

function parseEngineResponse(raw: string): EngineResponse {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const data = JSON.parse(cleaned) as Record<string, unknown>;
  const fields = (data.fields ?? {}) as Partial<QualificationFields>;
  const stage = Math.min(10, Math.max(1, Number(data.stage) || 1));

  return {
    reply: String(data.reply ?? "Понял. Давайте продолжим."),
    stage: stage as EngineResponse["stage"],
    fields,
    personalityType: (data.personalityType as EngineResponse["personalityType"]) ?? fields.personalityType ?? "",
    leadScore: Math.min(100, Math.max(0, Number(data.leadScore) || 50)),
    leadScoreBand: "interested",
    recommendedGiftIds: Array.isArray(data.recommendedGiftIds)
      ? data.recommendedGiftIds.map(String)
      : fields.recommendedGiftId
        ? [fields.recommendedGiftId]
        : [],
    emotion: String(data.emotion ?? ""),
    isComplete: Boolean(data.isComplete),
  };
}

export class QualificationEngine {
  async process(opts: {
    conversation: Conversation;
    userMessage: string;
    emotionHints: string[];
    history: string;
  }): Promise<EngineResponse> {
    const userPrompt = buildUserPrompt(opts);
    const raw = await callGemini({
      system: CONSULTANT_SYSTEM_PROMPT,
      user: userPrompt,
      json: true,
    });

    try {
      const parsed = parseEngineResponse(raw);
      const merged = mergeFields(opts.conversation.fields, parsed.fields);
      const stage = resolveNextStage(merged, parsed.stage);
      parsed.stage = stage;
      parsed.reply = ensureForwardReply(parsed.reply, stage, merged, parsed.isComplete);
      return parsed;
    } catch {
      return {
        reply: raw.slice(0, 1500),
        stage: opts.conversation.stage,
        fields: {},
        personalityType: "",
        leadScore: opts.conversation.leadScore || 50,
        leadScoreBand: opts.conversation.leadScoreBand,
        recommendedGiftIds: [],
        emotion: "",
        isComplete: false,
      };
    }
  }

  mergeFields = mergeFields;
  emptyFields = () => ({ ...EMPTY_QUALIFICATION });
}

export const qualificationEngine = new QualificationEngine();
