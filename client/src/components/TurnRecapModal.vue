<script setup>
import { computed } from 'vue';
import { useGameStore } from '../stores/gameStore';

const store = useGameStore();

const show = computed(() => store.room?.state === 'round_end' && !!store.lastTurnEnd);
const word = computed(() => store.lastTurnEnd?.word || '');
const rows = computed(() => store.lastTurnEnd?.summary || []);

function fmt(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return '0';
}
</script>

<template>
  <transition name="recap-fade">
    <div class="recap" v-if="show">
      <div class="recap-card">
        <div class="recap-head">
          <span class="recap-title">Итоги хода</span>
          <span class="recap-word" v-if="word">Слово: <b>{{ word }}</b></span>
        </div>
        <ul class="recap-list" v-if="rows.length">
          <li v-for="r in rows" :key="r.id" :class="{ me: r.id === store.myId }">
            <span class="rn">{{ r.nickname }}</span>
            <span class="role" v-if="r.isDrawer">рисовал</span>
            <span class="role ok" v-else-if="r.guessed">угадал</span>
            <span class="role miss" v-else>—</span>
            <span class="rp" :class="{ pos: r.gained > 0, neg: r.gained < 0 }">{{ fmt(r.gained) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.recap {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 64px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 90;
  width: min(92%, 360px);
  pointer-events: none;
}
.recap-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: .7rem .85rem;
}
.recap-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: .5rem;
  margin-bottom: .5rem;
}
.recap-title {
  font-weight: 700;
  font-size: .95rem;
}
.recap-word {
  font-size: .85rem;
  color: var(--text-dim);
}
.recap-word b { color: var(--accent); }
.recap-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: .25rem;
}
.recap-list li {
  display: flex;
  align-items: center;
  gap: .5rem;
  background: var(--bg-2);
  border-radius: var(--radius-sm);
  padding: .3rem .5rem;
  font-size: .9rem;
}
.recap-list li.me { outline: 2px solid var(--primary); outline-offset: -2px; }
.rn {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.role {
  font-size: .72rem;
  color: var(--text-dim);
  flex: 0 0 auto;
}
.role.ok { color: var(--success); }
.role.miss { opacity: .5; }
.rp {
  flex: 0 0 auto;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  min-width: 2.6rem;
  text-align: right;
  color: var(--text-dim);
}
.rp.pos { color: var(--success); }
.rp.neg { color: var(--danger); }

.recap-fade-enter-active, .recap-fade-leave-active {
  transition: opacity .25s ease, transform .25s ease;
}
.recap-fade-enter-from, .recap-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}
</style>
