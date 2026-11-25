// The neighbours' way round what players build on it (routines.js gives the way; neighbors.js draws it). The walk is the same in
// every game; where a piece, a fence or furniture stands on it, the part outdoors goes round by the nearest free tiles. With
// the same things built, every game finds the same detour.
import { PIECES, parsePlaced } from '../pieces.js';
import { ITEMS } from '../items.js';
import { pondDist } from './village.js';

const MARGIN = 14, MAX_OPEN = 3000;
// What they go round: walls, fences, posts, furniture… (not doors, gates, rugs, crops or what is hung)
function solid(w, tx, ty) {
  const raw = w.at('placed', tx, ty);
  if (raw) {
    const id = parsePlaced(raw)[0], kind = PIECES[id]?.kind;
    if (kind) return kind !== 'door' && kind !== 'gate';
    const place = ITEMS[id]?.place;
    if (place !== 'flat' && place !== 'rug') return true;
  }
  const x = tx + 0.5, y = ty + 0.5;
  if (pondDist(x, y) < 1.02) return true;
  for (const c of w.village?.colliders || []) if (!c.pond && (c.r !== undefined ? Math.hypot(x - c.x, y - c.y) < c.r + 0.35 : x > c.x0 - 0.2 && x < c.x1 + 0.2 && y > c.y0 - 0.2 && y < c.y1 + 0.2)) return true;
  return false;
}
const key = (x, y) => `${x},${y}`;
// Does a straight walk cross something a player put there?
function blockedLine(w, a, b, memo) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.25));
  for (let i = 0; i <= n; i++) {
    const x = Math.floor(a[0] + (b[0] - a[0]) * i / n), y = Math.floor(a[1] + (b[1] - a[1]) * i / n);
    if (isSolid(w, x, y, memo)) return true;
  }
  return false;
}
function isSolid(w, x, y, memo) { const k = key(x, y); let v = memo.get(k); if (v === undefined) memo.set(k, v = solid(w, x, y)); return v; }
// The tiles between two points, round what is solid (A*, eight ways without cutting corners), or null
function search(w, a, b, memo, max = MAX_OPEN) {
  const sx = Math.floor(a[0]), sy = Math.floor(a[1]), ex = Math.floor(b[0]), ey = Math.floor(b[1]);
  const x0 = Math.min(sx, ex) - MARGIN, x1 = Math.max(sx, ex) + MARGIN, y0 = Math.min(sy, ey) - MARGIN, y1 = Math.max(sy, ey) + MARGIN;
  const open = [[0, 0, sx, sy]], g = new Map([[key(sx, sy), 0]]), prev = new Map(), closed = new Set();
  for (let n = 0; open.length && n < max; n++) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, c, x, y] = open.splice(bi, 1)[0], k = key(x, y);
    if (closed.has(k)) continue;
    closed.add(k);
    if (x === ex && y === ey) {
      const out = [[x, y]];
      for (let q = k; prev.has(q); q = key(...prev.get(q))) out.unshift(prev.get(q));
      return out;
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((!dx && !dy) || nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      const end = nx === ex && ny === ey;
      if (!end && isSolid(w, nx, ny, memo)) continue;
      if (dx && dy && (isSolid(w, x + dx, y, memo) || isSolid(w, x, y + dy, memo))) continue;
      const nc = c + (dx && dy ? Math.SQRT2 : 1), nk = key(nx, ny);
      if (g.has(nk) && g.get(nk) <= nc) continue;
      g.set(nk, nc); prev.set(nk, [x, y]);
      open.push([nc + Math.hypot(ex - nx, ey - ny), nc, nx, ny]);
    }
  }
  return null;
}
// Is there a way on foot from one point to another, straight or round what is in between? (business.js: to a player's counter)
export function canWalk(w, a, b) { const memo = new Map(); return !blockedLine(w, a, b, memo) || !!search(w, a, b, memo); }
// The way on foot between two points, round what is solid, as points (the last one b); null if there is none (law.js: Ramiro)
export function wayTo(w, a, b) {
  const memo = new Map();
  if (!blockedLine(w, a, b, memo)) return [b];
  const tiles = search(w, a, b, memo, 900);
  if (!tiles) return null;
  const line = [a, ...tiles.slice(1, -1).map(([x, y]) => [x + 0.5, y + 0.5]), b], out = [];
  for (let i = 0; i < line.length - 1;) { let j = line.length - 1; while (j > i + 1 && blockedLine(w, line[i], line[j], memo)) j--; out.push(line[j]); i = j; }
  return out;
}
// R: a road of routines.js { pts, at, len, out: [first, last] of its points outdoors, or null }. The same road, or one like it
// that goes round what is in the way
export function wayRound(w, R) {
  if (!R.out || !w?.at) return R;
  const memo = new Map(), [i0, i1] = R.out, pts = R.pts.slice(0, i0 + 1);
  let changed = false;
  for (let i = i0; i < i1; i++) {
    let j = i + 1;
    if (!blockedLine(w, R.pts[i], R.pts[j], memo)) { pts.push(R.pts[j]); continue; }
    // (to the next of its points that is free itself)
    while (j < i1 && isSolid(w, Math.floor(R.pts[j][0]), Math.floor(R.pts[j][1]), memo)) j++;
    const tiles = search(w, R.pts[i], R.pts[j], memo);
    if (tiles) {
      // (pulled straight where it can be)
      const line = [R.pts[i], ...tiles.slice(1, -1).map(([x, y]) => [x + 0.5, y + 0.5]), R.pts[j]];
      for (let a = 0; a < line.length - 1;) { let b = line.length - 1; while (b > a + 1 && blockedLine(w, line[a], line[b], memo)) b--; pts.push(line[b]); a = b; }
      changed = true;
    } else for (let q = i + 1; q <= j; q++) pts.push(R.pts[q]);   // (walled in: straight through, as before)
    i = j - 1;
  }
  if (!changed) return R;
  pts.push(...R.pts.slice(i1 + 1));
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { ...R, pts, at, len: at[at.length - 1] };
}
