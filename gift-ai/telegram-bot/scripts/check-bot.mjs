import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(dir, "../.env");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const token = env.BOT_TOKEN?.trim();
if (!token) {
  console.log("BOT_TOKEN missing");
  process.exit(1);
}

const tg = async (method) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`);
  return res.json();
};

const me = await tg("getMe");
console.log("bot:", me.ok ? `@${me.result.username}` : me.description);

const wh = await tg("getWebhookInfo");
console.log("webhook:", wh.result?.url || "(polling)");
console.log("pending_updates:", wh.result?.pending_update_count);

const apiUrl = (env.API_URL ?? "").replace(/\/$/, "");
if (apiUrl) {
  try {
    const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(8000) });
    console.log("api:", apiUrl, "->", res.status, await res.text().then((t) => t.slice(0, 80)));
  } catch (e) {
    console.log("api:", apiUrl, "-> FAIL", e.message);
  }
}
