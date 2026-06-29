import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3100),
  ADMIN_API_KEY: z.string().min(1).default("change-me-admin-key"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  DATABASE_PATH: z.string().default("./data/gift-ai.db"),
  BITRIX24_WEBHOOK_URL: z.string().optional().default(""),
  BITRIX24_TAG: z.string().default("Подбор подарка AI"),
  CRM_PROVIDER: z.enum(["bitrix24", "none"]).default("none"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten());
    throw new Error("Invalid configuration");
  }
  const cfg = parsed.data;
  return {
    ...cfg,
    CRM_PROVIDER: cfg.BITRIX24_WEBHOOK_URL ? "bitrix24" : "none",
  };
}

export const config = loadConfig();
