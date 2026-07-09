import type { Api } from "grammy";
import type { BotLanguage } from "./languages.js";

type ProfileCopy = { description: string; shortDescription: string };

const PROFILE: Record<BotLanguage, ProfileCopy> = {
  ru: {
    description:
      "Здравствуйте! Меня зовут Чернилька, я ассистент Retro-Pressa. Помогу подобрать подарок мужчине — папе, дедушке, мужу, брату, сыну или другому близкому, который по-настоящему удивит.\n\nНажмите Start, чтобы начать.",
    shortDescription:
      "Чернилька — ассистент Retro-Pressa. Подберу подарок мужчине: папе, дедушке, мужу, брату.",
  },
  en: {
    description:
      "Hello! My name is Chernilka, I'm a Retro-Pressa assistant. I'll help you choose a gift for a man — father, grandfather, husband, brother, son, or another close man who deserves a truly special surprise.\n\nTap Start to begin.",
    shortDescription: "Chernilka — Retro-Pressa assistant. Gifts for men: dad, grandpa, husband, brother.",
  },
  lv: {
    description:
      "Sveiki! Mani sauc Černilka, esmu Retro-Pressa asistents. Palīdzēšu izvēlēties dāvanu vīrietim — tēvam, vectēvam, vīram, brālim, dēlam vai citam tuvam cilvēkam.\n\nNospiediet Start, lai sāktu.",
    shortDescription: "Černilka — Retro-Pressa asistents. Dāvanas vīriešiem: tēvam, vectēvam, viram.",
  },
  et: {
    description:
      "Tere! Minu nimi on Chernilka, olen Retro-Pressa assistent. Aitan valida kingi mehele — isale, vanaisale, abikaasale, vennale, pojale või teisele lähedasele mehele.\n\nAlustamiseks vajutage Start.",
    shortDescription: "Chernilka — Retro-Pressa assistent. Kingid meestele: isale, vanaisale, abikaasale.",
  },
  lt: {
    description:
      "Sveiki! Mano vardas Chernilka, esu Retro-Pressa asistentas. Padėsiu parinkti dovaną vyrui — tėčiui, seneliui, vyrui, broliui, sūnui ar kitam artimam vyrui.\n\nPaspauskite Start, kad pradėtumėte.",
    shortDescription: "Chernilka — Retro-Pressa asistentas. Dovanos vyrams: tėčiui, seneliui, vyrui.",
  },
};

/** Текст приветствия в меню после /start — совпадает с первой строкой описания бота. */
export function menuWelcomeText(lang: BotLanguage): string {
  return PROFILE[lang]?.description.split("\n\n")[0] ?? PROFILE.ru.description.split("\n\n")[0]!;
}

/** Синхронизирует описание бота в Telegram (экран до кнопки Start). */
export async function configureBotProfile(api: Api): Promise<void> {
  const langs = Object.keys(PROFILE) as BotLanguage[];

  await api.setMyDescription(PROFILE.ru.description);
  await api.setMyShortDescription(PROFILE.ru.shortDescription);

  for (const lang of langs) {
    if (lang === "ru") continue;
    const copy = PROFILE[lang];
    await api.setMyDescription(copy.description, { language_code: lang });
    await api.setMyShortDescription(copy.shortDescription, { language_code: lang });
  }
}
