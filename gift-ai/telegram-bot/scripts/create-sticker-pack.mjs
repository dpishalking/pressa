#!/usr/bin/env node
/**
 * Создаёт стикерпак Telegram для @rpgifts_bot.
 *
 * Требования:
 * - BOT_TOKEN в .env
 * - STICKER_OWNER_TELEGRAM_ID — ваш Telegram user id (должны хотя бы раз написать боту /start)
 *
 * Запуск: npm run stickers:create
 */
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { FormData, File } from "node:buffer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MASCOT_DIR = path.join(ROOT, "assets", "mascot");
const STICKER_DIR = path.join(MASCOT_DIR, "stickers");

const STICKERS: { file: string; emoji: string[] }[] = [
  { file: "welcome", emoji: ["👋", "😊"] },
  { file: "occasion", emoji: ["🎉", "🎂"] },
  { file: "recipient", emoji: ["👤", "🙂"] },
  { file: "delivery", emoji: ["📅", "🚚"] },
  { file: "budget", emoji: ["💰", "💳"] },
  { file: "emotions", emoji: ["❤️", "🥰"] },
  { file: "interests", emoji: ["🎯", "📚"] },
  { file: "offer", emoji: ["🎁", "✨"] },
  { file: "compare", emoji: ["⚖️", "🤔"] },
  { file: "contacts", emoji: ["☎️", "📱"] },
  { file: "done", emoji: ["✅", "🎉"] },
  { file: "waiting", emoji: ["⏳", "👀"] },
  { file: "thanks", emoji: ["🙏", "😊"] },
  { file: "thinking", emoji: ["🤔", "💡"] },
];

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath).split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

function readFileSync(p: string) {
  return require("node:fs").readFileSync(p, "utf8") as string;
}

async function botUsername(token: string): Promise<string> {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = (await res.json()) as { ok: boolean; result?: { username?: string } };
  if (!data.ok || !data.result?.username) throw new Error("getMe failed");
  return data.result.username;
}

function buildWebp(sourceJpg: string, destWebp: string) {
  execSync(`npx --yes sharp-cli -i "${sourceJpg}" -o "${destWebp}" resize 512 512`, {
    stdio: "pipe",
    cwd: ROOT,
  });
}

async function apiMultipart(token: string, method: string, fields: Record<string, string>, files: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const [k, filePath] of Object.entries(files)) {
    const buf = await readFile(filePath);
    form.append(k, new File([buf], path.basename(filePath), { type: "image/webp" }));
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  loadEnv();
  const token = process.env.BOT_TOKEN;
  const ownerId = process.env.STICKER_OWNER_TELEGRAM_ID;
  if (!token) throw new Error("BOT_TOKEN не задан в .env");
  if (!ownerId) throw new Error("STICKER_OWNER_TELEGRAM_ID не задан в .env (ваш Telegram user id)");

  mkdirSync(STICKER_DIR, { recursive: true });

  const prepared: { file: string; emoji: string[]; webp: string }[] = [];
  for (const s of STICKERS) {
    const jpg = path.join(MASCOT_DIR, `${s.file}.jpg`);
    const webp = path.join(STICKER_DIR, `${s.file}.webp`);
    if (!existsSync(jpg)) throw new Error(`Нет файла ${jpg}`);
    console.log(`→ webp: ${s.file}`);
    buildWebp(jpg, webp);
    prepared.push({ ...s, webp });
  }

  const username = await botUsername(token);
  const setName = `retro_pressa_gifts_by_${username}`;
  const setTitle = "Пресся — подарки Retro Pressa";

  console.log(`→ создаём набор ${setName}…`);
  const first = prepared[0];
  await apiMultipart(
    token,
    "createNewStickerSet",
    {
      user_id: ownerId,
      name: setName,
      title: setTitle,
      sticker_format: "static",
      stickers: JSON.stringify([
        { sticker: "attach://sticker0", emoji_list: first.emoji, format: "static" },
      ]),
    },
    { sticker0: first.webp },
  );

  for (const s of prepared.slice(1)) {
    console.log(`→ добавляем ${s.file}…`);
    await apiMultipart(
      token,
      "addStickerToSet",
      {
        user_id: ownerId,
        name: setName,
        sticker: JSON.stringify({ sticker: "attach://sticker0", emoji_list: s.emoji, format: "static" }),
      },
      { sticker0: s.webp },
    );
  }

  const link = `https://t.me/addstickers/${setName}`;
  console.log(`\n✅ Стикерпак готов: ${link}`);
  await writeFile(path.join(ROOT, "assets", "sticker-pack-url.txt"), `${link}\n`);
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
