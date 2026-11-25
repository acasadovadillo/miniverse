// How what has worn is drawn (wear.js says the stage of each piece; docs/planes/realismo/PLAN-R5-construccion.md §5.5): its
// vertices carry how worn it is and their height in the piece (geo.js Builder.wear), and the material of that bucket is its
// twin: the same one, with a little more in its shader. Grey wood with rain streaks and a damp foot, plaster that stains and
// falls, moss on stone, dark thatch with clumps of moss and rot, faded tiles with lichen and some slipped. By the place in the
// world, so a wall goes on into the next one; no pictures (a small noise of 64 KB), no more meshes and no more draw calls: a bucket of a chunk with
// nothing worn keeps its own material, one with something worn uses its twin. Nothing per frame.
import * as THREE from 'three';
import { ihash } from '../util.js';

const KINDS = { siding: 0, woodT: 0, plank: 0, soffit: 0, roofEdge: 0, floor_madera: 0, paint0: 0, paint1: 0, paint2: 0, paint3: 0, paint4: 0, door: 0, frame: 0, fence: 0, timber: 0,
  plaster: 1, stoneT: 2, wallStone: 2, stone: 2, fenceStone: 2, floor_piedra: 2, floor_camino: 2,
  'roof:tejado_paja': 3, 'roof:tejado_rojo': 4, 'roof:tejado_azul': 4, 'roof:tejado_verde': 4, 'roof:tejado_gris': 5 };
// The kind of a material key (undefined: it is never drawn worn)
export const wearKind = key => KINDS[key];
// What a stage looks like, from 0 to 1 (indoors, less: a floor under a roof)
export const LOOK = [0, 0.5, 1];
export const INSIDE = 0.3;   // the face of a wall that gives on to the house
export const WORN = '~';     // the key of the twin: the key and this

const VERT = `
  vWear = aWear; vWearP = transformed + modelMatrix[3].xyz; vWearN = normal;   // (not turned: on the leaf of a door it does not slide as it opens)`;
// (A: blotches of about 80, 20, 10 and 5 cm, R, G, A and B. S: the same stretched along the rain's way down or the straw)
const PARS = `
uniform float uWearKind; uniform sampler2D uWearNoise;
varying vec2 vWear; varying vec3 vWearP; varying vec3 vWearN;
vec3 wearColor(vec3 c) {
  float a = vWear.x, worn = smoothstep(0.6, 1.0, a), y = vWear.y;
  float up = abs(vWearN.y), side = 1.0 - smoothstep(0.3, 0.7, up);
  vec2 q = abs(vWearN.x) > abs(vWearN.z) ? vec2(vWearP.z, uWearKind > 2.5 ? vWearP.x : vWearP.y) : vec2(vWearP.x, uWearKind > 2.5 ? vWearP.z : vWearP.y);
  if (uWearKind < 2.5 && up > 0.7) q = vWearP.xz;
  vec4 A = texture2D(uWearNoise, q * 0.157 + vWearN.xz * 0.31);
  float n1 = A.r, n2 = A.g, n3 = A.b, n = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
  float lum = dot(c, vec3(0.3, 0.58, 0.12));
  float foot = side * (1.0 - smoothstep(0.1, 1.1, y + (n - 0.5) * 1.1));
  // (the north and the west take the weather)
  float face = mix(1.0, 0.86 + 0.14 * smoothstep(-0.4, 0.6, -vWearN.z - vWearN.x), side);
  vec3 moss = mix(vec3(0.046, 0.054, 0.02), vec3(0.085, 0.092, 0.03), n2) * (0.6 + 0.7 * n3);
  if (uWearKind < 0.5) {          // wood: it goes silver grey, streaked by the rain, darker at the foot; worn, with mould and split grain
    vec4 S = texture2D(uWearNoise, q * vec2(0.42, 0.022));
    vec3 grey = (vec3(0.026) + vec3(lum) * vec3(1.48, 1.41, 1.32)) * (0.8 + 0.4 * S.b);
    c = mix(c, grey, min(1.0, a * face * (0.75 + 0.6 * n)));
    c *= 1.0 - a * 0.42 * side * smoothstep(0.5, 0.9, S.g) * (0.4 + 0.6 * n1);
    c = mix(c, c * vec3(0.52, 0.56, 0.45), foot * a * 0.7);
    c = mix(c, c * 0.36, worn * smoothstep(0.54, 0.76, n) * (0.4 + 0.6 * S.g));
    c = mix(c, moss, worn * 0.45 * foot * smoothstep(0.45, 0.7, n));
  } else if (uWearKind < 1.5) {   // plaster: it runs down from the eaves and is damp at the foot; worn, it falls and shows the mud under it
    vec4 S = texture2D(uWearNoise, q * vec2(0.2, 0.016));
    float run = smoothstep(1.0, 2.75, y) * S.g;
    c *= 1.0 - a * face * (0.2 * n + 0.36 * run);
    c = mix(c, c * vec3(0.52, 0.5, 0.4), foot * a * 0.8);
    float f = n1 * 0.46 + n2 * 0.34 + n3 * 0.2 + foot * 0.11 + run * 0.05, fall = smoothstep(0.6, 0.614, f) * worn, edge = smoothstep(0.565, 0.6, f) * worn;
    c = mix(c, c * 0.6, edge * 0.75);
    c = mix(c, vec3(0.2, 0.148, 0.102) * (0.6 + 0.5 * n3 + 0.25 * A.a), fall * 0.92);
  } else if (uWearKind < 2.5) {   // stone: moss from the foot and on what looks up, the same once there
    a = min(a, 0.55);
    float m = smoothstep(0.43, 0.74, n + foot * 0.3 + up * step(0.0, vWearN.y) * 0.08) * a * 1.45;
    c *= 1.0 - a * 0.26 * n1 * face;
    c = mix(c, moss, min(0.8, m));
    c = mix(c, vec3(lum) * vec3(1.3, 1.24, 1.02), a * 0.55 * smoothstep(0.6, 0.72, A.a * 0.6 + n3 * 0.4) * (1.0 - m));
  } else if (uWearKind < 3.5) {   // thatch: dark and grey, matted by the rain; worn, with moss and rotten hollows along the straw
    vec4 S = texture2D(uWearNoise, q * vec2(0.4, 0.05)), L = texture2D(uWearNoise, q * vec2(0.17, 0.058) + 0.37);
    c = mix(c, vec3(lum) * vec3(0.94, 0.85, 0.72), min(1.0, a * 1.25));
    c *= 1.0 - a * (0.2 + 0.3 * n1 + 0.26 * S.g);
    c *= 1.0 + a * 0.55 * (S.b - 0.5);
    float g = L.r * 0.5 + S.g * 0.24 + n3 * 0.14 + n2 * 0.12 + (1.0 - smoothstep(2.4, 4.4, y)) * 0.07;
    c = mix(c, moss, a * 0.62 * smoothstep(0.47, 0.7, g));
    c = mix(c, vec3(0.022, 0.017, 0.012), worn * 0.8 * smoothstep(0.55, 0.68, L.g * 0.44 + S.g * 0.3 + S.b * 0.26));
  } else {                        // tiles and slates: faded, dirty, with lichen and moss along the rows; worn, some slipped
    float slate = step(4.5, uWearKind);
    c = mix(c, vec3(lum) * vec3(1.06, 1.0, 0.94), a * 0.46);
    c *= 1.0 - a * (0.3 * n1 + 0.2 * n2);
    c = mix(c, vec3(0.3, 0.29, 0.2) * (0.6 + 0.6 * n3), a * 0.4 * smoothstep(0.64, 0.76, A.a * 0.6 + n3 * 0.4));
    float g = n + (1.0 - smoothstep(2.6, 4.6, y)) * 0.07;
    #ifdef USE_MAP
      vec2 tl = vMapUv * vec2(15.0, 13.0); tl.x += 0.5 * mod(floor(tl.y), 2.0);
      vec3 h = fract(vec3(floor(tl), 3.0) * 0.1031); h += dot(h, h.zyx + 31.32);
      float cell = fract((h.x + h.y) * h.z);
      g += (0.5 - fract(tl.y)) * 0.07 + (cell - 0.5) * 0.1;
      c = mix(c, c * 0.14 + vec3(0.006), worn * (1.0 - slate) * step(cell, 0.032));
      c *= 1.0 + worn * (1.0 - slate) * 0.3 * step(0.94, cell);
    #endif
    c = mix(c, moss, a * (0.8 - 0.3 * slate) * smoothstep(0.49, 0.67, g));
  }
  return c;
}
`;
// The noise all of them read (64 KB, made once): value noise of 8, 32, 128 and 64 cells, that tiles
const N = 128;
let NOISE = null;
function noise() {
  if (NOISE) return NOISE;
  const px = new Uint8Array(N * N * 4), smooth = t => t * t * (3 - 2 * t);
  [[8, 0], [32, 1], [128, 2], [64, 3]].forEach(([cells, ch]) => {
    const v = (x, y) => ihash(x % cells, y % cells, 900 + ch);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x * cells / N, fy = y * cells / N, x0 = Math.floor(fx), y0 = Math.floor(fy), u = smooth(fx - x0), w = smooth(fy - y0);
      const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * u, b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * u;
      px[(y * N + x) * 4 + ch] = Math.round(255 * (a + (b - a) * w));
    }
  });
  NOISE = new THREE.DataTexture(px, N, N);
  NOISE.wrapS = NOISE.wrapT = THREE.RepeatWrapping;
  NOISE.magFilter = THREE.LinearFilter; NOISE.minFilter = THREE.LinearMipmapLinearFilter; NOISE.generateMipmaps = true; NOISE.anisotropy = 4;
  NOISE.needsUpdate = true;
  return NOISE;
}
// The twin of a material: a copy that draws the wear. extra: what the material it comes from adds to its own shader (the floors'
// contact shadow: build3d.js), which clone() does not copy
export function wearTwin(base, key, from = base) {
  const m = base.clone(), kind = { value: wearKind(key) ?? 0 }, own = Object.prototype.hasOwnProperty.call(from, 'onBeforeCompile'), prev = own ? from.onBeforeCompile : null, prevKey = own ? from.customProgramCacheKey() : '';
  m.onBeforeCompile = (sh, r) => {
    prev?.call(from, sh, r);
    sh.uniforms.uWearKind = kind; sh.uniforms.uWearNoise = { value: noise() };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aWear;\nvarying vec2 vWear; varying vec3 vWearP; varying vec3 vWearN;')
      .replace('#include <project_vertex>', VERT + '\n#include <project_vertex>');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', PARS + 'void main() {')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  if (vWear.x > 0.01) diffuseColor.rgb = wearColor(diffuseColor.rgb);');
  };
  m.customProgramCacheKey = () => 'wear' + prevKey;
  return m;
}
