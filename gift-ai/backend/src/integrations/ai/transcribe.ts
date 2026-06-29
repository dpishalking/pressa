import { config } from "../../config.js";
import { logger } from "../../logger.js";

const TRANSCRIBE_PROMPT =
  "Распознай речь в этом аудио. Язык — русский. Верни только текст того, что сказано, без кавычек и пояснений. Если речи нет или неразборчиво — верни пустую строку.";

function mimeCandidates(primary: string): string[] {
  return [...new Set([primary, "audio/ogg", "audio/webm", "audio/mpeg", "audio/mp4"])];
}

function modelsToTry(): string[] {
  const models = [config.GEMINI_MODEL];
  if (config.GEMINI_MODEL_FALLBACK && !models.includes(config.GEMINI_MODEL_FALLBACK)) {
    models.push(config.GEMINI_MODEL_FALLBACK);
  }
  return models;
}

async function callOnce(model: string, mimeType: string, base64Data: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: TRANSCRIBE_PROMPT },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.error("Gemini transcribe error", { model, mimeType, status: res.status, body: errText.slice(0, 200) });
    const err = new Error(`Gemini transcribe: ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = json.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p) => p.text ?? "").join("").trim();
}

export async function transcribeAudioBase64(mimeType: string, audioBase64: string): Promise<string> {
  if (!config.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY не настроен");
  }
  if (!audioBase64.trim()) {
    throw new Error("audioBase64 required");
  }

  let lastError: Error | null = null;

  for (const mime of mimeCandidates(mimeType)) {
    for (const model of modelsToTry()) {
      try {
        const text = await callOnce(model, mime, audioBase64);
        if (text) return text;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
  }

  if (lastError) throw lastError;
  return "";
}
