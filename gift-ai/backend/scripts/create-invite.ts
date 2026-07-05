/**
 * Create a personal or team invite link for the trainer bot.
 *
 * Usage:
 *   npx tsx scripts/create-invite.ts \
 *     --team "Команда Иванова" \
 *     --name "Мария Петрова" \
 *     --service retro-pressa \
 *     --manager 123456789
 */
import { initTrainingDb } from "../src/training/db.js";
import { createInvite, buildInviteLink } from "../src/training/invite-service.js";
import { getDb } from "../src/db/client.js";

getDb();
initTrainingDb();

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const teamName = arg("team");
if (!teamName) {
  console.error(`Usage: npx tsx scripts/create-invite.ts --team "Team name" [--name "Employee name"] [--service retro-pressa] [--manager TELEGRAM_ID] [--max-uses 1]`);
  process.exit(1);
}

const invite = createInvite({
  teamName,
  presetFullName: arg("name"),
  serviceTag: arg("service") ?? "retro-pressa",
  managerTelegramId: arg("manager"),
  maxUses: arg("max-uses") ? Number(arg("max-uses")) : 1,
});

const botUsername = process.env.TRAINER_BOT_USERNAME?.replace(/^@/, "") ?? "dushnila12_bot";
const link = buildInviteLink(botUsername, invite.token);
const practiceBase = process.env.TRAINER_PRACTICE_URL ?? "http://localhost:3100/trainer/practice";
const practiceLink = `${practiceBase}?invite=${invite.token}`;

console.log("\n✅ Invite created\n");
console.log(`Token:  ${invite.token}`);
console.log(`Team:   ${invite.teamName}`);
console.log(`Name:   ${invite.presetFullName ?? "(from Telegram profile)"}`);
console.log(`Service: ${invite.serviceTag}`);
console.log(`Bot:    ${link}`);
console.log(`Page:   ${practiceLink}\n`);
