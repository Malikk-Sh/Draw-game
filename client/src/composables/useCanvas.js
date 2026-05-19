import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { getSocket } from './useSocket.js';

export function useCanvas(canvasRef, { isDrawer, store }) {
  const color = ref('#1a1a1a');
  const size = ref(4);
  const tool = ref('brush');
  const undoCount = ref(0);
  const redoCount = ref(0);
  let ctx = null;
  let dpr = 1;
  let activeStroke = null;
  let strokes = [];
  let redoStack = [];
  let resizeObserver = null;

  function setupCanvas() {
    const canvas = canvasRef.value;
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function resize() {
    const canvas = canvasRef.value;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  function clearScreen() {
    const canvas = canvasRef.value;
    if (!ctx || !canvas) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function drawStroke(stroke) {
    if (!ctx || !canvasRef.value) return;
    const canvas = canvasRef.value;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
    }
    ctx.lineWidth = stroke.size;
    const pts = stroke.points;
    if (pts.length === 1) {
      const [x, y] = pts[0];
      ctx.beginPath();
      ctx.arc(x * w, y * h, stroke.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color;
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
    for (let i = 1; i < pts.length - 1; i++) {
      const x1 = pts[i][0] * w;
      const y1 = pts[i][1] * h;
      const x2 = pts[i + 1][0] * w;
      const y2 = pts[i + 1][1] * h;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      ctx.quadraticCurveTo(x1, y1, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0] * w, last[1] * h);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  function redraw() {
    clearScreen();
    for (const s of strokes) drawStroke(s);
  }

  function refreshCounters() {
    undoCount.value = strokes.length;
    redoCount.value = redoStack.length;
  }

  function applyEvents(events) {
    let changed = false;
    for (const e of events) {
      if (e.kind === 'replace') {
        strokes = [...e.strokes];
        redoStack = [];
        changed = true;
      } else if (e.kind === 'add') {
        strokes.push(e.stroke);
        drawStroke(e.stroke);
      }
    }
    if (changed) redraw();
    refreshCounters();
  }

  let rafScheduled = false;
  function scheduleSync() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      const events = store.consumeStrokeEvents();
      if (events.length) applyEvents(events);
    });
  }

  watch(() => store.pendingNewStrokes.length, scheduleSync);
  watch(() => store.clearSignal, () => {
    strokes = [];
    redoStack = [];
    redraw();
    refreshCounters();
  });

  function getRelativePoint(ev) {
    const canvas = canvasRef.value;
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    return [clamp01(x), clamp01(y)];
  }

  let lastEmitAt = 0;

  function getEventPoints(ev) {
    if (typeof ev.getCoalescedEvents !== 'function') return [getRelativePoint(ev)];
    const batch = ev.getCoalescedEvents();
    if (!batch || batch.length === 0) return [getRelativePoint(ev)];
    return batch.map(getRelativePoint);
  }

  function pushPointToStroke(stroke, pt) {
    const last = stroke.points[stroke.points.length - 1];
    if (!last) {
      stroke.points.push(pt);
      return true;
    }
    const minStep = Math.max(0.00035, 0.0015 / Math.max(stroke.size, 1));
    if (Math.abs(last[0] - pt[0]) < minStep && Math.abs(last[1] - pt[1]) < minStep) return false;
    stroke.points.push(pt);
    return true;
  }

  function onPointerDown(ev) {
    if (!isDrawer.value) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    canvasRef.value.setPointerCapture(ev.pointerId);
    activeStroke = {
      color: color.value,
      size: size.value,
      tool: tool.value,
      points: [getRelativePoint(ev)],
    };
    strokes.push(activeStroke);
    if (redoStack.length) {
      redoStack = [];
      refreshCounters();
    }
    drawStroke(activeStroke);
  }

  function onPointerMove(ev) {
    if (!isDrawer.value || !activeStroke) return;
    ev.preventDefault();
    const points = getEventPoints(ev);
    let changed = false;
    for (const pt of points) {
      if (pushPointToStroke(activeStroke, pt)) changed = true;
    }
    if (!changed) return;
    drawStroke(activeStroke);

    const now = performance.now();
    if (now - lastEmitAt > 70 && activeStroke.points.length > 10) {
      flushActiveStroke(false);
      lastEmitAt = now;
    }
  }

  function onPointerUp(ev) {
    if (!isDrawer.value || !activeStroke) return;
    ev.preventDefault();
    try { canvasRef.value.releasePointerCapture(ev.pointerId); } catch (_) {}
    flushActiveStroke(true);
    activeStroke = null;
    refreshCounters();
  }

  function flushActiveStroke(finalize) {
    if (!activeStroke || activeStroke.points.length === 0) return;
    const socket = getSocket();
    const payload = {
      color: activeStroke.color,
      size: activeStroke.size,
      tool: activeStroke.tool,
      points: activeStroke.points.slice(),
    };
    socket.emit('game:draw', payload);
    if (!finalize) {
      activeStroke = {
        color: activeStroke.color,
        size: activeStroke.size,
        tool: activeStroke.tool,
        points: [activeStroke.points[activeStroke.points.length - 1]],
      };
      strokes.push(activeStroke);
    }
  }

  function clearCanvas() {
    if (!isDrawer.value) return;
    strokes = [];
    redoStack = [];
    redraw();
    refreshCounters();
    getSocket().emit('game:clearCanvas');
  }

  function undo() {
    if (!isDrawer.value || strokes.length === 0) return;
    const popped = strokes.pop();
    redoStack.push(popped);
    redraw();
    refreshCounters();
    getSocket().emit('game:undo');
  }

  function redo() {
    if (!isDrawer.value || redoStack.length === 0) return;
    const stroke = redoStack.pop();
    strokes.push(stroke);
    drawStroke(stroke);
    refreshCounters();
    getSocket().emit('game:redo');
  }

  function setColor(c) {
    color.value = c;
    tool.value = 'brush';
  }
  function setSize(s) { size.value = s; }
  function setTool(t) { tool.value = t; }

  function onKeyDown(ev) {
    if (!isDrawer.value) return;
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
    const meta = ev.ctrlKey || ev.metaKey;
    if (!meta) return;
    const key = ev.key.toLowerCase();
    if (key === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      undo();
    } else if (key === 'y' || (key === 'z' && ev.shiftKey)) {
      ev.preventDefault();
      redo();
    }
  }

  onMounted(() => {
    setupCanvas();
    const canvas = canvasRef.value;
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
    }
    scheduleSync();
  });

  onBeforeUnmount(() => {
    const canvas = canvasRef.value;
    if (canvas) {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerUp);
    }
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKeyDown);
    if (resizeObserver) resizeObserver.disconnect();
  });

  return {
    color, size, tool,
    undoCount, redoCount,
    setColor, setSize, setTool,
    clearCanvas, undo, redo,
  };
}

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
