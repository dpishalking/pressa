# Gift AI — консультант по премиальным подаркам

AI-ассистент для подбора подарков с квалификацией клиента и передачей лида в Bitrix24.

## Архитектура

```
telegram-bot/     → канал (Telegram)
backend/          → ядро системы
  modules/
    chat-engine           — оркестратор
    qualification-engine  — 10 этапов консультации (Gemini)
    emotion-analyzer      — тон клиента
    recommendation-engine — подбор из каталога
    knowledge-base        — каталог подарков
    lead-scoring          — оценка готовности
    conversation-memory   — история диалогов
    summary-generator     — AI summary для менеджера
  integrations/
    crm/                  — адаптер CRM (Bitrix24 + заглушка)
    ai/                   — Gemini API
admin/            → простая админ-панель (статичный HTML)
```

Новые CRM подключаются через `CrmAdapter` без изменения ядра.  
Новые каналы (WhatsApp, Instagram) — отдельные боты, вызывающие `/chat/*` API.

## Быстрый старт

### 1. Backend

```bash
cd gift-ai
npm install
cp backend/.env.example backend/.env
# Заполните GEMINI_API_KEY и при необходимости BITRIX24_WEBHOOK_URL
npm run dev
```

API: `http://localhost:3100`  
Health: `GET /health`

### 2. Telegram-бот

```bash
cp telegram-bot/.env.example telegram-bot/.env
# BOT_TOKEN от @BotFather, API_URL=http://localhost:3100
npm run dev:bot
```

### 3. Админ-панель

Откройте `admin/index.html` в браузере.  
Укажите `ADMIN_API_KEY` из `backend/.env`.

## Bitrix24

1. Bitrix24 → Приложения → Вебхуки → Входящий вебхук
2. Права: `crm` (добавление лидов)
3. В `.env`: `BITRIX24_WEBHOOK_URL=https://your.bitrix24.ru/rest/1/xxx/`

При завершении диалога создаётся лид с:
- всеми полями квалификации
- полной перепиской
- AI Summary
- тегом **Подбор подарка AI**

## API

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/chat/start` | Начать консультацию |
| POST | `/chat/message` | Сообщение клиента |
| GET | `/conversations` | Список диалогов |
| GET | `/conversations/:id` | Диалог + переписка |
| GET | `/admin/gifts` | Каталог (нужен `x-admin-key`) |
| POST | `/admin/gifts` | Добавить подарок |
| GET | `/admin/stats` | Статистика |

## Lead Score

| Балл | Статус |
|------|--------|
| 90–100 | готов покупать |
| 70–90 | нужно уточнить детали |
| 40–70 | интересуется |
| &lt;40 | нецелевой |

## Переменные окружения

См. `backend/.env.example` и `telegram-bot/.env.example`.

## Дальше

- [ ] Пользовательские поля Bitrix (маппинг в конфиге)
- [ ] Загрузка фото подарков (S3 / Supabase Storage)
- [ ] Редактор сценариев диалога в админке
- [ ] WhatsApp / Instagram каналы
- [ ] PostgreSQL / Supabase вместо SQLite для продакшена
