// Jugar juntos en directo: el mundo compartido. Es el del anfitrión (el admin). Al entrar, los demás reciben
// sus trozos con todos sus cambios y lo que es de todos (la hora, la casa, los proyectos y los encargos del
// pueblo, el museo y los animales). Lo de cada uno (su personaje, lo que lleva, su dinero, sus habilidades,
// la amistad con los vecinos, lo que ha descubierto…) sigue siendo suyo y se guarda en su partida.
//
// Mientras se juega, cada cambio en un trozo del mundo (talar, picar, construir, el huerto, las puertas, los
// cofres…) se manda como la diferencia entre cómo estaba la última vez que se mandó y cómo está, casilla a
// casilla. Los invitados se lo mandan al anfitrión, que lo aplica y se lo reparte a todos (también a quien lo
// hizo): así, si dos tocan lo mismo a la vez, todos acaban con lo que dice el anfitrión. Lo que pasa solo (la
// hora, que crezcan los cultivos, que los animales den su producto y por dónde pasean) lo lleva el anfitrión.

// Lo de la partida que es del mundo (y no de cada jugador)
export const SHARED = ['clock', 'house', 'projects', 'boardDone', 'animals', 'museum'];

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
// dónde va cada animal) y cómo ponerlo
export const BLOBS = {
  house: { get: g => g.house, set: (g, v) => Object.assign(g.house, v) },
  board: { get: g => ({ projects: g.board.projects, done: g.board.done }), set: (g, v) => g.board.share(v) },
  museum: { get: g => [...g.collection.donated].sort(), set: (g, v) => { g.collection.donated = new Set(v); } },
  animals: { get: g => g.ranch.animals.map(a => { const { x, y, ...s } = a.toSave(); return s; }), set: (g, v) => g.ranch.share(v) },
};
