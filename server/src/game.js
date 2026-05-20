import {
  buildMaskedWord,
  clearAllTimers,
  notifyLobby,
  publicState,
} from './rooms.js';
import { normalize, randomWords, levenshtein } from './words.js';

const CHOOSING_MS = 20000;
const ROUND_END_MS = 5000;
const POINTS_BASE = 100;
const POINTS_PER_SECOND_LEFT = 2;
const POINTS_FIRST_BONUS = 50;
const POINTS_DRAWER_PER_GUESS = 50;

export function canStart(room) {
  return room.state === 'waiting' && room.players.size >= 2;
}

export function startGame(io, room) {
  if (!canStart(room)) return;
  for (const p of room.players.values()) p.score = 0;
  room.round = 0;
  room.drawerOrder = Array.from(room.players.keys());
  shuffle(room.drawerOrder);
  room.drawerIndex = -1;
  room.recentWords = [];
  io.to(room.id).emit('chat:system', { text: 'Игра началась!' });
  nextTurn(io, room);
}

export function nextTurn(io, room) {
  clearAllTimers(room);
  room.guessedBy = new Set();
  room.strokes = [];
  room.redoStack = [];
  room.currentWord = null;
  room.wordMask = [];
  room.hintsRevealed = 0;

  const order = room.drawerOrder.filter((id) => room.players.has(id));
  if (order.length < 2) {
    endGame(io, room);
    return;
  }
  room.drawerOrder = order;
  room.drawerIndex += 1;
  if (room.drawerIndex >= order.length) {
    room.drawerIndex = 0;
    room.round += 1;
  } else if (room.round === 0) {
    room.round = 1;
  }
  if (room.round > room.maxRounds) {
    endGame(io, room);
    return;
  }

  room.drawerId = order[room.drawerIndex];
  room.state = 'choosing';

  const choices = randomWords(3, room.recentWords);
  room.pendingChoices = choices;

  io.to(room.id).emit('room:stateUpdate', { state: room.state, drawerId: room.drawerId, round: room.round });
  io.to(room.drawerId).emit('game:wordChoices', { words: choices, timeMs: CHOOSING_MS });
  if (room.isPublic) notifyLobby();

  const drawer = room.players.get(room.drawerId);
  io.to(room.id).emit('chat:system', {
    text: drawer ? `${drawer.nickname} выбирает слово...` : 'Выбор слова...',
  });

  room.choosingTimer = setTimeout(() => {
    if (room.state !== 'choosing') return;
    endTurn(io, room, 'no_word_chosen');
  }, CHOOSING_MS);
}

export function chooseWord(io, room, word) {
  if (room.state !== 'choosing') return;
  const allowed = room.pendingChoices && room.pendingChoices.includes(word);
  if (!allowed) return;
  clearTimeout(room.choosingTimer);
  room.choosingTimer = null;
  room.pendingChoices = null;
  room.currentWord = word;
  room.wordMask = word.split('').map((ch) => ch === ' ' || ch === '-');
  room.hintsRevealed = 0;
  room.state = 'drawing';
  room.turnStartedAt = Date.now();
  room.recentWords.push(word);
  if (room.recentWords.length > 30) room.recentWords.shift();

  io.to(room.id).emit('game:turnStart', {
    drawerId: room.drawerId,
    wordLength: word.length,
    maskedWord: buildMaskedWord(room),
    turnDurationMs: room.turnDurationMs,
    turnStartedAt: room.turnStartedAt,
    round: room.round,
    maxRounds: room.maxRounds,
  });
  io.to(room.drawerId).emit('game:wordToDraw', { word });

  scheduleHints(io, room);
  room.turnTimer = setTimeout(() => endTurn(io, room, 'timeout'), room.turnDurationMs);
}

function scheduleHints(io, room) {
  if (!room.settings.hintsEnabled) return;
  const lettersCount = room.currentWord.split('').filter((ch) => ch !== ' ' && ch !== '-').length;
  const targetReveal = Math.max(1, Math.floor((lettersCount * 2) / 3));
  const hintsCount = Math.min(targetReveal, room.currentWord.length - 1);
  if (hintsCount <= 0) return;
  for (let i = 1; i <= hintsCount; i++) {
    const at = Math.floor((room.turnDurationMs * i) / (hintsCount + 1));
    const timer = setTimeout(() => revealHint(io, room), at);
    room.hintTimers.push(timer);
  }
}

function revealHint(io, room) {
  if (room.state !== 'drawing' || !room.currentWord) return;
  const candidates = [];
  for (let i = 0; i < room.currentWord.length; i++) {
    const ch = room.currentWord[i];
    if (ch === ' ' || ch === '-') continue;
    if (!room.wordMask[i]) candidates.push(i);
  }
  if (candidates.length <= 1) return;
  const idx = candidates[Math.floor(Math.random() * candidates.length)];
  room.wordMask[idx] = true;
  room.hintsRevealed += 1;
  const masked = buildMaskedWord(room);
  for (const [pid] of room.players) {
    if (pid === room.drawerId) continue;
    io.to(pid).emit('game:hint', { index: idx, letter: room.currentWord[idx], maskedWord: masked });
  }
}

export function handleGuess(io, room, socketId, text) {
  if (room.state !== 'drawing') return { kind: 'idle' };
  if (socketId === room.drawerId) return { kind: 'idle' };
  if (room.guessedBy.has(socketId)) return { kind: 'idle' };

  const guessNorm = normalize(text);
  const wordNorm = normalize(room.currentWord);
  if (!guessNorm) return { kind: 'idle' };

  if (guessNorm === wordNorm) {
    room.guessedBy.add(socketId);
    const guesser = room.players.get(socketId);
    if (!guesser) return { kind: 'idle' };

    const elapsedSec = Math.floor((Date.now() - room.turnStartedAt) / 1000);
    const totalSec = Math.floor(room.turnDurationMs / 1000);
    const remainSec = Math.max(0, totalSec - elapsedSec);
    let gained = POINTS_BASE + remainSec * POINTS_PER_SECOND_LEFT;
    if (room.guessedBy.size === 1) gained += POINTS_FIRST_BONUS;
    guesser.score += gained;

    const drawer = room.players.get(room.drawerId);
    if (drawer) drawer.score += POINTS_DRAWER_PER_GUESS;

    io.to(room.id).emit('chat:system', {
      text: `${guesser.nickname} угадал слово! (+${gained})`,
      kind: 'guess',
    });
    io.to(room.id).emit('game:correctGuess', {
      playerId: socketId,
      gainedPoints: gained,
      drawerBonus: POINTS_DRAWER_PER_GUESS,
      scores: scoresMap(room),
    });

    const guessersTotal = room.players.size - 1;
    if (room.guessedBy.size >= guessersTotal) {
      endTurn(io, room, 'all_guessed');
    }
    return { kind: 'correct' };
  }

  if (levenshtein(guessNorm, wordNorm) === 1 && guessNorm.length >= wordNorm.length - 1) {
    io.to(socketId).emit('chat:close', { text: `«${text}» — очень близко!` });
    return { kind: 'close' };
  }

  return { kind: 'wrong' };
}

export function endTurn(io, room, reason) {
  clearAllTimers(room);
  if (room.state === 'round_end' || room.state === 'waiting') return;
  const word = room.currentWord;
  room.state = 'round_end';
  io.to(room.id).emit('game:turnEnd', {
    word,
    reason,
    scores: scoresMap(room),
  });
  io.to(room.id).emit('chat:system', {
    text: word ? `Слово было: ${word}` : 'Ход завершён.',
  });
  room.roundEndTimer = setTimeout(() => nextTurn(io, room), ROUND_END_MS);
}

export function endGame(io, room) {
  clearAllTimers(room);
  room.state = 'game_end';
  room.drawerId = null;
  room.currentWord = null;
  const ranking = Array.from(room.players.values())
    .map((p) => ({ id: p.id, nickname: p.nickname, score: p.score }))
    .sort((a, b) => b.score - a.score);
  io.to(room.id).emit('game:end', { ranking });
  io.to(room.id).emit('chat:system', {
    text: ranking[0] ? `Победитель: ${ranking[0].nickname}!` : 'Игра окончена.',
  });
  if (room.isPublic) notifyLobby();
}

export function resetToLobby(room) {
  clearAllTimers(room);
  room.state = 'waiting';
  room.round = 0;
  room.drawerId = null;
  room.currentWord = null;
  room.wordMask = [];
  room.strokes = [];
  room.redoStack = [];
  room.guessedBy = new Set();
  room.drawerIndex = -1;
  for (const p of room.players.values()) p.score = 0;
  if (room.isPublic) notifyLobby();
}

export function snapshot(room) {
  return publicState(room);
}

function scoresMap(room) {
  const out = {};
  for (const p of room.players.values()) out[p.id] = p.score;
  return out;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
