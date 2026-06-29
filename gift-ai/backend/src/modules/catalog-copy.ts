const SKIP_SECTIONS = new Set([
  "как работает",
  "как заказать",
  "как это устроено",
]);

const SECTION_LABELS: Record<string, string> = {
  "что это": "Что вы получите",
  "что вы получите": "Что вы получите",
  идея: "Главная идея",
  "главная идея": "Главная идея",
  "закрывает потребность": "Почему это цепляет",
  "почему это цепляет": "Почему это цепляет",
  "для кого": "Кому подходит",
  "кому подходит": "Кому подходит",
  кейсы: "Как бывает на практике",
  "как бывает": "Как бывает на практике",
  отзывы: "Что говорят после подарка",
  "что говорят": "Что говорят после подарка",
};

/** До ~3 предложений на блок — хватает, чтобы продать идею, и влезает в Telegram. */
const SECTION_BODY_MAX = 420;
const CARD_TEXT_MAX = 2400;

const VOICE_REPLACEMENTS: [RegExp, string][] = [
  [/Клиент хочет/gi, "Вы хотите"],
  [/Клиенту нужен/gi, "Вам нужен"],
  [/клиент хочет/gi, "вы хотите"],
  [/клиенту нужен/gi, "вам нужен"],
  [/на сайте это описано как/gi, "это"],
  [/На сайте это описано как/gi, "Это"],
];

function toEngagingVoice(text: string): string {
  let t = text.trim();
  if (!t) return t;
  for (const [re, rep] of VOICE_REPLACEMENTS) {
    t = t.replace(re, rep);
  }
  return t;
}

function compressBody(text: string, maxLen = SECTION_BODY_MAX): string {
  let t = toEngagingVoice(text)
    .replace(/\d+\.\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return t;
  if (t.length <= maxLen) return t;

  const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  let out = "";
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > maxLen && out) break;
    out = next;
  }

  if (!out || out.length > maxLen) {
    const cut = (out || t).slice(0, maxLen - 1);
    const lastSpace = cut.lastIndexOf(" ");
    out = (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim();
  }

  return out.endsWith("…") ? out : `${out.replace(/[.,;:!?…]+$/, "")}…`;
}

function engagingSectionLabel(head: string): string {
  return SECTION_LABELS[head.trim().toLowerCase()] ?? head.trim();
}

function shouldSkipSection(head: string): boolean {
  return SKIP_SECTIONS.has(head.trim().toLowerCase());
}

function formatSection(head: string, body: string): string | null {
  if (shouldSkipSection(head)) return null;
  const label = engagingSectionLabel(head);
  const compressed = compressBody(body);
  if (!compressed) return null;
  return `${label}: ${compressed}`;
}

/** Переписывает описание из БД: без «как заказать», на «вы», с сохранением смысла. */
export function toEngagingCatalogDescription(description: string): string {
  const raw = description.trim();
  if (!raw) return raw;

  if (!/^[^:]+:/m.test(raw)) {
    return compressBody(raw, SECTION_BODY_MAX * 2);
  }

  return raw
    .split(/\n{2,}/)
    .map((block) => {
      const m = block.match(/^([^:]+):\s*([\s\S]*)$/);
      if (!m) return compressBody(block);
      return formatSection(m[1]!, m[2]!);
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Собирает продающее описание из полей таблицы (без процесса заказа). */
export function buildEngagingCatalogDescription(parts: {
  simple?: string;
  idea?: string;
  pain?: string;
  forWho?: string;
}): string {
  const hook = parts.pain || parts.forWho;
  const blocks = [
    parts.simple && formatSection("что это", parts.simple),
    parts.idea && formatSection("идея", parts.idea),
    hook && formatSection("закрывает потребность", hook),
    parts.forWho && formatSection("для кого", parts.forWho),
  ].filter(Boolean);

  return blocks.join("\n\n").slice(0, CARD_TEXT_MAX);
}

/** Полная карточка для каталога в боте: описание + кейс + отзыв. */
export function buildCatalogCardDescription(gift: {
  description: string;
  cases?: string;
  reviews?: string;
  suitableFor?: string[];
}): string {
  const blocks: string[] = [];

  const base = toEngagingCatalogDescription(gift.description);
  if (base) blocks.push(base);

  if (gift.cases?.trim()) {
    const section = formatSection("кейсы", gift.cases);
    if (section) blocks.push(section);
  }

  if (gift.reviews?.trim()) {
    const section = formatSection("отзывы", gift.reviews);
    if (section) blocks.push(section);
  } else if (gift.suitableFor?.length) {
    const section = formatSection("кому подходит", gift.suitableFor.slice(0, 6).join(", "));
    if (section && !base.toLowerCase().includes("кому подходит")) blocks.push(section);
  }

  return blocks.join("\n\n").slice(0, CARD_TEXT_MAX);
}
