// What holds a roof, what a door needs beside it, and the room you are in (docs/planes/realismo/PLAN-R5-construccion.md, P1).
// Logic only: scenes.js (canPlace), build.js (why not, what may be taken down) and game.js (game.room) ask it.
//
// A roof tile is held when
//   1. a support (a wall, a window, a door, a post, the hearth) is in it or in one of its 8 neighbours (the eave: 1 tile out), or
//   2. along its row, or its column, there is a support to each side with at most SPAN tiles between the two.
// Nothing built ever falls, and nothing is checked but when a roof is put or a support is taken away. A roof of an old save,
// built when nothing was asked of it, stays, and goes on being free to change: of a roof with some tile that nothing holds,
// every support may be taken away, and its holes are closed again. What came with the village or an aldea counts like the rest.
// Two ways to walk a row: to take a support away, only through roof (rafters rest on roof beside them); to put a roof tile,
// through anything, so the first tile in the middle of a room goes before the ones between it and the walls.
import { PIECES, parsePlaced } from './pieces.js';
import { wrapIndex } from './world/planet.js';
import { CHUNK } from './world/gen.js';
import { apagada } from './opciones.js';
import { ruleOf, AIR_WALLS } from './wearrules.js';

export const SPAN = 12;
const OFF = { support: apagada('soporte'), shelter: apagada('refugio') };
export const supportOn = () => !OFF.support;
export const shelterOn = () => !OFF.shelter;

const SUPPORT = new Set(['wall', 'door', 'post', 'hearth']);
export const isSupport = id => SUPPORT.has(PIECES[id]?.kind);

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const RING = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const keyOf = (x, y) => (y + 4194304) * 8388608 + (x + 4194304);

// What is in the tiles around, each asked of the scene once: a question here looks at hundreds. In a chunk where nothing came
// with the village or an aldea, straight from what the players put
class Look {
  constructor() { this.scene = null; this.chunks = new Map(); this.memo = { placed: new Map(), roof: new Map() }; }
  of(scene) { this.scene = scene; this.chunks.clear(); this.memo.placed.clear(); this.memo.roof.clear(); return this; }
  bare(cx, cy) {
    const S = this.scene, k = keyOf(cx, cy);
    let c = this.chunks.get(k);
    if (c === undefined) {
      c = null;
      if (S.deltas && S.contentFor && !S.overlay) { const q = S.contentFor(cx, cy); if (!q.objects.some(o => o.fixed) && !q.floors.some(o => o.fixed)) c = S.deltas.get(`${wrapIndex(cx, CHUNK)},${cy}`) || 0; }
      this.chunks.set(k, c);
    }
    return c;   // (its changes, 0: none; null: ask the scene)
  }
  at(layer, x, y) {
    const M = this.memo[layer], k = keyOf(x, y);
    let v = M.get(k);
    if (v === undefined) {
      const d = this.bare(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
      v = (d === null ? this.scene.at(layer, x, y) : d ? d[layer]?.[`${x},${y}`] : null) || null;
      M.set(k, v);
    }
    return v;
  }
  roof(x, y) { return this.at('roof', x, y) !== null; }
  id(x, y) { const v = this.at('placed', x, y); return v && parsePlaced(v)[0]; }
  kind(x, y) { const v = this.at('placed', x, y); return v ? PIECES[v]?.kind ?? PIECES[parsePlaced(v)[0]]?.kind : undefined; }
  support(x, y) { return SUPPORT.has(this.kind(x, y)); }
}
const LOOK = new Look();

// How far the nearest support is from (tx, ty) going (dx, dy), at most max tiles away (0: none). free: through anything (else
// only through roof). goneX, goneY: a tile that counts as without its support
function reach(L, tx, ty, dx, dy, max, free, goneX, goneY) {
  for (let i = 1; i <= max; i++) {
    const x = tx + dx * i, y = ty + dy * i;
    if (!(x === goneX && y === goneY) && L.support(x, y)) return i;
    if (!free && !L.roof(x, y)) return 0;
  }
  return 0;
}
// Is there a support next to (or in) this tile? (rule 1)
function beside(L, tx, ty, goneX, goneY) {
  for (const [i, j] of RING) if (!(tx + i === goneX && ty + j === goneY) && L.support(tx + i, ty + j)) return true;
  return false;
}
// The tiles between the supports at both sides along one axis, or 0 if one of them is missing
function between(L, tx, ty, dx, dy, max, free, goneX, goneY) {
  const a = reach(L, tx, ty, dx, dy, max, free, goneX, goneY), b = a && reach(L, tx, ty, -dx, -dy, max, free, goneX, goneY);
  return a && b ? a + b - 1 : 0;
}
function held(L, tx, ty, free, goneX, goneY) {
  if (beside(L, tx, ty, goneX, goneY)) return true;
  for (let k = 0; k < 2; k++) {
    const n = between(L, tx, ty, k ? 0 : 1, k ? 1 : 0, SPAN, free, goneX, goneY);
    if (n && n <= SPAN) return true;
  }
  return false;
}
// Is there in the roof this tile is part of one that nothing holds? (It is from before: it could not be put today.) At most
// ROOF_MAX tiles of it, starting here
const ROOF_MAX = 900;
function oldRoof(L, tx, ty) {
  const seen = new Set([keyOf(tx, ty)]), todo = [tx, ty];
  for (let i = 0; i < todo.length && seen.size <= ROOF_MAX; i += 2) {
    const x = todo[i], y = todo[i + 1];
    if (!held(L, x, y, false, NaN, NaN)) return true;
    for (const [a, b] of SIDES) { const k = keyOf(x + a, y + b); if (!seen.has(k) && L.roof(x + a, y + b)) { seen.add(k); todo.push(x + a, y + b); } }
  }
  return false;
}
// A hole in a roof is closed again: of one tile, in any; of more, from its corners on, over a floor and in a roof of before
function mends(L, scene, tx, ty) {
  if ((L.roof(tx - 1, ty) && L.roof(tx + 1, ty)) || (L.roof(tx, ty - 1) && L.roof(tx, ty + 1))) return true;
  const near = SIDES.filter(([i, j]) => L.roof(tx + i, ty + j));
  return near.length > 1 && !!scene.at('floor', tx, ty) && oldRoof(L, tx + near[0][0], ty + near[0][1]);
}
// A new tile grows out of something: a support beside it, a roof beside it, or a floor under it. (Not alone in mid-air, between
// two houses that happen to be near)
function touches(L, scene, tx, ty) {
  if (scene.at('floor', tx, ty) || beside(L, tx, ty)) return true;
  for (const [i, j] of SIDES) if (L.roof(tx + i, ty + j)) return true;
  return false;
}
// Is this roof tile held? free: to put it (through anything)
export const roofHeld = (scene, tx, ty, free = false) => held(LOOK.of(scene), tx, ty, free, NaN, NaN);
// Why a roof tile does not go here: null (it does), 'span' (there are walls to both sides, too far apart), 'start' (it would
// be held: from a wall on) or 'unheld'. The ghost asks it in every frame: the last answer is kept until something changes
const LAST = { scene: null, ver: -1, x: NaN, y: NaN, why: null };
export function roofWhy(scene, tx, ty) {
  if (scene.touches !== undefined && LAST.scene === scene && LAST.ver === scene.touches && LAST.x === tx && LAST.y === ty) return LAST.why;
  const L = LOOK.of(scene);
  let why = 'unheld';
  if (held(L, tx, ty, true, NaN, NaN) || mends(L, scene, tx, ty)) why = touches(L, scene, tx, ty) ? null : 'start';
  else for (let k = 0; k < 2; k++) if (between(L, tx, ty, k ? 0 : 1, k ? 1 : 0, SPAN * 2, true, NaN, NaN) > SPAN) why = 'span';
  LAST.scene = scene; LAST.ver = scene.touches; LAST.x = tx; LAST.y = ty; LAST.why = why;
  return why;
}
// Would taking the support in (tx, ty) away leave without support a roof tile that has it now? Only the tiles it can hold
// are looked at: the 8 around it and its row and column. (The hearth is furniture: it is always free to go. And a roof of
// before asks for nothing)
export function holdsRoof(scene, tx, ty) {
  const L = LOOK.of(scene);
  if (!L.support(tx, ty) || L.kind(tx, ty) === 'hearth') return false;
  let found = null;
  const drops = (x, y) => { if (!L.roof(x, y) || held(L, x, y, false, tx, ty) || !held(L, x, y, false, NaN, NaN)) return false; found = [x, y]; return true; };
  const any = () => {
    for (const [i, j] of RING) if (drops(tx + i, ty + j)) return true;
    for (const [dx, dy] of SIDES) for (let i = 2; i <= SPAN; i++) if (drops(tx + dx * i, ty + dy * i)) return true;
    return false;
  };
  return any() && !oldRoof(L, found[0], found[1]);
}

// ---------- frames ----------
// A door, a window or a wall with a picture needs something to hang from: one of these in one of its 4 neighbours; a gate,
// a fence, a wall, a post or a gate. The rest (plain walls, fences, posts) needs nothing
const FRAME = new Set(['wall', 'door', 'post', 'hearth']), GATE_FRAME = new Set(['fence', 'gate', 'wall', 'post']);
const isOpening = id => id === 'ventana' || id === 'ventana_contraventanas' || id === 'muro_cuadro';
// null, 'door', 'window' or 'gate': what kind of frame this piece asks for
export const frameKind = id => { const k = PIECES[id]?.kind; return k === 'door' || k === 'gate' ? k : isOpening(id) ? 'window' : null; };
export function frameOk(scene, tx, ty, id) {
  const k = frameKind(id);
  if (!k) return true;
  const set = k === 'gate' ? GATE_FRAME : FRAME;
  for (const [i, j] of SIDES) if (set.has(scene.pieceAt(tx + i, ty + j)?.kind)) return true;
  return false;
}
// Can one go in the place of the other in one go? Walls, windows and doors among themselves (and posts), and fences with gates
const family = id => { const k = PIECES[id]?.kind; return k === 'wall' || k === 'door' || k === 'post' ? 1 : k === 'fence' || k === 'gate' ? 2 : 0; };
export const swappable = id => family(id) > 0;
export const swaps = (from, to) => from !== to && family(from) > 0 && family(from) === family(to);

// ---------- rooms ----------
// The room of a tile, filled through its 4 neighbours: walls, windows and shut doors close it; an open door leads to what is
// on its other side (a room more of the same house, or the open air: then it is draughty). Reaching a tile with no roof
// by other than an open door, it is a porch. From ROOM_MAX tiles on, a hall.
// What names it (bed, kitchen, bath, living) is what is inside up to its doors, open or not.
export const ROOM_MAX = 400;
const BEDS = new Set(['cama', 'cama_doble', 'cama_nino', 'cuna']), KITCHEN = new Set(['cocina', 'encimera', 'fregadero']), BATH = new Set(['banera', 'lavabo', 'inodoro']);
const LIVING = new Set(['sofa', 'sillon', 'mesa', 'mesa_baja', 'mesa_grande', 'silla', 'chimenea']);
// The tile whose room one is in at (x, y): in a wall's or an open door's tile, the one on that side of it
function roomTile(L, x, y, out) {
  const tx = Math.floor(x), ty = Math.floor(y), kind = L.kind(tx, ty);
  out[0] = tx; out[1] = ty;
  if (kind !== 'wall' && kind !== 'door') return out;
  const solid = (a, b) => { const k = L.kind(a, b); return k === 'wall' || k === 'door' || (kind === 'door' && k !== undefined && k !== 'fence' && k !== 'gate'); };
  let alongX = solid(tx - 1, ty) || solid(tx + 1, ty), alongY = solid(tx, ty - 1) || solid(tx, ty + 1);
  if (!alongX && !alongY) alongX = true;
  if (kind === 'door' && alongX) alongY = false;   // (a door goes one way: scenes.js)
  if (alongX) out[1] = y - ty >= 0.5 ? ty + 1 : ty - 1;
  if (alongY) out[0] = x - tx >= 0.5 ? tx + 1 : tx - 1;
  return out;
}
const START = [0, 0];
const airy = (scene, x, y) => { const v = scene.ownAt('placed', x, y); return !!(v && ruleOf(parsePlaced(v)[0])?.air); };
// out (reused): { kind: 'room' | 'draughty' | 'porch' | 'hall' | null, size, hearth, bed, kitchen, bath, living, tiles: the
// keys of the tiles of the room itself (up to its doors), worn: the worn walls, windows and doors round it, leaky: it has a
// worn roof tile (wear.js) }
export function roomAt(scene, x, y, out = {}) {
  const tiles = (out.tiles ||= new Set());
  tiles.clear();
  out.kind = out.base = null; out.worn = 0; out.leaky = false; out.size = 0; out.hearth = out.bed = out.kitchen = out.bath = out.living = false;
  const L = LOOK.of(scene), [sx, sy] = roomTile(L, x, y, START);
  if (!L.roof(Math.floor(x), Math.floor(y))) return out;
  if (!L.roof(sx, sy)) { out.kind = 'porch'; return out; }
  const todo = [sx, sy], doors = [];
  let open = false;   // (the air gets in: no wall there)
  tiles.add(keyOf(sx, sy));
  const barrier = new Set(), wears = !!scene.wear;   // (its walls, each once)
  const look = (tx, ty, own) => {
    if (own && wears && !out.leaky && scene.wear.leaksAt(tx, ty)) out.leaky = true;
    const id = L.id(tx, ty);
    if (!id) return;
    if (id === 'chimenea' && !scene.lightOff?.(tx, ty)) out.hearth = true;
    if (!own) return;
    if (BEDS.has(id)) out.bed = true;
    else if (KITCHEN.has(id)) out.kitchen = true;
    else if (BATH.has(id)) out.bath = true;
    if (LIVING.has(id)) out.living = true;
  };
  // The tiles of todo and what they reach, into seen. own: the room itself (an open door waits in doors)
  const fill = (seen, own) => {
    let i = 0;
    for (; i < todo.length && seen.size <= ROOM_MAX; i += 2) {
      const tx = todo[i], ty = todo[i + 1];
      look(tx, ty, own);
      for (const [a, b] of SIDES) {
        const nx = tx + a, ny = ty + b, k = keyOf(nx, ny);
        if (seen.has(k)) continue;
        const kind = L.kind(nx, ny);
        if (own && wears && (kind === 'wall' || kind === 'door') && !barrier.has(k)) { barrier.add(k); if (scene.wearAt('placed', nx, ny) === 2 && airy(scene, nx, ny)) out.worn++; }
        if (kind === 'wall') continue;
        if (kind === 'door') { if (!scene.doorClosed(nx, ny)) doors.push(nx, ny); continue; }
        if (!L.roof(nx, ny)) { open = true; continue; }
        seen.add(k); todo.push(nx, ny);
      }
    }
    const full = i < todo.length;
    todo.length = 0;
    return full;
  };
  const huge = fill(tiles, true);
  out.size = tiles.size;
  if (open) { out.kind = 'porch'; return out; }
  if (huge) { out.kind = 'hall'; return out; }
  // Through the open doors: other rooms (their size and their hearth count, the warmth goes round) or the open air
  let draughty = false;
  if (doors.length) {
    const seen = new Set(tiles);
    for (let i = 0; i < doors.length && !draughty; i += 2) {
      const dx = doors[i], dy = doors[i + 1], k = keyOf(dx, dy);
      if (seen.has(k)) continue;
      seen.add(k); todo.push(dx, dy);
      fill(seen, false);
      draughty = open;
      if (seen.size > ROOM_MAX) break;
    }
    out.size = seen.size;
  }
  out.kind = out.base = draughty ? 'draughty' : 'room';
  return out;
}

// ---------- what a light inside reaches ----------
// A lamp, a candle, a candelabro or a hearth in a closed room lights the room and what its open doors and windows let out, never
// the other side of a wall, the next room or the open air: three/engine.js clips each of its six near lights to these boxes.
// lightRoom gives them for a light at (x, y): the room itself, up to the inner faces of its walls (in a few rectangles), from
// its floor to under its roof, and a short spill out of each open door or window, the nearest first, that fades at its edges.
// null: not in a closed room (the open air, a porch, a hall): it lights all round, as always.
// Each box: [x0, y0, x1, y1 (the world's x and y), h0, h1 (height), soft (m it fades over past its edge; 0, a hard edge)]
export const LIGHT_BOXES = 6;
const LIGHT_RECTS = 3;           // (rectangles of the room; the rest of an odd shape goes in the last one's bounds)
const INNER = 0.5 - 0.12 + 0.05; // (from a room tile's edge into its wall's tile: past the wall's inner face, short of its outer one)
const SPILL = 3.5, SPILL_SOFT = 1.2, DOOR_TOP = 2.3, WALL_TOP = 2.8;   // (WALL_TOP: three/build3d.js WALL_H)
const lightTmp = {};
// (a window in a corner or a T is a wall: no gap there; world/scenes.js addBuilt)
const joins = (L, x, y) => { const k = L.kind(x, y); return k === 'wall' || k === 'door'; };
const straight = (L, x, y) => !((joins(L, x + 1, y) || joins(L, x - 1, y)) && (joins(L, x, y + 1) || joins(L, x, y - 1)));
export function lightRoom(scene, x, y) {
  const r = roomAt(scene, x, y, lightTmp);
  if (r.kind !== 'room' && r.kind !== 'draughty') return null;
  const L = LOOK, tiles = [];
  let lo = Infinity, hi = -Infinity, ax0 = Infinity, ay0 = Infinity, ax1 = -Infinity, ay1 = -Infinity;
  for (const k of r.tiles) {
    const tx = k % 8388608 - 4194304, ty = Math.round((k - (k % 8388608)) / 8388608) - 4194304;
    tiles.push([tx, ty]);
    const h = scene.levelAt?.(tx + 0.5, ty + 0.5, true) ?? 0;
    lo = Math.min(lo, h); hi = Math.max(hi, h);
    ax0 = Math.min(ax0, tx); ay0 = Math.min(ay0, ty); ax1 = Math.max(ax1, tx + 1); ay1 = Math.max(ay1, ty + 1);
  }
  // (under the roof: up its pitch, as far as a roof over a room that wide rises)
  const h0 = lo - 0.3, h1 = hi + WALL_TOP + Math.min(3.5, 0.35 * Math.min(ax1 - ax0, ay1 - ay0)) + 0.3, out = [];
  // Rectangles: from the first tile left, as far along x as the room goes, then down while the whole row is in it
  const left = new Set(r.tiles);
  tiles.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [tx, ty] of tiles) {
    if (!left.has(keyOf(tx, ty))) continue;
    let x1 = tx;
    while (left.has(keyOf(x1 + 1, ty))) x1++;
    let y1 = ty;
    for (let ok = true; ok;) { for (let i = tx; i <= x1 && ok; i++) ok = left.has(keyOf(i, y1 + 1)); if (ok) y1++; }
    for (let j = ty; j <= y1; j++) for (let i = tx; i <= x1; i++) left.delete(keyOf(i, j));
    const b = [tx - INNER, ty - INNER, x1 + 1 + INNER, y1 + 1 + INNER, h0, h1, 0];
    if (out.length < LIGHT_RECTS) out.push(b);
    else { const m = out[LIGHT_RECTS - 1]; m[0] = Math.min(m[0], b[0]); m[1] = Math.min(m[1], b[1]); m[2] = Math.max(m[2], b[2]); m[3] = Math.max(m[3], b[3]); }
  }
  // Its open doors and windows (a window with its shutters or its casements shut lets nothing out), the nearest first
  const gaps = [], seen = new Set();
  for (const [tx, ty] of tiles) for (const [a, b] of SIDES) {
    const nx = tx + a, ny = ty + b, k = keyOf(nx, ny);
    if (seen.has(k) || r.tiles.has(k)) continue;
    seen.add(k);
    const kind = L.kind(nx, ny), id = kind === 'wall' && L.id(nx, ny);
    if (kind !== 'door' && !(id && id.startsWith('ventana') && straight(L, nx, ny))) continue;
    if (scene.doorClosed(nx, ny)) continue;
    gaps.push([Math.hypot(nx + 0.5 - x, ny + 0.5 - y), nx, ny, a, b, kind === 'door']);
  }
  gaps.sort((p, q) => p[0] - q[0]);
  for (const [, nx, ny, a, b, door] of gaps) {
    if (out.length >= LIGHT_BOXES) break;
    const c = (a ? nx : ny) + 0.5, from = a > 0 || b > 0 ? c - 0.2 : c - SPILL, to = a > 0 || b > 0 ? c + SPILL : c + 0.2;
    const top = door ? lo + DOOR_TOP : h1;
    out.push(a ? [from, ny - 0.3, to, ny + 1.3, h0, top, SPILL_SOFT] : [nx - 0.3, from, nx + 1.3, to, h0, top, SPILL_SOFT]);
  }
  return out;
}
// What changes around a tile (the versions of its 3 × 3 chunks, the doors and the fires with them): when to work out again
export const areaVersion = (scene, tx, ty) => RoomWatch.prototype.version(scene, tx, ty);

// The room of the player, kept (game.room): worked out again when he steps out of its tiles or something around changes (the
// versions of the 3 × 3 chunks, the doors and the fires with them), looked at every EVERY ms
const EVERY = 250;
export class RoomWatch {
  constructor() { this.room = { kind: null }; this.scene = null; this.at = -1e9; this.ver = -1; this.tx = this.ty = NaN; }
  version(scene, tx, ty) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    let v = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) v += (scene.delta(cx + i, cy + j)?.v || 0) + 1;
    return (v + (scene.wear?.dayV || 0)) * 10000 + ((cx % 100) + 100) % 100 * 100 + ((cy % 100) + 100) % 100;
  }
  // raining: it rains outside (a worn roof leaks, and lets the air in)
  get(scene, x, y, now, raining = false) {
    const r = this.look(scene, x, y, now);
    if (r.base === 'room') r.kind = r.worn >= AIR_WALLS || (r.leaky && raining) ? 'draughty' : 'room';
    return r;
  }
  look(scene, x, y, now) {
    const tx = Math.floor(x), ty = Math.floor(y), moved = tx !== this.tx || ty !== this.ty || scene !== this.scene;
    if (!moved && now - this.at < EVERY) return this.room;
    if (moved && scene === this.scene && now - this.at < EVERY) { const [a, b] = roomTile(LOOK.of(scene), x, y, START); if (this.room.kind && this.room.tiles.has(keyOf(a, b))) { this.tx = tx; this.ty = ty; return this.room; } }
    const ver = this.version(scene, tx, ty);
    if (scene === this.scene && ver === this.ver && this.room.kind) {
      const [a, b] = roomTile(LOOK.of(scene), x, y, START);
      if (this.room.tiles.has(keyOf(a, b))) { this.tx = tx; this.ty = ty; this.at = now; return this.room; }
    }
    this.scene = scene; this.ver = ver; this.tx = tx; this.ty = ty; this.at = now;
    return roomAt(scene, x, y, this.room);
  }
}
