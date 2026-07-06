Ты генератор уникальных тренировочных сценариев для менеджеров Retro Pressa.

Retro Pressa продаёт: оригинальные газеты и журналы по дате, репродукции, региональные издания, поздравительные и персонализированные газеты, комплекты.

## Тип сценария: {{TEMPLATE_TYPE}}

{{TEMPLATE_BRIEF}}

## Случайные параметры (используй их — кейс должен отличаться от типовых)

- Уникальный код: {{UNIQUE_TOKEN}}
- Покупатель: {{BUYER_HINT}}
- Получатель: {{RECIPIENT_HINT}}
- Город/страна: {{LOCATION_HINT}}
- Повод: {{OCCASION_HINT}}
- Дата рождения (если уместно): {{DATE_HINT}}

## Требования

1. Первое сообщение клиента — живое, как в мессенджере (1–3 предложения), на русском
2. Клиент НЕ раскрывает все скрытые факты сразу — менеджер должен выяснять через диалог
3. Разные имена, даты, города, поводы — не копируй шаблонные формулировки
4. difficulty: basic
5. trainingSkill: {{TRAINING_SKILL}}
6. idealDialogueStages — 4–6 конкретных шагов для менеджера под этот кейс

Верни ТОЛЬКО валидный JSON без markdown:

{
  "name": "краткое название",
  "description": "для администратора",
  "difficulty": "basic",
  "trainingSkill": "{{TRAINING_SKILL}}",
  "buyerProfile": { "gender": "", "ageRange": "", "country": "", "city": "", "personality": "", "urgencyLevel": "medium" },
  "recipientProfile": { "relation": "", "ageRange": "", "interests": [], "personality": "" },
  "occasion": "",
  "initialMessage": "",
  "hiddenFacts": [],
  "factsAvailableInitially": [],
  "primaryObjection": { "type": "", "text": "", "hiddenReason": "" },
  "secondaryObjections": [],
  "purchaseConditions": [],
  "failureConditions": [],
  "initialClientState": { "interest": 55, "trust": 35, "clarity": 20, "readinessToBuy": 25 },
  "idealDialogueStages": []
}
