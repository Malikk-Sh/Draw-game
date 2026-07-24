import { customAlphabet } from 'nanoid';

const ROOM_CODE = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);
const PUBLIC_ID = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const rooms = new Map();

// Комната без единого живого человека живёт ещё столько времени — этого хватает
// на кратковременный реконнект (grace-таймер = 30с), но не даёт «висеть» вечно.
export const EMPTY_ROOM_TTL_MS = 60000;
// Жёсткий предел простоя: даже если в комнате кто-то формально «подключён»,
// но за это время не произошло ни одного события — комната закрывается.
export const IDLE_ROOM_TTL_MS = 45 * 60 * 1000;
export const JANITOR_INTERVAL_MS = 20000;
// Уведомления лобби склеиваются в это окно, чтобы всплеск join/leave
// не рассылал десятки одинаковых списков.
const LOBBY_NOTIFY_DEBOUNCE_MS = 120;

let lobbyNotifier = null;
let lobbyTimer = null;

export function setLobbyNotifier(fn) {
  lobbyNotifier = fn;
}

function runLobbyNotifier() {
  lobbyTimer = null;
  if (!lobbyNotifier) return;
  try {
    lobbyNotifier();
  } catch (e) {
    console.error('[lobby notify]', e);
  }
}

export function notifyLobby() {
  if (!lobbyNotifier || lobbyTimer) return;
  lobbyTimer = setTimeout(runLobbyNotifier, LOBBY_NOTIFY_DEBOUNCE_MS);
  if (typeof lobbyTimer.unref === 'function') lobbyTimer.unref();
}

// Немедленная рассылка (используется в тестах и при закрытии комнат уборщиком).
export function flushLobby() {
  if (lobbyTimer) {
    clearTimeout(lobbyTimer);
    lobbyTimer = null;
  }
  runLobbyNotifier();
}

export function getRoom(id) {
  return rooms.get(id);
}

export function allRooms() {
  return Array.from(rooms.values());
}

// Комната считается «живой», пока она есть в реестре и не помечена удалённой.
// Все отложенные колбэки (таймеры хода, уборщик) обязаны это проверять.
export function isRoomAlive(room) {
  return Boolean(room) && !room.destroyed && rooms.get(room.id) === room;
}

export function touchRoom(room) {
  if (!room) return;
  room.lastActivityAt = Date.now();
}

export function connectedPlayers(room) {
  return Array.from(room.players.values()).filter((p) => p.isConnected);
}

export function connectedHumans(room) {
  return Array.from(room.players.values()).filter((p) => p.isConnected && !p.isBot);
}

export function connectedCount(room) {
  let n = 0;
  for (const p of room.players.values()) if (p.isConnected) n += 1;
  return n;
}

export function hasConnectedHumans(room) {
  for (const p of room.players.values()) if (p.isConnected && !p.isBot) return true;
  return false;
}

export function listPublicRooms() {
  const result = [];
  for (const room of rooms.values()) {
    if (!room.isPublic || room.destroyed) continue;
    // В лобби показываем только комнаты, где реально есть живые люди —
    // «брошенные» комнаты не должны висеть в списке до срабатывания уборщика.
    const humans = connectedHumans(room).length;
    if (humans === 0) continue;
    result.push({
      id: room.id,
      name: room.name,
      playersCount: connectedCount(room),
      maxPlayers: room.settings.maxPlayers,
      turnSec: room.settings.turnSec,
      hintsEnabled: room.settings.hintsEnabled,
      state: room.state,
    });
  }
  return result;
}

export function createRoom({ name, isPublic, settings, hostId, hostNickname }) {
  const id = isPublic ? PUBLIC_ID() : ROOM_CODE();
  const room = {
    id,
    name: name || `Комната ${hostNickname}`,
    isPublic: Boolean(isPublic),
    hostId,
    players: new Map(),
    state: 'waiting',
    round: 0,
    maxRounds: settings.rounds,
    // Очередь рисующих: динамический список id живых игроков в порядке входа.
    drawerOrder: [],
    // Кто уже рисовал в текущем раунде — основа для честной ротации при
    // входах/выходах игроков (индекс в массиве для этого не годится).
    drawnThisRound: new Set(),
    drawerIndex: -1,
    drawerId: null,
    pendingChoices: null,
    currentWord: null,
    wordMask: [],
    hintsRevealed: 0,
    turnDurationMs: settings.turnSec * 1000,
    turnStartedAt: 0,
    choosingStartedAt: 0,
    turnTimer: null,
    hintTimers: [],
    choosingTimer: null,
    roundEndTimer: null,
    guessedBy: new Set(),
    strokes: [],
    redoStack: [],
    recentWords: [],
    turnChatActivity: new Set(),
    botTimers: [],
    botId: null,
    isTest: false,
    destroyed: false,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    settings,
  };
  rooms.set(id, room);
  if (room.isPublic) notifyLobby();
  return room;
}

export function deleteRoom(id) {
  const room = rooms.get(id);
  if (!room) return null;
  room.destroyed = true;
  clearAllTimers(room);
  clearPlayerTimers(room);
  rooms.delete(id);
  if (room.isPublic) notifyLobby();
  return room;
}

export function clearAllTimers(room) {
  if (!room) return;
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (room.choosingTimer) clearTimeout(room.choosingTimer);
  if (room.roundEndTimer) clearTimeout(room.roundEndTimer);
  (room.hintTimers || []).forEach((t) => clearTimeout(t));
  (room.botTimers || []).forEach((t) => clearTimeout(t));
  room.turnTimer = null;
  room.choosingTimer = null;
  room.roundEndTimer = null;
  room.hintTimers = [];
  room.botTimers = [];
}

// Таймеры текущего хода — без roundEndTimer, который отвечает за переход
// к следующему ходу и не должен гаситься «попутно» (иначе игра зависает).
export function clearTurnTimers(room) {
  if (!room) return;
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (room.choosingTimer) clearTimeout(room.choosingTimer);
  (room.hintTimers || []).forEach((t) => clearTimeout(t));
  (room.botTimers || []).forEach((t) => clearTimeout(t));
  room.turnTimer = null;
  room.choosingTimer = null;
  room.hintTimers = [];
  room.botTimers = [];
}

// Персональные grace-таймеры игроков — отдельная категория утечек: они
// переживают удаление комнаты, если их не погасить явно.
export function clearPlayerTimers(room) {
  if (!room) return;
  for (const p of room.players.values()) {
    if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    p.disconnectTimer = null;
  }
}

export function cancelDisconnectTimer(player) {
  if (!player) return;
  if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
  player.disconnectTimer = null;
}

export function addPlayer(room, socketId, nickname, userId = null) {
  if (room.players.has(socketId)) return room.players.get(socketId);
  const player = {
    id: socketId,
    nickname: nickname.slice(0, 20),
    score: 0,
    joinedAt: Date.now(),
    isConnected: true,
    userId: userId ? String(userId).slice(0, 80) : null,
    disconnectTimer: null,
    correctStreak: 0,
    afkTurns: 0,
    lastGuessPoints: 0,
    lastReactAt: 0,
  };
  room.players.set(socketId, player);
  // Игрок, вошедший во время игры, встаёт в конец очереди рисующих и
  // получает ход в текущей ротации (он ещё не рисовал в этом раунде).
  ensureInDrawerOrder(room, socketId);
  if (!room.hostId || !room.players.has(room.hostId)) {
    room.hostId = socketId;
  }
  touchRoom(room);
  if (room.isPublic) notifyLobby();
  return player;
}

export function ensureInDrawerOrder(room, playerId) {
  if (!room.drawerOrder.includes(playerId)) room.drawerOrder.push(playerId);
}

// Хост должен быть живым человеком: иначе игру некому запустить.
export function reassignHost(room) {
  if (room.hostId) {
    const current = room.players.get(room.hostId);
    if (current && current.isConnected && !current.isBot) return room.hostId;
  }
  const candidate = connectedHumans(room).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (candidate) {
    room.hostId = candidate.id;
    return room.hostId;
  }
  // Живых людей нет — оставляем любого игрока, чтобы hostId не «завис» на
  // удалённом id (комнату всё равно закроет уборщик).
  const anyPlayer = room.players.keys().next();
  room.hostId = anyPlayer.done ? null : anyPlayer.value;
  return room.hostId;
}

export function removePlayer(room, socketId) {
  const player = room.players.get(socketId);
  if (!player) return null;
  cancelDisconnectTimer(player);
  room.players.delete(socketId);
  room.drawerOrder = room.drawerOrder.filter((id) => id !== socketId);
  room.drawnThisRound.delete(socketId);
  room.guessedBy.delete(socketId);
  room.turnChatActivity.delete(socketId);
  if (room.hostId === socketId) {
    room.hostId = null;
    reassignHost(room);
  }
  touchRoom(room);
  if (room.isPublic) notifyLobby();
  return player;
}

// Переезд игрока на новый socket.id при реконнекте.
// ВАЖНО: id игрока фигурирует сразу в нескольких структурах комнаты, и любая
// забытая — это рассинхрон (пропущенный ход, «призрак» в очереди, потерянный хост).
export function remapPlayerId(room, oldId, newId) {
  const player = room.players.get(oldId);
  if (!player || oldId === newId) return player || null;

  room.players.delete(oldId);
  player.id = newId;
  room.players.set(newId, player);

  room.drawerOrder = room.drawerOrder.map((id) => (id === oldId ? newId : id));
  // Подстраховка от дублей, если newId уже был в очереди.
  room.drawerOrder = room.drawerOrder.filter((id, i) => room.drawerOrder.indexOf(id) === i);

  if (room.drawnThisRound.delete(oldId)) room.drawnThisRound.add(newId);
  if (room.guessedBy.delete(oldId)) room.guessedBy.add(newId);
  if (room.turnChatActivity.delete(oldId)) room.turnChatActivity.add(newId);
  if (room.hostId === oldId) room.hostId = newId;
  if (room.drawerId === oldId) room.drawerId = newId;
  if (room.botId === oldId) room.botId = newId;
  room.drawerIndex = room.drawerOrder.indexOf(room.drawerId);
  touchRoom(room);
  return player;
}

export function findPlayerByUserId(room, userId) {
  if (!userId) return null;
  const key = String(userId).slice(0, 80);
  for (const p of room.players.values()) {
    if (p.userId && p.userId === key) return p;
  }
  return null;
}

let BOT_SEQ = 0;
// Игрок-бот для тестовой комнаты: считается подключённым (стартует игру и
// получает ход), но не имеет реального сокета и не умеет рисовать.
export function addBot(room, nickname = '🤖 Бот') {
  const id = `bot:${room.id}:${BOT_SEQ++}`;
  const bot = {
    id,
    nickname,
    score: 0,
    joinedAt: Date.now(),
    isConnected: true,
    isBot: true,
    userId: null,
    disconnectTimer: null,
    correctStreak: 0,
    afkTurns: 0,
    lastGuessPoints: 0,
    lastReactAt: 0,
  };
  room.players.set(id, bot);
  ensureInDrawerOrder(room, id);
  room.botId = id;
  if (room.isPublic) notifyLobby();
  return bot;
}

export function hasHumanPlayers(room) {
  for (const p of room.players.values()) if (!p.isBot) return true;
  return false;
}

// Единая точка правды о том, должна ли комната быть закрыта.
// Возвращает причину закрытия или null.
export function roomCloseReason(room, now = Date.now()) {
  if (!room || room.destroyed) return null;
  if (room.players.size === 0) return 'empty';
  if (!hasHumanPlayers(room)) return 'no_humans';
  if (!hasConnectedHumans(room)) {
    return now - room.lastActivityAt >= EMPTY_ROOM_TTL_MS ? 'abandoned' : null;
  }
  if (now - room.lastActivityAt >= IDLE_ROOM_TTL_MS) return 'idle';
  return null;
}

// Периодическая уборка: не полагаемся только на grace-таймер дисконнекта —
// он может не сработать (гонка, потерянный disconnect, комната без игроков).
export function sweepRooms(now = Date.now(), onClose = null) {
  const closed = [];
  for (const room of Array.from(rooms.values())) {
    const reason = roomCloseReason(room, now);
    if (!reason) continue;
    if (onClose) {
      try {
        onClose(room, reason);
      } catch (e) {
        console.error('[janitor onClose]', e);
      }
    }
    deleteRoom(room.id);
    closed.push({ id: room.id, reason });
  }
  if (closed.length) flushLobby();
  return closed;
}

let janitorTimer = null;
export function startRoomJanitor(onClose, intervalMs = JANITOR_INTERVAL_MS) {
  stopRoomJanitor();
  janitorTimer = setInterval(() => {
    try {
      const closed = sweepRooms(Date.now(), onClose);
      if (closed.length) {
        console.log('[janitor] closed rooms:', closed.map((c) => `${c.id}:${c.reason}`).join(', '));
      }
    } catch (e) {
      console.error('[janitor]', e);
    }
  }, intervalMs);
  if (typeof janitorTimer.unref === 'function') janitorTimer.unref();
  return stopRoomJanitor;
}

export function stopRoomJanitor() {
  if (janitorTimer) clearInterval(janitorTimer);
  janitorTimer = null;
}

// Только для тестов: полностью очистить реестр комнат.
export function _resetRooms() {
  for (const room of Array.from(rooms.values())) deleteRoom(room.id);
  rooms.clear();
  if (lobbyTimer) {
    clearTimeout(lobbyTimer);
    lobbyTimer = null;
  }
}

export function publicState(room) {
  return {
    id: room.id,
    name: room.name,
    isPublic: room.isPublic,
    hostId: room.hostId,
    state: room.state,
    round: room.round,
    maxRounds: room.maxRounds,
    drawerId: room.drawerId,
    drawerOrder: room.drawerOrder.slice(),
    wordLength: room.currentWord ? room.currentWord.length : 0,
    wordMask: room.wordMask,
    maskedWord: buildMaskedWord(room),
    turnDurationMs: room.turnDurationMs,
    turnStartedAt: room.turnStartedAt,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      isConnected: p.isConnected,
      isBot: Boolean(p.isBot),
      hasGuessed: room.guessedBy.has(p.id),
    })),
    settings: room.settings,
    strokes: room.strokes,
  };
}

export function buildMaskedWord(room) {
  if (!room.currentWord) return '';
  return room.currentWord
    .split('')
    .map((ch, i) => {
      if (ch === ' ' || ch === '-') return ch;
      return room.wordMask[i] ? ch : '_';
    })
    .join('');
}
