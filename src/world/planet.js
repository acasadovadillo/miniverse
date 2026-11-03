// El planeta. El mundo es un rectángulo que se cierra sobre sí mismo, como el mapa de la Tierra: andando hacia el
// este o el oeste se da la vuelta y se vuelve al mismo sitio, y al cruzar un polo se sale por el otro lado del
// planeta (180° más allá), andando hacia el sur. Mide W casillas de vuelta y H de polo a polo; el pueblo está a 40°
// de latitud norte, en la longitud 0. Las x van de -W/2 a W/2 (la costura, en las antípodas del pueblo) y las y,
// del polo norte (NORTH) al sur (SOUTH). Cada planeta es un mundo con su propio archivo; este es el primero.
import { vnoise, smoothstep } from '../util.js';

export const PLANET = { id: 'miniverse', name: 'Miniverse', W: 65536, H: 32768, homeLat: 40 };
export const W = PLANET.W, H = PLANET.H, HALF = W / 2;
const HOME_Y = 30;   // (la y del pueblo)
export const NORTH = Math.round(HOME_Y - ((90 - PLANET.homeLat) / 180) * H), SOUTH = NORTH + H;
export const TILES_PER_DEGREE = H / 180;

// Una x del planeta (entre -W/2 y W/2), y la diferencia más corta entre dos (de b hasta a)
export const wrapX = x => x - W * Math.floor((x + HALF) / W);
export const dxOf = (a, b) => wrapX(a - b);
export const distOf = (ax, ay, bx, by) => Math.hypot(dxOf(ax, bx), ay - by);
// x vista desde ref: en el mismo lado de la costura (para dibujar o comparar lo que está cerca)
export const nearX = (x, ref) => ref + wrapX(x - ref);
// Lo mismo con los trozos (de CHUNK casillas) y los bloques del suelo (de n casillas)
export const wrapIndex = (i, size) => { const n = W / size; return i - n * Math.floor((i + n / 2) / n); };
export const inPlanet = (x, y) => x >= -HALF && x < HALF && y >= NORTH && y < SOUTH;
// Latitud (90 en el polo norte, -90 en el sur) y longitud (-180 a 180, 0 en el pueblo)
export const latOf = y => 90 - ((y - NORTH) / H) * 180;
export const lonOf = x => (wrapX(x) / W) * 360;

// Ruido que da la vuelta al planeta sin costura: el de siempre (con su frecuencia f, por casilla) en casi todo el
// planeta y, en los últimos BLEND de cada lado de la costura, mezclado poco a poco con el del otro lado, hasta mitad
// y mitad en la costura misma (así, a los dos lados de ella sale lo mismo). Lejos de la costura, como siempre.
const BLEND = 8000;
export function wrapNoise(f) {
  return (x, y, s) => {
    x = wrapX(x);
    const a = vnoise(x * f, y * f, s), ax = Math.abs(x);
    if (ax < HALF - BLEND) return a;
    const t = smoothstep(HALF - BLEND, HALF, ax) * 0.5, b = vnoise((x - Math.sign(x) * W) * f, y * f, s);
    return a + (b - a) * t;
  };
}
