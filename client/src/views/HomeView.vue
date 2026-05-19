<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '../stores/userStore';

const router = useRouter();
const userStore = useUserStore();

const nickname = ref(userStore.nickname);

const canPlay = computed(() => nickname.value.trim().length >= 2);

function play() {
  if (!canPlay.value) return;
  userStore.setNickname(nickname.value);
  router.push('/lobby');
}
</script>

<template>
  <main class="center-screen">
    <div class="card home-card">
      <div class="brand">
        <div class="brand-emoji">🎨</div>
        <h1 class="brand-title">Крокодил</h1>
      </div>
      <p class="muted brand-sub">Рисуй слово — друзья угадывают в чате. По очереди, всем весело.</p>

      <div class="features">
        <span>🎯 Угадывай</span>
        <span>⏱️ Таймер</span>
        <span>🏆 Очки</span>
        <span>📱 С телефона</span>
      </div>

      <div class="col" style="margin-top:1.2rem">
        <label class="field-stack">
          <span class="muted field-lbl">Как тебя зовут?</span>
          <input
            v-model="nickname"
            placeholder="Например, Аня"
            maxlength="20"
            @keydown.enter="play"
            autocomplete="off"
          />
        </label>
        <button :disabled="!canPlay" @click="play" class="play-btn">
          🚀 Играть
        </button>
        <p class="muted hint">Тебя ждёт лобби с публичными комнатами и возможностью создать свою.</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.home-card {
  max-width: 460px;
  width: 100%;
  text-align: center;
  background: linear-gradient(160deg, var(--surface), var(--bg-2));
}
.brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: .6rem;
}
.brand-emoji {
  font-size: 2.4rem;
  filter: drop-shadow(0 4px 12px rgba(124, 108, 255, 0.5));
  animation: bob 3s ease-in-out infinite;
}
.brand-title {
  margin: 0;
  font-size: 2rem;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.brand-sub {
  margin: .4rem 0 0;
}
.features {
  display: flex;
  flex-wrap: wrap;
  gap: .35rem;
  justify-content: center;
  margin: 1rem 0 0;
}
.features span {
  background: var(--bg-2);
  border: 1px solid var(--border);
  padding: .25rem .65rem;
  border-radius: 999px;
  font-size: .82rem;
  color: var(--text-dim);
}
.field-stack {
  text-align: left;
}
.field-lbl {
  display: block;
  font-size: .82rem;
  margin-bottom: .25rem;
}
.play-btn {
  font-size: 1.15rem;
  padding: 1rem;
  background: linear-gradient(135deg, var(--primary), var(--primary-hover));
  box-shadow: 0 6px 20px rgba(124, 108, 255, 0.4);
}
.play-btn:hover:not(:disabled) {
  box-shadow: 0 8px 24px rgba(124, 108, 255, 0.55);
  transform: translateY(-1px);
}
.hint {
  font-size: .82rem;
  text-align: center;
  margin: .2rem 0 0;
}
@keyframes bob {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50% { transform: translateY(-4px) rotate(3deg); }
}
</style>
