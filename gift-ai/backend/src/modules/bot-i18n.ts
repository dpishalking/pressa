import type { BotLanguage } from "./languages.js";

type Strings = {
  menuWelcome: string;
  menuPrompt: string;
  menuConsult: string;
  menuCatalog: string;
  menuLang: string;
  menuBack: string;
  greeting: string;
  langSaved: (title: string) => string;
  catalogTitle: string;
  catalogPick: string;
  catalogBack: string;
  catalogChooseConsult: string;
  useMenuHint: string;
};

const RU: Strings = {
  menuWelcome: "Здравствуйте! Меня зовут Чернилька, я ассистент Retro-Pressa. Помогу подобрать подарок, который по-настоящему удивит вашего близкого человека.",
  menuPrompt: "Что хотите сделать?",
  menuConsult: "🎁 Подобрать подарок под ситуацию",
  menuCatalog: "📋 Выбрать из каталога",
  menuLang: "🌐 Выбрать язык / Select language",
  menuBack: "⬅️ В меню",
  greeting:
    "👋 Помогу быстро оформить заявку — задам несколько коротких вопросов и передам менеджеру.\n\n🎂 По какому поводу подарок?",
  langSaved: (title) => `Язык общения: ${title}\n\nМожете вернуться в меню и начать подбор.`,
  catalogTitle: "📋 Каталог подарков Retro Pressa\n\nВыберите, что посмотреть подробнее:",
  catalogPick: "🎁 Подобрать этот подарок",
  catalogBack: "⬅️ К каталогу",
  catalogChooseConsult: "Вы выбрали подарок из каталога — уточню пару деталей и передам менеджеру.",
  useMenuHint: "Выберите действие кнопками ниже или нажмите /start для меню.",
};

const EN: Strings = {
  menuWelcome: "Hello! My name is Chernilka, I'm a Retro-Pressa assistant. I'll help you choose a gift that will truly surprise your loved one.",
  menuPrompt: "What would you like to do?",
  menuConsult: "🎁 Find a gift for my situation",
  menuCatalog: "📋 Browse catalog",
  menuLang: "🌐 Select language",
  menuBack: "⬅️ Main menu",
  greeting:
    "I'll collect a few basics and pass you to our manager.\n\nWhat's the occasion?",
  langSaved: (title) => `Chat language: ${title}\n\nGo back to the menu when you're ready.`,
  catalogTitle: "📋 Retro Pressa gift catalog\n\nTap a product to see more:",
  catalogPick: "🎁 Choose this gift",
  catalogBack: "⬅️ Back to catalog",
  catalogChooseConsult: "You picked a gift from the catalog — a few quick questions, then our manager takes over.",
  useMenuHint: "Use the buttons below or send /start for the menu.",
};

const LV: Strings = {
  menuWelcome: "Sveiki! Mani sauc Černilka, esmu Retro-Pressa asistents. Palīdzēšu izvēlēties dāvanu, kas patiesi pārsteigs jūsu mīļoto cilvēku.",
  menuPrompt: "Ko vēlaties darīt?",
  menuConsult: "🎁 Piemeklēt dāvanu situācijai",
  menuCatalog: "📋 Izvēlēties no kataloga",
  menuLang: "🌐 Izvēlēties valodu / Select language",
  menuBack: "⬅️ Izvēlne",
  greeting:
    "Lieliski! Palīdzēšu piemeklēt dāvanu jūsu situācijai.\n\nVarat rakstīt vai nosūtīt balss ziņu.\n\nVispirms — kāds ir pasākuma iemesls?",
  langSaved: (title) => `Sarunas valoda: ${title}\n\nAtgriezieties izvēlnē, kad esat gatavi.`,
  catalogTitle: "📋 Retro Pressa dāvanu katalogs\n\nIzvēlieties produktu:",
  catalogPick: "🎁 Izvēlēties šo dāvanu",
  catalogBack: "⬅️ Atpakaļ uz katalogu",
  catalogChooseConsult: "Izvēlējāties dāvanu no kataloga — uzdošu dažus jautājumus.",
  useMenuHint: "Izmantojiet pogas vai /start izvēlnei.",
};

const ET: Strings = {
  menuWelcome: "Tere! Minu nimi on Chernilka, olen Retro-Pressa assistent. Aitan valida kingi, mis tõeliselt üllatab teie lähedast inimest.",
  menuPrompt: "Mida soovite teha?",
  menuConsult: "🎁 Leia kingitus minu olukorda",
  menuCatalog: "📋 Vali kataloogist",
  menuLang: "🌐 Vali keel / Select language",
  menuBack: "⬅️ Menüüsse",
  greeting:
    "Suurepärane! Aitan valida kingi teie olukorda.\n\nVõite kirjutada või saata häälsõnumi.\n\nKõigepealt — mis puhul kink valitakse?",
  langSaved: (title) => `Suhtluskeel: ${title}\n\nMenüüsse saate tagasi minna, kui olete valmis.`,
  catalogTitle: "📋 Retro Pressa kingikataloog\n\nValige toode:",
  catalogPick: "🎁 Vali see kingitus",
  catalogBack: "⬅️ Tagasi kataloogi",
  catalogChooseConsult: "Valisite kingi kataloogist — küsin mõned täpsustavad küsimused.",
  useMenuHint: "Kasutage nuppe või saatke /start menüü jaoks.",
};

const LT: Strings = {
  menuWelcome: "Sveiki! Mano vardas Chernilka, esu Retro-Pressa asistentas. Padėsiu parinkti dovaną, kuri tikrai nustebins jūsų artimą žmogų.",
  menuPrompt: "Ką norite daryti?",
  menuConsult: "🎁 Parinkti dovaną situacijai",
  menuCatalog: "📋 Rinktis iš katalogo",
  menuLang: "🌐 Pasirinkti kalbą / Select language",
  menuBack: "⬅️ Į meniu",
  greeting:
    "Puiku! Padėsiu parinkti dovaną jūsų situacijai.\n\nGalite rašyti arba siųsti balso žinutę.\n\nPirmiausia — kokia proga?",
  langSaved: (title) => `Bendravimo kalba: ${title}\n\nGrįžkite į meniu, kai būsite pasiruošę.`,
  catalogTitle: "📋 Retro Pressa dovanų katalogas\n\nPasirinkite produktą:",
  catalogPick: "🎁 Rinktis šią dovaną",
  catalogBack: "⬅️ Atgal į katalogą",
  catalogChooseConsult: "Pasirinkote dovaną iš katalogo — užduosiu kelis klausimus.",
  useMenuHint: "Naudokite mygtukus arba /start meniu.",
};

const TABLE: Record<BotLanguage, Strings> = { ru: RU, en: EN, lv: LV, et: ET, lt: LT };

export function t(lang: BotLanguage): Strings {
  return TABLE[lang] ?? RU;
}

export function greeting(lang: BotLanguage, catalogGiftName?: string): string {
  const base = t(lang).greeting;
  if (!catalogGiftName) return base;
  const intro = t(lang).catalogChooseConsult;
  return `${intro}\n\n«${catalogGiftName}»\n\n${base.split("\n\n").slice(-1)[0]}`;
}

const ALL_GREETINGS = Object.values(TABLE).map((s) => s.greeting);

export function isConsultGreeting(text: string): boolean {
  const trimmed = text.trim();
  return ALL_GREETINGS.some((g) => trimmed === g || trimmed.endsWith(g.split("\n\n").slice(-1)[0]!));
}
