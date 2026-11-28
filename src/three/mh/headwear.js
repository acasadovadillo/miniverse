// What a MakeHuman person wears on the head (plan CR, P6, ?creador=nuevo): the straw hat and the wool cap with its pompom
// (slot cabeza; the headscarf is a garment bound to the skin, tools/mh_garments.py), and the five hair accessories (slot
// pelo: bow, headband, flower, hair pins, flower crown). They are rigid pieces made here, by code, once per shape: each
// measured on this head (the skull above the brim, how much hair there is), so they fit any body. In the game they go
// on the head bone as the hair does (ingame.js: a part it does not know). Under a hat the hair is pressed into its crown
// (pressHair) and the short fur too (capFur), so nothing pokes through it; with a hat or a headscarf the accessories are
// not worn (they would be under it).
import { clothesFor, fullLook } from '../../looks.js';
import { joint } from './shape.js';

const M = 0.1;   // decimetres to metres

// The look's headwear: { hat, hatColour, acc, accColour, scarf }
export function headwearOf(look) {
  const W = look.wear || clothesFor(fullLook(look)), h = W.cabeza?.id, a = W.pelo?.id, metal = h?.startsWith('casco_') ? h.slice(6) : null;
  const hat = h === 'sombrero' || h === 'gorro' ? h : metal ? 'casco' : null, scarf = h === 'hijab';
  return { hat, hatColour: (metal && METAL[metal]) || W.cabeza?.color || (h === 'sombrero' ? '#e0c070' : '#c83a3a'), acc: hat || scarf ? null : ACC[a] ? a : null, accColour: W.pelo?.color || '#e86aa0', scarf };
}
const ACC = { lazo: 1, diadema: 1, flor_pelo: 1, horquillas: 1, corona_flores: 1 };
// (the armour's helmets, casco_<metal>: a metal cap of its metal's colour, its rim darker)
const METAL = { cobre: '#b87333', hierro: '#8e8e94', oro: '#d4af37' };
// The second colour of each piece: the straw hat's ribbon, the cap's pompom (its own wool), the flower's heart, the crown's
// green, the pins' beads
export const HAT_COLOUR2 = { sombrero: '#5a3a24', casco: '#4a4038' };
export const ACC_COLOUR2 = { flor_pelo: '#f0c030', corona_flores: '#4a7a34', horquillas: '#3a2a20', lazo: null, diadema: null };

// ---- The head, measured (decimetres, the body as built) ----
// A hat's frame: the brim's plane (through the forehead in front and lower behind for the cap), the skull's ellipse over
// it and its height, scaled until every skin point above the plane is inside; and how far out the hair goes at the brim
const BRIM = { sombrero: [0.62, 0.5, 0.18], gorro: [0.48, 0.02, 0.12], casco: [0.55, 0.0, 0.1] };   // (front and back over the eyes, the crown's room)
function headPoints(D, v) {
  const nb = D.head.nbody, neck = joint(D, v, 'joint-neck')[1], out = [];
  for (let i = 0; i < nb; i++) if (v[i * 3 + 1] > neck + 0.55) out.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
  return out;
}
function hairPoints(fitted) {
  const out = [];
  for (const f of fitted) if (f.kind === 'ownhair') for (let i = 0; i < f.v.length; i++) out.push(f.v[i]);
  return out;
}
export function hatFrame(D, v, fitted, kind, furDm = 0) {
  const le = joint(D, v, 'joint-l-eye'), re = joint(D, v, 'joint-r-eye'), eyeY = (le[1] + re[1]) / 2, head = headPoints(D, v);
  const [fy, by, room] = BRIM[kind];
  // (the front and the back of the head at those heights)
  let zF = -Infinity, zB = Infinity;
  for (let i = 0; i < head.length; i += 3) {
    const y = head[i + 1], z = head[i + 2];
    if (Math.abs(y - (eyeY + fy)) < 0.15 && Math.abs(head[i]) < 0.35) zF = Math.max(zF, z);
    if (Math.abs(y - (eyeY + by)) < 0.15 && Math.abs(head[i]) < 0.35) zB = Math.min(zB, z);
  }
  if (!(zF - zB > 1)) { zF = le[2]; zB = le[2] - 1.7; }   // (a head too strange to measure: its usual depth from the eyes)
  const t = Math.atan2(fy - by, zF - zB), o = [0, eyeY + (fy + by) / 2, (zF + zB) / 2];
  const F = { kind, o, s: Math.sin(t), c: Math.cos(t), eyeY };
  // (the skull over the plane, above the ears: its ellipse; then as high and wide as it takes to hold the whole skull)
  let rx = 0, zf = -Infinity, zb = Infinity, top = 0;
  for (let i = 0; i < head.length; i += 3) {
    const q = local(F, head[i], head[i + 1], head[i + 2]);
    if (q[1] > 0.12 && q[1] < 0.45) { rx = Math.max(rx, Math.abs(q[0])); zf = Math.max(zf, q[2]); zb = Math.min(zb, q[2]); }
    top = Math.max(top, q[1]);
  }
  F.cz = (zf + zb) / 2; F.rx = rx; F.rz = (zf - zb) / 2; F.ry = top;
  let k = 1;
  for (let i = 0; i < head.length; i += 3) { const q = local(F, head[i], head[i + 1], head[i + 2]); if (q[1] > 0.05) k = Math.max(k, ell(F, q, 0)); }
  F.rx *= k; F.rz *= k; F.ry *= k;
  // (much hair at the brim: the hat sits a little wider)
  const hair = hairPoints(fitted);
  let hk = 1;
  for (let i = 0; i < hair.length; i += 3) { const q = local(F, hair[i], hair[i + 1], hair[i + 2]); if (Math.abs(q[1]) < 0.15) hk = Math.max(hk, ell(F, q, 0)); }
  const mean = (F.rx + F.rz) / 2;
  F.room = room + Math.min(0.22, Math.max(0, (hk - 1) * mean) * 0.5, furDm * 0.5) + Math.min(0.1, furDm);
  return F;
}
// (into the brim's frame: x across, y up from the plane, z forward along it)
function local(F, x, y, z) {
  const dy = y - F.o[1], dz = z - F.o[2];
  return [x, dy * F.c - dz * F.s, dy * F.s + dz * F.c];
}
function world(F, q) { return [q[0], F.o[1] + q[1] * F.c + q[2] * F.s, F.o[2] - q[1] * F.s + q[2] * F.c]; }
// (how far out of the skull's ellipsoid, grown by room: 1 on it)
function ell(F, q, room) {
  const a = q[0] / (F.rx + room), b = (q[2] - F.cz) / (F.rz + room), c = Math.max(0, q[1]) / (F.ry + room);
  return Math.sqrt(a * a + b * b + c * c);
}

// The hair pressed into the hat's crown: what is above the brim and out of it comes in to its surface, softly from a
// little under the brim (long hair keeps falling from under it). In place, on any array of points (decimetres)
function pressInto(F, a, i, room) {
  const q = local(F, a[i], a[i + 1], a[i + 2]), fade = 0.3;
  if (q[1] < -fade) return;
  const e = ell(F, q, room);
  if (e <= 1) return;
  const w = Math.min(1, Math.max(0, (q[1] + fade) / (fade + 0.1))), k = 1 + (1 / e - 1) * w * w * (3 - 2 * w);
  const p = world(F, [q[0] * k, q[1] > 0 ? q[1] * k : q[1], F.cz + (q[2] - F.cz) * k]);
  a[i] = p[0]; a[i + 1] = p[1]; a[i + 2] = p[2];
}
export function pressHair(F, fitted) {
  for (const f of fitted) if (f.kind === 'ownhair') for (let i = 0; i < f.v.length; i += 3) pressInto(F, f.v, i, F.room - 0.02);
}
// The fur's copies (hair.js shellMeshes: metres, the ground at 0) pressed the same way
export const capFur = (F, ground) => (P) => {
  for (let i = 0; i < P.length; i += 3) {
    const a = [P[i] / M, P[i + 1] / M + ground, P[i + 2] / M];
    pressInto(F, a, 0, F.room - 0.04);
    P[i] = a[0] * M; P[i + 1] = (a[1] - ground) * M; P[i + 2] = a[2] * M;
  }
};

// ---- Building the pieces: rings of vertices joined in quads ----
// Each vertex: position (dm), the cloth's uv (metres), its part (0 or 1), distance to its border (mm, for the hem's
// stitches) and occlusion. Returns the arrays person.js draws ({ v, nv, idx, rmap, uv, att })
class Build {
  constructor() { this.p = []; this.uv = []; this.at = []; this.ix = []; }
  vert(p, u, w, part = 0, edge = 255, ao = 1) {
    this.p.push(p[0], p[1], p[2]); this.uv.push(u, w);
    this.at.push(Math.round(part * 255), 255, Math.max(0, Math.min(255, Math.round(edge))), Math.round(ao * 255));
    return this.p.length / 3 - 1;
  }
  // rings: arrays of vertex ids, all as long; closed: round (the last joins the first)
  strip(rings, closed = true) {
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = rings[k], B = rings[k + 1], n = A.length;
      for (let j = 0; j < (closed ? n : n - 1); j++) { const j2 = (j + 1) % n; this.ix.push(A[j], B[j], A[j2], A[j2], B[j], B[j2]); }
    }
  }
  // a closed lump round a centre (a bow's loop, a petal, a pompom): an ellipsoid in a frame (ax, ay, az unit vectors scaled
  // by its radii), bumped by bump(theta, phi) (a factor)
  blob(c, ax, ay, az, part, lat = 6, lon = 10, bump = null, uvk = 0.01) {
    const rings = [];
    for (let i = 0; i <= lat; i++) {
      const th = Math.PI * i / lat, ring = [];
      for (let j = 0; j < lon; j++) {
        const ph = 2 * Math.PI * j / lon, k = bump ? bump(th, ph) : 1, s = Math.sin(th) * k, cy = Math.cos(th) * k;
        const p = [0, 1, 2].map(d => c[d] + ax[d] * s * Math.cos(ph) + az[d] * s * Math.sin(ph) + ay[d] * cy);
        ring.push(this.vert(p, ph * uvk, th * uvk, part));
      }
      rings.push(ring);
    }
    this.strip(rings);
  }
  done(name, kind) {
    const nv = this.p.length / 3, rmap = new Uint16Array(nv);
    for (let i = 0; i < nv; i++) rmap[i] = i;
    return { kind, name, v: Float32Array.from(this.p), nv, idx: Uint16Array.from(this.ix), rmap, uv: Float32Array.from(this.uv), att: Uint8Array.from(this.at) };
  }
}
const ellR = (rx, rz, a) => 1 / Math.sqrt((Math.sin(a) / rx) ** 2 + (Math.cos(a) / rz) ** 2);
const SEG = 32;

// The straw hat: a round crown, a little narrower at the top, its ribbon, and a wide brim falling a little at its edge
function strawHat(F) {
  const B = new Build(), rx = F.rx + F.room + 0.04, rz = F.rz + F.room + 0.04, H = F.ry + F.room + 0.1, mr = (rx + rz) / 2;
  const at = (a, r, h) => world(F, [Math.sin(a) * r, h, F.cz + Math.cos(a) * r]);
  // (the crown's profile: radius factor and height, bottom to top; then a rounded top)
  const prof = [[1, -0.03], [0.995, 0.2], [0.99, 0.24], [0.975, 0.5 * H], [0.94, 0.8 * H], [0.86, 0.93 * H], [0.7, 1.0 * H], [0.42, 1.04 * H], [0.001, 1.05 * H]];
  const rings = [];
  let along = 0;
  prof.forEach(([f, h], k) => {
    if (k) along += Math.hypot((prof[k - 1][0] - f) * mr, h - prof[k - 1][1]);
    const ring = [];
    for (let j = 0; j < SEG; j++) {
      const a = 2 * Math.PI * j / SEG, r = ellR(rx, rz, a) * f * (1 + 0.012 * Math.sin(a * 2 + 1));
      ring.push(B.vert(at(a, r, h), a * mr * M, along * M, h < 0.22 ? 1 : 0, 255, k === 0 ? 0.8 : 1));
    }
    rings.push(ring);
  });
  B.strip(rings);
  // (the brim: from the crown out, falling a little, its edge rolled down; the inside ring its own vertices: a crease)
  const W = 0.98, brim = [];
  for (const [s, drop] of [[0, -0.02], [0.3, -0.05], [0.6, -0.1], [0.88, -0.16], [1, -0.21]]) {
    const ring = [];
    for (let j = 0; j < SEG; j++) {
      const a = 2 * Math.PI * j / SEG, r = ellR(rx, rz, a) + W * s, wob = 0.025 * Math.sin(3 * a + 0.6) * s;
      ring.push(B.vert(at(a, r, drop + wob), a * (mr + W * s) * M, (1 + s) * W * M, 0, (1 - s) * W * 100, s === 0 ? 0.75 : 1));
    }
    brim.push(ring);
  }
  B.strip(brim);
  return B.done('sombrero', 'hat');
}
// The wool cap: close round the skull from the forehead, lower behind; a turned-up ribbed cuff; a pompom on top
function woolCap(F) {
  const B = new Build(), rx = F.rx + F.room + 0.03, rz = F.rz + F.room + 0.03, ry = F.ry + F.room + 0.03, mr = (rx + rz) / 2;
  const dome = [], N = 9;
  for (let i = 0; i <= N; i++) {
    const ph = (Math.PI / 2) * (i / N) ** 0.9, ring = [];
    for (let j = 0; j < SEG; j++) {
      const a = 2 * Math.PI * j / SEG, rib = 1 + 0.008 * Math.sin(a * 30), r = ellR(rx, rz, a) * Math.cos(ph) * rib;
      ring.push(B.vert(world(F, [Math.sin(a) * r, ry * Math.sin(ph) - 0.02, F.cz + Math.cos(a) * r]), a * mr * M, ph * mr * M, 0));
    }
    dome.push(ring);
  }
  B.strip(dome);
  // (the cuff, over the dome's lower edge: a band 2.5 cm high, rolled at its foot)
  const cuff = [];
  for (const [d, h] of [[0.0, -0.06], [0.05, -0.05], [0.075, 0.02], [0.08, 0.22], [0.06, 0.28], [0.015, 0.31]]) {
    const ring = [];
    for (let j = 0; j < SEG * 2; j++) {
      const a = Math.PI * j / SEG, rib = 1 + 0.02 * Math.sin(a * 36), r = (ellR(rx, rz, a) + d) * rib;
      ring.push(B.vert(world(F, [Math.sin(a) * r, h, F.cz + Math.cos(a) * r]), a * mr * M, h * M, 0, 255, h < 0 ? 0.8 : 1));
    }
    cuff.push(ring);
  }
  B.strip(cuff);
  // (the pompom: fluffy, of the second colour, its fur by the cloth's fleece)
  const top = world(F, [0, ry + 0.22, F.cz - 0.05]), R = 0.36;
  const n = [0, 1, 2].map(d => world(F, [d === 0 ? 1 : 0, d === 1 ? 1 : 0, d === 2 ? 1 : 0]).map((x, k) => x - F.o[k]));
  B.blob(top, n[0].map(x => x * R), n[1].map(x => x * R * 0.92), n[2].map(x => x * R), 1, 9, 14, (th, ph) => 1 + 0.08 * Math.sin(th * 7 + ph * 5) * Math.sin(ph * 3 + th * 2), 0.06);
  return B.done('gorro', 'hat');
}
// The helmet: a smooth metal cap close round the skull, a raised rim at its edge and a ridge from front to back
function helmet(F) {
  const B = new Build(), rx = F.rx + F.room + 0.05, rz = F.rz + F.room + 0.05, ry = F.ry + F.room + 0.06, mr = (rx + rz) / 2, rings = [], N = 10;
  for (let i = -1; i <= N; i++) {
    const ph = i < 0 ? 0 : (Math.PI / 2) * (i / N) ** 0.9, ring = [], rim = i <= 0;
    for (let j = 0; j < SEG; j++) {
      const a = 2 * Math.PI * j / SEG, ridge = 1 + 0.05 * Math.exp(-((Math.sin(a) * 6) ** 2)) * Math.sin(ph), r = (ellR(rx, rz, a) + (rim ? 0.04 : 0)) * Math.cos(ph) * ridge;
      ring.push(B.vert(world(F, [Math.sin(a) * r, i < 0 ? -0.1 : ry * Math.sin(ph) * ridge - 0.02, F.cz + Math.cos(a) * r]), a * mr * M, ph * mr * M, i <= 1 ? 1 : 0));
    }
    rings.push(ring);
  }
  B.strip(rings);
  return B.done('casco', 'hat');
}
export function hatFit(F) { return F.kind === 'sombrero' ? strawHat(F) : F.kind === 'casco' ? helmet(F) : woolCap(F); }

// ---- Hair accessories: where the hair's outer surface is, in a direction from the head's centre ----
// (each style may hold the bow elsewhere: on its tail, between two tails, at its bun)
const BOW_AT = { coleta: [0, 0.12, -1], coletas: [0.7, 0.05, -0.7], trenza: [0, 0.05, -1], mono: [0, 0.6, -0.8], melena: [0.2, 0.55, -0.8] };
export function surfaceOf(D, v, fitted, look, furDm) {
  const le = joint(D, v, 'joint-l-eye'), re = joint(D, v, 'joint-r-eye'), eyeY = (le[1] + re[1]) / 2, head = headPoints(D, v);
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < head.length; i += 3) if (Math.abs(head[i + 1] - (eyeY + 0.4)) < 0.1) { zmin = Math.min(zmin, head[i + 2]); zmax = Math.max(zmax, head[i + 2]); }
  const C = [0, eyeY + 0.25, (zmin + zmax) / 2 - 0.05];
  // (every point as its direction and distance: the skin's (with the fur over it) and the hair cards')
  const dirs = [], add = (x, y, z, extra) => { const dx = x - C[0], dy = y - C[1], dz = z - C[2], r = Math.hypot(dx, dy, dz) || 1; dirs.push(dx / r, dy / r, dz / r, r + extra); };
  for (let i = 0; i < head.length; i += 3) add(head[i], head[i + 1], head[i + 2], furDm * 0.75);   // (the fur's tips are sparse: a little in)
  const hair = hairPoints(fitted);
  for (let i = 0; i < hair.length; i += 3) add(hair[i], hair[i + 1], hair[i + 2], 0);
  const at = (d, cone = 0.1) => {
    const l = Math.hypot(...d), x = d[0] / l, y = d[1] / l, z = d[2] / l;
    for (const cn of [cone, cone * 2, cone * 4]) {
      const cs = Math.cos(cn);
      let best = 0;
      for (let i = 0; i < dirs.length; i += 4) if (dirs[i] * x + dirs[i + 1] * y + dirs[i + 2] * z > cs) best = Math.max(best, dirs[i + 3]);
      if (best) return { p: [C[0] + x * best, C[1] + y * best, C[2] + z * best], n: [x, y, z], r: best };
    }
    return { p: [C[0] + x * 1.2, C[1] + y * 1.2, C[2] + z * 1.2], n: [x, y, z], r: 1.2 };
  };
  return { C, at, style: look.hairStyle };
}
const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const madd = (p, ...terms) => { const o = p.slice(); for (const [d, k] of terms) for (let c = 0; c < 3; c++) o[c] += d[c] * k; return o; };
// (a frame on the surface: n out of it, s across (level), u up along it)
function tangent(n) {
  const s = nrm(cross([0, 1, 0], n)), u = nrm(cross(n, s));
  return Math.hypot(...cross([0, 1, 0], n)) < 1e-3 ? { s: [1, 0, 0], u: [0, 0, -1] } : { s, u };
}
// A flower: five petals round a heart, facing n (radius R)
function flower(B, c, n, R, part = 0, heart = 1) {
  const { s, u } = tangent(n);
  for (let k = 0; k < 5; k++) {
    const a = 2 * Math.PI * k / 5 + 0.3, d = nrm(madd([0, 0, 0], [s, Math.cos(a)], [u, Math.sin(a)]));
    const pc = madd(c, [d, R * 0.62], [n, R * 0.05]), side = nrm(cross(n, d));
    B.blob(pc, d.map(x => x * R * 0.52), n.map(x => x * R * 0.14), side.map(x => x * R * 0.36), part, 4, 8);
  }
  B.blob(madd(c, [n, R * 0.14]), s.map(x => x * R * 0.3), n.map(x => x * R * 0.2), u.map(x => x * R * 0.3), heart, 4, 8);
}
// A tube along points (radius r), each with its part
function tube(B, pts, r, part, sides = 6) {
  const rings = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], t = nrm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const s = nrm(Math.abs(t[1]) < 0.9 ? cross(t, [0, 1, 0]) : cross(t, [1, 0, 0])), u = cross(s, t), ring = [];
    for (let j = 0; j < sides; j++) { const ph = 2 * Math.PI * j / sides; ring.push(B.vert(madd(pts[k], [s, Math.cos(ph) * r], [u, Math.sin(ph) * r]), k * 0.01, ph * 0.003, part)); }
    rings.push(ring);
  }
  B.strip(rings);
}
export function accFit(S, kind) {
  const B = new Build();
  if (kind === 'lazo') {
    // (two loops and their knot, two tails hanging; level across the surface where the style ties it)
    const h = S.at(BOW_AT[S.style] || [0, 0.4, -1]), { s, u } = tangent(h.n), c = madd(h.p, [h.n, 0.08]);
    for (const side of [-1, 1]) {
      const d = nrm(madd([0, 0, 0], [s, side], [u, 0.18]));
      B.blob(madd(c, [d, 0.26], [h.n, 0.02]), d.map(x => x * 0.26), u.map(x => x * 0.19), h.n.map(x => x * 0.08), 0, 7, 12);
      const t = nrm(madd([0, 0, 0], [s, side * 0.35], [u, -1]));
      B.blob(madd(c, [t, 0.27], [h.n, -0.02]), t.map(x => x * 0.27), s.map(x => x * 0.08), h.n.map(x => x * 0.03), 0, 6, 8);
    }
    B.blob(c, s.map(x => x * 0.08), u.map(x => x * 0.1), h.n.map(x => x * 0.08), 0, 5, 8);
  } else if (kind === 'diadema') {
    // (a band over the head from ear to ear, a little behind the hairline, on the hair)
    const pts = [], tilt = -0.32;
    for (let k = 0; k <= 22; k++) {
      const th = -1.5 + 3 * k / 22, d = [Math.sin(th), Math.cos(th) * Math.cos(tilt), Math.cos(th) * Math.sin(-tilt)];
      pts.push(S.at(d, 0.07));
    }
    // (smoothed along: single hairs stand out of the surface)
    const r = pts.map((p, k) => { const w = pts.slice(Math.max(0, k - 2), k + 3); return w.reduce((a, q) => a + q.r, 0) / w.length; });
    const cs = pts.map((p, k) => madd(S.C, [p.n, Math.max(r[k], p.r - 0.05) + 0.03])), rings = [];
    cs.forEach((c, k) => {
      const n = pts[k].n, a0 = cs[Math.max(0, k - 1)], a1 = cs[Math.min(cs.length - 1, k + 1)];
      const wdir = nrm(cross([a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]], n)), ring = [];
      for (const [a, b] of [[-1, 0], [-1, 1], [1, 1], [1, 0]]) ring.push(B.vert(madd(c, [wdir, a * 0.075], [n, b * 0.05]), k * 0.01, a * 0.004, 0));
      rings.push(ring);
    });
    B.strip(rings);
  } else if (kind === 'flor_pelo') {
    const h = S.at([1, 0.55, 0.15]);
    flower(B, madd(h.p, [h.n, 0.06]), h.n, 0.3, 0, 1);
  } else if (kind === 'horquillas') {
    // (two pins over the right temple, one over the other, slanting back)
    for (const d of [[-1, 0.62, 0.42], [-1, 0.42, 0.55]]) {
      const h = S.at(d), { s, u } = tangent(h.n), dir = nrm(madd([0, 0, 0], [s, 0.85], [u, 0.5])), c = madd(h.p, [h.n, 0.02]);
      const pts = [-0.24, -0.08, 0.08, 0.24].map(k => madd(c, [dir, k]));
      tube(B, pts, 0.022, 0, 6);
      B.blob(madd(c, [dir, 0.27]), dir.map(x => x * 0.05), h.n.map(x => x * 0.04), s.map(x => x * 0.04), 1, 4, 6);
    }
  } else if (kind === 'corona_flores') {
    // (a ring of flowers round the head, higher behind, on a green twist)
    const pts = [], N = 30;
    for (let k = 0; k <= N; k++) {
      const a = 2 * Math.PI * k / N, el = 0.5 - 0.3 * (1 - Math.cos(a)) / 2;   // (over the forehead, lower behind)
      pts.push(S.at([Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el)], 0.08));
    }
    const r = pts.map((p, k) => { const w = [-2, -1, 0, 1, 2].map(o => pts[(k + o + N) % N]); return w.reduce((a, q) => a + q.r, 0) / w.length; });
    const ring = pts.map((p, k) => madd(S.C, [p.n, Math.max(r[k], p.r - 0.06) + 0.05]));
    tube(B, ring, 0.04, 1, 6);
    for (let k = 0; k < N; k += 3) {
      const n = nrm(madd(pts[k].n, [[0, 1, 0], 0.4])), along = nrm(ring[k + 1].map((x, c) => x - ring[k][c]));
      flower(B, madd(ring[k], [pts[k].n, 0.05]), n, 0.17, 0, 0);
      // (a leaf either side, green)
      for (const sd of [-1, 1]) B.blob(madd(ring[k], [along, sd * 0.2]), along.map(x => x * 0.13), n.map(x => x * 0.025), cross(n, along).map(x => x * 0.06), 1, 4, 6);
    }
  }
  return B.done(kind, 'acc');
}
