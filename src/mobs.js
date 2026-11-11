// Luz y monstruos de fuera, como en Minecraft. Cada casilla tiene su luz, de 0 a 15: la del cielo (15 de día, 4 de
// noche; menos con tormenta, y nada bajo un tejado) o la de las luces encendidas que haya cerca (antorchas, lámparas,
// velas, hogares, hornos, ventanas iluminadas, la farola), que pierde 1 por cada casilla de distancia. Donde la luz es
// 7 o menos aparecen monstruos (limos y esqueletos) alrededor de quien juega en supervivencia, ni muy cerca ni muy
// lejos, nunca en un suelo o bajo un tejado; con antorchas alrededor, no. Persiguen a quien tienen cerca y muerden;
// con el sol se deshacen y, si se quedan muy lejos de todos, se van. Cuántos hay y cuánto muerden depende de la
// dificultad (/difficulty); en pacífico no hay. El pueblo es el sitio seguro: ahí no aparecen, los de fuera no entran
// ni persiguen a quien está dentro (los que pone un op con /summon dentro sí se mueven y muerden).
//
// Jugando juntos, los lleva quien lleva el mundo (el mundo del servidor): los hace aparecer alrededor de cada uno, los
// mueve y les dice a los demás dónde están; los demás le dicen a quién pegan y él les dice cuándo les muerden.
import { MONSTERS, DIFF } from './combat.js';
import { collide } from './physics.js';
import { CHUNK } from './world/gen.js';
import { inBounds } from './world/village.js';
import { Profile } from './accounts.js';
import { wrapX, dxOf, distOf } from './world/planet.js';

export const DARK = 7;                          // con esta luz o menos aparecen monstruos
const RING = [14, 26];                          // a qué distancia de quien juega aparecen
const AWAY = 12, FAR = 48, AROUND = 40;         // nunca más cerca de nadie; más lejos de todos, se van; los que cuentan
const CHASE = 10, BITE = 0.6;                   // a qué distancia persiguen y muerden
const SPAWN_EVERY = 1, SEND_EVERY = 0.15;
const NIGHT_TYPES = [['limo', 0.55], ['esqueleto', 0.45]];
const GM = ['survival', 'creative', 'survival', 'spectator'];   // (el modo de los demás, por su número)
const r2 = v => Math.round(v * 100) / 100;

class Mob {
  constructor(type, x, y, id) {
    Object.assign(this, { id, type, x, y, hp: MONSTERS[type].hp, cool: 0, hurt: 0, sun: 0, step: Math.random() * 4, wander: 0, dir: [0, 0], world: true });
  }
  get def() { return MONSTERS[this.type]; }
}

export class Mobs {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.n = 0;
    this.timers = { spawn: 0, send: 0 };
    this.lastSent = '';
  }
  reset() { this.list = []; this.lastSent = ''; }
  get world() { return this.game.world; }

  // ---------- la luz ----------
  // La del cielo ahora en x (la hora es la de esa longitud): 15 de día, 4 de noche (al amanecer y al atardecer,
  // entre medias); con lluvia, algo menos, y con tormenta, poca (aparecen monstruos también de día, como en Minecraft)
  sky(x = this.game.player?.x ?? 0) {
    const T = this.game.days, h = T.hourAt(x);
    let s = h >= 6.5 && h < 19 ? 15 : h >= 5 && h < 6.5 ? 4 + (h - 5) / 1.5 * 11 : h >= 19 && h < 20.5 ? 15 - (h - 19) / 1.5 * 11 : 4;
    const rain = T.info?.rain || 0;
    if (rain >= 2) s = Math.min(s, 6); else if (rain) s -= 3;
    return Math.max(4, Math.round(s));
  }
  // La de las luces encendidas en una casilla (la más fuerte, menos la distancia en casillas)
  block(tx, ty) {
    const w = this.world, cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    let best = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = w.contentFor(cx + dx, cy + dy);
      for (const l of c.lights) best = Math.max(best, Math.min(15, Math.round(l.r / 3.7)) - Math.abs(Math.floor(l.x) - tx) - Math.abs(Math.floor(l.y) - ty));
    }
    for (const o of w.village.objects) if (o.model === 'lamp') best = Math.max(best, 15 - Math.abs(Math.floor(o.x) - tx) - Math.abs(Math.floor(o.y) - ty));   // (la farola del pueblo)
    return Math.max(0, best);
  }
  lightAt(tx, ty) { return Math.max(this.world.roofAt(tx, ty) ? 0 : this.sky(tx), this.block(tx, ty)); }
  // ¿Puede aparecer aquí un monstruo? Fuera del pueblo, en tierra, sin nada construido ni tejado, sin chocar con nada y a oscuras
  canSpawn(tx, ty) {
    const w = this.world, x = tx + 0.5, y = ty + 0.5;
    if (inBounds(x, y) || w.water(x, y) || w.at('placed', tx, ty) || w.at('floor', tx, ty) || w.roofAt(tx, ty)) return false;
    const p = { x, y };
    collide(p, w.collidersNear(x, y), 0.3);
    return Math.hypot(p.x - x, p.y - y) < 0.05 && this.lightAt(tx, ty) <= DARK;
  }

  // ---------- quién juega ----------
  // Los que están en el mundo de fuera: tú (salvo el mundo del servidor) y los demás, con su modo de juego
  players() {
    const g = this.game, p = g.player, out = [];
    if (p && !Profile.server && g.scene === g.world) out.push({ me: true, x: p.x, y: p.y, gm: g.gamemode, crouch: p.crouch });
    if (g.live.joined) for (const [conn, peer] of g.live.peers) {
      if (peer.playing && !peer.server && peer.sc === 'world' && peer.entity) out.push({ conn, x: peer.entity.x, y: peer.entity.y, gm: GM[peer.entity.gm || 0], crouch: peer.entity.crouch });
    }
    return out;
  }
  // ¿Hay algún monstruo a menos de d de este punto?
  near(x, y, d) { return this.list.some(m => distOf(m.x, m.y, x, y) < d); }

  // ---------- cada paso ----------
  update(dt) {
    const g = this.game;
    if (!g.world) return;
    if (g.live.guest) { this.follow(dt); return; }   // (en el mundo de otro, donde dice su juego)
    const diff = DIFF[g.difficulty] || DIFF.normal, players = this.players(), fighters = players.filter(q => q.gm === 'survival');
    const on = g.rules.doMobSpawning && diff.cap > 0;
    if (!on && this.list.length) this.list = [];
    if (on && (this.timers.spawn += dt) >= SPAWN_EVERY) { this.timers.spawn = 0; for (const q of fighters) this.trySpawn(q, players, diff.cap); }
    for (const m of [...this.list]) {
      if (!players.some(q => distOf(q.x, q.y, m.x, m.y) < FAR)) { this.remove(m); continue; }
      // Con el sol, al rato, se deshacen
      if (this.sky(m.x) > 11 && !this.world.roofAt(Math.floor(m.x), Math.floor(m.y)) && (m.sun += dt) > 1 + (m.id % 7) * 0.6) { this.remove(m, true); continue; }
      this.move(m, fighters, dt, diff);
    }
    if (g.live.joined && (this.timers.send += dt) >= SEND_EVERY) {
      this.timers.send = 0;
      const m = this.list.map(m => [m.id, m.type, r2(m.x), r2(m.y), m.hurt > 0 ? 1 : 0]), s = JSON.stringify(m);
      if (s !== this.lastSent) { this.lastSent = s; g.live.net?.send({ t: 'mobs', m }); }
    }
  }
  trySpawn(q, players, cap) {
    if (this.list.filter(m => distOf(m.x, m.y, q.x, q.y) < AROUND).length >= cap) return;
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, r = RING[0] + Math.random() * (RING[1] - RING[0]);
      const tx = Math.floor(wrapX(q.x + Math.cos(a) * r)), ty = Math.floor(q.y + Math.sin(a) * r);
      if (players.some(o => distOf(o.x, o.y, tx + 0.5, ty + 0.5) < AWAY) || !this.canSpawn(tx, ty)) continue;
      let k = Math.random(), type = NIGHT_TYPES[0][0];
      for (const [t, w] of NIGHT_TYPES) { if ((k -= w) < 0) { type = t; break; } }
      this.list.push(new Mob(type, tx + 0.5, ty + 0.5, ++this.n));
      return;
    }
  }
  move(m, fighters, dt, diff) {
    const g = this.game, def = m.def;
    m.cool = Math.max(0, m.cool - dt); m.hurt = Math.max(0, m.hurt - dt);
    let t = null, td = CHASE;
    const outside = !inBounds(m.x, m.y);   // (desde fuera no se persigue a quien está en el pueblo)
    for (const q of fighters) { const d = distOf(q.x, q.y, m.x, m.y); if (d < td && !(outside && inBounds(q.x, q.y))) { td = d; t = q; } }
    let vx = 0, vy = 0;
    if (t && td > 0.01) { vx = dxOf(t.x, m.x) / td; vy = (t.y - m.y) / td; m.dir = [vx, vy]; }
    else if ((m.wander -= dt) <= 0) { m.wander = 1 + Math.random() * 2; const a = Math.random() * 6.28; m.dir = Math.random() < 0.4 ? [0, 0] : [Math.cos(a) * 0.4, Math.sin(a) * 0.4]; }
    if (!vx && !vy) [vx, vy] = m.dir;
    if (m.hurt > 0.25 && m.from) { const dx = dxOf(m.x, m.from[0]), dy = m.y - m.from[1], d = Math.hypot(dx, dy) || 1; vx = dx / d * 2.5; vy = dy / d * 2.5; }   // (empujón al recibir un golpe)
    const sp = def.speed * dt, p = { x: m.x + vx * sp, y: m.y + vy * sp };
    collide(p, this.world.collidersNear(p.x, p.y), 0.25);
    // (el de fuera no entra en el pueblo: se queda en el límite o sigue a lo largo de él)
    if (outside && inBounds(wrapX(p.x), p.y)) { if (!inBounds(wrapX(p.x), m.y)) p.y = m.y; else if (!inBounds(m.x, p.y)) p.x = m.x; else { p.x = m.x; p.y = m.y; } }
    if (!this.world.water(p.x, p.y)) { m.x = wrapX(p.x); m.y = p.y; }
    m.step += dt * 5;
    if (t && td < BITE && m.cool <= 0) {
      m.cool = 1.5;
      const dmg = Math.max(0.5, def.dmg * diff.dmg * 1.5);
      if (t.me) { if (g.combat.invuln <= 0) g.combat.hit(dmg, m); }
      else g.live.order(t.conn, { t: 'hurt', dmg, x: r2(m.x), y: r2(m.y) });
    }
  }
  remove(m, sun = false) {
    const i = this.list.indexOf(m);
    if (i >= 0) this.list.splice(i, 1);
    if (sun) this.game.gather.chips(m.x, m.y, 'stone', 10);
  }
  // (invitado) Donde los tiene quien lleva el mundo: [[id, tipo, x, y, herido]]
  netList(arr) {
    const old = new Map(this.list.map(m => [m.id, m]));
    this.list = arr.filter(([, type]) => MONSTERS[type]).map(([id, type, x, y, hurt]) => {   // (una criatura de una versión más nueva, que este juego no conoce, no se ve)
      const m = old.get(id) || new Mob(type, x, y, id);
      m.netTo = [x, y];
      if (hurt && m.hurt <= 0) m.hurt = 0.4;
      return m;
    });
  }
  follow(dt) {
    const k = 1 - Math.exp(-dt * 10);
    for (const m of this.list) {
      m.hurt = Math.max(0, m.hurt - dt);
      if (!m.netTo) continue;
      const dx = dxOf(m.netTo[0], m.x) * k, dy = (m.netTo[1] - m.y) * k;
      if (Math.abs(dx) + Math.abs(dy) > 1e-3) { m.dir = [dx, dy]; m.step += dt * 5; }
      m.x = wrapX(m.x + dx); m.y += dy;
    }
  }

  // ---------- pegarles ----------
  // Un golpe a un monstruo de fuera (lo da tu juego): si llevas tú el mundo, se lo das; si no, se lo pides a quien lo
  // lleva, que dice si lo has matado. Devuelve si ha muerto ya
  strike(m, dmg, far = false) {
    const g = this.game, p = g.player;
    m.hurt = 0.4;
    if (g.live.guest) { g.live.net?.send({ t: 'hitm', id: m.id, dmg, x: r2(p.x), y: r2(p.y), far: far ? 1 : 0 }, g.live.hostConn); return false; }
    return this.damage(m, dmg, [p.x, p.y], null);
  }
  // (quien lleva el mundo) Un golpe desde from; by: la conexión de quien lo ha dado (null: tú)
  damage(m, dmg, from, by) {
    m.hp -= dmg; m.hurt = 0.4; m.from = from;
    if (m.hp > 0) return false;
    this.remove(m);
    if (by === null) this.game.combat.reward(m);
    else this.game.live.net?.send({ t: 'mobdead', id: m.id, x: r2(m.x), y: r2(m.y), type: m.type }, by);
    return true;
  }
  hitBy(conn, peer, msg) {
    const m = this.list.find(m => m.id === msg.id);
    if (!m || !Number.isFinite(msg.dmg)) return;
    // (de cerca: como lo que se toca del mundo)
    if (peer.at && distOf(peer.at[0], peer.at[1], m.x, m.y) > (msg.far ? 60 : 4)) return;   // (con una flecha, de más lejos)
    this.damage(m, Math.min(10, Math.max(0, msg.dmg)), [msg.x, msg.y], conn);
  }
  // (invitado) Has matado a uno: lo que suelta, para ti
  killed(msg) {
    const m = this.list.find(m => m.id === msg.id) || new Mob(msg.type, msg.x, msg.y, msg.id);
    this.remove(m);
    if (MONSTERS[m.type]) this.game.combat.reward(m);
  }
  // /summon y /kill @e (los hace quien lleva el mundo)
  summon(type, x, y) { const m = new Mob(type, wrapX(x), y, ++this.n); this.list.push(m); return m; }
  clearNear(x, y, r) { const before = this.list.length; this.list = this.list.filter(m => distOf(m.x, m.y, x, y) >= r); return before - this.list.length; }
  entities(scene) { return scene === this.world && this.list.length ? this.list : null; }
}
