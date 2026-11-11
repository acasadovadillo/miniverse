// El arco, como en Minecraft: mantener pulsado tensa (un segundo para la fuerza máxima, y se anda despacio), al soltar sale
// la flecha, que vuela en parábola: cuanto más tensa, más lejos y más daña. Choca con la forma de lo que se ve (las barras
// y los postes de las vallas, los muros, los troncos, las rocas, los muebles, los tejados: ver world/shots.js) y se clava
// por la punta; por donde no hay nada, sigue volando. Se recoge con solo pasar por encima (o junto al muro o al tronco
// donde se ha clavado, si se alcanza), también en creativo; la que da a un animal o a una criatura se pierde. En primera
// persona va hacia la cruceta; en tercera, hacia el cursor (con el ángulo justo para llegar, si la fuerza da); sin ratón,
// hacia delante.
//
// Jugando juntos, cada flecha la lleva quien la dispara: él decide a quién da. Los demás la ven volar con los mismos
// datos, y cualquiera puede recogerla una vez clavada (también las del otro): entonces se avisa a todos de que ya no está.
import { keys } from './input.js';
import { CAM } from './camera.js';
import { ITEMS } from './items.js';
import { Audio } from './audio.js';
import { Profile } from './accounts.js';
import { rayHits, aabb } from './world/fit.js';
import { wrapX, nearX } from './world/planet.js';
import { shotHit } from './world/shots.js';
import { WALL_H } from './three/build3d.js';
import { bodyBox, PREY } from './hunt.js';

export const V = 24, G = 16;                    // lo que corre la flecha a toda fuerza (casillas por segundo) y lo que la baja
const FULL_DRAW = 1, MIN_POWER = 0.1, MAX_DMG = 6, DRAW_WALK = 0.45;
const AIR_TTL = 12, STUCK_TTL = 300, FREE_TTL = 60, PICK_AFTER = 0.3, PICK_NEAR = 0.9, REACH = [-0.7, 2.3];
// (la flecha va por su centro, a.x/a.h/a.y; la punta, TIP por delante. Clavada, la punta entra SINK: más en la tierra)
const TIP = 0.42, SINK = { ground: 0.18, solid: 0.09 };
const MAX_ARROWS = 60;
const r2 = v => Math.round(v * 100) / 100;

export class Archery {
  constructor(game) { this.game = game; this.list = []; this.n = 0; this.drawT = null; }
  reset() { this.list = []; this.drawT = null; }
  // Lo tenso que está (de 0 a 1)
  get k() { return this.drawT === null ? 0 : Math.min(1, this.drawT / FULL_DRAW); }
  get walk() { return this.drawT === null ? 1 : DRAW_WALK; }
  arrows() { const inv = this.game.inv; return inv.infinite ? Infinity : inv.count('flecha'); }

  // Lo que dice la ayuda con el arco en la mano
  target(p, held, def) {
    if (!def?.bow) return null;
    const n = this.arrows();
    if (!n) return { tile: null, ok: false, label: 'No te quedan flechas' };
    if (this.drawT !== null) return { tile: null, ok: true, label: `Tensando: ${Math.round(this.k * 100)} % (suelta para disparar)` };
    return { tile: null, ok: true, label: `Mantén pulsado para tensar${n === Infinity ? '' : ` (${n} flecha${n === 1 ? '' : 's'})`}` };
  }
  // Se pulsa el botón con el arco en la mano
  press() {
    if (this.drawT !== null) return;
    if (!this.arrows()) { Audio.error(); return; }
    this.drawT = 0;
    Audio.swish();
  }
  update(dt) {
    const g = this.game, p = g.player;
    if (!p) return;
    if (this.drawT !== null) {
      const able = ITEMS[g.inv.held?.id]?.bow && g.mode === 'play' && !g.busy && !p.pose && this.arrows();
      if (!able) this.drawT = null;
      else if (!keys.use) { this.fire(); this.drawT = null; }
      else { this.drawT += dt; this.turnTo(p); }
    }
    p.drawing = this.drawT !== null;
    this.step(dt);
    this.pickUp(p);
  }
  // La fuerza de un tensado (como en Minecraft: al principio crece deprisa)
  static power(k) { return (k * k + 2 * k) / 3; }
  // Hacia dónde va la flecha: { o, d } (o: de dónde sale, [x, altura, y]; d: dirección con su largo 1)
  aim(p, speed) {
    const g = this.game, ground = g.view3d.groundY?.(g.scene, p.x, p.y) || 0, h = ground + (p.crouch ? 0.75 : 1.15) + (p.z || 0);
    const m = g.mouse;
    if (CAM.first) {
      const ray = g.view3d.rayAt?.(innerWidth / 2, innerHeight / 2);
      if (ray) return { o: [ray.o[0] + ray.d[0] * 0.5, ray.o[1] + ray.d[1] * 0.5 - 0.1, ray.o[2] + ray.d[2] * 0.5], d: ray.d };
    }
    const at = m?.in ? this.cursorPoint(m) : null;
    if (!at) { const a = 0.14, c = Math.cos(a); return { o: [p.x + p.face.x * 0.4, h, p.y + p.face.y * 0.4], d: [p.face.x * c, Math.sin(a), p.face.y * c] }; }
    const dx = at[0] - p.x, dy = at[2] - p.y, x = Math.hypot(dx, dy) || 0.01, ux = dx / x, uy = dy / x;
    // El ángulo bajo que llega a ese punto, si la fuerza da; si no, el que más lejos llega sin subir demasiado
    const yy = at[1] - h, v2 = speed * speed, root = v2 * v2 - G * (G * x * x + 2 * yy * v2), ang = root >= 0 ? Math.atan((v2 - Math.sqrt(root)) / (G * x)) : 0.6;
    const c = Math.cos(ang);
    return { o: [p.x + ux * 0.4, h, p.y + uy * 0.4], d: [ux * c, Math.sin(ang), uy * c] };
  }
  // El punto bajo el cursor: el cuerpo de un animal o de una criatura, si está en el rayo; si no, el suelo
  cursorPoint(m) {
    const g = this.game, ray = g.view3d.rayAt?.(m.x, m.y);
    let best = null, near = Infinity;
    if (ray) for (const [, b, gy] of this.targets()) {
      const t = rayHits(ray.o, ray.d, { ...b, y0: b.y0 + gy, y1: b.y1 + gy });
      if (t !== null && t < near) { near = t; best = [b.x, gy + (b.y0 + b.y1) / 2, b.y]; }
    }
    if (best) return best;
    const pt = g.mousePoint?.();
    return pt && [pt[0], (g.view3d.groundY?.(g.scene, pt[0], pt[1]) || 0) + 0.3, pt[1]];
  }
  // Mirar hacia donde se apunta mientras se tensa (en tercera persona: en primera ya mira hacia ahí)
  turnTo(p) {
    if (CAM.first || !this.game.mouse?.in) return;
    const at = this.cursorPoint(this.game.mouse);
    if (!at) return;
    const dx = at[0] - p.x, dy = at[2] - p.y, l = Math.hypot(dx, dy);
    if (l > 0.2) { p.face = { x: dx / l, y: dy / l }; p.dir = [dx, dy]; }
  }
  fire() {
    const g = this.game, p = g.player, k = this.k, power = Archery.power(k);
    if (power < MIN_POWER || !g.scene) return null;   // (sin tensar apenas no sale)
    const speed = V * power, { o, d } = this.aim(p, speed), free = g.inv.infinite;
    if (!free) g.inv.remove('flecha', 1);
    g.gather.wearOut();
    g.combat.exert(0.1);
    Audio.swish();
    const a = this.add({ id: `${Profile.id || 'yo'}-${++this.n}`, x: o[0], h: o[1], y: o[2], vx: d[0] * speed, vh: d[1] * speed, vy: d[2] * speed, dmg: Math.max(1, Math.round(MAX_DMG * power)), mine: true, free, scene: g.scene });
    if (g.scene === g.world) g.live.net?.send({ t: 'arrow', id: a.id, x: r2(a.x), h: r2(a.h), y: r2(a.y), vx: r2(a.vx), vh: r2(a.vh), vy: r2(a.vy), free: free ? 1 : 0 });
    return a;
  }
  add(a) {
    Object.assign(a, { age: 0, stuck: false });
    this.list.push(a);
    if (this.list.length > MAX_ARROWS) this.list.shift();
    return a;
  }
  // (de otro jugador) Una flecha que ha disparado: se ve volar igual, sin decidir a quién da
  ghost(m) {
    const g = this.game;
    if (Profile.server || !g.player || g.scene !== g.world || ![m.x, m.h, m.y, m.vx, m.vh, m.vy].every(Number.isFinite)) return;
    this.add({ id: m.id, x: m.x, h: m.h, y: m.y, vx: m.vx, vh: m.vh, vy: m.vy, dmg: 0, mine: false, free: !!m.free, scene: g.world });
  }
  // (de otro jugador) Una que ya no está: ha dado a algo o la ha recogido
  gone(id) { this.list = this.list.filter(a => a.id !== id); }

  // A quién puede dar: [cosa, su caja, la altura del suelo] de los animales y las criaturas de esta escena
  targets() {
    const g = this.game, sc = g.scene, out = [], gy = e => g.view3d.groundY?.(sc, e.x, e.y) || 0;
    for (const m of g.combat.monsters || []) {
      const fly = g.combat.flies(m), tall = m.type === 'esqueleto' ? 1.4 : 0.7;
      out.push([m, { ...aabb(m.x - 0.4, m.y - 0.4, m.x + 0.4, m.y + 0.4), y0: fly ? 0.9 : 0, y1: fly ? 1.7 : tall }, gy(m)]);
    }
    if (sc === g.world) {
      for (const e of g.ranch.animals) if (PREY[e.type] && (!e.inside || g.ranch.stall(e)) && !e.rider && g.hunt.canHit(e)) out.push([e, bodyBox(e), gy(e)]);
      for (const e of g.wildlife.list) out.push([e, bodyBox(e), gy(e)]);
    }
    return out;
  }
  step(dt) {
    const g = this.game, gy = (x, y) => g.view3d.groundY?.(g.scene, x, y) || 0;
    let targets = null;
    this.list = this.list.filter(a => {
      a.age += dt;
      if (a.stuck) return a.age < (a.free ? FREE_TTL : STUCK_TTL);
      if (a.age > AIR_TTL) return false;
      if (a.scene !== g.scene) return a.scene === g.world;   // (mientras se está en una cueva, las de fuera se quedan quietas)
      const nx = a.x + a.vx * dt, ny = a.y + a.vy * dt, nh = a.h + a.vh * dt - G * dt * dt / 2, len = Math.hypot(nx - a.x, ny - a.y, nh - a.h) || 1e-6;
      const d = [(nx - a.x) / len, (nh - a.h) / len, (ny - a.y) / len], tip = [a.x + d[0] * TIP, a.h + d[1] * TIP, a.y + d[2] * TIP];
      if (a.mine) {
        let hit = null, near = len;
        for (const [e, b, gy0] of (targets ||= this.targets())) {
          const t = rayHits(tip, d, { ...b, y0: b.y0 + gy0, y1: b.y1 + gy0 });
          if (t !== null && t <= near) { near = t; hit = e; }
        }
        if (hit) { this.strike(a, hit); return false; }
      }
      a.vh -= G * dt;
      // (la punta: dónde toca el suelo, si lo toca en este paso, y lo primero que encuentra antes)
      const tx = tip[0] + d[0] * len, ty = tip[2] + d[2] * len, th = tip[1] + d[1] * len, over0 = tip[1] - gy(tip[0], tip[2]), over1 = th - gy(tx, ty);
      let t = over1 <= 0 ? len * Math.max(0, over0) / Math.max(1e-6, over0 - over1) : null, into = 'ground';
      const solid = this.hit(g.scene, tip, d, t ?? len, gy);
      if (solid !== null) { t = solid; into = 'solid'; }
      else if (g.scene === g.world && over1 <= 0.25 && g.world.water(tx, ty)) { g.gather.chips(tx, ty, 'water', 6); return false; }   // (al agua: se hunde)
      if (t !== null) { this.stick(a, tip[0] + d[0] * t, tip[1] + d[1] * t, tip[2] + d[2] * t, d, SINK[into]); return true; }
      a.x = g.scene === g.world ? wrapX(nx) : nx; a.y = ny; a.h = nh;
      return true;
    });
  }
  // Lo primero con lo que choca la punta yendo de o hacia d, antes de len (o null). En el mundo, la forma de lo que se ve
  // (world/shots.js) y los tejados (por dentro, el techo); en una cueva, sus paredes
  hit(sc, o, d, len, gy) {
    if (sc !== this.game.world) {
      for (let t = 0.1; t <= len; t += 0.1) if (sc.blocked?.(o[0] + d[0] * t, o[2] + d[2] * t)) return t;
      return null;
    }
    const best = shotHit(sc, o, d, len, gy), end = best ?? len;
    // (el tejado: de lo alto del muro a su cara de arriba, con la forma con que se dibuja: ver three/world3d.js, r.top. Se
    // mira en tres puntos del paso y, si alguno está dentro, se busca dónde entra)
    const W = this.game.view3d.world;
    if (!W?.regionOf || !W.regions.size) return best;
    const inRoof = t => {
      const x = o[0] + d[0] * t, y = o[2] + d[2] * t, h = o[1] + d[1] * t, r = W.regions.get(W.regionOf.get(`${Math.floor(x)},${Math.floor(y)}`));
      return !!r?.top && h > (r.level || 0) + WALL_H - 0.05 && h < r.top(x, y);
    };
    if (inRoof(0)) return best;   // (ya dentro: sale de ahí)
    for (let i = 1; i <= 3; i++) {
      let hi = end * i / 3;
      if (!inRoof(hi)) continue;
      let lo = end * (i - 1) / 3;
      for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (inRoof(m)) hi = m; else lo = m; }
      return hi;
    }
    return best;
  }
  // Clavada: con la punta SINK dentro de lo que ha tocado (en p), en la dirección en que iba
  stick(a, px, ph, py, d, sink) {
    const back = TIP - sink, g = this.game;
    a.stuck = true; a.age = 0;
    a.x = g.scene === g.world ? wrapX(px - d[0] * back) : px - d[0] * back; a.h = ph - d[1] * back; a.y = py - d[2] * back;
    a.vx = d[0]; a.vh = d[1]; a.vy = d[2];   // (hacia donde apunta clavada)
    const me = g.player, dist = me ? Math.hypot(nearX(a.x, me.x) - me.x, a.y - me.y) : 0;
    if (dist < 25) Audio.noiseHit(1200, 0.05, 0.15);
  }
  strike(a, e) {
    const g = this.game;
    if (PREY[e.type]) g.hunt.shot(e, a.dmg); else g.combat.shot(e, a.dmg);
    Audio.chop();
    if (a.scene === g.world) g.live.net?.send({ t: 'arrowgone', id: a.id });
  }
  // Pasar por encima de una clavada, o junto al muro o al tronco donde está si se alcanza (en lo alto de un muro o de un
  // tejado, no): vuelve a la mochila, también en creativo y también las del otro jugador. Se avisa a todos: ya no está
  pickUp(p) {
    const g = this.game;
    if (g.gamemode === 'spectator' || g.busy) return;
    const feet = (g.view3d.groundY?.(g.scene, p.x, p.y) || 0) + (p.z || 0);
    this.list = this.list.filter(a => {
      if (!a.stuck || a.age < PICK_AFTER || a.scene !== g.scene) return true;
      const up = a.h - feet, x = g.scene === g.world ? nearX(a.x, p.x) : a.x;
      if (Math.hypot(x - p.x, a.y - p.y) > PICK_NEAR || up < REACH[0] || up > REACH[1]) return true;
      if (g.inv.add('flecha', 1)) return true;   // (si no cabe, se queda)
      Audio.pickup();
      if (a.scene === g.world) g.live.net?.send({ t: 'arrowgone', id: a.id });
      return false;
    });
  }
}
