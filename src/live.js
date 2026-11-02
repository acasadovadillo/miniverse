// Jugar juntos en directo. El admin abre su servidor (multijugador.py) y su juego se conecta a él como
// anfitrión; los demás lo encuentran al iniciar sesión (la dirección está en GitHub) y entran en su mundo con
// su propio personaje (ver livesync.js: qué es de todos y cómo se reparten los cambios). Cada jugador manda a
// los demás cómo va (dónde está, hacia dónde mira, si salta, qué lleva en la mano y cuándo lo usa, y su
// aspecto con la ropa que lleva) y ve a los demás como una persona más, con su nombre encima. El chat llega a
// todos, y lo que se tira al suelo lo puede recoger cualquiera. Por ahora, juntos solo en el mundo de fuera:
// en las cuevas, cada uno va por su cuenta.
import { Net } from './net.js';
import { Person } from './entities.js';
import { Profile } from './accounts.js';
import { hud } from './ui/hud.js';
import { SHARED, BLOBS, diffChunk, applyOps, copy } from './livesync.js';

const SEND_EVERY = 0.1, IDLE_EVERY = 1;   // segundos entre mensajes de cómo va uno: moviéndose y quieto
const SYNC_EVERY = 0.1;                   // cada cuánto se mandan los cambios del mundo
const BLOB_EVERY = 0.25, TIME_EVERY = 1, HERD_EVERY = 0.2;   // lo de todos, la hora y por dónde van los animales
const SNAP = 4;                           // si alguien aparece a más de tantas casillas de donde estaba, salta allí
const MINE_FIRST = 3;                     // segundos que lo que suelta algo al romperse es solo de quien lo rompió
const GIVE_FIRST = 5;                     // y que lo que uno tira es solo para los demás (así se dan cosas)
const WORLD_WAIT = 20000;                 // lo que se espera, como mucho, a que llegue el mundo del anfitrión
const r2 = v => Math.round(v * 100) / 100;
const session = Math.random().toString(36).slice(2, 6);   // (para que los objetos tirados tengan nombres únicos)

// Otro jugador, tal como lo ven los demás: va hacia donde dicen sus mensajes, suavizado
class RemotePlayer extends Person {
  constructor(peer) {
    super({ x: 0, y: 0, look: peer.look });
    Object.assign(this, { remote: true, name: peer.name, z: 0, yaw: null, held: null, swing: 0, swingItem: null, cooldown: 0, to: null, fresh: true });
  }
  apply(st) {
    this.to = [st.x, st.y, st.z || 0];
    if (this.fresh || Math.hypot(st.x - this.x, st.y - this.y) > SNAP) { [this.x, this.y, this.z] = this.to; this.fresh = false; }
    Object.assign(this, { yaw: st.yaw ?? null, inside: !!st.in, mount: !!st.m, boat: !!st.b, held: st.h || null, swing: st.sw || 0, swingItem: st.si || null, cooldown: st.cd || 0 });
  }
  update(dt) {
    if (!this.to) return;
    const k = 1 - Math.exp(-dt * 12);
    this.x += (this.to[0] - this.x) * k; this.y += (this.to[1] - this.y) * k; this.z += (this.to[2] - this.z) * k;
  }
}

export class Live {
  constructor(game) {
    this.game = game;
    this.net = null;
    this.url = null;
    this.status = 'off';      // off | connecting | nokey | on | error
    this.error = '';
    this.joined = false;      // si uno está jugando con los demás (el admin, siempre que juega: su mundo es el de todos)
    this.role = null;         // jugando juntos: 'host' (el admin, en su mundo) o 'guest' (en el mundo del admin)
    this.peers = new Map();   // conexión → { id, name, host, playing, look, entity, sc }
    this.onChange = null;     // (para el menú: cambia el estado o quién hay)
    this.onHostLeft = null;   // (para el menú: el anfitrión se ha ido y el invitado tiene que salir)
    this.say = null;          // (para el chat: say(texto, tipo))
    this.sent = 0; this.lastSent = ''; this.swings = 0; this.lastSwing = 0; this.lastLook = null;
    this.pending = new Set();     // trozos del mundo que han cambiado desde la última vez que se mandaron
    this.synced = new Map();      // trozo → cómo estaba la última vez que se mandó (o llegó del anfitrión)
    this.blobs = {};              // lo de todos que no va en los trozos, como se mandó la última vez
    this.timers = { sync: 0, blob: 0, time: 0, herd: 0 };
    this.clockBase = null;        // (invitado) la hora del anfitrión: { c, at, run }
    this.solo = null;             // (invitado) su partida de siempre, con su mundo: lo que se guarda
    this.wanted = null;           // (invitado) esperando el mundo del anfitrión
    this.dropN = 0;
  }
  get host() { return [...this.peers.values()].find(p => p.host) || null; }
  get hostConn() { for (const [conn, p] of this.peers) if (p.host) return conn; return null; }
  get others() { return [...this.peers.values()]; }
  get guest() { return this.role === 'guest'; }
  changed() { this.onChange?.(); }
  setStatus(s, error = '') { this.status = s; this.error = error; this.changed(); }

  // ---------- conexión ----------
  async connect(url) {
    if (this.url === url && this.net) return;
    this.close();
    this.url = url;
    this.setStatus('connecting');
    const key = await Profile.worldKey();
    if (this.url !== url) return;
    const net = this.net = new Net(url, key, {
      up: () => this.up(),
      down: () => { this.dropAll(); this.setStatus('connecting'); this.hostGone(); },
      join: () => { if (this.status === 'nokey') this.net.sendPlain({ need: Profile.id }); },   // (por si es el admin, que llega)
      leave: conn => this.drop(conn, true),
      msg: (conn, m) => this.receive(conn, m),
      plain: (conn, p) => this.plain(conn, p),
    });
    try { await net.open(); } catch (e) { if (this.net === net) { net.close(); this.net = null; this.setStatus('error', e.message); } }
  }
  close() {
    if (this.net && this.joined) this.net.send({ t: 'bye' });
    this.net?.close();
    this.net = null; this.url = null;
    this.dropAll();
    if (this.status !== 'off') this.setStatus('off');
  }
  // Al entrar (o volver a entrar tras un corte): saludar o, sin la clave del mundo, pedírsela al admin
  up() {
    if (this.net.key) { this.setStatus('on'); this.hi(null, true); }
    else { this.setStatus('nokey'); this.net.sendPlain({ need: Profile.id }); }
  }
  hi(to = null, ask = false) {
    const g = this.game;
    const look = g.player ? g.appearance() : null;
    this.net?.send({ t: 'hi', id: Profile.id, name: g.player?.name || Profile.name, host: Profile.admin, playing: this.joined && !!g.player, look, ask }, to);
    this.lastLook = look; this.lastLookJson = JSON.stringify(look);
  }
  plain(conn, p) {
    // El admin da la clave del mundo a quien la pide (su archivo de claves dice si es de verdad esa cuenta:
    // solo esa cuenta puede abrir lo que se le deja ahí)
    if (p.need && Profile.admin) Profile.grant(p.need).then(() => this.net?.sendPlain({ granted: p.need }, conn)).catch(() => {});
    if (p.granted && p.granted === Profile.id && this.status === 'nokey') {
      Profile.reopenWorldKey().then(key => { if (key && this.net) { this.net.key = key; this.up(); } });
    }
  }

  // ---------- mensajes ----------
  receive(conn, m) {
    let peer = this.peers.get(conn);
    if (m.t === 'hi') {
      const was = peer?.playing;
      peer = { ...peer, id: m.id, name: m.name, host: !!m.host, playing: !!m.playing, look: m.look };
      if (!peer.playing) this.hide(peer);
      this.peers.set(conn, peer);
      if (peer.entity && m.look) peer.entity.look = m.look;
      if (m.ask) this.hi(conn);
      if (this.joined && this.game.player && peer.playing !== !!was) hud.toast(peer.playing ? `${peer.name} está jugando contigo` : `${peer.name} ha salido`, peer.playing ? 'ok' : '');
      if (peer.host && !peer.playing) this.hostGone();
      this.changed();
      return;
    }
    if (!peer) return;
    const g = this.game, fromHost = peer.host && this.guest;
    switch (m.t) {
      case 'st':
        if (!peer.playing) { peer.playing = true; this.changed(); }
        if (!m.sc) { this.hide(peer); return; }
        if (!peer.entity && peer.look) peer.entity = new RemotePlayer(peer);
        peer.entity?.apply(m);
        peer.sc = m.sc;
        break;
      case 'look':
        peer.look = m.look;
        if (peer.entity) peer.entity.look = m.look;
        break;
      case 'chat': this.say?.(`<${peer.name}> ${m.text}`); break;
      case 'bye':
        if (this.joined && peer.playing && g.player) hud.toast(`${peer.name} ha salido`);
        peer.playing = false;
        this.hide(peer);
        if (peer.host) this.hostGone();
        this.changed();
        break;
      // El mundo compartido
      case 'want': if (this.role === 'host' && g.player) this.sendWorld(conn); break;
      case 'world': if (this.wanted && peer.host) { clearTimeout(this.wanted.timer); this.wanted.resolve(m); this.wanted = null; } break;
      case 'w': if ((this.role === 'host' && !peer.host) || fromHost) this.applyChunk(m.c, m.ops); break;
      case 's':
        if (!BLOBS[m.name] || !((this.role === 'host' && !peer.host) || fromHost)) break;
        BLOBS[m.name].set(g, m.v);
        if (fromHost) this.blobs[m.name] = JSON.stringify(BLOBS[m.name].get(g));   // (el anfitrión lo reparte a todos en su próxima vuelta)
        break;
      case 'time': if (fromHost) this.clockBase = { c: m.c, at: g.time, run: m.run }; break;
      case 'herd': if (fromHost) m.p.forEach((p, i) => { const a = g.ranch.animals[i]; if (a) a.netTo = p; }); break;
      // Lo que se tira al suelo
      case 'drop':
        if (this.joined && g.world) g.gather.drops.push({ id: m.id, extra: m.extra, x: m.x, y: m.y, z: m.z, vz: m.vz, t: m.dt, scene: g.world, nid: m.n, owner: peer.id, free: !!m.free, born: g.time });
        break;
      case 'take': {
        const i = g.gather.drops.findIndex(d => d.nid === m.n);
        if (i >= 0) g.gather.drops.splice(i, 1);
        break;
      }
    }
  }
  hide(peer) { peer.entity = null; peer.sc = null; }
  drop(conn, gone = false) {
    const peer = this.peers.get(conn);
    if (!peer) return;
    if (gone) {
      if (this.joined && peer.playing && this.game.player) hud.toast(`${peer.name} se ha desconectado`);
      this.peers.delete(conn);
      if (peer.host) this.hostGone();
      this.changed();
    } else this.hide(peer);
  }
  dropAll() { for (const p of this.peers.values()) this.hide(p); this.peers.clear(); this.changed(); }
  // El anfitrión se ha ido (o se ha cortado la conexión): el invitado sale de su mundo
  hostGone() {
    if (!this.guest || !this.game.player || this.leaving) return;
    this.leaving = true;
    this.onHostLeft?.();
  }

  // ---------- entrar en el mundo del anfitrión (invitado) ----------
  // Lo pide y espera a que llegue: { deltas, shared }
  requestWorld() {
    const conn = this.hostConn;
    if (conn === null || !this.host?.playing) return Promise.reject(new Error('El anfitrión no está jugando ahora.'));
    return new Promise((resolve, reject) => {
      this.wanted = { resolve, reject, timer: setTimeout(() => { this.wanted = null; reject(new Error('El mundo compartido no llega. Prueba otra vez.')); }, WORLD_WAIT) };
      this.net.send({ t: 'want' }, conn);
    });
  }
  // (anfitrión) Se lo manda: antes, lo que hubiera pendiente a los que ya están, para que todos partan de lo mismo
  sendWorld(conn) {
    const g = this.game, snap = g.snapshot();
    this.flush();
    for (const [k, d] of g.world.deltas) if (!k.startsWith('u:') && !this.synced.has(k)) this.synced.set(k, copy(d));
    this.net.send({ t: 'world', deltas: [...g.world.deltas].filter(([k]) => !k.startsWith('u:')), shared: Object.fromEntries(SHARED.map(k => [k, snap[k]])) }, conn);
  }
  // La partida con la que empieza el invitado: la suya, con el mundo del anfitrión (y sus propias cuevas)
  enter(solo, world) {
    const her = solo.save;
    const save = { ...her, ...world.shared, player: { ...her.player, inside: false, boat: false, mount: false, ...(her.livePos || {}) } };
    const deltas = new Map(world.deltas);
    for (const [k, v] of solo.deltas) if (k.startsWith('u:')) deltas.set(k, v);
    return { save, deltas };
  }
  // Lo que se guarda en la partida del invitado: lo suyo de ahora, con su mundo de siempre (no el compartido)
  // y dónde se ha quedado en el compartido, para volver allí la próxima vez
  guestSave(snap, deltas) {
    const s = this.solo.save, { x, y, boat, mount } = snap.player, out = { ...snap, livePos: { x, y, boat, mount } };
    for (const k of SHARED) { if (k in s) out[k] = s[k]; else delete out[k]; }
    out.player = { ...snap.player, x: s.player.x, y: s.player.y, inside: s.player.inside, boat: s.player.boat, mount: s.player.mount };
    const d = new Map([...this.solo.deltas].filter(([k]) => !k.startsWith('u:')));
    for (const [k, v] of deltas) if (k.startsWith('u:')) d.set(k, v);
    return { save: out, deltas: d };
  }

  // ---------- en la partida ----------
  // Empieza a jugar con los demás: el admin, en su mundo (anfitrión); los demás, en el del admin (solo: su
  // partida de siempre). O deja de hacerlo, al salir al menú.
  join(solo = null) {
    const g = this.game;
    Object.assign(this, { joined: true, role: solo ? 'guest' : 'host', solo, leaving: false, clockBase: null, hostName: this.host?.name || '' });
    this.pending.clear(); this.synced.clear();
    if (solo) {
      for (const [k, d] of g.world.deltas) if (!k.startsWith('u:')) this.synced.set(k, copy(d));
      this.clockBase = { c: g.world.clock, at: g.time, run: true };
    }
    for (const [name, b] of Object.entries(BLOBS)) this.blobs[name] = JSON.stringify(b.get(g));
    this.hi();
  }
  left() {
    if (!this.joined) return;
    this.joined = false; this.role = null; this.solo = null;
    this.net?.send({ t: 'st', sc: null });
    this.hi();
    for (const p of this.peers.values()) this.hide(p);
    for (const a of this.game.ranch.animals) delete a.netTo;
  }
  chat(text) { if (this.joined) this.net?.send({ t: 'chat', text }); }
  // Un trozo del mundo ha cambiado (lo avisa el mundo)
  touched(k) { if (this.joined && !k.startsWith('u:')) this.pending.add(k); }

  // Manda los cambios de los trozos pendientes: el invitado, al anfitrión; el anfitrión, a todos
  flush() {
    const w = this.game.world, to = this.guest ? this.hostConn : null;
    for (const k of this.pending) {
      const cur = w.deltas.get(k), ops = diffChunk(this.synced.get(k), cur);
      this.synced.set(k, copy(cur) || {});
      if (ops.length && (to !== null || !this.guest)) this.net.send({ t: 'w', c: k, ops }, to);
    }
    this.pending.clear();
  }
  // Llegan cambios de un trozo. Al invitado le llegan del anfitrión (y quedan como lo último que se sabe); al
  // anfitrión, de un invitado: los aplica y, en su próxima vuelta, los reparte a todos.
  applyChunk(k, ops) {
    const w = this.game.world, [cx, cy] = k.split(',').map(Number);
    applyOps(w.delta(cx, cy, true), ops);
    if (this.guest) { const s = this.synced.get(k) || {}; applyOps(s, ops); this.synced.set(k, s); }
    w.touch(cx, cy);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) w.merged.delete(`${cx + dx},${cy + dy}`);   // (tejados y vallas miran a sus vecinas)
  }

  // Lo que se tira al suelo (o suelta algo al romperse): lo ven todos y lo puede recoger cualquiera. Lo que
  // suelta algo al romperse, los primeros segundos solo quien lo rompió; lo tirado a propósito (sale con t < 0,
  // porque tarda en poderse recoger), los primeros segundos solo los demás: así se dan cosas.
  dropped(d) {
    const g = this.game;
    if (!this.joined || d.scene !== g.world || !this.net?.ready) return;
    Object.assign(d, { nid: `${Profile.id}:${session}:${++this.dropN}`, owner: Profile.id, born: g.time, free: d.t < 0 });
    this.net.send({ t: 'drop', n: d.nid, id: d.id, extra: d.extra, x: r2(d.x), y: r2(d.y), z: d.z, vz: r2(d.vz), dt: d.t, free: d.free });
  }
  mayTake(d) {
    if (!d.owner) return true;
    const age = this.game.time - d.born;
    return d.owner === Profile.id ? !d.free || age > GIVE_FIRST : d.free || age > MINE_FIRST;
  }
  taken(d) { if (d.nid && this.joined) this.net?.send({ t: 'take', n: d.nid }); }

  // Cada paso, también con el juego en pausa o con el inventario abierto
  tick(dt) {
    const g = this.game, p = g.player;
    for (const peer of this.peers.values()) peer.entity?.update(dt);
    if (!this.joined || !p) return;
    // El invitado: la hora y los animales, como los lleva el anfitrión
    if (this.guest) {
      const b = this.clockBase;
      if (b) g.world.clock = b.c + (b.run ? g.time - b.at : 0);
      const k = 1 - Math.exp(-dt * 8);
      for (const a of g.ranch.animals) {
        if (!a.netTo) continue;
        const dx = (a.netTo[0] - a.x) * k, dy = (a.netTo[1] - a.y) * k, moving = Math.abs(dx) + Math.abs(dy) > 1e-3;
        a.x += dx; a.y += dy; a.vx = moving ? dx / dt : 0; a.vy = moving ? dy / dt : 0;
      }
    }
    if (!this.net?.ready || !this.net.key) return;
    const T = this.timers;
    for (const k in T) T[k] += dt;
    // Los cambios del mundo y lo de todos
    if (T.sync >= SYNC_EVERY) { T.sync = 0; if (this.pending.size) this.flush(); }
    if (T.blob >= BLOB_EVERY) {
      T.blob = 0;
      for (const [name, b] of Object.entries(BLOBS)) {
        const s = JSON.stringify(b.get(g));
        if (s === this.blobs[name]) continue;
        this.blobs[name] = s;
        if (!this.guest || this.hostConn !== null) this.net.send({ t: 's', name, v: JSON.parse(s) }, this.guest ? this.hostConn : null);
      }
    }
    if (this.role === 'host') {
      if (T.time >= TIME_EVERY) { T.time = 0; this.net.send({ t: 'time', c: r2(g.world.clock), run: g.mode === 'play' }); }
      if (T.herd >= HERD_EVERY && this.others.some(o => o.playing)) { T.herd = 0; this.net.send({ t: 'herd', p: g.ranch.animals.map(a => [r2(a.x), r2(a.y)]) }); }
    }
    // Cómo va uno. Cada golpe nuevo con la herramienta (el temporizador sube), para que los demás vean el gesto.
    if (g.gather.swing > this.lastSwing + 1e-4) this.swings++;
    this.lastSwing = g.gather.swing;
    // (el aspecto se rehace con cada cambio del inventario: solo se manda si de verdad ha cambiado la ropa)
    const look = g.appearance();
    if (look !== this.lastLook) {
      this.lastLook = look;
      const json = JSON.stringify(look);
      if (json !== this.lastLookJson) { this.lastLookJson = json; this.net.send({ t: 'look', look }); }
    }
    this.sent += dt;
    const sc = g.scene === g.world ? 'world' : null;
    const st = { t: 'st', sc, x: r2(p.x), y: r2(p.y), z: r2(p.z || 0), yaw: r2(g.view3d.actors.player?.person.facing ?? 0), in: p.inside ? 1 : 0, m: p.mount ? 1 : 0, b: p.boat ? 1 : 0, h: g.inv.held?.id || null, sw: this.swings, si: g.gather.swingItem || null, cd: r2(g.gather.cooldown || 0) };
    const key = JSON.stringify(st);
    if (this.sent < SEND_EVERY || (key === this.lastSent && this.sent < IDLE_EVERY)) return;
    this.sent = 0; this.lastSent = key;
    this.net.send(st);
  }
  // Los demás jugadores que están en esta escena (para dibujarlos)
  entities(scene) {
    if (!this.joined || scene !== this.game.world) return null;
    return this.others.filter(p => p.sc === 'world' && p.entity).map(p => p.entity);
  }
}
