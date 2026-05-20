import { defineStore } from 'pinia';
import { getSocket } from '../composables/useSocket.js';

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
    clearSignal: 0,
    lastTurnEnd: null,
    lastGameEnd: null,
    lobbyRooms: [],
    floatingPoints: [],
    lastRoomId: null,
    leftManually: false,
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
      const s = getSocket();
      s.on('connect', () => {
        this.connected = true;
        this.myId = s.id;
      });
      s.on('disconnect', () => {
        this.connected = false;
      });
      s.on('room:state', (state) => {
        this.room = state;
        this.maskedWord = state.maskedWord || '';
        if (state.drawerId !== this.myId) this.wordToDraw = null;
        if (state.state !== 'choosing') {
          this.wordChoices = null;
        }
        if (state.state !== 'game_end') this.lastGameEnd = null;
        if (state.state !== 'round_end') this.lastTurnEnd = null;
        if (Array.isArray(state.strokes) && state.strokes.length) {
          this.pendingNewStrokes.push({ kind: 'replace', strokes: state.strokes });
        } else {
          this.pendingNewStrokes.push({ kind: 'replace', strokes: [] });
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
        this.pendingNewStrokes.push({ kind: 'replace', strokes: [] });
      });
      s.on('game:drawStroke', (stroke) => {
        this.pendingNewStrokes.push({ kind: 'add', stroke });
      });
      s.on('game:canvasReplace', ({ strokes }) => {
        this.pendingNewStrokes.push({ kind: 'replace', strokes: strokes || [] });
      });
      s.on('game:clearCanvas', () => {
        this.pendingNewStrokes.push({ kind: 'replace', strokes: [] });
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
      });
      s.on('game:end', ({ ranking }) => {
        if (this.room) this.room.state = 'game_end';
        this.lastGameEnd = { ranking };
      });
      s.on('lobby:rooms', ({ rooms }) => {
        this.lobbyRooms = rooms || [];
      });
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
      this.room = null;
      this.wordToDraw = null;
      this.wordChoices = null;
      this.maskedWord = '';
      this.messages = [];
      this.lastTurnEnd = null;
      this.lastGameEnd = null;
    },
    markJoinedRoom(roomId) {
      this.lastRoomId = roomId || null;
      this.leftManually = false;
    },
    clearManualLeave() {
      this.leftManually = false;
    },
  },
});
