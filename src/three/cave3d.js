// Cuevas y mazmorras en 3D (las escenas de rejilla del juego): el suelo según el estilo (cueva, hielo o
// templo), paredes de roca irregular (o de sillares en los templos) en las casillas de pared que dan a un
// suelo, y lo que hay dentro: vetas de mineral, cristales que brillan, escaleras para subir y bajar, cofres,
// rejas, palancas, placas, bloques que se empujan y antorchas. Las paredes que quedan entre la cámara y el
// jugador se abren (no se pintan) para que siempre se le vea.
// The natural caves and the mines of now (world/cavegen.js, plan R7-5) add: a vault as high as each tile's ceiling (with the
// walls up to it, seen in first person), pools and lakes (their bed sunk and the water over it), steep slopes, a shaft of
// daylight from a hole far above, the daylight at the mouth, the pit with its rope, and in mines the timber sets, the rails
// of planks and the ladder shaft's collar. What changes with the hour (the daylight) is set in update.
import * as THREE from 'three';
import { mat as mat0, rockGeo } from './geo.js';
import { stone, flagstone, rockFace, wood } from './textures.js';
import { WATER_Y } from '../world/planet.js';
import { getModel, modelMat } from './models.js';
import { CAM } from '../camera.js';

const STYLE = {
  cave: { floor: '#6a6058', wall: '#9a8e80', top: '#3a342e' },
  ice: { floor: '#a8c8dc', wall: '#bcd8ea', top: '#e8f4fa' },
  temple: { floor: '#a89a80', wall: '#b8aa8a', top: '#6a604e' },
  mine: { floor: '#5e564c', wall: '#8a8074', top: '#34302a' },
};
const ROW = 0.82;   // (the height of one row of wall rocks)
const DAY_SKY = new THREE.Color('#e6eefa'), NIGHT_SKY = new THREE.Color('#1a2238'), DAY_LIGHT = new THREE.Color('#fff1dc'), NIGHT_LIGHT = new THREE.Color('#8a9ccc');
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
  // (the bed of the water on a tile corner: level with the floor where any tile round it is dry)
  bedAt(cx, cz) {
    const sc = this.sc, P = sc.pool;
    let sum = 0;
    for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const tx = cx + dx, tz = cz + dz; const d = tx < 0 || tz < 0 || tx >= sc.w || tz >= sc.h ? 0 : P[tz * sc.w + tx]; if (!d) return 0; sum += d; }
    return WATER_Y - sum / 40;
  }
  // The vault over (x, z): the tiles' ceilings round it, smoothly (2.5 m in the caves of before), with the hole of the shaft
  vaultY(x, z) {
    const sc = this.sc;
    if (!sc.ceil) return 2.5;
    const fx = x - 0.5, fz = z - 0.5, x0 = Math.floor(fx), z0 = Math.floor(fz), u = fx - x0, v = fz - z0, c = (a, b) => sc.ceilAt(Math.max(0, Math.min(sc.w - 1, a)), Math.max(0, Math.min(sc.h - 1, b)));
    return (c(x0, z0) * (1 - u) + c(x0 + 1, z0) * u) * (1 - v) + (c(x0, z0 + 1) * (1 - u) + c(x0 + 1, z0 + 1) * u) * v;
  }
  // The lowest the ground goes round a wall tile (a pool's bed, a slope): its rocks go down that far
  lowAt(tx, tz) {
    const sc = this.sc;
    let lo = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, z = tz + dz;
      if (x < 0 || z < 0 || x >= sc.w || z >= sc.h || sc.wall(x, z)) continue;
      if (sc.pool?.[z * sc.w + x]) lo = Math.min(lo, WATER_Y - sc.pool[z * sc.w + x] / 10);
      if (sc.floorY) lo = Math.min(lo, sc.floorY(x + 0.5, z + 0.5), sc.floorY(x + 0.5 - dx * 0.5, z + 0.5 - dz * 0.5));
    }
    return lo;
  }
  build() {
    const sc = this.sc, st = STYLE[sc.style] || STYLE.cave, temple = sc.style === 'temple';
    const G = g => (this.ownGeo.add(g), g), mat = o => { const m = mat0(o); this.ownMat.add(m); return m; };
    // Suelo
    const ftex = temple ? flagstone() : rockFace(st.floor);   // (en la cueva, roca, sin sillares)
    ftex.repeat.set(sc.w / (temple ? 1 : 2), sc.h / (temple ? 1 : 2));
    const shaped = !!(sc.pool || sc.ramps?.length);   // (water or slopes: the floor is made tile by tile, with holes and slopes)
    this.fixed = [];   // (the lights that are always there: the daylight of the mouth and of the shaft)
    if (!shaped) {
      const floor = new THREE.Mesh(G(new THREE.PlaneGeometry(sc.w, sc.h).rotateX(-Math.PI / 2)), mat({ map: ftex, roughness: 0.95 }));
      floor.position.set(sc.w / 2, 0, sc.h / 2); floor.receiveShadow = true;
      this.group.add(floor);
    } else this.shapedFloor(G, mat, ftex);
    // Paredes: en la cueva, rocas irregulares; en el templo, bloques de sillares
    const walls = [], mouths = (sc.items || []).filter(o => o.mouth).map(o => o.tile);
    // (the edge in front of a mouth is the open air: no rocks there, the daylight is seen through it)
    const atMouth = (tx, ty) => mouths.some(([mx, my]) => (ty === sc.h - 1 && my >= sc.h - 2 && Math.abs(tx - mx) <= 1) || (tx === 0 && mx <= 1 && ty >= my - 1 && ty <= my + 2));
    for (let ty = 0; ty < sc.h; ty++) for (let tx = 0; tx < sc.w; tx++) {
      if (!sc.wall(tx, ty) || atMouth(tx, ty)) continue;
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
      // (a cave of now: rows down to a pool's bed or a slope beside it, and, over 2.6 m, up to its vault: those only seen in
      // first person, with the vault)
      const rm = this.cutaway(mat({ map: rockFace(), flatShading: true, roughness: 0.95 })), lists = [[], [], []], high = [[], [], []], deep = !!(sc.pool || sc.ramps?.length);
      for (const [x, y] of walls) {
        const k0 = deep ? Math.min(0, Math.floor(this.lowAt(x, y) / ROW)) : 0;
        let top = 3;
        if (sc.ceil) { let v = 0; for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) v = Math.max(v, this.vaultY(x + a, y + b)); top = Math.max(3, Math.ceil((v - 0.05) / ROW)); }
        for (let k = k0; k < top; k++) {
          const s = 0.72 + rnd(x, y, k + 7) * 0.3, kk = Math.max(0, Math.min(2, k));
          (k >= 3 ? high : lists)[Math.floor(rnd(x, y, k + 11) * 3)].push([x + 0.5 + (rnd(x, y, k) - 0.5) * 0.3, 0.2 + k * ROW + rnd(x, y, k + 9) * 0.12, y + 0.5 + (rnd(x, y, k + 3) - 0.5) * 0.3, rnd(x, y, k + 6) * 6, s, s * [1.05, 0.95, 0.85][kk], 0.8 + rnd(x, y, k + 8) * 0.35]);
        }
      }
      this.highRocks = [];
      const rocks = (L, where) => L.forEach((list, v) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(G(rockGeo(v + 1)), rm, list.length);
        list.forEach(([px, py, pz, ry, s, sy, c], i) => { o.position.set(px, py, pz); o.rotation.set((c - 1) * 0.6, ry, 0); o.scale.set(s, sy, s); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, new THREE.Color(st.wall).multiplyScalar(c * 1.15)); });
        im.castShadow = im.receiveShadow = true; where.push(im);
      });
      const low = []; rocks(lists, low); rocks(high, this.highRocks);
      for (const m of low) this.group.add(m);
      if (sc.style === 'ice') {
        const snow = new THREE.InstancedMesh(G(new THREE.DodecahedronGeometry(0.6, 0)), this.cutaway(mat({ color: '#f4fbff' })), walls.length);
        walls.forEach(([x, y], i) => { o.position.set(x + 0.5, 2.55, y + 0.5); o.rotation.set(0, i, 0); o.scale.set(0.9, 0.3, 0.9); o.updateMatrix(); snow.setMatrixAt(i, o.matrix); });
        this.group.add(snow);
      }
    }
    // El techo: una bóveda de roca irregular sobre todo, con estalactitas colgando donde se anda (en el hielo,
    // carámbanos; en el templo, losas lisas). Solo en primera persona: desde arriba taparía la cueva (ver update)
    const H = temple ? 2.8 : 2.5, n = 2, geo = G(new THREE.PlaneGeometry(sc.w + 2, sc.h + 2, (sc.w + 2) * n, (sc.h + 2) * n).rotateX(Math.PI / 2)), p = geo.attributes.position;
    const S = sc.shaft, hole = (x, z) => (S ? Math.max(0, 1 - Math.max(0, Math.hypot(x - S.x, z - S.y) - 0.9) / 0.7) : 0);   // (1 in the shaft's hole, 0 beyond its funnel)
    if (!temple) for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), wx = x + sc.w / 2, wz = z + sc.h / 2; p.setY(i, (rnd(Math.round(x * 4), Math.round(z * 4), 21) - 0.5) * 0.35 + Math.sin(x * 0.9) * Math.cos(z * 0.7) * 0.18 + (sc.ceil ? this.vaultY(wx, wz) - H : 0) + hole(wx, wz) * 7); }
    geo.computeVertexNormals();
    const tex = temple ? flagstone() : rockFace(sc.style === 'ice' ? '#cfe0ea' : st.wall); tex.repeat.set((sc.w + 2) / 2, (sc.h + 2) / 2);
    const ceil = new THREE.Mesh(geo, mat({ map: tex, flatShading: !temple, roughness: 0.95, color: temple ? '#b8aa8a' : '#cfc8c0', emissive: temple ? '#2e2a22' : '#2e2820', emissiveMap: tex }));   // (un poco de luz propia: por debajo no le da el sol de la cueva)
    ceil.position.set(sc.w / 2, H, sc.h / 2); ceil.receiveShadow = true;
    const roof = new THREE.Group(); roof.add(ceil);
    if (!temple) {
      const list = [];
      for (let ty = 0; ty < sc.h; ty++) for (let tx = 0; tx < sc.w; tx++) {
        if (sc.wall(tx, ty) || sc.mine || (S && Math.hypot(tx + 0.5 - S.x, ty + 0.5 - S.y) < 2)) continue;
        for (let k = 0; k < 3; k++) if (rnd(tx, ty, 30 + k) < (sc.ceil && sc.ceilAt(tx, ty) > 3.2 ? 0.3 : 0.16)) list.push([tx + 0.15 + rnd(tx, ty, 40 + k) * 0.7, ty + 0.15 + rnd(tx, ty, 50 + k) * 0.7, 0.04 + rnd(tx, ty, 60 + k) * 0.09, 0.15 + rnd(tx, ty, 70 + k) * (sc.ceil && sc.ceilAt(tx, ty) > 3.2 ? 0.9 : 0.45)]);
      }
      const ice = sc.style === 'ice', cone = G(new THREE.ConeGeometry(1, 1, 7).rotateX(Math.PI).translate(0, -0.5, 0));
      const im = new THREE.InstancedMesh(cone, ice ? mat({ color: '#d8ecf6', roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.85 }) : mat({ map: rockFace(st.wall), flatShading: true, roughness: 0.9 }), Math.max(1, list.length));
      list.forEach(([x, z, r, l], i) => { o.position.set(x, (sc.ceil ? this.vaultY(x, z) : H) + 0.08, z); o.rotation.set(0, i, 0); o.scale.set(r, l, r); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.count = list.length; roof.add(im);
    }
    for (const m of this.highRocks || []) roof.add(m);
    roof.visible = false;
    this.roof = roof; this.group.add(roof);
    this.extras(G, mat, roof);
    // Fuera de la cueva, negro (under the deepest water or slope, when there is some)
    const dark = new THREE.Mesh(G(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: '#030304' }));
    this.ownMat.add(dark.material);
    dark.position.set(sc.w / 2, shaped ? -3.2 : -0.02, sc.h / 2);
    this.group.add(dark);
  }
  // The floor tile by tile: none under the water (its bed is lower, and the water over it), and sloping on a slope
  shapedFloor(G, mat, ftex) {
    const sc = this.sc, W = sc.w, H = sc.h, P = sc.pool, fy = sc.floorY || (() => 0), pos = [], uv = [], bed = [], bedUv = [], water = [];
    const quad = (out, ouv, x, z, y00, y10, y01, y11) => {
      out.push(x, y00, z, x, y01, z + 1, x + 1, y10, z, x + 1, y10, z, x, y01, z + 1, x + 1, y11, z + 1);
      ouv.push(x / W, 1 - z / H, x / W, 1 - (z + 1) / H, (x + 1) / W, 1 - z / H, (x + 1) / W, 1 - z / H, x / W, 1 - (z + 1) / H, (x + 1) / W, 1 - (z + 1) / H);
    };
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (P?.[z * W + x]) {
        quad(bed, bedUv, x, z, this.bedAt(x, z), this.bedAt(x + 1, z), this.bedAt(x, z + 1), this.bedAt(x + 1, z + 1));
        quad(water, [], x, z, WATER_Y, WATER_Y, WATER_Y, WATER_Y);
      } else quad(pos, uv, x, z, fy(x, z), fy(x + 1, z), fy(x, z + 1), fy(x + 1, z + 1));
    }
    const mesh = (p, u, m) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); if (u) g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); g.computeVertexNormals(); const me = new THREE.Mesh(G(g), m); me.receiveShadow = true; this.group.add(me); return me; };
    mesh(pos, uv, mat({ map: ftex, roughness: 0.95 }));
    if (bed.length) {
      const t2 = rockFace(this.sc.style === 'ice' ? '#9ab8c8' : '#5c544a'); t2.repeat.copy(ftex.repeat);
      mesh(bed, bedUv, mat({ map: t2, roughness: 0.6, color: '#b8b0a4' }));
      // (still water, dark and clear, that gives back the torches; deeper looks darker through it)
      const w = mesh(water, null, mat({ color: this.sc.style === 'ice' ? '#284c5c' : '#12303a', roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.8, depthWrite: false }));
      w.receiveShadow = false; w.renderOrder = 2;
    }
    // (the far end of a slope: the dark where it goes on)
    for (const R of sc.ramps || []) {
      const m = new THREE.Mesh(G(new THREE.PlaneGeometry(3, 3.4)), new THREE.MeshBasicMaterial({ color: '#020203' }));
      this.ownMat.add(m.material);
      const ex = R.x + R.dx * (R.len + 0.55), ez = R.y + R.dy * (R.len + 0.55);
      m.position.set(ex, R.sign * R.len * 0.5 + 1.2, ez); m.rotation.y = Math.atan2(-R.dx, -R.dy);
      this.group.add(m);
    }
  }
  // What a cave of now has besides its floor, walls and vault: the daylight at the mouth and down the shaft, the rope's hole in
  // the vault, the guano and the bones of its end; in a mine, the timber sets and the rails
  extras(G, mat, roof) {
    const sc = this.sc, o = new THREE.Object3D();
    const basic = opts => { const m = new THREE.MeshBasicMaterial(opts); this.ownMat.add(m); return m; };
    for (const it of sc.items || []) {
      if (it.mouth) {
        // (the open air: bright by day, dark blue by night, and its light falling inside)
        const south = it.tile[1] >= sc.h - 2, m = new THREE.Mesh(G(new THREE.PlaneGeometry(south ? 3.4 : 2.6, 3)), basic({ color: '#e6eefa', fog: false }));
        if (south) m.position.set(it.tile[0] + 0.5, 1.4, sc.h - 0.96); else { m.position.set(0.96, 1.4, it.tile[1] + 1); m.rotation.y = Math.PI / 2; }
        if (south) m.rotation.y = Math.PI;
        this.group.add(m); (this.skies ||= []).push(m.material);
        this.fixed.push({ x: south ? it.x : 1.8, y: 1.9, z: south ? sc.h - 1.8 : it.y, color: '#fff1dc', intensity: 4, range: 11, always: true, halo: 0, day: [0.4, 4.6] });
      }
      if (it.rope === 'up') { const h = new THREE.Mesh(G(new THREE.CircleGeometry(0.5, 16).rotateX(Math.PI / 2)), basic({ color: '#020203' })); h.position.set(it.x, this.vaultY(it.x, it.y) - 0.02, it.y); roof.add(h); }
    }
    const S = sc.shaft;
    if (S) {
      const top = this.vaultY(S.x, S.y) + 7;
      const sky = new THREE.Mesh(G(new THREE.CircleGeometry(1.1, 20).rotateX(Math.PI / 2)), basic({ color: '#e6eefa', fog: false }));
      sky.position.set(S.x, top - 0.2, S.y); roof.add(sky); (this.skies ||= []).push(sky.material);
      // (the column of light, brighter high up, and the patch it lights on the floor, with moss round it)
      const cyl = new THREE.CylinderGeometry(0.95, 1.3, top, 18, 1, true).translate(0, top / 2, 0), cp = cyl.attributes.position, col = new Float32Array(cp.count * 4);
      for (let i = 0; i < cp.count; i++) { const k = cp.getY(i) / top; col.set([1, 0.97, 0.9, 0.35 + 0.65 * k], i * 4); }
      cyl.setAttribute('color', new THREE.BufferAttribute(col, 4));
      this.beam = basic({ vertexColors: true, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const beam = new THREE.Mesh(G(cyl), this.beam); beam.position.set(S.x, 0, S.y); this.group.add(beam);
      const moss = new THREE.Mesh(G(new THREE.CircleGeometry(2.1, 24).rotateX(-Math.PI / 2)), mat({ color: '#4c6230', roughness: 1, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      moss.position.set(S.x, 0.012, S.y); this.group.add(moss);
      this.patch = basic({ color: '#fff0d4', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
      const pool = new THREE.Mesh(G(new THREE.CircleGeometry(1.3, 24).rotateX(-Math.PI / 2)), this.patch); pool.position.set(S.x, 0.02, S.y); this.group.add(pool);
      this.fixed.push({ x: S.x, y: 3.4, z: S.y, color: '#eef3ff', intensity: 6, range: 9.5, always: true, halo: 0, day: [0.15, 6.5] });
    }
    // The end of a cave: bat guano under the roost, the bones of a den
    const decor = sc.decor || [];
    const guano = decor.filter(d => d.kind === 'guano');
    if (guano.length) {
      const im = new THREE.InstancedMesh(G(new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2)), mat({ color: '#6e624e', roughness: 1, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }), guano.length);
      guano.forEach((d, i) => { o.position.set(d.x, 0.01 + i * 0.0005, d.y); o.rotation.set(0, i, 0); o.scale.set(d.s * 0.55, 1, d.s * 0.4); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.receiveShadow = true; this.group.add(im);
    }
    const bones = decor.filter(d => d.kind === 'bone' || d.kind === 'den');
    if (bones.length) {
      const ivory = mat({ color: '#d6cbb2', roughness: 0.75 }), shaft = G(new THREE.CylinderGeometry(0.022, 0.026, 0.42, 6).rotateZ(Math.PI / 2)), knob = G(new THREE.SphereGeometry(0.04, 6, 5)), skull = G(new THREE.SphereGeometry(0.13, 10, 8));
      const add = (geo, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, ivory); m.position.set(x, y, z); m.rotation.y = ry; m.scale.set(sx, sy, sz); m.castShadow = m.receiveShadow = true; this.group.add(m); };
      const bone = (x, z, ry, s) => { add(shaft, x, 0.03, z, ry, s, 1, 1); for (const e of [-1, 1]) add(knob, x + Math.cos(ry) * 0.21 * s * e, 0.035, z - Math.sin(ry) * 0.21 * s * e, 0, 1, 0.8, 1); };
      for (const d of bones) {
        if (d.kind === 'bone') { bone(d.x, d.y, d.yaw, d.s); continue; }
        add(skull, d.x, 0.11, d.y, d.yaw, 1, 0.82, 1.3);   // (a skull, a jaw and a heap of bones by a wall)
        add(G(new THREE.BoxGeometry(0.16, 0.04, 0.2)), d.x + Math.sin(d.yaw) * 0.12, 0.03, d.y + Math.cos(d.yaw) * 0.12, d.yaw);
        for (let i = 0; i < 7; i++) bone(d.x + Math.cos(i * 2.4) * (0.3 + i * 0.05), d.y + Math.sin(i * 2.4) * (0.3 + i * 0.05), i * 1.7 + d.yaw, 0.7 + (i % 3) * 0.2);
      }
    }
    // A mine: timber sets every 4 tiles (two posts, a cap and the lagging boards over it) and the rails of planks on sleepers
    if (sc.timbers?.length) {
      const tm = this.cutaway(mat({ map: wood('#5c4128'), roughness: 0.9 })), sets = [];
      for (const T of sc.timbers) {
        const ax = T.across === 'y', put = (x, y, z, w, h, d) => sets.push(ax ? [x, y, z, w, h, d] : [z - T.y + T.x, y, x - T.x + T.y, d, h, w]);
        // (along x: posts at y ± 0.86, the cap across y; along y, the same turned)
        put(T.x, 1.1, T.y - 0.86, 0.17, 2.2, 0.17); put(T.x, 1.1, T.y + 0.86, 0.17, 2.2, 0.17);
        put(T.x, 2.29, T.y, 0.19, 0.18, 2.05);
        for (const d of [-0.55, -0.18, 0.18, 0.55]) put(T.x, 2.41, T.y + d, 1.1, 0.05, 0.2);
      }
      const im = new THREE.InstancedMesh(G(new THREE.BoxGeometry(1, 1, 1)), tm, sets.length);
      sets.forEach(([x, y, z, w, h, d], i) => { o.position.set(x, y, z); o.rotation.set(0, 0, (i % 3 === 0 ? 0.02 : -0.015)); o.scale.set(w, h, d); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.castShadow = im.receiveShadow = true; this.group.add(im);
    }
    if (sc.rails) {
      const { y, x0, x1 } = sc.rails, parts = [];
      for (let x = x0; x < x1 - 0.3; x += 1) for (const d of [-0.32, 0.32]) parts.push([Math.min(x + 0.5, x1 - 0.5), 0.06, y + d, Math.min(1.02, x1 - x), 0.07, 0.07]);
      for (let x = x0 + 0.2; x < x1; x += 0.55) parts.push([x, 0.02, y, 0.13, 0.04, 0.92]);
      const im = new THREE.InstancedMesh(G(new THREE.BoxGeometry(1, 1, 1)), mat({ map: wood('#4a3622'), roughness: 0.95 }), parts.length);
      parts.forEach(([x, py, z, w, h, d], i) => { o.position.set(x, py, z); o.rotation.set(0, (i % 5 - 2) * 0.01, 0); o.scale.set(w, h, d); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.receiveShadow = true; this.group.add(im);
    }
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
    // (the daylight that comes in: from the hour, as outside)
    if (this.fixed?.length || this.skies) {
      const day = 1 - Math.max(0, Math.min(1, this.view.night ?? 0));
      if (day !== this.dayK) {
        this.dayK = day;
        for (const l of this.fixed) { l.intensity = l.day[0] + (l.day[1] - l.day[0]) * day; l.color = '#' + NIGHT_LIGHT.clone().lerp(DAY_LIGHT, day).getHexString(); }
        for (const m of this.skies || []) m.color.copy(NIGHT_SKY).lerp(DAY_SKY, day);
        if (this.beam) this.beam.opacity = 0.025 + 0.11 * day;
        if (this.patch) this.patch.opacity = 0.03 + 0.24 * day;
      }
    }
    if (p) this.cut.player.value.set(p.x, 0, p.y);
    if (this.roof) this.roof.visible = !!CAM.first;   // (el techo, solo desde dentro: desde arriba taparía todo)
    if (CAM.first) this.cut.toCam.value.set(0, 0);   // (en primera persona no se recortan las paredes)
    else this.cut.toCam.value.set(Math.sin(CAM.yaw), Math.cos(CAM.yaw));
    // Lo de dentro se rehace cuando cambia (una veta picada, un cofre abierto, una reja, una antorcha…)
    const live = this.sc.live(), st = this.sc.state;
    let sig = st.flags?.rope ? 'R' : '';
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
        // (a mine's shaft: a collar of four beams round the hole)
        if (o.shaft) for (const [dx, dz, w, d] of [[0, -0.58, 1.34, 0.17], [0, 0.58, 1.34, 0.17], [-0.58, 0, 0.17, 1.0], [0.58, 0, 0.17, 1.0]]) add(own(new THREE.BoxGeometry(w, 0.16, d)), x + dx, 0.08, z + dz).material = modelMat('wood');
        if (o.ladder === 'up' && !this.sc.mine) this.lightList.push({ x, y: 2.5, z, color: '#bcd8ff', intensity: 2, range: 6, always: true, halo: 0 });   // (la luz que baja por el agujero: sin halo, no es una lámpara; in a mine, none)
      } else if (o.pit) this.pit(g, add, own, x, z, !!st.flags?.rope);
      else if (o.rope === 'up') {
        const h = this.vaultY(x, z), r = add(own(new THREE.CylinderGeometry(0.022, 0.022, h, 6).translate(0, h / 2, 0)), x, 0, z);
        r.material = ROPE(); r.rotation.z = 0.03;
        const coil = add(own(new THREE.TorusGeometry(0.2, 0.035, 6, 18).rotateX(Math.PI / 2)), x + 0.18, 0.04, z + 0.1); coil.material = ROPE();
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
  // The pit at the end of a level: a dark hole with its rim of stones going down into the rock, and, tied, a stake with the rope
  pit(g, add, own, x, z, tied) {
    const V = vein();
    add(own(new THREE.CircleGeometry(0.72, 22).rotateX(-Math.PI / 2)), x, 0.012, z).material = modelMat('dark0');
    const wall = add(own(new THREE.CylinderGeometry(0.72, 0.55, 2.4, 16, 1, true).translate(0, -1.2, 0)), x, 0.01, z);
    wall.material = PIT();
    for (let i = 0; i < 8; i++) { const a = i * 0.785 + 0.3, s = add(new THREE.Mesh(V.rock, V.rockMat), x + Math.cos(a) * 0.86, 0.06, z + Math.sin(a) * 0.86); s.scale.set(0.16 + (i % 3) * 0.05, 0.12, 0.14 + (i % 2) * 0.05); s.rotation.y = a * 2; }
    if (!tied) return;
    const a = 0.6, sx = x + Math.cos(a) * 1.15, sz = z + Math.sin(a) * 1.15;
    const stake = add(own(new THREE.CylinderGeometry(0.045, 0.06, 0.62, 7).translate(0, 0.31, 0)), sx, 0, sz); stake.material = modelMat('wood'); stake.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    // (from the stake's head over the rim and down)
    const rim = [x + Math.cos(a) * 0.7, 0.04, z + Math.sin(a) * 0.7], head = [sx, 0.5, sz], seg = (p, q) => {
      const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], L = Math.hypot(dx, dy, dz), m = add(own(new THREE.CylinderGeometry(0.02, 0.02, L, 6)), (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
      m.material = ROPE(); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    };
    seg(head, rim); seg(rim, [rim[0] - Math.cos(a) * 0.06, -2.3, rim[2] - Math.sin(a) * 0.06]);
    add(own(new THREE.TorusGeometry(0.06, 0.02, 5, 10)), sx, 0.46, sz).material = ROPE();
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
  lights() { return this.fixed?.length ? this.fixed.concat(this.lightList) : this.lightList.slice(); }
  flames() { return this.flameList; }
}

// (las piezas de las vetas y los cristales, de todas las cuevas; la primera vez que hacen falta: con la foto ya aquí)
let VEIN;
const vein = () => (VEIN ||= { rock: rockGeo(2), gem: new THREE.OctahedronGeometry(1, 0), prism: new THREE.CylinderGeometry(0.6, 1, 1, 6).translate(0, 0.5, 0), rockMat: mat0({ map: rockFace('#8e887e'), flatShading: true, roughness: 0.95 }) });
const OREM = new Map(), CRYM = new Map();
const oreMat = ore => { if (!OREM.has(ore)) OREM.set(ore, mat0({ color: ORE[ore] || '#ffffff', metalness: ['cobre', 'hierro', 'oro'].includes(ore) ? 0.7 : 0.1, roughness: 0.3, emissive: ['amatista', 'esmeralda', 'rubi', 'diamante'].includes(ore) ? ORE[ore] : '#000000', emissiveIntensity: 0.4 })); return OREM.get(ore); };
let ROPE_M, PIT_M;
const ROPE = () => (ROPE_M ||= mat0({ color: '#9a7a4c', roughness: 0.95 }));
const PIT = () => (PIT_M ||= mat0({ map: rockFace('#5a544c'), roughness: 1, side: THREE.BackSide, color: '#7a7268' }));
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
