// El arco, como en Minecraft: mantener pulsado tensa (un segundo para la fuerza máxima, y se anda despacio), al soltar sale
// la flecha, que vuela en parábola: cuanto más tensa, más lejos y más daña. Choca con la forma de lo que se ve (las barras
// y los postes de las vallas, los muros, los troncos, las rocas, los muebles, los tejados: ver world/shots.js) y se clava
// por la punta; por donde no hay nada, sigue volando. Se recoge con solo pasar por encima (o junto al muro o al tronco
// donde se ha clavado, si se alcanza), también en creativo; la que da a un animal o a una criatura se pierde. En primera
// persona va hacia la cruceta; en tercera, hacia el cursor (con el ángulo justo para llegar, si la fuerza da); sin ratón,
// hacia delante.
//
// Jugando juntos, cada flecha la lleva quien la dispara: él decide a quién da. Los demás la ven volar con los mismos
// datos, y cualquiera puede recogerla una vez clavada (también las del otro): la propia, al momento; la del otro se le
// pide a quien la disparó, que se la da al primero que la pida (así no la recogen dos a la vez), y se avisa a todos de
// que ya no está. Si no contesta (se ha ido, o su juego es de antes), se recoge sin más. Las de creativo (free) solo dan
// flecha a quien juega en creativo: en supervivencia desaparecen sin dar nada, como en Minecraft.
import { keys } from './input.js';
import { CAM } from './camera.js';
import { ITEMS } from './items.js';
import { Audio } from './audio.js';
import { Profile } from './accounts.js';
import { rayHits, aabb } from './world/fit.js';
import { wrapX, nearX } from './world/planet.js';
import { shotHit } from './world/shots.js';
import { WALL_H, ROOF } from './three/build3d.js';
import { bodyBox, PREY } from './hunt.js';

export const V = 24, G = 16;                    // lo que corre la flecha a toda fuerza (casillas por segundo) y lo que la baja
const FULL_DRAW = 1, MIN_POWER = 0.1, MAX_DMG = 6, DRAW_WALK = 0.45;
const AIR_TTL = 12, STUCK_TTL = 300, FREE_TTL = 60, PICK_AFTER = 0.3, PICK_NEAR = 0.9, REACH = [-0.7, 2.3], ASK_WAIT = 1.5;
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
  // Hacia dónde va la flecha: { o, d, from } (o: de dónde sale, [x, altura, y]; d: dirección con su largo 1; from: el cuerpo
  // o el ojo del que dispara, para ver si entre él y la flecha ya hay algo: ver step)
  aim(p, speed) {
    const g = this.game, ground = g.view3d.groundY?.(g.scene, p.x, p.y) || 0, h = ground + (p.crouch ? 0.75 : 1.15) + (p.z || 0);
    const m = g.mouse;
    if (CAM.first) {
      const ray = g.view3d.rayAt?.(innerWidth / 2, innerHeight / 2);
      if (ray) return { o: [ray.o[0] + ray.d[0] * 0.5, ray.o[1] + ray.d[1] * 0.5 - 0.1, ray.o[2] + ray.d[2] * 0.5], d: ray.d, from: [ray.o[0], ray.o[1] - 0.1, ray.o[2]] };
    }
    const at = m?.in ? this.cursorPoint(m) : null;
    if (!at) { const a = 0.14, c = Math.cos(a); return { o: [p.x + p.face.x * 0.4, h, p.y + p.face.y * 0.4], d: [p.face.x * c, Math.sin(a), p.face.y * c], from: [p.x, h, p.y] }; }
    const dx = at[0] - p.x, dy = at[2] - p.y, x = Math.hypot(dx, dy) || 0.01, ux = dx / x, uy = dy / x;
    // El ángulo bajo que llega a ese punto, si la fuerza da; si no, el que más lejos llega sin subir demasiado
    const yy = at[1] - h, v2 = speed * speed, root = v2 * v2 - G * (G * x * x + 2 * yy * v2), ang = root >= 0 ? Math.atan((v2 - Math.sqrt(root)) / (G * x)) : 0.6;
    const c = Math.cos(ang);
    return { o: [p.x + ux * 0.4, h, p.y + uy * 0.4], d: [ux * c, Math.sin(ang), uy * c], from: [p.x, h, p.y] };
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
    const speed = V * power, { o, d, from } = this.aim(p, speed), free = g.inv.infinite;
    if (!free) g.inv.remove('flecha', 1);
    g.gather.wearOut();
    g.combat.exert(0.1);
    Audio.swish();
    const a = this.add({ id: `${Profile.id || 'yo'}-${++this.n}`, x: o[0], h: o[1], y: o[2], vx: d[0] * speed, vh: d[1] * speed, vy: d[2] * speed, dmg: Math.max(1, Math.round(MAX_DMG * power)), mine: true, free, scene: g.scene, from });
    if (g.scene === g.world) g.live.net?.send({ t: 'arrow', id: a.id, x: r2(a.x), h: r2(a.h), y: r2(a.y), vx: r2(a.vx), vh: r2(a.vh), vy: r2(a.vy), free: free ? 1 : 0, o: from.map(r2) });
    return a;
  }
  add(a) {
    Object.assign(a, { age: 0, stuck: false });
    this.list.push(a);
    if (this.list.length > MAX_ARROWS) this.list.shift();
    return a;
  }
  // (de otro jugador, conn) Una flecha que ha disparado: se ve volar igual, sin decidir a quién da. Sale de su cuerpo (m.o;
  // si su juego es de antes y no lo dice, de 0,4 por detrás de la flecha)
  ghost(m, conn = null) {
    const g = this.game;
    if (Profile.server || !g.player || g.scene !== g.world || ![m.x, m.h, m.y, m.vx, m.vh, m.vy].every(Number.isFinite)) return;
    const l = Math.hypot(m.vx, m.vy) || 1, from = Array.isArray(m.o) && m.o.length === 3 && m.o.every(Number.isFinite) ? m.o : [m.x - m.vx / l * 0.4, m.h, m.y - m.vy / l * 0.4];
    this.add({ id: m.id, x: m.x, h: m.h, y: m.y, vx: m.vx, vh: m.vh, vy: m.vy, dmg: 0, mine: false, free: !!m.free, scene: g.world, from, owner: conn });
  }
  // (de otro jugador) Una que ya no está: ha dado a algo o la ha recogido. Si se le ha dado a uno (to), y es a ti, a la mochila
  gone(id, to = null) {
    const a = this.list.find(q => q.id === id);
    if (a && to !== null && to === this.game.live.net?.me) this.give(a);
    this.list = this.list.filter(q => q.id !== id);
  }
  // (de otro jugador, conn) Pide una de las tuyas que ha recogido: si aún está, es suya (se avisa a todos de a quién va)
  asked(id, conn) {
    const a = this.list.find(q => q.id === id && q.mine && q.stuck);
    if (!a) return;
    this.list = this.list.filter(q => q !== a);
    this.game.live.net?.send({ t: 'arrowgone', id, to: conn });
  }
  // Una recogida, a la mochila (si no cabe, al suelo, a los pies). Las de creativo, solo si se juega en creativo
  give(a) {
    const g = this.game;
    Audio.pickup();
    if (a.free && !g.inv.infinite) return;
    if (g.inv.add('flecha', 1)) g.gather.throwOut('flecha', 1);
  }

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
  // El suelo para la flecha: el del andar, salvo en las casillas de solo valla en cuesta, donde lo construido sube a su
  // altura para andar pero lo que se ve es la tierra (y, bajo el poste, su dado de piedra: ver world/shots.js)
  ground(x, y) {
    const g = this.game, sc = g.scene, v = g.view3d.groundY?.(sc, x, y) || 0;
    if (sc !== g.world || !sc.groundRaw) return v;
    const tx = Math.floor(x), ty = Math.floor(y), kind = sc.pieceAt(tx, ty)?.kind;
    return (kind === 'fence' || kind === 'gate') && !sc.at('floor', tx, ty) ? Math.min(v, sc.groundRaw(x, y)) : v;
  }
  step(dt) {
    const g = this.game, gy = (x, y) => this.ground(x, y);
    let targets = null;
    this.list = this.list.filter(a => {
      a.age += dt;
      if (a.stuck) return a.age < (a.free ? FREE_TTL : STUCK_TTL);
      if (a.age > AIR_TTL) return false;
      if (a.scene !== g.scene) return a.scene === g.world;   // (mientras se está en una cueva, las de fuera se quedan quietas)
      const nx = a.x + a.vx * dt, ny = a.y + a.vy * dt, nh = a.h + a.vh * dt - G * dt * dt / 2, len = Math.hypot(nx - a.x, ny - a.y, nh - a.h) || 1e-6;
      const d = [(nx - a.x) / len, (nh - a.h) / len, (ny - a.y) / len], tip = [a.x + d[0] * TIP, a.h + d[1] * TIP, a.y + d[2] * TIP];
      // (al salir: lo que hay entre el que dispara y la punta, que está ya a casi un metro de él. Pegado a un muro, a un
      // tronco o a un animal, la flecha da ahí y no aparece al otro lado)
      if (a.from) {
        const f = a.from, v = [tip[0] - f[0], tip[1] - f[1], tip[2] - f[2]], l = Math.hypot(...v) || 1e-6, u = v.map(c => c / l);
        a.from = null;
        if (a.mine) {
          let hit = null, near = l;
          for (const [e, b, gy0] of (targets ||= this.targets())) {
            const t = rayHits(f, u, { ...b, y0: b.y0 + gy0, y1: b.y1 + gy0 });
            if (t !== null && t <= near) { near = t; hit = e; }
          }
          if (hit) { this.strike(a, hit); return false; }
        }
        const t = this.hit(g.scene, f, u, l, gy);
        if (t !== null) { this.stick(a, f[0] + u[0] * t, f[1] + u[1] * t, f[2] + u[2] * t, d, SINK.solid); return true; }
      }
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
    // (el tejado: de lo alto del muro a su cara de arriba, con la forma con que se dibuja: ver three/world3d.js, r.top; y su
    // alero, que sale ROOF.over de las casillas y baja hacia fuera. Se mira en tres puntos del paso y, si alguno está dentro,
    // se busca dónde entra)
    const W = this.game.view3d.world;
    if (!W?.regionOf || !W.regions.size) return best;
    const inRoof = t => {
      const x = o[0] + d[0] * t, y = o[2] + d[2] * t, h = o[1] + d[1] * t, tx = Math.floor(x), ty = Math.floor(y), r = W.regions.get(W.regionOf.get(`${tx},${ty}`));
      if (r) return !!r.top && h > (r.level || 0) + WALL_H - 0.05 && h < r.top(x, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const q = (dx || dy) && W.regions.get(W.regionOf.get(`${tx + dx},${ty + dy}`));
        if (!q?.top) continue;
        const out = Math.hypot(Math.max(tx + dx - x, 0, x - tx - dx - 1), Math.max(ty + dy - y, 0, y - ty - dy - 1));
        if (out > ROOF.over) continue;
        const top = (q.level || 0) + WALL_H + ROOF.thick - out * ROOF.level;   // (la cara de arriba del alero, a esa distancia)
        if (h < top && h > top - ROOF.thick - 0.06) return true;
      }
      return false;
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
  // tejado, no; a través de un muro, tampoco): vuelve a la mochila, también en creativo y también las del otro jugador.
  // La del otro se le pide a él (ver asked); la propia, al momento, y se avisa a todos de que ya no está
  pickUp(p) {
    const g = this.game, sc = g.scene, net = g.live.net;
    if (g.gamemode === 'spectator' || g.busy) return;
    const feet = (g.view3d.groundY?.(sc, p.x, p.y) || 0) + (p.z || 0);
    this.list = this.list.filter(a => {
      if (!a.stuck || a.age < PICK_AFTER || a.scene !== sc) return true;
      const up = a.h - feet, x = sc === g.world ? nearX(a.x, p.x) : a.x;
      if (Math.hypot(x - p.x, a.y - p.y) > PICK_NEAR || up < REACH[0] || up > REACH[1]) return true;
      if (sc.reaches && !sc.reaches(p.x, p.y, x, a.y)) return true;
      if ((!a.free || g.inv.infinite) && !g.inv.room('flecha')) return true;   // (si no cabe, se queda)
      // (del otro, si sigue aquí: se le pide, y se espera su respuesta un rato; si no llega, se coge sin más)
      if (!a.mine && a.owner !== null && a.owner !== undefined && net?.peers?.has(a.owner) && sc === g.world) {
        if (a.asked === undefined) { a.asked = g.time; net.send({ t: 'arrowtake', id: a.id }, a.owner); return true; }
        if (g.time - a.asked < ASK_WAIT) return true;
      }
      this.give(a);
      if (a.scene === g.world) net?.send({ t: 'arrowgone', id: a.id });
      return false;
    });
  }
}
