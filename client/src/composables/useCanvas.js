import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { getSocket } from './useSocket.js';

const CANVAS_BACKGROUND = '#F4EFE5';

export function useCanvas(canvasRef, { isDrawer, store }) {
  // Текущие настройки инструмента, которыми управляет UI (палитра/размер/ластик).
  const color = ref('#1a1a1a');
  const size = ref(4);
  const tool = ref('brush');
  // Счётчики для состояния кнопок "отменить/вернуть".
  const undoCount = ref(0);
  const redoCount = ref(0);
  // Внутреннее состояние рендера холста.
  let ctx = null;
  let dpr = 1;
  let activeStroke = null;
  let activePointerId = null;
  let activeStrokeId = null;
  let strokeSeq = 0;
  let strokes = [];
  let redoStack = [];
  let resizeObserver = null;

  function setupCanvas() {
    const canvas = canvasRef.value;
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    // Устанавливаем сглаживание концов и углов линий, чтобы штрихи выглядели естественно.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function resize() {
    const canvas = canvasRef.value;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // Рисуем в физических пикселях устройства для чёткости на Retina/HiDPI экранах.
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  function clearScreen() {
    const canvas = canvasRef.value;
    if (!ctx || !canvas) return;
    // Сбрасываем трансформацию, чтобы очищать всю физическую область холста.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CANVAS_BACKGROUND;
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
      // Ластик реализован как "прозрачная кисть": вырезаем пиксели из текущего слоя.
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
    // Полный перерендер нужен после событий полной замены, отмены/возврата и изменения размера.
    clearScreen();
    for (const s of strokes) drawStroke(s);
  }

  // Отмена/возврат должны работать на уровне "жеста пользователя",
  // а не на уровне сетевых чанков одного и того же штриха.
  function countUniqueStrokeIds(list) {
    const ids = new Set();
    for (const s of list) ids.add(s.strokeId || '__legacy__');
    return ids.size;
  }

  function refreshCounters() {
    undoCount.value = countUniqueStrokeIds(strokes);
    redoCount.value = countUniqueStrokeIds(redoStack);
  }

  function applyEvents(events) {
    let changed = false;
    for (const e of events) {
      if (e.kind === 'replace') {
        // Событие полной замены приходит после отмены/очистки/ресинхронизации: заменяем локальную историю целиком.
        strokes = [...e.strokes];
        redoStack = [];
        changed = true;
      } else if (e.kind === 'add') {
        // Событие добавления — это инкрементальный дорисованный кусок удалённого штриха.
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
    // Склеиваем пачку входящих сокет-событий в один кадр, чтобы не рендерить слишком часто.
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      const events = store.consumeStrokeEvents();
      if (events.length) applyEvents(events);
    });
  }

  watch(() => store.pendingNewStrokes.length, scheduleSync);
  watch(() => store.clearSignal, () => {
    // Отдельный сигнал очистки нужен, чтобы мгновенно сбрасывать локальный буфер.
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
    // На поддерживаемых браузерах берём объединённые события указателя:
    // это даёт более плотный и плавный путь пера при быстром движении.
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

    // Чем меньше порог минимального шага, тем больше "живых" точек сохраняем в кривой.
    // Это уменьшает угловатость на быстрых поворотах.
    const dx = last[0] - pt[0];
    const dy = last[1] - pt[1];
    const dist = Math.hypot(dx, dy);
    const minStep = Math.max(0.00008, 0.0008 / Math.max(stroke.size, 1));
    if (dist < minStep) return false;

    stroke.points.push(pt);
    return true;
  }

  function onPointerDown(ev) {
    if (!isDrawer.value) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (activePointerId !== null) return;
    activePointerId = ev.pointerId;
    // Один физический жест (нажатие указателя -> отпускание указателя) = один идентификатор штриха.
    // Благодаря этому отмена/возврат откатывает весь штрих целиком.
    activeStrokeId = `s${Date.now()}-${strokeSeq++}`;
    activeStroke = {
      strokeId: activeStrokeId,
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
    if (ev.pointerId !== activePointerId) return;
    const points = getEventPoints(ev);
    let changed = false;
    for (const pt of points) {
      if (pushPointToStroke(activeStroke, pt)) changed = true;
    }
    if (!changed) return;
    drawStroke(activeStroke);

    const now = performance.now();
    // Периодически отправляем текущий штрих кусками:
    // это снижает задержку у других игроков при длинной линии.
    if (now - lastEmitAt > 55 && activeStroke.points.length > 6) {
      flushActiveStroke(false);
      lastEmitAt = now;
    }
  }

  function onPointerUp(ev) {
    if (!isDrawer.value || !activeStroke) return;
    if (ev.pointerId !== activePointerId) return;
    flushActiveStroke(true);
    activeStroke = null;
    activePointerId = null;
    refreshCounters();
  }

  function onLostPointerCapture() {
    if (!isDrawer.value || !activeStroke) return;
    flushActiveStroke(true);
    activeStroke = null;
    activePointerId = null;
    refreshCounters();
  }

  function flushActiveStroke(finalize) {
    if (!activeStroke || activeStroke.points.length === 0) return;
    const socket = getSocket();
    const payload = {
      strokeId: activeStroke.strokeId || activeStrokeId,
      color: activeStroke.color,
      size: activeStroke.size,
      tool: activeStroke.tool,
      points: activeStroke.points.slice(),
    };
    socket.emit('game:draw', payload);
    if (!finalize) {
      // Оставляем "хвост" последних точек, чтобы следующий чанк
      // продолжал кривую без видимого излома на стыке.
      const tail = activeStroke.points.slice(-2);
      activeStroke = {
        strokeId: activeStroke.strokeId || activeStrokeId,
        color: activeStroke.color,
        size: activeStroke.size,
        tool: activeStroke.tool,
        points: tail.length ? tail : [activeStroke.points[activeStroke.points.length - 1]],
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
    const targetId = strokes[strokes.length - 1].strokeId || '__legacy__';
    // Переносим в стек возврата все чанки последнего идентификатора штриха одним действием.
    while (strokes.length) {
      const top = strokes[strokes.length - 1];
      const topId = top.strokeId || '__legacy__';
      if (topId !== targetId) break;
      redoStack.push(strokes.pop());
    }
    redraw();
    refreshCounters();
    getSocket().emit('game:undo');
  }

  function redo() {
    if (!isDrawer.value || redoStack.length === 0) return;
    const targetId = redoStack[redoStack.length - 1].strokeId || '__legacy__';
    const recovered = [];
    // Возвращаем все чанки одного идентификатора штриха в исходном порядке.
    while (redoStack.length) {
      const top = redoStack[redoStack.length - 1];
      const topId = top.strokeId || '__legacy__';
      if (topId !== targetId) break;
      recovered.push(redoStack.pop());
    }
    recovered.reverse();
    for (const stroke of recovered) {
      strokes.push(stroke);
      drawStroke(stroke);
    }
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
    // Горячие клавиши: Ctrl/Cmd+Z и Ctrl/Cmd+Y (или Cmd+Shift+Z на macOS).
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
    canvas.addEventListener('lostpointercapture', onLostPointerCapture);
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
      canvas.removeEventListener('lostpointercapture', onLostPointerCapture);
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
    // Все точки приходят нормализованными (0..1), масштабируем их в текущий размер холста.
