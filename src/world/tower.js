// La torre por dentro: sus medidas, sus choques y la altura de su escalera de caracol (la usan el dibujo, models.js,
// y el andar, entities.js). Es redonda, con la puerta mirando a +z, un pilar en medio y la escalera que sube alrededor
// desde la puerta, en sentido de las agujas del reloj visto desde arriba (el ángulo a = atan2(dx, dz) crece), hasta la
// terraza de arriba, con almenas. El hueco de la terraza deja pasar a la escalera en su última media vuelta.
// A tower may be 9 or 12 m tall (h; the ones of before, TOWER.H) and have its door to any of the four sides (yaw: how far it
// is turned, as the models are; 0, to +z). A tower: { x, y, h?, yaw?, stone? }: a place (explore.js) or a collider of these.
// Here too, the gallery of the lighthouses (GALLERY) and what each is called as a model (poiModel).

export const TOWER = {
  R: 3.4, wall: 0.5, H: 12, pitch: 4.8, r0: 0.55, stepsPerTurn: 16, parapet: 1.15,
  door: [0.06, 0.62],                 // los ángulos de la puerta (en la pared, de 0 a 2,2 m)
  hole: [0.3, Math.PI],               // los ángulos del hueco de la terraza, por donde llega la escalera
};
TOWER.inner = TOWER.R - TOWER.wall;
TOWER.turns = TOWER.H / TOWER.pitch;
export const TOWER_HEIGHTS = [9, 12];

const TAU = Math.PI * 2;
const angleOf = (dx, dz) => { let a = Math.atan2(dx, dz); if (a < 0) a += TAU; return a; };
// The hole of a terrace at h: the stairs' last half turn, up to where they end
const HOLE_W = TOWER.hole[1] - TOWER.hole[0];
export function holeOf(h = TOWER.H) {
  if (h === TOWER.H) return TOWER.hole;
  let e = ((h / TOWER.pitch) % 1) * TAU;
  if (e < HOLE_W) e += TAU;
  return [e - HOLE_W, e];
}
export const inHole = (a, h = TOWER.H) => { const [p, q] = holeOf(h); return a >= p && a <= q; };
// The watchtowers one builds (B › Exterior): their height, and the tiles they take, SIDE to a side
// (and the lighthouses: light, how they are painted; half, the tiles they take to each side of their own, 3 × 3 in all)
export const WATCHTOWERS = { watchtower: { h: 9 }, watchtower_tall: { h: 12 } };
export const LIGHTHOUSES = { lighthouse: { h: 11, half: 1, light: 'red' }, lighthouse_stone: { h: 11, half: 1, light: 'stone' }, lighthouse_black: { h: 11, half: 1, light: 'black' } };
const BIG = { ...WATCHTOWERS, ...LIGHTHOUSES };
export const watchtower = id => (id && Object.hasOwn(BIG, id) ? BIG[id] : null);
export const SIDE = 7, HALF_SIDE = 3;
export const halfOf = W => W?.half ?? HALF_SIDE;
// Where the watchman's chest is, on the terrace: against the wall, opposite the stairs' hole
const CHEST_R = 2.3;
export function chestSpot(t) {
  const h = t.h || TOWER.H, [p, q] = holeOf(h), a = (p + q) / 2 + Math.PI + (t.yaw || 0);
  return { x: t.x + Math.sin(a) * CHEST_R, y: t.y + Math.cos(a) * CHEST_R, yaw: a + Math.PI, z: h };
}

// Los choques de una torre en (x, y): la pared en anillo (con la puerta abierta), el pilar, un tope junto a la puerta
// para no meterse por debajo del final de la escalera (solo abajo: zmax) y la propia escalera (spiral: no frena, da la
// altura; ver floorAt en entities.js). Los animales y los monstruos no entran: para ellos la escalera es un círculo
// key: whose tower it is, for the look-around (lookout.js)
export function towerColliders(x, y, { h = TOWER.H, yaw = 0, key = null } = {}) {
  const T = TOWER, out = [], rw = T.R - 0.22;
  for (let a = 0; a < TAU; a += 0.13) {
    if (a > T.door[0] && a < T.door[1]) continue;
    out.push({ x: x + Math.sin(a + yaw) * rw, y: y + Math.cos(a + yaw) * rw, r: 0.26 });
  }
  out.push({ x, y, r: T.r0, zmax: h - 0.4 });   // (arriba, en la terraza, se pasa por encima)
  for (let r = T.r0 + 0.2; r < T.inner; r += 0.3) out.push({ x: x + Math.sin(0.01 + yaw) * r, y: y + Math.cos(0.01 + yaw) * r, r: 0.16, zmax: 1.2 });
  out.push({ x, y, r: T.inner, top: h, spiral: true, h, yaw, key });
  return out;
}

// La altura de lo que se pisa dentro de la torre, viniendo de la altura z: de las vueltas de la escalera que pasan por
// aquí (y de la terraza, fuera de su hueco), la más cercana; null si (x, y) no está dentro
export function towerFloor(c, x, y, z) {
  const T = TOWER, H = c.h || T.H, dx = x - c.x, dz = y - c.y, r = Math.hypot(dx, dz);
  if (r > T.inner + 0.05) return null;
  const a = angleOf(dx, dz) - (c.yaw || 0), t = (a < 0 ? a + TAU : a) / TAU;
  let best = null, bd = Infinity;
  const take = h => { const d = Math.abs(h - z); if (d < bd) { bd = d; best = h; } };
  if (r > T.r0 - 0.05) for (let k = 0; ; k++) { const h = (t + k) * T.pitch; if (h > H + 0.01) break; take(h); }
  if (!inHole(t * TAU, H) || r < T.r0) take(H);
  return best ?? 0;
}

// ---------- the lighthouse ----------
// Its measures (models.js draws it with these): the base and the shaft, and the gallery round the lantern at H, with its
// rail. One goes up and down by a fade (explore.js): the stairs inside are too narrow to walk
export const GALLERY = { H: 8.4, deck: 1.78, lantern: 0.62, rail: 1.68, base: 1.5 };
const RAIL_R = 0.16;
// Its colliders: the base below; on the gallery (zmin: only from that height up), the lantern and the rail. gallery: the
// floor, see galleryFloor
export function lighthouseColliders(x, y, key = null) {
  const G = GALLERY, up = G.H - 2, out = [{ x, y, r: G.base - 0.1, zmax: up }, { x, y, r: G.lantern, zmin: up }];
  for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU, r = G.rail + RAIL_R; out.push({ x: x + Math.sin(a) * r, y: y + Math.cos(a) * r, r: RAIL_R, zmin: up }); }
  out.push({ x, y, r: G.deck, top: G.H, gallery: true, h: G.H, key });
  return out;
}
// The gallery's floor, for who comes from height z: only from up there (below, the base stops you)
export const galleryFloor = (c, x, y, z) => (z > c.h - 2 && Math.hypot(x - c.x, y - c.y) < c.r + 0.1 ? c.h : null);

// The name of a place's model ('poi:torre:9:slate', 'poi:faro:dark', 'poi:cueva:snow'…)
export function poiModel(p) {
  if (p.kind === 'torre' && p.h) return `poi:torre:${p.h}:${p.stone}`;
  if (p.kind === 'faro') return p.form ? `lighthouse:${p.livery}:${p.lit === false ? 'dark' : 'lit'}:0.6` : p.lit === false ? 'poi:faro:dark' : 'poi:faro';
  return `poi:${p.kind}${p.snow ? ':snow' : ''}`;
}
