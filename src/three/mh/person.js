// A MakeHuman person for the new creator (plan CR, P1-P2, ?creador=nuevo): the hm08 body with the look's shapes blended
// once (shape.js), a photo skin shared by sex and age and tinted with the look's tone, with pores and the wrinkles of age
// in relief, shinier and matter zones, light that goes a little through the ears, nose and lips, and the look's skin
// layers (freckles, moles, a scar, vitiligo, blush, kohl, a tattoo); eyes with iris and cornea that blink and look, card
// brows and lashes, teeth and tongue, MakeHuman's expressions as morphs, and MakeHuman's own hair and provisional
// clothes, bound to the body. Standing still (no bones yet: that is P5). Only the creator draws it; the game's people are
// still persona.js.
import * as THREE from 'three';
import { mhUrl, proxy } from './data.js';
import { blend, fit, fitGarment, joint, armPose, poseInPlace, yearsOf, expressions } from './shape.js';
import { garment } from './data.js';
import { hairOf, browsOf, lashesOf, garmentsOf } from './looks.js';
import { clothMaterial } from './cloth.js';
import { skinLayers, layerUniforms } from './skin.js';
import { hairFits, hairKey, hairMeshes, scalpOf, hairColour, stubbleOf } from './hair.js';

const M = 0.1;   // MakeHuman's decimetres to metres

// ---- Textures: one copy each, shared by every person ----
const texCache = new Map();
// (the game draws its people smaller than the creator: from then on, a texture loaded is cut to the side this gives for its
// name; ingame.js)
let texMax = null;
export const limitTextures = f => { texMax = f; };
const fitSide = (t, name) => {
  const img = t.image, side = texMax?.(name) || 0;
  if (!side || !img || Math.max(img.width, img.height) <= side) return;
  const k = side / Math.max(img.width, img.height), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  t.image = c;
};
function tex(name, { srgb = true, onLoad = null } = {}) {
  let t = texCache.get(name);
  if (!t) {
    t = new THREE.TextureLoader().load(mhUrl(name), () => { fitSide(t, name); t.userData.ready = true; for (const f of t.userData.wait) f(t.image); t.userData.wait = []; });
    t.userData.wait = [];
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(name, t);
  }
  if (onLoad) { if (t.userData.ready) onLoad(t.image); else t.userData.wait.push(onLoad); }
  return t;
}
// Every texture asked for so far has arrived (portraits wait for it)
export const texturesReady = () => [...texCache.values()].every(t => t.userData.ready);
// The mean colour of a photo, linear (to take it out of the skin and keep only its detail); worked out once per image
const MEANS = new WeakMap();
function meanLinear(img) {
  if (!MEANS.has(img)) MEANS.set(img, meanOf(img));
  return MEANS.get(img).clone();
}
function meanOf(img) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 64, 64);
  const px = g.getImageData(0, 0, 64, 64).data, s = [0, 0, 0];
  const lin = x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  let n = 0;
  for (let i = 0; i < px.length; i += 4) { if (px[i] + px[i + 1] + px[i + 2] < 60) continue; s[0] += lin(px[i]); s[1] += lin(px[i + 1]); s[2] += lin(px[i + 2]); n++; }
  return new THREE.Vector3(s[0] / n, s[1] / n, s[2] / n);
}

// The pores: a height map made here, once (no download), that tiles: many small round dents of random size and depth
// over a faint grain, and a few fine creases. Tiled about fifty times over the skin's atlas, about a millimetre apart
let pores = null;
function poreMap() {
  if (pores) return pores;
  const N = 256, h = new Float32Array(N * N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < h.length; i++) h[i] = 0.5 + (rnd() - 0.5) * 0.12;
  const dent = (cx, cy, r, d) => {
    const R = Math.ceil(r * 2);
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      const q = (x * x + y * y) / (r * r);
      if (q > 4) continue;
      const i = ((cy + y + N) % N) * N + ((cx + x + N) % N);
      h[i] -= d * Math.exp(-q * 1.6);
    }
  };
  for (let k = 0; k < 900; k++) dent(Math.floor(rnd() * N), Math.floor(rnd() * N), 0.8 + rnd() * 1.4, 0.18 + rnd() * 0.3);
  for (let k = 0; k < 40; k++) {   // (the fine creases: short soft lines)
    let x = rnd() * N, y = rnd() * N;
    const a = rnd() * Math.PI, dx = Math.cos(a), dy = Math.sin(a);
    for (let s = 0; s < 10 + rnd() * 14; s++) { dent(Math.floor(x), Math.floor(y), 0.9, 0.05); x += dx; y += dy; }
  }
  const px = new Uint8Array(N * N * 4);
  for (let i = 0; i < h.length; i++) { const v = Math.max(0, Math.min(255, Math.round(h[i] * 255))); px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
  pores = new THREE.DataTexture(px, N, N);
  pores.wrapS = pores.wrapT = THREE.RepeatWrapping;
  pores.generateMipmaps = true; pores.minFilter = THREE.LinearMipmapLinearFilter; pores.magFilter = THREE.LinearFilter;
  pores.needsUpdate = true;
  return pores;
}

// ---- Materials ----
// The skin: the young and the old photo of the sex, mixed by age, divided by their mean colour (only the pores, veins,
// lips and wrinkles stay) and times the look's tone. Its relief: the photos' own lightness (the wrinkles, more with age)
// and the pores. Its zones (vertex attribute `zone`: the T of the face shiny, the lips, the thin parts and the face's
// front) and its layers (skin.js) are painted here too
function skinMaterial(sex) {
  const s = sex === 'chico' ? 'male' : 'female', U = {
    mapOld: { value: tex(`skin-${s}-old.jpg`) }, age: { value: 0 }, tone: { value: new THREE.Color('#e8b07a') },
    meanY: { value: new THREE.Vector3(0.5, 0.35, 0.28) }, meanO: { value: new THREE.Vector3(0.5, 0.35, 0.28) }, hairC: { value: new THREE.Color('#2a1e1e') },
    beard: { value: new THREE.Vector4(0, 0, 0, 0) }, poreMap: { value: poreMap() }, poreK: { value: 1 },
    sssTint: { value: new THREE.Color(1.0, 0.36, 0.24) },
    lay1: { value: new THREE.Vector4() }, lay2: { value: new THREE.Vector4() }, lay3: { value: new THREE.Vector4() },
    blushC: { value: new THREE.Color('#c85a5a') }, kohlC: { value: new THREE.Color('#1c1612') }, tatC: { value: new THREE.Color('#2a3a4a') },
    moles: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) }, eyesF: { value: new THREE.Vector2(0.3, 0.45) },
  };
  const young = tex(`skin-${s}-young.jpg`, { onLoad: img => U.meanY.value.copy(meanLinear(img)) });
  tex(`skin-${s}-old.jpg`, { onLoad: img => U.meanO.value.copy(meanLinear(img)) });
  const m = new THREE.MeshPhysicalMaterial({ map: young, bumpMap: young, bumpScale: 1, roughness: 0.6, sheen: 0.25, sheenRoughness: 0.55, sheenColor: new THREE.Color('#a8442a'), specularIntensity: 0.5 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float scalp; attribute vec3 beardZone; attribute vec4 zone; attribute vec3 face;
varying float vScalp; varying vec3 vBeard; varying vec4 vZone; varying vec3 vFace; varying vec3 vObj;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvScalp = scalp; vBeard = beardZone; vZone = zone; vFace = face; vObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
uniform sampler2D mapOld, poreMap; uniform float age, poreK; uniform vec3 tone, meanY, meanO, hairC, sssTint, blushC, kohlC, tatC;
uniform vec4 beard, lay1, lay2, lay3; uniform vec3 moles[6]; uniform vec2 eyesF;
varying float vScalp; varying vec3 vBeard; varying vec4 vZone; varying vec3 vFace; varying vec3 vObj;
${skinLayers}`)
      .replace('#include <map_fragment>', `
vec3 ty = age < 0.97 ? texture2D(map, vMapUv).rgb / meanY : vec3(1.0), to = age > 0.03 ? texture2D(mapOld, vMapUv).rgb / meanO : vec3(1.0);
vec3 dt = mix(ty, to, age);
float dl = dot(dt, vec3(0.2126, 0.7152, 0.0722));
diffuseColor.rgb *= tone * mix(vec3(dl), dt, 0.35);
diffuseColor.rgb = layers(diffuseColor.rgb, dl);
// (the scalp under the hair: the roots' shade of the hair's colour, fading softly at the hairline, made of fine dots there)
float sn = fract(sin(dot(floor(vMapUv * vec2(3200.0, 1300.0)), vec2(12.9898, 78.233))) * 43758.5453);
float sk = smoothstep(0.05, 0.85, vScalp) * mix(0.55 + 0.45 * sn, 1.0, smoothstep(0.5, 0.95, vScalp));
diffuseColor.rgb = mix(diffuseColor.rgb, hairC * (0.42 + 0.35 * dl), sk * 0.88);
// (the stubble (P4: the beard itself is of cards, hair.js): per zone, moustache, chin and jaw, how dense; the skin a little
// shadowed and the cut hairs as fine dots of the hair's colour)
float bz = clamp(max(max(vBeard.x * beard.x, vBeard.y * beard.y), vBeard.z * beard.z), 0.0, 1.0);
if (bz > 0.0) {
  vec2 hu = vMapUv * vec2(6400.0, 2600.0);
  float hn = fract(sin(dot(floor(hu), vec2(12.9898, 78.233))) * 43758.5453);
  vec3 shade = mix(vec3(1.0), hairC / max(0.04, dot(hairC, vec3(0.33))) * 0.3 + 0.55, 0.7);
  diffuseColor.rgb *= mix(vec3(1.0), shade * 0.82, bz * 0.7);
  diffuseColor.rgb = mix(diffuseColor.rgb, hairC * (0.6 + 0.3 * hn), smoothstep(1.0 - 0.7 * bz, 1.0 - 0.5 * bz, hn) * 0.55);
  // (under a beard of cards (density 1): the skin is the beard's own colour, no skin shows between its cards)
  diffuseColor.rgb = mix(diffuseColor.rgb, hairC * (0.5 + 0.3 * hn), smoothstep(0.9, 1.0, bz) * 0.72);
}`)
      // (the relief: the photos' lightness, the old one deeper, and the pores, strongest on the face's front)
      .replace('#include <bumpmap_pars_fragment>', `#ifdef USE_BUMPMAP
uniform sampler2D bumpMap; uniform float bumpScale;
float skinH(vec2 uv) {
  // (only the photos that count at this age: a young face reads one, an old one the other)
  float y = age < 0.97 ? dot(texture2D(bumpMap, uv).rgb, vec3(0.3, 0.59, 0.11)) : 0.0, o = age > 0.03 ? dot(texture2D(mapOld, uv).rgb, vec3(0.3, 0.59, 0.11)) : 0.0;
  float p = texture2D(poreMap, uv * 52.0).r;
  return mix(y * 0.6, o * 1.5, age) + (p - 0.5) * poreK * (0.35 + 0.65 * vZone.w);
}
vec2 dHdxy_fwd() {
  // (one height per pixel and the screen's own derivatives, not three: a third of the texture reads)
  float h = bumpScale * skinH(vBumpMapUv);
  return vec2(dFdx(h), dFdy(h));
}
vec3 perturbNormalArb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz)), vSigmaY = normalize(dFdy(surf_pos.xyz)), vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN), R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
#endif`)
      // (shinier on the forehead, nose and chin, and the lips; matter on the cheeks)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.36, vZone.x * 0.85);
roughnessFactor = mix(roughnessFactor, 0.3, vZone.y);`)
      // (the scalp under the hair is not shiny: through the gaps between the cards it would show as white lines)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
float scalpDull = 1.0 - smoothstep(0.1, 0.6, vScalp);
material.specularColor *= scalpDull; material.specularF90 *= scalpDull;
#ifdef USE_SHEEN
material.sheenColor *= scalpDull;
#endif`)
      // (light that goes a little through: a wrapped, reddish diffuse, more in the thin parts, and the ears glowing against
      // the light)
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment
        .replace('vec3 irradiance = dotNL * directLight.color;', `vec3 irradiance = dotNL * directLight.color;
	float ndlS = dot( geometryNormal, directLight.direction ), wrapS = 0.3 + 0.45 * vZone.z;
	vec3 sssIrr = ( saturate( ( ndlS + wrapS ) / ( 1.0 + wrapS ) ) - dotNL ) * directLight.color * sssTint * 0.55
		+ pow( saturate( -ndlS ), 1.5 ) * vZone.z * 0.45 * directLight.color * sssTint;`)
        .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', 'reflectedLight.directDiffuse += ( irradiance + sssIrr ) * BRDF_Lambert( material.diffuseColor );'));
  };
  m.customProgramCacheKey = () => 'mh-skin2';
  m.userData.U = U;
  return m;
}
// An eye: MakeHuman's iris photo, its colour taken out and the look's put in (only where it is coloured: the white and the
// pupil stay). One material per eye, for eyes of two colours
function eyeMaterial() {
  const U = { iris: { value: new THREE.Color('#3a8a4a') } };
  const m = new THREE.MeshStandardMaterial({ map: tex('iris.png'), roughness: 0.3, alphaTest: 0.5 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform vec3 iris;').replace('#include <map_fragment>', `
vec4 e4 = texture2D(map, vMapUv);
vec3 e = e4.rgb;
diffuseColor.a *= e4.a;
float hi = max(e.r, max(e.g, e.b)), lo = min(e.r, min(e.g, e.b)), l = dot(e, vec3(0.2126, 0.7152, 0.0722));
float k = smoothstep(0.03, 0.09, hi - lo) * (1.0 - smoothstep(0.35, 0.6, l));
diffuseColor.rgb *= mix(e, iris * (0.35 + 2.6 * l), k);`);
  };
  m.customProgramCacheKey = () => 'mh-eye';
  m.userData.U = U;
  return m;
}
// Cards (brows, lashes), hair and the provisional clothes: the texture's lightness (its mean taken out) times the look's
// colour. Hair comes in two files, colour and alpha, and is drawn twice: cut out, and then its soft edges blended over
function tinted(file, { alpha = null, colour = '#2a1e1e', blendEdges = false, cutout = false, rough = 0.6, keep = 0.85, test = 0.5, edgeOnly = false } = {}) {
  const U = { tint: { value: new THREE.Color(colour) }, meanL: { value: 0.3 } };
  const map = tex(file, { onLoad: img => { const v = meanLinear(img); U.meanL.value = Math.max(0.02, 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z); } });
  const m = new THREE.MeshStandardMaterial({ map, alphaMap: alpha ? tex(alpha, { srgb: false }) : null, side: THREE.DoubleSide, roughness: rough });
  if (blendEdges) Object.assign(m, { transparent: true, depthWrite: false });
  else if (cutout) Object.assign(m, { alphaTest: test, alphaToCoverage: true });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform vec3 tint; uniform float meanL;').replace('#include <map_fragment>', `
vec4 c4 = texture2D(map, vMapUv);
float cl = dot(c4.rgb, vec3(0.2126, 0.7152, 0.0722)) / meanL;
diffuseColor.rgb *= tint * clamp(mix(1.0, cl, ${keep.toFixed(2)}), 0.0, 3.0);
diffuseColor.a *= c4.a;`);
    // (the soft pass of the hair: only its edges, the rest was drawn cut out)
    if (edgeOnly) sh.fragmentShader = sh.fragmentShader.replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\nif (diffuseColor.a > 0.6 || diffuseColor.a < 0.03) discard;');
  };
  m.customProgramCacheKey = () => 'mh-tint' + keep + edgeOnly;
  m.userData.U = U;
  return m;
}

// ---- Geometry ----
// Normals on the shared vertices (so the uv seams do not show), copied to the render vertices
function normals(pos, nv, idx, rmap) {
  const n = new Float32Array(nv * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = rmap[idx[t]] * 3, b = rmap[idx[t + 1]] * 3, c = rmap[idx[t + 2]] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += x; n[i + 1] += y; n[i + 2] += z; }
  }
  for (let i = 0; i < nv; i++) { const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1; n[i * 3] /= l; n[i * 3 + 1] /= l; n[i * 3 + 2] /= l; }
  return n;
}
function geometry(pos, nv, idx, rmap, uv, ground) {
  const nr = rmap.length, p = new Float32Array(nr * 3), nn = new Float32Array(nr * 3), sn = normals(pos, nv, idx, rmap);
  for (let r = 0; r < nr; r++) {
    const i = rmap[r] * 3;
    p[r * 3] = pos[i] * M; p[r * 3 + 1] = (pos[i + 1] - ground) * M; p[r * 3 + 2] = pos[i + 2] * M;
    nn[r * 3] = sn[i]; nn[r * 3 + 1] = sn[i + 1]; nn[r * 3 + 2] = sn[i + 2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}
// The expressions as morphs of a geometry: per expression, the offset of each render vertex (metres, relative)
function morphs(g, rmap, deltas) {
  if (!deltas?.length) return;
  g.morphAttributes.position = deltas.map(d => {
    const a = new Float32Array(rmap.length * 3);
    for (let r = 0; r < rmap.length; r++) { const i = rmap[r] * 3; a[r * 3] = d[i] * M; a[r * 3 + 1] = d[i + 1] * M; a[r * 3 + 2] = d[i + 2] * M; }
    return new THREE.BufferAttribute(a, 3);
  });
  g.morphTargetsRelative = true;
}
// An expression's offsets as a full array over n vertices (decimetres)
function dense(e, n) {
  const a = new Float32Array(n * 3);
  for (let k = 0; k < e.idx.length; k++) { const i = e.idx[k] * 3; a[i] = e.d[k * 3]; a[i + 1] = e.d[k * 3 + 1]; a[i + 2] = e.d[k * 3 + 2]; }
  return a;
}

// Where the hair sits: the body vertices its cards are bound to, and those its cards lie close over (within 2 cm, softly),
// per render vertex. Never the face's front under 7 cm over the eyes (a fringe is bound to the forehead it hangs over);
// the shader breaks the edge into strands
function scalp(D, hair, rmap, v) {
  const nv = D.nv, s = new Float32Array(nv), out = new Float32Array(rmap.length), eye = joint(D, v, 'joint-l-eye');
  const face = i => v[i * 3 + 2] > eye[2] - 0.9 && v[i * 3 + 1] < eye[1] + 0.7;
  if (hair) {
    const { refs, w } = hair.d;
    for (let i = 0; i < refs.length; i++) if (Math.abs(w[i]) > 0.05 && refs[i] < D.head.nbody && !face(refs[i])) s[refs[i]] = 1;
    // (the cards over the skin: a grid of 0.2 dm cells of the hair's vertices, and each head vertex's nearest)
    const C = 0.11, grid = new Map(), hv = hair.v, cell = (a, b, c) => (a + 512) * 1048576 + (b + 512) * 1024 + (c + 512), key = (x, y, z) => cell(Math.floor(x / C), Math.floor(y / C), Math.floor(z / C));
    for (let i = 0; i < hv.length; i += 3) { const k = key(hv[i], hv[i + 1], hv[i + 2]); let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(i); }
    for (let i = 0; i < D.head.nbody; i++) {
      const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
      if (y < eye[1] - 0.4 || s[i] === 1) continue;
      let best = 1;
      const cx = Math.floor(x / C), cy = Math.floor(y / C), cz = Math.floor(z / C);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const near = grid.get(cell(cx + a, cy + b, cz + c));
        if (near) for (const j of near) { const dx = hv[j] - x, dy = hv[j + 1] - y, dz = hv[j + 2] - z, d = dx * dx + dy * dy + dz * dz; if (d < best) best = d; }
      }
      const near = Math.min(1, Math.max(0, (0.11 - Math.sqrt(best)) / 0.07));
      if (!face(i)) s[i] = Math.max(s[i], near);
    }
    const idx = D.body.idx;
    for (let pass = 0; pass < 2; pass++) {
      const t = s.slice();
      for (let k = 0; k < idx.length; k += 3) {
        const a = rmap[idx[k]], b = rmap[idx[k + 1]], c = rmap[idx[k + 2]];
        if (!face(a)) t[a] = Math.max(t[a], 0.6 * Math.max(s[b], s[c]));
        if (!face(b)) t[b] = Math.max(t[b], 0.6 * Math.max(s[a], s[c]));
        if (!face(c)) t[c] = Math.max(t[c], 0.6 * Math.max(s[a], s[b]));
      }
      s.set(t);
    }
  }
  for (let r = 0; r < rmap.length; r++) out[r] = s[rmap[r]];
  return out;
}

// The face's maps, measured on the blended head from its landmarks (the nose's tip, the most forward point of the face's
// middle; the mouth just under it; the chin's point; the eyes), soft at their edges, per render vertex:
//   beard: the beard's three zones (moustache, chin, jaw and cheeks)
//   zone:  the T of the face (shiny), the lips, the thin parts (ears, nose, lips: light goes through) and the face's front
//   face:  where on the face (across, in head halves; up from the nose's tip, in decimetres; depth from the nose's tip),
//          for the layers
function faceMaps(D, v, rmap) {
  const e = joint(D, v, 'joint-l-eye'), nb = D.head.nbody;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const band = (x, lo, hi, soft) => ss(lo - soft, lo + soft, x) * (1 - ss(hi - soft, hi + soft, x));
  const tip = (lo, hi) => { let best = -1; for (let i = 0; i < nb; i++) { const y = v[i * 3 + 1]; if (Math.abs(v[i * 3]) < 0.04 && y > lo && y < hi && (best < 0 || v[i * 3 + 2] > v[best * 3 + 2])) best = i; } return best < 0 ? [0, lo, 0] : [0, v[best * 3 + 1], v[best * 3 + 2]]; };
  const nose = tip(e[1] - 0.9, e[1] - 0.2), chin = tip(nose[1] - 1.3, nose[1] - 0.55), mouth = nose[1] - 0.27;
  const bz = new Float32Array(nb * 3), zn = new Float32Array(nb * 4), fc = new Float32Array(nb * 3);
  for (let i = 0; i < nb; i++) {
    const sx = v[i * 3], x = Math.abs(sx), y = v[i * 3 + 1], z = v[i * 3 + 2], dz = z - chin[2];
    fc[i * 3] = sx / 0.7; fc[i * 3 + 1] = y - nose[1]; fc[i * 3 + 2] = z - nose[2];
    if (y > e[1] + 1.4 || y < chin[1] - 0.9 || x > 1.0 || dz < -2.2) continue;
    const front = ss(-0.9, -0.55, dz), lips = (1 - ss(0.2, 0.3, x)) * band(y, mouth - 0.1, mouth + 0.06, 0.025) * ss(-0.5, -0.25, dz);
    const noseZ = (1 - ss(0.16, 0.26, x)) * band(y, nose[1] - 0.18, e[1] - 0.05, 0.05) * ss(-0.6, -0.3, z - nose[2]);
    const ears = ss(0.6, 0.68, x) * band(y, e[1] - 0.6, e[1] + 0.3, 0.08) * (1 - ss(-0.2, 0.2, z - e[2]));
    zn[i * 4] = Math.max(noseZ, (1 - ss(0.3, 0.45, x)) * band(y, e[1] + 0.15, e[1] + 0.95, 0.1) * front, (1 - ss(0.16, 0.26, x)) * band(y, chin[1] - 0.15, mouth - 0.15, 0.05) * front);
    zn[i * 4 + 1] = lips;
    zn[i * 4 + 2] = Math.max(ears, noseZ * 0.7, lips * 0.6);
    zn[i * 4 + 3] = front * (1 - ss(e[1] + 0.9, e[1] + 1.3, y));
    if (y > e[1]) continue;
    const bare = Math.max(lips, (1 - ss(0.16, 0.24, x)) * ss(nose[1] - 0.16, nose[1] - 0.1, y)), keep = 1 - bare;
    bz[i * 3] = band(y, mouth + 0.07, nose[1] - 0.08, 0.025) * (1 - ss(0.24, 0.34, x)) * front * keep;
    bz[i * 3 + 1] = band(y, chin[1] - 0.28, mouth - 0.11, 0.04) * (1 - ss(0.2, 0.3, x)) * front * keep;
    bz[i * 3 + 2] = band(y, chin[1] - 0.6, e[1] - 0.62, 0.07) * (1 - ss(0.68, 0.82, x)) * ss(-1.25, -0.95, dz) * keep;
  }
  const per = (src, k) => { const out = new Float32Array(rmap.length * k); for (let r = 0; r < rmap.length; r++) for (let c = 0; c < k; c++) out[r * k + c] = src[rmap[r] * k + c]; return out; };
  return { beard: per(bz, 3), zone: per(zn, 4), face: per(fc, 3), eyes: [e[0] / 0.7, e[1] - nose[1]] };
}
const BEARD = { bigote: [1, 0, 0], perilla: [0, 1, 0], candado: [1, 1, 0], completa: [1, 1, 1], larga: [1, 1, 1] };

// Cloth does not follow every bump of the skin: how far each garment vertex moved from where it sits on the base body is
// averaged with its neighbours' (three passes), so muscles and ribs do not show through a loose shirt. Not the boots
// nor the belt, which fit tight
const restCloth = new Map(), clothNb = new Map();
function looseCloth(D, name, v) {
  if (name === 'botas' || name === 'cinturon') return v;
  let rest = restCloth.get(name), nb = clothNb.get(name);
  if (!rest) {
    restCloth.set(name, (rest = fitGarment(D, D.pos, name)));
    const d = garment(D, name), sets = Array.from({ length: rest.length / 3 }, () => new Set());
    for (let t = 0; t < d.idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = d.rmap[d.idx[t + k]], b = d.rmap[d.idx[t + (k + 1) % 3]]; if (a !== b) { sets[a].add(b); sets[b].add(a); } }
    clothNb.set(name, (nb = sets.map(x => Uint32Array.from(x))));
  }
  let dv = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) dv[i] = v[i] - rest[i];
  // (what hangs, bound far from the skin to the coarse skirt helper, more: its rows would show as ridges)
  const passes = name === 'delantal' || name === 'tunica_larga' || name === 'abrigo' || name === 'tunica' ? 9 : 3;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float32Array(dv.length);
    for (let i = 0; i < nb.length; i++) {
      const n = nb[i];
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < n.length; k++) { const j = n[k] * 3; x += dv[j]; y += dv[j + 1]; z += dv[j + 2]; }
      const m = n.length || 1, s = n.length ? 0.6 : 0;
      next[i * 3] = dv[i * 3] * (1 - s) + (x / m) * s; next[i * 3 + 1] = dv[i * 3 + 1] * (1 - s) + (y / m) * s; next[i * 3 + 2] = dv[i * 3 + 2] * (1 - s) + (z / m) * s;
    }
    dv = next;
  }
  for (let i = 0; i < v.length; i++) v[i] = rest[i] + dv[i];
  return v;
}

// A built person: root (a Group, feet on y 0, facing +z), height, eyeY (for the camera), ms (how long it took), and the
// expressions (EXPR ids) to set with setExpression, the eyes to turn with setGaze
export class MhPerson {
  // (opts.restPose: the game's pose in place of the arms down, src/three/mh/rig.js; it may leave this.rig.squeeze, arrays
  // of decimetres squeezed with the rest)
  constructor(D, look, opts = {}) {
    this.D = D;
    this.opts = opts;
    this.root = new THREE.Group();
    this.mats = {};
    this.expr = D.head.expr || [];
    this.build(look);
  }
  // The shape key: what needs the geometry made again (colours and the skin's layers only touch the materials)
  static shapeKey(look) {
    return JSON.stringify([look.sex, look.mh?.macro || null, look.mh?.face || null, look.hairStyle, look.brows, look.outfit, look.wear ? Object.values(look.wear).map(w => w?.id).join() : null, hairKey(look)]);
  }
  build(look) {
    const t0 = performance.now(), D = this.D, sex = look.sex === 'chico' ? 'chico' : 'chica';
    this.clear();
    const prof = this.prof = {}, lap = k => { prof[k] = performance.now(); };
    const v = blend(D, look.mh, sex), nb = D.head.nbody;
    // (the expressions depend only on the origin: kept while it stays, and copied, since a giant is squeezed below)
    const m0 = look.mh?.macro || {}, exKey = [m0.af, m0.as, m0.ca].join();
    if (this.exKey !== exKey) { this.exKey = exKey; this.ex0 = expressions(D, look.mh); this.exDense = this.ex0.map(e => dense(e, D.nv)); }
    const ex = this.ex0.map(e => ({ id: e.id, idx: e.idx, d: e.d.slice() }));
    lap('blend');
    // The bound meshes first, on the base still in its A pose; those of the face also with each expression on
    const parts = [['eyes', 'high-poly'], ['brows', browsOf(look)], ['lashes', lashesOf(look)], ['teeth', 'teeth_base'], ['tongue', 'tongue01']];
    // (P4: our own hair and beard of cards, hair.js; MakeHuman's hair only if their pack did not load)
    const hair = D.hair ? null : hairOf(look);
    if (hair) parts.push(['hair', hair]);
    const fitted = parts.map(([kind, name]) => ({ kind, name, P: D.proxies.get(name), d: proxy(D, name), v: fit(D, v, name) })).filter(x => x.v);
    // (the clothes: our own garments, bound to the skin's triangles)
    for (const c of garmentsOf(look)) {
      const d = garment(D, c.name);
      if (d) fitted.push({ kind: 'garment', name: c.name, wear: c, P: D.garments.get(c.name), d, v: looseCloth(D, c.name, fitGarment(D, v, c.name)) });
    }
    fitted.push(...hairFits(D, v, look));
    const facial = fitted.filter(f => ['brows', 'lashes', 'teeth', 'tongue', 'ownbeard'].includes(f.kind));
    for (const f of facial) f.morphs = [];
    const shift = (e, k) => { for (let n = 0; n < e.idx.length; n++) { const i = e.idx[n] * 3; v[i] += e.d[n * 3] * k; v[i + 1] += e.d[n * 3 + 1] * k; v[i + 2] += e.d[n * 3 + 2] * k; } };
    for (const e of ex) {
      shift(e, 1);
      for (const f of facial) { const w = f.refit ? f.refit(v) : fit(D, v, f.name); for (let i = 0; i < w.length; i++) w[i] -= f.v[i]; f.morphs.push(w); }
      shift(e, -1);
    }
    lap('fit');
    // Then the arms down: the body with its weights; each bound vertex with its three base vertices' weights (in the game,
    // its own rest pose instead: rig.js)
    if (this.opts.restPose) this.opts.restPose(this, D, v, fitted);
    else {
      const mc = look.mh?.macro || {}, skirt = fitted.some(f => f.name === 'tunica_larga' || f.name === 'abrigo') ? 1.5 : fitted.some(f => f.name === 'tunica') ? 0.5 : 0;
      const pose = armPose(D, v, skirt + Math.max(0, (mc.weight || 0) + 0.6 * (mc.muscle || 0)) / 140), arm = D.body.arm;
      const wU = i => arm[i * 2] / 255, wL = i => arm[i * 2 + 1] / 255;
      for (const f of fitted) {
        if (!f.d) continue;   // (our hair: on the head, the arms do not move it)
        const { refs, w } = f.d, bw = (i, fn) => w[i * 3] * fn(refs[i * 3]) + w[i * 3 + 1] * fn(refs[i * 3 + 1]) + w[i * 3 + 2] * fn(refs[i * 3 + 2]);
        poseInPlace(f.v, f.P.nv, i => bw(i, wU), i => bw(i, wL), pose);
      }
      poseInPlace(v, nb, wU, wL, pose);
    }
    lap('pose');
    // Feet on the ground: the lowest of the body and the boots
    let ground = Infinity;
    for (let i = 0; i < nb; i++) ground = Math.min(ground, v[i * 3 + 1]);
    for (const f of fitted) if (f.kind === 'garment') for (let i = 0; i < f.P.nv; i++) ground = Math.min(ground, f.v[i * 3 + 1]);
    // (twice MakeHuman's range can make a giant: the person is kept under 1.95 m and 0.78 m across, door, bed and saddle)
    let top = -Infinity, wide = 0;
    for (let i = 0; i < nb; i++) { top = Math.max(top, v[i * 3 + 1]); wide = Math.max(wide, Math.abs(v[i * 3])); }
    const ky = Math.min(1, 19.5 / (top - ground)), kx = Math.min(1, 3.9 / (wide * ky));
    const squeezed = ky < 1 || kx < 1;
    if (squeezed) {
      const squeeze = a => { for (let i = 0; i < a.length; i += 3) { a[i] *= ky * kx; a[i + 1] = ground + (a[i + 1] - ground) * ky; a[i + 2] *= ky; } };
      squeeze(v);
      for (const a of this.rig?.squeeze || []) squeeze(a);
      for (const f of fitted) { squeeze(f.v); for (const m of f.morphs || []) for (let i = 0; i < m.length; i += 3) { m[i] *= ky * kx; m[i + 1] *= ky; m[i + 2] *= ky; } }
      for (const e of ex) for (let n = 0; n < e.d.length; n += 3) { e.d[n] *= ky * kx; e.d[n + 1] *= ky; e.d[n + 2] *= ky; }
    }
    this.ground = ground;
    // The skin under the clothes is not drawn (no poking through, fewer triangles)
    const hide = new Uint8Array(D.nv);
    for (const f of fitted) if (f.d?.del) for (const i of f.d.del) hide[i] = 1;
    const bi = D.body.idx, rm = D.body.rmap, keep = [];
    // (a skin triangle goes when all of it is under cloth: the garments cover with a margin from their openings)
    for (let t = 0; t < bi.length; t += 3) if (!(hide[rm[bi[t]]] && hide[rm[bi[t + 1]]] && hide[rm[bi[t + 2]]])) keep.push(bi[t], bi[t + 1], bi[t + 2]);
    const uv = new Float32Array(D.body.uv.length);
    for (let i = 0; i < uv.length; i++) uv[i] = D.body.uv[i] / 65535;
    const bodyGeo = geometry(v, D.nv, new Uint16Array(keep), rm, uv, ground);
    lap('geo');
    const fm = faceMaps(D, v, rm);
    lap('maps');
    const own = fitted.find(f => f.kind === 'ownhair');
    bodyGeo.setAttribute('scalp', new THREE.BufferAttribute(D.hair ? scalpOf(own, D.nv, rm) : scalp(D, fitted.find(f => f.kind === 'hair'), rm, v), 1));
    lap('scalp');
    bodyGeo.setAttribute('beardZone', new THREE.BufferAttribute(fm.beard, 3));
    bodyGeo.setAttribute('zone', new THREE.BufferAttribute(fm.zone, 4));
    bodyGeo.setAttribute('face', new THREE.BufferAttribute(fm.face, 3));
    morphs(bodyGeo, rm, squeezed ? ex.map(e => dense(e, D.nv)) : this.exDense);
    this.eyesF = fm.eyes;
    lap('body');
    const body = new THREE.Mesh(bodyGeo, this.mat('skin:' + sex, () => skinMaterial(sex)));
    body.name = 'body';
    this.root.add(body);
    this.eyes = [];
    for (const f of fitted) {
      if (f.s) { this.root.add(...hairMeshes(f, ground, (k, make) => this.mat(k, make))); continue; }
      const g = geometry(f.v, f.P.nv, f.d.idx, f.d.rmap, f.d.uv, ground);
      if (f.morphs) morphs(g, f.d.rmap, f.morphs);
      let mesh;
      if (f.kind === 'eyes') { this.eyeBalls(g); continue; }
      if (f.kind === 'brows') mesh = new THREE.Mesh(g, this.mat('brows:' + f.name, () => tinted(`brow-${f.name}.png`, { blendEdges: true })));
      else if (f.kind === 'lashes') mesh = new THREE.Mesh(g, this.mat('lashes:' + f.name, () => tinted(`lash-${f.name}.png`, { blendEdges: true, colour: '#1a1410' })));
      else if (f.kind === 'teeth') mesh = new THREE.Mesh(g, this.mat('teeth', () => (() => { const m = new THREE.MeshStandardMaterial({ map: tex('teeth.jpg'), color: '#e8dcc4', roughness: 0.42, envMapIntensity: 0.15 }); m.userData.env = 0.15; return m; })()));
      else if (f.kind === 'tongue') mesh = new THREE.Mesh(g, this.mat('tongue', () => new THREE.MeshStandardMaterial({ map: tex('tongue.jpg'), roughness: 0.4 })));
      else if (f.kind === 'hair') {
        mesh = new THREE.Mesh(g, this.mat('hair:' + f.name, () => tinted(`hair-${f.name}.jpg`, { alpha: `hair-${f.name}.a.png`, cutout: true, rough: 0.5, test: 0.5 })));
        // (its soft edges, over the cut-out cards: no hard line where the hair meets the forehead)
        const soft = new THREE.Mesh(g, this.mat('hairsoft:' + f.name, () => tinted(`hair-${f.name}.jpg`, { alpha: `hair-${f.name}.a.png`, blendEdges: true, edgeOnly: true, rough: 0.5 })));
        soft.renderOrder = 3; soft.name = 'hairsoft:' + f.name;
        this.root.add(soft);
      } else if (f.kind === 'garment') {
        g.setAttribute('att', new THREE.BufferAttribute(f.d.att, 4, true));
        mesh = new THREE.Mesh(g, this.mat('garment:' + f.name, () => clothMaterial({ leather: f.wear.leather, fleece: f.wear.fleece })));
      }
      mesh.name = f.kind + ':' + f.name;
      if (f.kind === 'brows' || f.kind === 'lashes') mesh.renderOrder = 1;
      this.root.add(mesh);
    }
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = o.material.depthWrite !== false; o.receiveShadow = true; } });
    top = 0;
    for (let i = 0; i < nb; i++) top = Math.max(top, v[i * 3 + 1]);
    this.height = (top - ground) * M;
    this.eyeY = (joint(D, v, 'joint-l-eye')[1] - ground) * M;
    wide = 0;
    for (let i = 0; i < nb; i++) wide = Math.max(wide, Math.abs(v[i * 3]));
    this.width = wide * 2 * M;
    this.key = MhPerson.shapeKey(look);
    this.colour(look);
    this.setExpression(this.face || {});
    this.tris = 0;
    this.root.traverse(o => { if (o.isMesh && !/^\w*soft:/.test(o.name)) this.tris += o.geometry.index.count / 3; });
    lap('parts');
    this.ms = performance.now() - t0;
    let at = t0;
    for (const k in prof) { const x = prof[k]; prof[k] = +(x - at).toFixed(1); at = x; }
  }
  // The two eyeballs, each its own mesh turning round its centre (where it looks), with its cornea: the same ball a little
  // bigger, clear, only its shine added
  eyeBalls(g) {
    const p = g.attributes.position;
    for (const side of [1, -1]) {
      const keep = [], idx = g.index.array, c = new THREE.Vector3();
      const box = new THREE.Box3();
      for (let i = 0; i < p.count; i++) if (Math.sign(p.getX(i)) === side) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(p, i));
      box.getCenter(c);
      for (let t = 0; t < idx.length; t += 3) if (Math.sign(p.getX(idx[t])) === side) keep.push(idx[t], idx[t + 1], idx[t + 2]);
      const eg = g.clone();
      eg.setIndex(new THREE.BufferAttribute(new Uint16Array(keep), 1));
      eg.translate(-c.x, -c.y, -c.z);
      const cg = eg.clone().scale(1.012, 1.012, 1.012);
      const pivot = new THREE.Group();
      pivot.position.copy(c); pivot.name = side > 0 ? 'eye:l' : 'eye:r';
      const ball = new THREE.Mesh(eg, this.mat(side > 0 ? 'eye:l' : 'eye:r', eyeMaterial));
      const cornea = new THREE.Mesh(cg, this.mat('cornea', () => { const m = new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.05, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: 0.3 }); m.userData.env = 0.3; return m; }));
      cornea.renderOrder = 2; cornea.name = 'cornea'; ball.name = 'eyes';
      pivot.add(ball, cornea);
      this.root.add(pivot);
      this.eyes.push(pivot);
    }
  }
  // The face: { blink, smile, jaw_open, … } 0..1 (MakeHuman's expression units, shape.js); the rest stay at 0
  setExpression(w) {
    this.face = w;
    this.root.traverse(o => {
      if (!o.isMesh || !o.morphTargetInfluences) return;
      this.expr.forEach((id, k) => { o.morphTargetInfluences[k] = w[id] || 0; });
    });
  }
  // Where the eyes look: yaw (right is +) and pitch (up is +), radians
  setGaze(yaw, pitch) { for (const e of this.eyes || []) e.rotation.set(-pitch, yaw, 0, 'YXZ'); }
  // The colours (no new geometry): skin tone, age and layers, eyes, hair and brows, clothes
  colour(look) {
    const skinMat = this.mats[`skin:${look.sex === 'chico' ? 'chico' : 'chica'}`], S = skinMat?.userData.U, hairC = new THREE.Color(look.hair || '#4a2c1c');
    const bw = look.sex === 'chico' ? BEARD[look.beard] : null;
    if (skinMat) skinMat.sheenColor.set(look.skin || '#e8b07a').multiplyScalar(0.55);   // (the soft light at the edges, of the skin's own colour)
    if (S) {
      S.beard.value.set(...(this.D.hair ? stubbleOf(look) : bw || [0, 0, 0]), 1); S.hairC.value.copy(hairC); S.tone.value.set(look.skin || '#e8b07a');
      S.age.value = Math.min(1, Math.max(0, (yearsOf(look.mh) - 30) / 45));
      S.eyesF.value.set(...(this.eyesF || [0.3, 0.45]));
      setLayers(S, look);
    }
    this.mats['eye:l']?.userData.U.iris.value.set(look.eyes || '#3a2a1e');
    this.mats['eye:r']?.userData.U.iris.value.set(look.mh?.eye2 || look.eyes || '#3a2a1e');
    for (const [k, m] of Object.entries(this.mats)) {
      if (k.startsWith('hair:') || k.startsWith('hairsoft:')) m.userData.U.tint.value.copy(hairC);
      else if (k.startsWith('brows:')) m.userData.U.tint.value.copy(hairC).multiplyScalar(0.75);
    }
    for (const c of garmentsOf(look)) {
      const U = this.mats['garment:' + c.name]?.userData.U;
      if (U) { U.c1.value.set(c.colour); U.c2.value.set(c.colour2); U.tear.value = c.tear; U.skin.value.set(look.skin || '#c99d7b'); }
    }
    hairColour(this.mats, look);
  }
  mat(key, make) { return (this.mats[key] ||= make()); }
  clear() {
    for (const o of [...this.root.children]) { this.root.remove(o); o.traverse(x => x.geometry?.dispose()); }
  }
  dispose() {
    this.clear();
    for (const m of Object.values(this.mats)) m.dispose();
    this.mats = {};
  }
}

// The layers' numbers into the skin's uniforms (skin.js says what each is)
function setLayers(S, look) { layerUniforms(S, look.mh?.skin || {}); }
