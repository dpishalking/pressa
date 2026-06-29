import { readFileSync } from "node:fs";
import { parseRetroPressaSheet } from "../src/integrations/sheets/retro-pressa-sheet.js";

const csv = readFileSync("/tmp/retro-sheet.csv", "utf8");
const gifts = parseRetroPressaSheet(csv);
console.log(JSON.stringify(gifts.map((g) => ({ id: g.externalId, name: g.name, emotions: g.emotions, suitableFor: g.suitableFor })), null, 2));
