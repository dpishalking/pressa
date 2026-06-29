import { randomUUID } from "node:crypto";
import { getDb } from "../db/client.js";

export type AnalyticsEventType =
  | "bot_start"
  | "consult_begin"
  | "catalog_open"
  | "user_message"
  | "handoff_shown"
  | "manager_click";

export type BotStats = {
  period: "all" | "today";
  uniqueVisitors: number;
  botStarts: number;
  consultStarts: number;
  catalogOpens: number;
  userMessages: number;
  applicationsReady: number;
  managerClicks: number;
  leadsStored: number;
  crmLeads: number;
  activeConsultations: number;
  abandoned: number;
  avgLeadScore: number;
  funnel: {
    visitors: number;
    consult: number;
    handoff: number;
    managerClick: number;
    consultRate: number;
    handoffRate: number;
    clickRate: number;
  };
  topOccasions: [string, number][];
  topGifts: [string, number][];
  recentApplications: Array<{
    id: string;
    channelUserId: string;
    occasion: string;
    gift: string;
    budget: string;
    telegram: string;
    status: string;
    createdAt: string;
  }>;
};

const STATS_TZ = process.env.STATS_TIMEZONE ?? "Europe/Moscow";

/** Полночь «сегодня» в часовом поясе статистики (по умолчанию Москва). */
function todayStartIso(): string {
  const local = new Date(new Date().toLocaleString("en-US", { timeZone: STATS_TZ }));
  local.setHours(0, 0, 0, 0);
  return local.toISOString();
}

function periodClause(period: "all" | "today", column = "created_at"): string {
  if (period === "today") return ` AND ${column} >= '${todayStartIso()}'`;
  return "";
}

function countQuery(sql: string): number {
  const row = getDb().prepare(sql).get() as { n: number } | undefined;
  return row?.n ?? 0;
}

export function recordAnalyticsEvent(opts: {
  channel: string;
  channelUserId: string;
  eventType: AnalyticsEventType;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO analytics_events (id, channel, channel_user_id, event_type, conversation_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    opts.channel,
    opts.channelUserId,
    opts.eventType,
    opts.conversationId ?? null,
    JSON.stringify(opts.metadata ?? {}),
    new Date().toISOString(),
  );
}

export function getBotStats(period: "all" | "today" = "all"): BotStats {
  const db = getDb();
  const p = periodClause(period);
  const pConv = periodClause(period, "created_at");
  const pConvC = periodClause(period, "c.created_at");
  const pMsg = periodClause(period, "m.created_at");

  const countEvent = (type: AnalyticsEventType, distinctUser = false): number => {
    const col = distinctUser ? "COUNT(DISTINCT channel_user_id)" : "COUNT(*)";
    const row = db
      .prepare(`SELECT ${col} AS n FROM analytics_events WHERE event_type = ?${p}`)
      .get(type) as { n: number };
    return row?.n ?? 0;
  };

  const distinctUsers = countQuery(
    `SELECT COUNT(DISTINCT channel_user_id) AS n FROM conversations WHERE 1=1${pConv}`,
  );

  const conversationSessions = countQuery(`SELECT COUNT(*) AS n FROM conversations WHERE 1=1${pConv}`);

  const consultStartsFromDb = countQuery(
    `SELECT COUNT(DISTINCT c.channel_user_id) AS n FROM conversations c
     WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'assistant')${pConvC}`,
  );

  const uniqueVisitors = Math.max(distinctUsers, countEvent("bot_start", true));

  const userMessagesFromDb = countQuery(
    `SELECT COUNT(*) AS n FROM messages m WHERE m.role = 'user'${pMsg}`,
  );

  const applicationsReady = countQuery(
    `SELECT COUNT(*) AS n FROM conversations WHERE status IN ('handoff', 'completed')${pConv}`,
  );

  const leadsStored = countQuery(`SELECT COUNT(*) AS n FROM leads WHERE 1=1${p}`);

  const crmLeads = countQuery(
    `SELECT COUNT(*) AS n FROM leads WHERE crm_lead_id IS NOT NULL AND crm_lead_id != ''${p}`,
  );

  const activeConsultations = countQuery(`SELECT COUNT(*) AS n FROM conversations WHERE status = 'active'`);

  const abandoned = countQuery(`SELECT COUNT(*) AS n FROM conversations WHERE status = 'abandoned'${pConv}`);

  const avgRow = db
    .prepare(
      `SELECT AVG(lead_score) AS avg FROM conversations WHERE status IN ('handoff', 'completed')${pConv}`,
    )
    .get() as { avg: number | null };

  const botStarts = Math.max(countEvent("bot_start"), conversationSessions);
  const consultStarts = Math.max(countEvent("consult_begin"), consultStartsFromDb);
  const handoffShown = Math.max(countEvent("handoff_shown"), applicationsReady);
  const managerClicks = countEvent("manager_click");

  const funnelVisitors = Math.max(uniqueVisitors, distinctUsers);
  const funnelConsult = countQuery(
    `SELECT COUNT(DISTINCT channel_user_id) AS n FROM conversations WHERE stage >= 2${pConv}`,
  );
  const funnelHandoff = applicationsReady;

  const rate = (n: number, d: number) => (d ? Math.min(100, Math.round((n / d) * 100)) : 0);

  const occasionRows = db
    .prepare(
      `SELECT json_extract(fields_json, '$.occasion') AS occasion, COUNT(*) AS n
       FROM conversations
       WHERE status IN ('handoff', 'completed')
         AND json_extract(fields_json, '$.occasion') IS NOT NULL
         AND json_extract(fields_json, '$.occasion') != ''${pConv}
       GROUP BY occasion ORDER BY n DESC LIMIT 5`,
    )
    .all() as { occasion: string; n: number }[];

  const giftRows = db
    .prepare(
      `SELECT json_extract(fields_json, '$.recommendedGiftName') AS gift, COUNT(*) AS n
       FROM conversations
       WHERE status IN ('handoff', 'completed')
         AND json_extract(fields_json, '$.recommendedGiftName') IS NOT NULL
         AND json_extract(fields_json, '$.recommendedGiftName') != ''${pConv}
       GROUP BY gift ORDER BY n DESC LIMIT 5`,
    )
    .all() as { gift: string; n: number }[];

  const recentRows = db
    .prepare(
      `SELECT id, channel_user_id, fields_json, status, created_at
       FROM conversations
       WHERE status IN ('handoff', 'completed')${pConv}
       ORDER BY updated_at DESC LIMIT 5`,
    )
    .all() as Array<{
    id: string;
    channel_user_id: string;
    fields_json: string;
    status: string;
    created_at: string;
  }>;

  return {
    period,
    uniqueVisitors,
    botStarts,
    consultStarts,
    catalogOpens: countEvent("catalog_open"),
    userMessages: Math.max(countEvent("user_message"), userMessagesFromDb),
    applicationsReady,
    managerClicks,
    leadsStored,
    crmLeads,
    activeConsultations,
    abandoned,
    avgLeadScore: Math.round(avgRow?.avg ?? 0),
    funnel: {
      visitors: funnelVisitors,
      consult: funnelConsult,
      handoff: funnelHandoff,
      managerClick: managerClicks,
      consultRate: rate(funnelConsult, funnelVisitors),
      handoffRate: rate(funnelHandoff, funnelConsult),
      clickRate: rate(managerClicks, funnelHandoff),
    },
    topOccasions: occasionRows.map((r) => [r.occasion, r.n]),
    topGifts: giftRows.map((r) => [r.gift, r.n]),
    recentApplications: recentRows.map((r) => {
      let fields: Record<string, string> = {};
      try {
        fields = JSON.parse(r.fields_json);
      } catch {
        /* ignore */
      }
      return {
        id: r.id,
        channelUserId: r.channel_user_id,
        occasion: fields.occasion ?? "—",
        gift: fields.recommendedGiftName ?? fields.catalogGiftInterest ?? "—",
        budget: fields.budget ?? "—",
        telegram: fields.telegram ?? "—",
        status: r.status,
        createdAt: r.created_at,
      };
    }),
  };
}
