// La sombra de contacto en la gráfica (las formas y los números: world/contact.js). Una sola textura del mundo, de dos
// canales y 25 cm por píxel, que cubre los 5 × 5 bloques de suelo que hay alrededor de la cámara (terrain.js) con
// direcciones que dan la vuelta: el bloque bx va al hueco bx mod 5, así los vecinos del mundo son vecinos en la textura y
// el filtrado no deja costuras entre bloques. La leen el suelo, la hierba y los suelos de las casas: al pie de un muro,
// bajo una mesa o junto a una roca llega menos luz del cielo, y bajo las copas de los árboles también, y más allá de las
// sombras de verdad (a unos 24-30 m), también menos sol: el bosque lejano deja de flotar.
// Solo se rehace donde algo cambia (se construye, se quita, se tala, cambia la estación), en el hilo aparte del suelo.
// ?contacto=0 la apaga (para comparar en el mismo código) y ?contacto=ver pinta solo la oclusión, para ajustarla.
import * as THREE from 'three';
import { CHUNK } from '../world/gen.js';
import { wrapIndex } from '../world/planet.js';
import { AO_PX, TILE, shapesOf, shapesIn, rasterTile, hashShapes, seasonShapes } from '../world/contact.js';
import { opcion, apagada } from '../opciones.js';

const BLOCK = CHUNK * 4;                 // (lo mismo que ground.js: 4 × 4 trozos por bloque)
const SLOTS = 5;                         // bloques de lado (los 2 × RADIUS + 1 de terrain.js)
const SIDE = BLOCK * AO_PX;              // píxeles de lado de un bloque (256)
const ATLAS = SLOTS * SIDE;              // píxeles de lado de la textura (1280)
const WORLD = ATLAS / AO_PX;             // metros que abarca antes de dar la vuelta (320)
const Q = opcion('contacto');
export const AO_ON = !apagada('contacto');   // (?contacto=0: sin ella; ver opciones.js)
// (?contacto=rojo: rojo donde hay contacto y verde donde solo hay copa, para ver hasta dónde llega cada cosa)
const SEE = Q === 'ver' ? 1 : Q === 'rojo' ? 2 : 0;
// Cuánto quita el contacto a la luz directa (el sol y las luces de cerca): menos que al cielo, porque el sol ya tiene su
// sombra de verdad; con todo, al pie de un muro, aunque le dé el sol, el suelo se asienta. Y la copa, fuera de la zona de
// sombras, al sol: ahí hace de sombra del árbol
const K_DIRECT = 0.5, K_CANOPY_SUN = 1;
const CANOPY_H = 3.2;                    // m: a qué altura está la copa (para correr su sombra lejana hacia donde da el sol)
const OFF_MAX = 7;                       // … como mucho, con el sol bajo

// La textura y su copia en memoria: son el mismo búfer (si la gráfica pierde el contexto, Three la vuelve a subir de ahí).
// Se hacen con el renderer del juego (setRenderer): sin pantalla (el servidor) no hay ni una ni otra
let DATA = null, atlas = null;
// k: x, cuánto quita el contacto al sol; y, cuánto quita la copa al sol fuera de la zona de sombras; z, ver solo la
// oclusión; w, encendida (solo mientras se dibuja el mundo: ver engine.js, draw). off: hacia dónde se corre la copa lejana
export const CONTACT = { map: { value: null }, k: { value: new THREE.Vector4(K_DIRECT, K_CANOPY_SUN, SEE, 0) }, off: { value: new THREE.Vector2() } };
let MAIN = null;
export function setRenderer(r) {
  if (!AO_ON || MAIN) return;
  DATA = new Uint8Array(ATLAS * ATLAS * 2).fill(255);
  atlas = new THREE.DataTexture(DATA, ATLAS, ATLAS, THREE.RGFormat, THREE.UnsignedByteType);
  atlas.wrapS = atlas.wrapT = THREE.RepeatWrapping;
  atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter;
  // (anisotropía 2: es una textura suave, de 25 cm por píxel; con más, en primera persona solo se pagan más lecturas)
  atlas.generateMipmaps = true; atlas.anisotropy = 2; atlas.flipY = false;
  atlas.needsUpdate = true;
  CONTACT.map.value = atlas;
  MAIN = r; r.initTexture(atlas);
}
// Hacia dónde da el sol (dir: hacia él, la del mapa de sombras): la sombra de una copa a CANOPY_H cae al otro lado
export function contactSun(dir) {
  const k = CANOPY_H / Math.max(0.15, dir.y), o = CONTACT.off.value.set(dir.x * k, dir.z * k);
  if (o.length() > OFF_MAX) o.setLength(OFF_MAX);
}
export const contactOn = on => { CONTACT.k.value.w = on && MAIN ? 1 : 0; };
// La gráfica perdió el contexto y lo ha recuperado: la textura, otra vez entera desde su copia en memoria
export function contactRestored() { if (MAIN) atlas.needsUpdate = true; }

// El código de los sombreadores. Se añade solo en el renderer del juego: el retrato, la vista previa y los iconos tienen
// el suyo (otro contexto, otra caché de programas: la misma clave no choca) y ahí no se subiría la textura para nada.
// mode: 'frag' (suelo y suelos de casa: se lee en cada píxel; pos, lo que da el sitio xz del mundo si ya hay un varying
// para eso), 'vert' o 'vertInst' (la hierba: se lee en el vértice, y no en cada píxel de las hojas; con instancias, en el pie
// de cada hoja, que da su atributo blade)
const INV = (1 / WORLD).toFixed(8);
const PARS = 'uniform sampler2D uContact;\nuniform vec4 uCK;\nuniform vec2 uCOff;\n';
// (lo que falta de la zona de sombras: 0 dentro, 1 fuera, con la misma rampa con la que look.js apaga la sombra hacia su
// borde. Así, donde la sombra de verdad se va, entra la de la copa, sin que se sumen ni quede un hueco)
const OUTSIDE = `float cOut = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    vec4 cSc = vDirectionalShadowCoord[ 0 ]; cSc.xyz /= cSc.w;
    vec2 cBd = abs(cSc.xy * 2.0 - 1.0);
    cOut = cSc.z > 1.0 ? 1.0 : smoothstep(0.82, 1.0, max(cBd.x, cBd.y));
  #endif`;
// (lo que hace con la luz: al cielo, el contacto y la copa; al sol, parte del contacto y, fuera de la zona de sombras, la
// copa corrida hacia el sol)
const APPLY = `
    cA = mix(vec2(1.0), cA, uCK.w); cG = mix(1.0, cG, uCK.w);
    float cAmb = cA.r * cA.g, cDir = mix(1.0, cA.r, uCK.x) * mix(1.0, cG, cOut * uCK.y);
    reflectedLight.indirectDiffuse *= cAmb; reflectedLight.indirectSpecular *= cAmb;
    reflectedLight.directDiffuse *= cDir; reflectedLight.directSpecular *= cDir;
    if (uCK.z > 0.5 && uCK.w > 0.5) {
      reflectedLight.directDiffuse = vec3(0.0); reflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0);
      reflectedLight.indirectDiffuse = uCK.z > 1.5 ? (cA.r < 0.97 ? vec3(1.0, 0.0, 0.0) : cA.g < 0.97 ? vec3(0.0, 1.0, 0.0) : vec3(0.2)) : vec3(0.6 * cAmb * mix(1.0, cG, cOut));
    }`;
export function injectContact(sh, renderer, mode, pos = null) {
  if (!AO_ON || renderer !== MAIN) return;
  sh.uniforms.uContact = CONTACT.map; sh.uniforms.uCK = CONTACT.k; sh.uniforms.uCOff = CONTACT.off;
  if (mode === 'frag') {
    let P = pos;
    if (!P) {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vCW;')
        .replace('#include <project_vertex>', 'vCW = (modelMatrix * vec4(transformed, 1.0)).xz;\n#include <project_vertex>');
      P = 'vCW';
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + PARS + (pos ? '' : 'varying vec2 vCW;\n'))
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  {
    vec2 cUV = ${P} * ${INV}, cDx = dFdx(cUV), cDy = dFdy(cUV);
    vec2 cA = vec2(1.0); float cG = 1.0;
    ${OUTSIDE}
    // (solo se lee con la sombra encendida: uCK.w es igual en toda la pasada, así que el if no cuesta. La copa corrida,
    // solo donde hace falta: fuera de la zona de sombras, con las derivadas de fuera del if)
    if (uCK.w > 0.5) {
      cA = texture2D(uContact, cUV).rg;
      if (cOut > 0.001) cG = textureGrad(uContact, cUV + uCOff * ${INV}, cDx, cDy).g;
    }
    ${APPLY}
  }`);
    return;
  }
  // (en las matas, el pie de cada hoja: la mata ocupa toda su casilla, y junto a un muro su centro queda a casi un metro,
  // donde ya no llega la sombra; las nueve esquinas de una hoja leen lo mismo, así que toda la hoja se oscurece igual.
  // Las hojas que el nivel de detalle ha hundido en su raíz (gk = 0: de lejos quedan 28 o 10 de 72, y ninguna pasado el
  // final de la hierba) no leen nada: no se ven. Con if de verdad, no con ?:, para que la segunda lectura no se haga
  // siempre)
  const root = mode === 'vertInst' ? '(modelMatrix * instanceMatrix * vec4(blade.y, 0.0, blade.z, 1.0)).xz' : '(modelMatrix * vec4(position, 1.0)).xz';
  const live = mode === 'vertInst' ? 'uCK.w > 0.5 && gk > 0.001' : 'uCK.w > 0.5';
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + PARS + 'varying vec4 vAO;')
    .replace('#include <shadowmap_vertex>', `#include <shadowmap_vertex>
  vAO = vec4(1.0);
  if (${live}) {
    vec2 cUV = ${root} * ${INV};
    vAO.rg = texture2D(uContact, cUV).rg;
    ${OUTSIDE}
    vAO.a = cOut;
    if (cOut > 0.001) vAO.b = texture2D(uContact, cUV + uCOff * ${INV}).g;
  }`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + PARS + 'varying vec4 vAO;')
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  {
    vec2 cA = vAO.rg; float cG = vAO.b, cOut = vAO.a;
    ${APPLY}
  }`);
}
// La clave del programa con la sombra de contacto (para que no comparta programa con el de sin ella)
export const contactKey = key => (AO_ON ? key + '-c' : key);

// ---------- el atlas, por bloques ----------
const slot = b => ((b % SLOTS) + SLOTS) % SLOTS;
const POLL_MS = 120;
const SAP_MS = 20000;     // cada cuánto se mira si ha cambiado algún trozo (solo compara números: unas 400 consultas)
const PUMP_MS = 1.5;     // lo que puede dedicar cada fotograma a juntar formas (y, sin hilo aparte, a pintarlas)
const UPLOADS = 3;       // bloques que se suben a la gráfica como mucho por fotograma
const SCRATCH = new Map();
// Lo que lleva la sombra de contacto de los bloques de suelo de terrain.js: las formas de cada trozo (con su versión, para
// saber cuándo rehacerlas), qué trozos de cada bloque faltan por pintar, lo que se ha pedido al hilo y lo que hay que subir
export class ContactField {
  constructor(terrain) {
    this.t = terrain;
    this.chunks = new Map();   // "cx,cy" → { v, season, S, hash, stale }
    this.world = null; this.vil = null; this.season = -1;
    this.poll = 0;
    this.area = null;          // [cx0, cy0, cx1, cy1]: los trozos de los 5 × 5 bloques (lo de fuera no se mira)
    // Los trozos de fuera del área que se han dado por vacíos al pintar un bloque del borde. Cuando el área se mueve y
    // entran, al juntar sus formas por primera vez se repinta lo de alrededor: si no, en cada línea entre bloques que se
    // cruza andando quedaría una franja sin la oclusión (ni la copa) de lo que hay al otro lado
    this.emptied = new Set();
    this.clean = new Set();    // los huecos del atlas que están en blanco también en la gráfica (no hace falta subirlos)
    this.villageSplit = null;
    this.stats = { tiles: 0, uploads: 0, ms: 0, frames: 0, local: 0, t: performance.now() };
    this.local = false;        // (el hilo aparte ha fallado con un trabajo de estos: se pintan aquí)
  }
  get on() { return !!MAIN; }
  // Otra partida u otro mundo: todo en blanco
  reset() {
    if (DATA) { DATA.fill(255); atlas.needsUpdate = true; for (let i = 0; i < SLOTS * SLOTS; i++) this.clean.add(i); }
    this.chunks.clear(); this.emptied.clear(); this.world = null; this.vil = null; this.villageSplit = null;
  }
  // Un bloque nuevo: su hueco en blanco ya (si no, durante un momento se vería la oclusión del bloque que lo ocupaba antes)
  // y sus 16 trozos por pintar
  added(blk) {
    if (!MAIN) return;   // (apagada: nada que pintar ni que esperar)
    const hx = slot(blk.bx) * SIDE, hz = slot(blk.bz) * SIDE, h = slot(blk.bz) * SLOTS + slot(blk.bx), clean = this.clean.has(h);
    if (!clean) for (let j = 0; j < SIDE; j++) DATA.fill(255, ((hz + j) * ATLAS + hx) * 2, ((hz + j) * ATLAS + hx + SIDE) * 2);
    // (upNow: el hueco en blanco se sube ya, entero, si no lo estaba ya en la gráfica; blank: es un hueco recién vaciado,
    // que va antes que los demás al subir)
    blk.ao = { dirty: new Set(Array.from({ length: 16 }, (_, i) => i)), urgent: false, seq: new Uint32Array(16), flying: new Set(), up: [0, 0, 3, 3], upNow: !clean, blank: !clean };
  }
  // Cambió la estación: las copas (los de hoja caduca, en invierno, casi no tapan el cielo). Solo cambia su fuerza: se
  // cambia en las formas que ya hay (sin volver a juntarlas: serían 400 trozos) y se pinta otra vez donde hay alguno
  seasonChanged(season) {
    for (const c of this.chunks.values()) {
      if (c.stale) continue;
      const hash = hashShapes(seasonShapes(c.S, season));
      if (hash !== c.hash) { c.hash = hash; this.mark(c.cx, c.cy, false); }
    }
  }
  // Cambiaron las casas del pueblo (un proyecto acabado): sus formas, otra vez
  villageChanged() { this.villageSplit = null; for (const c of this.chunks.values()) c.stale = true; }

  // Cada fotograma (desde Terrain.update): mira si algo ha cambiado, junta formas y lo pide, y sube lo que ha llegado
  update(x, z) {
    if (!MAIN) return;
    const t0 = performance.now(), T = this.t, w = T.world;
    if (!w?.colliderShapes) return;
    if (w !== this.world) { this.chunks.clear(); this.emptied.clear(); this.world = w; this.vil = w.village; this.villageSplit = null; }
    if (w.village !== this.vil) { this.vil = w.village; this.villageSplit = null; for (const c of this.chunks.values()) c.stale = true; }
    if (T.season !== this.season) { const was = this.season; this.season = T.season; if (was !== -1) this.seasonChanged(this.season); }
    const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK), n = BLOCK / CHUNK;
    const area = [(bx - 2) * n, (bz - 2) * n, (bx + 3) * n - 1, (bz + 3) * n - 1];
    if (!this.area || area[0] !== this.area[0] || area[1] !== this.area[1]) {
      this.area = area;
      for (const k of this.chunks.keys()) { const [cx, cy] = k.split(',').map(Number); if (!this.inArea(cx, cy)) this.chunks.delete(k); }
      // (los dados por vacíos que ya no tocan ningún bloque: ni dentro ni en el anillo de alrededor)
      for (const k of this.emptied) { const [cx, cy] = k.split(',').map(Number); if (cx < area[0] - 1 || cx > area[2] + 1 || cy < area[1] - 1 || cy > area[3] + 1) this.emptied.delete(k); }
    }
    // (si el hilo aparte ha fallado, lo que se le había pedido vuelve a la lista: se pinta aquí)
    const local = this.local || !T.workers.length;
    if (local) for (const b of T.blocks.values()) if (b.ao?.flying.size) { for (const i of b.ao.flying) b.ao.dirty.add(i); b.ao.flying.clear(); }
    if (t0 > this.poll) { this.poll = t0 + POLL_MS; this.check(t0); }
    this.pump(x, z, t0, local);
    this.flush(x, z);
    const s = this.stats; s.ms += performance.now() - t0; s.frames++;
  }
  inArea(cx, cy) { const a = this.area; return !!a && cx >= a[0] && cx <= a[2] && cy >= a[1] && cy <= a[3]; }
  // ¿Ha cambiado algún trozo? (su versión: la sube Overworld.touch al construir, quitar, talar… y el multijugador al
  // recibir un cambio). Se marca él y los de alrededor (los muros y las cercas se unen con los vecinos)
  // Los arbolitos plantados crecen con los días sin que cambie la versión del trozo: los trozos que tienen alguno se miran
  // otra vez cada SAP_MS (si nada ha cambiado, la huella es la misma y no se pinta nada)
  check(now) {
    const w = this.world, sap = now > (this.sapT || 0);
    if (sap) this.sapT = now + SAP_MS;
    for (const c of this.chunks.values()) {
      if (c.stale) continue;
      // (primero la versión: un cambio de verdad es urgente y alcanza a los vecinos, aunque toque mirar los arbolitos)
      if (deltaV(w, c.cx, c.cy) !== c.v) {
        c.stale = true; c.near = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const o = this.chunks.get(`${c.cx + dx},${c.cy + dy}`); if (o) { o.stale = true; o.near = true; } }
      } else if (sap && c.sap) c.stale = true;
    }
  }
  // Las formas de un trozo (las de la caché si valen; si no, se rehacen y, si han cambiado, se marcan para pintar los
  // trozos a los que llegan)
  shapes(cx, cy) {
    const k = `${cx},${cy}`;
    if (!this.inArea(cx, cy)) { this.emptied.add(k); return EMPTY; }
    const c = this.chunks.get(k);
    if (c && !c.stale) return c.S;
    const w = this.world, T = this.t, v = deltaV(w, cx, cy);
    const data = w.colliderShapes(cx, cy);
    const at = { lifted: (tx, ty) => (w.levelAt(tx + 0.5, ty + 0.5) ?? 0) - T.heightAt(tx + 0.5, ty + 0.5) > 0.28, floorAt: (tx, ty) => !!w.at('floor', tx, ty) };
    const S = shapesOf(data, this.season, at, this.villageIn(cx, cy)), hash = hashShapes(S);
    // (si ha cambiado; o, la primera vez, si algún bloque del borde lo pintó cuando aún estaba fuera, como vacío)
    const was = this.emptied.delete(k);
    if (c ? c.hash !== hash : was && S.length) this.mark(cx, cy, !!c?.near);
    this.chunks.set(k, { cx, cy, v, S, hash, stale: false, near: false, sap: data.objects.some(o => o.sapling) });
    return S;
  }
  // Lo fijo del pueblo que cae en el trozo (sus colisiones van aparte, en village.colliders; sin la elipse del estanque)
  villageIn(cx, cy) {
    const vil = this.world.village;
    if (!vil) return null;
    if (!this.villageSplit) {
      const m = (this.villageSplit = new Map()), at = (x, y) => { const key = `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`; if (!m.has(key)) m.set(key, { colliders: [], objects: [] }); return m.get(key); };
      for (const c of vil.colliders) if (c.rx === undefined) at(c.x ?? (c.x0 + c.x1) / 2, c.y ?? (c.y0 + c.y1) / 2).colliders.push(c);
      for (const o of vil.objects) if (o.nature) at(o.x, o.y).objects.push(o);
    }
    return this.villageSplit.get(`${cx},${cy}`) || null;
  }
  // Pintar otra vez los trozos de alrededor del trozo (cx, cy): las formas de un trozo llegan como mucho al de al lado
  mark(cx, cy, urgent) {
    const T = this.t;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy, b = T.blocks.get(`${Math.floor(x / 4)},${Math.floor(y / 4)}`);
      if (!b?.ao) continue;
      b.ao.dirty.add((y - b.bz * 4) * 4 + (x - b.bx * 4));
      if (urgent) b.ao.urgent = true;
    }
  }
  // Lo que falta por pintar, de lo urgente (algo que acaba de cambiar) y lo cercano a lo lejano: se juntan las formas que
  // llegan al bloque y se piden sus trozos al hilo aparte de una vez (o, sin él, se pintan aquí, poco a poco)
  pump(x, z, t0, local) {
    const T = this.t, over = () => performance.now() - t0 > PUMP_MS;
    // Primero, las formas que hay que rehacer (lo que ha cambiado, la estación, el pueblo), de lo cercano a lo lejano: así
    // se sabe qué trozos hay que volver a pintar (solo aquellos a los que llega algo que ha cambiado)
    const dist = (cx, cy) => Math.abs((cx + 0.5) * CHUNK - x) + Math.abs((cy + 0.5) * CHUNK - z);
    const stale = [];
    for (const c of this.chunks.values()) if (c.stale) stale.push(c);
    if (stale.length) {
      stale.sort((a, b) => (b.near - a.near) || dist(a.cx, a.cy) - dist(b.cx, b.cy));
      for (const c of stale) { if (over() && !c.near) break; this.shapes(c.cx, c.cy); }
    }
    const list = [];
    for (const b of T.blocks.values()) if (b.ao?.dirty.size) list.push(b);
    if (!list.length) return;
    const d = b => (b.ao.urgent ? -1e9 : 0) + Math.hypot(b.bx * BLOCK + BLOCK / 2 - x, b.bz * BLOCK + BLOCK / 2 - z);
    list.sort((a, b) => d(a) - d(b));
    for (const b of list) {
      if (over() && !b.ao.urgent) break;
      // Las formas de los 6 × 6 trozos (el bloque y su anillo) que llegan al bloque. Las que faltan se hacen ahora, hasta
      // agotar el tiempo de este fotograma (lo urgente, todas): si no da, se sigue en el siguiente
      const lists = [], c0x = b.bx * 4, c0y = b.bz * 4;
      let full = true;
      for (let cy = c0y - 1; cy <= c0y + 4 && full; cy++) for (let cx = c0x - 1; cx <= c0x + 4; cx++) {
        if (!this.fresh(cx, cy) && over() && !b.ao.urgent) { full = false; break; }
        lists.push(this.shapes(cx, cy));
      }
      if (!full) break;
      const x0 = b.bx * BLOCK, z0 = b.bz * BLOCK, tiles = [...b.ao.dirty];
      const S = shapesIn(lists, x0 - 4, z0 - 4, x0 + BLOCK + 4, z0 + BLOCK + 4);
      const pri = b.ao.urgent ? -1 : d(b) / BLOCK + 0.75;
      b.ao.dirty.clear(); b.ao.urgent = false;
      if (local) {
        // (sin hilo: aquí mismo, un trozo cada vez y hasta agotar lo que toca en este fotograma; lo demás, al siguiente)
        const px = (this.px ||= new Uint8Array(TILE * TILE * 2));
        for (let i = 0; i < tiles.length; i++) {
          if (i && performance.now() - t0 > PUMP_MS * 2) { for (const r of tiles.slice(i)) b.ao.dirty.add(r); break; }
          const ti = tiles[i];
          rasterTile(S, x0 + (ti % 4) * CHUNK, z0 + ((ti / 4) | 0) * CHUNK, px);
          this.paste(b, ti, px); this.stats.local++;
        }
        continue;
      }
      // (cada trozo con su número: lo que llegue de un pedido anterior, más viejo, no pisa al nuevo)
      const seqs = tiles.map(ti => (b.ao.seq[ti] = ++SEQ));
      for (const ti of tiles) b.ao.flying.add(ti);
      T.ask('ao', `${b.bx},${b.bz}`, pri, { bx: b.bx, bz: b.bz, x0, z0, tiles, seqs, shapes: S }, [S.buffer]);
      this.stats.tiles += tiles.length;
    }
  }
  fresh(cx, cy) { if (!this.inArea(cx, cy)) return true; const c = this.chunks.get(`${cx},${cy}`); return !!c && !c.stale; }
  // Lo que devuelve el hilo aparte (terrain.js, onResult)
  result(m) {
    const b = this.t.blocks.get(`${m.bx},${m.bz}`);
    if (!b?.ao) return;
    m.tiles.forEach((ti, i) => { if (m.seqs[i] !== b.ao.seq[ti]) return; b.ao.flying.delete(ti); this.paste(b, ti, m.pixels[i]); });
  }
  // Un trabajo que ha fallado en el hilo: sus trozos, otra vez a la lista, y desde ahora se pintan aquí
  failed(m) {
    const b = this.t.blocks.get(`${m.bx},${m.bz}`);
    this.local = true;
    if (b?.ao) for (const ti of m.tiles || []) { b.ao.flying.delete(ti); b.ao.dirty.add(ti); }
  }
  // Los píxeles de un trozo, a la copia en memoria y a la lista de lo que hay que subir
  paste(b, ti, px) {
    const ci = ti % 4, cj = (ti / 4) | 0, hx = slot(b.bx) * SIDE + ci * TILE, hz = slot(b.bz) * SIDE + cj * TILE;
    this.clean.delete(slot(b.bz) * SLOTS + slot(b.bx));
    for (let j = 0; j < TILE; j++) DATA.set(px.subarray(j * TILE * 2, (j + 1) * TILE * 2), ((hz + j) * ATLAS + hx) * 2);
    const u = b.ao.up;
    if (!b.ao.upNow) { b.ao.upNow = true; u[0] = u[2] = ci; u[1] = u[3] = cj; }
    else { u[0] = Math.min(u[0], ci); u[1] = Math.min(u[1], cj); u[2] = Math.max(u[2], ci); u[3] = Math.max(u[3], cj); }
  }
  // A la gráfica, lo cambiado de unos pocos bloques (un rectángulo por bloque), de lo más cercano a lo más lejano y los
  // huecos recién vaciados antes que nada; y las mipmaps de toda la textura, una sola vez al final
  flush(x, z) {
    const todo = [];
    for (const b of this.t.blocks.values()) if (b.ao?.upNow && b.mesh) todo.push(b);
    if (!todo.length) return;
    const done = () => { for (const b of todo) { b.ao.upNow = false; b.ao.blank = false; } };
    // (si ya se va a subir entera, porque se ha pedido y aún no se ha dibujado nada con ella, ya lleva todo: Three la sube
    // desde la copia en memoria)
    if (MAIN.properties.get(atlas).__version !== atlas.version) { done(); return; }
    // (muchos huecos recién vaciados, más que los de una fila y una columna de bloques, como al teletransportarse: entera,
    // una vez. Si no, durante unos fotogramas el suelo de donde se ha llegado enseñaría la oclusión del sitio de antes.
    // Andando entran como mucho 9, a dos bloques, en la niebla: esos van por partes, los vacíos primero)
    let blank = 0;
    for (const b of todo) if (b.ao.blank) blank++;
    if (blank > 2 * SLOTS - 1) { atlas.needsUpdate = true; done(); return; }
    const d = b => (b.ao.blank ? -1e9 : 0) + Math.hypot(b.bx * BLOCK + BLOCK / 2 - x, b.bz * BLOCK + BLOCK / 2 - z);
    todo.sort((a, b) => d(a) - d(b));
    todo.length = Math.min(todo.length, UPLOADS);
    try {
      todo.forEach((b, n) => {
        const u = b.ao.up, ci0 = u[0], cj0 = u[1], wpx = (u[2] - u[0] + 1) * TILE, hpx = (u[3] - u[1] + 1) * TILE;
        const hx = slot(b.bx) * SIDE + ci0 * TILE, hz = slot(b.bz) * SIDE + cj0 * TILE, key = wpx * 10000 + hpx;
        let s = SCRATCH.get(key);
        if (!s) { s = new THREE.DataTexture(new Uint8Array(wpx * hpx * 2), wpx, hpx, THREE.RGFormat, THREE.UnsignedByteType); SCRATCH.set(key, s); }
        const dd = s.image.data;
        for (let j = 0; j < hpx; j++) dd.set(DATA.subarray(((hz + j) * ATLAS + hx) * 2, ((hz + j) * ATLAS + hx + wpx) * 2), j * wpx * 2);
        // (copyTextureToTexture rehace las mipmaps de toda la textura en cada copia: se apagan para todas menos la última.
        // Se puede porque no hay una subida entera pendiente (ver arriba): generateMipmaps entra en la clave con la que Three
        // guarda la textura en la gráfica, pero esa clave solo se mira al subirla entera)
        atlas.generateMipmaps = n === todo.length - 1;
        MAIN.copyTextureToTexture(V2.set(hx, hz), s, atlas);
        b.ao.upNow = false; b.ao.blank = false;
        this.stats.uploads++;
      });
    } catch (e) {
      // (si la copia por partes no va, la textura entera, como mucho tres veces por segundo)
      if (!this.warned) { this.warned = true; console.warn('Sombra de contacto: no se puede subir por partes; se sube entera', e); }
      if (performance.now() > (this.whole || 0)) { this.whole = performance.now() + 300; atlas.needsUpdate = true; done(); }
    } finally { atlas.generateMipmaps = true; }
  }
  // ¿Queda algo por hacer? (para las pruebas y el banco)
  busy() {
    if (!MAIN) return false;
    for (const b of this.t.blocks.values()) if (b.ao && (b.ao.dirty.size || b.ao.flying.size || b.ao.upNow)) return true;
    return false;
  }
  // Para F3: trozos pendientes (por pedir y en el hilo), pedidos y subidas por segundo, y lo que cuesta aquí
  text() {
    let dirty = 0, flying = 0;
    for (const b of this.t.blocks.values()) if (b.ao) { dirty += b.ao.dirty.size; flying += b.ao.flying.size; }
    const s = this.stats, now = performance.now(), dt = (now - (s.t || now)) / 1000 || 1;
    const out = `contacto: ${dirty} trozos por pedir · ${flying} en el hilo · ${(s.tiles / dt).toFixed(1).replace('.', ',')} pedidos/s · ${(s.uploads / dt).toFixed(1).replace('.', ',')} subidas/s · ${s.frames ? (s.ms / s.frames).toFixed(2).replace('.', ',') : '0'} ms por fotograma · ${this.chunks.size} trozos con formas${this.local || !this.t.workers.length ? ` · ${s.local} pintados aquí` : ''}`;
    if (dt > 2) { s.tiles = s.uploads = s.ms = s.frames = 0; s.t = now; }
    return out;
  }
}
const V2 = new THREE.Vector2(), EMPTY = new Float32Array(0);
let SEQ = 0;
// La versión de un trozo (sin delta(), que añade campos a los de partidas antiguas), o -1 si no tiene cambios. Más allá de
// la costura del planeta, la del mismo trozo una vuelta antes
const deltaV = (w, cx, cy) => w.deltas.get(`${wrapIndex(cx, CHUNK)},${cy}`)?.v ?? -1;
