<script setup>
import { onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useGameStore } from './stores/gameStore';
import { useSound, initAudioUnlock } from './composables/useSound';

const store = useGameStore();
const route = useRoute();
const { muted, toggleMute } = useSound();

onMounted(() => {
  store.init();
  initAudioUnlock();
});

const isHome = computed(() => route.name === 'home');
function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

const canFullscreen = computed(() => {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement;
  return Boolean(
    el.requestFullscreen
    || el.webkitRequestFullscreen
    || document.exitFullscreen
    || document.webkitExitFullscreen,
  );
});

async function toggleFullscreen() {
  const el = document.documentElement;
  if (!getFullscreenElement()) {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } else if (document.exitFullscreen) {
    await document.exitFullscreen();
  } else if (document.webkitExitFullscreen) {
    document.webkitExitFullscreen();
  }
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
    <div class="header-btns">
      <button class="ghost snd-toggle" @click="toggleMute" :title="muted ? 'Включить звук' : 'Выключить звук'" :aria-label="muted ? 'Включить звук' : 'Выключить звук'">{{ muted ? '🔇' : '🔊' }}</button>
      <button v-if="canFullscreen" class="ghost fs-toggle" @click="toggleFullscreen">⛶</button>
    </div>
  </header>
  <router-view v-slot="{ Component }">
    <transition name="route" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>
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
.header-btns {
  display: flex;
  align-items: center;
  gap: .4rem;
}
@media (max-width: 480px) {
  .status .label { display: none; }
  .fs-toggle, .snd-toggle {
    min-height: 34px;
    padding: .25rem .55rem;
    font-size: 1rem;
  }
}
</style>
