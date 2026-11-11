// El arte del juego («Pueblo vivido», ver docs/propuesta-arte.md): un pueblo de cal, madera, piedra y barro con luz y
// color sobrios. Aquí está lo que no necesita Three (vale también en el hilo del suelo, genworker.js): la paleta y
// sobrio(), tonos() y apagado(). (Hasta 2026-11-10 había otro arte, el de antes, que se podía pedir con ?arte=1: ya no
// está. Si quedan las dos claves con las que se acordaba cada navegador, se borran: solo esas, que son del juego.)
import { apagada } from './opciones.js';
if (typeof localStorage !== 'undefined') try { localStorage.removeItem('pueblo-brotes:arte-v2'); localStorage.removeItem('pueblo-brotes:arte'); } catch {}

// La paleta (sección 3 de la propuesta). Suelo y muros, saturación de 30 o menos; la nota de color la ponen las
// pinturas de puertas y postigos.
export const PAL = {
  suelo: { hierba: '#6e7a55', seca: '#8b8562', tierra: '#6b5e4b', camino: '#8d7d65', barro: '#4f4538', roca: '#77746b', arena: '#b1a27f', nieve: '#d9dcd8' },
  muro: { cal: '#cdc4b1', calSucia: '#a99f8b', piedra: '#7f7b71', piedraOscura: '#5e5b54', entramado: '#4f4438', tablaVieja: '#6d5c4c', tablaClara: '#907c64' },
  cubierta: { teja: '#8e6650', tejaOscura: '#6e5040', pizarra: '#4c5053', paja: '#9d8d6e' },
  pintura: { verdin: '#3f7f5a', ocre: '#b08a4e', almagre: '#8f4a38', anil: '#3a5f8f', ciruela: '#7a3a68' },
  detalle: { hierro: '#4f5254', laton: '#8a7440', cristal: '#39444a' },
  follaje: { primavera: '#6f8050', verano: '#59683f', otono: '#94703a', otono2: '#7f4e2e', pino: '#3f5240', tronco: '#4d4236' },
  agua: { profunda: '#2f4a4f', media: '#47666a', orilla: '#7f8f83', espuma: '#c7ccc2' },
};

const rgb = hex => { const n = parseInt(String(hex).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (r, g, b) => '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
function hsv(r, g, b) {
  const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m;
  let h = 0;
  if (d > 0) { if (M === r) h = ((g - b) / d + 6) % 6; else if (M === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; }
  return [h, M > 0 ? d / M : 0, M];
}
function fromHsv(h, s, v) {
  const m = v * (1 - s), x = m + (v - m) * (1 - Math.abs((h % 2) - 1));
  return [[v, x, m], [x, v, m], [m, v, x], [m, x, v], [x, m, v], [v, m, x]][Math.floor(h) % 6];
}
// Un color guardado (de ropa, pelo o piel), apagado para dibujarlo: las partidas guardan el suyo y se ve así. Telas y
// pelo: saturación ×0,85 y valor ×0,92; piel: saturación ×0,85 y valor ×0,97.
const SOBRIO = new Map();
export function sobrio(c, tipo) {
  if (typeof c !== 'string' || c[0] !== '#' || c.length !== 7) return c;
  const k = c + (tipo || '');
  let o = SOBRIO.get(k);
  if (!o) {
    const [h, s, v] = hsv(...rgb(c));
    SOBRIO.set(k, (o = hex(...fromHsv(h, s * 0.85, v * (tipo === 'piel' ? 0.97 : 0.92)))));
  }
  return o;
}
// Los cuatro tonos de un color de suelo, como los de siempre: el de base, dos más claros y uno más oscuro
export const tonos = c => { const [h, s, v] = hsv(...rgb(c)); return [1, 1.08, 1.16, 0.91].map((k, i) => hex(...fromHsv((h + [0, 0.02, 0.04, -0.02][i] + 6) % 6, s, Math.min(255, v * k)))); };
// Los cuatro tonos del suelo de un bioma (el de base, dos más claros y uno más oscuro), con más recorrido que tonos(): los
// claros salen más secos (más amarillos y menos saturados) y el oscuro, más jugoso. El matiz va en sextos de vuelta
// (-0,14: unos 8°). k: el contraste de cada bioma (la nieve y la arena, poco). (tonos() se queda como estaba: lo usan
// las hojas)
export const tonosSuelo = (c, k = 1) => {
  const [h, s, v] = hsv(...rgb(c));
  return [[1, 1, 0], [1 + 0.1 * k, 1 - 0.08 * k, -0.08 * k], [1 + 0.2 * k, 1 - 0.15 * k, -0.14 * k], [1 - 0.16 * k, 1 + 0.08 * k, 0.06 * k]]
    .map(([kv, ks, kh]) => hex(...fromHsv((h + kh + 6) % 6, Math.min(1, s * ks), Math.min(255, v * kv))));
};
// ?suelo=0 (o ?suelo=v2, como antes): el suelo de antes (paleta, detalle y matas de hasta 2026-11-10), para compararlo con
// el de ahora en el mismo código. Se lee en el hilo principal (de la dirección de la página) y en el del suelo (de la
// suya: terrain.js le pasa la opción al crearlo). Ver opciones.js
export const SUELO_V2 = apagada('suelo');
// Para todo lo demás que no tiene color propio en la paleta (muebles, telas, toldos…): saturación ×0,7 y valor ×0,9,
// para que no chille sobre el mundo sobrio.
const APAGADO = new Map();
export function apagado(c) {
  if (typeof c !== 'string' || c[0] !== '#' || c.length !== 7) return c;
  let o = APAGADO.get(c);
  if (!o) { const [h, s, v] = hsv(...rgb(c)); APAGADO.set(c, (o = hex(...fromHsv(h, s * 0.7, v * 0.9)))); }
  return o;
}
