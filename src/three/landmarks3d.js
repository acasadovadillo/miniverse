// The landmarks on the skyline (docs/planes/realismo/PLAN-R7-mundo.md §6; R7-2; ?siluetas=0 turns it off): the towers, the
// lighthouses, the hamlets and the temples that are too far for their chunk to be drawn, as simple shapes of the same size and
// colour, with the smoke of the hamlets by day and the light of the lighthouses by night.
//   One mesh for all the shapes, made again only when the list changes (looked at twice a second, from lookout.js: plain
// arithmetic on the sites already known); one of points for the smoke and one for the lights. The last ones get lost in the fog
// later than the land does, and their foot before their top: a pale shape in the haze, that says something is there.
//   beacons: the lit lighthouses whose chunk is not drawn, for their turning beam (fx.js).
import * as THREE from 'three';
import { CHUNK } from '../world/gen.js';
import { nearX, distOf } from '../world/planet.js';
import { TOWER, GALLERY } from '../world/tower.js';
import { stoneOf } from '../world/biomes.js';
import { houseSize } from '../world/blueprints.js';
import { ROOF_COLORS } from './build3d.js';
import { apagado } from '../arte.js';
import { apagada } from '../opciones.js';

const OFF = apagada('siluetas');
const RANGE = 330, LIGHT_RANGE = 400, EVERY = 0.5, MAX = 24, PUFFS = 6, SMOKES = 4, LIGHTS = 8, BUILT_S = 4;
export const LENS_Y = GALLERY.H + 1.05;   // (the lens over the ground: models.js, faro)
const STONE = { limestone: '#9c9585', granite: '#979a9d', slate: '#7d8388' };   // (as the towers look from some way off: models.js)
const ROOFS = ['tejado_azul', 'tejado_gris', 'tejado_verde'];

// ---------- the shapes ----------
// Into a list of positions, normals and colours (aTall: how tall the vertex is over the place's foot, for the haze)
class Shapes {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.tall = []; this.c = new THREE.Color(); }
  at(x, y, z, tint) { this.x = x; this.y = y; this.z = z; this.color(tint); }
  color(tint) { this.c.set(tint); }
  v(p, n) { this.pos.push(this.x + p[0], this.y + p[1], this.z + p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(this.c.r, this.c.g, this.c.b); this.tall.push(p[1]); }
  tri(a, b, c, n) { this.v(a, n); this.v(b, n); this.v(c, n); }
  quad(a, b, c, d, n) { this.tri(a, b, c, n); this.tri(a, c, d, n); }
  // A ring of wall, from (r0, y0) to (r1, y1), in n faces
  ring(r0, y0, r1, y1, n, from = 0, step = 1) {
    for (let i = from; i < n; i += step) {
      const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2, m = (a + b) / 2, P = (q, r, y) => [Math.sin(q) * r, y, Math.cos(q) * r];
      this.quad(P(a, r0, y0), P(b, r0, y0), P(b, r1, y1), P(a, r1, y1), [Math.sin(m), 0, Math.cos(m)]);
    }
  }
  disc(r, y, n, up = 1) {
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2, A = [Math.sin(a) * r, y, Math.cos(a) * r], B = [Math.sin(b) * r, y, Math.cos(b) * r]; if (up > 0) this.tri([0, y, 0], A, B, [0, 1, 0]); else this.tri([0, y, 0], B, A, [0, -1, 0]); }
  }
  cone(r, y0, y1, n) { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2, m = (a + b) / 2; this.tri([Math.sin(a) * r, y0, Math.cos(a) * r], [Math.sin(b) * r, y0, Math.cos(b) * r], [0, y1, 0], [Math.sin(m) * 0.7, 0.7, Math.cos(m) * 0.7]); } }
  box(x0, y0, z0, x1, y1, z1, top = true) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]); this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]); this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
  }
  // A roof of two slopes, its ridge along x
  gable(x0, z0, x1, z1, y, h) {
    const m = (z0 + z1) / 2;
    this.quad([x0, y, z1], [x1, y, z1], [x1, y + h, m], [x0, y + h, m], [0, 0.8, 0.6]); this.quad([x1, y, z0], [x0, y, z0], [x0, y + h, m], [x1, y + h, m], [0, 0.8, -0.6]);
    this.tri([x0, y, z0], [x0, y, z1], [x0, y + h, m], [-1, 0, 0]); this.tri([x1, y, z1], [x1, y, z0], [x1, y + h, m], [1, 0, 0]);
  }
  // …along z
  gableZ(x0, z0, x1, z1, y, h) {
    const m = (x0 + x1) / 2;
    this.quad([x1, y, z1], [x1, y, z0], [m, y + h, z0], [m, y + h, z1], [0.6, 0.8, 0]); this.quad([x0, y, z0], [x0, y, z1], [m, y + h, z1], [m, y + h, z0], [-0.6, 0.8, 0]);
    this.tri([x0, y, z1], [x1, y, z1], [m, y + h, z1], [0, 0, 1]); this.tri([x1, y, z0], [x0, y, z0], [m, y + h, z0], [0, 0, -1]);
  }
}
function tower(S, h) {
  const R = TOWER.R, n = 14, top = h + 0.5;
  S.ring(R, -1, R, top, n); S.disc(R - 0.5, h, n); S.ring(R - 0.45, h, R - 0.45, top, n);
  S.ring(R, top, R, h + TOWER.parapet, n, 0, 2); S.ring(R - 0.45, top, R - 0.45, h + TOWER.parapet, n, 0, 2);
}
const LIVERY = { red: ['#8e3a34', '#cfcbc0', '#8e3a34', [1, 3, 5]], black: ['#3a3d40', '#cfcbc0', '#3a3d40', [1, 4, 5]], stone: ['#b3aa98', '#b3aa98', '#5d6165', []] };
function lighthouse(S, livery = 'red') {
  const [BAND, WHITE, CAP, ON] = LIVERY[livery] || LIVERY.red;
  const n = 10, B0 = 0.7, B1 = 7.75, r = y => 1.36 - (y - B0) / (B1 - B0) * 0.36;
  S.color('#77736b'); S.ring(GALLERY.base, -1, 1.4, B0, n);
  for (let i = 0; i < 6; i++) { const y = B0 + i * (B1 - B0) / 6, y1 = B0 + (i + 1) * (B1 - B0) / 6; S.color(ON.includes(i) ? BAND : WHITE); S.ring(r(y), y, r(y1), y1, n); }
  S.color('#77736b'); S.ring(1.0, B1, GALLERY.deck, GALLERY.H - 0.16, n); S.ring(GALLERY.deck, GALLERY.H - 0.16, GALLERY.deck, GALLERY.H, n); S.disc(GALLERY.deck, GALLERY.H, n);
  S.color('#4a4c4e'); S.ring(GALLERY.lantern, GALLERY.H, GALLERY.lantern, GALLERY.H + 1.7, 8);
  S.color(CAP); S.cone(GALLERY.lantern + 0.1, GALLERY.H + 1.7, GALLERY.H + 2.3, 8);
}
// (one of now: its homes, as they are; hamlets.js)
const WALL_C = { muro_entramado: '#b0a48e', limewash_wall: '#d6d2c6', muro_piedra: '#86827a', muro_madera: '#8a745a' };
function hamletNow(S, p, L) {
  for (const h of L.homes) {
    const x = h.x - p.x, z = h.y - p.y, along = h.w >= h.h;
    S.color(WALL_C[h.wall] || '#8b7d68'); S.box(x, -0.5, z, x + h.w, 2.5, z + h.h, false);
    S.color(ROOF_COLORS[h.roof] || '#9c8f76');
    if (along) S.gable(x - 0.4, z - 0.4, x + h.w + 0.4, z + h.h + 0.4, 2.4, h.h * 0.31); else S.gableZ(x - 0.4, z - 0.4, x + h.w + 0.4, z + h.h + 0.4, 2.4, h.w * 0.31);
  }
}
function hamlet(S, slots) {
  const { w, h } = houseSize(false);
  for (const [i, [dx, dy]] of slots.entries()) {
    S.color('#8b7d68'); S.box(dx - 0.5, -0.5, dy - 0.5, dx - 0.5 + w, 2.5, dy - 0.5 + h, false);
    S.color(ROOF_COLORS[ROOFS[i]]); S.gable(dx - 0.9, dy - 0.9, dx - 0.1 + w, dy - 0.1 + h, 2.4, 3);
  }
}
// (one of now: its podium, its cella, its columns and its low roof, the gable to the front)
function templeNow(S, L, columns) {
  const [w, h, porch] = { 4: [7, 9, 2], 6: [7, 11, 4], 8: [11, 13, 4] }[columns] || [7, 9, 2], x0 = -(w >> 1) - 0.5, z0 = -(h >> 1) - 0.5, y = 0.3;
  S.color('#a39d90'); S.box(x0 - 1, -0.5, z0 - 1, x0 + w + 1, y, z0 + h + 2); S.color('#b8b0a0');
  S.box(x0 + 0.4, y, z0 + 0.4, x0 + w - 0.4, y + 2.8, z0 + h - porch - 0.4, false);
  for (let i = 0; i < w; i += 2) S.box(x0 + i + 0.28, y, z0 + h - 0.72, x0 + i + 0.72, y + 2.8, z0 + h - 0.28, false);
  S.color('#a8a294'); S.gableZ(x0 - 0.4, z0 - 0.4, x0 + w + 0.4, z0 + h + 0.4, y + 2.85, w * 0.145);
}
function temple(S) {
  S.color('#a8a294'); S.box(-1.65, -0.5, -1.65, 1.65, 0.45, 1.65); S.color('#b4ae9f');
  for (const [x, z] of [[-1.2, 1.2], [-0.4, 1.2], [0.4, 1.2], [1.2, 1.2], [-1.2, -1.2], [1.2, -1.2]]) S.box(x - 0.16, 0.45, z - 0.16, x + 0.16, 3.2, z + 0.16, false);
  S.box(-0.85, 0.45, -1, 0.85, 3.2, 0.3, false); S.box(-1.5, 3.2, -1.5, 1.5, 3.6, 1.5); S.gable(-1.56, -1.56, 1.56, 1.56, 3.6, 0.85);
}

export class Landmarks {
  constructor(view) {
    this.view = view;
    this.beacons = []; this.list = []; this.built = []; this.slots = new Map();
    this.stats = { places: 0, tris: 0, made: 0, ms: 0 };
    this.key = ''; this.at = -1; this.builtAt = -1;
    if (OFF) return;
    const U = this.U = { lmFar: { value: 150 }, lmKeep: { value: 0.13 } };
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTall;\nvarying float vTall;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTall = smoothstep(0.5, 6.0, aTall);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float lmFar;\nuniform float lmKeep;\nvarying float vTall;').replace('#include <fog_fragment>', `
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
        fogFactor = min(fogFactor, 1.0 - lmKeep * vTall * (1.0 - smoothstep(lmFar * 1.5, lmFar * 2.1, vFogDepth)));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);`);
    };
    m.customProgramCacheKey = () => 'landmarks';
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
    this.mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); this.mesh.geometry.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
    this.mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute([], 3)); this.mesh.geometry.setAttribute('aTall', new THREE.Float32BufferAttribute([], 1));
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    // The smoke (soft grey, it fades in the fog) and the lights (they shine through it). A bit nearer than they are: out of the
    // lantern's own shape
    const points = (n, frag, uniforms, more) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aV', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));   // (its size, m, and how much of it)
      g.setDrawRange(0, 0);
      const p = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms, transparent: true, depthWrite: false, fog: false, ...more,
        vertexShader: 'attribute vec2 aV; uniform float uScale; varying float vA; varying float vD; void main() { vec4 q = modelViewMatrix * vec4(position, 1.0); vD = -q.z; q.xyz *= 1.0 - min(0.5, 1.4 / max(1.0, vD)); vA = aV.y; gl_Position = projectionMatrix * q; gl_PointSize = max(2.0, aV.x * uScale / max(1.0, vD)); }',
        fragmentShader: frag }));
      p.frustumCulled = false; p.visible = false;
      return p;
    };
    this.smokeU = { uScale: { value: 800 }, uColor: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uNear: { value: 60 }, uFar: { value: 150 } };
    this.smoke = points(SMOKES * PUFFS, `uniform vec3 uColor; uniform vec3 uFog; uniform float uNear; uniform float uFar; varying float vA; varying float vD;
      void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard; float f = smoothstep(uNear, uFar, vD); gl_FragColor = vec4(mix(uColor, uFog, f * 0.85), vA * (1.0 - r) * (1.0 - r) * (1.0 - smoothstep(uFar * 1.3, uFar * 2.0, vD))); }`, this.smokeU);
    this.lightU = { uScale: { value: 800 }, uK: { value: 0 } };
    this.lights = points(LIGHTS, `uniform float uK; varying float vA; varying float vD;
      void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard; float c = exp(-r * 30.0) + 0.3 * exp(-r * 5.0) * (1.0 - r); gl_FragColor = vec4(vec3(1.0, 0.94, 0.74) * c * vA * uK, 1.0); }`, this.lightU, { blending: THREE.AdditiveBlending });
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.smoke, this.lights);
    view.scene.add(this.group);
  }
  // The watchtowers people have built, wherever they are (their list is made again when something has changed)
  builtTowers(scene, t) {
    if (scene.touches === this.builtTouches && scene === this.builtScene) return this.built;
    if (scene === this.builtScene && Math.abs(t - this.builtAt) < BUILT_S) return this.built;
    this.builtAt = t; this.builtTouches = scene.touches; this.builtScene = scene;
    this.built.length = 0;
    for (const [k, d] of scene.deltas) {
      if (!d?.placed) continue;
      const i = k.indexOf(','), cx = Number(k.slice(0, i)), cy = Number(k.slice(i + 1));
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      for (const q of scene.towersIn(cx, cy)) this.built.push(q.light ? { kind: 'faro', key: q.key, x: q.x, y: q.y, z: scene.levelAt(q.x, q.y) || 0, livery: q.light, lit: scene.fireAt(q.tx, q.ty) } : { kind: 'torre', key: q.key, x: q.x, y: q.y, z: scene.levelAt(q.x, q.y) || 0, h: q.h, yaw: q.yaw, stone: stoneOf(scene.gen.biomeAt(q.x, q.y)) });
    }
    return this.built;
  }
  slotsOf(places, p) {
    let s = this.slots.get(p.key);
    if (!s) { if (this.slots.size > 200) this.slots.clear(); this.slots.set(p.key, (s = places.aldeaSlots(Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK)))); }
    return s;
  }
  update(game, scene, t) {
    if (OFF) return;
    const places = game.places, world = scene === game.world && !this.view.cave && !!places?.look && !!game.player;
    this.group.visible = world;
    if (!world) { this.beacons.length = 0; return; }
    const cam = this.view.camera, fog = this.view.scene.fog;
    if (this.scene !== scene || !(Math.abs(t - this.at) < EVERY)) { this.at = t; this.scene = scene; this.look(game, scene, places, t); }
    this.U.lmFar.value = fog.far; this.U.lmKeep.value = this.view.fogNow ? 0 : 0.13 * (1 - 0.5 * (this.view.night || 0));
    const px = this.view.renderer.domElement.height / (2 * Math.tan(cam.fov * Math.PI / 360));
    this.lightsAt(t, px); this.smokeAt(game, t, px, fog);
  }
  look(game, scene, places, t) {
    const t0 = performance.now(), p = game.player, list = this.list;
    places.look.tall(p.x, p.y, LIGHT_RANGE, list);
    for (const q of this.builtTowers(scene, t)) if (distOf(q.x, q.y, p.x, p.y) <= RANGE) list.push(q);
    // (those whose chunk is drawn have their real model)
    let key = '';
    let n = 0;
    const chunks = this.view.world.chunks;
    this.beacons.length = 0;
    for (const q of list) {
      const x = nearX(q.x, p.x), cx = Math.floor(x / CHUNK), cy = Math.floor(q.y / CHUNK);
      if (chunks.has(`${cx},${cy}`)) continue;
      const d = Math.hypot(x - p.x, q.y - p.y);
      if (q.kind === 'faro' && q.lit !== false && this.beacons.length < LIGHTS) this.beacons.push([x, (q.z || 0) + LENS_Y, q.y, d]);
      if (d > RANGE || n >= MAX) continue;
      list[n++] = q; key += `${q.key},${Math.round(x)};`;
    }
    list.length = n;
    this.beacons.sort((a, b) => a[3] - b[3]);
    this.stats.places = n;
    if (key !== this.key) { this.key = key; this.make(places, p.x); }
    this.stats.ms = performance.now() - t0;
  }
  make(places, px) {
    const S = new Shapes();
    this.homes = [];
    for (const q of this.list) {
      const x = nearX(q.x, px);
      S.at(x, q.kind === 'aldea' ? 0 : q.z || 0, q.y, apagado(STONE[q.stone] || STONE.limestone));
      if (q.kind === 'torre') tower(S, q.h || TOWER.H);
      else if (q.kind === 'faro') lighthouse(S, q.livery);
      else if (q.kind === 'templo' && q.form) templeNow(S, null, places.planOf(q).columns);
      else if (q.kind === 'templo') temple(S);
      else if (q.form) { const L = places.planOf(q); hamletNow(S, q, L); if (L.homes.length && this.homes.length < SMOKES) this.homes.push([x + L.homes[0].x + L.homes[0].w / 2 - q.x, 5.2, L.homes[0].y + L.homes[0].h / 2]); }
      else { const slots = this.slotsOf(places, q), { w, h } = houseSize(false); hamlet(S, slots); if (slots.length && this.homes.length < SMOKES) this.homes.push([x + slots[0][0] + w / 2, 5.2, q.y + slots[0][1] + h / 2]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(S.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(S.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(S.col, 3)); g.setAttribute('aTall', new THREE.Float32BufferAttribute(S.tall, 1));
    if (S.pos.length) g.computeBoundingSphere();
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.mesh.visible = S.pos.length > 0;
    this.stats.tris = S.pos.length / 9; this.stats.made++;
  }
  // The lights: a glow that swells when the beam comes round to you (it turns as fx.js turns it)
  lightsAt(t, px) {
    const night = this.view.night || 0, k = Math.max(0, Math.min(1, (night - 0.3) / 0.3)), P = this.lights, G = P.geometry, cam = this.view.camera.position;
    P.visible = k > 0 && this.beacons.length > 0;
    if (!P.visible) return;
    this.lightU.uK.value = k * (this.view.fogNow ? 0.25 : 1); this.lightU.uScale.value = px;
    const pos = G.attributes.position.array, v = G.attributes.aV.array;
    let n = 0;
    for (const b of this.beacons) {
      const a = t * 0.8 + b[0] * 0.37 + b[2] * 0.11, dx = cam.x - b[0], dz = cam.z - b[2], d = Math.hypot(dx, dz) || 1, on = Math.max(0, (Math.cos(a) * dx - Math.sin(a) * dz) / d) ** 14;
      pos[n * 3] = b[0]; pos[n * 3 + 1] = b[1]; pos[n * 3 + 2] = b[2];
      v[n * 2] = 8 + 18 * on; v[n * 2 + 1] = (0.6 + 1.5 * on) * Math.max(0, 1 - d / (LIGHT_RANGE + 60));
      n++;
    }
    G.setDrawRange(0, n); G.attributes.position.needsUpdate = G.attributes.aV.needsUpdate = true;
  }
  smokeAt(game, t, px, fog) {
    const P = this.smoke, G = P.geometry, homes = this.homes || [], night = this.view.night || 0, k = this.view.fogNow ? 0 : 0.2 * (1 - 0.8 * night);
    P.visible = homes.length > 0 && k > 0.02;
    if (!P.visible) return;
    const W = game.wind, wx = (W?.x || 0.6) * (0.4 + 0.5 * (W?.s || 0.4)), wz = (W?.y || 0.3) * (0.4 + 0.5 * (W?.s || 0.4)), pos = G.attributes.position.array, v = G.attributes.aV.array;
    this.smokeU.uScale.value = px; this.smokeU.uFog.value.copy(fog.color); this.smokeU.uNear.value = fog.near; this.smokeU.uFar.value = fog.far;
    this.smokeU.uColor.value.setRGB(0.5, 0.5, 0.5).lerp(fog.color, 0.35);
    let n = 0;
    for (const [hx, hy, hz] of homes) for (let i = 0; i < PUFFS; i++) {
      const q = (t * 0.07 + i / PUFFS + hx * 0.013) % 1, up = q * 9;
      pos[n * 3] = hx + wx * up * 0.5; pos[n * 3 + 1] = hy + up; pos[n * 3 + 2] = hz + wz * up * 0.5;
      v[n * 2] = 1.2 + q * 4; v[n * 2 + 1] = k * Math.min(1, q / 0.15) * (1 - q) ** 1.3;
      n++;
    }
    G.setDrawRange(0, n); G.attributes.position.needsUpdate = G.attributes.aV.needsUpdate = true;
  }
}
