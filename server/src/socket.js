import {
  addPlayer,
  createRoom,
  deleteRoom,
  getRoom,
  listPublicRooms,
  publicState,
  removePlayer,
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
  hintsCount: 2,
  maxPlayers: 8,
};

function sanitizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  s.rounds = clamp(parseInt(s.rounds, 10) || 3, 1, 10);
  s.turnSec = clamp(parseInt(s.turnSec, 10) || 80, 30, 180);
  s.hintsCount = clamp(parseInt(s.hintsCount, 10) || 2, 0, 4);
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
  io.on('connection', (socket) => {
    socket.data.roomId = null;

    socket.on('lobby:list', (cb) => {
      safeCb(cb, { rooms: listPublicRooms() });
    });

    socket.on('room:create', ({ nickname, name, isPublic, settings } = {}, cb) => {
      const nick = sanitizeNick(nickname);
      const settingsClean = sanitizeSettings(settings);
      const room = createRoom({
        name: name ? String(name).slice(0, 40) : '',
        isPublic: Boolean(isPublic),
        settings: settingsClean,
        hostId: socket.id,
        hostNickname: nick,
      });
      joinSocketToRoom(socket, room, nick);
      io.to(room.id).emit('room:state', publicState(room));
      safeCb(cb, { ok: true, roomId: room.id });
    });

    socket.on('room:join', ({ roomId, nickname } = {}, cb) => {
      const id = String(roomId || '').trim().toUpperCase();
      const roomLookup = getRoom(id) || getRoom(String(roomId || '').trim());
      if (!roomLookup) {
        safeCb(cb, { ok: false, error: 'Комната не найдена' });
        return;
      }
      if (roomLookup.players.size >= roomLookup.settings.maxPlayers) {
        safeCb(cb, { ok: false, error: 'Комната заполнена' });
        return;
      }
      const nick = sanitizeNick(nickname);
      joinSocketToRoom(socket, roomLookup, nick);
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
      const safeStroke = sanitizeStroke(stroke);
      room.strokes.push(safeStroke);
      if (room.strokes.length > 2000) room.strokes.shift();
      socket.to(room.id).emit('game:drawStroke', safeStroke);
    });

    socket.on('game:clearCanvas', () => {
      const room = currentRoom(socket);
      if (!room) return;
      if (socket.id !== room.drawerId) return;
      room.strokes = [];
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

function joinSocketToRoom(socket, room, nickname) {
  socket.join(room.id);
  socket.data.roomId = room.id;
  addPlayer(room, socket.id, nickname);
}

function currentRoom(socket) {
  if (!socket.data.roomId) return null;
  return getRoom(socket.data.roomId);
}

function leaveCurrentRoom(io, socket) {
  const room = currentRoom(socket);
  if (!room) return;
  const wasDrawer = socket.id === room.drawerId;
  const player = removePlayer(room, socket.id);
  socket.leave(room.id);
  socket.data.roomId = null;

  if (player) {
    io.to(room.id).emit('chat:system', { text: `${player.nickname} покинул комнату` });
  }

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
  const color = typeof s.color === 'string' ? s.color.slice(0, 16) : '#000000';
  const size = clamp(Number(s.size) || 4, 1, 64);
  const tool = s.tool === 'eraser' ? 'eraser' : 'brush';
  return { color, size, tool, points: s.points };
}

function safeCb(cb, payload) {
  if (typeof cb === 'function') {
    try { cb(payload); } catch (_) {}
  }
}
