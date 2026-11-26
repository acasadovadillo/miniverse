// Glass: the panes of the greenhouse (its walls, its roof, its door) and the cloche (phase R2-G, greenhouse.js).
// All the glass of the world shares one material (PANE) and is added to what its chunk already merges, so a chunk costs one
// more draw however many panes it has (and a roof, one). It is drawn cheaply: no lights, no shadow, no texture; the sky it
// reflects, the sun's glint, the green of its edges, the rain's drops, the snow on a roof, the frost of a cold night and the
// lamps near are worked out from the place and the time. It writes no depth (what is behind is drawn first, opaque), is drawn
// once for its two faces and gives no shadow: the iron bars do. Far away the small things of it are left out.
// A pane's uv go 0 to 1 along its sides (the edges).
import * as THREE from 'three';
import { Builder, mat } from './geo.js';
import { CAM } from '../camera.js';
import { PIECES, parsePlaced } from '../pieces.js';
import { GLASS_WALL, GLASS_ROOF } from '../greenhouse.js';

const IRON = '#525a58';
export const isGlass = id => id === GLASS_WALL;

// With the player in a greenhouse, what of it would come between him and the camera is not drawn (as the walls and the roof of a
// house: world3d.js updateFade; here in the shaders, so all its glass and its iron go on being one mesh of a chunk)
export const CUT = { uCutP: { value: new THREE.Vector3() }, uCutC: { value: new THREE.Vector2(0, 1) }, uCutB: { value: new THREE.Vector4() }, uCutK: { value: 0 } };
const CUT_PARS = 'uniform vec3 uCutP; uniform vec2 uCutC; uniform vec4 uCutB; uniform float uCutK;';
const cutMain = w => `if (uCutK > 0.0 && ${w}.x > uCutB.x && ${w}.x < uCutB.y && ${w}.z > uCutB.z && ${w}.z < uCutB.w) {
        float ahead = dot(${w}.xz - uCutP.xz, uCutC);
        if ((${w}.y > uCutP.y + 2.5 || (ahead > 0.35 && ${w}.y > uCutP.y + 0.32)) && uCutK > fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))))) discard;
      }`;
let IRONM = null;
export function ironMaterial() {
  if (IRONM) return IRONM;
  IRONM = mat({ color: IRON, metalness: 0.5, roughness: 0.5 });
  IRONM.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, CUT);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCutW;').replace('#include <project_vertex>', '#include <project_vertex>\nvCutW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCutW;\n' + CUT_PARS).replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + cutMain('vCutW'));
  };
  IRONM.customProgramCacheKey = () => 'glass-iron';
  return IRONM;
}

// ---------- the material ----------
export const PANE_U = {
  uTop: { value: new THREE.Color('#8fb0cc') }, uHor: { value: new THREE.Color('#c8d4d8') }, uSun: { value: new THREE.Vector3(0.3, 0.8, 0.4) }, uSunC: { value: new THREE.Color('#fff4e0') },
  uAmb: { value: new THREE.Color('#b8c0c4') }, uT: { value: 0 }, uWet: { value: 0 }, uSnow: { value: 0 }, uFrost: { value: 0 },
  uLampP: { value: null }, uLampC: { value: null }, uLampN: { value: 0 },
};
let PANE = null;
export function paneMaterial() {
  if (PANE) return PANE;
  const lampP = Array.from({ length: 6 }, () => new THREE.Vector4()), lampC = Array.from({ length: 6 }, () => new THREE.Vector4());
  PANE_U.uLampP.value ||= lampP; PANE_U.uLampC.value ||= lampC;
  PANE = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...PANE_U, ...CUT }, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    vertexShader: `uniform vec4 uLampP[6]; uniform vec4 uLampC[6]; uniform int uLampN;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vLamp;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0), mvPosition = viewMatrix * w;
        vW = w.xyz; vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
        vLamp = vec3(0.0);
        for (int i = 0; i < 6; i++) { if (i >= uLampN) break; vec3 d = uLampP[i].xyz - w.xyz; vLamp += uLampC[i].rgb / (1.0 + dot(d, d) * 0.35); }
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunC; uniform vec3 uAmb; uniform float uT; uniform float uWet; uniform float uSnow; uniform float uFrost;
      ${CUT_PARS}
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vLamp;
      #include <common>
      #include <fog_pars_fragment>
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main() {
        ${cutMain('vW')}
        vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
        vec3 N = normalize(vN); bool outside = dot(N, V) > 0.0; if (!outside) N = -N;
        float nv = clamp(dot(N, V), 0.0, 1.0), near = 1.0 - smoothstep(10.0, 22.0, dist);
        // (old glass is never quite flat: what it reflects ripples a little)
        vec2 q = abs(N.y) > 0.35 ? vW.xz : vec2(dot(vW.xz, vec2(N.z, -N.x)), vW.y);
        vec3 R = reflect(-V, normalize(N + near * 0.012 * vec3(sin(q.y * 9.0 + q.x * 4.0), 0.0, cos(q.x * 11.0 - q.y * 5.0))));
        float F = 0.075 + 0.85 * pow(1.0 - nv, 3.5);
        vec3 sky = R.y > 0.0 ? mix(uHor, uTop, pow(R.y, 0.55)) : mix(uHor, uHor * 0.35, min(1.0, -R.y * 4.0));
        sky *= 0.82 + 0.4 * smoothstep(0.35, 0.75, n2(R.xz / (abs(R.y) + 0.25) * 1.6 + 3.0));   // (the clouds in it)
        // (thin, and a little green: more at its cut edges)
        vec2 e = min(vUv, 1.0 - vUv); float edge = (1.0 - smoothstep(0.0, 0.05, min(e.x, e.y))) * (0.35 + 0.65 * near);
        float tintA = 0.06 + 0.18 * edge;
        vec3 tint = uAmb * mix(vec3(0.62, 0.74, 0.70), vec3(0.22, 0.46, 0.36), edge);
        float a = 1.0 - (1.0 - F) * (1.0 - tintA);
        vec3 c = (sky * F + tint * tintA * (1.0 - F)) / max(a, 1e-3);
        float g = pow(max(dot(R, uSun), 0.0), 380.0);
        c += uSunC * g * 2.2; a = min(1.0, a + g * 0.8);
        c += vLamp * 0.5; a = min(1.0, a + 0.10 * min(1.0, dot(vLamp, vec3(1.2))));
        // Rain: drops that stay and, down the panes, some that run
        if (uWet > 0.01 && near > 0.01) {
          vec2 cell = floor(q * 30.0); float r = h2(cell);
          vec2 f = (fract(q * 30.0) - 0.5 - 0.5 * (vec2(h2(cell + 7.0), h2(cell + 13.0)) - 0.5)) * vec2(1.0, abs(N.y) > 0.35 ? 1.0 : 0.75);
          float rad = 0.06 + 0.2 * h2(cell + 3.0) * h2(cell + 5.0), drop = r < 0.3 * uWet ? 1.0 - smoothstep(rad * 0.5, rad, length(f)) : 0.0, hi = drop * smoothstep(0.0, 0.2, f.y + f.x * 0.4);
          vec2 sc = vec2(floor(q.x * 11.0), 0.0); float sp = 0.25 + 0.5 * h2(sc + 5.0), run = fract(q.y * 0.45 + uT * sp * 0.35 + h2(sc));
          float streak = step(0.72, h2(sc + 9.0)) * smoothstep(0.42, 0.0, abs(fract(q.x * 11.0) - 0.5 - 0.15 * sin(q.y * 7.0 + sc.x))) * smoothstep(0.0, 0.02, run) * (1.0 - smoothstep(0.03, 0.38, run));
          float wet = max(drop * 0.38, streak * 0.3) * uWet * near;
          c = mix(c, mix(uHor * 0.75, uHor * 1.25, hi), min(1.0, wet * 1.5)); a = max(a, wet);
        }
        // Frost: from the edges of each pane inwards, feathery, thicker below
        if (uFrost > 0.01) {
          float nz = near > 0.02 ? n2(q * 9.0) * 0.6 + n2(q * 23.0) * 0.4 : 0.5, ed = min(e.x, e.y);
          float fr = uFrost * smoothstep(0.30, 0.0, ed - 0.16 * (nz - 0.4) + 0.10 * vUv.y - 0.05);
          c = mix(c, uAmb * vec3(0.86, 0.93, 1.0) * (0.75 + 0.4 * nz), fr * 0.9); a = max(a, fr * 0.72);
        }
        // Snow, on what slopes: in patches that thicken with it; from below, it dims the light
        if (uSnow > 0.01 && abs(N.y) > 0.35) {
          float nz = n2(vW.xz * 1.1) * 0.6 + n2(vW.xz * 4.3) * 0.28 + n2(vW.xz * 15.0) * 0.12;
          float bell = 1.0 - step(0.0005, abs(vUv.x - 0.5));   // (a cloche: a thin cap of it)
          float sn = smoothstep(0.78 - 0.62 * uSnow, 0.98 - 0.62 * uSnow, nz + 0.22 * (1.0 - smoothstep(0.0, 0.25, e.y)) + 0.1 - 0.3 * bell) * (1.0 - 0.35 * bell);
          vec3 sc = outside ? uAmb * vec3(1.02, 1.05, 1.1) * (0.9 + 0.2 * nz) + uSunC * 0.35 * max(dot(N, uSun), 0.0) : uAmb * vec3(0.52, 0.58, 0.66);
          c = mix(c, sc, sn); a = max(a, sn * (outside ? 0.94 : 0.86));
        }
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  PANE.forceSinglePass = true;
  PANE.name = 'pane';
  return PANE;
}
// Each frame (engine.js): the sky, the sun and the weather of now. dt: how fast it gets wet, or white
const C0 = new THREE.Color();
export function paneFrame(view, game, dt, t) {
  const U = PANE_U, S = view.skyU, info = game.player ? game.days?.info || {} : {}, to = (u, v, s) => { u.value += (v - u.value) * Math.min(1, dt * s); if (Math.abs(u.value - v) < 0.004) u.value = v; };
  U.uT.value = t;
  U.uTop.value.copy(S.top.value); U.uHor.value.copy(S.horizon.value);
  if (view.sunDir) U.uSun.value.copy(view.sunDir);
  const clear = S.cloudy.value > 0.9 ? 0 : 1 - S.cloudy.value * 0.6;
  U.uSunC.value.copy(view.sun.color).multiplyScalar(Math.min(1.4, view.sun.intensity) * clear);
  // (the light that falls on what is white on it: the sky's and, on a clear day, some of the sun's)
  U.uAmb.value.copy(view.hemi.color).multiplyScalar(0.34 * view.hemi.intensity).add(C0.copy(view.sun.color).multiplyScalar(0.05 * view.sun.intensity));
  // (the cut: the house the player is in, coming and going)
  const W = view.world, p = game.player, r = p && game.underGlass && game.scene === W.scene && !CAM.first ? W.regions.get(W.insideRegion) : null;
  if (r) { CUT.uCutP.value.set(p.x, view.groundY(W.scene, p.x, p.y), p.y); CUT.uCutB.value.set(r.box.x0 - 0.7, r.box.x1 + 0.7, r.box.y0 - 0.7, r.box.y1 + 0.7); }
  CUT.uCutC.value.set(Math.sin(CAM.yaw), Math.cos(CAM.yaw));
  to(CUT.uCutK, r ? 1 : 0, r ? 6 : 1e3);
  const snap = U.day !== game.days?.dayIndex ? 1e3 : 1;   // (another day, or another world: as it is there, at once)
  U.day = game.days?.dayIndex;
  if (U.lock) return;   // (the art sheet sets them)
  to(U.uWet, info.rain ? 1 : 0, (info.rain ? 0.12 : 0.02) * snap);
  to(U.uSnow, info.snow ? 1 : 0, (info.snow ? 0.02 : 0.008) * snap);
  to(U.uFrost, frostNow(game), 0.1 * snap);
}
// How frosted the panes are: in a night of frost where the player is, from dusk on, melting in the morning
let frost = { day: NaN, x: NaN, y: NaN, min: 99 };
function frostNow(game) {
  const p = game.player, T = game.days;
  if (!p || !T || !game.farm || game.scene !== game.world) return 0;
  const h = T.localHour, k = h >= 20 ? Math.min(1, (h - 20) / 3) : h < 8 ? 1 : h < 10 ? 1 - (h - 8) / 2 : 0;
  if (!k) return 0;
  const cx = Math.floor(p.x / 64), cy = Math.floor(p.y / 64), day = T.dayIndex - (h < 12 ? 1 : 0);
  if (frost.day !== day || frost.x !== cx || frost.y !== cy) { frost.day = day; frost.x = cx; frost.y = cy; frost.min = game.farm.fieldAt(day, Math.floor(p.x), Math.floor(p.y), {}).min; }
  return k * Math.max(0, Math.min(1, (2 - frost.min) / 4));
}

// ---------- the pieces ----------
export const KERB = 0.26;                // the wooden kerb at the foot of a wall
const MIDRAIL = 1.5, TOP = 0.07, BAR = 0.014, POST = 0.021;
const isWall = p => p?.kind === 'wall' || p?.kind === 'door';
const placedId = (scene, x, y) => { const v = scene.at('placed', x, y); return v ? parsePlaced(v)[0] : ''; };

// An iron bar from p to q (any direction), w wide and h high, a little under the line it follows: its four long faces
export function stick(B, p, q, w, h) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], L = Math.hypot(...d) || 1, f = d.map(v => v / L);
  let s = Math.abs(f[1]) > 0.97 ? [1, 0, 0] : [-f[2], 0, f[0]];
  const sl = Math.hypot(...s) || 1; s = s.map(v => v / sl);
  const u = [s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]], up = u[1] < 0 ? u.map(v => -v) : u;
  const at = (o, a, b) => [o[0] + s[0] * a + up[0] * b, o[1] + s[1] * a + up[1] * b, o[2] + s[2] * a + up[2] * b], W = w / 2, H = h / 2;
  for (const [a0, b0, a1, b1, n] of [[-W, H, W, H, up], [-W, -H, W, -H, up.map(v => -v)], [W, -H, W, H, s], [-W, -H, -W, H, s.map(v => -v)]]) B.quadN(at(p, a0, b0), at(q, a0, b0), at(q, a1, b1), at(p, a1, b1), n, [[0, 0], [L, 0], [L, w], [0, w]]);
}
const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

// A straight length of glass wall, from a to b along its axis (X: along x), at c across: kerb, bars and panes, from the floor
// to y1. posts: at which ends it has a thick post
function pane(emit, X, c, a, b, y1, posts, kerb = KERB) {
  const K = emit('timber', 'free'), I = emit('paneIron', 'free'), G = emit('pane', 'free');
  const box = (B, u0, u1, y0, yy, t) => { if (X) B.box(u0, y0, c - t, u1, yy, c + t, { s: 0.6 }); else B.box(c - t, y0, u0, c + t, yy, u1, { s: 0.6 }); };
  if (kerb) { box(K, a, b, 0, kerb, 0.05); box(K, a, b, kerb, kerb + 0.03, 0.075); }
  const lo = kerb ? kerb + 0.03 : 0, n = Math.max(1, Math.round((b - a) * 2)), w = (b - a) / n;
  box(I, a, b, lo, lo + 0.03, 0.02);
  box(I, a, b, y1 - TOP, y1, 0.035);
  const rows = y1 - lo > 2 ? [lo + 0.03, MIDRAIL, y1 - TOP] : [lo + 0.03, y1 - TOP];
  for (const y of rows.slice(1, -1)) box(I, a, b, y - 0.012, y + 0.012, BAR);
  for (let i = 0; i <= n; i++) {
    const u = a + i * w, thick = (i === 0 && posts[0]) || (i === n && posts[1]);
    if ((i === 0 || i === n) && !thick) continue;
    box(I, u - (thick ? POST : 0.009), u + (thick ? POST : 0.009), lo, y1, thick ? POST : BAR);
  }
  const P = (u, y) => (X ? [u, y, c] : [c, y, u]), N = X ? [0, 0, 1] : [1, 0, 0];
  for (let i = 0; i < n; i++) for (let r = 0; r + 1 < rows.length; r++) G.quadN(P(a + i * w, rows[r]), P(a + (i + 1) * w, rows[r]), P(a + (i + 1) * w, rows[r + 1]), P(a + i * w, rows[r + 1]), N, UV);
}
// The glass wall of a tile: straight on, or an arm to each neighbour (mask: wallMask), with a post where they meet
export function glassWall(emit, tx, ty, mask, H) {
  const cx = tx + 0.5, cz = ty + 0.5, xs = mask & 3, zs = mask & 12;
  if (!zs || !xs) {
    const X = !zs, u = X ? tx : ty;
    // (a post every tile, at its start; at its end, only where the wall ends)
    pane(emit, X, X ? cz : cx, u, u + 1, H, [true, X ? !(mask & 1) : !(mask & 4)]);
    return;
  }
  const I = emit('paneIron', 'free');
  I.box(cx - 0.04, 0, cz - 0.04, cx + 0.04, H, cz + 0.04, { s: 0.6 });
  const arm = (X, from, to) => pane(emit, X, X ? cz : cx, Math.min(from, to), Math.max(from, to), H, [false, false]);
  if (mask & 1) arm(true, cx + 0.04, tx + 1);
  if (mask & 2) arm(true, tx, cx - 0.04);
  if (mask & 4) arm(false, cz + 0.04, ty + 1);
  if (mask & 8) arm(false, ty, cz - 0.04);
}
// What is over and beside a door in a glass wall, and its glazed leaf (doorLeaf in build3d.js hangs it as any other)
export function glassDoorway(emit, X, c, u0, half, y1, H) {
  const I = emit('paneIron', 'free'), G = emit('pane', 'free'), m = u0 + 0.5;
  const box = (B, a, b, y0, yy, t) => { if (X) B.box(a, y0, c - t, b, yy, c + t, { s: 0.6 }); else B.box(c - t, y0, a, c + t, yy, b, { s: 0.6 }); };
  for (const [a, b] of [[u0, m - half], [m + half, u0 + 1]]) box(I, a, b, 0, H, 0.03);
  box(I, m - half, m + half, y1, y1 + 0.06, 0.03); box(I, m - half, m + half, H - TOP, H, 0.035); box(I, m - 0.011, m + 0.011, y1 + 0.06, H - TOP, BAR);
  const P = (u, y) => (X ? [u, y, c] : [c, y, u]), N = X ? [0, 0, 1] : [1, 0, 0];
  for (const [a, b] of [[m - half, m], [m, m + half]]) G.quadN(P(a, y1 + 0.06), P(b, y1 + 0.06), P(b, H - TOP), P(a, H - TOP), N, UV);
}
export function glassLeaf(d, mats, H) {
  const I = new Builder(), K = new Builder(), G = new Builder(), w = d.width, g = new THREE.Group();
  for (const x of [0.005, w - 0.055]) I.box(x, 0.03, -0.022, x + 0.05, H, 0.022);
  for (const [y0, y1] of [[0.03, 0.09], [0.5, 0.56], [H - 0.06, H], [1.26, 1.29]]) I.box(0.055, y0, -0.02, w - 0.055, y1, 0.02);
  I.box(w / 2 - 0.011, 0.56, -0.014, w / 2 + 0.011, H - 0.06, 0.014);
  for (const y of [0.4, 1.6]) I.box(0, y, -0.034, 0.16, y + 0.04, -0.022);
  I.box(w - 0.1, 0.98, -0.06, w - 0.02, 1.0, -0.022); I.box(w - 0.1, 0.98, 0.022, w - 0.02, 1.0, 0.06);
  K.box(0.055, 0.09, -0.012, w - 0.055, 0.5, 0.012, { s: 0.6 });
  for (const [x0, x1] of [[0.055, w / 2], [w / 2, w - 0.055]]) for (const [y0, y1] of [[0.56, 1.275], [1.275, H - 0.06]]) G.quadN([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], [0, 0, 1], UV);
  const gm = G.mesh(mats.pane, { cast: false, receive: false });
  gm.userData.glass = true;
  g.add(I.mesh(mats.iron), K.mesh(mats.kerb), gm);
  return g;
}

// ---------- the roof ----------
// The tiles of glass of a roof: what build3d.js (both kinds of roof) gives tile by tile, gathered in two meshes
export class GlassRoof {
  constructor(scene, shape, level, height) {
    this.scene = scene; this.shape = shape; this.K = level; this.base = height;
    this.G = new Builder(); this.I = new Builder(); this.n = 0;
  }
  // The glass lies a little lower than the tiles of a roof would
  static is(raw) { return raw === GLASS_ROOF; }
  face(ps) {   // a triangle or a quad of it, its uv along its own sides
    const [a, b, c] = ps, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1; n = n.map(x => x / l); if (n[1] < 0) n = n.map(x => -x);
    if (ps.length === 4) this.G.quadN(ps[0], ps[1], ps[2], ps[3], n, UV);
    else { const up = (u[2] * v[0] - u[0] * v[2]) >= 0; this.G.tri(...(up ? [a, b, c] : [a, c, b]), n, [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]); }
    this.n++;
  }
  bar(p, q, w = 0.022, h = 0.04) { stick(this.I, [p[0], p[1] - h * 0.4, p[2]], [q[0], q[1] - h * 0.4, q[2]], w, h); }
  // Between the top of a glass wall (or a door in one) and the roof over it
  infill(x, y, all) {
    const s = this.scene, p = s.pieceAt(x, y);
    if (!isWall(p)) return;
    const id = placedId(s, x, y), near = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (!all && id !== GLASS_WALL && !(p.kind === 'door' && near.some(([i, j]) => placedId(s, x + i, y + j) === GLASS_WALL))) return;
    const W = this.base.wall, at = (px, py) => W + this.base.drop + this.shape.H(px, py) * this.K, cx = x + 0.5, cz = y + 0.5;
    let arms = near.filter(([i, j]) => isWall(s.pieceAt(x + i, y + j)));
    if (!arms.length) arms = [[1, 0], [-1, 0]];
    if (p.kind === 'door') { const X = arms.some(a => a[0]); arms = arms.filter(a => (X ? a[0] : a[1])); if (arms.length === 1) arms.push(arms[0].map(v => -v)); }
    else if (arms.every(a => a[0]) || arms.every(a => a[1])) if (arms.length === 1) arms.push(arms[0].map(v => -v));
    for (const [i, j] of arms) {
      const p0 = [cx, 0, cz], p1 = [cx + i * 0.5, 0, cz + j * 0.5], h0 = at(p0[0], p0[2]), h1 = at(p1[0], p1[2]);
      if (Math.max(h0, h1) - W < 0.05) continue;
      const q = (o, h) => [o[0], h, o[2]];
      if (h0 - W > 0.01 && h1 - W > 0.01) this.G.quadN(q(p0, W), q(p1, W), q(p1, h1), q(p0, h0), [Math.abs(j), 0, Math.abs(i)], UV);
      else { const t = h0 > h1 ? q(p0, h0) : q(p1, h1); this.G.tri(q(p0, W), q(p1, W), t, [Math.abs(j), 0, Math.abs(i)], [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]); }
      this.bar(q(p1, W), q(p1, h1), 0.022, 0.022);
      stick(this.I, q(p0, h0), q(p1, h1), 0.03, 0.03);
    }
    stick(this.I, [cx, W, cz], [cx, at(cx, cz), cz], 0.02, 0.02);
  }
  addTo(group, pane, iron) {
    if (this.G.empty) return;
    const g = this.G.mesh(pane, { cast: false, receive: false }), i = this.I.mesh(iron);
    g.userData.glass = i.userData.glass = true;   // (their own materials: world3d.js neither fades them nor clones them)
    group.add(i, g);
  }
}

// ---------- the cloche ----------
// A blown bell of glass with its knob; n: which one, by the plant under it (greenhouse.js bellSize): its radius and its height
export const BELL_SIZE = [null, [0.3, 0.42], [0.42, 0.58], [0.37, 0.92], [0.42, 1.22], [0.42, 1.48], [0.48, 0.58], [0.48, 0.9]];
const BELLS = new Map();
function bellGeo(n) {
  if (BELLS.has(n)) return BELLS.get(n);
  const [r, h] = BELL_SIZE[n], pts = [[r * 1.04, 0], [r * 1.0, 0.015], [r * 0.985, h * 0.18], [r * 0.96, h * 0.45], [r * 0.9, h * 0.65], [r * 0.76, h * 0.82], [r * 0.5, h * 0.94], [r * 0.2, h * 0.99], [0.001, h]];
  const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 20), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.03 + 0.9 * uv.getY(i));   // (one edge: the rim)
  BELLS.set(n, g);
  return g;
}
export function cloche(m, size) {
  const n = BELL_SIZE[+size] ? +size : 1, [r, h] = BELL_SIZE[n];
  m.geo('pane', bellGeo(n), 0, 0.02, 0);
  m.geo('pane', RIM, 0, 0.026, 0, [Math.PI / 2, 0, 0], [r * 1.03, r * 1.03, 0.5]);
  m.geo('pane', NECK, 0, 0.02 + h, 0).geo('pane', KNOB, 0, 0.05 + h, 0);
}
const still = g => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.02, 0.5); return g; };
const RIM = still(new THREE.TorusGeometry(1, 0.03, 6, 24)), NECK = still(new THREE.CylinderGeometry(0.016, 0.028, 0.05, 10)), KNOB = still(new THREE.SphereGeometry(0.036, 12, 8));
