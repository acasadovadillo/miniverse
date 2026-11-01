// Generador del mundo: a partir de una semilla decide el bioma, el suelo y la naturaleza de cualquier casilla.
// Todo es determinista: la misma semilla y la misma casilla dan siempre lo mismo.
import { mk, ihash, vnoise, rgbOf } from '../util.js';
import { toScreen } from '../iso.js';
import * as village from './village.js';
import { B, BIOMES, climate, classify, biomeAt } from './biomes.js';
import { FLOWER_COLS } from '../art/props.js';
import { seasonalPalette } from '../art/seasons.js';

export const CHUNK = 16;
// Solo hay un mundo, el mismo para todas las partidas: esta es su semilla
export const WORLD_SEED = 20261030;
export const RES = 4;   // muestras de clima por casilla (el clima cambia despacio: no hace falta calcularlo por píxel)
const WHITE = rgbOf('#ffffff'), LIGHT_WATER = rgbOf('#9cd0f0'), DUNE = rgbOf('#c8a868');
const ROOF = '#c95a3c', PATH = '#c99e66', POND = '#3f8fd0';

export class WorldGen {
  constructor(seed, props) {
    this.seed = seed | 0;
    this.props = props;
    this.cache = new Map();
    this.season = 0;   // estación actual (cambia los colores del suelo y de las plantas)
  }

  biomeAt(x, y) { return biomeAt(x, y, this.seed); }
  nearVillage(cx, cy) {
    const bx = cx * CHUNK, by = cy * CHUNK, V = village.BOUNDS;
    return bx + CHUNK > V.x0 && bx < V.x1 && by + CHUNK > V.y0 && by < V.y1;
  }

  // Bioma de un trozo en una rejilla de cuartos de casilla. El clima cambia despacio: se calcula una vez
  // por casilla y se interpola, y con eso se decide el bioma de cada muestra.
  field(cx, cy) {
    const s = this.seed, nc = CHUNK + 1, c = {};
    const K = ['T', 'M', 'C', 'R', 'L', 'K', 'P', 'f'], coarse = K.map(() => new Float32Array(nc * nc));
    for (let j = 0, i = 0; j < nc; j++) {
      for (let k = 0; k < nc; k++, i++) {
        climate(cx * CHUNK + k, cy * CHUNK + j, s, c);
        for (let q = 0; q < K.length; q++) coarse[q][i] = c[K[q]];
      }
    }
    const n = CHUNK * RES + 1, biome = new Uint8Array(n * n), patch = new Float32Array(n * n), v = new Float32Array(K.length);
    for (let j = 0, i = 0; j < n; j++) {
      for (let k = 0; k < n; k++, i++) {
        const fx = k / RES, fy = j / RES, x0 = Math.min(nc - 2, fx | 0), y0 = Math.min(nc - 2, fy | 0), u = fx - x0, w = fy - y0, b = y0 * nc + x0;
        for (let q = 0; q < K.length; q++) {
          const a = coarse[q], p00 = a[b], p10 = a[b + 1], p01 = a[b + nc], p11 = a[b + nc + 1];
          v[q] = p00 + (p10 - p00) * u + (p01 - p00) * w + (p00 - p10 - p01 + p11) * u * w;
        }
        // El azar va ligado a la posición en el mundo, así coincide en el borde entre dos trozos
        const gk = cx * CHUNK * RES + k, gj = cy * CHUNK * RES + j;
        biome[i] = classify(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], (ihash(gk, gj, s + 5) - 0.5) * 0.03);
        patch[i] = vnoise(gk / RES * 0.45, gj / RES * 0.45, s);
      }
    }
    return { n, biome, patch };
  }

  // Pinta el suelo de un trozo en `d` (datos RGBA del lienzo). `pixels` dice qué píxeles caen dentro del
  // rombo del trozo y su posición (lx, ly) en casillas; así el bucle no repite cálculos.
  paint(d, cx, cy, ox, oy, f, pixels) {
    const { index, LX, LY, PX, PY, H, SAMPLE } = pixels, len = index.length;
    const bx = cx * CHUNK, by = cy * CHUNK, nearVillage = this.nearVillage(cx, cy);
    // La textura usa la tabla de azar desplazada según el trozo, para que no se repita igual en todos
    const shift = Math.floor(ihash(cx, cy, this.seed + 3) * len);
    const { biome: BI, patch: PA } = f;
    for (let q = 0; q < len; q++) {
      const o = index[q] * 4, h = H[(q + shift) % len];
      let col = null;
      if (nearVillage) {
        const gx = bx + LX[q], gy = by + LY[q];
        if (village.inBounds(gx, gy)) col = village.groundColor(gx, gy, h, vnoise(gx * 1.7, gy * 1.7, 3), vnoise(gx * 2.2, gy * 2.2, 4), ox + PX[q], oy + PY[q]);
      }
      if (!col) {
        const idx = SAMPLE[q], biome = BI[idx], info = BIOMES[biome], pal = seasonalPalette(biome, info, this.season), k = PA[idx] + (h - 0.5) * 0.32;
        if (info.water && h < 0.035) col = LIGHT_WATER;
        else if (biome === B.SNOW && h > 0.985) col = WHITE;
        else if (biome === B.DESERT && Math.sin((bx + LX[q] + (by + LY[q]) * 0.6) * 4 + PA[idx] * 9) > 0.93) col = DUNE;
        else col = k < 0.3 ? pal[3] : k < 0.52 ? pal[0] : k < 0.72 ? pal[1] : pal[2];
      }
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
  }

  // Detalles pintados en el suelo, según el bioma de cada casilla (y un margen, para que no se corten en el borde)
  decorate(g, ox, oy, cx, cy, field) {
    const s = this.seed;
    const at = (x, y) => { const [px, py] = toScreen(x, y); return [Math.round(px - ox), Math.round(py - oy)]; };
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    for (let ty = cy * CHUNK - 1; ty < (cy + 1) * CHUNK + 1; ty++) {
      for (let tx = cx * CHUNK - 1; tx < (cx + 1) * CHUNK + 1; tx++) {
        const lx = tx - cx * CHUNK, ly = ty - cy * CHUNK, inside = lx >= 0 && ly >= 0 && lx < CHUNK && ly < CHUNK;
        const b = inside ? field.biome[Math.round((ly + 0.5) * RES) * field.n + Math.round((lx + 0.5) * RES)] : this.biomeAt(tx + 0.5, ty + 0.5);
        const winter = this.season === 3, lush = !winter && (b === B.MEADOW || b === B.FOREST || b === B.PINES);
        for (let k = 0; k < 2; k++) {
          const roll = ihash(tx, ty, s + 10 + k);
          const x = tx + ihash(tx, ty, s + 20 + k), y = ty + ihash(tx, ty, s + 30 + k);
          if (!village.isGrass(x, y)) continue;
          const [sx, sy] = at(x, y);
          if (lush && roll < (b === B.MEADOW ? 0.35 : 0.25)) {
            R(sx, sy, 1, 2, '#3f7a30'); R(sx + 4, sy, 1, 2, '#3f7a30');
            R(sx + 1, sy - 2, 1, 4, '#5a9a40'); R(sx + 3, sy - 1, 1, 3, '#5a9a40');
            R(sx + 2, sy - 3, 1, 4, '#9ed06a'); R(sx + 1, sy - 2, 1, 1, '#9ed06a');
          } else if (b === B.SWAMP && roll < 0.3) {
            for (let r = 0; r < 4; r++) R(sx + r * 2, sy - 4 - (r % 2) * 2, 1, 6 + (r % 2) * 2, r % 2 ? '#3f5a2a' : '#5a7a3a');
            R(sx + 2, sy - 7, 1, 2, '#8a6a3a');
          } else if (b === B.DESERT && roll < 0.1) {
            R(sx, sy - 2, 1, 3, '#a88a52'); R(sx + 2, sy - 3, 1, 4, '#b8955a'); R(sx + 4, sy - 2, 1, 3, '#a88a52');
          } else if (b === B.SNOW && roll < 0.1) {
            R(sx - 2, sy - 1, 6, 2, '#ffffff'); R(sx - 1, sy - 2, 4, 1, '#ffffff'); R(sx - 2, sy + 1, 6, 1, '#c8d8ea');
          } else if (b === B.BEACH && roll < 0.05) {
            R(sx, sy, 2, 2, k ? '#ffd8e0' : '#ffffff'); R(sx, sy + 2, 2, 1, '#c8b07a');
          } else if (b === B.ROCKY && roll < 0.35) {
            R(sx, sy, 3, 2, '#6e6a62'); R(sx, sy, 2, 1, '#b0aca2');
          } else if ((b === B.SHALLOW || b === B.LAKE) && roll < 0.02 && this.biomeAt(tx + 1.5, ty + 0.5) !== B.OCEAN) {
            R(sx - 3, sy - 1, 7, 3, '#3f8a32'); R(sx - 2, sy - 2, 5, 1, '#5cae48'); R(sx, sy - 1, 2, 1, '#3578bb');
          }
        }
        // Flores en manchas (pradera) y setas (bosque)
        if (winter) continue;
        if (b === B.MEADOW && vnoise(tx * 0.25, ty * 0.25, s + 7) > 0.66 && ihash(tx, ty, s + 40) < (this.season === 0 ? 0.9 : this.season === 2 ? 0.35 : 0.7)) {
          const x = tx + ihash(tx, ty, s + 41), y = ty + ihash(tx, ty, s + 42);
          if (!village.isGrass(x, y)) continue;
          const col = FLOWER_COLS[Math.floor(vnoise(tx * 0.2, ty * 0.2, s + 8) * FLOWER_COLS.length)];
          const [sx, sy] = at(x, y);
          R(sx + 1, sy, 1, 3, '#3f7a30');
          R(sx, sy - 1, 3, 1, col); R(sx + 1, sy - 2, 1, 3, col);
          R(sx + 1, sy - 1, 1, 1, col === '#ffe04a' ? '#ffffff' : '#ffe04a');
        } else if (b === B.FOREST && ihash(tx, ty, s + 43) < 0.04) {
          const [sx, sy] = at(tx + 0.5, ty + 0.5);
          R(sx + 1, sy - 1, 1, 2, '#f4ecd8'); R(sx, sy - 3, 3, 2, '#c83a2a'); R(sx, sy - 3, 1, 1, '#ffffff');
        }
      }
    }
  }

  // Árboles, arbustos y rocas de un trozo. Cada objeto lleva su tipo (kind), una clave única,
  // su colisión (col) y su sombra; así el mundo puede quitarlos y volver a ponerlos.
  // Todo va en el centro de su casilla (tx + 0.5, ty + 0.5) y hay como mucho un objeto por casilla,
  // como en Minecraft: así el jugador puede construir casilla a casilla alrededor de lo que hay,
  // y cada casilla está libre u ocupada del todo, nunca a medias.
  content(cx, cy) {
    const key = `${cx},${cy}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const s = this.seed, P = this.props;
    const objects = [];
    const taken = new Set();   // casillas ya ocupadas ("tx,ty"): la primera que llega se la queda
    const add = (kind, img, tx, ty, ax, ay, r, shadow) => {
      const t = `${tx},${ty}`;
      if (taken.has(t)) return;
      taken.add(t);
      const x = tx + 0.5, y = ty + 0.5;   // centro de la casilla
      const o = { kind, img, x, y, ax, ay, key: `${x.toFixed(2)},${y.toFixed(2)}` };
      if (r) o.col = { x, y, r };
      if (shadow) o.shadow = { x, y: y + 0.1, rx: shadow[0], ry: shadow[1] };   // en el mundo: se proyecta al pintar el suelo
      objects.push(o);
    };
    const place = (kind, tx, ty, r, salt, shadow = [15, 6]) => {
      const list = P[kind];
      add(kind, list[Math.floor(ihash(tx, ty, s + salt) * list.length)], tx, ty, 36, 91, r, shadow);
    };

    // Plantas grandes: como mucho una por celda de 2×2 casillas. El azar elige cuál de las cuatro
    // casillas de la celda ocupa (la misma que antes caía el punto suelto, pero ahora centrada).
    for (let ty = cy * CHUNK; ty < (cy + 1) * CHUNK; ty += 2) {
      for (let tx = cx * CHUNK; tx < (cx + 1) * CHUNK; tx += 2) {
        const px = tx + (ihash(tx, ty, s + 50) < 0.5 ? 0 : 1), py = ty + (ihash(tx, ty, s + 51) < 0.5 ? 0 : 1);
        const x = px + 0.5, y = py + 0.5;
        if (village.keepClear(x, y)) continue;
        const b = this.biomeAt(x, y), roll = ihash(tx, ty, s + 52) / village.clearing(x, y);
        const thick = 0.6 + vnoise(x * 0.05, y * 0.05, s + 9) * 0.6;   // claros dentro de los bosques
        const pineMix = vnoise(x * 0.04, y * 0.04, s + 60) > 0.58;
        if (b === B.MEADOW && roll < 0.06) place(ihash(tx, ty, s + 53) < 0.06 ? 'fruit' : pineMix ? 'pine' : 'oak', px, py, 0.35, 54);
        else if (b === B.FOREST && roll < 0.55 * thick) place(pineMix ? 'pine' : ihash(tx, ty, s + 53) < 0.03 ? 'fruit' : 'oak', px, py, 0.35, 54);
        else if (b === B.PINES && roll < 0.6 * thick) place('pine', px, py, 0.35, 55);
        else if (b === B.SNOW && roll < 0.28 * thick) place('snowPine', px, py, 0.35, 56);
        else if (b === B.SWAMP && roll < 0.22) place('swampTree', px, py, 0.4, 57);
        else if (b === B.DESERT && roll < 0.07) place('cactus', px, py, 0.3, 58, [9, 4]);
        else if (b === B.BEACH && roll < 0.05 && climate(x, y, s).T > 0.45) place('palm', px, py, 0.3, 59, [12, 5]);   // palmeras solo en playas cálidas
        else if (b === B.ROCKY && roll < 0.14) place('boulder', px, py, 0.7, 61, [18, 6]);
        else if (b === B.ROCKY && roll < 0.2) place('pine', px, py, 0.35, 55);
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
        if (b === B.DESERT) { place('deadBush', tx, ty, 0, 72, null); continue; }
        if (b === B.SNOW) { if (r < 0.006) place('snowBoulder', tx, ty, 0.6, 73, [16, 5]); continue; }
        if (r < 0.005 || b === B.ROCKY || b === B.BEACH) {
          const i = Math.floor(ihash(tx, ty, s + 71) * P.rock.length);
          add('rock', P.rock[i], tx, ty, 13, 13, 0.25 + i * 0.05, null);
        } else {
          add('bush', P.bush[Math.floor(ihash(tx, ty, s + 72) * P.bush.length)], tx, ty, 18, 21, 0.45, [12, 4]);
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
    const c = mk(CHUNK, CHUNK), g = c.getContext('2d'), img = g.createImageData(CHUNK, CHUNK);
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const x = cx * CHUNK + i + 0.5, y = cy * CHUNK + j + 0.5;
        let col = BIOMES[this.biomeAt(x, y)].rgb[1];
        if (village.inBounds(x, y)) {
          if (village.inOwnHouse(x, y) || Object.values(village.HOUSES).some(h => (!h.project || village.hasProject(h.project)) && x > h.x0 && x < h.x1 && y > h.y0 && y < h.y1)) col = rgbOf(ROOF);
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
