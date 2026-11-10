// La torre vieja por dentro: sus medidas, sus choques y la altura de su escalera de caracol (la usan el dibujo, models.js,
// y el andar, entities.js). Es redonda, con la puerta mirando a +z, un pilar en medio y la escalera que sube alrededor
// desde la puerta, en sentido de las agujas del reloj visto desde arriba (el ángulo a = atan2(dx, dz) crece), hasta la
// terraza de arriba, con almenas. El hueco de la terraza deja pasar a la escalera en su última media vuelta.
export const TOWER = {
  R: 3.4, wall: 0.5, H: 12, pitch: 4.8, r0: 0.55, stepsPerTurn: 16, parapet: 1.15,
  door: [0.06, 0.62],                 // los ángulos de la puerta (en la pared, de 0 a 2,2 m)
  hole: [0.3, Math.PI],               // los ángulos del hueco de la terraza, por donde llega la escalera
};
TOWER.inner = TOWER.R - TOWER.wall;
TOWER.turns = TOWER.H / TOWER.pitch;

const TAU = Math.PI * 2;
const angleOf = (dx, dz) => { let a = Math.atan2(dx, dz); if (a < 0) a += TAU; return a; };
export const inHole = a => a >= TOWER.hole[0] && a <= TOWER.hole[1];

// Los choques de una torre en (x, y): la pared en anillo (con la puerta abierta), el pilar, un tope junto a la puerta
// para no meterse por debajo del final de la escalera (solo abajo: zmax) y la propia escalera (spiral: no frena, da la
// altura; ver floorAt en entities.js). Los animales y los monstruos no entran: para ellos la escalera es un círculo
export function towerColliders(x, y) {
  const T = TOWER, out = [], rw = T.R - 0.22;
  for (let a = 0; a < TAU; a += 0.13) {
    if (a > T.door[0] && a < T.door[1]) continue;
    out.push({ x: x + Math.sin(a) * rw, y: y + Math.cos(a) * rw, r: 0.26 });
  }
  out.push({ x, y, r: T.r0, zmax: T.H - 0.4 });   // (arriba, en la terraza, se pasa por encima)
  for (let r = T.r0 + 0.2; r < T.inner; r += 0.3) out.push({ x: x + Math.sin(0.01) * r, y: y + Math.cos(0.01) * r, r: 0.16, zmax: 1.2 });
  out.push({ x, y, r: T.inner, top: T.H, spiral: true });
  return out;
}

// La altura de lo que se pisa dentro de la torre, viniendo de la altura z: de las vueltas de la escalera que pasan por
// aquí (y de la terraza, fuera de su hueco), la más cercana; null si (x, y) no está dentro
export function towerFloor(c, x, y, z) {
  const T = TOWER, dx = x - c.x, dz = y - c.y, r = Math.hypot(dx, dz);
  if (r > T.inner + 0.05) return null;
  const a = angleOf(dx, dz), t = a / TAU;
  let best = null, bd = Infinity;
  const take = h => { const d = Math.abs(h - z); if (d < bd) { bd = d; best = h; } };
  if (r > T.r0 - 0.05) for (let k = 0; ; k++) { const h = (t + k) * T.pitch; if (h > T.H + 0.01) break; take(h); }
  if (!inHole(a) || r < T.r0) take(T.H);
  return best ?? 0;
}
