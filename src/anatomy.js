// The body of a wild land animal, for the arrows (Plan R3-3, docs/planes/realismo/PLAN-R3-caza.md §3.5): the parts an arrow
// can meet (the trunk, the neck and head, the legs) and what lies inside the trunk, measured on its model (three/animals.js).
// The organs of the plan are shares of a body; here they are shares of the TRUNK (u: 0 at the breast, 1 at the rump; v: 0 at
// the belly, 1 at the back): the box of a deer (hunt.js bodyBox) goes up to its antlers, half of it is air, and its spine
// would be up there. So an arrow over the back, under the belly or between the legs flies on.
// Pure: no game, no drawing. Heights are over the ground under the animal.
import { scaleOf } from './herds.js';
import { dxOf } from './world/planet.js';

// Where an arrow hit (what travels in hita.z: an older host knows 0 to 2 and takes the rest as the body)
export const ZONE = { body: 0, vital: 1, graze: 2, liver: 3, gut: 4, leg: 5, spine: 6 };
// What an arrow that has been in one says of it when it is picked up (a.b; lang hunt.arrow.*), by zone
export const READING = ['flesh', 'lungs', 'graze', 'liver', 'gut', 'leg', 'spine'];
export const GRAZE_DMG = 2;                          // an arrow this weak only grazes
export const HEAD_ON = 0.35;                         // |cos| of the arrow with the animal's side: below, from the front or from behind
export const PASS = { [ZONE.vital]: 0.6, [ZONE.liver]: 0.75 };   // the draw (archery.js power) from which the arrow goes through
const IN = 0.06;
const ORGANS = { chest: 0.42, liver: 0.58, gut: 0.86, spine: 0.8, top: 0.97, steep: -0.5 };

// Each box: [half width, back, front, bottom, top] in the model's metres (its z+ is the front). down: the head, grazing
const BODIES = {
  ciervo: { trunk: [0.24, -0.5, 0.5, 0.7, 1.26], head: [0.14, 0.36, 0.94, 0.98, 1.7], down: [0.14, 0.4, 1, 0.1, 1.05], legs: [[0.19, 0.22, 0.44], [0.19, -0.44, -0.22]] },
  jabali: { trunk: [0.27, -0.5, 0.5, 0.2, 0.83], head: [0.17, 0.4, 0.87, 0.26, 0.72], down: [0.17, 0.4, 0.95, 0, 0.6], legs: [[0.2, 0.17, 0.37], [0.2, -0.37, -0.17]] },
};
export const hasOrgans = e => !!BODIES[e?.type];
const low = e => !!(e.lying || e.bedded);

// A point of the world (or, w = 0, a direction) in the animal's own space: [to its right, up, ahead], in the model's metres
const L = [0, 0, 0], M = [0, 0, 0];
function local(out, e, gy, x, h, y, w = 1) {
  const d = e.worldDir?.() || e.dir || [0, 1], l = Math.hypot(d[0], d[1]) || 1, fx = d[0] / l, fy = d[1] / l, k = scaleOf(e);
  const px = w ? dxOf(x, e.x) : x, py = w ? y - e.y : y;
  out[0] = (px * fy - py * fx) / k; out[1] = (w ? h - gy : h) / k; out[2] = (px * fx + py * fy) / k;
  return out;
}
// Lying, its belly is on the ground (and its legs under it)
const dropOf = (e, B) => (low(e) ? B.trunk[3] - 0.02 : 0);
let T0 = 0, T1 = 0;
function slab(o, d, hw, z0, z1, y0, y1) {
  T0 = 0; T1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const lo = i === 0 ? -hw : i === 1 ? y0 : z0, hi = i === 0 ? hw : i === 1 ? y1 : z1;
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo || o[i] > hi) return false; continue; }
    let a = (lo - o[i]) / d[i], b = (hi - o[i]) / d[i];
    if (a > b) { const q = a; a = b; b = q; }
    if (a > T0) T0 = a;
    if (b < T1) T1 = b;
    if (T0 > T1) return false;
  }
  return true;
}
// Where a ray (o [x, height, y], d of length 1) first meets its body within max: out = { t, exit (out of that part), part }
// or null
export function hitBody(e, gy, o, d, max, out = {}) {
  const B = BODIES[e.type];
  if (!B) return null;
  local(L, e, gy, o[0], o[1], o[2]); local(M, e, 0, d[0], d[1], d[2], 0);
  const dy = dropOf(e, B), H = e.grazing && !low(e) ? B.down : B.head;
  out.t = Infinity;
  const see = (part, hw, z0, z1, y0, y1) => { if (slab(L, M, hw, z0, z1, y0, y1) && T0 <= max && T0 < out.t) { out.t = T0; out.exit = T1; out.part = part; } };
  see('trunk', B.trunk[0], B.trunk[1], B.trunk[2], B.trunk[3] - dy, B.trunk[4] - dy);
  see('head', H[0], H[1], H[2], Math.max(0, H[3] - dy), H[4] - dy);
  if (!low(e)) for (const g of B.legs) see('leg', g[0], g[1], g[2], 0, B.trunk[3]);
  return out.t < Infinity ? out : null;
}
// Where to send an arrow at the part of it that the ray (the cursor's) points at: [x, height, y]; pointing just off it, the
// nearest of its trunk
const AIM = {};
export function aimPoint(e, gy, o, d, near) {
  const h = hitBody(e, gy, o, d, Infinity, AIM);
  if (h) { const t = (h.t + h.exit) / 2; return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]; }
  const B = BODIES[e.type], k = scaleOf(e), dy = dropOf(e, B), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  local(L, e, gy, o[0] + d[0] * near, o[1] + d[1] * near, o[2] + d[2] * near);
  const f = e.worldDir?.() || e.dir || [0, 1], l = Math.hypot(f[0], f[1]) || 1, z = clamp(L[2], B.trunk[1] + 0.06, B.trunk[2] - 0.06) * k, y = clamp(L[1], B.trunk[3] - dy + 0.05, B.trunk[4] - dy - 0.05) * k;
  return [e.x + f[0] / l * z, gy + y, e.y + f[1] / l * z];
}
// How an arrow in direction d comes at it: c, |cos| with the animal's side (1 broadside); ahead: it goes the way it faces
// (from behind)
export function angleOf(e, d) {
  local(M, e, 0, d[0], 0, d[2], 0);
  const l = Math.hypot(M[0], M[2]) || 1;
  return { c: Math.abs(M[0]) / l, ahead: M[2] > 0 };
}
// Which zone of it a hit point [x, height, y] is in (gy: the ground under it; dmg: the arrow's; dir: the way it flies, or
// null: broadside). Without a point (an old caller), the body
export function organOf(e, hit, gy, dmg, dir = null) {
  const B = BODIES[e?.type];
  if (!B || !Array.isArray(hit) || !hit.every(Number.isFinite)) return ZONE.body;
  if (dmg <= GRAZE_DMG) return ZONE.graze;
  local(L, e, gy, hit[0], hit[1], hit[2]);
  if (dir) { local(M, e, 0, dir[0], dir[1], dir[2], 0); for (let i = 0; i < 3; i++) L[i] += M[i] * IN; }   // (a little way in: one coming down on its back is not a graze)
  const y = L[1], z = L[2], dy = dropOf(e, B), [, z0, z1, y0, y1] = B.trunk;
  if (z > z1 + 0.01 || (z > B.head[1] && y > y1 - dy + 0.02)) return ZONE.body;   // (the neck and the head)
  if (!low(e) && y < y0 - 0.01) return ZONE.leg;
  const u = (z1 - z) / (z1 - z0), steep = dir && dir[1] < ORGANS.steep, v = steep ? 0.5 : (y - (y0 - dy)) / (y1 - y0);
  const A = dir ? angleOf(e, dir) : null, ends = !!A && A.c < HEAD_ON;
  if (v > ORGANS.top) return ZONE.graze;
  if (v > ORGANS.spine && u <= ORGANS.gut) return ZONE.spine;
  if (u > ORGANS.gut) return ends && A.ahead ? ZONE.gut : ZONE.graze;
  if (u <= ORGANS.chest) return !ends ? ZONE.vital : A.ahead ? ZONE.gut : ZONE.body;   // (from behind it goes through the paunch; from the front it stays in the brisket)
  if (u <= ORGANS.liver) return ends && A.ahead ? ZONE.gut : ZONE.liver;
  return ZONE.gut;
}
