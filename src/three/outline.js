// El borde amarillo de lo que se apunta con el cursor. Se dibuja después de todo, sobre el canal de plantilla: primero la
// forma de la cosa (solo marca la plantilla) y luego esa misma forma engordada unos píxeles, de amarillo, solo fuera de lo
// marcado. Sale la silueta, del mismo grosor a cualquier distancia.
//
// The shape is always the one on screen this frame (drawn after everything has been animated):
// - actors (people, animals, monsters, other players with their horse or boat): their own visible meshes. People are
//   SkinnedMesh: the outline uses a SkinnedMesh bound to the same skeleton, so it follows every bone (walking, sitting,
//   the tool gesture); morph targets share the influences array.
// - live objects (a door or gate leaf as it swings, a moored boat, what is inside a cave): their meshes as they are.
// - models merged into the chunk meshes (placed things, the hearth, the village board, places, chests, crops): the
//   model's pieces where the chunk draws them (same height as buildChunk: the level of its tile).
// - trees: the instances of that tree, swaying with the wind like them. The leaf cards are flat quads with a cut-out
//   texture: the mask keeps only their leaves, and the line is each card grown a few pixels around its centre (with the
//   same cut), so the outline goes round the foliage and not round the quads or the dark core inside.
// - the rest (a window, a cave gate or plate…): its box.
// The same shapes give the exact aim test (hit): the cursor ray against the real triangles.
import * as THREE from 'three';
import { getModel } from './models.js';
import { nearX } from '../world/planet.js';
import { WIND } from './nature3d.js';

const WIDTH = 2.5;   // grosor, en píxeles de la pantalla
// The mark is grown too, a little: separate pieces a pixel or two apart (the planks of a door, a bag on a back) close up,
// and the line does not show through those seams. The line grows that much more, so it keeps its width outside
const SEAM = 1.25;
const U = { res: { value: new THREE.Vector2(1, 1) }, width: { value: WIDTH + SEAM }, seam: { value: SEAM }, glow: { value: 1 } };
const STENCIL_MARK = { stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilRef: 1, stencilZPass: THREE.ReplaceStencilOp, stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp };
const STENCIL_LINE = { stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilRef: 1, stencilZPass: THREE.KeepStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp };
// The shape pushed out along its normal on the screen, with the skinning and morph chunks: Three turns them on by itself
// for a SkinnedMesh or a geometry with morphs, and the normal is the posed one
const SHELL_VS = `uniform vec2 res; uniform float width;
    #include <common>
    #include <morphtarget_pars_vertex>
    #include <skinning_pars_vertex>
    void main() {
      #include <beginnormal_vertex>
      #include <morphnormal_vertex>
      #include <skinbase_vertex>
      #include <skinnormal_vertex>
      #include <begin_vertex>
      #include <morphtarget_vertex>
      #include <skinning_vertex>
      vec4 c = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      vec2 d = (projectionMatrix * vec4(normalMatrix * objectNormal, 0.0)).xy;
      if (dot(d, d) > 1e-8) c.xy += normalize(d) * width * 2.0 / res * c.w;
      gl_Position = c;
    }`;
const COLOR_FS = 'uniform float glow; void main() { gl_FragColor = vec4(vec3(1.0, 0.82, 0.2) * glow, 1.0); }';
const shell = mark => new THREE.ShaderMaterial({
  uniforms: { res: U.res, width: mark ? U.seam : U.width, glow: U.glow }, vertexShader: SHELL_VS, fragmentShader: COLOR_FS,
  colorWrite: !mark, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false, ...(mark ? STENCIL_MARK : STENCIL_LINE),
});
const MASK = shell(true), LINE = shell(false);
// The parts of a tree (instanced, with the wind of nature3d.js: sway = [amount, speed, 1 or -1 if it hangs]), grown like
// the shells above. CARD: a leaf card, cut by its texture and grown on the screen around its centre (a flat quad has no
// side to push out), with its leaves grown in the texture by as many pixels
const INST_VS = `uniform vec2 res; uniform float width; uniform float windTime; uniform vec3 sway;
  #ifdef CARD
  varying vec2 vUv;
  #endif
  void main() {
    vec3 p = position;
    vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float t = windTime * sway.y;
    float s = sin(t * 1.6 + wp.x * 0.35 + wp.z * 0.25) * 0.6 + sin(t * 2.9 + wp.x * 0.9 - wp.z * 0.4) * 0.3;
    p.xz += vec2(s, s * 0.5) * sway.x * max(sway.z * position.y, 0.0);
    mat4 mv = modelViewMatrix * instanceMatrix;
    vec4 c = projectionMatrix * mv * vec4(p, 1.0);
    #ifdef CARD
    vUv = uv;
    vec4 o = projectionMatrix * mv * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 d = c.xy / c.w - o.xy / o.w;
    #else
    vec2 d = (projectionMatrix * vec4(normalMatrix * (mat3(instanceMatrix) * normal), 0.0)).xy;
    #endif
    if (dot(d, d) > 1e-12) c.xy += normalize(d) * width * 2.0 / res * c.w;
    gl_Position = c;
  }`;
const INST_FS = `uniform float glow; uniform sampler2D map; uniform float width;
  #ifdef CARD
  varying vec2 vUv;
  #endif
  void main() {
    #ifdef CARD
    // (the leaves grown by the width: the most opaque of 8 texels around, at that many pixels on the screen)
    float a = texture2D(map, vUv).a;
    vec2 ux = dFdx(vUv) * width, uy = dFdy(vUv) * width;
    for (int i = 0; i < 8; i++) { float k = float(i) * 0.785398; a = max(a, texture2D(map, vUv + ux * cos(k) + uy * sin(k)).a); }
    if (a < 0.5) discard;
    #endif
    gl_FragColor = vec4(vec3(1.0, 0.82, 0.2) * glow, 1.0);
  }`;
const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); WHITE.needsUpdate = true;
function instMat(line, card) {
  return new THREE.ShaderMaterial({
    uniforms: { res: U.res, width: line ? U.width : U.seam, glow: U.glow, windTime: WIND, sway: { value: new THREE.Vector3() }, map: { value: WHITE } },
    vertexShader: INST_VS, fragmentShader: INST_FS, defines: card ? { CARD: '' } : {},
    colorWrite: line, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false, ...(line ? STENCIL_LINE : STENCIL_MARK),
  });
}
const CARDS = new Set(['card', 'cardS', 'cardStrand', 'cardStrandB', 'frond2']);
// The wind of a nature material (its program key says it: see nature3d.js sway), as [amount, speed, ±1]
const SWAY = new WeakMap();
function swayOf(mat) {
  let v = SWAY.get(mat);
  if (!v) { const k = /sway([\d.]+):([\d.]+)(:cuelga)?/.exec(mat?.customProgramCacheKey?.() || ''); v = k ? [+k[1], +k[2], k[3] ? -1 : 1] : [0, 0, 1]; SWAY.set(mat, v); }
  return v;
}
const BOX = new THREE.BoxGeometry(1, 1, 1), ME = new THREE.Matrix4(), MI = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3();
const RAY = new THREE.Raycaster(), HITS = [], BB = new THREE.Box3();

export class Outline {
  constructor(view) {
    this.view = view;
    this.scene = new THREE.Scene();
    this.pool = [];      // [mask, line] pairs of plain meshes
    this.skinned = [];   // [mask, line] pairs of SkinnedMesh (for people)
    this.inst = [];      // [mask, line] pairs of InstancedMesh (the parts of a tree), each with its own materials
    this.models = new Map();   // (las piezas de cada modelo: [[geometría, matriz]])
    this.bounds = new Map();   // model name → its local box
    this.list = [];      // what collect found: [geometry, world matrix, source mesh or null, tree part or null]
  }
  // The programs (plain, skinned and the tree parts; mask and line), compiled without stopping the game: the first
  // outline on a person or a tree would otherwise compile them in the middle of the game
  prewarm() {
    this.warm = true;
    const r = this.view.renderer;
    if (!r?.compileAsync) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const bone = new THREE.Bone(), sk = new THREE.SkinnedMesh(g, MASK), sl = new THREE.SkinnedMesh(g, LINE);
    sk.add(bone); sk.bind(new THREE.Skeleton([bone]));
    sl.bind(sk.skeleton);
    const tmp = new THREE.Scene(), mats = [];
    tmp.add(new THREE.Mesh(g, MASK), new THREE.Mesh(g, LINE), sk, sl);
    for (const line of [false, true]) for (const card of [false, true]) { const m = instMat(line, card); mats.push(m); tmp.add(new THREE.InstancedMesh(g, m, 1)); }
    for (const o of tmp.children) o.frustumCulled = false;
    r.compileAsync(tmp, this.view.camera).catch(() => {}).finally(() => { sk.skeleton.dispose(); g.dispose(); for (const m of mats) m.dispose(); });
  }
  // Una forma más que dibujar: geometría, dónde y, si es de una malla con esqueleto, esa malla
  add(geo, matrix, src = null) {
    const skin = !!src?.isSkinnedMesh, pool = skin ? this.skinned : this.pool, k = skin ? this.ns++ : this.np++;
    let pair = pool[k];
    if (!pair) {
      pair = pool[k] = skin ? [new THREE.SkinnedMesh(BOX, MASK), new THREE.SkinnedMesh(BOX, LINE)] : [new THREE.Mesh(BOX, MASK), new THREE.Mesh(BOX, LINE)];
      this.prep(pair);
    }
    for (const m of pair) {
      m.geometry = geo; m.matrix.copy(matrix); m.visible = true;
      // (the morphs of the source, the same array: whatever it shows this frame)
      m.morphTargetInfluences = src?.morphTargetInfluences; m.morphTargetDictionary = src?.morphTargetDictionary;
      if (skin) { m.skeleton = src.skeleton; m.bindMode = src.bindMode; m.bindMatrix.copy(src.bindMatrix); m.bindMatrixInverse.copy(src.bindMatrixInverse); }
    }
  }
  prep(pair) {
    pair[0].renderOrder = 1; pair[1].renderOrder = 2;
    for (const m of pair) { m.matrixAutoUpdate = false; m.frustumCulled = false; this.scene.add(m); }
  }
  // Some instances of one instanced mesh of a tree (idx), with its wind and, if they are leaf cards, their cut-out
  addInstances(im, idx, type) {
    const k = this.ni++, card = CARDS.has(type);
    let pair = this.inst[k];
    if (!pair || pair[0].instanceMatrix.count < idx.length) {
      if (pair) for (const m of pair) { this.scene.remove(m); m.dispose(); m.material.dispose(); }
      const n = Math.max(64, idx.length);
      pair = this.inst[k] = [new THREE.InstancedMesh(BOX, instMat(false, false), n), new THREE.InstancedMesh(BOX, instMat(true, false), n)];
      this.prep(pair);
    }
    const sway = swayOf(im.userData.mat || im.material), map = (card && (im.userData.mat || im.material).map) || WHITE;
    for (const m of pair) {
      m.geometry = im.geometry; m.matrix.copy(im.matrixWorld); m.visible = true; m.count = idx.length;
      for (let j = 0; j < idx.length; j++) { im.getMatrixAt(idx[j], MI); m.setMatrixAt(j, MI); }
      m.instanceMatrix.needsUpdate = true;
      const M = m.material;
      if ((M.defines.CARD !== undefined) !== card) { if (card) M.defines.CARD = ''; else delete M.defines.CARD; M.needsUpdate = true; }
      M.uniforms.sway.value.set(...sway); M.uniforms.map.value = map;
    }
  }
  pieces(name) {
    if (this.models.has(name)) return this.models.get(name);
    const m = getModel(name), out = [];
    if (m) {
      for (const [, B] of m.parts) if (!B.empty) out.push([B.geometry(), new THREE.Matrix4()]);
      for (const e of m.extras) { e.updateMatrixWorld(true); e.traverse(q => { if (q.isMesh) out.push([q.geometry, q.matrixWorld.clone()]); }); }
    }
    this.models.set(name, out);
    return out;
  }
  // The box of a model in its own coordinates ([x0, y0, z0, x1, y1, z1]), or null
  modelBounds(name) {
    if (this.bounds.has(name)) return this.bounds.get(name);
    let out = null;
    const list = this.pieces(name);
    if (list.length) {
      BB.makeEmpty();
      const b = new THREE.Box3();
      for (const [geo, m] of list) { if (!geo.boundingBox) geo.computeBoundingBox(); BB.union(b.copy(geo.boundingBox).applyMatrix4(m)); }
      out = [BB.min.x, BB.min.y, BB.min.z, BB.max.x, BB.max.y, BB.max.z];
    }
    this.bounds.set(name, out);
    return out;
  }
  // What the aimed thing a looks like, in this.list; false if it only has its box
  collect(a, scene, me) {
    const view = this.view, L = this.list;
    L.length = 0;
    const live = obj => { obj.updateMatrixWorld(true); obj.traverseVisible(q => { if (q.isMesh) push(q); }); };
    const push = q => {
      if (q.isInstancedMesh) { for (let i = 0; i < q.count; i++) { q.getMatrixAt(i, MI); L.push([q.geometry, new THREE.Matrix4().multiplyMatrices(q.matrixWorld, MI), null, null]); } }
      else L.push([q.geometry, q.matrixWorld, q, null]);
    };
    // Something that moves: a person, an animal, a monster, another player
    const actor = a.e && view.actors.models.get(a.e);
    if (actor) { live(actor.root); return true; }
    // Something drawn on its own: the leaf of a door or a gate, a moored boat, what is in a cave
    const obj = this.objectOf(a);
    if (obj) { for (const o of [].concat(obj)) live(o); return true; }
    // A tree: its instances, by instanced mesh ([im, [indices], type])
    if (a.tree) {
      const parts = view.world?.natureParts?.(a.tree.key);
      if (parts?.length) {
        const by = new Map();
        for (const [im, i, type] of parts) { if (!by.has(im)) by.set(im, [im, [], type]); by.get(im)[1].push(i); }
        for (const [im, idx, type] of by.values()) { im.updateMatrixWorld(); L.push([im.geometry, im.matrixWorld, im, [idx, type]]); }
        return true;
      }
    }
    // A model merged into its chunk
    const m = this.modelOf(a, scene);
    if (m) {
      const list = this.pieces(m.name);
      if (list.length) {
        ME.makeRotationY(m.yaw || 0).setPosition(nearX(m.x, me.x), m.lift, m.y);
        for (const [geo, local] of list) L.push([geo, new THREE.Matrix4().multiplyMatrices(ME, local), null, null]);
        return true;
      }
    }
    return false;
  }
  // The live object of an aimed thing (or a list of them), if it is drawn on its own
  objectOf(a) {
    const w = this.view.world;
    // (a door or a gate; also aimed at as a piece, in the build mode)
    if (a.kind === 'door' || (a.kind === 'placed' && a.o?.door && a.o.tile)) return w?.doorLeaf?.(a.tile || a.o.tile) || null;
    if (a.boat) return w?.boatObject?.(a.boat) || null;
    if (a.grid) return this.view.cave?.itemsAt?.(a.grid) || null;
    return null;
  }
  // The model of an aimed thing that is drawn merged into its chunk: { name, x, y, yaw, lift }
  modelOf(a, scene) {
    if (a.model) return { lift: 0, ...a.model };
    const o = a.kind === 'placed' || a.kind === 'hearth' ? a.o : null;
    if (!o || o.layer === 'rug') return null;
    const w = this.view.world, name = o.key && o.key === w?.insideKey ? `${o.placed}:in` : o.model || o.placed;
    return { name, x: o.x, y: o.y, yaw: o.yaw ?? a.yaw ?? 0, lift: liftOf(scene, o) };
  }
  // The aim box of a model, from what it draws ({ x, y, hx, hy, ux…, y0, y1, abs }), or null
  modelBox(m) {
    const b = this.modelBounds(m.name);
    if (!b) return null;
    const yaw = m.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw), cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
    // (local x+ is (cos, -sin) on the ground plan, local z+ is (sin, cos): rotation.y = yaw)
    return { x: m.x + cx * c + cz * s, y: m.y - cx * s + cz * c, hx: (b[3] - b[0]) / 2, hy: (b[5] - b[2]) / 2, ux: c, uy: -s, vx: s, vy: c, y0: (m.lift || 0) + b[1], y1: (m.lift || 0) + b[4], abs: true };
  }
  // The box around a live object, in the world (with absolute heights)
  liveBox(obj) {
    obj.updateMatrixWorld(true);
    BB.setFromObject(obj);
    if (BB.isEmpty()) return null;
    return { x: (BB.min.x + BB.max.x) / 2, y: (BB.min.z + BB.max.z) / 2, hx: (BB.max.x - BB.min.x) / 2, hy: (BB.max.z - BB.min.z) / 2, ux: 1, uy: 0, vx: 0, vy: 1, y0: BB.min.y, y1: BB.max.y, abs: true };
  }
  // Where the cursor ray (o, d: [x, height, y]) meets the real shape of a: its distance in the units of d, null if it
  // misses, undefined if there is no shape to test (then the box decides). People and animals keep their boxes: posing a
  // skinned mesh on the processor for every frame costs too much, and the box of an animal reaches its snout on purpose
  hit(a, scene, me, o, d) {
    if (a.e && this.view.actors.models.get(a.e)) return undefined;
    if (!this.collect(a, scene, me)) return undefined;
    RAY.ray.origin.set(o[0], o[1], o[2]); RAY.ray.direction.set(d[0], d[1], d[2]).normalize();
    const probe = (this.probe ||= new THREE.Mesh(BOX, MASK));
    let best = null;
    const test = (geo, m) => {
      probe.geometry = geo; probe.matrixWorld.copy(m);
      HITS.length = 0;
      probe.raycast(RAY, HITS);
      for (const h of HITS) if (best === null || h.distance < best) best = h.distance;
    };
    for (const [geo, m, src, part] of this.list) {
      if (src?.isSkinnedMesh) continue;
      if (part) { for (const i of part[0]) { src.getMatrixAt(i, MI); test(geo, ME.multiplyMatrices(m, MI)); } }
      else test(geo, m);
    }
    this.list.length = 0;
    return best === null ? null : best / Math.hypot(d[0], d[1], d[2]);
  }
  // Las formas de lo apuntado
  fill(a, scene, me) {
    this.np = this.ns = this.ni = 0;
    if (this.collect(a, scene, me)) {
      for (const [geo, m, src, part] of this.list) { if (part) this.addInstances(src, ...part); else this.add(geo, m, src); }
      return;
    }
    const b = a.box, g = b.abs ? 0 : this.view.groundY(scene, b.x, b.y);
    X.set(b.ux * b.hx * 2, 0, b.uy * b.hx * 2); Z.set(b.vx * b.hy * 2, 0, b.vy * b.hy * 2); Y.set(0, b.y1 - b.y0, 0);
    ME.makeBasis(X, Y, Z).setPosition(nearX(b.x, me.x), g + (b.y0 + b.y1) / 2, b.y);
    this.add(BOX, ME);
  }
  draw(renderer, camera, a, scene, me, t) {
    if (!a || !me) return;
    this.fill(a, scene, me);
    this.list.length = 0;
    for (let i = this.np; i < this.pool.length; i++) this.pool[i][0].visible = this.pool[i][1].visible = false;
    for (let i = this.ns; i < this.skinned.length; i++) { const p = this.skinned[i]; p[0].visible = p[1].visible = false; p[0].skeleton = p[1].skeleton = undefined; }
    for (let i = this.ni; i < this.inst.length; i++) this.inst[i][0].visible = this.inst[i][1].visible = false;
    const k = renderer.getPixelRatio();
    renderer.getDrawingBufferSize(U.res.value);
    U.width.value = (WIDTH + SEAM) * k; U.seam.value = SEAM * k;
    U.glow.value = 0.92 + Math.sin(t * 6) * 0.08;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearStencil();
    renderer.render(this.scene, camera);
    renderer.autoClear = auto;
  }
}
// The height a chunk draws a thing at (buildChunk: the level of its tile; places and treasure, on the ground at 0)
export function liftOf(scene, o) {
  if (scene?.kind === 'grid' || o.poi || o.treasure) return 0;
  const [tx, ty] = o.tile || [Math.floor(o.x), Math.floor(o.y)];
  return scene?.levelAt?.(tx + 0.5, ty + 0.5) || 0;
}
