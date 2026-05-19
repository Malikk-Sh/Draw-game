<script setup>
import { ref, computed } from 'vue';
import { useGameStore } from '../stores/gameStore';
import { useCanvas } from '../composables/useCanvas';

const store = useGameStore();
const canvasRef = ref(null);
const isDrawer = computed(() => store.isDrawer);

const { color, size, tool, setColor, setSize, setTool, clearCanvas } =
  useCanvas(canvasRef, { isDrawer, store });

const colors = ['#1a1a1a', '#ffffff', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#ff7ed4', '#8b4513'];
const sizes = [2, 4, 8, 14, 22];
</script>

<template>
  <div>
    <div class="canvas-wrap">
      <canvas ref="canvasRef"></canvas>
      <div
        v-if="store.room && store.room.state !== 'drawing' && store.room.state !== 'choosing'"
        class="canvas-overlay"
      >
        <div v-if="store.room.state === 'waiting'">
          Ожидание игроков... Минимум 2 для начала.
        </div>
        <div v-else-if="store.room.state === 'round_end'">
          Раунд завершён.
        </div>
        <div v-else-if="store.room.state === 'game_end'">
          Игра окончена.
        </div>
      </div>
      <div
        v-else-if="store.room?.state === 'choosing' && !isDrawer"
        class="canvas-overlay"
      >
        <div>
          {{ store.drawer ? store.drawer.nickname : 'Игрок' }} выбирает слово...
        </div>
      </div>
    </div>
    <div v-if="isDrawer && store.room?.state === 'drawing'" class="canvas-toolbar">
      <button
        v-for="c in colors"
        :key="c"
        class="color-btn"
        :class="{ active: color === c && tool === 'brush' }"
        :style="{ background: c, borderColor: c === '#ffffff' ? '#666' : undefined }"
        @click="setColor(c)"
      />
      <span style="width:1px;height:24px;background:var(--border)" />
      <button
        v-for="s in sizes"
        :key="s"
        class="size-btn"
        :class="{ active: size === s }"
        @click="setSize(s)"
      >
        <span class="dot" :style="{ width: Math.max(4, s) + 'px', height: Math.max(4, s) + 'px' }"></span>
      </button>
      <span style="width:1px;height:24px;background:var(--border)" />
      <button
        class="tool-btn secondary"
        :class="{ active: tool === 'eraser' }"
        @click="setTool(tool === 'eraser' ? 'brush' : 'eraser')"
      >Ластик</button>
      <button class="tool-btn danger" @click="clearCanvas">Очистить</button>
    </div>
  </div>
</template>
