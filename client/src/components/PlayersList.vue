<script setup>
import { useGameStore } from '../stores/gameStore';

const store = useGameStore();
</script>

<template>
  <div class="players-card">
    <h3 style="margin:0 0 .6rem 0">Игроки</h3>
    <ul class="players">
      <li
        v-for="p in store.sortedPlayers"
        :key="p.id"
        :class="{
          drawer: store.room?.drawerId === p.id,
          self: store.myId === p.id,
          guessed: p.hasGuessed,
        }"
      >
        <div class="info">
          <span class="name">{{ p.nickname }}</span>
          <div class="tags">
            <span v-if="store.myId === p.id" class="badge you">я</span>
            <span v-if="store.room?.hostId === p.id" class="badge host">хост</span>
            <span v-if="store.room?.drawerId === p.id" class="badge drawer">рисует</span>
            <span v-if="p.hasGuessed && store.room?.state === 'drawing'" class="badge guessed">✓</span>
          </div>
        </div>
        <span class="score">{{ p.score }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.players-card {
  background: var(--surface);
  border-radius: var(--radius);
  padding: .8rem;
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
  padding: .45rem .65rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .5rem;
}
.players li.drawer {
  outline: 2px solid var(--success);
}
.players li.guessed {
  background: rgba(46, 204, 113, 0.15);
}
.info {
  display: flex;
  flex-direction: column;
  gap: .2rem;
  min-width: 0;
}
.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tags {
  display: flex;
  gap: .25rem;
  flex-wrap: wrap;
}
.score {
  font-weight: 700;
  color: var(--accent);
  font-size: 1.05rem;
}
</style>
