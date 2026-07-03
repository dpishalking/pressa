import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
import { chatEngine } from "../modules/chat-engine.js";
import { conversationMemory } from "../modules/conversation-memory.js";
import { knowledgeBase } from "../modules/knowledge-base.js";
import { syncGiftsFromConfig } from "../integrations/sheets/workbook-sync.js";
import { sheetSyncConfig, sheetSyncEnabled } from "../integrations/sheets/config.js";
import { config } from "../config.js";
import { listCanonicalProductsWithPhotos } from "../modules/gift-photos.js";
import { normalizeLanguage } from "../modules/languages.js";
import { transcribeAudioBase64 } from "../integrations/ai/transcribe.js";
import { seedGifts } from "../seed.js";
import { getBotStats, recordAnalyticsEvent, type AnalyticsEventType } from "../modules/analytics.js";
import { getDb } from "../db/client.js";
import { parseBitrixWebhookBody } from "../integrations/alerts/bitrix-webhook-parse.js";
import { resolveTelegramChatIds, ropAlertsConfig, ropAlertsEnabled } from "../integrations/alerts/alerts-config.js";
import { handleBitrixWebhook } from "../integrations/alerts/rop-alerts.js";
import { handleCsoBotUpdate } from "../integrations/alerts/cso-bot.js";
import { sendTelegramAlert, eur } from "../integrations/alerts/telegram-notify.js";
import { listTelegramSubscriberDetails } from "../integrations/alerts/telegram-subscribers.js";
import { getSubscriberSettings } from "../integrations/alerts/subscriber-settings.js";
import { dashboard } from "./dashboard-routes.js";
import { trainerRouter } from "./trainer-routes.js";

function verifyOutboundTokenEarly(token?: string): boolean {
  const expected = config.BITRIX24_OUTBOUND_TOKEN.trim();
  if (!expected) return true;
  return token === expected;
}

export const api = new Hono();

api.get("/health", (c) => {
  const db = getDb();
  const conversations = (db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as { n: number }).n;
  const messages = (db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role = 'user'").get() as { n: number }).n;
  return c.json({
    ok: true,
    crm: config.CRM_PROVIDER,
    gemini: Boolean(config.GEMINI_API_KEY),
    gifts: knowledgeBase.listGifts().length,
    catalogPhotos: listCanonicalProductsWithPhotos(),
    sheetSync: sheetSyncEnabled(),
    ropAlerts: ropAlertsEnabled(),
    ropAlertsWebhook: ropAlertsEnabled()
      ? `${(config.PUBLIC_API_URL || `http://localhost:${config.PORT}`).replace(/\/$/, "")}/webhooks/bitrix`
      : undefined,
    conversations,
    userMessages: messages,
  });
});

api.get("/catalog", (c) => {
  const lang = normalizeLanguage(c.req.query("lang"));
  return c.json({ items: chatEngine.listCatalog(lang) });
});

api.get("/chat/status", (c) => {
  const channel = c.req.query("channel");
  const channelUserId = c.req.query("channelUserId");
  if (!channel || !channelUserId) return c.json({ error: "channel and channelUserId required" }, 400);
  return c.json(chatEngine.getChatStatus(channel, channelUserId));
});

api.post("/chat/menu", async (c) => {
  const body = await c.req.json<{ channel: string; channelUserId: string; telegramUsername?: string }>();
  const { channel, channelUserId, telegramUsername } = body;
  if (!channel || !channelUserId) return c.json({ error: "channel and channelUserId required" }, 400);
  const result = chatEngine.resetMenu(channel, channelUserId, telegramUsername);
  return c.json(result);
});

api.get("/chat/handoff", (c) => {
  const channel = c.req.query("channel");
  const channelUserId = c.req.query("channelUserId");
  if (!channel || !channelUserId) return c.json({ error: "channel and channelUserId required" }, 400);
  const result = chatEngine.getConsultationHandoff(channel, channelUserId);
  if (!result) return c.json({ error: "handoff not ready" }, 404);
  return c.json(result);
});

api.post("/chat/switch-gift", async (c) => {
  try {
    const body = await c.req.json<{
      channel: string;
      channelUserId: string;
      catalogGiftExternalId: string;
      telegramUsername?: string;
    }>();
    const { channel, channelUserId, catalogGiftExternalId, telegramUsername } = body;
    if (!channel || !channelUserId || !catalogGiftExternalId) {
      return c.json({ error: "channel, channelUserId and catalogGiftExternalId required" }, 400);
    }
    const result = await chatEngine.switchConsultationGift({
      channel,
      channelUserId,
      catalogGiftExternalId,
      telegramUsername,
    });
    return c.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[chat/switch-gift]", msg);
    return c.json({ error: msg }, 400);
  }
});

api.post("/chat/begin", async (c) => {
  const body = await c.req.json<{
    channel: string;
    channelUserId: string;
    language?: string;
    catalogGiftExternalId?: string;
    telegramUsername?: string;
  }>();
  const { channel, channelUserId, language, catalogGiftExternalId, telegramUsername } = body;
  if (!channel || !channelUserId) return c.json({ error: "channel and channelUserId required" }, 400);
  const result = chatEngine.beginConsultation({
    channel,
    channelUserId,
    language,
    catalogGiftExternalId,
    telegramUsername,
  });
  return c.json(result);
});

api.post("/chat/start", async (c) => {
  const body = await c.req.json<{ channel: string; channelUserId: string; telegramUsername?: string }>();
  const { channel, channelUserId, telegramUsername } = body;
  if (!channel || !channelUserId) return c.json({ error: "channel and channelUserId required" }, 400);
  const result = chatEngine.beginConsultation({ channel, channelUserId, telegramUsername, language: "ru" });
  return c.json(result);
});

api.post("/chat/message", async (c) => {
  try {
    const body = await c.req.json<{
      channel: string;
      channelUserId: string;
      text: string;
      telegramUsername?: string;
    }>();
    const { channel, channelUserId, text, telegramUsername } = body;
    if (!channel || !channelUserId || !text?.trim()) {
      return c.json({ error: "channel, channelUserId and text required" }, 400);
    }
    const result = await chatEngine.handleMessage({ channel, channelUserId, text: text.trim(), telegramUsername });
    return c.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[chat/message]", msg);
    return c.json({ error: msg }, 500);
  }
});

api.post("/webhooks/bitrix", async (c) => {
  try {
    if (!ropAlertsEnabled()) {
      return c.json({ ok: false, error: "ROP alerts disabled" }, 503);
    }

    const payload = await parseBitrixWebhookBody(c.req.raw);
    if (!verifyOutboundTokenEarly(payload.applicationToken)) {
      return c.json({ ok: false }, 401);
    }

    void handleBitrixWebhook(payload).catch((error) => {
      console.error("[webhooks/bitrix] async handler failed", error instanceof Error ? error.message : String(error));
    });
    return c.json({ ok: true, accepted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[webhooks/bitrix]", msg);
    return c.json({ ok: false, error: msg }, 500);
  }
});

api.post("/webhooks/telegram-cso", async (c) => {
  try {
    const update = await c.req.json();
    await handleCsoBotUpdate(update);
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[webhooks/telegram-cso]", msg);
    return c.json({ ok: false, error: msg }, 500);
  }
});

api.post("/chat/transcribe", async (c) => {
  try {
    const body = await c.req.json<{ mimeType?: string; audioBase64?: string }>();
    const mimeType = body.mimeType?.trim() || "audio/ogg";
    const audioBase64 = body.audioBase64?.trim();
    if (!audioBase64) return c.json({ error: "audioBase64 required" }, 400);

    const text = await transcribeAudioBase64(mimeType, audioBase64);
    return c.json({ text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[chat/transcribe]", msg);
    return c.json({ error: msg }, 500);
  }
});

api.get("/conversations/:id", (c) => {
  const conv = chatEngine.getConversation(c.req.param("id"));
  if (!conv) return c.json({ error: "not found" }, 404);
  return c.json(conv);
});

api.get("/conversations", (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const items = conversationMemory.listAll(limit).map((conv) => ({
    ...conv,
    messageCount: conversationMemory.getMessages(conv.id).length,
  }));
  return c.json({ items });
});

const admin = new Hono();
admin.use("*", async (c, next) => {
  const key = c.req.header("x-admin-key");
  if (key !== config.ADMIN_API_KEY) return c.json({ error: "unauthorized" }, 401);
  await next();
});

admin.get("/gifts", (c) => c.json({ items: knowledgeBase.listGifts(false) }));

admin.post("/gifts", async (c) => {
  const body = await c.req.json();
  const gift = knowledgeBase.createGift({
    name: body.name,
    description: body.description ?? "",
    priceMin: Number(body.priceMin ?? 0),
    priceMax: Number(body.priceMax ?? 0),
    emotions: body.emotions ?? [],
    suitableFor: body.suitableFor ?? [],
    occasions: body.occasions ?? [],
    leadTimeDays: Number(body.leadTimeDays ?? 7),
    personalization: body.personalization ?? "",
    photoUrl: body.photoUrl ?? "",
    cases: body.cases ?? "",
    reviews: body.reviews ?? "",
    active: body.active !== false,
  });
  return c.json(gift, 201);
});

admin.patch("/gifts/:id", async (c) => {
  const body = await c.req.json();
  const gift = knowledgeBase.updateGift(c.req.param("id"), body);
  if (!gift) return c.json({ error: "not found" }, 404);
  return c.json(gift);
});

admin.delete("/gifts/:id", (c) => {
  const ok = knowledgeBase.deleteGift(c.req.param("id"));
  return c.json({ ok });
});

admin.post("/seed", (c) => {
  const force = c.req.query("force") === "1" || c.req.query("force") === "true";
  try {
    seedGifts({ replace: force });
    return c.json({ ok: true, count: knowledgeBase.listGifts().length, replaced: force });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

admin.post("/export-bitrix-analytics", async (c) => {
  try {
    const { analyticsExportEnabled } = await import("../integrations/analytics/config.js");
    if (!analyticsExportEnabled()) {
      return c.json(
        {
          error:
            "Нужны BITRIX24_WEBHOOK_URL, ANALYTICS_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON и ANALYTICS_COUNTRY_TAGS",
        },
        400,
      );
    }

    const body = (await c.req.json<{ from?: string; to?: string; tags?: string[]; mode?: string; month?: string }>().catch(() => ({}))) as {
      from?: string;
      to?: string;
      tags?: string[];
      mode?: string;
      month?: string;
    };

    const { monthRange, yesterdayRange, exportBitrixAnalyticsByCountryTags, exportBitrixAnalyticsCombined, exportBitrixSalesSummary } =
      await import("../integrations/analytics/bitrix-country-export.js");

    const range =
      body.month
        ? monthRange(body.month)
        : body.from && body.to
          ? { from: body.from, to: body.to }
          : body.from
            ? (() => {
                const [year, month, day] = body.from!.split("-").map(Number);
                const next = new Date(Date.UTC(year, month - 1, day + 1));
                return { from: body.from!, to: next.toISOString().slice(0, 10) };
              })()
            : yesterdayRange();

    const mode = body.mode === "by-country" ? "by-country" : body.mode === "summary" || body.month ? "summary" : "combined";

    const summary =
      mode === "summary"
        ? await exportBitrixSalesSummary({
            range,
            month: body.month,
            countryTags: body.tags,
          })
        : mode === "combined"
          ? await exportBitrixAnalyticsCombined({
              range,
              countryTags: body.tags,
            })
          : await exportBitrixAnalyticsByCountryTags({
              range,
              countryTags: body.tags,
            });
    return c.json({ ok: true, mode, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

admin.post("/sync-sheets", async (c) => {
  try {
    const body = (await c.req.json<{ url?: string; sheetId?: string }>().catch(() => ({}))) as {
      url?: string;
      sheetId?: string;
    };
    const base = sheetSyncConfig();
    const result = await syncGiftsFromConfig({
      sheetId: body.sheetId || base.sheetId,
      gids: base.gids,
      csvUrl: body.url || base.csvUrl,
      csvUrls: base.csvUrls,
    });
    return c.json({ ok: true, ...result, giftsInCatalog: knowledgeBase.listGifts().length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

admin.get("/stats", (c) => {
  const period = c.req.query("period") === "today" ? "today" : "all";
  return c.json(getBotStats(period));
});

admin.post("/events", async (c) => {
  const body = await c.req.json<{
    channel: string;
    channelUserId: string;
    eventType: AnalyticsEventType;
    conversationId?: string;
    metadata?: Record<string, unknown>;
  }>();
  if (!body.channel || !body.channelUserId || !body.eventType) {
    return c.json({ error: "channel, channelUserId and eventType required" }, 400);
  }
  recordAnalyticsEvent(body);
  return c.json({ ok: true });
});

admin.post("/rop-alerts/test", async (c) => {
  try {
    if (!ropAlertsEnabled()) {
      return c.json({ error: "ROP alerts не настроены" }, 400);
    }
    const cfg = ropAlertsConfig();
    await sendTelegramAlert(
      cfg,
      [
        "✅ Тест алертов РОПа",
        "",
        `Порог лида: ${eur(cfg.leadMinEur)} / ${cfg.leadNoResponseMinutes} мин`,
        `Счёт: ${cfg.invoiceMinEur > 0 ? eur(cfg.invoiceMinEur) : "любая сумма"} / ${cfg.invoiceUnpaidDays} дн.`,
        `Проигранная сделка: ≥ ${eur(cfg.lostDealMinEur)}`,
        `VIP LTV: ${eur(cfg.vipLtvMinEur)}`,
      ].join("\n"),
    );
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

admin.post("/rop-alerts/daily-digest", async (c) => {
  try {
    if (!ropAlertsEnabled()) {
      return c.json({ error: "ROP alerts не настроены" }, 400);
    }
    const body = (await c.req.json<{ send?: boolean }>().catch(() => ({}))) as { send?: boolean };
    const cfg = ropAlertsConfig();
    const { buildDailyDigestStats, formatDailyDigestMessage } = await import(
      "../integrations/alerts/daily-digest.js"
    );
    const stats = await buildDailyDigestStats(cfg);
    const text = formatDailyDigestMessage(stats);
    if (body.send) {
      const { sendTelegramDigest } = await import("../integrations/alerts/telegram-notify.js");
      await sendTelegramDigest(cfg, text);
    }
    return c.json({ ok: true, stats, preview: text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

admin.get("/rop-alerts/subscribers", (c) => {
  try {
    if (!ropAlertsEnabled()) {
      return c.json({ error: "ROP alerts не настроены" }, 400);
    }
    const chatIds = resolveTelegramChatIds();
    const username = c.req.query("username")?.trim().replace(/^@/, "").toLowerCase();
    const subscribers = listTelegramSubscriberDetails()
      .map((sub) => ({
        ...sub,
        settings: getSubscriberSettings(sub.chatId),
        receivesAlerts: chatIds.includes(sub.chatId),
      }))
      .filter((sub) => !username || sub.username.toLowerCase() === username);

    return c.json({ chatIds, subscribers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

admin.post("/rop-alerts/subscribers/:chatId/test", async (c) => {
  try {
    if (!ropAlertsEnabled()) {
      return c.json({ error: "ROP alerts не настроены" }, 400);
    }
    const chatId = c.req.param("chatId");
    const cfg = ropAlertsConfig();
    if (!cfg.telegramChatIds.includes(chatId)) {
      return c.json({ error: "chat_id не в списке получателей" }, 404);
    }
    const result = await sendTelegramAlert(cfg, [
      "✅ Тест доставки CSO-бота",
      "",
      `Chat ID: ${chatId}`,
      "Если видите это — бот может писать вам в личку.",
    ].join("\n"));
    return c.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

admin.post("/rop-alerts/run-checks", async (c) => {
  try {
    if (!ropAlertsEnabled()) {
      return c.json({ error: "ROP alerts не настроены" }, 400);
    }
    const { processDueWatches, scanUnpaidInvoices, scanUnprocessedLeads } = await import(
      "../integrations/alerts/rop-alerts.js"
    );
    const cfg = ropAlertsConfig();
    const fired = await processDueWatches(cfg);
    await scanUnprocessedLeads(cfg);
    await scanUnpaidInvoices(cfg);
    return c.json({ ok: true, fired });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

admin.get("/stats/legacy", (c) => {
  const convs = conversationMemory.listAll(1000);
  const completed = convs.filter((x) => x.status === "completed");
  const occasions: Record<string, number> = {};
  const gifts: Record<string, number> = {};
  for (const conv of completed) {
    if (conv.fields.occasion) occasions[conv.fields.occasion] = (occasions[conv.fields.occasion] ?? 0) + 1;
    if (conv.fields.recommendedGiftName) {
      gifts[conv.fields.recommendedGiftName] = (gifts[conv.fields.recommendedGiftName] ?? 0) + 1;
    }
  }
  return c.json({
    totalConversations: convs.length,
    completed: completed.length,
    conversionRate: convs.length ? Math.round((completed.length / convs.length) * 100) : 0,
    topOccasions: Object.entries(occasions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
    topGifts: Object.entries(gifts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
    avgLeadScore: completed.length
      ? Math.round(completed.reduce((s, x) => s + x.leadScore, 0) / completed.length)
      : 0,
  });
});

api.route("/admin", admin);
api.route("/admin/dashboard", dashboard);
api.route("/trainer", trainerRouter);

const dashboardDist = config.DASHBOARD_DIST_PATH.trim();
if (dashboardDist) {
  const root = path.resolve(dashboardDist);
  api.use("/dashboard/*", serveStatic({ root }));
  api.get("/dashboard", (c) => c.redirect("/dashboard/"));
  api.get("/dashboard/*", serveStatic({ root, path: "index.html" }));
}
