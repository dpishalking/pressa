import type { BotLanguage } from "./languages.js";

type Strings = {
  menuWelcome: string;
  menuPrompt: string;
  menuConsult: string;
  menuCatalog: string;
  menuLang: string;
  menuBack: string;
  langSaved: (title: string) => string;
  catalogTitle: string;
  catalogPick: string;
  catalogPickConsult: string;
  catalogChooseAnother: string;
  catalogKeepContextTitle: string;
  consultBack: string;
  catalogBack: string;
  useMenuHint: string;
  consultRestarted: string;
  completeHandoff: string;
};

const RU: Strings = {
  menuWelcome: "Привет! Я Чернилька — помогу подобрать подарок Retro Pressa, от которого захватывает дух.",
  menuPrompt: "Что хотите сделать?",
  menuConsult: "🎁 Подобрать подарок под ситуацию",
  menuCatalog: "📋 Выбрать из каталога",
  menuLang: "🌐 Выбрать язык / Select language",
  menuBack: "⬅️ В меню",
  langSaved: (title) => `Язык общения: ${title}\n\nМожете вернуться в меню и начать подбор.`,
  catalogTitle: "📋 Каталог подарков Retro Pressa\n\nВыберите, что посмотреть подробнее:",
  catalogPick: "🎁 Подобрать этот подарок",
  catalogPickConsult: "✅ Выбрать этот подарок",
  catalogChooseAnother: "📋 Выбрать другой подарок из каталога",
  catalogKeepContextTitle:
    "📋 Каталог подарков\n\nВаши ответы сохранены — выберите другой вариант:",
  consultBack: "⬅️ Назад к рекомендации",
  catalogBack: "⬅️ К каталогу",
  useMenuHint: "Выберите действие кнопками ниже или нажмите /start для меню.",
  consultRestarted: "Начали заново.",
  completeHandoff:
    "✅ Вся информация передана менеджеру. Он свяжется с вами и поможет оформить заказ — без повторных вопросов.",
};

const EN: Strings = {
  menuWelcome: "Hi! I'm Chernilka — I'll help you find a Retro Pressa gift that truly moves people.",
  menuPrompt: "What would you like to do?",
  menuConsult: "🎁 Find a gift for my situation",
  menuCatalog: "📋 Browse catalog",
  menuLang: "🌐 Select language",
  menuBack: "⬅️ Main menu",
  langSaved: (title) => `Chat language: ${title}\n\nGo back to the menu when you're ready.`,
  catalogTitle: "📋 Retro Pressa gift catalog\n\nTap a product to see more:",
  catalogPick: "🎁 Choose this gift",
  catalogPickConsult: "✅ Choose this gift",
  catalogChooseAnother: "📋 Pick another gift from catalog",
  catalogKeepContextTitle: "📋 Gift catalog\n\nYour answers are saved — pick another option:",
  consultBack: "⬅️ Back to recommendation",
  catalogBack: "⬅️ Back to catalog",
  useMenuHint: "Use the buttons below or send /start for the menu.",
  consultRestarted: "Starting over.",
  completeHandoff:
    "✅ Your details were sent to our manager. They'll contact you to help with the order.",
};

const LV: Strings = {
  menuWelcome: "Sveiki! Es esmu Černilka — palīdzēšu atrast Retro Pressa dāvanu, kas patiesi aizrauj.",
  menuPrompt: "Ko vēlaties darīt?",
  menuConsult: "🎁 Piemeklēt dāvanu situācijai",
  menuCatalog: "📋 Izvēlēties no kataloga",
  menuLang: "🌐 Izvēlēties valodu / Select language",
  menuBack: "⬅️ Izvēlne",
  langSaved: (title) => `Sarunas valoda: ${title}\n\nAtgriezieties izvēlnē, kad esat gatavi.`,
  catalogTitle: "📋 Retro Pressa dāvanu katalogs\n\nIzvēlieties produktu:",
  catalogPick: "🎁 Izvēlēties šo dāvanu",
  catalogPickConsult: "✅ Izvēlēties šo dāvanu",
  catalogChooseAnother: "📋 Izvēlēties citu dāvanu no kataloga",
  catalogKeepContextTitle: "📋 Dāvanu katalogs\n\nJūsu atbildes saglabātas — izvēlieties citu variantu:",
  consultBack: "⬅️ Atpakaļ uz ieteikumu",
  catalogBack: "⬅️ Atpakaļ uz katalogu",
  useMenuHint: "Izmantojiet pogas vai /start izvēlnei.",
  consultRestarted: "Sākam no jauna.",
  completeHandoff: "✅ Informācija nodota menedžerim. Viņš ar jums sazināsies.",
};

const ET: Strings = {
  menuWelcome: "Tere! Olen Chernilka — aitan leida Retro Pressa kingi, mis tõeliselt liigutab.",
  menuPrompt: "Mida soovite teha?",
  menuConsult: "🎁 Leia kingitus minu olukorda",
  menuCatalog: "📋 Vali kataloogist",
  menuLang: "🌐 Vali keel / Select language",
  menuBack: "⬅️ Menüüsse",
  langSaved: (title) => `Suhtluskeel: ${title}\n\nMenüüsse saate tagasi minna, kui olete valmis.`,
  catalogTitle: "📋 Retro Pressa kingikataloog\n\nValige toode:",
  catalogPick: "🎁 Vali see kingitus",
  catalogPickConsult: "✅ Vali see kingitus",
  catalogChooseAnother: "📋 Vali kataloogist teine kingitus",
  catalogKeepContextTitle: "📋 Kingikataloog\n\nTeie vastused on salvestatud — valige teine variant:",
  consultBack: "⬅️ Tagasi soovituse juurde",
  catalogBack: "⬅️ Tagasi kataloogi",
  useMenuHint: "Kasutage nuppe või saatke /start menüü jaoks.",
  consultRestarted: "Alustame uuesti.",
  completeHandoff: "✅ Info on edastatud haldurile. Ta võtab teiega ühendust.",
};

const LT: Strings = {
  menuWelcome: "Sveiki! Aš Chernilka — padėsiu rasti Retro Pressa dovaną, kuri tikrai jaudina.",
  menuPrompt: "Ką norite daryti?",
  menuConsult: "🎁 Parinkti dovaną situacijai",
  menuCatalog: "📋 Rinktis iš katalogo",
  menuLang: "🌐 Pasirinkti kalbą / Select language",
  menuBack: "⬅️ Į meniu",
  langSaved: (title) => `Bendravimo kalba: ${title}\n\nGrįžkite į meniu, kai būsite pasiruošę.`,
  catalogTitle: "📋 Retro Pressa dovanų katalogas\n\nPasirinkite produktą:",
  catalogPick: "🎁 Rinktis šią dovaną",
  catalogPickConsult: "✅ Rinktis šią dovaną",
  catalogChooseAnother: "📋 Rinktis kitą dovaną iš katalogo",
  catalogKeepContextTitle: "📋 Dovanų katalogas\n\nJūsų atsakymai išsaugoti — pasirinkite kitą variantą:",
  consultBack: "⬅️ Atgal į rekomendaciją",
  catalogBack: "⬅️ Atgal į katalogą",
  useMenuHint: "Naudokite mygtukus arba /start meniu.",
  consultRestarted: "Pradedame iš naujo.",
  completeHandoff: "✅ Informacija perduota vadybininkui. Jis su jumis susisieks.",
};

const TABLE: Record<BotLanguage, Strings> = { ru: RU, en: EN, lv: LV, et: ET, lt: LT };

export function t(lang: BotLanguage): Strings {
  return TABLE[lang] ?? RU;
}
