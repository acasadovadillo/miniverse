// Generador del mundo: a partir de una semilla decide el bioma, el suelo y la naturaleza de cualquier casilla.
// Todo es determinista: la misma semilla y la misma casilla dan siempre lo mismo.
import { mk, ihash, vnoise, rgbOf } from '../util.js';
import * as village from './village.js';
import { B, BIOMES, climate, classify, biomeAt, wetness, depthOfWet, deepOf, shoreOf, reliefOf, WATER_Y } from './biomes.js';
import { wrapNoise, wrapIndex } from './planet.js';

export const CHUNK = 16;
// Solo hay un mundo, el mismo para todas las partidas: esta es su semilla
export const WORLD_SEED = 20261030;
export const RES = 4;   // muestras de clima por casilla (el clima cambia despacio: no hace falta calcularlo por píxel)
const ROOF = '#c95a3c', PATH = '#c99e66', POND = '#3f8fd0';
const PATCH = wrapNoise(0.45), THICK = wrapNoise(0.05), PINE_MIX = wrapNoise(0.04);
// (los trozos se cuentan siempre dentro del planeta: el de la otra punta de la costura es el mismo)
const own = cx => wrapIndex(cx, CHUNK);

// Cuánta hierba hay en cada bioma (la parte de sus casillas que la tienen) y a los cuántos días de segarla (o de que se
// la coman los animales que pastan: ranch.js y wildlife.js) vuelve a salir
const GRASS_DENSITY = { [B.MEADOW]: 0.95, [B.FOREST]: 0.78, [B.PINES]: 0.6, [B.SWAMP]: 0.5 };
export const GRASS_REGROW = 7;
// Las flores silvestres que se cogen (objetos de la naturaleza, en manchas por la pradera y algo por el bosque). Salen
// todas en primavera, casi todas en verano, menos en otoño y ninguna en invierno
export const FLOWER_KINDS = new Set(['margarita', 'diente_leon']);
export const flowerShows = (o, season) => ihash(Math.floor(o.x), Math.floor(o.y), 77) < [1, 0.85, 0.4, 0][season];

// The seabed finds (seabed): what a chunk without any answers, how many chunks are remembered, one sunken chest in how many
// chunks (only those with deep sea bed get one) and at most how many seaweeds per chunk
const NO_SEABED = Object.freeze({ finds: Object.freeze([]) });
const SEABED_CACHE = 200, SUNK_EVERY = 12, WEEDS_MAX = 32;

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
  depthAt(x, y) { const c = climate(x, y, this.seed, this.tmpC ||= {}); return depthOfWet(wetness(c), c, x, y, this.seed); }
  // La altura del suelo en (x, y) sin lo construido: hundido por el agua o, en tierra, el relieve (ver reliefOf)
  groundAt(x, y) { const c = climate(x, y, this.seed, this.tmpC ||= {}), u = wetness(c); return u > 0 ? depthOfWet(u, c, x, y, this.seed) : reliefOf(c, u, x, y, this.seed); }
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
  // La hierba de una casilla, como la de Minecraft: cada casilla de pradera, bosque, pinar o pantano la tiene o no (en
  // manchas), y la que la tiene la llena entera. Da su altura (0 si no hay). En invierno queda menos. Se siega con la
  // guadaña y vuelve a salir a los GRASS_REGROW días (scenes.js, grassAt y mow); lo dibuja nature3d.js (buildGround)
  grassAt(tx, ty) {
    const d = GRASS_DENSITY[this.biomeAt(tx + 0.5, ty + 0.5)];
    if (!d) return 0;
    const s = this.seed, patch = 0.7 + vnoise(tx * 0.13, ty * 0.13, s + 11) * 0.6;
    if (ihash(tx, ty, s + 10) > d * patch * (this.season === 3 ? 0.45 : 1)) return 0;
    return 0.75 + ihash(tx, ty, s + 40) * 0.55;
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
    const K = ['T', 'M', 'C', 'R', 'L', 'K', 'P', 'f', 'Q', 'Tl', 'Ml'], coarse = K.map(() => new Float32Array(nc * nc));
    for (let j = 0, i = 0; j < nc; j++) {
      for (let k = 0; k < nc; k++, i++) {
        climate(cx * CHUNK + k, cy * CHUNK + j, s, c);
        for (let q = 0; q < K.length; q++) coarse[q][i] = c[K[q]];
      }
    }
    const n = CHUNK * RES + 1, biome = new Uint8Array(n * n), patch = new Float32Array(n * n), v = new Float32Array(K.length);
    const wet = new Float32Array(n * n), shore = new Uint8Array(n * n), cw = {};   // (el agua, seguida, y la clase de orilla)
    // (the extra depth of the deep sea and the big lakes, deepOf, for the bed paint; with lake 1 where it is a lake's. Both
    // null in a chunk with nothing deep, which is nearly all of them)
    let deep = null, lake = null;
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
        biome[i] = classify(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], (patch[i] - 0.5) * 0.03, v[8], v[9], v[10]);
        for (let q = 0; q < K.length; q++) cw[K[q]] = v[q];
        wet[i] = wetness(cw); shore[i] = shoreOf(v[0], v[1], v[2]);
        if (wet[i] > 2.5) {
          const e = deepOf(cw, gk / RES, gj / RES, s);
          if (e > 0) {
            if (!deep) { deep = new Float32Array(n * n); lake = new Uint8Array(n * n); }
            deep[i] = e; lake[i] = cw.T >= 0.32 && (cw.L - 0.82) / 0.03 > (0.36 - cw.C) / 0.02 ? 1 : 0;
          }
        }
      }
    }
    return { n, biome, patch, wet, shore, deep, lake };
  }

  // The finds on the sea and lake beds of a chunk, apart from content() (docs/planes/gta/PLAN-D-barras-buceo.md §4.6):
  // { finds: [{ kind: 'seashell' | 'seaweed' | 'oyster' | 'mussel' | 'sunken_chest', key: `${kind}:${tx},${ty}`, x, y,
  // bed (the gen bed height h), tall? (seaweed), yaw? (chest)}] }, deterministic, with its own LRU cache. Only dive.js
  // and three/seabed3d.js call it; never merged into content, farObjects or colliders (content() runs for hundreds of
  // chunks: the contact shadows, the far trees; every reader of its objects would pay for these).
  // Like content(), cx wraps round the planet and x, y are those of the chunk's own copy (the caller adds the offset
  // beyond the seam). At most one find per tile. Per tile, the cheap roll first, then the cached biome, and only then
  // one climate call for the bed (sea or lake, and how deep): some 25-70 climate calls in a sea chunk, none on land
  seabed(cx, cy) {
    cx = own(cx);
    const key = `${cx},${cy}`, C = (this.beds ||= new Map()), hit = C.get(key);
    if (hit) { C.delete(key); C.set(key, hit); return hit; }
    const out = this.computeSeabed(cx, cy);
    C.set(key, out);
    if (C.size > SEABED_CACHE) C.delete(C.keys().next().value);
    return out;
  }
  computeSeabed(cx, cy) {
    const s = this.seed, x0 = cx * CHUNK, y0 = cy * CHUNK, c = (this.tmpS ||= {});
    // (nothing of this in the village, nor in a chunk without a water biome at its corners and centre: it would be all land)
    if (this.nearVillage(cx, cy)) return NO_SEABED;
    if (![[0.5, 0.5], [CHUNK - 0.5, 0.5], [0.5, CHUNK - 0.5], [CHUNK - 0.5, CHUNK - 0.5], [CHUNK / 2, CHUNK / 2]].some(([i, j]) => BIOMES[this.biomeAt(x0 + i, y0 + j)].water)) return NO_SEABED;
    const finds = [], taken = new Set();
    // The bed at (x, y): its height h and whether it is the sea (else a lake, a river or a pond: fresh water). null on land
    const bed = (x, y) => {
      climate(x, y, s, c);
      const u = wetness(c);
      if (u <= 0) return null;
      return { h: depthOfWet(u, c, x, y, s), sea: (0.36 - c.C) / 0.02 >= u - 1e-6, lake: c.T >= 0.32 && (c.L - 0.82) / 0.03 >= u - 1e-6 };
    };
    const water = (tx, ty) => { const b = this.biomeAt(tx + 0.5, ty + 0.5); return b === B.OCEAN || b === B.SHALLOW || b === B.LAKE; };
    // (a little off the tile's centre, the same every time: a bed of shells in a grid would look planted)
    const spot = (tx, ty, k) => [tx + 0.2 + 0.6 * ihash(tx, ty, s + k), ty + 0.2 + 0.6 * ihash(tx, ty, s + k + 1)];
    const add = (kind, tx, ty, x, y, h, extra) => { taken.add(ty * 65536 + tx); finds.push({ kind, key: `${kind}:${tx},${ty}`, x, y, bed: h, ...extra }); };
    // A sunken chest: one chunk in SUNK_EVERY, on deep sea bed (up to three tries for its tile)
    if (ihash(cx, cy, s + 905) < 1 / SUNK_EVERY) for (let i = 0; i < 3; i++) {
      const tx = x0 + Math.floor(ihash(cx, cy, s + 910 + i) * CHUNK), ty = y0 + Math.floor(ihash(cx, cy, s + 920 + i) * CHUNK);
      if (!water(tx, ty)) continue;
      const x = tx + 0.5, y = ty + 0.5, b = bed(x, y);
      if (!b || !b.sea || b.h > -6) continue;
      add('sunken_chest', tx, ty, x, y, b.h, { yaw: ihash(tx, ty, s + 930) * Math.PI * 2 });
      break;
    }
    let weeds = 0;
    for (let ty = y0; ty < y0 + CHUNK; ty++) for (let tx = x0; tx < x0 + CHUNK; tx++) {
      if (taken.has(ty * 65536 + tx)) continue;
      // (the rolls, cheapest first: no climate call for a tile that would hold nothing)
      const oyster = vnoise(tx * 0.05, ty * 0.05, s + 906) > 0.7 && ihash(tx, ty, s + 904) < 0.05;
      const mussel = !oyster && ihash(tx, ty, s + 907) < 0.006;
      const shell = !oyster && !mussel && ihash(tx, ty, s + 901) < 0.02;
      const weed = !oyster && !mussel && !shell && weeds < WEEDS_MAX && vnoise(tx * 0.08, ty * 0.08, s + 902) > 0.62 && ihash(tx, ty, s + 903) < 0.3;
      if (!(oyster || mussel || shell || weed) || !water(tx, ty)) continue;
      const [x, y] = spot(tx, ty, oyster ? 940 : mussel ? 942 : shell ? 944 : 946), b = bed(x, y);
      if (!b) continue;
      const h = b.h;
      if (oyster && b.sea && h < -4) add('oyster', tx, ty, x, y, h, { yaw: ihash(tx, ty, s + 950) * Math.PI * 2 });
      else if (mussel && b.lake && !b.sea && h < -3) add('mussel', tx, ty, x, y, h, { yaw: ihash(tx, ty, s + 951) * Math.PI * 2 });
      // (shells always at swimming depth, never in the wading band: there they would be gather targets on foot)
      else if (shell && b.sea && h > -5 && h < -1.2) add('seashell', tx, ty, x, y, h, { yaw: ihash(tx, ty, s + 952) * Math.PI * 2 });
      else if (weed && (b.sea || b.lake) && h > -10 && h < -1.5) {
        // (never poking out of the water: at most 0.4 m under it)
        const tall = Math.min(0.6 + ihash(tx, ty, s + 908) * 1.2, WATER_Y - h - 0.4);
        if (tall >= 0.3) { add('seaweed', tx, ty, x, y, h, { tall, yaw: ihash(tx, ty, s + 953) * Math.PI * 2 }); weeds++; }
      }
    }
    return finds.length ? { finds } : NO_SEABED;
  }

  // Árboles, arbustos y rocas de un trozo. Cada objeto lleva su tipo (kind), una clave única,
  // y su colisión (col); así el mundo puede quitarlos y volver a ponerlos.
  // Todo va en el centro de su casilla (tx + 0.5, ty + 0.5) y hay como mucho un objeto por casilla,
  // como en Minecraft: así el jugador puede construir casilla a casilla alrededor de lo que hay,
  // y cada casilla está libre u ocupada del todo, nunca a medias.
  // keep: guardarlo en la caché (false: solo se mira, como la sombra de contacto, que pide muchos trozos una vez)
  content(cx, cy, keep = true) {
    cx = own(cx);
    const key = `${cx},${cy}`, hit = this.cache.get(key);
    // (al acertar, la clave pasa al final: la caché echa lo que menos se ha usado, no lo primero que entró)
    if (hit) { if (keep) { this.cache.delete(key); this.cache.set(key, hit); } return hit; }
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
      if (FLOWER_KINDS.has(kind)) o.flower = true;
      objects.push(o);
    };
    // (las cuestas donde el suelo es roca: ahí no crecen arbustos ni flores. Con el relieve sin allanar, que es el que se
    // sabe aquí; sl: lo que sube por metro, con roca desde unos 0,6 (ver terrain.js y grassKeep en ground.js))
    const steep = (x, y, sl) => !village.inBounds(x, y) && Math.hypot(this.groundAt(x + 0.5, y) - this.groundAt(x - 0.5, y), this.groundAt(x, y + 0.5) - this.groundAt(x, y - 0.5)) > sl;
    // Los arbustos del jardín del pueblo: como los demás, se siegan (y lo segado no vuelve)
    for (const [tx, ty] of village.gardenBushes()) if (Math.floor(tx / CHUNK) === cx && Math.floor(ty / CHUNK) === cy) add('bush', tx, ty, 0.45);

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
        if (BIOMES[b].water || b === B.ICE) continue;   // (sobre el agua y el hielo no crece nada)
        if (b === B.DESERT) { add('deadBush', tx, ty, 0); continue; }
        if (b === B.SNOW) { if (r < 0.006) add('snowBoulder', tx, ty, 0.6); continue; }
        if (r < 0.005 || b === B.ROCKY || b === B.BEACH) {
          const i = Math.floor(ihash(tx, ty, s + 71) * 4);   // cuatro tamaños de roca
          add('rock', tx, ty, 0.25 + i * 0.05);
        } else if (!steep(x, y, 0.62)) {
          add('bush', tx, ty, 0.45);
        }
      }
    }
    // Flores, en manchas, en las casillas que siguen libres (también en la hierba del pueblo)
    for (let ty = cy * CHUNK; ty < (cy + 1) * CHUNK; ty++) for (let tx = cx * CHUNK; tx < (cx + 1) * CHUNK; tx++) {
      if (taken.has(`${tx},${ty}`) || vnoise(tx * 0.21, ty * 0.21, s + 7) < 0.64) continue;
      const x = tx + 0.5, y = ty + 0.5, b = this.biomeAt(x, y);
      if ((b !== B.MEADOW && b !== B.FOREST) || ihash(tx, ty, s + 75) > (b === B.MEADOW ? 0.42 : 0.12) || village.keepClear(x, y) || !village.isGrass(x, y) || steep(x, y, 0.55)) continue;
      add(vnoise(tx * 0.09 + 3, ty * 0.09, s + 8) > 0.5 ? 'margarita' : 'diente_leon', tx, ty, 0);
    }
    const out = { objects };
    if (!keep) return out;
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
