// Natural caves and mines (plan R7-5, docs/planes/realismo/PLAN-R7-mundo.md §3.8): the grid scenes a cave mouth or a mine adit
// leads to. Each is made from the world's seed and its site alone, so it is the same in every game and made again each time it is
// entered; what changes in it (veins mined, chests opened, a rope tied, the tiles seen) goes in its state, u:k… for caves and
// u:m… for mines, which is never sent to anybody: each player has their own, as before. The caves of before (u:c…) are left as
// they were; ?cuevas=1 still builds them (caveScene).
//
// A natural cave is a passage that winds into the hill from its mouth, with chambers on the way, side passages, sometimes a pool
// to wade or swim, a shaft of daylight, a pit you go down on a rope or a steep slope; 1 to 3 levels, and the deepest ends in
// something to see (a lake, crystals, a bat roost, a den with bones). A mine is straight galleries with timber props, rails of
// planks and veins along the walls, and a ladder shaft at the far end of every level, down without end.
//
// What a scene of these has besides a GridScene's (underground.js):
//   ceil        Uint8Array: the height of the vault over each tile, in tenths of a metre (null: 2.5 m everywhere)
//   pool        Uint8Array: the depth of the water on each tile, in tenths (null: no water). waterDepth(x, y) and water(x, y)
//               then answer as the world's do (entities.js swims and wades with them)
//   ramps       [{ x, y, dx, dy, len, sign }]: a steep slope from (x, y) along (dx, dy), going down (sign -1) or up (+1); floorY
//   shaft       { x, y } (the corner the 2 × 2 daylight shaft is round) or null;  end: { kind, x, y, r } on the deepest level
//   chambers    [{ x, y, r }] (the Exploring perk shows the one you are in);  next(level): the scene of another level
import { ihash, clamp } from '../util.js';
import { B } from './biomes.js';
import { GridScene, ORES, makeCave } from './underground.js';
import { apagada } from '../opciones.js';
import { t } from '../i18n.js';

export const OLD_CAVES = apagada('cuevas');   // (?cuevas=1: the caves of before, a blob with ladders down for ever, for cave and mine)
export const CAVE_ENDS = ['lake', 'crystals', 'roost', 'bones'];
export const RAMP_STEP = 0.5;   // m down (or up) per tile of a slope
const RAMP_LEN = 3, RAMP_GO = RAMP_LEN - 0.45;   // (tiles; how far along it before it takes you to the next level)

// A stream of numbers for one level of one place
const stream = seed => { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let q = s; q = Math.imul(q ^ (q >>> 15), q | 1); q ^= q + Math.imul(q ^ (q >>> 7), q | 61); return ((q ^ (q >>> 14)) >>> 0) / 4294967296; }; };
const mix = (seed, id, level, salt) => (Math.imul(seed | 0, 31) ^ Math.imul(id | 0, 2654435761) ^ Math.imul(level | 0, 40503) ^ Math.imul(salt, 69069)) >>> 0;

// How many levels a natural cave has (60 % one, 30 % two, 10 % three; in rocky land a little deeper), and what its end is
export function caveLevels(seed, site) {
  const r = ihash(site.id | 0, 11, seed);
  let n = r < 0.6 ? 1 : r < 0.9 ? 2 : 3;
  if (n < 3 && site.biome === B.ROCKY && ihash(site.id | 0, 12, seed) < 0.12) n++;
  return n;
}
export const caveEnd = (seed, site) => CAVE_ENDS[Math.floor(ihash(site.id | 0, 13, seed) * CAVE_ENDS.length)];
// How a level that is not the last goes down: a pit for a rope (70 %) or a steep slope (30 %)
export const downOf = (seed, site, level) => (ihash(site.id | 0, 20 + level, seed) < 0.3 ? 'slope' : 'pit');

// The scene a place leads to at a level: a natural cave, a mine, or (with ?cuevas=1) the old blob of before for both
export function caveScene(game, site, level) {
  if (OLD_CAVES) return makeCave(game, site.id, level, !!site.snow);
  return site.kind === 'mina' ? makeMine(game, site, level) : makeCave2(game, site, level);
}

// ---------- shared pieces ----------
// (its name, for the place shown on screen; a site the names cannot place has none)
const titleOf = (game, site) => { try { return game.places?.title?.(site) || ''; } catch { return ''; } };
function grid0(W, H) {
  const grid = new Uint8Array(W * H).fill(1), inside = (x, y) => x >= 1 && y >= 1 && x <= W - 2 && y <= H - 2;
  const carve = (cx, cy, r) => {
    const r2 = r * r + 0.25;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if (inside(x, y) && (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2) grid[y * W + x] = 0;
  };
  return { grid, inside, carve };
}
// Only the floor reached from (sx, sy) stays floor
function keepFrom(grid, W, H, sx, sy) {
  const seen = new Uint8Array(W * H), todo = [sy * W + sx];
  if (grid[todo[0]]) return;
  seen[todo[0]] = 1;
  while (todo.length) { const j = todo.pop(); for (const k of [j + 1, j - 1, j + W, j - W]) if (k >= 0 && k < W * H && !grid[k] && !seen[k]) { seen[k] = 1; todo.push(k); } }
  for (let i = 0; i < W * H; i++) if (!grid[i] && !seen[i]) grid[i] = 1;
}
// Tiles from the nearest wall (4 ways): 1 next to one
function wallDist(grid, W, H) {
  const d = new Uint8Array(W * H), q = [];
  for (let i = 0; i < W * H; i++) if (grid[i]) q.push(i); else d[i] = 255;
  for (let h = 0; h < q.length; h++) { const j = q[h], x = j % W, v = d[j] + 1; for (const k of [x + 1 < W ? j + 1 : -1, x > 0 ? j - 1 : -1, j + W < W * H ? j + W : -1, j - W]) if (k >= 0 && d[k] > v) { d[k] = v; q.push(k); } }
  return d;
}
const nextToWall = (sc, tx, ty) => sc.wall(tx + 1, ty) || sc.wall(tx - 1, ty) || sc.wall(tx, ty + 1) || sc.wall(tx, ty - 1);
const pickOre = (level, q) => {
  const ok = ORES.filter(([, d]) => level >= d), tot = ok.reduce((s, o) => s + o[2], 0);
  let v = q * tot;
  for (const [k, , w] of ok) { if (v < w) return k; v -= w; }
  return ok[0][0];
};
// What a scene of these answers besides a GridScene's (see the top)
function dress(sc, { pool, ramps }) {
  sc.ramps = ramps || [];
  if (pool && pool.some(v => v > 0)) {
    sc.pool = pool;
    sc.waterDepth = (x, y) => { const tx = Math.floor(x), ty = Math.floor(y); return tx < 0 || ty < 0 || tx >= sc.w || ty >= sc.h ? 0 : pool[ty * sc.w + tx] / 10; };
    sc.water = (x, y) => { const d = sc.waterDepth(x, y); return d > 0 ? (d >= 1 ? 'deep' : 'shallow') : null; };
  }
  if (sc.ramps.length) sc.floorY = (x, y) => { for (const R of sc.ramps) { const s = rampAt(R, x, y); if (s !== null) return R.sign * s * RAMP_STEP; } return 0; };
  return sc;
}
// How far along a slope (x, y) is (0 at its top, len at its bottom), or null off it
export function rampAt(R, x, y) {
  const ox = x - R.x, oy = y - R.y, s = ox * R.dx + oy * R.dy, side = Math.abs(ox * R.dy - oy * R.dx);
  return s < -0.05 || s > R.len + 0.6 || side > 1.6 ? null : clamp(s, 0, R.len);
}
// Has (x, y) gone far enough down (or up) a slope to be taken to the next level? The slope, or null
export const rampGoes = (sc, x, y) => (sc.ramps || []).find(R => { const s = rampAt(R, x, y); return s !== null && s >= RAMP_GO; }) || null;

// ---------- natural caves ----------
export function makeCave2(game, site, level) {
  const seed = game.world.seed, levels = caveLevels(seed, site), L = clamp(level | 0, 1, levels), last = L >= levels;
  const R = stream(mix(seed, site.id, L, 1)), endKind = caveEnd(seed, site);
  const W = L === 1 ? 40 + Math.floor(R() * 21) : 36 + Math.floor(R() * 17), H = L === 1 ? 28 + Math.floor(R() * 13) : 26 + Math.floor(R() * 11);
  const { grid, inside, carve } = grid0(W, H), at = (x, y) => y * W + x;
  // Where it starts: the mouth on the south edge (level 1) or where the rope or the slope of the level above comes down
  const sx = Math.floor(W * (0.3 + R() * 0.4)), came = L > 1 ? downOf(seed, site, L - 1) : null, sy = L === 1 ? H - 3 : H - 6;
  if (L === 1) for (let x = sx - 1; x <= sx + 1; x++) for (let y = H - 4; y <= H - 2; y++) grid[at(x, y)] = 0;
  if (came === 'slope') for (let y = H - 6; y <= H - 2; y++) carve(sx + 0.5, y + 0.5, 1.3);
  if (came === 'pit') carve(sx + 0.5, sy + 0.5, 1.6);
  // The passage: a walk with momentum, away from where it started (toward the far side), turning back from the edges
  let rad = 1.2;
  const width = () => (rad = clamp(rad + (R() - 0.5) * 0.45, 0.9, 1.9));
  const goal = [clamp(W - sx + (R() - 0.5) * W * 0.3, 6, W - 7), 5 + R() * 4];
  const walk = (x, y, a, n, rw, pull) => {
    const out = [];
    let turn = 0;
    for (let i = 0; i < n; i++) {
      out.push([x, y, a]);
      carve(x, y, rw());
      turn = turn * 0.72 + (R() - 0.5) * 0.6;
      a += turn;
      if (pull) { let d = Math.atan2(pull[1] - y, pull[0] - x) - a; d = Math.atan2(Math.sin(d), Math.cos(d)); a += d * 0.09; }
      const m = 5, nx = x + Math.cos(a), ny = y + Math.sin(a);
      if (nx < m || nx > W - 1 - m || ny < m || ny > H - 1 - m) { let d = Math.atan2(H / 2 - y, W / 2 - x) - a; d = Math.atan2(Math.sin(d), Math.cos(d)); a += d * 0.5; }
      x = clamp(x + Math.cos(a), 2.5, W - 2.5); y = clamp(y + Math.sin(a), 2.5, H - 2.5);
    }
    return out;
  };
  const n = L === 1 ? 30 + Math.floor(R() * 41) : 25 + Math.floor(R() * 31);
  const path = walk(sx + 0.5, sy + 0.5, -Math.PI / 2, n, width, goal);
  // Chambers on the way (2 to 5), round with a rough edge
  const chambers = [];
  const room = (cx, cy, r0) => {
    const r = Math.min(r0, cx - 2, W - 2 - cx, cy - 2, H - 2 - cy);
    if (r < 2.2) return null;
    const ph = R() * 6.3, k = 0.12 + R() * 0.1;
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, a = Math.atan2(dy, dx), rr = r * (1 + k * Math.sin(3 * a + ph) + 0.08 * Math.sin(5 * a - ph));
      if (inside(x, y) && dx * dx + dy * dy <= rr * rr) grid[at(x, y)] = 0;
    }
    const c = { x: cx, y: cy, r };
    chambers.push(c);
    return c;
  };
  const nRooms = 2 + Math.floor(R() * 4);
  for (let i = 0; i < nRooms; i++) { const [x, y] = path[Math.floor(n * (0.18 + (i + R() * 0.6) * 0.72 / nRooms))]; room(x, y, 3 + R() * 4); }
  // Side passages (1 to 3): blind, or ending in a small chamber
  const sideEnds = [];
  for (let i = 0, k = 1 + Math.floor(R() * 3); i < k; i++) {
    const [x, y, a] = path[Math.floor(n * (0.15 + R() * 0.65))], side = walk(x, y, a + (R() < 0.5 ? -1 : 1) * (Math.PI / 2 + (R() - 0.5) * 0.8), 8 + Math.floor(R() * 11), () => 0.9 + R() * 0.3, null);
    const [ex, ey] = side[side.length - 1];
    sideEnds.push([Math.floor(ex), Math.floor(ey)]);
    if (R() < 0.5) room(ex, ey, 2 + R());
  }
  // The end: a chamber of its own on the deepest level (bigger for the lake)
  const [ex, ey] = path[n - 1], endRoom = last ? room(ex, ey, endKind === 'lake' ? 6 + R() * 1.5 : 4.5 + R() * 2) : null;
  // Rough walls: a little noise on the edges and two passes of the cellular smoothing of before; then the passage and the chambers'
  // middles are carved again, so it stays one cave from the mouth to the end
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = at(x, y), edge = grid[i + 1] !== grid[i] || grid[i - 1] !== grid[i] || grid[i + W] !== grid[i] || grid[i - W] !== grid[i];
    if (edge && ihash(x, y, seed + L * 7 + 3) < (grid[i] ? 0.32 : 0.1)) grid[i] ^= 1;
  }
  for (let it = 0; it < 2; it++) {
    const next = grid.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += grid[at(x + dx, y + dy)];
      next[at(x, y)] = c >= 5 ? 1 : 0;
    }
    grid.set(next);
  }
  for (const [x, y] of path) carve(x, y, 0.95);
  for (const c of chambers) carve(c.x, c.y, c.r * 0.55);
  if (L === 1) for (let x = sx - 1; x <= sx + 1; x++) for (let y = H - 4; y <= H - 2; y++) grid[at(x, y)] = 0;   // (the mouth, three wide to the open air)
  if (came === 'slope') for (let y = H - 6; y <= H - 2; y++) carve(sx + 0.5, y + 0.5, 1.2);
  keepFrom(grid, W, H, sx, sy);

  const id = `k${site.id}_${L}`;
  const sc = new GridScene(game, { id, w: W, h: H, grid, style: site.snow ? 'ice' : 'cave', name: '' });
  Object.assign(sc, { depth: L, caveId: site.id, site, levels, chambers, natural: true, next: lv => makeCave2(game, site, lv) });
  sc.name = t('cave.level', { title: titleOf(game, site) || t('place.kind.cueva'), n: L });
  const taken = new Set(), take = (tx, ty, r = 0) => { for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) taken.add(at(x, y)); };
  const ramps = [];
  // Up: the mouth (level 1), a rope hanging from the pit above, or the slope you came down
  if (L === 1) {
    sc.items.push({ mouth: true, x: sx + 0.5, y: H - 1.6, tile: [sx, H - 2] });
    sc.entry = { x: sx + 0.5, y: H - 3.6 };
    take(sx, H - 2, 2);
  } else if (came === 'pit') {
    sc.items.push({ rope: 'up', x: sx + 0.5, y: sy + 0.5, tile: [sx, sy], solid: true, r: 0.22 });
    sc.entry = { x: sx + 0.5, y: sy - 0.7 };
    take(sx, sy, 2);
  } else {
    ramps.push({ x: sx + 0.5, y: H - 5.5, dx: 0, dy: 1, len: RAMP_LEN, sign: 1, up: true });
    sc.entry = { x: sx + 0.5, y: H - 7.2 };
    take(sx, H - 4, 3);
  }
  // Down: at the passage's end, a pit or a slope (the level below begins where this one ends)
  const tx = clamp(Math.floor(ex), 2, W - 3), ty = clamp(Math.floor(ey), 2, H - 3);
  if (!last) {
    const [bx, by] = path[Math.max(0, n - 4)];
    let dx = ex - bx, dy = ey - by;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const fits = [1, 2, 3, 4].every(s => inside(Math.floor(ex + dx * s), Math.floor(ey + dy * s)) && Math.floor(ex + dx * s) > 1 && Math.floor(ey + dy * s) > 1 && Math.floor(ex + dx * s) < W - 2 && Math.floor(ey + dy * s) < H - 2);
    if (downOf(seed, site, L) === 'slope' && fits) {
      for (let s = 0; s <= RAMP_LEN + 0.5; s += 0.5) carve(ex + dx * s, ey + dy * s, 1.25);
      ramps.push({ x: ex, y: ey, dx, dy, len: RAMP_LEN, sign: -1 });
      sc.fromBelow = { x: ex - dx * 1.8, y: ey - dy * 1.8 };
      take(tx, ty, 2);
    } else {
      carve(tx + 0.5, ty + 0.5, 1.6);
      sc.items.push({ pit: true, x: tx + 0.5, y: ty + 0.5, tile: [tx, ty], solid: true, r: 0.62 });
      // (you come up out of it at its edge, the rope at hand: hold X to take it back)
      sc.fromBelow = { x: tx + 0.5 - dx * 1.05, y: ty + 0.5 - dy * 1.05 };
      take(tx, ty, 2);
    }
  }
  // (what carving the slope or the pit opened is still one cave)
  keepFrom(grid, W, H, sx, sy);
  // The vault: low in the passages, high in the middle of a chamber
  const dist = wallDist(grid, W, H), ceil = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) ceil[i] = grid[i] ? 25 : Math.round(10 * (2.5 + clamp((dist[i] - 2) * 0.75, 0, 3.4) + ihash(i % W, (i / W) | 0, seed + 17) * 0.3));
  // (up a slope the floor rises: the vault with it, so there is room overhead to the end)
  for (const Rm of ramps) if (Rm.sign > 0) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = rampAt(Rm, x + 0.5, y + 0.5); if (s !== null) ceil[at(x, y)] = Math.min(250, ceil[at(x, y)] + Math.round(s * RAMP_STEP * 10) + 4); }
  sc.ceil = ceil;
  // Water: a pool across the passage (40 %; wading to the knees or swimming in the middle) and the lake of the end
  const pool = new Uint8Array(W * H), wet = [];
  const flood = (cx, cy, r, max) => {
    const set = [];
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 1 || y < 1 || x > W - 2 || y > H - 2 || grid[at(x, y)] || taken.has(at(x, y)) || (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
      set.push(at(x, y));
    }
    if (!set.length) return;
    const inSet = new Set(set), de = new Map(), q = [];
    for (const i of set) if ([i + 1, i - 1, i + W, i - W].some(k => !grid[k] && !inSet.has(k))) { de.set(i, 1); q.push(i); }
    for (let h = 0; h < q.length; h++) { const j = q[h], v = de.get(j) + 1; for (const k of [j + 1, j - 1, j + W, j - W]) if (inSet.has(k) && !de.has(k)) { de.set(k, v); q.push(k); } }
    for (const i of set) { pool[i] = Math.round(10 * Math.min(max, 0.2 + ((de.get(i) || 1) - 1) * 0.38)); wet.push(i); }
  };
  if (endRoom && endKind === 'lake') flood(endRoom.x, endRoom.y, endRoom.r - 1.8, 2.6);
  if (R() < 0.4) {
    const [px, py] = path[Math.floor(n * (0.35 + R() * 0.35))];
    if (Math.hypot(px - sx, py - sy) > 6 && Math.hypot(px - ex, py - ey) > 6) flood(px, py, 2.2 + R() * 1.6, R() < 0.5 ? 1.4 : 0.6);
  }
  // A shaft of daylight from a hole far above (a quarter of the first levels), in a chamber with no water
  if (L === 1 && R() < 0.25) {
    for (const c of chambers) {
      const x = Math.round(c.x), y = Math.round(c.y), four = [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]];
      if (c === endRoom || four.some(([a, b]) => grid[at(a, b)] || pool[at(a, b)] || taken.has(at(a, b))) || wet.some(i => Math.hypot(i % W - x, ((i / W) | 0) - y) < 3)) continue;
      sc.shaft = { x, y };
      for (const [a, b] of four) taken.add(at(a, b));
      break;
    }
  }
  dress(sc, { pool, ramps });
  for (const i of wet) taken.add(i);
  // The end of the deepest level, and what is there
  if (endRoom) {
    sc.end = { kind: endKind, x: endRoom.x, y: endRoom.y, r: endRoom.r };
    const inRoom = [];
    for (let y = Math.floor(endRoom.y - endRoom.r - 1); y <= endRoom.y + endRoom.r + 1; y++) for (let x = Math.floor(endRoom.x - endRoom.r - 1); x <= endRoom.x + endRoom.r + 1; x++)
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && !grid[at(x, y)] && !taken.has(at(x, y)) && Math.hypot(x + 0.5 - endRoom.x, y + 0.5 - endRoom.y) < endRoom.r + 1) inRoom.push([x, y]);
    const near = inRoom.filter(([x, y]) => nextToWall(sc, x, y));
    if (endKind === 'crystals') {
      const cols = ['#9a5ae0', '#4ae8c8', '#5aa8ff'], list = near.length > 6 ? near : inRoom;
      for (let k = 0, m = 10 + Math.floor(R() * 7); k < m && list.length; k++) {
        const [x, y] = list.splice(Math.floor(R() * list.length), 1)[0];
        sc.items.push({ color: cols[Math.floor(R() * 3)], x: x + 0.5, y: y + 0.5, shine: 46, tile: [x, y], solid: true, r: 0.3 });
        taken.add(at(x, y));
      }
    } else if (endKind === 'roost') {
      sc.decor = Array.from({ length: 30 }, () => { const [x, y] = inRoom[Math.floor(R() * inRoom.length)] || [ex, ey]; return { kind: 'guano', x: x + R(), y: y + R(), s: 0.4 + R() * 0.7 }; });
      for (let k = 0; k < 5; k++) { const [x, y] = inRoom[Math.floor(R() * inRoom.length)] || [ex, ey]; (sc.spawns ||= []).push(['murcielago', x + 0.5, y + 0.5]); }
    } else if (endKind === 'bones') {
      const [x, y] = near[Math.floor(R() * near.length)] || [Math.floor(ex), Math.floor(ey)];
      sc.decor = [{ kind: 'den', x: x + 0.5, y: y + 0.5, s: 1, yaw: R() * 6.3 }, ...Array.from({ length: 6 }, () => { const [a, b] = inRoom[Math.floor(R() * inRoom.length)] || [x, y]; return { kind: 'bone', x: a + R(), y: b + R(), s: 0.8 + R() * 0.5, yaw: R() * 6.3 }; })];
    }
    // (sometimes the reward of having come so far)
    if (R() < 0.6) { const free = inRoom.filter(([x, y]) => !taken.has(at(x, y))), q = free[Math.floor(R() * free.length)]; if (q) { sc.items.push({ chest: true, x: q[0] + 0.5, y: q[1] + 0.5, key: 'cofre', tile: q, solid: true, r: 0.35, loot: L + 1 }); taken.add(at(...q)); } }
  } else if (sideEnds.length && R() < 0.3) {
    const q = sideEnds.find(([x, y]) => !grid[at(x, y)] && !taken.has(at(x, y)));
    if (q) { sc.items.push({ chest: true, x: q[0] + 0.5, y: q[1] + 0.5, key: 'cofre', tile: q, solid: true, r: 0.35, loot: L }); taken.add(at(...q)); }
  }
  // Ores, fewer than in a mine (caves are for seeing), and now and then a crystal deeper down
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (grid[at(x, y)] || taken.has(at(x, y)) || !nextToWall(sc, x, y)) continue;
    const r = ihash(x, y, seed + L * 31 + 1);
    if (r < 0.035) sc.items.push({ kind: 'veta_' + pickOre(L, ihash(x, y, seed + L * 31 + 2)), x: x + 0.5, y: y + 0.5, key: `${x},${y}`, tile: [x, y], solid: true, r: 0.35 });
    else if (L >= 2 && r > 0.996) sc.items.push({ color: '#7ae0ff', x: x + 0.5, y: y + 0.5, shine: 46, tile: [x, y], solid: true, r: 0.3 });
    else continue;
    taken.add(at(x, y));
  }
  // Bats, as before (slimes and skeletons are for mines and temples)
  const dry = sc.freeTiles().filter(([x, y]) => !pool[at(x, y)] && Math.hypot(x - sx, y - sy) > 6);
  for (let k = 0; k < L && dry.length; k++) { const [x, y] = dry[Math.floor(R() * dry.length)]; (sc.spawns ||= []).push(['murcielago', x + 0.5, y + 0.5]); }
  sc.fromBelow ||= sc.entry;
  return sc;
}

// ---------- mines ----------
export function makeMine(game, site, level) {
  const seed = game.world.seed, L = Math.max(1, level | 0), R = stream(mix(seed, site.id, L, 2));
  const W = 44 + Math.floor(R() * 17), H = 30 + Math.floor(R() * 11), { grid, inside } = grid0(W, H), at = (x, y) => y * W + x;
  const open = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inside(x, y)) grid[at(x, y)] = 0; };
  // The main drift, two tiles wide, from the way in (west) to the shaft (east), and cross-cuts off it every 8 to 12 tiles
  const ym = Math.floor(H / 2) - 2 + Math.floor(R() * 3), x0 = L === 1 ? 1 : 2, xe = W - 4;
  open(x0, ym, xe, ym + 1);
  const cuts = [], timbers = [], stopes = [];
  for (let x = 7 + Math.floor(R() * 4); x < W - 9; x += 8 + Math.floor(R() * 5)) {
    const up = R() < 0.85 ? 3 + Math.floor(R() * 10) : 0, down = R() < 0.85 ? 3 + Math.floor(R() * 10) : 0;
    const ya = Math.max(2, ym - up), yb = Math.min(H - 3, ym + 1 + down);
    open(x, ya, x + 1, yb);
    cuts.push({ x, ya, yb });
    for (const [y, end] of [[ya, up], [yb, down]]) if (end && R() < 0.4) { const sy = y < ym ? Math.max(2, y - 2) : y; open(x - 1, sy, x + 2, Math.min(H - 3, sy + 2)); stopes.push([x, y < ym ? sy : sy + 2]); }
  }
  // (sometimes a second drift, joined by the cross-cuts that reach it)
  const reach = cuts.filter(c => c.ya <= ym - 8);
  if (reach.length >= 2 && R() < 0.5) { const y2 = ym - 8, a = reach[0].x, b = reach[reach.length - 1].x + 1; open(a, y2, b, y2 + 1); for (let x = a + 2; x < b - 1; x += 4) timbers.push({ x: x + 0.5, y: y2 + 1, across: 'y' }); }
  keepFrom(grid, W, H, x0 + 2, ym);
  const id = `m${site.id}_${L}`;
  const sc = new GridScene(game, { id, w: W, h: H, grid, style: 'mine', name: '' });
  Object.assign(sc, { depth: L, caveId: site.id, site, mine: true, next: lv => makeMine(game, site, lv) });
  sc.name = t('mine.level', { title: titleOf(game, site) || t('place.kind.mina'), n: L });
  const taken = new Set(), take = (tx, ty, r = 0) => { for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) taken.add(at(x, y)); };
  // Up: the adit to the open air (level 1) or the ladder from the level above; down: the ladder shaft at the far end
  if (L === 1) { sc.items.push({ mouth: true, x: 1.4, y: ym + 1, tile: [1, ym] }); take(1, ym, 2); }
  else { sc.items.push({ x: 2.5, y: ym + 0.5, ladder: 'up', tile: [2, ym] }); take(2, ym, 2); }
  sc.entry = { x: 3.6, y: ym + 1 };
  sc.items.push({ x: xe + 0.5, y: ym + 0.5, ladder: 'down', tile: [xe, ym], shaft: true });
  sc.fromBelow = { x: xe - 1.1, y: ym + 1.3 };
  take(xe, ym, 2);
  // Timber sets every 4 tiles (two posts and a cap across the gallery), and the rails along the drift
  for (let x = 5; x < xe - 1; x += 4) timbers.push({ x: x + 0.5, y: ym + 1, across: 'y' });
  for (const c of cuts) for (let y = c.ya + 1; y < c.yb; y += 4) if (Math.abs(y - ym) > 2) timbers.push({ x: c.x + 1, y: y + 0.5, across: 'x' });
  sc.timbers = timbers;
  sc.rails = { y: ym + 1, x0: L === 1 ? 2 : 3.5, x1: xe - 0.6 };
  // Veins along the walls (more than in a natural cave: today's table, by level), mostly off the drift where the rails go
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (grid[at(x, y)] || taken.has(at(x, y)) || !nextToWall(sc, x, y)) continue;
    const drift = y === ym || y === ym + 1, r = ihash(x, y, seed + L * 977 + site.id);
    if (r < (drift ? 0.035 : 0.16)) { sc.items.push({ kind: 'veta_' + pickOre(L, ihash(x, y, seed + L * 977 + 2)), x: x + 0.5, y: y + 0.5, key: `${x},${y}`, tile: [x, y], solid: true, r: 0.35 }); taken.add(at(x, y)); }
  }
  // A chest on some levels, at the end of a cross-cut or in a stope (as often as before)
  const ends = [...stopes, ...cuts.flatMap(c => [[c.x, c.ya], [c.x + 1, c.yb]])].filter(([x, y]) => !grid[at(x, y)] && !taken.has(at(x, y)));
  if (ends.length && ihash(site.id, L, seed + 4) < 0.45) { const q = ends[Math.floor(R() * ends.length)]; sc.items.push({ chest: true, x: q[0] + 0.5, y: q[1] + 0.5, key: 'cofre', tile: q, solid: true, r: 0.35, loot: L }); taken.add(at(...q)); }
  // Creatures, as before by depth
  const free = sc.freeTiles().filter(([x]) => x > 9), types = ['limo', ...(L >= 2 ? ['murcielago'] : []), ...(L >= 4 ? ['esqueleto'] : [])];
  for (let i = 0, n = Math.min(12, 2 + L); i < n && free.length; i++) { const [x, y] = free[Math.floor(R() * free.length)]; (sc.spawns ||= []).push([types[Math.floor(R() * types.length)], x + 0.5, y + 0.5]); }
  return dress(sc, {});
}
