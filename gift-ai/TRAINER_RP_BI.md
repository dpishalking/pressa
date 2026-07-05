# Интеграция тренажёра с rp-bi.site

Личный кабинет: https://rp-bi.site/training

## Как это работает

1. Менеджер входит в rp-bi.site (логин/пароль от администратора).
2. Проходит этапы «Продукт» и «CRM».
3. На этапе **«Практика»** видит одну кнопку — персональная ссылка в Telegram-бот уже подставлена.
4. При первом открытии этапа ссылка **создаётся автоматически** (если ещё не была).

## Вариант A — iframe (быстрее всего)

На странице этапа «Практика» в rp-bi:

```tsx
const { user } = useAuth(); // id + fullName из /api/auth/me

<iframe
  title="Практика"
  src={`${process.env.TRAINER_API_URL}/trainer/practice?manager=${user.id}&name=${encodeURIComponent(user.fullName)}&back=${encodeURIComponent("/training")}`}
  className="w-full min-h-[600px] border-0"
/>
```

`TRAINER_API_URL` — URL бэкенда gift-ai, например:
- локально: `http://localhost:3100`
- prod: `https://pressa-production.up.railway.app`

## Вариант B — своя вёрстка + API

На mount компонента «Практика»:

```tsx
useEffect(() => {
  if (!user) return;
  fetch(
    `${TRAINER_API_URL}/trainer/managers/${user.id}/practice?name=${encodeURIComponent(user.fullName)}`,
  )
    .then((r) => r.json())
    .then((data) => setBotLink(data.botLink));
}, [user]);
```

Кнопка:

```tsx
<a href={botLink} target="_blank" rel="noopener noreferrer">
  Открыть тренажёр в Telegram
</a>
```

Ответ API:

```json
{
  "botLink": "https://t.me/dushnila12_bot?start=inv_abc123",
  "practicePageUrl": "https://api.../trainer/practice?manager=user-42",
  "inviteToken": "inv_abc123",
  "manager": { "externalId": "user-42", "fullName": "Анна Иванова" }
}
```

## Вариант C — создать менеджера заранее (при выдаче аккаунта)

Когда админ создаёт пользователя в rp-bi, вызвать один раз:

```bash
curl -X POST "$TRAINER_API_URL/trainer/managers" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -d '{"externalId":"user-42","fullName":"Анна Иванова","serviceTag":"retro-pressa"}'
```

`externalId` должен совпадать с `user.id` из `/api/auth/me` в rp-bi.

## Что нужно в .env rp-bi

```
TRAINER_API_URL=https://pressa-production.up.railway.app
```

## Что нужно в .env gift-ai backend

```
TRAINER_BOT_USERNAME=dushnila12_bot
TRAINER_BOT_TOKEN=...
PUBLIC_API_URL=https://pressa-production.up.railway.app
```

## CORS

Если Practice-страница на rp-bi.site запрашивает API напрямую из браузера, добавьте в backend:

```
DASHBOARD_ORIGIN=https://rp-bi.site
```

(или расширьте CORS middleware для `/trainer/managers/*/practice`).
