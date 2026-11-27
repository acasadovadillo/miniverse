// A MakeHuman person for the new creator (plan CR, P1, ?creador=nuevo): the hm08 body with the look's shapes blended
// once (shape.js), a photo skin shared by sex and age and tinted with the look's tone, eyes with iris and cornea, card
// brows and lashes, and MakeHuman's own hair and provisional clothes, bound to the body. Standing still (no bones yet:
// that is P5). Only the creator draws it; the game's people are still persona.js.
import * as THREE from 'three';
import { mhUrl, proxy } from './data.js';
import { blend, fit, joint, armPose, poseInPlace, yearsOf } from './shape.js';
import { hairOf, browsOf, lashesOf, clothesOf } from './looks.js';

const M = 0.1;   // MakeHuman's decimetres to metres

// ---- Textures: one copy each, shared by every person ----
const texCache = new Map();
function tex(name, { srgb = true, onLoad = null } = {}) {
  let t = texCache.get(name);
  if (!t) {
    t = new THREE.TextureLoader().load(mhUrl(name), () => { t.userData.ready = true; for (const f of t.userData.wait) f(t.image); t.userData.wait = []; });
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
// The mean colour of a photo, linear (to take it out of the skin and keep only its detail)
function meanLinear(img) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 64, 64);
  const px = g.getImageData(0, 0, 64, 64).data, s = [0, 0, 0];
  const lin = x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  let n = 0;
  for (let i = 0; i < px.length; i += 4) { if (px[i] + px[i + 1] + px[i + 2] < 60) continue; s[0] += lin(px[i]); s[1] += lin(px[i + 1]); s[2] += lin(px[i + 2]); n++; }
  return new THREE.Vector3(s[0] / n, s[1] / n, s[2] / n);
}
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// ---- Materials ----
// The skin: the young and the old photo of the sex, mixed by age, divided by their mean colour (only the pores, veins,
// lips and wrinkles stay) and times the look's tone; a little of the photo's own hue stays for the lips and cheeks
function skinMaterial(sex) {
  const s = sex === 'chico' ? 'male' : 'female', U = {
    mapOld: { value: tex(`skin-${s}-old.jpg`) }, age: { value: 0 }, tone: { value: new THREE.Color('#e8b07a') },
    meanY: { value: new THREE.Vector3(0.5, 0.35, 0.28) }, meanO: { value: new THREE.Vector3(0.5, 0.35, 0.28) }, hairC: { value: new THREE.Color('#2a1e1e') },
    beard: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  const young = tex(`skin-${s}-young.jpg`, { onLoad: img => U.meanY.value.copy(meanLinear(img)) });
  tex(`skin-${s}-old.jpg`, { onLoad: img => U.meanO.value.copy(meanLinear(img)) });
  // (the photo is its own bump map: the pores and wrinkles catch the light)
  const m = new THREE.MeshPhysicalMaterial({ map: young, bumpMap: young, bumpScale: 0.9, roughness: 0.52, sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color('#a8442a'), specularIntensity: 0.45 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    // (scalp: where the hair is bound, the skin takes the hair's colour, so no bare skin shows between the cards)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float scalp; attribute vec3 beardZone; varying float vScalp; varying vec3 vBeard;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvScalp = scalp; vBeard = beardZone;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
uniform sampler2D mapOld; uniform float age; uniform vec3 tone, meanY, meanO, hairC; uniform vec4 beard; varying float vScalp; varying vec3 vBeard;`).replace('#include <map_fragment>', `
vec3 ty = texture2D(map, vMapUv).rgb / meanY, to = texture2D(mapOld, vMapUv).rgb / meanO;
vec3 dt = mix(ty, to, age);
float dl = dot(dt, vec3(0.2126, 0.7152, 0.0722));
vec3 tn = mix(vec3(dot(tone, vec3(0.2126, 0.7152, 0.0722))), tone, 0.72);   // (a little less saturated: the curve adds it back)
diffuseColor.rgb *= tn * mix(vec3(dl), dt, 0.35);
diffuseColor.rgb = mix(diffuseColor.rgb, hairC * (0.45 + 0.4 * dl), vScalp * 0.9);
// (the beard, painted for now (P4 makes it of cards): its zones, moustache, chin and jaw, with the look's style; hairs from
// a fine noise of the skin's uv, thicker as it grows)
float bz = clamp(dot(vBeard, beard.xyz), 0.0, 1.0);
if (bz > 0.0) {
  vec2 hu = vMapUv * vec2(2400.0, 900.0);
  float hn = fract(sin(dot(floor(hu), vec2(12.9898, 78.233))) * 43758.5453);
  float dense = bz * mix(0.55 + 0.45 * hn, 0.9 + 0.1 * hn, beard.w);
  diffuseColor.rgb = mix(diffuseColor.rgb, hairC * (0.6 + 0.5 * hn), dense * 0.92);
}`);
  };
  m.customProgramCacheKey = () => 'mh-skin';
  m.userData.U = U;
  return m;
}
// The eyes: MakeHuman's iris photo, its colour taken out and the look's put in (only where it is coloured: the white
// and the pupil stay)
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
// colour. Hair comes in two files, colour and alpha; the brows and lashes blend their edges, hair is cut out
function tinted(file, { alpha = null, colour = '#2a1e1e', blendEdges = false, cutout = false, rough = 0.6, keep = 0.85, test = 0.5 } = {}) {
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
  };
  m.customProgramCacheKey = () => 'mh-tint' + keep;
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

// Where the hair sits: the body vertices its cards are bound to, softened two rings out over the mesh (per render vertex).
// Never the face (a fringe is bound to the forehead it hangs over): nothing in front lower than 7 cm over the eyes
function scalp(D, hair, rmap, v) {
  const nv = D.nv, s = new Float32Array(nv), out = new Float32Array(rmap.length), eye = joint(D, v, 'joint-l-eye');
  const face = i => v[i * 3 + 2] > eye[2] - 0.9 && v[i * 3 + 1] < eye[1] + 0.7;
  if (hair) {
    const { refs, w } = hair.d;
    for (let i = 0; i < refs.length; i++) if (Math.abs(w[i]) > 0.05 && refs[i] < D.head.nbody && !face(refs[i])) s[refs[i]] = 1;
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

// The beard's three zones (moustache, chin, jaw and cheeks), measured on the blended head from the nose's tip (the most
// forward point of the face's middle), the mouth just under it and the chin's point, soft at their edges (decimetres; per
// render vertex)
function beardZones(D, v, rmap) {
  const e = joint(D, v, 'joint-l-eye'), out = new Float32Array(rmap.length * 3), nb = D.head.nbody;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const band = (x, lo, hi, soft) => ss(lo - soft, lo + soft, x) * (1 - ss(hi - soft, hi + soft, x));
  const tip = (lo, hi) => { let best = -1; for (let i = 0; i < nb; i++) { const y = v[i * 3 + 1]; if (Math.abs(v[i * 3]) < 0.04 && y > lo && y < hi && (best < 0 || v[i * 3 + 2] > v[best * 3 + 2])) best = i; } return best < 0 ? [0, lo, 0] : [0, v[best * 3 + 1], v[best * 3 + 2]]; };
  const nose = tip(e[1] - 0.9, e[1] - 0.2), chin = tip(nose[1] - 1.3, nose[1] - 0.55), mouth = nose[1] - 0.27;
  const z = new Float32Array(nb * 3);
  for (let i = 0; i < nb; i++) {
    const x = Math.abs(v[i * 3]), y = v[i * 3 + 1], dz = v[i * 3 + 2] - chin[2];
    if (y > e[1] || y < chin[1] - 0.9 || x > 0.9 || dz < -1.3) continue;
    // (never the lips, nor the nose)
    const bare = Math.max((1 - ss(0.2, 0.3, x)) * band(y, mouth - 0.1, mouth + 0.06, 0.025) * ss(-0.5, -0.25, dz), (1 - ss(0.16, 0.24, x)) * ss(nose[1] - 0.16, nose[1] - 0.1, y));
    const front = ss(-0.9, -0.55, dz), keep = 1 - bare;
    z[i * 3] = band(y, mouth + 0.07, nose[1] - 0.08, 0.025) * (1 - ss(0.24, 0.34, x)) * front * keep;
    z[i * 3 + 1] = band(y, chin[1] - 0.28, mouth - 0.11, 0.04) * (1 - ss(0.2, 0.3, x)) * front * keep;
    z[i * 3 + 2] = band(y, chin[1] - 0.6, e[1] - 0.62, 0.07) * (1 - ss(0.68, 0.82, x)) * ss(-1.25, -0.95, dz) * keep;
  }
  for (let r = 0; r < rmap.length; r++) { const i = rmap[r] * 3; out[r * 3] = z[i]; out[r * 3 + 1] = z[i + 1]; out[r * 3 + 2] = z[i + 2]; }
  return out;
}
const BEARD = { bigote: [1, 0, 0], perilla: [0, 1, 0], candado: [1, 1, 0], completa: [1, 1, 1], larga: [1, 1, 1] };

// A built person: root (a Group, feet on y 0, facing +z), height, eyeY (for the camera), ms (how long it took)
export class MhPerson {
  constructor(D, look) {
    this.D = D;
    this.root = new THREE.Group();
    this.mats = {};
    this.build(look);
  }
  // The shape key: what needs the geometry made again (colours only touch the materials)
  static shapeKey(look) {
    return JSON.stringify([look.sex, look.mh?.macro || null, look.mh?.face || null, look.hairStyle, look.brows, look.outfit]);
  }
  build(look) {
    const t0 = performance.now(), D = this.D, sex = look.sex === 'chico' ? 'chico' : 'chica';
    this.clear();
    const prof = this.prof = {}, lap = k => { prof[k] = performance.now(); };
    const v = blend(D, look.mh, sex), nb = D.head.nbody;
    lap('blend');
    // The bound meshes first, on the base still in its A pose
    const parts = [['eyes', 'high-poly'], ['brows', browsOf(look)], ['lashes', lashesOf(look)]];
    const hair = hairOf(look);
    if (hair) parts.push(['hair', hair]);
    for (const c of clothesOf(look)) parts.push(['cloth', c]);
    const fitted = parts.map(([kind, name]) => ({ kind, name, P: D.proxies.get(name), d: proxy(D, name), v: fit(D, v, name) })).filter(x => x.v);
    lap('fit');
    // Then the arms down: the body with its weights; each bound vertex with its three base vertices' weights
    const pose = armPose(D, v), arm = D.body.arm;
    const wU = i => arm[i * 2] / 255, wL = i => arm[i * 2 + 1] / 255;
    for (const f of fitted) {
      const { refs, w } = f.d, bw = (i, fn) => w[i * 3] * fn(refs[i * 3]) + w[i * 3 + 1] * fn(refs[i * 3 + 1]) + w[i * 3 + 2] * fn(refs[i * 3 + 2]);
      poseInPlace(f.v, f.P.nv, i => bw(i, wU), i => bw(i, wL), pose);
    }
    poseInPlace(v, nb, wU, wL, pose);
    lap('pose');
    // Feet on the ground: the lowest of the body and the boots
    let ground = Infinity;
    for (let i = 0; i < nb; i++) ground = Math.min(ground, v[i * 3 + 1]);
    for (const f of fitted) if (f.kind === 'cloth') for (let i = 0; i < f.P.nv; i++) ground = Math.min(ground, f.v[i * 3 + 1]);
    // The skin under the clothes is not drawn (no poking through, fewer triangles)
    const hide = new Uint8Array(D.nv);
    for (const f of fitted) if (f.d.del) for (const i of f.d.del) hide[i] = 1;
    const bi = D.body.idx, rm = D.body.rmap, keep = [];
    for (let t = 0; t < bi.length; t += 3) if (!hide[rm[bi[t]]] && !hide[rm[bi[t + 1]]] && !hide[rm[bi[t + 2]]]) keep.push(bi[t], bi[t + 1], bi[t + 2]);
    const uv = new Float32Array(D.body.uv.length);
    for (let i = 0; i < uv.length; i++) uv[i] = D.body.uv[i] / 65535;
    const bodyGeo = geometry(v, D.nv, new Uint16Array(keep), rm, uv, ground);
    bodyGeo.setAttribute('scalp', new THREE.BufferAttribute(scalp(D, fitted.find(f => f.kind === 'hair'), rm, v), 1));
    bodyGeo.setAttribute('beardZone', new THREE.BufferAttribute(beardZones(D, v, rm), 3));
    lap('body');
    const body = new THREE.Mesh(bodyGeo, this.mat('skin:' + sex, () => skinMaterial(sex)));
    body.name = 'body';
    this.root.add(body);
    for (const f of fitted) {
      const g = geometry(f.v, f.P.nv, f.d.idx, f.d.rmap, f.d.uv, ground);
      let mesh;
      if (f.kind === 'eyes') {
        mesh = new THREE.Mesh(g, this.mat('eyes', eyeMaterial));
        // (the cornea: the same balls a little bigger, clear, only their shine added)
        const c = g.clone(), p = c.attributes.position, eyes = ['l', 'r'].map(s => joint(D, v, `joint-${s}-eye`).map((x, k) => (k === 1 ? (x - ground) * M : x * M)));
        for (let i = 0; i < p.count; i++) {
          const o = p.getX(i) > 0 ? eyes[0] : eyes[1];
          p.setXYZ(i, o[0] + (p.getX(i) - o[0]) * 1.012, o[1] + (p.getY(i) - o[1]) * 1.012, o[2] + (p.getZ(i) - o[2]) * 1.012);
        }
        const cornea = new THREE.Mesh(c, this.mat('cornea', () => { const c = new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.05, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: 0.3 }); c.userData.env = 0.3; return c; }));
        cornea.renderOrder = 2; cornea.name = 'cornea';
        this.root.add(cornea);
      } else if (f.kind === 'brows') mesh = new THREE.Mesh(g, this.mat('brows:' + f.name, () => tinted(`brow-${f.name}.png`, { blendEdges: true })));
      else if (f.kind === 'lashes') mesh = new THREE.Mesh(g, this.mat('lashes:' + f.name, () => tinted(`lash-${f.name}.png`, { blendEdges: true, colour: '#1a1410' })));
      else if (f.kind === 'hair') mesh = new THREE.Mesh(g, this.mat('hair:' + f.name, () => tinted(`hair-${f.name}.jpg`, { alpha: `hair-${f.name}.a.png`, cutout: true, rough: 0.5, test: 0.35 })));
      else if (f.d.part) {
        // (upper and lower part, each its colour: two groups of the same geometry)
        const up = [], lo = [], idx = f.d.idx, part = f.d.part;
        for (let t = 0; t < idx.length; t += 3) (part[idx[t]] ? lo : up).push(idx[t], idx[t + 1], idx[t + 2]);
        g.setIndex(new THREE.BufferAttribute(new Uint16Array([...up, ...lo]), 1));
        g.addGroup(0, up.length, 0); g.addGroup(up.length, lo.length, 1);
        mesh = new THREE.Mesh(g, [this.mat('cloth-up:' + f.name, () => tinted(`cloth-${f.name}.jpg`, { rough: 0.92, keep: 0.7 })), this.mat('cloth-lo:' + f.name, () => tinted(`cloth-${f.name}.jpg`, { rough: 0.92, keep: 0.7 }))]);
      } else mesh = new THREE.Mesh(g, this.mat('cloth:' + f.name, () => tinted(`cloth-${f.name}.jpg`, { colour: '#5a3a24', rough: 0.7, keep: 0.6 })));
      mesh.name = f.kind + ':' + f.name;
      if (f.kind === 'brows' || f.kind === 'lashes') mesh.renderOrder = 1;
      this.root.add(mesh);
    }
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = o.material.depthWrite !== false; o.receiveShadow = true; } });
    let top = 0;
    for (let i = 0; i < nb; i++) top = Math.max(top, v[i * 3 + 1]);
    this.height = (top - ground) * M;
    this.eyeY = (joint(D, v, 'joint-l-eye')[1] - ground) * M;
    this.key = MhPerson.shapeKey(look);
    this.colour(look);
    this.tris = 0;
    this.root.traverse(o => { if (o.isMesh) this.tris += o.geometry.index.count / 3; });
    lap('parts');
    this.ms = performance.now() - t0;
    let at = t0;
    for (const k in prof) { const x = prof[k]; prof[k] = +(x - at).toFixed(1); at = x; }
  }
  // The colours (no new geometry): skin tone and age, eyes, hair and brows, clothes
  colour(look) {
    const S = this.mats[`skin:${look.sex === 'chico' ? 'chico' : 'chica'}`]?.userData.U, hairC = new THREE.Color(look.hair || '#4a2c1c');
    const bw = look.sex === 'chico' ? BEARD[look.beard] : null;
    if (S) { S.beard.value.set(...(bw || [0, 0, 0]), look.beard === 'larga' ? 1 : 0.4); S.hairC.value.copy(hairC); S.tone.value.set(look.skin || '#e8b07a'); S.age.value = Math.min(1, Math.max(0, (yearsOf(look.mh) - 30) / 45)); }
    this.mats.eyes?.userData.U.iris.value.set(look.eyes || '#3a2a1e');
    for (const [k, m] of Object.entries(this.mats)) {
      if (k.startsWith('hair:')) m.userData.U.tint.value.copy(hairC);
      else if (k.startsWith('brows:')) m.userData.U.tint.value.copy(hairC).multiplyScalar(0.75);
      else if (k.startsWith('cloth-up:')) m.userData.U.tint.value.set(look.cloth || '#3a5ab8');
      else if (k.startsWith('cloth-lo:')) m.userData.U.tint.value.set(look.sex === 'chico' || look.outfit !== 'larga' ? look.pants || '#4a3a2a' : look.cloth || '#3a5ab8');
    }
  }
  mat(key, make) { return (this.mats[key] ||= make()); }
  clear() {
    for (const o of [...this.root.children]) { this.root.remove(o); o.geometry.dispose(); }
  }
  dispose() {
    this.clear();
    for (const m of Object.values(this.mats)) m.dispose();
    this.mats = {};
  }
}
