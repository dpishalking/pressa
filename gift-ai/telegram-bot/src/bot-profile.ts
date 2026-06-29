import type { Api } from "grammy";
import type { BotLanguage } from "./languages.js";

type ProfileCopy = { description: string; shortDescription: string };

const PROFILE: Record<BotLanguage, ProfileCopy> = {
  ru: {
    description:
      "Здравствуйте! Меня зовут Чернилька, я ассистент Retro-Pressa. Помогу подобрать подарок, который по-настоящему удивит вашего близкого человека.\n\nНажмите Start, чтобы начать.",
    shortDescription:
      "Чернилька — ассистент Retro-Pressa. Подберу подарок, который удивит вашего близкого.",
  },
  en: {
    description:
      "Hello! My name is Chernilka, I'm a Retro-Pressa assistant. I'll help you choose a gift that will truly surprise your loved one.\n\nTap Start to begin.",
    shortDescription: "Chernilka — Retro-Pressa assistant. Gifts that truly surprise your loved one.",
  },
  lv: {
    description:
      "Sveiki! Mani sauc Černilka, esmu Retro-Pressa asistents. Palīdzēšu izvēlēties dāvanu, kas patiesi pārsteigs jūsu mīļoto cilvēku.\n\nNospiediet Start, lai sāktu.",
    shortDescription: "Černilka — Retro-Pressa asistents. Dāvanas, kas pārsteigs jūsu mīļoto.",
  },
  et: {
    description:
      "Tere! Minu nimi on Chernilka, olen Retro-Pressa assistent. Aitan valida kingi, mis tõeliselt üllatab teie lähedast inimest.\n\nAlustamiseks vajutage Start.",
    shortDescription: "Chernilka — Retro-Pressa assistent. Kingid, mis üllatavad teie lähedast.",
  },
  lt: {
    description:
      "Sveiki! Mano vardas Chernilka, esu Retro-Pressa asistentas. Padėsiu parinkti dovaną, kuri tikrai nustebins jūsų artimą žmogų.\n\nPaspauskite Start, kad pradėtumėte.",
    shortDescription: "Chernilka — Retro-Pressa asistentas. Dovanos, kurios nustebins jūsų artimąjį.",
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
