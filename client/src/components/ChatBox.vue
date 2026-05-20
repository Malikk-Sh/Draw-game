<script setup>
import { ref, nextTick, watch, computed } from 'vue';
import { useGameStore } from '../stores/gameStore';
import { getSocket } from '../composables/useSocket';

const store = useGameStore();
const text = ref('');
const listRef = ref(null);

function send() {
  const t = text.value.trim();
  if (!t) return;
  getSocket().emit('chat:send', { text: t });
  text.value = '';
}

const placeholder = computed(() => {
  if (store.isDrawer) return 'Ты рисуешь — чат недоступен';
  if (store.room?.state === 'drawing') return 'Введи догадку...';
  return 'Сообщение...';
});

watch(
  () => store.messages.length,
  async () => {
    await nextTick();
    if (listRef.value) {
      listRef.value.scrollTop = listRef.value.scrollHeight;
    }
  },
);
</script>

<template>
  <div class="chat-box">
    <div class="chat-list" ref="listRef">
      <p v-if="!store.messages.length" class="empty-chat muted">
        💬 Здесь будут сообщения и догадки
      </p>
      <div
        v-for="m in store.messages"
        :key="m._key"
        class="chat-msg"
        :class="m.kind"
      >
        <template v-if="m.kind === 'system'">
          <span class="system-dot">●</span><em>{{ m.text }}</em>
        </template>
        <template v-else-if="m.kind === 'close'">
          <span class="close-icon">🔥</span> {{ m.text }}
        </template>
        <template v-else>
          <b>{{ m.nickname }}:</b> <span>{{ m.text }}</span>
        </template>
      </div>
    </div>
    <form class="chat-input" @submit.prevent="send">
      <input
        v-model="text"
        :placeholder="placeholder"
        :disabled="store.isDrawer"
        maxlength="200"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="submit" :disabled="store.isDrawer || !text.trim()" aria-label="Отправить">
        ➤
      </button>
    </form>
  </div>
</template>

<style scoped>
.chat-box {
  display: flex;
  flex-direction: column;
  background: rgba(255, 250, 242, 0.84);
  backdrop-filter: blur(6px);
  border-radius: var(--radius);
  height: 100%;
  min-height: 240px;
  overflow: hidden;
}
.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: .6rem .8rem;
  display: flex;
  flex-direction: column;
  gap: .25rem;
  font-size: .92rem;
  scroll-behavior: smooth;
}
.empty-chat {
  text-align: center;
  padding: 1.5rem .5rem;
  margin: 0;
}
.chat-msg {
  animation: slide-in .25s ease-out;
  padding: .15rem 0;
  word-wrap: break-word;
}
.chat-msg.system {
  color: var(--text-dim);
  font-style: italic;
  font-size: .85rem;
  padding: .25rem 0;
  display: flex;
  gap: .35rem;
  align-items: center;
}
.system-dot { color: var(--accent); font-size: .7rem; }
.chat-msg.guessed {
  color: var(--success);
  font-weight: 500;
}
.chat-msg.close {
  color: var(--warn);
  background: rgba(255, 179, 71, 0.1);
  padding: .25rem .5rem;
  border-radius: 6px;
  border-left: 3px solid var(--warn);
}
.close-icon { margin-right: .25rem; }
.chat-input {
  display: flex;
  gap: .4rem;
  padding: .5rem;
  border-top: 1px solid var(--border);
  background: var(--bg-2);
}
.chat-input input {
  flex: 1;
  min-height: 40px;
}
.chat-input button {
  width: 48px;
  padding: 0;
  font-size: 1.2rem;
}
@keyframes slide-in {
  from { opacity: 0; transform: translateX(-6px); }
  to { opacity: 1; transform: translateX(0); }
}
</style>
