// Las estaciones cambian el color del mundo: en otoño las hojas se vuelven naranjas y en invierno
// todo lleva nieve. En vez de dibujar cada sprite cuatro veces, se recolorean los de siempre.
import { mk, ihash, rgbOf, mixHex } from '../util.js';

export const SEASONS = ['Primavera', 'Verano', 'Otoño', 'Invierno'];
const AUTUMN = [[214, 120, 46], [232, 168, 56], [196, 76, 44], [240, 196, 80]];

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

// mode: 'autumn' (hojas de colores), 'winter' (hojas cubiertas de nieve) o 'snowcap' (solo nieve encima)
let tint = 0;
export function recolor(src, mode) {
  const base = tint++ % AUTUMN.length;   // cada planta, de un color de otoño
  const c = mk(src.width, src.height), g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data, W = c.width;
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (!d[o + 3]) continue;
      const [h, s, l] = rgbToHsl(d[o], d[o + 1], d[o + 2]);
      const leaf = h > 65 && h < 170 && s > 0.18;
      const above = y > 1 ? d[((y - 2) * W + x) * 4 + 3] : 0, above4 = y > 3 ? d[((y - 4) * W + x) * 4 + 3] : 0;
      if (mode === 'autumn' && leaf) {
        const a = AUTUMN[ihash(x >> 3, y >> 3, base) < 0.8 ? base : (base + 1) % AUTUMN.length], k = 0.55 + l * 0.9;
        out[o] = a[0] * k; out[o + 1] = a[1] * k; out[o + 2] = a[2] * k;
      } else if ((mode === 'snowcap' || mode === 'winter') && (!above || (mode === 'winter' && leaf && !above4)) && l > 0.12) {
        const v = 205 + l * 60;   // nieve encima
        out[o] = v - 12; out[o + 1] = v - 4; out[o + 2] = v + 8;
      } else if (mode === 'winter' && leaf) {
        const v = 60 + l * 110;   // hojas apagadas de invierno
        out[o] = v * 0.82; out[o + 1] = v * 0.9; out[o + 2] = v * 0.88;
      }
    }
  }
  img.data.set(out);
  g.putImageData(img, 0, 0);
  return c;
}

// Juego de sprites de una estación (se calcula una vez y se guarda)
const cache = new Map();
export function seasonalProps(props, season) {
  if (season < 2) return props;
  if (cache.has(season)) return cache.get(season);
  const mode = season === 2 ? 'autumn' : 'winter', out = { ...props };
  for (const k of ['oak', 'fruit', 'bush', 'swampTree']) out[k] = props[k].map(img => recolor(img, mode));
  if (season === 3) for (const k of ['pine', 'rock', 'boulder', 'deadBush']) out[k] = props[k].map(img => recolor(img, 'snowcap'));
  cache.set(season, out);
  return out;
}

// Paleta del suelo según la estación (solo cambia la hierba y la tierra; el agua y la nieve se quedan igual)
const GREENISH = new Set([3, 4, 5, 6]);   // pradera, bosque, pinos y pantano
const palCache = new Map();
export function seasonalPalette(biome, info, season) {
  if (season === 0 || season === 1 && !GREENISH.has(biome)) return info.rgb;
  const key = biome * 4 + season;
  if (palCache.has(key)) return palCache.get(key);
  let pal = info.pal;
  if (season === 1 && GREENISH.has(biome)) pal = pal.map(c => mixHex(c, '#b8b040', 0.12));
  else if (season === 2 && GREENISH.has(biome)) pal = pal.map((c, i) => mixHex(c, i % 2 ? '#b8823a' : '#a8903a', 0.38));
  else if (season === 3 && (GREENISH.has(biome) || biome === 2 || biome === 9)) pal = pal.map((c, i) => mixHex(c, i === 3 ? '#c8d8e6' : '#eef3f8', 0.86));
  const rgb = pal.map(rgbOf);
  palCache.set(key, rgb);
  return rgb;
}
