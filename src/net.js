// Jugar juntos en directo: la conexión con el servidor (multijugador.py, en el ordenador del admin), que
// reparte los mensajes entre los que están conectados. Lo del juego va cifrado con la clave del mundo
// (AES-GCM), así que el servidor solo ve a quién va cada mensaje. Sin cifrar solo van los avisos que hacen
// falta antes de tener la clave (pedírsela al admin y que diga que ya está).
import { toB64, fromB64 } from './vault.js';

const RETRY_MS = 3000;   // si se corta, se vuelve a intentar cada tanto

async function sealMsg(key, msg) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(msg))));
  const out = new Uint8Array(12 + body.length);
  out.set(iv); out.set(body, 12);
  return toB64(out);
}
async function openMsg(key, d) {
  try {
    const b = fromB64(d);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, key, b.subarray(12))));
  } catch { return null; }
}

// on: { up(), down(), join(conn), leave(conn), msg(conn, msg), plain(conn, p), bad(conn), ops(lista) }. Cada
// conexión tiene un número (conn), que da el servidor. ops: los usuarios con modo admin, que se dan en el
// terminal del servidor (/op); null si el servidor es de antes y no los lleva.
export class Net {
  constructor(url, key, on) {
    Object.assign(this, { url, key, on, ws: null, me: null, peers: new Set(), wanted: false });
    this.out = this.in = Promise.resolve();   // (cifrar y descifrar va en orden)
  }
  get ready() { return this.me !== null && this.ws?.readyState === 1; }
  // Conecta y, si se corta, lo vuelve a intentar hasta close(). Se resuelve al entrar (o falla si tarda mucho).
  open(timeout = 8000) {
    this.wanted = true;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.entered = null; reject(new Error('El servidor no responde.')); }, timeout);
      this.entered = () => { clearTimeout(timer); resolve(); };
      this.dial();
    });
  }
  dial() {
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.retry(); return; }
    this.ws = ws;
    ws.onmessage = e => this.receive(e.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null; this.me = null; this.peers.clear();
      this.on.down?.();
      this.retry();
    };
  }
  retry() { if (this.wanted) setTimeout(() => { if (this.wanted && !this.ws) this.dial(); }, RETRY_MS); }
  close() {
    this.wanted = false;
    const ws = this.ws;
    this.ws = null; this.me = null; this.peers.clear();
    ws?.close();
  }

  receive(raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'you') { this.me = m.id; this.peers = new Set(m.peers); this.on.ops?.(m.ops ?? null); this.on.up?.(); this.entered?.(); this.entered = null; }
    else if (m.t === 'ops') this.on.ops?.(m.ops);
    else if (m.t === 'join') { this.peers.add(m.id); this.on.join?.(m.id); }
    else if (m.t === 'leave') { this.peers.delete(m.id); this.on.leave?.(m.id); }
    else if (m.t === 'msg') {
      if (m.p) this.on.plain?.(m.from, m.p);
      if (m.d && this.key) {
        const key = this.key;
        this.in = this.in.then(async () => { const msg = await openMsg(key, m.d); if (msg) this.on.msg?.(m.from, msg); else this.on.bad?.(m.from); });
      }
    }
  }
  // Un mensaje del juego, cifrado: a una conexión (to) o a todas las demás
  send(msg, to = null) {
    if (!this.ready || !this.key) return;
    const key = this.key, ws = this.ws;
    this.out = this.out.then(async () => { const d = await sealMsg(key, msg); if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'msg', to, d })); }).catch(() => {});
  }
  // Un aviso sin cifrar
  sendPlain(p, to = null) { if (this.ready) this.ws.send(JSON.stringify({ t: 'msg', to, p })); }
}
