<script setup>
import { computed, ref } from 'vue';
import { useGameStore } from '../stores/gameStore';

const props = defineProps({
  variant: {
    type: String,
    default: 'list', // 'list' (десктоп, вертикальный) | 'strip' (мобильный, горизонтальный)
  },
});

const store = useGameStore();
const expanded = ref(false);

const avatarColors = [
  '#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1',
  '#a55eea', '#fd79a8', '#fab1a0', '#74b9ff',
];

function avatarFor(p) {
  let h = 0;
  for (const ch of p.id) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  const idx = Math.abs(h) % avatarColors.length;
  return avatarColors[idx];
}

function initials(name) {
  const trimmed = (name || '?').trim();
  return trimmed.slice(0, 2).toUpperCase();
}

const players = computed(() => store.sortedPlayers);

function floatFor(playerId) {
  return store.floatingPoints.filter((f) => f.playerId === playerId);
}

function toggleExpanded() {
  expanded.value = !expanded.value;
}
</script>

<template>
  <!-- Десктоп: полный вертикальный список -->
  <div v-if="variant === 'list'" class="players-card">
    <h3 class="players-title">
      <span>Игроки</span>
      <span class="muted players-count">{{ players.length }}</span>
    </h3>
    <TransitionGroup tag="ul" name="player" class="players">
      <li
        v-for="(p, idx) in players"
        :key="p.id"
        :class="{
          drawer: store.room?.drawerId === p.id,
          self: store.myId === p.id,
          guessed: p.hasGuessed,
        }"
      >
        <div class="rank">{{ idx + 1 }}</div>
        <div class="avatar" :style="{ background: avatarFor(p) }">
          {{ initials(p.nickname) }}
          <span v-if="store.room?.drawerId === p.id" class="pencil">✏️</span>
        </div>
        <div class="info">
          <div class="name-row">
            <span class="name">{{ p.nickname }}</span>
            <span v-if="store.myId === p.id" class="badge you">я</span>
            <span v-if="store.room?.hostId === p.id" class="badge host">★</span>
          </div>
          <div class="tags-row">
            <span v-if="store.room?.drawerId === p.id" class="badge drawer">рисует</span>
            <span v-if="p.hasGuessed && store.room?.state === 'drawing'" class="badge guessed">✓ угадал</span>
            <span v-if="p.isConnected === false" class="badge offline">offline</span>
          </div>
        </div>
        <div class="score-wrap">
          <span class="score">{{ p.score }}</span>
          <transition-group name="float" tag="div" class="float-container">
            <span v-for="f in floatFor(p.id)" :key="f.id" class="float-pt">{{ f.text }}</span>
          </transition-group>
        </div>
      </li>
    </TransitionGroup>
  </div>

  <!-- Мобильный/планшет: компактная горизонтальная полоса + разворот -->
  <div v-else class="players-strip-wrap">
    <TransitionGroup tag="div" name="player" class="players-strip" @click="toggleExpanded">
      <div
        v-for="p in players"
        :key="p.id"
        class="chip"
        :class="{
          drawer: store.room?.drawerId === p.id,
          self: store.myId === p.id,
          guessed: p.hasGuessed,
          offline: p.isConnected === false,
        }"
      >
        <div class="chip-avatar" :style="{ background: avatarFor(p) }">
          {{ initials(p.nickname) }}
          <span v-if="store.room?.drawerId === p.id" class="chip-pencil">✏️</span>
          <span v-else-if="p.hasGuessed && store.room?.state === 'drawing'" class="chip-check">✓</span>
        </div>
        <div class="chip-meta">
          <span class="chip-name">{{ p.nickname }}</span>
          <span class="chip-score">{{ p.score }}</span>
        </div>
        <div class="chip-floats">
          <transition-group name="float" tag="div">
            <span v-for="f in floatFor(p.id)" :key="f.id" class="float-pt">{{ f.text }}</span>
          </transition-group>
        </div>
      </div>
    </TransitionGroup>
    <button class="strip-toggle" @click="toggleExpanded" :aria-expanded="expanded">
      {{ expanded ? '▲' : '▼' }}
    </button>

    <transition name="sheet">
      <div v-if="expanded" class="strip-sheet">
        <ul class="sheet-list">
          <li
            v-for="(p, idx) in players"
            :key="p.id"
            :class="{ drawer: store.room?.drawerId === p.id, self: store.myId === p.id }"
          >
            <span class="rank">{{ idx + 1 }}</span>
            <span class="avatar sm" :style="{ background: avatarFor(p) }">{{ initials(p.nickname) }}</span>
            <span class="name">{{ p.nickname }}</span>
            <span v-if="store.room?.hostId === p.id" class="badge host">★</span>
            <span v-if="store.room?.drawerId === p.id" class="badge drawer">рисует</span>
            <span v-if="p.hasGuessed && store.room?.state === 'drawing'" class="badge guessed">✓</span>
            <span v-if="p.isConnected === false" class="badge offline">off</span>
            <span class="score">{{ p.score }}</span>
          </li>
        </ul>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.players-card {
  background: rgba(255, 250, 242, 0.84);
  backdrop-filter: blur(6px);
  border-radius: var(--radius);
  padding: .8rem;
}
.players-title {
  margin: 0 0 .6rem 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.players-count {
  font-size: .82rem;
  background: var(--bg-3);
  padding: .1rem .5rem;
  border-radius: 999px;
  font-weight: 600;
}
.players {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: .35rem;
}
.players li {
  background: var(--bg-2);
  border-radius: var(--radius-sm);
  padding: .45rem .55rem;
  display: flex;
  align-items: center;
  gap: .5rem;
  border: 1px solid transparent;
  transition: border-color .2s, background .2s;
  position: relative;
}
.players li.drawer {
  border-color: var(--success);
  background: linear-gradient(90deg, rgba(46, 204, 113, 0.15), var(--bg-2));
}
.players li.guessed {
  background: rgba(46, 204, 113, 0.15);
}
.players li.self {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.rank {
  font-weight: 700;
  font-size: .85rem;
  width: 1.2rem;
  color: var(--text-dim);
  text-align: center;
  flex: 0 0 auto;
}
.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: white;
  font-size: .8rem;
  flex: 0 0 34px;
  position: relative;
  letter-spacing: -0.5px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
.avatar.sm {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  font-size: .72rem;
}
.pencil {
  position: absolute;
  bottom: -4px;
  right: -4px;
  font-size: .85rem;
  background: var(--surface);
  border-radius: 50%;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.info {
  display: flex;
  flex-direction: column;
  gap: .15rem;
  min-width: 0;
  flex: 1 1 auto;
}
.name-row {
  display: flex;
  align-items: center;
  gap: .25rem;
}
.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: .95rem;
}
.tags-row {
  display: flex;
  gap: .25rem;
  flex-wrap: wrap;
}
.score-wrap {
  position: relative;
  flex: 0 0 auto;
}
.score {
  font-weight: 700;
  color: var(--accent);
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
}
.float-container {
  position: absolute;
  right: 0;
  top: -1.6rem;
  pointer-events: none;
}
.float-pt {
  position: absolute;
  right: 0;
  font-weight: 700;
  color: var(--success);
  font-size: .9rem;
  white-space: nowrap;
}
.float-enter-active {
  transition: all 1.2s ease-out;
}
.float-leave-active { transition: opacity .3s; }
.float-enter-from {
  opacity: 0;
  transform: translateY(0);
}
.float-enter-to {
  opacity: 1;
  transform: translateY(-1.6rem);
}
.float-leave-from { opacity: 1; }
.float-leave-to { opacity: 0; }
.badge.host { background: var(--accent); color: #2b1d00; padding: 0 .35rem; }
.badge.offline { background: var(--bg-3); color: var(--text-dim); }

/* Плавная пересортировка строк при смене очков (FLIP) */
.player-move {
  transition: transform .45s cubic-bezier(0.22, 1, 0.36, 1);
}
.player-enter-active {
  transition: opacity .3s ease, transform .3s ease;
}
.player-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}

/* ===== Вариант «полоса» (мобильный/планшет) ===== */
.players-strip-wrap {
  position: relative;
}
.players-strip {
  display: flex;
  gap: .4rem;
  overflow-x: auto;
  overflow-y: visible;
  padding: .35rem 2.2rem .35rem .35rem;
  background: rgba(255, 250, 242, 0.9);
  backdrop-filter: blur(6px);
  border-radius: var(--radius-sm);
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  cursor: pointer;
}
.players-strip::-webkit-scrollbar { display: none; }
.chip {
  display: flex;
  align-items: center;
  gap: .35rem;
  background: var(--bg-2);
  border: 1px solid transparent;
  border-radius: 999px;
  padding: .2rem .55rem .2rem .2rem;
  flex: 0 0 auto;
  position: relative;
  transition: border-color .2s, background .2s;
}
.chip.drawer {
  border-color: var(--success);
  background: linear-gradient(90deg, rgba(46, 204, 113, 0.2), var(--bg-2));
}
.chip.guessed { background: rgba(46, 204, 113, 0.18); }
.chip.self { outline: 2px solid var(--primary); outline-offset: -2px; }
.chip.offline { opacity: .55; }
.chip-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #fff;
  font-size: .72rem;
  flex: 0 0 28px;
  position: relative;
  text-shadow: 0 1px 2px rgba(0,0,0,.2);
}
.chip-pencil,
.chip-check {
  position: absolute;
  bottom: -3px;
  right: -3px;
  font-size: .6rem;
  background: var(--surface);
  border-radius: 50%;
  width: 15px;
  height: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chip-check { color: var(--success); font-weight: 800; }
.chip-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.05;
  min-width: 0;
}
.chip-name {
  font-size: .72rem;
  font-weight: 600;
  max-width: 5.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-score {
  font-size: .82rem;
  font-weight: 700;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.chip-floats {
  position: relative;
  width: 0;
}
.chip-floats .float-pt { top: -1.2rem; }
.strip-toggle {
  position: absolute;
  top: 50%;
  right: .25rem;
  transform: translateY(-50%);
  width: 30px;
  height: 30px;
  min-height: 30px;
  padding: 0;
  border-radius: 999px;
  background: var(--bg-3);
  color: var(--text-dim);
  font-size: .7rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.strip-sheet {
  position: absolute;
  top: calc(100% + .35rem);
  left: 0;
  right: 0;
  z-index: 60;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  padding: .4rem;
  max-height: 50vh;
  overflow-y: auto;
}
.sheet-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: .25rem;
}
.sheet-list li {
  display: flex;
  align-items: center;
  gap: .4rem;
  background: var(--bg-2);
  border-radius: var(--radius-sm);
  padding: .35rem .5rem;
}
.sheet-list li.drawer { background: linear-gradient(90deg, rgba(46,204,113,.15), var(--bg-2)); }
.sheet-list li.self { outline: 2px solid var(--primary); outline-offset: -2px; }
.sheet-list .name { flex: 1; font-size: .9rem; }
.sheet-list .score { margin-left: auto; }
.sheet-enter-active, .sheet-leave-active { transition: opacity .18s ease, transform .18s ease; }
.sheet-enter-from, .sheet-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
