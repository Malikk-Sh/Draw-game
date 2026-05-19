<script setup>
import { onMounted } from 'vue';
import { useGameStore } from './stores/gameStore';

const store = useGameStore();
onMounted(() => store.init());
</script>

<template>
  <header class="app-header">
    <router-link to="/" class="logo" style="text-decoration:none">
      <span>🎨</span> Крокодил
    </router-link>
    <div class="muted" style="font-size:.85rem">
      <span v-if="store.connected">● онлайн</span>
      <span v-else style="color:var(--warn)">● переподключение...</span>
    </div>
  </header>
  <router-view />
</template>
