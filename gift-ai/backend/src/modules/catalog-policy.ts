import { knowledgeBase } from "./knowledge-base.js";
import { defaultNameForExternalId } from "./product-catalog.js";
import { logger } from "../logger.js";

/** Не показываем в Telegram-боте (остаются в CRM/таблице для истории). */
const HIDDEN_IN_BOT = new Set(["joke-passport", "discovery-passport", "family-subscription"]);

export function applyBotCatalogPolicy(): { hidden: number; renamed: number } {
  let hidden = 0;
  let renamed = 0;

  for (const externalId of HIDDEN_IN_BOT) {
    const gift = knowledgeBase.getByExternalId(externalId);
    if (gift?.active) {
      knowledgeBase.updateGift(gift.id, { active: false });
      hidden += 1;
    }
  }

  const lifeBookName = defaultNameForExternalId("life-book");
  const lifeBook = knowledgeBase.getByExternalId("life-book");
  if (lifeBook && lifeBookName && lifeBook.name !== lifeBookName) {
    knowledgeBase.updateGift(lifeBook.id, { name: lifeBookName });
    renamed += 1;
  }

  if (hidden || renamed) {
    logger.info("Bot catalog policy applied", { hidden, renamed });
  }

  return { hidden, renamed };
}
