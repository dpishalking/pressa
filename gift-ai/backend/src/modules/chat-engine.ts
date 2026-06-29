import { randomUUID } from "node:crypto";
import { getDb } from "../db/client.js";
import { crmAdapter } from "../integrations/crm/factory.js";
import { logger } from "../logger.js";
import { conversationMemory } from "./conversation-memory.js";
import { emotionAnalyzer } from "./emotion-analyzer.js";
import { knowledgeBase } from "./knowledge-base.js";
import { leadScoring, recommendationEngine, scoreToBand } from "./lead-scoring.js";
import { qualificationEngine } from "./qualification-engine.js";
import { summaryGenerator } from "./summary-generator.js";
import type { Conversation, LeadPayload, QualificationFields } from "../types/index.js";

const GREETING =
  "Привет! Я помогу подобрать необычный подарок — такой, от которого действительно захватывает дух.\n\nДля начала — по какому поводу выбираете подарок?";

export class ChatEngine {
  async start(channel: string, channelUserId: string, telegramUsername?: string): Promise<{ reply: string; conversationId: string }> {
    const conv = conversationMemory.reset(channel, channelUserId);
    if (telegramUsername) {
      conversationMemory.update(conv.id, {
        fields: { ...conv.fields, telegram: `@${telegramUsername.replace(/^@/, "")}` },
      });
    }
    conversationMemory.addMessage(conv.id, "assistant", GREETING);
    return { reply: GREETING, conversationId: conv.id };
  }

  async handleMessage(opts: {
    channel: string;
    channelUserId: string;
    text: string;
    telegramUsername?: string;
  }): Promise<{ reply: string; conversationId: string; isComplete: boolean }> {
    const { channel, channelUserId, text, telegramUsername } = opts;
    let conv = conversationMemory.getOrCreate(channel, channelUserId);

    if (telegramUsername && !conv.fields.telegram) {
      conv = conversationMemory.update(conv.id, {
        fields: { ...conv.fields, telegram: `@${telegramUsername.replace(/^@/, "")}` },
      })!;
    }

    conversationMemory.addMessage(conv.id, "user", text);

    const emotion = emotionAnalyzer.analyze(text);
    const history = conversationMemory.formatTranscript(conv.id);

    const engine = await qualificationEngine.process({
      conversation: conv,
      userMessage: text,
      emotionHints: emotion.hints,
      history,
    });

    const mergedFields = qualificationEngine.mergeFields(conv.fields, {
      ...engine.fields,
      personalityType: engine.personalityType || engine.fields.personalityType || conv.fields.personalityType,
    });

    const gifts = knowledgeBase.listGifts();
    const matched = recommendationEngine.match(gifts, mergedFields, engine.recommendedGiftIds);
    if (matched[0] && !mergedFields.recommendedGiftName) {
      mergedFields.recommendedGiftId = matched[0].id;
      mergedFields.recommendedGiftName = matched[0].name;
      if (!mergedFields.recommendationReason) {
        mergedFields.recommendationReason = matched[0].description.slice(0, 300);
      }
      if (matched.length > 1 && !mergedFields.alternatives) {
        mergedFields.alternatives = matched
          .slice(1)
          .map((g) => g.name)
          .join(", ");
      }
    }

    const leadScore = leadScoring.compute(mergedFields, {
      modelScore: engine.leadScore,
      hasRecommendation: Boolean(mergedFields.recommendedGiftName),
      emotionTone: emotion.tone,
      stage: engine.stage,
    });
    const leadScoreBand = scoreToBand(leadScore);

    let isComplete = engine.isComplete;
    let summary = conv.summary;
    let bitrixLeadId = conv.bitrixLeadId;

    if (isComplete) {
      const transcript = conversationMemory.formatTranscript(conv.id);
      const payload = this.buildLeadPayload(conv, mergedFields, leadScore, leadScoreBand, transcript, summary);
      summary = await summaryGenerator.generate({ ...payload, aiSummary: "" });
      payload.aiSummary = summary;

      const crm = await crmAdapter.createLead(payload);
      bitrixLeadId = crm.leadId;
      this.storeLead(payload, crm.leadId, crmAdapter.name);

      conversationMemory.update(conv.id, {
        stage: 10,
        fields: mergedFields,
        leadScore,
        leadScoreBand,
        status: "completed",
        summary,
        bitrixLeadId,
      });
    } else {
      conversationMemory.update(conv.id, {
        stage: engine.stage,
        fields: mergedFields,
        leadScore,
        leadScoreBand,
      });
    }

    conversationMemory.addMessage(conv.id, "assistant", engine.reply);

    return { reply: engine.reply, conversationId: conv.id, isComplete };
  }

  private buildLeadPayload(
    conv: Conversation,
    fields: QualificationFields,
    leadScore: number,
    leadScoreBand: ReturnType<typeof scoreToBand>,
    fullTranscript: string,
    aiSummary: string,
  ): LeadPayload {
    return {
      ...fields,
      conversationId: conv.id,
      channel: conv.channel,
      channelUserId: conv.channelUserId,
      leadScore,
      leadScoreBand,
      fullTranscript,
      aiSummary,
      recommendedGiftId: fields.recommendedGiftId,
    };
  }

  private storeLead(payload: LeadPayload, crmLeadId: string | null, crmProvider: string) {
    const id = randomUUID();
    getDb()
      .prepare(
        `INSERT INTO leads (id, conversation_id, payload_json, crm_provider, crm_lead_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, payload.conversationId, JSON.stringify(payload), crmProvider, crmLeadId, new Date().toISOString());
    logger.info("Lead stored", { id, conversationId: payload.conversationId, crmLeadId });
  }

  getConversation(id: string) {
    const conv = conversationMemory.getById(id);
    if (!conv) return null;
    return {
      ...conv,
      messages: conversationMemory.getMessages(id),
      transcript: conversationMemory.formatTranscript(id),
    };
  }
}

export const chatEngine = new ChatEngine();
