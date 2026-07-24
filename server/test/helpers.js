// Минимальные заглушки Socket.IO для юнит-тестов игровой логики:
// нам нужны только io.to(...).emit(...), io.sockets.sockets и сокет с join/leave/emit.

export function makeIo() {
  const emitted = [];
  const sockets = new Map();
  return {
    emitted,
    sockets: { sockets },
    to(target) {
      return {
        emit(event, payload) {
          emitted.push({ target, event, payload });
        },
      };
    },
    in() {
      return { socketsLeave() {} };
    },
    events(event) {
      return emitted.filter((e) => e.event === event);
    },
    last(event) {
      const list = emitted.filter((e) => e.event === event);
      return list[list.length - 1] || null;
    },
    reset() {
      emitted.length = 0;
    },
  };
}

export function makeSocket(io, id) {
  const socket = {
    id,
    data: { roomId: null, userId: null },
    rooms: new Set(),
    emitted: [],
    join(room) {
      this.rooms.add(room);
    },
    leave(room) {
      this.rooms.delete(room);
    },
    emit(event, payload) {
      this.emitted.push({ event, payload });
    },
    last(event) {
      const list = this.emitted.filter((e) => e.event === event);
      return list[list.length - 1] || null;
    },
  };
  io.sockets.sockets.set(id, socket);
  return socket;
}

export const TEST_SETTINGS = {
  rounds: 2,
  turnSec: 60,
  hintsEnabled: false,
  maxPlayers: 8,
};

// Ход «проигрывается» без ожидания реальных таймеров: выбираем слово,
// завершаем ход и сразу переводим комнату к следующему.
export function playTurnAndAdvance(io, room, game) {
  if (room.state === 'choosing') {
    game.chooseWord(io, room, room.pendingChoices[0]);
  }
  if (room.state === 'drawing') {
    game.endTurn(io, room, 'timeout');
  }
  if (room.state === 'round_end') {
    clearTimeout(room.roundEndTimer);
    room.roundEndTimer = null;
    game.nextTurn(io, room);
  }
}

// Прогон партии: возвращает список ходов [{ round, drawerId }].
export function playGame(io, room, game, { maxTurns = 40, onTurn = null } = {}) {
  const turns = [];
  let guard = 0;
  while (room.state !== 'game_end' && guard < maxTurns) {
    guard += 1;
    if (room.state === 'choosing' || room.state === 'drawing') {
      turns.push({ round: room.round, drawerId: room.drawerId });
      if (onTurn) onTurn(turns.length, room);
    }
    if (room.state === 'game_end') break;
    playTurnAndAdvance(io, room, game);
  }
  return turns;
}
