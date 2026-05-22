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

## Ссылка на игру
https://draw-game-elvq.onrender.com
#https://draw-game-elvq.onrender.com

## Структура

```
client/   # Vue 3 SPA
server/   # Express + Socket.IO
render.yaml
```
