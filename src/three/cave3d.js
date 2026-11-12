// Cuevas y mazmorras en 3D (las escenas de rejilla del juego): el suelo según el estilo (cueva, hielo o
// templo), paredes de roca irregular (o de sillares en los templos) en las casillas de pared que dan a un
// suelo, y lo que hay dentro: vetas de mineral, cristales que brillan, escaleras para subir y bajar, cofres,
// rejas, palancas, placas, bloques que se empujan y antorchas. Las paredes que quedan entre la cámara y el
// jugador se abren (no se pintan) para que siempre se le vea.
import * as THREE from 'three';
import { mat as mat0, rockGeo } from './geo.js';
import { stone, flagstone, rockFace } from './textures.js';
import { getModel, modelMat } from './models.js';
import { CAM } from '../camera.js';

const STYLE = {
  cave: { floor: '#6a6058', wall: '#9a8e80', top: '#3a342e' },
  ice: { floor: '#a8c8dc', wall: '#bcd8ea', top: '#e8f4fa' },
  temple: { floor: '#a89a80', wall: '#b8aa8a', top: '#6a604e' },
};
const ORE = { piedra: '#8a857c', cobre: '#d8844a', hierro: '#b8c2ce', amatista: '#b07ae0', oro: '#f0c840', esmeralda: '#3ad07a', rubi: '#e83a4a', diamante: '#bff4ff', fosil: '#e8dcc0' };

export class Cave3D {
  constructor(view, scene) {
    this.view = view; this.sc = scene;
    this.group = new THREE.Group();
    view.scene.add(this.group);
    this.cut = { player: { value: new THREE.Vector3() }, toCam: { value: new THREE.Vector2(0, 1) } };
    // (lo que se hace para esta cueva y se suelta con ella: ver dispose. Lo compartido, como los materiales de los
    // modelos, los de las vetas y los cristales, no entra)
    this.ownGeo = new Set(); this.ownMat = new Set();
    this.build();
    this.items = null; this.sig = '';
    this.lightList = []; this.flameList = [];
  }
  build() {
    const sc = this.sc, st = STYLE[sc.style] || STYLE.cave, temple = sc.style === 'temple';
    const G = g => (this.ownGeo.add(g), g), mat = o => { const m = mat0(o); this.ownMat.add(m); return m; };
    // Suelo
    const ftex = temple ? flagstone() : rockFace(st.floor);   // (en la cueva, roca, sin sillares)
    ftex.repeat.set(sc.w / (temple ? 1 : 2), sc.h / (temple ? 1 : 2));
    const floor = new THREE.Mesh(G(new THREE.PlaneGeometry(sc.w, sc.h).rotateX(-Math.PI / 2)), mat({ map: ftex, roughness: 0.95 }));
    floor.position.set(sc.w / 2, 0, sc.h / 2); floor.receiveShadow = true;
    this.group.add(floor);
    // Paredes: en la cueva, rocas irregulares; en el templo, bloques de sillares
    const walls = [];
    for (let ty = 0; ty < sc.h; ty++) for (let tx = 0; tx < sc.w; tx++) {
      if (!sc.wall(tx, ty)) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => !sc.wall(tx + dx, ty + dy) && tx + dx >= 0 && ty + dy >= 0 && tx + dx < sc.w && ty + dy < sc.h);
      if (edge) walls.push([tx, ty]);
    }
    const o = new THREE.Object3D(), rnd = (x, y, k) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(k, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    if (temple) {
      const wallMat = this.cutaway(mat({ map: stone(st.wall), roughness: 0.9 }));
      const im = new THREE.InstancedMesh(G(new THREE.BoxGeometry(1, 2.6, 1).translate(0, 1.3, 0)), wallMat, walls.length);
      walls.forEach(([x, y], i) => { o.position.set(x + 0.5, 0, y + 0.5); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.castShadow = im.receiveShadow = true; this.group.add(im);
      const cap = new THREE.InstancedMesh(G(new THREE.BoxGeometry(1.04, 0.2, 1.04)), this.cutaway(mat({ color: st.top })), walls.length);
      walls.forEach(([x, y], i) => { o.position.set(x + 0.5, 2.7, y + 0.5); o.updateMatrix(); cap.setMatrixAt(i, o.matrix); });
      this.group.add(cap);
    } else {
      // Tres hileras de rocas de caras irregulares con la textura de la roca, de unos 2,6 m (a la altura de las
      // personas); las que tapan se abren igual
      const rm = this.cutaway(mat({ map: rockFace(), flatShading: true, roughness: 0.95 })), lists = [[], [], []];
      for (const [x, y] of walls) for (let k = 0; k < 3; k++) {
        const s = 0.72 + rnd(x, y, k + 7) * 0.3;
        lists[Math.floor(rnd(x, y, k + 11) * 3)].push([x + 0.5 + (rnd(x, y, k) - 0.5) * 0.3, 0.2 + k * 0.82 + rnd(x, y, k + 9) * 0.12, y + 0.5 + (rnd(x, y, k + 3) - 0.5) * 0.3, rnd(x, y, k + 6) * 6, s, s * [1.05, 0.95, 0.85][k], 0.8 + rnd(x, y, k + 8) * 0.35]);
      }
      lists.forEach((list, v) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(G(rockGeo(v + 1)), rm, list.length);
        list.forEach(([px, py, pz, ry, s, sy, c], i) => { o.position.set(px, py, pz); o.rotation.set((c - 1) * 0.6, ry, 0); o.scale.set(s, sy, s); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, new THREE.Color(st.wall).multiplyScalar(c * 1.15)); });
        im.castShadow = im.receiveShadow = true; this.group.add(im);
      });
      if (sc.style === 'ice') {
        const snow = new THREE.InstancedMesh(G(new THREE.DodecahedronGeometry(0.6, 0)), this.cutaway(mat({ color: '#f4fbff' })), walls.length);
        walls.forEach(([x, y], i) => { o.position.set(x + 0.5, 2.55, y + 0.5); o.rotation.set(0, i, 0); o.scale.set(0.9, 0.3, 0.9); o.updateMatrix(); snow.setMatrixAt(i, o.matrix); });
        this.group.add(snow);
      }
    }
    // El techo: una bóveda de roca irregular sobre todo, con estalactitas colgando donde se anda (en el hielo,
    // carámbanos; en el templo, losas lisas). Solo en primera persona: desde arriba taparía la cueva (ver update)
    const H = temple ? 2.8 : 2.5, n = 2, geo = G(new THREE.PlaneGeometry(sc.w + 2, sc.h + 2, (sc.w + 2) * n, (sc.h + 2) * n).rotateX(Math.PI / 2)), p = geo.attributes.position;
    if (!temple) for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, (rnd(Math.round(x * 4), Math.round(z * 4), 21) - 0.5) * 0.35 + Math.sin(x * 0.9) * Math.cos(z * 0.7) * 0.18); }
    geo.computeVertexNormals();
    const tex = temple ? flagstone() : rockFace(sc.style === 'ice' ? '#cfe0ea' : st.wall); tex.repeat.set((sc.w + 2) / 2, (sc.h + 2) / 2);
    const ceil = new THREE.Mesh(geo, mat({ map: tex, flatShading: !temple, roughness: 0.95, color: temple ? '#b8aa8a' : '#cfc8c0', emissive: temple ? '#2e2a22' : '#2e2820', emissiveMap: tex }));   // (un poco de luz propia: por debajo no le da el sol de la cueva)
    ceil.position.set(sc.w / 2, H, sc.h / 2); ceil.receiveShadow = true;
    const roof = new THREE.Group(); roof.add(ceil);
    if (!temple) {
      const list = [];
      for (let ty = 0; ty < sc.h; ty++) for (let tx = 0; tx < sc.w; tx++) {
        if (sc.wall(tx, ty)) continue;
        for (let k = 0; k < 3; k++) if (rnd(tx, ty, 30 + k) < 0.16) list.push([tx + 0.15 + rnd(tx, ty, 40 + k) * 0.7, ty + 0.15 + rnd(tx, ty, 50 + k) * 0.7, 0.04 + rnd(tx, ty, 60 + k) * 0.09, 0.15 + rnd(tx, ty, 70 + k) * 0.45]);
      }
      const ice = sc.style === 'ice', cone = G(new THREE.ConeGeometry(1, 1, 7).rotateX(Math.PI).translate(0, -0.5, 0));
      const im = new THREE.InstancedMesh(cone, ice ? mat({ color: '#d8ecf6', roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.85 }) : mat({ map: rockFace(st.wall), flatShading: true, roughness: 0.9 }), Math.max(1, list.length));
      list.forEach(([x, z, r, l], i) => { o.position.set(x, H + 0.08, z); o.rotation.set(0, i, 0); o.scale.set(r, l, r); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.count = list.length; roof.add(im);
    }
    roof.visible = false;
    this.roof = roof; this.group.add(roof);
    // Fuera de la cueva, negro
    const dark = new THREE.Mesh(G(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: '#030304' }));
    this.ownMat.add(dark.material);
    dark.position.set(sc.w / 2, -0.02, sc.h / 2);
    this.group.add(dark);
  }
  // Las paredes entre la cámara y el jugador no se pintan (a su alrededor, hacia la cámara)
  cutaway(m) {
    const U = this.cut;
    m.onBeforeCompile = sh => {
      sh.uniforms.cutPlayer = U.player; sh.uniforms.cutCam = U.toCam;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCutW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCutW = (modelMatrix * (instanceMatrix * vec4(transformed, 1.0))).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 cutPlayer;\nuniform vec2 cutCam;\nvarying vec3 vCutW;').replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        vec2 d = vCutW.xz - cutPlayer.xz;
        float ahead = dot(d, cutCam), side = abs(d.x * cutCam.y - d.y * cutCam.x);
        if (vCutW.y > 0.3 && ahead > 0.35 && ahead < 9.0 && side < 2.0 + ahead * 0.15) discard;`);
    };
    m.customProgramCacheKey = () => 'cavecut';
    return m;
  }

  update(game, dt) {
    const p = game.player;
    if (p) this.cut.player.value.set(p.x, 0, p.y);
    if (this.roof) this.roof.visible = !!CAM.first;   // (el techo, solo desde dentro: desde arriba taparía todo)
    if (CAM.first) this.cut.toCam.value.set(0, 0);   // (en primera persona no se recortan las paredes)
    else this.cut.toCam.value.set(Math.sin(CAM.yaw), Math.cos(CAM.yaw));
    // Lo de dentro se rehace cuando cambia (una veta picada, un cofre abierto, una reja, una antorcha…)
    const live = this.sc.live(), st = this.sc.state;
    let sig = '';
    for (const o of live) sig += (o.key || '') + (o.chest ? (st.opened[o.key] ? 'o' : 'c') : '') + (o.open ? 'g' : '') + (o.lever !== undefined ? (st.flags['g' + o.lever] ? 'L' : 'l') : '') + (o.plate !== undefined ? (st.flags['g' + o.plate] ? 'P' : 'p') : '') + (o.tile ? o.tile.join(':') : '') + (o.placed || '') + ',';
    if (sig !== this.sig) { this.sig = sig; this.buildItems(live, st); }
  }
  buildItems(live, st) {
    if (this.items) { this.group.remove(this.items); this.items.traverse(o => { if (o.userData.own) o.geometry.dispose(); }); }
    const g = (this.items = new THREE.Group());
    this.lightList = []; this.flameList = [];
    const put = (name, x, z, yaw = 0, y = 0) => {
      const m = getModel(name);
      if (!m) return;
      for (const [key, B] of m.parts) { const mesh = B.transformed(x, y, z, yaw).mesh(modelMat(key)); mesh.userData.own = true; g.add(mesh); }
      for (const e of m.extras) { const o = e.clone(); o.position.add(new THREE.Vector3(x, y, z)); g.add(o); }
      for (const l of m.lights) this.lightList.push({ ...l, x: x + l.x, y: y + l.y, z: z + l.z });
      for (const f of m.fires) this.flameList.push([x + f[0], y + f[1], z + f[2], f[3]]);
    };
    const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };
    const own = geo => Object.assign(new THREE.Mesh(geo, null), { userData: { own: true } });   // (una malla con su geometría propia, que se suelta al rehacer)
    this.items_ = new Map();   // (what was drawn for each tile, for the outline: see itemsAt)
    for (const o of live) {
      const x = o.x, z = o.y, from = g.children.length;
      if (o.kind?.startsWith('veta_')) {
        const ore = o.kind.slice(5), V = vein(), rock = add(new THREE.Mesh(V.rock, V.rockMat), x, 0.42, z);
        rock.rotation.set(0.3, x * 3, 0.2); rock.scale.set(0.62, 0.5, 0.55);
        const gm = oreMat(ore);
        for (let i = 0; i < 7; i++) { const a = i * 0.9 + x, r = i < 2 ? 0.12 : 0.36, c = add(new THREE.Mesh(V.gem, gm), x + Math.cos(a) * r, i < 2 ? 0.82 : 0.45 + (i % 3) * 0.14, z + Math.sin(a) * r * 0.9); c.scale.setScalar(0.1 + (i % 2) * 0.05); c.rotation.set(i, a, 0); }
      } else if (o.shine) {
        const cm = crystalMat(o.color || '#7ae0ff');
        for (let i = 0; i < 5; i++) { const a = i * 1.25, c = add(new THREE.Mesh(vein().prism, cm), x + Math.cos(a) * 0.14 * (i ? 1 : 0), 0, z + Math.sin(a) * 0.14 * (i ? 1 : 0)); c.scale.set(0.09, 0.35 + ((i * 7) % 5) * 0.12, 0.09); c.rotation.set(Math.cos(a) * 0.35 * (i ? 1 : 0), 0, Math.sin(a) * 0.35 * (i ? 1 : 0)); }
        this.lightList.push({ x, y: 0.8, z, color: o.color || '#7ae0ff', intensity: 2.2, range: 6, always: true });
      } else if (o.ladder) {
        if (o.ladder === 'down') { const m = add(own(new THREE.CircleGeometry(0.45, 20).rotateX(-Math.PI / 2)), x, 0.01, z); m.material = modelMat('dark0'); }
        const lad = ladder(o.ladder === 'down'); lad.position.set(x, o.ladder === 'down' ? -0.6 : 0, z); g.add(lad);
        if (o.ladder === 'up') this.lightList.push({ x, y: 2.5, z, color: '#bcd8ff', intensity: 2, range: 6, always: true, halo: 0 });   // (la luz que baja por el agujero: sin halo, no es una lámpara)
      } else if (o.chest) put(`treasure:${st.opened[o.key] ? 1 : 0}`, x, z);
      else if (o.gate !== undefined) {
        const gate = gateModel(); gate.position.set(x, o.open ? 2.3 : 0, z);
        // La reja va a lo largo del pasillo: perpendicular al eje que une sus vecinos libres
        gate.rotation.y = this.sc.wall(o.tile[0] - 1, o.tile[1]) ? 0 : Math.PI / 2;
        g.add(gate);
      } else if (o.lever !== undefined) {
        const on = !!st.flags['g' + o.lever], lev = leverModel(on); lev.position.set(x, 0, z); g.add(lev);
      } else if (o.plate !== undefined) {
        const on = !!st.flags['g' + o.plate];
        add(own(new THREE.BoxGeometry(0.8, on ? 0.02 : 0.08, 0.8)), x, on ? 0.01 : 0.04, z).material = modelMat(on ? 'gold' : 'templeD');
      } else if (o.block) add(own(new THREE.BoxGeometry(0.9, 0.9, 0.9)), x, 0.45, z).material = modelMat('templeD');
      else if (o.placed) put(o.placed, x, z);
      if (o.tile && g.children.length > from) this.items_.set(`${o.tile[0]},${o.tile[1]}`, g.children.slice(from));
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(g);
  }
  // The meshes drawn for what is on a tile (the outline of what is aimed at: a chest, a gate, a lever, a ladder…)
  itemsAt(tile) { return this.items_?.get(`${tile[0]},${tile[1]}`) || null; }
  // Se suelta todo lo que se hizo para esta cueva: geometrías, instancias, materiales y sus texturas (las de las fotos son
  // copias de una compartida: soltarlas solo resta un uso). Lo compartido con el mundo no se toca
  dispose() {
    this.view.scene.remove(this.group);
    if (this.items) this.items.traverse(o => { if (o.userData.own) o.geometry.dispose(); });
    this.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
    for (const g of this.ownGeo) g.dispose();
    for (const m of this.ownMat) { m.map?.dispose(); if (m.emissiveMap !== m.map) m.emissiveMap?.dispose(); m.dispose(); }
    this.ownGeo.clear(); this.ownMat.clear(); this.items = null;
  }
  lights() { return this.lightList.slice(); }
  flames() { return this.flameList; }
}

// (las piezas de las vetas y los cristales, de todas las cuevas; la primera vez que hacen falta: con la foto ya aquí)
let VEIN;
const vein = () => (VEIN ||= { rock: rockGeo(2), gem: new THREE.OctahedronGeometry(1, 0), prism: new THREE.CylinderGeometry(0.6, 1, 1, 6).translate(0, 0.5, 0), rockMat: mat0({ map: rockFace('#8e887e'), flatShading: true, roughness: 0.95 }) });
const OREM = new Map(), CRYM = new Map();
const oreMat = ore => { if (!OREM.has(ore)) OREM.set(ore, mat0({ color: ORE[ore] || '#ffffff', metalness: ['cobre', 'hierro', 'oro'].includes(ore) ? 0.7 : 0.1, roughness: 0.3, emissive: ['amatista', 'esmeralda', 'rubi', 'diamante'].includes(ore) ? ORE[ore] : '#000000', emissiveIntensity: 0.4 })); return OREM.get(ore); };
const crystalMat = c => { if (!CRYM.has(c)) CRYM.set(c, mat0({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.1, transparent: true, opacity: 0.9 })); return CRYM.get(c); };
function ladder(down) {
  const g = new THREE.Group(), w = modelMat('wood'), h = down ? 1.4 : 3.2;
  for (const x of [-0.25, 0.25]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), w); r.position.set(x, h / 2, 0); r.userData.own = true; g.add(r); }
  for (let y = 0.25; y < h; y += 0.32) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.05), w); r.position.set(0, y, 0); r.userData.own = true; g.add(r); }
  g.rotation.x = down ? 0 : -0.25;
  return g;
}
function gateModel() {
  const g = new THREE.Group(), m = modelMat('iron');
  for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 6), m); b.position.set(-0.42 + i * 0.17, 1.25, 0); b.userData.own = true; g.add(b); }
  for (const y of [0.3, 1.3, 2.3]) { const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.06), m); b.position.set(0, y, 0); b.userData.own = true; g.add(b); }
  return g;
}
function leverModel(on) {
  const g = new THREE.Group(), base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.3), modelMat('templeD')), arm = new THREE.Group();
  base.userData.own = true;
  base.position.y = 0.09; g.add(base);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), modelMat('iron')); stick.position.y = 0.3; stick.userData.own = true; arm.add(stick);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), modelMat('red')); knob.position.y = 0.6; knob.userData.own = true; arm.add(knob);
  arm.position.y = 0.18; arm.rotation.z = on ? -0.7 : 0.7; g.add(arm);
  return g;
}
