const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() ?? "";
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
const GEMINI_MODEL_FALLBACK = process.env.GEMINI_MODEL_FALLBACK?.trim() || "gemini-2.5-pro";
const BOT_TOKEN = process.env.BOT_TOKEN ?? "";

const TRANSCRIBE_PROMPT =
  "Распознай речь в этом аудио. Язык — русский. Верни только текст того, что сказано, без кавычек и пояснений. Если речи нет или неразборчиво — верни пустую строку.";

export function isTranscribeAvailable(): boolean {
  return Boolean(GEMINI_API_KEY && BOT_TOKEN);
}

export async function transcribeTelegramFile(filePath: string, mimeType: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY не задан — распознавание голоса недоступно.");
  }

  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) throw new Error("Не удалось скачать аудио из Telegram.");

  const base64 = Buffer.from(await fileRes.arrayBuffer()).toString("base64");
  const models = [GEMINI_MODEL, GEMINI_MODEL_FALLBACK];
  const mimes = mimeCandidates(mimeType);

  let lastError = "";

  for (const mime of mimes) {
    for (const model of models) {
      const result = await callGeminiTranscribe(model, mime, base64);
      if (result.text.trim()) return result.text.trim();
      if (result.error) lastError = result.error;
    }
  }

  if (lastError) throw new Error(lastError);
  return "";
}

function mimeCandidates(primary: string): string[] {
  return [...new Set([primary, "audio/ogg", "audio/webm", "audio/mpeg", "audio/mp4"])];
}

async function callGeminiTranscribe(
  model: string,
  mimeType: string,
  base64Data: string,
): Promise<{ text: string; error?: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
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
    console.error("[transcribe]", model, mimeType, res.status, errText.slice(0, 200));
    if (res.status === 401 || res.status === 403) {
      return { text: "", error: "Неверный GEMINI_API_KEY." };
    }
    if (res.status === 429) {
      return { text: "", error: "Слишком много запросов к Gemini. Подождите минуту." };
    }
    return { text: "", error: `Gemini не принял аудио (${res.status}). Напишите текстом.` };
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = json.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return { text: "" };
  return { text: parts.map((p) => p.text ?? "").join("").trim() };
}

/** Telegram voice → audio/ogg; audio messages may vary. */
export function mimeForTelegramAudio(mime?: string | null): string {
  if (mime?.startsWith("audio/")) return mime.split(";")[0];
  return "audio/ogg";
}
