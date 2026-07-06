import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3100),
  ADMIN_API_KEY: z.string().min(1).default("change-me-admin-key"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_MODEL_FALLBACK: z.string().default("gemini-2.5-flash-lite"),
  DATABASE_PATH: z.string().default("./data/gift-ai.db"),
  BITRIX24_WEBHOOK_URL: z.string().optional().default(""),
  BITRIX24_TAG: z.string().default("Подбор подарка AI"),
  ANALYTICS_SHEET_ID: z.string().optional().default(""),
  ANALYTICS_CHAT_SHEET_ID: z.string().optional().default(""),
  ACTIONS_SHEET_ID: z.string().optional().default(""),
  MANAGERS_SHEET_ID: z.string().optional().default(""),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional().default(""),
  ANALYTICS_COUNTRY_TAGS: z.string().optional().default(""),
  BITRIX_COUNTRY_FIELD: z.string().optional().default(""),
  BITRIX_DEAL_COUNTRY_FIELD: z.string().optional().default(""),
  ANALYTICS_BASE_CURRENCY: z.string().optional().default("EUR"),
  ANALYTICS_FX_OVERRIDES: z.string().optional().default(""),
  /** Стадии сделок для сводки продаж, через запятую. По умолчанию WON — только основная воронка. */
  ANALYTICS_SALES_STAGE_IDS: z.string().optional().default("WON"),
  GOOGLE_SHEET_CSV_URL: z.string().optional().default(""),
  GOOGLE_SHEET_ID: z.string().optional().default(""),
  GOOGLE_SHEET_GIDS: z.string().optional().default(""),
  CRM_PROVIDER: z.enum(["bitrix24", "none"]).default("none"),
  /** Алерты РОПа в Telegram (webhook Bitrix + фоновые проверки). */
  ROP_ALERTS_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "1" || v.toLowerCase() === "true"),
  ROP_ALERTS_TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  /** ID чата или канала Telegram (можно несколько через запятую). */
  ROP_ALERTS_TELEGRAM_CHAT_IDS: z.string().optional().default(""),
  /** Публичный URL API для исходящего webhook Bitrix (без слэша в конце). */
  PUBLIC_API_URL: z.string().optional().default(""),
  /** Токен исходящего webhook Bitrix (auth.application_token). */
  BITRIX24_OUTBOUND_TOKEN: z.string().optional().default(""),
  /** Базовый URL портала для ссылок, напр. https://bb-wood.bitrix24.eu */
  BITRIX24_PORTAL_URL: z.string().optional().default(""),
  /** Мин. сумма лида для алерта; 0 = любой лид без ответа. */
  ROP_ALERT_LEAD_MIN_EUR: z.coerce.number().default(0),
  ROP_ALERT_LEAD_NO_RESPONSE_MINUTES: z.coerce.number().default(61),
  ROP_ALERT_CHAT_NO_RESPONSE_MINUTES: z.coerce.number().default(30),
  /** Не алертить по лидам старше N дней (0 = без лимита). */
  ROP_ALERT_LEAD_MAX_AGE_DAYS: z.coerce.number().default(1),
  /** Не алертить по чатам, где последнее сообщение клиента старше N дней. */
  ROP_ALERT_CHAT_MAX_AGE_DAYS: z.coerce.number().default(3),
  /** Часы отправки алертов по Москве (начало включительно, конец не включительно). */
  ROP_ALERTS_FROM_HOUR_MSK: z.coerce.number().min(0).max(23).default(10),
  ROP_ALERTS_TO_HOUR_MSK: z.coerce.number().min(1).max(24).default(22),
  ROP_ALERT_INVOICE_MIN_EUR: z.coerce.number().default(0),
  ROP_ALERT_INVOICE_UNPAID_DAYS: z.coerce.number().default(2),
  /** Мин. сумма проигранной сделки для алерта; 0 = любая проигранная. */
  ROP_ALERT_LOST_DEAL_MIN_EUR: z.coerce.number().default(500),
  ROP_ALERT_VIP_LTV_MIN_EUR: z.coerce.number().default(1500),
  /** Интервал фоновой проверки отложенных алертов, сек. */
  ROP_ALERTS_POLL_INTERVAL_SEC: z.coerce.number().default(60),
  /** Вечерний дайджест в Telegram (итоги дня из Bitrix). */
  ROP_ALERT_DAILY_DIGEST_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v === "1" || v.toLowerCase() === "true"),
  /** Час отправки дайджеста по Москве (0–23). */
  ROP_ALERT_DAILY_DIGEST_HOUR_MSK: z.coerce.number().min(0).max(23).default(22),
  /** CORS origin для dashboard SPA, напр. http://203.0.113.5:8080 */
  DASHBOARD_ORIGIN: z.string().optional().default(""),
  /** Путь к собранному dashboard dist для serveStatic (опционально). */
  DASHBOARD_DIST_PATH: z.string().optional().default(""),
  /** Путь к JSON-экспорту реальных переписок для few-shot примеров и импорта сценариев. */
  CONVERSATIONS_EXPORT_PATH: z.string().optional().default("./data/exports/retro-pressa-conversations-2026-06.json"),
  /** Username trainer-бота без @ — для генерации invite-ссылок. */
  TRAINER_BOT_USERNAME: z.string().optional().default(""),
  /** Токен бота для уведомлений о результатах тренировок (обычно = TRAINER_BOT_TOKEN). */
  TRAINER_NOTIFY_BOT_TOKEN: z.string().optional().default(""),
  /** Telegram chat id РОПа/наставника — получает результаты тренировок команды. */
  TRAINER_NOTIFY_TELEGRAM_IDS: z.string().optional().default(""),
});

export type AppConfig = Omit<
  z.infer<typeof envSchema>,
  "ANALYTICS_COUNTRY_TAGS" | "ANALYTICS_SALES_STAGE_IDS" | "ROP_ALERTS_TELEGRAM_CHAT_IDS" | "TRAINER_NOTIFY_TELEGRAM_IDS"
> & {
  ANALYTICS_COUNTRY_TAGS: string[];
  ANALYTICS_SALES_STAGE_IDS: string[];
  ROP_ALERTS_TELEGRAM_CHAT_IDS: string[];
  TRAINER_NOTIFY_TELEGRAM_IDS: string[];
};

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten());
    throw new Error("Invalid configuration");
  }
  const cfg = parsed.data;

  const portalUrl =
    cfg.BITRIX24_PORTAL_URL.trim() ||
    (() => {
      try {
        return cfg.BITRIX24_WEBHOOK_URL ? new URL(cfg.BITRIX24_WEBHOOK_URL).origin : "";
      } catch {
        return "";
      }
    })();

  const telegramBotToken = cfg.ROP_ALERTS_TELEGRAM_BOT_TOKEN.trim() || process.env.BOT_TOKEN?.trim() || "";
  const telegramChatIds = cfg.ROP_ALERTS_TELEGRAM_CHAT_IDS.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const adminTelegramIds = (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^-?\d+$/.test(id));
  const mergedChatIds = telegramChatIds.length ? telegramChatIds : adminTelegramIds;

  const trainerNotifyToken =
    cfg.TRAINER_NOTIFY_BOT_TOKEN.trim() ||
    process.env.TRAINER_BOT_TOKEN?.trim() ||
    "";
  const trainerNotifyChatIds = cfg.TRAINER_NOTIFY_TELEGRAM_IDS.split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return {
    ...cfg,
    BITRIX24_PORTAL_URL: portalUrl,
    ROP_ALERTS_TELEGRAM_BOT_TOKEN: telegramBotToken,
    TRAINER_NOTIFY_BOT_TOKEN: trainerNotifyToken,
    TRAINER_NOTIFY_TELEGRAM_IDS: trainerNotifyChatIds,
    CRM_PROVIDER: cfg.BITRIX24_WEBHOOK_URL ? "bitrix24" : "none",
    ANALYTICS_COUNTRY_TAGS: cfg.ANALYTICS_COUNTRY_TAGS.split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    ANALYTICS_SALES_STAGE_IDS: cfg.ANALYTICS_SALES_STAGE_IDS.split(",")
      .map((stage) => stage.trim())
      .filter(Boolean),
    ROP_ALERTS_TELEGRAM_CHAT_IDS: mergedChatIds,
  };
}

export const config = loadConfig();
