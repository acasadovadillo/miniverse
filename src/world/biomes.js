// Clima y biomas. Cada punto del mundo tiene temperatura, humedad, "continentalidad" (tierra o mar),
// ríos, lagos, roca y charcas, todos a partir de ruido con la semilla. Con eso se decide el bioma.
import { vnoise, lerp, smoothstep, rgbOf } from '../util.js';
import { CENTER } from './village.js';

export const B = { OCEAN: 0, SHALLOW: 1, BEACH: 2, MEADOW: 3, FOREST: 4, PINES: 5, SWAMP: 6, DESERT: 7, SNOW: 8, ROCKY: 9, ICE: 10, LAKE: 11 };

const GRASS = ['#5c9e44', '#68ab4c', '#75b855', '#4f903b'];
export const BIOMES = [
  { name: 'Mar', pal: ['#2f6eb0', '#2a64a3', '#3576b8', '#285c98'], water: 'deep' },
  { name: 'Aguas poco profundas', pal: ['#4f9ad6', '#4a92cf', '#5aa6dc', '#4489c6'], water: 'shallow' },
  { name: 'Playa', pal: ['#ecd9a6', '#e4cf98', '#f2e2b4', '#dcc48a'] },
  { name: 'Pradera', pal: GRASS },
  { name: 'Bosque', pal: ['#4a8a3c', '#538f40', '#5c9a46', '#40783a'] },
  { name: 'Bosque de pinos', pal: ['#3e7444', '#45804a', '#4d8a50', '#366a3e'] },
  { name: 'Pantano', pal: ['#56703c', '#5e7a42', '#677f48', '#4a6234'] },
  { name: 'Desierto', pal: ['#e2c98e', '#d8bd80', '#ecd59c', '#cdb072'] },
  { name: 'Tundra nevada', pal: ['#eef3f8', '#e2eaf2', '#f8fbfd', '#d4dfea'] },
  { name: 'Montaña rocosa', pal: ['#8e8a82', '#9a968d', '#a8a49a', '#7e7a72'] },
  { name: 'Hielo', pal: ['#bfe0f2', '#b2d6ec', '#cfe9f7', '#a6cce4'] },
  { name: 'Lago', pal: ['#3578bb', '#2f6eb0', '#3f86c6', '#2a64a3'], water: 'deep' },
];
for (const b of BIOMES) b.rgb = b.pal.map(rgbOf);

// Valores del clima en (x, y). Se escriben en `out` para no crear objetos en los bucles grandes.
export function climate(x, y, seed, out = {}) {
  // Distorsión: los bordes entre biomas no son líneas rectas
  const wx = x + (vnoise(x * 0.02, y * 0.02, seed + 11) - 0.5) * 26;
  const wy = y + (vnoise(x * 0.02, y * 0.02, seed + 12) - 0.5) * 26;
  // Cerca del pueblo el clima es templado y no hay ríos, mar ni lagos (f = 0 en el pueblo, 1 lejos)
  const d = Math.hypot(x - CENTER.x, y - CENTER.y), f = smoothstep(45, 100, d);
  const local = 0.3 + vnoise(x * 0.07, y * 0.07, seed + 1) * 0.3;   // junto al pueblo: pradera o bosque, nunca pantano
  out.T = lerp(0.52, vnoise(wx * 0.006, wy * 0.006, seed + 100) * 0.75 + vnoise(wx * 0.03, wy * 0.03, seed + 101) * 0.25, f);
  out.M = lerp(local, vnoise(wx * 0.008, wy * 0.008, seed + 200) * 0.75 + vnoise(wx * 0.035, wy * 0.035, seed + 201) * 0.25, f);
  out.C = lerp(0.75, vnoise(wx * 0.0035, wy * 0.0035, seed + 300) * 0.7 + vnoise(wx * 0.012, wy * 0.012, seed + 301) * 0.3, f);
  out.R = vnoise(wx * 0.011, wy * 0.011, seed + 400);
  out.L = vnoise(x * 0.04, y * 0.04, seed + 500) * f;
  out.K = vnoise(wx * 0.01, wy * 0.01, seed + 600) * f;
  out.P = vnoise(x * 0.3, y * 0.3, seed + 700);
  out.f = f;
  return out;
}

// Bioma a partir del clima. j: pequeño desplazamiento aleatorio para que los bordes queden tramados.
export function classify(T, M, C, R, L, K, P, f, j = 0) {
  const c = C + j * 0.3, t = T + j, m = M + j;   // la costa cambia despacio: poco azar, o la orilla sale muy ancha
  if (c < 0.34) return B.OCEAN;
  if (c < 0.36) return B.SHALLOW;
  const cold = t < 0.32;
  if (Math.abs(R - 0.5) + j * 0.3 < 0.008 * f && c > 0.4) return cold ? B.ICE : B.SHALLOW;      // ríos
  if (L + j > 0.82) return cold ? B.ICE : L > 0.85 ? B.LAKE : B.SHALLOW;                        // lagos
  if (c < 0.41) return cold ? B.SNOW : B.BEACH;
  if (cold) return B.SNOW;
  if (K + j > 0.7) return B.ROCKY;
  if (t > 0.62 && m < 0.46) return B.DESERT;
  if (m > 0.64) return P + j > 0.73 ? B.SHALLOW : B.SWAMP;                                     // charcas del pantano
  if (t < 0.47 && m > 0.4) return B.PINES;
  if (m > 0.48) return B.FOREST;
  return B.MEADOW;
}

const tmp = {};
export function biomeAt(x, y, seed) {
  const c = climate(x, y, seed, tmp);
  return classify(c.T, c.M, c.C, c.R, c.L, c.K, c.P, c.f);
}
