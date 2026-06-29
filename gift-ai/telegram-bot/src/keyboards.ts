import { InlineKeyboard } from "grammy";
import { giftLabel } from "./gift-emojis.js";
import { BOT_LANGUAGES } from "./languages.js";
import type { BotLanguage } from "./languages.js";
import { t } from "./i18n.js";

export function handoffActionsKeyboard(
  buttonLabel: string,
  handoffUrl: string,
  lang: BotLanguage,
): InlineKeyboard {
  const s = t(lang);
  return new InlineKeyboard()
    .url(buttonLabel, handoffUrl)
    .row()
    .text(s.catalogChooseAnother, "consult:catalog")
    .row()
    .text(s.menuBack, "menu:main");
}

/** @deprecated use handoffActionsKeyboard */
export function managerHandoffKeyboard(
  buttonLabel: string,
  handoffUrl: string,
  lang: BotLanguage,
): InlineKeyboard {
  return handoffActionsKeyboard(buttonLabel, handoffUrl, lang);
}

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
  opts?: { consult?: boolean },
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const prefix = opts?.consult ? "cat:consult:view:" : "cat:view:";
  for (const item of items) {
    kb.text(giftLabel(item.externalId, item.name), `${prefix}${item.externalId}`).row();
  }
  kb.text(opts?.consult ? t(lang).consultBack : t(lang).menuBack, opts?.consult ? "consult:back" : "menu:main");
  return kb;
}

export function catalogGiftKeyboard(
  externalId: string,
  lang: BotLanguage,
  opts?: { consult?: boolean },
): InlineKeyboard {
  const s = t(lang);
  const pickAction = opts?.consult ? `cat:consult:pick:${externalId}` : `cat:pick:${externalId}`;
  const backAction = opts?.consult ? "consult:catalog" : "menu:catalog";
  return new InlineKeyboard()
    .text(opts?.consult ? s.catalogPickConsult : s.catalogPick, pickAction)
    .row()
    .text(s.catalogBack, backAction)
    .row()
    .text(s.menuBack, "menu:main");
}
