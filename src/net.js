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

// on: { up(), down(), join(conn), leave(conn), msg(conn, msg), plain(conn, p), bad(conn), ops(lista), server(m) }.
// Cada conexión tiene un número (conn), que da el servidor. ops: los usuarios op, que se dan en el terminal del
// servidor (/op); null si el servidor es de antes y no los lleva. server: lo que manda el propio servidor desde su
// terminal (kicked: te ha echado, y no se vuelve a intentar; say: un aviso; save: guardar ya; stop: se cierra; need:
// le faltan las claves para el mundo del servidor, y solo se lo pide a quien está en su mismo ordenador). need: si al
// entrar ya le faltaban.
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
    if (m.t === 'you') { this.me = m.id; this.peers = new Set(m.peers); this.need = !!m.need; this.on.ops?.(m.ops ?? null); this.on.welcome?.(m); this.on.up?.(); this.entered?.(); this.entered = null; }
    else if (m.t === 'need') { this.need = true; this.on.server?.(m); }
    else if (m.t === 'secretos') this.on.server?.(m);   // (al mundo del servidor: sus claves)
    // (cuáles son las conexiones del mundo del servidor; si se guarda el mundo; el tiempo para echar a quien no se
    // mueve; y, al mundo del servidor, un comando del terminal, que diga cómo va o que guarde para abrirlo con el código
    // nuevo: /update, o que abra una copia del mundo: /restore, o haga una con nombre: /backup), y avisos del servidor
    // (notice: que el token del servidor va a caducar)
    else if (['servers', 'autosave', 'idle', 'cmd', 'tps', 'restart', 'restore', 'keep', 'notice'].includes(m.t)) this.on.server?.(m);
    else if (m.t === 'ops') this.on.ops?.(m.ops);
    else if (m.t === 'kicked' || m.t === 'say' || m.t === 'save' || m.t === 'stop' || m.t === 'tp') { if (m.t === 'kicked' || m.t === 'stop') this.wanted = false; this.on.server?.(m); }
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
  // Al propio servidor (no a los demás): de qué cuenta es este juego, una copia del mundo (ya cifrada) o, del admin
  // en el mismo ordenador, las claves para el mundo del servidor
  sendServer(m) { if (this.ready) this.ws.send(JSON.stringify(m)); }
}
