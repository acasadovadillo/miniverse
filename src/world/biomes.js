// Clima y biomas. Cada punto del mundo tiene temperatura, humedad, "continentalidad" (tierra o mar),
// ríos, lagos, roca y charcas, todos a partir de ruido con la semilla (que da vueltas enteras al planeta). Con eso
// se decide el bioma. Lejos del pueblo, la latitud: más calor hacia el ecuador, más frío hacia los polos y, cerca
// de ellos, casquetes de hielo (sobre la tierra y sobre el mar).
import { lerp, smoothstep, rgbOf } from '../util.js';
import { CENTER } from './village.js';
import { wrapNoise, dxOf, latOf, PLANET } from './planet.js';
import { tonos } from '../arte.js';

export const B = { OCEAN: 0, SHALLOW: 1, BEACH: 2, MEADOW: 3, FOREST: 4, PINES: 5, SWAMP: 6, DESERT: 7, SNOW: 8, ROCKY: 9, ICE: 10, LAKE: 11 };

// Cada bioma con su color de la paleta sobria (sección 4.8 de docs/propuesta-arte.md), en cuatro tonos (ver tonos())
export const BIOMES = [
  { name: 'Mar', base: '#2f4a4f', water: 'deep' },
  { name: 'Aguas poco profundas', base: '#47666a', water: 'shallow' },
  { name: 'Playa', base: '#c9b88e' },
  { name: 'Pradera', base: '#6e7a55' },
  { name: 'Bosque', base: '#4f5e42' },
  { name: 'Bosque de pinos', base: '#46553f' },
  { name: 'Pantano', base: '#4e5740' },
  { name: 'Desierto', base: '#b9a681' },
  { name: 'Tundra nevada', base: '#d9dddc' },
  { name: 'Montaña rocosa', base: '#7c786e' },
  { name: 'Hielo', base: '#b4cdd6' },
  { name: 'Lago', base: '#355a63', water: 'deep' },
];
for (const b of BIOMES) { b.pal = tonos(b.base); b.rgb = b.pal.map(rgbOf); }

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
  const t0 = N[0.006](wx, wy, seed + 100), m0 = N[0.008](wx, wy, seed + 200), lw = (warmth(lat) - HOME_WARMTH) * band;
  out.T = lerp(0.52, t0 * 0.75 + N[0.03](wx, wy, seed + 101) * 0.25, f) + lw;
  out.M = lerp(local, m0 * 0.75 + N[0.035](wx, wy, seed + 201) * 0.25, f);
  // (lo mismo sin el ruido fino, de unos 30 m: el tipo de tierra sale de esto, para que no haya islotes de nieve en el
  // desierto ni de desierto en el bosque; el agua sigue saliendo de T y M, como siempre)
  out.Tl = lerp(0.52, t0 * 0.75 + 0.125, f) + lw;
  out.Ml = lerp(local, m0 * 0.75 + 0.125, f);
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
export function classify(T, M, C, R, L, K, P, f, j = 0, Q = 0, Tl = T, Ml = M) {
  if (Q + j * 2 > 0.5) return B.ICE;
  const c = C + j * 0.3, t = T + j, m = M + j;   // la costa cambia despacio: poco azar, o la orilla sale muy ancha
  if (c < 0.34) return B.OCEAN;
  if (c < 0.36) return B.SHALLOW;
  const cold = t < 0.32;   // (el agua: con T, igual que wetness)
  if (Math.abs(R - 0.5) + j * 0.3 < 0.008 * f && c > 0.4) return cold ? B.ICE : B.SHALLOW;      // ríos
  if (L + j > 0.82) return cold ? B.ICE : L > 0.85 ? B.LAKE : B.SHALLOW;                        // lagos
  if (m > 0.64 && !cold && P + j > 0.73) return B.SHALLOW;                                        // charcas del pantano (agua: con M)
  // La tierra, con el clima de gran escala (Tl, Ml)
  const tl = Tl + j, ml = Ml + j, coldL = tl < 0.32;
  if (c < 0.41) return coldL ? B.SNOW : B.BEACH;
  if (coldL) return B.SNOW;
  if (K + j > 0.7) return B.ROCKY;
  if (tl > 0.62 && ml < 0.46) return B.DESERT;
  if (ml > 0.64) return B.SWAMP;
  if (tl < 0.47 && ml > 0.4) return B.PINES;
  if (ml > 0.48) return B.FOREST;
  return B.MEADOW;
}

// Cuánta agua hay en un punto según el clima: lo mismo que decide classify (sin el tramado), pero seguido, para
// que la orilla no salga a escalones. > 0 bajo el agua (1: lo hondo de un río; más, mar adentro o en un lago),
// < 0 en tierra (cuanto más lejos de la orilla, más negativo). En el hielo y el frío solo queda el mar.
export function wetness(c) {
  if (c.Q > 0.5) return -1;
  let u = (0.36 - c.C) / 0.02;                                                                 // el mar
  if (c.T >= 0.32) {
    if (c.C > 0.4 && c.f > 0.01) u = Math.max(u, 1 - Math.abs(c.R - 0.5) / (0.008 * c.f));   // los ríos
    u = Math.max(u, (c.L - 0.82) / 0.03);                                                     // los lagos
    if (c.M > 0.64) u = Math.max(u, (c.P - 0.73) / 0.02);                                     // las charcas del pantano
  }
  return u;
}
// Lo que se hunde el suelo con esa agua (metros, negativo): en la orilla hay un escalón de 27 cm (el agua está a
// -0,12: así el borde es nítido, con 15 cm de agua, y no una lámina), un río llega a casi 60 cm y el mar y los
// lagos, a más de uno
// El relieve (metros sobre el agua, 0 o más) en tierra, con el clima de ese punto (c, de climate) y lo mojado (u, de
// wetness): colinas suaves en todas partes (algo más en los bosques y dunas en el desierto) y montañas donde hay roca (K)
// o hace frío, con crestas. Los ríos, los lagos, el mar y los pantanos van por el fondo de los valles: el relieve baja a
// 0 en sus orillas. Junto al pueblo (f = 0) todo es llano. Lo construido y los lugares, también: ver scenes.js (padK)
const NR = { hill: wrapNoise(0.028), hill2: wrapNoise(0.075), ridge: wrapNoise(0.013), peak: wrapNoise(0.045), mnt: wrapNoise(0.0045) };
export function reliefOf(c, u, x, y, seed) {
  if (c.f <= 0 || u > 0 || c.Q > 0.5) return 0;
  const valley = smoothstep(0.008, 0.2, Math.abs(c.R - 0.5)) * smoothstep(0.37, 0.56, c.C) * smoothstep(0.82, 0.56, c.L) * (1 - smoothstep(0.56, 0.66, c.M)) * smoothstep(0, 4, -u);   // (anchos: laderas, no paredes)
  if (valley <= 0) return 0;
  const desert = c.T > 0.62 && c.M < 0.46 ? 1 : 0, woods = smoothstep(0.42, 0.55, c.M);
  let h = Math.max(0, NR.hill(x, y, seed + 830) * 0.75 + NR.hill2(x, y, seed + 831) * 0.25 - 0.32) * (3.2 + 1.6 * woods) * (desert ? 0.7 : 1);
  // Las montañas: donde hay roca, donde hace frío y, de vez en cuando, una sierra suelta
  const mask = Math.max(smoothstep(0.52, 0.78, c.K), smoothstep(0.38, 0.27, c.T) * 0.8, smoothstep(0.62, 0.8, NR.mnt(x, y, seed + 840)) * 0.7);
  if (mask > 0) { const r = 1 - Math.abs(NR.ridge(x, y, seed + 841) * 2 - 1); h += mask * (5 + 17 * r * r * (0.65 + 0.35 * NR.peak(x, y, seed + 842))); }
  return h * valley * smoothstep(0, 0.6, c.f);
}
export const depthOfWet = u => (u <= 0 ? 0 : -0.27 - 0.3 * smoothstep(0, 0.6, u) - 0.7 * smoothstep(1, 2.5, u));
// Qué orilla tiene: arena (costa y desierto), barro (lo normal) o lodo oscuro (pantano)
export const shoreOf = (T, M, C) => (C < 0.41 || (T > 0.62 && M < 0.46) ? 0 : M > 0.64 ? 2 : 1);

const tmp = {};
export function biomeAt(x, y, seed) {
  const c = climate(x, y, seed, tmp);
  return classify(c.T, c.M, c.C, c.R, c.L, c.K, c.P, c.f, 0, c.Q, c.Tl, c.Ml);
}
