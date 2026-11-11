// La sombra de contacto, en números y sin Three (vale también en el hilo aparte, genworker.js). Lo que hay en el suelo
// (muros, cercas, muebles, rocas, troncos, cimientos y las copas de los árboles) se pasa a formas sencillas vistas desde
// arriba, y de ellas sale cuánta luz del cielo llega a cada palmo del suelo: junto al pie de un muro, en un rincón o bajo
// una mesa, menos. Se pinta en una textura del mundo (three/contact3d.js) que leen el suelo, la hierba y los suelos de
// las casas. Es como la oclusión ambiental de un juego grande, pero calculada una vez y no en cada fotograma: solo se
// rehace donde algo cambia.
// Dos canales: el contacto (R), que es lo que está pegado al suelo, y la copa de los árboles (G), que tapa el cielo y,
// donde ya no llegan las sombras de verdad, también el sol.
import { CHUNK } from './gen.js';
import { canopyOf } from './treedims.js';

export const AO_PX = 4;                    // píxeles por metro (como la textura del suelo: ground.js, PX)
export const TILE = CHUNK * AO_PX;         // píxeles de lado de un trozo
export const STRIDE = 10;                  // números por forma: [tipo, x, y, a, b, ux, uy, s, R, canal]
const CIRCLE = 0, BOX = 1, EDGE = 2;
// Lo más que oscurece cada canal (el contacto puede llegar a un tercio; la copa, por muchas que se junten, no deja el
// bosque negro)
export const AO_MIN = 0.32, CANOPY_MIN = 0.62;
const TREES = new Set(['oak', 'fruit', 'pine', 'snowPine', 'swampTree', 'palm']);
const ROUND_KIND = { bush: [0.4, 0.5], cactus: [0.35, 0.4], deadBush: [0.2, 0.25] };   // [fuerza, alcance] de lo que no es árbol

// Las formas de un trozo, en un Float32Array de STRIDE números cada una. data: lo de contentFor (objetos, colisiones y
// suelos); season: la estación (los árboles de hoja caduca, en invierno, casi no tapan el cielo); at: lo que hace falta
// saber del mundo: lifted(tx, ty), si un suelo va alzado sobre su cimiento, y floorAt(tx, ty), si hay suelo. extra: más
// colisiones y objetos (los del pueblo, que van aparte). Cada forma lleva su fuerza (s: lo que quita en su sitio, de 0 a 1)
// y su alcance (R: los metros en los que se desvanece)
export function shapesOf(data, season, at, extra = null) {
  const out = [];
  const push = (t, x, y, a, b, ux, uy, s, R, ch) => out.push(t, x, y, a, b, ux, uy, s, R, ch);
  const kinds = new Map();   // "x,y" → el objeto que hay ahí (para saber qué es cada círculo que choca)
  const objects = extra ? [...data.objects, ...extra.objects] : data.objects;
  for (const o of objects) {
    const kind = o.kind || o.nature;
    if (!kind && !o.sapling) continue;
    kinds.set(`${o.x},${o.y}`, o);
    // La copa: tapa el cielo (en invierno, los de hoja caduca casi nada; el sauce, algo menos); las palmeras, poco
    // (en a, la clase de copa: ver canopyS; la fuerza se pone al final, con la estación)
    if (TREES.has(kind)) {
      const R = canopyOf(o);
      if (R > 0) push(CIRCLE, o.x, o.y, CANOPY_CLASS[kind], 0, 0, 0, 0, R, 1);
    }
  }
  const colliders = extra ? [...data.colliders, ...extra.colliders] : data.colliders;
  for (const c of colliders) {
    if (c.rx !== undefined) continue;   // (la elipse del estanque del pueblo: no es algo que esté encima del suelo)
    if (c.spiral) continue;             // (el hueco de la escalera de la torre: se pisa, no tapa nada)
    if (c.dig) continue;                // (lo cavado con la pala: es suelo, más bajo o más alto)
    if (c.obb) {
      // Lo colocado libre (con su giro) y las casas grandes: su caja
      const b = c.obb, big = Math.max(b.hx, b.hy) > 0.75;
      push(BOX, b.x, b.y, b.hx, b.hy, b.ux, b.uy, big ? 0.55 : 0.5, big ? 1.2 : 0.8, 0);
      continue;
    }
    if (c.r !== undefined) {
      const o = kinds.get(`${c.x},${c.y}`), kind = o && (o.kind || o.nature);
      let r = c.r, s, R;
      if (c.top !== undefined) [s, R] = c.top > 0.5 ? [0.6, 0.9] : [0.45, 0.5];   // (rocas: las grandes, más)
      else if (c.low) [s, R] = [0.35, 0.35];                                      // (el poste de una cerca)
      else if (TREES.has(kind)) { r = Math.min(r, 0.35) * 0.7; [s, R] = [0.5, 0.6]; }   // (el tronco, más fino que su choque)
      else if (o?.sapling) [s, R] = [0.25, 0.3];
      else if (ROUND_KIND[kind]) [s, R] = ROUND_KIND[kind];
      else [s, R] = [0.4, 0.45];   // (sillas, farolas, cofres, el buzón…)
      push(CIRCLE, c.x, c.y, r, 0, 0, 0, s, R, 0);
      continue;
    }
    if (c.x0 === undefined) continue;
    // Una puerta cerrada, como abierta: sus dos jambas (la de una cerca, sus postes, que ya van aparte). Así, al abrirla
    // o cerrarla, la huella no cambia: ni salta la oclusión del umbral ni hay nada que repintar
    if (c.shut) {
      if (!c.wall) continue;
      const J = 0.14;
      if (c.x1 - c.x0 > c.y1 - c.y0) for (const [a, b] of [[c.x0, c.x0 + J], [c.x1 - J, c.x1]]) push(BOX, (a + b) / 2, (c.y0 + c.y1) / 2, J / 2, (c.y1 - c.y0) / 2, 1, 0, 0.6, 1.0, 0);
      else for (const [a, b] of [[c.y0, c.y0 + J], [c.y1 - J, c.y1]]) push(BOX, (c.x0 + c.x1) / 2, (a + b) / 2, (c.x1 - c.x0) / 2, J / 2, 1, 0, 0.6, 1.0, 0);
      continue;
    }
    const hx = (c.x1 - c.x0) / 2, hy = (c.y1 - c.y0) / 2, x = (c.x0 + c.x1) / 2, y = (c.y0 + c.y1) / 2;
    let s, R;
    if (c.wall) [s, R] = [0.6, 1.0];           // (muros y puertas)
    else if (c.piece) [s, R] = [0.5, 0.9];     // (el hogar)
    else if (c.low) [s, R] = [0.18, 0.3];      // (las traviesas de una cerca, en alto)
    else if (Math.max(hx, hy) > 1) [s, R] = [0.3, 0.8];   // (lo grande, como los lugares: debajo puede haber hueco)
    else [s, R] = [0.45, 0.6];                 // (muebles)
    push(BOX, x, y, hx, hy, 1, 0, s, R, 0);
  }
  // Los suelos alzados: su cimiento de piedra, por los lados que dan afuera (por dentro sigue el suelo, que no se
  // oscurece). Un suelo a ras del terreno no hace sombra: mide 3 cm
  if (at) for (const f of data.floors || []) {
    const [tx, ty] = f.tile;
    if (f.placed === 'camino' || !at.lifted(tx, ty)) continue;
    // (u: a lo largo del borde, con la normal (-uy, ux) hacia fuera)
    if (!at.floorAt(tx, ty - 1)) push(EDGE, tx + 0.5, ty, 0.5, 0, -1, 0, 0.5, 0.8, 0);
    if (!at.floorAt(tx, ty + 1)) push(EDGE, tx + 0.5, ty + 1, 0.5, 0, 1, 0, 0.5, 0.8, 0);
    if (!at.floorAt(tx - 1, ty)) push(EDGE, tx, ty + 0.5, 0.5, 0, 0, 1, 0.5, 0.8, 0);
    if (!at.floorAt(tx + 1, ty)) push(EDGE, tx + 1, ty + 0.5, 0.5, 0, 0, -1, 0.5, 0.8, 0);
  }
  return seasonShapes(new Float32Array(out), season);
}
// Lo que tapa cada copa según la estación: los pinos, siempre; los de hoja caduca, en invierno, casi nada (la nieve bajo
// un roble pelado no sale gris); el sauce, algo más (sus ramillas); las palmeras, poco. Se cambia en el sitio: al cambiar
// de estación no hace falta volver a juntar las formas, solo esto
const CANOPY_CLASS = { pine: 0, snowPine: 0, oak: 1, fruit: 1, swampTree: 2, palm: 3 };
const canopyS = (cls, season) => (cls === 0 ? 0.25 : cls === 3 ? 0.08 : season === 3 ? (cls === 2 ? 0.14 : 0.08) : 0.22);
export function seasonShapes(S, season) {
  for (let i = 0; i < S.length; i += STRIDE) if (S[i + 9] === 1) S[i + 7] = canopyS(S[i + 3], season);
  return S;
}

// Hasta dónde llega una forma: [x0, y0, x1, y1]
function reach(S, i) {
  const t = S[i], x = S[i + 1], y = S[i + 2], a = S[i + 3], b = S[i + 4], ux = Math.abs(S[i + 5]), uy = Math.abs(S[i + 6]), R = S[i + 8];
  if (S[i + 9] === 1) { const e = 1.15 * R; return [x - e, y - e, x + e, y + e]; }
  if (t === CIRCLE) { const e = a + R; return [x - e, y - e, x + e, y + e]; }
  const ex = ux * a + uy * b + R, ey = uy * a + ux * b + R;
  return [x - ex, y - ey, x + ex, y + ey];
}
// Las formas que llegan a un rectángulo del mundo (de varias listas: las de los trozos de alrededor)
export function shapesIn(lists, x0, y0, x1, y1) {
  let n = 0;
  for (const S of lists) for (let i = 0; i < S.length; i += STRIDE) { const e = reach(S, i); if (e[2] > x0 && e[0] < x1 && e[3] > y0 && e[1] < y1) n++; }
  const out = new Float32Array(n * STRIDE);
  let k = 0;
  for (const S of lists) for (let i = 0; i < S.length; i += STRIDE) {
    const e = reach(S, i);
    if (e[2] > x0 && e[0] < x1 && e[3] > y0 && e[1] < y1) { out.set(S.subarray(i, i + STRIDE), k); k += STRIDE; }
  }
  return out;
}

// Pinta un trozo (TILE × TILE píxeles, con su esquina en x0, z0 del mundo) en out, desde el byte o: dos bytes por píxel
// (contacto y copa), por filas de z. Cada forma multiplica la luz que queda (1 - lo que quita): donde se juntan dos, como
// en un rincón, se oscurece más, como pasa de verdad
const AC = new Float32Array(TILE * TILE), AT = new Float32Array(TILE * TILE);
export function rasterTile(S, x0, z0, out, o = 0) {
  AC.fill(1); AT.fill(1);
  const step = 1 / AO_PX;
  for (let i = 0; i < S.length; i += STRIDE) {
    const e = reach(S, i);
    const i0 = Math.max(0, Math.floor((e[0] - x0) * AO_PX)), i1 = Math.min(TILE - 1, Math.ceil((e[2] - x0) * AO_PX));
    const j0 = Math.max(0, Math.floor((e[1] - z0) * AO_PX)), j1 = Math.min(TILE - 1, Math.ceil((e[3] - z0) * AO_PX));
    if (i0 > i1 || j0 > j1) continue;
    const t = S[i], cx = S[i + 1], cy = S[i + 2], a = S[i + 3], b = S[i + 4], ux = S[i + 5], uy = S[i + 6], s = S[i + 7], R = S[i + 8];
    if (S[i + 9] === 1) {
      // La copa: un disco que se desvanece hacia el borde (de un cuarto del radio a algo más que el radio)
      const lo = 0.25 * R, hi = 1.15 * R, k = 1 / (hi - lo);
      for (let j = j0; j <= j1; j++) {
        const pz = z0 + (j + 0.5) * step - cy, row = j * TILE;
        for (let q = i0; q <= i1; q++) {
          const px = x0 + (q + 0.5) * step - cx, d = Math.sqrt(px * px + pz * pz);
          if (d >= hi) continue;
          const u = d <= lo ? 0 : (d - lo) * k, sm = u * u * (3 - 2 * u);
          AT[row + q] *= 1 - s * (1 - sm);
        }
      }
      continue;
    }
    // El contacto: todo dentro de lo que ocupa; fuera, se va suave (una curva en S) hasta R
    const kR = 1 / R;
    for (let j = j0; j <= j1; j++) {
      const pz = z0 + (j + 0.5) * step - cy, row = j * TILE;
      for (let q = i0; q <= i1; q++) {
        const px = x0 + (q + 0.5) * step - cx;
        let d;
        if (t === CIRCLE) d = Math.sqrt(px * px + pz * pz) - a;
        else {
          const lx = px * ux + pz * uy, ly = pz * ux - px * uy;   // (a lo largo de u y de v = (-uy, ux))
          if (t === EDGE) { if (ly <= 0) continue; d = Math.hypot(Math.max(Math.abs(lx) - a, 0), ly); }
          else d = Math.hypot(Math.max(Math.abs(lx) - a, 0), Math.max(Math.abs(ly) - b, 0));
        }
        if (d >= R) continue;
        const f = d <= 0 ? 1 : 1 - d * kR;
        AC[row + q] *= 1 - s * f * f * (3 - 2 * f);
      }
    }
  }
  for (let p = 0; p < TILE * TILE; p++) {
    out[o + 2 * p] = Math.round(255 * Math.max(AO_MIN, AC[p]));
    out[o + 2 * p + 1] = Math.round(255 * Math.max(CANOPY_MIN, AT[p]));
  }
  return out;
}

// Una huella de las formas (FNV-1a): si no cambia, no hace falta volver a pintar
export function hashShapes(S) {
  const u = new Uint32Array(S.buffer, S.byteOffset, S.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
  return (h ^ u.length) >>> 0;
}
