// Jugar juntos en directo: el mundo compartido. Lo lleva el juego del anfitrión (el primero que entra). Al
// entrar, los demás reciben sus trozos con todos sus cambios y lo que es de todos (la hora y el calendario, la
// casa, los proyectos y los encargos del pueblo y los animales). Lo de cada uno (su personaje, lo que lleva, su dinero, sus habilidades,
// la amistad con los vecinos, lo que ha descubierto…) sigue siendo suyo y se guarda en su partida.
//
// Mientras se juega, cada cambio en un trozo del mundo (talar, picar, construir, el huerto, las puertas, los
// cofres…) se manda como la diferencia entre cómo estaba la última vez que se mandó y cómo está, casilla a
// casilla. Los invitados se lo mandan al anfitrión, que lo aplica y se lo reparte a todos (también a quien lo
// hizo): así, si dos tocan lo mismo a la vez, todos acaban con lo que dice el anfitrión. Lo que pasa solo (la
// hora, que crezcan los cultivos, que los animales den su producto y por dónde pasean) lo lleva el anfitrión.

import { setFamilyHouse } from './world/village.js';

// Lo de la partida que es del mundo (y no de cada jugador)
// (dayBase, timeShift y seenDay: el calendario del mundo y el último día que amaneció en él)
// (rules, worldSpawn, weatherLock y difficulty: las reglas del mundo, dónde aparecen los nuevos, el tiempo que ha
// puesto un op y la dificultad)
export const SHARED = ['clock', 'house', 'projects', 'boardDone', 'animals', 'farm', 'family', 'dayBase', 'timeShift', 'seenDay', 'rules', 'worldSpawn', 'weatherLock', 'difficulty', 'maps', 'defaultGamemode', 'frozenHour'];

// Lo del mundo guardado que este juego no conoce: de una versión más nueva (una clave que se añadió después). Quien lleva
// el mundo lo vuelve a guardar tal cual (ver worldOf en live.js), para no perderlo. RETIRED: lo que se quitó del juego
// (el museo), que no se arrastra
const RETIRED_SHARED = new Set(['museum']);
export const unknownShared = shared => Object.fromEntries(Object.entries(shared || {}).filter(([k]) => !SHARED.includes(k) && !RETIRED_SHARED.has(k)));

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
export const copy = v => (v === undefined ? v : structuredClone(v));

// Lo que ha cambiado en un trozo: una lista de [capa] (quitarla), [capa, null, valor] (ponerla entera),
// [capa, casilla] (quitar lo de esa casilla) y [capa, casilla, valor]. Las capas son lo talado, lo labrado,
// lo construido, los cultivos, los cofres… (v, el contador de cambios de cada ordenador, no cuenta).
export function diffChunk(prev = {}, cur = {}) {
  const ops = [];
  for (const f of new Set([...Object.keys(prev), ...Object.keys(cur)])) {
    if (f === 'v') continue;
    const a = prev[f], b = cur[f];
    if (isMap(a) && isMap(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!(k in b)) ops.push([f, k]);
        else if (!(k in a) || !same(a[k], b[k])) ops.push([f, k, b[k]]);
      }
    } else if (a === undefined && isMap(b) && Object.keys(b).length) {
      // (un mapa nuevo va casilla a casilla: entero pisaría lo que otro haya hecho a la vez en él)
      for (const k of Object.keys(b)) ops.push([f, k, b[k]]);
    } else if (!same(a, b)) ops.push(b === undefined ? [f] : [f, null, b]);
  }
  return ops;
}
export function applyOps(d, ops) {
  for (const [f, k, v] of ops) {
    if (k === undefined) delete d[f];
    else if (k === null) d[f] = copy(v);
    else if (v === undefined) { if (isMap(d[f])) delete d[f][k]; }
    else { if (!isMap(d[f])) d[f] = {}; d[f][k] = copy(v); }
  }
}

// Lo de todos que no va en los trozos del mundo: cómo leerlo (sin lo que cambia a cada momento, como por
// dónde va cada animal) y cómo ponerlo. NORMA: uno nuevo se llama igual que su clave de SHARED, y su valor es el que se
// guarda en ella: así un juego más viejo que lo lleva, que no lo conoce, lo guarda tal cual (unknownBlob en live.js)
export const BLOBS = {
  house: {
    get: g => g.house,
    set: (g, v) => {   // (si ahora es la casa familiar, el jardín cambia: el pueblo se rehace)
      const was = !!g.house.family;
      Object.assign(g.house, v);
      if (!!v.family !== was) { setFamilyHouse(v.family); g.world.rebuildVillage(); }
    },
  },
  family: { get: g => g.family.v, set: (g, v) => g.family.share(v) },
  board: { get: g => ({ projects: g.board.projects, done: g.board.done }), set: (g, v) => g.board.share(v) },
  animals: { get: g => [...g.ranch.animals.map(a => { const { x, y, ...s } = a.toSave(); return s; }), ...g.ranch.unknown], set: (g, v) => g.ranch.share(v) },   // (unknown: los de una versión más nueva, tal cual)
  farm: { get: g => g.ranch.farm, set: (g, v) => g.ranch.shareFarm(v) },
  rules: { get: g => g.rules, set: (g, v) => { g.rules = { ...g.rules, ...v }; } },
  worldSpawn: { get: g => g.worldSpawn, set: (g, v) => { g.worldSpawn = v; } },
  weatherLock: { get: g => g.weatherLock, set: (g, v) => { g.weatherLock = v; } },
  difficulty: { get: g => g.difficulty, set: (g, v) => { g.difficulty = v; } },
  maps: { get: g => g.maps.data, set: (g, v) => { g.maps.data = v || {}; } },   // (lo dibujado en los mapas)
  defaultGamemode: { get: g => g.defaultGamemode, set: (g, v) => { g.defaultGamemode = v; } },
};

// ---------- lo de todos, elemento a elemento ----------
// Los animales, la familia y la granja (el heno del silo y el correo del palomar) no van enteros: enteros, lo de uno
// borraba lo del otro (un ternero que nacía en el juego de quien lleva el mundo justo cuando el otro mandaba su lista,
// sin él, desaparecía). Cada uno es una lista de elementos con un id que no cambia (cada animal, cada hijo, cada envío
// del palomar; lo que no es de ninguno, en '@') y se manda solo lo que ha cambiado de cada elemento, campo a campo:
//   ['put', id, todo]          uno nuevo
//   ['set', id, campo, valor]  ['del', id, campo]  (un campo que ya no está)
//   ['add', id, campo, n]      lo que se suma (el heno, el cariño): si dos cogen heno a la vez, cuentan los dos
//   ['drop', id]               ya no está (y no vuelve: un cambio que llegue tarde no lo resucita)
// Como con las casillas de los trozos, los invitados se lo mandan a quien lleva el mundo, que lo aplica en el orden en
// que llega y se lo reparte a todos (también a quien lo hizo): gana lo que dice él. Para que algo que acabas de hacer no
// se deshaga un momento con lo que él mandó antes de recibirlo, cada envío del invitado lleva un número (seq) y quien
// lleva el mundo dice hasta cuál ha aplicado de cada uno (ack): lo suyo que aún no lo incluye no pisa tus campos.
// Los juegos de antes (sin perItem en el saludo) siguen con las listas enteras de BLOBS: ver syncMode en live.js.
// Por si algo se ha perdido por el camino (quien lo llevaba se fue sin aplicarlo o sin repartirlo), quien lleva el mundo
// manda de vez en cuando (y al empezar a llevarlo) la foto entera ('el' con full): quien la recibe pone lo que le falta,
// quita lo que sobra (salvo lo suyo aún sin aplicar allí) y queda igual. Y el invitado, si lo pasa a llevar otro, le
// vuelve a mandar lo suyo que el de antes no llegó a aplicar (unsend).
// counters: los campos que se suman, y entre qué valores quedan. guestDrops: si un invitado puede quitar elementos (los
// animales y los hijos solo los quita quien lleva el mundo: si a un invitado le falta uno, se le devuelve). whole: los
// elementos de la lista entera de BLOBS (la de los juegos de antes), para partir de lo último que se mandó entero.
// Los ids no se repiten: uno quitado no vuelve (por eso cada embarazo tiene el suyo: ver Family.netItems)
export const COLLECTIONS = {
  animals: { items: g => g.ranch.netItems(), whole: (g, v) => new Map((Array.isArray(v) ? v : []).filter(s => typeof s?.id === 'string').map(s => [s.id, s])), apply: (g, ops) => g.ranch.netApply(ops), counters: { love: [0, 10] }, guestDrops: false },
  family: { items: g => g.family.netItems(), whole: (g, v) => g.family.netItems(v || {}), apply: (g, ops) => g.family.netApply(ops), guestDrops: false },
  farm: { items: g => g.ranch.farmItems(), whole: (g, v) => g.ranch.farmItems(v || {}), apply: (g, ops) => g.ranch.farmApply(ops), counters: { hay: [0, Infinity] }, guestDrops: true },
};
const OPS = new Set(['put', 'set', 'del', 'add', 'drop']);
const BAD_FIELDS = new Set(['__proto__', 'constructor', 'prototype']);
const valid = op => Array.isArray(op) && OPS.has(op[0]) && typeof op[1] === 'string' && op[1].length <= 400 && !BAD_FIELDS.has(op[1])
  && (op[0] === 'drop' || (op[0] === 'put' ? isMap(op[2]) : typeof op[2] === 'string' && !BAD_FIELDS.has(op[2]) && (op[0] !== 'add' || Number.isFinite(op[3]))));
const slot = (id, f) => `${id}\u0000${f}`;
// (en inflight, además de los campos: que el elemento es nuevo, PUT, o que lo has quitado, DROP)
const PUT = '\u0001put', DROP = '\u0001drop';

// Una colección como se repartió la última vez (base: id → su JSON), lo que se ha quitado (gone) y, en el invitado, lo
// suyo que ha mandado y aún no ha visto aplicado por quien lleva el mundo (inflight: id + campo → el seq con que se mandó)
export class ItemSync {
  constructor(name) {
    this.name = name; this.def = COLLECTIONS[name];
    this.base = new Map(); this.gone = new Set(); this.inflight = new Map(); this.redrop = new Set();
  }
  // Desde lo que hay ahora, sin mandar nada (al entrar en el mundo), o desde la lista entera que se acaba de mandar o de
  // recibir (whole: jugando con un juego de antes; al volver a esto, lo cambiado desde entonces sí se manda)
  reset(g, whole) {
    this.base.clear(); this.inflight.clear(); this.redrop.clear();
    for (const [id, o] of whole === undefined ? this.def.items(g) : this.def.whole(g, whole)) this.base.set(id, JSON.stringify(o));
  }
  // (invitado) Lo has mandado a quien llevaba el mundo y no sabes si lo aplicó (se ha ido, o lo lleva otro): vuelve a quedar
  // por mandar. Los campos van con lo que valen (no lo sumado: quien lo lleva ahora puede que ya lo tenga), lo nuevo
  // otra vez entero y lo quitado otra vez quitado
  unsend() {
    for (const k of this.inflight.keys()) {
      const [id, f] = k.split('\u0000'), was = this.base.get(id);
      if (f === DROP) this.redrop.add(id);
      else if (f === PUT) this.base.delete(id);
      else if (was !== undefined) { const o = JSON.parse(was); delete o[f]; this.base.set(id, JSON.stringify(o)); }
    }
    this.inflight.clear();
  }
  // (invitado) Si es tuyo y aún no lo han aplicado allí: lo nuevo, lo quitado o alguno de sus campos
  mine(id) { for (const k of this.inflight.keys()) if (k.startsWith(`${id}\u0000`)) return true; return false; }
  // (quien lleva el mundo) La foto entera: lo cambiado queda como repartido (y lo quitado, en gone) y va todo como put
  full(g) {
    this.diff(g);
    return [...this.def.items(g)].map(([id, o]) => ['put', id, o]);
  }
  // Lo que ha cambiado desde la última vez, y queda como repartido. seq: el número del envío, si eres invitado (tus
  // contadores van como lo que has sumado; los de quien lleva el mundo, con lo que valen)
  diff(g, seq = null) {
    const ops = [], seen = new Set(), counters = this.def.counters || {};
    for (const [id, o] of this.def.items(g)) {
      seen.add(id);
      const s = JSON.stringify(o), was = this.base.get(id);
      if (was === s) continue;
      this.base.set(id, s);
      if (was === undefined) {
        const all = JSON.parse(s); ops.push(['put', id, all]); this.gone.delete(id);
        if (seq !== null) { this.inflight.set(slot(id, PUT), seq); for (const f in all) this.inflight.set(slot(id, f), seq); }
        continue;
      }
      const a = JSON.parse(was), b = JSON.parse(s);
      for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!(f in b)) ops.push(['del', id, f]);
        else if (!(f in a) || JSON.stringify(a[f]) !== JSON.stringify(b[f])) ops.push(seq !== null && counters[f] && typeof a[f] === 'number' && typeof b[f] === 'number' ? ['add', id, f, b[f] - a[f]] : ['set', id, f, b[f]]);
        else continue;
        if (seq !== null) this.inflight.set(slot(id, f), seq);
      }
    }
    for (const id of [...this.base.keys()]) if (!seen.has(id)) {
      this.base.delete(id); this.gone.add(id); ops.push(['drop', id]);
      if (seq !== null) { for (const k of [...this.inflight.keys()]) if (k.startsWith(`${id}\u0000`)) this.inflight.delete(k); this.inflight.set(slot(id, DROP), seq); }
    }
    for (const id of this.redrop) if (!seen.has(id) && !ops.some(op => op[1] === id)) { ops.push(['drop', id]); if (seq !== null) this.inflight.set(slot(id, DROP), seq); }
    this.redrop.clear();
    return ops;
  }
  // Llegan cambios. fromHost: de quien lleva el mundo (ack: hasta qué envío tuyo ha aplicado; full: es la foto entera);
  // si no, de un invitado y los aplicas tú, que lo llevas: devuelve lo que no se deja, para devolvérselo como está aquí.
  // trusted: de quien lo llevaba hasta que te lo pasó (el mundo del servidor, mientras se lo pasa): puede quitar
  apply(g, ops, fromHost, ack = null, { full = false, trusted = false } = {}) {
    const cur = this.def.items(g), out = [], back = [], counters = this.def.counters || {}, sums = new Map();
    if (fromHost) for (const [k, seq] of this.inflight) if (ack !== null && seq <= ack) this.inflight.delete(k);
    const held = (id, f) => fromHost && this.inflight.has(slot(id, f));   // (tuyo y aún sin aplicar allí: se queda lo tuyo)
    for (const op of ops) {
      if (!valid(op)) continue;
      const [kind, id, f, v] = op, have = cur.get(id);
      if (kind === 'drop') {
        if (!fromHost && !trusted && !this.def.guestDrops) { if (have) back.push(['put', id, JSON.parse(JSON.stringify(have))]); continue; }   // (que lo vuelva a tener)
        this.gone.add(id);
        if (fromHost) for (const k of this.inflight.keys()) if (k.startsWith(`${id}\u0000`)) this.inflight.delete(k);
        if (have) { out.push(op); cur.delete(id); }
        continue;
      }
      if (kind === 'put') {
        if (!fromHost && this.gone.has(id)) { back.push(['drop', id]); continue; }   // (ya no está: no se resucita)
        if (!have) { if (held(id, DROP)) continue; out.push(['put', id, f]); cur.set(id, f); if (fromHost) this.gone.delete(id); continue; }   // (lo acabas de quitar tú: no vuelve)
        // (uno que ya está: campo a campo, como si fueran set y del)
        for (const k of new Set([...Object.keys(have), ...Object.keys(f)])) {
          if (held(id, k) || BAD_FIELDS.has(k)) continue;
          if (!(k in f)) out.push(['del', id, k]);
          else if (JSON.stringify(have[k]) !== JSON.stringify(f[k])) out.push(['set', id, k, f[k]]);
        }
        continue;
      }
      if (!have) { if (!fromHost) back.push(['drop', id]); continue; }   // (de uno que ya no está)
      if (held(id, f)) continue;
      if (kind === 'add') {
        const range = counters[f] || [-Infinity, Infinity], k = slot(id, f), now = sums.has(k) ? sums.get(k) : Number(have[f]) || 0;
        const n = Math.min(range[1], Math.max(range[0], now + v));
        sums.set(k, n); out.push(['set', id, f, n]);
      } else out.push(kind === 'set' ? ['set', id, f, v] : ['del', id, f]);
    }
    // (la foto entera: lo que aquí sobra se quita, salvo lo tuyo que allí aún no han aplicado)
    if (full) {
      const there = new Set(ops.filter(valid).map(op => op[1]));
      for (const id of cur.keys()) if (!there.has(id) && !this.mine(id)) { out.push(['drop', id]); this.gone.add(id); }
    }
    if (out.length) this.def.apply(g, out);
    // (el invitado: lo que acaba de llegar queda como repartido, para no volver a mandarlo)
    if (fromHost && out.length) {
      const now = this.def.items(g);
      for (const id of new Set(out.map(op => op[1]))) { const o = now.get(id); if (o) this.base.set(id, JSON.stringify(o)); else this.base.delete(id); }
    }
    return back;
  }
}
