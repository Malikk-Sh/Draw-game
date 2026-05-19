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

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: isProd ? undefined : { origin: '*' },
  pingInterval: 20000,
  pingTimeout: 25000,
});

registerSocketHandlers(io);

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
