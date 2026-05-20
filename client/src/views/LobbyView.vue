<script setup>
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '../stores/userStore';
import { useGameStore } from '../stores/gameStore';
import { emitAck, getSocket } from '../composables/useSocket';

const router = useRouter();
const userStore = useUserStore();
const store = useGameStore();

const busy = ref(false);
const error = ref('');
const roomName = ref('');
const visibility = ref('public');
const settings = ref({ rounds: 3, turnSec: 80, hintsEnabled: true, maxPlayers: 8 });
const joinCode = ref('');

let pollTimer = null;

const rooms = computed(() => store.lobbyRooms);

async function refresh() {
  try {
    const res = await emitAck('lobby:list');
    if (res?.rooms) store.lobbyRooms = res.rooms;
  } catch (_) {}
}

async function createRoom() {
  busy.value = true;
  error.value = '';
  try {
    const res = await emitAck('room:create', {
      nickname: userStore.nickname,
      userId: userStore.ensureUserId(),
      name: roomName.value.trim(),
      isPublic: visibility.value === 'public',
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
    const res = await emitAck('room:join', {
      roomId: id,
      nickname: userStore.nickname,
      userId: userStore.ensureUserId(),
    });
    if (res?.ok) router.push(`/room/${res.roomId}`);
    else error.value = res?.error || 'Не удалось войти';
  } catch (_) {
    error.value = 'Ошибка соединения';
  } finally {
    busy.value = false;
  }
}

async function joinByCode() {
  const code = joinCode.value.trim().toUpperCase();
  if (code.length < 3) return;
  await join(code);
}

onMounted(() => {
  if (!userStore.nickname) {
    router.push('/');
    return;
  }
  const sock = getSocket();
  const subscribe = () => sock.emit('lobby:subscribe');
  if (sock.connected) subscribe();
  sock.on('connect', subscribe);
  refresh();
  pollTimer = setInterval(refresh, 2000);
});

onBeforeUnmount(() => {
  const sock = getSocket();
  sock.emit('lobby:unsubscribe');
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <main class="container lobby">
    <div class="lobby-grid">
      <section class="card panel-rooms">
        <div class="panel-header">
          <h2>Публичные комнаты</h2>
          <span class="muted count-pill">{{ rooms.length }}</span>
        </div>
        <p v-if="!rooms.length" class="muted empty-rooms">
          🎈 Пока пусто. Создай первую комнату или войди по коду!
        </p>
        <ul v-else class="rooms-list">
          <li v-for="r in rooms" :key="r.id" class="room-item">
            <div class="room-info">
              <div class="room-name">{{ r.name }}</div>
              <div class="muted room-meta">
                <span>👥 {{ r.playersCount }} / {{ r.maxPlayers }}</span>
                <span class="dot">·</span>
                <span :class="r.state === 'waiting' ? 'tag-wait' : 'tag-play'">
                  {{ r.state === 'waiting' ? 'ожидает' : 'идёт игра' }}
                </span>
              </div>
            </div>
            <button
              :disabled="busy || r.playersCount >= r.maxPlayers"
              @click="join(r.id)"
              class="join-btn"
            >Войти</button>
          </li>
        </ul>

        <div class="join-by-code">
          <input
            v-model="joinCode"
            placeholder="Код приватной комнаты"
            maxlength="6"
            style="text-transform:uppercase"
            :disabled="busy"
            @keydown.enter="joinByCode"
          />
          <button
            class="secondary"
            :disabled="joinCode.trim().length < 3 || busy"
            @click="joinByCode"
          >По коду</button>
        </div>
      </section>

      <section class="card panel-create">
        <h2>Создать комнату</h2>

        <div class="visibility-toggle" role="tablist">
          <button
            type="button"
            :class="{ active: visibility === 'public' }"
            @click="visibility = 'public'"
          >🌍 Публичная</button>
          <button
            type="button"
            :class="{ active: visibility === 'private' }"
            @click="visibility = 'private'"
          >🔒 Приватная</button>
        </div>
        <p class="muted vis-help">
          {{ visibility === 'public'
            ? 'Появится в списке выше — войдут все желающие.'
            : 'Только по коду или ссылке-приглашению.' }}
        </p>

        <label class="field">
          <span class="muted field-label">Название</span>
          <input v-model="roomName" :placeholder="`Комната ${userStore.nickname}`" maxlength="40" />
        </label>

        <div class="grid-2">
          <label class="field">
            <span class="muted field-label">Раундов</span>
            <select v-model.number="settings.rounds">
              <option :value="1">1</option>
              <option :value="2">2</option>
              <option :value="3">3</option>
              <option :value="5">5</option>
            </select>
          </label>
          <label class="field">
            <span class="muted field-label">Секунд на ход</span>
            <select v-model.number="settings.turnSec">
              <option :value="60">60</option>
              <option :value="80">80</option>
              <option :value="120">120</option>
            </select>
          </label>
          <div class="field">
            <span class="muted field-label">Подсказки</span>
            <label class="hint-toggle">
              <input type="checkbox" v-model="settings.hintsEnabled" />
              <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
              <span class="switch-text">{{ settings.hintsEnabled ? 'Включены' : 'Выключены' }}</span>
            </label>
          </div>
          <label class="field">
            <span class="muted field-label">Макс. игроков</span>
            <select v-model.number="settings.maxPlayers">
              <option :value="4">4</option>
              <option :value="6">6</option>
              <option :value="8">8</option>
              <option :value="12">12</option>
            </select>
          </label>
        </div>

        <button :disabled="busy" @click="createRoom" class="create-btn">
          Создать и войти
        </button>
        <p v-if="error" class="error">{{ error }}</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.lobby {
  padding: 1rem;
}
.lobby-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}
@media (min-width: 900px) {
  .lobby-grid {
    grid-template-columns: 3fr 2fr;
    align-items: start;
  }
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: .6rem;
}
.panel-header h2 { margin: 0; }
.count-pill {
  background: var(--bg-3);
  padding: .15rem .55rem;
  border-radius: 999px;
  font-size: .85rem;
}
.empty-rooms {
  text-align: center;
  padding: 1.5rem .5rem;
  background: var(--bg-2);
  border-radius: var(--radius-sm);
  border: 1px dashed var(--border);
  margin: 0 0 .8rem;
}
.rooms-list {
  list-style: none;
  margin: 0 0 .8rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: .5rem;
  max-height: 340px;
  overflow-y: auto;
}
.room-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-2);
  border-radius: var(--radius-sm);
  padding: .65rem .85rem;
  gap: .6rem;
  border: 1px solid transparent;
  transition: border-color .15s, transform .1s;
}
.room-item:hover {
  border-color: var(--primary);
}
.room-info { min-width: 0; flex: 1; }
.room-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.room-meta {
  font-size: .85rem;
  display: flex;
  gap: .35rem;
  align-items: center;
}
.tag-wait { color: var(--accent); }
.tag-play { color: var(--success); }
.dot { opacity: .5; }
.join-btn {
  padding: .45rem 1rem;
  min-height: 38px;
  flex: 0 0 auto;
}
.join-by-code {
  display: flex;
  gap: .4rem;
  padding-top: .8rem;
  border-top: 1px dashed var(--border);
}
.join-by-code input {
  letter-spacing: .15em;
  font-weight: 600;
}

.visibility-toggle {
  display: flex;
  gap: .4rem;
  background: var(--bg-2);
  padding: .25rem;
  border-radius: 999px;
  margin: .4rem 0 .3rem;
}
.visibility-toggle button {
  flex: 1;
  background: transparent;
  color: var(--text-dim);
  min-height: 38px;
  border-radius: 999px;
  font-size: .9rem;
}
.visibility-toggle button.active {
  background: var(--primary);
  color: #2b1d00;
}
.vis-help {
  font-size: .82rem;
  margin: 0 0 .8rem;
}
.field {
  display: block;
  margin-bottom: .6rem;
}
.field-label {
  display: block;
  font-size: .78rem;
  margin-bottom: .15rem;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: .5rem;
  margin-bottom: .6rem;
}
.create-btn {
  width: 100%;
  font-size: 1.05rem;
  padding: .85rem;
  background: linear-gradient(135deg, var(--primary), var(--primary-hover));
}
.hint-toggle {
  display: inline-flex;
  align-items: center;
  gap: .55rem;
  min-height: 44px;
}
.hint-toggle input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
}
.switch-track {
  width: 48px;
  height: 28px;
  border-radius: 999px;
  background: var(--bg-3);
  border: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  padding: 3px;
  transition: background .2s ease, border-color .2s ease;
}
.switch-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff7eb;
  box-shadow: 0 1px 4px rgba(0,0,0,.2);
  transition: transform .2s ease;
}
.hint-toggle input:checked + .switch-track {
  background: rgba(46, 139, 87, 0.25);
  border-color: var(--success);
}
.hint-toggle input:checked + .switch-track .switch-thumb {
  transform: translateX(20px);
  background: #f2ffec;
}
.switch-text {
  font-size: .9rem;
  font-weight: 600;
}
.error {
  color: var(--danger);
  margin: .6rem 0 0;
  font-size: .9rem;
}
</style>
