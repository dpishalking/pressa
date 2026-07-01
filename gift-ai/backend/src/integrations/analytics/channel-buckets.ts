/** Единые группы каналов для лидов, сделок и открытых линий */
export const CHANNEL_BUCKETS = [
  "WhatsApp (Wazzup)",
  "Telegram (Wazzup)",
  "WhatsApp",
  "Telegram",
  "Instagram",
  "Facebook",
  "Сайт retro-pressa.com",
  "Сайт: форма",
  "Другие сайты",
  "Вручную",
  "Не указан",
  "Другое",
] as const;

export type ChannelBucket = (typeof CHANNEL_BUCKETS)[number];

export function normalizeCrmChannel(
  sourceId: string | undefined,
  sourceLabel: string,
  sourceDescription = "",
): ChannelBucket {
  const id = (sourceId ?? "").toLowerCase();
  const label = sourceLabel.trim();
  const desc = sourceDescription.trim().toLowerCase();
  const combined = `${label} ${id} ${desc}`.toLowerCase();

  if (
    id.includes("wz_whatsapp") ||
    (label.includes("WAZZUP") && combined.includes("whatsapp"))
  ) {
    return "WhatsApp (Wazzup)";
  }
  if (label === "WhatsApp" || (combined.includes("whatsapp") && !combined.includes("wazzup"))) {
    return "WhatsApp";
  }

  if (
    id.includes("wz_telegram") ||
    (label.includes("WAZZUP") && combined.includes("telegram"))
  ) {
    return "Telegram (Wazzup)";
  }
  if (combined.includes("telegram")) {
    return "Telegram";
  }

  if (label === "Instagram" || combined.includes("instagram")) return "Instagram";
  if (label === "Facebook" || combined.includes("facebook")) return "Facebook";
  if (label === "В ручную" || id === "uc_lkput4") return "Вручную";

  if (
    label === "Website Retro Pressa.com" ||
    id === "web" ||
    (desc.includes("retro-pressa.com") && !desc.includes("/ru/new") && !desc.includes("/life") && !desc.includes("/est/") && !desc.includes("/de/") && !desc.includes("/gifts"))
  ) {
    if (
      label === "Website Retro Pressa.com" ||
      desc === "https://retro-pressa.com/" ||
      desc.endsWith("retro-pressa.com/lv") ||
      desc.endsWith("retro-pressa.com/ru") ||
      desc.includes("retro-pressa.com/ru/individual")
    ) {
      return "Сайт retro-pressa.com";
    }
  }

  if (
    desc.includes("retro-pressa.com/") ||
    label.includes("retro-pressa.com") ||
    label.startsWith("https://retro-pressa.com")
  ) {
    return "Сайт: форма";
  }

  if (label === "Website Retro Pressa.com" || id === "web") {
    return "Сайт retro-pressa.com";
  }

  if (
    label.startsWith("Website ") ||
    label.startsWith("https://") ||
    desc.startsWith("http")
  ) {
    return "Другие сайты";
  }

  if (!label || label === "empty") return "Не указан";
  return "Другое";
}

export function normalizeOpenLineChannel(channel: string): ChannelBucket {
  const lower = channel.trim().toLowerCase();
  if (lower.includes("wazzup") && lower.includes("whatsapp")) return "WhatsApp (Wazzup)";
  if (lower.includes("wazzup") && lower.includes("telegram")) return "Telegram (Wazzup)";
  if (lower.includes("instagram")) return "Instagram";
  if (lower.includes("facebook")) return "Facebook";
  if (lower.includes("telegram")) return "Telegram";
  return "Другое";
}

export function sortChannelRows<T extends { channel: string; revenueEur: number; leads: number }>(
  rows: T[],
): T[] {
  const order = new Map<string, number>(CHANNEL_BUCKETS.map((name, index) => [name, index]));
  return [...rows].sort((a, b) => {
    const byRevenue = b.revenueEur - a.revenueEur;
    if (byRevenue !== 0) return byRevenue;
    const byLeads = b.leads - a.leads;
    if (byLeads !== 0) return byLeads;
    return (order.get(a.channel) ?? 99) - (order.get(b.channel) ?? 99);
  });
}
