/**
 * Register a manager in the training system — auto-generates unique bot invite link.
 *
 * Usage:
 *   npx tsx scripts/create-manager.ts --id anna-ivanova --name "Анна Иванова"
 */
import { initTrainingDb } from "../src/training/db.js";
import { createManager } from "../src/training/manager-service.js";
import { getDb } from "../src/db/client.js";

getDb();
initTrainingDb();

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const externalId = arg("id");
const fullName = arg("name");

if (!externalId || !fullName) {
  console.error(`Usage: npx tsx scripts/create-manager.ts --id MANAGER_ID --name "Full Name" [--service retro-pressa]`);
  process.exit(1);
}

const links = createManager({
  externalId,
  fullName,
  serviceTag: arg("service") ?? "retro-pressa",
  managerTelegramId: arg("rop"),
});

console.log("\n✅ Manager registered\n");
console.log(`ID:     ${links.manager.externalId}`);
console.log(`Name:   ${links.manager.fullName}`);
console.log(`Token:  ${links.inviteToken}`);
console.log(`Bot:    ${links.botLink}`);
console.log(`Page:   ${links.practicePageUrl}\n`);
console.log("→ В LMS на этап «Практика» вставьте Page-ссылку с ?manager=" + links.manager.externalId);
