<script setup>
import { computed } from 'vue';
import { useGameStore } from '../stores/gameStore';
import { getSocket } from '../composables/useSocket';
import { useRouter } from 'vue-router';

const store = useGameStore();
const router = useRouter();

const showGameEnd = computed(() => store.room?.state === 'game_end' && store.lastGameEnd);

function playAgain() {
  getSocket().emit('game:playAgain');
}
function leave() {
  store.leave();
  router.push('/lobby');
}

const medals = ['🥇', '🥈', '🥉'];
const onlinePlayers = computed(() => (store.room?.players || []).filter((p) => p.isConnected !== false));
</script>

<template>
  <transition name="fade">
    <div class="modal-backdrop" v-if="showGameEnd">
      <div class="modal end-modal">
        <div class="trophy-decoration">🎉</div>
        <h2 class="end-title">Игра окончена!</h2>
        <ol class="ranking">
          <li
            v-for="(p, i) in store.lastGameEnd.ranking"
            :key="p.id"
            :class="{ winner: i === 0, top3: i < 3 }"
            :style="{ animationDelay: (i * 0.08) + 's' }"
          >
            <span class="rank">{{ medals[i] || (i + 1) }}</span>
            <span class="name">{{ p.nickname }}</span>
            <span class="score">{{ p.score }}</span>
          </li>
        </ol>
        <p class="muted" style="margin:.2rem 0 .5rem">Остались в комнате: {{ onlinePlayers.map((p) => p.nickname).join(', ') || '—' }}</p>
        <div class="end-actions">
          <button v-if="store.isHost" @click="playAgain" class="play-again">
            🔄 Играть ещё
          </button>
          <button class="secondary" @click="leave">В лобби</button>
        </div>
        <p v-if="!store.isHost" class="muted host-hint">
          Хост может начать новую игру.
        </p>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.end-modal {
  text-align: center;
  animation: zoom-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative;
  overflow: hidden;
}
.end-modal::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, rgba(255, 209, 102, 0.1), transparent 70%);
  z-index: 0;
}
.end-modal > * { position: relative; z-index: 1; }
.trophy-decoration {
  font-size: 3rem;
  margin-bottom: .25rem;
  animation: bounce 2s ease-in-out infinite;
}
.end-title {
  background: linear-gradient(135deg, var(--accent), var(--primary));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0 0 .8rem;
  font-size: 1.6rem;
}
.ranking {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem;
  display: flex;
  flex-direction: column;
  gap: .4rem;
}
.ranking li {
  display: flex;
  align-items: center;
  gap: .8rem;
  background: var(--bg-2);
  padding: .65rem .9rem;
  border-radius: var(--radius-sm);
  animation: row-in 0.4s ease-out backwards;
}
.ranking li.winner {
  background: linear-gradient(90deg, rgba(255,209,102,0.25), var(--bg-2));
  border: 1px solid var(--accent);
  transform: scale(1.02);
}
.rank {
  font-weight: 700;
  font-size: 1.3rem;
  width: 2rem;
  text-align: center;
  color: var(--text-dim);
  flex: 0 0 2rem;
}
.ranking li.top3 .rank {
  font-size: 1.6rem;
}
.name {
  flex: 1;
  font-weight: 600;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.score {
  font-weight: 700;
  color: var(--accent);
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
}
.end-actions {
  display: flex;
  gap: .5rem;
}
.end-actions > * { flex: 1; }
.play-again {
  background: linear-gradient(135deg, var(--primary), var(--primary-hover));
}
.host-hint {
  margin: .8rem 0 0;
  text-align: center;
  font-size: .85rem;
}
@keyframes zoom-in {
  from { opacity: 0; transform: scale(0.85); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes row-in {
  from { opacity: 0; transform: translateX(-12px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
