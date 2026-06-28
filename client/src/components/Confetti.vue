<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

const canvasRef = ref(null);
let raf = null;
let running = false;

const COLORS = [
  '#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1',
  '#a55eea', '#fd79a8', '#caa46b', '#8f5f3f',
];

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function launch() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Частицы стартуют двумя «фонтанами» из нижних углов и одним сверху.
  const particles = [];
  const total = 120;
  for (let i = 0; i < total; i++) {
    particles.push({
      x: W / 2 + (Math.random() - 0.5) * W * 0.6,
      y: -20 - Math.random() * H * 0.3,
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 4,
      size: 5 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      life: 1,
    });
  }

  const start = performance.now();
  const DURATION = 2500;
  running = true;

  function frame(now) {
    if (!running) return;
    const elapsed = now - start;
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
      p.vy += 0.08; // гравитация
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (elapsed > DURATION - 700) p.life = Math.max(0, (DURATION - elapsed) / 700);
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (elapsed < DURATION) {
      raf = requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, W, H);
      running = false;
    }
  }
  raf = requestAnimationFrame(frame);
}

onMounted(() => {
  if (prefersReducedMotion()) return;
  launch();
});

onBeforeUnmount(() => {
  running = false;
  if (raf) cancelAnimationFrame(raf);
});
</script>

<template>
  <canvas ref="canvasRef" class="confetti-canvas" aria-hidden="true"></canvas>
</template>

<style scoped>
.confetti-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
}
</style>
