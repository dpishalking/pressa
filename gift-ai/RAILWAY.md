# Деплой на Railway

Нужно **два сервиса** из одного репозитория: API и Telegram-бот.

> ⚠️ Одновременно должен работать **только один** экземпляр бота (локально или на Railway). Иначе Telegram молчит.

---

## Сервис 1 — API (backend)

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → репозиторий `pressa`
2. **Settings → Root Directory:** `gift-ai/backend`
3. **Variables:**

| Переменная | Значение |
|------------|----------|
| `GEMINI_API_KEY` | ваш ключ Gemini |
| `ADMIN_API_KEY` | пароль для админки |
| `DATABASE_PATH` | `/data/gift-ai.db` |
| `BITRIX24_WEBHOOK_URL` | (когда будет) URL вебхука Bitrix |
| `BITRIX24_TAG` | `Подбор подарка AI` |

`PORT` Railway подставит сам — не трогайте.

4. **Volume** (чтобы диалоги не пропадали при перезапуске):
   - Settings → **Volumes** → Add Volume
   - Mount path: `/data`

5. Deploy. В логах: `Gift AI API started`
6. **Settings → Networking → Generate Domain** — скопируйте URL, например:
   `https://gift-ai-api-production.up.railway.app`

Проверка: откройте `https://ваш-url/health` — должно быть `{"ok":true,...}`

---

## Сервис 2 — Telegram-бот

1. В том же проекте Railway: **+ New Service** → **GitHub Repo** → тот же репозиторий
2. **Root Directory:** `gift-ai/telegram-bot`
3. **Variables:**

| Переменная | Значение |
|------------|----------|
| `BOT_TOKEN` | токен от @BotFather |
| `API_URL` | URL API из шага 1 (без слэша в конце) |
| `GEMINI_API_KEY` | тот же ключ, что у API — для распознавания голосовых |

Пример: `API_URL=https://gift-ai-api-production.up.railway.app`

4. Deploy. В логах: `✅ @rpgifts_bot — gift consultant bot`

---

## После деплоя

1. **Остановите** локальные `npm run dev` и `npm run dev:bot` на Mac
2. Напишите боту в Telegram `/start`

---

## Частые проблемы

| Симптом | Решение |
|---------|---------|
| Бот молчит | Локальный бот ещё запущен — остановите |
| «Не удалось обработать» | Проверьте `API_URL` у бота и `/health` у API |
| Данные пропали | Подключите Volume на `/data` |
| 409 Conflict | Два процесса с одним `BOT_TOKEN` |

---

## Админка

Откройте `gift-ai/admin/index.html` локально.  
API URL — публичный Railway URL, ключ — `ADMIN_API_KEY`.
