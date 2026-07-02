import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CONTENT_PILLARS,
  generateThreadsPosts,
  renderPostsMarkdown,
  type GenerateOptions,
} from "./modules/content-factory.js";

/**
 * CLI «контент-завода» для Threads.
 *
 * Воронка: провокационный вопрос → комментарии → Retro Pressa → сайт/бот.
 *
 * Примеры:
 *   tsx --env-file=.env src/content.ts                       # 6 тредов
 *   tsx --env-file=.env src/content.ts --count 12
 *   tsx --env-file=.env src/content.ts --pillar taboo        # только табу-вопросы
 *   tsx --env-file=.env src/content.ts --brief "к 8 марта"
 *   tsx --env-file=.env src/content.ts --out drafts/threads.md
 */

function parseArgs(argv: string[]): GenerateOptions & { json: boolean; out: string | null; help: boolean } {
  const opts: GenerateOptions & { json: boolean; out: string | null; help: boolean } = {
    count: 6,
    json: false,
    out: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--count":
      case "-n":
        opts.count = Number(argv[++i]);
        break;
      case "--pillar":
      case "-p":
        opts.pillarId = argv[++i];
        break;
      case "--brief":
      case "-b":
        opts.brief = argv[++i];
        break;
      case "--out":
      case "-o":
        opts.out = argv[++i];
        break;
      case "--json":
        opts.json = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        break;
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Контент-завод Threads — треды с провокационными вопросами про подарки.

Воронка каждого треда:
  1. Провокационный вопрос (без бренда) → люди заходят в комментарии
  2. Вовлечение / узнаваемая боль
  3. Описание Retro Pressa
  4. Продукт из каталога + CTA на сайт или бот

Опции:
  -n, --count <N>      Сколько тредов (1–30, по умолчанию 6)
  -p, --pillar <id>    Только один тип вопроса
  -b, --brief <текст>  Доп. контекст (повод, аудитория)
  -o, --out <файл>     Сохранить в файл (.md или .json)
      --json           Вывести JSON вместо markdown
  -h, --help           Показать справку

Типы провокационных вопросов:
${CONTENT_PILLARS.map((p) => `  ${p.id.padEnd(12)} — ${p.title}`).join("\n")}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const posts = await generateThreadsPosts({
    count: opts.count,
    pillarId: opts.pillarId,
    brief: opts.brief,
  });

  const output = opts.json ? JSON.stringify(posts, null, 2) : renderPostsMarkdown(posts);

  if (opts.out) {
    const path = resolve(process.cwd(), opts.out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, output, "utf8");
    console.log(`Сохранено ${posts.length} постов → ${path}`);
  } else {
    console.log(output);
  }
}

main().catch((e) => {
  console.error("Ошибка генерации:", e instanceof Error ? e.message : e);
  process.exit(1);
});
