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
const mobileTab = ref('chat');
const copied = ref(false);

const inviteUrl = computed(() => {
  if (typeof window === 'undefined' || !store.room) return '';
  return `${window.location.origin}/room/${store.room.id}`;
});

const canStart = computed(() => {
  return store.isHost && store.room?.state === 'waiting' && store.room.players.length >= 2;
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
  const res = await emitAck('room:join', { roomId: props.id, nickname: userStore.nickname });
  if (!res?.ok) {
    error.value = res?.error || 'Не удалось войти в комнату';
  }
}

function start() {
  getSocket().emit('game:start');
}

function leave() {
  store.leave();
  router.push('/lobby');
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteUrl.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  } catch (_) {
    /* fallback noop */
  }
}

onMounted(() => {
  joinIfNeeded();
});

onBeforeUnmount(() => {
  store.leave();
});

watch(
  () => store.connected,
  (c) => {
    if (c && (!store.room || store.room.id !== props.id)) joinIfNeeded();
  },
);
</script>

<template>
  <main class="room">
    <div v-if="error" class="card" style="margin:1rem">
      <p style="color:var(--danger);margin:0 0 .6rem">{{ error }}</p>
      <button @click="router.push('/lobby')">В лобби</button>
    </div>

    <template v-else-if="store.room">
      <div class="room-header">
        <div class="room-title">
          <div class="row" style="gap:.5rem;flex-wrap:wrap;align-items:center">
            <h2 style="margin:0">{{ store.room.name }}</h2>
            <span class="badge">{{ store.room.isPublic ? 'публичная' : 'приватная' }}</span>
            <span class="badge">Раунд {{ Math.max(1, store.room.round) }} / {{ store.room.maxRounds }}</span>
          </div>
          <div class="row" style="gap:.4rem;margin-top:.3rem">
            <code class="invite-code">{{ store.room.id }}</code>
            <button class="ghost" style="padding:.3rem .6rem;min-height:32px;font-size:.8rem" @click="copyInvite">
              {{ copied ? 'Скопировано!' : 'Копировать ссылку' }}
            </button>
          </div>
        </div>
        <div class="room-actions">
          <button v-if="canStart" @click="start">Начать игру</button>
          <button class="ghost" @click="leave">Выйти</button>
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

      <nav class="mobile-tabs">
        <button :class="{ active: mobileTab === 'chat' }" @click="mobileTab = 'chat'">Чат</button>
        <button :class="{ active: mobileTab === 'players' }" @click="mobileTab = 'players'">Игроки</button>
      </nav>
      <div class="mobile-panel">
        <PlayersList v-if="mobileTab === 'players'" />
        <ChatBox v-else />
      </div>

      <WordChoiceModal />
      <RoundEndModal />
    </template>

    <div v-else class="center-screen muted">Подключаемся к комнате...</div>
  </main>
</template>

<style scoped>
.room {
  padding: .8rem;
  display: flex;
  flex-direction: column;
  gap: .8rem;
  flex: 1;
}
.room-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: .6rem;
  background: var(--bg-2);
  padding: .6rem .9rem;
  border-radius: var(--radius);
}
.room-actions {
  display: flex;
  gap: .4rem;
}
.invite-code {
  background: var(--bg-3);
  padding: .15rem .55rem;
  border-radius: 6px;
  font-family: ui-monospace, monospace;
  font-weight: 700;
  letter-spacing: .1em;
}

.game-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: .8rem;
}
.grid-players,
.grid-chat {
  display: none;
}
.grid-canvas {
  display: flex;
  flex-direction: column;
  gap: .4rem;
}

.mobile-tabs {
  display: flex;
  gap: .4rem;
}
.mobile-tabs button {
  flex: 1;
  background: var(--bg-2);
  color: var(--text-dim);
}
.mobile-tabs button.active {
  background: var(--primary);
  color: white;
}
.mobile-panel {
  height: 320px;
}

@media (min-width: 900px) {
  .room {
    padding: 1rem;
  }
  .game-grid {
    grid-template-columns: 220px 1fr 300px;
    align-items: start;
  }
  .grid-players,
  .grid-chat {
    display: block;
  }
  .grid-chat {
    height: 70vh;
    max-height: 760px;
  }
  .mobile-tabs,
  .mobile-panel {
    display: none;
  }
}
</style>
