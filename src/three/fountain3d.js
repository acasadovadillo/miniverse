// The village plaza fountain (3×3 tiles, model 'village:fountain'): a round basin of dressed limestone blocks in two
// courses, with a moulded coping on top, a low plinth round its foot and a ring of paving slabs round that; in the middle a
// baluster that carries a carved bowl, and above it a small finial with the nozzle. Real water in the basin and in the bowl
// (the game's own water: the material of the filled pits, terrain.js 'charca', with its waves, its sky, its rain and its
// night), a jet that rises from the nozzle and falls back into the bowl in eight thin arcs, the thin sheet that pours
// outwards over the whole lip of the bowl and falls into the basin (glassy at the lip, tearing into strands lower down),
// and where the water lands: rings and foam on the surface, droplets that jump off it and a soft mist.
//
// Cheap: the stone goes into the village meshes like any other model (two materials of its own, one 'fountStone' and one
// 'fountWet' mesh for the whole village, with the same program); the two water surfaces are one mesh; everything else
// that moves (the sheet, the arcs, the droplets, the mist, the rings) is ONE more mesh, animated only in its shader by a
// time uniform (FOUNTAIN_U, set by fx.js each frame): nothing on the processor per frame and nothing allocated. The
// geometry is made once (getModel caches it).
//
// Sizes in metres, the ground at y = 0, the centre at the origin. The stone's texture is projected from the three axes
// in the shader (triplanar, in metres: no stretching on the round blocks, the mouldings or the bowl, and no seam); the
// uv of each vertex is only its block's offset into the texture, so that no two blocks look alike. The vertex colour
// carries each block's own tone, the dark joints, the dirt at the foot and the waterline stain.
import * as THREE from 'three';
import { mat } from './geo.js';
import { photo, photoNow } from './photos.js';

const TAU = Math.PI * 2;
// The heights and radii everything else depends on (land and arcLand: worked out below, from how the water flies)
export const FOUNT = {
  water: 0.44,        // the basin's water surface (the bed at 0.10: some 34 cm of water)
  bed: 0.10,
  wallIn: 1.08,       // the inside face of the basin wall
  bowlWater: 1.302,   // the bowl's water, level with the top of its lip (it spills all round)
  bowlR: 0.612,       // where the bowl's water meets its lip
  nozzle: 1.6,        // the top of the finial, where the jet comes out
  land: 0.83,         // where the falling sheet reaches the basin's water
  arcLand: 0.3,       // where the jet's arcs reach the bowl's water
};
// Set every frame by fx.js (updateFountains): the time, and the sky the water reflects (darker at night)
export const FOUNTAIN_U = { fTime: { value: 0 }, fSky: { value: new THREE.Color('#a8c0d0') } };

// A small deterministic random sequence (the same fountain every time)
function rand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- the stone's texture and materials ----------
// A pale dressed limestone, 512 px for LIME_M metres, tileable: the rock photo (roca, Rock030) as its grain, softened
// (a light blur that wraps round) and with its contrast brought well down and its white crystals clipped, so its veins
// read as the faint figure of a limestone and not as a glittering granite; over it the pitted surface of the sand photo
// (arena, Ground080) and a few broad, warm stains. Painted with what has arrived; when a photo arrives later it is
// painted again (once)
const LIME_M = 1.3, LIME_N = 512;
let LIME;
function limeTex() {
  if (LIME) return LIME;
  const N = LIME_N, c = document.createElement('canvas');
  c.width = c.height = N;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  // The luminance of a photo at N × N, round its mean, blurred by a 3 × 3 box that wraps round the edges
  const lum = (g, key, blur) => {
    const ph = photoNow(key);
    if (!ph) return null;
    g.drawImage(ph.img, 0, 0, N, N);
    const a = g.getImageData(0, 0, N, N).data, l = new Float32Array(N * N);
    let m = 0;
    for (let i = 0, j = 0; j < l.length; i += 4, j++) m += (l[j] = 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2]);
    m /= l.length;
    if (!blur) { for (let j = 0; j < l.length; j++) l[j] -= m; return l; }
    const o = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += l[((y + dy + N) % N) * N + ((x + dx + N) % N)];
      o[y * N + x] = s / 9 - m;
    }
    return o;
  };
  // A smooth noise that tiles (cells of N / cells px)
  const R = rand(4242), cells = 6, grid = Array.from({ length: cells * cells }, () => R() - 0.5);
  const noise = (x, y) => {
    const fx = (x / N) * cells, fy = (y / N) * cells, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const G = (i, j) => grid[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (G(ix, iy) * (1 - su) + G(ix + 1, iy) * su) * (1 - sv) + (G(ix, iy + 1) * (1 - su) + G(ix + 1, iy + 1) * su) * sv;
  };
  const paint = () => {
    const g = c.getContext('2d', { willReadFrequently: true }), rock = lum(g, 'roca', true), sand = lum(g, 'arena', false);
    const im = g.createImageData(N, N), d = im.data, G = rand(77);
    for (let y = 0, j = 0; y < N; y++) for (let x = 0; x < N; x++, j++) {
      const st = noise(x, y);
      let v = st * 30;
      if (rock) { const r = rock[j] * 0.62; v += r > 0 ? 20 * Math.tanh(r / 20) : 34 * Math.tanh(r / 34); }
      else v += (G() - 0.5) * 14;
      if (sand) v += 26 * Math.tanh((sand[j] * 0.75) / 26);
      const warm = Math.max(0, st) * 20, i = j * 4;
      d[i] = 176 + v + warm * 0.6; d[i + 1] = 168 + v * 0.97 + warm * 0.25; d[i + 2] = 151 + v * 0.9 - warm * 0.2; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    t.needsUpdate = true;
  };
  paint();
  for (const k of ['roca', 'arena']) if (!photoNow(k)) photo(k)?.then(img => { if (img) paint(); });
  return (LIME = t);
}
// The stone's material: the texture projected from the three axes (in the model's own space, which is the village's:
// the fountain never moves), weighted by the normal; vMapUv is the block's offset
function stoneMat(wet) {
  const m = mat({ map: limeTex(), vertexColors: true, color: wet ? '#b2ac9f' : '#ffffff', roughness: wet ? 0.6 : 0.9 });
  m.customProgramCacheKey = () => 'fountain-stone-v1';
  m.onBeforeCompile = sh => {
    sh.uniforms.limeK = { value: 1 / LIME_M };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTp;\nvarying vec3 vTn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTp = transformed; vTn = objectNormal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTp;\nvarying vec3 vTn;\nuniform float limeK;')
      .replace('#include <map_fragment>', `
        vec3 tw = pow(abs(normalize(vTn)), vec3(4.0)); tw /= tw.x + tw.y + tw.z;
        vec4 sampledDiffuseColor = texture2D(map, vTp.zy * limeK + vMapUv) * tw.x + texture2D(map, vTp.xz * limeK + vMapUv + 0.37) * tw.y
          + texture2D(map, vTp.xy * limeK + vMapUv + 0.61) * tw.z;
        diffuseColor *= sampledDiffuseColor;`);
  };
  return m;
}
// The two (made the first time the fountain is drawn: models.js modelMat)
export const FOUNT_MATS = { fountStone: () => stoneMat(false), fountWet: () => stoneMat(true) };

// ---------- the stone ----------
// The tone of the block being built (each stone a little different), and whether its foot is in the plaza (darker there:
// the splashes and the dust)
let TONE = [1, 1, 1], FOOT = true;
const MOSS = [0.56, 0.62, 0.48];
// One vertex into a Builder (geo.js), its index. Its colour: the block's tone; darker in a joint (joint: the worn end of
// a block); at the foot outside; and where the water stands, the waterline's green-grey stain and below it the moss (in
// the basin, and in the bowl: its inside and its lip, not its underside)
function vtx(B, p, n, uv, joint = false) {
  const i = B.pos.length / 3, r = Math.hypot(p[0], p[2]), y = p[1];
  let k = joint ? 0.74 : 1;
  if (FOOT && r > 1.2) k *= 0.8 + 0.2 * sstep(0.03, 0.24, y);
  const wl = y > 1.12 && r < 0.67 && n[1] > -0.3 ? FOUNT.bowlWater : r < 1.1 && y < 0.7 ? FOUNT.water : null;
  const t = wl === null ? 0 : sstep(wl + 0.075, wl - 0.004, y);
  B.pos.push(p[0], p[1], p[2]); B.nor.push(n[0], n[1], n[2]); B.uv.push(uv[0], uv[1]);
  B.col.push(...TONE.map((c, j) => c * k * (1 - t + t * MOSS[j])));
  return i;
}
// A triangle facing (about) n
function tri(B, a, b, c, n) {
  const P = B.pos, ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
  const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
  const k = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
  if (k >= 0) B.idx.push(a, b, c); else B.idx.push(a, c, b);
}
const at = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
const nAt = (a, nr, ny) => [Math.sin(a) * nr, ny, Math.cos(a) * nr];
// A profile [[r, y], …] swept round the y axis from a0 to a1 (radians) in segs steps. The profile goes counter-clockwise
// in the r-y plane (along the bottom outwards, up the outside, back in along the top): its outward normals are then to
// the right of each edge. closed: the last point joins the first (a block); if the sweep is not a whole turn, its two
// ends are capped. ch: the chamfer of the block's ends (m): the end slices are the profile shrunk by ch, so the ends
// look worn and rounded and each joint shows as a dark groove. smooth: corners whose normals differ less than this (as
// a dot product) are shaded smooth (a moulding); sharper ones keep their edge. uo: the block's offset into the texture
function sweep(B, prof, { a0 = 0, a1 = TAU, segs = 32, closed = false, ch = 0, uo = [0, 0], smooth = 0.55 } = {}) {
  const n = prof.length, E = closed ? n : n - 1, full = a1 - a0 >= TAU - 1e-6, caps = closed && !full;
  const en = [];
  for (let i = 0; i < E; i++) {
    const p = prof[i], q = prof[(i + 1) % n], dr = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dr, dy) || 1;
    en.push([dy / l, -dr / l]);
  }
  const edgeAt = i => (closed ? (i + E) % E : i < 0 || i >= E ? -1 : i);
  // The averaged normal at a vertex (to shrink the ends), and the one an edge uses at its vertex i (its own if the corner is sharp)
  const avg = i => {
    const a = en[edgeAt(i - 1)], b = en[edgeAt(i)], x = (a ? a[0] : 0) + (b ? b[0] : 0), y = (a ? a[1] : 0) + (b ? b[1] : 0), l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  const nrm = (e, i) => {
    const o = edgeAt(i === e ? e - 1 : e + 1);
    if (o < 0) return en[e];
    const a = en[e], b = en[o];
    return a[0] * b[0] + a[1] * b[1] >= smooth ? avg(i) : a;
  };
  // The slices: [angle, shrink, end] (end: -1 the start cap, 1 the end cap)
  const rMean = prof.reduce((t, p) => t + p[0], 0) / n, sl = [];
  const d = caps && ch ? Math.min(ch / Math.max(rMean, 0.05), (a1 - a0) * 0.2) : 0;
  if (d) sl.push([a0, ch, -1]);
  for (let k = 0; k <= segs; k++) sl.push([a0 + d + (a1 - a0 - 2 * d) * (k / segs), 0, 0]);
  if (d) sl.push([a1, ch, 1]);
  const pt = (i, sh) => { const p = prof[i % n]; if (!sh) return p; const v = avg(i % n); return [p[0] - v[0] * sh, p[1] - v[1] * sh]; };
  for (let e = 0; e < E; e++) {
    const i0 = e, i1 = e + 1, ids = [];
    for (const [a, sh, end] of sl) {
      const T = [Math.cos(a) * end, 0, -Math.sin(a) * end];
      const row = [];
      for (const i of [i0, i1]) {
        const p = pt(i, sh), m = nrm(e, i % n);
        let N = nAt(a, m[0], m[1]);
        if (end) { N = [N[0] * 0.55 + T[0] * 0.85, N[1] * 0.55, N[2] * 0.55 + T[2] * 0.85]; const l = Math.hypot(...N); N = N.map(v => v / l); }
        row.push(vtx(B, at(a, p[0], p[1]), N, uo, !!end));
      }
      ids.push(row);
    }
    for (let k = 0; k < sl.length - 1; k++) {
      const [a, b] = ids[k], [c, dd] = ids[k + 1], am = (sl[k][0] + sl[k + 1][0]) / 2, N = nAt(am, en[e][0], en[e][1]);
      tri(B, a, b, dd, N); tri(B, a, dd, c, N);
    }
  }
  if (caps) for (const [a, sh, end] of [[a0, d ? ch : 0, -1], [a1, d ? ch : 0, 1]]) {
    const pts = prof.map((_, i) => pt(i, sh)), N = [Math.cos(a) * end, 0, -Math.sin(a) * end];
    const ids = pts.map(p => vtx(B, at(a, p[0], p[1]), N, uo, true));
    for (const [x, y, z] of THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), [])) tri(B, ids[x], ids[y], ids[z], N);
  }
}
// A flat disc (or ring) facing up at y
function disc(B, r0, r1, y, segs, uo = [0, 0]) {
  const N = [0, 1, 0], c = r0 ? null : vtx(B, [0, y, 0], N, uo);
  const ring = r => Array.from({ length: segs + 1 }, (_, k) => vtx(B, at((k / segs) * TAU, r, y), N, uo));
  const o = ring(r1), q = r0 ? ring(r0) : null;
  for (let k = 0; k < segs; k++) if (q) { tri(B, q[k], o[k], o[k + 1], N); tri(B, q[k], o[k + 1], q[k + 1], N); } else tri(B, c, o[k], o[k + 1], N);
}
// A rectangle with its corners chamfered by e: the section of a dressed block. outY, inY: heights where its outer and
// inner faces get an extra row of vertices (for the colour: the dirt at the foot, the waterline)
const block = (r0, r1, y0, y1, e = 0.014, outY = [], inY = []) => {
  const on = y => y > y0 + e + 0.005 && y < y1 - e - 0.005;
  return [[r0 + e, y0], [r1 - e, y0], [r1, y0 + e], ...outY.filter(on).sort((a, b) => a - b).map(y => [r1, y]), [r1, y1 - e], [r1 - e, y1],
    [r0 + e, y1], [r0, y1 - e], ...inY.filter(on).sort((a, b) => b - a).map(y => [r0, y]), [r0, y0 + e]];
};
// The coping: flat underneath, a rounded nose outwards with a drip, a top that falls a little towards the water and a
// rounded edge inwards
const COPING = [[1.03, 0.49], [1.33, 0.49], [1.352, 0.496], [1.37, 0.51], [1.38, 0.53], [1.381, 0.555], [1.374, 0.578], [1.358, 0.596], [1.335, 0.606],
  [1.29, 0.611], [1.1, 0.607], [1.062, 0.603], [1.042, 0.594], [1.03, 0.58], [1.024, 0.56], [1.024, 0.51]];
// The middle, all one piece: the base moulding (under the water), the baluster, the collar, the bowl (underneath, its
// rounded lip, inside), the finial and its little cup with the nozzle
const CENTRE = [[0, 0.1], [0.33, 0.1], [0.345, 0.13], [0.35, 0.19], [0.335, 0.225], [0.3, 0.245], [0.268, 0.258], [0.252, 0.285], [0.245, 0.33],
  [0.212, 0.355], [0.185, 0.4], [0.18, 0.43], [0.176, 0.452], [0.172, 0.47], [0.178, 0.55], [0.192, 0.62], [0.19, 0.69], [0.172, 0.75], [0.146, 0.8], [0.128, 0.84],
  [0.124, 0.86], [0.148, 0.87], [0.162, 0.885], [0.16, 0.9], [0.142, 0.912], [0.122, 0.925], [0.118, 0.95], [0.135, 0.975],
  [0.18, 1.0], [0.26, 1.035], [0.36, 1.072], [0.45, 1.112], [0.53, 1.152], [0.59, 1.19], [0.628, 1.222],
  [0.648, 1.238], [0.658, 1.258], [0.655, 1.278], [0.643, 1.291], [0.624, 1.297], [0.604, 1.296], [0.588, 1.288],
  [0.566, 1.262], [0.52, 1.226], [0.43, 1.19], [0.31, 1.166], [0.19, 1.155], [0.1, 1.152],
  [0.086, 1.162], [0.076, 1.2], [0.072, 1.28], [0.08, 1.35], [0.094, 1.395], [0.09, 1.43], [0.07, 1.46], [0.056, 1.49], [0.058, 1.515],
  [0.08, 1.535], [0.112, 1.56], [0.126, 1.582], [0.122, 1.598], [0.104, 1.604], [0.085, 1.598], [0.03, 1.59], [0.022, 1.6], [0, 1.6]];

function stone(m) {
  const R = rand(1907), dry = m.B('fountStone'), wet = m.B('fountWet'), uo = () => [R() * 7, R() * 7];
  dry.col ||= []; wet.col ||= [];
  // (each stone its own tone: a little lighter or darker, warmer or cooler)
  const tone = (k0 = 0.93, dk = 0.14) => { const k = k0 + R() * dk, w = (R() - 0.5) * 0.05; TONE = [k * (1 + w), k, k * (1 - w)]; };
  // The paving round it: 18 slabs flush with the plaza, their outer edge uneven (the plaza is not quite flat: they go
  // some 12 cm down)
  FOOT = false;
  for (let i = 0, N = 18, o = R(); i < N; i++) {
    const g = 0.008 / 1.6, a0 = ((i + o) / N) * TAU + g, a1 = ((i + 1 + o) / N) * TAU - g;
    tone(0.8, 0.12);
    sweep(dry, block(1.497, 1.74 + R() * 0.09, -0.12, 0.018 + R() * 0.008, 0.008), { a0, a1, segs: 3, closed: true, ch: 0.009, uo: uo(), smooth: 0.8 });
  }
  FOOT = true;
  // The plinth round the foot (half of it in the ground), in 14 stones
  for (let i = 0, N = 14, o = R(); i < N; i++) {
    const g = 0.005 / 1.4, a0 = ((i + o) / N) * TAU + g, a1 = ((i + 1 + o) / N) * TAU - g;
    tone(0.88, 0.12);
    sweep(dry, [[1.27, -0.25], [1.49, -0.25], [1.49, 0.03], [1.47, 0.065], [1.29, 0.07], [1.27, 0.05]], { a0, a1, segs: 4, closed: true, ch: 0.012, uo: uo(), smooth: 0.8 });
  }
  // The wall: two courses of 16 blocks, the joints of the top course over the middle of the ones below
  const W = FOUNT.water;
  for (const [y0, y1, off, outY, inY] of [[-0.18, 0.235, 0, [0.09, 0.2], []], [0.24, 0.488, 0.5, [], [W + 0.075, W + 0.03, W - 0.004]]]) for (let i = 0, N = 16; i < N; i++) {
    const g = 0.006 / 1.2, a0 = ((i + off) / N) * TAU + g, a1 = ((i + 1 + off) / N) * TAU - g;
    tone();
    sweep(dry, block(FOUNT.wallIn, 1.3, y0, y1, 0.014, outY, inY), { a0, a1, segs: 3, closed: true, ch: 0.012, uo: uo() });
  }
  // Behind the joints, the mortar (so that no light comes through them)
  TONE = [0.5, 0.48, 0.44];
  sweep(wet, [[1.29, -0.1], [1.29, 0.49]], { segs: 48 });
  sweep(wet, [[FOUNT.wallIn + 0.01, 0.49], [FOUNT.wallIn + 0.01, 0.0]], { segs: 48 });
  // The coping, in 12 stones, their joints between the wall's
  for (let i = 0, N = 12; i < N; i++) {
    const g = 0.004 / 1.2, a0 = ((i + 0.27) / N) * TAU + g, a1 = ((i + 1.27) / N) * TAU - g;
    tone(0.95, 0.1);
    sweep(dry, COPING, { a0, a1, segs: 6, closed: true, ch: 0.01, uo: uo(), smooth: 0.5 });
  }
  // The bed of the basin, and the middle
  TONE = [0.9, 0.9, 0.88];
  disc(wet, 0, FOUNT.wallIn + 0.02, FOUNT.bed, 48, uo());
  TONE = [1, 1, 0.98];
  sweep(wet, CENTRE, { segs: 32, uo: uo(), smooth: 0.35 });
  TONE = [1, 1, 1];
  m.solids.push([-1.49, 0, -1.49, 1.49, 0.611, 1.49], [-0.66, 0.611, -0.66, 0.66, FOUNT.nozzle, 0.66]);
}

// ---------- the water ----------
// The two surfaces in one geometry, with what the game's water material needs per vertex: the depth (its colour and how
// much of the bed shows) and the 'shore' (x: the distance to the edge; the rest, no bank reflected)
function waterGeo() {
  const pos = [], nor = [], uv = [], depth = [], shore = [], idx = [];
  const ring = (r0, r1, y, dp, segs) => {
    const base = pos.length / 3;
    for (let k = 0; k <= segs; k++) for (const r of [r0, r1]) {
      const p = at((k / segs) * TAU, r, y);
      pos.push(...p); nor.push(0, 1, 0); uv.push(p[0], p[2]); depth.push(dp); shore.push(0.6, 0, 0, 0);
    }
    for (let k = 0; k < segs; k++) { const a = base + k * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  };
  ring(0.17, FOUNT.wallIn + 0.012, FOUNT.water, FOUNT.water - FOUNT.bed, 64);
  ring(0.06, FOUNT.bowlR, FOUNT.bowlWater, 0.15, 40);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  g.setAttribute('shore', new THREE.Float32BufferAttribute(shore, 4));
  // (wound to face up: the ring above goes outwards then round, counter-clockwise seen from above)
  const P = g.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  a.fromBufferAttribute(P, idx[0]); b.fromBufferAttribute(P, idx[1]); c.fromBufferAttribute(P, idx[2]);
  if (b.sub(a).cross(c.sub(a)).y < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------- how the water flies ----------
// The sheet: over the rounded lip of the bowl (LIP, a few mm above the stone, at LIP_V m/s), then free from the lip's
// outer edge with SHEET_V (outwards, up) m/s, so it first pours a little outwards and then curves down into the basin
const LIP = [[0.6, 1.303], [0.626, 1.302], [0.647, 1.295], [0.66, 1.28], [0.664, 1.258]], LIP_V = 0.6, SHEET_V = [0.42, -0.15];
// The time to fall from height h to the water at w with an upward speed vy
const fall = (vy, h, w) => (vy + Math.sqrt(vy * vy + 19.6 * (h - w))) / 9.8;
const SHEET_T = fall(SHEET_V[1], LIP[4][1], FOUNT.water);
FOUNT.land = LIP[4][0] + SHEET_V[0] * SHEET_T;
// The jet's eight arcs: out of the nozzle at ARC_V (outwards, up) m/s, into the bowl's water
const ARC_V = [0.56, 2.0], ARC_T = fall(ARC_V[1], FOUNT.nozzle, FOUNT.bowlWater);
FOUNT.arcLand = 0.012 + ARC_V[0] * ARC_T;
const ARC_TOP = FOUNT.nozzle + (ARC_V[1] * ARC_V[1]) / 19.6;
const arcAt = (a, t) => at(a, 0.012 + ARC_V[0] * t, FOUNT.nozzle + ARC_V[1] * t - 4.9 * t * t);

// ---------- what moves ----------
// One geometry with three kinds of thing (attribute fxa.x): 0 falling water (a surface: fxq = [round it, 0 to 1; the
// time since the water left the lip or the nozzle, s]; fxa.z the whole time of its fall; fxa.w 0 the sheet, ≥ 1 a jet
// (its fraction a time offset)), 1 a droplet or a puff of mist (a quad that the shader moves along its flight: position =
// where it starts, fxv = its velocity, fxa = [1, phase, life, size; < 0 mist], fxq = the corner), 2 the rings and foam on
// a water surface (fxq = [radius, angle]; fxa.y where the water lands, fxa.z the outer edge, fxa.w how many separate
// streams land there, 0 a whole ring)
function fxGeo() {
  const pos = [], nor = [], q = [], fa = [], fv = [], idx = [];
  const v = (p, n, uvq, a, vel = [0, 0, 0]) => { pos.push(...p); nor.push(...n); q.push(...uvq); fa.push(...a); fv.push(...vel); return pos.length / 3 - 1; };
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
  // The sheet: a surface of revolution along its path [[r, y, time], …]
  const path = [];
  { let t = 0; LIP.forEach((p, i) => { if (i) t += Math.hypot(p[0] - LIP[i - 1][0], p[1] - LIP[i - 1][1]) / LIP_V; path.push([p[0], p[1], t]); }); }
  const t0 = path[path.length - 1][2], [r0, y0] = LIP[LIP.length - 1];
  for (let i = 1; i <= 12; i++) { const t = (i / 12) * SHEET_T; path.push([r0 + SHEET_V[0] * t, y0 + SHEET_V[1] * t - 4.9 * t * t, t0 + t]); }
  path[path.length - 1][1] = FOUNT.water;
  const total = t0 + SHEET_T, segs = 96, W = path.length, base = pos.length / 3;
  for (let k = 0; k <= segs; k++) {
    const a = (k / segs) * TAU;
    path.forEach(([r, y, t], i) => {
      const j = Math.min(i, W - 2), dr = path[j + 1][0] - path[j][0], dy = path[j + 1][1] - path[j][1], l = Math.hypot(dr, dy);
      v(at(a, r, y), nAt(a, dy / l, -dr / l), [k / segs, t], [0, 0, total, 0]);
    });
  }
  for (let k = 0; k < segs; k++) for (let i = 0; i < W - 1; i++) { const a = base + k * W + i; quad(a, a + 1, a + W + 1, a + W); }
  // A thin tube along a path [[x, y, z, time], …], r0 thick at the start and r1 at the end (a jet: w its time offset)
  const tube = (pts, r0, r1, w, sides = 6) => {
    const len = pts[pts.length - 1][3], base = pos.length / 3, t = new THREE.Vector3(), up = new THREE.Vector3(), s1 = new THREE.Vector3(), s2 = new THREE.Vector3();
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      t.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      up.set(Math.abs(t.y) > 0.9 ? 1 : 0, Math.abs(t.y) > 0.9 ? 0 : 1, 0);
      s1.crossVectors(t, up).normalize(); s2.crossVectors(s1, t).normalize();
      const r = r0 + (r1 - r0) * (p[3] / len);
      for (let k = 0; k <= sides; k++) {
        const c = (k / sides) * TAU, nx = s1.x * Math.cos(c) + s2.x * Math.sin(c), ny = s1.y * Math.cos(c) + s2.y * Math.sin(c), nz = s1.z * Math.cos(c) + s2.z * Math.sin(c);
        v([p[0] + nx * r, p[1] + ny * r, p[2] + nz * r], [nx, ny, nz], [k / sides, p[3]], [0, 0, len, w]);
      }
    });
    const S = sides + 1;
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < sides; k++) { const a = base + i * S + k; quad(a, a + S, a + S + 1, a + 1); }
  };
  // The jet: a short column out of the nozzle, and eight arcs that open from it into the bowl
  tube([0, 0.05, 0.1, 0.14].map(t => [0, FOUNT.nozzle - 0.01 + ARC_V[1] * t - 4.9 * t * t, 0, t]), 0.015, 0.009, 1, 8);
  for (let j = 0; j < 8; j++) {
    const a = (j / 8) * TAU + 0.2, pts = [];
    for (let i = 0; i <= 14; i++) { const t = (i / 14) * ARC_T; pts.push([...arcAt(a, t), t]); }
    tube(pts, 0.0075, 0.0042, 1 + ((j * 0.618) % 1) * 0.99, 5);
  }
  // Droplets and mist (moved by the shader)
  const R = rand(77), drop = (p, vel, life, size, phase = R()) => {
    const b = pos.length / 3;
    for (const c of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) v(p, [0, 1, 0], c, [1, phase, life, size], vel);
    quad(b, b + 1, b + 2, b + 3);
  };
  // where the sheet lands: small splashes that jump a few cm and fall back near the ring
  for (let i = 0; i < 60; i++) {
    const a = R() * TAU, out = (R() < 0.7 ? 1 : -1) * (0.05 + R() * 0.3), up = 0.5 + R() * 0.55, c = (R() - 0.5) * 0.2;
    drop(at(a, FOUNT.land + (R() - 0.5) * 0.04, FOUNT.water + 0.008), [Math.sin(a) * out + Math.cos(a) * c, up, Math.cos(a) * out - Math.sin(a) * c], (2 * up) / 9.8 + 0.01, 0.0035 + R() * 0.003);
  }
  // the sheet tearing into drops in its lower part: they leave it with its own speed there
  for (let i = 0; i < 36; i++) {
    const a = R() * TAU, t = SHEET_T * (0.45 + R() * 0.45), vy = SHEET_V[1] - 9.8 * t - R() * 0.3, h = y0 + SHEET_V[1] * t - 4.9 * t * t;
    drop(at(a, r0 + SHEET_V[0] * t - 0.004, h), nAt(a, SHEET_V[0] + (R() - 0.3) * 0.12, vy), fall(vy, h, FOUNT.water), 0.004 + R() * 0.003);
  }
  // the jet: drops that leave the arcs on the way (with the arc's speed there, a little off), never higher than the arcs
  for (let i = 0; i < 30; i++) {
    const a = (Math.floor(R() * 8) / 8) * TAU + 0.2 + (R() - 0.5) * 0.12, t = ARC_T * (0.1 + R() * 0.55), p = arcAt(a, t);
    const vy = Math.min(ARC_V[1] - 9.8 * t + (R() - 0.5) * 0.3, Math.sqrt(Math.max(0, 19.6 * (ARC_TOP + 0.04 - p[1]))));
    drop(p, nAt(a, ARC_V[0] + (R() - 0.5) * 0.25, vy), fall(vy, p[1], FOUNT.bowlWater), 0.0035 + R() * 0.0025);
  }
  // splashes where the arcs land in the bowl
  for (let i = 0; i < 24; i++) {
    const a = ((i % 8) / 8) * TAU + 0.2 + (R() - 0.5) * 0.12, up = 0.35 + R() * 0.45;
    drop(at(a, FOUNT.arcLand + (R() - 0.5) * 0.03, FOUNT.bowlWater + 0.005), nAt(a, 0.05 + R() * 0.2, up), (2 * up) / 9.8 + 0.01, 0.003 + R() * 0.0025);
  }
  // mist: soft puffs that rise slowly where the sheet lands, and a few round the bowl
  for (let i = 0; i < 24; i++) {
    const a = R() * TAU, bowl = i >= 19;
    drop(at(a, bowl ? 0.4 + R() * 0.2 : FOUNT.land + (R() - 0.4) * 0.12, (bowl ? FOUNT.bowlWater : FOUNT.water) + 0.03), nAt(a, 0.03 + R() * 0.06, 0.04 + R() * 0.05), 1.6 + R() * 1.4, -(bowl ? 0.1 : 0.13 + R() * 0.1));
  }
  // The rings and foam on both surfaces (the basin's only round where the sheet lands: that is where they show)
  const surface = (r0, r1, y, land, n, segs) => {
    const base = pos.length / 3, rings = 6;
    for (let k = 0; k <= segs; k++) for (let j = 0; j <= rings; j++) {
      const a = (k / segs) * TAU, r = r0 + (r1 - r0) * (j / rings);
      v(at(a, r, y), [0, 1, 0], [r, a], [2, land, r1, n]);
    }
    const W = rings + 1;
    for (let k = 0; k < segs; k++) for (let j = 0; j < rings; j++) { const a = base + k * W + j; quad(a, a + W, a + W + 1, a + 1); }
  };
  surface(FOUNT.land - 0.4, FOUNT.wallIn, FOUNT.water + 0.004, FOUNT.land, 0, 64);
  surface(0.06, FOUNT.bowlR - 0.004, FOUNT.bowlWater + 0.003, FOUNT.arcLand, 8, 40);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('fxq', new THREE.Float32BufferAttribute(q, 2));
  g.setAttribute('fxa', new THREE.Float32BufferAttribute(fa, 4));
  g.setAttribute('fxv', new THREE.Float32BufferAttribute(fv, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);   // (the droplets fly a little out of their quads)
  return g;
}

// The material of what moves: the scene's own light (sun, moon, lamps, fog), plus the sky reflected by Fresnel; what is
// thin and seen against the sky (the arcs, the droplets, the mist) never darker than the sky it stands against
const FX_COMMON = `
float fH(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float fN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fH(i), fH(i + vec2(1.0, 0.0)), f.x), mix(fH(i + vec2(0.0, 1.0)), fH(i + vec2(1.0, 1.0)), f.x), f.y); }
// (the same, round a ring: x wraps every P cells, so the sheet has no seam)
float fNp(vec2 p, float P) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); float i0 = mod(i.x, P), i1 = mod(i.x + 1.0, P);
  return mix(mix(fH(vec2(i0, i.y)), fH(vec2(i1, i.y)), f.x), mix(fH(vec2(i0, i.y + 1.0)), fH(vec2(i1, i.y + 1.0)), f.x), f.y); }`;
let FX_MAT;
function fxMaterial() {
  if (FX_MAT) return FX_MAT;
  // (the part of the sheet's time spent over the lip: there it is a clear film with only a thin line of light)
  let lipT = 0;
  for (let i = 1; i < LIP.length; i++) lipT += Math.hypot(LIP[i][0] - LIP[i - 1][0], LIP[i][1] - LIP[i - 1][1]) / LIP_V;
  const LIP_A = (lipT / (lipT + SHEET_T)).toFixed(3);
  // (premultiplied: what the water adds to the light and how much of what is behind it it hides are apart, so thin water
  // in the shade never darkens what shows through it; only the foam hides much)
  const m = new THREE.MeshStandardMaterial({ color: '#d4e4e8', roughness: 0.12, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
  m.forceSinglePass = true;
  m.customProgramCacheKey = () => 'fountain-fx-v3';
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, FOUNTAIN_U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 fxq; attribute vec4 fxa; attribute vec3 fxv;
        uniform float fTime;
        varying vec4 vFx; varying vec2 vFq; varying float vFa;`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(normal);
        vec3 fxPos = position;
        vFx = fxa; vFq = fxq; vFa = 1.0;
        if (fxa.x > 0.5 && fxa.x < 1.5) {
          // a droplet (or a puff of mist) along its flight; the quad faces the camera, a droplet stretched along its speed
          float life = fxa.z, age = fract(fTime / life + fxa.y), t = age * life;
          bool mist = fxa.w < 0.0;
          vec3 g = mist ? vec3(0.0, 0.05, 0.0) : vec3(0.0, -9.8, 0.0);
          vec3 p = position + fxv * t + 0.5 * g * t * t, vel = fxv + g * t;
          vec3 cam = transpose(mat3(modelMatrix)) * (cameraPosition - modelMatrix[3].xyz), toC = normalize(cam - p);
          vec3 ax, sd; float W, L;
          if (mist) { sd = normalize(cross(vec3(0.0, 1.0, 0.0), toC)); ax = cross(toC, sd); W = -fxa.w * (0.55 + age * 0.9); L = W; vFa = sin(age * 3.14159); }
          else { ax = normalize(vel + vec3(0.0, 1e-4, 0.0)); sd = normalize(cross(ax, toC)); W = fxa.w; L = max(W * 1.3, length(vel) * 0.018); vFa = 1.0 - smoothstep(0.75, 1.0, age); }
          fxPos = p + sd * fxq.x * W + ax * fxq.y * L;
          objectNormal = toC;
        }`)
      .replace('#include <begin_vertex>', 'vec3 transformed = fxPos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float fTime; uniform vec3 fSky;
        varying vec4 vFx; varying vec2 vFq; varying float vFa;
        ${FX_COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float kind = vFx.x, fxA = 1.0, foam = 0.0, refl = 0.0, lip = 1.0, hide = 0.3;
        bool jet = vFx.w > 0.5;
        if (kind < 0.5) {
          // falling water. The streaks are drawn in the water's own time (vFq.y: since it left the lip or the nozzle), so
          // they stretch as it speeds up, like real falling water
          float T = vFq.y, along = T / vFx.z, run = T - fTime - (jet ? fract(vFx.w) * 3.0 : 0.0);
          if (jet) {
            float n = fNp(vec2(vFq.x * 6.0, run * 14.0), 6.0);
            fxA = mix(0.55, 0.85, n) * (1.0 - 0.45 * along);
            foam = 0.15 + 0.25 * n; refl = 1.0; hide = 0.45;
          } else {
            hide = 0.22;
            // round the ring: where it breaks early into separate strands (and leaves gaps), slowly changing
            float brk = fNp(vec2(vFq.x * 11.0, fTime * 0.15), 11.0);
            float tearAt = mix(0.62, 0.38, smoothstep(0.42, 0.72, brk));
            float tear = smoothstep(tearAt, tearAt + 0.35, along);
            float n = fNp(vec2(vFq.x * 120.0, run * 8.0), 120.0) * 0.55 + fNp(vec2(vFq.x * 260.0 + 3.0, run * 17.0), 260.0) * 0.45;
            float strands = smoothstep(0.3 + 0.34 * tear, 0.56 + 0.24 * tear, n);
            fxA = mix(0.06, 0.44, strands) * mix(1.0, strands, tear * 0.92);
            fxA *= 1.0 - 0.55 * smoothstep(0.55, 0.85, brk) * tear;
            foam = strands * (0.06 + 0.42 * tear);
            refl = 1.0 - tear * 0.5;
            lip = mix(0.35, 1.0, smoothstep(0.0, ${LIP_A}, along));
            fxA *= lip;
          }
          fxA *= 1.0 - smoothstep(0.9, 1.0, along);
        } else if (kind < 1.5) {
          float d = length(vFq);
          if (vFx.w < 0.0) { fxA = (1.0 - smoothstep(0.0, 1.0, d)) * (1.0 - smoothstep(0.0, 1.0, d)) * 0.2 * vFa; foam = 1.0; hide = 0.15; }
          else { fxA = (1.0 - smoothstep(0.3, 1.0, d)) * 0.8 * vFa; foam = 0.35; refl = 1.0; hide = 0.25; }
        } else {
          // the rings that spread from where the water lands, and the foam there
          float r = vFq.x, a = vFq.y, dr = r - vFx.y;
          float spots = vFx.w > 0.5 ? pow(0.5 + 0.5 * cos(a * vFx.w - 1.6), 6.0) : 1.0;
          float n = fN(vec2(a * vFx.y * 26.0, r * 30.0 - fTime * 1.7)) * 0.5 + fN(vec2(a * vFx.y * 60.0 + fTime * 2.3, r * 70.0 - fTime)) * 0.3;
          float fade = exp(-abs(dr) * (vFx.w > 0.5 ? 9.0 : 4.5)) * (1.0 - smoothstep(vFx.z - 0.06, vFx.z, r)) * (1.0 - smoothstep(0.32, 0.4, -dr)) * mix(1.0, spots, 0.6);
          float band = exp(-dr * dr / 0.004) * spots;
          foam = band * smoothstep(0.32, 0.65, n) * 0.9;
          if (fade > 0.03) {
            float wob = fN(vec2(a * vFx.y * 5.0, fTime * 0.4)) - 0.5;   // (the rings are not perfect circles)
            float wave = sin((abs(dr) + wob * 0.05) * 70.0 - fTime * 10.0 + n * 2.0);
            refl = smoothstep(0.35, 1.0, wave) * fade * (0.6 + 0.8 * fN(vec2(a * vFx.y * 9.0, r * 6.0 - fTime * 0.2)));
          }
          fxA = clamp(foam * 0.7 + refl * 0.16 + band * 0.08, 0.0, 1.0);
          hide = 0.15;
        }
        hide = mix(hide, 0.85, foam * 0.6);
        // (clear water scatters little light of its own: what shows of it is what it reflects; the foam is white)
        diffuseColor.rgb = mix(diffuseColor.rgb * 0.4, vec3(0.93, 0.95, 0.96), foam);
        diffuseColor.a *= fxA;`)
      .replace('#include <opaque_fragment>', `
        {
          float F = 0.04 + 0.96 * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 5.0);
          float k = kind < 0.5 ? (0.25 + 0.75 * F) * refl * lip : kind < 1.5 ? 0.5 * refl : 0.35 * refl;
          outgoingLight += fSky * k;
          if (kind < 0.5 && !jet) diffuseColor.a = clamp(diffuseColor.a + F * 0.12 * refl * lip, 0.0, 1.0);
          // (thin water against the sky: as bright as the sky behind it, never a grey speck)
          if (jet || (kind > 0.5 && kind < 1.5)) outgoingLight = max(outgoingLight, fSky * 0.9);
        }
        #include <opaque_fragment>`)
      // (after the fog: the light the water adds, and how much it hides of what is behind it)
      .replace('#include <premultiplied_alpha_fragment>', 'gl_FragColor = vec4(gl_FragColor.rgb * gl_FragColor.a, gl_FragColor.a * hide);');
  };
  return (FX_MAT = m);
}

// The fountain, into the model m (models.js): its stone in the village meshes; the water and what moves, apart (extras:
// world3d.js gives the water the game's water material, and neither casts a shadow nor is outlined)
let GEO;
export function fountain(m, waterMat) {
  stone(m);
  GEO ||= { water: waterGeo(), fx: fxGeo() };
  const w = new THREE.Mesh(GEO.water, waterMat);
  w.userData.water = true; w.userData.fx = true; w.renderOrder = 2;
  const f = new THREE.Mesh(GEO.fx, fxMaterial());
  f.userData.fx = true; f.renderOrder = 3;
  m.extra(w).extra(f);
}
