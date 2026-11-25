// Recolectar: elegir lo que hay delante del jugador, golpearlo con la herramienta,
// soltar lo que da y recogerlo. También los efectos: astillas, textos flotantes y el golpe de la herramienta.
import { CAM } from './camera.js';
import { ITEMS, HARVEST, GRASS_DROPS, TOOL_COST, CROPS, hitsFor, hungerOf, thirstOf, pctOf, itemNoun } from './items.js';
import { seedOf } from './cropdata.js';
import { itemIconUrl } from './art/items.js';
import { HUNGER_MAX, HP_MAX } from './combat.js';
import { THIRST_MAX } from './needs.js';
import { PIECES, layerOf } from './pieces.js';
import { watchtower } from './world/tower.js';
import { RECIPES } from './recipes.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { RUG_SIZES, TABLE_SIZES } from './art/stations.js';
import { XP_ORE, roll } from './xp.js';
import { dxOf, WATER_Y } from './world/planet.js';
import { reportFault } from './faults.js';
import { t as tr } from './i18n.js';   // (as tr: t is the target in many places here)
import { BULKY_PARTS } from './carry-items.js';   // (the big things carried in the arms: never a drop, their parts)

// Lo que dice cada efecto al tomarlo (comida o poción)
const BUFF_KINDS = new Set(['rapido', 'incansable', 'fuerza', 'resistencia', 'regeneracion']);   // (their names: buff.name.<kind> in src/lang)

// Lo que se coloca libre (donde se apunte, con cualquier giro): muebles, estaciones, lo que va plano y las
// alfombras. Los cuadros y el hogar, contra un muro, siguen yendo por casillas
export const freePlace = id => !!id && !PIECES[id] && ['furniture', 'station', 'flat', 'rug'].includes(ITEMS[id]?.place);   // (las piezas, como el hogar y la valla, van por casillas)
// Los tamaños que se eligen con V (índices de TABLE_SIZES: girarla ya lo hace R). Las alfombras ya vienen de su
// tamaño del telar: rugK, su índice en RUG_SIZES
const sizesOf = id => (id === 'mesa_grande' ? [0, 2, 3, 5] : null);
const rugK = id => Math.max(0, RUG_SIZES.findIndex(([w, h]) => w === ITEMS[id].size?.[0] && h === ITEMS[id].size?.[1]));

const REACH = 1.7;          // alcance en casillas
const COOLDOWN = 0.32;      // segundos entre golpes
// Which system offered each target of pickTarget (a WeakMap: the targets are theirs, not to be written on)
const OFFERED = new WeakMap();
const TIRED_SLOW = 1.5;     // with no stamina left (needs.exhausted) tools still work, this much more slowly
const SIP = 5;              // what a sip from a canteen or a jug quenches (half-units of THIRST_MAX: 25 %)
// The floats of what eating or drinking gave, in the colour of its bar (ui/needsbar.js: --nd-food, --nd-water, --nd-hp)
const FLOAT_HUNGER = '#d98c45', FLOAT_THIRST = '#4a9fd8', FLOAT_HEALTH = '#66b562';
const CHIPS = {
  wood: ['#8a5a30', '#b07a44', '#e0b878'], stone: ['#7e7a72', '#a8a49a', '#5e5a55'], leaf: ['#4a9638', '#7cbf55', '#3a7c2e'],
  cactus: ['#4f9a52', '#7cc07a', '#f4f0d0'], twig: ['#8a6a44', '#a8865a', '#c8a878'], dirt: ['#6a4428', '#8a5a34', '#4a2e1a'],
  water: ['#9ad0ff', '#7ab8e0', '#d8f0ff'], heart: ['#ff7aa8', '#ff9ac8', '#ffffff'], feather: ['#ffffff', '#e8e4dc', '#c8c8d0'],
};

const TURN_WAIT = 0.22, TURN_SPEED = 1.7;   // R: lo que dura un toque (s) y lo que gira mantenida (rad/s)
const TURN_STEP = Math.PI / 12;             // los toques de R van de 15° en 15° (encajados: 90° son 6 toques)
const PLACE_REACH = 4;   // casillas de distancia a las que se puede colocar algo con el ratón
const DIG_REACH = 3.2;   // metros (de los pies al centro de la casilla) hasta donde llega la pala

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
    if (!p || g.mode !== 'play' || g.gamemode === 'spectator' || p.swim) return null;   // (el espectador no toca nada; nadando, tampoco)
    // (en el modo construir, lo que se "lleva" es el mueble o la estación elegidos en la barra, o lo que se mueve)
    const virt = g.build.on ? g.build.heldItem() : null;
    if (g.build.on && !virt) return null;
    const held = virt || g.inv.held, def = held && ITEMS[held.id], tool = def?.tool;
    // Lo que se coloca libre va al punto del ratón (si se ha movido hace poco), o un paso por delante, girado como
    // diga R; se arrima a la pared que roce y no se pone si corta algo
    if (freePlace(held?.id) && g.scene.fitFree) {
      const mp = g.mousePoint();
      if (mp) { this.cursorPt = mp; this.cursorAt = performance.now(); }
      const pt = this.cursorPt && performance.now() - this.cursorAt < 4000 ? this.cursorPt : [p.x + p.face.x * 1.3, p.y + p.face.y * 1.3];
      const S = sizesOf(held.id), k = def.place === 'rug' ? rugK(held.id) : S ? S[this.size % S.length] : 0, f = g.scene.fitFree(held.id, pt[0], pt[1], this.angle, k, p);
      const far = Math.hypot(f.cx - p.x, f.cy - p.y) > (f.reach || PLACE_REACH + 0.5);   // (reach: a watchtower, as wide as it is)
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
      const fence = ['fence', 'gate'].includes(PIECES[held.id]?.kind);   // (la valla y su puerta no se giran: se unen a sus vecinas; y van fuera, como en el modo construir)
      if (fence) rot = 0;
      return { tile: [tx, ty], ok: !far && (!fence || g.scene === g.world) && !!g.scene.canPlace?.(tx, ty, held.id, p, rot), far, place: held.id, rot };
    }
    for (const s of g.systems) { if (typeof s.target !== 'function') continue; let t; try { t = s.target(p, held, def); } catch (e) { reportFault(e, `${s.constructor.name}.target`); } if (t) { if (typeof t === 'object') OFFERED.set(t, s); return t; } }   // (aislado: ver game.js, hook. OFFERED: who offers it)
    if (!g.scene.harvestablesNear) return null;
    if (tool === 'azada' && g.scene === g.world) {
      const [tx, ty] = g.aimTile();
      return { tile: [tx, ty], ok: g.world.canTill(tx, ty) };
    }
    if (tool === 'pala' && g.scene === g.world) return this.shovelTarget(def);
    // La guadaña siega también la hierba de la casilla apuntada, si ahí no hay una mata, una flor u otra planta
    if (tool === 'guadana' && g.scene === g.world && g.world.grassAt) {
      const [tx, ty] = g.aimTile();
      const onTile = g.scene.harvestablesNear(p.x, p.y).some(o => Math.floor(o.x) === tx && Math.floor(o.y) === ty);
      if (!onTile && Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) < 2.6 && g.world.grassAt(tx, ty, g.days.dayIndex)) return { tile: [tx, ty], grass: true, ok: true, label: 'Segar la hierba' };
    }
    // (en primera persona, lo que está en la cruceta: un tronco alto, una mata baja)
    const ray = CAM.first && g.mouse?.in ? g.view3d.rayAt(g.mouse.x, g.mouse.y) : null;
    if (ray) {
      let hit = null, near = Infinity;
      for (const o of g.scene.harvestablesNear(p.x, p.y)) {
        if (o.flower && tool && tool !== 'guadana') continue;   // (con el hacha o el pico, las flores no tapan lo de detrás)
        const ox = o.x - ray.o[0], oy = o.y - ray.o[2], l = Math.hypot(ray.d[0], ray.d[2]) || 1e-6, t = Math.max(0, (ox * ray.d[0] + oy * ray.d[2]) / (l * l)), gap = Math.hypot(ox - ray.d[0] * t, oy - ray.d[2] * t);
        const y = ray.o[1] + ray.d[1] * t - g.view3d.groundY(g.scene, o.x, o.y), top = HARVEST[o.kind]?.tool === 'hacha' ? 4 : 1.4;
        if (Math.hypot(o.x - p.x, o.y - p.y) <= REACH && gap < 0.6 && y > -0.2 && y < top && t < near) { near = t; hit = o; }
      }
      return hit && { obj: hit };
    }
    let best = null, score = Infinity;
    for (const o of g.scene.harvestablesNear(p.x, p.y)) {
      if (o.flower && tool && tool !== 'guadana') continue;
      const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
      if (d > REACH) continue;
      const dot = d > 0.01 ? (dx * p.face.x + dy * p.face.y) / d : 1;
      if (dot < 0.25 && d > 0.9) continue;
      const s = d - dot * 0.6;
      if (s < score) { score = s; best = o; }
    }
    return best && { obj: best };
  }

  // La pala: la casilla del cursor (en primera persona, la de la cruceta), si llega; si no, la de delante. Vacía, cava; con
  // tierra, la suelta. Lo que dice digWhy se recuerda mientras no cambie la casilla ni el mundo (se mira en cada fotograma)
  // Apuntando a una pared (la de un hoyo o la de un montón), como en Minecraft: se cava el bloque de la pared y la tierra se
  // suelta delante de ella, en la casilla más baja (así un hoyo hondo se rellena apuntando a su pared)
  shovelTarget(def) {
    const g = this.game, p = g.player, w = g.world, up = !!def.empty, mp = g.mousePoint();
    let mt = mp && [Math.floor(mp[0]), Math.floor(mp[1])];
    if (mt && up) {
      const fx = mp[0] - mt[0], fy = mp[1] - mt[1], hy = g.view3d.groundY(w, mp[0], mp[1]);
      for (const [edge, dx, dy] of [[fx < 0.03, -1, 0], [fx > 0.97, 1, 0], [fy < 0.03, 0, -1], [fy > 0.97, 0, 1]]) {
        if (!edge) continue;
        if (g.view3d.groundY(w, mt[0] + dx + 0.5, mt[1] + dy + 0.5) < hy - 0.1) mt = [mt[0] + dx, mt[1] + dy];
        break;
      }
    }
    // (con el cursor lejos, esa casilla, en rojo: como al colocar. Sin cursor, la de delante)
    const [tx, ty] = mt || g.aimTile();
    const far = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) > DIG_REACH, key = `${tx},${ty},${up},${w.touches},${far}`;
    if (this.digMemo?.key !== key) this.digMemo = { key, why: far ? 'Demasiado lejos' : w.digWhy(tx, ty, up) };
    // (un animal o una criatura en la casilla: se quedaría dentro de la tierra o en el hoyo, chocando con sus paredes. Va
    // aparte de lo recordado porque se mueven)
    const why = this.digMemo.why || (this.someoneOn(tx, ty) ? 'Hay alguien encima' : '');
    return { tile: [tx, ty], ok: !why, why, mark: true, shovel: up ? 'soltar' : 'cavar', label: why || (up ? 'Soltar la tierra' : 'Cavar') };
  }

  // ¿Hay un animal (del rancho o salvaje), una criatura o alguien del pueblo (un vecino, Nilo, tus hijos) en la casilla (o
  // rozándola)?
  someoneOn(tx, ty) {
    const g = this.game, on = a => a && !a.inside && !a.dead && !a.hidden && Math.abs(dxOf(a.x, tx + 0.5)) < 0.75 && Math.abs(a.y - ty - 0.5) < 0.75;
    return g.ranch.animals.some(on) || g.wildlife.list.some(on) || g.mobs.list.some(on) || g.neighbors.people.some(on) || on(g.world.nilo) || [...(g.family.ents?.values() || [])].some(on);
  }

  // Texto de ayuda según lo que se tiene en la mano y lo que hay delante
  hint() {
    const g = this.game, held = g.inv.held, def = held && ITEMS[held.id], t = this.target;
    if (!g.player || g.mode !== 'play' || g.busy) return '';
    if (g.player.swim) return '';   // (nadando no se usa nada: ver use)
    if (def?.food) return tr(def.drink ? 'act.drink' : 'act.eat', { item: itemNoun(held.id) });
    if (def?.heal) return tr('act.drink', { item: itemNoun(held.id) });
    // (a canteen or a jug: the fresh water aimed at fills it (needs.target); anything else, a sip, or that it is empty)
    if (def?.canteen) return this.fills(t) && t.label !== undefined ? t.label : tr(held.sips > 0 ? 'needs.canteen.sip' : 'needs.canteen.empty', { item: itemNoun(held.id) });
    if (t?.free) {
      const [w, h] = held.id === 'mesa_grande' ? TABLE_SIZES[t.rot] : [], size = w ? ` de ${w}×${h}` : '', keys = `R: girar${w ? ' · V: tamaño' : ''}`;
      const loose = g.player.crouch && held.id === 'encimera' ? ', suelta (agachado no se une)' : '';
      return t.ok ? `Colocar ${def.name.toLowerCase()}${size}${loose} (${keys})` : t.far ? 'Demasiado lejos' : `${t.why || 'Ahí no cabe'} (${keys})`;
    }
    if (def?.place) return t?.ok ? `Colocar ${def.name.toLowerCase()}${['fence', 'gate'].includes(PIECES[held.id]?.kind) ? '' : ' (R: girar)'}` : t?.far ? 'Demasiado lejos' : '';
    if (t?.label !== undefined) return t.label;
    if (def?.tool === 'azada') return t?.ok ? 'Labrar' : '';
    if (!t?.obj) return '';
    const rule = HARVEST[t.obj.kind];
    if (def?.tool === rule.tool) return rule.verb;
    if (!def?.tool && rule.hand) return rule.verb;
    return `Necesitas ${rule.tool === 'guadana' ? 'la guadaña' : rule.tool === 'hacha' ? 'el hacha' : 'el pico'}`;
  }

  // Girar lo que se coloca libre: dejando R pulsada, gira sin parar (con Shift, al revés); cada toque lo lleva
  // al siguiente múltiplo de 15°, así que tras un giro libre unos toques lo vuelven a cuadrar con las casillas
  // (y con la pared). Al soltar tras mantenerla, si queda casi recto (a menos de 5°), se endereza
  turnStart(dir) { if (!this.turn) this.turn = { dir, at: performance.now(), from: this.angle }; }
  turning() { const t = this.turn, held = (performance.now() - t.at) / 1000 - TURN_WAIT; if (held > 0) this.angle = t.from + t.dir * TURN_SPEED * held; }
  turnEnd() {
    const t = this.turn;
    if (!t) return;
    this.turning();
    this.turn = null;
    const Q = Math.PI / 2;
    if (performance.now() - t.at < TURN_WAIT * 1000) {
      const s = t.from / TURN_STEP;   // (el margen, para no quedarse donde ya está por un error de redondeo)
      this.angle = (t.dir > 0 ? Math.floor(s + 1e-6) + 1 : Math.ceil(s - 1e-6) - 1) * TURN_STEP;
    } else { const n = Math.round(this.angle / Q) * Q; if (Math.abs(this.angle - n) < 5 * Math.PI / 180) this.angle = n; }
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
      if (d.ttl && d.t > d.ttl) { this.drops.splice(i, 1); continue; }   // (lo que se suelta al morir dura un rato)
      if (!p || d.scene !== g.scene || g.gamemode === 'spectator') continue;   // (el espectador no recoge)
      const dx = p.x - d.x, dy = p.y - d.y, dist = Math.hypot(dx, dy);
      if (d.t > 0.45 && dist < 1.8 && (d.id !== 'pelota' || d.back) && ITEMS[d.id] && g.live.mayTake(d)) {   // (la pelota lanzada es para el perro; lo de una versión más nueva, sin ITEMS, se queda en el suelo)
        if (dist < 0.35) {
          const n = d.count || 1, left = g.inv.add(d.id, n, d.extra);
          for (let k = left; k < n; k++) this.collected(d.id);
          if (left === 0) { this.drops.splice(i, 1); g.live.taken(d); } else d.count = left;
          continue;
        }
        const sp = Math.min(dist, 7 * dt);
        d.x += (dx / dist) * sp; d.y += (dy / dist) * sp;
      }
    }
    // Los objetos recogidos seguidos se juntan en un solo texto ("+4 Madera")
    for (const [id, e] of this.pending) {
      e.t += dt;
      if (e.t > 0.25) {
        this.pending.delete(id);
        // (the minimal interface says it in the feed, above the minimap; the full one, over the player, as always)
        if (!this.game.smartHud || !hud.feed.push({ kind: 'item', key: 'item:' + id, text: ITEMS[id].name, n: e.n, icon: itemIconUrl(id) })) this.float(`+${e.n} ${ITEMS[id].name}`, '#fff3c0');
      }
    }
    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter(f => f.t < 1.4);
    for (const q of this.parts) { q.t += dt; q.vz -= 9.8 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z = Math.max(q.floor ?? 0.02, q.z + q.vz * dt); }
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

  // Gotas que salpican del agua (al nadar, al caer en ella): salen de la superficie, poco y cerca, y se hunden al caer
  splash(x, y, n = 6, k = 1) {
    if (this.parts.length > 200) return;
    const cols = CHIPS.water;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random() * 0.9) * k;
      this.parts.push({ x: x + (Math.random() - 0.5) * 0.4, y: y + (Math.random() - 0.5) * 0.4, z: WATER_Y + 0.02, floor: WATER_Y - 0.1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: (1.2 + Math.random() * 1.8) * k, t: 0, life: 0.35 + Math.random() * 0.25, col: cols[i % cols.length], s: 0.5 });
    }
  }

  // Usar una herramienta cansa (da hambre, como en Minecraft; con la tala o la minería al 5, la mitad) y la gasta un
  // uso. Siempre se puede trabajar: con el hambre a cero lo que baja es la vida (según la dificultad)
  // Also stamina (needs.work: TOOL_COST × toolK, halved by the skill; the buff turns it off there): the hunger cost stays
  // exactly as it was. And dirt on the body (body.work: a little per use, Plan E §2.3), whatever the buff
  spend(kind, slot = this.game.inv.selected) {   // (slot: the hammer of build mode is not in the hand: plans.js)
    const g = this.game;
    if (!(g.buffs?.incansable > g.time)) g.combat?.exert(TOOL_COST[kind] * (g.skills?.costCut(kind) ? 0.5 : 1));   // (la sopa de verduras quita el cansancio un rato)
    g.needs?.work(kind);
    g.wildlife?.toolHit();   // (heard by the wild animals: presence.js)
    g.body?.work(kind);   // (and it dirties you and wears the clothes on a little: Plan E §2.3, §3.2, on the time worked)
    this.wearOut(slot);
    return true;
  }
  // Lo que se lleva en la mano (herramienta o arma) se gasta un uso; si se acaba, se rompe (en creativo, no)
  wearOut(slot = this.game.inv.selected) {
    const g = this.game, s = g.inv.slots[slot], def = s && ITEMS[s.id];
    if (!def?.dur || g.inv.infinite) return;
    s.dur = (s.dur ?? def.dur) - 1;
    if (s.dur <= 0) { g.inv.slots[slot] = null; this.float(`¡Se ha roto: ${def.name.toLowerCase()}!`, '#ffb0a0'); Audio.error(); }
    g.inv.changed();
  }

  // Usar lo que se tiene en la mano (herramienta, comida o la mano vacía).
  // auto: el botón se mantiene pulsado; sigue golpeando, pero no come sin querer ni golpea al aire.
  use(auto = false) {
    const g = this.game, p = g.player;
    if (!p || g.busy || hud.dialogOpen || g.talk?.takesClick || g.mode !== 'play' || this.cooldown > 0 || (p.pose && !g.fishing.canUse(p)) || p.swim || g.gamemode === 'spectator') return;   // (nadando, las manos son para nadar)
    if (g.carry?.handsBusy()) return g.carry.handsFull(auto);   // (something in the arms, or the hands on the wheelbarrow: no punches, nothing picked by hand; carry.js. Riding or rowing with it, the tool works)
    const held = g.inv.held, def = held && ITEMS[held.id];
    if (def?.food || def?.heal || def?.buff) return auto ? undefined : this.eat(g.inv.selected);
    if (held?.id === 'mapa_vacio') return auto ? undefined : g.maps.create(g.inv.selected);
    if (def?.place) return this.place(held.id, auto);
    if (def?.bow) { if (!auto) g.archery.press(); return; }   // (mantener tensa; al soltar, sale)
    // (a canteen or a jug: a sip, unless the fresh water aimed at fills it (needs.target). Like food, what other systems
    // offer (a crop to harvest…) waits until it is put away. Never with the button held, like eating)
    if (def?.canteen && !this.fills(this.target)) return auto ? undefined : this.sip(g.inv.selected);
    if (this.target?.use) {   // lo que propone otro sistema (sembrar, pescar…)
      if (auto && !this.target.auto) return;
      if (def?.tool && !this.target.still) { this.swing = 0.25; this.swingItem = held.id; }   // (también se ve el gesto: regar, lanzar la caña…; still: with the line out, fishing.js does its own)
      const r = this.target.use();
      if (def?.tool && this.tired()) this.cooldown *= TIRED_SLOW;
      return r;
    }
    if (auto && !(this.target?.obj || this.target?.ok)) return;
    if (auto && def?.tool === 'pala') return;   // (la pala, clic a clic: mantenido, cavaría y soltaría sin parar)
    if (!g.scene.harvestablesNear) return;
    const tool = def?.tool || null, tier = def?.tier || 1, t = this.target;
    this.cooldown = COOLDOWN * (1 - 0.07 * (tier - 1)) * (this.tired() ? TIRED_SLOW : 1);   // (las de hierro van más deprisa que la mano; with no stamina, slower)
    this.swing = 0.25;
    this.swingItem = tool ? held.id : null;

    if (tool === 'pala') return this.shovel(t, held);
    if (tool === 'azada') {
      if (!t?.ok || !this.spend('azada')) { if (!t?.ok) Audio.swish(); return; }
      g.world.till(...t.tile);
      g.stats?.add('labrados', 1);
      this.chips(t.tile[0] + 0.5, t.tile[1] + 0.5, 'dirt', 10);
      Audio.till();
      return;
    }
    if (t?.grass && tool === 'guadana') {   // (la hierba de una casilla: da fibra y vuelve a salir)
      if (!this.spend('guadana')) return;
      const [tx, ty] = t.tile;
      g.world.mow(tx, ty, g.days.dayIndex);
      this.chips(tx + 0.5, ty + 0.5, 'leaf', 10);
      this.spawnDrops({ x: tx + 0.5, y: ty + 0.5 }, { drops: GRASS_DROPS });
      g.skills?.gain('agricultura', 0.5);
      g.ranch?.mowed();   // (con un silo, el heno se guarda solo)
      Audio.swish();
      return;
    }
    if (!t?.obj) { Audio.swish(); return; }
    const o = t.obj, rule = HARVEST[o.kind];
    const hits = tool === rule.tool ? hitsFor(rule) : !tool && rule.hand ? rule.hand : 0;
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
      if (g.scene === g.world) g.nature?.harvested(o.kind);   // (felled or picked: Known in the nature book)
      this.chips(o.x, o.y, rule.chips, 16);
      const fruit = o.bare && rule.fruit ? { ...rule, drops: rule.drops.filter(([id]) => id !== rule.fruit) } : rule;   // (la palmera a la que se le acaban de coger los cocos ya no tiene)
      // (with the weight inventory, a tree leaves its log lying where it falls instead of the wood: carry.js)
      if (!g.carry?.felled(o, fruit)) this.spawnDrops(o, fruit, skill && Math.random() < (g.skills?.bonus(skill) || 0));
      const ore = rule.drops.find(([id]) => XP_ORE[id]);   // (el carbón y las piedras preciosas dan experiencia)
      if (ore) g.xp?.add(roll(...XP_ORE[ore[0]]));
      if (o.kind === 'bush' && tool === 'guadana') g.ranch?.mowed();   // (con un silo, el heno se guarda solo)
      if (skill) { g.skills?.gain(skill, 3); g.stats?.add(skill === 'tala' ? 'talados' : skill === 'mineria' ? 'picados' : 'segados', 1); }
      Audio.fell();
    }
  }

  // Cavar con la pala vacía (se llena) o soltar la tierra que lleva (se vacía): el suelo de la casilla baja o sube un bloque
  // (ver scenes.js, digTile). Si es la casilla que pisa uno, con ella: cae al hoyo o sube al montón, suave (z)
  shovel(t, held) {
    const g = this.game, p = g.player, slot = g.inv.selected, up = !!ITEMS[held.id].empty;
    if (!t?.shovel || !t.ok) { this.float(t?.why || 'Ahí no', '#ffb0a0'); Audio.error(); this.cooldown = COOLDOWN; return; }
    const [tx, ty] = t.tile, under = Math.floor(p.x) === tx && Math.floor(p.y) === ty && !p.boat, was = under ? g.world.surfaceAt(p.x, p.y) : 0;
    const wasWet = !!g.world.water(tx + 0.5, ty + 0.5);
    g.world.digTile(tx, ty, up ? 1 : -1, g.days.dayIndex);
    const wet = !!g.world.water(tx + 0.5, ty + 0.5);
    if (under) p.z = (p.z || 0) + was - g.world.surfaceAt(p.x, p.y);   // (los pies, donde estaban: cae o sube suave)
    // (la misma pala, con su desgaste, llena o vacía; y luego se gasta un uso)
    g.inv.slots[slot] = { ...held, id: up ? ITEMS[held.id].empty : ITEMS[held.id].full };
    g.inv.changed();
    this.spend('pala');
    // (en el agua de un canal, o al abrirlo y entrar el agua: salpica y suena a agua; la tierra que salta, solo si queda en
    // seco, que bajo el agua no se vería)
    if (wasWet || wet) { this.splash(tx + 0.5, ty + 0.5, 14, 1.3); g.view3d?.fx?.rippleAt?.(tx + 0.5, ty + 0.5, 1.4, 0.6); Audio.splash(); }
    if (!wet) this.chips(tx + 0.5, ty + 0.5, 'dirt', up ? 10 : 14);
    if (!wasWet && !wet) { if (up) Audio.dump(); else Audio.dig(); }
    g.stats?.add(up ? 'tierra_soltada' : 'cavados', 1);
  }

  // Lo que suelta al romperse
  spawnDrops(o, rule, extra = false) {
    for (let [id, min, max, chance = 1] of rule.drops) {
      if (extra) { max++; extra = false; }   // la habilidad a veces da uno más
      if (Math.random() > chance) continue;
      if (id === 'semillas') {   // semillas de algo que crezca en esta estación
        const season = this.game.days.season, ok = Object.keys(CROPS).filter(c => CROPS[c].seasons.includes(season));
        if (!ok.length) continue;
        id = seedOf(ok[Math.floor(Math.random() * ok.length)]);
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
    if (g.build.on && !g.build.canPay(id)) { this.float(tr('build.why.materials'), '#ffb0a0'); Audio.error(); return; }   // (what the chests nearby had may be gone: carry.js)
    if (t.moor) g.world.moorBoat(...t.moor);   // (la barca: amarrada en el agua)
    else if (t.free) g.scene.placeFree(id, t.fit, !!g.player.crouch); else g.scene.place(...t.tile, id, t.rot);
    if (!t.moor && g.scene === g.world) { const at = t.free ? t.fit.anchor : t.tile; g.rep?.placed(layerOf(id), at[0], at[1]); }   // (put back where you took it from: reputation.js)
    if (g.build.on) g.build.paid(id); else g.inv.take(g.inv.selected, 1);   // (construyendo, se pagan sus materiales)
    this.chips(t.free ? t.fit.cx : t.tile[0] + 0.5, t.free ? t.fit.cy : t.tile[1] + 0.5, 'dirt', 8);
    Audio.place();
    if (ITEMS[id].place === 'station') g.stats?.add('estaciones', 1);
    if (ITEMS[id].place === 'station') this.float(`${ITEMS[id].name}: acércate y pulsa E`, '#fff3c0');
    if (id === 'pozo') this.float('Pozo: con la regadera, E o clic en él la llena', '#9ad0ff');
    if (watchtower(id)) { g.build.justPut(id, t.fit.anchor); this.float(tr('toast.watchtower.placed'), '#fff3c0'); }
    if (id === 'big_well') this.float(tr('toast.big_well.placed'), '#9ad0ff');
    if (id === 'wheelbarrow') this.float(tr('toast.wheelbarrow.placed'), '#fff3c0');
  }

  // Eat or drink what is in a slot. Refused (with why) when it would do nothing: not hurt, not hungry, no effect, and
  // not thirsty or it does not quench. What it gave floats up in its bar's colour ("hunger +25 %", "thirst +30 %")
  eat(slot) {
    const g = this.game, it = g.inv.slots[slot], def = it && ITEMS[it.id];
    if (!def?.food && !def?.heal && !def?.buff) return;
    const quench = thirstOf(def), N = g.needs;
    const hurt = g.combat && g.combat.hp < HP_MAX, hungry = g.combat && g.combat.hunger < HUNGER_MAX, thirsty = !!N && quench > 0 && N.thirst < THIRST_MAX;
    if (!hurt && !hungry && !thirsty && !def.buff) { this.float(tr(def.drink ? 'needs.not_thirsty' : 'needs.not_hungry'), '#d8e8ff'); return; }
    g.inv.take(slot, 1);
    // (los platos de la cocina quitan más hambre con cada nivel de cocina)
    const cooked = RECIPES.some(r => r.out === it.id && r.station === 'cocina'), fed = def.food ? Math.max(1, Math.round(hungerOf(def) * (cooked ? 1 + (g.skills?.level('cocina') || 0) * 0.05 : 1))) : 0;
    if (fed && g.combat) { const was = g.combat.hunger; g.combat.feed(fed); const got = g.combat.hunger - was; if (got > 0) this.float(tr('item.restores.hunger', { n: pctOf(got) }), FLOAT_HUNGER); }
    if (quench && N) { const was = N.thirst; N.quench(quench); const got = N.thirst - was; if (got > 0) this.float(tr('item.restores.thirst', { n: pctOf(got) }), FLOAT_THIRST); }
    if (g.combat) { const hp = def.heal || (def.food ? Math.ceil(def.food / 12) : 0); if (hurt && hp) { const was = g.combat.hp; g.combat.heal(hp); const got = g.combat.hp - was; if (got > 0) this.float(tr('item.restores.health', { n: pctOf(got) }), FLOAT_HEALTH); } }
    if (def.buff) {
      const [kind, secs] = def.buff;
      g.buffs[kind] = g.time + secs;
      const name = BUFF_KINDS.has(kind) ? tr(`buff.name.${kind}`) : kind;
      this.float(secs >= 60 ? tr('buff.for_min', { name, n: secs / 60 }) : tr('buff.for_s', { name, n: secs }), '#ffe08a');
    }
    Audio.eat();
    this.cooldown = COOLDOWN;
  }

  // ---------- the canteen and the jug (items.js: canteen = the sips when full; the stack's s.sips, what is left) ----------
  // A sip from the one in that slot: SIP of thirst (needs.gulp plays its sound and its drops). Empty or not thirsty: why
  sip(slot = this.game.inv.selected) {
    const g = this.game, s = g.inv.slots[slot], def = s && ITEMS[s.id];
    if (!def?.canteen) return false;
    this.cooldown = COOLDOWN;
    if (!(s.sips > 0)) { this.float(tr('needs.canteen.empty', { item: itemNoun(s.id) }), '#ffb0a0'); Audio.error(); return false; }
    if (!g.needs || g.needs.thirst >= THIRST_MAX) { this.float(tr('needs.not_thirsty'), '#d8e8ff'); return false; }
    const was = g.needs.thirst;
    if (!g.inv.infinite) { s.sips--; if (!s.sips) delete s.sips; }   // (empty: no sips at all, as one just made)
    g.needs.gulp(SIP);
    const got = g.needs.thirst - was;
    if (got > 0) this.float(tr('item.restores.thirst', { n: pctOf(got) }), FLOAT_THIRST);
    g.inv.changed();
    return true;
  }
  // Fill the canteen or the jug in that slot to the top (at a river, a lake or a well: whoever offers it checks the water).
  // false if it is not one, or it is already full
  fillCanteen(slot = this.game.inv.selected) {
    const g = this.game, s = g.inv.slots[slot], def = s && ITEMS[s.id];
    if (!def?.canteen || (s.sips || 0) >= def.canteen) return false;
    s.sips = def.canteen;
    g.inv.changed();
    this.cooldown = COOLDOWN;
    Audio.plop();   // (as filling it at a river: needs.fillHeld)
    this.float(tr('needs.canteen.filled', { item: itemNoun(s.id), n: s.sips, max: def.canteen }), FLOAT_THIRST);
    return true;
  }
  // Is this target the needs' (filling a canteen at fresh water: needs.target)?
  fills(t) { return !!t?.use && !!this.game.needs && OFFERED.get(t) === this.game.needs; }
  // No stamina left (needs.js): tools go slower, never stop
  tired() { return !!this.game.needs?.exhausted; }

  // Tirar objetos de la mochila al suelo, delante del jugador
  throwOut(id, n, extra) {
    const p = this.game.player;
    if (!p) return false;
    if (BULKY_PARTS[id]) { for (const [m, k] of BULKY_PARTS[id]) this.throwOut(m, n * k); return true; }   // (a big thing is never a drop: its parts)
    for (let i = 0; i < n; i++) this.addDrop({ id, extra, x: p.x + p.face.x * 1.2 + (Math.random() - 0.5) * 0.4, y: p.y + p.face.y * 1.2 + (Math.random() - 0.5) * 0.4, z: 6, vz: 40, t: -1.5, scene: this.game.scene });
    return true;
  }
  // Un objeto más en el suelo (jugando juntos, lo ven todos)
  addDrop(d) {
    if (BULKY_PARTS[d.id]) { for (const [m, k] of BULKY_PARTS[d.id]) for (let i = 0; i < k * (d.count || 1); i++) this.addDrop({ ...d, id: m, count: undefined }); return; }   // (its parts: a big thing would never be picked up)
    this.drops.push(d); this.game.live.dropped(d);
  }




}

