// Сквозной прогон на настоящем сервере и настоящих socket.io-клиентах.
// socket.io-client живёт в зависимостях клиента: если они не установлены
// (например, на «голом» сервере), набор тестов пропускается.
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Server as SocketServer } from 'socket.io';

import { _resetRooms, allRooms, getRoom, sweepRooms } from '../src/rooms.js';
import { registerSocketHandlers } from '../src/socket.js';

async function loadClient() {
  try {
    const require = createRequire(new URL('../../client/package.json', import.meta.url));
    const mod = await import(pathToFileURL(require.resolve('socket.io-client')).href);
    return mod.io || mod.default?.io || null;
  } catch (_) {
    return null;
  }
}

const ioc = await loadClient();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function ack(socket, event, payload, ms = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), ms);
    const cb = (res) => {
      clearTimeout(t);
      resolve(res);
    };
    if (payload === undefined) socket.emit(event, cb);
    else socket.emit(event, payload, cb);
  });
}

function once(socket, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

describe('сквозной прогон через настоящие сокеты', { skip: ioc ? false : 'socket.io-client не установлен' }, () => {
  let httpServer;
  let io;
  let url;
  const clients = [];

  before(async () => {
    httpServer = createServer();
    io = new SocketServer(httpServer, { cors: { origin: '*' } });
    registerSocketHandlers(io);
    const port = await new Promise((res) => httpServer.listen(0, () => res(httpServer.address().port)));
    url = `http://localhost:${port}`;
  });

  after(async () => {
    for (const c of clients) c.close();
    io.close();
    httpServer.close();
    _resetRooms();
  });

  function connect() {
    const socket = ioc(url, { transports: ['websocket'], forceNew: true });
    socket.state = null;
    socket.on('room:state', (st) => { socket.state = st; });
    clients.push(socket);
    return socket;
  }

  test('партия, досрочное завершение хода и реконнект с сохранением очков', async () => {
    const a = connect();
    await once(a, 'connect');
    const created = await ack(a, 'room:create', {
      nickname: 'Аня',
      userId: 'u-a',
      isPublic: true,
      settings: { rounds: 1, turnSec: 30 },
    });
    assert.equal(created.ok, true);
    const roomId = created.roomId;

    const b = connect();
    await once(b, 'connect');
    assert.equal((await ack(b, 'room:join', { roomId, nickname: 'Боря', userId: 'u-b' })).ok, true);
    await wait(120);
    assert.equal(a.state.players.length, 2);
    assert.equal(b.state.players.length, 2);

    const lobby = await ack(a, 'lobby:list');
    assert.equal(lobby.rooms.length, 1);
    assert.equal(lobby.rooms[0].playersCount, 2, 'в лобби видно обоих игроков');

    // Старт партии: рисующим может стать любой из двоих — определяем его по
    // тому, кому сервер прислал слова на выбор.
    let drawer = null;
    const choicesPromise = Promise.race([
      once(a, 'game:wordChoices').then((p) => { drawer = a; return p; }),
      once(b, 'game:wordChoices').then((p) => { drawer = b; return p; }),
    ]);
    a.emit('game:start');
    const choices = await choicesPromise;
    await wait(60);
    const guesser = drawer === a ? b : a;
    assert.equal(getRoom(roomId).drawerId, drawer.id, 'рисующий определён однозначно');

    const wordPromise = once(drawer, 'game:wordToDraw');
    drawer.emit('game:chooseWord', { word: choices.words[0] });
    const { word } = await wordPromise;
    assert.equal(word, choices.words[0]);

    // Единственный живой угадывающий отгадал → ход обязан завершиться сразу.
    const turnEndPromise = once(guesser, 'game:turnEnd');
    guesser.emit('chat:send', { text: word });
    const turnEnd = await turnEndPromise;
    assert.equal(turnEnd.reason, 'all_guessed');
    const scoreBefore = turnEnd.scores[guesser.id];
    assert.ok(scoreBefore > 0, 'очки начислены');

    // Обрыв связи: игрок остаётся в комнате на время grace-периода.
    const guesserUserId = guesser === a ? 'u-a' : 'u-b';
    guesser.disconnect();
    await wait(200);
    assert.equal(getRoom(roomId).players.size, 2);

    guesser.connect();
    await once(guesser, 'connect');
    const rejoin = await ack(guesser, 'room:join', {
      roomId,
      nickname: 'Боря',
      userId: guesserUserId,
    });
    assert.equal(rejoin.ok, true);
    await wait(150);

    const me = guesser.state.players.find((p) => p.id === guesser.id);
    assert.ok(me, 'вернувшийся игрок есть в room:state под новым socket.id');
    assert.equal(me.score, scoreBefore, 'очки сохранены');
    assert.equal(guesser.state.players.length, 2, 'дубль игрока не создан');

    const serverRoom = getRoom(roomId);
    assert.ok(serverRoom.drawerOrder.includes(guesser.id), 'место в очереди восстановлено');
    assert.equal(serverRoom.drawerOrder.length, 2);

    // Все вышли → комната исчезает и из реестра, и из лобби.
    a.emit('room:leave');
    b.emit('room:leave');
    await wait(300);
    assert.equal(getRoom(roomId), undefined);
    assert.equal((await ack(a, 'lobby:list')).rooms.length, 0);
  });

  test('брошенная комната переживает grace-период и закрывается уборщиком', async () => {
    const c = connect();
    await once(c, 'connect');
    const created = await ack(c, 'room:create', { nickname: 'Ц', userId: 'u-c', isPublic: true });
    // Жёсткий обрыв без room:leave.
    c.close();
    await wait(250);

    const room = getRoom(created.roomId);
    assert.ok(room, 'комната ещё жива — игрок может вернуться');
    assert.equal(Array.from(room.players.values())[0].isConnected, false);
    assert.equal((await ack(connect(), 'lobby:list').catch(() => ({ rooms: [] }))).rooms.length, 0,
      'но в лобби её уже не показывают');

    // Имитируем истёкший TTL — уборщик обязан её закрыть.
    room.lastActivityAt = Date.now() - 10 * 60 * 1000;
    const closed = sweepRooms();
    assert.ok(closed.some((x) => x.id === created.roomId));
    assert.equal(getRoom(created.roomId), undefined);
    assert.equal(allRooms().length, 0);
  });
});
