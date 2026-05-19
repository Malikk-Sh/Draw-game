<script setup>
import { computed } from 'vue';
import { useGameStore } from '../stores/gameStore';

const store = useGameStore();

const display = computed(() => {
  if (!store.room || store.room.state !== 'drawing') return '';
  if (store.isDrawer && store.wordToDraw) return store.wordToDraw;
  return store.maskedWord || '';
});

const subtitle = computed(() => {
  if (!store.room) return '';
  if (store.room.state === 'drawing') {
    if (store.isDrawer) return 'Ты рисуешь:';
    return 'Угадывай слово:';
  }
  if (store.room.state === 'round_end' && store.lastTurnEnd?.word) {
    return `Слово было: ${store.lastTurnEnd.word}`;
  }
  return '';
});
</script>

<template>
  <div class="word-display" v-if="subtitle">
    <div class="subtitle muted">{{ subtitle }}</div>
    <div v-if="store.room?.state === 'drawing'" class="word">
      <span v-for="(ch, i) in display.split('')" :key="i" class="letter">
        {{ ch === '_' ? '_' : ch }}
      </span>
      <span class="length-hint muted">({{ store.room.wordLength || display.length }})</span>
    </div>
  </div>
</template>

<style scoped>
.word-display {
  text-align: center;
  padding: .4rem 0;
}
.subtitle {
  font-size: .82rem;
  margin-bottom: .2rem;
}
.word {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: .15em;
  text-transform: uppercase;
  display: inline-flex;
  align-items: center;
  gap: .15em;
  flex-wrap: wrap;
  justify-content: center;
}
.letter {
  display: inline-block;
  min-width: .6em;
}
.length-hint {
  font-size: .85rem;
  font-weight: 400;
  margin-left: .5em;
  letter-spacing: 0;
  text-transform: none;
}
</style>
