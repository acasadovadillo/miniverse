// The new creator's people in the game (plan CR P5, ?creador=nuevo). A MakeHuman body (person.js, built once per look in
// the game's rest pose: rig.js) worn on the skeleton of today's person: the bones of real/persona.js are moved to
// MakeHuman's joints, so everything that writes on them (actors.js: walking, sitting, riding, swimming, tools, gestures)
// and everything that hangs from them (the tool in the hand, the backpack, the tools on the body, the belly) moves it as it
// is. Three levels of detail:
//   0  near (under 8 m, the 6 nearest at most): the whole body, its parts (skin, eyes, brows, lashes, teeth, hair, clothes)
//      each a skinned mesh on one skeleton, blinking and moving the mouth when talking
//   1  middle (to 30 m): MakeHuman's own low body (about 3,100 triangles), one mesh and one draw, the clothes and the hair
//      as colours taken from the near parts (and the surface pushed out to them); no face bones
//   2  far: today's ring person of the same look, on the same bones, scaled to the MakeHuman one's height
// Whatever new part is bound to the body (P3's clothes, P4's hair) comes along: every mesh of the built person becomes a
// part, with the weights of what it is bound to (or, if not known, of the head).
import * as THREE from 'three';
import { loadMh, proxy, garment } from './data.js';
import { MhPerson, limitTextures } from './person.js';
import { restPose, BONES, hasRig, baseSkin } from './rig.js';
import { MH_ON } from './folk.js';

const M = 0.1;                 // decimetres to metres
const TEX_SIDE = 1024;         // the game's textures (the creator's are 2048)
// (the expressions kept in the game: the eyes closing and the mouth while talking)
const KEEP = ['blink', 'jaw_open', 'smile', 'pucker'];
// (parts the game does not draw: the cornea's shine and the tongue)
const DROP = n => n === 'cornea' || n.startsWith('tongue');
// What a part is, by its name (person.js): the clothes (P3's garments; the provisional MakeHuman ones), the hair and the
// beard (P4's cards, cut and soft passes; MakeHuman's), the brows, the rest
const kindOf = n => (/^(garment|cloth):/.test(n) ? 'cloth' : /^(own)?hair(soft)?:/.test(n) ? 'hair' : /^ownbeard(soft)?:/.test(n) ? 'beard' : n.split(':')[0]);
const softPass = n => /soft:/.test(n);
export const LEVEL_M = [8, 30];    // m: near under the first, middle under the second
export const NEAR_MAX = 6;         // people drawn whole at once
const KEEP_FREE = 16;              // shapes nobody wears kept for a while (a neighbour going into a house and out; the
                                   // village's, made beforehand: prebuildMh)

let D = null, loading = false, failed = false;
// The pack, once it has arrived (the first call starts loading it): null meanwhile and without the switch
export function mhData() {
  if (!MH_ON || failed) return null;
  if (D) return D;
  if (!loading) {
    loading = true;
    loadMh().then(d => { if (hasRig(d)) { D = d; limitTextures(() => TEX_SIDE); } else failed = true; })
      .catch(err => { failed = true; console.warn('Miniverse: MakeHuman pack', err); });
  }
  return null;
}

// ---- The shapes: what a look builds (tens of ms), shared by every person of that look and kept a while after
const SHAPES = new Map();
// (the whole look but the backpack, which hangs from the bones: its clothes and their wear, the hair's and the beard's growth)
const shapeKey = (look, mh) => JSON.stringify([{ ...look, mh: undefined, wear: look.wear && { ...look.wear, espalda: undefined } }, mh]);
export const shapeReady = (look, mh) => SHAPES.has(shapeKey(look, mh));
export const mhStats = () => { let free = 0; for (const s of SHAPES.values()) if (s.refs <= 0) free++; return { shapes: SHAPES.size, free }; };
function trim() {
  const free = [...SHAPES].filter(([, s]) => s.refs <= 0).sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < free.length - KEEP_FREE; i++) { SHAPES.delete(free[i][0]); free[i][1].dispose(); }
}
// The shape of a look made beforehand, kept with nobody wearing it (actors.js prewarm, in idle time): true if it was made
export function prebuildMh(look, mh) {
  if (!D || !mh || SHAPES.has(shapeKey(look, mh))) return false;
  const s = shapeFor(look, mh);
  s.release();
  return true;
}
function shapeFor(look, mh) {
  const k = shapeKey(look, mh);
  let s = SHAPES.get(k);
  if (!s) SHAPES.set(k, (s = new MhShape(look, mh)));
  s.refs++; s.used = performance.now();
  return s;
}

// ---- The middle distance's one material: the skin photo (young, of the sex) for the face's detail, times a colour per
// vertex: the skin's tone, or a garment's or the hair's colour (lc.a: how much photo shows). Shared by everybody
const LOW = new Map();
function lowMaterial(skinMat) {
  const key = skinMat.map?.uuid || 'none';
  let m = LOW.get(key);
  if (m) return m;
  const meanY = skinMat.userData.U?.meanY || { value: new THREE.Vector3(0.5, 0.35, 0.28) };
  m = new THREE.MeshStandardMaterial({ map: skinMat.map, roughness: 0.78, side: THREE.DoubleSide });   // (both sides: the hair's cards)
  m.onBeforeCompile = sh => {
    sh.uniforms.meanY = meanY;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 lc; varying vec4 vLc;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLc = lc;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform vec3 meanY; varying vec4 vLc;').replace('#include <map_fragment>', `
vec3 dt = texture2D(map, vMapUv).rgb / meanY;
float dl = dot(dt, vec3(0.2126, 0.7152, 0.0722));
diffuseColor.rgb = vLc.rgb * mix(vec3(1.0), mix(vec3(dl), dt, 0.35), vLc.a);`);
  };
  m.customProgramCacheKey = () => 'mh-low';
  LOW.set(key, m);
  return m;
}

function smoothNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += x; n[i + 1] += y; n[i + 2] += z; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}
// A grid of points for the nearest one (cells of C metres): add(x, y, z, data), near(x, y, z, reach) → data or null
function grid(C) {
  const cells = new Map(), key = (a, b, c) => (a + 512) * 1048576 + (b + 512) * 1024 + (c + 512);
  return {
    add(x, y, z, d) { const k = key(Math.floor(x / C), Math.floor(y / C), Math.floor(z / C)); let a = cells.get(k); if (!a) cells.set(k, (a = [])); a.push(x, y, z, d); },
    near(x, y, z, reach) {
      let best = reach * reach, out = null;
      const cx = Math.floor(x / C), cy = Math.floor(y / C), cz = Math.floor(z / C), R = Math.ceil(reach / C);
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (let c = -R; c <= R; c++) {
        const l = cells.get(key(cx + a, cy + b, cz + c));
        if (l) for (let j = 0; j < l.length; j += 4) { const dx = l[j] - x, dy = l[j + 1] - y, dz = l[j + 2] - z, dd = dx * dx + dy * dy + dz * dz; if (dd < best) { best = dd; out = l; out.at = j; } }
      }
      return out && { x: out[out.at], y: out[out.at + 1], z: out[out.at + 2], d: out[out.at + 3], dist: Math.sqrt(best) };
    },
  };
}

// (as person.js: wide skirts and a heavy or strong body hold the arms out)
function spreadOf(look, mh, fitted) {
  const mc = mh?.macro || {}, skirt = fitted.some(f => f.name === 'tunica_larga' || f.name === 'abrigo') ? 1 : fitted.some(f => f.name === 'tunica') ? 0.4 : 0;
  return Math.max(0, Math.min(1, skirt + Math.max(0, (mc.weight || 0) + 0.6 * (mc.muscle || 0)) / 140));
}
// What a look builds once: the MakeHuman person in the rest pose, its parts' geometries with their skin weights (bone
// numbers of the ring skeleton, the same order for everybody: real/persona.js defs), the low body, the joints
class MhShape {
  constructor(look, mh) {
    const t0 = performance.now(), sex = (this.sex = look.sex === 'chico' ? 'chico' : 'chica');
    this.refs = 0; this.used = 0;
    // (an old look's beard: true, a full one)
    const mp = (this.mp = new MhPerson(D, { ...look, mh, beard: look.beard === true ? 'completa' : look.beard }, { restPose: (p, d, v, f) => restPose(p, d, v, f, sex, spreadOf(look, mh, f)) }));
    const rig = mp.rig, g0 = mp.ground;
    this.height = mp.height; this.eyeY = mp.eyeY;
    const J = (this.J = {});
    BONES.forEach((b, k) => { J[b] = new THREE.Vector3(rig.joints[k * 3] * M, (rig.joints[k * 3 + 1] - g0) * M, rig.joints[k * 3 + 2] * M); });
    const toSkel = BONES.map(b => ORDER.indexOf(b));
    mp.root.updateMatrixWorld(true);
    const exIdx = KEEP.map(k => mp.expr.indexOf(k)).filter(i => i >= 0);
    this.exNames = KEEP.filter(k => mp.expr.includes(k));
    const meshes = [];
    mp.root.traverse(o => { if (o.isMesh && !DROP(o.name)) meshes.push(o); });
    this.parts = [];
    const done = new Set();   // (the hair's soft pass shares its geometry with the cut one: made once)
    for (const o of meshes) {
      const g = o.geometry;
      if (done.has(g)) { this.parts.push({ g, mat: o.material, name: o.name, order: o.renderOrder, shadow: o.castShadow }); continue; }
      done.add(g);
      if (!o.matrixWorld.equals(IDENTITY)) g.applyMatrix4(o.matrixWorld);   // (the eyes turn round their centres: put back)
      if (g.morphAttributes.position) g.morphAttributes.position = exIdx.map(i => g.morphAttributes.position[i]);
      const n = g.attributes.position.count, si = new Uint8Array(n * 4), sw = new Float32Array(n * 4);
      const pname = o.name === 'body' ? null : o.name === 'eyes' ? 'high-poly' : o.name.slice(o.name.indexOf(':') + 1);
      const pd = pname && rig.parts.get(pname), rm = pname && (proxy(D, pname) || garment(D, pname))?.rmap;
      for (let i = 0; i < n; i++) {
        if (o.name === 'body') baseSkin(D, D.body.rmap[i], si, sw, i);
        else if (pd && rm && rm.length === n) { const j = rm[i]; for (let k = 0; k < 4; k++) { si[i * 4 + k] = pd.idx[j * 4 + k]; sw[i * 4 + k] = pd.w[j * 4 + k]; } }
        else { si[i * 4] = BONES.indexOf('head'); sw[i * 4] = 1; }   // (a part not known: on the head)
      }
      for (let i = 0; i < si.length; i++) si[i] = Math.max(0, toSkel[si[i]]);
      g.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      g.computeBoundingSphere();
      this.parts.push({ g, mat: o.material, name: o.name, order: o.renderOrder, shadow: o.castShadow });
    }
    const body = this.parts.find(p => p.name === 'body');
    this.skinMat = body.mat;
    // (in the game the skin is seen from metres away: no pores' relief and no soft light at its edges, which cost most of
    // its drawing; the eyes and the teeth cast no shadow)
    Object.assign(body.mat, { bumpMap: null, sheen: 0, needsUpdate: true });
    for (const p of this.parts) if (p.name === 'eyes' || p.name.startsWith('teeth')) p.shadow = false;
    const tu = performance.now();
    this.underClothes(body);
    this.underMs = performance.now() - tu;
    // (how far in front of the waist bone the belly is: the pregnancy's belly goes there, realperson.js setBelly)
    const bp = body.g.attributes.position, ys = J.spine.y - 0.05;
    let front = J.spine.z + 0.1;
    for (let i = 0; i < bp.count; i++) if (Math.abs(bp.getY(i) - ys) < 0.03 && Math.abs(bp.getX(i)) < 0.05) front = Math.max(front, bp.getZ(i));
    this.bellyFront = front - J.spine.z;
    this.tris0 = this.parts.reduce((a, p) => a + p.g.index.count / 3, 0);
    this.low = rig.lod ? this.lowGeometry(rig.lod, g0, toSkel, body) : null;
    this.tris1 = this.low ? this.low.index.count / 3 : this.tris0;
    this.ms = performance.now() - t0;
  }
  // The skin right under a garment (within 1.8 cm of one of its vertices) is not drawn either: moving, it would poke
  // through (the garment follows its own three base vertices, the skin its own weights), and it is fewer triangles. And
  // the garments 3 mm out, for the same reason
  underClothes(body) {
    const G = grid(0.02);
    for (const p of this.parts) if (kindOf(p.name) === 'cloth') {
      const a = p.g.attributes.position, nr = p.g.attributes.normal;
      for (let i = 0; i < a.count; i++) {
        G.add(a.getX(i), a.getY(i), a.getZ(i), 1);
        if (!/shoes|botas/.test(p.name)) a.setXYZ(i, a.getX(i) + nr.getX(i) * 0.003, a.getY(i) + nr.getY(i) * 0.003, a.getZ(i) + nr.getZ(i) * 0.003);
      }
      a.needsUpdate = true;
    }
    const a = body.g.attributes.position, near = new Uint8Array(a.count), idx = body.g.index.array, keep = [];
    // (never the hands and forearms: they hang by the hips, close to the trousers or the skirt, and are seen)
    const si = body.g.attributes.skinIndex, sw = body.g.attributes.skinWeight, arms = new Set(['handL', 'handR', 'foreL', 'foreR'].map(b => ORDER.indexOf(b)));
    const arm = i => { let w = 0; for (let k = 0; k < 4; k++) if (arms.has(si.array[i * 4 + k])) w += sw.array[i * 4 + k]; return w > 0.3; };
    for (let i = 0; i < a.count; i++) near[i] = !arm(i) && G.near(a.getX(i), a.getY(i), a.getZ(i), 0.018) ? 1 : 0;
    for (let t = 0; t < idx.length; t += 3) if (!(near[idx[t]] && near[idx[t + 1]] && near[idx[t + 2]])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    if (keep.length < idx.length) body.g.setIndex(new THREE.BufferAttribute(new Uint16Array(keep), 1));
  }
  // The low body: fitted and posed with the rest (rig.js), its own uv on the same skin photo. Each of its vertices looks at
  // the near parts: the front of an eye, dark; a brow, its colour; a body vertex the clothes hide (or a garment close over
  // it), the nearest garment's colour, going out to it; inside a skirt (between the legs), the skirt's, darker; the hair
  // close over it (never on the face's front), the hair's. And the hair and the beard themselves, their cut cards with the
  // hair's colour, in the same mesh: a fringe and long hair keep their shape from afar
  lowGeometry(lod, g0, toSkel, body) {
    const d = lod.d, rm = d.rmap, n = rm.length, nv = lod.v.length / 3;
    const pv = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { pv[i * 3] = lod.v[i * 3] * M; pv[i * 3 + 1] = (lod.v[i * 3 + 1] - g0) * M; pv[i * 3 + 2] = lod.v[i * 3 + 2] * M; }
    const tri = new Uint32Array(d.idx.length);
    for (let t = 0; t < tri.length; t++) tri[t] = rm[d.idx[t]];
    const nn = smoothNormals(pv, tri);
    const bp = body.g.attributes.position, shown = new Uint8Array(bp.count), bi = body.g.index.array;
    for (let t = 0; t < bi.length; t++) shown[bi[t]] = 1;
    const B = grid(0.03), t0 = performance.now();
    for (let i = 0; i < bp.count; i++) B.add(bp.getX(i), bp.getY(i), bp.getZ(i), i);
    // (cells as big as the reach: each look is 27 cells)
    // (each garment its own grid, inside out as person.js dresses them: the outermost over a vertex is its colour)
    const layers = [], face = grid(0.01), hair = grid(0.05), beard = grid(0.015);
    // (the eyes: each one's centre and the front of its iris)
    const eyes = [];
    for (const p of this.parts) if (p.name === 'eyes') {
      const a = p.g.attributes.position, c = new THREE.Vector3(), box = new THREE.Box3(), ix = p.g.index.array;   // (each eye's mesh has both eyes' vertices, and only its own triangles)
      for (let t = 0; t < ix.length; t++) box.expandByPoint(c.set(a.getX(ix[t]), a.getY(ix[t]), a.getZ(ix[t])));
      box.getCenter(c); eyes.push({ c, f: new THREE.Vector3(c.x, c.y, box.max.z) });
    }
    const ez = eyes.length ? eyes[0].c.z : 0;
    const front = (x, y, z) => z > ez - 0.035 && y < this.eyeY + 0.055 && Math.abs(x) < 0.075;   // (the face: never hair)
    const U = m => m.userData.U || {};
    const tint = (m, k) => (U(m).tint?.value || U(m).hairC?.value || m.color || new THREE.Color('#777')).clone().multiplyScalar(k);
    // (a skirt: per 2 cm of height, how far out it goes from the middle; the legs inside it are hidden by it)
    const SK = 0.02, skirt = new Map();
    let hairC = null;
    for (const p of this.parts) {
      const kind = kindOf(p.name), mat = p.mat, pos = p.g.attributes.position, idx = p.g.index.array;
      if (softPass(p.name)) continue;
      if (kind === 'hair' && !hairC) hairC = tint(mat, 0.8);
      if (kind !== 'cloth' && kind !== 'brows' && kind !== 'hair' && kind !== 'beard') continue;
      const into = kind === 'cloth' ? (layers[layers.length] = Object.assign(grid(0.08), { apron: /delantal/.test(p.name) })) : kind === 'hair' ? hair : kind === 'beard' ? beard : face, seen = new Uint8Array(pos.count), att = p.g.attributes.att;
      // (P3's garment: its two colours by the part of each vertex; MakeHuman's provisional one: by its groups)
      const two = att && U(mat).c1 ? [U(mat).c1.value.clone().multiplyScalar(0.75), U(mat).c2.value.clone().multiplyScalar(0.75)] : null;
      const wide = kind === 'cloth' && /:(tunica|tunica_larga|abrigo)$/.test(p.name);
      const put = (i, c) => {
        if (seen[i]) return;
        seen[i] = 1;
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        into.add(x, y, z, two ? two[att.getX(i) > 0.5 ? 1 : 0] : c);
        if (wide) { const k = Math.floor(y / SK), r = Math.hypot(x, z - this.J.body.z), o = skirt.get(k); if (!o) skirt.set(k, { r, c: two ? two[0] : c }); else o.r = Math.max(o.r, r); }
      };
      const colourOf = k => tint(Array.isArray(mat) ? mat[k] : mat, kind === 'brows' ? 0.55 : kind === 'beard' ? 0.7 : 0.85);
      if (p.g.groups.length) for (const gr of p.g.groups) { const c = colourOf(gr.materialIndex); for (let t = gr.start; t < gr.start + gr.count; t++) put(idx[t], c); }
      else { const c = colourOf(0); for (let t = 0; t < idx.length; t++) put(idx[t], c); }
    }
    // (below the hips only, and never the arms: a hand hangs by the skirt, outside it)
    const hipY = this.J.body.y + 0.05, armB = new Set(['handL', 'handR', 'foreL', 'foreR', 'armL', 'armR'].map(b => BONES.indexOf(b)));
    const isArm = i => { let w = 0; for (let k = 0; k < 4; k++) if (armB.has(lod.skin.idx[i * 4 + k])) w += lod.skin.w[i * 4 + k]; return w > 0.3; };
    const handB = new Set(['handL', 'handR'].map(b => BONES.indexOf(b)));
    const isHand = i => { let w = 0; for (let k = 0; k < 4; k++) if (handB.has(lod.skin.idx[i * 4 + k])) w += lod.skin.w[i * 4 + k]; return w > 0.5; };
    const tone = (U(this.skinMat).tone?.value || new THREE.Color('#c99c76')).clone();
    const out = new Float32Array(nv * 4), push = new Float32Array(nv);
    for (let i = 0; i < nv; i++) {
      const x = pv[i * 3], y = pv[i * 3 + 1], z = pv[i * 3 + 2], b = B.near(x, y, z, 0.03);
      let c = tone, a = 1;
      const f = y > this.eyeY + 0.01 ? face.near(x, y, z, 0.009) : null, along = p => (p.x - x) * nn[i * 3] + (p.y - y) * nn[i * 3 + 1] + (p.z - z) * nn[i * 3 + 2], out_ = (p, cap) => Math.max(0, Math.min(cap, along(p)));
      let g = null;
      // (a hand is never a garment's, nor an arm the apron's, which hangs by it; the apron only just over the body)
      const arm = isArm(i), hand = isHand(i);
      if (!f && !hand) for (let L = layers.length - 1; L >= 0 && !g; L--) {
        if (arm && layers[L].apron) continue;
        const q = layers[L].near(x, y, z, layers[L].apron ? 0.04 : b && shown[b.d] ? 0.06 : 0.08);
        if (q && along(q) > -0.025) g = q;
      }   // (the low body may stand a little out of a garment)
      let h = f || front(x, y, z) ? null : hair.near(x, y, z, 0.05);
      if (g && h && along(h) > along(g) + 0.004) g = null;   // (long hair over the clothes: the hair)
      const bd = f || g ? null : beard.near(x, y, z, 0.015);
      const sk = !g && y < hipY && !arm ? skirt.get(Math.floor(y / SK)) : null;
      // (the eye itself, on the photo a white ball: dark, as an eye looks from metres away; a hole there is closed: eyePlugs)
      let eye = false;
      for (const E of eyes) if (E.f.distanceTo(V.set(x, y, z)) < 0.013) eye = true;
      if (eye) { c = IRIS; a = 0; }
      else if (f) { c = f.d; a = 0; }
      else if (g) { c = g.d; a = 0; push[i] = out_(g, 0.04) + 0.004; }
      else if (sk && Math.hypot(x, z - this.J.body.z) < sk.r) { c = sk.c.clone().multiplyScalar(0.55); a = 0; }
      else if (bd) { c = bd.d; a = 0; push[i] = out_(bd, 0.012); }
      else if (h) { c = hairC; a = 0; push[i] = out_(h, 0.05) + 0.003; }
      out[i * 4] = c.r; out[i * 4 + 1] = c.g; out[i * 4 + 2] = c.b; out[i * 4 + 3] = a;
    }
    // The vertices: the body's, the eyes' plugs, the hair's and the beard's cards
    const plugs = this.eyePlugs(tri, pv, eyes, rm, d.uv);
    // (of the hair's cards only those that stand off the head, a fringe, long hair, a tail: more than 2 cm out; the rest is
    // the colour painted on the head, as the beard)
    const cards = this.parts.filter(p => kindOf(p.name) === 'hair' && !softPass(p.name) && p.name.startsWith('own')).map(p => {
      const a = p.g.attributes.position, ix = p.g.index.array, off = new Uint8Array(a.count), keep = [];
      for (let i = 0; i < a.count; i++) off[i] = B.near(a.getX(i), a.getY(i), a.getZ(i), 0.022) ? 0 : 1;
      for (let t = 0; t < ix.length; t += 3) if (off[ix[t]] || off[ix[t + 1]] || off[ix[t + 2]]) keep.push(ix[t], ix[t + 1], ix[t + 2]);
      return { p, keep };
    }).filter(c => c.keep.length);
    const nc = cards.reduce((k, c) => k + c.p.g.attributes.position.count, 0), np = plugs.pts.length, N = n + np + nc;
    const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), lc = new Float32Array(N * 4), uv = new Float32Array(N * 2);
    const si = new Uint8Array(N * 4), sw = new Float32Array(N * 4), head = Math.max(0, toSkel[BONES.indexOf('head')]);
    for (let r = 0; r < n; r++) {
      const i = rm[r];
      for (let k = 0; k < 3; k++) { pos[r * 3 + k] = pv[i * 3 + k] + nn[i * 3 + k] * push[i]; nor[r * 3 + k] = nn[i * 3 + k]; }
      for (let k = 0; k < 4; k++) { lc[r * 4 + k] = out[i * 4 + k]; si[r * 4 + k] = Math.max(0, toSkel[lod.skin.idx[i * 4 + k]]); sw[r * 4 + k] = lod.skin.w[i * 4 + k]; }
    }
    uv.set(d.uv);
    const index = Array.from(d.idx);
    plugs.pts.forEach((p, j) => { const r = n + j; pos.set([p.x, p.y, p.z], r * 3); nor.set([0, 0, 1], r * 3); uv.set(plugs.uvs.slice(j * 2, j * 2 + 2), r * 2); lc.set([IRIS.r, IRIS.g, IRIS.b, 0], r * 4); si[r * 4] = head; sw[r * 4] = 1; });
    for (const t of plugs.tris) index.push(t < 0 ? n + (-t - 1) : t);
    let at = n + np;
    for (const { p, keep: ix } of cards) {
      const a = p.g.attributes.position, nr = p.g.attributes.normal, c = tint(p.mat, 0.8);
      for (let i = 0; i < a.count; i++) {
        const r = at + i;
        pos[r * 3] = a.getX(i); pos[r * 3 + 1] = a.getY(i); pos[r * 3 + 2] = a.getZ(i);
        nor[r * 3] = nr.getX(i); nor[r * 3 + 1] = nr.getY(i); nor[r * 3 + 2] = nr.getZ(i);
        lc[r * 4] = c.r; lc[r * 4 + 1] = c.g; lc[r * 4 + 2] = c.b; lc[r * 4 + 3] = 0;
        si[r * 4] = head; sw[r * 4] = 1;
      }
      for (let t = 0; t < ix.length; t++) index.push(at + ix[t]);
      at += a.count;
    }
    this.lowMs = performance.now() - t0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('lc', new THREE.BufferAttribute(lc, 4));
    g.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setIndex(new THREE.BufferAttribute(N > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1));
    g.computeBoundingSphere();
    return g;
  }
  // The holes' edges (edges of one triangle only, over the shared vertices) within 3.5 cm of an eye: a triangle from each
  // to a new point at the eye's front (its render vertex: any of that shared vertex's; new points as -1, -2…)
  eyePlugs(tri, pv, eyes, rm, uv) {
    const count = new Map(), key = (a, b) => (a < b ? a * 65536 + b : b * 65536 + a), out = { pts: [], tris: [], uvs: [] };
    for (let t = 0; t < tri.length; t += 3) for (let e = 0; e < 3; e++) { const k = key(tri[t + e], tri[t + (e + 1) % 3]); count.set(k, (count.get(k) || 0) + 1); }
    const rOf = new Map();
    for (let r = rm.length - 1; r >= 0; r--) rOf.set(rm[r], r);
    eyes.forEach(E => {
      const id = -(out.pts.length + 1), at = E.f.clone(); at.z -= 0.004;
      let used = false, u = 0, w = 0, n = 0;
      for (let t = 0; t < tri.length; t += 3) for (let e = 0; e < 3; e++) {
        const a = tri[t + e], b = tri[t + (e + 1) % 3];
        if (count.get(key(a, b)) !== 1) continue;
        const near = i => E.c.distanceTo(V.set(pv[i * 3], pv[i * 3 + 1], pv[i * 3 + 2])) < 0.035;
        if (!near(a) || !near(b)) continue;
        out.tris.push(rOf.get(a), rOf.get(b), id); used = true;
        u += uv[rOf.get(a) * 2]; w += uv[rOf.get(a) * 2 + 1]; n++;   // (its uv, the rim's mean: the photo's eye there)
      }
      if (used) { out.pts.push(at); out.uvs.push(u / n, w / n); }
    });
    return out;
  }
  release() { this.refs--; this.used = performance.now(); trim(); }
  dispose() {
    for (const p of this.parts) p.g.dispose();
    this.low?.dispose();
    this.mp.dispose();   // (its own materials; the textures and the low material are everybody's)
  }
}

// A skeleton object that only works out its matrices when something moved (three does it every frame for every person
// seen): as realperson.js does for the ring one. Its own flag (dirty), set by afterPose
function lazy(sk) {
  const up = sk.update.bind(sk), hip = sk.bones[0], last = new Float64Array(16);
  sk.userData = { dirty: true };
  sk.update = () => {
    const e = hip.matrixWorld.elements;
    let go = sk.userData.dirty;
    if (!go) for (let i = 0; i < 16; i++) if (e[i] !== last[i]) { go = true; break; }
    if (go) { up(); last.set(e); sk.userData.dirty = false; }
  };
  return sk;
}

// A MakeHuman body for one person of the game, worn on that person's ring skeleton (r: real/persona.js build)
export class MhBody {
  constructor(look, mh, r) {
    const t0 = performance.now(), S = (this.shape = shapeFor(look, mh)), J = S.J;
    this.r = r; this.height = S.height; this.eyeY = S.eyeY; this.bellyFront = S.bellyFront; this.exNames = S.exNames;
    // The persona's bones moved to the MakeHuman joints (each relative to its parent; the skirt at the hips)
    const bones = r.mesh.skeleton.bones, byName = r.bones;
    for (const b of BONES) {
      const bone = byName[b], pa = bone.parent?.isBone ? bone.parent.name : null;
      bone.position.copy(J[b]);
      if (pa && J[pa]) bone.position.sub(J[pa]);
    }
    if (byName.skirt) byName.skirt.position.set(0, 0, 0);
    this.hipY = J.body.y; this.hipZ = J.body.z;
    this.kHip = J.body.y / (r.d?.cadera || J.body.y);
    // Its own skeleton object on the same bones, with the inverses of MakeHuman's rest; and the ring mesh's, scaled to this
    // height (at rest it is today's person, as tall as this one; moving, it turns about these joints)
    const rest = bones.map(b => new THREE.Matrix4().makeTranslation(...restOf(b).negate().toArray()));
    this.skel = lazy(new THREE.Skeleton(bones, rest));
    const k = this.height / (r.d?.alto || this.height), sc = new THREE.Matrix4().makeScale(k, k, k);
    this.ringSkel = lazy(new THREE.Skeleton(bones, rest.map(m => m.clone().multiply(sc))));
    r.mesh.bind(this.ringSkel, r.mesh.bindMatrix);
    // (the bones out of the ring mesh, into its root, in the same place: hiding that mesh must not hide what hangs from
    // them, the tool in the hand, the backpack, the tools on the body, the belly)
    r.root.add(byName.body);
    this.near = new THREE.Group(); this.near.name = 'mh-near';
    this.parts = S.parts.map(p => {
      const s = new THREE.SkinnedMesh(p.g, p.mat);
      s.name = p.name; s.renderOrder = p.order; s.castShadow = p.shadow; s.receiveShadow = true;
      s.boundingSphere = p.g.boundingSphere.clone(); s.boundingSphere.radius += 0.25;
      s.bind(this.skel, IDENTITY);
      this.near.add(s);
      return s;
    });
    this.body = this.parts.find(p => p.name === 'body');
    this.low = null;
    if (S.low) {
      const s = (this.low = new THREE.SkinnedMesh(S.low, lowMaterial(S.skinMat)));
      s.name = 'mh-low'; s.castShadow = s.receiveShadow = true;
      s.boundingSphere = S.low.boundingSphere.clone(); s.boundingSphere.radius += 0.25;
      s.bind(this.skel, IDENTITY);
    }
    this.tris0 = S.tris0; this.tris1 = S.tris1;
    this.level = -1;
    this.t = Math.random() * 10; this.blinkAt = 1 + Math.random() * 3; this.mouth = 0;
    this.ms = performance.now() - t0;
    this.built = S.ms;
  }
  // Into the person's root (with the ring mesh: lying down moves that root), drawn at the level asked
  attach(parent) {
    parent.add(this.near);
    if (this.low) parent.add(this.low);
    this.setLevel(0);
  }
  setLevel(n) {
    if (n === this.level) return;
    this.level = n;
    this.near.visible = n === 0 || (n === 1 && !this.low);
    if (this.low) this.low.visible = n === 1;
    this.r.mesh.visible = n === 2;
    this.r.setLod(n === 2 ? 1 : 0);
    this.skel.userData.dirty = this.ringSkel.userData.dirty = true;
  }
  get tris() { return this.level === 2 ? this.r.trisL : this.level === 1 ? this.tris1 : this.tris0; }
  // After the persona's pose (real/persona.js writes the hips' height for its own legs): for these legs
  afterPose() {
    const b = this.r.bones.body;
    b.position.x *= this.kHip; b.position.y *= this.kHip; b.position.z += this.hipZ;
    this.skel.userData.dirty = this.ringSkel.userData.dirty = true;
  }
  // Blinking every few seconds and, while talking, the jaw and the lips (near only)
  face(dt, talking) {
    this.t += dt;
    if (this.level !== 0) return;
    let blink = 0;
    if ((this.blinkAt -= dt) < 0) { const k = -this.blinkAt / 0.16; blink = k < 1 ? Math.sin(k * Math.PI) : 0; if (k >= 1) this.blinkAt = 2 + Math.random() * 4; }
    this.mouth += ((talking ? 1 : 0) - this.mouth) * Math.min(1, dt * 8);
    const tt = this.t, talk = this.mouth * (0.18 + 0.22 * Math.abs(Math.sin(tt * 9.3) * Math.sin(tt * 3.1 + 1)));
    const w = { blink, jaw_open: talk, pucker: this.mouth * 0.25 * Math.max(0, Math.sin(tt * 2.3)), smile: 0 };
    for (const p of this.parts) {
      const inf = p.morphTargetInfluences;
      if (!inf) continue;
      for (let k = 0; k < this.exNames.length; k++) inf[k] = w[this.exNames[k]] || 0;
    }
  }
  dispose() {
    this.near.parent?.remove(this.near); this.low?.parent?.remove(this.low);
    this.shape.release();
  }
}
// (the ring skeleton's order: body, spine, torso, neck, head, then clav, arm, fore, hand, leg, shin, foot, toe of the left
// and of the right; skirt and braid after: real/persona.js defs)
const ORDER = ['body', 'spine', 'torso', 'neck', 'head', ...['L', 'R'].flatMap(S => ['clav', 'arm', 'fore', 'hand', 'leg', 'shin', 'foot', 'toe'].map(b => b + S))];
const IDENTITY = new THREE.Matrix4(), V = new THREE.Vector3(), IRIS = new THREE.Color('#2e241c');
// Where a bone is at rest, from the ground (its own and its parents' places: no turns at rest)
function restOf(b) { const p = new THREE.Vector3(); for (let o = b; o?.isBone; o = o.parent) p.add(o.position); return p; }

// ---- Who is made next: the nearest of those waiting (actors.js asks each frame), one at a time; a look made already
// costs nothing and goes at once. With the screen dark (entering, a jump), several, up to BUSY_MS
let lastBuild = -1e9;
const GAP_MS = 120, BUSY_MS = 150;
export function buildNext(waiting, dark = false) {
  if (!D || !waiting.length) return;
  waiting.sort((a, b) => a[1] - b[1]);
  const t0 = performance.now();
  for (const [P] of waiting) {
    const cheap = shapeReady(P.look, P.mhWant);
    if (!cheap && !dark && t0 - lastBuild < GAP_MS) continue;
    if (!cheap && dark && performance.now() - t0 > BUSY_MS) break;
    P.wearMh();
    if (!cheap) { lastBuild = performance.now(); if (!dark) break; }
  }
}
