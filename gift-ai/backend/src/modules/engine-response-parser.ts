import type { EngineResponse, PersonalityType, QualificationFields } from "../types/index.js";

function cleanRaw(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function extractReplyField(raw: string): string | null {
  const cleaned = cleanRaw(raw);
  const keyMatch = cleaned.match(/"reply"\s*:\s*"/);
  if (!keyMatch || keyMatch.index === undefined) return null;

  let i = keyMatch.index + keyMatch[0].length;
  const chars: string[] = [];
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (ch === "\\") {
      if (i + 1 >= cleaned.length) break;
      const next = cleaned[i + 1];
      const escaped: Record<string, string> = {
        n: "\n",
        t: "\t",
        r: "\r",
        '"': '"',
        "\\": "\\",
        "/": "/",
      };
      chars.push(escaped[next] ?? next);
      i += 2;
      continue;
    }
    if (ch === '"') break;
    chars.push(ch);
    i++;
  }

  const reply = chars.join("").trim();
  return reply || null;
}

function tryParseRepaired(cleaned: string): Record<string, unknown> | null {
  let inString = false;
  let escape = false;
  let depth = 0;

  for (const ch of cleaned) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }
  }

  let repair = cleaned;
  if (inString) repair += '"';
  while (depth > 0) {
    repair += "}";
    depth--;
  }

  try {
    return JSON.parse(repair) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractScalar(raw: string, key: string): string | number | boolean | null {
  const strMatch = raw.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`));
  if (strMatch) {
    return strMatch[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  const numMatch = raw.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
  if (numMatch) return Number(numMatch[1]);
  const boolMatch = raw.match(new RegExp(`"${key}"\\s*:\\s*(true|false)`));
  if (boolMatch) return boolMatch[1] === "true";
  return null;
}

function buildFromData(data: Record<string, unknown>): EngineResponse {
  const fields = (data.fields ?? {}) as Partial<QualificationFields>;
  const stage = Math.min(10, Math.max(1, Number(data.stage) || 1));

  return {
    reply: String(data.reply ?? "Понял. Давайте продолжим."),
    stage: stage as EngineResponse["stage"],
    fields,
    personalityType: (data.personalityType as PersonalityType) ?? fields.personalityType ?? "",
    leadScore: Math.min(100, Math.max(0, Number(data.leadScore) || 50)),
    leadScoreBand: "interested",
    recommendedGiftIds: Array.isArray(data.recommendedGiftIds)
      ? data.recommendedGiftIds.map(String)
      : fields.recommendedGiftId
        ? [fields.recommendedGiftId]
        : [],
    emotion: String(data.emotion ?? ""),
    isComplete: Boolean(data.isComplete),
  };
}

function buildFromPartial(raw: string, reply: string): EngineResponse {
  const cleaned = cleanRaw(raw);
  const repaired = tryParseRepaired(cleaned);
  if (repaired?.reply) {
    return { ...buildFromData(repaired), reply: String(repaired.reply) };
  }

  const stage = extractScalar(cleaned, "stage");
  const leadScore = extractScalar(cleaned, "leadScore");
  const isComplete = extractScalar(cleaned, "isComplete");

  let fields: Partial<QualificationFields> = {};
  const fieldsMatch = cleaned.match(/"fields"\s*:\s*(\{[\s\S]*)/);
  if (fieldsMatch) {
    const repairedFields = tryParseRepaired(fieldsMatch[1]);
    if (repairedFields) fields = repairedFields as Partial<QualificationFields>;
  }

  return {
    reply,
    stage: Math.min(10, Math.max(1, typeof stage === "number" ? stage : 1)) as EngineResponse["stage"],
    fields,
    personalityType: (extractScalar(cleaned, "personalityType") as PersonalityType) ?? "",
    leadScore: Math.min(100, Math.max(0, typeof leadScore === "number" ? leadScore : 50)),
    leadScoreBand: "interested",
    recommendedGiftIds: [],
    emotion: String(extractScalar(cleaned, "emotion") ?? ""),
    isComplete: isComplete === true,
  };
}

export function parseEngineResponse(raw: string): EngineResponse {
  const cleaned = cleanRaw(raw);
  if (!cleaned) throw new Error("empty engine response");

  try {
    return buildFromData(JSON.parse(cleaned) as Record<string, unknown>);
  } catch {
    const repaired = tryParseRepaired(cleaned);
    if (repaired && typeof repaired.reply === "string" && repaired.reply.trim()) {
      return buildFromData(repaired);
    }

    const reply = extractReplyField(raw);
    if (reply) return buildFromPartial(raw, reply);

    throw new Error("unable to parse engine response");
  }
}
