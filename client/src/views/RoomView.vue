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
const mobileTab = ref(null);
const copied = ref(false);
const mobileTabsRef = ref(null);
const mobilePanelRef = ref(null);

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

function closeMobileTabOnOutsideClick(event) {
  if (!mobileTab.value) return;
  const tabsEl = mobileTabsRef.value;
  const panelEl = mobilePanelRef.value;
  const target = event.target;
  if (!target || !(target instanceof Node)) return;
  if (tabsEl?.contains(target)) return;
  if (panelEl?.contains(target)) return;
  mobileTab.value = null;
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
  document.addEventListener('pointerdown', closeMobileTabOnOutsideClick);
});

onBeforeUnmount(() => {
  window.removeEventListener('online', handleOnline);
  document.removeEventListener('pointerdown', closeMobileTabOnOutsideClick);
});

watch(
  () => store.connected,
  (c) => {
    if (c) joinIfNeeded();
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
          </div>
          <div class="invite-row">
            <span class="muted invite-lbl">Код:</span>
            <code class="invite-code">{{ store.room.id }}</code>
            <button class="ghost copy-btn" @click="copyInvite">
              {{ copied ? '✓ скопировано' : '🔗 ссылка' }}
            </button>
          </div>
        </div>
        <div class="header-actions">
          <button
            v-if="fullScreenSupported"
            @click="toggleFullscreen"
            class="ghost fullscreen-btn"
          >⛶ Экран</button>
          <button v-if="canStart" @click="start" class="start-btn">▶ Начать игру</button>
          <button v-else-if="store.isHost && store.room.state === 'waiting'" disabled class="ghost">
            Нужно ≥ 2 игроков
          </button>
          <button class="ghost leave-btn" @click="leave">Выйти</button>
        </div>
      </div>

      <div class="game-grid">
        <aside class="grid-players">
          <PlayersList />
        </aside>
        <section class="grid-canvas">
          <WordDisplay />
          <TurnTimer />
          <DrawingCanvas />
        </section>
        <aside class="grid-chat">
          <ChatBox />
        </aside>
      </div>

      <nav class="mobile-tabs" v-if="store.room" ref="mobileTabsRef">
        <button :class="{ active: mobileTab === 'chat' }" @pointerdown.stop="mobileTab = mobileTab === 'chat' ? null : 'chat'">
          💬 Чат
        </button>
        <button v-if="mobileTab !== 'chat'" :class="{ active: mobileTab === 'players' }" @pointerdown.stop="mobileTab = mobileTab === 'players' ? null : 'players'">
          👥 Игроки <span class="count">{{ store.room.players.length }}</span>
        </button>
      </nav>
      <div class="mobile-panel" :class="{ open: !!mobileTab }" ref="mobilePanelRef">
        <PlayersList v-if="mobileTab === 'players'" />
        <ChatBox v-else-if="mobileTab === 'chat'" />
      </div>

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
  padding: .7rem;
  padding-bottom: calc(46px + 1.6rem + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: .7rem;
  flex: 1;
}
.error-card {
  margin: 1rem;
  text-align: center;
}
.error-text { color: var(--danger); margin: 0 0 .8rem; }

.room-header {
  padding: .85rem 1rem;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: .8rem;
}
.header-left { flex: 1; min-width: 220px; }
.room-name {
  margin: 0 0 .3rem;
  font-size: 1.15rem;
}
.header-tags {
  display: flex;
  flex-wrap: wrap;
  gap: .35rem;
  margin-bottom: .4rem;
}
.badge.pub { background: rgba(46, 204, 113, 0.2); color: var(--success); }
.badge.priv { background: rgba(255, 209, 102, 0.2); color: var(--accent); }
.badge.state { text-transform: uppercase; letter-spacing: .05em; font-size: .7rem; }
.badge.round { background: var(--bg-3); color: var(--text); }

.invite-row {
  display: flex;
  align-items: center;
  gap: .4rem;
  flex-wrap: wrap;
}
.invite-lbl { font-size: .82rem; }
.invite-code {
  background: var(--bg-3);
  padding: .2rem .65rem;
  border-radius: 6px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-weight: 700;
  letter-spacing: .12em;
  color: var(--accent);
}
.copy-btn {
  padding: .25rem .6rem;
  min-height: 30px;
  font-size: .8rem;
}

.header-actions {
  display: flex;
  gap: .4rem;
  flex-wrap: wrap;
}
.start-btn {
  background: linear-gradient(135deg, var(--success), #1abc9c);
  font-size: .95rem;
}
.leave-btn {
  font-size: .9rem;
  padding: .5rem 1rem;
  min-height: 38px;
}

.game-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: .7rem;
}
.grid-players,
.grid-chat { display: none; }
.grid-canvas {
  display: flex;
  flex-direction: column;
  gap: .4rem;
}

.mobile-tabs {
  position: fixed;
  left: .7rem;
  right: .7rem;
  bottom: max(.6rem, env(safe-area-inset-bottom));
  margin-top: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: .4rem;
  z-index: 70;
}
.mobile-tabs button {
  background: var(--bg-2);
  color: #3f3123;
  border: 1px solid var(--border);
  min-height: 40px;
  font-size: .95rem;
  font-weight: 700;
}
.mobile-tabs button.active {
  background: var(--primary);
  color: #fff7e8;
  border-color: var(--primary);
}
.count {
  margin-left: .25rem;
  background: rgba(255, 255, 255, 0.15);
  padding: 0 .35rem;
  border-radius: 999px;
  font-size: .75rem;
}
.mobile-panel {
  position: fixed;
  left: .7rem;
  right: .7rem;
  bottom: calc(max(.6rem, env(safe-area-inset-bottom)) + 46px + .45rem);
  height: min(55vh, 420px);
  opacity: 0;
  transform: translateY(calc(100% + .8rem));
  pointer-events: none;
  transition: transform .22s ease, opacity .18s ease;
  background: rgba(10, 14, 24, .72);
  backdrop-filter: blur(4px);
  border-radius: 12px;
  padding: .4rem;
  overflow: hidden;
  z-index: 69;
}
.mobile-panel.open {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.loading {
  display: flex;
  align-items: center;
  gap: .8rem;
}
.spinner {
  width: 20px;
  height: 20px;
  border: 3px solid var(--bg-3);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

@media (min-width: 900px) {
  .room { padding: 1rem; gap: 1rem; }
  .game-grid {
    grid-template-columns: 240px 1fr 320px;
    align-items: start;
    min-height: 0;
  }
  .grid-players, .grid-chat { display: block; }
  .grid-chat {
    height: 70vh;
    max-height: 760px;
  }
  .mobile-tabs, .mobile-panel { display: none; }
}
</style>
