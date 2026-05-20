<script setup>
import { onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useGameStore } from './stores/gameStore';

const store = useGameStore();
const route = useRoute();

onMounted(() => store.init());

const isHome = computed(() => route.name === 'home');
const canFullscreen = computed(() => typeof document !== 'undefined' && !!document.documentElement.requestFullscreen);

async function toggleFullscreen() {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  else await document.exitFullscreen?.();
}
</script>

<template>
  <header class="app-header" v-if="!isHome">
    <router-link to="/" class="logo">
      🎨 Скетч-Баттл
    </router-link>
    <div class="status" :class="{ online: store.connected }">
      <span class="dot"></span>
      <span class="label">{{ store.connected ? 'онлайн' : 'переподключение...' }}</span>
    </div>
    <button v-if="canFullscreen" class="ghost fs-toggle" @click="toggleFullscreen">⛶</button>
  </header>
  <router-view />
</template>

<style scoped>
.status {
  display: flex;
  align-items: center;
  gap: .35rem;
  font-size: .82rem;
  color: var(--warn);
  font-weight: 500;
}
.status.online { color: var(--success); }
.status .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 0 currentColor;
  animation: ping 2s ease-out infinite;
}
.status.online .dot {
  animation: none;
}
@keyframes ping {
  0% { box-shadow: 0 0 0 0 rgba(255, 179, 71, 0.6); }
  100% { box-shadow: 0 0 0 8px transparent; }
}
@media (max-width: 480px) {
  .status .label { display: none; }
  .fs-toggle {
    min-height: 34px;
    padding: .25rem .55rem;
    font-size: 1rem;
  }
}
</style>
