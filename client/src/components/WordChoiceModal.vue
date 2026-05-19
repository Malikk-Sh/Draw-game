<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue';
import { useGameStore } from '../stores/gameStore';
import { getSocket } from '../composables/useSocket';

const store = useGameStore();
const now = ref(Date.now());
let raf = null;

const startedAt = computed(() => store.wordChoicesReceivedAt || now.value);
const totalMs = computed(() => store.wordChoicesTimeMs || 15000);

const remainSec = computed(() => {
  const elapsed = now.value - startedAt.value;
  return Math.max(0, Math.ceil((totalMs.value - elapsed) / 1000));
});

const remainPct = computed(() => {
  const elapsed = now.value - startedAt.value;
  return Math.max(0, Math.min(100, 100 - (elapsed / totalMs.value) * 100));
});

function tick() {
  now.value = Date.now();
  raf = requestAnimationFrame(tick);
}

onMounted(() => {
  now.value = Date.now();
  raf = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf);
});

watch(() => store.wordChoices, (val) => {
  if (val) now.value = Date.now();
});

function choose(word) {
  getSocket().emit('game:chooseWord', { word });
}
</script>

<template>
  <transition name="fade">
    <div class="modal-backdrop" v-if="store.wordChoices && store.isDrawer">
      <div class="modal choose-modal">
        <h2 style="margin:0 0 .25rem">Выбери слово для рисования</h2>
        <p class="muted" style="margin:0 0 .8rem">
          Осталось <b>{{ remainSec }}</b> сек. Если не выберешь — возьмём первое.
        </p>
        <div class="timer-bar"><div class="fill" :style="{ width: remainPct + '%' }"></div></div>
        <div class="choices">
          <button
            v-for="(w, i) in store.wordChoices"
            :key="w"
            class="choice"
            :style="{ animationDelay: (i * 0.05) + 's' }"
            @click="choose(w)"
          >{{ w }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.choose-modal {
  animation: slide-up 0.3s ease-out;
}
.choices {
  display: flex;
  flex-direction: column;
  gap: .5rem;
  margin-top: .8rem;
}
.choice {
  font-size: 1.15rem;
  padding: 1rem;
  animation: pop-in 0.25s ease-out backwards;
  background: linear-gradient(135deg, var(--primary), var(--primary-hover));
}
.timer-bar {
  height: 6px;
  background: var(--bg-3);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: .4rem;
}
.timer-bar .fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--warn));
  border-radius: 999px;
  transition: width .2s linear;
}
@keyframes slide-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes pop-in {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
