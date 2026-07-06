import type { ClientState, TrainingScenario } from "./types.js";

const SALES_KEYWORDS =
  /газет|архив|подар|дат|репродук|журнал|достав|цен|руб|₽|фото|подбер|вариант|оригинал|комплект|книг|оформ|счёт|счет/i;

/** Known bad replies — old manager fallback and common LLM slips. */
const BANNED_REPLY_RE =
  /понял вас|хочу предложить|подходящий формат|подскажите.{0,50}(для кого|к какой|какой повод|дату|дата)|уточните.{0,40}(достав|дату|дата)|проверю архив|могу предложить|какой формат вам|оформим заказ|итого.{0,12}руб|стоимость доставки|подберу.{0,30}(формат|вариант|подарок)|предложу.{0,30}(формат|вариант)|расскажите.{0,40}(для кого|какой повод|точную дату)|спасибо за обращение/i;

export function looksLikeManagerReply(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (BANNED_REPLY_RE.test(t)) return true;

  const lower = t.toLowerCase();
  const asksWho = /для кого|кому подарок|кто получ/i.test(lower);
  const asksWhen = /к какой дате|к какому срок|успеть к|к какой дат/i.test(lower);
  const offersProduct = /предлож|подбер|формат|проверю|уточню в архив/i.test(lower);
  if (asksWho && (asksWhen || offersProduct)) return true;

  return false;
}

export type ClientReplyContext = {
  employeeText: string;
  history: Array<{ author: string; text: string }>;
  clientState: ClientState;
  scenario: TrainingScenario;
};

/** Always return a reply in client voice — use at every exit from client simulation. */
export function ensureClientVoiceReply(rawReply: string, opts: ClientReplyContext): string {
  return sanitizeClientReply(rawReply, opts);
}

export function sanitizeClientReply(rawReply: string, opts: ClientReplyContext): string {
  const trimmed = rawReply.trim();
  if (!trimmed || looksLikeManagerReply(trimmed)) {
    return buildFallbackClientReply(opts);
  }
  return trimmed;
}

export function buildFallbackClientReply(opts: ClientReplyContext): string {
  const { employeeText, history, clientState, scenario } = opts;
  const managerText = employeeText.trim();
  const managerLower = managerText.toLowerCase();
  const clientContext =
    history
      .filter((m) => m.author === "client")
      .map((m) => m.text)
      .join(" ") || scenario.initialMessage;

  const isOffTopic = managerText.length > 0 && !SALES_KEYWORDS.test(managerLower);
  const irritated = clientState.irritation >= 55;

  if (isOffTopic) {
    if (/дед|дедуш/i.test(clientContext)) {
      if (irritated) {
        return "Простите, мы же про подарок дедушке говорили? Не понял, при чём тут это. Что вы можете предложить на его дату рождения?";
      }
      return "Не совсем понял… Мы же обсуждали подарок дедушке на дату рождения. Расскажите, какие варианты у вас есть?";
    }
    if (/мам|мать/i.test(clientContext)) {
      if (/фото|выгляд|покаж/i.test(clientContext)) {
        return "Извините, не понял… Я спрашивала про подарок маме — покажите, как выглядит газета?";
      }
      return "Извините, не понял ответ. Я спрашивала про подарок маме — что вы можете предложить?";
    }
    if (irritated) {
      return "Странный ответ… Я о подарке спрашивала. Можете вернуться к теме и предложить что-нибудь?";
    }
    return "Извините, не понял. Можете рассказать, какой подарок по дате рождения вы можете предложить?";
  }

  if (/дат|год|архив|феврал|1950|1963/i.test(clientContext) && !/фото|цен|достав/i.test(managerLower)) {
    return "Хорошо. А что именно можно заказать на эту дату — оригинал газеты или что-то ещё? Хотелось бы понять варианты.";
  }

  return "Понял. Расскажите подробнее — какие варианты подарка вы можете предложить?";
}
