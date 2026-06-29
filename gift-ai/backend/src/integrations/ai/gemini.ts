import { config } from "../../config.js";
import { logger } from "../../logger.js";

type GeminiPart = { text: string };

export async function callGemini(opts: {
  system: string;
  user: string;
  json?: boolean;
}): Promise<string> {
  if (!config.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY не настроен");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent?key=${config.GEMINI_API_KEY}`;

  const body = {
    system_instruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    logger.error("Gemini API error", { status: res.status, body: errText.slice(0, 500) });
    throw new Error(`Gemini API: ${res.status}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!text) throw new Error("Gemini вернул пустой ответ");
  return text;
}
