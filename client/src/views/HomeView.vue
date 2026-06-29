<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '../stores/userStore';
import { useGameStore } from '../stores/gameStore';
import { emitAck } from '../composables/useSocket';

const router = useRouter();
const userStore = useUserStore();
const store = useGameStore();

const nickname = ref(userStore.nickname);
const busy = ref(false);

const canPlay = computed(() => nickname.value.trim().length >= 2);

function play() {
  if (!canPlay.value) return;
  userStore.setNickname(nickname.value);
  router.push('/lobby');
}

async function playTest() {
  if (!canPlay.value || busy.value) return;
  userStore.setNickname(nickname.value);
  busy.value = true;
  try {
    const res = await emitAck('room:createTest', {
      nickname: userStore.nickname,
      userId: userStore.ensureUserId(),
    });
    if (res?.ok) {
      store.markJoinedRoom(res.roomId);
      router.push(`/room/${res.roomId}`);
    }
  } catch (_) {
    // ignore — пользователь может попробовать снова
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="center-screen">
    <div class="card home-card">
      <div class="brand">
        <div class="brand-emoji">🎨</div>
        <h1 class="brand-title">Скетч-Баттл</h1>
      </div>
      <p class="muted brand-sub">Рисуй слово — друзья угадывают в чате.</p>


      <div class="col" style="margin-top:1.2rem">
        <label class="field-stack">
          <span class="muted field-lbl">Как тебя зовут?</span>
          <input
            v-model="nickname"
            placeholder="Введите имя"
            maxlength="20"
            @keydown.enter="play"
            autocomplete="off"
          />
        </label>
        <button :disabled="!canPlay" @click="play" class="play-btn">
          🚀 Играть
        </button>
        <button :disabled="!canPlay || busy" @click="playTest" class="secondary test-btn">
          🧪 Тест с ботом
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.home-card {
  max-width: 460px;
  width: 100%;
  text-align: center;
  background: var(--surface);
}
.brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: .6rem;
}
.brand-emoji {
  font-size: 2.4rem;

}
.brand-title {
  margin: 0;
  font-size: 2rem;
  color: var(--primary);
}
.brand-sub {
  margin: .4rem 0 0;
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

}
.play-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}
</style>
