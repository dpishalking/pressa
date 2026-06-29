import type { EmotionAnalysis } from "../types/index.js";

const HESITANT = /не уверен|сомнева|не знаю|может быть|наверное|думаю|сложно выбрать/i;
const URGENT = /срочно|завтра|послезавтра|через пару дней|очень быстро|горит/i;
const NEGATIVE = /дорого|не подходит|не хочу|откаж|не интересно|не надо/i;
const POSITIVE = /отлично|супер|беру|давайте|подходит|именно это|нравится|готов/i;

export class EmotionAnalyzer {
  analyze(text: string): EmotionAnalysis {
    const hints: string[] = [];
    let tone: EmotionAnalysis["tone"] = "neutral";
    let confidence = 0.5;

    if (URGENT.test(text)) {
      tone = "urgent";
      confidence = 0.85;
      hints.push("Клиенту важна срочность — уточни дату и сроки изготовления.");
    } else if (HESITANT.test(text)) {
      tone = "hesitant";
      confidence = 0.8;
      hints.push("Клиент сомневается — не дави, сравни варианты и объясни разницу.");
    } else if (NEGATIVE.test(text)) {
      tone = "negative";
      confidence = 0.75;
      hints.push("Есть возражение — уточни причину и предложи альтернативу из каталога.");
    } else if (POSITIVE.test(text)) {
      tone = "positive";
      confidence = 0.85;
      hints.push("Клиент настроен позитивно — можно мягко двигаться к оформлению.");
    }

    return { tone, confidence, hints };
  }
}

export const emotionAnalyzer = new EmotionAnalyzer();
