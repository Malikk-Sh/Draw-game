import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io({
      autoConnect: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 4000,
    });
  }
  return socket;
}

export function emitAck(event, payload, timeoutMs = 5000) {
  const s = getSocket();
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('timeout'));
    }, timeoutMs);
    const onAck = (response) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(response);
    };
    // Без payload его нельзя передавать как undefined: сервер получил бы
    // лишний аргумент и не нашёл бы ack-колбэк.
    if (payload === undefined) s.emit(event, onAck);
    else s.emit(event, payload, onAck);
  });
}
