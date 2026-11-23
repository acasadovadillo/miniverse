// The surface overlay of the realistic people: dirt, mud, wet, snow, blood and sweat drawn by the shader over the
// look's canvas, never painted into it. Design: docs/planes/gta/PLAN-E-cuerpo-aspecto.md §5.2. Owner: Track B. Batch F
// (the horse's mud) reuses the chunk on the animals.
//
// How it works with Three r160. The people of one look share one canvas, one texture and one material, and every persona
// material shares one program (customProgramCacheKey). onBeforeCompile runs once per MATERIAL (each keeps its own uniforms
// object) while the compiled program is shared by its key, so the overlay code goes into EVERY persona material (the
// shared ones get all-zero uniforms and skip it behind a uniform branch) and each material reads its own values. A person
// with a surface gets a material of its own (grimeMaterial: the same map, hooks and program key, so nothing is compiled),
// or, for the player, whose meshes already have their own copies (actors.js ownMesh), only its uniforms are written.
// There is no second program variant: the one persona program carries the overlay, compiled with it wherever the
// people's program is compiled (engine.js compileFor and gate), so nothing new needs warming up.
//
// Contract (plan §10; keep the names):
//   GRIME_VERT          GLSL after `#include <begin_vertex>`: the REST-pose position and normal (the attributes, before
//                       skinning: the persona is built in metres at rest, feet at 0) as the varyings vRest and vRestN
//   GRIME_FRAG          GLSL after `#include <map_fragment>`: the overlay on diffuseColor, inside a branch on the sum of
//                       the uniforms; it sets grR, the roughness multiplier the roughness line applies (GRIME_ROUGH)
//   GRIME_UNIFORMS      the uniform names (each material has its own values, one shared program):
//                         uGrime  vec4 (dirt, mud, wet, snow)          0..1 (body.surface())
//                         uGrime2 vec4 (blood, wetLegs, sweat, shiver) 0..1; wetLegs also sets the water line on the legs
//                                                                      (0.08 + 0.5 × wetLegs of the height)
//                         uTall   float: the prototype's standing height in metres, as its rest-pose geometry is built
//                                 (a child is built at adult size and scaled at its root: its d.alto is the right one)
//   injectGrime(sh, mat, opts)  puts the overlay into a shader being compiled (from an onBeforeCompile); opts.skin and
//                       opts.hair are GLSL expressions for the skin and hair masks (0 when the material has none), and
//                       opts.rough the line after which the roughness is multiplied
//   grimeMaterial(base) a material of its own for one person with a surface: same map, same hooks, same program key, its
//                       own uniforms; the caller disposes it (never the shared map). RealPerson.setGrime uses it
//   writeGrime(mat, s, tall) / clearGrime(mat)  the uniform values of one material (s: body.surface()'s shape, 0..1)
//   hasGrime(s)         is anything on this surface worth drawing (above 1/100)?
// The cheap chibi people (?arte=1, three/people.js) get no overlay. With ?cuerpo=0 realperson.js never installs it: the
// persona program is exactly the one of before.
import * as THREE from 'three';

export const GRIME_UNIFORMS = ['uGrime', 'uGrime2', 'uTall'];
const EPS = 0.01;   // (less than this on every channel: drawn clean, and the person goes back to the shared material)

// Declarations (after `#include <common>` in each stage)
const VERT_DECL = 'varying vec3 vRest;\nvarying vec3 vRestN;';
const FRAG_DECL = `varying vec3 vRest;
varying vec3 vRestN;
uniform vec4 uGrime;
uniform vec4 uGrime2;
uniform float uTall;
// 3-D value noise (about 40 ALU an octave): the patches of dirt and blood and the broken edges of mud and snow. Inside
// the overlay's branch two octaves always run (n, n2); the mud splashes, the blood blotches and the sweat beads each add
// one more only while their own channel is on (uniform branches: nothing for a body without mud, blood or sweat)
float grHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float grNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(grHash(i), grHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(grHash(i + vec3(0.0, 1.0, 0.0)), grHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(grHash(i + vec3(0.0, 0.0, 1.0)), grHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(grHash(i + vec3(0.0, 1.0, 1.0)), grHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}`;
export const GRIME_VERT = 'vRest = position; vRestN = normal;';
// GR_SKIN and GR_HAIR: the masks, defined by injectGrime for each kind of material. (Every smoothstep has edge0 < edge1:
// the reversed form is undefined in GLSL and differs between drivers; and no pow of a negative base, also undefined)
export const GRIME_FRAG = `float grR = 1.0;
if (uGrime.x + uGrime.y + uGrime.z + uGrime.w + uGrime2.x + uGrime2.y + uGrime2.z + uGrime2.w > 0.0) {
  float h = vRest.y / max(uTall, 0.3), ax = abs(vRest.x), n = grNoise(vRest * 11.0), n2 = grNoise(vRest * 3.3 + 5.0), sk = GR_SKIN, hr = GR_HAIR;
  vec3 c = diffuseColor.rgb;
  // (every colour here is LINEAR, as diffuseColor is: an sRGB 0.46 would be 0.18 here, and a value picked by eye in sRGB
  // comes out far too pale)
  // dirt: a dull film and brown smudges about 10 cm across (two octaves), stronger on the forearms and hands (they hang
  // by the hips at rest), the knees and the hem; less in the hair and on the face. The colour under it is dulled first
  // (most of its saturation goes), then darkened towards brown and mixed with the colour of earth: straight onto a dark
  // blue cloth the earth's red would lift it to a pale lilac haze instead of grime
  float limb = smoothstep(0.16, 0.22, ax) * smoothstep(0.36, 0.44, h) * (1.0 - smoothstep(0.6, 0.68, h));
  float kq = (h - 0.29) / 0.05, knee = exp(-kq * kq), hem = 1.0 - smoothstep(0.06, 0.2, h);
  float mk = max(max(limb, knee), hem), grP = smoothstep(0.4, 0.62, 0.35 * n2 + 0.65 * n);
  float dk = uGrime.x * (0.22 + 0.3 * mk + (0.6 + 0.3 * mk) * grP) * (1.0 - 0.7 * hr) * (1.0 - 0.35 * sk * step(0.86, h));
  vec3 dull = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))), 0.7);
  // (the target is mostly an absolute dusty earth: on dark trousers dirt reads lighter, on skin and a pale shirt darker.
  // Darkening the cloth's own colour alone was lost on the dark clothes of most looks)
  c = mix(c, mix(dull * vec3(0.62, 0.5, 0.36), vec3(0.17, 0.12, 0.07) * (0.8 + 0.4 * n2), 0.62), clamp(dk, 0.0, 0.9));
  // mud: feet and shins, up to 0.10 + 0.25 × mud of the height, the edge broken by the noise and thicker towards the feet;
  // dark and glossy when wet, pale and dusty when dry
  float wetK = max(uGrime.z, uGrime2.y), mline = 0.10 + 0.25 * uGrime.y + (n - 0.5) * 0.08;
  float md = (1.0 - smoothstep(mline - 0.03, mline + 0.03, h)) * smoothstep(0.0, 0.2, uGrime.y) * (0.6 + 0.4 * (1.0 - smoothstep(0.0, mline, h)));
  // (splashes: a few spots up to a hand above the line)
  // (below 0.2 of mud the last factor is 0: the noise is not even looked up)
  if (uGrime.y > 0.2) {
    float sp = (1.0 - smoothstep(mline, mline + 0.09, h)) * step(mline, h) * smoothstep(0.55, 0.62, grNoise(vRest * 47.0 + 3.0) * (0.55 + 0.6 * n)) * smoothstep(0.2, 0.5, uGrime.y);
    md = max(md, sp);
  }
  // (dry: a pale caked earth that stands out on dark trousers and boots; wet: a mid brown, dark but not black, with the
  // gloss doing the rest. The vertex colours' contact shading multiplies this afterwards, so both are lighter than they read)
  c = mix(c, mix(vec3(0.3, 0.22, 0.13), vec3(0.1, 0.064, 0.032), wetK) * (0.75 + 0.5 * n), md * 0.95);
  grR = mix(grR, mix(1.15, 0.38, wetK), md);
  // blood: shoulders and upper chest, front and back, in blotches
  // (without blood the smoothstep's argument is -0.2: 0, so the whole block is skipped)
  if (uGrime2.x > 0.0) {
    float bq = (h - 0.79) / 0.065, bz = exp(-bq * bq) * (1.0 - smoothstep(0.15, 0.27, ax));
    float bd = smoothstep(0.36, 0.44, uGrime2.x * bz * (0.15 + 0.5 * n + 0.8 * grNoise(vRest * 23.0 + 11.0)) - 0.2);
    c = mix(c, vec3(0.085, 0.006, 0.005) * (0.75 + 0.5 * n), bd * 0.95);
    grR = mix(grR, 0.6, bd);
  }
  // wet: darker and glossier, all over (wet) or below the water line (wetLegs); skin darkens less than cloth
  float wline = 0.08 + 0.5 * uGrime2.y, wt = max(uGrime.z, step(0.001, uGrime2.y) * (1.0 - smoothstep(wline - 0.02, wline + 0.02, h)));
  c *= mix(1.0, mix(0.55, 0.85, sk), wt);
  grR *= mix(1.0, 0.42, wt);
  // snow: on what faces up high (shoulders, the top of the head, hat brims)
  float sn = smoothstep(0.15, 0.45, uGrime.w * smoothstep(0.4, 0.75, vRestN.y) * smoothstep(0.72, 0.8, h) * (0.5 + n));
  c = mix(c, vec3(0.93, 0.95, 0.98), sn);
  grR = mix(grR, 0.95, sn);
  // sweat (heat): a sheen on the skin only; shivering (cold): the skin a touch paler and cooler
  // (glossier in beads where the noise is high, so the sun catches it in spots and not as one plastic shine)
  // (the light catches beads on what faces up and forward, the brow, the nose, the cheekbones: a lighter fleck in them,
  // since the gloss alone shows only where the sun or the sky happens to reflect)
  // (every sweat line is multiplied by uGrime2.z: without sweat, skipped)
  if (uGrime2.z > 0.0) {
    float bead = smoothstep(0.6, 0.78, grNoise(vRest * 53.0 + 7.0)) * smoothstep(0.0, 0.7, max(vRestN.y, 0.0) + max(vRestN.z, 0.0) * 0.8);
    grR *= 1.0 - uGrime2.z * sk * (0.72 + 0.2 * bead);
    c = mix(c, c * vec3(1.02, 0.86, 0.82), uGrime2.z * sk * 0.5);   // (flushed and darker, as hot damp skin is)
    c = mix(c, c * 1.35 + 0.015, uGrime2.z * sk * bead * 0.55);
  }
  c *= mix(vec3(1.0), vec3(0.95, 0.97, 1.02), uGrime2.w * sk);
  diffuseColor.rgb = c;
}`;
export const GRIME_ROUGH = 'roughnessFactor = clamp(roughnessFactor * grR, 0.04, 1.0);';

// The uniforms of each material (one object per material, made the first time it is asked for: by the compile or by
// writeGrime, whichever comes first). A WeakMap, not userData: clone() copies userData by JSON, which would turn the
// vectors into plain objects and share nothing
const UNI = new WeakMap();
function uniformsOf(mat) {
  let u = UNI.get(mat);
  // (all four components 0: THREE.Vector4() starts at w = 1, which would draw snow and a shiver on everyone never written)
  if (!u) UNI.set(mat, (u = { uGrime: { value: new THREE.Vector4(0, 0, 0, 0) }, uGrime2: { value: new THREE.Vector4(0, 0, 0, 0) }, uTall: { value: 1.7 } }));
  return u;
}

const WARNED = new Set();
const once = msg => { if (!WARNED.has(msg)) { WARNED.add(msg); console.warn('GRIME: ' + msg); } };
// Into a shader being compiled (sh: the onBeforeCompile parameters) of material mat
export function injectGrime(sh, mat, { skin = '0.0', hair = '0.0', rough = '#include <roughnessmap_fragment>' } = {}) {
  const u = uniformsOf(mat);
  for (const k of GRIME_UNIFORMS) sh.uniforms[k] = u[k];
  const v0 = sh.vertexShader, f0 = sh.fragmentShader;
  const v = v0.replace('#include <common>', `#include <common>\n${VERT_DECL}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${GRIME_VERT}`);
  let f = f0.replace('#include <common>', `#include <common>\n#define GR_SKIN (${skin})\n#define GR_HAIR (${hair})\n${FRAG_DECL}`).replace('#include <map_fragment>', `#include <map_fragment>\n${GRIME_FRAG}`);
  if (f.includes(rough)) f = f.replace(rough, `${rough}\n${GRIME_ROUGH}`);
  else if (f.includes('#include <roughnessmap_fragment>')) f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${GRIME_ROUGH}`);
  else once('no roughness line to hook (drawn without the gloss)');
  // (all or nothing: a half-patched shader would not compile)
  if (v === v0 || f === f0 || !f.includes('grR = 1.0') || !v.includes('vRest = position')) { once('could not hook the shader: drawn without the overlay'); return false; }
  sh.vertexShader = v; sh.fragmentShader = f;
  return true;
}

// Is anything on this surface worth drawing?
export function hasGrime(s) {
  return !!s && (s.dirt > EPS || s.mud > EPS || s.wet > EPS || s.snow > EPS || s.blood > EPS || s.wetLegs > EPS || s.sweat > EPS || s.shiver > EPS);
}
const c01 = v => (v > 0 ? (v < 1 ? v : 1) : 0);
// The values of one material (s: { dirt, mud, wet, wetLegs, snow, blood, shiver, sweat }, 0..1; missing ones read 0)
export function writeGrime(mat, s, tall = 1.7) {
  const u = uniformsOf(mat);
  u.uGrime.value.set(c01(s.dirt), c01(s.mud), c01(s.wet), c01(s.snow));
  u.uGrime2.value.set(c01(s.blood), c01(s.wetLegs), c01(s.sweat), c01(s.shiver));
  u.uTall.value = tall;
}
export function clearGrime(mat) {
  const u = UNI.get(mat);
  if (u) { u.uGrime.value.set(0, 0, 0, 0); u.uGrime2.value.set(0, 0, 0, 0); }
}
// A material of its own for one person: the same map, hooks and program key (clone() copies neither of those two hooks)
export function grimeMaterial(base) {
  const m = base.clone();
  m.onBeforeCompile = base.onBeforeCompile;
  m.customProgramCacheKey = base.customProgramCacheKey;
  uniformsOf(m);
  return m;
}
