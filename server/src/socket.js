import {
  addPlayer,
  createRoom,
  deleteRoom,
  findPlayerByUserId,
  getRoom,
  listPublicRooms,
  publicState,
  removePlayer,
  setLobbyNotifier,
} from './rooms.js';
import {
  chooseWord,
  endTurn,
  handleGuess,
  resetToLobby,
  startGame,
} from './game.js';

const MAX_NICKNAME = 20;
const MAX_CHAT = 200;

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

  io.on('connection', (socket) => {
    socket.data.roomId = null;
    socket.data.userId = null;

    socket.on('lobby:list', (cb) => {
      safeCb(cb, { rooms: listPublicRooms() });
    });

    socket.on('lobby:subscribe', () => {
      socket.join('lobby');
      socket.emit('lobby:rooms', { rooms: listPublicRooms() });
    });

    socket.on('lobby:unsubscribe', () => {
      socket.leave('lobby');
    });

    socket.on('room:create', ({ nickname, name, isPublic, settings, userId } = {}, cb) => {
      const nick = sanitizeNick(nickname);
      const settingsClean = sanitizeSettings(settings);
      const room = createRoom({
        name: name ? String(name).slice(0, 40) : '',
        isPublic: Boolean(isPublic),
        settings: settingsClean,
        hostId: socket.id,
        hostNickname: nick,
      });
      joinSocketToRoom(socket, room, nick, userId);
      io.to(room.id).emit('room:state', publicState(room));
      safeCb(cb, { ok: true, roomId: room.id });
    });

    socket.on('room:join', ({ roomId, nickname, userId } = {}, cb) => {
      const id = String(roomId || '').trim().toUpperCase();
      const roomLookup = getRoom(id) || getRoom(String(roomId || '').trim());
      if (!roomLookup) {
        safeCb(cb, { ok: false, error: 'Комната не найдена' });
        return;
      }
      const existing = findPlayerByUserId(roomLookup, userId);
      if (!existing && roomLookup.players.size >= roomLookup.settings.maxPlayers) {
        safeCb(cb, { ok: false, error: 'Комната заполнена' });
        return;
      }
      const nick = sanitizeNick(nickname);
      joinSocketToRoom(socket, roomLookup, nick, userId);
      io.to(roomLookup.id).emit('room:state', publicState(roomLookup));
      safeCb(cb, { ok: true, roomId: roomLookup.id });
    });

    socket.on('room:leave', () => {
      leaveCurrentRoom(io, socket);
    });

    socket.on('game:start', () => {
      const room = currentRoom(socket);
      if (!room) return;
      if (socket.id !== room.hostId) return;
      startGame(io, room);
    });

    socket.on('game:playAgain', () => {
      const room = currentRoom(socket);
      if (!room || socket.id !== room.hostId) return;
      if (room.state !== 'game_end') return;
      resetToLobby(room);
      io.to(room.id).emit('room:state', publicState(room));
    });

    socket.on('game:chooseWord', ({ word } = {}) => {
      const room = currentRoom(socket);
      if (!room) return;
      if (socket.id !== room.drawerId) return;
      chooseWord(io, room, String(word || ''));
    });

    socket.on('game:draw', (stroke) => {
      const room = currentRoom(socket);
      if (!room || room.state !== 'drawing') return;
      if (socket.id !== room.drawerId) return;
      if (!isValidStroke(stroke)) return;
      // Сервер хранит историю в виде чанков, но с общим идентификатором штриха для одного жеста.
      const safeStroke = sanitizeStroke(stroke);
      room.strokes.push(safeStroke);
      if (room.strokes.length > 2000) room.strokes.shift();
      if (room.redoStack.length) room.redoStack = [];
      socket.to(room.id).emit('game:drawStroke', safeStroke);
    });

    socket.on('game:undo', () => {
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

    socket.on('game:redo', () => {
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

    socket.on('game:clearCanvas', () => {
      const room = currentRoom(socket);
      if (!room) return;
      if (socket.id !== room.drawerId) return;
      room.strokes = [];
      room.redoStack = [];
      io.to(room.id).emit('game:clearCanvas');
    });

    socket.on('chat:send', ({ text } = {}) => {
      const room = currentRoom(socket);
      if (!room) return;
      const player = room.players.get(socket.id);
      if (!player) return;
      const raw = String(text || '').slice(0, MAX_CHAT).trim();
      if (!raw) return;

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

    socket.on('disconnect', () => {
      leaveCurrentRoom(io, socket);
    });
  });
}

function joinSocketToRoom(socket, room, nickname, userId) {
  const existing = findPlayerByUserId(room, userId);
  if (existing && existing.id !== socket.id) {
    const oldId = existing.id;
    existing.id = socket.id;
    existing.nickname = nickname;
    existing.isConnected = true;
    if (existing.disconnectTimer) clearTimeout(existing.disconnectTimer);
    existing.disconnectTimer = null;
    room.players.delete(oldId);
    room.players.set(socket.id, existing);
    if (room.hostId === oldId) room.hostId = socket.id;
    if (room.drawerId === oldId) room.drawerId = socket.id;
    if (room.guessedBy.has(oldId)) {
      room.guessedBy.delete(oldId);
      room.guessedBy.add(socket.id);
    }
  } else {
    addPlayer(room, socket.id, nickname, userId);
  }
  socket.join(room.id);
  socket.data.roomId = room.id;
  socket.data.userId = userId || null;
}

function currentRoom(socket) {
  if (!socket.data.roomId) return null;
  return getRoom(socket.data.roomId);
}

function leaveCurrentRoom(io, socket) {
  const room = currentRoom(socket);
  if (!room) return;
  const player = room.players.get(socket.id);
  if (!player) return;
  socket.leave(room.id);
  socket.data.roomId = null;
  player.isConnected = false;
  if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
  player.disconnectTimer = null;
  const wasDrawer = socket.id === room.drawerId;
  removePlayer(room, socket.id);
  io.to(room.id).emit('chat:system', { text: `${player.nickname} покинул комнату` });
  if (room.players.size === 0) {
    deleteRoom(room.id);
    return;
  }
  if (wasDrawer && (room.state === 'drawing' || room.state === 'choosing')) {
    endTurn(io, room, 'drawer_left');
  }
  io.to(room.id).emit('room:state', publicState(room));
}

function isValidStroke(s) {
  if (!s || typeof s !== 'object') return false;
  if (!Array.isArray(s.points) || s.points.length === 0 || s.points.length > 500) return false;
  for (const p of s.points) {
    if (!Array.isArray(p) || p.length !== 2) return false;
    if (typeof p[0] !== 'number' || typeof p[1] !== 'number') return false;
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
