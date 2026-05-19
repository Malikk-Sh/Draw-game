<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '../stores/userStore';
import { emitAck, getSocket } from '../composables/useSocket';

const router = useRouter();
const userStore = useUserStore();

const rooms = ref([]);
const busy = ref(false);
const error = ref('');
const roomName = ref('');
const settings = ref({ rounds: 3, turnSec: 80, hintsCount: 2, maxPlayers: 8 });
const showCreate = ref(false);

let refreshTimer = null;

async function refresh() {
  try {
    const res = await emitAck('lobby:list');
    rooms.value = res?.rooms || [];
  } catch (_) {
    /* ignore */
  }
}

async function createPublic() {
  busy.value = true;
  error.value = '';
  try {
    const res = await emitAck('room:create', {
      nickname: userStore.nickname,
      name: roomName.value.trim(),
      isPublic: true,
      settings: settings.value,
    });
    if (res?.ok) {
      router.push(`/room/${res.roomId}`);
    } else {
      error.value = res?.error || 'Не удалось создать';
    }
  } catch (_) {
    error.value = 'Ошибка соединения';
  } finally {
    busy.value = false;
  }
}

async function join(id) {
  busy.value = true;
  error.value = '';
  try {
    const res = await emitAck('room:join', { roomId: id, nickname: userStore.nickname });
    if (res?.ok) router.push(`/room/${res.roomId}`);
    else error.value = res?.error || 'Не удалось войти';
  } catch (_) {
    error.value = 'Ошибка соединения';
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (!userStore.nickname) {
    router.push('/');
    return;
  }
  getSocket();
  refresh();
  refreshTimer = setInterval(refresh, 4000);
});

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <main class="container">
    <div class="lobby-grid">
      <section class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:.6rem">
          <h2 style="margin:0">Публичные комнаты</h2>
          <button class="ghost" @click="refresh" style="padding:.4rem .8rem;min-height:36px">↻</button>
        </div>
        <p v-if="!rooms.length" class="muted">Пока пусто. Создай первую комнату!</p>
        <ul v-else class="rooms-list">
          <li v-for="r in rooms" :key="r.id" class="room-item">
            <div>
              <div style="font-weight:600">{{ r.name }}</div>
              <div class="muted" style="font-size:.85rem">
                {{ r.playersCount }} / {{ r.maxPlayers }} игроков ·
                <span v-if="r.state === 'waiting'">ожидает</span>
                <span v-else>идёт игра</span>
              </div>
            </div>
            <button
              :disabled="busy || r.playersCount >= r.maxPlayers"
              @click="join(r.id)"
              style="padding:.4rem .9rem;min-height:36px"
            >Войти</button>
          </li>
        </ul>
      </section>

      <section class="card">
        <h2 style="margin-top:0">Создать комнату</h2>
        <button v-if="!showCreate" class="secondary" @click="showCreate = true">
          Настроить и создать
        </button>
        <div v-else class="col">
          <label>
            <span class="muted" style="font-size:.85rem">Название</span>
            <input v-model="roomName" :placeholder="`Комната ${userStore.nickname}`" maxlength="40" />
          </label>
          <div class="row" style="gap:.6rem;flex-wrap:wrap">
            <label style="flex:1;min-width:120px">
              <span class="muted" style="font-size:.85rem">Раундов</span>
              <select v-model.number="settings.rounds">
                <option :value="1">1</option>
                <option :value="2">2</option>
                <option :value="3">3</option>
                <option :value="5">5</option>
              </select>
            </label>
            <label style="flex:1;min-width:120px">
              <span class="muted" style="font-size:.85rem">Секунд на ход</span>
              <select v-model.number="settings.turnSec">
                <option :value="60">60</option>
                <option :value="80">80</option>
                <option :value="120">120</option>
              </select>
            </label>
            <label style="flex:1;min-width:120px">
              <span class="muted" style="font-size:.85rem">Подсказок</span>
              <select v-model.number="settings.hintsCount">
                <option :value="0">0</option>
                <option :value="1">1</option>
                <option :value="2">2</option>
                <option :value="3">3</option>
              </select>
            </label>
            <label style="flex:1;min-width:120px">
              <span class="muted" style="font-size:.85rem">Макс. игроков</span>
              <select v-model.number="settings.maxPlayers">
                <option :value="4">4</option>
                <option :value="6">6</option>
                <option :value="8">8</option>
                <option :value="12">12</option>
              </select>
            </label>
          </div>
          <button :disabled="busy" @click="createPublic">Создать публичную</button>
        </div>
        <p v-if="error" style="color:var(--danger);margin-top:.6rem">{{ error }}</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.lobby-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}
@media (min-width: 900px) {
  .lobby-grid {
    grid-template-columns: 3fr 2fr;
  }
}
.rooms-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: .5rem;
}
.room-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-2);
  border-radius: var(--radius-sm);
  padding: .6rem .8rem;
  gap: .6rem;
}
</style>
