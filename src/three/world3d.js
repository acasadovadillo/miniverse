// El mundo de fuera en 3D, por trozos de 16 casillas: lo que el juego dice que hay en cada uno
// (`Overworld.contentFor`) se convierte en mallas. Cerca de la cámara va todo (naturaleza, hierba, lo
// construido, muebles, estaciones, cultivos, lugares); más lejos, solo los árboles y las rocas, sencillos y
// sin sombra, en bloques grandes, hasta donde llega la niebla. Cada trozo se rehace solo cuando cambia lo que
// tiene. Los tejados van por regiones (toda la superficie unida, aunque cruce trozos) y, con el jugador dentro
// de una casa, se ocultan el tejado y las paredes que dan a la cámara (siguen dando sombra).
import * as THREE from 'three';
import { CHUNK } from '../world/gen.js';
import * as village from '../world/village.js';
import { PIECES, parsePlaced } from '../pieces.js';
import { CAM } from '../camera.js';
import { Builder } from './geo.js';
import { buildNatureChunk, buildGround, buildFarNature, shake, WIND } from './nature3d.js';
import { baseMaterials, wallTile, doorTile, doorLeaf, gateTile, gateLeaf, fenceTile, floorTile, roofRegion, WALL_H, ROOF, FLOWER } from './build3d.js';
import { getModel, modelMat, CHANDELIER } from './models.js';
import { yawOf } from '../art/stations.js';
// Lo que brilla en los modelos y, apagado, con qué se dibuja
const UNLIT = { shade: 'cloth', lamp: 'white', ember: 'soot', glow: 'soot', crystal: 'crystal' };
import { tintMats, tintOf } from './tints.js';

const NEAR = 3;          // trozos alrededor del de la cámara con todo
const NB = 2;            // la naturaleza y la hierba van en bloques de NB × NB trozos (menos mallas)
const GROUND_R = 2;      // trozos alrededor con hierba y flores
const SHADOW_R = 2;      // … cuya naturaleza da sombra
const FAR_BLOCK = 4;     // trozos por lado de un bloque lejano
const FAR_R = 2;         // bloques lejanos alrededor
const NATURE = new Set(['oak', 'fruit', 'pine', 'snowPine', 'swampTree', 'cactus', 'palm', 'boulder', 'rock', 'bush', 'deadBush', 'snowBoulder']);

export class World3D {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    view.scene.add(this.group);
    this.chunks = new Map();       // "cx,cy" → vista del trozo
    this.nature = new Map();       // "bx,by" → bloque de naturaleza (árboles, rocas…) y hierba
    this.far = new Map();          // "bx,by" → bloque lejano
    this.regions = new Map();      // clave → región de tejado { key, tiles, box, roof, lamp, top }
    this.regionOf = new Map();     // "tx,ty" → clave de su región
    this.doors = new Map();        // "tx,ty" → { leaf, amount }
    this.fadeMats = new Map();     // "región|lado" → Map(clave de material → material propio)
    this.fade = new Map();         // "región|lado" o "región|roof" → opacidad actual
    this.villageGroup = null; this.villageRef = null;
    this.scene = null; this.season = -1;
    this.insideHouse = null;
    this.nearUniform = { value: new THREE.Vector4(0, 0, 0, 0) };   // trozos cercanos (los árboles lejanos ahí no se pintan)
  }

  // ---------- cada fotograma ----------
  update(game, scene, target, dt, snap = false) {
    if (scene !== this.scene || scene.gen.season !== this.season) this.reset(scene);
    this.game = game;
    WIND.value = game.time;
    const ccx = Math.floor(target.x / CHUNK), ccy = Math.floor(target.z / CHUNK);
    this.nearUniform.value.set((ccx - NEAR) * CHUNK, (ccx + NEAR + 1) * CHUNK, (ccy - NEAR) * CHUNK, (ccy + NEAR + 1) * CHUNK);
    this.updateVillage(scene);
    // Trozos cercanos: los nuevos o cambiados, del más cercano al más lejano, con un tope de tiempo
    const want = [];
    for (let dy = -NEAR; dy <= NEAR; dy++) for (let dx = -NEAR; dx <= NEAR; dx++) want.push([ccx + dx, ccy + dy, Math.max(Math.abs(dx), Math.abs(dy))]);
    want.sort((a, b) => a[2] - b[2]);
    const keep = new Set(want.map(([x, y]) => `${x},${y}`));
    for (const [k, c] of this.chunks) if (!keep.has(k)) this.dropChunk(k, c);
    const t0 = performance.now(), budget = snap ? 1e9 : 7;
    for (const [cx, cy, ring] of want) {
      const k = `${cx},${cy}`, cur = this.chunks.get(k), data = scene.contentFor(cx, cy);
      if (cur && !cur.force && cur.data !== data) { if (this.signature(scene, cx, cy, data) === cur.sig) cur.data = data; }
      if (cur && !cur.force && cur.data === data) { this.setRing(scene, cur, ring); continue; }
      if (performance.now() - t0 > budget && cur) continue;
      if (performance.now() - t0 > budget * 2) break;
      // Si cambian sus muros o tejados, las casas que tocaba se calculan de nuevo
      const struct = structure(data);
      if (cur && cur.struct !== struct) for (const r of cur.regions) { const reg = this.regions.get(r); if (reg) this.invalidateRegion(reg); }
      if (cur) this.dropChunk(k, cur, true);
      const c = this.buildChunk(scene, cx, cy, data, ring);
      c.struct = struct;
      this.chunks.set(k, c);
    }
    // Las casas que han quedado lejos se olvidan (se vuelven a calcular si se vuelve)
    const lo = (ccx - NEAR - 1) * CHUNK, hi = (ccx + NEAR + 2) * CHUNK, lz = (ccy - NEAR - 1) * CHUNK, hz = (ccy + NEAR + 2) * CHUNK;
    for (const r of [...this.regions.values()]) {
      const b = r.box;
      if (b.x1 >= lo && b.x0 <= hi && b.y1 >= lz && b.y0 <= hz) continue;
      this.dropRegion(r); this.regions.delete(r.key);
      for (const [x, y] of r.tiles) if (this.regionOf.get(`${x},${y}`) === r.key) this.regionOf.delete(`${x},${y}`);
      for (const k of [...this.fadeMats.keys()]) if (k.startsWith(r.key + '|')) { for (const m of this.fadeMats.get(k).values()) m.dispose(); this.fadeMats.delete(k); this.fade.delete(k); }
    }
    this.updateNature(scene, ccx, ccy, t0, budget);
    this.updateFar(scene, ccx, ccy, t0, budget);
    this.updateRegions(scene);
    // Lo que se golpea tiembla
    for (const b of this.nature.values()) for (const [key, o] of b.shakers) {
      const on = o.shakeUntil > game.time;
      if (on || b.shaking?.has(key)) { shake(b.nat, key, on ? Math.sin(game.time * 90) * 0.04 : 0); if (on) (b.shaking ||= new Set()).add(key); else b.shaking.delete(key); }
    }
    this.updateDoors(scene, dt);
    for (const c of this.chunks.values()) if (c.spin) for (const o of c.spin) o.rotation.x += o.userData.spin * dt;
    this.updateFade(game, scene, dt);
    // Las ventanas se encienden de noche
    const glow = this.view.night * 1.2;
    for (const m of this.glassMats()) m.emissiveIntensity = glow;
  }
  reset(scene) {
    for (const [k, c] of this.chunks) this.dropChunk(k, c);
    for (const b of this.nature.values()) this.dropNature(b);
    this.nature.clear();
    for (const b of this.far.values()) this.group.remove(b);
    this.far.clear();
    for (const r of this.regions.values()) this.dropRegion(r);
    this.regions.clear(); this.regionOf.clear();
    this.scene = scene; this.season = scene.gen.season;
    if (this.villageGroup) this.group.remove(this.villageGroup);
    this.villageGroup = null; this.villageRef = null;
  }

  // Firma de un trozo: si no cambia, no hace falta rehacerlo (el juego rehace sus datos cada pocos segundos)
  signature(scene, cx, cy, data) {
    const farm = this.farm(scene), d = scene.delta(cx, cy), today = farm?.today;
    let s = '';
    for (const o of data.objects) s += o.key + (o.crop ? ':' + farm.stage(o.crop) : '') + (o.open ? '!' : '') + (o.placed ? o.placed + (o.rot || 0) : '') + (o.model ? ':' + o.model : '') + (o.off ? '~' : '') + (o.tuck ? '^' : '') + (o.free ? `@${o.x.toFixed(2)},${o.y.toFixed(2)},${o.yaw.toFixed(2)}` : '') + (o.window && scene.doorClosed(...o.tile) ? '#' : '') + ',';   // (~: apagado; #: ventana cerrada)
    for (const o of data.flats) s += o.key + (o.model || o.placed || '') + (o.rot || 0) + (o.free ? `@${o.x.toFixed(2)},${o.y.toFixed(2)},${o.yaw.toFixed(2)}` : '') + ',';
    for (const o of data.floors) s += o.key + ',';
    for (const t of data.tilled) { const k = `${t[0]},${t[1]}`; s += k + (d?.wet?.[k] === today ? 'w' : '') + ';'; }
    return s;
  }

  // El huerto (solo en la partida: el mundo del menú no tiene)
  farm(scene) { return this.game?.world === scene ? this.game.farm : null; }

  // ---------- un trozo ----------
  buildChunk(scene, cx, cy, data, ring) {
    const group = new THREE.Group(), view = this.view, gy = (x, y) => view.groundY(scene, x, y);
    const c = { group, data, ring, sig: this.signature(scene, cx, cy, data), lights: [], flames: [], smoke: [], doors: [], regions: new Set(), cx, cy };
    // Lo construido y lo colocado, juntado por material (y lo de cada pared de cada casa, aparte)
    const sinks = new Map(), extras = { blooms: [], leaves: [] };
    // (lo que se puede pintar por vértice va a un material compartido, con su color)
    const emitFor = region => (key, side) => {
      const tint = tintOf(key), bucket = tint ? tint[0] : key, k = `${region && side && side !== 'free' && side !== 'floor' ? region + '|' + side : ''}#${bucket}`;
      let b = sinks.get(k);
      if (!b) sinks.set(k, (b = new Builder()));
      return b.tint(tint ? tint[1] : null);
    };
    const plain = emitFor('');
    for (const o of data.floors) floorTile(scene, o.tile[0], o.tile[1], o.placed, plain);
    for (const t of data.tilled) {
      const k = `${t[0]},${t[1]}`, wet = scene.delta(cx, cy)?.wet?.[k] === this.farm(scene)?.today;
      this.placeModel(`tilled:${wet ? 1 : 0}`, t[0] + 0.5, t[1] + 0.5, 0, plain, c, group);
    }
    for (const o of data.objects.concat(data.flats)) {
      if (o.placed && (o.layer === 'placed' || o.layer === 'hang' || o.layer === 'rug')) {
        const [tx, ty] = o.tile, piece = PIECES[o.placed], region = this.regionAt(scene, tx, ty);
        if (region) c.regions.add(region);
        if (piece?.kind === 'wall') { const ex = { blooms: [], leaves: [] }; wallTile(scene, tx, ty, o.placed, emitFor(region), ex); this.flowers(ex, region, group); }
        else if (piece?.kind === 'door') { const ex = { blooms: [], leaves: [] }; const d = doorTile(scene, tx, ty, emitFor(region), ex); d.region = region; c.doors.push(d); }
        else if (piece?.kind === 'gate') c.doors.push(gateTile(scene, tx, ty, plain));
        else if (piece?.kind === 'fence') fenceTile(scene, tx, ty, o.placed, plain);
        else this.placeModel(o.model || o.placed, o.x, o.y, o.yaw ?? yawOf(o.rot), plain, c, group, o.off);
      } else if (o.crop && this.farm(scene)) this.placeModel(`crop:${o.crop.id}:${this.farm(scene).stage(o.crop)}`, o.x, o.y, 0, plain, c, group);
      else if (o.poi) this.placeModel(`poi:${o.poi.kind}${o.poi.snow ? ':snow' : ''}`, o.poi.x, o.poi.y, 0, plain, c, group);
      else if (o.treasure) this.placeModel(`treasure:${o.open ? 1 : 0}`, o.x, o.y, 0, plain, c, group);
      else if (o.roof && o.layer === 'roof') { const r = this.regionAt(scene, o.tile[0], o.tile[1]); if (r) c.regions.add(r); }
    }
    this.flowers(extras, '', group);
    for (const [k, B] of sinks) {
      if (B.empty) continue;
      const [fadeKey, key] = k.split('#'), m = fadeKey ? this.fadeMat(fadeKey, key) : this.mat(key), mesh = B.mesh(m);
      mesh.castShadow = key !== 'glass'; mesh.receiveShadow = true;
      if (fadeKey) mesh.userData.fade = fadeKey;
      mesh.userData.own = true;
      group.add(mesh);
    }
    // Puertas: la hoja se anima aparte (y se desvanece con su pared)
    for (const d of c.doors) {
      const k = `${d.tile[0]},${d.tile[1]}`, fk = d.region && d.side !== 'free' ? `${d.region}|${d.side}` : '';
      const leaf = d.gate ? gateLeaf(d, { fence: this.mat('fence') }) : doorLeaf(d, { door: fk ? this.fadeMat(fk, 'door') : this.mat('door'), frame: fk ? this.fadeMat(fk, 'frame') : this.mat('frame') });
      leaf.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const prev = this.doors.get(k);
      const amount = prev ? prev.amount : scene.doorClosed(...d.tile) ? 0 : 1;
      leaf.userData.setAngle(amount);
      group.add(leaf);
      this.doors.set(k, { leaf, amount, tile: d.tile });
    }
    group.matrixAutoUpdate = true;
    this.group.add(group);
    return c;
  }
  dropChunk(k, c, rebuilding = false) {
    this.group.remove(c.group);
    c.group.traverse(o => { if (o.userData.own) o.geometry.dispose(); });
    for (const d of c.doors) { const dk = `${d.tile[0]},${d.tile[1]}`; if (!rebuilding) this.doors.delete(dk); }
    if (!rebuilding) this.chunks.delete(k);
  }
  setRing(scene, c, ring) { c.ring = ring; }

  // ---------- naturaleza y hierba, en bloques de NB × NB trozos ----------
  updateNature(scene, ccx, ccy, t0, budget) {
    const keep = new Set(), gy = (x, y) => this.view.groundY(scene, x, y);
    for (let by = Math.floor((ccy - NEAR) / NB); by <= Math.floor((ccy + NEAR) / NB); by++) for (let bx = Math.floor((ccx - NEAR) / NB); bx <= Math.floor((ccx + NEAR) / NB); bx++) {
      const k = `${bx},${by}`, datas = [];
      keep.add(k);
      let ring = Infinity;
      for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) { const cx = bx * NB + i, cy = by * NB + j; datas.push([cx, cy, scene.contentFor(cx, cy)]); ring = Math.min(ring, Math.max(Math.abs(cx - ccx), Math.abs(cy - ccy))); }
      let b = this.nature.get(k);
      const same = b && b.datas.every((d, i) => d[2] === datas[i][2]);
      if (!same || !b) {
        if (b && performance.now() - t0 > budget) { this.natureRing(scene, b, ring); continue; }
        if (!b && performance.now() - t0 > budget * 2) continue;
        // Qué hay: la naturaleza (lo que genera el mundo y lo plantado) y, para la hierba, todo lo demás
        const nat = [], shakers = new Map();
        for (const [, , d] of datas) for (const o of d.objects) {
          if (NATURE.has(o.kind) && !o.poi) { nat.push(o); shakers.set(o.key, o); }
          else if (o.sapling) nat.push({ kind: 'sapling', tree: o.sapling, x: o.x, y: o.y, key: o.key });
        }
        const natSig = nat.map(o => o.key + (o.bare ? '-' : '')).join(','), gSig = datas.map(([cx, cy, d]) => this.signature(scene, cx, cy, d)).join('|');
        if (!b) { b = { group: new THREE.Group(), nat: null, ground: null, bx, by }; this.group.add(b.group); this.nature.set(k, b); }
        if (natSig !== b.natSig) {
          if (b.nat) { b.group.remove(b.nat.group); b.nat.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); }
          b.nat = buildNatureChunk(nat, scene.gen.season, gy, true);
          b.group.add(b.nat.group);
          b.natSig = natSig; b.shadow = null;
        }
        b.shakers = shakers;
        if (gSig !== b.gSig) { if (b.ground) { b.group.remove(b.ground); b.ground.geometry.dispose(); b.ground = null; } b.groundJob = null; }
        b.gSig = gSig; b.datas = datas; b.occ = occupied(scene, datas);
      }
      this.natureRing(scene, b, ring);
    }
    for (const [k, b] of this.nature) if (!keep.has(k)) { this.dropNature(b); this.nature.delete(k); }
    // La hierba, poco a poco (un trozo de un bloque cada vez, mientras quede tiempo; de golpe al empezar)
    for (const b of this.nature.values()) {
      while (b.groundJob) {
        const r = b.groundJob.next();
        if (r.done) { b.groundJob = null; b.ground = r.value; b.group.add(b.ground); }
        if (performance.now() - t0 > budget) break;
      }
      if (performance.now() - t0 > budget) break;
    }
  }
  // Lo que depende de lo cerca que está: la hierba (solo cerca) y si da sombra
  natureRing(scene, b, ring) {
    const wantGround = ring <= GROUND_R, shadow = ring <= SHADOW_R;
    if (wantGround && !b.ground && !b.groundJob) {
      const T = this.view.terrain, occ = b.occ;
      b.groundJob = buildGround(b.bx * NB, b.by * NB, NB, CHUNK, scene.gen, scene.gen.season, (x, y) => !occ.has(`${Math.floor(x)},${Math.floor(y)}`) && village.isGrass(x, y), (x, y) => T.heightAt(x, y));
    } else if (!wantGround) { if (b.ground) { b.group.remove(b.ground); b.ground.geometry.dispose(); b.ground = null; } b.groundJob = null; }
    if (b.shadow !== shadow) { b.shadow = shadow; b.nat.group.traverse(o => { if (o.isMesh && o.userData.base) o.castShadow = shadow && o.userData.cast !== false; }); }
  }
  dropNature(b) {
    this.group.remove(b.group);
    b.nat?.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
    b.ground?.geometry.dispose();
  }
  // Pone un modelo (por su nombre) en (x, z) girado yaw: sus piezas a las mallas del trozo; lo demás, aparte
  // off: apagado (una lámpara, una antorcha, una vela, un hogar): sin luz, llama ni humo, y lo que brilla, apagado
  placeModel(name, x, z, yaw, emit, c, group, off = false) {
    const m = getModel(name);
    if (!m) return;
    for (const [key, B] of m.parts) emit(off ? UNLIT[key] || key : key, '').add(B.transformed(x, 0, z, yaw));
    const cs = Math.cos(yaw), sn = Math.sin(yaw), at = (p) => [x + p[0] * cs + p[2] * sn, p[1], z - p[0] * sn + p[2] * cs];
    for (const e of m.extras) {
      const o = e.clone();
      o.position.set(...at([e.position.x, e.position.y, e.position.z])); o.rotation.y += yaw;
      o.traverse(q => { if (q.isMesh) { q.castShadow = true; q.receiveShadow = true; } });
      if (o.userData.spin) (c.spin ||= []).push(o);   // (lo que gira: la rueda de la noria)
      group.add(o);
    }
    if (!off) for (const l of m.lights) c.lights.push({ ...l, ...Object.fromEntries(['x', 'y', 'z'].map((k, i) => [k, at([l.x, l.y, l.z])[i]])) });
    if (!off) for (const f of m.fires) c.flames.push([...at(f), f[3]]);
    if (!off) for (const s of m.smoke) c.smoke.push(at(s));
    if (m.fountain) c.fountain = at(m.fountain);
    if (m.beacon) c.beacon = at(m.beacon);
  }
  // Flores y hojas de las jardineras (instancias, en el grupo de su pared)
  flowers(ex, region, group) {
    for (const [list, key] of [[ex.blooms, 'bloom'], [ex.leaves, 'leaves']]) {
      if (!list.length) continue;
      const bySide = new Map();
      for (const it of list) { if (!bySide.has(it.side)) bySide.set(it.side, []); bySide.get(it.side).push(it); }
      for (const [side, l] of bySide) {
        const fk = region && side !== 'free' ? `${region}|${side}` : '';
        const im = new THREE.InstancedMesh(FLOWER, fk ? this.fadeMat(fk, key) : this.mat(key), l.length), o = new THREE.Object3D();
        l.forEach((it, i) => { o.position.set(...it.p); o.scale.set(...(typeof it.s === 'number' ? [it.s, it.s, it.s] : it.s)); o.rotation.set(i, i * 2, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); if (it.c) im.setColorAt(i, new THREE.Color(it.c)); });
        im.castShadow = true;
        im.computeBoundingSphere();
        group.add(im);
      }
    }
  }
  // ¿Puede haber hierba en (x, y)? Ni camino ni construido ni labrado ni cultivado
  free(scene, x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!village.isGrass(x, y)) return false;
    if (scene.at('floor', tx, ty) || scene.at('placed', tx, ty)) return false;
    if (scene.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.tilled?.[`${tx},${ty}`] !== undefined) return false;
    return !scene.layers.some(l => l.blocks?.(tx, ty));
  }

  // Materiales: los de los modelos y los de las piezas (los tejados, 'roof:<id>'); los de las paredes de cada
  // casa, propios (para desvanecerlos)
  mat(key) { const B = baseMaterials(), T = tintMats(); if (key.startsWith('roof:')) return B.roofs[key.slice(5)]; return T[key] || B[key] || modelMat(key); }
  fadeMat(fadeKey, key) {
    let m = this.fadeMats.get(fadeKey);
    if (!m) this.fadeMats.set(fadeKey, (m = new Map()));
    if (!m.has(key)) { const base = this.mat(key), c = base.clone(); if (!c.transparent) c.alphaHash = true; c.userData.base = c.opacity; m.set(key, c); }
    return m.get(key);
  }
  *glassMats() { yield baseMaterials().glass; for (const m of this.fadeMats.values()) if (m.has('glass')) yield m.get('glass'); }

  // ---------- lo lejano ----------
  updateFar(scene, ccx, ccy, t0, budget) {
    const bx = Math.floor(ccx / FAR_BLOCK), by = Math.floor(ccy / FAR_BLOCK), keep = new Set();
    for (let dy = -FAR_R; dy <= FAR_R; dy++) for (let dx = -FAR_R; dx <= FAR_R; dx++) {
      const k = `${bx + dx},${by + dy}`;
      keep.add(k);
      if (this.far.has(k) || performance.now() - t0 > budget * 2) continue;
      const objs = [];
      for (let j = 0; j < FAR_BLOCK; j++) for (let i = 0; i < FAR_BLOCK; i++) {
        const cx = (bx + dx) * FAR_BLOCK + i, cy = (by + dy) * FAR_BLOCK + j;
        for (const o of scene.gen.content(cx, cy).objects) if (NATURE.has(o.kind) && o.kind !== 'bush' && o.kind !== 'rock' && o.kind !== 'deadBush') objs.push(o);
      }
      const g = buildFarNature(objs, scene.gen.season, (x, y) => this.view.groundY(scene, x, y));
      g.traverse(o => { if (o.material) this.hideNear(o.material); });
      this.far.set(k, g);
      this.group.add(g);
    }
    for (const [k, g] of this.far) if (!keep.has(k)) { this.group.remove(g); this.far.delete(k); }
  }
  // Los árboles lejanos que caen en los trozos cercanos no se pintan (ahí están los de verdad)
  hideNear(m) {
    if (m.userData.hideNear) return;
    m.userData.hideNear = true;
    const prev = m.onBeforeCompile, U = this.nearUniform;
    m.onBeforeCompile = (sh, r) => {
      prev?.(sh, r);
      sh.uniforms.nearBox = U;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec4 nearBox;').replace('#include <project_vertex>', `#include <project_vertex>
        vec4 ip = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        if (ip.x > nearBox.x && ip.x < nearBox.y && ip.z > nearBox.z && ip.z < nearBox.w) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`);
    };
    m.customProgramCacheKey = () => 'far' + (prev ? prev.toString().length : 0);
    m.needsUpdate = true;
  }

  // ---------- el pueblo ----------
  updateVillage(scene) {
    if (scene.village === this.villageRef) return;
    if (this.villageGroup) this.group.remove(this.villageGroup);
    this.villageRef = scene.village;
    const g = new THREE.Group(), sinks = new Map(), emit = key => { const tint = tintOf(key), bucket = tint ? tint[0] : key; let b = sinks.get(bucket); if (!b) sinks.set(bucket, (b = new Builder())); return b.tint(tint ? tint[1] : null); };
    const c = { lights: [], flames: [], smoke: [] }, nat = [];
    for (const o of scene.village.objects) {
      if (o.nature) { nat.push({ kind: o.nature, x: o.x, y: o.y, key: 'v:' + o.x + ',' + o.y }); continue; }
      if (!o.model) continue;
      // Lo que se apoya en una esquina de su huella (puestos, muelle) va centrado en ella
      const x = o.fx ? (o.fx[0] + o.fx[1]) / 2 : o.x, z = o.fy ? (o.fy[0] + o.fy[1]) / 2 : o.y;
      const name = 'village:' + o.model;
      this.placeModel(name, x, z, 0, emit, c, g);
    }
    g.add(buildNatureChunk(nat, scene.gen.season, () => 0, true).group);
    for (const [k, B] of sinks) { const m = B.mesh(this.mat(k)); m.castShadow = m.receiveShadow = true; g.add(m); }
    g.add(pondDecor());
    this.villageLights = c;
    this.villageGroup = g;
    this.group.add(g);
  }

  // ---------- regiones de tejado ----------
  // Región de tejado de una casilla (o '' si no tiene tejado). Se calcula la primera vez que se pregunta
  regionAt(scene, tx, ty) {
    const k = `${tx},${ty}`;
    if (this.regionOf.has(k)) return this.regionOf.get(k);
    if (!scene.roofAt(tx, ty)) return '';
    const tiles = [], seen = new Set([k]), todo = [[tx, ty]];
    while (todo.length && seen.size <= 900) {
      const [x, y] = todo.pop();
      tiles.push([x, y]);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { const nk = `${nx},${ny}`; if (!seen.has(nk) && scene.roofAt(nx, ny)) { seen.add(nk); todo.push([nx, ny]); } }
    }
    let key = null, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of tiles) { if (key === null || y < +key.split(',')[1] || (y === +key.split(',')[1] && x < +key.split(',')[0])) key = `${x},${y}`; x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
    key = `${key}:${tiles.length}`;
    // Si alguna de sus casillas era de otra región (la casa ha crecido o se ha partido), aquella ya no vale
    const old = new Set(tiles.map(([x, y]) => this.regionOf.get(`${x},${y}`)).filter(Boolean));
    for (const o of old) { const r = this.regions.get(o); if (r && o !== key) this.invalidateRegion(r); }
    for (const [x, y] of tiles) this.regionOf.set(`${x},${y}`, key);
    if (!this.regions.has(key)) this.regions.set(key, { key, tiles, box: { x0, x1, y0, y1 }, roof: null, dirty: true });
    return key;
  }
  invalidateRegion(r) {
    this.dropRegion(r);
    this.regions.delete(r.key);
    for (const [x, y] of r.tiles) this.regionOf.delete(`${x},${y}`);
    // Los trozos que la tocan se rehacen (sus paredes la llevan apuntada)
    for (const c of this.chunks.values()) if (c.regions.has(r.key)) c.force = true;
  }
  dropRegion(r) {
    for (const k of ['roof', 'ceil']) if (r[k]) { this.group.remove(r[k]); r[k].traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
    if (r.lamp) this.group.remove(r.lamp);
    r.roof = r.lamp = r.ceil = null;
  }
  updateRegions(scene) {
    for (const r of this.regions.values()) {
      if (!r.dirty) continue;
      r.dirty = false;
      r.roof = roofRegion(scene, r.tiles, r.key);
      const mats = [];
      r.roof.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material = this.fadeMat(r.key + '|roof', matKeyOf(o.material)); mats.push(o.material); } });
      this.group.add(r.roof);
      // El techo por dentro: tablas y vigas (se ve solo con la cámara por debajo, ver updateFade)
      const floor = r.tiles.filter(([x, y]) => scene.at('floor', x, y));
      if (floor.length) { r.ceil = this.ceiling(floor, r.box); this.group.add(r.ceil); }
      // Candelabro en el centro de las casas (las regiones con suelo), salvo si ya tienen uno colgado
      if (floor.length > 4) {
        let sx = 0, sy = 0;
        for (const [x, y] of floor) { sx += x + 0.5; sy += y + 0.5; }
        r.center = [sx / floor.length, sy / floor.length];
        const lamp = new THREE.Group(), sinks = new Map();
        for (const [key, B] of CHANDELIER.parts) { const m = B.mesh(this.mat(key)); m.castShadow = false; lamp.add(m); sinks.set(key, m); }
        lamp.position.set(r.center[0], WALL_H, r.center[1]);
        r.flames = CHANDELIER.fires.map(f => [f[0] + r.center[0], f[1] + WALL_H, f[2] + r.center[1], f[3]]);
        r.lamp = lamp;
        this.group.add(lamp);
      }
      // Altura del tejado en (x, z), para que la cámara pase por encima
      const edges = [], has = (x, y) => this.regionOf.get(`${x},${y}`) === r.key;
      for (const [x, y] of r.tiles) { if (!has(x, y - 1)) edges.push([x, y, x + 1, y]); if (!has(x, y + 1)) edges.push([x, y + 1, x + 1, y + 1]); if (!has(x - 1, y)) edges.push([x, y, x, y + 1]); if (!has(x + 1, y)) edges.push([x + 1, y, x + 1, y + 1]); }
      r.top = (px, py) => { let best = Infinity; for (const e of edges) { const d = Math.max(Math.max(e[0] - px, 0, px - e[2]), Math.max(e[1] - py, 0, py - e[3])); if (d < best) best = d; } return WALL_H + ROOF.thick + Math.min(best, ROOF.cap) * ROOF.level; };
    }
  }
  // El techo de una casa por dentro: tablas de madera (que solo se ven desde abajo) y una viga oscura cada
  // dos filas, de pared a pared
  ceiling(floor, box) {
    const g = new THREE.Group(), boards = new Builder(), beams = new Builder(), y = WALL_H - 0.01, has = new Set(floor.map(t => String(t)));
    for (const [x, z] of floor) {
      boards.box(x, y - 0.02, z, x + 1, y, z + 1, { skip: 'px nx py pz nz' });
      if ((z - box.y0) % 2 === 1) {
        const x0 = has.has(String([x - 1, z])) ? x : x + 0.02, x1 = has.has(String([x + 1, z])) ? x + 1 : x + 0.98;
        beams.box(x0, y - 0.18, z + 0.43, x1, y - 0.02, z + 0.57, { skip: 'py' });
      }
    }
    for (const [B, key] of [[boards, 'plank'], [beams, 'dark']]) if (!B.empty) { const m = B.mesh(this.mat(key)); m.castShadow = false; m.receiveShadow = false; g.add(m); }
    g.visible = false;
    return g;
  }
  // ¿Cuelga de esta casa algún candelabro puesto por el jugador? (entonces no lleva el suyo); se mira de vez en cuando
  ownLamp(r) {
    const s = this.game?.world, t = performance.now() / 1000;
    if (!s || (r.lampAt ?? -9) > t - 0.5) return r.hasLamp;
    r.lampAt = t;
    r.hasLamp = r.tiles.some(([x, y]) => { const v = s.at('placed', x, y); return v && parsePlaced(v)[0] === 'candelabro'; });
    if (r.lamp) r.lamp.visible = !r.hasLamp;
    return r.hasLamp;
  }
  // Cajas de las casas cercanas (para que la cámara no se meta detrás de un tejado)
  houseBoxes() {
    const t = this.view.cam.target, out = [];
    for (const r of this.regions.values()) {
      const b = r.box;
      if (b.x1 < t.x - 50 || b.x0 > t.x + 50 || b.y1 < t.z - 50 || b.y0 > t.z + 50 || !r.top) continue;
      r.cam ||= { x0: b.x0 - ROOF.over, x1: b.x1 + ROOF.over, z0: b.y0 - ROOF.over, z1: b.y1 + ROOF.over, top: (x, z) => r.top(x, z), region: r };
      out.push(r.cam);
    }
    return out;
  }
  // ¿Hay suelo construido aquí? (el jugador pisa un poco más alto)
  floorAt(x, y) { return !!this.scene?.at('floor', Math.floor(x), Math.floor(y)); }

  // ---------- puertas y casas por dentro ----------
  updateDoors(scene, dt) {
    for (const d of this.doors.values()) {
      const want = scene.doorClosed(...d.tile) ? 0 : 1;
      if (Math.abs(want - d.amount) < 1e-3) continue;
      d.amount += (want - d.amount) * Math.min(1, dt * 7);
      d.leaf.userData.setAngle(d.amount);
    }
  }
  updateFade(game, scene, dt) {
    // El techo por dentro, solo con la cámara por debajo de él (en primera persona o muy baja): desde arriba no tapa
    const below = this.view.camera.position.y < WALL_H;
    for (const r of this.regions.values()) if (r.ceil) r.ceil.visible = below;
    // La casa en la que está el jugador: la región de tejado bajo sus pies (si está a cubierto)
    const p = game.player, inside = p && game.scene === scene && game.underRoof ? this.regionOf.get(`${Math.floor(p.x)},${Math.floor(p.y)}`) || null : null;
    const reg = inside ? this.regions.get(inside) : null;
    this.insideHouse = reg?.cam || (reg ? (this.houseBoxes(), reg.cam) : null);
    const toCam = [Math.sin(CAM.yaw), Math.cos(CAM.yaw)], N = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
    for (const [fk, mats] of this.fadeMats) {
      const [region, side] = fk.split('|');
      let goal = 1;
      if (region === inside && !CAM.first) goal = side === 'roof' ? 0 : N[side] && N[side][0] * toCam[0] + N[side][1] * toCam[1] > 0.12 ? 0 : 1;
      const v = this.fade.get(fk) ?? 1;
      if (v === goal) continue;
      const o = goal > v ? Math.min(goal, v + dt * 4) : Math.max(goal, v - dt * 4);
      this.fade.set(fk, o);
      // Del todo oculta: no se pinta, pero sigue opaca para el mapa de sombras (el tejado da sombra dentro)
      const on = o > 0.01;
      for (const m of mats.values()) { m.opacity = m.userData.base * (on ? o : 1); if (m.colorWrite !== on) { m.colorWrite = on; m.depthWrite = on && !m.transparent; } }
    }
  }

  // ---------- luces, fuegos y humo cercanos ----------
  lights() {
    const out = [];
    for (const c of this.chunks.values()) for (const l of c.lights) out.push(l);
    if (this.villageLights) for (const l of this.villageLights.lights) out.push(l);
    for (const r of this.regions.values()) if (r.center && !this.ownLamp(r) && !this.chandelierOff(r)) out.push({ x: r.center[0], y: WALL_H - 0.6, z: r.center[1], color: '#ffd08a', intensity: 4.5, range: 11 });
    return out;
  }
  flames() {
    const out = [];
    for (const c of this.chunks.values()) for (const f of c.flames) out.push(f);
    if (this.villageLights) for (const f of this.villageLights.flames) out.push(f);
    for (const r of this.regions.values()) if (r.flames && !this.ownLamp(r) && !this.chandelierOff(r)) for (const f of r.flames) out.push(f);
    return out;
  }
  // El candelabro de una casa: se apaga y se enciende como las demás luces (se guarda con la casilla de su centro)
  chandelierOff(r) { const s = this.game?.world, [x, y] = r.center.map(Math.floor); return !!s?.lightOff(x, y, `c:${x},${y}`); }
  // (la casilla de su centro; exact: el punto del que cuelga)
  chandelierNear(x, y, d = 2.2, exact = false) {
    for (const r of this.regions.values()) if (r.center && !this.ownLamp(r) && Math.hypot(r.center[0] - x, r.center[1] - y) < d) return exact ? r.center : r.center.map(Math.floor);
    return null;
  }
  smoke() {
    const out = [];
    for (const c of this.chunks.values()) for (const s of c.smoke) out.push(s);
    for (const r of this.regions.values()) if (r.roof) for (const s of r.roof.userData.chimneys) out.push(s);
    return out;
  }
  fountains() { const out = []; for (const c of this.chunks.values()) if (c.fountain) out.push(c.fountain); if (this.villageLights?.fountain) out.push(this.villageLights.fountain); return out; }
}
// Clave de un material base (para clonarlo para una región)
function matKeyOf(m) {
  const B = baseMaterials();
  for (const [k, v] of Object.entries(B)) { if (v === m) return k; if (k === 'roofs') for (const [rk, rv] of Object.entries(v)) if (rv === m) return 'roof:' + rk; }
  return 'stone';
}
// Casillas ocupadas de unos trozos (ahí no crece hierba): lo construido y colocado, lo labrado, los cultivos y
// los lugares (que ocupan 3 × 3 casillas)
function occupied(scene, datas) {
  const occ = new Set();
  for (const [cx, cy, d] of datas) {
    for (const o of d.objects.concat(d.flats, d.floors)) {
      if (o.tile && (o.layer || o.crop || o.treasure)) occ.add(`${o.tile[0]},${o.tile[1]}`);
      if (o.poi || o.fx) for (let y = Math.floor(o.fy?.[0] ?? o.y - 1.5); y < Math.ceil(o.fy?.[1] ?? o.y + 1.5); y++) for (let x = Math.floor(o.fx?.[0] ?? o.x - 1.5); x < Math.ceil(o.fx?.[1] ?? o.x + 1.5); x++) occ.add(`${x},${y}`);
    }
    for (const t of d.tilled) occ.add(`${t[0]},${t[1]}`);
    const dl = scene.delta(cx, cy);
    for (const k of Object.keys(dl?.crops || {})) occ.add(k);
  }
  return occ;
}
// Muros y tejados de un trozo (si cambian, cambian las casas)
function structure(data) {
  let s = '';
  for (const o of data.objects) if (o.layer === 'roof' || (o.layer === 'placed' && PIECES[o.placed])) s += o.key + o.placed + ',';
  return s;
}

// Nenúfares, piedras y juncos del estanque del pueblo
function pondDecor() {
  const g = new THREE.Group(), P = village.POND, rnd = (() => { let a = 77; return () => ((a = (a * 9301 + 49297) % 233280) / 233280); })();
  const padGeo = new THREE.CircleGeometry(0.32, 16, 0.4, Math.PI * 2 - 0.5); padGeo.rotateX(-Math.PI / 2);
  const padMat = modelMat('leaf'), WY = -0.12;
  for (const [ax, ay, fl] of [[0.3, -0.2, 1], [-0.35, 0.25, 1], [0.1, 0.45, 0], [-0.5, -0.3, 0], [0.55, 0.2, 0], [-0.1, -0.5, 0]]) {
    const m = new THREE.Mesh(padGeo, padMat); m.position.set(P.x + ax * P.rx, WY + 0.012, P.y + ay * P.ry); m.rotation.y = rnd() * 6; m.receiveShadow = true; g.add(m);
    if (fl) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.12, 8, 1, true), modelMat('fruit:#ffb8d8')); f.rotation.x = Math.PI; f.position.set(m.position.x + 0.05, WY + 0.08, m.position.z); g.add(f); }
  }
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), modelMat('rock'), 30), o = new THREE.Object3D();
  for (let i = 0; i < 30; i++) { const a = (i / 30) * Math.PI * 2, s = 0.12 + rnd() * 0.12; o.position.set(P.x + Math.cos(a) * P.rx * 1.1, s * 0.2 - 0.02, P.y + Math.sin(a) * P.ry * 1.1); o.rotation.set(rnd(), rnd() * 6, rnd()); o.scale.set(s * 1.3, s * 0.7, s); o.updateMatrix(); rocks.setMatrixAt(i, o.matrix); }
  rocks.castShadow = rocks.receiveShadow = true; g.add(rocks);
  const reedGeo = new THREE.CylinderGeometry(0.008, 0.014, 1, 4); reedGeo.translate(0, 0.5, 0);
  const reeds = new THREE.InstancedMesh(reedGeo, modelMat('leafD'), 120);
  for (let i = 0; i < 120; i++) { const a = rnd() * Math.PI * 2, d = 0.96 + rnd() * 0.1; o.position.set(P.x + Math.cos(a) * P.rx * d + (rnd() - 0.5) * 0.12, WY, P.y + Math.sin(a) * P.ry * d + (rnd() - 0.5) * 0.12); o.rotation.set((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25); o.scale.set(1, 0.5 + rnd() * 0.5, 1); o.updateMatrix(); reeds.setMatrixAt(i, o.matrix); }
  reeds.castShadow = true; g.add(reeds);
  return g;
}
