// Modo construcción: se elige una pieza de la paleta, se apunta a una casilla (con el ratón, el dedo
// o lo que hay delante del jugador) y se pone pagando sus materiales. Quitar devuelve los materiales
// (o el mueble a la mochila). Se puede quitar de todo, también de las casas del pueblo y de las aldeas.
// What holds and what does not, structure.js: a roof needs a support, a door its frame, and a wall that holds a roof stays.
// A wall, a window, a door, a post or a fence goes in the place of another in one go (swapFor). What you put less than UNDO_MS
// ago comes back whole, at a tap; the rest of the pieces are taken down holding (needsHold), and give back part (salvage).
// In survival, the pieces are drawn first, for free, and the hammer builds them (plans.js): placing one here draws its plan, and
// pressing on one already drawn hammers it. Furniture and stations, and everything in creative, are placed at once.
import { STATIONS, aStation } from './recipes.js';
import { PIECES, parsePlaced, layerOf } from './pieces.js';
import { ITEMS, CHESTS } from './items.js';
import { floorSprite, wallSprite, doorSprite, hearthSprite, roofSprite, fenceSprite, postSprite } from './art/build.js';
import { Audio } from './audio.js';
import { WALL_H, ROOF, outward } from './three/build3d.js';
import { CHUNK } from './world/gen.js';
import { aabb, hull, solidsOf, placeBoxes, rayHits } from './world/fit.js';
import { wallRuns } from './art/build.js';
import { yawOf, rugRect } from './art/stations.js';

const PICK_NEAR = 14;   // (se apunta a lo que haya hasta aquí: lo que está más lejos del alcance, tapa lo de detrás y dice que está lejos)
export const REACH = 7;   // casillas de distancia a las que se puede construir
import { BUILDABLE, BUILD_CATS } from './buildables.js';
import { t as tr, has } from './i18n.js';   // (as tr: t is the target tile here)
import { planKey, PLAN_REACH } from './plans.js';
import { watchtower } from './world/tower.js';
import { supportOn, roofWhy, holdsRoof, isSupport, frameKind, frameOk, swaps, swappable, SPAN } from './structure.js';
export const BUILD_STATION_REACH = 16;   // a cuántas casillas puede estar la estación que pide una pieza (el banco, para lo de madera; la mesa de cantero, para lo de piedra)
export const UNDO_MS = 10 * 60 * 1000;   // what you have just put comes back whole, this long
export const HOLD_S = 0.3;               // s: the rest is taken down holding (like X: input.js HOLD_X)
const FRAME_MS = 80;                     // ms a frame counts for it, at most
// What comes back of each material when a piece is taken down later (rounded down, but at least 1 of what can be used again)
export const SALVAGE = { tablas: 0.5, piedra: 0.75, fibra: 0, tela: 0 };
export const salvage = cost => cost.map(([m, n]) => { const k = SALVAGE[m] ?? 0.5; return [m, k ? Math.max(1, Math.floor(n * k)) : 0]; }).filter(([, n]) => n > 0);
// "2 planks · 1 stone" (build.mat.<material>; another material, its name)
export const matText = (list, sign = '') => list.map(([m, n]) => sign + (has('build.mat.' + m) ? tr('build.mat.' + m, { n }) : tr('build.mat.other', { n, item: ITEMS[m] }))).join(' · ');
export const PIECE_IDS = Object.keys(PIECES).filter(id => !ITEMS[id] || PIECES[id].palette);   // (el hogar se fabrica, como un mueble; la valla, además de fabricarse, se pone aquí)

// Dibujo de una pieza para su icono en la paleta: el tejado, como casilla suelta (pirámide con alero por
// los cuatro lados); el hogar, con su chimenea
export function pieceSprite(id) {
  const p = PIECES[id];
  if (p.layer === 'floor') return floorSprite(id);
  if (p.layer === 'roof') return roofSprite(id, { nw: 0, ne: 0, se: 0, sw: 0, c: 0.5 }, { n: true, e: true, s: true, w: true }, false);
  if (p.kind === 'door') return doorSprite(true);
  if (p.kind === 'fence') return fenceSprite(id, 3);
  if (p.kind === 'gate') return fenceSprite('valla', 3);
  if (p.kind === 'hearth') return hearthSprite();
  if (p.kind === 'post') return postSprite(id);
  return wallSprite(id, 3);
}

// Todo lo que sale en la barra: las piezas y los muebles y estaciones (buildables.js). DEF: lo que cuesta y pide cada uno
export const BUILD_IDS = [...PIECE_IDS.filter(id => !BUILDABLE[id]), ...Object.keys(BUILDABLE)];
export const ALL_CATS = [...new Set([...Object.values(PIECES).map(p => p.cat), ...Object.keys(BUILD_CATS)])].filter(c => BUILD_IDS.some(id => DEF(id).cat === c));
export function DEF(id) { return BUILDABLE[id] || PIECES[id]; }

export class BuildMode {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.piece = PIECE_IDS[0];
    this.erase = false;          // la "pieza" de quitar (para móvil)
    this.move = false;           // la herramienta de mover: coge un mueble o una estación y lo deja en otro sitio, sin coste
    this.carry = null;           // lo que se lleva al mover: { id }
    this.cursor = null;          // casilla apuntada con el ratón o el dedo, [x, y]
    this.cursorAt = 0;
    this.painted = null;         // al arrastrar, no repetir la misma casilla
    this.onChange = null;
    this.dragLayer = null;       // al arrastrar quitando, la capa de lo primero que se quitó
    this.recent = new Map();     // `layer:tile` → { id, t }: what you put here, for UNDO_MS (this session only)
    this.held = null;            // what is being taken down, holding: { key, tile, layer, ms, last, at } (tick)
    this.stroke = undefined;     // dragging: the id being swapped for another, or null (a stroke that puts new pieces)
    this.holdsMemo = { k: '', v: false };
    this.pickV = 0;              // (cambia al quitar algo: lo apuntado hay que volver a mirarlo)
  }
  toggle(v = !this.on) {
    const g = this.game;
    if (v && (g.mode !== 'play' || !g.player)) return false;
    if (!v) { this.dropCarry(); this.release(); }
    this.on = v;
    this.cursor = null;
    document.body.classList.toggle('building', v);
    this.onChange?.();
    return true;
  }
  select(id) { this.dropCarry(); this.release(); this.erase = id === 'quitar'; this.move = id === 'mover'; if (!this.erase && !this.move) this.piece = id; this.onChange?.(); }
  cycle(d) {
    const list = ['quitar', 'mover', ...BUILD_IDS.filter(id => this.available(id))], cur = this.erase ? 0 : this.move ? 1 : list.indexOf(this.piece);
    this.select(list[(cur + d + list.length) % list.length]);
  }
  // ¿Sale en la barra? Las piezas, siempre; los muebles y las estaciones, cuando se conoce su receta (como al fabricar)
  available(id) { const b = BUILDABLE[id]; return !b || this.game.admin || !!this.game.craft?.known.has(b.recipe); }
  // Lo que el modo construir lleva "en la mano" para colocarlo como un mueble (ver gather.js, pickTarget): el mueble o
  // la estación elegidos, o lo que se está moviendo; null con una pieza de casilla, quitando o sin nada cogido
  heldItem() {
    if (!this.on) return null;
    if (this.carry) return { id: this.carry.id };
    return !this.erase && !this.move && BUILDABLE[this.piece] ? { id: this.piece } : null;
  }
  // Soltar lo que se movía sin haberlo colocado: vuelven sus materiales
  dropCarry() {
    const c = this.carry, g = this.game;
    if (!c) return;
    this.carry = null;
    for (const [m, n] of DEF(c.id).cost) { const left = g.inv.add(m, n); if (left) g.gather.throwOut(m, left); }
    g.gather.float(tr('build.carry_back', { item: DEF(c.id) }), '#fff3c0');
  }
  // Lo que se cobra al colocar (lo llama gather.place): nada si se estaba moviendo o en creativo
  paid(id) {
    const g = this.game;
    if (this.carry) { this.carry = null; this.onChange?.(); return; }
    if (!g.admin) this.spend(DEF(id).cost);
    g.skills?.gain('construccion', 1);
    g.stats?.add('piezas', 1);
  }
  // (with the weight inventory, what is missing comes from the chests nearby: carry.js have and spend; with the slot one
  // (?inventario=casillas), the backpack as before)
  have(id, fresh = false) { return this.game.carry ? this.game.carry.have(id, fresh) : this.game.inv.count(id); }
  spend(cost) { if (this.game.carry) return this.game.carry.spend(cost); for (const [m, n] of cost) this.game.inv.remove(m, n); return true; }
  // (just before placing a piece of furniture or a station: counted now, so it is never placed without being paid)
  canPay(id) { const g = this.game; return g.admin || !!this.carry || DEF(id).cost.every(([m, n]) => this.have(m, true) >= n); }

  // Casilla objetivo: la del ratón si se ha movido hace poco; si no, la de delante del jugador
  target() {
    const p = this.game.player;
    if (!p) return null;
    if (this.erase || this.move) { const hit = this.pick(); if (hit) { this.pointTo(hit.tile); return hit.tile; } }
    // Con ratón, la casilla que hay debajo (y, si está sobre la barra de construir, la última); con el dedo, la
    // tocada hace poco; si no, la de delante
    const sw = this.swapTile();
    if (sw) { this.pointTo(sw); return sw; }
    const mt = this.game.mouseTile();
    if (mt) { this.pointTo(mt); return mt; }
    if (this.cursor && (this.game.mouse || performance.now() - this.cursorAt < 4000)) return this.cursor;
    return [Math.floor(p.x + p.face.x), Math.floor(p.y + p.face.y)];
  }
  pointTo(tile) { this.cursor = tile; this.cursorAt = performance.now(); }
  // (a plan is erased from as far as it is drawn)
  reaches(hit) { const p = this.game.player; return hit.plan ? Math.hypot(hit.plan.x + 0.5 - p.x, hit.plan.ty + 0.5 - p.y) <= PLAN_REACH : this.inReach(hit.tile); }
  inReach(t) { const p = this.game.player; return Math.hypot(t[0] + 0.5 - p.x, t[1] + 0.5 - p.y) <= REACH; }
  // ¿Está cerca la estación que pide la pieza? (lo de madera, el banco de carpintero; en creativo, nada). Se mira dos
  // veces por segundo: esto se pregunta en cada fotograma
  stationFor(id) {
    const need = DEF(id)?.needs, g = this.game, p = g.player;
    if (!need || g.admin || !p || this.carry) return true;
    const now = performance.now();
    if (!this.near || this.near.t < now - 500 || Math.hypot(this.near.x - p.x, this.near.y - p.y) > 1) {
      const found = new Set();
      for (const o of g.scene?.placedNear?.(p.x, p.y, BUILD_STATION_REACH) || []) if (STATIONS[o.placed]) found.add(o.placed);
      this.near = { t: now, x: p.x, y: p.y, found };
    }
    return this.near.found.has(need);
  }
  affordable(id) { return this.game.admin || !!this.carry || DEF(id).cost.every(([m, n]) => this.have(m) >= n); }

  // Qué pasaría en la casilla: { ok, why, code, swap }
  check(t) {
    const g = this.game, sc = g.scene, no = (code, args) => ({ ok: false, code, why: tr('build.why.' + code, args) });
    if (this.erase) {
      const hit = this.eraseTarget(t);
      if (!hit) return no('nothing');
      if (!this.reaches(hit)) return no('far');
      return this.holds(hit) ? no('holds_roof') : { ok: true };
    }
    // Un mueble o una estación (o lo que se mueve): que se pueda pagar, con su estación cerca y donde quepa (lo dice
    // gather.pickTarget, que es quien lo coloca, libre y con su giro)
    const held = this.heldItem();
    if (held) {
      if (!this.affordable(held.id)) return no('materials');
      if (!this.stationFor(held.id)) return no('station', { station: aStation(DEF(held.id).needs) });
      const tg = g.gather.target?.place === held.id ? g.gather.target : g.gather.pickTarget();
      return tg?.ok ? { ok: true } : tg?.far ? no('far') : tg?.why ? { ok: false, why: tg.why } : no('no_fit');
    }
    if (this.move) {
      const hit = this.eraseTarget(t), raw = hit && sc.at(hit.layer, hit.tile[0], hit.tile[1]), id = raw && parsePlaced(raw)[0];
      if (!hit || !BUILDABLE[id]) return no('move_what');
      if (watchtower(id)) return { ok: false, why: tr('why.watchtower.move') };
      if (sc.ownAt && !sc.ownAt(hit.layer, hit.tile[0], hit.tile[1])) return no('move_fixed');
      if (!this.inReach(hit.tile)) return no('far');
      return this.holds(hit) ? no('holds_roof') : { ok: true };
    }
    if (!t) return { ok: false };
    if (sc !== g.world) return no('indoors');
    const id = this.piece, sw = this.swapFor(t);
    // (drawing it: from farther away, with nothing in hand nor near. A wall that stands is still swapped at once)
    if (!sw && g.plans?.active) { const c = g.plans.check(t, id); return c.ok ? c : no(c.code, { n: SPAN }); }
    if (!this.inReach(t)) return no('far');
    if (!(sw ? this.canPayNet(sw) : this.affordable(id))) return no('materials');
    if (!this.stationFor(id)) return no('station', { station: aStation(PIECES[id].needs) });
    if (sw) return sw.why ? no(sw.why) : { ok: true, swap: sw };
    if (!sc.canPlace(t[0], t[1], id, g.player)) return no(this.whyNot(t, id), { n: SPAN });
    return { ok: true };
  }
  // Why a piece does not go in a tile (the code of build.why.<code>)
  whyNot(t, id, sc = this.game.scene) {
    const kind = PIECES[id].kind, [x, y] = t;
    if ((kind === 'door' || kind === 'gate') && sc.holeBeside?.(x, y)) return 'hole';
    if (!supportOn()) return PIECES[id].layer === 'roof' ? 'roof' : 'no_fit';
    if (sc.at(layerOf(id), x, y) || inWater(sc, x, y)) return 'no_fit';
    if (PIECES[id].layer === 'roof') return roofWhy(sc, x, y) || 'no_fit';
    return frameOk(sc, x, y, id) ? 'no_fit' : frameKind(id) === 'gate' ? 'gate_frame' : frameKind(id) === 'window' ? 'window_frame' : 'frame';
  }
  // Does what is aimed at hold a roof that would be left with nothing under it? (Creative, never: nothing is checked there.)
  // Asked in every frame while aiming at it: kept until something around changes
  holds(hit) {
    const g = this.game, sc = g.scene, [x, y] = hit.tile;
    if (hit.plan || hit.layer !== 'placed' || g.admin || sc !== g.world || !supportOn()) return false;
    const raw = sc.at('placed', x, y);
    if (!raw || !isSupport(parsePlaced(raw)[0])) return false;
    const k = `${x},${y},${sc.touches}`, M = this.holdsMemo;
    if (M.k !== k) { M.k = k; M.v = holdsRoof(sc, x, y); }
    return M.v;
  }

  // ---------- swapping ----------
  // The piece chosen in the place of the one in this tile, or null: { tile, from, pay, back (lists of materials), why }. The
  // old one's materials come back whole and the new one's are paid: only the difference changes hands
  swapFor(t) {
    const g = this.game, sc = g.scene;
    if (!t || this.erase || this.move || !swappable(this.piece) || sc !== g.world || this.stroke === null) return null;
    const raw = sc.at('placed', t[0], t[1]), from = raw && parsePlaced(raw)[0];
    if (!from || !swaps(from, this.piece) || (this.stroke && this.stroke !== from)) return null;
    const pay = [], back = [];
    for (const m of new Set([...PIECES[from].cost, ...PIECES[this.piece].cost].map(c => c[0]))) {
      const of = id => PIECES[id].cost.find(c => c[0] === m)?.[1] || 0, n = of(this.piece) - of(from);
      if (n > 0) pay.push([m, n]); else if (n < 0) back.push([m, -n]);
    }
    const kind = PIECES[this.piece].kind, k = frameKind(this.piece), p = g.player;
    // (a doorway one stands in is not walled up; a door does not open onto a hole)
    const why = (kind === 'door' || kind === 'gate') && sc.holeBeside?.(t[0], t[1]) ? 'hole'
      : supportOn() && !g.admin && !frameOk(sc, t[0], t[1], this.piece) ? (k === 'gate' ? 'gate_frame' : k === 'window' ? 'window_frame' : 'frame')
        : kind !== 'door' && p && Math.abs(p.x - t[0] - 0.5) < 0.8 && Math.abs(p.y - t[1] - 0.5) < 0.8 ? 'no_fit' : null;
    return { tile: t, from, pay, back, why };
  }
  canPayNet(sw) { return this.game.admin || sw.pay.every(([m, n]) => this.have(m) >= n); }
  // With the mouse, the tile of a wall (a door, a fence…) that is under the cursor and can be swapped for the piece chosen:
  // the wall itself is aimed at, not the ground behind it. null: the ground's tile, as always
  swapTile(at) {
    const g = this.game, sc = g.scene;
    if (this.erase || this.move || !swappable(this.piece) || sc !== g.world || this.stroke === null || !(at || g.mouse?.in)) return null;
    const m = g.mouse, x = at ? at[0] : m.x, y = at ? at[1] : m.y, M = (this.swapMemo ||= {});
    if (M.frame === g.frameNo && M.v === this.pickV && M.piece === this.piece && M.x === x && M.y === y) return M.tile;
    Object.assign(M, { frame: g.frameNo, v: this.pickV, piece: this.piece, x, y, tile: null });
    const ray = g.view3d.rayAt?.(x, y), p = g.player, view = g.view3d.world;
    if (!ray) return null;
    const hidden = (tx, ty, side) => !!view?.faded?.(tx, ty, side), cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK), R = REACH + 1;
    let near = Infinity, best = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const o of sc.contentFor(cx + dx, cy + dy).objects) {
      if (o.layer !== 'placed' || !o.placed || Math.abs(o.x - p.x) > R || Math.abs(o.y - p.y) > R || !PIECES[o.placed] || !this.inReach(o.tile)) continue;
      const y0 = g.view3d.groundY(sc, o.x, o.y), whole = rayHits(ray.o, ray.d, { ...aabb(o.x - 0.6, o.y - 0.6, o.x + 0.6, o.y + 0.6), y0: y0 - 0.5, y1: y0 + WALL_H + 0.5 });
      if (whole === null || whole >= near) continue;
      this.pieceBoxes(o, hidden, b => {
        const gy = g.view3d.groundY(sc, b.x, b.y), t = rayHits(ray.o, ray.d, { ...b, y0: b.y0 + gy, y1: b.y1 + gy });
        if (t !== null && t < near) { near = t; best = o; }
      });
    }
    // (the nearest one is looked at whether it can be swapped or not: the same one again hides what is behind. And so does a roof)
    if (!best || !swaps(best.placed, this.piece)) return null;
    if (ray.d[1] < 0) {
      const t = (g.view3d.groundY(sc, best.x, best.y) + WALL_H - ray.o[1]) / ray.d[1], rx = Math.floor(ray.o[0] + ray.d[0] * t), rz = Math.floor(ray.o[2] + ray.d[2] * t);
      if (t > 0 && t < near && sc.roofAt(rx, rz) && !hidden(rx, rz, 'roof')) return null;
    }
    return (M.tile = best.tile);
  }
  doSwap(sw) {
    const g = this.game, sc = g.scene, [x, y] = sw.tile, id = this.piece, own = !!sc.ownAt('placed', x, y), key = `placed:${x},${y}`;
    if (!g.admin && sw.pay.length && !this.spend(sw.pay)) { g.gather.float(tr('build.why.materials'), '#ffb0a0'); Audio.error(); return false; }
    if (!sc.swapPiece(x, y, id)) return false;
    if (!g.admin) this.giveBack(sw.back);
    // (an old piece does not become new, with all its materials, by changing it twice)
    if (this.isRecent(key, sw.from)) this.recent.set(key, { id, t: this.recent.get(key).t }); else this.recent.delete(key);
    g.rep?.taken('placed', x, y, own);
    g.rep?.placed('placed', x, y);
    this.pickV++;
    return true;
  }
  giveBack(list) { const g = this.game; for (const [m, n] of list) { const left = g.inv.add(m, n); if (left) g.gather.throwOut(m, left); } }
  // Did you put this piece here less than UNDO_MS ago?
  isRecent(key, id) {
    const r = this.recent.get(key);
    if (r && Date.now() - r.t >= UNDO_MS) { this.recent.delete(key); return false; }
    return !!r && r.id === id;
  }
  // What comes back of the piece in that layer and tile
  backOf(hit, id) { return hit.plan || !supportOn() || this.game.admin || this.isRecent(`${hit.layer}:${hit.tile}`, id) ? DEF(id).cost : salvage(DEF(id).cost); }
  // Something just put, for UNDO_MS (a watchtower: gather.js, place)
  justPut(id, t) { this.recent.set(`${layerOf(id)}:${t}`, { id, t: Date.now() }); }
  // Is it taken down only by holding? (a piece of the palette you have not just put. Furniture and stations come apart cleanly)
  // (nor a plan, but one already begun: what was hammered is lost)
  needsHold(hit, id) { return hit.plan ? !this.game.admin && (hit.plan.rec.w > 0 || !!hit.plan.rec.p) : watchtower(id) ? !this.game.admin && !this.isRecent(`${hit.layer}:${hit.tile}`, id) : supportOn() && !this.game.admin && !!PIECES[id] && !ITEMS[id] && !this.isRecent(`${hit.layer}:${hit.tile}`, id); }

  place(t = this.target(), drag = false, at = null) {
    if (!this.on) return;
    if (this.erase) return this.removeAt(t, drag, at);
    const held = this.heldItem();
    if (held) {   // (un mueble o una estación: lo coloca gather, que cobra con paid())
      if (drag) return;
      const g = this.game, c = this.check(t);
      if (!c.ok && (c.code === 'materials' || c.code === 'station')) { g.gather.float(c.why, '#ffb0a0'); Audio.error(); return; }
      g.gather.place(held.id);
      return;
    }
    if (this.move) return this.lift(t, drag, at);
    if (!drag) this.stroke = undefined;
    const g = this.game;
    if (drag && g.plans?.holding) return;   // (hammering: the cursor picks the next one, plans.js)
    t = this.swapTile(at) || t;
    if (!t) return;
    if (drag && this.painted === `${t}`) return;
    this.painted = `${t}`;
    const c = this.check(t);
    if (!drag) this.stroke = c.swap ? c.swap.from : null;   // (dragging on swaps only the same as the first one, and painting new ones swaps nothing)
    if (!drag) this.drawing = c.plan || null;
    if (c.plan) {
      if (c.plan === 'hammer') { if (!drag) g.plans.hold(c.key); }
      else if (c.plan === this.drawing) g.plans.draw(c.key, this.piece);   // (a stroke that draws new ones changes none of the old, nor the other way round)
      return;
    }
    if (c.swap) { if (!this.doSwap(c.swap)) return; return this.placedFx(t); }
    if (!c.ok) { if (!drag) { if (c.why) g.gather.float(c.why, '#ffb0a0'); Audio.error(); } return; }
    if (!g.admin && !this.spend(PIECES[this.piece].cost)) { if (!drag) { g.gather.float(tr('build.why.materials'), '#ffb0a0'); Audio.error(); } return; }   // (counted now: the chests nearby may have changed, carry.js)
    g.scene.place(t[0], t[1], this.piece);
    this.recent.set(`${layerOf(this.piece)}:${t}`, { id: this.piece, t: Date.now() });
    if (g.scene === g.world) g.rep?.placed(layerOf(this.piece), t[0], t[1]);   // (put back where you took it from: reputation.js)
    this.placedFx(t);
  }
  placedFx(t) {
    const g = this.game;
    g.gather.chips(t[0] + 0.5, t[1] + 0.5, 'wood', 6);
    Audio.place();
    g.skills?.gain('construccion', 1);
    g.stats?.add('piezas', 1);
  }

  // Mover: coger el mueble o la estación apuntados (vacíos: como al quitarlos) para dejarlos en otro sitio sin pagar
  lift(t, drag = false, at = null) {
    if (drag) return;
    const g = this.game, sc = g.scene, c = this.check(t), hit = c.ok && this.eraseTarget(t, at);
    if (!hit) { if (c.why) g.gather.float(c.why, '#ffb0a0'); Audio.error(); return; }
    const id = parsePlaced(sc.at(hit.layer, hit.tile[0], hit.tile[1]))[0];
    if (this.unknown(id, !sc.ownAt || sc.ownAt(hit.layer, hit.tile[0], hit.tile[1]))) return;
    if (!g.pickUp({ tile: hit.tile, layer: hit.layer, placed: id }, true)) return;
    this.carry = { id };
    this.pickV++;
    g.gather.chips(hit.tile[0] + 0.5, hit.tile[1] + 0.5, 'wood', 4);
    this.onChange?.();
  }

  // En una casilla, lo que se quitaría, de arriba abajo (para cuando no se apunta): { tile, layer }. La casilla es donde
  // está guardado (una cama o una alfombra grandes ocupan más)
  removableAt(t) {
    const sc = this.game.scene;
    if (!t || !sc.at) return null;
    if (!this.move) for (const layer of ['roof', 'placed', 'floor']) { const e = this.planHit(planKey(layer, t[0], t[1])); if (e) return e; }
    for (const layer of ['roof', 'hang', 'placed']) if (sc.at(layer, t[0], t[1])) return { tile: t, layer };
    const long = sc.anchorOf?.(t[0], t[1]);
    if (long) return { tile: long, layer: 'placed' };
    const rug = sc.rugAnchor?.(t[0], t[1]) || (sc.at('rug', t[0], t[1]) ? t : null);
    if (rug) return { tile: rug, layer: 'rug' };
    return sc.at('floor', t[0], t[1]) ? { tile: t, layer: 'floor' } : null;
  }
  removable(t) { return this.removableAt(t)?.layer || null; }
  // A plan as something to remove: { tile, layer, plan: its entry, o, box }, or null
  planHit(key) {
    const P = this.game.plans, e = P && this.game.scene === this.game.world && (P.refresh(), P.byKey.get(key));
    return e ? { tile: e.tile, layer: e.layer, plan: e, o: { tile: e.tile, layer: e.layer, placed: e.id, plan: true }, box: P.boxOf(e) } : null;
  }
  // The boxes of a wall, a door, a post or a fence, to aim at it (those hidden from inside the house, not): add(box). false:
  // it is none of these
  pieceBoxes(o, hidden, add) {
    const sc = this.game.scene, [tx, ty] = o.tile, box = (x, y, hx, hy, y0, y1) => ({ ...aabb(x - hx, y - hy, x + hx, y + hy), y0, y1 });
    if (o.fence) {
      const m = o.mask || 0, x0 = m & 2 ? -0.5 : -0.1, x1 = m & 1 ? 0.5 : 0.1, y0 = m & 8 ? -0.5 : -0.1, y1 = m & 4 ? 0.5 : 0.1;
      add(box(o.x + (x0 + x1) / 2, o.y + (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0.9));
    } else if (o.door) {
      const alongX = o.door === 'x', high = o.gate ? 1 : WALL_H;
      if (!o.gate && hidden(tx, ty, outward(sc, tx, ty, alongX))) return true;
      add(alongX ? box(tx + 0.5, ty + 0.5, 0.5, 0.14, 0, high) : box(tx + 0.5, ty + 0.5, 0.14, 0.5, 0, high));
    } else if (PIECES[o.placed]?.kind === 'wall') {
      // (el muro que da a la cámara, desde dentro, no se ve: se apunta a lo de detrás)
      const m = o.mask ?? 0, sides = [m & 3 || !(m & 12) ? outward(sc, tx, ty, true) : null, m & 12 ? outward(sc, tx, ty, false) : null].filter(Boolean);
      if (sides.every(side => hidden(tx, ty, side))) return true;
      for (const [x0, x1, y0, y1] of wallRuns(m)) add({ ...aabb(o.x + x0, o.y + y0, o.x + x1, o.y + y1), y0: 0, y1: WALL_H });
    } else if (o.post) { const r = PIECES[o.placed].r; add(box(o.x, o.y, r, r, 0, WALL_H)); }
    else return false;
    return true;
  }
  // Todo lo que se puede quitar cerca, cada cosa con la caja que ocupa de verdad: { tile, layer, o, box }
  pickables() {
    const g = this.game, sc = g.scene, p = g.player, view = g.view3d.world, out = [], memo = new Map();
    const box = (x, y, hx, hy, y0, y1) => ({ ...aabb(x - hx, y - hy, x + hx, y + hy), y0, y1 });
    const add = (o, b) => out.push({ tile: o.tile, layer: o.layer, o, box: b });
    const hidden = (tx, ty, side) => !!view?.faded?.(tx, ty, side);
    const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = sc.contentFor(cx + dx, cy + dy);
      for (const o of c.floors) if (Math.abs(o.x - p.x) < PICK_NEAR && Math.abs(o.y - p.y) < PICK_NEAR) add(o, box(o.tile[0] + 0.5, o.tile[1] + 0.5, 0.5, 0.5, -0.05, 0.05));
      for (const o of [...c.objects, ...c.flats]) {
        if ((!o.placed && !o.unknown) || !o.tile || !o.layer || Math.abs(o.x - p.x) > PICK_NEAR || Math.abs(o.y - p.y) > PICK_NEAR) continue;
        const [tx, ty] = o.tile;
        // (lo de una versión más nueva, con «?»: se apunta, para decir que no se quita)
        if (o.unknown) add(o, o.layer === 'hang' ? box(o.x, o.y, 0.45, 0.45, 0.9, 2) : o.layer === 'rug' ? { ...aabb(o.fx[0], o.fy[0], o.fx[1], o.fy[1]), y0: 0, y1: 0.08 } : { ...o.obb, y0: 0, y1: 0.75 });
        else if (o.layer === 'roof') {
          if (hidden(tx, ty, 'roof')) continue;   // (desde dentro no se ve)
          add(o, box(tx + 0.5, ty + 0.5, 0.5, 0.5, WALL_H, WALL_H + ROOF.thick + ROOF.level * ((sc.roofGeometry?.(tx, ty, memo)?.h.c ?? 0) + 0.5)));
        } else if (o.layer === 'rug') add(o, { ...(o.obb || aabb(o.fx[0], o.fy[0], o.fx[1], o.fy[1])), y0: 0, y1: 0.08 });
        else if (o.layer === 'hang') add(o, box(o.x, o.y, 0.45, 0.45, 0.9, 2));
        else if (!this.pieceBoxes(o, hidden, b => add(o, b))) {
          let h = hull(solidsOf(o.model || o.placed));
          if (!isFinite(h[0])) h = [-0.45, 0, -0.45, 0.45, 0.1, 0.45];
          add(o, placeBoxes([h], o.x, o.y, o.yaw ?? yawOf(o.rot))[0]);
        }
      }
    }
    return out;
  }
  // Lo primero que corta el rayo que sale por un punto de la pantalla (at; si no, el ratón): { tile, layer, o, box }, o
  // null. Así se quita lo que se ve ahí: el tejado desde fuera, la pared aunque tenga tejado encima, y lo de dentro de casa
  pick(at) {
    const g = this.game, sc = g.scene, m = g.mouse;
    if (sc !== g.world || !g.player || (!at && !m?.in)) return null;
    if (!at && m.pickFrame === g.frameNo && m.pickV === this.pickV) return m.pick;
    const ray = g.view3d.rayAt?.(at ? at[0] : m.x, at ? at[1] : m.y);
    let best = null, near = Infinity;
    if (ray) for (const c of this.pickables()) {
      const gy = g.view3d.groundY(sc, c.box.x, c.box.y), t = rayHits(ray.o, ray.d, { ...c.box, y0: c.box.y0 + gy, y1: c.box.y1 + gy });
      if (t !== null && t < near) { near = t; best = c; }
    }
    if (ray && !this.move && g.plans?.list.length) {
      const e = g.plans.pickAt(at ? at[0] : m.x, at ? at[1] : m.y, PLAN_REACH, false, near);
      if (e) best = this.planHit(e.key);
    }
    if (!at) { m.pick = best; m.pickFrame = g.frameNo; m.pickV = this.pickV; }
    return best;
  }
  // Con ratón (o tocando la pantalla), lo que se apunta; si no hay nada, nada. Sin apuntar, lo de esa casilla
  eraseTarget(t, at) {
    const g = this.game;
    return g.scene === g.world && (at || g.mouse?.in) ? this.pick(at) : this.removableAt(t);
  }
  remove(t = this.target()) { return this.removeAt(t); }
  // Quitar: si es lo que venía puesto (de una casa del pueblo o de una aldea), igual; se apunta que ya no está. drag: al
  // arrastrar, una vez por pieza y solo de la misma capa que la primera, para que un temblor no se lleve lo de debajo.
  // A piece that needs holding starts here and ends in tick; moving on to another one starts again
  removeAt(t, drag = false, at = null) {
    const g = this.game, sc = g.scene, hit = this.eraseTarget(t, at);
    if (!hit) { this.held = null; if (!drag) Audio.error(); return; }
    const { tile, layer } = hit, key = keyOf(hit), dl = (hit.plan ? 'plan:' : '') + layer;
    if (drag && (this.painted === key || this.held?.key === key || (this.dragLayer && this.dragLayer !== dl))) return;
    this.held = null;
    if (!this.reaches(hit)) { if (!drag) Audio.error(); return; }
    const raw = hit.plan ? hit.plan.id : sc.at(layer, tile[0], tile[1]);
    if (!raw) return;
    if (this.holds(hit)) { if (!drag) { g.gather.float(tr('build.why.holds_roof'), '#ffb0a0'); Audio.error(); } return; }
    const id = parsePlaced(raw)[0];
    this.dragLayer = dl;
    if (this.needsHold(hit, id) && (hit.plan || !this.unknown(id, !sc.ownAt || sc.ownAt(layer, tile[0], tile[1])))) {
      this.held = { key, tile, layer, id, o: hit.o || null, box: hit.box || null, ms: 0, last: performance.now(), at };
      return;
    }
    this.painted = key;
    this.takeDown(hit);
  }
  // Letting go of the mouse (or of X, or leaving the mode): the drag is over, and what was being held stays
  release() {
    const h = this.held;
    this.painted = null; this.dragLayer = null; this.held = null; this.stroke = undefined; this.drawing = null;
    this.game.plans?.release();
    if (h) this.game.gather?.float(tr('build.hold_on'), '#fff3c0');
  }
  // Each frame: what is being taken down, holding. Aiming at something else (or out of reach) stops it
  tick() {
    const h = this.held, g = this.game;
    if (!h) return;
    const m = g.mouse, hit = g.mode === 'play' && !g.busy && this.on ? this.eraseTarget(h.tile, m?.in ? [m.x, m.y] : h.at) : null;
    if (!hit || keyOf(hit) !== h.key || !this.reaches(hit)) { this.held = null; return; }
    const now = performance.now();
    h.ms += Math.min(FRAME_MS, now - h.last); h.last = now;   // (a long frame, with the key let go of waiting behind it, does not end a tap)
    if (h.ms < HOLD_S * 1000) return;
    this.held = null;
    this.painted = h.key;
    this.takeDown(hit);
  }
  // How much of the hold is done (0 to 1; -1: none)
  holdK() { return this.held ? Math.min(1, this.held.ms / (HOLD_S * 1000)) : -1; }
  takeDown(hit) {
    if (hit.plan) { if (this.game.plans.cancel(hit.plan.key)) { this.pickV++; Audio.chalk(); } return; }
    const g = this.game, sc = g.scene, { tile, layer } = hit, raw = sc.at(layer, tile[0], tile[1]);
    if (!raw) return;
    const [id, k] = parsePlaced(raw), own = !sc.ownAt || sc.ownAt(layer, tile[0], tile[1]), o = { tile, layer, placed: id, ...(layer === 'rug' ? { rug: rugRect(tile[0], tile[1], k) } : {}), ...(own ? {} : { fixed: true, build: true }) };
    if (this.unknown(id, own)) return;
    if (id === 'wheelbarrow' && g.barrow?.loaded(tile)) { g.gather.float(tr('barrow.empty_first'), '#ffb0a0'); Audio.error(); return; }   // (its stacks or its big things: barrow.js)
    if (CHESTS[id] && sc.chestAt(...tile)?.some(Boolean)) { g.gather.float(tr('build.empty_first', { what: CHESTS[id][1] }), '#ffb0a0'); Audio.error(); return; }
    if (PIECES[id] && !ITEMS[id]) {
      const back = this.backOf(hit, id);
      if (sc.unplace(o) === false) { Audio.error(); return; }
      this.recent.delete(`${layer}:${tile}`);
      this.giveBack(back);
      if (!back.length) g.gather.float(tr(PIECES[id].cost.every(([m]) => m === 'fibra') ? 'build.salvage.none' : 'build.salvage.nothing'), '#d8c3a0');
      if (sc === g.world) g.rep?.taken(layer, tile[0], tile[1], own);   // (from a neighbor's house: the village notices, reputation.js; pickUp does it for the rest)
    } else if (!g.pickUp(o)) return;
    if (watchtower(id)) this.recent.delete(`${layer}:${tile}`);
    this.pickV++;
    g.gather.chips(tile[0] + 0.5, tile[1] + 0.5, 'wood', 6);
    Audio.chop();
  }
  // Lo de una versión más nueva del juego (un id que este no conoce) no se quita ni se mueve: se perdería (ver knownItem).
  // own: si es del jugador (lo fijo del pueblo lo pone el juego: siempre lo conoce)
  unknown(id, own = true) {
    if (!own || PIECES[id] || ITEMS[id]) return false;
    this.game.gather.float(tr('build.newer'), '#ffb0a0'); Audio.error();
    return true;
  }
  // El borde amarillo de lo que se va a quitar
  pickHighlight() {
    if (!this.on || !(this.erase || (this.move && !this.carry))) return null;
    const hit = this.pick();
    return hit && this.reaches(hit) ? { kind: 'placed', o: hit.o, yaw: hit.o.yaw, box: hit.box } : null;
  }

  // Lo que se va a quitar (o mover), por su nombre: { item, id, hit } (null: nothing there; { newer } a thing of a newer version)
  aimedThing() {
    const sc = this.game.scene, hit = this.eraseTarget(this.target()), raw = hit && (hit.plan ? hit.plan.id : sc.at(hit.layer, hit.tile[0], hit.tile[1])), id = raw && parsePlaced(raw)[0], def = id && (PIECES[id] || ITEMS[id]);
    return def?.name ? { item: def, id, hit } : id ? { newer: true } : null;
  }
  eraseHint() {
    const a = this.aimedThing();
    if (a?.hit?.plan) return this.needsHold(a.hit, a.id) ? tr('build.hint.erase_begun', { item: a.item, back: matText(PIECES[a.id].cost) }) : tr('build.hint.erase', { item: a.item });
    if (a?.item && this.needsHold(a.hit, a.id)) { const back = this.backOf(a.hit, a.id); return back.length ? tr('build.hint.remove_hold', { item: a.item, back: matText(back) }) : tr('build.hint.remove_hold_none', { item: a.item }); }
    return a?.item ? tr('build.hint.remove', { item: a.item }) : a?.newer ? tr('build.hint.newer') : tr('build.hint.remove_any');
  }
  // Drawing a piece, or hammering the one drawn there
  planHint(c) {
    const P = this.game.plans, item = PIECES[this.piece], e = c.plan === 'hammer' && P.byKey.get(c.key);
    return e ? (P.inReach(e) ? P.label(e) : tr('build.why.far')) : tr('build.hint.plan', { item });
  }
  swapHint(sw) {
    const cost = this.game.admin ? '' : [matText(sw.pay, '+'), sw.back.length ? tr('build.swap_back', { back: matText(sw.back) }) : ''].filter(Boolean).join(' · ');
    return cost ? tr('build.hint.swap', { item: PIECES[this.piece], cost }) : tr('build.hint.swap_free', { item: PIECES[this.piece] });
  }
  // The row at the thing that is taken down holding (ui/prompts.js): { text, target, k } or null
  holdRow() {
    if (!this.on) return null;
    const h = this.held, hit = h || (this.erase ? this.pick() : null), sc = this.game.scene;
    if (!hit || !this.reaches(hit)) return null;
    const raw = hit.plan ? hit.plan.id : sc.at(hit.layer, hit.tile[0], hit.tile[1]), id = raw && parsePlaced(raw)[0];
    if (!id || !PIECES[id]?.name || !this.needsHold(hit, id) || (!h && this.holds(hit))) return null;
    const R = (this.row ||= { text: '', target: null, k: -1 });
    R.text = tr(hit.plan ? 'build.prompt.erase' : 'build.prompt.take_down', { item: PIECES[id] });
    R.target = hit.o && hit.box ? { kind: 'placed', o: hit.o, box: hit.box } : null;
    R.k = this.holdK();
    return R;
  }
  hint() {
    if (!this.on) return '';
    const held = this.heldItem();
    if (held) { const c = this.check(), item = DEF(held.id); return c.ok ? tr(this.carry ? 'build.hint.drop' : 'build.hint.place', { item }) : tr('build.hint.why', { why: c.why || tr('build.hint.no_fit') }); }
    if (this.move) { const c = this.check(this.target()), a = c.ok && this.aimedThing(); return c.ok ? (a?.item ? tr('build.hint.move', { item: a.item }) : a?.newer ? tr('build.hint.newer') : tr('build.hint.move_any')) : c.why || ''; }
    const c = this.check(this.target());
    return this.erase ? (c.ok ? this.eraseHint() : c.why || '') : c.ok ? (c.swap ? this.swapHint(c.swap) : c.plan ? this.planHint(c) : tr('build.hint.piece', { item: PIECES[this.piece] })) : c.why || '';
  }

}
// (what is being removed: a plan and the piece under it are two things)
const keyOf = hit => `${hit.plan ? 'plan:' : ''}${hit.layer}:${hit.tile}`;
// (a roof over the water, a wall in it: it does not fit, whatever holds it)
const inWater = (sc, x, y) => !!sc.water?.(x + 0.5, y + 0.5);
