import type { BotLanguage } from "./languages.js";

type Strings = {
  menuWelcome: string;
  menuPrompt: string;
  menuConsultMan: string;
  menuConsult: string;
  menuCatalog: string;
  menuLang: string;
  menuBack: string;
  greeting: string;
  greetingForMan: string;
  langSaved: (title: string) => string;
  catalogTitle: string;
  catalogPick: string;
  catalogBack: string;
  catalogChooseConsult: string;
  useMenuHint: string;
};

const RU: Strings = {
  menuWelcome:
    "Здравствуйте! Меня зовут Чернилька, я ассистент Retro-Pressa. Помогу подобрать подарок мужчине — папе, дедушке, мужу, брату, сыну или другому близкому, который по-настоящему удивит.",
  menuPrompt: "Что хотите сделать?",
  menuConsultMan: "👔 Подобрать подарок мужчине",
  menuConsult: "🎁 Подобрать подарок под ситуацию",
  menuCatalog: "📋 Выбрать из каталога",
  menuLang: "🌐 Выбрать язык / Select language",
  menuBack: "⬅️ В меню",
  greeting:
    "👋 Помогу подобрать подарок мужчине — задам несколько коротких вопросов и передам менеджеру.\n\n🎂 По какому поводу подарок?",
  greetingForMan:
    "👔 Отлично! Подберём подарок мужчине — папе, дедушке, мужу, брату, сыну или другому близкому.\n\nЗадам несколько коротких вопросов и передам менеджеру.\n\n🎂 По какому поводу подарок?",
  langSaved: (title) => `Язык общения: ${title}\n\nМожете вернуться в меню и начать подбор.`,
  catalogTitle: "📋 Каталог подарков Retro Pressa\n\nВыберите, что посмотреть подробнее:",
  catalogPick: "🎁 Подобрать этот подарок",
  catalogBack: "⬅️ К каталогу",
  catalogChooseConsult: "Вы выбрали подарок из каталога — уточню пару деталей и передам менеджеру.",
  useMenuHint: "Выберите действие кнопками ниже или нажмите /start для меню.",
};

const EN: Strings = {
  menuWelcome:
    "Hello! My name is Chernilka, I'm a Retro-Pressa assistant. I'll help you choose a gift for a man — father, grandfather, husband, brother, son, or another close man.",
  menuPrompt: "What would you like to do?",
  menuConsultMan: "👔 Find a gift for a man",
  menuConsult: "🎁 Find a gift for my situation",
  menuCatalog: "📋 Browse catalog",
  menuLang: "🌐 Select language",
  menuBack: "⬅️ Main menu",
  greeting:
    "I'll help you pick a gift for a man — a few quick questions, then our manager takes over.\n\nWhat's the occasion?",
  greetingForMan:
    "Great! Let's find a gift for a man — dad, grandpa, husband, brother, son, or someone close.\n\nA few quick questions, then our manager takes over.\n\nWhat's the occasion?",
  langSaved: (title) => `Chat language: ${title}\n\nGo back to the menu when you're ready.`,
  catalogTitle: "📋 Retro Pressa gift catalog\n\nTap a product to see more:",
  catalogPick: "🎁 Choose this gift",
  catalogBack: "⬅️ Back to catalog",
  catalogChooseConsult: "You picked a gift from the catalog — a few quick questions, then our manager takes over.",
  useMenuHint: "Use the buttons below or send /start for the menu.",
};

const LV: Strings = {
  menuWelcome:
    "Sveiki! Mani sauc Černilka, esmu Retro-Pressa asistents. Palīdzēšu izvēlēties dāvanu vīrietim — tēvam, vectēvam, viram, brālim, dēlam vai citam tuvam cilvēkam.",
  menuPrompt: "Ko vēlaties darīt?",
  menuConsultMan: "👔 Piemeklēt dāvanu vīrietim",
  menuConsult: "🎁 Piemeklēt dāvanu situācijai",
  menuCatalog: "📋 Izvēlēties no kataloga",
  menuLang: "🌐 Izvēlēties valodu / Select language",
  menuBack: "⬅️ Izvēlne",
  greeting:
    "Palīdzēšu piemeklēt dāvanu vīrietim — daži īsi jautājumi, tad nododam menedžerim.\n\nKāds ir pasākuma iemesls?",
  greetingForMan:
    "Lieliski! Piemeklēsim dāvanu vīrietim — tēvam, vectēvam, viram, brālim, dēlam vai citam tuvam cilvēkam.\n\nDaži īsi jautājumi, tad nododam menedžerim.\n\nKāds ir pasākuma iemesls?",
  langSaved: (title) => `Sarunas valoda: ${title}\n\nAtgriezieties izvēlnē, kad esat gatavi.`,
  catalogTitle: "📋 Retro Pressa dāvanu katalogs\n\nIzvēlieties produktu:",
  catalogPick: "🎁 Izvēlēties šo dāvanu",
  catalogBack: "⬅️ Atpakaļ uz katalogu",
  catalogChooseConsult: "Izvēlējāties dāvanu no kataloga — uzdošu dažus jautājumus.",
  useMenuHint: "Izmantojiet pogas vai /start izvēlnei.",
};

const ET: Strings = {
  menuWelcome:
    "Tere! Minu nimi on Chernilka, olen Retro-Pressa assistent. Aitan valida kingi mehele — isale, vanaisale, abikaasale, vennale, pojale või teisele lähedasele mehele.",
  menuPrompt: "Mida soovite teha?",
  menuConsultMan: "👔 Leia kingitus mehele",
  menuConsult: "🎁 Leia kingitus minu olukorda",
  menuCatalog: "📋 Vali kataloogist",
  menuLang: "🌐 Vali keel / Select language",
  menuBack: "⬅️ Menüüsse",
  greeting:
    "Aitan valida kingi mehele — paar lühikest küsimust, siis edastame haldurile.\n\nMis puhul kink valitakse?",
  greetingForMan:
    "Suurepärane! Valime kingi mehele — isale, vanaisale, abikaasale, vennale, pojale või teisele lähedasele mehele.\n\nPaar lühikest küsimust, siis edastame haldurile.\n\nMis puhul kink valitakse?",
  langSaved: (title) => `Suhtluskeel: ${title}\n\nMenüüsse saate tagasi minna, kui olete valmis.`,
  catalogTitle: "📋 Retro Pressa kingikataloog\n\nValige toode:",
  catalogPick: "🎁 Vali see kingitus",
  catalogBack: "⬅️ Tagasi kataloogi",
  catalogChooseConsult: "Valisite kingi kataloogist — küsin mõned täpsustavad küsimused.",
  useMenuHint: "Kasutage nuppe või saatke /start menüü jaoks.",
};

const LT: Strings = {
  menuWelcome:
    "Sveiki! Mano vardas Chernilka, esu Retro-Pressa asistentas. Padėsiu parinkti dovaną vyrui — tėčiui, seneliui, vyrui, broliui, sūnui ar kitam artimam vyrui.",
  menuPrompt: "Ką norite daryti?",
  menuConsultMan: "👔 Parinkti dovaną vyrui",
  menuConsult: "🎁 Parinkti dovaną situacijai",
  menuCatalog: "📋 Rinktis iš katalogo",
  menuLang: "🌐 Pasirinkti kalbą / Select language",
  menuBack: "⬅️ Į meniu",
  greeting:
    "Padėsiu parinkti dovaną vyrui — keli trumpi klausimai, tada perduosime vadybininkui.\n\nKokia proga?",
  greetingForMan:
    "Puiku! Parinksime dovaną vyrui — tėčiui, seneliui, vyrui, broliui, sūnui ar kitam artimam vyrui.\n\nKeli trumpi klausimai, tada perduosime vadybininkui.\n\nKokia proga?",
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

export function greeting(lang: BotLanguage, catalogGiftName?: string, giftForMan?: boolean): string {
  const base = giftForMan ? t(lang).greetingForMan : t(lang).greeting;
  if (!catalogGiftName) return base;
  const intro = t(lang).catalogChooseConsult;
  return `${intro}\n\n«${catalogGiftName}»\n\n${base.split("\n\n").slice(-1)[0]}`;
}

const ALL_GREETINGS = Object.values(TABLE).flatMap((s) => [s.greeting, s.greetingForMan]);

export function isConsultGreeting(text: string): boolean {
  const trimmed = text.trim();
  return ALL_GREETINGS.some((g) => trimmed === g || trimmed.endsWith(g.split("\n\n").slice(-1)[0]!));
}
