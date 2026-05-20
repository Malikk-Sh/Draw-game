import { customAlphabet } from 'nanoid';

const ROOM_CODE = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);
const PUBLIC_ID = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const rooms = new Map();

let lobbyNotifier = null;
export function setLobbyNotifier(fn) {
  lobbyNotifier = fn;
}
export function notifyLobby() {
  if (lobbyNotifier) lobbyNotifier();
}

export function getRoom(id) {
  return rooms.get(id);
}

export function listPublicRooms() {
  const result = [];
  for (const room of rooms.values()) {
    if (!room.isPublic) continue;
    result.push({
      id: room.id,
      name: room.name,
      playersCount: room.players.size,
      maxPlayers: room.settings.maxPlayers,
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
    drawerOrder: [],
    drawerIndex: -1,
    drawerId: null,
    currentWord: null,
    wordMask: [],
    hintsRevealed: 0,
    turnDurationMs: settings.turnSec * 1000,
    turnStartedAt: 0,
    turnTimer: null,
    hintTimers: [],
    choosingTimer: null,
    roundEndTimer: null,
    guessedBy: new Set(),
    strokes: [],
    redoStack: [],
    recentWords: [],
    settings,
  };
  rooms.set(id, room);
  if (room.isPublic) notifyLobby();
  return room;
}

export function deleteRoom(id) {
  const room = rooms.get(id);
  if (!room) return;
  clearAllTimers(room);
  rooms.delete(id);
  if (room.isPublic) notifyLobby();
}

export function clearAllTimers(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (room.choosingTimer) clearTimeout(room.choosingTimer);
  if (room.roundEndTimer) clearTimeout(room.roundEndTimer);
  room.hintTimers.forEach((t) => clearTimeout(t));
  room.turnTimer = null;
  room.choosingTimer = null;
  room.roundEndTimer = null;
  room.hintTimers = [];
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
  };
  room.players.set(socketId, player);
  if (!room.hostId || !room.players.has(room.hostId)) {
    room.hostId = socketId;
  }
  if (room.isPublic) notifyLobby();
  return player;
}

export function removePlayer(room, socketId) {
  const player = room.players.get(socketId);
  if (!player) return null;
  room.players.delete(socketId);
  if (room.hostId === socketId) {
    const next = room.players.keys().next();
    room.hostId = next.done ? null : next.value;
  }
  if (room.isPublic) notifyLobby();
  return player;
}

export function findPlayerByUserId(room, userId) {
  if (!userId) return null;
  for (const p of room.players.values()) {
    if (p.userId === userId) return p;
  }
  return null;
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
