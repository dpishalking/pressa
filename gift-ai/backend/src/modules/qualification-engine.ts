import { callGemini } from "../integrations/ai/gemini.js";
import { logger } from "../logger.js";
import { parseEngineResponse } from "./engine-response-parser.js";
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

Ответь JSON согласно инструкции. Поле reply — не длиннее 700 символов. Поле reply ОБЯЗАНО заканчиваться вопросом (кроме isComplete=true).`;
}

const SHORT_REPLY_HINT =
  "\n\nВАЖНО: предыдущий ответ был слишком длинным. Поле reply — максимум 500 символов. JSON должен быть полным и валидным.";

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

function finalizeResponse(
  parsed: ReturnType<typeof parseEngineResponse>,
  conversation: Conversation,
): ReturnType<typeof parseEngineResponse> {
  const merged = mergeFields(conversation.fields, parsed.fields);
  const stage = resolveNextStage(merged, parsed.stage);
  parsed.stage = stage;
  parsed.reply = ensureForwardReply(parsed.reply, stage, merged, parsed.isComplete);
  return parsed;
}

function fallbackResponse(conversation: Conversation): ReturnType<typeof parseEngineResponse> {
  const stage = resolveNextStage(conversation.fields, conversation.stage);
  const reply = ensureForwardReply("Понял. Давайте продолжим.", stage, conversation.fields, false);
  return {
    reply,
    stage,
    fields: {},
    personalityType: "",
    leadScore: conversation.leadScore || 50,
    leadScoreBand: conversation.leadScoreBand,
    recommendedGiftIds: [],
    emotion: "",
    isComplete: false,
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
    const attempts = [userPrompt, userPrompt + SHORT_REPLY_HINT];

    for (let i = 0; i < attempts.length; i++) {
      const { text: raw, finishReason } = await callGemini({
        system: CONSULTANT_SYSTEM_PROMPT,
        user: attempts[i],
        json: true,
      });

      try {
        const parsed = parseEngineResponse(raw);
        return finalizeResponse(parsed, opts.conversation);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "parse error";
        logger.warn("Engine response parse failed", {
          attempt: i + 1,
          finishReason,
          error: msg,
          preview: raw.slice(0, 200),
        });
        if (i < attempts.length - 1) continue;
      }
    }

    return fallbackResponse(opts.conversation);
  }

  mergeFields = mergeFields;
  emptyFields = () => ({ ...EMPTY_QUALIFICATION });
}

export const qualificationEngine = new QualificationEngine();
