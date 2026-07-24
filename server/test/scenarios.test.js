import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  _resetRooms,
  addBot,
  createRoom,
  getRoom,
  isRoomAlive,
  listPublicRooms,
} from '../src/rooms.js';
import * as game from '../src/game.js';
import { joinSocketToRoom, _internals } from '../src/socket.js';
import { makeIo, makeSocket, TEST_SETTINGS } from './helpers.js';

const { markDisconnected, leaveCurrentRoom } = _internals;

function setup(ids, { isPublic = true } = {}) {
  const io = makeIo();
  const room = createRoom({
    name: 'сценарий',
    isPublic,
    settings: { ...TEST_SETTINGS },
    hostId: null,
    hostNickname: 'host',
  });
  const sockets = {};
  for (const id of ids) {
    const socket = makeSocket(io, id);
    joinSocketToRoom(io, socket, room, id, `user-${id}`);
    sockets[id] = socket;
  }
  return { io, room, sockets };
}

describe('сценарии выходов, обрывов и гонок', () => {
  beforeEach(() => _resetRooms());
  afterEach(() => _resetRooms());

  test('одновременный выход нескольких игроков не ломает комнату', () => {
    const { io, room, sockets } = setup(['a', 'b', 'c', 'd']);
    game.startGame(io, room);
    game.chooseWord(io, room, room.pendingChoices[0]);

    const leaving = ['b', 'c', 'd'].filter((id) => id !== room.drawerId).slice(0, 2);
    for (const id of leaving) leaveCurrentRoom(io, sockets[id]);

    assert.ok(isRoomAlive(room));
    assert.equal(room.players.size, 2);
    for (const id of leaving) {
      assert.ok(!room.drawerOrder.includes(id), 'вышедший убран из очереди');
      assert.ok(!room.drawnThisRound.has(id));
      assert.ok(!room.guessedBy.has(id));
    }
    assert.ok(room.players.has(room.hostId), 'хост существует');
  });

  test('выход рисующего в момент его хода завершает ход и передаёт очередь', () => {
    const { io, room, sockets } = setup(['a', 'b', 'c']);
    game.startGame(io, room);
    game.chooseWord(io, room, room.pendingChoices[0]);
    const drawerId = room.drawerId;

    leaveCurrentRoom(io, sockets[drawerId]);
    assert.equal(room.state, 'round_end');
    assert.equal(io.last('game:turnEnd').payload.reason, 'drawer_left');

    clearTimeout(room.roundEndTimer);
    game.nextTurn(io, room);
    assert.notEqual(room.drawerId, drawerId);
    assert.ok(room.players.has(room.drawerId), 'новый рисующий реально в комнате');
    assert.equal(room.players.get(room.drawerId).isConnected, true);
  });

  test('обрыв связи хоста передаёт роль живому игроку', () => {
    const { io, room, sockets } = setup(['a', 'b', 'c']);
    room.hostId = 'a';
    markDisconnected(io, sockets.a);

    assert.notEqual(room.hostId, 'a', 'хост сменился');
    assert.ok(['b', 'c'].includes(room.hostId));
    assert.equal(room.players.get('a').isConnected, false);
    assert.ok(room.players.has('a'), 'игрок остался на время grace-периода');
  });

  test('запоздавший disconnect старого сокета не выкидывает переподключившегося', () => {
    const { io, room, sockets } = setup(['a', 'b']);
    const fresh = makeSocket(io, 'a-new');
    joinSocketToRoom(io, fresh, room, 'a', 'user-a');

    // Событие disconnect от старого сокета приходит уже после реконнекта.
    markDisconnected(io, sockets.a);

    const player = room.players.get('a-new');
    assert.ok(player, 'игрок на месте');
    assert.equal(player.isConnected, true, 'остался подключённым');
    assert.equal(player.disconnectTimer, null, 'лишний grace-таймер не заведён');
    assert.equal(room.players.size, 2);
  });

  test('повторный disconnect того же сокета идемпотентен', () => {
    const { io, room, sockets } = setup(['a', 'b']);
    markDisconnected(io, sockets.a);
    const timer = room.players.get('a').disconnectTimer;
    markDisconnected(io, sockets.a);
    assert.equal(room.players.get('a').disconnectTimer, timer, 'второй таймер не создан');
    assert.equal(room.players.size, 2);
  });

  test('выход последнего живого игрока удаляет комнату и убирает её из лобби', () => {
    const { io, room, sockets } = setup(['a', 'b']);
    assert.equal(listPublicRooms().length, 1);

    leaveCurrentRoom(io, sockets.a);
    leaveCurrentRoom(io, sockets.b);

    assert.equal(getRoom(room.id), undefined, 'комната удалена');
    assert.equal(listPublicRooms().length, 0, 'в лобби её больше нет');
  });

  test('тестовая комната с ботом закрывается, когда человек вышел', () => {
    const { io, room, sockets } = setup(['a'], { isPublic: false });
    addBot(room);
    leaveCurrentRoom(io, sockets.a);
    assert.equal(getRoom(room.id), undefined);
  });

  test('игрок входит в середине игры и включается в текущую ротацию', () => {
    const { io, room } = setup(['a', 'b']);
    game.startGame(io, room);
    game.chooseWord(io, room, room.pendingChoices[0]);

    const late = makeSocket(io, 'z');
    joinSocketToRoom(io, late, room, 'z', 'user-z');

    assert.ok(room.drawerOrder.includes('z'), 'новичок в очереди');
    assert.ok(!room.drawnThisRound.has('z'), 'ход ему ещё положен');
    const state = late.last('room:state');
    assert.ok(state, 'новичок сразу получил состояние комнаты');
    assert.equal(state.payload.state, 'drawing');
    assert.equal(state.payload.drawerId, room.drawerId);

    // Догоняем ротацию: 'z' обязан получить ход до конца партии.
    const drawers = [];
    let guard = 0;
    while (room.state !== 'game_end' && guard < 30) {
      guard += 1;
      if (room.state === 'choosing' || room.state === 'drawing') drawers.push(room.drawerId);
      if (room.state === 'choosing') game.chooseWord(io, room, room.pendingChoices[0]);
      if (room.state === 'drawing') game.endTurn(io, room, 'timeout');
      clearTimeout(room.roundEndTimer);
      room.roundEndTimer = null;
      game.nextTurn(io, room);
    }
    assert.ok(drawers.includes('z'), 'новичок получил свой ход');
  });

  test('игра останавливается, когда живых игроков стало меньше двух', () => {
    const { io, room, sockets } = setup(['a', 'b', 'c']);
    game.startGame(io, room);
    game.chooseWord(io, room, room.pendingChoices[0]);

    const others = ['a', 'b', 'c'].filter((id) => id !== room.drawerId);
    leaveCurrentRoom(io, sockets[others[0]]);
    leaveCurrentRoom(io, sockets[others[1]]);

    assert.equal(room.state, 'game_end');
    assert.ok(isRoomAlive(room), 'комната остаётся у последнего игрока');
  });

  test('быстрый цикл вход-выход-вход не оставляет дублей', () => {
    const { io, room, sockets } = setup(['a', 'b']);
    leaveCurrentRoom(io, sockets.a);
    assert.equal(room.players.size, 1);

    const again = makeSocket(io, 'a-2');
    joinSocketToRoom(io, again, room, 'a', 'user-a');
    assert.equal(room.players.size, 2);

    markDisconnected(io, again);
    const back = makeSocket(io, 'a-3');
    joinSocketToRoom(io, back, room, 'a', 'user-a');

    assert.equal(room.players.size, 2, 'дублей игрока нет');
    assert.equal(room.drawerOrder.length, 2, 'дублей в очереди нет');
    assert.equal(room.players.get('a-3').isConnected, true);
  });
});
