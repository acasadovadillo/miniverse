// Our own hair and beards for the new creator (plan CR, P4): cards of strands made offline on MakeHuman's base body by
// tools/mh_hair.py (Blender, in the background) into assets/mh/hair.bin.gz, with our strand texture hair-strands.png.
// Each card point is bound to one body triangle: its barycentric point plus an offset in that triangle's own frame (edge,
// normal, their cross), so the hair follows the head's shape, age and weight. The clothes of P3 bind the same way
// (bind to skin); both will share one module later, this one only reads the head's and the face's triangles.
// Every style comes cut and grown (the same points): the hair's three growth steps and the beard's are a mix of the two.
// The colour is the shader's: the look's colour, darker roots, lighter ends, each strand a little different, grey hairs by
// age and highlights in streaks. Cards are drawn twice, cut out and then their soft edges, in the fixed order the tool
// wrote them (inner layers first): no sorting, so nothing flickers.
import * as THREE from 'three';
import { mhUrl } from './data.js';
import { yearsOf } from './shape.js';

const M = 0.1;   // MakeHuman's decimetres to metres

// ---- The pack ----
let pending = null;
export const loadHair = () => (pending ||= fetchHair().catch(err => { pending = null; console.warn('Miniverse: hair.bin.gz did not load', err); return null; }));
async function fetchHair() {
  const res = await fetch(mhUrl('hair.bin.gz'));
  if (!res.ok) throw new Error(`hair.bin.gz: HTTP ${res.status}`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  const raw = bytes.length;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const H = parseHair(bytes.buffer);
  H.downloaded = raw;
  return H;
}
export function parseHair(buf) {
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(...u8.subarray(0, 4)) !== 'MHH1') throw new Error('hair.bin: not a hair pack');
  const hlen = new DataView(buf).getUint32(4, true), head = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hlen))), start = 8 + hlen;
  const view = (name, T) => { const b = head.blobs[name]; return b ? new T(buf, start + b[0], b[1] / T.BYTES_PER_ELEMENT) : null; };
  return { head, view, styles: new Map() };
}
// A style, decoded the first time a look wears it
function style(H, name) {
  let s = H.styles.get(name);
  if (s !== undefined) return s;
  const info = H.head.styles[name];
  if (!info) { H.styles.set(name, null); return null; }
  const p = `s.${name}.`, q = 1 / H.head.offq, n = info.npts;
  const o0 = H.view(p + 'o0', Int16Array), o1 = H.view(p + 'o1', Int16Array), tn = H.view(p + 'tn', Int8Array), b = H.view(p + 'bary', Uint16Array);
  const off0 = new Float32Array(n * 3), off1 = new Float32Array(n * 3), tl = new Float32Array(n * 6), bary = new Float32Array(n * 2);
  for (let i = 0; i < n * 3; i++) { off0[i] = o0[i] * q; off1[i] = o1[i] * q; }
  for (let i = 0; i < n * 6; i++) tl[i] = tn[i] / 127;
  for (let i = 0; i < n * 2; i++) bary[i] = b[i] / 65535;
  s = { name, kind: info.kind, n, tris: info.tris, tri: H.view(p + 'tri', Uint16Array), bary, off0, off1, tl, wa: H.view(p + 'wa', Uint8Array), v: H.view(p + 'v', Uint16Array),
    cards: H.view(p + 'cards', Uint8Array), mi: H.view(p + 'mi', Uint16Array), mw: H.view(p + 'mw', Uint8Array), ms: H.view(p + 'ms', Uint16Array), wq: H.head.wq, vq: H.head.vq, cols: H.head.cols };
  H.styles.set(name, s);
  return s;
}

// ---- Which style a look wears ----
// The game's 23 names on our 15 styles (those without one of their own, on the nearest: as barber.js does with realHair)
export const HAIR_STYLE = {
  corto: 'corto', largo: 'largo', coleta: 'coleta', rizado: 'rizado', mono: 'mono', rapado: 'rapado', calvo: 'calvo', pinchos: 'pinchos',
  melena: 'melena', coletas: 'coletas', trenza: 'trenza', cresta: 'pinchos', tupe: 'tupe', afro: 'afro', rastas: 'ondas', coletaAlta: 'coleta',
  monos: 'mono', trenzas: 'trenza', ondas: 'ondas', flequillo: 'tazon', mullet: 'corto', tazon: 'tazon', samurai: 'mono',
};
// (under a headscarf, no hair at all: it covers it, P6)
export const hairStyleOf = look => (look.hairStyle === 'panuelo' || look.wear?.cabeza?.id === 'hijab' ? null : HAIR_STYLE[look.hairStyle] || 'corto');
// The beard and how far it has grown (look.beardGrow 0..4, body.js): a shape keeps its outline for two steps, growing a
// little, while stubble comes up round it; from the third it fills into a full beard, the long one at the fourth. With no
// shape: stubble, more stubble, then a short full beard. Returns { shape, k (0 cut .. 1 grown), stubble: [moustache,
// chin, jaw] 0..1 } for the skin's own layer
const ZONES = { bigote: [1, 0, 0], perilla: [0, 1, 0], candado: [1, 1, 0], completa: [1, 1, 1], larga: [1, 1, 1] };
export function beardOf(look) {
  if (look.sex !== 'chico') return { shape: null, k: 0, stubble: [0, 0, 0] };
  const g = Math.max(0, Math.min(4, look.beardGrow | 0)), s = ZONES[look.beard] ? look.beard : null;
  const all = k => [k, k, k], max = (a, b) => a.map((x, i) => Math.max(x, b[i]));
  if (!s) return [{ shape: null, k: 0, stubble: [0, 0, 0] }, { shape: null, k: 0, stubble: all(0.45) }, { shape: null, k: 0, stubble: all(0.9) },
    { shape: 'completa', k: 0, stubble: all(1) }, { shape: 'completa', k: 0.6, stubble: all(1) }][g];
  if (g <= 2) return { shape: s, k: g * 0.3, stubble: max(ZONES[s], all(g * 0.4)) };
  return { shape: s === 'larga' ? 'larga' : g === 4 ? 'completa' : 'completa', k: s === 'larga' ? 0.3 + 0.35 * (g - 2) : g === 3 ? 0.5 : 1, stubble: all(1) };
}
// Grey hairs: the look's own (look.mh.grey 0..100), or by age, none before forty and nearly all at eighty
export function greyOf(look) {
  const g = look.mh?.grey;
  if (Number.isFinite(g)) return Math.max(0, Math.min(1, g / 100));
  const y = yearsOf(look.mh);
  return Math.max(0, Math.min(0.95, (y - 40) / 42)) ** 1.3;
}
export const HIGHLIGHT_COLOURS = ['#e8c878', '#f0e0b0', '#c87a3a', '#a8442a', '#d8d4cc', '#e86aa0', '#4a7ae8'];

// ---- Fitting: the points on the blended body (decimetres), then the cards' two edges ----
// (k mixes the cut style into the grown one)
function fitPoints(D, s, v, k) {
  const n = s.n, P = new Float32Array(n * 3), T = new Float32Array(n * 3), N = new Float32Array(n * 3), O = new Float32Array(n), idx = D.body.idx, rm = D.body.rmap;
  for (let i = 0; i < n; i++) {
    const t = s.tri[i] * 3, a = rm[idx[t]] * 3, b = rm[idx[t + 1]] * 3, c = rm[idx[t + 2]] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz) || 1, ul = Math.hypot(ux, uy, uz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const ex = ux / ul, ey = uy / ul, ez = uz / ul, fx = ny * ez - nz * ey, fy = nz * ex - nx * ez, fz = nx * ey - ny * ex;
    const wb = s.bary[i * 2], wc = s.bary[i * 2 + 1], wa = 1 - wb - wc;
    const o = i * 3, ox = s.off0[o] + (s.off1[o] - s.off0[o]) * k, oy = s.off0[o + 1] + (s.off1[o + 1] - s.off0[o + 1]) * k, oz = s.off0[o + 2] + (s.off1[o + 2] - s.off0[o + 2]) * k;
    // (how open the point is: near the skin, under the rest of the hair, it is in shadow)
    const up = Math.hypot(ox, oy, oz);
    O[i] = Math.min(1, Math.max(0, (oy > 0 ? Math.max(oy, up * 0.5) : 0) / 0.05));
    P[o] = v[a] * wa + v[b] * wb + v[c] * wc + ex * ox + nx * oy + fx * oz;
    P[o + 1] = v[a + 1] * wa + v[b + 1] * wb + v[c + 1] * wc + ey * ox + ny * oy + fy * oz;
    P[o + 2] = v[a + 2] * wa + v[b + 2] * wb + v[c + 2] * wc + ez * ox + nz * oy + fz * oz;
    const l = i * 6;
    T[o] = ex * s.tl[l] + nx * s.tl[l + 1] + fx * s.tl[l + 2]; T[o + 1] = ey * s.tl[l] + ny * s.tl[l + 1] + fy * s.tl[l + 2]; T[o + 2] = ez * s.tl[l] + nz * s.tl[l + 1] + fz * s.tl[l + 2];
    N[o] = ex * s.tl[l + 3] + nx * s.tl[l + 4] + fx * s.tl[l + 5]; N[o + 1] = ey * s.tl[l + 3] + ny * s.tl[l + 4] + fy * s.tl[l + 5]; N[o + 2] = ez * s.tl[l + 3] + nz * s.tl[l + 4] + fz * s.tl[l + 5];
  }
  return { P, T, N, O };
}
// The cards' vertices: two per point, across the strand (T x N) by the card's width (wk times: a short beard's cards are
// narrower than a grown one's), the edges a little in towards the head (no flat sheet standing out)
function cardVerts(s, fp, wk = 1) {
  const { P, T, N } = fp, n = s.n, out = new Float32Array(n * 6), w = s.wa, q = wk / s.wq;
  for (let i = 0; i < n; i++) {
    const o = i * 3, tx = T[o], ty = T[o + 1], tz = T[o + 2], nx = N[o], ny = N[o + 1], nz = N[o + 2];
    let cx = ty * nz - tz * ny, cy = tz * nx - tx * nz, cz = tx * ny - ty * nx;
    const cl = Math.hypot(cx, cy, cz) || 1, h = w[i * 2] * q * 0.5;
    cx *= h / cl; cy *= h / cl; cz *= h / cl;
    const dip = h * 0.22;
    out[i * 6] = P[o] + cx - nx * dip; out[i * 6 + 1] = P[o + 1] + cy - ny * dip; out[i * 6 + 2] = P[o + 2] + cz - nz * dip;
    out[i * 6 + 3] = P[o] - cx - nx * dip; out[i * 6 + 4] = P[o + 1] - cy - ny * dip; out[i * 6 + 5] = P[o + 2] - cz - nz * dip;
  }
  return out;
}
// What does not change with the shape (made once per style): uv, the strand's attributes and the triangles
function statics(s) {
  if (s.static) return s.static;
  const n = s.n, uv = new Float32Array(n * 4), hk = new Float32Array(n * 8), idx = [], idxF = [], cols = s.cols;
  let p = 0;
  for (let c = 0; c < s.cards.length; c += 4) {
    const m = s.cards[c], col = s.cards[c + 1] & 127, burn = s.cards[c + 1] >> 7, rand = s.cards[c + 2] / 255, ao = s.cards[c + 3] / 255;
    const u0 = (col + 0.02) / cols, u1 = (col + 0.98) / cols;
    for (let i = 0; i < m; i++) {
      const j = p + i, v = s.v[j] / s.vq, al = s.wa[j * 2 + 1] / 255;
      uv[j * 4] = u0; uv[j * 4 + 1] = v; uv[j * 4 + 2] = u1; uv[j * 4 + 3] = v;
      for (const e of [0, 4]) { hk[j * 8 + e] = al; hk[j * 8 + e + 1] = rand; hk[j * 8 + e + 2] = ao; hk[j * 8 + e + 3] = e ? 1 : 0; }
      if (i) { const a = (j - 1) * 2, b = j * 2; idx.push(a, a + 1, b, a + 1, b + 1, b); if (!burn) idxF.push(a, a + 1, b, a + 1, b + 1, b); }
    }
    p += m;
  }
  // (a woman's: no sideburns)
  return (s.static = { uv, hk, index: new Uint16Array(idx), indexF: idxF.length < idx.length ? new Uint16Array(idxF) : null });
}

// ---- The materials ----
let strandTex = null;
function strands() {
  if (strandTex) return strandTex;
  strandTex = new THREE.TextureLoader().load(mhUrl('hair-strands.png'), () => { strandTex.userData.ready = true; });
  strandTex.colorSpace = THREE.NoColorSpace;
  strandTex.wrapS = THREE.ClampToEdgeWrapping; strandTex.wrapT = THREE.RepeatWrapping;
  strandTex.anisotropy = 4;
  return strandTex;
}
export const hairTextureReady = () => !strandTex || !!strandTex.userData.ready;
// One material per pass and kind (hair, beard): the colour, roots, ends, grey and highlights from uniforms; the light as
// hair takes it, wrapped round and with two highlights along the strands (Kajiya and Kay: a white one, and a second of the
// hair's colour a little lower)
function hairMaterial(soft) {
  const U = {
    hairC: { value: new THREE.Color('#4a2c1c') }, greyC: { value: new THREE.Color('#d6d2ca') }, hlC: { value: new THREE.Color('#e8c878') },
    greyK: { value: 0 }, hlK: { value: 0 }, rootK: { value: 0.62 }, specK: { value: 1 },
  };
  const m = new THREE.MeshStandardMaterial({ map: strands(), side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
  if (soft) Object.assign(m, { transparent: true, depthWrite: false });
  else m.alphaTest = 0.45;
  m.userData.env = 0.05;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 hdir; attribute vec4 hk; varying vec3 vHDir; varying vec4 vHk;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHk = hk; vHDir = normalize((modelViewMatrix * vec4(hdir, 0.0)).xyz);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 hairC, greyC, hlC; uniform float greyK, hlK, rootK, specK; varying vec3 vHDir; varying vec4 vHk;
float hairSpec = 1.0, hairShift = 0.0;`)
      .replace('#include <map_fragment>', `
vec4 s4 = texture2D(map, vMapUv);
float along = vHk.x, crand = vHk.y, ao = vHk.z, occ = vHk.w;
float colN = floor(vMapUv.x * 8.0), ul = fract(vMapUv.x * 8.0);
float sid = floor(ul * 44.0) + floor(crand * 61.0) * 45.0 + colN * 7.0;
float h1 = fract(sin(sid * 12.9898) * 43758.5453), h2 = fract(sin(sid * 78.233 + 3.1) * 43758.5453);
// (each strand ends a little before or after the card's tip; the root end fades into the skin)
float a = s4.a * (1.0 - smoothstep(0.86 + 0.12 * h2, 1.0, along)) * smoothstep(0.0, 0.07, along);
// (far off the texture's small mips are fainter: their alpha is raised as they get smaller, so hair and beards do not
// thin out into holes with distance)
vec2 tdx = dFdx(vMapUv * vec2(1024.0, 512.0)), tdy = dFdy(vMapUv * vec2(1024.0, 512.0));
a *= 1.0 + 0.24 * max(0.0, 0.5 * log2(max(dot(tdx, tdx), dot(tdy, tdy))));
vec3 hc = hairC * (0.55 + 0.6 * s4.r) * (0.88 + 0.24 * h1);
hc *= mix(rootK, 1.0, smoothstep(0.0, 0.12, along)) * mix(1.0, 1.08, smoothstep(0.6, 1.0, along));
float hs = fract(sin((floor(ul * 6.0) + floor(crand * 11.0) * 7.0 + colN * 3.0) * 45.164 + 7.0) * 43758.5453);
hc = mix(hc, hlC * (0.6 + 0.55 * s4.r), float(hs < hlK) * 0.85 * smoothstep(0.04, 0.3, along));
// (grey hairs one by one up close; far off, where a strand is under a pixel, their share as an even mix: no salt and pepper)
float gk = mix(float(h2 < greyK), greyK, smoothstep(0.35, 1.0, fwidth(ul * 44.0)));
hc = mix(hc, greyC * (0.5 + 0.6 * s4.r) * (0.86 + 0.28 * h1), gk * 0.94);
// (the shadow at the roots: under the rest of the hair, close to the skin, it is darker)
float shade = ao * mix(colN == 7.0 ? 1.0 : 0.6, 1.0, smoothstep(0.0, 1.0, occ));   // (the short fuzz lies on the skin: it is not under anything)
diffuseColor.rgb *= hc * shade;
diffuseColor.a *= a;
// (the highlight: each strand's a little higher or lower, only on the strands, less in the shade; curls in small points)
hairShift = (h1 - 0.5) * 0.18;
hairSpec = (colN == 4.0 ? 0.35 : 1.0) * (0.35 + 0.65 * s4.r) * shade;
${soft ? 'if (diffuseColor.a > 0.46 || diffuseColor.a < 0.03) discard;' : ''}`)
      // (cut out at a fixed threshold; what it leaves, the soft pass blends. A threshold changing from pixel to pixel (a
      // dither) was tried in the polish: it left grain at 1x, with no frames to average it over)
      .replace('#include <alphatest_fragment>', soft ? '' : 'if (diffuseColor.a < 0.45) discard;')
      // (the normal is the hair's way out, whichever side of the card is seen)
      .replace('#include <normal_fragment_begin>', `float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
vec3 normal = normalize(vNormal);
vec3 nonPerturbedNormal = normal;`)
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment
        .replace('vec3 irradiance = dotNL * directLight.color;', `float dotNLw = saturate((dot(geometryNormal, directLight.direction) + 0.55) / 1.55);
	vec3 irradiance = dotNLw * directLight.color;`)
        // (two Kajiya-Kay highlights along the strand: a sharp white one, and a broader one of the hair's own colour, shifted
        // towards the tip)
        .replace('reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );', `{
		vec3 Th = normalize(vHDir), Hh = normalize(directLight.direction + geometryViewDir);
		float t1 = dot(normalize(Th + geometryNormal * (hairShift - 0.1)), Hh), t2 = dot(normalize(Th + geometryNormal * (hairShift + 0.16)), Hh);
		float s1 = pow(max(0.0, 1.0 - t1 * t1), 140.0), s2 = pow(max(0.0, 1.0 - t2 * t2), 30.0);
		float vis = saturate(dot(geometryNormal, directLight.direction) * 1.6 + 0.35);
		reflectedLight.directSpecular += directLight.color * vis * specK * hairSpec * (0.09 * s1 + 0.2 * s2 * min(material.diffuseColor * 3.0, vec3(1.0)));
	}`));
    // (the cut pass is opaque where it draws: a see-through canvas (the creator's) would show its partial alpha as white)
    if (!soft) sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a = 1.0;');
  };
  m.customProgramCacheKey = () => 'mh-hair3' + (soft ? 's' : 'c');
  m.userData.U = U;
  return m;
}

// ---- What person.js asks for ----
// The look's own hair and beard as entries of its bound meshes: { kind, name, v (the vertices, decimetres), morphs?,
// refit(v) (the vertices again on a moved body: the beard follows the face's expressions), mesh(ground, mat) }. With no
// pack (it did not load) an empty list: person.js then keeps MakeHuman's hair
export function hairFits(D, v, look) {
  const H = D.hair;
  if (!H) return [];
  const out = [], hs = hairStyleOf(look), bd = beardOf(look);
  const add = (kind, name, k) => {
    const s = style(H, name);
    if (!s) return;
    const wk = kind === 'ownbeard' ? 0.7 + 0.3 * k : 1, fit = w => cardVerts(s, fitPoints(D, s, w, k), wk);
    const f = { kind, name, s, k, v: fit(v), refit: fit, fp: null, female: look.sex !== 'chico' };
    f.fp = fitPoints(D, s, v, k);
    out.push(f);
  };
  if (hs && !(SHELLS && SHELL_HAIR[hs]?.only)) add('ownhair', hs, Math.max(0, Math.min(3, look.hairGrow | 0)) / 3);   // (the afro: shells alone)
  if (bd.shape && (!SHELLS || bd.shape === 'larga')) add('ownbeard', 'beard_' + bd.shape, bd.k);   // (the others: shells, below)
  return out;
}
// How far the short hair's fur stands out (metres; 0 for a style of cards alone): headwear.js sits a hat over it
export function furOf(look) {
  const H = SHELLS && SHELL_HAIR[hairStyleOf(look)];
  return H ? H.L[0] + (H.L[1] - H.L[0]) * Math.max(0, Math.min(3, look.hairGrow | 0)) / 3 : 0;
}
// A style drawn by shells alone (no cards fitted): its scalp mask is still the style's (scalpOf)
export function shellOnly(D, look) {
  const hs = hairStyleOf(look);
  return D.hair && SHELLS && SHELL_HAIR[hs]?.only ? { s: style(D.hair, hs), female: look.sex !== 'chico' } : null;
}
// The key of what the hair needs made again (person.js shapeKey adds it)
export const hairKey = look => [hairStyleOf(look), look.hairGrow | 0, look.sex === 'chico' ? [look.beard, look.beardGrow | 0] : 0].join();

// A fitted entry into its two meshes (cut out, and the soft edges after everything), ground and squeeze already in f.v
export function hairMeshes(f, ground, mat) {
  const st = statics(f.s), n = f.s.n, p = new Float32Array(n * 6), nn = new Float32Array(n * 6), td = new Float32Array(n * 6);
  for (let i = 0; i < n * 2; i++) { p[i * 3] = f.v[i * 3] * M; p[i * 3 + 1] = (f.v[i * 3 + 1] - ground) * M; p[i * 3 + 2] = f.v[i * 3 + 2] * M; }
  const { T, N } = f.fp;
  for (let i = 0; i < n; i++) for (const e of [0, 3]) for (let c = 0; c < 3; c++) { nn[i * 6 + e + c] = N[i * 3 + c]; td[i * 6 + e + c] = T[i * 3 + c]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  g.setAttribute('hdir', new THREE.BufferAttribute(td, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(st.uv, 2));
  const hk = st.hk.slice();
  for (let i = 0; i < n; i++) hk[i * 8 + 3] = hk[i * 8 + 7] = f.fp.O[i];
  g.setAttribute('hk', new THREE.BufferAttribute(hk, 4));
  g.setIndex(new THREE.BufferAttribute(f.female && st.indexF ? st.indexF : st.index, 1));
  g.computeBoundingSphere();
  if (f.morphs?.length) {
    g.morphAttributes.position = f.morphs.map(d => { const a = new Float32Array(n * 6); for (let i = 0; i < a.length; i++) a[i] = d[i] * M; return new THREE.BufferAttribute(a, 3); });
    g.morphTargetsRelative = true;
  }
  const cut = new THREE.Mesh(g, mat(`${f.kind}:cut`, () => hairMaterial(false)));
  const soft = new THREE.Mesh(g, mat(`${f.kind}:soft`, () => hairMaterial(true)));
  cut.name = `${f.kind}:${f.name}`; soft.name = `${f.kind}soft:${f.name}`;
  soft.renderOrder = 3; soft.castShadow = false;
  return [cut, soft];
}

// Where the hair grows, per render vertex of the body (0..1), for the skin's scalp paint: the style's own mask, soft at
// the hairline. A beard has none (its stubble is the skin's beard layer)
export function scalpOf(f, nv, rmap) {
  const s = new Float32Array(nv), out = new Float32Array(rmap.length);
  if (f?.s.mi) for (let i = 0; i < f.s.mi.length; i++) s[f.s.mi[i]] = f.s.mw[i] / 255;
  if (f?.female && f.s.ms) for (const i of f.s.ms) s[i] = 0;
  for (let r = 0; r < rmap.length; r++) out[r] = s[rmap[r]];
  return out;
}

// The colours of a person's hair, beard and brows (no new geometry)
export function hairColour(mats, look) {
  const c = new THREE.Color(look.hair || '#4a2c1c'), grey = greyOf(look), hl = Math.max(0, Math.min(1, (look.mh?.hl || 0) / 100));
  const hlc = new THREE.Color(look.mh?.hlC || HIGHLIGHT_COLOURS[0]);
  for (const [k, m] of Object.entries(mats)) {
    const U = m.userData.U;
    if (k.startsWith('ownshell:')) {
      U.hairC.value.copy(c); U.greyK.value = k.startsWith('ownshell:beard') ? Math.min(1, grey * 1.15) : grey;
    } else if (k.startsWith('ownhair:') || k.startsWith('ownbeard:')) {
      U.hairC.value.copy(c); U.greyK.value = k.startsWith('ownbeard') ? Math.min(1, grey * 1.15) : grey;
      U.hlK.value = k.startsWith('ownbeard') ? 0 : hl * 0.55; U.hlC.value.copy(hlc);
      U.rootK.value = k.startsWith('ownbeard') ? 0.9 : 0.85;
    } else if (k.startsWith('skin:')) {
      U.hairC.value.copy(c).lerp(new THREE.Color('#bdb8b0'), grey * 0.8);   // (the scalp's and the stubble's paint greys too)
    } else if (k.startsWith('brows:')) {
      // (the brows: the hair's own colour, a little darker, greying later than the hair)
      U.tint.value.copy(c).multiplyScalar(0.82).lerp(new THREE.Color('#bdb8b0'), grey * 0.55);
    }
  }
}
// The skin's stubble layer: per beard zone (moustache, chin, jaw) how dense, 0..1
export const stubbleOf = look => beardOf(look).stubble;

// ---- Shells (P4, second pass): fur made of copies of the skin ----
// The beards (all their steps), the short hair of the men's styles with their temples, and under the afro and the curls:
// up to eight copies of the skin's triangles there, each a little further out along the skin's normal (and leaning the way
// the hair falls), drawn with hairs cut out by a pattern in the skin's uv: a hair is a dot, the same in every copy, thinner
// and rarer further out. Dense up close; from afar, where a hair is under a pixel, the dots widen until each copy is solid,
// so a beard is a clean mass, never specks. Only the near people (person.js meshes); the middle level of the game
// (ingame.js) leaves them out as it leaves the cards' soft pass. ?capas=0: off, the cards of before.
export const SHELLS = (() => { try { return new URLSearchParams(location.search).get('capas') !== '0'; } catch { return true; } })();
// Per hairstyle: layers, length (metres, cut and grown), how many hairs, how thick, which way they lean
const SHELL_HAIR = {
  rapado: { n: 6, L: [0.003, 0.012], den: 0.9, r: 0.36, lean: 0.4 }, calvo: { n: 5, L: [0.005, 0.011], den: 0.85, r: 0.36, lean: 0.8 },
  corto: { n: 5, L: [0.006, 0.012], den: 0.9, r: 0.38, lean: 0.9 }, tupe: { n: 5, L: [0.006, 0.012], den: 0.9, r: 0.38, lean: 0.9 },
  pinchos: { n: 5, L: [0.006, 0.012], den: 0.9, r: 0.38, lean: 0.7 }, afro: { n: 8, L: [0.042, 0.052], den: 1, r: 0.55, lean: 0.05, only: true, puff: 1 },
  rizado: { n: 6, L: [0.012, 0.016], den: 1, r: 0.48, lean: 0.3 },
};
const SHELL_BEARD = { n: 6, den: 1, r: 0.42, lean: 1.1 };
function furMaterial() {
  const U = { hairC: { value: new THREE.Color('#4a2c1c') }, greyC: { value: new THREE.Color('#d6d2ca') }, greyK: { value: 0 }, furR: { value: 0.4 } };
  const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, side: THREE.FrontSide });
  m.userData.env = 0.05;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 fur; varying vec3 vFur; varying vec2 vFuv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFur = fur; vFuv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 hairC, greyC; uniform float greyK, furR; varying vec3 vFur; varying vec2 vFuv;
vec3 hash3(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yzz) * q.zyx); }`)
      .replace('#include <map_fragment>', `
// (vFur: x how far out this copy is (0..1), y how dense the hair is here, z the hair's own length scale here)
vec2 fu = vFuv * vec2(2600.0, 1050.0);
vec2 cell = floor(fu), side = sign(fract(fu) - 0.5);
float far = smoothstep(0.7, 1.8, length(fwidth(fu)));
float best = 9.0, hid = 0.0;
// (the hair nearest: in this cell and the three towards the corner it is nearest to; a hair sits in the middle 70% of its
// cell, so farther ones never win)
for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
  vec2 cc = cell + vec2(float(i), float(j)) * side;
  vec3 h = hash3(cc);
  if (h.z > vFur.y) continue;
  vec2 d = cc + 0.15 + 0.7 * h.xy - fu;
  float dd = dot(d, d);
  if (dd < best) { best = dd; hid = h.z / max(vFur.y, 0.001); }
}
float len = mix(0.55, 1.0, fract(hid * 7.13));
// (far off, the hairs merge into tufts of their own length, three cells across: the visible copy changes from tuft to tuft,
// so the mass keeps its light and shade instead of becoming a smooth mask)
vec3 tuft = hash3(floor(fu * 0.33) + 17.0);
float r = mix(furR * (1.0 - 0.7 * vFur.x / len), 0.9, far);
if (vFur.x > mix(len, mix(0.4, 1.0, tuft.x), far) || best > r * r) discard;
vec3 fc = hairC * mix(0.38, 1.05, vFur.x) * mix(0.75 + 0.5 * fract(hid * 13.1), 0.85 + 0.3 * tuft.y, far);
fc = mix(fc, greyC * mix(0.55, 1.0, vFur.x), step(fract(hid * 3.7), greyK) * (1.0 - far) + greyK * far);
diffuseColor.rgb *= fc;`)
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a = 1.0;');
  };
  m.customProgramCacheKey = () => 'mh-fur2';
  m.userData.U = U;
  return m;
}
// The shells of a person: its body geometry (metres, ground at 0; with the 'scalp' and 'beardZone' it was given), the look,
// and the materials' cache. Returns the meshes (none with ?capas=0 or nothing to cover)
// (cap: a hat's, P6: the hair's copies pressed into its crown, headwear.js capFur)
export function shellMeshes(bodyGeo, look, mat, cap = null) {
  if (!SHELLS) return [];
  const out = [], hs = hairStyleOf(look), bd = beardOf(look), grow = Math.max(0, Math.min(3, look.hairGrow | 0)) / 3;
  const H = SHELL_HAIR[hs];
  if (H) out.push(shellMesh(bodyGeo, 'hair', bodyGeo.attributes.scalp, null, H.n, H.L[0] + (H.L[1] - H.L[0]) * grow, H.den, H.r, H.lean, [0, -0.6, -0.8], false, mat, cap));
  if (bd.shape) {
    const z = ZONES[bd.shape], L = bd.shape === 'larga' ? 0.014 : 0.004 + 0.011 * bd.k;
    out.push(shellMesh(bodyGeo, 'beard', bodyGeo.attributes.beardZone, z, SHELL_BEARD.n, L, SHELL_BEARD.den, SHELL_BEARD.r, SHELL_BEARD.lean, [0, -1, 0.15], true, mat));
  }
  return out.filter(Boolean);
}
function shellMesh(bg, kind, wAttr, zones, n, L, den, r, lean, fall, withMorphs, mat, cap = null) {
  if (!wAttr) return null;
  const pos = bg.attributes.position, nor = bg.attributes.normal, uv = bg.attributes.uv, idx = bg.index.array, nv = pos.count;
  const w = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    if (!zones) w[i] = wAttr.getX(i);
    else w[i] = Math.max(wAttr.getX(i) * zones[0], wAttr.getY(i) * zones[1], wAttr.getZ(i) * zones[2]);
  }
  const tri = [], map = new Int32Array(nv).fill(-1), sel = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (Math.max(w[a], w[b], w[c]) < 0.05) continue;
    for (const k of [a, b, c]) if (map[k] < 0) { map[k] = sel.length; sel.push(k); }
    tri.push(map[a], map[b], map[c]);
  }
  if (!tri.length) return null;
  const m = sel.length, P = new Float32Array(m * n * 3), N = new Float32Array(m * n * 3), UVs = new Float32Array(m * n * 2), F = new Float32Array(m * n * 3);
  const f = new THREE.Vector3(...fall).normalize(), nn = new THREE.Vector3(), d = new THREE.Vector3();
  for (let l = 0; l < n; l++) {
    const h = (l + 1) / n;
    for (let k = 0; k < m; k++) {
      const i = sel[k], o = (l * m + k) * 3;
      nn.fromBufferAttribute(nor, i);
      // (the lean: the hair falls along the skin, more the further out)
      d.copy(f).addScaledVector(nn, -f.dot(nn));
      const off = L * h, sl = L * lean * h * h;
      P[o] = pos.getX(i) + nn.x * off + d.x * sl; P[o + 1] = pos.getY(i) + nn.y * off + d.y * sl; P[o + 2] = pos.getZ(i) + nn.z * off + d.z * sl;
      N[o] = nn.x; N[o + 1] = nn.y; N[o + 2] = nn.z;
      UVs[(l * m + k) * 2] = uv.getX(i); UVs[(l * m + k) * 2 + 1] = uv.getY(i);
      F[o] = h; F[o + 1] = Math.min(1, w[i] * 1.1) * den; F[o + 2] = 1;
    }
  }
  if (cap) cap(P);
  const index = new (m * n > 65535 ? Uint32Array : Uint16Array)(tri.length * n);
  // (outermost copy first: where its hairs are, the inner copies fail the depth test before they are shaded)
  for (let l = 0; l < n; l++) for (let t = 0; t < tri.length; t++) index[l * tri.length + t] = tri[t] + (n - 1 - l) * m;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(UVs, 2));
  g.setAttribute('fur', new THREE.BufferAttribute(F, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  // (a beard follows the mouth: the skin's own expressions, the same for every copy)
  if (withMorphs && bg.morphAttributes.position?.length) {
    g.morphAttributes.position = bg.morphAttributes.position.map(a => {
      const out = new Float32Array(m * n * 3);
      for (let l = 0; l < n; l++) for (let k = 0; k < m; k++) { const i = sel[k], o = (l * m + k) * 3; out[o] = a.getX(i); out[o + 1] = a.getY(i); out[o + 2] = a.getZ(i); }
      return new THREE.BufferAttribute(out, 3);
    });
    g.morphTargetsRelative = true;
  }
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, mat(`ownshell:${kind}`, furMaterial));
  mesh.material.userData.U.furR.value = r;
  mesh.name = `ownshell:${kind}`;
  mesh.castShadow = false; mesh.receiveShadow = false;   // (no shadow lookups: eight layers of them cost most)
  return mesh;
}
