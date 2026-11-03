// Clima y biomas. Cada punto del mundo tiene temperatura, humedad, "continentalidad" (tierra o mar),
// ríos, lagos, roca y charcas, todos a partir de ruido con la semilla (que da vueltas enteras al planeta). Con eso
// se decide el bioma. Lejos del pueblo, la latitud: más calor hacia el ecuador, más frío hacia los polos y, cerca
// de ellos, casquetes de hielo (sobre la tierra y sobre el mar).
import { lerp, smoothstep, rgbOf } from '../util.js';
import { CENTER } from './village.js';
import { wrapNoise, dxOf, latOf, PLANET } from './planet.js';

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

// Los ruidos del clima, uno por frecuencia
const N = Object.fromEntries([0.02, 0.07, 0.006, 0.03, 0.008, 0.035, 0.0035, 0.012, 0.011, 0.04, 0.01, 0.3].map(f => [f, wrapNoise(f)]));
const LAT_KEEP = [2000, 4000];   // a cuántas casillas al norte o al sur del pueblo empieza a notarse la latitud (y del todo)
const warmth = lat => 0.15 + 0.75 * Math.cos((lat * Math.PI) / 180);
const HOME_WARMTH = warmth(PLANET.homeLat);   // (la del pueblo)

// Valores del clima en (x, y). Se escriben en `out` para no crear objetos en los bucles grandes.
export function climate(x, y, seed, out = {}) {
  // Distorsión: los bordes entre biomas no son líneas rectas
  const wx = x + (N[0.02](x, y, seed + 11) - 0.5) * 26;
  const wy = y + (N[0.02](x, y, seed + 12) - 0.5) * 26;
  // Cerca del pueblo el clima es templado y no hay ríos, mar ni lagos (f = 0 en el pueblo, 1 lejos)
  const d = Math.hypot(dxOf(x, CENTER.x), y - CENTER.y), f = smoothstep(45, 100, d);
  const local = 0.3 + N[0.07](x, y, seed + 1) * 0.3;   // junto al pueblo: pradera o bosque, nunca pantano
  const lat = latOf(y), band = smoothstep(LAT_KEEP[0], LAT_KEEP[1], Math.abs(y - CENTER.y));
  out.T = lerp(0.52, N[0.006](wx, wy, seed + 100) * 0.75 + N[0.03](wx, wy, seed + 101) * 0.25, f) + (warmth(lat) - HOME_WARMTH) * band;
  out.M = lerp(local, N[0.008](wx, wy, seed + 200) * 0.75 + N[0.035](wx, wy, seed + 201) * 0.25, f);
  out.C = lerp(0.75, N[0.0035](wx, wy, seed + 300) * 0.7 + N[0.012](wx, wy, seed + 301) * 0.3, f);
  out.R = N[0.011](wx, wy, seed + 400);
  out.L = N[0.04](x, y, seed + 500) * f;
  out.K = N[0.01](wx, wy, seed + 600) * f;
  out.P = N[0.3](x, y, seed + 700);
  out.f = f;
  out.Q = smoothstep(78, 84, Math.abs(lat));   // el casquete polar
  return out;
}

// Bioma a partir del clima. j: pequeño desplazamiento aleatorio para que los bordes queden tramados. Q: lo que se
// está dentro de un casquete polar (todo hielo, también el mar)
export function classify(T, M, C, R, L, K, P, f, j = 0, Q = 0) {
  if (Q + j * 2 > 0.5) return B.ICE;
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
  return classify(c.T, c.M, c.C, c.R, c.L, c.K, c.P, c.f, 0, c.Q);
}
