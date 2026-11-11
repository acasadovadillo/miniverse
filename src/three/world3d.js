// El mundo de fuera en 3D, por trozos de 16 casillas: lo que el juego dice que hay en cada uno
// (`Overworld.contentFor`) se convierte en mallas. Cerca de la cámara va todo (naturaleza, hierba, lo
// construido, muebles, estaciones, cultivos, lugares); más lejos, solo los árboles (impostores: impostor.js) y las
// rocas, sin sombra, en bloques grandes, hasta donde llega la niebla. Entre lo de cerca y lo lejano no hay salto: una
// máscara por trozo dice dónde está ya el árbol de cerca, y los dos se funden con tramados complementarios. Cada trozo
// se rehace solo cuando cambia lo que tiene. Los tejados van por regiones (toda la superficie unida, aunque cruce trozos) y, con el jugador dentro
// de una casa, se ocultan el tejado y las paredes que dan a la cámara (siguen dando sombra).
import { WATER_Y } from './terrain.js';
import { boatModel } from './actors.js';
import * as THREE from 'three';
import { CHUNK, GRASS_REGROW } from '../world/gen.js';
import * as village from '../world/village.js';
import { PIECES } from '../pieces.js';
import { CAM } from '../camera.js';
import { Builder } from './geo.js';
import { buildNatureChunk, buildGround, buildFarNature, shake, WIND, GRASS, TUFT_LOD, tuftLods, DITHER, nearFadeSet, releaseFadeSet, fadeMeshes } from './nature3d.js';
import { ImpostorAtlas, buildFarImpostors, IMPOSTORS_ON, MASK, MASK_GLSL } from './impostor.js';
import { wrapIndex } from '../world/planet.js';
import { roofShape } from '../world/roof.js';
import { baseMaterials, wallTile, doorTile, doorLeaf, gateTile, gateLeaf, fenceTile, floorTile, roofRegion, paintKey, WALL_H, ROOF, FLOWER } from './build3d.js';
import { getModel, modelMat } from './models.js';
import { poolGround } from './glow.js';
import { yawOf } from '../art/stations.js';
// Lo que brilla en los modelos y, apagado, con qué se dibuja
let BOAT = null;   // (el modelo de la barca, para las amarradas)
const UNLIT = { shade: 'cloth', lamp: 'white', ember: 'soot', glow: 'soot', crystal: 'crystal' };
import { tintMats, tintOf } from './tints.js';

const NEAR = 3;          // trozos alrededor del de la cámara con todo
const NB = 2;            // la naturaleza y la cubierta del suelo van en bloques de NB × NB trozos (menos mallas)
const GROUND_R = 3;      // trozos alrededor con matas de hierba (cada trozo, su malla)
const COVER_R = 2;       // … con la cubierta del suelo (juncos, piedrecitas, setas), por bloque
// Dónde se acaba la hierba: poco a poco, en un círculo alrededor del objetivo de la cámara. Cabe siempre en los trozos
// con matas (los de anillo ≤ GROUND_R llegan al menos a GROUND_R × CHUNK casillas en cada eje), así que, al cruzar de
// trozo, los que entran o salen quedan fuera del círculo: nunca se ve aparecer ni irse un trozo de hierba
const FADE = [GROUND_R * CHUNK - 10, GROUND_R * CHUNK - 1];
const VIEW = new THREE.Frustum(), VIEW_M = new THREE.Matrix4();   // (lo que ve la cámara, para recortar las matas)
const SHADOW_R = 2;      // … cuya naturaleza da sombra
const FAR_BLOCK = 4;     // trozos por lado de un bloque lejano
const FAR_R = 2;         // bloques lejanos alrededor
const FAR_KINDS = new Set(['oak', 'fruit', 'pine', 'snowPine', 'swampTree', 'cactus', 'palm', 'boulder', 'snowBoulder']);   // lo que se ve de lejos
const FADE_MS = 600;     // lo que tarda un bloque de naturaleza en fundirse con lo lejano, al llegar y al irse
const NATURE = new Set(['oak', 'fruit', 'pine', 'snowPine', 'swampTree', 'cactus', 'palm', 'boulder', 'rock', 'bush', 'deadBush', 'snowBoulder', 'margarita', 'diente_leon']);

export class World3D {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    view.scene.add(this.group);
    // Lo que se mueve dentro de los modelos (la rueda de la noria, la hoja de una puerta mientras gira), aparte: no es
    // fijo para el mapa de sombras (ver sunshadow.js). Cualquier otra cosa que se anime en un modelo va aquí o avisa con stale()
    this.spin = new THREE.Group();
    view.scene.add(this.spin);
    this.chunks = new Map();       // "cx,cy" → vista del trozo
    this.nature = new Map();       // "bx,by" → bloque de naturaleza (árboles, rocas…) y hierba
    this.far = new Map();          // "bx,by" → bloque lejano
    this.regions = new Map();      // clave → región de tejado { key, tiles, box, roof, top }
    this.regionOf = new Map();     // "tx,ty" → clave de su región
    this.doors = new Map();        // "tx,ty" → { leaf, amount }
    this.fadeMats = new Map();     // "región|lado" → Map(clave de material → material propio)
    this.fade = new Map();         // "región|lado" o "región|roof" → opacidad actual
    this.villageGroup = null; this.villageRef = null;
    this.scene = null; this.season = -1;
    this.insideHouse = null;
    // La máscara de lo cercano: por trozo, cuánto se ve ya el árbol de cerca (0, nada: se ve el lejano; 255, del todo). La
    // leen los impostores y los árboles sencillos de lejos, que solo se apartan donde el de cerca ya está hecho: sin
    // árboles dobles ni huecos mientras se construyen los bloques. Va centrada en la cámara, MASK × MASK trozos: cubre de
    // sobra lo lejano (FAR_R bloques de FAR_BLOCK). impFar: hasta dónde se pinta lo lejano (la niebla)
    this.maskData = new Uint8Array(MASK * MASK); this.maskNext = new Uint8Array(MASK * MASK); this.maskAt = [NaN, NaN];
    this.mask = new THREE.DataTexture(this.maskData, MASK, MASK, THREE.RedFormat);
    this.mask.minFilter = this.mask.magFilter = THREE.NearestFilter; this.mask.needsUpdate = true;
    this.maskU = { impMask: { value: this.mask }, impOrigin: { value: new THREE.Vector2() }, impFar: { value: 150 } };
    this.useImpostors = IMPOSTORS_ON;
    this.impostors = null;         // el atlas de los árboles lejanos (se hornea en el primer fotograma: en el menú)
    this.farSigs = new Map();      // "bx,by" → firma de lo quitado en el bloque lejano (se vuelve a mirar si cambia algún trozo)
    this.removedN = new WeakMap(); // cambios de un trozo → [su versión, cuántas cosas se han quitado de él]
  }

  // ---------- cada fotograma ----------
  update(game, scene, target, dt, snap = false) {
    if (scene !== this.scene || scene.gen.season !== this.season) this.reset(scene);
    this.game = game;
    WIND.value = game.time;
    const ccx = Math.floor(target.x / CHUNK), ccy = Math.floor(target.z / CHUNK);
    this.at = [ccx, ccy];
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
      // (uno nuevo, en el borde de lo que se ve, espera a sus programas de sombreado si trae alguno que la gráfica aún no
      // tiene; uno que se rehace, no: dejaría un hueco donde estaba)
      if (!cur) this.view.gate?.(c.group, null, chunkBox(cx, cy));
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
    this.updateNature(scene, ccx, ccy, t0, budget, snap);
    this.updateFades(snap);
    this.updateMask(ccx, ccy);
    this.updateGrass(target);
    this.updateFar(scene, ccx, ccy, t0, budget);
    this.updateImpostors(scene, game, snap);
    this.updateRegions(scene);
    // Lo que se golpea tiembla
    for (const b of this.nature.values()) for (const [key, o] of b.shakers) {
      const on = o.shakeUntil > game.time;
      // (la sombra no tiembla: el temblor es de unos centímetros y repintar lo fijo cada dos fotogramas mientras dura, a
      // cada golpe del hacha, saldría caro. Al acabar sí, por si lo fijo se repintó a medio temblor)
      if (on || b.shaking?.has(key)) { shake(b.nat, key, on ? Math.sin(game.time * 90) * 0.04 : 0); if (on) (b.shaking ||= new Set()).add(key); else { b.shaking.delete(key); this.stale(false, [o.x - 4, o.y - 4, o.x + 4, o.y + 4]); } }
    }
    this.updateDoors(scene, dt);
    for (const c of this.chunks.values()) if (c.spin) for (const o of c.spin) o.rotation.x += o.userData.spin * dt;
    this.updateFade(game, scene, dt);
    // Las ventanas se encienden de noche; los faroles y la lente del faro, también (de día, apagados: antes brillaban igual a
    // mediodía). Son materiales de todo el mundo: dentro de casa, de día, solo suben las pantallas de las lámparas, que solo
    // se ponen dentro (los faroles de la calle se verían encendidos alrededor de la casa)
    const night = this.view.night, glow = night * 1.2, k = night, ks = Math.max(night, this.game?.indoors ? 0.6 : 0);
    for (const m of this.glassMats()) m.emissiveIntensity = glow;
    if (k !== this.lampK) { this.lampK = k; modelMat('lamp').emissiveIntensity = 0.25 + 1.5 * k; modelMat('lens').emissiveIntensity = 0.5 + 1.5 * k; }
    if (ks !== this.shadeK) { this.shadeK = ks; modelMat('shade').emissiveIntensity = 0.15 + 0.6 * ks; }
  }
  // Ha cambiado algo que da sombra y no se mueve: el mapa de sombras repinta lo fijo (now: en este fotograma; si no,
  // cuando le toque, sin pasar de uno de cada dos)
  // (box: [x0, z0, x1, z1] de lo que ha cambiado, si se sabe)
  stale(now = false, box = null) { this.view.shadows?.stale(now, box); }
  reset(scene) {
    this.stale(true);
    for (const [k, c] of this.chunks) this.dropChunk(k, c);
    for (const b of this.nature.values()) this.dropNature(b);
    this.nature.clear();
    for (const g of this.far.values()) this.dropFar(g);
    this.far.clear();
    for (const r of this.regions.values()) this.dropRegion(r);
    this.regions.clear(); this.regionOf.clear();
    this.scene = scene; this.season = scene.gen.season;
    if (this.villageGroup) this.group.remove(this.villageGroup);
    for (const o of this.villageLights?.spin || []) this.spin.remove(o);
    this.villageGroup = null; this.villageRef = null; this.villageLights = null;
    // (lo primero que se monta después, al cambiar de estación o de mundo, sale de golpe: detrás no hay nada con lo que
    // fundirse, que lo lejano también se está rehaciendo, y su sombra saldría entera mientras él aún va tramado)
    this.freshNature = true;
  }

  // La casa en la que se está (el establo), sin tejado; se rehace su trozo al entrar y al salir
  showInside(o) {
    const key = o?.key || null;
    if (key === (this.insideKey ?? null)) return;
    for (const t of [this.insideTile, o?.tile]) { const c = t && this.chunks.get(`${Math.floor(t[0] / CHUNK)},${Math.floor(t[1] / CHUNK)}`); if (c) c.force = true; }
    this.insideKey = key; this.insideTile = o?.tile || null;
  }
  // ¿Está ahora oculto lo de este lado de la casa? (las paredes que dan a la cámara y el tejado, desde dentro)
  faded(tx, ty, side) { const r = this.regionOf.get(`${tx},${ty}`); return !!r && (this.fade.get(`${r}|${side}`) ?? 1) < 0.5; }
  // Firma de un trozo: si no cambia, no hace falta rehacerlo (el juego rehace sus datos cada pocos segundos)
  signature(scene, cx, cy, data) {
    const farm = this.farm(scene), d = scene.delta(cx, cy), today = farm?.today;
    let s = '';
    for (const o of data.objects) s += o.key + (o.crop ? ':' + farm.stage(o.crop) : '') + (o.open ? '!' : '') + (o.placed ? o.placed + (o.rot || 0) : '') + (o.model ? ':' + o.model : '') + (o.off ? '~' : '') + (o.tuck ? '^' : '') + (o.mask !== undefined ? `m${o.mask}` : '') + (o.door ? `d${o.door}` : '') + (o.free ? `@${o.x.toFixed(2)},${o.y.toFixed(2)},${o.yaw.toFixed(2)}` : '') + (o.window && scene.doorClosed(...o.tile) ? '#' : '') + ',';   // (~: apagado; #: ventana cerrada)
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
    const c = { group, data, ring, sig: this.signature(scene, cx, cy, data), lights: [], flames: [], smoke: [], doors: [], regions: new Set(), windows: [], cx, cy };
    // Lo construido y lo colocado, juntado por material (y lo de cada pared de cada casa, aparte)
    const sinks = new Map(), extras = { blooms: [], leaves: [] };
    // La altura de cada casilla (lo construido va a la suya: ver scenes.js, levelAt): lo que se pinta mientras LIFT vale
    // algo sube eso (cada constructor apunta desde qué vértice va cada altura, y se aplica al final)
    let LIFT = 0;
    const lv = (tx, ty) => scene.levelAt?.(tx + 0.5, ty + 0.5) || 0;
    // (lo que se puede pintar por vértice va a un material compartido, con su color)
    const emitFor = region => (key, side) => {
      const tint = tintOf(key), bucket = tint ? tint[0] : key, k = `${region && side && side !== 'free' && side !== 'floor' ? region + '|' + side : ''}#${bucket}`;
      let b = sinks.get(k);
      if (!b) sinks.set(k, (b = new Builder()));
      if (b.liftNow !== LIFT) { (b.marks ||= []).push([b.pos.length, LIFT]); b.liftNow = LIFT; }
      return b.tint(tint ? tint[1] : null);
    };
    const plain = emitFor('');
    const struct = new Map();   // (las casillas con piezas de construcción, para su cimiento: 'full' o 'post')
    for (const o of data.floors) { LIFT = lv(...o.tile); struct.set(`${o.tile[0]},${o.tile[1]}`, 'full'); floorTile(scene, o.tile[0], o.tile[1], o.placed, plain); }
    for (const t of data.tilled) {
      const k = `${t[0]},${t[1]}`, wet = scene.delta(cx, cy)?.wet?.[k] === this.farm(scene)?.today;
      LIFT = lv(t[0], t[1]);
      this.placeModel(`tilled:${wet ? 1 : 0}`, t[0] + 0.5, t[1] + 0.5, 0, plain, c, group, false, LIFT);
    }
    for (const o of data.objects.concat(data.flats)) {
      LIFT = o.poi || o.treasure ? 0 : o.tile ? lv(...o.tile) : lv(Math.floor(o.x), Math.floor(o.y));
      if (o.placed && (o.layer === 'placed' || o.layer === 'hang' || o.layer === 'rug')) {
        const [tx, ty] = o.tile, piece = PIECES[o.placed], region = this.regionAt(scene, tx, ty);
        if (region) c.regions.add(region);
        if (piece) { const tk = `${tx},${ty}`; if (struct.get(tk) !== 'full') struct.set(tk, piece.kind === 'fence' || piece.kind === 'gate' ? 'post' : 'full'); }
        if (piece?.kind === 'wall') { const ex = { blooms: [], leaves: [], paint: paintKey(region), lift: LIFT, windows: c.windows }; wallTile(scene, tx, ty, o.placed, emitFor(region), ex); this.flowers(ex, region, group); }
        else if (piece?.kind === 'door') { const ex = { blooms: [], leaves: [] }; const d = doorTile(scene, tx, ty, emitFor(region), ex); d.region = region; d.lift = LIFT; c.doors.push(d); }
        else if (piece?.kind === 'gate') { const d = gateTile(scene, tx, ty, plain); d.lift = LIFT; c.doors.push(d); }
        else if (piece?.kind === 'fence') fenceTile(scene, tx, ty, o.placed, plain);
        else this.placeModel(o.key === this.insideKey ? `${o.placed}:in` : o.model || o.placed, o.x, o.y, o.yaw ?? yawOf(o.rot), plain, c, group, o.off, LIFT);
      } else if (o.unknown) this.placeModel('unknown', o.x, o.y, o.yaw || 0, plain, c, group, false, LIFT);   // (de una versión más nueva: la caja con «?»)
      else if (o.crop && this.farm(scene)) this.placeModel(`crop:${o.crop.id}:${this.farm(scene).stage(o.crop)}`, o.x, o.y, 0, plain, c, group, false, LIFT);
      else if (o.boat) { const b = (BOAT ||= boatModel()).clone(true); b.position.set(o.x, WATER_Y - 0.12, o.y); b.rotation.y = o.yaw; b.traverse(q => { if (q.isMesh) { q.castShadow = true; q.receiveShadow = true; } }); group.add(b); }   // (una barca amarrada)
      else if (o.poi) this.placeModel(`poi:${o.poi.kind}${o.poi.snow ? ':snow' : ''}`, o.poi.x, o.poi.y, 0, plain, c, group);
      else if (o.treasure) this.placeModel(`treasure:${o.open ? 1 : 0}`, o.x, o.y, 0, plain, c, group);
      else if (o.roof && o.layer === 'roof') { const r = this.regionAt(scene, o.tile[0], o.tile[1]); if (r) c.regions.add(r); }
    }
    // (el suelo bajo cada charco de luz, con su pendiente, al montar el trozo: si cambia el suelo, se rehace con él. Ver glow.js)
    for (const w of c.windows) poolGround(w, w.p[0] + w.n[0] * 1.0, w.p[2] + w.n[1] * 1.0, gy);
    for (const l of c.lights) if (l.pool) poolGround(l, l.x, l.z, gy);
    // Los cimientos: debajo de cada pieza de construcción alzada, piedra hasta el suelo (los suelos y los muros, la casilla
    // entera; las vallas, un dado bajo cada poste)
    LIFT = 0;
    if (scene.levelAt) for (const [tk, kind] of struct) {
      const [tx, ty] = tk.split(',').map(Number), L = lv(tx, ty);
      if (L <= 0.02) continue;
      const g0 = Math.min(...[[tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]].map(([x, y]) => view.terrain.heightAt(x, y))) - 0.25;   // (el suelo de verdad, sin lo construido)
      if (L - g0 < 0.28) continue;
      const B = plain('stone');
      if (kind === 'post') B.box(tx + 0.36, g0, ty + 0.36, tx + 0.64, L, ty + 0.64, { s: 0.6 }); else B.box(tx, g0, ty, tx + 1, L, ty + 1, { s: 0.6 });
    }
    this.flowers(extras, '', group);
    for (const [k, B] of sinks) {
      if (B.empty) continue;
      if (B.marks) for (let m = 0; m < B.marks.length; m++) {   // (cada casilla, a su altura)
        const [from, lift] = B.marks[m], to = m + 1 < B.marks.length ? B.marks[m + 1][0] : B.pos.length;
        if (lift) for (let i = from + 1; i < to; i += 3) B.pos[i] += lift;
      }
      const [fadeKey, key] = k.split('#'), m = fadeKey ? this.fadeMat(fadeKey, key) : this.mat(key), mesh = B.mesh(m);
      mesh.castShadow = key !== 'glass'; mesh.receiveShadow = true;
      if (fadeKey) mesh.userData.fade = fadeKey;
      mesh.userData.own = true;
      group.add(mesh);
    }
    // Puertas: la hoja se anima aparte (y se desvanece con su pared)
    for (const d of c.doors) {
      const k = `${d.tile[0]},${d.tile[1]}`, fk = d.region && d.side !== 'free' ? `${d.region}|${d.side}` : '';
      const M = key => (fk ? this.fadeMat(fk, key) : this.mat(key)), paint = paintKey(d.region);
      const leaf = d.gate ? gateLeaf(d, { fence: this.mat('fence') }) : doorLeaf(d, { door: M('door'), frame: M('frame'), paint: M(paint), iron: M('iron') });
      if (d.lift) leaf.position.y += d.lift;   // (a la altura de su casilla)
      leaf.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const prev = this.doors.get(k);
      const amount = prev ? prev.amount : scene.doorClosed(...d.tile) ? 0 : 1;
      leaf.userData.setAngle(amount);
      group.add(leaf);
      this.doors.set(k, { leaf, amount, tile: d.tile, group });
    }
    group.matrixAutoUpdate = true;
    this.group.add(group);
    this.stale(false, chunkBox(cx, cy));
    return c;
  }
  dropChunk(k, c, rebuilding = false) {
    this.group.remove(c.group);
    for (const o of c.spin || []) this.spin.remove(o);
    this.stale(false, chunkBox(c.cx, c.cy));
    c.group.traverse(o => { if (o.userData.own) o.geometry.dispose(); });
    for (const d of c.doors) {
      const dk = `${d.tile[0]},${d.tile[1]}`, e = this.doors.get(dk);
      if (e?.leaf.parent === this.spin) this.spin.remove(e.leaf);   // (a medio abrirse: estaba aparte, ver updateDoors)
      if (!rebuilding) this.doors.delete(dk);
    }
    if (!rebuilding) this.chunks.delete(k);
  }
  setRing(scene, c, ring) { c.ring = ring; }

  // ---------- naturaleza y hierba, en bloques de NB × NB trozos ----------
  updateNature(scene, ccx, ccy, t0, budget, snap = false) {
    const keep = new Set(), gy = (x, y) => this.view.groundY(scene, x, y), now = performance.now();
    for (let by = Math.floor((ccy - NEAR) / NB); by <= Math.floor((ccy + NEAR) / NB); by++) for (let bx = Math.floor((ccx - NEAR) / NB); bx <= Math.floor((ccx + NEAR) / NB); bx++) {
      const k = `${bx},${by}`, datas = [];
      keep.add(k);
      let ring = Infinity;
      const rings = [];   // (el anillo de cada trozo: las matas van por trozo)
      for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) { const cx = bx * NB + i, cy = by * NB + j, r = Math.max(Math.abs(cx - ccx), Math.abs(cy - ccy)); datas.push([cx, cy, scene.contentFor(cx, cy)]); rings.push(r); ring = Math.min(ring, r); }
      let b = this.nature.get(k);
      // (si se estaba yendo, vuelve: se funde de vuelta desde donde iba)
      if (b && b.leaving != null) { b.born = now - b.fadeNow * FADE_MS; b.leaving = null; }
      // (también se vuelve a mirar cuando el suelo ha cambiado de forma: ver padStamp)
      const T = this.view.terrain, padV = T?.padV ?? 0, same = b && b.padV === padV && b.datas.every((d, i) => d[2] === datas[i][2]);
      if (!same || !b) {
        if (b && performance.now() - t0 > budget) { this.natureRing(scene, b, ring, rings); continue; }
        if (!b && performance.now() - t0 > budget * 2) continue;
        // Qué hay: la naturaleza (lo que genera el mundo y lo plantado) y, para la hierba, todo lo demás
        const nat = [], shakers = new Map();
        for (const [, , d] of datas) for (const o of d.objects) {
          if (NATURE.has(o.kind) && !o.poi) { nat.push(o); shakers.set(o.key, o); }
          else if (o.sapling) nat.push({ kind: 'sapling', tree: o.sapling, x: o.x, y: o.y, key: o.key });
        }
        // (el allanado, el que tiene ahora el suelo: si se quita algo de antes, el suelo vuelve a subir cuando se rehace su
        // malla, que puede ser medio segundo después, y lo de encima se rehace entonces; ver padStamp)
        const pad = (x0, y0, n) => (T?.padStamp && scene.padSig ? T.padStamp(x0 * CHUNK, y0 * CHUNK, (x0 + n) * CHUNK, (y0 + n) * CHUNK) : '');
        const natSig = nat.map(o => o.key + (o.bare ? '-' : '')).join(',') + '|' + pad(bx * NB, by * NB, NB);
        // (las firmas de la hierba, por trozo: lo que hay en él, el allanado de su suelo y sus casillas ocupadas, segadas
        // incluidas, aunque lo que las ocupa sea de otro trozo; la de la cubierta, sin lo segado)
        const occ = occupied(scene, datas, this.today()), sigs = datas.map(([cx, cy, d]) => this.signature(scene, cx, cy, d) + '|p' + pad(cx, cy, 1)), coverSig = sigs.join('|');
        const oh = occHashes(occ, datas);
        for (let i = 0; i < sigs.length; i++) sigs[i] += '|o' + oh[i];
        const fresh = !b;
        if (!b) {
          b = { group: new THREE.Group(), nat: null, ground: new THREE.Group(), tufts: new Map(), cover: null, coverSig: null, bx, by };
          b.group.add(b.ground); this.group.add(b.group); this.nature.set(k, b);
        }
        if (natSig !== b.natSig) {
          if (b.nat) { b.group.remove(b.nat.group); b.nat.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); }
          else b.born = snap || this.freshNature ? -Infinity : now;   // (la primera vez, aparece fundiéndose con lo lejano; de golpe, si se salta o justo después de reset)
          b.nat = buildNatureChunk(nat, scene.gen.season, gy, true);
          b.group.add(b.nat.group);
          b.natSig = natSig; b.shadow = null;
          this.stale(false, blockBox(b));
          if (fresh) this.view.gate?.(b.group, null, blockBox(b));   // (un bloque nuevo, con un árbol que aún no tiene programa: ver engine.js, gate)
        }
        b.shakers = shakers;
        // (si cambia algo, el trabajo a medias se deja y se vuelve a pedir; lo hecho se queda hasta que llega lo nuevo: sin huecos)
        if (b.sigs && (coverSig !== b.coverSig0 || sigs.some((g, i) => g !== b.sigs[i]))) b.groundJob = null;
        b.sigs = sigs; b.coverSig0 = coverSig; b.datas = datas; b.occ = occ; b.padV = padV;
      }
      this.natureRing(scene, b, ring, rings);
    }
    // (en cuanto están todos los de alrededor, lo que llegue ya se funde)
    if (this.freshNature && [...keep].every(k => this.nature.get(k)?.nat)) this.freshNature = false;
    // Lo que queda lejos se va fundiéndose con lo lejano (updateFades lo suelta al acabar); su hierba y su cubierta, en el
    // acto (ya quedaban fuera del círculo de la hierba). Al saltar, de golpe
    for (const [k, b] of this.nature) if (!keep.has(k)) {
      if (snap || !b.nat || !(b.fadeNow > 0)) { this.dropNature(b); this.nature.delete(k); continue; }
      if (b.leaving != null) continue;
      b.leaving = now - (1 - b.fadeNow) * FADE_MS;
      for (const i of [...b.tufts.keys()]) this.dropTufts(b, i);
      this.dropCover(b); b.groundJob = null;
    }
    // La hierba, poco a poco (un trozo cada vez, mientras quede tiempo; de golpe al empezar), de los bloques más cercanos a
    // los más lejanos: lo que se siega junto al jugador sale enseguida. Cada trozo hecho cambia su malla en el acto
    const jobs = [...this.nature.values()].filter(b => b.groundJob).sort((a, b) => a.ring - b.ring);
    for (const b of jobs) {
      while (b.groundJob) {
        const job = b.groundJob, r = job.gen.next();
        if (r.done) {
          b.groundJob = null;
          if (job.cover) { this.dropCover(b); b.cover = r.value; b.coverSig = job.coverSig; if (b.cover) b.ground.add(b.cover); }
        } else if (r.value && job.want.has(r.value.i) && b.rings[r.value.i] <= GROUND_R) this.setTufts(b, r.value, job.sigs[r.value.i]);
        if (performance.now() - t0 > budget) break;
      }
      if (performance.now() - t0 > budget) break;
    }
  }
  // Las matas de un trozo (i, del 0 al 3 en su bloque): la malla nueva sustituye a la vieja (o a ninguna)
  setTufts(b, piece, sig) {
    const old = b.tufts.get(piece.i);
    if (old?.tufts) { b.ground.remove(old.tufts); old.tufts.dispose(); }
    const pc = { sig, tufts: piece.tufts, box: piece.box, bounds: piece.bounds, lod: 0 };
    b.tufts.set(piece.i, pc);
    if (pc.tufts) b.ground.add(pc.tufts);   // (su nivel de detalle lo pone updateGrass, en este mismo fotograma)
  }
  dropTufts(b, i) {
    const pc = b.tufts.get(i);
    if (pc?.tufts) { b.ground.remove(pc.tufts); pc.tufts.dispose(); }   // (InstancedMesh.dispose no suelta la mata: es de todas)
    b.tufts.delete(i);
  }
  dropCover(b) { if (b.cover) { b.ground.remove(b.cover); b.cover.geometry.dispose(); b.cover = null; } b.coverSig = null; }
  // Cada fotograma (tras updateNature, con la cámara ya puesta): el círculo donde se acaba la hierba, cuánto más pequeño
  // se ve todo con el FOV de ahora y, por trozo, si se dibuja (fuera del círculo o de la vista, ni se manda: la caja de
  // un trozo recorta mejor que su esfera, que con 16 × 16 casillas y casi nada de alto se sale mucho) y qué malla dibuja
  // (todas las hojas, las N[1] primeras o las N[2]). Los cambios de malla no se ven: el sombreador ya ha hundido las
  // hojas que se dejan de dibujar
  updateGrass(target) {
    const cam = this.view.camera, k = Math.tan(cam.fov * Math.PI / 360) / Math.tan(Math.PI / 12);
    GRASS.lodK.value = k; GRASS.center.value.set(target.x, target.z); GRASS.fade.value.set(FADE[0], FADE[1]);
    cam.updateMatrixWorld();
    VIEW.setFromProjectionMatrix(VIEW_M.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const p = cam.position, lods = tuftLods(), R2 = FADE[1] * FADE[1];
    for (const b of this.nature.values()) for (const pc of b.tufts.values()) {
      const B = pc.box, im = pc.tufts;
      if (!im) continue;
      const hx = Math.max(B.x0 - target.x, 0, target.x - B.x1), hz = Math.max(B.z0 - target.z, 0, target.z - B.z1);
      if (!(im.visible = hx * hx + hz * hz < R2 && VIEW.intersectsBox(pc.bounds))) continue;
      const dx = Math.max(B.x0 - p.x, 0, p.x - B.x1), dy = Math.max(B.y0 - p.y, 0, p.y - B.y1), dz = Math.max(B.z0 - p.z, 0, p.z - B.z1);
      const de = Math.hypot(dx, dy, dz) * k, lod = de >= TUFT_LOD.SW[1] ? 2 : de >= TUFT_LOD.SW[0] ? 1 : 0;
      if (pc.lod !== lod) { pc.lod = lod; im.geometry = lods[lod]; }
    }
  }
  // Lo que depende de lo cerca que está: las matas (por trozo, los de anillo ≤ GROUND_R), la cubierta (por bloque, ≤
  // COVER_R) y si da sombra. Lo que falta o ha cambiado se pide en un trabajo (buildGround); lo que queda lejos se suelta
  natureRing(scene, b, ring, rings) {
    const shadow = ring <= SHADOW_R, wantCover = ring <= COVER_R;
    b.ring = ring; b.rings = rings;
    for (let i = 0; i < rings.length; i++) if (rings[i] > GROUND_R && b.tufts.has(i)) this.dropTufts(b, i);
    if (!wantCover && b.cover) this.dropCover(b);
    if (!b.groundJob) {
      const want = new Set();
      for (let i = 0; i < rings.length; i++) if (rings[i] <= GROUND_R && b.tufts.get(i)?.sig !== b.sigs[i]) want.add(i);
      const cover = wantCover && b.coverSig !== b.coverSig0;
      if (want.size || cover) {
        const T = this.view.terrain, occ = b.occ, list = [];
        // (con la cubierta se recorren los cuatro trozos; si no, solo los que cambian)
        b.datas.forEach(([cx, cy], i) => { if (cover || want.has(i)) list.push([cx, cy, i, want.has(i)]); });
        b.groundJob = {
          gen: buildGround(list, CHUNK, scene.gen, scene.gen.season, (x, y) => !occ.has(`${Math.floor(x)},${Math.floor(y)}`) && village.isGrass(x, y), (x, y) => T.heightAt(x, y), cover,
            (x, y) => occ.stub.has(`${Math.floor(x)},${Math.floor(y)}`) && village.isGrass(x, y)),
          want, cover, sigs: b.sigs.slice(), coverSig: b.coverSig0,
        };
      }
    }
    if (b.shadow !== shadow) { b.shadow = shadow; b.nat.group.traverse(o => { if (o.isMesh && o.userData.base) o.castShadow = shadow && o.userData.cast !== false; }); this.stale(false, blockBox(b)); }
  }
  dropNature(b) {
    this.group.remove(b.group);
    if (b.nat && b.shadow) this.stale(false, blockBox(b));
    b.nat?.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
    if (b.fadeSet) { releaseFadeSet(b.fadeSet); b.fadeSet = null; b.fadeOn = null; }
    for (const i of [...b.tufts.keys()]) this.dropTufts(b, i);
    this.dropCover(b);
    b.groundJob = null;
  }
  // Cada fotograma: cuánto se ve cada bloque de naturaleza (fadeNow, de 0 a 1 en FADE_MS al llegar; de vuelta a 0 al irse)
  // y, mientras no está del todo, sus mallas con el juego de materiales de fundido (nature3d.js, nearFadeSet). Los que
  // acaban de irse se sueltan aquí
  updateFades(snap) {
    const now = performance.now();
    for (const [k, b] of this.nature) {
      if (!b.nat) { b.fadeNow = 0; continue; }
      // (mientras espera escondido a sus programas, no cuenta: los impostores siguen en su sitio, en la máscara, y el
      // fundido empieza al enseñarlo)
      if (!b.group.visible && b.leaving == null) { b.born = now; b.fadeNow = 0; continue; }
      // (al saltar, lo que se estaba fundiendo queda hecho del todo, también en los fotogramas siguientes)
      if (snap && b.leaving == null) b.born = -Infinity;
      let f = b.leaving != null ? 1 - (now - b.leaving) / FADE_MS : snap ? 1 : (now - b.born) / FADE_MS;
      f = b.fadeNow = Math.max(0, Math.min(1, f));
      if (b.leaving != null && f <= 0) { this.dropNature(b); this.nature.delete(k); continue; }
      if (f < 1) {
        b.fadeSet ||= nearFadeSet();
        if (b.fadeOn !== b.nat) { fadeMeshes(b.nat.group, b.fadeSet, true); b.fadeOn = b.nat; }   // (también si se ha rehecho a medias)
        b.fadeSet.u.value = f;
      } else if (b.fadeSet) {
        if (b.fadeOn === b.nat) fadeMeshes(b.nat.group, b.fadeSet, false);
        releaseFadeSet(b.fadeSet); b.fadeSet = null; b.fadeOn = null;
      }
    }
  }
  // La máscara de lo cercano (ver el constructor), centrada en el trozo de la cámara; solo se sube si cambia (1 KB)
  updateMask(ccx, ccy) {
    const N = this.maskNext, ox = ccx - MASK / 2, oy = ccy - MASK / 2;
    N.fill(0);
    for (const b of this.nature.values()) {
      if (!b.nat) continue;
      const v = Math.round(b.fadeNow * 255);
      for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) {
        const x = b.bx * NB + i - ox, y = b.by * NB + j - oy;
        if (x >= 0 && y >= 0 && x < MASK && y < MASK) N[y * MASK + x] = v;
      }
    }
    const D = this.maskData;
    let same = this.maskAt[0] === ox && this.maskAt[1] === oy;
    if (same) for (let i = 0; i < D.length; i++) if (D[i] !== N[i]) { same = false; break; }
    if (!same) { D.set(N); this.mask.needsUpdate = true; this.maskAt = [ox, oy]; this.maskU.impOrigin.value.set(ox, oy); }
    this.maskU.impFar.value = this.view.scene.fog?.far ?? 150;
  }
  // El día del juego (para la hierba segada, que vuelve a salir)
  today() { return this.game?.days?.dayIndex ?? 0; }
  // Pone un modelo (por su nombre) en (x, z) girado yaw: sus piezas a las mallas del trozo; lo demás, aparte
  // off: apagado (una lámpara, una antorcha, una vela, un hogar): sin luz, llama ni humo, y lo que brilla, apagado
  placeModel(name, x, z, yaw, emit, c, group, off = false, lift = 0) {
    const m = getModel(name);
    if (!m) return;
    for (const [key, B] of m.parts) emit(off ? UNLIT[key] || key : key, '').add(B.transformed(x, 0, z, yaw));   // (la altura la pone LIFT, en buildChunk)
    const cs = Math.cos(yaw), sn = Math.sin(yaw), at = (p) => [x + p[0] * cs + p[2] * sn, p[1] + lift, z - p[0] * sn + p[2] * cs];
    for (const e of m.extras) {
      const o = e.clone();
      o.position.set(...at([e.position.x, e.position.y, e.position.z])); o.rotation.y += yaw;
      o.traverse(q => { if (q.isMesh) { q.castShadow = true; q.receiveShadow = true; } });
      if (o.userData.spin) { (c.spin ||= []).push(o); this.spin.add(o); }   // (lo que gira: la rueda de la noria; ya en su sitio del mundo)
      else group.add(o);
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
        l.forEach((it, i) => { o.position.set(it.p[0], it.p[1] + (ex.lift || 0), it.p[2]); o.scale.set(...(typeof it.s === 'number' ? [it.s, it.s, it.s] : it.s)); o.rotation.set(i, i * 2, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); if (it.c) im.setColorAt(i, new THREE.Color(it.c)); });
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
  // Bloques de FAR_BLOCK × FAR_BLOCK trozos alrededor: los árboles como impostores (si el atlas está listo; si no, o con
  // ?impostores=0, los sencillos de antes) y los peñascos en 3D (un impostor de roca, a ras de suelo, se ve mal). Un
  // bloque hecho con lo otro, o en el que ha cambiado algo (se ha talado un árbol, aquí o en la partida de otro), se
  // rehace; al acabar de hornear, se cambian uno a uno, sin dejar hueco
  updateFar(scene, ccx, ccy, t0, budget) {
    const bx = Math.floor(ccx / FAR_BLOCK), by = Math.floor(ccy / FAR_BLOCK), keep = new Set();
    const A = this.useImpostors && this.impostors?.ready && this.impostors.season === scene.gen.season ? this.impostors : null, mode = A ? 'imp' + A.gen : 'old';
    const gy = (x, y) => this.view.groundY(scene, x, y);
    // (las firmas, solo cuando ha cambiado algún trozo del mundo desde la última vez: si no, las de antes)
    if (scene !== this.farSigScene || scene.touches === undefined || scene.touches !== this.farTouches || this.farSigs.size > 64) {
      this.farSigs.clear(); this.farSigScene = scene; this.farTouches = scene.touches;
    }
    for (let dy = -FAR_R; dy <= FAR_R; dy++) for (let dx = -FAR_R; dx <= FAR_R; dx++) {
      const k = `${bx + dx},${by + dy}`, old = this.far.get(k);
      let sig = this.farSigs.get(k);
      if (sig === undefined) this.farSigs.set(k, (sig = this.farSig(scene, bx + dx, by + dy)));
      keep.add(k);
      if (old?.userData.mode === mode && old.userData.sig === sig) continue;
      if (performance.now() - t0 > (old ? budget : budget * 2)) continue;
      const objs = this.farObjects(scene, bx + dx, by + dy), g = new THREE.Group();
      if (A) {
        const trees = buildFarImpostors(objs, gy, A);
        if (trees) g.add(trees);
        const rocks = objs.filter(o => o.kind === 'boulder' || o.kind === 'snowBoulder');
        if (rocks.length) g.add(buildFarNature(rocks, scene.gen.season, gy));
      } else g.add(buildFarNature(objs, scene.gen.season, gy));
      g.traverse(o => { if (o.material && o.material !== A?.material) this.hideNear(o.material); });
      g.userData.mode = mode; g.userData.sig = sig;
      if (old) this.dropFar(old);
      this.far.set(k, g);
      this.group.add(g);
      if (!old) this.view.gate?.(g, null, farBox(bx + dx, by + dy));   // (los nuevos, en el horizonte; los que se rehacen, en el acto: no dejan hueco)
    }
    for (const [k, g] of this.far) if (!keep.has(k)) { this.dropFar(g); this.far.delete(k); }
  }
  // Lo que se ve de lejos en un bloque: los árboles y peñascos que pone el mundo, sin lo talado o picado (sus cambios por
  // trozo, sin crearlos: delta() les añadiría campos vacíos) ni lo que tapan los lugares y las aldeas, y más allá de la
  // costura del planeta, en su sitio de esta vuelta. No pasa por contentFor: con 400 trozos echaría de su caché a los
  // cercanos
  farObjects(scene, fbx, fby) {
    const out = [];
    for (let j = 0; j < FAR_BLOCK; j++) for (let i = 0; i < FAR_BLOCK; i++) {
      const cx = fbx * FAR_BLOCK + i, cy = fby * FAR_BLOCK + j, own = wrapIndex(cx, CHUNK), off = (cx - own) * CHUNK;
      const removed = scene.deltas?.get(`${own},${cy}`)?.removed;
      for (const o of scene.gen.content(cx, cy).objects) {
        if (!FAR_KINDS.has(o.kind) || o.poi) continue;
        if (removed && removed[o.key] !== undefined) continue;
        if (scene.layers?.some(l => l.hides?.(o))) continue;
        out.push(off ? { ...o, x: o.x + off } : o);
      }
    }
    return out;
  }
  // La firma de un bloque lejano: cuánto se ha quitado de cada uno de sus trozos (lo talado, aquí o en la partida de
  // otro). Solo eso cambia lo lejano: segar, labrar, poner piezas, abrir puertas o que crezcan los cultivos también suben
  // la versión del trozo, pero no hace falta rehacer el bloque entero por ello
  farSig(scene, fbx, fby) {
    let h = 0;
    if (scene.deltas) for (let j = 0; j < FAR_BLOCK; j++) for (let i = 0; i < FAR_BLOCK; i++) {
      const cx = fbx * FAR_BLOCK + i, cy = fby * FAR_BLOCK + j, d = scene.deltas.get(`${wrapIndex(cx, CHUNK)},${cy}`);
      h = (Math.imul(h, 31) + (d ? this.removedCount(d) : 0)) | 0;
    }
    return h;
  }
  // (contadas una vez por versión del trozo: lo quitado no vuelve, así que si cambia, cambia la cuenta)
  removedCount(d) {
    const c = this.removedN.get(d);
    if (c && c[0] === d.v) return c[1];
    const n = d.removed ? Object.keys(d.removed).length : 0;
    this.removedN.set(d, [d.v, n]);
    return n;
  }
  // Un bloque lejano fuera: sus instancias y sus geometrías propias, también de la gráfica
  dropFar(g) {
    this.group.remove(g);
    g.traverse(o => { if (o.isInstancedMesh) o.dispose(); if (o.userData.own) o.geometry.dispose(); });
  }
  // Los árboles y peñascos sencillos de lejos: donde ya está el de cerca no se pintan, y mientras se funden, se traman al
  // revés que él (como los impostores; ver nearFadeSet)
  hideNear(m) {
    if (m.userData.hideNear) return;
    m.userData.hideNear = true;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey(), U = this.maskU;
    m.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r);
      sh.uniforms.impMask = U.impMask; sh.uniforms.impOrigin = U.impOrigin;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform sampler2D impMask;\nuniform vec2 impOrigin;\nvarying float vNear;').replace('#include <project_vertex>', `#include <project_vertex>
        vec4 ip = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        ${MASK_GLSL('ip.xz')}
        if (vNear > 0.999) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vNear;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n  if (${DITHER} < vNear) discard;`);
    };
    m.customProgramCacheKey = () => 'farMask:' + prevKey;
    m.needsUpdate = true;
  }
  // El atlas de los impostores: se hornea la estación del mundo que se ve, por pasos (nunca en un fotograma de salto),
  // más deprisa en el menú. Con él listo, se precompila lo que se usará al jugar (el impostor y el fundido)
  updateImpostors(scene, game, snap) { this.prebake(scene.gen.season, game, snap); }
  prebake(season, game, snap = false) {
    if (!this.useImpostors || !this.view.renderer) return;
    const A = (this.impostors ||= new ImpostorAtlas(this.view.renderer, this.maskU));
    if (A.season === -2) return;   // (falló: lo lejano se queda sencillo)
    if (A.season !== season) A.start(season);
    const menu = !game?.player || !game.scene;
    if (!snap && !A.ready) A.step(menu ? 6 : 3, menu);
    A.material.visible = A.ready;   // (mientras se vuelve a hornear, sus bloques no se pintan: se están cambiando por los sencillos)
    if (A.ready && this.warmed !== A.gen) { this.warmed = A.gen; this.warm(A); }
    this.warmStep();
  }
  // Los programas del impostor y de los materiales de fundido, compilados en paralelo con la luz y la niebla de la escena
  // del juego: así el primer bloque que se funde no da un tirón (en una Iris Plus, decenas de ms por programa)
  // (de uno en uno, un material por fotograma: compilar cuesta algo de procesador aunque sea en paralelo; y con y sin
  // color por pieza por separado, porque compileAsync solo espera al último programa de cada material)
  warm(A) {
    const set = nearFadeSet(), q = [[A.material, true]];
    for (const m of set.mats.values()) q.push([m, true], [m, false]);
    this.warming = { q, set, geo: new THREE.PlaneGeometry(1, 1) };
  }
  // (si se pierde el contexto de WebGL: lo que se estaba compilando ya no existe; se suelta y se vuelve a pedir al
  // hornear otra vez el atlas)
  stopWarm() {
    const W = this.warming;
    if (W) { releaseFadeSet(W.set); W.geo.dispose(); }
    this.warming = null;
  }
  warmStep() {
    const W = this.warming;
    if (!W || W.busy) return;
    const next = W.q.shift();
    if (!next) { releaseFadeSet(W.set); W.geo.dispose(); this.warming = null; return; }
    const [m, color] = next, s = new THREE.Scene(), im = new THREE.InstancedMesh(W.geo, m, 1);
    if (color) im.setColorAt(0, new THREE.Color(1, 1, 1));
    s.add(im);
    W.busy = true;
    this.view.renderer.compileAsync(s, this.view.camera, this.view.scene).catch(() => {}).finally(() => { im.dispose(); W.busy = false; });
  }
  // Para F3: cómo van los impostores y cuántos bloques se están fundiendo
  impostorStats() {
    let fading = 0;
    for (const b of this.nature.values()) if (b.fadeSet) fading++;
    const head = !this.useImpostors ? 'impostores: apagados (?impostores=0)' : this.impostors ? this.impostors.stats() : 'impostores: aún no';
    return `${head} · ${fading} bloques fundiéndose`;
  }
  // Se ha perdido el contexto de WebGL y ha vuelto: el atlas está vacío. Se hornea otra vez y, mientras, todo lo lejano
  // pasa ya a los árboles sencillos (si se fuera cambiando bloque a bloque, los de impostores dejarían huecos)
  impostorsLost() {
    if (!this.impostors) return;
    this.impostors.invalidate();
    this.setImpostors(this.useImpostors);
  }
  // Cambiar a impostores o a lo sencillo y rehacer ya todo lo lejano (el banco, para medir los dos en la misma pasada)
  setImpostors(on) {
    this.useImpostors = on;
    if (this.scene && this.at) this.updateFar(this.scene, this.at[0], this.at[1], performance.now(), 1e9);
  }

  // ---------- el pueblo ----------
  updateVillage(scene) {
    if (scene.village === this.villageRef) return;
    if (this.villageGroup) this.group.remove(this.villageGroup);
    for (const o of this.villageLights?.spin || []) this.spin.remove(o);
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
    for (const l of c.lights) if (l.pool) poolGround(l, l.x, l.z, (x, z) => this.view.groundY(scene, x, z));
    this.villageLights = c;
    this.villageGroup = g;
    this.group.add(g);
    this.stale();
  }

  // ---------- regiones de tejado ----------
  // Región de tejado de una casilla (o '' si no tiene tejado). Se calcula la primera vez que se pregunta
  regionAt(scene, tx, ty) {
    const k = `${tx},${ty}`;
    if (this.regionOf.has(k)) {   // (si la casa ha subido de altura, su tejado se rehace)
      const key = this.regionOf.get(k), r = this.regions.get(key);
      if (r && scene.levelAt && r.level !== undefined && r.level !== this.regionLevel(scene, r.tiles)) { this.dropRegion(r); r.dirty = true; }
      return key;
    }
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
  // La altura de una casa: la más alta de sus casillas
  regionLevel(scene, tiles) { let L = 0; if (scene.levelAt) for (const [x, y] of tiles) L = Math.max(L, scene.levelAt(x + 0.5, y + 0.5) || 0); return L; }
  invalidateRegion(r) {
    this.dropRegion(r);
    this.regions.delete(r.key);
    for (const [x, y] of r.tiles) this.regionOf.delete(`${x},${y}`);
    // Los trozos que la tocan se rehacen (sus paredes la llevan apuntada)
    for (const c of this.chunks.values()) if (c.regions.has(r.key)) c.force = true;
  }
  dropRegion(r) {
    if (r.roof) this.stale(false, regionBox(r));
    for (const k of ['roof', 'ceil']) if (r[k]) { this.group.remove(r[k]); r[k].traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
    r.roof = r.ceil = null;
  }
  updateRegions(scene) {
    for (const r of this.regions.values()) {
      if (!r.dirty) continue;
      r.dirty = false;
      const L = (r.level = this.regionLevel(scene, r.tiles));
      r.roof = roofRegion(scene, r.tiles, r.key);
      r.roof.position.y = L;
      r.roof.userData.chimneys = r.roof.userData.chimneys.map(([x, y, z]) => [x, y + L, z]);
      const mats = [];
      r.roof.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material = this.fadeMat(r.key + '|roof', matKeyOf(o.material)); mats.push(o.material); } });
      this.group.add(r.roof);
      // (casi siempre en el acto: cada casa tiene sus materiales, pero comparten programa; y si se rehace al editar, cerca
      // de la cámara: también en el acto, sin dejar la casa sin tejado)
      this.view.gate?.(r.roof, null, regionBox(r));
      this.stale(false, regionBox(r));
      // El techo por dentro: tablas y vigas (se ve solo con la cámara por debajo, ver updateFade)
      const floor = r.tiles.filter(([x, y]) => scene.at('floor', x, y));
      if (floor.length) { r.ceil = this.ceiling(floor, r.box); r.ceil.position.y = L; this.group.add(r.ceil); }
      // (sin candelabro por su cuenta: se cuelga como un objeto más; el de las casas del pueblo, las aldeas y la taberna va
      // en sus planos, world/blueprints.js)
      // Altura del tejado en (x, z), para que la cámara pase por encima
      // (la misma forma que el dibujo: roof.js, a dos aguas si es rectangular, si no a cuatro)
      const shape = roofShape(r.tiles, (x, y) => this.regionOf.get(`${x},${y}`) === r.key);
      r.top = (px, py) => L + WALL_H + ROOF.thick + shape.H(px, py) * ROOF.level;
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
      // (la hoja da sombra: mientras gira, va con lo que se mueve (world.spin) y su sombra se pinta en cada fotograma sin
      // rehacer lo fijo; al empezar y al acabar, lo fijo se repinta una vez, sin ella y con ella. El grupo del trozo está
      // en el origen y sin giro, así que la hoja no cambia de sitio al pasar de uno a otro)
      const box = [d.tile[0] - 1, d.tile[1] - 1, d.tile[0] + 2, d.tile[1] + 2];
      if (Math.abs(want - d.amount) < 1e-3) {
        if (d.leaf.parent === this.spin) { d.group.add(d.leaf); this.stale(true, box); }
        continue;
      }
      if (d.leaf.parent !== this.spin) { this.spin.add(d.leaf); delete d.leaf.userData.shS; this.stale(true, box); }
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
    this.insideRegion = inside;   // (la clave de su tejado: quien esté bajo otro, se ve solo por ventanas y puertas; ver Actors.grade)
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
      // Del todo oculta: no se pinta, pero sigue opaca para el mapa de sombras (el tejado da sombra dentro). El material de
      // profundidad de Three (r160, getDepthMaterial) no copia colorWrite, opacidad ni alphaHash: desvanecer no cambia la
      // sombra y no hace falta repintar lo fijo (stale) mientras dura
      const on = o > 0.01;
      for (const m of mats.values()) { m.opacity = m.userData.base * (on ? o : 1); if (m.colorWrite !== on) { m.colorWrite = on; m.depthWrite = on && !m.transparent; } }
    }
  }

  // ---------- luces, fuegos y humo cercanos ----------
  lights() {
    const out = [];
    for (const c of this.chunks.values()) for (const l of c.lights) out.push(l);
    if (this.villageLights) for (const l of this.villageLights.lights) out.push(l);
    return out;
  }
  flames() {
    const out = [];
    for (const c of this.chunks.values()) for (const f of c.flames) out.push(f);
    if (this.villageLights) for (const f of this.villageLights.flames) out.push(f);
    return out;
  }
  smoke() {
    const out = [];
    for (const c of this.chunks.values()) for (const s of c.smoke) out.push(s);
    for (const r of this.regions.values()) if (r.roof) for (const s of r.roof.userData.chimneys) out.push(s);
    return out;
  }
  fountains() { const out = []; for (const c of this.chunks.values()) if (c.fountain) out.push(c.fountain); if (this.villageLights?.fountain) out.push(this.villageLights.fountain); return out; }
}
// Lo que abarca (x0, z0, x1, z1 del mundo) un trozo, un bloque de naturaleza (con lo que asoma por los lados: copas,
// sauces) y una casa (con el alero), para saber si un cambio cae en la zona de sombras (ver SunShadow.stale)
// (con lo que asoma de los modelos grandes puestos en el borde del trozo: la taberna, las casas de animales, la noria)
const chunkBox = (cx, cy) => [cx * CHUNK - 6, cy * CHUNK - 6, (cx + 1) * CHUNK + 6, (cy + 1) * CHUNK + 6];
const blockBox = b => [b.bx * NB * CHUNK - 6, b.by * NB * CHUNK - 6, (b.bx + 1) * NB * CHUNK + 6, (b.by + 1) * NB * CHUNK + 6];
const regionBox = r => [r.box.x0 - 3, r.box.y0 - 3, r.box.x1 + 3, r.box.y1 + 3];
const farBox = (fbx, fby) => [fbx * FAR_BLOCK * CHUNK, fby * FAR_BLOCK * CHUNK, (fbx + 1) * FAR_BLOCK * CHUNK, (fby + 1) * FAR_BLOCK * CHUNK];
// Clave de un material base (para clonarlo para una región)
function matKeyOf(m) {
  const B = baseMaterials();
  for (const [k, v] of Object.entries(B)) { if (v === m) return k; if (k === 'roofs') for (const [rk, rv] of Object.entries(v)) if (rv === m) return 'roof:' + rk; }
  return 'stone';
}
// Una huella de las casillas ocupadas de cada trozo de un bloque (si cambia, se rehacen sus matas): cuántas son y una
// suma de sus posiciones (no depende del orden)
function occHashes(occ, datas) {
  const h = datas.map(() => [0, 0]);
  for (const k of occ) {
    const c = k.indexOf(','), x = +k.slice(0, c), y = +k.slice(c + 1), cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    const i = datas.findIndex(d => d[0] === cx && d[1] === cy);
    if (i >= 0) { h[i][0]++; h[i][1] = (h[i][1] + (Math.imul(x, 73856093) ^ Math.imul(y, 19349663))) | 0; }
  }
  return h.map(([n, s]) => n + ':' + s);
}
// Casillas ocupadas de unos trozos (ahí no crece hierba): lo construido y colocado, lo labrado, los cultivos, lo
// segado, lo cavado y los lugares (que ocupan 3 × 3 casillas). occ.stub: las segadas o comidas que no tienen nada más
// (llevan rastrojo: ver buildGround)
function occupied(scene, datas, today = 0) {
  const occ = new Set(), mown = [];
  for (const [cx, cy, d] of datas) {
    for (const o of d.objects.concat(d.flats, d.floors)) {
      if (o.tile && (o.layer || o.crop || o.treasure)) occ.add(`${o.tile[0]},${o.tile[1]}`);
      if (o.poi || o.fx) for (let y = Math.floor(o.fy?.[0] ?? o.y - 1.5); y < Math.ceil(o.fy?.[1] ?? o.y + 1.5); y++) for (let x = Math.floor(o.fx?.[0] ?? o.x - 1.5); x < Math.ceil(o.fx?.[1] ?? o.x + 1.5); x++) occ.add(`${x},${y}`);
    }
    for (const t of d.tilled) occ.add(`${t[0]},${t[1]}`);
    const dl = scene.delta(cx, cy);
    for (const k of Object.keys(dl?.crops || {})) occ.add(k);
    for (const [k, v] of Object.entries(dl?.mown || {})) if (today - v < GRASS_REGROW) mown.push(k);
    for (const k of Object.keys(dl?.dig || {})) occ.add(k);   // (lo cavado y la tierra apilada: tierra desnuda)
  }
  occ.stub = new Set(mown.filter(k => !occ.has(k)));
  for (const k of mown) occ.add(k);
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
