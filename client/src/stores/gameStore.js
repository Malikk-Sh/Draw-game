import { defineStore } from 'pinia';
import { getSocket } from '../composables/useSocket.js';
import { playSound } from '../composables/useSound.js';

export const useGameStore = defineStore('game', {
  state: () => ({
    connected: false,
    room: null,
    myId: null,
    wordToDraw: null,
    wordChoices: null,
    wordChoicesTimeMs: 0,
    wordChoicesReceivedAt: 0,
    maskedWord: '',
    messages: [],
    pendingNewStrokes: [],
    // Монотонный счётчик событий холста: следить за длиной очереди нельзя —
    // если она успевает опустеть и снова наполниться внутри одного тика,
    // watcher не срабатывает и холст «замирает» до следующего штриха.
    strokeSeq: 0,
    clearSignal: 0,
    correctGuessSignal: 0,
    lastTurnEnd: null,
    lastGameEnd: null,
    lobbyRooms: [],
    floatingPoints: [],
    reactions: [],
    lastRoomId: null,
    leftManually: false,
    // socket.id, под которым мы реально числимся в комнате на сервере.
    // После реконнекта id меняется — это признак, что нужно перезайти.
    joinedSocketId: null,
    roomClosed: null,
    initialized: false,
  }),
  getters: {
    isHost: (s) => s.room && s.myId && s.room.hostId === s.myId,
    isDrawer: (s) => s.room && s.myId && s.room.drawerId === s.myId,
    me: (s) => s.room?.players?.find((p) => p.id === s.myId) || null,
    drawer: (s) => s.room?.players?.find((p) => p.id === s.room?.drawerId) || null,
    sortedPlayers: (s) => {
      if (!s.room?.players) return [];
      return [...s.room.players].sort((a, b) => b.score - a.score);
    },
  },
  actions: {
    init() {
      // Повторный init() навесил бы вторые копии всех обработчиков —
      // отсюда дубли сообщений и «двойные» ходы на клиенте.
      if (this.initialized) return;
      this.initialized = true;
      const s = getSocket();
      s.on('connect', () => {
        this.connected = true;
        this.myId = s.id;
        // Новый socket.id ⇒ сервер нас в комнате не знает, пока не перезайдём.
        if (this.joinedSocketId !== s.id) this.joinedSocketId = null;
      });
      s.on('disconnect', () => {
        this.connected = false;
        this.joinedSocketId = null;
      });
      s.on('room:closed', ({ reason } = {}) => {
        this.roomClosed = reason || 'closed';
        this.room = null;
        this.joinedSocketId = null;
        this.lastRoomId = null;
      });
      s.on('room:state', (state) => {
        this.room = state;
        this.roomClosed = null;
        // Сервер прислал состояние ⇒ мы в комнате под текущим socket.id.
        if (state.players?.some((p) => p.id === s.id)) {
          this.joinedSocketId = s.id;
          this.myId = s.id;
          this.lastRoomId = state.id;
        }
        this.maskedWord = state.maskedWord || '';
        if (state.drawerId !== this.myId) this.wordToDraw = null;
        if (state.state !== 'choosing') {
          this.wordChoices = null;
        }
        if (state.state !== 'game_end') this.lastGameEnd = null;
        if (state.state !== 'round_end') this.lastTurnEnd = null;
        if (Array.isArray(state.strokes) && state.strokes.length) {
          this.pushStrokeEvent({ kind: 'replace', strokes: state.strokes });
        } else {
          this.pushStrokeEvent({ kind: 'replace', strokes: [] });
        }
      });
      s.on('room:stateUpdate', (patch) => {
        if (!this.room) return;
        Object.assign(this.room, patch);
      });
      s.on('chat:message', (m) => this.pushMessage({ ...m, kind: 'message' }));
      s.on('chat:guessed', (m) => this.pushMessage({ ...m, kind: 'guessed' }));
      s.on('chat:system', (m) => this.pushMessage({ ...m, kind: 'system' }));
      s.on('chat:close', (m) => this.pushMessage({ ...m, kind: 'close' }));

      s.on('game:wordChoices', ({ words, timeMs }) => {
        this.wordChoicesTimeMs = timeMs;
        this.wordChoicesReceivedAt = Date.now();
        this.wordChoices = words;
        playSound('yourTurn');
      });
      s.on('game:wordToDraw', ({ word }) => {
        this.wordToDraw = word;
        this.wordChoices = null;
      });
      s.on('game:turnStart', (payload) => {
        if (!this.room) return;
        this.room.state = 'drawing';
        this.room.drawerId = payload.drawerId;
        this.room.turnDurationMs = payload.turnDurationMs;
        this.room.turnStartedAt = payload.turnStartedAt;
        this.room.wordLength = payload.wordLength;
        this.room.round = payload.round;
        this.room.maxRounds = payload.maxRounds;
        this.maskedWord = payload.maskedWord;
        for (const p of this.room.players) p.hasGuessed = false;
        this.pushStrokeEvent({ kind: 'replace', strokes: [] });
        playSound('turnStart');
      });
      s.on('game:drawStroke', (stroke) => {
        this.pushStrokeEvent({ kind: 'add', stroke });
      });
      s.on('game:canvasReplace', ({ strokes }) => {
        this.pushStrokeEvent({ kind: 'replace', strokes: strokes || [] });
      });
      s.on('game:clearCanvas', () => {
        this.pushStrokeEvent({ kind: 'replace', strokes: [] });
        this.clearSignal += 1;
      });
      s.on('game:hint', ({ maskedWord }) => {
        this.maskedWord = maskedWord;
      });
      s.on('game:correctGuess', ({ playerId, gainedPoints, scores }) => {
        if (!this.room) return;
        for (const p of this.room.players) {
          if (scores[p.id] != null) p.score = scores[p.id];
          if (p.id === playerId) p.hasGuessed = true;
        }
        if (gainedPoints) this.spawnFloat(playerId, `+${gainedPoints}`);
        this.correctGuessSignal += 1;
        playSound(playerId === this.myId ? 'selfCorrect' : 'correct');
      });
      s.on('game:turnEnd', (payload) => {
        if (!this.room) return;
        this.room.state = 'round_end';
        this.lastTurnEnd = payload;
        if (payload.scores) {
          for (const p of this.room.players) {
            if (payload.scores[p.id] != null) p.score = payload.scores[p.id];
          }
        }
        playSound('turnEnd');
      });
      s.on('game:end', ({ ranking }) => {
        if (this.room) this.room.state = 'game_end';
        this.lastGameEnd = { ranking };
        playSound('win');
      });
      s.on('game:reaction', ({ id, emoji }) => {
        const rid = id || Math.random().toString(36).slice(2);
        this.reactions.push({ id: rid, emoji, x: 6 + Math.random() * 86 });
        if (this.reactions.length > 30) this.reactions.splice(0, this.reactions.length - 30);
        setTimeout(() => {
          this.reactions = this.reactions.filter((r) => r.id !== rid);
        }, 2200);
        playSound('pop');
      });
      s.on('lobby:rooms', ({ rooms }) => {
        this.lobbyRooms = rooms || [];
      });
    },
    sendReaction(emoji) {
      getSocket().emit('game:react', { emoji });
    },
    spawnFloat(playerId, text) {
      const id = Math.random().toString(36).slice(2);
      this.floatingPoints.push({ id, playerId, text });
      setTimeout(() => {
        this.floatingPoints = this.floatingPoints.filter((f) => f.id !== id);
      }, 1500);
    },
    pushMessage(msg) {
      this.messages.push({ ...msg, _key: this.messages.length + Math.random() });
      if (this.messages.length > 200) this.messages.splice(0, this.messages.length - 200);
    },
    clearMessages() {
      this.messages = [];
    },
    pushStrokeEvent(event) {
      this.pendingNewStrokes.push(event);
      this.strokeSeq += 1;
    },
    consumeStrokeEvents() {
      const events = this.pendingNewStrokes;
      this.pendingNewStrokes = [];
      return events;
    },
    leave() {
      const s = getSocket();
      s.emit('room:leave');
      this.leftManually = true;
      this.lastRoomId = null;
      this.joinedSocketId = null;
      this.roomClosed = null;
      this.room = null;
      this.wordToDraw = null;
      this.wordChoices = null;
      this.maskedWord = '';
      this.messages = [];
      this.lastTurnEnd = null;
      this.lastGameEnd = null;
      this.reactions = [];
    },
    markJoinedRoom(roomId) {
      this.lastRoomId = roomId || null;
      this.leftManually = false;
      this.roomClosed = null;
    },
    // Нужен ли (пере)вход в комнату: либо мы не в ней, либо изменился socket.id.
    needsJoin(roomId) {
      const s = getSocket();
      if (!s.connected) return false;
      if (this.joinedSocketId !== s.id) return true;
      return this.room?.id !== roomId;
    },
    clearManualLeave() {
      this.leftManually = false;
    },
  },
});
