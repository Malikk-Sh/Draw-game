<script setup>
import { ref, nextTick, watch } from 'vue';
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
      <div
        v-for="m in store.messages"
        :key="m._key"
        class="chat-msg"
        :class="m.kind"
      >
        <template v-if="m.kind === 'system'">
          <em>{{ m.text }}</em>
        </template>
        <template v-else-if="m.kind === 'close'">
          <span class="close-hint">{{ m.text }}</span>
        </template>
        <template v-else>
          <b>{{ m.nickname }}:</b> <span>{{ m.text }}</span>
        </template>
      </div>
    </div>
    <form class="chat-input" @submit.prevent="send">
      <input
        v-model="text"
        :placeholder="store.isDrawer ? 'Ты рисуешь — чат недоступен' : 'Угадывай или общайся...'"
        :disabled="store.isDrawer"
        maxlength="200"
        autocomplete="off"
      />
      <button type="submit" :disabled="store.isDrawer || !text.trim()">→</button>
    </form>
  </div>
</template>

<style scoped>
.chat-box {
  display: flex;
  flex-direction: column;
  background: var(--surface);
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
  gap: .35rem;
  font-size: .92rem;
}
.chat-msg.system { color: var(--text-dim); font-style: italic; }
.chat-msg.guessed { color: var(--success); }
.chat-msg.close { color: var(--warn); }
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
}
</style>
