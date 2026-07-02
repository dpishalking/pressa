import type { BitrixLead } from "../crm/bitrix-client.js";

export type LeadTrafficKind = "traffic" | "organic";

export type LeadTrafficStats = {
  /** Лиды в отчёте = трафик + органика. */
  marketingTotal: number;
  traffic: number;
  organic: number;
  excludedMessengers: number;
  excludedIgnored: number;
  excludedReviews: number;
};

const PAID_UTM_MEDIUM_KEYWORDS = ["cpc", "paid_social", "social_paid", "cpm", "ppc"] as const;

const PAID_LANDING_MARKERS = ["/ru/new", "/life"] as const;

const MAIN_SITE_SOURCE = "Website Retro Pressa.com";

function sourceText(lead: BitrixLead, sourceLabel: string): string {
  return `${sourceLabel} ${String(lead.SOURCE_DESCRIPTION ?? "")}`.toLowerCase();
}

/** WhatsApp, Wazzup, Telegram-бот — не входят в маркетинговый отчёт. */
export function isMessengerSource(sourceLabel: string): boolean {
  const label = sourceLabel.toLowerCase();
  if (label.includes("whatsapp") || label.includes("wazzup") || label.includes("ручн")) return true;
  if (label.includes("telegram") && !label.includes("instagram")) return true;
  return false;
}

export function isFullIgnoreStatus(statusLabel: string): boolean {
  const status = statusLabel.toLowerCase();
  return status.includes("игнор") || status.includes("ignore");
}

export function isReviewStatus(statusLabel: string): boolean {
  return statusLabel.toLowerCase().includes("отзыв");
}

export function isSentToEmailStatus(statusLabel: string): boolean {
  return statusLabel.toLowerCase().includes("почт");
}

export function isSpamOrDuplicateStatus(statusLabel: string): boolean {
  const status = statusLabel.toLowerCase();
  return status.includes("spam") || status.includes("спам") || status.includes("dub") || status.includes("дуб");
}

/** UTM medium/source с явными рекламными метками (не utm_source=paid_social на формах сайта). */
export function hasPaidUtm(lead: BitrixLead): boolean {
  const utmMedium = String(lead.UTM_MEDIUM ?? "").toLowerCase().trim();
  const utmSource = String(lead.UTM_SOURCE ?? "").toLowerCase().trim();
  if (PAID_UTM_MEDIUM_KEYWORDS.some((keyword) => utmMedium.includes(keyword))) return true;
  return utmSource === "facebook" || utmSource === "instagram";
}

export function isAdLanding(lead: BitrixLead, sourceLabel: string): boolean {
  const text = sourceText(lead, sourceLabel);
  return PAID_LANDING_MARKERS.some((marker) => text.includes(marker));
}

/** Рекламный трафик: соцсети, UTM, лендинги, спам/дубли с рекламы, email-формы с paid_social. */
export function isTrafficLead(lead: BitrixLead, sourceLabel: string, statusLabel: string): boolean {
  const label = sourceLabel.trim().toLowerCase();
  if (label === "instagram" || label === "facebook") return true;
  if (hasPaidUtm(lead)) return true;
  if (isAdLanding(lead, sourceLabel)) return true;
  if (isSpamOrDuplicateStatus(statusLabel)) return true;
  if (isSentToEmailStatus(statusLabel) && String(lead.UTM_SOURCE ?? "").toLowerCase().trim() === "paid_social") {
    return true;
  }
  return false;
}

/** Органика: прямой заход на основной сайт без рекламных меток в UTM medium/source. */
export function isOrganicLead(lead: BitrixLead, sourceLabel: string, statusLabel: string): boolean {
  if (sourceLabel.trim() !== MAIN_SITE_SOURCE) return false;
  if (isSentToEmailStatus(statusLabel)) return false;
  if (isTrafficLead(lead, sourceLabel, statusLabel)) return false;
  return true;
}

export function isExcludedFromMarketingPool(sourceLabel: string, statusLabel: string): boolean {
  return isMessengerSource(sourceLabel) || isFullIgnoreStatus(statusLabel) || isReviewStatus(statusLabel);
}

/** @deprecated используйте isTrafficLead */
export function classifyLeadTraffic(lead: BitrixLead, sourceLabel: string): LeadTrafficKind {
  return isTrafficLead(lead, sourceLabel, "") ? "traffic" : "organic";
}

export function countLeadTraffic(
  leads: BitrixLead[],
  sourceLabels: Map<string, string>,
  statusLabels: Map<string, string>,
): LeadTrafficStats {
  let traffic = 0;
  let organic = 0;
  let excludedMessengers = 0;
  let excludedIgnored = 0;
  let excludedReviews = 0;

  for (const lead of leads) {
    const sourceLabel = sourceLabels.get(lead.SOURCE_ID ?? "") ?? lead.SOURCE_ID ?? "";
    const statusLabel = statusLabels.get(lead.STATUS_ID ?? "") ?? "";

    if (isMessengerSource(sourceLabel)) {
      excludedMessengers += 1;
      continue;
    }
    if (isFullIgnoreStatus(statusLabel)) {
      excludedIgnored += 1;
      continue;
    }
    if (isReviewStatus(statusLabel)) {
      excludedReviews += 1;
      continue;
    }

    if (isOrganicLead(lead, sourceLabel, statusLabel)) {
      organic += 1;
    } else {
      traffic += 1;
    }
  }

  return {
    marketingTotal: traffic + organic,
    traffic,
    organic,
    excludedMessengers,
    excludedIgnored,
    excludedReviews,
  };
}
