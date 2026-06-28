<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '../stores/userStore';
import { useGameStore } from '../stores/gameStore';
import { emitAck, getSocket } from '../composables/useSocket';

import DrawingCanvas from '../components/DrawingCanvas.vue';
import ChatBox from '../components/ChatBox.vue';
import PlayersList from '../components/PlayersList.vue';
import WordDisplay from '../components/WordDisplay.vue';
import TurnTimer from '../components/TurnTimer.vue';
import WordChoiceModal from '../components/WordChoiceModal.vue';
import RoundEndModal from '../components/RoundEndModal.vue';

const props = defineProps({ id: String });
const router = useRouter();
const userStore = useUserStore();
const store = useGameStore();

const error = ref('');
const copied = ref(false);
const toastMessages = ref([]);
const MESSAGE_LIFETIME_MS = 3000;

const inviteUrl = computed(() => {
  if (typeof window === 'undefined' || !store.room) return '';
  return `${window.location.origin}/room/${store.room.id}`;
});

const canStart = computed(() => {
  return store.isHost && store.room?.state === 'waiting' && store.room.players.length >= 2;
});

const stateLabel = computed(() => {
  if (!store.room) return '';
  switch (store.room.state) {
    case 'waiting': return 'ожидание';
    case 'choosing': return 'выбор слова';
    case 'drawing': return 'идёт раунд';
    case 'round_end': return 'итоги хода';
    case 'game_end': return 'игра окончена';
    default: return '';
  }
});

async function joinIfNeeded() {
  if (store.room?.id === props.id) return;
  if (!userStore.nickname) {
    router.push('/');
    return;
  }
  const socket = getSocket();
  if (!socket.connected) {
    await new Promise((res) => socket.once('connect', res));
  }
  const res = await emitAck('room:join', {
    roomId: props.id,
    nickname: userStore.nickname,
    userId: userStore.ensureUserId(),
  });
  if (!res?.ok) {
    error.value = res?.error || 'Не удалось войти в комнату';
    if ((res?.error || '').includes('заполнена')) {
      store.lastRoomId = null;
      router.push('/lobby');
    }
    return;
  }
  store.markJoinedRoom(props.id);
}

function start() {
  getSocket().emit('game:start');
}

function leave() {
  store.leave();
  router.push('/lobby');
}

function handleOnline() {
  if (!store.leftManually && store.lastRoomId === props.id) joinIfNeeded();
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteUrl.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  } catch (_) {}
}

onMounted(() => {
  joinIfNeeded();
  store.clearManualLeave();
  window.addEventListener('online', handleOnline);
});

onBeforeUnmount(() => {
  window.removeEventListener('online', handleOnline);
});

function enqueueToastMessage(msg) {
  const id = `${Date.now()}-${Math.random()}`;
  toastMessages.value.push({ id, nickname: msg.nickname, text: msg.text });
  setTimeout(() => {
    toastMessages.value = toastMessages.value.filter((item) => item.id !== id);
  }, MESSAGE_LIFETIME_MS);
}

watch(
  () => store.connected,
  (c) => {
    if (c) joinIfNeeded();
  },
);

watch(
  () => store.messages.length,
  (length, prevLength) => {
    if (!store.isDrawer || store.room?.state !== 'drawing') return;
    if (!length || length === prevLength) return;
    const msg = store.messages[length - 1];
    if (!msg || msg.kind !== 'message' || !msg.nickname || !msg.text) return;
    enqueueToastMessage(msg);
  },
);
</script>

<template>
  <main class="room">
    <div v-if="error" class="card error-card">
      <p class="error-text">{{ error }}</p>
      <button @click="router.push('/lobby')">В лобби</button>
    </div>

    <template v-else-if="store.room">
      <div class="room-header card">
        <div class="header-left">
          <h2 class="room-name">{{ store.room.name }}</h2>
          <div class="header-tags">
            <span class="badge" :class="store.room.isPublic ? 'pub' : 'priv'">
              {{ store.room.isPublic ? '🌍 публичная' : '🔒 приватная' }}
            </span>
            <span class="badge state">{{ stateLabel }}</span>
            <span class="badge round" v-if="store.room.state !== 'waiting'">
              Раунд {{ Math.max(1, store.room.round) }} / {{ store.room.maxRounds }}
            </span>
            <code class="invite-code">{{ store.room.id }}</code>
          </div>
        </div>
        <div class="header-actions">
          <button class="ghost copy-btn" @click="copyInvite">
            {{ copied ? '✓' : '🔗' }}<span class="btn-lbl">{{ copied ? ' скопировано' : ' ссылка' }}</span>
          </button>
          <button v-if="canStart" @click="start" class="start-btn">▶<span class="btn-lbl"> Начать</span></button>
          <button v-else-if="store.isHost && store.room.state === 'waiting'" disabled class="ghost need-players">
            Нужно ≥ 2
          </button>
          <button class="ghost leave-btn" @click="leave">🚪<span class="btn-lbl"> Выйти</span></button>
        </div>
      </div>

      <div class="game-area">
        <PlayersList variant="strip" class="zone pl-strip" />
        <aside class="zone pl-list">
          <PlayersList variant="list" />
        </aside>
        <section class="zone zone-canvas">
          <WordDisplay />
          <TurnTimer />
          <DrawingCanvas />
        </section>
        <aside class="zone zone-chat">
          <ChatBox :is-active="true" />
        </aside>
      </div>

      <TransitionGroup name="guess-toast" tag="div" class="guess-toasts" v-if="toastMessages.length">
        <div v-for="msg in toastMessages" :key="msg.id" class="guess-toast-item">
          <span class="toast-author">{{ msg.nickname }}</span>
          <span class="toast-text">{{ msg.text }}</span>
        </div>
      </TransitionGroup>

      <WordChoiceModal />
      <RoundEndModal />
    </template>

    <div v-else class="center-screen muted">
      <div class="loading">
        <div class="spinner"></div>
        Подключаемся к комнате...
      </div>
    </div>
  </main>
</template>

<style scoped>
.room {
  padding: .6rem;
  padding-bottom: calc(.6rem + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: .55rem;
  flex: 1;
  min-height: 0;
}
.error-card {
  margin: 1rem;
  text-align: center;
}
.error-text { color: var(--danger); margin: 0 0 .8rem; }

/* ===== Шапка ===== */
.room-header {
  padding: .55rem .7rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: .5rem;
}
.header-left { flex: 1; min-width: 0; }
.room-name {
  margin: 0 0 .25rem;
  font-size: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.header-tags {
  display: flex;
  flex-wrap: wrap;
  gap: .3rem;
  align-items: center;
}
.badge.pub { background: rgba(46, 204, 113, 0.2); color: var(--success); }
.badge.priv { background: rgba(255, 209, 102, 0.2); color: var(--accent); }
.badge.state { text-transform: uppercase; letter-spacing: .05em; font-size: .68rem; }
.badge.round { background: var(--bg-3); color: var(--text); }
.invite-code {
  background: var(--bg-3);
  padding: .1rem .5rem;
  border-radius: 6px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-weight: 700;
  letter-spacing: .12em;
  color: var(--accent);
  font-size: .8rem;
}
.header-actions {
  display: flex;
  gap: .35rem;
  flex-wrap: wrap;
  flex: 0 0 auto;
}
.header-actions button {
  min-height: 38px;
  padding: .4rem .7rem;
  font-size: .88rem;
}
.start-btn {
  background: linear-gradient(135deg, var(--success), #1abc9c);
}
.need-players { font-size: .82rem; }

/* ===== Игровая зона (адаптив) ===== */
.game-area {
  display: flex;
  flex-direction: column;
  gap: .5rem;
  flex: 1;
  min-height: 0;
}
.pl-list { display: none; }
.zone-canvas {
  display: flex;
  flex-direction: column;
  gap: .35rem;
  flex: 1 1 auto;
  min-height: 0;
}
.zone-chat {
  flex: 0 1 auto;
  min-height: 84px;
  max-height: 30vh;
  display: flex;
}
.zone-chat :deep(.chat-box) { height: 100%; width: 100%; }

/* Планшет / телефон в ландшафте: холст + чат бок о бок, игроки полосой сверху */
@media (min-width: 600px) and (max-width: 899px),
       (orientation: landscape) and (max-height: 600px) {
  .game-area {
    display: grid;
    grid-template-columns: 1.7fr 1fr;
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      "strip strip"
      "canvas chat";
    min-height: 0;
  }
  .pl-strip { grid-area: strip; }
  .zone-canvas { grid-area: canvas; min-height: 0; }
  .zone-chat { grid-area: chat; min-height: 0; max-height: none; }
}

/* Десктоп: 3 колонки, полный список игроков */
@media (min-width: 900px) {
  .room { padding: 1rem; gap: 1rem; }
  .game-area {
    display: grid;
    grid-template-columns: 240px 1fr 320px;
    grid-template-areas: "players canvas chat";
    align-items: start;
    min-height: 0;
  }
  .pl-strip { display: none; }
  .pl-list { display: block; grid-area: players; }
  .zone-canvas { grid-area: canvas; }
  .zone-chat { grid-area: chat; height: 72vh; max-height: 780px; min-height: 0; }
  .room-header { padding: .85rem 1rem; }
  .room-name { font-size: 1.15rem; }
}

/* На узких экранах прячем текстовые подписи кнопок шапки */
@media (max-width: 560px) {
  .header-actions .btn-lbl { display: none; }
  .header-actions button { padding: .4rem .6rem; min-height: 34px; }
}

/* Компактная шапка комнаты на телефоне — освобождаем высоту под холст. */
@media (max-width: 599px) {
  .room { gap: .4rem; }
  .room-header { padding: .4rem .6rem; gap: .4rem; }
  .room-name { font-size: .9rem; margin-bottom: .15rem; }
  .invite-code { display: none; }
  .header-tags { gap: .25rem; }
}

/* Короткий ландшафт (телефон боком): максимально сжать шапку под холст+чат */
@media (orientation: landscape) and (max-height: 600px) {
  .room { padding: .4rem; gap: .4rem; }
  .room-header { padding: .35rem .6rem; }
  .room-name { font-size: .9rem; margin-bottom: .15rem; }
  .header-actions .btn-lbl { display: none; }
  .header-actions button { min-height: 32px; padding: .3rem .5rem; }
}

/* ===== Всплывашки догадок для рисующего ===== */
.guess-toasts {
  position: fixed;
  top: calc(56px + env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: .4rem;
  z-index: 72;
  pointer-events: none;
  width: min(92%, 420px);
}
.guess-toast-item {
  background: rgba(15, 22, 37, .86);
  border: 1px solid rgba(141, 225, 255, .35);
  border-radius: 12px;
  padding: .45rem .65rem;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 26px rgba(0, 0, 0, .24);
}
.toast-author { font-size: .74rem; font-weight: 700; color: #7fd6ff; }
.toast-text { color: #f7fbff; font-size: .88rem; font-weight: 500; word-break: break-word; }
.guess-toast-enter-active, .guess-toast-leave-active { transition: opacity .28s ease, transform .28s ease; }
.guess-toast-enter-from, .guess-toast-leave-to { opacity: 0; transform: translateY(-12px) scale(.97); }
@media (min-width: 900px) {
  .guess-toasts { display: none; }
}

/* ===== Загрузка ===== */
.loading { display: flex; align-items: center; gap: .8rem; }
.spinner {
  width: 20px;
  height: 20px;
  border: 3px solid var(--bg-3);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
