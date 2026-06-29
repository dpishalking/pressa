const ACK_RE =
  /^(Понял|Поняла|Красиво|Отлично|Здорово|Прекрасно|Хорошо|Вижу|Ясно|Конечно|Замечательно|Впечатляет|Круто|Супер|Отличный выбор)([.!…,:—\s]|$)/i;

const HTML_TAG_RE = /<\/?(?:b|i|u|s|code|pre|a)\b/i;

export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

/** Умная вёрстка для Telegram HTML: вопросы жирным, подтверждения курсивом. */
export function smartFormatReply(text: string): string {
  const raw = text.trim();
  if (!raw) return "";

  if (HTML_TAG_RE.test(raw)) {
    return raw;
  }

  const paragraphs = raw.split(/\n{2,}/);

  return paragraphs
    .map((paragraph) => {
      const lines = paragraph.split("\n");
      return lines
        .map((line) => {
          const parts = line.split(/(?<=[.!?…])\s+/).filter(Boolean);
          if (parts.length <= 1) return formatSentence(line);
          return parts.map(formatSentence).join(" ");
        })
        .join("\n");
    })
    .join("\n\n");
}

export function formatGreeting(text: string): string {
  return smartFormatReply(text);
}
