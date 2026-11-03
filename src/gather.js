// Recolectar: elegir lo que hay delante del jugador, golpearlo con la herramienta,
// soltar lo que da y recogerlo. También los efectos: astillas, textos flotantes y el golpe de la herramienta.
import { ITEMS, HARVEST, TOOL_COST, ENERGY_MAX, CROPS, toolId, hitsFor } from './items.js';
import { RECIPES } from './recipes.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { RUG_SIZES, TABLE_SIZES } from './art/stations.js';

// Lo que se coloca libre (donde se apunte, con cualquier giro): muebles, estaciones, lo que va plano y las
// alfombras. Los cuadros y el hogar, contra un muro, siguen yendo por casillas
export const freePlace = id => !!id && id !== 'chimenea' && ['furniture', 'station', 'flat', 'rug'].includes(ITEMS[id]?.place);
// Los tamaños que se eligen con V (índices de RUG_SIZES y TABLE_SIZES: girarlos ya lo hace R)
const sizesOf = id => (ITEMS[id]?.place === 'rug' ? [0, 1, 3, 4, 6] : id === 'mesa_grande' ? [0, 2, 3, 5] : null);

const REACH = 1.7;          // alcance en casillas
const COOLDOWN = 0.32;      // segundos entre golpes
const CHIPS = {
  wood: ['#8a5a30', '#b07a44', '#e0b878'], stone: ['#7e7a72', '#a8a49a', '#5e5a55'], leaf: ['#4a9638', '#7cbf55', '#3a7c2e'],
  cactus: ['#4f9a52', '#7cc07a', '#f4f0d0'], twig: ['#8a6a44', '#a8865a', '#c8a878'], dirt: ['#6a4428', '#8a5a34', '#4a2e1a'],
  water: ['#9ad0ff', '#7ab8e0', '#d8f0ff'], heart: ['#ff7aa8', '#ff9ac8', '#ffffff'], feather: ['#ffffff', '#e8e4dc', '#c8c8d0'],
};

const TURN_WAIT = 0.22, TURN_SPEED = 1.7;   // R: lo que dura un toque (s) y lo que gira mantenida (rad/s)
const PLACE_REACH = 4;   // casillas de distancia a las que se puede colocar algo con el ratón

export class Gathering {
  constructor(game) {
    this.game = game;
    this.drops = [];        // objetos en el suelo esperando a que los recojan
    this.parts = [];        // astillas
    this.floaters = [];     // textos que suben ("+3 Madera")
    this.pending = new Map();
    this.target = null;
    this.rot = 0;           // giro de lo que va contra un muro (cuadros y hogar: cuatro, con R)
    this.angle = 0;         // giro de lo que se coloca libre (radianes: R lo va girando poco a poco)
    this.size = 0;          // tamaño de la alfombra o de la mesa grande (V)
    this.turn = null;       // R pulsada: { dir, at }
    this.cursor = null;     // casilla bajo el ratón (para colocar donde apunta), [x, y]
    this.cursorAt = 0;
    this.cooldown = 0;
    this.swing = 0;
    this.swingItem = null;
  }

  pointTo(tile) { this.cursor = tile; this.cursorAt = performance.now(); }
  reset() { this.drops = []; this.parts = []; this.floaters = []; this.target = null; }

  // Qué hay justo delante del jugador (o qué casilla labraría la azada, o dónde iría lo que se coloca)
  pickTarget() {
    const g = this.game, p = g.player;
    if (!p || g.mode !== 'play' || g.build.on) return null;
    const held = g.inv.held, def = held && ITEMS[held.id], tool = def?.tool;
    // Lo que se coloca libre va al punto del ratón (si se ha movido hace poco), o un paso por delante, girado como
    // diga R; se arrima a la pared que roce y no se pone si corta algo
    if (freePlace(held?.id) && g.scene.fitFree) {
      const mp = g.mousePoint();
      if (mp) { this.cursorPt = mp; this.cursorAt = performance.now(); }
      const pt = this.cursorPt && performance.now() - this.cursorAt < 4000 ? this.cursorPt : [p.x + p.face.x * 1.3, p.y + p.face.y * 1.3];
      const S = sizesOf(held.id), k = S ? S[this.size % S.length] : 0, f = g.scene.fitFree(held.id, pt[0], pt[1], this.angle, k, p);
      const far = Math.hypot(f.cx - p.x, f.cy - p.y) > PLACE_REACH + 0.5;
      return { free: true, ok: f.ok && !far, far, why: f.why, fit: f, place: held.id, model: f.model, x: f.ox, y: f.oy, a: f.a, rot: k };
    }
    if (def?.place) {
      // Lo que se coloca va a la casilla del ratón, si se ha movido hace poco y está a PLACE_REACH casillas
      // como mucho; si no, a la de delante (también dentro de casa)
      let [tx, ty] = [Math.floor(p.x + p.face.x), Math.floor(p.y + p.face.y)], far = false;
      const mt = g.mouseTile();
      if (mt) this.pointTo(mt);
      if (this.cursor && performance.now() - this.cursorAt < 4000) {
        [tx, ty] = this.cursor;
        far = Math.max(Math.abs(tx - Math.floor(p.x)), Math.abs(ty - Math.floor(p.y))) > PLACE_REACH;
      }
      // Lo que va contra un muro (los cuadros y el hogar) se gira solo hacia el que tenga detrás (con R, si hay dos,
      // al otro)
      let rot = this.rot % (def.place === 'rug' ? RUG_SIZES.length : held.id === 'mesa_grande' ? TABLE_SIZES.length : 4);
      if (def.place === 'wall' || held.id === 'chimenea') rot = [0, 1, 2, 3].map(i => (rot + i) % 4).find(r => g.scene.canPlace?.(tx, ty, held.id, p, r)) ?? this.rot;
      return { tile: [tx, ty], ok: !far && !!g.scene.canPlace?.(tx, ty, held.id, p, rot), far, place: held.id, rot };
    }
    for (const s of g.systems) { const t = s.target?.(p, held, def); if (t) return t; }
    if (!g.scene.harvestablesNear) return null;
    if (tool === 'azada' && g.scene === g.world) {
      const tx = Math.floor(p.x + p.face.x * 0.9), ty = Math.floor(p.y + p.face.y * 0.9);
      return { tile: [tx, ty], ok: g.world.canTill(tx, ty) };
    }
    let best = null, score = Infinity;
    for (const o of g.scene.harvestablesNear(p.x, p.y)) {
      const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
      if (d > REACH) continue;
      const dot = d > 0.01 ? (dx * p.face.x + dy * p.face.y) / d : 1;
      if (dot < 0.25 && d > 0.9) continue;
      const s = d - dot * 0.6;
      if (s < score) { score = s; best = o; }
    }
    return best && { obj: best };
  }

  // Texto de ayuda según lo que se tiene en la mano y lo que hay delante
  hint() {
    const g = this.game, held = g.inv.held, def = held && ITEMS[held.id], t = this.target;
    if (!g.player || g.mode !== 'play' || g.busy) return '';
    if (def?.food) return `Comer ${def.name.toLowerCase()}`;
    if (def?.heal) return `Beber ${def.name.toLowerCase()}`;
    if (t?.free) {
      const [w, h] = def.place === 'rug' ? RUG_SIZES[t.rot] : held.id === 'mesa_grande' ? TABLE_SIZES[t.rot] : [], size = w ? ` de ${w}×${h}` : '', keys = `R: girar${w ? ' · V: tamaño' : ''}`;
      return t.ok ? `Colocar ${def.name.toLowerCase()}${size} (${keys})` : t.far ? 'Demasiado lejos' : `${t.why || 'Ahí no cabe'} (${keys})`;
    }
    if (def?.place) return t?.ok ? `Colocar ${def.name.toLowerCase()} (R: girar)` : t?.far ? 'Demasiado lejos' : '';
    if (t?.label !== undefined) return t.label;
    if (def?.tool === 'azada') return t?.ok ? 'Labrar' : '';
    if (!t?.obj) return '';
    const rule = HARVEST[t.obj.kind];
    if (def?.tool === rule.tool) return def.tier >= (rule.minTier || 1) ? rule.verb : `Necesitas ${ITEMS[toolId(rule.tool, rule.minTier)].name.toLowerCase()} o mejor`;
    if (!def?.tool && rule.hand) return rule.verb;
    return `Necesitas ${rule.tool === 'guadana' ? 'la guadaña' : rule.tool === 'hacha' ? 'el hacha' : 'el pico'}`;
  }

  // Girar lo que se coloca libre: un toque de R, 15°; dejándola pulsada, gira poco a poco (con Shift, al revés).
  // Al soltar, si queda casi recto (a menos de 5°), se endereza
  turnStart(dir) { if (!this.turn) this.turn = { dir, at: performance.now(), from: this.angle }; }
  turning() { const t = this.turn, held = (performance.now() - t.at) / 1000 - TURN_WAIT; if (held > 0) this.angle = t.from + t.dir * TURN_SPEED * held; }
  turnEnd() {
    const t = this.turn;
    if (!t) return;
    this.turning();
    this.turn = null;
    const Q = Math.PI / 2;
    if (performance.now() - t.at < TURN_WAIT * 1000) this.angle = t.from + t.dir * Math.PI / 12;
    else { const n = Math.round(this.angle / Q) * Q; if (Math.abs(this.angle - n) < 5 * Math.PI / 180) this.angle = n; }
    this.angle = ((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }
  nextSize() { this.size++; }
  update(dt) {
    const g = this.game, p = g.player;
    if (this.turn) this.turning();
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swing = Math.max(0, this.swing - dt);
    this.target = this.pickTarget();

    // Objetos en el suelo: caen, rebotan y luego van hacia el jugador
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      if (d.z > 0 || d.vz > 0) { d.vz -= 160 * dt; d.z = Math.max(0, d.z + d.vz * dt); if (d.z === 0) d.vz = d.vz < -25 ? -d.vz * 0.35 : 0; }
      if (!p || d.scene !== g.scene) continue;
      const dx = p.x - d.x, dy = p.y - d.y, dist = Math.hypot(dx, dy);
      if (d.t > 0.45 && dist < 1.8 && (d.id !== 'pelota' || d.back) && g.live.mayTake(d)) {   // (la pelota lanzada es para el perro)
        if (dist < 0.35) {
          if (g.inv.add(d.id, 1, d.extra) === 0) { this.drops.splice(i, 1); this.collected(d.id); g.live.taken(d); }
          continue;
        }
        const sp = Math.min(dist, 7 * dt);
        d.x += (dx / dist) * sp; d.y += (dy / dist) * sp;
      }
    }
    // Los objetos recogidos seguidos se juntan en un solo texto ("+4 Madera")
    for (const [id, e] of this.pending) {
      e.t += dt;
      if (e.t > 0.25) { this.float(`+${e.n} ${ITEMS[id].name}`, '#fff3c0'); this.pending.delete(id); }
    }
    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter(f => f.t < 1.4);
    for (const q of this.parts) { q.t += dt; q.vz -= 9.8 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z = Math.max(0.02, q.z + q.vz * dt); }
    this.parts = this.parts.filter(q => q.t < q.life);
  }

  collected(id) {
    Audio.pickup();
    this.game.collection?.found(id);
    const e = this.pending.get(id) || { n: 0, t: 0 };
    e.n++; e.t = 0;
    this.pending.set(id, e);
  }

  // Texto que sube sobre la cabeza del jugador (en el mundo: x, y de la rejilla y el número de fila)
  float(text, color = '#ffffff') {
    const p = this.game.player;
    if (!p) return;
    if (this.floaters.length >= 4) this.floaters.shift();   // como mucho cuatro a la vez
    this.floaters.push({ text, color, x: p.x, y: p.y, row: this.floaters.length, t: 0 });
  }

  // Astillas que saltan de lo que se golpea (en el mundo: x, y de la rejilla y z de altura, en casillas)
  chips(x, y, kind, n = 8) {
    const cols = CHIPS[kind] || CHIPS.wood;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 0.6 + Math.random() * 1.6;
      this.parts.push({ x: x + (Math.random() - 0.5) * 0.3, y: y + (Math.random() - 0.5) * 0.3, z: 0.4 + Math.random() * 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 1.5 + Math.random() * 2.5, t: 0, life: 0.5 + Math.random() * 0.3, col: cols[i % cols.length] });
    }
  }

  spend(kind) {
    const g = this.game;
    if (g.buffs?.incansable > g.time) return true;   // la sopa de verduras quita el cansancio un rato
    const cost = Math.max(0, TOOL_COST[kind] - (g.skills?.costCut(kind) || 0));
    if (g.energy < cost) {
      this.float('Sin energía: come algo o duerme', '#ffb0a0');
      Audio.error();
      return false;
    }
    g.setEnergy(g.energy - cost);
    return true;
  }

  // Usar lo que se tiene en la mano (herramienta, comida o la mano vacía).
  // auto: el botón se mantiene pulsado; sigue golpeando, pero no come sin querer ni golpea al aire.
  use(auto = false) {
    const g = this.game, p = g.player;
    if (!p || g.busy || hud.dialogOpen || g.mode !== 'play' || this.cooldown > 0 || p.pose) return;
    const held = g.inv.held, def = held && ITEMS[held.id];
    if (def?.food || def?.heal) return auto ? undefined : this.eat(g.inv.selected);
    if (def?.place) return this.place(held.id, auto);
    if (this.target?.use) {   // lo que propone otro sistema (sembrar, pescar…)
      if (auto && !this.target.auto) return;
      if (def?.tool && !this.target.still) { this.swing = 0.25; this.swingItem = held.id; }   // también se ve el gesto (regar, lanzar la caña…)
      return this.target.use();
    }
    if (auto && !(this.target?.obj || this.target?.ok)) return;
    if (!g.scene.harvestablesNear) return;
    const tool = def?.tool || null, tier = def?.tier || 1, t = this.target;
    this.cooldown = COOLDOWN * (1 - 0.07 * (tier - 1));   // las herramientas buenas van más deprisa
    this.swing = 0.25;
    this.swingItem = tool ? held.id : null;

    if (tool === 'azada') {
      if (!t?.ok || !this.spend('azada')) { if (!t?.ok) Audio.swish(); return; }
      g.world.till(...t.tile);
      this.chips(t.tile[0] + 0.5, t.tile[1] + 0.5, 'dirt', 10);
      Audio.till();
      return;
    }
    if (!t?.obj) { Audio.swish(); return; }
    const o = t.obj, rule = HARVEST[o.kind];
    const hits = tool === rule.tool ? (tier >= (rule.minTier || 1) ? hitsFor(rule, tier) : 0) : !tool && rule.hand ? rule.hand : 0;
    if (!hits) { this.float(this.hint(), '#ffb0a0'); Audio.error(); return; }
    if (!this.spend(tool || 'mano')) return;
    o.hits = (o.hits || 0) + 1;
    const skill = { hacha: 'tala', pico: 'mineria', guadana: 'agricultura' }[rule.tool];
    if (skill) g.skills?.gain(skill, 0.5);
    o.shakeUntil = g.time + 0.18;
    this.chips(o.x, o.y, rule.chips);
    if (rule.chips === 'stone') Audio.clink(); else if (rule.chips === 'leaf' || rule.chips === 'twig') Audio.swish(); else Audio.chop();
    if (o.hits >= hits) {
      o.hits = 0;
      g.scene.remove(o);
      this.chips(o.x, o.y, rule.chips, 16);
      this.spawnDrops(o, rule, tool === rule.tool ? tier : 0, skill && Math.random() < (g.skills?.bonus(skill) || 0));
      if (o.kind === 'bush' && tool === 'guadana') g.ranch?.mowed();   // (con un silo, el heno se guarda solo)
      if (skill) { g.skills?.gain(skill, 3); g.stats?.add(skill === 'tala' ? 'talados' : skill === 'mineria' ? 'picados' : 'segados', 1); }
      Audio.fell();
    }
  }

  // Lo que suelta al romperse; algunos minerales solo salen con una herramienta de cierto nivel
  spawnDrops(o, rule, tier = 1, extra = false) {
    for (let [id, min, max, chance = 1, minTier = 0] of rule.drops) {
      if (extra) { max++; extra = false; }   // la habilidad a veces da uno más
      if (tier < minTier || Math.random() > chance) continue;
      if (id === 'semillas') {   // semillas de algo que crezca en esta estación
        const season = this.game.days.season, ok = Object.keys(CROPS).filter(c => CROPS[c].seasons.includes(season));
        if (!ok.length) continue;
        id = 'semilla_' + ok[Math.floor(Math.random() * ok.length)];
      }
      const n = min + Math.floor(Math.random() * (max - min + 1));
      for (let i = 0; i < n; i++) {
        this.addDrop({ id, x: o.x + (Math.random() - 0.5) * 0.9, y: o.y + (Math.random() - 0.5) * 0.9, z: 4, vz: 50 + Math.random() * 40, t: 0, scene: this.game.scene });
      }
    }
  }

  // Poner en el mundo la estación o el mueble que se lleva en la mano
  place(id, auto) {
    const g = this.game, t = this.pickTarget();
    if (auto) return;
    this.cooldown = COOLDOWN;
    if (!t?.ok) { this.float(t?.far ? `Demasiado lejos (como mucho a ${PLACE_REACH} casillas)` : t?.why || 'Ahí no cabe', '#ffb0a0'); Audio.error(); return; }
    if (t.free) g.scene.placeFree(id, t.fit); else g.scene.place(...t.tile, id, t.rot);
    g.inv.take(g.inv.selected, 1);
    this.chips(t.free ? t.fit.cx : t.tile[0] + 0.5, t.free ? t.fit.cy : t.tile[1] + 0.5, 'dirt', 8);
    Audio.place();
    if (ITEMS[id].place === 'station') g.stats?.add('estaciones', 1);
    if (ITEMS[id].place === 'station') this.float(`${ITEMS[id].name}: acércate y pulsa E`, '#fff3c0');
  }

  eat(slot) {
    const g = this.game, it = g.inv.slots[slot], def = it && ITEMS[it.id];
    if (!def?.food && !def?.heal) return;
    const hurt = g.combat && g.combat.hp < 20;
    if (g.energy >= ENERGY_MAX && !hurt && !def.buff) { this.float('No tienes hambre', '#d8e8ff'); return; }
    g.inv.take(slot, 1);
    const cooked = RECIPES.some(r => r.out === it.id && r.station === 'cocina'), food = Math.round((def.food || 0) * (cooked ? 1 + (g.skills?.level('cocina') || 0) * 0.05 : 1));
    if (food) { g.setEnergy(g.energy + food); this.float(`+${food} energía`, '#a8f0a0'); }
    if (g.combat) { const hp = def.heal || Math.ceil(def.food / 12); if (hurt) { g.combat.heal(hp); this.float(`+${hp / 2} ♥`, '#ff9aaa'); } }
    if (def.buff) {
      const [kind, secs] = def.buff;
      g.buffs[kind] = g.time + secs;
      this.float(kind === 'rapido' ? `¡Más rápido durante ${secs / 60} min!` : `¡Sin cansancio durante ${secs / 60} min!`, '#ffe08a');
    }
    Audio.eat();
    this.cooldown = COOLDOWN;
  }

  // Tirar objetos de la mochila al suelo, delante del jugador
  throwOut(id, n, extra) {
    const p = this.game.player;
    if (!p) return false;
    for (let i = 0; i < n; i++) this.addDrop({ id, extra, x: p.x + p.face.x * 1.2 + (Math.random() - 0.5) * 0.4, y: p.y + p.face.y * 1.2 + (Math.random() - 0.5) * 0.4, z: 6, vz: 40, t: -1.5, scene: this.game.scene });
    return true;
  }
  // Un objeto más en el suelo (jugando juntos, lo ven todos)
  addDrop(d) { this.drops.push(d); this.game.live.dropped(d); }




}

