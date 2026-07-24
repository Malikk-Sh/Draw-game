import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { registerSocketHandlers } from './socket.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Один сбойный обработчик не должен ронять весь сервер и все комнаты разом.
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: isProd ? undefined : { origin: '*' },
  pingInterval: 20000,
  pingTimeout: 25000,
  // Восстановление состояния соединения намеренно НЕ включаем: сокет вернулся бы
  // со старым id в комнату, которую сервер уже пометил отключённой. Реконнект
  // выполняет клиент явным room:join по userId — это единственный путь.
});

io.engine.on('connection_error', (err) => {
  console.warn('[engine] connection_error', err.code, err.message);
});

registerSocketHandlers(io);

// На free-плане Render процесс регулярно усыпляют/перезапускают: логируем сигналы,
// чтобы «самопроизвольные перезагрузки» были отличимы от падений по ошибке.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[shutdown] received ${sig}`);
    try {
      io.close();
    } catch (_) {}
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const clientDist = resolve(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
} else if (isProd) {
  console.warn('[warn] client/dist not found — run `npm run build` first.');
}

httpServer.listen(PORT, () => {
  console.log(`Draw Game server listening on http://localhost:${PORT}`);
});
