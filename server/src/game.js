import {
  buildMaskedWord,
  clearAllTimers,
  clearTurnTimers,
  connectedCount,
  ensureInDrawerOrder,
  isRoomAlive,
  notifyLobby,
  publicState,
  touchRoom,
} from './rooms.js';
import { normalize, randomWords, levenshtein } from './words.js';

export const CHOOSING_MS = 20000;
const ROUND_END_MS = 5000;
const POINTS_FIRST_BONUS = 20;
const POINTS_LIGHTNING_BONUS = 25;
const STREAK_3_BONUS = 25;
const STREAK_5_BONUS = 50;
const DRAWER_BASE_IF_GUESSED = 40;
const DRAWER_SHARE = 0.25;
const DRAWER_CAP_MULT = 1.3;
const DRAWER_IDEAL_BONUS = 30;
const DRAWER_AFK_PENALTY = 30;
const GUESSER_AFK_PENALTY = 10;
const BOT_CHOOSE_DELAY_MS = 900;
const BOT_GUESS_DELAY_MS = 15000;

const ACTIVE_STATES = new Set(['choosing', 'drawing']);

export function canStart(room) {
  return room.state === 'waiting' && connectedCount(room) >= 2;
}

// Очередь рисующих динамическая: синхронизируем её с фактическим составом
// комнаты — выбывшие уходят, новые встают в конец.
export function syncDrawerOrder(room) {
  const seen = new Set();
  room.drawerOrder = room.drawerOrder.filter((id) => {
    if (seen.has(id) || !room.players.has(id)) return false;
    seen.add(id);
    return true;
  });
  for (const id of room.players.keys()) ensureInDrawerOrder(room, id);
  for (const id of Array.from(room.drawnThisRound)) {
    if (!room.players.has(id)) room.drawnThisRound.delete(id);
  }
}

// Кандидаты на ход: подключённые игроки из очереди, ещё не рисовавшие в раунде.
export function eligibleDrawers(room) {
  return room.drawerOrder.filter((id) => {
    const p = room.players.get(id);
    return p && p.isConnected && !room.drawnThisRound.has(id);
  });
}

export function startGame(io, room) {
  if (!isRoomAlive(room) || !canStart(room)) return;
  clearAllTimers(room);
  for (const p of room.players.values()) {
    p.score = 0;
    p.correctStreak = 0;
    p.afkTurns = 0;
    p.lastGuessPoints = 0;
  }
  room.round = 1;
  room.drawerOrder = Array.from(room.players.values())
    .filter((p) => p.isConnected)
    .map((p) => p.id);
  shuffle(room.drawerOrder);
  syncDrawerOrder(room);
  room.drawnThisRound = new Set();
  room.drawerIndex = -1;
  room.drawerId = null;
  room.recentWords = [];
  touchRoom(room);
  io.to(room.id).emit('chat:system', { text: 'Игра началась!' });
  nextTurn(io, room);
}

export function nextTurn(io, room) {
  // Отложенный таймер мог сработать уже после удаления комнаты.
  if (!isRoomAlive(room)) return;
  clearAllTimers(room);
  room.guessedBy = new Set();
  room.strokes = [];
  room.redoStack = [];
  room.currentWord = null;
  room.pendingChoices = null;
  room.wordMask = [];
  room.hintsRevealed = 0;
  room.turnChatActivity = new Set();

  syncDrawerOrder(room);

  // Игра имеет смысл только при двух и более подключённых игроках.
  if (connectedCount(room) < 2) {
    endGame(io, room);
    return;
  }

  let candidates = eligibleDrawers(room);
  if (candidates.length === 0) {
    // Все живые уже рисовали в этом раунде — переходим к следующему.
    room.round += 1;
    room.drawnThisRound = new Set();
    if (room.round > room.maxRounds) {
      endGame(io, room);
      return;
    }
    candidates = eligibleDrawers(room);
  }
  if (candidates.length === 0) {
    endGame(io, room);
    return;
  }

  room.drawerId = candidates[0];
  room.drawnThisRound.add(room.drawerId);
  room.drawerIndex = room.drawerOrder.indexOf(room.drawerId);
  room.state = 'choosing';
  room.choosingStartedAt = Date.now();
  touchRoom(room);

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
    if (!isRoomAlive(room) || room.state !== 'choosing') return;
    endTurn(io, room, 'no_word_chosen');
  }, CHOOSING_MS);

  // Бот не умеет выбирать слово вручную — выбираем за него автоматически.
  if (drawer && drawer.isBot) {
    const botId = drawer.id;
    const t = setTimeout(() => {
      if (!isRoomAlive(room)) return;
      if (room.state === 'choosing' && room.drawerId === botId && room.pendingChoices) {
        chooseWord(io, room, room.pendingChoices[0]);
      }
    }, BOT_CHOOSE_DELAY_MS);
    room.botTimers.push(t);
  }
}

export function chooseWord(io, room, word) {
  if (!isRoomAlive(room) || room.state !== 'choosing') return;
  const allowed = room.pendingChoices && room.pendingChoices.includes(word);
  if (!allowed) return;
  clearTimeout(room.choosingTimer);
  room.choosingTimer = null;
  room.pendingChoices = null;
  room.currentWord = word;
  room.wordMask = word.split('').map((ch) => ch === ' ' || ch === '-');
  room.hintsRevealed = 0;
  room.turnChatActivity = new Set();
  room.state = 'drawing';
  room.turnStartedAt = Date.now();
  room.recentWords.push(word);
  if (room.recentWords.length > 30) room.recentWords.shift();
  touchRoom(room);

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

  scheduleBotForTurn(io, room);
}

// Автоматика бота на текущий ход:
// - если рисует бот → раскрываем слово в чат по одной букве (бот не рисует);
// - если рисует человек → бот сам угадывает слово через BOT_GUESS_DELAY_MS,
//   чтобы ход завершился.
function scheduleBotForTurn(io, room) {
  const drawer = room.players.get(room.drawerId);
  if (drawer && drawer.isBot) {
    botRevealWord(io, room);
    return;
  }
  for (const p of room.players.values()) {
    if (p.isBot && p.id !== room.drawerId) scheduleBotGuess(io, room, p.id);
  }
}

function scheduleBotGuess(io, room, botId) {
  const word = room.currentWord;
  const delay = Math.min(BOT_GUESS_DELAY_MS, Math.max(3000, room.turnDurationMs - 4000));
  const t = setTimeout(() => {
    if (!isRoomAlive(room)) return;
    if (room.state === 'drawing' && room.currentWord === word && !room.guessedBy.has(botId)) {
      handleGuess(io, room, botId, word);
    }
  }, delay);
  room.botTimers.push(t);
}

function botRevealWord(io, room) {
  const word = room.currentWord;
  if (!word) return;
  io.to(room.id).emit('chat:system', {
    text: '🤖 Я бот и не умею рисовать — даю слово по буквам, впиши его в чат:',
  });
  const letters = [...word];
  const total = letters.length;
  // Раскрываем по одной букве за ~первую половину хода.
  const step = Math.min(4000, Math.max(1500, Math.floor((room.turnDurationMs * 0.5) / total)));
  for (let i = 1; i <= total; i++) {
    const t = setTimeout(() => {
      if (!isRoomAlive(room)) return;
      if (room.state !== 'drawing' || room.currentWord !== word) return;
      const shown = letters.map((ch, idx) => (idx < i ? ch : '_')).join(' ');
      io.to(room.id).emit('chat:system', { text: `🤖 ${shown}` });
    }, step * i);
    room.botTimers.push(t);
  }
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
  if (!isRoomAlive(room)) return;
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

// Кто обязан угадать, чтобы ход завершился досрочно: только подключённые люди
// (боты угадывают по своему таймеру, отключённые не угадают никогда).
export function requiredGuessers(room) {
  return Array.from(room.players.values()).filter(
    (p) => p.id !== room.drawerId && p.isConnected && !p.isBot,
  );
}

export function maybeEndTurnEarly(io, room) {
  if (!isRoomAlive(room) || room.state !== 'drawing') return false;
  const required = requiredGuessers(room);
  if (required.length === 0) {
    // Живых угадывающих не осталось (все вышли/отключились, либо в комнате
    // только бот) — держать ход до таймаута бессмысленно.
    endTurn(io, room, room.guessedBy.size > 0 ? 'all_guessed' : 'no_guessers');
    return true;
  }
  if (required.every((p) => room.guessedBy.has(p.id))) {
    endTurn(io, room, 'all_guessed');
    return true;
  }
  return false;
}

export function handleGuess(io, room, socketId, text) {
  if (!isRoomAlive(room) || room.state !== 'drawing') return { kind: 'idle' };
  if (socketId === room.drawerId) return { kind: 'idle' };
  if (room.guessedBy.has(socketId)) return { kind: 'idle' };

  const guessNorm = normalize(text);
  const wordNorm = normalize(room.currentWord);
  if (!guessNorm) return { kind: 'idle' };

  if (guessNorm === wordNorm) {
    const guesser = room.players.get(socketId);
    if (!guesser) return { kind: 'idle' };
    room.guessedBy.add(socketId);

    const elapsedMs = Math.max(0, Date.now() - room.turnStartedAt);
    const totalMs = Math.max(1, room.turnDurationMs);
    const remainMs = Math.max(0, totalMs - elapsedMs);
    const basePoints = basePointsForTurn(totalMs);
    const timeCoef = 0.4 + (0.6 * remainMs) / totalMs;
    let gained = Math.round(basePoints * timeCoef);
    if (room.guessedBy.size === 1) gained += POINTS_FIRST_BONUS;
    if (elapsedMs <= totalMs * 0.15) gained += POINTS_LIGHTNING_BONUS;

    guesser.correctStreak = (guesser.correctStreak || 0) + 1;
    if (guesser.correctStreak === 3) gained += STREAK_3_BONUS;
    if (guesser.correctStreak === 5) gained += STREAK_5_BONUS;
    guesser.lastGuessPoints = gained;
    guesser.score += gained;
    touchRoom(room);

    io.to(room.id).emit('chat:system', {
      text: `${guesser.nickname} угадал слово! (+${gained})`,
      kind: 'guess',
    });
    io.to(room.id).emit('game:correctGuess', {
      playerId: socketId,
      gainedPoints: gained,
      drawerBonus: 0,
      scores: scoresMap(room),
    });

    maybeEndTurnEarly(io, room);
    return { kind: 'correct' };
  }

  if (levenshtein(guessNorm, wordNorm) === 1 && guessNorm.length >= wordNorm.length - 1) {
    io.to(socketId).emit('chat:close', { text: `«${text}» — очень близко!` });
    return { kind: 'close' };
  }

  return { kind: 'wrong' };
}

export function endTurn(io, room, reason) {
  if (!isRoomAlive(room)) return;
  // Ход можно завершить только из активных состояний: иначе двойной вызов
  // (например, дисконнект рисующего + истёкший таймер) перезапускал ротацию
  // и мог «воскресить» уже завершённую игру.
  if (!ACTIVE_STATES.has(room.state)) {
    // Гасим только остатки таймеров хода: roundEndTimer уже ведёт партию
    // дальше, и его отмена «подвесила» бы комнату навсегда.
    clearTurnTimers(room);
    return;
  }
  const wasDrawing = room.state === 'drawing';
  clearAllTimers(room);
  const gains = wasDrawing ? applyTurnEconomy(room, reason) : {};
  const word = room.currentWord;
  const drawerId = room.drawerId;
  room.state = 'round_end';
  room.pendingChoices = null;
  touchRoom(room);
  // Итоги хода: кто сколько набрал именно за этот ход (для модалки-recap).
  const summary = Array.from(room.players.values())
    .map((p) => ({
      id: p.id,
      nickname: p.nickname,
      isBot: Boolean(p.isBot),
      gained: gains[p.id] || 0,
      guessed: room.guessedBy.has(p.id),
      isDrawer: p.id === drawerId,
    }))
    .sort((a, b) => b.gained - a.gained);
  io.to(room.id).emit('game:turnEnd', {
    word,
    reason,
    drawerId,
    summary,
    scores: scoresMap(room),
  });
  io.to(room.id).emit('chat:system', {
    text: word ? `Слово было: ${word}` : 'Ход завершён.',
  });
  if (room.isPublic) notifyLobby();
  room.roundEndTimer = setTimeout(() => nextTurn(io, room), ROUND_END_MS);
}

export function endGame(io, room) {
  if (!isRoomAlive(room)) return;
  clearAllTimers(room);
  room.state = 'game_end';
  room.drawerId = null;
  room.currentWord = null;
  room.pendingChoices = null;
  room.drawnThisRound = new Set();
  touchRoom(room);
  const ranking = Array.from(room.players.values())
    .map((p) => ({ id: p.id, nickname: p.nickname, score: p.score }))
    .sort((a, b) => b.score - a.score);
  io.to(room.id).emit('game:end', { ranking });
  io.to(room.id).emit('chat:system', {
    text: ranking[0] ? `Победитель: ${ranking[0].nickname}!` : 'Игра окончена.',
  });
  io.to(room.id).emit('room:state', publicState(room));
  if (room.isPublic) notifyLobby();
}

export function resetToLobby(room) {
  clearAllTimers(room);
  room.state = 'waiting';
  room.round = 0;
  room.drawerId = null;
  room.drawerIndex = -1;
  room.currentWord = null;
  room.pendingChoices = null;
  room.wordMask = [];
  room.hintsRevealed = 0;
  room.strokes = [];
  room.redoStack = [];
  room.guessedBy = new Set();
  room.turnChatActivity = new Set();
  room.drawnThisRound = new Set();
  syncDrawerOrder(room);
  for (const p of room.players.values()) {
    p.score = 0;
    p.correctStreak = 0;
    p.afkTurns = 0;
    p.lastGuessPoints = 0;
  }
  touchRoom(room);
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


function applyTurnEconomy(room, reason) {
  const gains = {};
  const add = (id, n) => { gains[id] = (gains[id] || 0) + n; };
  const drawer = room.players.get(room.drawerId);
  const guessers = Array.from(room.guessedBy).map((id) => room.players.get(id)).filter(Boolean);

  if (drawer) {
    if (guessers.length > 0) {
      const bestGuesser = Math.max(...guessers.map((p) => p.lastGuessPoints || 0));
      const share = guessers.reduce((acc, p) => acc + Math.round((p.lastGuessPoints || 0) * DRAWER_SHARE), 0);
      let drawerGain = DRAWER_BASE_IF_GUESSED + share;
      drawerGain = Math.min(drawerGain, Math.round(bestGuesser * DRAWER_CAP_MULT));
      // Знаменатель — только те, кто реально мог угадать (подключённые),
      // иначе «идеальный ход» не засчитывался из-за отключённых игроков.
      const totalGuessers = Math.max(
        1,
        Array.from(room.players.values()).filter((p) => p.isConnected && p.id !== room.drawerId).length,
      );
      if (guessers.length / totalGuessers >= 0.7) drawerGain += DRAWER_IDEAL_BONUS;
      drawer.score += drawerGain;
      add(drawer.id, drawerGain);
    } else if (reason === 'timeout' && room.strokes.length === 0) {
      drawer.score -= DRAWER_AFK_PENALTY;
      add(drawer.id, -DRAWER_AFK_PENALTY);
    }
  }

  for (const p of room.players.values()) {
    if (p.id === room.drawerId) continue;
    const guessed = room.guessedBy.has(p.id);
    if (guessed) add(p.id, p.lastGuessPoints || 0);
    if (!guessed) p.correctStreak = 0;
    p.lastGuessPoints = 0;
    // AFK-статистику ведём только для живых людей: боты и отключённые
    // не должны копить штрафы.
    if (p.isBot || !p.isConnected) continue;
    const wasActive = room.turnChatActivity && room.turnChatActivity.has(p.id);
    if (!wasActive) p.afkTurns = (p.afkTurns || 0) + 1;
    else p.afkTurns = 0;
    if (!guessed && !wasActive && p.afkTurns >= 2) {
      p.score -= GUESSER_AFK_PENALTY;
      add(p.id, -GUESSER_AFK_PENALTY);
    }
  }

  return gains;
}

function basePointsForTurn(totalMs) {
  const sec = Math.round(totalMs / 1000);
  return sec + 60;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
