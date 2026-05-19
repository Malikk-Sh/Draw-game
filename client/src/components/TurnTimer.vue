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
const lowTime = computed(() => percent.value <= 20);
</script>

<template>
  <div class="timer" v-if="active" :class="{ pulse: lowTime }">
    <div class="bar">
      <div class="fill" :class="colorClass" :style="{ width: percent + '%' }"></div>
    </div>
    <div class="num" :class="colorClass">⏱ {{ remainSec }}<span class="unit">с</span></div>
  </div>
</template>

<style scoped>
.timer {
  display: flex;
  align-items: center;
  gap: .6rem;
  padding: 0 .2rem;
}
.bar {
  flex: 1;
  height: 8px;
  background: var(--bg-3);
  border-radius: 999px;
  overflow: hidden;
}
.fill {
  height: 100%;
  transition: width .25s linear, background .3s;
  border-radius: 999px;
}
.fill.ok { background: linear-gradient(90deg, var(--success), #34d399); }
.fill.warn { background: linear-gradient(90deg, var(--warn), #ffb347); }
.fill.danger { background: linear-gradient(90deg, var(--danger), #ff8484); }
.num {
  font-weight: 700;
  min-width: 3.5rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 1rem;
}
.num.ok { color: var(--success); }
.num.warn { color: var(--warn); }
.num.danger { color: var(--danger); }
.unit {
  font-size: .8em;
  font-weight: 500;
  margin-left: .1em;
}
.timer.pulse .num {
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}
</style>
