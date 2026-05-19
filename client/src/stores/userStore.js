import { defineStore } from 'pinia';

const STORAGE_KEY = 'drawgame:nickname';

export const useUserStore = defineStore('user', {
  state: () => ({
    nickname: typeof localStorage !== 'undefined' ? (localStorage.getItem(STORAGE_KEY) || '') : '',
  }),
  actions: {
    setNickname(name) {
      this.nickname = String(name || '').trim().slice(0, 20);
      try {
        localStorage.setItem(STORAGE_KEY, this.nickname);
      } catch (_) {}
    },
  },
});
