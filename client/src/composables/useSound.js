import { ref } from 'vue';

// Лёгкие звуковые эффекты через Web Audio (без файлов). Громкость низкая,
// состояние mute сохраняется. Контекст «разблокируется» по первому касанию
// (требование автоплея в браузерах).
const STORAGE_KEY = 'drawgame:muted';
const muted = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1',
);

let ctx = null;
let unlockBound = false;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(ac, { freq, start, dur, type = 'sine', gain = 0.08, slideTo = null }) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

const SOUNDS = {
  correct: (ac, t) => { tone(ac, { freq: 523, start: t, dur: 0.12 }); tone(ac, { freq: 784, start: t + 0.1, dur: 0.16 }); },
  selfCorrect: (ac, t) => { tone(ac, { freq: 659, start: t, dur: 0.1 }); tone(ac, { freq: 988, start: t + 0.09, dur: 0.2, gain: 0.1 }); },
  yourTurn: (ac, t) => { tone(ac, { freq: 587, start: t, dur: 0.14, type: 'triangle' }); tone(ac, { freq: 880, start: t + 0.12, dur: 0.2, type: 'triangle' }); },
  turnStart: (ac, t) => { tone(ac, { freq: 440, start: t, dur: 0.1, type: 'triangle', gain: 0.05 }); },
  turnEnd: (ac, t) => { tone(ac, { freq: 330, start: t, dur: 0.2, gain: 0.06, slideTo: 220 }); },
  win: (ac, t) => { [523, 659, 784, 1046].forEach((f, i) => tone(ac, { freq: f, start: t + i * 0.12, dur: 0.22, type: 'triangle', gain: 0.09 })); },
  tick: (ac, t) => { tone(ac, { freq: 880, start: t, dur: 0.05, gain: 0.04 }); },
  pop: (ac, t) => { tone(ac, { freq: 660, start: t, dur: 0.07, type: 'triangle', gain: 0.05, slideTo: 990 }); },
};

export function playSound(name) {
  if (muted.value) return;
  const ac = getCtx();
  if (!ac) return;
  const fn = SOUNDS[name];
  if (!fn) return;
  try { fn(ac, ac.currentTime); } catch (_) {}
}

export function toggleMute() {
  muted.value = !muted.value;
  try { localStorage.setItem(STORAGE_KEY, muted.value ? '1' : '0'); } catch (_) {}
  if (!muted.value) playSound('pop');
}

// Однократно вешаем разблокировку аудиоконтекста на первый жест пользователя.
export function initAudioUnlock() {
  if (unlockBound || typeof window === 'undefined') return;
  unlockBound = true;
  const unlock = () => { getCtx(); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

export function useSound() {
  return { muted, toggleMute, playSound };
}
