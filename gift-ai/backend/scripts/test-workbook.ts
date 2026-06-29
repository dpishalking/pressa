import { parseGiftsFromWorkbookZip, fetchWorkbookZip } from "../src/integrations/sheets/workbook-sync.js";

const sheetId = "1hLYcO6_knzWrfz6RWuHkQPuJoRajiy1XM9Z1aqHcQ98";
const zip = await fetchWorkbookZip(sheetId);
const parsed = parseGiftsFromWorkbookZip(zip);
for (const { sheet, gifts } of parsed) {
  console.log(`\n=== ${sheet} (${gifts.length}) ===`);
  for (const g of gifts) console.log(" -", g.name);
}
console.log("\nTotal:", parsed.reduce((s, p) => s + p.gifts.length, 0));
