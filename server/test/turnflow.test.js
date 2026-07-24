import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  _resetRooms,
  addBot,
  addPlayer,
  createRoom,
} from '../src/rooms.js';
import * as game from '../src/game.js';
import { makeIo, TEST_SETTINGS } from './helpers.js';

function startedRoom(io, ids, { bot = false } = {}) {
  const room = createRoom({
    name: 'test',
    isPublic: false,
    settings: { ...TEST_SETTINGS },
    hostId: ids[0],
    hostNickname: 'host',
  });
  for (const id of ids) addPlayer(room, id, id, `user-${id}`);
  if (bot) addBot(room);
  game.startGame(io, room);
  game.chooseWord(io, room, room.pendingChoices[0]);
  return room;
}

// Делаем указанного игрока рисующим, чтобы сценарии были детерминированными.
function forceDrawer(io, room, drawerId) {
  room.drawerId = drawerId;
  return room;
}

describe('досрочное завершение хода', () => {
  beforeEach(() => _resetRooms());
  afterEach(() => _resetRooms());

  test('ход завершается, когда угадали все подключённые люди (бот не блокирует)', () => {
    const io = makeIo();
    const room = startedRoom(io, ['a', 'b', 'c'], { bot: true });
    forceDrawer(io, room, 'a');
    const word = room.currentWord;

    game.handleGuess(io, room, 'b', word);
    assert.equal(room.state, 'drawing', 'один угадавший ход не завершает');
    game.handleGuess(io, room, 'c', word);
    assert.equal(room.state, 'round_end', 'все люди угадали — ход завершён, бота не ждём');
    assert.equal(io.last('game:turnEnd').payload.reason, 'all_guessed');
  });

  test('отключённый игрок не мешает досрочному завершению', () => {
    const io = makeIo();
    const room = startedRoom(io, ['a', 'b', 'c']);
    forceDrawer(io, room, 'a');
    room.players.get('c').isConnected = false;

    game.handleGuess(io, room, 'b', room.currentWord);
    assert.equal(room.state, 'round_end');
  });

  test('ход завершается, если угадывать стало некому', () => {
    const io = makeIo();
    const room = startedRoom(io, ['a', 'b']);
    forceDrawer(io, room, 'a');
    room.players.get('b').isConnected = false;

    assert.equal(game.maybeEndTurnEarly(io, room), true);
    assert.equal(room.state, 'round_end');
    assert.equal(io.last('game:turnEnd').payload.reason, 'no_guessers');
  });

  test('повторный endTurn не запускает второй цикл ходов', () => {
    const io = makeIo();
    const room = startedRoom(io, ['a', 'b', 'c']);
    game.endTurn(io, room, 'timeout');
    const timer = room.roundEndTimer;
    const turnEnds = io.events('game:turnEnd').length;

    game.endTurn(io, room, 'drawer_left');
    assert.equal(io.events('game:turnEnd').length, turnEnds, 'второй turnEnd не отправлен');
    assert.equal(room.roundEndTimer, timer, 'второй переход к следующему ходу не запланирован');
  });

  test('endTurn после конца игры не воскрешает партию', () => {
    const io = makeIo();
    const room = startedRoom(io, ['a', 'b']);
    game.endGame(io, room);
    assert.equal(room.state, 'game_end');

    game.endTurn(io, room, 'timeout');
    assert.equal(room.state, 'game_end');
    assert.equal(room.roundEndTimer, null, 'следующий ход не запланирован');
  });

  test('очки за ход начисляются один раз', () => {
    const io = makeIo();
    const room = startedRoom(io, ['a', 'b']);
    forceDrawer(io, room, 'a');
    game.handleGuess(io, room, 'b', room.currentWord);
    const scoreAfterTurn = room.players.get('b').score;
    assert.ok(scoreAfterTurn > 0);

    game.endTurn(io, room, 'timeout');
    assert.equal(room.players.get('b').score, scoreAfterTurn, 'повторного начисления нет');
  });

  test('повторное угадывание тем же игроком игнорируется', () => {
    const io = makeIo();
    const room = startedRoom(io, ['a', 'b', 'c']);
    forceDrawer(io, room, 'a');
    const word = room.currentWord;
    game.handleGuess(io, room, 'b', word);
    const score = room.players.get('b').score;
    const res = game.handleGuess(io, room, 'b', word);
    assert.equal(res.kind, 'idle');
    assert.equal(room.players.get('b').score, score);
  });

  test('после игры resetToLobby очищает состояние хода и очередь', () => {
    const io = makeIo();
    const room = startedRoom(io, ['a', 'b']);
    game.endGame(io, room);
    game.resetToLobby(room);

    assert.equal(room.state, 'waiting');
    assert.equal(room.round, 0);
    assert.equal(room.drawerId, null);
    assert.equal(room.currentWord, null);
    assert.equal(room.pendingChoices, null);
    assert.equal(room.drawnThisRound.size, 0);
    assert.equal(room.guessedBy.size, 0);
    assert.deepEqual(room.strokes, []);
    assert.deepEqual([...room.drawerOrder].sort(), ['a', 'b']);
    for (const p of room.players.values()) assert.equal(p.score, 0);
  });
});
