import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  _resetRooms,
  addPlayer,
  createRoom,
  removePlayer,
} from '../src/rooms.js';
import * as game from '../src/game.js';
import { makeIo, playGame, playTurnAndAdvance, TEST_SETTINGS } from './helpers.js';

function newRoom(playerIds, settings = TEST_SETTINGS) {
  const room = createRoom({
    name: 'test',
    isPublic: false,
    settings: { ...settings },
    hostId: playerIds[0],
    hostNickname: 'host',
  });
  for (const id of playerIds) addPlayer(room, id, id, `user-${id}`);
  return room;
}

describe('очередь рисующих', () => {
  beforeEach(() => _resetRooms());
  // Комнаты держат живые таймеры хода — без уборки процесс тестов не завершится.
  afterEach(() => _resetRooms());

  test('каждый игрок рисует ровно один раз за раунд, раунды считаются верно', () => {
    const io = makeIo();
    const room = newRoom(['a', 'b', 'c']);
    game.startGame(io, room);

    const turns = playGame(io, room, game);

    assert.equal(room.state, 'game_end');
    assert.equal(turns.length, 6, 'три игрока × два раунда');
    const round1 = turns.filter((t) => t.round === 1).map((t) => t.drawerId);
    const round2 = turns.filter((t) => t.round === 2).map((t) => t.drawerId);
    assert.deepEqual([...round1].sort(), ['a', 'b', 'c']);
    assert.deepEqual([...round2].sort(), ['a', 'b', 'c']);
  });

  test('игрок, вошедший во время игры, попадает в очередь и получает ход', () => {
    const io = makeIo();
    const room = newRoom(['a', 'b', 'c']);
    game.startGame(io, room);

    // Ход №1 отыгран, дальше в комнату входит новый игрок.
    playTurnAndAdvance(io, room, game);
    addPlayer(room, 'd', 'd', 'user-d');
    assert.ok(room.drawerOrder.includes('d'), 'новый игрок встал в очередь');

    const turns = playGame(io, room, game);
    const drewInRound1 = turns.filter((t) => t.round === 1).map((t) => t.drawerId);
    assert.ok(
      drewInRound1.includes('d') || turns.some((t) => t.drawerId === 'd'),
      'новичок получает ход',
    );
    // Никто не рисует дважды за один раунд.
    for (const round of [1, 2]) {
      const ids = turns.filter((t) => t.round === round).map((t) => t.drawerId);
      assert.equal(new Set(ids).size, ids.length, `дубликат хода в раунде ${round}`);
    }
  });

  test('выход игрока до его хода не приводит к пропуску или двойному ходу', () => {
    const io = makeIo();
    const room = newRoom(['a', 'b', 'c', 'd']);
    game.startGame(io, room);
    const first = room.drawerId;

    playTurnAndAdvance(io, room, game);
    // Уходит игрок, который ещё не рисовал (и не является текущим рисующим).
    const victim = room.drawerOrder.find((id) => id !== first && id !== room.drawerId);
    removePlayer(room, victim);

    const turns = playGame(io, room, game);
    // Первый ход отыгран до запуска playGame — добавляем его вручную.
    const round1 = [first, ...turns.filter((t) => t.round === 1).map((t) => t.drawerId)];
    assert.ok(!round1.includes(victim), 'вышедший не получает ход');
    assert.equal(new Set(round1).size, round1.length, 'нет двойных ходов');
    // Оставшиеся трое отрисовали раунд полностью.
    assert.equal(round1.length, 3);
    assert.deepEqual([...round1].sort(), ['a', 'b', 'c', 'd'].filter((id) => id !== victim));
  });

  test('отключение рисующего не даёт ему второй ход в том же раунде', () => {
    const io = makeIo();
    const room = newRoom(['a', 'b', 'c']);
    game.startGame(io, room);
    const drawer = room.drawerId;

    // Рисующий пропал прямо во время выбора слова.
    room.players.get(drawer).isConnected = false;
    game.endTurn(io, room, 'drawer_left');
    clearTimeout(room.roundEndTimer);
    game.nextTurn(io, room);

    assert.notEqual(room.drawerId, drawer, 'ход перешёл другому игроку');
    assert.equal(room.round, 1, 'раунд не перескочил');
    assert.ok(room.drawnThisRound.has(drawer), 'ход отключённого считается использованным');
  });

  test('игра завершается, если подключённых игроков стало меньше двух', () => {
    const io = makeIo();
    const room = newRoom(['a', 'b']);
    game.startGame(io, room);
    room.players.get('b').isConnected = false;

    clearTimeout(room.roundEndTimer);
    game.nextTurn(io, room);
    assert.equal(room.state, 'game_end');
  });

  test('очередь не содержит удалённых игроков (нет «призраков»)', () => {
    const io = makeIo();
    const room = newRoom(['a', 'b', 'c']);
    game.startGame(io, room);
    removePlayer(room, 'c');
    game.syncDrawerOrder(room);
    assert.deepEqual(room.drawerOrder.filter((id) => id === 'c'), []);
    assert.ok(!room.drawnThisRound.has('c'));
  });
});
