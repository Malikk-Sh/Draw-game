<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { useGameStore } from '../stores/gameStore';

const store = useGameStore();
const now = ref(Date.now());
let raf = null;

function tick() {
  now.value = Date.now();
  raf = requestAnimationFrame(tick);
}

onMounted(() => { raf = requestAnimationFrame(tick); });
onBeforeUnmount(() => { if (raf) cancelAnimationFrame(raf); });

const active = computed(() => store.room?.state === 'drawing');
const remainSec = computed(() => {
  if (!active.value) return 0;
  const total = store.room.turnDurationMs || 0;
  const elapsed = now.value - (store.room.turnStartedAt || now.value);
  return Math.max(0, Math.ceil((total - elapsed) / 1000));
});
const percent = computed(() => {
  if (!active.value) return 0;
  const total = store.room.turnDurationMs || 1;
  const elapsed = now.value - (store.room.turnStartedAt || now.value);
  return Math.max(0, Math.min(100, 100 - (elapsed / total) * 100));
});
const colorClass = computed(() => {
  if (percent.value > 50) return 'ok';
  if (percent.value > 20) return 'warn';
  return 'danger';
});
</script>

<template>
  <div class="timer" v-if="active">
    <div class="bar"><div class="fill" :class="colorClass" :style="{ width: percent + '%' }"></div></div>
    <div class="num">{{ remainSec }}с</div>
  </div>
</template>

<style scoped>
.timer {
  display: flex;
  align-items: center;
  gap: .6rem;
}
.bar {
  flex: 1;
  height: 10px;
  background: var(--bg-3);
  border-radius: 999px;
  overflow: hidden;
}
.fill {
  height: 100%;
  transition: width .25s linear, background .3s;
  border-radius: 999px;
}
.fill.ok { background: var(--success); }
.fill.warn { background: var(--warn); }
.fill.danger { background: var(--danger); }
.num {
  font-weight: 700;
  min-width: 3rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
