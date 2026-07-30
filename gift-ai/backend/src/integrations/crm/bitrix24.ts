import { config } from "../../config.js";
import { logger } from "../../logger.js";
import type { LeadPayload } from "../../types/index.js";
import { bandLabel } from "../../modules/lead-scoring.js";
import { formatTelegramContact } from "../../modules/telegram-contact.js";
import { bitrixCall } from "./bitrix-client.js";
import type { CrmAdapter, CrmLeadResult } from "./types.js";

function telegramParts(payload: LeadPayload): { contact: string; username: string; telegramId: string } {
  const contact = formatTelegramContact({
    telegram: payload.telegram,
    channelUserId: payload.channelUserId,
  });
  const username = contact.startsWith("@") ? contact.slice(1) : "";
  const telegramId = contact.startsWith("id:")
    ? contact.slice(3)
    : /^\d+$/.test(payload.channelUserId ?? "")
      ? payload.channelUserId
      : "";
  return { contact, username, telegramId };
}

export class Bitrix24Adapter implements CrmAdapter {
  readonly name = "bitrix24";

  async createLead(payload: LeadPayload): Promise<CrmLeadResult> {
    try {
      const { contact, username, telegramId } = telegramParts(payload);
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
        `Особенно дорого: ${payload.story}`,
        `Интересы: ${payload.interests}`,
        `Хобби: ${payload.hobbies}`,
        `Срочность: ${payload.urgency}`,
        `Telegram: ${contact || "—"}`,
        `Lead Score: ${payload.leadScore} — ${bandLabel(payload.leadScoreBand)}`,
        ``,
        `=== ПЕРЕПИСКА ===`,
        payload.fullTranscript,
      ].join("\n");

      const fields: Record<string, unknown> = {
        TITLE: title,
        NAME: payload.clientName || "Клиент",
        PHONE: payload.phone ? [{ VALUE: payload.phone, VALUE_TYPE: "WORK" }] : [],
        EMAIL: payload.email ? [{ VALUE: payload.email, VALUE_TYPE: "WORK" }] : [],
        SOURCE_ID: "WEB",
        SOURCE_DESCRIPTION: `Telegram: ${contact || payload.channelUserId || "—"}`,
        COMMENTS: comments.slice(0, 65000),
      };

      // Wazzup / Open Lines custom fields — ignore if portal has no such UF.
      if (username) fields.UF_CRM_TELEGRAMUSERNAME_WZ = username;
      if (telegramId) fields.UF_CRM_TELEGRAMID_WZ = telegramId;

      let result: Record<string, unknown>;
      try {
        result = await bitrixCall("crm.lead.add", { fields });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/UF_CRM_TELEGRAM/i.test(msg)) throw e;
        delete fields.UF_CRM_TELEGRAMUSERNAME_WZ;
        delete fields.UF_CRM_TELEGRAMID_WZ;
        result = await bitrixCall("crm.lead.add", { fields });
      }

      const leadId = String((result.result as number | string) ?? "");

      if (leadId && config.BITRIX24_TAG) {
        try {
          await bitrixCall("crm.lead.update", {
            id: leadId,
            fields: { TAGS: config.BITRIX24_TAG },
          });
        } catch (e) {
          logger.warn("Bitrix tag update failed", { leadId, error: String(e) });
        }
      }

      logger.info("Bitrix lead created", { leadId, telegram: contact });
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
