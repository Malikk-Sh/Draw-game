import { defineStore } from 'pinia';

const STORAGE_KEY = 'drawgame:nickname';
const USER_ID_KEY = 'drawgame:userId';

export const useUserStore = defineStore('user', {
  state: () => ({
    nickname: typeof localStorage !== 'undefined' ? (localStorage.getItem(STORAGE_KEY) || '') : '',
    userId: typeof localStorage !== 'undefined' ? (localStorage.getItem(USER_ID_KEY) || '') : '',
  }),
  actions: {
    ensureUserId() {
      if (this.userId) return this.userId;
      this.userId = `u_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      try { localStorage.setItem(USER_ID_KEY, this.userId); } catch (_) {}
      return this.userId;
    },
    setNickname(name) {
      this.nickname = String(name || '').trim().slice(0, 20);
      try {
        localStorage.setItem(STORAGE_KEY, this.nickname);
      } catch (_) {}
    },
  },
});
