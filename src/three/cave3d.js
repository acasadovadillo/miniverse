// Cuevas y mazmorras en 3D (las escenas de rejilla del juego): el suelo según el estilo (cueva, hielo o
// templo), paredes de roca irregular (o de sillares en los templos) en las casillas de pared que dan a un
// suelo, y lo que hay dentro: vetas de mineral, cristales que brillan, escaleras para subir y bajar, cofres,
// rejas, palancas, placas, bloques que se empujan y antorchas. Las paredes que quedan entre la cámara y el
// jugador se abren (no se pintan) para que siempre se le vea.
import * as THREE from 'three';
import { mat } from './geo.js';
import { stone, flagstone } from './textures.js';
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
    if (!scene.walls) scene.prepare?.();
    this.cut = { player: { value: new THREE.Vector3() }, toCam: { value: new THREE.Vector2(0, 1) } };
    this.build();
    this.items = null; this.sig = '';
    this.lightList = []; this.flameList = [];
  }
  build() {
    const sc = this.sc, st = STYLE[sc.style] || STYLE.cave, temple = sc.style === 'temple';
    // Suelo
    const ftex = temple ? flagstone() : stone(st.floor);
    ftex.repeat.set(sc.w / (temple ? 1 : 2), sc.h / (temple ? 1 : 2));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(sc.w, sc.h).rotateX(-Math.PI / 2), mat({ map: ftex, roughness: 0.95 }));
    floor.position.set(sc.w / 2, 0, sc.h / 2); floor.receiveShadow = true;
    this.group.add(floor);
    // Paredes: en la cueva, rocas irregulares; en el templo, bloques de sillares
    const walls = [];
    for (let ty = 0; ty < sc.h; ty++) for (let tx = 0; tx < sc.w; tx++) {
      if (!sc.wall(tx, ty)) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => !sc.wall(tx + dx, ty + dy) && tx + dx >= 0 && ty + dy >= 0 && tx + dx < sc.w && ty + dy < sc.h);
      if (edge) walls.push([tx, ty]);
    }
    const wallMat = this.cutaway(temple ? mat({ map: stone(st.wall), roughness: 0.9 }) : mat({ color: st.wall, flatShading: true, roughness: 0.95 }));
    const o = new THREE.Object3D(), rnd = (x, y, k) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(k, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    if (temple) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 2.6, 1).translate(0, 1.3, 0), wallMat, walls.length);
      walls.forEach(([x, y], i) => { o.position.set(x + 0.5, 0, y + 0.5); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.castShadow = im.receiveShadow = true; this.group.add(im);
      const cap = new THREE.InstancedMesh(new THREE.BoxGeometry(1.04, 0.2, 1.04), this.cutaway(mat({ color: st.top })), walls.length);
      walls.forEach(([x, y], i) => { o.position.set(x + 0.5, 2.7, y + 0.5); o.updateMatrix(); cap.setMatrixAt(i, o.matrix); });
      this.group.add(cap);
    } else {
      // (dos hileras de rocas, de 1,7 m: con la cámara alta no tapan; si tapan, se abren)
      const geo = new THREE.DodecahedronGeometry(0.85, 0), im = new THREE.InstancedMesh(geo, wallMat, walls.length * 2);
      let n = 0;
      for (const [x, y] of walls) for (let k = 0; k < 2; k++) {
        o.position.set(x + 0.5 + (rnd(x, y, k) - 0.5) * 0.3, 0.45 + k * 0.75 + rnd(x, y, k + 9) * 0.15, y + 0.5 + (rnd(x, y, k + 3) - 0.5) * 0.3);
        o.rotation.set(rnd(x, y, k + 5) * 6, rnd(x, y, k + 6) * 6, 0); const s = 0.8 + rnd(x, y, k + 7) * 0.3; o.scale.set(s, s * (k ? 0.75 : 0.95), s);
        o.updateMatrix(); im.setMatrixAt(n++, o.matrix);
        im.setColorAt(n - 1, new THREE.Color(st.wall).multiplyScalar(0.8 + rnd(x, y, k + 8) * 0.35));
      }
      im.count = n; im.castShadow = im.receiveShadow = true;
      this.group.add(im);
      if (sc.style === 'ice') {
        const snow = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.6, 0), this.cutaway(mat({ color: '#f4fbff' })), walls.length);
        walls.forEach(([x, y], i) => { o.position.set(x + 0.5, 1.75, y + 0.5); o.rotation.set(0, i, 0); o.scale.set(0.9, 0.35, 0.9); o.updateMatrix(); snow.setMatrixAt(i, o.matrix); });
        this.group.add(snow);
      }
    }
    // Fuera de la cueva, negro
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#030304' }));
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
    this.cut.toCam.value.set(Math.sin(CAM.yaw), Math.cos(CAM.yaw));
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
    for (const o of live) {
      const x = o.x, z = o.y;
      if (o.kind?.startsWith('veta_')) {
        const ore = o.kind.slice(5), rock = add(new THREE.Mesh(VEIN.rock, VEIN.rockMat), x, 0.42, z);
        rock.rotation.set(0.3, x * 3, 0.2); rock.scale.set(0.62, 0.5, 0.55);
        const gm = oreMat(ore);
        for (let i = 0; i < 7; i++) { const a = i * 0.9 + x, r = i < 2 ? 0.12 : 0.36, c = add(new THREE.Mesh(VEIN.gem, gm), x + Math.cos(a) * r, i < 2 ? 0.82 : 0.45 + (i % 3) * 0.14, z + Math.sin(a) * r * 0.9); c.scale.setScalar(0.1 + (i % 2) * 0.05); c.rotation.set(i, a, 0); }
      } else if (o.shine) {
        const cm = crystalMat(o.color || '#7ae0ff');
        for (let i = 0; i < 5; i++) { const a = i * 1.25, c = add(new THREE.Mesh(VEIN.prism, cm), x + Math.cos(a) * 0.14 * (i ? 1 : 0), 0, z + Math.sin(a) * 0.14 * (i ? 1 : 0)); c.scale.set(0.09, 0.35 + ((i * 7) % 5) * 0.12, 0.09); c.rotation.set(Math.cos(a) * 0.35 * (i ? 1 : 0), 0, Math.sin(a) * 0.35 * (i ? 1 : 0)); }
        this.lightList.push({ x, y: 0.8, z, color: o.color || '#7ae0ff', intensity: 2.2, range: 6, always: true });
      } else if (o.ladder) {
        if (o.ladder === 'down') add(new THREE.Mesh(new THREE.CircleGeometry(0.45, 20).rotateX(-Math.PI / 2), modelMat('dark0')), x, 0.01, z);
        const lad = ladder(o.ladder === 'down'); lad.position.set(x, o.ladder === 'down' ? -0.6 : 0, z); g.add(lad);
        if (o.ladder === 'up') this.lightList.push({ x, y: 2.5, z, color: '#bcd8ff', intensity: 2, range: 6, always: true });
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
        add(new THREE.Mesh(new THREE.BoxGeometry(0.8, on ? 0.02 : 0.08, 0.8), modelMat(on ? 'gold' : 'templeD')), x, on ? 0.01 : 0.04, z);
      } else if (o.block) add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), modelMat('templeD')), x, 0.45, z);
      else if (o.placed) put(o.placed, x, z);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(g);
  }
  lights() { return this.lightList.slice(); }
  flames() { return this.flameList; }
}

const VEIN = { rock: new THREE.DodecahedronGeometry(1, 0), gem: new THREE.OctahedronGeometry(1, 0), prism: new THREE.CylinderGeometry(0.6, 1, 1, 6).translate(0, 0.5, 0), rockMat: mat({ color: '#7e786e', flatShading: true }) };
const OREM = new Map(), CRYM = new Map();
const oreMat = ore => { if (!OREM.has(ore)) OREM.set(ore, mat({ color: ORE[ore] || '#ffffff', metalness: ['cobre', 'hierro', 'oro'].includes(ore) ? 0.7 : 0.1, roughness: 0.3, emissive: ['amatista', 'esmeralda', 'rubi', 'diamante'].includes(ore) ? ORE[ore] : '#000000', emissiveIntensity: 0.4 })); return OREM.get(ore); };
const crystalMat = c => { if (!CRYM.has(c)) CRYM.set(c, mat({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.1, transparent: true, opacity: 0.9 })); return CRYM.get(c); };
function ladder(down) {
  const g = new THREE.Group(), w = modelMat('wood'), h = down ? 1.4 : 3.2;
  for (const x of [-0.25, 0.25]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), w); r.position.set(x, h / 2, 0); g.add(r); }
  for (let y = 0.25; y < h; y += 0.32) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.05), w); r.position.set(0, y, 0); g.add(r); }
  g.rotation.x = down ? 0 : -0.25;
  return g;
}
function gateModel() {
  const g = new THREE.Group(), m = modelMat('iron');
  for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 6), m); b.position.set(-0.42 + i * 0.17, 1.25, 0); g.add(b); }
  for (const y of [0.3, 1.3, 2.3]) { const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.06), m); b.position.set(0, y, 0); g.add(b); }
  return g;
}
function leverModel(on) {
  const g = new THREE.Group(), base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.3), modelMat('templeD')), arm = new THREE.Group();
  base.position.y = 0.09; g.add(base);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), modelMat('iron')); stick.position.y = 0.3; arm.add(stick);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), modelMat('red')); knob.position.y = 0.6; arm.add(knob);
  arm.position.y = 0.18; arm.rotation.z = on ? -0.7 : 0.7; g.add(arm);
  return g;
}
