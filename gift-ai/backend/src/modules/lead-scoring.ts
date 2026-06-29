import type { Gift, LeadScoreBand, QualificationFields } from "../types/index.js";

export function scoreToBand(score: number): LeadScoreBand {
  if (score >= 90) return "ready";
  if (score >= 70) return "needs_details";
  if (score >= 40) return "interested";
  return "non_target";
}

export function bandLabel(band: LeadScoreBand): string {
  switch (band) {
    case "ready":
      return "готов покупать (90–100)";
    case "needs_details":
      return "нужно уточнить детали (70–90)";
    case "interested":
      return "интересуется (40–70)";
    case "non_target":
      return "нецелевой (ниже 40)";
  }
}

export class LeadScoring {
  compute(
    fields: QualificationFields,
    opts: {
      modelScore: number;
      hasRecommendation: boolean;
      emotionTone: string;
      stage: number;
    },
  ): number {
    let score = Math.min(100, Math.max(0, opts.modelScore));

    const filled = [
      fields.occasion,
      fields.recipient,
      fields.budget,
      fields.desiredEmotions,
      fields.phone || fields.telegram,
      fields.recommendedGiftName,
    ].filter(Boolean).length;

    score += filled * 3;

    if (opts.hasRecommendation) score += 10;
    if (fields.phone) score += 8;
    if (opts.emotionTone === "positive") score += 5;
    if (opts.emotionTone === "negative") score -= 15;
    if (opts.emotionTone === "hesitant") score -= 5;
    if (opts.stage >= 10 && fields.phone) score += 10;

    return Math.min(100, Math.max(0, Math.round(score)));
  }
}

export class RecommendationEngine {
  match(gifts: Gift[], fields: QualificationFields, ids: string[]): Gift[] {
    if (ids.length) {
      const byId = new Map(gifts.map((g) => [g.id, g]));
      return ids.map((id) => byId.get(id)).filter(Boolean) as Gift[];
    }

    const occasion = fields.occasion.toLowerCase();
    const emotions = fields.desiredEmotions.toLowerCase();
    const budget = parseBudget(fields.budget);

    return gifts
      .map((g) => {
        let pts = 0;
        if (occasion && g.occasions.some((o) => occasion.includes(o.toLowerCase()) || o.toLowerCase().includes(occasion)))
          pts += 3;
        if (emotions && g.emotions.some((e) => emotions.includes(e.toLowerCase()))) pts += 3;
        if (fields.recipient && g.suitableFor.some((s) => fields.recipient.toLowerCase().includes(s.toLowerCase())))
          pts += 2;
        if (budget && g.priceMax <= budget.max && g.priceMin >= budget.min * 0.7) pts += 2;
        return { g, pts };
      })
      .filter((x) => x.pts > 0)
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 3)
      .map((x) => x.g);
  }
}

function parseBudget(raw: string): { min: number; max: number } | null {
  const nums = raw.match(/\d[\d\s]*/g)?.map((n) => Number(n.replace(/\s/g, ""))) ?? [];
  if (!nums.length) return null;
  if (nums.length === 1) return { min: 0, max: nums[0] };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

export const leadScoring = new LeadScoring();
export const recommendationEngine = new RecommendationEngine();
