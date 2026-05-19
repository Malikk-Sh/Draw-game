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
</script>

<template>
  <div class="modal-backdrop" v-if="showGameEnd">
    <div class="modal">
      <h2 style="margin-top:0">🏆 Игра окончена!</h2>
      <ol class="ranking">
        <li v-for="(p, i) in store.lastGameEnd.ranking" :key="p.id" :class="{ winner: i === 0 }">
          <span class="rank">{{ i + 1 }}</span>
          <span class="name">{{ p.nickname }}</span>
          <span class="score">{{ p.score }}</span>
        </li>
      </ol>
      <div class="row" style="gap:.5rem;margin-top:1rem">
        <button v-if="store.isHost" @click="playAgain" style="flex:1">Играть ещё</button>
        <button class="secondary" @click="leave" style="flex:1">В лобби</button>
      </div>
      <p v-if="!store.isHost" class="muted" style="margin:.6rem 0 0;text-align:center;font-size:.85rem">
        Хост может начать новую игру.
      </p>
    </div>
  </div>
</template>

<style scoped>
.ranking {
  list-style: none;
  padding: 0;
  margin: .6rem 0 0;
  display: flex;
  flex-direction: column;
  gap: .4rem;
}
.ranking li {
  display: flex;
  align-items: center;
  gap: .8rem;
  background: var(--bg-2);
  padding: .6rem .8rem;
  border-radius: var(--radius-sm);
}
.ranking li.winner {
  background: linear-gradient(90deg, rgba(255,209,102,0.25), var(--bg-2));
  outline: 1px solid var(--accent);
}
.rank {
  font-weight: 700;
  width: 1.5rem;
  text-align: center;
  color: var(--text-dim);
}
.ranking li.winner .rank { color: var(--accent); }
.name { flex: 1; font-weight: 600; }
.score { font-weight: 700; color: var(--accent); }
</style>
