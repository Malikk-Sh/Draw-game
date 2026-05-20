<script setup>
import { computed } from 'vue';
import { useGameStore } from '../stores/gameStore';

const store = useGameStore();

const display = computed(() => {
  if (!store.room || store.room.state !== 'drawing') return '';
  if (store.isDrawer && store.wordToDraw) return store.wordToDraw;
  if (!store.room?.settings?.hintsEnabled) return '';
  return store.maskedWord || '';
});

const subtitle = computed(() => {
  if (!store.room) return '';
  if (store.room.state === 'drawing') {
    if (store.isDrawer) return 'Ты рисуешь';
    return 'Угадывай слово';
  }
  if (store.room.state === 'round_end' && store.lastTurnEnd?.word) {
    return `Слово было: ${store.lastTurnEnd.word}`;
  }
  return '';
});

const wordLength = computed(() => {
  if (!store.room) return 0;
  if (!store.room.settings?.hintsEnabled) return 0;
  return store.room.wordLength || display.value.replace(/\s/g, '').length;
});
</script>

<template>
  <div class="word-display" v-if="subtitle">
    <div class="subtitle">{{ subtitle }}</div>
    <div v-if="store.room?.state === 'drawing' && (store.isDrawer || store.room?.settings?.hintsEnabled)" class="word">
      <span v-for="(ch, i) in display.split('')" :key="i" class="letter" :class="{ revealed: ch !== '_' && ch !== ' ' }">
        {{ ch === '_' ? '_' : ch === ' ' ? ' ' : ch }}
      </span>
      <span v-if="wordLength" class="length-hint">({{ wordLength }})</span>
    </div>
  </div>
</template>

<style scoped>
.word-display {
  text-align: center;
  padding: .25rem 0;
}
.subtitle {
  font-size: .82rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: .1em;
  margin-bottom: .25rem;
}
.word {
  font-size: 1.55rem;
  font-weight: 700;
  letter-spacing: .15em;
  text-transform: uppercase;
  display: inline-flex;
  align-items: baseline;
  gap: .12em;
  flex-wrap: wrap;
  justify-content: center;
}
.letter {
  display: inline-block;
  min-width: .8em;
  color: var(--text);
  opacity: .5;
  transition: opacity .3s, color .3s;
}
.letter.revealed {
  opacity: 1;
  color: var(--accent);
}
.length-hint {
  font-size: .85rem;
  font-weight: 400;
  margin-left: .5em;
  letter-spacing: 0;
  text-transform: none;
  color: var(--text-dim);
}
@media (max-width: 480px) {
  .word { font-size: 1.25rem; }
}
</style>
