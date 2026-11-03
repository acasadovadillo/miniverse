// Colisiones en el plano del suelo: círculos {x, y, r}, elipses {x, y, rx, ry} y cajas {x0, y0, x1, y1}.
import { clamp } from './util.js';
import { pushOut } from './world/fit.js';

export function collide(p, list, radius) {
  for (const c of list) {
    if (c.obb) { pushOut(p, c.obb, radius); continue; }   // (lo colocado libre, girado)
    if (c.rx) {
      const dx = (p.x - c.x) / (c.rx + radius), dy = (p.y - c.y) / (c.ry + radius), d = Math.hypot(dx, dy);
      if (d < 1 && d > 1e-6) { p.x = c.x + (dx / d) * (c.rx + radius); p.y = c.y + (dy / d) * (c.ry + radius); }
    } else if (c.r !== undefined) {
      const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy), m = radius + c.r;
      if (d < m && d > 1e-6) { p.x = c.x + (dx / d) * m; p.y = c.y + (dy / d) * m; }
    } else {
      const cx = clamp(p.x, c.x0, c.x1), cy = clamp(p.y, c.y0, c.y1), dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
      if (d >= radius) continue;
      if (d > 1e-6) { p.x = cx + (dx / d) * radius; p.y = cy + (dy / d) * radius; continue; }
      const l = p.x - c.x0, r = c.x1 - p.x, t = p.y - c.y0, b = c.y1 - p.y, m = Math.min(l, r, t, b);
      if (m === l) p.x = c.x0 - radius; else if (m === r) p.x = c.x1 + radius; else if (m === t) p.y = c.y0 - radius; else p.y = c.y1 + radius;
    }
  }
}
