<script setup>
import { computed } from 'vue';
import { useGameStore } from '../stores/gameStore';

const store = useGameStore();

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
</script>

<template>
  <div class="players-card">
    <h3 class="players-title">
      <span>Игроки</span>
      <span class="muted players-count">{{ players.length }}</span>
    </h3>
    <ul class="players">
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
    </ul>
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
</style>
