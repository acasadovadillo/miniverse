// The big map in three dimensions (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.8): the land in relief, from a slant, turnable. What
// is looked at and what there is on it is ui/map.js's (MapView: the middle, the scale, the tilt and the turn, the blips); this draws
// it, with the game's own renderer, into the game's own canvas (the world is not painted while the map is open: game.js render), and
// only when something in it changed: with the map still, not a frame is painted.
//   The land     one grid of N × N vertices, finer the closer (LEVELS), whose heights come from the ground worker (satpixels.js
//                satHeights); made again when the view goes near its edge. What is not explored is flat and slate, below the sea
//   Its picture  one texture that repeats (a chunk's place in it: its own, modulo): the same pictures and what is built on them as in
//                two dimensions (SatTexture, a MapGround): moving the map only paints the chunks that come in
//   On it        the roofs as blocks, the trees at the closest zoom, the route and the areas as ribbons (a mesh each), and the blips and
//                their names as elements of the page
// Flat (tilt 0) it looks just like the map in two dimensions, so that going from one to the other does not show: ui/map.js
// begins there, and the land rises as it tilts.
// Everything is given back when the map closes: the world's own memory is what it was.
// (?mapa3d=0, or no worker, ?sat=0, a cave, a graphics card that cannot: the map in two dimensions, ui/map.js canSolid)
import * as THREE from 'three';
import { CHUNK } from '../world/gen.js';
import { wrapIndex, wrapX, nearX } from '../world/planet.js';
import { NONE, TREE } from '../world/satpixels.js';
import { MapGround } from '../ui/mapground.js';
import { SAT } from '../ui/sattiles.js';
import { MAP_GLYPHS, svg } from '../ui/mapglyphs.js';
import { blips, blipScale } from '../ui/blips.js';
import { styleOf, FOG, GRID, OUTLINE } from '../ui/map.js';
import { accent } from '../ui/skin.js';
import { Settings } from '../settings.js';
import { getLang } from '../i18n.js';
import { rgbOf } from '../util.js';
import { opcion, apagada } from '../opciones.js';
import { reportFault } from '../faults.js';

export const MAP3D = SAT && !apagada('mapa3d');
export const N = 161;                  // vertices on each side: 51 200 triangles
const TEX = opcion('q') === 'low' ? 1024 : 2048;   // (its picture: 4 px per tile at 8 and 16 px, 2 at 4)
// By the scale it is going to (px per tile): tiles between two vertices, chunks on each side of the texture, how far the view may go from
// the middle of the mesh before it is made again, and how far the roofs reach
export const LEVELS = [{ px: 4, s: 6, nc: 64, far: 72, roofs: 300 }, { px: 8, s: 3, nc: 32, far: 30, roofs: 190 }, { px: 16, s: 2, nc: 32, far: 40, roofs: 120 }];
const levelOf = px => LEVELS[px >= 16 ? 2 : px >= 8 ? 1 : 0];
const FOV = 32, SLANT = 35 * Math.PI / 180;                      // (degrees of the lens: long, as a map; the pitch is 55° from the horizontal)
export const TALL = 1.6;                                          // how much the relief is exaggerated
const RISE_S = 0.3, SWAP_S = 0.6, FADE_S = 0.24, REST_S = 8;      // (s the land takes to rise when its heights come; at most, for the other picture; to fade from and to the flat map; until the memory goes back, once flat)
const FIRST_MS = 8, FRESH_MS = 4, NEAR_MAX = 780;                // (ms of a frame painting the chunks that come; how many satellite pictures at once: sattiles.js keeps 900)
const MASK = 256, EDGE = 0.03;                                    // (texels of what is explored; the rim of the mesh that fades out, of its side)
const BLIPS_MAX = 60, ROOFED = new Set(['home', 'house', 'tavern']);   // (their glyph on their roof)
const TREES = 3000, TREES_R = 80, TREES_KEEP = 260, TREE_FLYING = 4, TREE_STEP = 12;
const LIFT = 0.6, ROUTE_PX = 5, AREA_PX = 2;                      // (m over the ground; px wide)
const still = () => Settings.v.motion === 'reduced' || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), mod = (a, n) => a - n * Math.floor(a / n);
const vec3 = c => new THREE.Vector3(...rgbOf(c).map(v => v / 255));
const $ = id => document.getElementById(id);

// ---------- the picture of the land ----------
// The chunks painted in a frame go to the graphics card together: on a canvas, which is uploaded once and copied from there to their
// places, all in one drawing (written one by one into a texture in use, each of them costs a wait: 100-200 ms a frame)
const BATCH = 512, QUADS = 256;
class Batch {
  constructor(renderer, material) {
    this.renderer = renderer; this.material = material;
    this.cv = document.createElement('canvas');
    this.cv.width = this.cv.height = BATCH;
    this.g = this.cv.getContext('2d', { alpha: false, willReadFrequently: true });
    const T = (this.tex = new THREE.CanvasTexture(this.cv)), G = (this.geo = new THREE.BufferGeometry()), idx = new Uint16Array(QUADS * 6);
    T.flipY = false; T.generateMipmaps = false; T.magFilter = T.minFilter = THREE.NearestFilter;
    for (let i = 0; i < QUADS; i++) idx.set([0, 1, 2, 2, 1, 3].map(v => v + i * 4), i * 6);
    G.setAttribute('position', new THREE.BufferAttribute(new Float32Array(QUADS * 12), 3));
    G.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(QUADS * 8), 2));
    G.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(G, material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.camera = new THREE.Camera();
    this.n = 0; this.target = null; this.s = 0;
  }
  dispose() { this.tex.dispose(); this.geo.dispose(); this.material.uniforms.map.value = null; this.cv.width = this.cv.height = 1; }
  // Where to paint the next one, s px wide, that goes to (x, y) of the target: [g, x, y]
  place(target, s, x, y) {
    const cols = BATCH / s;
    if (this.n && (this.target !== target || this.s !== s || this.n >= Math.min(QUADS, cols * cols))) this.flush();
    this.target = target; this.s = s;
    const i = this.n++, bx = i % cols * s, by = Math.floor(i / cols) * s, P = this.geo.attributes.position, U = this.geo.attributes.uv;
    for (let k = 0; k < 4; k++) {
      const u = k & 1, v = k >> 1;
      P.setXYZ(i * 4 + k, (x + u * s) / target.width * 2 - 1, (y + v * s) / target.height * 2 - 1, 0);
      U.setXY(i * 4 + k, (bx + u * s) / BATCH, (by + v * s) / BATCH);
    }
    return [this.g, bx, by];
  }
  flush() {
    if (!this.n) return;
    const r = this.renderer;
    this.tex.needsUpdate = true;
    this.geo.attributes.position.needsUpdate = this.geo.attributes.uv.needsUpdate = true;
    this.geo.setDrawRange(0, this.n * 6);
    this.material.uniforms.map.value = this.tex;
    this.n = 0;
    r.setRenderTarget(this.target);
    r.autoClear = false;
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
  }
}
// The chunks round the view, painted by MapGround's own rules, in a texture that repeats; mask: where it is explored and
// painted, with a soft edge (inside: nothing of what is not explored ever shows through it)
class SatTexture extends MapGround {
  constructor(view, batch, nc) {
    super(view);
    this.batch = batch; this.nc = nc; this.px = TEX / nc / CHUNK;   // (px per tile)
    this.target = new THREE.WebGLRenderTarget(TEX, TEX, { depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
    this.tex = this.target.texture;
    this.mask = new THREE.DataTexture(new Uint8Array(MASK * MASK), MASK, MASK, THREE.RedFormat);
    this.mask.wrapS = this.mask.wrapT = THREE.RepeatWrapping; this.mask.magFilter = this.mask.minFilter = THREE.LinearFilter;
    this.mask.needsUpdate = true;
    this.grid = new Uint8Array(nc * nc);
    this.maskDirty = false; this.v = 0;
  }
  dispose() { this.free(); this.target.dispose(); this.mask.dispose(); }
  // Around (cx, cy): the same chunks, moved, or all of them again. Chunks come in as they enter; the rest stay as they are
  follow(gen, explored, cx, cy) {
    const n = this.nc, x0 = Math.floor(cx / CHUNK + 0.5) - n / 2, y0 = Math.floor(cy / CHUNK + 0.5) - n / 2, B = this.B;
    if (!B || B.gen !== gen || B.explored !== explored) {
      this.B = { gen, sat: true, fine: true, b: this.px, x0, y0, nx: n, ny: n, explored, n: -1, season: gen.season };
      this.cells = []; this.fresh = []; this.under = null; this.scanFrom = -1;
      this.list(FIRST_MS);
    } else if (Math.abs(B.x0 - x0) > 2 || Math.abs(B.y0 - y0) > 2) this.move(x0, y0);
    else if (B.n !== explored.size) this.list(FRESH_MS);
    if (B && B.season !== gen.season) B.season = gen.season;
    if (this.fresh.length) this.budget ||= FRESH_MS;
    this.paintFresh(gen);
    this.scan(gen);
    this.batch.flush();
    if (this.maskDirty) this.paintMask();
  }
  move(x0, y0) {
    const B = this.B, dx = B.x0 - x0, dy = B.y0 - y0, kept = [];
    B.x0 = x0; B.y0 = y0;
    for (const q of this.cells) { q.i += dx; q.j += dy; if (q.i >= 0 && q.j >= 0 && q.i < B.nx && q.j < B.ny) kept.push(q); }
    this.cells = kept;
    this.stats.moved++;
    this.list(FRESH_MS);
  }
  list(ms) {
    super.list(ms);
    // (the nearest, the satellite pictures; with more explored chunks than that round it, the small ones for the rest)
    const C = this.cells, B = this.B, far = q => (q.i + 0.5 - B.nx / 2) ** 2 + (q.j + 0.5 - B.ny / 2) ** 2;
    let most = Infinity;
    if (C.length > NEAR_MAX) most = Float64Array.from(C, far).sort()[NEAR_MAX];
    for (const q of C) { const near = far(q) < most; if (near && !q.near && !q.sharp) q.best = false; q.near = near; }
    if (most < Infinity) this.sign = '';
    this.maskDirty = true;
  }
  look(q, gen, again) {
    this.B.fine = q.near || !!q.sharp;
    super.look(q, gen, again);
    if (this.B.fine && q.best) q.sharp = true;
  }
  put(q, gen, pic, ov) {
    const n = this.nc, s = CHUNK * this.px;
    if (!pic) q.plain = false;
    const [g, x, y] = this.batch.place(this.target, s, mod(q.kx, n) * s, mod(q.ky, n) * s);
    this.fill(g, q, gen, pic, ov, x, y, s);
    if (this.view.built.src(q.kx, q.ky, q.key)) this.view.floodOver(g, this.B.explored, q.kx * CHUNK, q.ky * CHUNK, CHUNK, CHUNK, this.px, x, y);
    q.in = true;
    this.maskDirty = true;
  }
  paintMask() {
    this.maskDirty = false; this.v++;
    const n = this.nc, k = MASK / n, D = this.mask.image.data, G = this.grid, on = (i, j) => i >= 0 && j >= 0 && i < n && j < n && G[j * n + i];
    D.fill(0); G.fill(0);
    for (const q of this.cells) if (q.in) G[q.j * n + q.i] = 1;
    for (const q of this.cells) {
      if (!q.in) continue;
      const i = q.i, j = q.j, W = on(i - 1, j), E = on(i + 1, j), U = on(i, j - 1), S = on(i, j + 1), all = W && E && U && S && on(i - 1, j - 1) && on(i + 1, j - 1) && on(i - 1, j + 1) && on(i + 1, j + 1);
      const o = mod(q.ky, n) * k * MASK + mod(q.kx, n) * k;
      for (let v = 0; v < k; v++) for (let u = 0; u < k; u++) {
        if (!all) {
          const l = u === 0, r = u === k - 1, t = v === 0, b = v === k - 1;
          if ((l && !W) || (r && !E) || (t && !U) || (b && !S) || (l && t && !on(i - 1, j - 1)) || (r && t && !on(i + 1, j - 1)) || (l && b && !on(i - 1, j + 1)) || (r && b && !on(i + 1, j + 1))) continue;
        }
        D[o + v * MASK + u] = 255;
      }
    }
    this.mask.needsUpdate = true;
  }
}

// ---------- the materials (their programs stay when the map closes: opening it again compiles nothing) ----------
// Colours are the screen's own, as they are in the pictures: no light nor tone curve of the game
const GROUND_VS = `attribute float h; uniform vec2 uO; uniform float uS, uK; varying vec2 vW; varying vec2 vG; varying float vH; varying vec3 vP;
  void main() { vec3 p = vec3(uO.x + position.x * uS, h * uK, uO.y + position.y * uS); vG = position.xy / ${(N - 1).toFixed(1)}; vH = h; vW = p.xz; vP = p; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`;
const SLATE = `uniform vec3 uFog, uGrid; uniform float uLine;
  vec3 slate(vec2 w) { vec2 g = w / uLine, d = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), vec2(1e-5)); return mix(uFog, uGrid, 1.0 - min(1.0, min(d.x, d.y))); }`;
const GROUND_FS = `uniform sampler2D uMap, uMask; uniform vec2 uBase, uLo, uHi; uniform float uWin; uniform vec3 uCool, uGlint; varying vec2 vW; varying vec2 vG; varying float vH; varying vec3 vP;
  float hash(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float noise(vec2 p) { vec2 i = floor(p), f = p - i; f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
  ${SLATE}
  void main() {
    vec2 w = vW + uBase, uv = w / uWin, e = min(vG, 1.0 - vG), a = min(vW - uLo, uHi - vW);
    float m = texture2D(uMask, uv).r * smoothstep(0.0, ${EDGE}, min(e.x, e.y)) * step(0.0, min(a.x, a.y));
    vec3 c = texture2D(uMap, uv).rgb;
    float wet = smoothstep(0.05, 0.14, c.b - c.r) * (1.0 - smoothstep(0.1, 0.5, vH));
    if (wet > 0.0) {
      // (the water: the sky of a slant look, and where the light comes back from, broken by the waves)
      float a = noise(w * 0.35) + 0.5 * noise(w * 0.9 + 7.3), b = noise(w.yx * 0.31 + 3.7) + 0.5 * noise(w.yx * 0.83);
      vec3 v = normalize(cameraPosition - vP), n = normalize(vec3((a - 0.75) * 0.22, 1.0, (b - 0.75) * 0.22));
      float s = pow(max(0.0, dot(n, normalize(v + normalize(vec3(-0.5, 0.9, -0.55))))), 60.0), f = pow(1.0 - max(0.0, v.y), 2.0);
      c = mix(c, uCool * 0.8, wet * 0.55 * f) * (1.0 + wet * (a - 0.75) * 0.09) + wet * s * uGlint;
    }
    gl_FragColor = vec4(mix(slate(w), c, m), 1.0);
  }`;
const PLANE_VS = `uniform float uY; uniform vec2 uC; varying vec2 vW; void main() { vec3 p = vec3(uC.x + position.x, uY, uC.y + position.y); vW = p.xz; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`;
const PLANE_FS = `uniform vec2 uBase; varying vec2 vW; ${SLATE} void main() { gl_FragColor = vec4(slate(vW + uBase), 1.0); }`;
const ROOF_VS = `attribute vec3 color; varying vec3 vC; uniform float uK; attribute float base; void main() { vC = color; vec4 p = modelMatrix * vec4(position.x, (position.y + base) * uK, position.z, 1.0); gl_Position = projectionMatrix * viewMatrix * p; }`;
const COPY_VS = 'varying vec2 vU; void main() { vU = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const COPY_FS = 'uniform sampler2D map; varying vec2 vU; void main() { gl_FragColor = vec4(texture2D(map, vU).rgb, 1.0); }';
const FLAT_FS = 'varying vec3 vC; void main() { gl_FragColor = vec4(vC, 1.0); }';
const TREE_VS = `varying vec3 vC; uniform float uK;
  void main() { vec4 p = modelMatrix * instanceMatrix * vec4(position, 1.0); p.y *= uK; vC = instanceColor * color.x; gl_Position = projectionMatrix * viewMatrix * p; }`;
const LINE_VS = `attribute vec4 side; attribute vec4 tone; uniform float uPx, uK; varying vec4 vT; varying float vS, vD, vW;
  void main() { vT = tone; vS = side.z; vD = side.w; vW = tone.w > 2.5 ? ${(AREA_PX / 2).toFixed(1)} : ${(ROUTE_PX / 2 + 1).toFixed(1)}; vec3 p = vec3(position.x + side.x * side.z * vW * uPx, position.y * uK + ${LIFT} * (0.4 + uPx * 3.0), position.z + side.y * side.z * vW * uPx); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0); }`;
const LINE_FS = `uniform float uPx; uniform vec3 uOut; varying vec4 vT; varying float vS, vD, vW;
  void main() {
    float d = vD / uPx, across = abs(vS) * vW, style = vT.w;
    if (style > 2.5) { if (mod(d, 12.0) > 7.0) discard; }
    else if (style > 1.5) { if (mod(d, 20.0) > 11.7) discard; }
    else if (style > 0.5) { if (mod(d, 8.5) > 4.6) discard; }
    vec3 c = style < 2.5 && across > ${(ROUTE_PX / 2).toFixed(1)} ? uOut : vT.rgb;
    gl_FragColor = vec4(c, 1.0);
  }`;

// A tree, 1 m wide and 1 m tall: six sides, a crown over a narrow foot, its light already in its colour (from the north-west)
function treeGeometry() {
  const rings = [[0.02, 0.42], [0.3, 1], [0.68, 0.74]], pos = [], col = [], at = (k, i) => { const a = i / 6 * Math.PI * 2; return [Math.cos(a) * rings[k][1], rings[k][0], Math.sin(a) * rings[k][1]]; };
  const tri = (a, b, c) => {
    for (const p of [a, b, c]) {   // (from its middle outwards: round, not faceted)
      const n = new THREE.Vector3(p[0], (p[1] - 0.35) * 1.5, p[2]).normalize(), v = clamp(0.82 + 0.36 * (n.y * 0.7 - n.x * 0.5 - n.z * 0.5), 0.46, 1.2);
      pos.push(...p); col.push(v, v, v);
    }
  };
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 2; k++) { tri(at(k, i), at(k + 1, i), at(k, i + 1)); tri(at(k, i + 1), at(k + 1, i), at(k + 1, i + 1)); }
    tri(at(2, i), [0, 1, 0], at(2, i + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// The grid of the land: its vertices (i, j) and its triangles (made once)
let GRID_OF = null;
function gridOf() {
  if (GRID_OF) return GRID_OF;
  const pos = new Uint16Array(N * N * 3), idx = new Uint16Array((N - 1) * (N - 1) * 6);
  for (let j = 0, o = 0; j < N; j++) for (let i = 0; i < N; i++, o += 3) { pos[o] = i; pos[o + 1] = j; }
  for (let j = 0, o = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i; idx[o++] = a; idx[o++] = a + N; idx[o++] = a + 1; idx[o++] = a + 1; idx[o++] = a + N; idx[o++] = a + N + 1; }
  return (GRID_OF = [pos, idx]);
}

export class Map3D {
  constructor(view) {
    this.view = view;
    this.view3d = view.game.view3d;
    this.on = false; this.broken = false;
    this.scene = null;
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 100);
    this.frames = 0;                          // (how many it has painted)
    this.stats = { ms: 0, msMax: 0, meshes: 0, meshMs: 0 };
    this.ray = new THREE.Vector3(); this.tmp = new THREE.Vector3();
    this.box = document.createElement('div');
    this.box.id = 'map-3d';
    this.box.setAttribute('aria-hidden', 'true');
    $('bigmap').after(this.box);
    this.pool = [];
    this.gl = this.view3d.renderer.getContext();
    this.view3d.renderer.domElement.addEventListener('webglcontextlost', () => this.drop());
  }
  get squash() { return Math.cos(SLANT * this.view.tilt); }   // (how much shorter the land is up the screen than across)
  get settled() { return this.on && this.view.now - this.shownAt > FADE_S; }

  // ---------- made and given back ----------
  materials() {
    if (this.mats) return this.mats;
    const fog = { uFog: { value: vec3(FOG) }, uGrid: { value: vec3(GRID) }, uLine: { value: CHUNK }, uBase: { value: new THREE.Vector2() } };
    const K = (this.K = { value: 0 });
    const M = (this.mats = {
      ground: new THREE.ShaderMaterial({ uniforms: { ...fog, uK: K, uO: { value: new THREE.Vector2() }, uS: { value: 1 }, uMap: { value: null }, uMask: { value: null }, uLo: { value: new THREE.Vector2() }, uHi: { value: new THREE.Vector2() }, uWin: { value: 512 }, uCool: { value: vec3('#7fd6d0') }, uGlint: { value: new THREE.Vector3(0.2, 0.23, 0.24) } }, vertexShader: GROUND_VS, fragmentShader: GROUND_FS }),
      plane: new THREE.ShaderMaterial({ uniforms: { ...fog, uY: { value: 0 }, uC: { value: new THREE.Vector2() } }, vertexShader: PLANE_VS, fragmentShader: PLANE_FS, side: THREE.DoubleSide }),
      roof: new THREE.ShaderMaterial({ uniforms: { uK: K }, vertexShader: ROOF_VS, fragmentShader: FLAT_FS, side: THREE.DoubleSide }),
      tree: new THREE.ShaderMaterial({ uniforms: { uK: K }, vertexShader: TREE_VS, fragmentShader: FLAT_FS, vertexColors: true }),
      copy: new THREE.ShaderMaterial({ uniforms: { map: { value: null } }, vertexShader: COPY_VS, fragmentShader: COPY_FS, depthTest: false, depthWrite: false }),
      line: new THREE.ShaderMaterial({ uniforms: { uK: K, uPx: { value: 1 }, uOut: { value: vec3(OUTLINE) } }, vertexShader: LINE_VS, fragmentShader: LINE_FS, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }),
    });
    return M;
  }
  make() {
    if (this.scene) return;
    const M = this.materials(), S = (this.scene = new THREE.Scene()), [pos, idx] = gridOf();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('h', new THREE.BufferAttribute(new Float32Array(N * N).fill(NONE), 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const add = (o, order) => { o.frustumCulled = false; o.renderOrder = order; S.add(o); return o; };
    this.ground = add(new THREE.Mesh(g, M.ground), 0);
    const p = new THREE.BufferGeometry();
    p.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-6e3, -6e3, 0, 6e3, -6e3, 0, -6e3, 6e3, 0, 6e3, 6e3, 0]), 3));
    p.setIndex([0, 2, 1, 1, 2, 3]);
    this.plane = add(new THREE.Mesh(p, M.plane), 4);   // (after the land: what it covers is not painted)
    this.roofs = add(new THREE.Mesh(new THREE.BufferGeometry(), M.roof), 1);
    this.lines = add(new THREE.Mesh(new THREE.BufferGeometry(), M.line), 3);
    this.roofs.visible = this.lines.visible = false;
    this.grid = null;         // { x0, y0, s, h, gen, n (explored then) }: what is in the mesh
    this.pending = 0; this.failed = 0; this.failedAt = -1e9;
    this.origin = new THREE.Vector2();   // (the scene's own (0, 0), in tiles)
    this.hc = 0; this.rise = 0; this.riseAt = null;
    this.gridV = 0; this.roofKey = this.lineKey = this.key = this.domKey = '';
    this.woods = null;
    this.cur = this.next = null;
    this.batch = new Batch(this.view3d.renderer, M.copy);
    this.compiled = false;
  }
  // Its programs, asked for beforehand (with the map flat meanwhile): nothing waits for them
  programs() {
    if (this.compiled || this.broken) return this.compiled;
    const r = this.view3d.renderer;
    try {
      if (!this.asked) {
        const w = this.woodsMesh(1), was = [this.roofs.visible, this.lines.visible];
        this.roofs.visible = this.lines.visible = w.visible = true;
        r.compile(this.scene, this.camera);
        [this.roofs.visible, this.lines.visible] = was;
        // (the copy's, as it is in a texture: its program is another)
        const rt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
        r.setRenderTarget(rt); r.compile(this.batch.scene, this.batch.camera); r.setRenderTarget(null);
        rt.dispose();
        this.scene.remove(w); w.geometry.dispose(); w.dispose();
        this.asked = true;
      }
      const P = Object.values(this.mats).map(m => r.properties.get(m).currentProgram);
      if (!P.every(p => p && p.isReady())) return false;
      for (const p of P) if (!this.gl.getProgramParameter(p.program, this.gl.LINK_STATUS)) throw new Error('a program of the 3D map does not link');
      this.compiled = true;
    } catch (e) { this.broken = true; reportFault(e, 'Map3D.programs'); }
    return this.compiled;
  }
  // Wanted, but not on the screen yet: what it needs, asked for. True: it can be shown
  prepare(V) {
    if (this.broken || this.gl.isContextLost()) return false;
    this.make();
    if (!this.programs()) return false;
    this.askMesh(V);
    return true;
  }
  show() {
    this.on = true;
    this.shownAt = this.view.now; this.hc = 0; this.rise = this.grid && !this.grid.flat ? 1 : 0; this.riseAt = null;
    this.key = this.domKey = '';
    const c = $('s-pause').classList;
    clearTimeout(this.outTimer);
    c.remove('map3d-out'); c.add('map3d');
    this.clear(true);
  }
  // What lies between the game's canvas and the pause (what floats over the world, the HUD's leftovers): the flat map covers it; here it
  // is hidden meanwhile
  clear(on) {
    for (const el of document.querySelectorAll('.under-map')) el.classList.remove('under-map');
    if (!on) return;
    const P = $('s-pause'), at = el => +getComputedStyle(el).zIndex || 0, z = at(P);
    for (const el of document.body.children) if (el !== P && el.id !== 'c' && el.tagName !== 'SCRIPT') { const q = at(el); if (q < z || (q === z && el.compareDocumentPosition(P) & Node.DOCUMENT_POSITION_FOLLOWING)) el.classList.add('under-map'); }
  }
  hide() {
    if (!this.on) return;
    this.on = false;
    this.offAt = this.view.now;
    const c = $('s-pause').classList;
    c.remove('map3d'); c.add('map3d-out');
    clearTimeout(this.outTimer);
    this.outTimer = setTimeout(() => { c.remove('map3d-out'); this.clear(false); }, FADE_S * 1000);
    for (const el of this.pool) this.put(el, null);
  }
  // Flat for a while: its memory goes back
  rest(now) { if (this.scene && !this.on && now - (this.offAt ?? now) > REST_S) this.free(); }
  free() {
    if (!this.scene) return;
    for (const o of [this.ground, this.plane, this.roofs, this.lines]) o.geometry.dispose();
    this.dropWoods();
    this.cur?.dispose(); this.next?.dispose(); this.batch.dispose();
    this.batch = this.cur = this.next = this.scene = this.ground = this.plane = this.roofs = this.lines = this.grid = null;
    for (const M of Object.values(this.mats)) for (const u of [M.uniforms.uMap, M.uniforms.uMask]) if (u) u.value = null;
    this.box.replaceChildren(); this.pool = [];
  }
  // The map was closed: the canvas is the world's again
  close() {
    const was = this.on;
    this.on = false;
    clearTimeout(this.outTimer);
    $('s-pause').classList.remove('map3d', 'map3d-out');
    this.clear(false);
    this.free();
    const v = this.view3d;
    if (was || this.painted) v.redraw = true;
    this.painted = false;
  }
  // (the graphics card lost what it had)
  drop() { this.hide(); this.free(); this.asked = this.compiled = false; }
  // What it holds, for F3, the tests and the bench
  get memory() { return this.scene ? { tex: ((this.cur ? 1 : 0) + (this.next ? 1 : 0)) * (TEX * TEX * 4 + MASK * MASK) + BATCH * BATCH * 4, geo: N * N * (6 + 4) + (N - 1) ** 2 * 12 } : { tex: 0, geo: 0 }; }

  // ---------- the land ----------
  // Its heights, when the view is near the edge of what it has, closer or farther, or more is explored
  askMesh(V) {
    const L = levelOf(V.to), now = this.view.now, half = (N - 1) / 2;
    let G = this.grid;
    // (nothing of this place yet: flat, so that its picture shows, and it rises when the heights come)
    if (!G || G.gen !== V.gen || Math.max(Math.abs(nearX(V.cx, G.cx) - G.cx), Math.abs(V.cy - G.cy)) > half * G.s * 0.7) { this.flatten(V, L.s); G = this.grid; }
    if (this.pending || now - this.failedAt < 2) return;
    if (!G.flat && G.s === L.s && G.n === V.explored.size && Math.max(Math.abs(nearX(V.cx, G.cx) - G.cx), Math.abs(V.cy - G.cy)) < L.far) return;
    if (!G.flat && G.s === L.s && G.n !== V.explored.size && now - G.at < 1 && Math.hypot(nearX(V.cx, G.cx) - G.cx, V.cy - G.cy) < L.far) return;   // (while exploring: once a second)
    const s = L.s, cx = Math.round(V.cx / s) * s, cy = Math.round(V.cy / s) * s, x0 = cx - half * s, y0 = cy - half * s;
    const mx = Math.floor(x0 / CHUNK), my = Math.floor(y0 / CHUNK), mw = Math.floor((x0 + (N - 1) * s) / CHUNK) - mx + 1, mh = Math.floor((y0 + (N - 1) * s) / CHUNK) - my + 1, seen = new Uint8Array(mw * mh);
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) if (V.explored.has(`${wrapIndex(mx + i, CHUNK)},${my + j}`)) seen[j * mw + i] = 1;
    const gen = V.gen, n = V.explored.size, T = this.view3d.terrain, made = this.scene;
    this.pending = T.askMap('satmesh', gen, Math.floor(wrapX(cx) / CHUNK), Math.floor(cy / CHUNK), -5e5, { x0, y0, s, n: N, mx, my, mw, mh, seen }, m => {
      if (made !== this.scene) return;   // (closed meanwhile)
      this.pending = 0;
      if (!m) { this.failedAt = this.view.now; if (++this.failed > 4) this.broken = true; return; }
      this.failed = 0;
      this.stats.meshes++; this.stats.meshMs = m.ms;
      this.take({ x0, y0, s, cx, cy, h: m.data, gen, n, at: this.view.now });
    });
    if (!this.pending) this.failedAt = now;
  }
  flatten(V, s) {
    const cx = Math.round(V.cx / s) * s, cy = Math.round(V.cy / s) * s, half = (N - 1) / 2;
    this.take({ x0: cx - half * s, y0: cy - half * s, s, cx, cy, h: new Float32Array(N * N), gen: V.gen, n: -1, at: this.view.now, flat: true });
    this.rise = 0; this.riseAt = null; this.hc = 0;
  }
  take(G) {
    const was = this.grid;
    this.grid = G;
    const a = this.ground.geometry.attributes.h;
    a.array.set(G.h); a.needsUpdate = true;
    this.origin.set(G.cx, G.cy);
    const U = this.mats.ground.uniforms;
    U.uO.value.set(G.x0 - G.cx, G.y0 - G.cy); U.uS.value = G.s;
    U.uBase.value.set(mod(G.cx, 1024), mod(G.cy, 1024));   // (shared with the plane: the grid's lines, and the picture, which repeats in 512 or 1024)
    if (was?.flat && !G.flat) this.riseAt = this.view.now;
    this.gridV++;
  }
  // The land's height at (x, y) as it is drawn, not exaggerated (NONE where nothing is known)
  heightAt(x, y) {
    const G = this.grid;
    if (!G) return 0;
    const u = (nearX(x, G.cx) - G.x0) / G.s, v = (y - G.y0) / G.s, i = Math.floor(u), j = Math.floor(v);
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return NONE;
    const a = u - i, b = v - j, q = j * N + i, H = G.h;
    return a + b <= 1 ? H[q] + (H[q + 1] - H[q]) * a + (H[q + N] - H[q]) * b : H[q + N + 1] + (H[q + N] - H[q + N + 1]) * (1 - a) + (H[q + 1] - H[q + N + 1]) * (1 - b);
  }
  // Its picture, of the size the scale asks for; another one is painted whole before it takes the place of the last
  followPicture(V) {
    const L = levelOf(V.to);
    if (!this.cur) this.cur = new SatTexture(this.view, this.batch, L.nc);
    if (this.cur.nc !== L.nc && this.next?.nc !== L.nc) { this.next?.dispose(); this.next = new SatTexture(this.view, this.batch, L.nc); this.nextAt = this.view.now; }
    if (this.next && this.cur.nc === L.nc) { this.next.dispose(); this.next = null; }
    this.cur.follow(V.gen, V.explored, V.cx, V.cy);
    if (this.next) {
      this.next.follow(V.gen, V.explored, V.cx, V.cy);
      if (!this.next.fresh.length || this.view.now - this.nextAt > SWAP_S) { this.cur.dispose(); this.cur = this.next; this.next = null; }
    }
    const P = this.cur, U = this.mats.ground.uniforms, B = P.B, G = this.grid;
    U.uMap.value = P.tex; U.uMask.value = P.mask; U.uWin.value = P.nc * CHUNK;
    { const x = nearX(B.x0 * CHUNK, G.cx - P.nc * CHUNK / 2) - G.cx, y = B.y0 * CHUNK - G.cy; U.uLo.value.set(x, y); U.uHi.value.set(x + P.nc * CHUNK, y + P.nc * CHUNK); }
  }

  // ---------- what stands on it ----------
  // The roofs near the middle as blocks: four walls and a hipped roof, their light in their colour
  putRoofs(V) {
    const R = levelOf(V.to).roofs, B = this.view.built, k = `${Math.floor(V.cx / 24)},${Math.floor(V.cy / 24)}|${R}|${B.v}|${V.explored.size}|${this.gridV}`;
    if (k === this.roofKey && this.view.now < this.roofAgain) return;
    B.begin(4);
    const seen = (x, y) => V.explored.has(`${wrapIndex(Math.floor(x / CHUNK), CHUNK)},${Math.floor(y / CHUNK)}`);
    const list = B.footprints(V.cx - R - 24, V.cy - R - 24, V.cx + R + 24, V.cy + R + 24).filter(q => seen((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2));
    this.roofAgain = B.pending ? this.view.now + 0.1 : Infinity;
    this.roofKey = `${Math.floor(V.cx / 24)},${Math.floor(V.cy / 24)}|${R}|${B.v}|${V.explored.size}|${this.gridV}`;
    const sign = list.map(q => `${q.x0},${q.y0},${q.x1},${q.y1},${q.h},${q.color}`).join('|') + this.gridV;
    if (sign === this.roofSign) return;
    this.roofSign = sign;
    const pos = [], col = [], base = [], ox = this.origin.x, oy = this.origin.y;
    const tri = (b, c, ...p) => { for (const [x, y, z] of p) { pos.push(x, y, z); col.push(...c); base.push(b); } };
    const quad = (b, c, p, q, r, s) => { tri(b, c, p, q, r); tri(b, c, p, r, s); };
    for (const q of list) {
      const c = q.color.match(/\d+/g).map(v => v / 255), x0 = nearX(q.x0, ox) - ox, x1 = x0 + q.x1 - q.x0, z0 = q.y0 - oy, z1 = q.y1 - oy, W = x1 - x0, D = z1 - z0;
      let b = 0;
      for (const [u, v] of [[0, 0], [W, 0], [0, D], [W, D], [W / 2, D / 2]]) b += Math.max(0, this.heightAt(q.x0 + u, q.y0 + v)) / 5;
      const wall = [0.62, 0.55, 0.45], shade = (s, t = c) => t.map(v => Math.min(1, v * s)), h = q.h * 0.85, o = 0.35, m = Math.min(W, D) / 2 + o, top = h + Math.min(2.4, m * 0.45), e = m * 0.5;
      const a0 = x0 + 0.1, a1 = x1 - 0.1, d0 = z0 + 0.1, d1 = z1 - 0.1, lo = -2.5;
      quad(b, shade(1.02, wall), [a0, lo, d0], [a0, h, d0], [a1, h, d0], [a1, lo, d0]);
      quad(b, shade(0.66, wall), [a1, lo, d1], [a1, h, d1], [a0, h, d1], [a0, lo, d1]);
      quad(b, shade(1.06, wall), [a0, lo, d1], [a0, h, d1], [a0, h, d0], [a0, lo, d0]);
      quad(b, shade(0.72, wall), [a1, lo, d0], [a1, h, d0], [a1, h, d1], [a1, lo, d1]);
      const X0 = x0 - o, X1 = x1 + o, Z0 = z0 - o, Z1 = z1 + o, g = h - 0.15, wide = W >= D, A = wide ? [X0 + e, top, (Z0 + Z1) / 2] : [(X0 + X1) / 2, top, Z0 + e], C = wide ? [X1 - e, top, (Z0 + Z1) / 2] : [(X0 + X1) / 2, top, Z1 - e];
      const nw = [X0, g, Z0], ne = [X1, g, Z0], se = [X1, g, Z1], sw = [X0, g, Z1];
      if (wide) { quad(b, shade(1.16), nw, A, C, ne); quad(b, shade(0.8), se, C, A, sw); tri(b, shade(1.08), sw, A, nw); tri(b, shade(0.86), ne, C, se); }
      else { quad(b, shade(1.16), sw, C, A, nw); quad(b, shade(0.8), ne, A, C, se); tri(b, shade(1.08), nw, A, ne); tri(b, shade(0.86), se, C, sw); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('base', new THREE.Float32BufferAttribute(base, 1));
    this.roofs.geometry.dispose();
    this.roofs.geometry = g;
    this.roofs.visible = pos.length > 0;
    this.roofCount = list.length;
    this.key = '';
  }
  // The trees, at the closest zoom only: those of the explored chunks round the middle, as they come from the worker
  woodsMesh(n) {
    const m = new THREE.InstancedMesh(treeGeometry(), this.mats.tree, n);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    m.count = 0; m.frustumCulled = false; m.renderOrder = 2;
    this.scene.add(m);
    return m;
  }
  dropWoods() {
    const W = this.woods;
    if (!W) return;
    this.woods = null;
    this.scene.remove(W.mesh); W.mesh.geometry.dispose(); W.mesh.dispose();
  }
  putWoods(V) {
    if (levelOf(V.to).px < 16 || V.px < 9) { if (this.woods) { if (V.to < 16 && V.px <= V.to) this.dropWoods(); else if (this.woods.mesh.visible) { this.woods.mesh.visible = false; this.key = ''; } } return; }
    const W = (this.woods ||= { mesh: this.woodsMesh(TREES), kept: new Map(), flying: new Map(), list: [], at: null, v: 0, gridV: -1, dirty: true, doneAt: 0, season: V.gen.season, gen: V.gen });
    if (W.gen !== V.gen || W.season !== V.gen.season) { W.kept.clear(); W.gen = V.gen; W.season = V.gen.season; W.dirty = true; W.at = null; }
    if (!W.mesh.visible) { W.mesh.visible = true; this.key = ''; }
    const gen = V.gen;
    if (!W.at || Math.hypot(nearX(V.cx, W.at[0]) - W.at[0], V.cy - W.at[1]) > TREE_STEP || W.n !== V.explored.size) {
      W.at = [V.cx, V.cy]; W.n = V.explored.size; W.dirty = true;
      const r = Math.ceil(TREES_R / CHUNK), px = Math.floor(V.cx / CHUNK), py = Math.floor(V.cy / CHUNK);
      W.list = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const kx = wrapIndex(px + dx, CHUNK), ky = py + dy, k = `${kx},${ky}`, d = Math.hypot((px + dx + 0.5) * CHUNK - V.cx, (ky + 0.5) * CHUNK - V.cy);
        if (d < TREES_R && V.explored.has(k)) W.list.push({ k, kx, ky, x: (px + dx) * CHUNK, d });
      }
      W.list.sort((a, b) => a.d - b.d);
    }
    for (const q of W.list) {
      if (W.flying.size >= TREE_FLYING) break;
      if (W.kept.has(q.k) || W.flying.has(q.k)) continue;
      const world = this.view.world, gone = [], d = world?.deltas?.get(q.k)?.removed, clear = this.view.game.places?.clearings?.(q.kx, q.ky), data = { season: gen.season };
      if (d) for (const k of Object.keys(d)) gone.push(k);
      if (gone.length) data.gone = gone;
      if (clear?.length) data.clear = clear;
      const id = this.view3d.terrain.askMap('sattrees', gen, q.kx, q.ky, 3e5 + q.d, data, m => {
        W.flying.delete(q.k);
        if (this.woods !== W || W.gen !== gen) return;
        W.kept.set(q.k, m?.data || new Float32Array(0));
        if (W.kept.size > TREES_KEEP) W.kept.delete(W.kept.keys().next().value);
        W.dirty = true;
      });
      if (!id) break;
      W.flying.set(q.k, id);
    }
    if (W.gridV !== this.gridV) { W.gridV = this.gridV; W.dirty = true; W.doneAt = 0; }
    if (!W.dirty || (W.flying.size && this.view.now - W.doneAt < 0.15)) return;
    W.dirty = false; W.doneAt = this.view.now;
    const M = W.mesh, A = M.instanceMatrix.array, C = M.instanceColor.array, ox = this.origin.x, oy = this.origin.y;
    let n = 0;
    for (const q of W.list) {
      const T = W.kept.get(q.k);
      if (!T) continue;
      for (let i = 0; i < T.length && n < TREES; i += TREE, n++) {
        const x = q.x + T[i], y = q.ky * CHUNK + T[i + 1], r = T[i + 2], h = T[i + 3], c = T[i + 4], cone = T[i + 5] === 1, o = n * 16, k = cone ? 0.85 : 1;
        A.fill(0, o, o + 16);
        A[o] = r * k; A[o + 5] = h / TALL; A[o + 10] = r * k; A[o + 12] = nearX(x, ox) - ox; A[o + 13] = Math.max(0, this.heightAt(x, y)) - 0.1; A[o + 14] = y - oy; A[o + 15] = 1;
        C[n * 3] = (c >> 16) / 255; C[n * 3 + 1] = ((c >> 8) & 255) / 255; C[n * 3 + 2] = (c & 255) / 255;
      }
      if (n >= TREES) break;
    }
    M.count = n;
    M.instanceMatrix.needsUpdate = M.instanceColor.needsUpdate = true;
    W.v++;
  }
  // The marked route, on the ground, from where you are on it, and the areas' rings
  putLines(V) {
    const R = this.view.route, rings = this.rings || [], k = `${V.stamp}|${R?.active ? R.seg : ''}|${this.gridV}|${accent.route}|${rings.map(b => `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.r},${b.color}`).join(';')}`;
    if (k === this.lineKey) return;
    this.lineKey = k;
    this.key = '';
    const G = this.grid, pos = [], side = [], tone = [], idx = [], ox = this.origin.x, oy = this.origin.y, reach = (N - 1) / 2 * G.s;
    // A line through points (x, y), in steps no longer than the mesh's: style 0 solid, 1 dots, 2 dashes, 3 an area's
    const line = (P, styles, rgb) => {
      const n = P.length >> 1, Q = [];
      for (let i = 0; i < n - 1; i++) {
        const ax = P[i * 2], ay = P[i * 2 + 1], bx = ax + (nearX(P[i * 2 + 2], ax) - ax), by = P[i * 2 + 3], L = Math.hypot(bx - ax, by - ay);
        if (Math.min(Math.abs(nearX(ax, ox) - ox), Math.abs(nearX(bx, ox) - ox)) > reach + 60 || Math.min(Math.abs(ay - oy), Math.abs(by - oy)) > reach + 60) { if (Q.length && Q[Q.length - 1]) Q.push(null); continue; }
        const m = Math.max(1, Math.ceil(L / G.s)), st = styles(i);
        for (let u = 0; u < m; u++) Q.push([ax + (bx - ax) * u / m, ay + (by - ay) * u / m, st]);
        if (i === n - 2) Q.push([bx, by, st]);
      }
      let d = 0;
      for (let i = 0; i < Q.length; i++) {
        const q = Q[i];
        if (!q) { d = 0; continue; }
        const p = Q[i - 1] || null, s = Q[i + 1] || null, f = p || q, t = s || q, dx = nearX(t[0], f[0]) - f[0], dy = t[1] - f[1], l = Math.hypot(dx, dy) || 1;
        if (p) d += Math.hypot(nearX(q[0], p[0]) - p[0], q[1] - p[1]);
        const b = pos.length / 3, x = nearX(q[0], ox) - ox, h = this.heightAt(q[0], q[1]);
        for (const e of [-1, 1]) { pos.push(x, h, q[1] - oy); side.push(-dy / l, dx / l, e, d); tone.push(...rgb, q[2]); }
        if (p) idx.push(b - 2, b - 1, b, b, b - 1, b + 1);
      }
    };
    const col = c => rgbOf(c).map(v => v / 255);
    if (R?.active) line(R.pts.subarray ? R.pts.subarray(R.seg * 2) : R.pts.slice(R.seg * 2), i => styleOf(R.kinds[i + R.seg], R.kinds[i + R.seg + 1]), col(accent.route));
    for (const b of rings) { const P = []; for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; P.push(b.x + Math.cos(a) * b.r, b.y + Math.sin(a) * b.r); } line(P, () => 3, col(b.color)); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('side', new THREE.Float32BufferAttribute(side, 4));
    g.setAttribute('tone', new THREE.Float32BufferAttribute(tone, 4));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    this.lines.geometry.dispose();
    this.lines.geometry = g;
    this.lines.visible = idx.length > 0;
  }

  // ---------- the camera ----------
  // Over the middle, at the distance where a tile there is px wide on the screen; the middle of the land it looks at is its
  // own height, so that what is in the middle of the map is in the middle of the screen
  place(V) {
    const c = this.camera, th = SLANT * V.tilt, d = V.h / 2 / Math.tan(FOV * Math.PI / 360) / V.px, sx = Math.sin(V.yaw), sy = Math.cos(V.yaw);
    const x = nearX(V.cx, this.origin.x) - this.origin.x, z = V.cy - this.origin.y, y = this.hc * this.K.value;
    c.aspect = V.w / V.h; c.near = Math.max(1, d * 0.15); c.far = d * 4 + 200;
    c.position.set(x - sx * d * Math.sin(th), y + d * Math.cos(th), z + sy * d * Math.sin(th));
    c.up.set(sx, 0, -sy);
    c.lookAt(x, y, z);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    this.V = V;
  }
  // The land's own point under (sx, sy) of the screen: the ray, down to the relief ([x, y] in tiles, x inside the planet)
  pick(sx, sy) {
    const V = this.V;
    if (!V) return null;
    const o = this.camera.position, d = this.aim(sx, sy), K = this.K.value;
    const at = t => { const x = o.x + d.x * t + this.origin.x, y = o.z + d.z * t + this.origin.y; return o.y + d.y * t - this.heightAt(x, y) * K; };
    const end = (o.y - NONE * K + 0.01) / -d.y, top = Math.max(0, (o.y - 60 * K - 1) / -d.y), steps = 96;
    let a = top, b = end;
    if (K > 0) for (let i = 1; i <= steps; i++) { const t = top + (end - top) * i / steps; if (at(t) <= 0) { b = t; break; } a = t; }
    if (K > 0) for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (at(m) <= 0) b = m; else a = m; }
    return [wrapX(o.x + d.x * b + this.origin.x), o.z + d.z * b + this.origin.y];
  }
  aim(sx, sy) {
    const V = this.V, d = this.ray.set(sx / V.w * 2 - 1, -(sy / V.h * 2 - 1), 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    if (d.y > -0.05) d.y = -0.05;
    return d;
  }
  // From the middle to what is under a point of the screen, on the level of the middle (or y), in tiles
  floor(sx, sy, y = this.hc * this.K.value) {
    if (!this.V) return null;
    const o = this.camera.position, d = this.aim(sx, sy), t = (o.y - y) / -d.y;
    return [o.x + d.x * t - (nearX(this.V.cx, this.origin.x) - this.origin.x), o.z + d.z * t - (this.V.cy - this.origin.y)];
  }
  // What the land moves when it is dragged from one point of the screen to another
  drag(from, to) {
    const p = this.pick(...from);
    if (!p) return null;
    const y = this.heightAt(p[0], p[1]) * this.K.value, a = this.floor(...from, y), b = this.floor(...to, y);
    return [a[0] - b[0], a[1] - b[1]];
  }
  project(x, y, up = 0) {
    const V = this.V, p = this.tmp.set(nearX(x, this.origin.x) - this.origin.x, (Math.max(NONE, this.heightAt(x, y)) + up) * this.K.value, y - this.origin.y).project(this.camera);
    return p.z > 1 || p.z < -1 ? null : [(p.x + 1) / 2 * V.w, (1 - p.y) / 2 * V.h];
  }

  // ---------- a frame of the map ----------
  frame(V) {
    if (this.gl.isContextLost()) { this.hide(); return; }
    const t0 = performance.now(), now = this.view.now, v = this.view3d, r = v.renderer;
    try {
      this.askMesh(V);
      this.followPicture(V);
      if (this.riseAt !== null) { this.rise = still() ? 1 : clamp((now - this.riseAt) / RISE_S, 0, 1); if (this.rise >= 1) this.riseAt = null; }
      const e = this.rise * this.rise * (3 - 2 * this.rise);
      this.K.value = TALL * e * V.tilt;
      const hc = Math.max(0, this.heightAt(V.cx, V.cy)), step = still() ? 1 : 1 - Math.exp(-Math.min(0.1, now - (this.lastAt || now)) * 9);
      this.lastAt = now;
      this.hc = Math.abs(hc - this.hc) < 0.02 ? hc : this.hc + (hc - this.hc) * step;
      this.place(V);
      this.putRoofs(V); this.putWoods(V);
      this.rings = [];
      for (const b of blips.list) if (b.r && blips.shown(b)) this.rings.push(b);
      this.putLines(V);
      const c = r.domElement, cam = `${V.cx.toFixed(3)},${V.cy.toFixed(3)}|${V.px.toFixed(4)}|${V.yaw.toFixed(5)}|${V.tilt.toFixed(5)}|${this.hc.toFixed(3)}|${this.K.value.toFixed(4)}|${V.w}x${V.h}|${this.gridV}`;
      const key = `${cam}|${c.width}x${c.height}|${this.cur.tex.id}|${this.cur.v}|${this.cur.stats.painted}|${this.woods ? this.woods.v : ''}|${v.drawn}`;
      if (key !== this.key) { this.key = key; this.paint(V); }
      this.spots(V, cam);
    } catch (e) { this.broken = true; reportFault(e, 'Map3D.frame'); }
    const ms = performance.now() - t0;
    this.stats.ms = ms; this.stats.msMax = Math.max(this.stats.msMax, ms);
  }
  // (something else was painted on the canvas)
  touch() { this.key = ''; }
  paint(V) {
    const r = this.view3d.renderer, M = this.mats, U = M.ground.uniforms;
    // (the land's grid: a line every chunk, or every few, as in two dimensions)
    let n = CHUNK;
    while (n * V.px < 24) n *= 2;
    U.uLine.value = n;
    M.plane.uniforms.uY.value = NONE * this.K.value - 0.1 - V.tilt * 0.2;
    M.plane.uniforms.uC.value.set(nearX(V.cx, this.origin.x) - this.origin.x, V.cy - this.origin.y);
    M.line.uniforms.uPx.value = 1 / V.px;
    r.setRenderTarget(null);
    r.setClearColor(FOG);
    r.autoClear = true;
    r.info.reset();
    r.render(this.scene, this.camera);
    this.info = { calls: r.info.render.calls, triangles: r.info.render.triangles };
    r.info.reset();
    this.frames++;
    this.painted = true;
  }
  // The blips and their names, elements of the page over the canvas: where they are on the screen, written only if it is another place
  spots(V, cam) {
    const MV = this.view, F = MV.face, k = `${cam}|${blips.v}|${V.stamp}|${accent.v}|${Settings.v.blipSize}|${getLang()}|${MV.me[0].toFixed(1)},${MV.me[1].toFixed(1)}|${F ? Math.round(Math.atan2(F.y, F.x) * 36 / Math.PI) : ''}`;
    if (k === this.domKey) return;
    this.domKey = k;
    const { shown, labels } = MV.layout(MV.spotList().spots, q => this.project(q.x, q.y, (q.z || 0) + (ROOFED.has(q.kind) ? 3.4 : 0)), V.px, V.w, V.h, BLIPS_MAX), name = new Map(labels.map(l => [l.q, l])), K = blipScale();
    shown.forEach((q, i) => this.put(this.pool[i] || this.blip(), q, name.get(q), K, shown.length - i));
    for (let i = shown.length; i < this.pool.length; i++) this.put(this.pool[i], null);
  }
  blip() {
    const el = document.createElement('div'), face = document.createElement('i'), label = document.createElement('b');
    el.append(face, label);
    Object.assign(el, { face, label });
    this.box.append(el);
    this.pool.push(el);
    return el;
  }
  put(el, q, l, K = 1, z = 0) {
    if (!q) { if (el.said !== '') { el.said = ''; el.style.display = 'none'; } return; }
    const pin = q.pin ? q.size * 0.55 * K : 0, s = `${q.kind}|${q.glyph}|${q.col}|${q.size}|${q.dim ? 1 : 0}|${q.dir ? 1 : 0}|${pin}|${l ? q.name : ''}`;
    if (el.said !== s) {
      if (!el.said) el.style.display = '';
      el.said = s;
      el.className = q.dir ? 'you' : pin ? 'pin' : q.dim ? 'dim' : '';
      if (q.dir) el.face.innerHTML = '<svg viewBox="-12 -12 24 24"><path d="M10 0-8 7.800-3.500 0-8-7.800z" fill="#fff" stroke="#120a10" stroke-width="1.500" stroke-linejoin="round" paint-order="stroke"/></svg>';
      else if (pin) el.face.innerHTML = `<svg viewBox="0 0 24 24"><path d="${MAP_GLYPHS.pin}" fill="${q.col}" stroke="${OUTLINE}" stroke-width="${(1.5 * 14.8 / (2 * pin)).toFixed(2)}" fill-rule="evenodd" paint-order="stroke"/></svg>`;
      else el.face.innerHTML = svg(q.glyph, q.col);
      const D = q.dir ? 24 : pin ? pin * 2 * 24 / 14.8 : q.size + 2;
      el.style.setProperty('--d', `${D}px`);
      el.style.setProperty('--k', q.col);
      el.label.textContent = l ? q.name : '';
      el.tr = el.lt = null;
    }
    const tr = `translate3d(${q.sx}px, ${q.sy}px, 0)`;
    if (el.tr !== tr) { el.tr = tr; el.style.transform = tr; }
    if (el.z !== z) { el.z = z; el.style.zIndex = z; }
    if (l) { const lt = `translate(${Math.round(l.x - q.sx)}px, ${Math.round(l.y - q.sy)}px) translateY(-50%)`; if (el.lt !== lt) { el.lt = lt; el.label.style.transform = lt; } }
    if (q.dir) {
      const a = this.project(q.x, q.y), b = this.project(q.x + q.dir[0] * 3, q.y + q.dir[1] * 3), rot = a && b ? `rotate(${(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI).toFixed(1)}deg)` : '';
      if (el.rot !== rot) { el.rot = rot; el.face.style.transform = rot; }
    } else if (el.rot) { el.rot = ''; el.face.style.transform = ''; }
  }
}
