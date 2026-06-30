import {
  getBitrixDealById,
  getBitrixLeadById,
  listBitrixContactsByIds,
  listBitrixLeads,
  resolveBitrixUserNames,
} from "../crm/bitrix-client.js";
import {
  getBitrixInvoiceById,
  INVOICE_STAGE_UNPAID,
  listUnpaidInvoices,
  SMART_INVOICE_ENTITY_TYPE_ID,
} from "../crm/bitrix-invoices.js";
import { findOpenLineSessionBySessionId, fetchSessionChat, type OpenLineSession } from "../crm/bitrix-openlines.js";
import { loadFxConverter } from "../analytics/fx-rates.js";
import { logger } from "../../logger.js";
import { ropAlertsConfig, type RopAlertsConfig } from "./alerts-config.js";
import {
  cancelWatch,
  clearAlertSent,
  completeWatch,
  listDueWatches,
  markAlertSent,
  upsertWatch,
  wasAlertSent,
} from "./alert-store.js";
import {
  extractDynamicItem,
  extractEntityId,
  extractImMessage,
  type BitrixWebhookPayload,
} from "./bitrix-webhook-parse.js";
import { getContactLtvEur } from "./contact-ltv.js";
import { eur, portalLink, sendTelegramAlert } from "./telegram-notify.js";

const CRM_OWNER_CONTACT = "3";
const CRM_OWNER_LEAD = "1";
const CRM_OWNER_DEAL = "2";

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function crmLinkForSession(cfg: RopAlertsConfig, session: OpenLineSession): string {
  const { ownerTypeId, ownerId, sessionId } = session;
  if (ownerTypeId === CRM_OWNER_LEAD && ownerId && ownerId !== "0") {
    return portalLink(cfg, `/crm/lead/details/${ownerId}/`);
  }
  if (ownerTypeId === CRM_OWNER_CONTACT && ownerId && ownerId !== "0") {
    return portalLink(cfg, `/crm/contact/details/${ownerId}/`);
  }
  if (ownerTypeId === CRM_OWNER_DEAL && ownerId && ownerId !== "0") {
    return portalLink(cfg, `/crm/deal/details/${ownerId}/`);
  }
  return portalLink(cfg, `/online/?IM_HISTORY=imol|${sessionId}`);
}

function isManagerSender(session: OpenLineSession, senderId?: string): boolean {
  if (!senderId || senderId === "0") return false;
  return Boolean(session.responsibleId && senderId === session.responsibleId);
}

function isoAfterMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function isoAfterDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function daysBetween(fromIso: string, toDate = new Date()): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.floor((toDate.getTime() - from) / 86_400_000));
}

function minutesBetween(fromIso: string, toDate = new Date()): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.round((toDate.getTime() - from) / 60_000));
}

function leadTitle(lead: { TITLE?: string; NAME?: string; LAST_NAME?: string }): string {
  return lead.TITLE?.trim() || [lead.NAME, lead.LAST_NAME].filter(Boolean).join(" ").trim() || "Лид";
}

function verifyOutboundToken(cfg: RopAlertsConfig, token?: string): boolean {
  if (!cfg.outboundToken) return true;
  return token === cfg.outboundToken;
}

async function fx(cfg: RopAlertsConfig) {
  return loadFxConverter({
    baseCurrency: cfg.baseCurrency,
    date: new Date().toISOString().slice(0, 10),
    overrides: cfg.fxOverrides,
  });
}

async function leadAmountEur(lead: { OPPORTUNITY?: string; CURRENCY_ID?: string }, cfg: RopAlertsConfig): Promise<number> {
  const converter = await fx(cfg);
  return converter.convert(Number.parseFloat(lead.OPPORTUNITY ?? "0") || 0, lead.CURRENCY_ID);
}

async function isLeadUnprocessed(leadId: string): Promise<boolean> {
  const leads = await listBitrixLeads({ ID: leadId, STATUS_SEMANTIC_ID: "P" }, ["ID"]);
  return leads.length > 0;
}

async function resolveContactIdFromSession(session: {
  ownerTypeId: string;
  ownerId: string;
}): Promise<string | null> {
  if (session.ownerTypeId === CRM_OWNER_CONTACT && session.ownerId && session.ownerId !== "0") {
    return session.ownerId;
  }

  if (session.ownerTypeId === CRM_OWNER_LEAD && session.ownerId) {
    const lead = await getBitrixLeadById(session.ownerId);
    const contactId = String(lead?.CONTACT_ID ?? "");
    if (contactId && contactId !== "0") return contactId;
  }

  return null;
}

export async function scheduleLeadWatch(leadId: string, cfg?: RopAlertsConfig): Promise<void> {
  const settings = cfg ?? ropAlertsConfig();
  const lead = await getBitrixLeadById(leadId);
  if (!lead) return;

  const amountEur = await leadAmountEur(lead, settings);
  if (settings.leadMinEur > 0 && amountEur < settings.leadMinEur) return;

  upsertWatch({
    watchType: "lead_no_response",
    entityId: leadId,
    checkAfter: isoAfterMinutes(settings.leadNoResponseMinutes),
    payload: { amountEur, title: leadTitle(lead) },
  });

  logger.info("Lead alert watch scheduled", { leadId, amountEur, minutes: settings.leadNoResponseMinutes });
}

export async function scheduleChatWatch(
  sessionId: string,
  opts: { text?: string; cfg?: RopAlertsConfig },
): Promise<void> {
  const settings = opts.cfg ?? ropAlertsConfig();
  const session = await findOpenLineSessionBySessionId(sessionId);
  if (!session) return;

  upsertWatch({
    watchType: "chat_no_response",
    entityId: sessionId,
    checkAfter: isoAfterMinutes(settings.chatNoResponseMinutes),
    payload: {
      clientLabel: session.clientLabel,
      channel: session.channel,
      preview: (opts.text ?? "").slice(0, 200),
      ownerTypeId: session.ownerTypeId,
      ownerId: session.ownerId,
    },
  });

  logger.info("Chat alert watch scheduled", {
    sessionId,
    minutes: settings.chatNoResponseMinutes,
    channel: session.channel,
  });
}

export async function scheduleInvoiceWatch(invoiceId: string, cfg?: RopAlertsConfig): Promise<void> {
  const settings = cfg ?? ropAlertsConfig();
  const invoice = await getBitrixInvoiceById(Number.parseInt(invoiceId, 10));
  if (!invoice || invoice.stageId !== INVOICE_STAGE_UNPAID) return;

  const converter = await fx(settings);
  const amountEur = converter.convert(invoice.opportunity ?? 0, invoice.currencyId);
  if (amountEur < settings.invoiceMinEur) return;

  const created = invoice.createdTime ?? new Date().toISOString();
  const dueAt = new Date(Date.parse(created) + settings.invoiceUnpaidDays * 86_400_000).toISOString();

  upsertWatch({
    watchType: "invoice_unpaid",
    entityId: invoiceId,
    checkAfter: dueAt,
    payload: { amountEur, dealId: invoice.parentDealId, title: invoice.title ?? "" },
  });

  logger.info("Invoice alert watch scheduled", { invoiceId, amountEur, dueAt });
}

async function fireLeadNoResponseAlert(leadId: string, cfg: RopAlertsConfig, payload: Record<string, unknown>): Promise<void> {
  const alertKey = `lead_no_response:${leadId}`;
  if (wasAlertSent(alertKey)) return;

  const stillOpen = await isLeadUnprocessed(leadId);
  if (!stillOpen) return;

  const lead = await getBitrixLeadById(leadId);
  if (!lead) return;

  const amountEur = Number(payload.amountEur) || (await leadAmountEur(lead, cfg));
  const waitingMin = minutesBetween(lead.DATE_CREATE ?? "");
  const managerIds = await resolveBitrixUserNames([String(lead.ASSIGNED_BY_ID ?? "")]);
  const manager = managerIds.get(String(lead.ASSIGNED_BY_ID ?? "")) ?? "не назначен";

  const lines = [
    "🔴 Лид без ответа",
    "",
    `Лид: ${leadTitle(lead)}`,
    `Ожидает: ${waitingMin} мин`,
    `Менеджер: ${manager}`,
  ];
  if (amountEur > 0) lines.splice(3, 0, `Сумма: ${eur(amountEur)}`);
  lines.push("", "Открыть в Bitrix:", portalLink(cfg, `/crm/lead/details/${leadId}/`));

  await sendTelegramAlert(cfg, lines.join("\n"));
  markAlertSent(alertKey, "lead_no_response");
}

async function fireInvoiceUnpaidAlert(
  invoiceId: string,
  cfg: RopAlertsConfig,
  payload: Record<string, unknown>,
): Promise<void> {
  const alertKey = `invoice_unpaid:${invoiceId}`;
  if (wasAlertSent(alertKey)) return;

  const invoice = await getBitrixInvoiceById(Number.parseInt(invoiceId, 10));
  if (!invoice || invoice.stageId !== INVOICE_STAGE_UNPAID) return;

  const converter = await fx(cfg);
  const amountEur = Number(payload.amountEur) || converter.convert(invoice.opportunity ?? 0, invoice.currencyId);
  if (amountEur < cfg.invoiceMinEur) return;

  const daysUnpaid = daysBetween(invoice.createdTime ?? "");
  if (daysUnpaid < cfg.invoiceUnpaidDays) return;

  let clientName = String(payload.title ?? invoice.title ?? "");
  let manager = "не назначен";
  let dealLink = "";

  if (invoice.parentDealId) {
    const deal = await getBitrixDealById(invoice.parentDealId);
    if (deal) {
      clientName = deal.TITLE ?? clientName;
      const names = await resolveBitrixUserNames([String(deal.ASSIGNED_BY_ID ?? "")]);
      manager = names.get(String(deal.ASSIGNED_BY_ID ?? "")) ?? manager;
      dealLink = portalLink(cfg, `/crm/deal/details/${deal.ID}/`);
    }
  }

  const text = [
    "🟠 Крупный счёт без оплаты",
    "",
    `Сумма: ${eur(amountEur)}`,
    `Счёт #${invoiceId}`,
    clientName ? `Клиент: ${clientName}` : "",
    `Без оплаты: ${daysUnpaid} дн.`,
    `Менеджер: ${manager}`,
    dealLink || portalLink(cfg, `/crm/type/31/details/${invoiceId}/`),
  ]
    .filter(Boolean)
    .join("\n");

  await sendTelegramAlert(cfg, text);
  markAlertSent(alertKey, "invoice_unpaid");
}

async function fireChatNoResponseAlert(
  sessionId: string,
  cfg: RopAlertsConfig,
  payload: Record<string, unknown>,
): Promise<void> {
  const alertKey = `chat_no_response:${sessionId}`;
  if (wasAlertSent(alertKey)) return;

  const session = await findOpenLineSessionBySessionId(sessionId);
  if (!session) return;

  const stats = await fetchSessionChat(session);
  const clientMessages = stats.messages.filter((m) => m.author === "client");
  const managerMessages = stats.messages.filter((m) => m.author === "manager");
  const lastClient = clientMessages.at(-1);
  const lastManager = managerMessages.at(-1);

  const clientWaiting = lastClient && (!lastManager || lastClient.date > lastManager.date);
  if (!clientWaiting || !lastClient) return;

  const waitingMin = minutesBetween(lastClient.date);
  if (waitingMin < cfg.chatNoResponseMinutes) return;

  const managerIds = await resolveBitrixUserNames([session.responsibleId]);
  const manager = managerIds.get(session.responsibleId) ?? (session.responsibleId || "не назначен");
  const preview = String(payload.preview ?? lastClient.text).slice(0, 200);

  const text = [
    "💬 Чат без ответа",
    "",
    `Клиент: ${session.clientLabel}`,
    `Канал: ${session.channel}`,
    `Ожидает: ${waitingMin} мин`,
    `Менеджер: ${manager}`,
    preview ? `Сообщение: «${preview}»` : "",
    "",
    "Открыть в Bitrix:",
    crmLinkForSession(cfg, session),
  ]
    .filter(Boolean)
    .join("\n");

  await sendTelegramAlert(cfg, text);
  markAlertSent(alertKey, "chat_no_response");
}

function clearChatAlert(sessionId: string): void {
  cancelWatch("chat_no_response", sessionId);
  clearAlertSent(`chat_no_response:${sessionId}`);
}

export async function handleVipChatMessage(opts: {
  sessionId?: string;
  senderId?: string;
  text?: string;
  cfg?: RopAlertsConfig;
}): Promise<void> {
  const cfg = opts.cfg ?? ropAlertsConfig();
  if (!opts.sessionId) return;

  const session = await findOpenLineSessionBySessionId(opts.sessionId);
  if (!session) return;

  if (opts.senderId && session.responsibleId && opts.senderId === session.responsibleId) {
    return;
  }

  const contactId = await resolveContactIdFromSession(session);
  if (!contactId) return;

  const ltv = await getContactLtvEur(contactId, cfg);
  if (ltv < cfg.vipLtvMinEur) return;

  const cooldownKey = `vip_chat:${contactId}`;
  if (wasAlertSent(cooldownKey)) return;

  const contacts = await listBitrixContactsByIds([contactId]);
  const contact = contacts[0];
  const name = contact
    ? [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ").trim()
    : session.clientLabel;

  const preview = (opts.text ?? "").slice(0, 180);
  const text = [
    "⭐ VIP-клиент написал в чат",
    "",
    `Клиент: ${name || session.clientLabel}`,
    `LTV: ${eur(ltv)}`,
    `Канал: ${session.channel}`,
    preview ? `Сообщение: ${preview}` : "",
    portalLink(cfg, `/crm/contact/details/${contactId}/`),
  ]
    .filter(Boolean)
    .join("\n");

  await sendTelegramAlert(cfg, text);
  markAlertSent(cooldownKey, "vip_chat");
  scheduleVipCooldownReset(cooldownKey);
}

const vipCooldownTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleVipCooldownReset(alertKey: string): void {
  const existing = vipCooldownTimers.get(alertKey);
  if (existing) clearTimeout(existing);

  vipCooldownTimers.set(
    alertKey,
    setTimeout(() => {
      clearAlertSent(alertKey);
      vipCooldownTimers.delete(alertKey);
    }, 60 * 60_000),
  );
}

export async function processDueWatches(cfg?: RopAlertsConfig): Promise<number> {
  const settings = cfg ?? ropAlertsConfig();
  const due = listDueWatches();
  let fired = 0;

  for (const watch of due) {
    try {
      if (watch.watchType === "lead_no_response") {
        await fireLeadNoResponseAlert(watch.entityId, settings, watch.payload);
      } else if (watch.watchType === "chat_no_response") {
        await fireChatNoResponseAlert(watch.entityId, settings, watch.payload);
      } else if (watch.watchType === "invoice_unpaid") {
        await fireInvoiceUnpaidAlert(watch.entityId, settings, watch.payload);
      }
      completeWatch(watch.id);
      fired += 1;
    } catch (error) {
      logger.error("ROP alert watch failed", {
        watchType: watch.watchType,
        entityId: watch.entityId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return fired;
}

export async function scanUnprocessedLeads(cfg?: RopAlertsConfig): Promise<void> {
  const settings = cfg ?? ropAlertsConfig();
  const cutoff = hoursAgoIso(settings.leadNoResponseMinutes / 60);
  const leads = await listBitrixLeads(
    { STATUS_SEMANTIC_ID: "P", "<DATE_CREATE": cutoff },
    ["OPPORTUNITY", "CURRENCY_ID", "ASSIGNED_BY_ID", "DATE_CREATE", "TITLE", "NAME", "LAST_NAME"],
  );

  for (const lead of leads) {
    const amountEur = await leadAmountEur(lead, settings);
    if (settings.leadMinEur > 0 && amountEur < settings.leadMinEur) continue;
    await fireLeadNoResponseAlert(String(lead.ID), settings, {
      amountEur,
      title: leadTitle(lead),
    });
  }
}

export async function scanUnpaidInvoices(cfg?: RopAlertsConfig): Promise<void> {
  const settings = cfg ?? ropAlertsConfig();
  const converter = await fx(settings);
  const invoices = await listUnpaidInvoices();

  for (const invoice of invoices) {
    const amountEur = converter.convert(invoice.opportunity ?? 0, invoice.currencyId);
    if (amountEur < settings.invoiceMinEur) continue;

    const daysUnpaid = daysBetween(invoice.createdTime ?? "");
    if (daysUnpaid >= settings.invoiceUnpaidDays) {
      await fireInvoiceUnpaidAlert(String(invoice.id), settings, { amountEur });
      continue;
    }

    await scheduleInvoiceWatch(String(invoice.id), settings);
  }
}

export async function handleBitrixWebhook(payload: BitrixWebhookPayload): Promise<{ ok: boolean; handled?: string }> {
  const baseCfg = ropAlertsConfig();
  const cfg =
    payload.domain && !baseCfg.portalUrl
      ? { ...baseCfg, portalUrl: `https://${payload.domain}` }
      : baseCfg;

  if (!verifyOutboundToken(cfg, payload.applicationToken)) {
    logger.warn("Bitrix webhook rejected: invalid token");
    return { ok: false };
  }

  const event = payload.event.toUpperCase();
  logger.info("Bitrix webhook received", { event });

  if (event === "ONCRMLEADADD" || event === "ONCRMLEADUPDATE") {
    const leadId = extractEntityId(payload.data);
    if (!leadId) return { ok: true };

    const lead = await getBitrixLeadById(leadId);
    if (!lead) return { ok: true };

    const unprocessed = await isLeadUnprocessed(leadId);
    if (unprocessed) {
      await scheduleLeadWatch(leadId, cfg);
    } else {
      cancelWatch("lead_no_response", leadId);
      clearAlertSent(`lead_no_response:${leadId}`);
    }
    return { ok: true, handled: "lead" };
  }

  if (
    event === "ONCRMDYNAMICITEMADD" ||
    event === "ONCRMDYNAMICITEMUPDATE" ||
    event === "ONCRM_DYNAMIC_ITEM_ADD" ||
    event === "ONCRM_DYNAMIC_ITEM_UPDATE"
  ) {
    const item = extractDynamicItem(payload.data);
    if (item.entityTypeId === SMART_INVOICE_ENTITY_TYPE_ID && item.id) {
      const invoice = await getBitrixInvoiceById(Number.parseInt(item.id, 10));
      if (invoice?.stageId === INVOICE_STAGE_UNPAID) {
        await scheduleInvoiceWatch(item.id, cfg);
      } else {
        cancelWatch("invoice_unpaid", item.id);
      }
      return { ok: true, handled: "invoice" };
    }
  }

  if (
    event === "ONIMCONNECTORMESSAGEADD" ||
    event === "ONOPENLINEMESSAGEADD" ||
    event === "ONIMBOTMESSAGEADD"
  ) {
    const message = extractImMessage(payload.data);
    if (message.sessionId) {
      const session = await findOpenLineSessionBySessionId(message.sessionId);
      if (session) {
        if (isManagerSender(session, message.senderId)) {
          clearChatAlert(message.sessionId);
        } else {
          await scheduleChatWatch(message.sessionId, { text: message.text, cfg });
          await handleVipChatMessage({
            sessionId: message.sessionId,
            senderId: message.senderId,
            text: message.text,
            cfg,
          });
        }
      }
      return { ok: true, handled: "chat" };
    }
  }

  return { ok: true };
}
