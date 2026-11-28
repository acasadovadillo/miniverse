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
import { HAIR_STYLE } from './hair.js';
import { injectGrime, grimeMaterial, writeGrime, clearGrime } from '../grime.js';

// The surface overlay (grime.js) into a material of the person: put in before its own patch, which keeps the hook lines
// (map and roughness); a program of its own (the creator's has none). Nothing is drawn while its uniforms are 0
function withGrime(m, skin) {
  if (m.userData.grime) return m;
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
  m.onBeforeCompile = function (sh, r) { injectGrime(sh, this, { skin }); prev?.call(this, sh, r); };
  m.customProgramCacheKey = function () { return (key ? key.call(this) : '') + '-grime'; };
  m.userData.grime = true;
  return m;
}

const M = 0.1;                 // decimetres to metres
const TEX_SIDE = 1024;         // the game's textures (the creator's are 2048)
// (the expressions kept in the game: the eyes closing and the mouth while talking)
const KEEP = ['blink', 'jaw_open', 'smile', 'pucker'];
// (parts the game does not draw: the cornea's shine, the tongue and the beard's soft second pass, a draw of its own that
// does not show from metres away; the hair's stays: without it the hair looks thin, even from a few metres)
const DROP = n => n === 'cornea' || n.startsWith('tongue') || n.startsWith('ownbeardsoft');
// What a part is, by its name (person.js): the clothes (P3's garments; the provisional MakeHuman ones), the hair and the
// beard (P4's cards, cut and soft passes; MakeHuman's), the brows, the rest
// (P4's fur shells, ownshell:hair and ownshell:beard, near only: on the head bone like the cards, and their colour and
// volume painted on the middle level, never their copies)
const kindOf = n => (/^(garment|cloth):/.test(n) ? 'cloth' : /^((own)?hair(soft)?|ownshell):hair/.test(n) || /^(own)?hair(soft)?:/.test(n) ? 'hair' : /^own(beard(soft)?|shell):beard/.test(n) || /^ownbeard(soft)?:/.test(n) ? 'beard' : n.split(':')[0]);
const isShell = n => n.startsWith('ownshell:');
const softPass = n => /soft:/.test(n);
const CURLY = new Set(['rizado', 'afro']);   // (hair.js styles drawn as one mass at the middle level)
export const LEVEL_M = [8, 30];    // m: near under the first, middle under the second
export const NEAR_MAX = 6;         // people drawn whole at once
const KEEP_FREE = 16;              // shapes nobody wears kept for a while (a neighbour going into a house and out; the
                                   // village's, made beforehand: prebuildMh)

let D = null, loading = false, failed = false;
export const mhFailed = () => failed;
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
export const shapeReady = (look, mh) => !!SHAPES.get(shapeKey(look, mh))?.ready;
export const mhStats = () => { let free = 0; for (const s of SHAPES.values()) if (s.refs <= 0) free++; return { shapes: SHAPES.size, free }; };
function trim() {
  const free = [...SHAPES].filter(([, s]) => s.refs <= 0 && s.ready).sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < free.length - KEEP_FREE; i++) { SHAPES.delete(free[i][0]); free[i][1].dispose(); }
}
// ---- Making them without a stumble: a shape is made in steps (a generator), a few ms a frame (BUDGET_MS, more with the
// screen dark), the most wanted first (prio: metres to the camera; the ones made beforehand, far behind)
const BUDGET_MS = 4, DARK_MS = 40;
let deadline = Infinity;
const late = () => performance.now() > deadline;
function shapeOf(look, mh) {
  const k = shapeKey(look, mh);
  let s = SHAPES.get(k);
  if (!s) { SHAPES.set(k, (s = new MhShape(look, mh))); trim(); }
  return s;
}
// Asks for the shape of a look (prio: lower goes first): false while it is being made
export function requestShape(look, mh, prio = 0) {
  if (!D || !mh) return false;
  const s = shapeOf(look, mh);
  if (!s.ready) s.prio = Math.min(s.prio, prio);
  return s.ready;
}
// The shape of a look made beforehand, kept with nobody wearing it (actors.js prewarm): queued, far behind the seen
export const prebuildMh = (look, mh) => requestShape(look, mh, 1e6) === false && !!D && !!mh;
// A few ms of making (actors.js, each frame): the pending shapes, most wanted first, until the time is up
export function runJobs(dark = false) {
  if (!D) return;
  const t0 = performance.now(), end = t0 + (dark ? DARK_MS : BUDGET_MS);
  while (performance.now() < end) {
    let best = null;
    for (const s of SHAPES.values()) if (!s.ready && (!best || s.prio < best.prio)) best = s;
    if (!best) return;
    deadline = end;
    try { while (!best.step() && performance.now() < end); }
    finally { deadline = Infinity; }
  }
}
// The geometry sent to the graphics card while it is made, a piece a step (one tiny draw into a pixel off screen), so the
// frame it first shows does not send it all at once. actors.js gives the renderer
let UP = null;
export function setUploader(renderer) {
  if (UP || !renderer) return;
  const target = new THREE.WebGLRenderTarget(1, 1), scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(), mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.frustumCulled = false; scene.add(mesh);
  UP = g => {
    const was = renderer.getRenderTarget();
    // (without its morphs: they would make other programs to compile; their texture goes up when first drawn, small)
    const mo = g.morphAttributes;
    g.morphAttributes = {}; mesh.geometry = g;
    renderer.setRenderTarget(target); renderer.render(scene, cam); renderer.setRenderTarget(was);
    g.morphAttributes = mo; mesh.geometry = EMPTY_G;
  };
}
const EMPTY_G = new THREE.BufferGeometry();
// The shape, made now if it is not (the player at the start, behind the dark screen), with one more wearing it
function shapeFor(look, mh) {
  const s = shapeOf(look, mh);
  if (!s.ready) { deadline = Infinity; while (!s.step()); }
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
diffuseColor.rgb = vLc.rgb * mix(vec3(1.0), mix(vec3(dl), dt, 0.35), max(vLc.a, 0.0));
if (vLc.a < -0.5 && !gl_FrontFacing) diffuseColor.rgb *= 0.35;   // (lc.a -1: a sheet whose inside is in shade, the robe and the hull)`);
  };
  m.customProgramCacheKey = () => 'mh-low';
  withGrime(m, 'max(vLc.a, 0.0)');
  LOW.set(key, m);
  return m;
}

function smoothNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    n[a] += x; n[a + 1] += y; n[a + 2] += z; n[b] += x; n[b + 1] += y; n[b + 2] += z; n[c] += x; n[c + 1] += y; n[c + 2] += z;
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
  const mc = mh?.macro || {}, skirt = fitted.some(f => f.name === 'tunica_larga' || f.name === 'abrigo') ? 1.5 : fitted.some(f => f.name === 'falda') ? 0.9 : fitted.some(f => f.name === 'tunica') ? 0.5 : 0;
  return Math.max(0, Math.min(1.6, skirt + Math.max(0, (mc.weight || 0) + 0.6 * (mc.muscle || 0)) / 140));
}
// What a look builds once: the MakeHuman person in the rest pose, its parts' geometries with their skin weights (bone
// numbers of the ring skeleton, the same order for everybody: real/persona.js defs), the low body, the joints
class MhShape {
  constructor(look, mh) {
    this.refs = 0; this.used = performance.now(); this.ready = false; this.prio = Infinity; this.ms = 0;
    this.it = this.build(look, mh);
  }
  // One step of the making (true when it is done); the time it takes adds up in ms
  step() {
    const t = performance.now(), r = this.it.next(), d = performance.now() - t;
    this.ms += d;
    if (d > (this.maxStep || 0)) { this.maxStep = d; this.maxAt = `${Object.keys(this.mp?.prof || {}).pop() || '-'}/${this.stage || ''}`; }
    if (r.done) { this.ready = true; this.it = null; }
    return r.done;
  }
  *build(look, mh) {
    const sex = (this.sex = look.sex === 'chico' ? 'chico' : 'chica');
    this.curly = CURLY.has(HAIR_STYLE[look.hairStyle]);
    // (an old look's beard: true, a full one; only the expressions the game moves)
    const L = { ...look, mh, beard: look.beard === true ? 'completa' : look.beard };
    const mp = (this.mp = new MhPerson(D, L, { defer: true, expr: KEEP, restPose: (p, d, v, f, lt) => restPose(p, d, v, f, sex, spreadOf(look, mh, f), lt) }));
    this.stage = 'mp';
    yield* mp.steps(L, late);
    this.stage = 'parts';
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
        if ((i & 2047) === 0 && late()) yield;
        if (o.name === 'body') baseSkin(D, D.body.rmap[i], si, sw, i);
        else if (pd && rm && rm.length === n) { const j = rm[i]; for (let k = 0; k < 4; k++) { si[i * 4 + k] = pd.idx[j * 4 + k]; sw[i * 4 + k] = pd.w[j * 4 + k]; } }
        else { si[i * 4] = BONES.indexOf('head'); sw[i * 4] = 1; }   // (a part not known: on the head)
      }
      for (let i = 0; i < si.length; i++) si[i] = Math.max(0, toSkel[si[i]]);
      g.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      g.computeBoundingSphere();
      this.parts.push({ g, mat: o.material, name: o.name, order: o.renderOrder, shadow: o.castShadow });
      if (late()) yield;
    }
    // (the two eyes, one draw when they are of one colour: each eye's mesh has both eyes' vertices, so only the triangles join)
    const eyes = this.parts.filter(p => p.name === 'eyes');
    if (eyes.length === 2 && !mh?.eye2) {
      const a = eyes[0].g.index.array, b = eyes[1].g.index.array, ab = new Uint16Array(a.length + b.length);
      ab.set(a); ab.set(b, a.length); eyes[0].g.setIndex(new THREE.BufferAttribute(ab, 1));
      eyes[1].g.dispose(); this.parts.splice(this.parts.indexOf(eyes[1]), 1);
    }
    const body = this.parts.find(p => p.name === 'body');
    this.skinMat = body.mat;
    // (in the game the skin is seen from metres away: no pores' relief and no soft light at its edges, which cost most of
    // its drawing; the eyes and the teeth cast no shadow)
    Object.assign(body.mat, { bumpMap: null, sheen: 0, needsUpdate: true });
    // (the surface overlay on the skin and the clothes)
    this.grimeMats = [withGrime(body.mat, '1.0')];
    for (const p of this.parts) if (kindOf(p.name) === 'cloth' || kindOf(p.name) === 'hat') for (const m of [].concat(p.mat)) this.grimeMats.push(withGrime(m, '0.0'));
    // (only the body, the clothes, the hair and a hat cast a shadow: what else would cast one is too small to see in it)
    for (const p of this.parts) if (!/^(body|garment|cloth|ownhair|hair|hat):?/.test(p.name)) p.shadow = false;
    this.stage = 'under';
    yield* this.underClothes(body);
    this.stage = 'low';
    // (how far in front of the waist bone the belly is: the pregnancy's belly goes there, realperson.js setBelly)
    const bp = body.g.attributes.position, ys = J.spine.y - 0.05;
    let front = J.spine.z + 0.1;
    for (let i = 0; i < bp.count; i++) if (Math.abs(bp.getY(i) - ys) < 0.03 && Math.abs(bp.getX(i)) < 0.05) front = Math.max(front, bp.getZ(i));
    this.bellyFront = front - J.spine.z;
    this.tris0 = this.parts.reduce((a, p) => a + p.g.index.count / 3, 0);
    this.low = rig.lod ? yield* this.lowGeometry(rig.lod, g0, toSkel, body) : null;
    this.tris1 = this.low ? this.low.index.count / 3 : this.tris0;
    this.stage = 'upload';
    if (UP) for (const g of new Set([this.low, ...this.parts.map(p => p.g)])) if (g) { if (late()) yield; UP(g); }
  }
  // The skin right under a garment (within 1.8 cm of one of its vertices) is not drawn either: moving, it would poke
  // through (the garment follows its own three base vertices, the skin its own weights), and it is fewer triangles. And
  // the garments 3 mm out, for the same reason
  *underClothes(body) {
    const G = grid(0.02);
    // (not the headscarf: round the face it lies close to the skin that shows, which must stay)
    for (const p of this.parts) if (kindOf(p.name) === 'cloth' && !/:hijab$/.test(p.name)) {
      const a = p.g.attributes.position, nr = p.g.attributes.normal, att = p.g.attributes.att;
      for (let i = 0; i < a.count; i++) {
        // (not by its hem: where a piece ends on bare skin (underwear, socks, a waistband) the skin there shows, or its
        // inside and a hole would)
        if (!att || att.getZ(i) * 255 > 20) G.add(a.getX(i), a.getY(i), a.getZ(i), 1);
        if (!/shoes|botas/.test(p.name)) a.setXYZ(i, a.getX(i) + nr.getX(i) * 0.003, a.getY(i) + nr.getY(i) * 0.003, a.getZ(i) + nr.getZ(i) * 0.003);
      }
      a.needsUpdate = true;
    }
    const a = body.g.attributes.position, near = new Uint8Array(a.count), idx = body.g.index.array, keep = [];
    // (never the hands and forearms: they hang by the hips, close to the trousers or the skirt, and are seen)
    const si = body.g.attributes.skinIndex, sw = body.g.attributes.skinWeight, arms = new Set(['handL', 'handR', 'foreL', 'foreR'].map(b => ORDER.indexOf(b)));
    const arm = i => { let w = 0; for (let k = 0; k < 4; k++) if (arms.has(si.array[i * 4 + k])) w += sw.array[i * 4 + k]; return w > 0.3; };
    if (late()) yield;
    for (let i = 0; i < a.count; i++) { near[i] = !arm(i) && G.near(a.getX(i), a.getY(i), a.getZ(i), 0.018) ? 1 : 0; if ((i & 511) === 0 && late()) yield; }
    for (let t = 0; t < idx.length; t += 3) if (!(near[idx[t]] && near[idx[t + 1]] && near[idx[t + 2]])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    if (keep.length < idx.length) body.g.setIndex(new THREE.BufferAttribute(new Uint16Array(keep), 1));
  }
  // The low body: fitted and posed with the rest (rig.js), its own uv on the same skin photo. Each of its vertices looks at
  // the near parts: the front of an eye, dark; a brow, its colour; a body vertex the clothes hide (or a garment close over
  // it), the nearest garment's colour, going out to it; inside a skirt (between the legs), the skirt's, darker; the hair
  // close over it (never on the face's front), the hair's. And the hair and the beard themselves, their cut cards with the
  // hair's colour, in the same mesh: a fringe and long hair keep their shape from afar
  *lowGeometry(lod, g0, toSkel, body) {
    const d = lod.d, rm = d.rmap, n = rm.length, nv = lod.v.length / 3;
    const pv = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { pv[i * 3] = lod.v[i * 3] * M; pv[i * 3 + 1] = (lod.v[i * 3 + 1] - g0) * M; pv[i * 3 + 2] = lod.v[i * 3 + 2] * M; }
    const tri = new Uint32Array(d.idx.length);
    for (let t = 0; t < tri.length; t++) tri[t] = rm[d.idx[t]];
    const nn = smoothNormals(pv, tri);
    const bp = body.g.attributes.position, shown = new Uint8Array(bp.count), bi = body.g.index.array;
    for (let t = 0; t < bi.length; t++) shown[bi[t]] = 1;
    const B = grid(0.03), t0 = performance.now();
    for (let i = 0; i < bp.count; i++) { B.add(bp.getX(i), bp.getY(i), bp.getZ(i), i); if ((i & 4095) === 0 && late()) yield; }
    if (late()) yield;
    // (cells as big as the reach: each look is 27 cells)
    // (each garment its own grid, inside out as person.js dresses them: the outermost over a vertex is its colour)
    const layers = [], face = grid(0.01), hair = grid(0.05), beard = grid(0.015);
    // (the eyes: each one's centre and the front of its iris)
    const eyes = [];
    for (const p of this.parts) if (p.name === 'eyes') for (const side of [1, -1]) {
      const a = p.g.attributes.position, c = new THREE.Vector3(), box = new THREE.Box3(), ix = p.g.index.array;   // (each eye: the triangles on its side)
      for (let t = 0; t < ix.length; t++) if (Math.sign(a.getX(ix[t])) === side) box.expandByPoint(c.set(a.getX(ix[t]), a.getY(ix[t]), a.getZ(ix[t])));
      if (box.isEmpty() || eyes.some(E => Math.sign(E.c.x) === side)) continue;
      box.getCenter(c); eyes.push({ c, f: new THREE.Vector3(c.x, c.y, box.max.z) });
    }
    const ez = eyes.length ? eyes[0].c.z : 0;
    const front = (x, y, z) => z > ez - 0.06 && y < this.eyeY + 0.055 && Math.abs(x) < 0.075;   // (the face, chin too: never hair)
    const U = m => m.userData.U || {};
    // (the hair's and the beard's: their colour greyed as much as the near ones are)
    const tint = (m, k) => {
      const u = U(m), c = (u.tint?.value || u.hairC?.value || m.color || new THREE.Color('#777')).clone();
      if (u.greyK && u.greyC) c.lerp(u.greyC.value, Math.min(1, u.greyK.value) * 0.85);
      return c.multiplyScalar(k);
    };
    // (a skirt: per 2 cm of height, how far out it goes from the middle; the legs inside it are hidden by it)
    const SK = 0.02, skirt = new Map();
    let hairC = null;
    for (const p of this.parts) {
      const kind = kindOf(p.name), mat = p.mat, pos = p.g.attributes.position, idx = p.g.index.array;
      if (softPass(p.name)) continue;
      if (kind === 'hair' && !hairC) hairC = tint(mat, 0.8);
      if (kind !== 'cloth' && kind !== 'brows' && kind !== 'hair' && kind !== 'beard') continue;
      const into = kind === 'cloth' ? (layers[layers.length] = Object.assign(grid(0.12), { apron: /delantal/.test(p.name), upper: /:(camisa|camisa_corta|camiseta|chaleco|zamarra)$/.test(p.name), scarf: /:hijab$/.test(p.name), tear: Array.isArray(mat) ? 0 : U(mat).tear?.value || 0 })) : kind === 'hair' ? hair : kind === 'beard' ? beard : face, seen = new Uint8Array(pos.count), att = p.g.attributes.att;
      // (P3's garment: its two colours by the part of each vertex; MakeHuman's provisional one: by its groups)
      const two = att && U(mat).c1 ? [U(mat).c1.value.clone().multiplyScalar(0.75), U(mat).c2.value.clone().multiplyScalar(0.75)] : null;
      const wide = kind === 'cloth' && /:(tunica|tunica_larga|abrigo|falda)$/.test(p.name);
      const put = (i, c) => {
        if (seen[i]) return;
        seen[i] = 1;
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        into.add(x, y, z, two ? two[att.getX(i) > 0.5 ? 1 : 0] : c);
        if (wide) { const k = Math.floor(y / SK), r = Math.hypot(x, z - this.J.body.z), o = skirt.get(k); if (!o) skirt.set(k, { r, c: two ? two[0] : c }); else o.r = Math.max(o.r, r); }
      };
      const colourOf = k => tint(Array.isArray(mat) ? mat[k] : mat, kind === 'brows' ? 0.55 : kind === 'beard' ? 0.7 : 0.85);
      if (p.g.groups.length) for (const gr of p.g.groups) { const c = colourOf(gr.materialIndex); for (let t = gr.start; t < gr.start + gr.count; t++) put(idx[t], c); }
      else { const c = colourOf(0); for (let t = 0; t < idx.length; t++) { put(idx[t], c); if ((t & 8191) === 0 && late()) yield; } }
      if (kind === 'cloth') { const L = layers[layers.length - 1]; L.minY = Infinity; for (let i = 0; i < pos.count; i++) if (seen[i]) L.minY = Math.min(L.minY, pos.getY(i)); }
      if (late()) yield;
    }
    // (a skirt, a tunic, a coat: a robe round the legs, the legs in it left out; curly hair: one mass)
    this.stage = 'robe';
    const wideP = this.parts.filter(p => kindOf(p.name) === 'cloth' && WIDE.test(p.name)), apronP = this.parts.filter(p => /:delantal$/.test(p.name));
    const robe = wideP.length ? yield* this.robe(wideP) : null;
    // (an apron over trousers: the same, open, only where it hangs, from a little over the hips: between the legs, from the
    // front, the apron, never the shirt's colour nor the ground)
    const panel = !robe && apronP.length ? yield* this.robe(apronP, this.J.body.y + 0.03, true) : null;
    // (curly hair and the afro: a hull round the head, instead of their cards)
    const hull = this.curly ? yield* this.hairHull(new THREE.Vector3(0, this.eyeY + 0.02, ez - 0.085), Math.max(0, toSkel[BONES.indexOf('head')])) : null;
    const sheets = [robe, panel, hull].filter(Boolean);
    const cov = robe ? new Uint8Array(nv) : null;
    // (below the hips only, and never the arms: a hand hangs by the skirt, outside it)
    const hipY = this.J.body.y + 0.05, armB = new Set(['handL', 'handR', 'foreL', 'foreR', 'armL', 'armR'].map(b => BONES.indexOf(b)));
    const isArm = i => { let w = 0; for (let k = 0; k < 4; k++) if (armB.has(lod.skin.idx[i * 4 + k])) w += lod.skin.w[i * 4 + k]; return w > 0.3; };
    const handB = new Set(['handL', 'handR'].map(b => BONES.indexOf(b))), legB = new Set(['legL', 'legR'].map(b => BONES.indexOf(b)));
    const isLeg = i => { let w = 0; for (let k = 0; k < 4; k++) if (legB.has(lod.skin.idx[i * 4 + k])) w += lod.skin.w[i * 4 + k]; return w > 0.45; };
    const isHand = i => { let w = 0; for (let k = 0; k < 4; k++) if (handB.has(lod.skin.idx[i * 4 + k])) w += lod.skin.w[i * 4 + k]; return w > 0.5; };
    // (the skin's tone a little darker and warmer than the near skin's uniform: that one is lit through, and from afar the
    // plain tone of a very light skin read as a white mask)
    const t0n = U(this.skinMat).tone?.value || new THREE.Color('#c99c76'), lum = 0.2126 * t0n.r + 0.7152 * t0n.g + 0.0722 * t0n.b;
    const tone = t0n.clone().multiply(LOW_TONE).multiplyScalar(1 - 0.42 * Math.min(1, lum));   // (the lighter, the more)
    const out = new Float32Array(nv * 4), push = new Float32Array(nv), neckTop = this.J.neck.y + 0.25 * (this.J.head.y - this.J.neck.y);
    // (the eye and the brows, softened into the skin: on this low head each vertex paints a wide triangle, and their full dark
    // made two holes for eyes and a band for brows)
    const eyeC = IRIS.clone().lerp(tone, 0.3);
    for (let i = 0; i < nv; i++) {
      if ((i & 63) === 0 && late()) yield;
      const x = pv[i * 3], y = pv[i * 3 + 1], z = pv[i * 3 + 2], b = B.near(x, y, z, 0.03);
      // (the head and the neck: their plain tone, no photo; on this low head it read as a white mask on a pale skin)
      let c = tone, a = y > this.eyeY - 0.32 ? 0 : 1;
      const f = y > this.eyeY + 0.01 ? face.near(x, y, z, 0.009) : null, along = p => (p.x - x) * nn[i * 3] + (p.y - y) * nn[i * 3 + 1] + (p.z - z) * nn[i * 3 + 2], out_ = (p, cap) => Math.max(0, Math.min(cap, along(p)));
      let g = null, gl = null;
      // (a hand is never a garment's, nor an arm the apron's, which hangs by it; the apron only just over the body)
      const arm = isArm(i), hand = isHand(i);
      if (cov && !arm && robe.covers(x, y, z)) cov[i] = 1;
      if (!f && !hand) for (let L = layers.length - 1; L >= 0 && !g; L--) {
        // (not under a garment's hem, nor a shirt between the legs)
        // (nor the chin and the jaw: a collar's colour reached up to them, a beard of cloth that made the face from afar a
        // dark mask; only a headscarf goes over the neck)
        if ((arm && layers[L].apron) || y < layers[L].minY - 0.01 || (layers[L].upper && (y < this.J.body.y - 0.02 || isLeg(i)) && !arm) || (layers[L].scarf && front(x, y, z)) || (!layers[L].scarf && y > neckTop) || (layers[L].apron && nn[i * 3 + 2] < 0.35)) continue;   // (the apron: only what faces forward, never the thighs' sides)
        const q = layers[L].near(x, y, z, layers[L].apron ? 0.04 : arm ? 0.12 : b && shown[b.d] ? 0.06 : 0.08);   // (wide sleeves stand well off the arm)
        if (q && along(q) > -0.025) { g = q; gl = layers[L]; }
      }   // (the low body may stand a little out of a garment)
      let h = f || front(x, y, z) ? null : hair.near(x, y, z, 0.05);
      if (g && h && along(h) > along(g) + 0.004) g = null;   // (long hair over the clothes: the hair)
      const bd = f || g ? null : beard.near(x, y, z, 0.015);
      const sk = !g && y < hipY && !arm ? skirt.get(Math.floor(y / SK)) : null;
      // (the eye itself, on the photo a white ball: dark, as an eye looks from metres away; a hole there is closed: eyePlugs)
      let eye = false;
      for (const E of eyes) if (E.f.distanceTo(V.set(x, y, z)) < 0.01) eye = true;
      if (eye) { c = eyeC; a = 0; }
      else if (f) { c = tone.clone().lerp(f.d, 0.6); a = 0; }
      else if (g) { c = gl.tear ? worn(g.d, gl.tear, x, y, z, tone) : g.d; a = 0; push[i] = out_(g, 0.04) + 0.004; }
      else if (sk && Math.hypot(x, z - this.J.body.z) < sk.r) { c = sk.c.clone().multiplyScalar(0.55); a = 0; }
      else if (bd) { c = bd.d; a = 0; push[i] = out_(bd, 0.012); }
      else if (h) { c = hairC; a = 0; push[i] = out_(h, 0.05) + 0.003; }
      out[i * 4] = c.r; out[i * 4 + 1] = c.g; out[i * 4 + 2] = c.b; out[i * 4 + 3] = a;
    }
    // The vertices: the body's, the eyes' plugs, the hair's and the beard's cards
    const plugs = this.eyePlugs(tri, pv, eyes, rm, d.uv);
    // (of the hair's cards only those that stand off the head, a fringe, long hair, a tail: more than 2 cm out; the rest is
    // the colour painted on the head, as the beard)
    if (late()) yield;
    this.stage = 'cards';
    const cards = [];
    for (const p of this.parts) {
      if (kindOf(p.name) !== 'hair' || softPass(p.name) || !p.name.startsWith('own') || isShell(p.name) || this.curly) continue;   // (curls: the mass alone)
      const a = p.g.attributes.position, ix = p.g.index.array, off = new Uint8Array(a.count), keep = [];
      for (let i = 0; i < a.count; i++) { off[i] = B.near(a.getX(i), a.getY(i), a.getZ(i), 0.022) ? 0 : 1; if ((i & 255) === 0 && late()) yield; }
      for (let t = 0; t < ix.length; t += 3) if (off[ix[t]] || off[ix[t + 1]] || off[ix[t + 2]]) keep.push(ix[t], ix[t + 1], ix[t + 2]);
      if (keep.length) cards.push({ p, keep });
    }
    // (a hat, whole, in the same mesh: its two colours as a garment's; the hair accessories are left out here)
    for (const p of this.parts) if (kindOf(p.name) === 'hat') cards.push({ p, keep: p.g.index.array, hat: true });
    const nc = cards.reduce((k, c) => k + c.p.g.attributes.position.count, 0), np = plugs.pts.length, N = n + np + nc + sheets.reduce((k, S) => k + S.n, 0);
    const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), lc = new Float32Array(N * 4), uv = new Float32Array(N * 2);
    const si = new Uint8Array(N * 4), sw = new Float32Array(N * 4), head = Math.max(0, toSkel[BONES.indexOf('head')]);
    for (let r = 0; r < n; r++) {
      const i = rm[r];
      for (let k = 0; k < 3; k++) { pos[r * 3 + k] = pv[i * 3 + k] + nn[i * 3 + k] * push[i]; nor[r * 3 + k] = nn[i * 3 + k]; }
      for (let k = 0; k < 4; k++) { lc[r * 4 + k] = out[i * 4 + k]; si[r * 4 + k] = Math.max(0, toSkel[lod.skin.idx[i * 4 + k]]); sw[r * 4 + k] = lod.skin.w[i * 4 + k]; }
    }
    uv.set(d.uv);
    // (without the legs inside the robe)
    const index = [];
    for (let t = 0; t < d.idx.length; t += 3) { const A = d.idx[t], B = d.idx[t + 1], C = d.idx[t + 2]; if (!(cov && cov[rm[A]] && cov[rm[B]] && cov[rm[C]])) index.push(A, B, C); }
    plugs.pts.forEach((p, j) => { const r = n + j; pos.set([p.x, p.y, p.z], r * 3); nor.set([0, 0, 1], r * 3); uv.set(plugs.uvs.slice(j * 2, j * 2 + 2), r * 2); lc.set([IRIS.r, IRIS.g, IRIS.b, 0], r * 4); si[r * 4] = head; sw[r * 4] = 1; });
    for (const t of plugs.tris) index.push(t < 0 ? n + (-t - 1) : t);
    let at = n + np;
    for (const { p, keep: ix, hat } of cards) {
      const a = p.g.attributes.position, nr = p.g.attributes.normal, c = hat ? null : tint(p.mat, 0.8), att = p.g.attributes.att;
      const two = hat && [U(p.mat).c1.value.clone().multiplyScalar(0.75), U(p.mat).c2.value.clone().multiplyScalar(0.75)];
      for (let i = 0; i < a.count; i++) {
        const r = at + i, ci = hat ? two[att.getX(i) > 0.5 ? 1 : 0] : c;
        pos[r * 3] = a.getX(i); pos[r * 3 + 1] = a.getY(i); pos[r * 3 + 2] = a.getZ(i);
        nor[r * 3] = nr.getX(i); nor[r * 3 + 1] = nr.getY(i); nor[r * 3 + 2] = nr.getZ(i);
        lc[r * 4] = ci.r; lc[r * 4 + 1] = ci.g; lc[r * 4 + 2] = ci.b; lc[r * 4 + 3] = 0;
        si[r * 4] = head; sw[r * 4] = 1;
      }
      for (let t = 0; t < ix.length; t++) index.push(at + ix[t]);
      at += a.count;
    }
    // (the robe: each vertex the outermost garment's over it (an apron only in front), torn as it is; the apron's panel, the
    // apron's)
    for (const robe of sheets) {
      for (let v = 0; v < robe.n; v++) {
        const r = at + v, x = robe.pos[v * 3], y = robe.pos[v * 3 + 1], z = robe.pos[v * 3 + 2], nz = robe.nor[v * 3 + 2];
        // (the hull a little lighter than the painted hair: the near one's shine lifts a dark hair's mass)
        let c = robe === hull ? (hairC || tone).clone().multiplyScalar(1.1 * hull.shade[v]).addScalar(0.03) : null, tr = 0;
        for (const reach of [0.1, 0.3]) for (let L = layers.length - 1; L >= 0 && !c; L--) {
          const Ly = layers[L];
          if (robe === panel ? !Ly.apron : Ly.upper || Ly.scarf || (Ly.apron && (nz < 0.35 || reach > 0.1))) continue;
          const q = Ly.near(x, y, z, Ly.apron && robe !== panel ? 0.05 : reach);
          if (q) { c = q.d; tr = Ly.tear; }
        }
        c = c ? (tr ? worn(c, tr, x, y, z, tone) : c) : tone;
        for (let k = 0; k < 3; k++) { pos[r * 3 + k] = robe.pos[v * 3 + k]; nor[r * 3 + k] = robe.nor[v * 3 + k]; }
        for (let k = 0; k < 4; k++) { si[r * 4 + k] = robe.si[v * 4 + k]; sw[r * 4 + k] = robe.sw[v * 4 + k]; }
        lc[r * 4] = c.r; lc[r * 4 + 1] = c.g; lc[r * 4 + 2] = c.b; lc[r * 4 + 3] = -1;
      }
      for (const t of robe.tris) index.push(at + t);
      at += robe.n;
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
  // A skirt, a tunic or a coat from the hips down, as a robe: rings of ROBE_COLS vertices, a ring every 7 cm or so, each
  // vertex as far out as the near garment there and skinned as that garment's vertex, so it walks as the near one does.
  // Painted on the legs, a skirt read from afar as two painted legs with the ground showing between them. The sleeves
  // hanging by the hips are not the robe; each column ends at the garment's own hem there (a coat longer behind)
  // (open: only the columns the garment has, an apron's panel in front; top: where it starts)
  *robe(wide, top = this.J.body.y - 0.03, open = false) {
    const NC = ROBE_COLS, cz = this.J.body.z, TAU = Math.PI * 2;
    const armB = new Set(['armL', 'armR', 'foreL', 'foreR', 'handL', 'handR'].map(b => ORDER.indexOf(b)));
    const sleeve = (g, i) => { const si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array; let w = 0; for (let k = 0; k < 4; k++) if (armB.has(si[i * 4 + k])) w += sw[i * 4 + k]; return w > 0.2; };
    const colOf = (x, z) => { const k = Math.floor((Math.atan2(x, z - cz) / TAU + 0.5) * NC); return ((k % NC) + NC) % NC; };
    // (the vertices drawn, under the hips and not of a sleeve)
    const pts = [];
    for (const p of wide) {
      const a = p.g.attributes.position, ix = p.g.index.array, on = new Uint8Array(a.count);
      for (let t = 0; t < ix.length; t++) on[ix[t]] = 1;
      for (let i = 0; i < a.count; i++) if (on[i] && a.getY(i) < top && !sleeve(p.g, i)) pts.push(p, i);
      if (late()) yield;
    }
    if (pts.length < 40) return null;
    const hem = new Float32Array(NC).fill(Infinity);
    for (let k = 0; k < pts.length; k += 2) { const a = pts[k].g.attributes.position, i = pts[k + 1], j = colOf(a.getX(i), a.getZ(i)); hem[j] = Math.min(hem[j], a.getY(i)); }
    // (a column with nothing: as its neighbours (open: none there); under 5 cm long, nothing to make)
    const has = Array.from(hem, h => h < Infinity);
    for (let pass = 0; pass < NC && hem.some(h => h === Infinity); pass++) for (let j = 0; j < NC; j++) if (hem[j] === Infinity) hem[j] = Math.min(hem[(j + 1) % NC], hem[(j + NC - 1) % NC]);
    // (the hem a little smoothed round: the near one's lowest folds made it a saw)
    const h0 = hem.slice();
    for (let j = 0; j < NC; j++) if (!open || (has[(j + NC - 1) % NC] && has[(j + 1) % NC])) hem[j] = (h0[(j + NC - 1) % NC] + 2 * h0[j] + h0[(j + 1) % NC]) / 4;
    let low = Infinity;
    for (let j = 0; j < NC; j++) { hem[j] = Math.min(hem[j], top - 0.05); low = Math.min(low, hem[j]); }
    if (!(low < top - 0.08)) return null;
    const R = Math.max(2, Math.min(14, Math.round((top - low) / 0.07))), rad = new Float32Array(NC * (R + 1)), who = new Int32Array(NC * (R + 1)).fill(-1);
    const rowOf = (j, y) => Math.max(0, Math.min(R, Math.round((top - y) / (top - hem[j]) * R)));
    for (let k = 0; k < pts.length; k += 2) {
      const a = pts[k].g.attributes.position, i = pts[k + 1], x = a.getX(i), z = a.getZ(i), j = colOf(x, z), c = rowOf(j, a.getY(i)) * NC + j, r = Math.hypot(x, z - cz);
      if (r > rad[c]) { rad[c] = r; who[c] = k; }
      if ((k & 2047) === 0 && late()) yield;
    }
    // (an empty cell: the nearest of its ring; an empty ring: the one above)
    for (let r = 0; r <= R; r++) {
      const row = r * NC;
      if (!who.subarray(row, row + NC).some(w => w >= 0)) { if (r) for (let j = 0; j < NC; j++) { rad[row + j] = rad[row - NC + j]; who[row + j] = who[row - NC + j]; } continue; }
      for (let j = 0; j < NC; j++) if (who[row + j] < 0) for (let s = 1; s < NC; s++) { const o = row + (j + s) % NC, o2 = row + (j + NC - s) % NC; if (who[o] >= 0 || who[o2] >= 0) { const f = who[o] >= 0 ? o : o2; rad[row + j] = rad[f]; who[row + j] = -2 - who[f]; break; } }
      for (let j = 0; j < NC; j++) if (who[row + j] < -1) who[row + j] = -2 - who[row + j];
      // (a little smoothed round the ring: one fold of the near skirt is not a corner of the robe)
      const sm = Float32Array.from({ length: NC }, (_, j) => (rad[row + (j + NC - 1) % NC] + 2 * rad[row + j] + rad[row + (j + 1) % NC]) / 4);
      for (let j = 0; j < NC; j++) rad[row + j] = Math.max(sm[j], rad[row + j] * 0.94);
    }
    // (the top rings still empty: as the first one under them)
    for (let r = R - 1; r >= 0; r--) if (who[r * NC] < 0) for (let j = 0; j < NC; j++) { rad[r * NC + j] = rad[(r + 1) * NC + j]; who[r * NC + j] = who[(r + 1) * NC + j]; }
    if (who[0] < 0) return null;
    const n = NC * (R + 1), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), si = new Uint8Array(n * 4), sw = new Float32Array(n * 4);
    for (let r = 0; r <= R; r++) for (let j = 0; j < NC; j++) {
      const v = r * NC + j, th = ((j + 0.5) / NC - 0.5) * TAU, s = Math.sin(th), c = Math.cos(th), y = top - (top - hem[j]) * r / R;
      pos[v * 3] = s * rad[v]; pos[v * 3 + 1] = y; pos[v * 3 + 2] = cz + c * rad[v];
      nor[v * 3] = s; nor[v * 3 + 2] = c;
      const p = pts[who[v]], i = pts[who[v] + 1], gs = p.g.attributes.skinIndex.array, gw = p.g.attributes.skinWeight.array;
      for (let k = 0; k < 4; k++) { si[v * 4 + k] = gs[i * 4 + k]; sw[v * 4 + k] = gw[i * 4 + k]; }
    }
    const tris = [];
    for (let r = 0; r < R; r++) for (let j = 0; j < NC; j++) {
      if (open && !(has[j] && has[(j + 1) % NC])) continue;
      const a = r * NC + j, b = r * NC + (j + 1) % NC, c = a + NC, d = b + NC;
      tris.push(a, c, b, b, c, d);
    }
    // (a vertex of the low body inside it, between its top and a little over its hem: left out)
    const covers = (x, y, z) => {
      if (y > top + 0.01) return false;
      const j = colOf(x, z);
      return y > hem[j] + 0.04 && Math.hypot(x, z - cz) < rad[rowOf(j, y) * NC + j] + 0.012;
    };
    return { n, pos, nor, si, sw, tris, covers };
  }
  // Curly hair and the afro from metres away: their cards and fur shells, each a little curl, made a fuzz of bits. One clean
  // mass instead, round the head: a hull of HULL_COLS x HULL_ROWS directions from the head's middle (c), each as far out
  // as the hair goes that way, open where there is no hair (the face). On the head bone, as the cards
  *hairHull(c, head) {
    const NC = HULL_COLS, NR = HULL_ROWS, TAU = Math.PI * 2, rad = new Float32Array(NC * NR), cnt = new Uint16Array(NC * NR), sum = new Float32Array(NC * NR), dir = new Float32Array(NC * NR * 3);
    const rowOf = phi => Math.round((HULL_TOP - phi) / ((HULL_TOP - HULL_LOW) / (NR - 1)));
    for (const p of this.parts) {
      if (kindOf(p.name) !== 'hair' || softPass(p.name)) continue;
      const a = p.g.attributes.position;
      for (let k = 0; k < a.count; k++) {
        if ((k & 2047) === 0 && late()) yield;
        const x = a.getX(k) - c.x, y = a.getY(k) - c.y, z = a.getZ(k) - c.z, r = Math.hypot(x, y, z), row = rowOf(Math.asin(y / (r || 1)));
        if (row < 0 || row >= NR) continue;
        const col = ((Math.round((Math.atan2(x, z) / TAU + 0.5) * NC) % NC) + NC) % NC, o = row * NC + col;
        cnt[o]++; sum[o] += r; if (r > rad[o]) rad[o] = r;
        if (r) { dir[o * 3] += x / r; dir[o * 3 + 1] += y / r; dir[o * 3 + 2] += z / r; }
      }
    }
    // (a cell with a few strays is not hair; a hole between two of hair, closed; then a little smoothed)
    const has = Uint8Array.from(cnt, (k, o) => (k >= (o < NC ? 1 : 12) ? 1 : 0));   // (the crown's ring: any hair there)
    // (out to most of the hair, not its farthest stray curl: between its mean and its farthest)
    for (let o = 0; o < NC * NR; o++) if (cnt[o]) rad[o] = sum[o] / cnt[o] + 0.6 * (rad[o] - sum[o] / cnt[o]);
    for (let r = 0; r < NR; r++) for (let j = 0; j < NC; j++) {
      const o = r * NC + j, L = r * NC + (j + NC - 1) % NC, R = r * NC + (j + 1) % NC, U = o - NC, D = o + NC;
      if (has[o]) continue;
      if (has[L] && has[R]) { rad[o] = (rad[L] + rad[R]) / 2; has[o] = 2; }
      else if (r > 0 && r < NR - 1 && has[U] && has[D]) { rad[o] = (rad[U] + rad[D]) / 2; has[o] = 2; }
    }
    if (!has.some(Boolean)) return null;
    const sm = rad.slice();
    for (let r = 0; r < NR; r++) for (let j = 0; j < NC; j++) {
      const o = r * NC + j;
      if (!has[o]) continue;
      let s = 2 * rad[o], w = 2;
      for (const q of [r * NC + (j + NC - 1) % NC, r * NC + (j + 1) % NC, o - NC, o + NC]) if (q >= 0 && q < NC * NR && has[q]) { s += rad[q]; w++; }
      sm[o] = Math.max(s / w, rad[o] * 0.9);
    }
    const edge = new Uint8Array(NC * NR);
    // (at the hull's edge, the hairline, down to the hair's mean: it meets the head there instead of standing off as a hood)
    for (let r = 0; r < NR; r++) for (let j = 0; j < NC; j++) {
      const o = r * NC + j;
      if (has[o] && cnt[o] && [r * NC + (j + NC - 1) % NC, r * NC + (j + 1) % NC, r < NR - 1 ? o + NC : -1].some(q => q >= 0 && !has[q])) { sm[o] = Math.min(sm[o], sum[o] / cnt[o]); edge[o] = 1; }
    }
    // (the vertices: the rows, and the crown's point over them, as far out as the top row on average)
    const n = NC * NR + 1, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), si = new Uint8Array(n * 4), sw = new Float32Array(n * 4), shade = new Float32Array(n);
    let top = 0, tn = 0;
    for (let r = 0; r < NR; r++) for (let j = 0; j < NC; j++) {
      const o = r * NC + j, phi = HULL_TOP - r * (HULL_TOP - HULL_LOW) / (NR - 1), th = (j / NC - 0.5) * TAU;
      let dx = Math.cos(phi) * Math.sin(th), dy = Math.sin(phi), dz = Math.cos(phi) * Math.cos(th);
      // (towards where its hair is: a cell's hair may be only in its upper part, by the ear)
      const l = Math.hypot(dir[o * 3], dir[o * 3 + 1], dir[o * 3 + 2]);
      if (l > 0) { dx = 0.3 * dx + 0.7 * dir[o * 3] / l; dy = 0.3 * dy + 0.7 * dir[o * 3 + 1] / l; dz = 0.3 * dz + 0.7 * dir[o * 3 + 2] / l; const k = 1 / Math.hypot(dx, dy, dz); dx *= k; dy *= k; dz *= k; }
      pos.set([c.x + dx * sm[o], c.y + dy * sm[o], c.z + dz * sm[o]], o * 3); nor.set([dx, dy, dz], o * 3);
      // (darker underneath, where the light does not reach, and in clumps)
      shade[o] = (1 - 0.3 * Math.max(0, -dy)) * (0.86 + 0.28 * noise3(dx * 3 + 7, dy * 3, dz * 3)) * (edge[o] ? 0.8 : 1);
      if (r === 0 && has[o]) { top += sm[o]; tn++; }
    }
    const P = NC * NR;
    pos.set([c.x, c.y + (tn ? top / tn : 0.1), c.z], P * 3); nor.set([0, 1, 0], P * 3); shade[P] = 1;
    for (let v = 0; v < n; v++) { si[v * 4] = head; sw[v * 4] = 1; }
    const tris = [];
    for (let j = 0; j < NC; j++) { const a = j, b = (j + 1) % NC; if (has[a] && has[b]) tris.push(P, a, b); }   // (wound to face out, as the robe)
    for (let r = 0; r < NR - 1; r++) for (let j = 0; j < NC; j++) {
      const a = r * NC + j, b = r * NC + (j + 1) % NC, d = a + NC, e = b + NC;
      if (has[a] && has[b] && has[d]) tris.push(a, d, b);
      if (has[b] && has[e] && has[d]) tris.push(b, d, e);
    }
    if (!tris.length) return null;
    return { n, pos, nor, si, sw, tris, shade };
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
    // Its own skeleton object on the same bones, with the inverses of MakeHuman's rest. The ring person under it is a
    // stand-in of its sex (realperson.js), never drawn: its bones and its walk are what is used
    const rest = bones.map(b => new THREE.Matrix4().makeTranslation(...restOf(b).negate().toArray()));
    this.skel = lazy(new THREE.Skeleton(bones, rest));
    r.mesh.visible = false;
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
      const s = (this.low = new THREE.SkinnedMesh(S.low, (this.lowShared = lowMaterial(S.skinMat))));
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
  // Into the person's root (with the ring mesh: lying down moves that root), drawn at the level asked; inner holds both
  // levels, for the engine's gate (engine.js: shown when their programs are compiled, which the game does in parallel)
  attach(parent) {
    this.inner = new THREE.Group(); this.inner.name = 'mh-body';
    this.inner.add(this.near);
    if (this.low) this.inner.add(this.low);
    parent.add(this.inner);
    this.setLevel(0);
  }
  // (far, the low body too, without its shadow: under a hundred pixels it is the cheapest that keeps the look)
  setLevel(n) {
    if (n === this.level) return;
    this.level = n;
    this.near.visible = n === 0 || (n > 0 && !this.low);
    if (this.low) { this.low.visible = n > 0; this.low.castShadow = n === 1; }
    this.skel.userData.dirty = true;
  }
  get tris() { return this.level === 0 || !this.low ? this.tris0 : this.tris1; }
  // What the world has left on the body (grime.js; s: body.surface()'s shape or null): on the near skin and clothes, the
  // look's materials, and on the low body a material of its own while there is something (the low one is everybody's)
  setGrime(s, on) {
    const S = this.shape;
    for (const m of S.grimeMats) on ? writeGrime(m, s, this.height) : clearGrime(m);
    if (!this.low) return;
    if (on && !this.lowOwn) { this.lowOwn = grimeMaterial(this.lowShared); this.low.material = this.lowOwn; }
    if (this.lowOwn) { if (on) writeGrime(this.lowOwn, s, this.height); else { this.low.material = this.lowShared; this.lowOwn.dispose(); this.lowOwn = null; } }
  }
  // After the persona's pose (real/persona.js writes the hips' height for its own legs): for these legs
  afterPose() {
    const b = this.r.bones.body;
    b.position.x *= this.kHip; b.position.y *= this.kHip; b.position.z += this.hipZ;
    this.skel.userData.dirty = true;
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
    this.inner?.parent?.remove(this.inner);
    this.lowOwn?.dispose();
    this.skel.dispose();
    this.shape.release();
  }
}
// (the ring skeleton's order: body, spine, torso, neck, head, then clav, arm, fore, hand, leg, shin, foot, toe of the left
// and of the right; skirt and braid after: real/persona.js defs)
const ORDER = ['body', 'spine', 'torso', 'neck', 'head', ...['L', 'R'].flatMap(S => ['clav', 'arm', 'fore', 'hand', 'leg', 'shin', 'foot', 'toe'].map(b => b + S))];
const LOW_TONE = new THREE.Color(1, 0.93, 0.88);
// (the garments that hang free below the hips: the robe; how many vertices round it)
const WIDE = /:(tunica|tunica_larga|abrigo|falda)$/, ROBE_COLS = 18;
// (curly hair's hull: directions round, rows from HULL_TOP down to HULL_LOW, radians of elevation)
const HULL_COLS = 18, HULL_ROWS = 9, HULL_TOP = 1.4, HULL_LOW = -1.2;
// A garment's colour at a point of a worn piece (tear 1) or a torn one (2): from afar its holes are a few darker patches,
// the skin showing in the worst of them; a worn one, faded patches. By a noise in space (about 10 cm patches)
function worn(c, tear, x, y, z, skin) {
  const w = noise3(x * 9, y * 9, z * 9) * 0.6 + noise3(x * 23 + 5, y * 23, z * 23) * 0.4;
  let o = c;
  if (w > 0.58 - 0.06 * tear) { const l = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; o = c.clone().lerp(W_.setRGB(l, l, l).multiplyScalar(1.2), 0.45); }
  if (tear > 1.5) {
    const h = noise3(x * 13 + 3.1, y * 13, z * 13 - 1.7);
    if (h > 0.76) o = skin.clone().multiplyScalar(0.5);
    else if (h > 0.62) o = o.clone().multiplyScalar(0.55);
    else if (w > 0.5) o = o.clone().multiplyScalar(0.8);
  }
  return o;
}
const W_ = new THREE.Color();
// A smooth noise in space, 0..1 (value noise on a unit lattice)
function noise3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), u = sm3(x - X), v = sm3(y - Y), w = sm3(z - Z);
  const h = (i, j, k) => { let n = Math.imul(X + i, 374761393) ^ Math.imul(Y + j, 668265263) ^ Math.imul(Z + k, 1440662683); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v), l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
const sm3 = t => t * t * (3 - 2 * t);
const IDENTITY = new THREE.Matrix4(), V = new THREE.Vector3(), IRIS = new THREE.Color('#2e241c');
// Where a bone is at rest, from the ground (its own and its parents' places: no turns at rest)
function restOf(b) { const p = new THREE.Vector3(); for (let o = b; o?.isBone; o = o.parent) p.add(o.position); return p; }

// ---- Who is made next (actors.js, each frame): those waiting ask for their shapes by distance, a few ms of making run,
// and whoever has a shape ready puts it on (that costs about a millisecond)
export function buildNext(waiting, dark = false) {
  if (!D) return;
  for (const [P, d] of waiting) requestShape(P.look, P.mhWant, d);
  runJobs(dark);
  for (const [P] of waiting) if (shapeReady(P.look, P.mhWant)) P.wearMh();
}
