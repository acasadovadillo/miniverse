// Prototipo 3D: Pueblo Brotes con los mismos datos que el juego (village.js, blueprints.js y el generador del
// mundo): terreno con los colores de cada bioma, el camino de tierra, el estanque con su orilla de arena,
// piedras y nenúfares, el agua, la valla del jardín, las casas, el puesto, el tablón, la vitrina, el buzón,
// la farola, el cartel y toda la vegetación de alrededor.
import * as THREE from 'three';
import * as V from '../world/village.js';
import { WorldGen, WORLD_SEED, CHUNK } from '../world/gen.js';
import { B, BIOMES } from '../world/biomes.js';
import { houseBlueprint, houseSize } from '../world/blueprints.js';
import { ihash, vnoise, smoothstep } from '../util.js';
import { buildHouse } from './houses.js';
import { buildNature, buildGround } from './nature.js';
import { Builder, mat } from './geo.js';
import { grassDetail, soilDetail, awning, notes, wood, stone, rng } from './textures.js';

export const AREA = { x0: -26, z0: -22, x1: 70, z1: 90 };   // lo que se construye (la niebla tapa el borde)
export const WATER_Y = -0.14;
const S = WORLD_SEED;

// Altura del terreno: llano en el pueblo, el estanque hundido y lomas suaves más allá
export function heightAt(x, z) {
  const pd = V.pondDist(x, z);
  let y = 0;
  if (pd < 1.35) y = pd < 1 ? -0.62 * (1 - pd * pd) - 0.06 : -0.06 * (1 - (pd - 1) / 0.35);
  const out = Math.max(0, Math.max(V.BOUNDS.x0 - x, x - V.BOUNDS.x1, V.BOUNDS.y0 - z, z - V.BOUNDS.y1));
  const far = smoothstep(0, 14, out + 6 * V.clearing(x, z) - 6);
  y += far * (0.15 + vnoise(x * 0.06, z * 0.06, S + 3) * 2.6);
  return y;
}

const hexRGB = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(c => Math.pow(c, 2.2)); };
const DIRT = hexRGB('#c49a64'), DIRT_D = hexRGB('#a8804e'), SAND = hexRGB('#dcc791'), MUD = hexRGB('#8a7a5a');
const PAL = BIOMES.map(b => b.pal.map(hexRGB));
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Terreno: una malla de medio metro con color por vértice y cuánto tiene de tierra (para el detalle)
function buildTerrain(gen) {
  const step = 0.5, nx = Math.round((AREA.x1 - AREA.x0) / step) + 1, nz = Math.round((AREA.z1 - AREA.z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), soil = new Float32Array(nx * nz);
  const water = [];
  for (let j = 0, i = 0; j < nz; j++) {
    for (let k = 0; k < nx; k++, i++) {
      const x = AREA.x0 + k * step, z = AREA.z0 + j * step;
      let y = heightAt(x, z);
      // Color del bioma, con manchas suaves entre los cuatro tonos de su paleta
      const b = gen.biomeAt(x, z), pal = PAL[b] || PAL[B.MEADOW];
      const n1 = vnoise(x * 0.11, z * 0.11, S + 11), n2 = vnoise(x * 0.33, z * 0.33, S + 12);
      let c = mix3(mix3(pal[0], pal[1], n1), mix3(pal[2], pal[3], n2), smoothstep(0.35, 0.65, vnoise(x * 0.07, z * 0.07, S + 13)));
      let s = 0;
      if (BIOMES[b].water) { y = Math.min(y, -0.7); s = 0.6; water.push(1); }
      else if (b === B.BEACH || b === B.DESERT) s = 0.7;
      // Camino de tierra con el borde irregular, la entrada de casa y la orilla del estanque
      if (V.inBounds(x, z)) {
        const p = V.distToPath(x, z) + (vnoise(x * 0.6, z * 0.6, S + 14) - 0.5) * 0.35;
        const door = Math.hypot((x - 21.5) / 1.6, (z - 17.6) / 0.8);
        const t = Math.max(1 - smoothstep(0.62, 0.95, p), 1 - smoothstep(0.85, 1.1, door));
        if (t > 0) { c = mix3(c, mix3(DIRT, DIRT_D, n2 * 0.8), t); s = Math.max(s, t); }
        const pd = V.pondDist(x, z) + (n1 - 0.5) * 0.14;
        if (pd < 1.3) { const ts = 1 - smoothstep(1.12, 1.3, pd); c = mix3(c, pd < 1 ? mix3(MUD, SAND, smoothstep(0.6, 1, pd)) : SAND, ts); s = Math.max(s, ts); }
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      col.set(c, i * 3); soil[i] = s;
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let k = 0; k < nx - 1; k++) { const a = j * nx + k, b2 = a + 1, c2 = a + nx, d = c2 + 1; idx.push(a, c2, b2, b2, c2, d); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('soil', new THREE.BufferAttribute(soil, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Detalle: briznas sobre la hierba y piedrecitas sobre la tierra, a dos escalas para que no se note la repetición
  const m = mat({ vertexColors: true, roughness: 0.95 }), gd = grassDetail(), sd = soilDetail();
  m.onBeforeCompile = sh => {
    sh.uniforms.grassMap = { value: gd }; sh.uniforms.soilMap = { value: sd };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float soil;\nvarying float vSoil;\nvarying vec2 vWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSoil = soil;\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D grassMap;\nuniform sampler2D soilMap;\nvarying float vSoil;\nvarying vec2 vWorld;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float g1 = texture2D(grassMap, vWorld * 0.55).r / 0.85, g2 = texture2D(grassMap, vWorld * 0.13 + 0.37).r / 0.85;
        float s1 = texture2D(soilMap, vWorld * 0.6).r / 0.84;
        diffuseColor.rgb *= mix(mix(0.82, 1.12, g1) * mix(0.92, 1.06, g2), mix(0.85, 1.12, s1), vSoil);`);
  };
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true;
  return mesh;
}

// Agua: un plano a la altura del estanque que solo asoma donde el terreno está más bajo, con ondas suaves
function buildWater() {
  const geo = new THREE.PlaneGeometry(AREA.x1 - AREA.x0, AREA.z1 - AREA.z0, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate((AREA.x0 + AREA.x1) / 2, WATER_Y, (AREA.z0 + AREA.z1) / 2);
  const m = new THREE.MeshStandardMaterial({ color: '#3f8fd0', roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.78 });
  const uniforms = { time: { value: 0 } };
  m.onBeforeCompile = sh => {
    sh.uniforms.time = uniforms.time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float time;\nvarying vec2 vW;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 q = vW * 1.7;
        float w1 = sin(q.x * 1.3 + time * 1.1) * cos(q.y * 1.1 - time * 0.8), w2 = sin((q.x + q.y) * 2.3 - time * 1.7);
        normal = normalize(normal + (mat3(viewMatrix) * vec3(w1 * 0.06 + w2 * 0.03, 0.0, w2 * 0.05 - w1 * 0.03)));`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sp = sin(vW.x * 3.1 + time * 0.9) * sin(vW.y * 2.7 - time * 0.7);
        diffuseColor.rgb += vec3(0.05, 0.07, 0.08) * smoothstep(0.75, 1.0, sp);`);
  };
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  return { mesh, uniforms };
}

// Valla de madera del jardín: postes en cada casilla del anillo y dos travesaños, con hueco en la entrada
function buildFence() {
  const Y = V.YARD, G = [20, 22], posts = [], rails = [], colliders = [];
  const x0 = Y.x0 + 0.5, x1 = Y.x1 - 0.5, z0 = Y.y0 + 0.5, z1 = Y.y1 - 0.5;
  // Tramos (de poste a poste): arriba, abajo (en dos, por la entrada) y los lados
  const runs = [[[x0, z0], [x1, z0]], [[x0, z1], [G[0] - 0.5, z1]], [[G[1] + 0.5, z1], [x1, z1]], [[x0, z0], [x0, z1]], [[x1, z0], [x1, z1]]];
  const seen = new Set();
  for (const [a, b] of runs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.round(L), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    for (let i = 0; i <= n; i++) {
      const x = a[0] + dx * i, z = a[1] + dz * i, k = `${x},${z}`;
      if (!seen.has(k)) { seen.add(k); posts.push([x, z]); }
    }
    rails.push({ a, b, yaw: Math.atan2(dx, dz), L });
    colliders.push({ x0: Math.min(a[0], b[0]) - 0.08, x1: Math.max(a[0], b[0]) + 0.08, z0: Math.min(a[1], b[1]) - 0.08, z1: Math.max(a[1], b[1]) + 0.08 });
  }
  const wd = wood('#9a6a40'), g = new THREE.Group(), bp = new Builder(), br = new Builder();
  for (const [x, z] of posts) {
    const s = (ihash(Math.round(x * 2), Math.round(z * 2), 7) - 0.5) * 0.06;
    bp.box(x - 0.055, 0, z - 0.055, x + 0.055, 0.92 + s, z + 0.055, { s: 0.5 });
    bp.box(x - 0.07, 0.92 + s, z - 0.07, x + 0.07, 0.96 + s, z + 0.07, { s: 0.5 });
  }
  for (const { a, b } of rails) {
    const X = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
    for (const y of [0.36, 0.72]) {
      if (X) br.box(Math.min(a[0], b[0]), y, a[1] + 0.055, Math.max(a[0], b[0]), y + 0.1, a[1] + 0.09, { s: 0.5 }), br.box(Math.min(a[0], b[0]), y, a[1] - 0.09, Math.max(a[0], b[0]), y + 0.1, a[1] - 0.055, { s: 0.5 });
      else br.box(a[0] + 0.055, y, Math.min(a[1], b[1]), a[0] + 0.09, y + 0.1, Math.max(a[1], b[1]), { s: 0.5 }), br.box(a[0] - 0.09, y, Math.min(a[1], b[1]), a[0] - 0.055, y + 0.1, Math.max(a[1], b[1]), { s: 0.5 });
    }
  }
  g.add(bp.mesh(mat({ map: wd })), br.mesh(mat({ map: wd, color: '#e8d8c8' })));
  return { group: g, colliders };
}

// Objetos del pueblo
function buildProps() {
  const g = new THREE.Group(), colliders = [], lamps = [];
  const W = wood('#8a5a34'), WD = wood('#5e3b22'), ST = stone('#a8a296');
  const mw = mat({ map: W }), md = mat({ map: WD }), ms = mat({ map: ST });
  // Puesto de Rosa: mostrador, postes, toldo a rayas y cajas de fruta
  {
    const s = V.STALL, b = new Builder(), d = new Builder(), cx = (s.x0 + s.x1) / 2, cz = (s.y0 + s.y1) / 2;
    b.box(s.x0 + 0.1, 0, cz - 0.1, s.x1 - 0.1, 0.9, cz + 0.4, { s: 0.5 });
    d.box(s.x0 + 0.05, 0.9, cz - 0.15, s.x1 - 0.05, 0.98, cz + 0.45, { s: 0.5 });
    for (const x of [s.x0 + 0.12, s.x1 - 0.12]) for (const z of [cz - 0.42, cz + 0.42]) d.box(x - 0.05, 0, z - 0.05, x + 0.05, 2.2, z + 0.05, { s: 0.5 });
    g.add(b.mesh(mw), d.mesh(md));
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(s.x1 - s.x0 + 0.3, 1.3), mat({ map: awning(), side: THREE.DoubleSide }));
    aw.position.set(cx, 2.15, cz + 0.05); aw.rotation.set(-Math.PI / 2 + 0.38, 0, 0); aw.castShadow = true; aw.receiveShadow = true;
    g.add(aw);
    // Cajas de fruta en el mostrador
    for (const [i, c] of [['#d8352a', 0], ['#f0a020', 1], ['#7ac040', 2]].map((v, k) => [k, v[0]])) {
      const x = s.x0 + 0.4 + i * 0.6, cr = new Builder();
      cr.box(x - 0.24, 0.98, cz - 0.05, x + 0.24, 1.12, cz + 0.32, { s: 0.5 }); g.add(cr.mesh(md));
      const fr = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), mat({ color: c, roughness: 0.45 }), 8);
      for (let k = 0; k < 8; k++) { const m4 = new THREE.Matrix4().makeTranslation(x - 0.15 + (k % 4) * 0.1, 1.15 + (k > 3 ? 0.03 : 0), cz + 0.05 + (k > 3 ? 0.15 : 0)); fr.setMatrixAt(k, m4); }
      fr.castShadow = true; g.add(fr);
    }
    colliders.push({ x0: s.x0, x1: s.x1, z0: s.y0, z1: s.y1 });
  }
  // Tablón de encargos: dos postes, un tablero con papeles y un tejadillo
  {
    const { x, y: z } = V.BOARD, b = new Builder();
    for (const dx of [-0.55, 0.5]) b.box(x + dx, 0, z - 0.04, x + dx + 0.08, 1.9, z + 0.04, { s: 0.5 });
    b.box(x - 0.62, 1.86, z - 0.2, x + 0.65, 1.92, z + 0.2, { s: 0.5 });
    g.add(b.mesh(md));
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.75, 0.05), [mw, mw, mw, mw, mat({ map: notes() }), mw]);
    board.position.set(x + 0.01, 1.3, z + 0.02); board.castShadow = true; g.add(board);
    colliders.push({ x, z, r: 0.45 });
  }
  // Vitrina del museo: pie de piedra, caja de cristal y una concha dentro
  {
    const { x, y: z } = V.MUSEUM, b = new Builder();
    b.box(x - 0.36, 0, z - 0.3, x + 0.36, 0.85, z + 0.3); g.add(b.mesh(ms));
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.5, 0.54), new THREE.MeshStandardMaterial({ color: '#cfe8f4', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false }));
    gl.position.set(x, 1.1, z); gl.renderOrder = 2; g.add(gl);
    const shell = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.26, 10), mat({ color: '#f0d8b8', roughness: 0.4 })); shell.position.set(x, 0.98, z); shell.rotation.z = 1.2; shell.castShadow = true; g.add(shell);
    colliders.push({ x, z, r: 0.42 });
  }
  // Buzón: poste, caja y bandera roja
  {
    const { x, z } = { x: 22.5, z: 20.5 }, b = new Builder();
    b.box(x - 0.05, 0, z - 0.05, x + 0.05, 1.0, z + 0.05); g.add(b.mesh(md));
    const bx = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.42, 12, 1, false, 0, Math.PI), mat({ color: '#3a6ab8', roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }));
    bx.rotation.set(Math.PI / 2, 0, Math.PI / 2); bx.position.set(x, 1.0, z); bx.castShadow = true; g.add(bx);
    const base = new Builder(); base.box(x - 0.15, 0.98, z - 0.21, x + 0.15, 1.0, z + 0.21); g.add(base.mesh(mat({ color: '#3a6ab8' })));
    const flag = new Builder(); flag.box(x + 0.15, 1.0, z - 0.02, x + 0.17, 1.32, z + 0.02); flag.box(x + 0.15, 1.2, z + 0.02, x + 0.17, 1.32, z + 0.16); g.add(flag.mesh(mat({ color: '#d8352a' })));
    colliders.push({ x, z, r: 0.25 });
  }
  // Farola: base de piedra, poste de hierro y un farol que se enciende de noche
  {
    const { x, z } = { x: 19.5, z: 20.5 }, iron = mat({ color: '#2e2c2a', metalness: 0.6, roughness: 0.45 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 10), ms); base.position.set(x, 0.15, z); base.castShadow = true; g.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 2.6, 8), iron); pole.position.set(x, 1.55, z); pole.castShadow = true; g.add(pole);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.32, 6), mat({ color: '#ffe6a8', emissive: '#ffb84a', emissiveIntensity: 0.15, roughness: 0.2 }));
    glass.position.set(x, 3.0, z); g.add(glass);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.18, 6), iron); cap.position.set(x, 3.25, z); cap.castShadow = true; g.add(cap);
    const light = new THREE.PointLight('#ffc070', 0, 12, 1.5); light.position.set(x, 2.9, z); g.add(light);
    lamps.push({ glass, light });
    colliders.push({ x, z, r: 0.22 });
  }
  // Cartel del cruce: poste y una tabla en flecha
  {
    const { x, z } = { x: 17.5, z: 26.5 }, b = new Builder();
    b.box(x - 0.05, 0, z - 0.05, x + 0.05, 1.5, z + 0.05); g.add(b.mesh(md));
    const shape = new THREE.Shape([[-0.42, -0.14], [0.3, -0.14], [0.44, 0], [0.3, 0.14], [-0.42, 0.14]].map(([a, c]) => new THREE.Vector2(a, c)));
    const sign = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false }), mw);
    sign.position.set(x + 0.05, 1.25, z - 0.025); sign.castShadow = true; g.add(sign);
    colliders.push({ x, z, r: 0.25 });
  }
  // Nenúfares y piedras de la orilla del estanque
  {
    const P = V.POND, r = rng(77), pads = [], stones = [];
    for (const [ax, ay, fl] of [[0.3, -0.2, 1], [-0.35, 0.25, 1], [0.1, 0.45, 0], [-0.5, -0.3, 0], [0.55, 0.2, 0], [-0.1, -0.5, 0]]) pads.push({ x: P.x + ax * P.rx, z: P.y + ay * P.ry, fl, a: r() * 6 });
    const padGeo = new THREE.CircleGeometry(0.32, 16, 0.4, Math.PI * 2 - 0.5); padGeo.rotateX(-Math.PI / 2);
    const padMat = mat({ color: '#3f8a32', roughness: 0.6, side: THREE.DoubleSide });
    for (const p of pads) {
      const m = new THREE.Mesh(padGeo, padMat); m.position.set(p.x, WATER_Y + 0.012, p.z); m.rotation.y = p.a; m.receiveShadow = true; g.add(m);
      if (p.fl) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.12, 8, 1, true), mat({ color: '#ffb8d8', roughness: 0.5, side: THREE.DoubleSide }));
        f.rotation.x = Math.PI; f.position.set(p.x + 0.05, WATER_Y + 0.08, p.z); g.add(f);
        const c = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat({ color: '#ffe04a' })); c.position.set(p.x + 0.05, WATER_Y + 0.07, p.z); g.add(c);
      }
    }
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat({ flatShading: true, roughness: 0.9 }), 30);
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + r() * 0.1, x = P.x + Math.cos(a) * P.rx * 1.1, z = P.y + Math.sin(a) * P.ry * 1.1, s = 0.12 + r() * 0.12;
      const m4 = new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) + s * 0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r(), r() * 6, r())), new THREE.Vector3(s * 1.3, s * 0.7, s));
      rocks.setMatrixAt(i, m4); rocks.setColorAt(i, new THREE.Color(['#9a958c', '#8c877e', '#aaa59c'][i % 3]));
    }
    rocks.castShadow = rocks.receiveShadow = true;
    g.add(rocks);
    // Juncos en la orilla
    const reeds = [];
    for (let i = 0; i < 40; i++) { const a = r() * Math.PI * 2, d = 0.96 + r() * 0.1; reeds.push({ x: P.x + Math.cos(a) * P.rx * d, z: P.y + Math.sin(a) * P.ry * d }); }
    const reedGeo = new THREE.CylinderGeometry(0.008, 0.014, 1, 4); reedGeo.translate(0, 0.5, 0);
    const rm = new THREE.InstancedMesh(reedGeo, mat({ color: '#5a8a3a' }), reeds.length * 3);
    let n = 0;
    for (const p of reeds) for (let k = 0; k < 3; k++) {
      const m4 = new THREE.Matrix4().compose(new THREE.Vector3(p.x + (r() - 0.5) * 0.12, WATER_Y, p.z + (r() - 0.5) * 0.12), new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.25, 0, (r() - 0.5) * 0.25)), new THREE.Vector3(1, 0.5 + r() * 0.5, 1));
      rm.setMatrixAt(n++, m4);
    }
    rm.castShadow = true;
    g.add(rm);
  }
  return { group: g, colliders, lamps };
}

// Todo el pueblo
export function buildVillage3D() {
  const t0 = performance.now();
  const stub = new Proxy({}, { get: () => [0, 1, 2, 3] });
  const gen = new WorldGen(S, stub);
  const group = new THREE.Group(), colliders = [], houses = [];
  group.add(buildTerrain(gen));
  const water = buildWater();
  group.add(water.mesh);
  // Casas: la tuya y las de los vecinos (con los muebles del juego)
  const list = [{ x0: V.HOUSE.x0, y0: V.HOUSE.y0, roof: 'tejado_rojo', furnish: 'full', name: 'Tu casa' }, ...Object.values(V.HOUSES).filter(h => !h.project).map(h => ({ x0: h.x0, y0: h.y0, roof: h.roof, furnish: 'npc', name: `Casa de ${h.name}` }))];
  for (const h of list) {
    const { w, h: hh } = houseSize(false), bp = houseBlueprint({ x0: h.x0, y0: h.y0, roof: h.roof, furnish: h.furnish });
    const house = buildHouse(bp, { x0: h.x0, y0: h.y0, w, h: hh, roofId: h.roof, lights: h.furnish === 'full' });
    house.name = h.name;
    group.add(house.group); houses.push(house); colliders.push(...house.colliders);
  }
  const fence = buildFence(); group.add(fence.group); colliders.push(...fence.colliders);
  const props = buildProps(); group.add(props.group); colliders.push(...props.colliders);
  colliders.push({ x: V.POND.x, z: V.POND.y, rx: V.POND.rx * 0.92, rz: V.POND.ry * 0.92 });
  // Vegetación: la del jardín (fija) y la del generador del mundo, separando los árboles para que no se pisen
  const items = [{ kind: 'fruit', x: 12.5, z: 12.5 }, { kind: 'oak', x: 29.5, z: 8.5 }];
  for (const [tx, ty, b] of [[17, 18, 1], [25, 18, 2], [12, 16, 0], [29, 13, 3], [27, 22, 0], [22, 30, 4], [13, 25, 0]]) items.push({ kind: 'bush', x: tx + 0.5, z: ty + 0.5, flowers: ['#ff7aa8', '#ffe04a', null, '#ffffff', '#b48aff'][b] || undefined });
  const KIND = { oak: 'oak', fruit: 'fruit', pine: 'pine', snowPine: 'pine', swampTree: 'oak', boulder: 'boulder', rock: 'rock', bush: 'bush', snowBoulder: 'boulder' };
  for (let cy = Math.floor(AREA.z0 / CHUNK); cy <= Math.floor((AREA.z1 - 1) / CHUNK); cy++) for (let cx = Math.floor(AREA.x0 / CHUNK); cx <= Math.floor((AREA.x1 - 1) / CHUNK); cx++) {
    for (const o of gen.content(cx, cy).objects) {
      const kind = KIND[o.kind];
      if (!kind || o.x < AREA.x0 + 1 || o.x > AREA.x1 - 1 || o.y < AREA.z0 + 1 || o.y > AREA.z1 - 1) continue;
      if (heightAt(o.x, o.y) < WATER_Y + 0.3) continue;
      items.push({ kind, x: o.x + (ihash(o.x * 4, o.y * 4, S + 90) - 0.5) * 0.5, z: o.y + (ihash(o.x * 4, o.y * 4, S + 91) - 0.5) * 0.5, flowers: kind === 'bush' && ihash(o.x, o.y, S + 92) < 0.3 ? ['#ff7aa8', '#ffe04a', '#ffffff', '#b48aff'][Math.floor(ihash(o.x, o.y, S + 93) * 4)] : undefined });
    }
  }
  // Radio de cada planta (copa incluida) y reparto voraz: se queda la primera y se quitan las que la pisen
  const RAD = { oak: 1.35, fruit: 1.35, pine: 1.25, bush: 0.6, rock: 0.35, boulder: 0.8 };
  const kept = [];
  const cell = new Map(), key = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
  for (const it of items) {
    const r = RAD[it.kind];
    let ok = true;
    for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1 && ok; dx++) {
      for (const o of cell.get(`${Math.floor(it.x / 4) + dx},${Math.floor(it.z / 4) + dz}`) || []) if (Math.hypot(o.x - it.x, o.z - it.z) < r + RAD[o.kind] - (it.kind === 'bush' || o.kind === 'bush' ? 0.3 : 0)) { ok = false; break; }
    }
    // Nada encima de las casas, la valla, el camino ni el estanque
    if (ok && houses.some(h => it.x > h.bounds.x0 - r && it.x < h.bounds.x1 + r && it.z > h.bounds.z0 - r && it.z < h.bounds.z1 + r)) ok = false;
    if (ok && V.inBounds(it.x, it.z) && (V.distToPath(it.x, it.z) < 1.0 + r * 0.6 || V.pondDist(it.x, it.z) < 1.25)) ok = false;
    if (!ok) continue;
    it.y = heightAt(it.x, it.z);
    kept.push(it);
    const k = key(it.x, it.z); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(it);
  }
  const nature = buildNature(kept, 5);
  group.add(nature.group);
  colliders.push(...nature.colliders);
  // Matas de hierba y flores sueltas por la pradera (no en el camino, el estanque ni dentro de las casas)
  const r = rng(321), tufts = [], flowers = [];
  const FLOWERS = ['#ffffff', '#ffe04a', '#ff7aa8', '#b48aff', '#ff6a4a', '#7ac8ff'];
  const free = (x, z) => !houses.some(h => x > h.bounds.x0 + 0.3 && x < h.bounds.x1 - 0.3 && z > h.bounds.z0 + 0.3 && z < h.bounds.z1 - 0.3) && (!V.inBounds(x, z) || (V.distToPath(x, z) > 1.0 && V.pondDist(x, z) > 1.2));
  for (let i = 0; i < 26000; i++) {
    const x = AREA.x0 + r() * (AREA.x1 - AREA.x0), z = AREA.z0 + r() * (AREA.z1 - AREA.z0);
    if (vnoise(x * 0.25, z * 0.25, S + 40) < 0.38 || !free(x, z) || heightAt(x, z) < WATER_Y + 0.08) continue;
    const b = gen.biomeAt(x, z);
    if (![B.MEADOW, B.FOREST, B.PINES, B.SWAMP].includes(b)) continue;
    tufts.push({ x, z, y: heightAt(x, z) });
  }
  for (let i = 0; i < 2600; i++) {
    const x = AREA.x0 + r() * (AREA.x1 - AREA.x0), z = AREA.z0 + r() * (AREA.z1 - AREA.z0);
    if (vnoise(x * 0.12, z * 0.12, S + 41) < 0.5 || !free(x, z) || heightAt(x, z) < WATER_Y + 0.08 || gen.biomeAt(x, z) !== B.MEADOW) continue;
    flowers.push({ x, z, y: heightAt(x, z), c: FLOWERS[Math.floor(vnoise(x * 0.3, z * 0.3, S + 42) * 6) % 6] });
  }
  group.add(buildGround(tufts, flowers, 9));
  console.log(`pueblo 3D: ${kept.length} plantas, ${tufts.length} matas, ${flowers.length} flores, ${houses.length} casas en ${(performance.now() - t0).toFixed(0)} ms`);
  return { group, colliders, houses, water, lamps: props.lamps, gen };
}
