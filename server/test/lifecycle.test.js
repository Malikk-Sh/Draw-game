import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_ROOM_TTL_MS,
  IDLE_ROOM_TTL_MS,
  _resetRooms,
  addBot,
  addPlayer,
  createRoom,
  deleteRoom,
  getRoom,
  isRoomAlive,
  listPublicRooms,
  removePlayer,
  roomCloseReason,
  sweepRooms,
} from '../src/rooms.js';
import * as game from '../src/game.js';
import { makeIo, TEST_SETTINGS } from './helpers.js';

function publicRoom(name = 'room') {
  return createRoom({
    name,
    isPublic: true,
    settings: { ...TEST_SETTINGS },
    hostId: null,
    hostNickname: 'host',
  });
}

describe('жизненный цикл комнат и лобби', () => {
  beforeEach(() => _resetRooms());
  afterEach(() => _resetRooms());

  test('в лобби не показываются комнаты без живых людей', () => {
    const room = publicRoom('живая');
    addPlayer(room, 'a', 'a', 'user-a');
    const dead = publicRoom('брошенная');
    addPlayer(dead, 'b', 'b', 'user-b');
    dead.players.get('b').isConnected = false;

    const list = listPublicRooms();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'живая');
  });

  test('счётчик игроков в лобби считает только подключённых', () => {
    const room = publicRoom();
    addPlayer(room, 'a', 'a', 'user-a');
    addPlayer(room, 'b', 'b', 'user-b');
    addPlayer(room, 'c', 'c', 'user-c');
    room.players.get('c').isConnected = false;

    const [entry] = listPublicRooms();
    assert.equal(entry.playersCount, 2);
    assert.equal(entry.state, 'waiting');
  });

  test('комната без игроков закрывается уборщиком немедленно', () => {
    const room = publicRoom();
    addPlayer(room, 'a', 'a', 'user-a');
    removePlayer(room, 'a');
    assert.equal(roomCloseReason(room), 'empty');
    const closed = sweepRooms();
    assert.deepEqual(closed.map((c) => c.reason), ['empty']);
    assert.equal(getRoom(room.id), undefined);
    assert.equal(listPublicRooms().length, 0);
  });

  test('комната только с ботом закрывается уборщиком', () => {
    const room = publicRoom();
    addBot(room);
    assert.equal(roomCloseReason(room), 'no_humans');
    sweepRooms();
    assert.equal(getRoom(room.id), undefined);
  });

  test('отключённым игрокам даётся время на реконнект, потом комната убирается', () => {
    const room = publicRoom();
    addPlayer(room, 'a', 'a', 'user-a');
    room.players.get('a').isConnected = false;
    const t0 = room.lastActivityAt;

    assert.equal(roomCloseReason(room, t0 + EMPTY_ROOM_TTL_MS - 1000), null, 'рано убирать');
    assert.equal(sweepRooms(t0 + EMPTY_ROOM_TTL_MS - 1000).length, 0);
    assert.ok(isRoomAlive(room));

    assert.equal(roomCloseReason(room, t0 + EMPTY_ROOM_TTL_MS + 1), 'abandoned');
    const closed = sweepRooms(t0 + EMPTY_ROOM_TTL_MS + 1);
    assert.deepEqual(closed.map((c) => c.reason), ['abandoned']);
    assert.equal(getRoom(room.id), undefined);
  });

  test('давно неактивная комната закрывается даже с подключёнными игроками', () => {
    const room = publicRoom();
    addPlayer(room, 'a', 'a', 'user-a');
    addPlayer(room, 'b', 'b', 'user-b');
    const t0 = room.lastActivityAt;

    assert.equal(roomCloseReason(room, t0 + IDLE_ROOM_TTL_MS - 1000), null);
    const seen = [];
    const closed = sweepRooms(t0 + IDLE_ROOM_TTL_MS + 1, (r, reason) => seen.push([r.id, reason]));
    assert.deepEqual(closed.map((c) => c.reason), ['idle']);
    assert.deepEqual(seen, [[room.id, 'idle']]);
  });

  test('активность продлевает жизнь комнаты', () => {
    const room = publicRoom();
    addPlayer(room, 'a', 'a', 'user-a');
    room.players.get('a').isConnected = false;
    const t0 = room.lastActivityAt;
    room.lastActivityAt = t0 + EMPTY_ROOM_TTL_MS; // пришло событие
    assert.equal(roomCloseReason(room, t0 + EMPTY_ROOM_TTL_MS + 10), null);
  });

  test('удаление комнаты гасит все таймеры, включая grace-таймеры игроков', () => {
    const io = makeIo();
    const room = publicRoom();
    addPlayer(room, 'a', 'a', 'user-a');
    addPlayer(room, 'b', 'b', 'user-b');
    game.startGame(io, room);
    game.chooseWord(io, room, room.pendingChoices[0]);
    room.players.get('b').disconnectTimer = setTimeout(() => {
      throw new Error('grace-таймер пережил удаление комнаты');
    }, 5);

    assert.ok(room.turnTimer, 'таймер хода запущен');
    deleteRoom(room.id);

    assert.equal(room.turnTimer, null);
    assert.equal(room.choosingTimer, null);
    assert.equal(room.roundEndTimer, null);
    assert.deepEqual(room.hintTimers, []);
    assert.deepEqual(room.botTimers, []);
    assert.equal(room.players.get('b').disconnectTimer, null);
    assert.equal(room.destroyed, true);
    assert.equal(isRoomAlive(room), false);
  });

  test('отложенный ход не оживляет удалённую комнату', () => {
    const io = makeIo();
    const room = publicRoom();
    addPlayer(room, 'a', 'a', 'user-a');
    addPlayer(room, 'b', 'b', 'user-b');
    game.startGame(io, room);
    deleteRoom(room.id);
    const before = io.emitted.length;

    // Ровно то, что делает «зависший» roundEndTimer после удаления комнаты.
    game.nextTurn(io, room);
    game.endTurn(io, room, 'timeout');
    game.endGame(io, room);

    assert.equal(io.emitted.length, before, 'ни одного события в мёртвую комнату');
  });
});
