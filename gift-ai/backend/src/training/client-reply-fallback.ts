import type { ClientState, TrainingScenario } from "./types.js";

const SALES_KEYWORDS =
  /газет|архив|подар|дат|репродук|журнал|достав|цен|руб|₽|фото|подбер|вариант|оригинал|комплект|книг|оформ|счёт|счет/i;

export function buildFallbackClientReply(opts: {
  employeeText: string;
  history: Array<{ author: string; text: string }>;
  clientState: ClientState;
  scenario: TrainingScenario;
}): string {
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
      return "Извините, не понял ответ. Я спрашивала про подарок маме — что вы можете предложить?";
    }
    if (irritated) {
      return "Странный ответ… Я о подарке спрашивала. Можете вернуться к теме и предложить что-нибудь?";
    }
    return "Извините, не понял. Можете рассказать, какой подарок по дате рождения вы можете предложить?";
  }

  if (/дат|год|архив|феврал|1950/i.test(clientContext) && !/фото|цен|достав/i.test(managerLower)) {
    return "Хорошо. А что именно можно заказать на эту дату — оригинал газеты или что-то ещё? Хотелось бы понять варианты.";
  }

  return "Понял. Расскажите подробнее — какие варианты подарка вы можете предложить?";
}
