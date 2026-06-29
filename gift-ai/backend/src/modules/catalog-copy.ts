const SECTION_LABELS: Record<string, string> = {
  "что это": "Что вы получите",
  идея: "Главная идея",
  "как работает": "Как заказать",
  "закрывает потребность": "Почему это цепляет",
};

const VOICE_REPLACEMENTS: [RegExp, string][] = [
  [
    /Клиент оставляет заявку[^.]*\.\s*Клиент заполняет[^.]*\.\s*Далее редакторы[^.]*\./gi,
    "Вы оставляете заявку, рассказываете о человеке и присылаете фото. Мы соберём макет, согласуем с вами и напечатаем издание — вам останется торжественно вручить готовый подарок.",
  ],
  [/Клиент оставляет заявку[.:]?\s*/gi, "Вы оставляете заявку — "],
  [/Клиент заполняет/gi, "Вы заполняете"],
  [/Клиент присылает/gi, "Вы присылаете"],
  [/Клиент проходит/gi, "Вы проходите"],
  [/Клиент хочет/gi, "Вы хотите"],
  [/Клиенту нужен/gi, "Вам нужен"],
  [/Клиенту важно/gi, "Вам важно"],
  [/клиент хочет/gi, "вы хотите"],
  [/клиент оставляет/gi, "вы оставляете"],
  [/клиент заполняет/gi, "вы заполняете"],
  [/клиент присылает/gi, "вы присылаете"],
  [/клиент проходит/gi, "вы проходите"],
  [/клиенту нужен/gi, "вам нужен"],
  [/Далее редакторы/gi, "Дальше наши редакторы"],
  [/редакторы и дизайнеры/gi, "редакторы и дизайнеры"],
  [/отправляют в типографию/gi, "печатаем для вас"],
  [/наши наши/gi, "наши"],
  [/ или проходит /gi, " или проходите "],
  [/ или проходит$/gi, " или проходите"],
  [/ присылает /gi, " присылаете "],
  [/ присылает$/gi, " присылаете"],
  [/Вы оставляете заявку — Вы /gi, "Вы оставляете заявку, "],
  [/на сайте это описано как/gi, "это"],
  [/На сайте это описано как/gi, "Это"],
];

/** Переводит сухой B2B-текст в обращение на «вы» с продающим тоном. */
export function toEngagingVoice(text: string): string {
  let t = text.trim();
  if (!t) return t;

  for (const [re, rep] of VOICE_REPLACEMENTS) {
    t = t.replace(re, rep);
  }

  return t;
}

function engagingSectionLabel(head: string): string {
  return SECTION_LABELS[head.trim().toLowerCase()] ?? head.trim();
}

/** Переписывает структурированное описание каталога для показа в боте. */
export function toEngagingCatalogDescription(description: string): string {
  const raw = description.trim();
  if (!raw) return raw;

  if (!/^[^:]+:/m.test(raw)) {
    return toEngagingVoice(raw);
  }

  return raw
    .split(/\n{2,}/)
    .map((block) => {
      const m = block.match(/^([^:]+):\s*([\s\S]*)$/);
      if (!m) return toEngagingVoice(block);
      const [, head, body] = m;
      return `${engagingSectionLabel(head!)}: ${toEngagingVoice(body!.trim())}`;
    })
    .join("\n\n");
}

/** Собирает описание из полей таблицы Retro Pressa в продающем тоне. */
export function buildEngagingCatalogDescription(parts: {
  simple?: string;
  idea?: string;
  howItWorks?: string;
  pain?: string;
}): string {
  const blocks = [
    parts.simple && `Что вы получите: ${toEngagingVoice(parts.simple)}`,
    parts.idea && `Главная идея: ${toEngagingVoice(parts.idea)}`,
    parts.howItWorks && `Как заказать: ${toEngagingVoice(parts.howItWorks)}`,
    parts.pain && `Почему это цепляет: ${toEngagingVoice(parts.pain)}`,
  ].filter(Boolean);

  return blocks.join("\n\n").slice(0, 4000);
}
