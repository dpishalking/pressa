import { InlineKeyboard } from "grammy";
import { giftLabel } from "./gift-emojis.js";
import { BOT_LANGUAGES } from "./languages.js";
import type { BotLanguage } from "./languages.js";
import { t } from "./i18n.js";

export function mainMenuKeyboard(lang: BotLanguage): InlineKeyboard {
  const s = t(lang);
  return new InlineKeyboard()
    .text(s.menuConsult, "menu:consult")
    .row()
    .text(s.menuCatalog, "menu:catalog")
    .row()
    .text(s.menuLang, "menu:lang");
}

export function languageKeyboard(lang: BotLanguage): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const item of BOT_LANGUAGES) {
    kb.text(item.title, `lang:${item.id}`).row();
  }
  kb.text(t(lang).menuBack, "menu:main");
  return kb;
}

export function catalogListKeyboard(
  items: { externalId: string; name: string }[],
  lang: BotLanguage,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const item of items) {
    kb.text(giftLabel(item.externalId, item.name, lang), `cat:view:${item.externalId}`).row();
  }
  kb.text(t(lang).menuBack, "menu:main");
  return kb;
}

export function catalogGiftKeyboard(externalId: string, lang: BotLanguage): InlineKeyboard {
  const s = t(lang);
  return new InlineKeyboard()
    .text(s.catalogPick, `cat:pick:${externalId}`)
    .row()
    .text(s.catalogBack, "menu:catalog")
    .row()
    .text(s.menuBack, "menu:main");
}
