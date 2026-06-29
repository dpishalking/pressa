import { Hono } from "hono";
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

export const api = new Hono();

api.get("/health", (c) =>
  c.json({
    ok: true,
    crm: config.CRM_PROVIDER,
    gemini: Boolean(config.GEMINI_API_KEY),
    gifts: knowledgeBase.listGifts().length,
    catalogPhotos: listCanonicalProductsWithPhotos(),
    sheetSync: sheetSyncEnabled(),
  }),
);

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
