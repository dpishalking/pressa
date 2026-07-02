import { config } from "../../config.js";
import { logger } from "../../logger.js";
import type { LeadPayload } from "../../types/index.js";
import { bandLabel } from "../../modules/lead-scoring.js";
import { bitrixCall } from "./bitrix-client.js";
import type { CrmAdapter, CrmLeadResult } from "./types.js";

export class Bitrix24Adapter implements CrmAdapter {
  readonly name = "bitrix24";

  async createLead(payload: LeadPayload): Promise<CrmLeadResult> {
    try {
      const title = `AI подбор: ${payload.recommendedGiftName || payload.occasion || "подарок"}`;
      const comments = [
        `=== AI SUMMARY ===`,
        payload.aiSummary,
        ``,
        `=== РЕКОМЕНДАЦИЯ ===`,
        `Подарок: ${payload.recommendedGiftName || "—"}`,
        `Причина: ${payload.recommendationReason || "—"}`,
        `Альтернативы: ${payload.alternatives || "—"}`,
        ``,
        `=== КВАЛИФИКАЦИЯ ===`,
        `Повод: ${payload.occasion}`,
        `Дата: ${payload.eventDate}`,
        `Получатель: ${payload.recipient} (${payload.recipientGender}, ${payload.recipientAge})`,
        `Отношение: ${payload.relationship}`,
        `Город: ${payload.city}, ${payload.country}`,
        `Бюджет: ${payload.budget}`,
        `Эмоции: ${payload.desiredEmotions}`,
        `Интересы: ${payload.interests}`,
        `Хобби: ${payload.hobbies}`,
        `Срочность: ${payload.urgency}`,
        `Lead Score: ${payload.leadScore} — ${bandLabel(payload.leadScoreBand)}`,
        ``,
        `=== ПЕРЕПИСКА ===`,
        payload.fullTranscript,
      ].join("\n");

      const result = await bitrixCall("crm.lead.add", {
        fields: {
          TITLE: title,
          NAME: payload.clientName || "Клиент",
          PHONE: payload.phone ? [{ VALUE: payload.phone, VALUE_TYPE: "WORK" }] : [],
          EMAIL: payload.email ? [{ VALUE: payload.email, VALUE_TYPE: "WORK" }] : [],
          SOURCE_ID: "WEB",
          SOURCE_DESCRIPTION: `Telegram: ${payload.telegram || payload.channelUserId}`,
          COMMENTS: comments.slice(0, 65000),
          UF_CRM_LEAD_SCORE: String(payload.leadScore),
        },
      });

      const leadId = String((result.result as number | string) ?? "");

      if (leadId) {
        try {
          await bitrixCall("crm.lead.update", {
            id: leadId,
            fields: { TAGS: config.BITRIX24_TAG },
          });
        } catch (e) {
          logger.warn("Bitrix tag update failed", { leadId, error: String(e) });
        }
      }

      logger.info("Bitrix lead created", { leadId });
      return { success: true, leadId };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.error("Bitrix lead creation failed", { error });
      return { success: false, leadId: null, error };
    }
  }
}

export class NoopCrmAdapter implements CrmAdapter {
  readonly name = "none";

  async createLead(payload: LeadPayload): Promise<CrmLeadResult> {
    logger.info("CRM not configured — lead stored locally only", {
      conversationId: payload.conversationId,
      client: payload.clientName,
    });
    return { success: true, leadId: null };
  }
}
