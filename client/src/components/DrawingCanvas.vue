<script setup>
import { ref, computed } from 'vue';
import { useGameStore } from '../stores/gameStore';
import { useCanvas } from '../composables/useCanvas';

const store = useGameStore();
const canvasRef = ref(null);
const isDrawer = computed(() => store.isDrawer);

const {
  color, size, tool,
  undoCount, redoCount,
  setColor, setSize, setTool,
  clearCanvas, undo, redo,
} = useCanvas(canvasRef, { isDrawer, store });

const colors = [
  '#1a1a1a', '#ffffff',
  '#e74c3c', '#e67e22', '#f1c40f',
  '#2ecc71', '#1abc9c',
  '#3498db', '#9b59b6', '#ff7ed4',
  '#8b4513', '#7f8c8d',
];
const sizes = [2, 5, 10, 18, 28];
</script>

<template>
  <div class="canvas-block">
    <div class="canvas-wrap">
      <canvas ref="canvasRef"></canvas>
      <transition name="overlay">
        <div
          v-if="store.room && store.room.state !== 'drawing'"
          class="canvas-overlay"
        >
          <div v-if="store.room.state === 'waiting'" class="overlay-content">
            <div class="overlay-emoji">⏳</div>
            <p>Ожидание игроков</p>
            <p class="muted">Минимум 2 для начала</p>
          </div>
          <div v-else-if="store.room.state === 'choosing'" class="overlay-content">
            <div class="overlay-emoji">💭</div>
            <p v-if="!isDrawer">
              {{ store.drawer ? store.drawer.nickname : 'Игрок' }} выбирает слово...
            </p>
            <p v-else>Выбери слово в окне выше</p>
          </div>
          <div v-else-if="store.room.state === 'round_end'" class="overlay-content">
            <div class="overlay-emoji">🎬</div>
            <p>Раунд завершён</p>
            <p class="muted" v-if="store.lastTurnEnd?.word">Слово было: <b>{{ store.lastTurnEnd.word }}</b></p>
          </div>
          <div v-else-if="store.room.state === 'game_end'" class="overlay-content">
            <div class="overlay-emoji">🏆</div>
            <p>Игра окончена</p>
          </div>
        </div>
      </transition>
    </div>

    <div v-if="isDrawer && store.room?.state === 'drawing'" class="canvas-toolbar">
      <div class="tools-row">
        <div class="colors-grid">
          <button
            v-for="c in colors"
            :key="c"
            class="color-btn"
            :class="{ active: color === c && tool === 'brush' }"
            :style="{ background: c }"
            :aria-label="'Цвет ' + c"
            @click="setColor(c)"
          />
        </div>
        <div class="divider" />
        <div class="sizes-row">
          <button
            v-for="s in sizes"
            :key="s"
            class="size-btn"
            :class="{ active: size === s }"
            :aria-label="'Размер ' + s"
            @click="setSize(s)"
          >
            <span class="dot" :style="{
              width: Math.min(22, Math.max(4, s)) + 'px',
              height: Math.min(22, Math.max(4, s)) + 'px',
              background: tool === 'eraser' ? '#888' : color
            }"></span>
          </button>
        </div>
      </div>

      <div class="actions-row">
        <button
          class="action-btn"
          :class="{ active: tool === 'eraser' }"
          @click="setTool(tool === 'eraser' ? 'brush' : 'eraser')"
          aria-label="Ластик"
        >
          <span class="ico">🩹</span><span class="lbl">Ластик</span>
        </button>
        <button
          class="action-btn"
          :disabled="undoCount === 0"
          @click="undo"
          aria-label="Отменить (Ctrl+Z)"
          title="Отменить (Ctrl+Z)"
        >
          <span class="ico">↶</span><span class="lbl">Отменить</span>
        </button>
        <button
          class="action-btn"
          :disabled="redoCount === 0"
          @click="redo"
          aria-label="Вернуть (Ctrl+Y)"
          title="Вернуть (Ctrl+Y)"
        >
          <span class="ico">↷</span><span class="lbl">Вернуть</span>
        </button>
        <button class="action-btn danger" @click="clearCanvas" aria-label="Очистить">
          <span class="ico">🗑</span><span class="lbl">Очистить</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.canvas-block {
  display: flex;
  flex-direction: column;
  gap: .5rem;
}
.overlay-content {
  text-align: center;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: .2rem;
}
.overlay-emoji {
  font-size: 2.4rem;
  margin-bottom: .2rem;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.3));
}
.overlay-content p { margin: 0; }
.overlay-enter-active, .overlay-leave-active {
  transition: opacity .25s;
}
.overlay-enter-from, .overlay-leave-to { opacity: 0; }

.tools-row, .actions-row {
  display: flex;
  gap: .4rem;
  align-items: center;
  flex-wrap: wrap;
}
.actions-row {
  margin-top: .35rem;
}
.colors-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: .25rem;
  flex: 1;
}
@media (min-width: 600px) {
  .colors-grid {
    display: flex;
    flex: 0 1 auto;
  }
}
.divider {
  width: 1px;
  height: 28px;
  background: var(--border);
  margin: 0 .15rem;
}
.sizes-row {
  display: flex;
  gap: .25rem;
  flex: 0 0 auto;
}
.size-btn {
  background: var(--bg-3);
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
}
.size-btn.active {
  border-color: var(--primary);
  background: var(--bg-2);
}
.size-btn .dot {
  border-radius: 50%;
  display: inline-block;
}
.color-btn {
  width: 32px;
  height: 32px;
}
.color-btn.active {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.action-btn {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  padding: .45rem .7rem;
  min-height: 38px;
  background: var(--bg-3);
  color: var(--text);
  font-size: .85rem;
  font-weight: 500;
  border: 1px solid transparent;
  flex: 1 1 auto;
  justify-content: center;
}
.action-btn:hover:not(:disabled) {
  background: var(--border);
}
.action-btn.active {
  background: var(--primary);
  color: #2b1d00;
}
.action-btn.danger {
  background: rgba(255, 107, 107, 0.15);
  color: var(--danger);
}
.action-btn.danger:hover:not(:disabled) {
  background: var(--danger);
  color: #2b1d00;
}
.action-btn .ico {
  font-size: 1.05rem;
  line-height: 1;
}
@media (max-width: 480px) {
  .action-btn .lbl { display: none; }
  .action-btn { flex: 1 1 0; padding: .5rem; }
  .action-btn .ico { font-size: 1.3rem; }
}
</style>
