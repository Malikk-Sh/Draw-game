import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { _resetRooms, createRoom, publicState } from '../src/rooms.js';
import * as game from '../src/game.js';
import { joinSocketToRoom } from '../src/socket.js';
import { makeIo, makeSocket, TEST_SETTINGS } from './helpers.js';

function setupRoom(io, ids) {
  const room = createRoom({
    name: 'test',
    isPublic: false,
    settings: { ...TEST_SETTINGS },
    hostId: null,
    hostNickname: 'host',
  });
  const sockets = ids.map((id) => {
    const socket = makeSocket(io, id);
    joinSocketToRoom(io, socket, room, id, `user-${id}`);
    return socket;
  });
  return { room, sockets };
}

describe('реконнект и синхронизация состояния', () => {
  beforeEach(() => _resetRooms());
  afterEach(() => _resetRooms());

  test('все ссылки на игрока переезжают на новый socket.id', () => {
    const io = makeIo();
    const { room } = setupRoom(io, ['a', 'b', 'c']);
    game.startGame(io, room);
    game.chooseWord(io, room, room.pendingChoices[0]);

    // Готовим «богатое» состояние: очки, отметка угадавшего, активность в чате.
    const target = room.drawerOrder.find((id) => id !== room.drawerId);
    room.players.get(target).score = 137;
    room.guessedBy.add(target);
    room.turnChatActivity.add(target);
    room.hostId = target;
    const orderIndex = room.drawerOrder.indexOf(target);
    const drewAlready = room.drawnThisRound.has(target);

    const fresh = makeSocket(io, 'a2');
    joinSocketToRoom(io, fresh, room, 'newnick', `user-${target}`);

    assert.ok(!room.players.has(target), 'старый id исчез из списка игроков');
    const player = room.players.get('a2');
    assert.ok(player, 'игрок доступен по новому id');
    assert.equal(player.score, 137, 'очки сохранены');
    assert.equal(player.isConnected, true);
    assert.equal(room.hostId, 'a2', 'хост переехал');
    assert.equal(room.drawerOrder.indexOf('a2'), orderIndex, 'место в очереди сохранено');
    assert.equal(room.drawerOrder.filter((id) => id === 'a2').length, 1, 'нет дублей в очереди');
    assert.ok(!room.drawerOrder.includes(target), 'старого id нет в очереди');
    assert.equal(room.drawnThisRound.has('a2'), drewAlready, 'отметка «уже рисовал» сохранена');
    assert.ok(room.guessedBy.has('a2'), 'отметка угадавшего сохранена');
    assert.ok(!room.guessedBy.has(target));
    assert.ok(room.turnChatActivity.has('a2'), 'активность хода сохранена');
    assert.ok(!room.turnChatActivity.has(target));
  });

  test('рисующий возвращается на свой ход и получает слово обратно', () => {
    const io = makeIo();
    const { room } = setupRoom(io, ['a', 'b']);
    game.startGame(io, room);
    game.chooseWord(io, room, room.pendingChoices[0]);
    const drawerId = room.drawerId;
    const word = room.currentWord;

    const fresh = makeSocket(io, `${drawerId}-new`);
    joinSocketToRoom(io, fresh, room, drawerId, `user-${drawerId}`);

    assert.equal(room.drawerId, `${drawerId}-new`, 'рисующий переехал на новый сокет');
    const state = fresh.last('room:state');
    assert.ok(state, 'вернувшемуся выслано room:state');
    assert.equal(state.payload.drawerId, `${drawerId}-new`);
    assert.equal(state.payload.state, 'drawing');
    const wordEvent = fresh.last('game:wordToDraw');
    assert.ok(wordEvent, 'слово возвращено рисующему');
    assert.equal(wordEvent.payload.word, word);
  });

  test('вернувшийся во время выбора слова получает список слов с остатком времени', () => {
    const io = makeIo();
    const { room } = setupRoom(io, ['a', 'b']);
    game.startGame(io, room);
    const drawerId = room.drawerId;
    const choices = room.pendingChoices;

    const fresh = makeSocket(io, `${drawerId}-new`);
    joinSocketToRoom(io, fresh, room, drawerId, `user-${drawerId}`);

    const evt = fresh.last('game:wordChoices');
    assert.ok(evt);
    assert.deepEqual(evt.payload.words, choices);
    assert.ok(evt.payload.timeMs > 0 && evt.payload.timeMs <= game.CHOOSING_MS);
  });

  test('старый сокет отцепляется от комнаты при перезаходе с тем же userId', () => {
    const io = makeIo();
    const { room, sockets } = setupRoom(io, ['a', 'b']);
    const old = sockets[0];
    assert.ok(old.rooms.has(room.id));

    const fresh = makeSocket(io, 'a-new');
    joinSocketToRoom(io, fresh, room, 'a', 'user-a');

    assert.ok(!old.rooms.has(room.id), 'старый сокет покинул комнату');
    assert.equal(old.data.roomId, null);
    assert.ok(fresh.rooms.has(room.id));
    assert.equal(fresh.data.roomId, room.id);
    assert.equal(room.players.size, 2, 'дубль игрока не создан');
  });

  test('grace-таймер отменяется при возвращении игрока', () => {
    const io = makeIo();
    const { room } = setupRoom(io, ['a', 'b']);
    const player = room.players.get('a');
    player.isConnected = false;
    player.disconnectTimer = setTimeout(() => {
      throw new Error('grace-таймер не должен сработать после реконнекта');
    }, 5);

    const fresh = makeSocket(io, 'a-new');
    joinSocketToRoom(io, fresh, room, 'a', 'user-a');
    assert.equal(room.players.get('a-new').disconnectTimer, null);
    assert.equal(room.players.get('a-new').isConnected, true);
  });

  test('room:state отражает актуальный состав и очки', () => {
    const io = makeIo();
    const { room } = setupRoom(io, ['a', 'b']);
    room.players.get('a').score = 42;
    const state = publicState(room);
    assert.equal(state.players.length, 2);
    assert.equal(state.players.find((p) => p.id === 'a').score, 42);
    assert.deepEqual(state.drawerOrder, ['a', 'b']);
  });
});
