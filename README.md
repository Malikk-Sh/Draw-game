# Draw Game — мультиплеерная игра «Скетч-Баттл» на Vue 3

Веб-игра в духе классических игр в рисование и угадывание / Pictionary. Игроки по очереди
рисуют загаданное слово, остальные угадывают в чате. Адаптировано под
мобильные устройства и десктоп.

## Возможности

- Публичные комнаты и приватные комнаты по 4-значному коду.
- Чат с автоматической проверкой угадываний.
- Очки за угадывание и за рисование, итоговая таблица.
- Таймер на ход, постепенное открытие букв-подсказок.
- Адаптивный UI (mobile / desktop), рисование пальцем или мышью.
- Real-time на Socket.IO с восстановлением после реконнекта.

## Стек

- **Frontend:** Vue 3 (Composition API) + Vite, Pinia, Vue Router, Socket.IO client, HTML5 Canvas.
- **Backend:** Node.js, Express, Socket.IO.
- **Хостинг:** Render.com (один Web Service раздаёт фронт и держит WebSocket).

## Локальная разработка

Требуется Node.js 20+.

```bash
# Установка зависимостей (root + client + server)
npm install

# Разработка (server на :3000, Vite dev-сервер на :5173 с прокси WS)
npm run dev
# Открыть http://localhost:5173

# Прод-сборка и запуск как на хостинге
npm run build
npm start
# Открыть http://localhost:3000
```

## Деплой на Render.com

1. Запушить репозиторий на GitHub.
2. В Render: **New → Blueprint → Connect repository**.
3. Render автоматически прочитает `render.yaml` и развернёт сервис.
4. Через 2–3 минуты будет доступен URL вида `https://draw-game.onrender.com`.

> **Free tier:** сервис засыпает после 15 минут неактивности.
> Первый запрос «будит» его (~30 секунд).

## Структура

```
client/   # Vue 3 SPA
server/   # Express + Socket.IO
render.yaml
```

## Лицензия

MIT
