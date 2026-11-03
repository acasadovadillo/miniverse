// Colocar libre: lo que se pone en el mundo va donde se apunte y con el giro que se quiera (no por casillas).
// Cada cosa ocupa unas cajas (las de su modelo en 3D, con su altura): no se puede poner si alguna corta un muro
// u otra cosa a la misma altura (así una silla entra bajo una mesa, pero un sofá no).
//
// En el plano, una caja girada es { x, y, hx, hy, ux, uy, vx, vy }: su centro, sus medios lados y sus dos ejes
// (u, el ancho del modelo, x+; v, su fondo, z+, hacia donde mira). Con alturas, además { y0, y1 }.

// Las cajas de cada modelo en sus coordenadas ([x0, y0, z0, x1, y1, z1]): las pone el dibujo al cargar
export const SOLIDS = { of: null };
const FALLBACK = [[-0.45, 0, -0.45, 0.45, 1, 0.45]];
export const solidsOf = name => SOLIDS.of?.(name) || FALLBACK;

// Hacia dónde mira (el frente del modelo, z+) y hacia dónde queda su derecha (x+) con un giro: 0, +y; π/2, +x
export const dirOf = a => [Math.sin(a), Math.cos(a)], sideOf = a => [Math.cos(a), -Math.sin(a)];

export function obb(x, y, hx, hy, a = 0) {
  const [ux, uy] = sideOf(a), [vx, vy] = dirOf(a);
  return { x, y, hx, hy, ux, uy, vx, vy };
}
export const aabb = (x0, y0, x1, y1) => ({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, ux: 1, uy: 0, vx: 0, vy: 1 });
// La caja que la envuelve, alineada con los ejes
export function bounds(b) {
  const ex = Math.abs(b.ux) * b.hx + Math.abs(b.vx) * b.hy, ey = Math.abs(b.uy) * b.hx + Math.abs(b.vy) * b.hy;
  return { x0: b.x - ex, y0: b.y - ey, x1: b.x + ex, y1: b.y + ey };
}

// Las cajas de un modelo puesto en (ox, oy) con giro a: en el mundo, con sus alturas
export function placeBoxes(local, ox, oy, a) {
  const [ux, uy] = sideOf(a), [vx, vy] = dirOf(a);
  return local.map(([x0, y0, z0, x1, y1, z1]) => {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    return { x: ox + ux * cx + vx * cz, y: oy + uy * cx + vy * cz, hx: (x1 - x0) / 2, hy: (z1 - z0) / 2, ux, uy, vx, vy, y0, y1 };
  });
}
// Lo que ocupa en el plano todo el modelo (la caja que envuelve todas las suyas, en sus coordenadas)
export function hull(local) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const s of local) for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i], s[i]); b[i + 3] = Math.max(b[i + 3], s[i + 3]); }
  return b;
}

// ¿Se cortan dos cajas en el plano? null si no; si sí, hacia dónde empujar A para sacarla (n) y cuánto (depth)
export function sat(A, B) {
  let best = null;
  for (const [nx, ny] of [[A.ux, A.uy], [A.vx, A.vy], [B.ux, B.uy], [B.vx, B.vy]]) {
    const ra = A.hx * Math.abs(A.ux * nx + A.uy * ny) + A.hy * Math.abs(A.vx * nx + A.vy * ny);
    const rb = B.hx * Math.abs(B.ux * nx + B.uy * ny) + B.hy * Math.abs(B.vx * nx + B.vy * ny);
    const d = (A.x - B.x) * nx + (A.y - B.y) * ny, depth = ra + rb - Math.abs(d);
    if (depth <= 0) return null;
    if (!best || depth < best.depth) best = { nx: d < 0 ? -nx : nx, ny: d < 0 ? -ny : ny, depth };
  }
  return best;
}
// ¿Corta la caja A un círculo (un tronco, una persona)?
export function hitsCircle(A, cx, cy, r) {
  const dx = cx - A.x, dy = cy - A.y, u = dx * A.ux + dy * A.uy, v = dx * A.vx + dy * A.vy;
  const qu = Math.max(-A.hx, Math.min(A.hx, u)), qv = Math.max(-A.hy, Math.min(A.hy, v));
  return Math.hypot(u - qu, v - qv) < r;
}
// Distancia de un punto a una caja (0 si está dentro)
export function distTo(A, px, py) {
  const dx = px - A.x, dy = py - A.y, u = dx * A.ux + dy * A.uy, v = dx * A.vx + dy * A.vy;
  return Math.hypot(Math.max(0, Math.abs(u) - A.hx), Math.max(0, Math.abs(v) - A.hy));
}
// ¿A qué distancia corta un rayo (o: origen; d: dirección; los dos [x, altura, y]) una caja girada con alturas? null
// si no la corta
export function rayHits(o, d, b) {
  const px = o[0] - b.x, py = o[2] - b.y;
  let t0 = 0, t1 = Infinity;
  for (const [s, ds, lo, hi] of [[px * b.ux + py * b.uy, d[0] * b.ux + d[2] * b.uy, -b.hx, b.hx], [px * b.vx + py * b.vy, d[0] * b.vx + d[2] * b.vy, -b.hy, b.hy], [o[1], d[1], b.y0, b.y1]]) {
    if (Math.abs(ds) < 1e-9) { if (s < lo || s > hi) return null; continue; }
    let a = (lo - s) / ds, c = (hi - s) / ds;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}
// Sacar a una persona (un círculo en p) de una caja girada
export function pushOut(p, A, r) {
  const dx = p.x - A.x, dy = p.y - A.y, u = dx * A.ux + dy * A.uy, v = dx * A.vx + dy * A.vy;
  const qu = Math.max(-A.hx, Math.min(A.hx, u)), qv = Math.max(-A.hy, Math.min(A.hy, v)), du = u - qu, dv = v - qv, d = Math.hypot(du, dv);
  if (d >= r) return;
  let nu, nv;
  if (d > 1e-6) { nu = qu + (du / d) * r; nv = qv + (dv / d) * r; }
  else {   // (dentro: por el lado más cercano)
    const left = A.hx - Math.abs(u), back = A.hy - Math.abs(v);
    if (left < back) { nu = Math.sign(u || 1) * (A.hx + r); nv = v; } else { nu = u; nv = Math.sign(v || 1) * (A.hy + r); }
  }
  p.x = A.x + A.ux * nu + A.vx * nv; p.y = A.y + A.uy * nu + A.vy * nv;
}
