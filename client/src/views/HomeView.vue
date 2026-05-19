<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '../stores/userStore';
import { useGameStore } from '../stores/gameStore';
import { emitAck } from '../composables/useSocket';

const router = useRouter();
const userStore = useUserStore();
const gameStore = useGameStore();

const nickname = ref(userStore.nickname);
const joinCode = ref('');
const busy = ref(false);
const error = ref('');

const canPlay = computed(() => nickname.value.trim().length >= 2);

async function goPublicLobby() {
  if (!canPlay.value) return;
  userStore.setNickname(nickname.value);
  router.push('/lobby');
}

async function createPrivate() {
  if (!canPlay.value) return;
  userStore.setNickname(nickname.value);
  busy.value = true;
  error.value = '';
  try {
    const res = await emitAck('room:create', {
      nickname: nickname.value,
      isPublic: false,
      settings: {},
    });
    if (res && res.ok) {
      router.push(`/room/${res.roomId}`);
    } else {
      error.value = (res && res.error) || 'Не удалось создать комнату';
    }
  } catch (e) {
    error.value = 'Ошибка соединения';
  } finally {
    busy.value = false;
  }
}

async function joinByCode() {
  const code = joinCode.value.trim().toUpperCase();
  if (!canPlay.value || code.length < 3) return;
  userStore.setNickname(nickname.value);
  busy.value = true;
  error.value = '';
  try {
    const res = await emitAck('room:join', {
      roomId: code,
      nickname: nickname.value,
    });
    if (res && res.ok) {
      router.push(`/room/${res.roomId}`);
    } else {
      error.value = (res && res.error) || 'Не удалось войти';
    }
  } catch (e) {
    error.value = 'Ошибка соединения';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="center-screen">
    <div class="card home-card">
      <h1>🎨 Крокодил</h1>
      <p class="muted">Рисуй слово — друзья угадывают в чате. По очереди, всем весело.</p>

      <div class="col" style="margin-top:1rem">
        <label>
          <span class="muted" style="font-size:.85rem">Твой ник</span>
          <input
            v-model="nickname"
            placeholder="Например, Аня"
            maxlength="20"
            :disabled="busy"
            @keydown.enter="goPublicLobby"
          />
        </label>

        <button :disabled="!canPlay || busy" @click="goPublicLobby">
          Открыть лобби
        </button>

        <div class="separator"><span>или</span></div>

        <button class="secondary" :disabled="!canPlay || busy" @click="createPrivate">
          Создать приватную комнату
        </button>

        <div class="row" style="gap:.4rem">
          <input
            v-model="joinCode"
            placeholder="Код комнаты (ABCD)"
            maxlength="6"
            style="text-transform:uppercase"
            :disabled="busy"
            @keydown.enter="joinByCode"
          />
          <button
            class="secondary"
            style="flex:0 0 auto"
            :disabled="!canPlay || joinCode.trim().length < 3 || busy"
            @click="joinByCode"
          >Войти</button>
        </div>

        <p v-if="error" style="color:var(--danger);margin:0">{{ error }}</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.home-card {
  max-width: 460px;
  width: 100%;
}
.separator {
  display: flex;
  align-items: center;
  gap: .6rem;
  color: var(--text-dim);
  font-size: .85rem;
  margin: .2rem 0;
}
.separator::before,
.separator::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
</style>
