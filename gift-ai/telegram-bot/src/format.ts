const ACK_RE =
  /^(Понял|Поняла|Красиво|Отлично|Здорово|Прекрасно|Хорошо|Вижу|Ясно|Конечно|Замечательно|Впечатляет|Круто|Супер|Отличный выбор)([.!…,:—\s]|$)/i;

const TRANSITION_RE = /^(а теперь|теперь давайте|давайте|перейдём|перейдем|следующ)/i;

const HTML_TAG_RE = /<\/?(?:b|i|u|s|code|pre|a)\b/i;

const EMOJI_RE = /^\s*[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/u;

const SECTION_EMOJI: [RegExp, string][] = [
  [/^(что (это|вы получите)|what you get|ko jūs saņemsiet|mida sa saad|ką gausite)\b[^:]*:/i, "📖"],
  [/^(идея|главная идея|main idea|galvenā ideja|peamine idee|pagrindinė idėja)\b[^:]*:/i, "💡"],
  [/^(кому подходит|who it's for|kam piemērots|kellele sobib|kam tinka)\b[^:]*:/i, "👥"],
  [
    /^(как бывает|кейсы?|how it works in practice|kā tas notiek praksē|kuidas see praktikas on|kaip būna praktikoje)\b[^:]*:/i,
    "💬",
  ],
];

function isCatalogSectionHead(head: string): boolean {
  return SECTION_EMOJI.some(([re]) => re.test(head.trim()));
}

function sectionEmoji(paragraph: string): string | null {
  const head = paragraph.trim().split("\n")[0]?.trim() ?? "";
  for (const [re, emoji] of SECTION_EMOJI) {
    if (re.test(head)) return emoji;
  }
  return null;
}

const STAGE_EMOJI: Record<number, string> = {
  1: "🎂",
  2: "👤",
  3: "📅",
  4: "💰",
  5: "❤️",
  6: "🎯",
  7: "🎯",
  8: "🎁",
  9: "⚖️",
  10: "☎️",
};

export type FormatOpts = {
  stage?: number;
  /** Кликабельная ссылка «Написать менеджеру» в конце сообщения. */
  managerHandoff?: { url: string; buttonLabel: string };
};

export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SECTION_LINE_RE =
  /^(?:(?<emoji>[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+\s+))?(?<label>[^:]+):\s*(?<body>.*)$/u;

function formatBodyText(body: string): string {
  const parts = body.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (parts.length <= 1) return formatSentence(body);
  return parts.map(formatSentence).join(" ");
}

/** Жирный заголовок блока каталога: «📖 Что вы получите:» */
function formatSectionLine(line: string): string | null {
  const m = line.trim().match(SECTION_LINE_RE);
  if (!m?.groups?.label) return null;

  const label = m.groups.label.trim();
  const head = `${label}:`;
  if (!isCatalogSectionHead(head) && !isCatalogSectionHead(line.trim())) return null;

  const emoji = m.groups.emoji?.trim() ?? sectionEmoji(head) ?? "";
  const prefix = emoji ? `${emoji} ` : "";
  const boldHead = `<b>${escHtml(`${prefix}${label}`)}:</b>`;
  const body = m.groups.body?.trim() ?? "";
  return body ? `${boldHead} ${formatBodyText(body)}` : boldHead;
}

function formatLine(line: string): string {
  return formatSectionLine(line) ?? formatBodyText(line);
}

function formatSentence(sentence: string): string {
  const t = sentence.trim();
  if (!t) return "";

  const esc = escHtml(t);

  if (/^привет!/i.test(t)) {
    return `<b>${esc}</b>`;
  }

  if (ACK_RE.test(t)) {
    return `<i>${esc}</i>`;
  }

  if (t.endsWith("?")) {
    return `<b>${esc}</b>`;
  }

  if (/рекоменд/i.test(t)) {
    return esc.replace(/«([^»]+)»/g, "«<b>$1</b>»");
  }

  if (/передаю менеджеру|свяжется с вами/i.test(t)) {
    return `<i>${esc}</i>`;
  }

  return esc;
}

/** Разбивает сплошной текст на абзацы: подтверждение → переход → вопрос. */
function structureReply(text: string): string {
  const raw = text.trim();
  if (!raw || /\n{2,}/.test(raw)) return raw;

  const sentences = raw
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return raw;

  const blocks: string[] = [];
  let i = 0;

  if (ACK_RE.test(sentences[0]!)) {
    blocks.push(sentences[0]!);
    i = 1;
  }

  if (i < sentences.length && TRANSITION_RE.test(sentences[i]!)) {
    blocks.push(sentences[i]!);
    i++;
  }

  if (i < sentences.length) {
    blocks.push(sentences.slice(i).join(" "));
  }

  if (blocks.length <= 1) return raw;
  return blocks.join("\n\n");
}

function emojiForParagraph(paragraph: string, index: number, total: number, stage?: number): string {
  if (EMOJI_RE.test(paragraph)) return paragraph;

  const section = sectionEmoji(paragraph);
  if (section) return `${section} ${paragraph}`;

  let emoji: string;
  if (index === 0 && ACK_RE.test(paragraph)) {
    emoji = "✨";
  } else if (index === total - 1) {
    emoji = (stage && STAGE_EMOJI[stage]) || "💬";
  } else {
    emoji = "👉";
  }

  return `${emoji} ${paragraph}`;
}

/** Умная вёрстка для Telegram HTML: абзацы, эмодзи, вопросы жирным, подтверждения курсивом. */
export function smartFormatReply(text: string, opts?: FormatOpts): string {
  const raw = text.trim();
  if (!raw) return "";

  if (HTML_TAG_RE.test(raw)) {
    return raw;
  }

  const structured = structureReply(raw);
  const paragraphs = structured
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const withEmojis = paragraphs.map((p, i) => emojiForParagraph(p, i, paragraphs.length, opts?.stage));

  return withEmojis
    .map((paragraph) => {
      const lines = paragraph.split("\n");
      return lines.map((line) => formatLine(line)).join("\n");
    })
    .join("\n\n");
}

export function formatGreeting(text: string): string {
  return smartFormatReply(text, { stage: 1 });
}
