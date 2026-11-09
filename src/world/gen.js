// Generador del mundo: a partir de una semilla decide el bioma, el suelo y la naturaleza de cualquier casilla.
// Todo es determinista: la misma semilla y la misma casilla dan siempre lo mismo.
import { mk, ihash, rgbOf } from '../util.js';
import * as village from './village.js';
import { B, BIOMES, climate, classify, biomeAt, wetness, depthOfWet, shoreOf } from './biomes.js';
import { wrapNoise, wrapIndex } from './planet.js';

export const CHUNK = 16;
// Solo hay un mundo, el mismo para todas las partidas: esta es su semilla
export const WORLD_SEED = 20261030;
export const RES = 4;   // muestras de clima por casilla (el clima cambia despacio: no hace falta calcularlo por píxel)
const ROOF = '#c95a3c', PATH = '#c99e66', POND = '#3f8fd0';
const PATCH = wrapNoise(0.45), THICK = wrapNoise(0.05), PINE_MIX = wrapNoise(0.04);
// (los trozos se cuentan siempre dentro del planeta: el de la otra punta de la costura es el mismo)
const own = cx => wrapIndex(cx, CHUNK);

export class WorldGen {
  constructor(seed) {
    this.seed = seed | 0;
    this.cache = new Map();
    this.biomes = new Map();   // "cx,cy" → los biomas de medias casillas de un trozo ya calculados (255: aún no)
    this.fields = new Map();   // "cx,cy" → field(cx, cy)
    this.season = 0;   // estación actual (cambia los colores del suelo y de las plantas)
  }

  // El bioma de un punto. Los puntos a medias casillas (los centros y las esquinas, que son los que piden el
  // mundo, el suelo y el mapa) se recuerdan por trozo: el clima cuesta y se pregunta mucho
  biomeAt(x, y) {
    const hx = x * 2, hy = y * 2;
    if (hx !== (hx | 0) || hy !== (hy | 0)) return biomeAt(x, y, this.seed);
    const cx = own(Math.floor(x / CHUNK)), cy = Math.floor(y / CHUNK), k = `${cx},${cy}`;
    let grid = this.biomes.get(k);
    if (!grid) { grid = new Uint8Array(CHUNK * CHUNK * 4).fill(255); this.biomes.set(k, grid); if (this.biomes.size > 3000) this.biomes.delete(this.biomes.keys().next().value); }
    const li = (hy - cy * CHUNK * 2) * CHUNK * 2 + (((hx % (CHUNK * 2)) + CHUNK * 2) % (CHUNK * 2));   // (la media casilla dentro del trozo)
    let b = grid[li];
    if (b === 255) grid[li] = b = biomeAt(x, y, this.seed);
    return b;
  }
  // Lo que se hunde el suelo por el agua en (x, y), seguido (0 en tierra): ver wetness
  depthAt(x, y) { return depthOfWet(wetness(climate(x, y, this.seed, this.tmpC ||= {}))); }
  // Apuntar biomas ya calculados en otro hilo (ground.js: blockHeights): las esquinas (m por lado desde
  // (x0 - 1, z0 - 1)) y los centros (BLOCK por lado desde el bloque)
  seedBiomes(x0, z0, corners, m, centers, w) {
    const put = (x, y, b) => {
      const cx = own(Math.floor(x / CHUNK)), cy = Math.floor(y / CHUNK), k = `${cx},${cy}`;
      let grid = this.biomes.get(k);
      if (!grid) { grid = new Uint8Array(CHUNK * CHUNK * 4).fill(255); this.biomes.set(k, grid); }
      grid[(y * 2 - cy * CHUNK * 2) * CHUNK * 2 + ((((x * 2) % (CHUNK * 2)) + CHUNK * 2) % (CHUNK * 2))] = b;
    };
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) put(x0 - 1 + i, z0 - 1 + j, corners[j * m + i]);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) put(x0 + i + 0.5, z0 + j + 0.5, centers[j * w + i]);
  }
  nearVillage(cx, cy) {
    const bx = own(cx) * CHUNK, by = cy * CHUNK, V = village.BOUNDS;
    return bx + CHUNK > V.x0 && bx < V.x1 && by + CHUNK > V.y0 && by < V.y1;
  }

  // Bioma de un trozo en una rejilla de cuartos de casilla. El clima cambia despacio: se calcula una vez
  // por casilla y se interpola, y con eso se decide el bioma de cada muestra.
  field(cx, cy) {
    cx = own(cx);
    const fk = `${cx},${cy}`, had = this.fields.get(fk);
    if (had) return had;
    const out = this.computeField(cx, cy);
    this.fields.set(fk, out);
    if (this.fields.size > 320) this.fields.delete(this.fields.keys().next().value);
    return out;
  }
  computeField(cx, cy) {
    const s = this.seed, nc = CHUNK + 1, c = {};
    const K = ['T', 'M', 'C', 'R', 'L', 'K', 'P', 'f', 'Q'], coarse = K.map(() => new Float32Array(nc * nc));
    for (let j = 0, i = 0; j < nc; j++) {
      for (let k = 0; k < nc; k++, i++) {
        climate(cx * CHUNK + k, cy * CHUNK + j, s, c);
        for (let q = 0; q < K.length; q++) coarse[q][i] = c[K[q]];
      }
    }
    const n = CHUNK * RES + 1, biome = new Uint8Array(n * n), patch = new Float32Array(n * n), v = new Float32Array(K.length);
    const wet = new Float32Array(n * n), shore = new Uint8Array(n * n), cw = {};   // (el agua, seguida, y la clase de orilla)
    for (let j = 0, i = 0; j < n; j++) {
      for (let k = 0; k < n; k++, i++) {
        const fx = k / RES, fy = j / RES, x0 = Math.min(nc - 2, fx | 0), y0 = Math.min(nc - 2, fy | 0), u = fx - x0, w = fy - y0, b = y0 * nc + x0;
        for (let q = 0; q < K.length; q++) {
          const a = coarse[q], p00 = a[b], p10 = a[b + 1], p01 = a[b + nc], p11 = a[b + nc + 1];
          v[q] = p00 + (p10 - p00) * u + (p01 - p00) * w + (p00 - p10 - p01 + p11) * u * w;
        }
        // El ruido va ligado a la posición en el mundo, así coincide en el borde entre dos trozos. El borde de cada
        // bioma se mueve con él (a manchas, no a muestras sueltas: un tramado se vería como un laberinto de casillas)
        const gk = cx * CHUNK * RES + k, gj = cy * CHUNK * RES + j;
        patch[i] = PATCH(gk / RES, gj / RES, s);
        biome[i] = classify(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], (patch[i] - 0.5) * 0.03, v[8]);
        for (let q = 0; q < K.length; q++) cw[K[q]] = v[q];
        wet[i] = wetness(cw); shore[i] = shoreOf(v[0], v[1], v[2]);
      }
    }
    return { n, biome, patch, wet, shore };
  }

  // Árboles, arbustos y rocas de un trozo. Cada objeto lleva su tipo (kind), una clave única,
  // y su colisión (col); así el mundo puede quitarlos y volver a ponerlos.
  // Todo va en el centro de su casilla (tx + 0.5, ty + 0.5) y hay como mucho un objeto por casilla,
  // como en Minecraft: así el jugador puede construir casilla a casilla alrededor de lo que hay,
  // y cada casilla está libre u ocupada del todo, nunca a medias.
  content(cx, cy) {
    cx = own(cx);
    const key = `${cx},${cy}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const s = this.seed;
    const objects = [];
    const taken = new Set();   // casillas ya ocupadas ("tx,ty"): la primera que llega se la queda
    const add = (kind, tx, ty, r) => {
      const t = `${tx},${ty}`;
      if (taken.has(t)) return;
      taken.add(t);
      const x = tx + 0.5, y = ty + 0.5;   // centro de la casilla
      const o = { kind, x, y, key: `${x.toFixed(2)},${y.toFixed(2)}` };
      if (r) o.col = { x, y, r };
      // (las rocas tienen altura, top: se sube uno encima andando, y la colisión del suelo no las cuenta; ver entities.js)
      if (r && (kind === 'rock' || kind === 'boulder' || kind === 'snowBoulder')) o.col.top = kind === 'rock' ? 0.3 : 0.85;
      objects.push(o);
    };

    // Plantas grandes: como mucho una por celda de 2×2 casillas. El azar elige cuál de las cuatro
    // casillas de la celda ocupa (la misma que antes caía el punto suelto, pero ahora centrada).
    for (let ty = cy * CHUNK; ty < (cy + 1) * CHUNK; ty += 2) {
      for (let tx = cx * CHUNK; tx < (cx + 1) * CHUNK; tx += 2) {
        const px = tx + (ihash(tx, ty, s + 50) < 0.5 ? 0 : 1), py = ty + (ihash(tx, ty, s + 51) < 0.5 ? 0 : 1);
        const x = px + 0.5, y = py + 0.5;
        if (village.keepClear(x, y)) continue;
        const b = this.biomeAt(x, y), roll = ihash(tx, ty, s + 52) / village.clearing(x, y);
        const thick = 0.6 + THICK(x, y, s + 9) * 0.6;   // claros dentro de los bosques
        const pineMix = PINE_MIX(x, y, s + 60) > 0.58;
        if (b === B.MEADOW && roll < 0.06) add(ihash(tx, ty, s + 53) < 0.06 ? 'fruit' : pineMix ? 'pine' : 'oak', px, py, 0.35);
        else if (b === B.FOREST && roll < 0.55 * thick) add(pineMix ? 'pine' : ihash(tx, ty, s + 53) < 0.03 ? 'fruit' : 'oak', px, py, 0.35);
        else if (b === B.PINES && roll < 0.6 * thick) add('pine', px, py, 0.35);
        else if (b === B.SNOW && roll < 0.28 * thick) add('snowPine', px, py, 0.35);
        else if (b === B.SWAMP && roll < 0.22) add('swampTree', px, py, 0.4);
        else if (b === B.DESERT && roll < 0.07) add('cactus', px, py, 0.3);
        else if (b === B.BEACH && roll < 0.05 && climate(x, y, s).T > 0.45) add('palm', px, py, 0.3);   // palmeras solo en playas cálidas
        else if (b === B.ROCKY && roll < 0.14) add('boulder', px, py, 0.7);
        else if (b === B.ROCKY && roll < 0.2) add('pine', px, py, 0.35);
      }
    }
    // Arbustos, matojos y rocas sueltas, solo en casillas que han quedado libres
    for (let ty = cy * CHUNK; ty < (cy + 1) * CHUNK; ty++) {
      for (let tx = cx * CHUNK; tx < (cx + 1) * CHUNK; tx++) {
        const r = ihash(tx, ty, s + 70);
        if (r > 0.014 || taken.has(`${tx},${ty}`)) continue;
        const x = tx + 0.5, y = ty + 0.5;
        if (village.keepClear(x, y) || (village.clearing(x, y) < 0.3 && r > 0.006)) continue;
        const b = this.biomeAt(x, y);
        if (BIOMES[b].water) continue;
        if (b === B.DESERT) { add('deadBush', tx, ty, 0); continue; }
        if (b === B.SNOW) { if (r < 0.006) add('snowBoulder', tx, ty, 0.6); continue; }
        if (r < 0.005 || b === B.ROCKY || b === B.BEACH) {
          const i = Math.floor(ihash(tx, ty, s + 71) * 4);   // cuatro tamaños de roca
          add('rock', tx, ty, 0.25 + i * 0.05);
        } else {
          add('bush', tx, ty, 0.45);
        }
      }
    }
    const out = { objects };
    this.cache.set(key, out);
    if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
    return out;
  }

  // Miniatura del trozo para el mapa: un píxel por casilla
  thumbnail(cx, cy) {
    cx = own(cx);
    const c = mk(CHUNK, CHUNK), g = c.getContext('2d'), img = g.createImageData(CHUNK, CHUNK);
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const x = cx * CHUNK + i + 0.5, y = cy * CHUNK + j + 0.5;
        let col = BIOMES[this.biomeAt(x, y)].rgb[1];
        if (village.inBounds(x, y)) {
          if (village.inOwnHouse(x, y) || village.inTavern(x, y) || Object.values(village.HOUSES).some(h => (!h.project || village.hasProject(h.project)) && x > h.x0 && x < h.x1 && y > h.y0 && y < h.y1)) col = rgbOf(ROOF);
          else if (village.pondDist(x, y) < 1) col = rgbOf(POND);
          else if (village.distToPath(x, y) < 0.8) col = rgbOf(PATH);
        }
        img.data.set([...col, 255], (j * CHUNK + i) * 4);
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
}
