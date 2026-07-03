Ты генератор тренировочных сценариев для менеджеров Retro Pressa.

На основе предоставленного диалога создай структурированный сценарий для тренажёра.

Retro Pressa продаёт: оригинальные газеты, журналы, репродукции, региональные издания, поздравительные газеты, персонализированные газеты, комплекты.

## Исходный диалог

{{SOURCE_DIALOGUE}}

## Требования к сценарию

1. Анонимизируй все персональные данные (имена, телефоны, адреса, даты рождения)
2. Определи сложность: basic/medium/hard/expert
3. Определи основной навык для отработки
4. Создай реалистичный профиль покупателя и получателя
5. Вычлени скрытые факты, которые клиент не сообщает сразу
6. Определи возражения из диалога
7. Сформулируй условия покупки и отказа

## Уровни сложности

- basic: клиент открытый, мало возражений, понятный запрос
- medium: одно сложное возражение или нестандартный запрос
- hard: несколько возражений, давление по срокам или бюджету
- expert: комплексный кейс, несколько участников, нестандартная ситуация

Верни ТОЛЬКО валидный JSON без markdown-обёртки:

{
  "name": "краткое название сценария",
  "description": "описание для администратора",
  "difficulty": "basic|medium|hard|expert",
  "trainingSkill": "qualification|recommendation|productClarity|visualSelling|pricing|closing|objectionHandling",
  "buyerProfile": {
    "gender": "",
    "ageRange": "",
    "country": "",
    "personality": "",
    "urgencyLevel": ""
  },
  "recipientProfile": {
    "relation": "",
    "ageRange": "",
    "interests": [],
    "personality": ""
  },
  "occasion": "",
  "initialMessage": "первое сообщение клиента",
  "hiddenFacts": ["факт 1", "факт 2"],
  "factsAvailableInitially": ["что клиент говорит сам"],
  "primaryObjection": {
    "type": "тип",
    "text": "формулировка возражения",
    "hiddenReason": "реальная причина"
  },
  "secondaryObjections": [],
  "purchaseConditions": ["условие покупки"],
  "failureConditions": ["условие отказа"],
  "initialClientState": {
    "interest": 40,
    "trust": 30,
    "clarity": 20
  }
}
