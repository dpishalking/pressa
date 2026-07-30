import { randomUUID } from "node:crypto";
import { getDb } from "../db/client.js";
import { crmAdapter } from "../integrations/crm/factory.js";
import { logger } from "../logger.js";
import { greeting as buildGreeting, isConsultGreeting } from "./bot-i18n.js";
import { conversationMemory } from "./conversation-memory.js";
import { emotionAnalyzer } from "./emotion-analyzer.js";
import { isTruncatedReply, sanitizeAssistantMessage } from "./engine-response-parser.js";
import { knowledgeBase } from "./knowledge-base.js";
import { normalizeLanguage } from "./languages.js";
import { leadScoring, recommendationEngine, scoreToBand } from "./lead-scoring.js";
import { recoverFieldsFromTranscript } from "./field-recovery.js";
import { qualificationEngine } from "./qualification-engine.js";
import { defaultNameForExternalId } from "./product-catalog.js";
import {
  buildManagerHandoff,
  hasHandoffBasics,
  stripPhoneCollectionAsk,
  stripManagerContactMentions,
  type ManagerHandoff,
} from "./manager-handoff.js";
import { resolveNextStage } from "./stage-guide.js";
import { buildCatalogCardDescription } from "./catalog-copy.js";
import { getLocalizedCatalogCard, localizedProductName, PRICE_ON_REQUEST } from "./product-i18n.js";
import type { BotLanguage } from "./languages.js";
import { isRepeatRequest } from "./stage-guide.js";
import { summaryGenerator } from "./summary-generator.js";
import { recordAnalyticsEvent } from "./analytics.js";
import { formatTelegramContact } from "./telegram-contact.js";
import { cancelHandoffReminders, scheduleHandoffReminders } from "./handoff-reminders.js";
import { enqueueHandoffAdminAlert } from "./handoff-admin-notify.js";
import type { Conversation, LeadPayload, QualificationFields } from "../types/index.js";

function withTelegramContact(
  fields: QualificationFields,
  channelUserId: string,
  telegramUsername?: string,
): QualificationFields {
  const telegram = formatTelegramContact({
    username: telegramUsername,
    telegram: fields.telegram,
    channelUserId,
  });
  return telegram ? { ...fields, telegram } : fields;
}

function formatPriceLabel(min: number, max: number, lang: BotLanguage = "ru"): string {
  if (!min && !max) return PRICE_ON_REQUEST[lang];
  if (min && max && min !== max) return `${min}–${max} ₽`;
  return `${max || min} ₽`;
}

export class ChatEngine {
  resetMenu(channel: string, channelUserId: string, telegramUsername?: string): { conversationId: string } {
    const conv = conversationMemory.reset(channel, channelUserId);
    cancelHandoffReminders({ channel, channelUserId });
    const fields = withTelegramContact(conv.fields, channelUserId, telegramUsername);
    if (fields.telegram !== conv.fields.telegram) {
      conversationMemory.update(conv.id, { fields });
    }
    recordAnalyticsEvent({
      channel,
      channelUserId,
      eventType: "bot_start",
      conversationId: conv.id,
    });
    return { conversationId: conv.id };
  }

  beginConsultation(opts: {
    channel: string;
    channelUserId: string;
    language?: string;
    catalogGiftExternalId?: string;
    telegramUsername?: string;
    giftForMan?: boolean;
  }): { reply: string; conversationId: string; stage: number } {
    const language = normalizeLanguage(opts.language);
    const conv = conversationMemory.reset(opts.channel, opts.channelUserId);
    cancelHandoffReminders({ channel: opts.channel, channelUserId: opts.channelUserId });

    const gifts = knowledgeBase.listGifts();
    const catalogGift = opts.catalogGiftExternalId
      ? gifts.find((g) => g.externalId === opts.catalogGiftExternalId || g.id === opts.catalogGiftExternalId)
      : undefined;

    const fields: Partial<QualificationFields> = {
      uiLanguage: language,
      recipientGender: "мужчина",
      catalogGiftInterest: catalogGift?.name ?? "",
      comments: catalogGift ? `Выбрал из каталога: ${catalogGift.name}` : "",
    };

    conversationMemory.update(conv.id, {
      fields: withTelegramContact(
        qualificationEngine.mergeFields(conv.fields, fields),
        opts.channelUserId,
        opts.telegramUsername,
      ),
    });

    const reply = buildGreeting(language, catalogGift?.name, opts.giftForMan);
    conversationMemory.addMessage(conv.id, "assistant", reply);
    recordAnalyticsEvent({
      channel: opts.channel,
      channelUserId: opts.channelUserId,
      eventType: "consult_begin",
      conversationId: conv.id,
      metadata: { catalogGift: catalogGift?.name, giftForMan: opts.giftForMan ?? false },
    });
    return { reply, conversationId: conv.id, stage: 1 };
  }

  listCatalog(lang: BotLanguage = "ru"): Array<{
    id: string;
    externalId: string;
    name: string;
    description: string;
    priceLabel: string;
    emotions: string[];
  }> {
    return knowledgeBase.listGifts().map((g) => {
      const localized = getLocalizedCatalogCard(g.externalId, lang);
      const fallbackName = defaultNameForExternalId(g.externalId) ?? g.name;
      return {
        id: g.id,
        externalId: g.externalId,
        name: localized?.name ?? localizedProductName(g.externalId, lang, fallbackName),
        description:
          localized?.description ??
          buildCatalogCardDescription({
            description: g.description,
            cases: g.cases,
            reviews: g.reviews,
            suitableFor: g.suitableFor,
          }),
        priceLabel: formatPriceLabel(g.priceMin, g.priceMax, lang),
        emotions: g.emotions,
      };
    });
  }

  getChatStatus(channel: string, channelUserId: string): {
    inConsultation: boolean;
    stage: number;
    language: string;
    conversationId: string;
  } {
    const conv = conversationMemory.getOrCreate(channel, channelUserId);
    const messages = conversationMemory.getMessages(conv.id);
    const inConsultation = messages.some((m) => m.role === "assistant");
    return {
      inConsultation,
      stage: conv.stage,
      language: conv.fields.uiLanguage || "ru",
      conversationId: conv.id,
    };
  }

  async switchConsultationGift(opts: {
    channel: string;
    channelUserId: string;
    catalogGiftExternalId: string;
    telegramUsername?: string;
  }): Promise<{
    reply: string;
    conversationId: string;
    stage: number;
    recommendedGift: { id: string; externalId: string; name: string };
    managerHandoff: ManagerHandoff;
  }> {
    const { channel, channelUserId, catalogGiftExternalId, telegramUsername } = opts;
    const conv = conversationMemory.getOrCreate(channel, channelUserId);
    const messages = conversationMemory.getMessages(conv.id);
    if (!messages.some((m) => m.role === "assistant")) {
      throw new Error("Консультация не начата");
    }

    const gift = knowledgeBase
      .listGifts()
      .find((g) => g.externalId === catalogGiftExternalId || g.id === catalogGiftExternalId);
    if (!gift) throw new Error("Подарок не найден в каталоге");

    const lang = normalizeLanguage(conv.fields.uiLanguage);
    const displayName =
      localizedProductName(gift.externalId, lang, defaultNameForExternalId(gift.externalId) ?? gift.name);
    const pitch =
      getLocalizedCatalogCard(gift.externalId, lang)?.description?.split(/[.!?]/)[0]?.trim() ||
      gift.description.split(/[.!?]/)[0]?.trim() ||
      gift.cases.slice(0, 120);

    let fields = qualificationEngine.mergeFields(conv.fields, {
      recommendedGiftId: gift.externalId || gift.id,
      recommendedGiftName: displayName,
      catalogGiftInterest: displayName,
      recommendationReason: pitch,
      comments: [conv.fields.comments, `Сменил выбор на: ${displayName}`].filter(Boolean).join("; "),
    });

    fields = withTelegramContact(fields, channelUserId, telegramUsername);

    if (!hasHandoffBasics(fields)) {
      throw new Error("Сначала завершите короткий опрос — не хватает данных заявки");
    }

    const managerHandoff = buildManagerHandoff(fields, lang);
    const leadLine =
      lang === "en"
        ? `Great choice! I suggest «${displayName}» — ${pitch}.`
        : `Отличный выбор! Предлагаю «${displayName}» — ${pitch}.`;
    const reply = `${leadLine}\n\n${managerHandoff.prompt}`;

    conversationMemory.addMessage(conv.id, "user", `[выбрал другой подарок из каталога: ${displayName}]`);
    conversationMemory.update(conv.id, {
      stage: 10,
      fields,
      status: "handoff",
    });
    conversationMemory.addMessage(conv.id, "assistant", reply);

    // CRM auto-create disabled: push client to manager button; notify admins instead.
    scheduleHandoffReminders({
      conversationId: conv.id,
      channel,
      channelUserId,
      handoffUrl: managerHandoff.url,
      buttonLabel: managerHandoff.buttonLabel,
      language: lang,
      fields,
    });
    void enqueueHandoffAdminAlert({ channelUserId, fields });

    recordAnalyticsEvent({
      channel,
      channelUserId,
      eventType: "handoff_shown",
      conversationId: conv.id,
      metadata: { gift: displayName },
    });

    return {
      reply,
      conversationId: conv.id,
      stage: 10,
      recommendedGift: { id: gift.id, externalId: gift.externalId, name: displayName },
      managerHandoff,
    };
  }

  getConsultationHandoff(channel: string, channelUserId: string): {
    reply: string;
    stage: number;
    recommendedGift: { id: string; externalId: string; name: string } | null;
    managerHandoff: ManagerHandoff;
  } | null {
    const conv = conversationMemory.getOrCreate(channel, channelUserId);
    if (!hasHandoffBasics(conv.fields)) return null;

    const lang = normalizeLanguage(conv.fields.uiLanguage);
    const managerHandoff = buildManagerHandoff(conv.fields, lang);
    const messages = conversationMemory.getMessages(conv.id);
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const reply = lastAssistant?.content || managerHandoff.prompt;

    const gifts = knowledgeBase.listGifts();
    const recommended = conv.fields.recommendedGiftId
      ? gifts.find(
          (g) => g.id === conv.fields.recommendedGiftId || g.externalId === conv.fields.recommendedGiftId,
        )
      : undefined;

    return {
      reply,
      stage: conv.stage,
      recommendedGift: recommended
        ? { id: recommended.id, externalId: recommended.externalId, name: recommended.name }
        : null,
      managerHandoff,
    };
  }

  /** @deprecated use resetMenu + beginConsultation */
  async start(
    channel: string,
    channelUserId: string,
    telegramUsername?: string,
  ): Promise<{ reply: string; conversationId: string; stage: number }> {
    return this.beginConsultation({ channel, channelUserId, telegramUsername, language: "ru" });
  }

  async handleMessage(opts: {
    channel: string;
    channelUserId: string;
    text: string;
    telegramUsername?: string;
  }): Promise<{
    reply: string;
    conversationId: string;
    isComplete: boolean;
    stage: number;
    recommendedGift: { id: string; externalId: string; name: string } | null;
    managerHandoff?: ManagerHandoff;
    needsMenu?: boolean;
  }> {
    const { channel, channelUserId, text, telegramUsername } = opts;
    let conv = conversationMemory.getOrCreate(channel, channelUserId);

    const messages = conversationMemory.getMessages(conv.id);
    const hasConsultation = messages.some((m) => m.role === "assistant");
    if (!hasConsultation) {
      return {
        reply: "",
        conversationId: conv.id,
        isComplete: false,
        stage: 0,
        recommendedGift: null,
        needsMenu: true,
      };
    }

    const nextFields = withTelegramContact(conv.fields, channelUserId, telegramUsername);
    if (nextFields.telegram !== conv.fields.telegram) {
      conv = conversationMemory.update(conv.id, { fields: nextFields })!;
    }

    conversationMemory.addMessage(conv.id, "user", text);
    recordAnalyticsEvent({
      channel,
      channelUserId,
      eventType: "user_message",
      conversationId: conv.id,
    });

    if (isRepeatRequest(text)) {
      const repeatReply = this.buildRepeatReply(conv.id);
      if (repeatReply) {
        conversationMemory.addMessage(conv.id, "assistant", repeatReply);
        return {
          reply: repeatReply,
          conversationId: conv.id,
          isComplete: false,
          stage: conv.stage,
          recommendedGift: null,
        };
      }
    }

    const emotion = emotionAnalyzer.analyze(text);
    const history = conversationMemory.formatTranscript(conv.id);

    const recovered = recoverFieldsFromTranscript(
      conversationMemory.getMessages(conv.id),
      conv.fields,
      text,
    );
    if (Object.keys(recovered).length) {
      conv =
        conversationMemory.update(conv.id, {
          fields: qualificationEngine.mergeFields(conv.fields, recovered),
        }) ?? conv;
    }

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
    const basicsForRecommend =
      Boolean(mergedFields.desiredEmotions?.trim()) && Boolean(mergedFields.story?.trim());
    const readyForRecommendation =
      basicsForRecommend &&
      (engine.stage >= 8 || Boolean(mergedFields.catalogGiftInterest && engine.stage >= 6));
    const matched = readyForRecommendation
      ? recommendationEngine.match(gifts, mergedFields, engine.recommendedGiftIds)
      : [];
    if (matched[0] && !mergedFields.recommendedGiftName) {
      mergedFields.recommendedGiftId = matched[0].externalId || matched[0].id;
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
    } else if (!mergedFields.recommendedGiftId && engine.recommendedGiftIds[0]) {
      mergedFields.recommendedGiftId = engine.recommendedGiftIds[0];
      const byId = gifts.find(
        (g) => g.externalId === engine.recommendedGiftIds[0] || g.id === engine.recommendedGiftIds[0],
      );
      if (byId && !mergedFields.recommendedGiftName) {
        mergedFields.recommendedGiftName = byId.name;
      }
    }

    const lang = normalizeLanguage(mergedFields.uiLanguage);
    let reply = engine.reply;
    let stage = resolveNextStage(mergedFields, engine.stage);
    let managerHandoff: ManagerHandoff | undefined;

    if (stage === 10 && hasHandoffBasics(mergedFields)) {
      managerHandoff = buildManagerHandoff(mergedFields, lang);
      const cleaned = stripManagerContactMentions(stripPhoneCollectionAsk(reply));
      reply = cleaned ? `${cleaned}\n\n${managerHandoff.prompt}` : managerHandoff.prompt;
      stage = 10;
      recordAnalyticsEvent({
        channel,
        channelUserId,
        eventType: "handoff_shown",
        conversationId: conv.id,
        metadata: { gift: mergedFields.recommendedGiftName },
      });
    }

    const leadScore = leadScoring.compute(mergedFields, {
      modelScore: engine.leadScore,
      hasRecommendation: Boolean(mergedFields.recommendedGiftName),
      emotionTone: emotion.tone,
      stage,
    });
    const leadScoreBand = scoreToBand(leadScore);

    let isComplete = engine.isComplete;
    const summary = conv.summary;
    const bitrixLeadId = conv.bitrixLeadId;

    if (managerHandoff) {
      // CRM auto-create disabled — only reminders + admin notify.
      scheduleHandoffReminders({
        conversationId: conv.id,
        channel,
        channelUserId,
        handoffUrl: managerHandoff.url,
        buttonLabel: managerHandoff.buttonLabel,
        language: lang,
        fields: mergedFields,
      });
      void enqueueHandoffAdminAlert({ channelUserId, fields: mergedFields });
    }

    if (isComplete) {
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
        stage,
        fields: mergedFields,
        leadScore,
        leadScoreBand,
        status: managerHandoff ? "handoff" : "active",
        summary,
        bitrixLeadId,
      });
    }

    conversationMemory.addMessage(conv.id, "assistant", reply);

    const recommended = mergedFields.recommendedGiftId
      ? gifts.find(
          (g) => g.id === mergedFields.recommendedGiftId || g.externalId === mergedFields.recommendedGiftId,
        )
      : undefined;

    return {
      reply,
      conversationId: conv.id,
      isComplete,
      stage: isComplete ? 10 : stage,
      managerHandoff,
      recommendedGift:
        readyForRecommendation && recommended
          ? { id: recommended.id, externalId: recommended.externalId, name: recommended.name }
          : null,
    };
  }

  private buildRepeatReply(conversationId: string): string | null {
    const messages = conversationMemory.getMessages(conversationId);
    for (let i = messages.length - 2; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const cleaned = sanitizeAssistantMessage(m.content);
      if (!cleaned || isConsultGreeting(cleaned) || isTruncatedReply(cleaned)) continue;
      return `Конечно! Повторю:\n\n${cleaned}`;
    }
    return null;
  }

  /** Дозаливает в CRM заявки, которые дошли до handoff, но bitrix_lead_id пустой. */
  async pushPendingLeadsToCrm(opts?: { conversationId?: string; limit?: number }): Promise<{
    crmProvider: string;
    attempted: number;
    pushed: number;
    skipped: number;
    errors: Array<{ conversationId: string; error: string }>;
  }> {
    const db = getDb();
    const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
    const rows = opts?.conversationId
      ? (db
          .prepare(
            `SELECT id FROM conversations
             WHERE id = ?
               AND status IN ('handoff', 'completed')
               AND (bitrix_lead_id IS NULL OR bitrix_lead_id = '')`,
          )
          .all(opts.conversationId) as Array<{ id: string }>)
      : (db
          .prepare(
            `SELECT id FROM conversations
             WHERE status IN ('handoff', 'completed')
               AND (bitrix_lead_id IS NULL OR bitrix_lead_id = '')
             ORDER BY updated_at DESC
             LIMIT ?`,
          )
          .all(limit) as Array<{ id: string }>);

    let pushed = 0;
    let skipped = 0;
    const errors: Array<{ conversationId: string; error: string }> = [];

    for (const row of rows) {
      const conv = conversationMemory.getById(row.id);
      if (!conv || !hasHandoffBasics(conv.fields)) {
        skipped += 1;
        continue;
      }
      try {
        const result = await this.finalizeLeadNow(row.id);
        if (result.leadId) pushed += 1;
        else {
          skipped += 1;
          if (result.error) errors.push({ conversationId: row.id, error: result.error });
        }
      } catch (e) {
        errors.push({
          conversationId: row.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      crmProvider: crmAdapter.name,
      attempted: rows.length,
      pushed,
      skipped,
      errors,
    };
  }

  private async finalizeLeadNow(
    conversationId: string,
  ): Promise<{ leadId: string | null; error?: string }> {
    const conv = conversationMemory.getById(conversationId);
    if (!conv) return { leadId: null, error: "conversation not found" };
    if (conv.bitrixLeadId) return { leadId: conv.bitrixLeadId };
    if (!hasHandoffBasics(conv.fields)) return { leadId: null, error: "handoff basics missing" };

    const transcript = conversationMemory.formatTranscript(conversationId);
    const payload = this.buildLeadPayload(
      conv,
      conv.fields,
      conv.leadScore,
      conv.leadScoreBand,
      transcript,
      conv.summary,
    );
    const aiSummary = await summaryGenerator.generate({ ...payload, aiSummary: "" });
    payload.aiSummary = aiSummary;
    const crm = await crmAdapter.createLead(payload);
    this.storeLead(payload, crm.leadId, crmAdapter.name);
    conversationMemory.update(conversationId, {
      summary: aiSummary,
      bitrixLeadId: crm.leadId,
    });
    if (!crm.success || !crm.leadId) {
      return { leadId: null, error: crm.error || `CRM provider=${crmAdapter.name} returned empty leadId` };
    }
    return { leadId: crm.leadId };
  }

  private finalizeLeadAsync(conversationId: string, payload: LeadPayload): void {
    void (async () => {
      try {
        const aiSummary = await summaryGenerator.generate({ ...payload, aiSummary: "" });
        payload.aiSummary = aiSummary;
        const crm = await crmAdapter.createLead(payload);
        this.storeLead(payload, crm.leadId, crmAdapter.name);
        conversationMemory.update(conversationId, {
          summary: aiSummary,
          bitrixLeadId: crm.leadId,
        });
        if (!crm.success || !crm.leadId) {
          logger.warn("Lead stored without CRM id", {
            conversationId,
            provider: crmAdapter.name,
            error: crm.error,
          });
        }
      } catch (e) {
        logger.error("Lead finalize failed", {
          conversationId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
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
