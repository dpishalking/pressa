import { config } from "../../config.js";
import { logger } from "../../logger.js";

type GeminiPart = { text: string };

export type GeminiResult = {
  text: string;
  finishReason?: string;
};

const RETRYABLE_STATUSES = new Set([429, 500, 503]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function modelsToTry(): string[] {
  const models = [config.GEMINI_MODEL];
  if (config.GEMINI_MODEL_FALLBACK && !models.includes(config.GEMINI_MODEL_FALLBACK)) {
    models.push(config.GEMINI_MODEL_FALLBACK);
  }
  return models;
}

async function callGeminiOnce(
  model: string,
  opts: { system: string; user: string; json?: boolean },
): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.GEMINI_API_KEY}`;

  const body = {
    system_instruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    logger.error("Gemini API error", { model, status: res.status, body: errText.slice(0, 500) });
    const err = new Error(`Gemini API: ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: GeminiPart[] };
      finishReason?: string;
    }>;
  };
  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!text) throw new Error("Gemini вернул пустой ответ");
  return { text, finishReason: candidate?.finishReason };
}

export async function callGemini(opts: {
  system: string;
  user: string;
  json?: boolean;
}): Promise<GeminiResult> {
  if (!config.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY не настроен");
  }

  let lastError: Error | null = null;

  for (const model of modelsToTry()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await callGeminiOnce(model, opts);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        const status = (e as { status?: number })?.status;
        const retryable = status !== undefined && RETRYABLE_STATUSES.has(status);
        if (!retryable || attempt === 2) break;
        const delayMs = 800 * (attempt + 1) ** 2;
        logger.warn("Gemini retry", { model, attempt: attempt + 1, status, delayMs });
        await sleep(delayMs);
      }
    }
  }

  throw lastError ?? new Error("Gemini API failed");
}
