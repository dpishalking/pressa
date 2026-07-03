import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger.js";

export interface ConversationMessage {
  message_id: string;
  date: string;
  sender: string;
  sender_role: "client" | "manager";
  text: string;
}

export interface ExportedConversation {
  dialog_id: string;
  lead_id: string;
  deal_id: string;
  outcome: string;
  amount: string;
  messages: ConversationMessage[];
}

/** Keywords that suggest this is a product-related sales dialogue */
const SALES_KEYWORDS = [
  "газет", "журнал", "репродукц", "оригинал", "персонализ",
  "поздравит", "архив", "подарок", "цена", "стоимость", "заказ",
  "доставк", "евро", "именинник",
];

const NOISE_KEYWORDS = [
  "SYSTEM WZ", "трек", "tracking", "отследить", "посылка", "RR6",
  "номер отслеживания", "вопрос не по теме",
];

export function isSalesDialogue(conv: ExportedConversation): boolean {
  if (conv.messages.length < 4) return false;

  const fullText = conv.messages.map((m) => m.text.toLowerCase()).join(" ");
  const hasNoise = NOISE_KEYWORDS.some((kw) => fullText.includes(kw.toLowerCase()));
  if (hasNoise) return false;

  const salesScore = SALES_KEYWORDS.filter((kw) =>
    fullText.includes(kw.toLowerCase()),
  ).length;

  return salesScore >= 2;
}

function anonymize(text: string): string {
  return text
    .replace(/\b(?:Анастасия|Елена|Мария|Ирина|Ольга|Алина|Наталья|Наташа|Света|Светлана)\b/gi, "[Менеджер]")
    .replace(/\b\d{10,15}\b/g, "[ТЕЛЕФОН]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL]")
    .replace(/https?:\/\/\S+/g, "[ССЫЛКА]")
    .replace(/\bRR\d{9,}\w+\b/gi, "[ТРЕКИНГ]");
}

export function formatConversationForPrompt(conv: ExportedConversation): string {
  const lines: string[] = [`--- Диалог ${conv.dialog_id} ---`];
  for (const msg of conv.messages) {
    const role = msg.sender_role === "manager" ? "Менеджер" : "Клиент";
    const clean = anonymize(msg.text).trim();
    if (clean) lines.push(`${role}: ${clean}`);
  }
  return lines.join("\n");
}

let _cache: ExportedConversation[] | null = null;

/** Load all conversations from the exports JSON file (lazy, cached). */
export function loadConversations(filePath: string): ExportedConversation[] {
  if (_cache) return _cache;

  if (!fs.existsSync(filePath)) {
    logger.warn("Conversations export file not found", { filePath });
    return [];
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    _cache = JSON.parse(raw) as ExportedConversation[];
    logger.info("Loaded conversations export", { count: _cache.length, filePath });
    return _cache;
  } catch (err) {
    logger.warn("Failed to parse conversations export", { error: String(err) });
    return [];
  }
}

export interface ConversationSample {
  dialogId: string;
  formatted: string;
  outcome: string;
  messageCount: number;
}

/**
 * Sample N sales-relevant conversations from the export file.
 * Returns formatted anonymized text blocks ready for injection into LLM prompts.
 */
export function sampleConversations(
  filePath: string,
  count = 5,
  maxMessagesPerDialog = 12,
): ConversationSample[] {
  const all = loadConversations(filePath);
  const sales = all.filter(isSalesDialogue);

  logger.info("Filtered sales dialogues", { total: all.length, sales: sales.length });

  // Prefer longer, richer dialogues (more messages = more context)
  const sorted = [...sales].sort((a, b) => b.messages.length - a.messages.length);

  // Take top N but spread across the array for variety
  const step = Math.max(1, Math.floor(sorted.length / count));
  const selected: ExportedConversation[] = [];

  for (let i = 0; i < sorted.length && selected.length < count; i += step) {
    selected.push(sorted[i]);
  }

  return selected.map((conv) => {
    const truncated = { ...conv, messages: conv.messages.slice(0, maxMessagesPerDialog) };
    return {
      dialogId: conv.dialog_id,
      formatted: formatConversationForPrompt(truncated),
      outcome: conv.outcome,
      messageCount: conv.messages.length,
    };
  });
}

/** Format sampled conversations as a single few-shot block for prompt injection. */
export function buildFewShotBlock(samples: ConversationSample[]): string {
  if (!samples.length) return "Примеры реальных диалогов недоступны.";

  const lines: string[] = [
    "## Примеры реальных диалогов Retro Pressa (для понимания контекста)\n",
    "Используй эти диалоги как эталон реального общения клиентов и менеджеров.",
    "Обрати внимание на: типичные вопросы клиентов, продуктовые термины, ценовые диапазоны, возражения.\n",
  ];

  for (const s of samples) {
    lines.push(s.formatted);
    lines.push("");
  }

  return lines.join("\n");
}
