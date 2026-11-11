// Contra qué choca lo que vuela (las flechas): la forma de lo que se ve, no la de los choques al andar. Una valla para al
// que anda con una caja de lado a lado y hasta el suelo, pero una flecha pasa por encima, y entre sus barras; un árbol
// para con su tronco, no con la copa (las hojas no frenan una flecha); un mueble, con las piezas de su modelo.
//
// Cada trozo da sus formas (se hacen una vez por versión del trozo: ver shapesOf), todas con su altura de verdad (la del
// suelo o la de lo construido debajo):
//   caja:     { b: caja girada del plano (fit.js), con sus alturas y0 e y1 }
//   cilindro: { c: [x, y], r, y0, y1 }                       (troncos y postes redondos)
//   elipsoide: { e: [x, y, z], rx, ry }                      (rocas y arbustos, redondeados)
// y cada una lleva su recuadro en el plano (x0, y0p, x1, y1p) para descartar deprisa lo que no está en el camino.
import { PIECES } from '../pieces.js';
import { aabb, rayHits, placeBoxes, partsOf } from './fit.js';
import { broadDims, pineDims, palmDims, treeK, cactusK } from './treedims.js';
import { TOWER } from './tower.js';
import { CHUNK } from './gen.js';
import { ihash } from '../util.js';
import { WALL_H, DOOR } from '../three/build3d.js';

const CACHE = new WeakMap();   // lo de cada trozo (el objeto de contentFor: cambia con el trozo)
const box = (b, y0, y1, out) => { b.y0 = y0; b.y1 = y1; out.push({ b, ...plan(b) }); };   // (b es siempre nueva: placeBoxes y aabb)
const plan = b => { const ex = Math.abs(b.ux) * b.hx + Math.abs(b.vx) * b.hy, ey = Math.abs(b.uy) * b.hx + Math.abs(b.vy) * b.hy; return { x0: b.x - ex, x1: b.x + ex, y0p: b.y - ey, y1p: b.y + ey }; };
const cyl = (x, y, r, y0, y1, out) => out.push({ c: [x, y], r, y0, y1, x0: x - r, x1: x + r, y0p: y - r, y1p: y + r });
const ell = (x, y, z, rx, ry, out) => out.push({ e: [x, y, z], rx, ry, x0: x - rx, x1: x + rx, y0p: y - rx, y1p: y + rx });
// Una caja alineada con los ejes, de (x0, y0) a (x1, y1) en el plano
const rect = (x0, y0, x1, y1, h0, h1, out) => box(aabb(x0, y0, x1, y1), h0, h1, out);

// Las formas de un trozo (data: lo que da scene.contentFor). gy(x, y): la altura del suelo
export function shapesOf(scene, data, gy) {
  let out = CACHE.get(data);
  if (out) return out;
  out = [];
  const lv = (tx, ty) => scene.levelAt?.(tx + 0.5, ty + 0.5) || 0;   // (lo construido, a la altura de su casilla: ver world3d.js, LIFT)
  for (const o of data.objects) {
    if (o.placed && o.layer === 'placed') {
      const [tx, ty] = o.tile, L = lv(tx, ty), piece = PIECES[o.placed];
      if (o.fence) fence(o, tx, ty, L, out);
      else if (o.gate) gate(scene, o, tx, ty, L, out);
      else if (o.door && !scene.doorClosed?.(tx, ty)) {   // (abierta: el dintel; las jambas y la cerrada van con los muros)
        const X = o.door === 'x';
        rect(X ? tx : tx + 0.5 - 0.13, X ? ty + 0.5 - 0.13 : ty, X ? tx + 1 : tx + 0.5 + 0.13, X ? ty + 0.5 + 0.13 : ty + 1, L + DOOR.y1, L + WALL_H, out);
      } else if (!piece) for (const b of placeBoxes(partsOf(o.model || o.placed), o.x, o.y, o.yaw ?? 0)) box(b, L + b.y0, L + b.y1, out);   // los muebles, pieza a pieza
    } else if (o.kind && !o.flower) nature(o, gy(o.x, o.y), out);
    else if (o.poi) poi(o.poi, out);
    else if (o.treasure) for (const b of placeBoxes(partsOf(`treasure:${o.open ? 1 : 0}`), o.x, o.y, 0)) box(b, b.y0, b.y1, out);
  }
  // Los muros, las jambas, las puertas cerradas y el hogar: lo que ocupan al andar, de su suelo hasta lo alto del muro
  for (const c of data.colliders) {
    if (!c.wall && !c.piece) continue;
    const L = lv(Math.floor((c.x0 + c.x1) / 2), Math.floor((c.y0 + c.y1) / 2));
    rect(c.x0, c.y0, c.x1, c.y1, L, L + WALL_H, out);
  }
  CACHE.set(data, out);
  return out;
}

// La valla: el poste y, hacia cada vecina, sus dos barras (como three/build3d.js, fenceTile); la de piedra, maciza
function fence(o, tx, ty, L, out) {
  const cx = tx + 0.5, cy = ty + 0.5, m = o.mask || 0, stone = o.placed === 'valla_piedra';
  const arms = [[1, 1, 0], [2, -1, 0], [4, 0, 1], [8, 0, -1]].filter(([bit]) => m & bit);
  if (stone) {
    rect(cx - 0.2, cy - 0.2, cx + 0.2, cy + 0.2, L, L + 0.8, out);
    for (const [, dx, dy] of arms) {
      if (dx) rect(Math.min(cx, cx + dx * 0.5), cy - 0.15, Math.max(cx, cx + dx * 0.5), cy + 0.15, L, L + 0.62, out);
      else rect(cx - 0.15, Math.min(cy, cy + dy * 0.5), cx + 0.15, Math.max(cy, cy + dy * 0.5), L, L + 0.62, out);
    }
    return;
  }
  rect(cx - 0.06, cy - 0.06, cx + 0.06, cy + 0.06, L, L + 0.96, out);
  for (const [, dx, dy] of arms) for (const h of [0.36, 0.72]) {
    if (dx) rect(Math.min(cx, cx + dx * 0.5), cy - 0.09, Math.max(cx, cx + dx * 0.5), cy + 0.09, L + h, L + h + 0.1, out);
    else rect(cx - 0.09, Math.min(cy, cy + dy * 0.5), cx + 0.09, Math.max(cy, cy + dy * 0.5), L + h, L + h + 0.1, out);
  }
}
// La puerta de la valla: sus dos postes y, cerrada, la hoja (abierta gira: solo los postes)
function gate(scene, o, tx, ty, L, out) {
  const X = o.door === 'x', cx = tx + 0.5, cy = ty + 0.5;
  for (const s of [-0.5, 0.5]) { const px = X ? cx + s : cx, py = X ? cy : cy + s; rect(px - 0.08, py - 0.08, px + 0.08, py + 0.08, L, L + 1.07, out); }
  if (scene.doorClosed?.(tx, ty)) rect(X ? tx : cx - 0.045, X ? cy - 0.045 : ty, X ? tx + 1 : cx + 0.045, X ? cy + 0.045 : ty + 1, L + 0.18, L + 0.92, out);
}
// Árboles (el tronco), rocas y arbustos, con las medidas con que se dibujan de cerca (three/nature3d.js)
function nature(o, y, out) {
  const kind = o.kind, x = o.x, z = o.y;
  if (kind === 'oak' || kind === 'fruit') { const { k, th, cy } = broadDims(o, y); cyl(x, z, 0.26 * k, y, y + th + (cy - y - th) * 0.5, out); }
  else if (kind === 'swampTree') { const k = treeK(o); cyl(x, z, 0.34 * k, y, y + 1.25 * k, out); }
  else if (kind === 'pine' || kind === 'snowPine') { const { k, H } = pineDims(o); cyl(x, z, 0.19 * k, y, y + H * 0.74, out); }
  else if (kind === 'palm') { const { k, H } = palmDims(o); cyl(x, z, 0.2 * Math.sqrt(k), y, y + H * 0.45, out); }   // (lo de abajo, casi derecho)
  else if (kind === 'cactus') { const k = cactusK(o); cyl(x, z, 0.2 * Math.sqrt(k), y, y + 2.2 * k, out); }
  else if (kind === 'rock' || kind === 'boulder' || kind === 'snowBoulder') {
    const h = ihash(Math.floor(x * 7), Math.floor(z * 7), 11), s = kind === 'rock' ? 0.3 + h * 0.14 : 0.8 + h * 0.2;
    ell(x, z, y + s * 0.12, s * 1.15, s * (kind === 'rock' ? 0.8 : 0.95), out);
  } else if (kind === 'bush') { const k = 1.1 + ihash(Math.floor(x * 7), Math.floor(z * 7), 11) * 0.35; ell(x, z, y + 0.4 * k, 0.5 * k, 0.42 * k, out); }
}
// Los lugares: la torre, su pared en anillo (por dentro se sube); los demás, las piezas de su modelo
function poi(p, out) {
  if (p.kind === 'torre') {
    const T = TOWER, rw = T.R - 0.22;
    for (let a = 0; a < Math.PI * 2; a += 0.13) if (!(a > T.door[0] && a < T.door[1])) cyl(p.x + Math.sin(a) * rw, p.y + Math.cos(a) * rw, 0.26, 0, T.H + T.parapet, out);
    cyl(p.x, p.y, T.r0, 0, T.H, out);
    return;
  }
  if (p.kind === 'aldea') return;
  for (const b of placeBoxes(partsOf(`poi:${p.kind}${p.snow ? ':snow' : ''}`), p.x, p.y, 0)) box(b, b.y0, b.y1, out);
}
// Lo del pueblo que no va por trozos: los dos árboles del jardín y el puesto, el tablón, la fuente, el buzón, la farola…
const VILLAGE = new WeakMap();
const TALL = { stall: 2.3, stall2: 2.3, stall3: 2.3, board: 2, fountain: 0.9, mailbox: 1.2, lamp: 2.6, sign: 1.6 };
function villageShapes(village, gy) {
  let out = VILLAGE.get(village);
  if (out) return out;
  out = [];
  for (const o of village.objects) {
    if (o.nature) nature({ ...o, kind: o.nature }, gy(o.x, o.y), out);
    else if (TALL[o.model]) { const y = gy(o.x, o.y); if (o.fx) rect(o.fx[0], o.fy[0], o.fx[1], o.fy[1], y, y + TALL[o.model], out); else cyl(o.x, o.y, o.model === 'fountain' ? 1.05 : 0.22, y, y + TALL[o.model], out); }
  }
  VILLAGE.set(village, out);
  return out;
}

// ¿Choca algo que va de o ([x, altura, y]) en la dirección d (de largo 1) antes de len? Devuelve la distancia o null. Lo
// que ya tiene dentro al salir no cuenta (sale de ahí). gy(x, y): la altura del suelo
export function shotHit(scene, o, d, len, gy) {
  const ex = o[0] + d[0] * len, ey = o[2] + d[2] * len;
  const bx0 = Math.min(o[0], ex), bx1 = Math.max(o[0], ex), by0 = Math.min(o[2], ey), by1 = Math.max(o[2], ey);
  const lists = [];
  if (scene.contentFor) {
    for (let cy = Math.floor(by0 / CHUNK); cy <= Math.floor(by1 / CHUNK); cy++) for (let cx = Math.floor(bx0 / CHUNK); cx <= Math.floor(bx1 / CHUNK); cx++) lists.push(shapesOf(scene, scene.contentFor(cx, cy), gy));
    if (scene.village) lists.push(villageShapes(scene.village, gy));
  }
  let best = null;
  for (const list of lists) for (const s of list) {
    if (s.x1 < bx0 || s.x0 > bx1 || s.y1p < by0 || s.y0p > by1) continue;
    const t = s.b ? rayHits(o, d, s.b) : s.c ? hitCyl(o, d, s) : hitEll(o, d, s);
    if (t !== null && t > 1e-6 && t <= len && (best === null || t < best)) best = t;
  }
  return best;
}
// Un rayo contra un cilindro de pie (de y0 a y1): la entrada por el costado, o por arriba o por abajo
function hitCyl(o, d, s) {
  const px = o[0] - s.c[0], pz = o[2] - s.c[1], a = d[0] * d[0] + d[2] * d[2], b = px * d[0] + pz * d[2], c = px * px + pz * pz - s.r * s.r;
  let t0 = 0, t1 = Infinity;
  if (a < 1e-12) { if (c > 0) return null; }
  else {
    const disc = b * b - a * c;
    if (disc < 0) return null;
    const q = Math.sqrt(disc);
    t0 = Math.max(t0, (-b - q) / a); t1 = (-b + q) / a;
    if (t1 < 0) return null;
  }
  if (Math.abs(d[1]) < 1e-9) { if (o[1] < s.y0 || o[1] > s.y1) return null; }
  else { let u = (s.y0 - o[1]) / d[1], v = (s.y1 - o[1]) / d[1]; if (u > v) [u, v] = [v, u]; t0 = Math.max(t0, u); t1 = Math.min(t1, v); }
  return t0 <= t1 ? t0 : null;
}
// Un rayo contra un elipsoide (redondo en el plano, de radio rx, y de alto ry)
function hitEll(o, d, s) {
  const px = (o[0] - s.e[0]) / s.rx, py = (o[1] - s.e[2]) / s.ry, pz = (o[2] - s.e[1]) / s.rx, dx = d[0] / s.rx, dy = d[1] / s.ry, dz = d[2] / s.rx;
  const a = dx * dx + dy * dy + dz * dz, b = px * dx + py * dy + pz * dz, c = px * px + py * py + pz * pz - 1, disc = b * b - a * c;
  if (disc < 0) return null;
  const q = Math.sqrt(disc), t0 = (-b - q) / a, t1 = (-b + q) / a;
  return t1 < 0 ? null : Math.max(0, t0);
}
