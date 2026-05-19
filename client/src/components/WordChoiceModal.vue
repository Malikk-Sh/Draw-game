<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { useGameStore } from '../stores/gameStore';
import { getSocket } from '../composables/useSocket';

const store = useGameStore();
const now = ref(Date.now());
let raf = null;
const started = Date.now();
let initialTime = 0;

onMounted(() => {
  initialTime = store.wordChoicesTimeMs || 15000;
  const loop = () => { now.value = Date.now(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
});
onBeforeUnmount(() => { if (raf) cancelAnimationFrame(raf); });

const remainSec = computed(() => {
  return Math.max(0, Math.ceil((initialTime - (now.value - started)) / 1000));
});

function choose(word) {
  getSocket().emit('game:chooseWord', { word });
}
</script>

<template>
  <div class="modal-backdrop" v-if="store.wordChoices && store.isDrawer">
    <div class="modal">
      <h2 style="margin-top:0">Выбери слово</h2>
      <p class="muted">У тебя {{ remainSec }} сек. Если не выберешь — возьмём первое.</p>
      <div class="choices">
        <button
          v-for="w in store.wordChoices"
          :key="w"
          class="choice"
          @click="choose(w)"
        >{{ w }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.choices {
  display: flex;
  flex-direction: column;
  gap: .5rem;
  margin-top: .6rem;
}
.choice {
  font-size: 1.1rem;
  padding: 1rem;
}
</style>
