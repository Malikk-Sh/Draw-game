import {
  addBot,
  addPlayer,
  cancelDisconnectTimer,
  connectedCount,
  createRoom,
  deleteRoom,
  ensureInDrawerOrder,
  findPlayerByUserId,
  getRoom,
  hasConnectedHumans,
  isRoomAlive,
  listPublicRooms,
  publicState,
  reassignHost,
  remapPlayerId,
  removePlayer,
  setLobbyNotifier,
  startRoomJanitor,
  touchRoom,
} from './rooms.js';
import {
  CHOOSING_MS,
  chooseWord,
  endGame,
  endTurn,
  handleGuess,
  maybeEndTurnEarly,
  resetToLobby,
  startGame,
} from './game.js';

const MAX_NICKNAME = 20;
const MAX_CHAT = 200;
const DISCONNECT_GRACE_MS = 30000;
const REACTIONS = ['👍', '❤️', '😂', '😮', '🎉'];
const REACT_MIN_INTERVAL_MS = 500;

const DEFAULT_SETTINGS = {
  rounds: 3,
  turnSec: 80,
  hintsEnabled: true,
  maxPlayers: 8,
};

function sanitizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  s.rounds = clamp(parseInt(s.rounds, 10) || 3, 1, 10);
  s.turnSec = clamp(parseInt(s.turnSec, 10) || 80, 30, 180);
  s.hintsEnabled = Boolean(s.hintsEnabled);
  s.maxPlayers = clamp(parseInt(s.maxPlayers, 10) || 8, 2, 12);
  return s;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function sanitizeNick(n) {
  return String(n || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, MAX_NICKNAME) || 'Игрок';
}

export function registerSocketHandlers(io) {
  setLobbyNotifier(() => {
    io.to('lobby').emit('lobby:rooms', { rooms: listPublicRooms() });
  });

  // Уборщик комнат: grace-таймеров недостаточно (сокет может «пропасть» без
  // события disconnect, комната может остаться вообще без игроков).
  startRoomJanitor((room, reason) => {
    try {
      io.to(room.id).emit('room:closed', { reason });
      io.to(room.id).emit('chat:system', { text: 'Комната закрыта из-за неактивности.' });
      io.in(room.id).socketsLeave(room.id);
    } catch (e) {
      console.error('[janitor notify]', e);
    }
  });

  io.on('connection', (socket) => {
    socket.data.roomId = null;
    socket.data.userId = null;

    // Обёртка: исключение в одном обработчике не должно стать uncaughtException
    // и уронить процесс — логируем и продолжаем. Асинхронные отказы ловим тоже.
    const on = (event, fn) => socket.on(event, (...args) => {
      try {
        const result = fn(...args);
        if (result && typeof result.catch === 'function') {
          result.catch((e) => console.error(`[handler ${event}]`, e));
        }
      } catch (e) {
        console.error(`[handler ${event}]`, e);
      }
    });

    // Клиент может прислать событие как с полезной нагрузкой, так и без неё —
    // ack ищем среди аргументов, иначе запрос молча «зависал» по таймауту.
    on('lobby:list', (...args) => {
      safeCb(args.find((a) => typeof a === 'function'), { rooms: listPublicRooms() });
    });

    on('lobby:subscribe', () => {
      socket.join('lobby');
      socket.emit('lobby:rooms', { rooms: listPublicRooms() });
    });

    on('lobby:unsubscribe', () => {
      socket.leave('lobby');
    });

    on('room:create', ({ nickname, name, isPublic, settings, userId } = {}, cb) => {
      const nick = sanitizeNick(nickname);
      const settingsClean = sanitizeSettings(settings);
      const room = createRoom({
        name: name ? String(name).slice(0, 40) : '',
        isPublic: Boolean(isPublic),
        settings: settingsClean,
        hostId: socket.id,
        hostNickname: nick,
      });
      joinSocketToRoom(io, socket, room, nick, userId);
      io.to(room.id).emit('room:state', publicState(room));
      safeCb(cb, { ok: true, roomId: room.id });
    });

    on('room:createTest', ({ nickname, userId } = {}, cb) => {
      const nick = sanitizeNick(nickname);
      const settingsClean = sanitizeSettings({ rounds: 2, turnSec: 60 });
      const room = createRoom({
        name: `🧪 Тест ${nick}`,
        isPublic: false,
        settings: settingsClean,
        hostId: socket.id,
        hostNickname: nick,
      });
      room.isTest = true;
      joinSocketToRoom(io, socket, room, nick, userId);
      addBot(room);
      io.to(room.id).emit('room:state', publicState(room));
      safeCb(cb, { ok: true, roomId: room.id });
    });

    on('room:join', ({ roomId, nickname, userId } = {}, cb) => {
      const id = String(roomId || '').trim().toUpperCase();
      const roomLookup = getRoom(id) || getRoom(String(roomId || '').trim());
      if (!roomLookup || roomLookup.destroyed) {
        safeCb(cb, { ok: false, error: 'Комната не найдена' });
        return;
      }
      const existing = findPlayerByUserId(roomLookup, userId);
      const alreadyHere = existing || roomLookup.players.has(socket.id);
      // Занятыми считаем только живые слоты: «призраки» не должны блокировать вход.
      if (!alreadyHere && connectedCount(roomLookup) >= roomLookup.settings.maxPlayers) {
        safeCb(cb, { ok: false, error: 'Комната заполнена' });
        return;
      }
      const nick = sanitizeNick(nickname);
      joinSocketToRoom(io, socket, roomLookup, nick, userId);
      io.to(roomLookup.id).emit('room:state', publicState(roomLookup));
      safeCb(cb, { ok: true, roomId: roomLookup.id });
    });

    on('room:leave', (...args) => {
      leaveCurrentRoom(io, socket);
      safeCb(args.find((a) => typeof a === 'function'), { ok: true });
    });

    on('game:start', () => {
      const room = currentRoom(socket);
      if (!room) return;
      if (socket.id !== room.hostId) return;
      startGame(io, room);
    });

    on('game:playAgain', () => {
      const room = currentRoom(socket);
      if (!room || socket.id !== room.hostId) return;
      if (room.state !== 'game_end') return;
      resetToLobby(room);
      io.to(room.id).emit('room:state', publicState(room));
    });

    on('game:chooseWord', ({ word } = {}) => {
      const room = currentRoom(socket);
      if (!room) return;
      if (socket.id !== room.drawerId) return;
      touchRoom(room);
      chooseWord(io, room, String(word || ''));
    });

    on('game:draw', (stroke) => {
      const room = currentRoom(socket);
      if (!room || room.state !== 'drawing') return;
      if (socket.id !== room.drawerId) return;
      if (!isValidStroke(stroke)) return;
      // Сервер хранит историю в виде чанков, но с общим идентификатором штриха для одного жеста.
      const safeStroke = sanitizeStroke(stroke);
      room.strokes.push(safeStroke);
      if (room.strokes.length > 2000) room.strokes.shift();
      if (room.redoStack.length) room.redoStack = [];
      touchRoom(room);
      socket.to(room.id).emit('game:drawStroke', safeStroke);
    });

    on('game:undo', () => {
      const room = currentRoom(socket);
      if (!room || room.state !== 'drawing') return;
      if (socket.id !== room.drawerId) return;
      if (room.strokes.length === 0) return;
      // Отмена удаляет весь жест целиком (все чанки с одним идентификатором штриха).
      const targetId = room.strokes[room.strokes.length - 1].strokeId || '__legacy__';
      while (room.strokes.length) {
        const top = room.strokes[room.strokes.length - 1];
        const topId = top.strokeId || '__legacy__';
        if (topId !== targetId) break;
        room.redoStack.push(room.strokes.pop());
      }
      socket.to(room.id).emit('game:canvasReplace', { strokes: room.strokes });
    });

    on('game:redo', () => {
      const room = currentRoom(socket);
      if (!room || room.state !== 'drawing') return;
      if (socket.id !== room.drawerId) return;
      if (room.redoStack.length === 0) return;
      // Возврат возвращает один полный жест в исходной последовательности чанков.
      const targetId = room.redoStack[room.redoStack.length - 1].strokeId || '__legacy__';
      const recovered = [];
      while (room.redoStack.length) {
        const top = room.redoStack[room.redoStack.length - 1];
        const topId = top.strokeId || '__legacy__';
        if (topId !== targetId) break;
        recovered.push(room.redoStack.pop());
      }
      recovered.reverse();
      for (const stroke of recovered) {
        room.strokes.push(stroke);
        socket.to(room.id).emit('game:drawStroke', stroke);
      }
    });

    on('game:clearCanvas', () => {
      const room = currentRoom(socket);
      if (!room) return;
      if (socket.id !== room.drawerId) return;
      room.strokes = [];
      room.redoStack = [];
      io.to(room.id).emit('game:clearCanvas');
    });

    on('chat:send', ({ text } = {}) => {
      const room = currentRoom(socket);
      if (!room) return;
      const player = room.players.get(socket.id);
      if (!player) return;
      const raw = String(text || '').slice(0, MAX_CHAT).trim();
      if (!raw) return;
      touchRoom(room);

      if (room.state === 'drawing' && socket.id !== room.drawerId) {
        if (!room.turnChatActivity) room.turnChatActivity = new Set();
        room.turnChatActivity.add(socket.id);
      }

      if (room.state === 'drawing' && socket.id !== room.drawerId && !room.guessedBy.has(socket.id)) {
        const result = handleGuess(io, room, socket.id, raw);
        if (result.kind === 'correct') return;
        if (result.kind === 'close') return;
      }

      if (room.state === 'drawing' && socket.id === room.drawerId) {
        return;
      }

      const isAfterGuess = room.guessedBy.has(socket.id) && room.state === 'drawing';
      const channel = isAfterGuess ? 'chat:guessed' : 'chat:message';
      const payload = {
        id: socket.id,
        nickname: player.nickname,
        text: raw,
        timestamp: Date.now(),
      };

      if (isAfterGuess) {
        for (const [pid] of room.players) {
          if (pid === room.drawerId) continue;
          if (!room.guessedBy.has(pid) && pid !== socket.id) continue;
          io.to(pid).emit(channel, payload);
        }
      } else {
        io.to(room.id).emit(channel, payload);
      }
    });

    on('game:react', ({ emoji } = {}) => {
      const room = currentRoom(socket);
      if (!room) return;
      const player = room.players.get(socket.id);
      if (!player) return;
      if (!REACTIONS.includes(emoji)) return;
      const now = Date.now();
      if (player.lastReactAt && now - player.lastReactAt < REACT_MIN_INTERVAL_MS) return;
      player.lastReactAt = now;
      io.to(room.id).emit('game:reaction', { id: `${socket.id}:${now}`, emoji });
    });

    on('disconnect', () => {
      markDisconnected(io, socket);
    });
  });
}

// Вход в комнату и «переезд» игрока на новый socket.id при реконнекте.
// Все ссылки на игрока (очередь рисующих, отметки хода, хост, рисующий)
// переносятся централизованно через remapPlayerId.
export function joinSocketToRoom(io, socket, room, nickname, userId) {
  const existing = findPlayerByUserId(room, userId);
  let reconnected = false;

  if (existing && existing.id !== socket.id) {
    const oldId = existing.id;
    // Старая вкладка/сокет не должна продолжать получать события комнаты.
    const oldSocket = io?.sockets?.sockets?.get?.(oldId);
    if (oldSocket && oldSocket.id !== socket.id) {
      try {
        oldSocket.leave(room.id);
      } catch (_) {}
      if (oldSocket.data) oldSocket.data.roomId = null;
    }
    cancelDisconnectTimer(existing);
    remapPlayerId(room, oldId, socket.id);
    existing.nickname = nickname;
    existing.isConnected = true;
    reconnected = true;
  } else {
    const player = addPlayer(room, socket.id, nickname, userId);
    cancelDisconnectTimer(player);
    if (!player.isConnected) reconnected = true;
    player.isConnected = true;
    player.nickname = nickname;
    if (userId && !player.userId) player.userId = String(userId).slice(0, 80);
    ensureInDrawerOrder(room, socket.id);
  }

  reassignHost(room);
  touchRoom(room);
  socket.join(room.id);
  socket.data.roomId = room.id;
  socket.data.userId = userId || null;

  if (reconnected) {
    io.to(room.id).emit('chat:system', { text: `${nickname} снова в игре` });
  }
  // Полное состояние — лично вошедшему: очки, очередь, текущий ход, холст.
  socket.emit('room:state', publicState(room));
  restoreDrawerContext(socket, room);
  return room.players.get(socket.id);
}

// Рисующий, вернувшийся после обрыва, должен получить обратно своё слово или
// экран выбора — иначе он «слепой» до конца хода.
function restoreDrawerContext(socket, room) {
  if (room.drawerId !== socket.id) return;
  if (room.state === 'drawing' && room.currentWord) {
    // room:state уже вернул таймер, холст и маску — не хватает только слова.
    socket.emit('game:wordToDraw', { word: room.currentWord });
  } else if (room.state === 'choosing' && room.pendingChoices) {
    socket.emit('game:wordChoices', {
      words: room.pendingChoices,
      timeMs: remainingChoosingMs(room),
    });
  }
}

function remainingChoosingMs(room) {
  const elapsed = Date.now() - (room.choosingStartedAt || Date.now());
  return clamp(CHOOSING_MS - elapsed, 2000, CHOOSING_MS);
}

function currentRoom(socket) {
  if (!socket.data.roomId) return null;
  const room = getRoom(socket.data.roomId);
  if (!room || room.destroyed) {
    socket.data.roomId = null;
    return null;
  }
  return room;
}

// Мягкий обрыв связи: игрок не удаляется сразу, ему даётся время на реконнект
// (с тем же userId), чтобы сохранить очки, ход и комнату при кратких сбоях сети.
function markDisconnected(io, socket) {
  const room = currentRoom(socket);
  if (!room) return;
  const player = room.players.get(socket.id);
  if (!player) return;
  socket.leave(room.id);
  socket.data.roomId = null;
  player.isConnected = false;

  const wasHost = room.hostId === player.id;

  // Рисующий всё равно не сможет рисовать — завершаем ход, но игрока оставляем.
  if (socket.id === room.drawerId && (room.state === 'drawing' || room.state === 'choosing')) {
    endTurn(io, room, 'drawer_left');
  } else {
    // Возможно, оставшиеся уже всё угадали — не держим ход до таймаута.
    maybeEndTurnEarly(io, room);
  }

  // Хост без связи не сможет нажать «Начать» — передаём права живому человеку.
  reassignHost(room);
  if (wasHost && room.hostId && room.hostId !== player.id) {
    const newHost = room.players.get(room.hostId);
    if (newHost) io.to(room.id).emit('chat:system', { text: `${newHost.nickname} теперь ведущий` });
  }

  cancelDisconnectTimer(player);
  player.disconnectTimer = setTimeout(
    () => finalizeRemoval(io, room, player),
    DISCONNECT_GRACE_MS,
  );
  if (typeof player.disconnectTimer.unref === 'function') player.disconnectTimer.unref();

  io.to(room.id).emit('chat:system', { text: `${player.nickname} потерял соединение...` });
  io.to(room.id).emit('room:state', publicState(room));
  touchRoom(room);
  closeRoomIfDead(io, room);
}

// Окончательное удаление игрока из комнаты (по истечении grace или при явном выходе).
function finalizeRemoval(io, room, player) {
  if (!player) return;
  cancelDisconnectTimer(player);
  if (!isRoomAlive(room)) return;
  if (player.isConnected) return; // успел переподключиться — ничего не делаем
  if (room.players.get(player.id) !== player) return; // уже удалён или заменён
  const wasDrawer = player.id === room.drawerId;
  removePlayer(room, player.id);
  io.to(room.id).emit('chat:system', { text: `${player.nickname} покинул комнату` });

  if (closeRoomIfDead(io, room)) return;

  if (wasDrawer && (room.state === 'drawing' || room.state === 'choosing')) {
    endTurn(io, room, 'drawer_left');
  } else {
    maybeEndTurnEarly(io, room);
  }
  // Игра вдвоём, один вышел — продолжать нечего.
  if (room.state !== 'waiting' && room.state !== 'game_end' && connectedCount(room) < 2) {
    endGame(io, room);
  }
  io.to(room.id).emit('room:state', publicState(room));
}

// Комната без живых людей закрывается сразу — она не должна висеть в лобби
// в ожидании уборщика.
function closeRoomIfDead(io, room) {
  if (!isRoomAlive(room)) return true;
  if (hasConnectedHumans(room)) return false;
  // Есть отключённые люди — оставляем шанс на реконнект, комнату уберёт janitor.
  const hasPendingHumans = Array.from(room.players.values()).some((p) => !p.isBot);
  if (hasPendingHumans) return false;
  io.to(room.id).emit('room:closed', { reason: 'empty' });
  deleteRoom(room.id);
  return true;
}

// Явный выход по кнопке — удаляем немедленно, без grace-периода.
function leaveCurrentRoom(io, socket) {
  const room = currentRoom(socket);
  if (!room) return;
  const player = room.players.get(socket.id);
  socket.leave(room.id);
  socket.data.roomId = null;
  if (!player) return;
  player.isConnected = false;
  cancelDisconnectTimer(player);
  finalizeRemoval(io, room, player);
}

function isValidStroke(s) {
  if (!s || typeof s !== 'object') return false;
  if (!Array.isArray(s.points) || s.points.length === 0 || s.points.length > 500) return false;
  for (const p of s.points) {
    if (!Array.isArray(p) || p.length !== 2) return false;
    if (typeof p[0] !== 'number' || typeof p[1] !== 'number') return false;
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false;
    if (p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) return false;
  }
  return true;
}

function sanitizeStroke(s) {
  // Идентификатор штриха безопасно ограничиваем по длине — он нужен только для группировки отмены/возврата.
  const strokeId = typeof s.strokeId === 'string' ? s.strokeId.slice(0, 64) : null;
  const color = typeof s.color === 'string' ? s.color.slice(0, 16) : '#000000';
  const size = clamp(Number(s.size) || 4, 1, 64);
  const tool = s.tool === 'eraser' ? 'eraser' : 'brush';
  return { strokeId, color, size, tool, points: s.points };
}

function safeCb(cb, payload) {
  if (typeof cb === 'function') {
    try { cb(payload); } catch (_) {}
  }
}

export const _internals = {
  markDisconnected,
  finalizeRemoval,
  leaveCurrentRoom,
  closeRoomIfDead,
  DISCONNECT_GRACE_MS,
};
