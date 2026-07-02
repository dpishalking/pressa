import { callGemini } from "../integrations/ai/gemini.js";
import { logger } from "../logger.js";
import { knowledgeBase } from "./knowledge-base.js";

/**
 * «Контент-завод» для Threads: провокационный вопрос → вовлечение в комментариях →
 * описание Retro Pressa → сайт или бот для подбора подарка.
 */

export const RETRO_PRESSA_SITE = "https://retro-pressa.com/gifts";
export const RETRO_PRESSA_BOT = "@rpgifts_bot";

export type ContentPillar = {
  id: string;
  title: string;
  goal: string;
  /** Подсказка модели: какой тип провокационного вопроса задать. */
  brief: string;
};

/** Рубрики = типы провокационных вопросов, которые тянут людей в комментарии. */
export const CONTENT_PILLARS: ContentPillar[] = [
  {
    id: "taboo",
    title: "Табу / неудобный вопрос",
    goal: "Вызвать спор в комментариях",
    brief:
      "Спроси про то, о чём обычно молчат: деньги вместо подарка, перепродать подарок, подарок «для галочки», сертификат = бездушно. Первая часть — только вопрос, без бренда.",
  },
  {
    id: "dilemma",
    title: "Дилемма «А или Б»",
    goal: "Заставить выбрать сторону",
    brief:
      "Дай жёсткий выбор: дорогой банальный подарок vs дешёвый личный; подарок-сюрприз vs «скинь ссылку»; подарок себе vs близкому. Люди обязаны ответить.",
  },
  {
    id: "mistake",
    title: "Ошибка / признание",
    goal: "Вызвать истории «и у меня так было»",
    brief:
      "Спроси про худший подарок, подарок который лежит в шкафу, или «что вы дарили, когда не знали что дарить». Формат: «Признавайтесь…» / «Кто тоже…»",
  },
  {
    id: "unpopular",
    title: "Непопулярное мнение",
    goal: "Разжечь дискуссию",
    brief:
      "Горячий тейк о подарках: «цветы — пустая трата», «подарок должен быть только практичным», «лучше ничего не дарить». Намеренно полярно, но без токсичности.",
  },
  {
    id: "scenario",
    title: "Гипотетический сценарий",
    goal: "Втянуть в ролевую игру",
    brief:
      "Сценарий: «У вас 24 часа до ДР мамы, бюджет 5к, она всё покупает сама — что дарите?» или «Босс намекнул на подарок — что делать?». Пусть люди пишут свои варианты.",
  },
  {
    id: "ranking",
    title: "Рейтинг / что хуже",
    goal: "Быстрый отклик одним словом",
    brief:
      "«Что хуже подарить: носки, свечку или сертификат?» / «Топ-3 самых бессмысленных подарка». Люди любят ранжировать и спорить.",
  },
];

export type ThreadsPost = {
  pillarId: string;
  pillarTitle: string;
  /** Провокационный вопрос — первая строка треда, без бренда. */
  provocativeQuestion: string;
  hook: string;
  body: string;
  cta: string;
  /** Куда вести: site | bot */
  ctaTarget: "site" | "bot";
  hashtags: string[];
  giftExternalId: string | null;
  format: "single" | "thread";
  threadParts: string[];
};

export type GenerateOptions = {
  count?: number;
  pillarId?: string;
  brief?: string;
  siteUrl?: string;
  botHandle?: string;
};

const SYSTEM_PROMPT = `Ты — SMM-копирайтер Retro Pressa — студии персональных подарков (газеты из дня рождения, книги жизни, именные журналы, книги воспоминаний и т.п.).

Ты пишешь для Threads. Главная задача — ВОРОНКА:

1. ПРОВОКАЦИЯ — человек видит неудобный/спорный вопрос и заходит в комментарии
2. ВОВЛЕЧЕНИЕ — он узнаёт себя, спорит, делится историей
3. БРЕНД — мягко появляется Retro Pressa и суть: подарки, которые вызывают эмоции, а не лежат в шкафу
4. ДЕЙСТВИЕ — конкретный продукт из каталога + ссылка на сайт ИЛИ бот для подбора

ОБЯЗАТЕЛЬНО:
- Почти каждый пост — формат "thread" из 3–4 частей (single только если идея не тянет на тред)
- Часть 1 — ТОЛЬКО провокационный вопрос. Без Retro Pressa, без продуктов, без ссылок. Заканчивай приглашением ответить: «А вы как?», «Что думаете?», «Кто за / кто против?»
- Часть 2 — разворот темы: узнаваемая боль, типичные ответы из комментариев, лёгкий юмор. Всё ещё без продажи
- Часть 3 — мост к бренду: «Мы в Retro Pressa…» — 2–3 предложения что делаете и почему это не банальный подарок
- Часть 4 — один продукт из каталога (почему он отвечает на вопрос из части 1) + CTA на сайт или бот. Чередуй ctaTarget: site / bot

Тон:
- Живой разговорный русский, как в комментариях Threads
- Провокация — острая, но не оскорбительная и не токсичная
- Короткие абзацы, лимит одной части ~500 символов
- Эмодзи 0–2 на часть, только если уместно
- Хэштеги: 2–3, на русском, только в последней части треда

Продукты — ТОЛЬКО из каталога, giftExternalId = ID из каталога. Не выдумывай.

ФОРМАТ ОТВЕТА — строго JSON:
{
  "posts": [
    {
      "pillarId": "id рубрики",
      "provocativeQuestion": "только вопрос-крючок, как в части 1",
      "hook": "дублирует provocativeQuestion",
      "body": "дублирует часть 1 (первую часть треда)",
      "cta": "текст призыва из финальной части",
      "ctaTarget": "site" | "bot",
      "hashtags": ["#тег"],
      "giftExternalId": "id из каталога или null",
      "format": "thread",
      "threadParts": ["часть 1 — только вопрос", "часть 2 — вовлечение", "часть 3 — Retro Pressa", "часть 4 — продукт + CTA"]
    }
  ]
}`;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function distributePillars(count: number, only?: string): ContentPillar[] {
  const pool = only ? CONTENT_PILLARS.filter((p) => p.id === only) : CONTENT_PILLARS;
  if (!pool.length) {
    throw new Error(`Рубрика "${only}" не найдена. Доступные: ${CONTENT_PILLARS.map((p) => p.id).join(", ")}`);
  }
  const result: ContentPillar[] = [];
  for (let i = 0; i < count; i++) {
    result.push(pool[i % pool.length]);
  }
  return result;
}

function buildUserPrompt(
  pillars: ContentPillar[],
  siteUrl: string,
  botHandle: string,
  extraBrief?: string,
): string {
  const catalog = knowledgeBase.formatForPrompt();
  const tasks = pillars
    .map(
      (p, i) =>
        `${i + 1}. Рубрика "${p.id}" (${p.title}) — цель: ${p.goal}. Вопрос: ${p.brief}`,
    )
    .join("\n");

  return `КАТАЛОГ ПОДАРКОВ (продукт только отсюда, в финальной части треда):
${catalog}

ССЫЛКИ ДЛЯ CTA:
- Сайт: ${siteUrl}
- Бот в Telegram: ${botHandle}

${extraBrief ? `ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ: ${extraBrief}\n\n` : ""}ЗАДАНИЕ: ${pillars.length} тредов для Threads. Каждый — полная воронка (провокация → вовлечение → Retro Pressa → продукт + CTA).

Чередуй ctaTarget между "site" и "bot". Не повторяй одни и те же вопросы.

${tasks}

Верни строго JSON.`;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter((v) => v.trim().length > 0);
}

function parsePosts(raw: string, pillars: ContentPillar[]): ThreadsPost[] {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new Error("Не удалось разобрать ответ модели как JSON");
  }

  const rawPosts = (data as { posts?: unknown }).posts;
  if (!Array.isArray(rawPosts)) throw new Error("В ответе модели нет массива posts");

  const validIds = new Set(knowledgeBase.listGifts().map((g) => g.externalId || g.id));

  return rawPosts.map((item, idx): ThreadsPost => {
    const post = (item ?? {}) as Record<string, unknown>;
    const pillarId = String(post.pillarId ?? pillars[idx % pillars.length]?.id ?? "");
    const pillar = CONTENT_PILLARS.find((p) => p.id === pillarId) ?? pillars[idx % pillars.length];
    const giftId = post.giftExternalId ? String(post.giftExternalId) : null;
    const provocativeQuestion = String(post.provocativeQuestion ?? post.hook ?? post.body ?? "").trim();
    const format = post.format === "single" ? "single" : "thread";
    const threadParts = format === "thread" ? coerceStringArray(post.threadParts) : [];
    const ctaTarget = post.ctaTarget === "bot" ? "bot" : "site";

    return {
      pillarId: pillar?.id ?? pillarId,
      pillarTitle: pillar?.title ?? pillarId,
      provocativeQuestion,
      hook: String(post.hook ?? provocativeQuestion).trim(),
      body: String(post.body ?? provocativeQuestion).trim(),
      cta: String(post.cta ?? "").trim(),
      ctaTarget,
      hashtags: coerceStringArray(post.hashtags),
      giftExternalId: giftId && validIds.has(giftId) ? giftId : null,
      format,
      threadParts: threadParts.length ? threadParts : provocativeQuestion ? [provocativeQuestion] : [],
    };
  });
}

export async function generateThreadsPosts(opts: GenerateOptions = {}): Promise<ThreadsPost[]> {
  const count = clamp(Math.round(opts.count ?? 6), 1, 30);
  const pillars = distributePillars(count, opts.pillarId);
  const siteUrl = opts.siteUrl ?? RETRO_PRESSA_SITE;
  const botHandle = opts.botHandle ?? RETRO_PRESSA_BOT;

  logger.info("Content factory: generating Threads posts", {
    count,
    pillarId: opts.pillarId ?? "all",
    funnel: "provocation → engagement → brand → cta",
  });

  const { text } = await callGemini({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(pillars, siteUrl, botHandle, opts.brief),
    json: true,
  });

  const posts = parsePosts(text, pillars);
  logger.info("Content factory: generated", { requested: count, produced: posts.length });
  return posts;
}

const FUNNEL_LABELS = ["🪝 Провокация", "💬 Вовлечение", "🏷️ Retro Pressa", "🎁 Продукт + CTA"];

export function renderPostsMarkdown(posts: ThreadsPost[]): string {
  const lines: string[] = [
    `# Threads — пачка из ${posts.length} тредов`,
    "",
    `Воронка: провокационный вопрос → комментарии → Retro Pressa → сайт (${RETRO_PRESSA_SITE}) или бот (${RETRO_PRESSA_BOT})`,
    "",
  ];

  posts.forEach((p, i) => {
    lines.push(`## ${i + 1}. [${p.pillarTitle}]`);
    lines.push("");
    lines.push(`**Вопрос-крючок:** ${p.provocativeQuestion}`);
    lines.push("");

    if (p.format === "thread" && p.threadParts.length) {
      p.threadParts.forEach((part, j) => {
        const label = FUNNEL_LABELS[j] ?? `Часть ${j + 1}`;
        lines.push(`**${label}**`);
        lines.push(part);
        lines.push("");
      });
    } else {
      lines.push(p.body);
      lines.push("");
    }

    if (p.cta) {
      const target = p.ctaTarget === "bot" ? RETRO_PRESSA_BOT : RETRO_PRESSA_SITE;
      lines.push(`> CTA (${p.ctaTarget}): ${p.cta}`);
      lines.push(`> Ссылка: ${target}`);
    }
    if (p.hashtags.length) {
      lines.push(`> ${p.hashtags.join(" ")}`);
    }
    if (p.giftExternalId) {
      lines.push(`> Продукт: \`${p.giftExternalId}\``);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  });
  return lines.join("\n");
}
