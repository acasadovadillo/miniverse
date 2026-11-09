// Las caras pintadas: ojos (con su forma, iris en degradado, pupila, brillos y pestañas), cejas, boca y
// colorete, dibujados en un lienzo que se pega en la parte delantera de la cabeza. Hay dos dibujos por cara:
// con los ojos abiertos y cerrados (para parpadear). La nariz, las orejas y la barba siguen siendo piezas.
//
// La cabeza es una esfera de radio 0.29, achatada a 0.96 en alto y en fondo. El lienzo cubre solo la cara
// (45° a cada lado y arriba y abajo del centro), y lo de fuera se rellena con el color de la piel.
import * as THREE from 'three';
import { mat } from './geo.js';
import { sobrio } from '../arte.js';

const R = 0.29, SQ = 0.96, SIZE = 512;
const shade = (c, k) => '#' + new THREE.Color(c).multiplyScalar(k).getHexString();
const mix = (a, b, k) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
const cache = new Map();
export const CLOSED = new WeakMap();   // material con los ojos abiertos → el de los ojos cerrados

// De un punto de la cara (x, y como en la cabeza: x a la derecha del personaje mirando de frente, y hacia
// arriba) a su píxel en el lienzo
function px(x, y) {
  const py = y / SQ, z = Math.sqrt(Math.max(1e-6, R * R - x * x - py * py));
  const lon = Math.atan2(x, z), lat = Math.asin(Math.max(-1, Math.min(1, py / R)));
  const u = 0.25 + lon / (2 * Math.PI), v = 0.5 + lat / Math.PI;
  return [(u - 0.125) * 4 * SIZE, (1 - (v - 0.25) * 2) * SIZE];
}
const K = SIZE * 4 / (2 * Math.PI * R);   // píxeles por unidad, cerca del centro de la cara

export function faceMaterials(L) {
  const key = ['skin', 'eyes', 'eyeStyle', 'brows', 'hair', 'cheeks', 'sex', 'mouth'].map(k => L[k]).join('|');
  if (cache.has(key)) return cache.get(key);
  // (los colores apagados con sobrio(), como los del cuerpo)
  const S = { ...L, skin: sobrio(L.skin, 'piel'), eyes: sobrio(L.eyes), hair: sobrio(L.hair) };
  const open = material(draw(S, false)), closed = material(draw(S, true));
  CLOSED.set(open, closed);
  cache.set(key, open);
  return open;
}
function material(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(4, 2); t.offset.set(-0.5, -0.5);
  t.anisotropy = 4;
  return mat({ map: t, roughness: 0.72 });
}

function draw(L, shut) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  g.fillStyle = L.skin; g.fillRect(0, 0, SIZE, SIZE);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const girl = L.sex === 'chica', ink = '#2a1a1a';
  // Colorete: suave siempre, más con mofletes
  for (const s of [-1, 1]) {
    const [cx, cy] = px(s * 0.142, -0.075), r = 0.05 * K;
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, mix(L.skin, '#ff6a7a', L.cheeks ? 0.45 : 0.18)); grd.addColorStop(1, L.skin);
    g.fillStyle = grd; g.beginPath(); g.ellipse(cx, cy, r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
  }
  for (const s of [-1, 1]) {
    const [cx, cy] = px(s * 0.1, -0.002);
    eye(g, cx, cy, s, L, shut, ink, girl);
    brow(g, s, L);
  }
  mouth(g, L.mouth || 'sonrisa', girl);
  return c;
}

// Un ojo en (cx, cy), del lado s (-1 izquierda, 1 derecha). Los estilos: redondos, almendrados, con pestañas,
// entornados y pequeños; cerrado, una raya curva (con pestañas si las tiene)
function eye(g, cx, cy, s, L, shut, ink, girl) {
  const st = L.eyeStyle, k = K;
  const big = st === 'redondos' || st === 'pestanas', rx = (st === 'pequenos' ? 0.032 : st === 'almendrados' ? 0.064 : 0.058) * k, ry = (st === 'pequenos' ? 0.042 : st === 'almendrados' ? 0.045 : st === 'entornados' ? 0.056 : 0.071) * k;
  g.save();
  if (shut) {
    g.strokeStyle = ink; g.lineWidth = 0.011 * k;
    g.beginPath(); g.moveTo(cx - rx, cy); g.quadraticCurveTo(cx, cy + ry * 0.55, cx + rx, cy); g.stroke();
    if (st === 'pestanas' || girl) lashes(g, cx + s * rx * 0.85, cy + ry * 0.05, s, k, ink, 0.6);
    g.restore();
    return;
  }
  if (st === 'pequenos') {
    g.fillStyle = shade(L.eyes, 0.5); g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(cx + rx * 0.35, cy - ry * 0.4, rx * 0.32, rx * 0.32, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    return;
  }
  // La forma del ojo (lo blanco) y, dentro, el iris y la pupila
  const shape = () => {
    g.beginPath();
    if (st === 'almendrados') {
      const t = -s * 0.18;   // un poco hacia arriba por fuera
      g.moveTo(cx - rx, cy + Math.sin(t) * rx * -s); g.bezierCurveTo(cx - rx * 0.5, cy - ry * 1.25, cx + rx * 0.5, cy - ry * 1.25, cx + rx, cy - Math.sin(t) * rx * -s);
      g.bezierCurveTo(cx + rx * 0.5, cy + ry * 1.05, cx - rx * 0.5, cy + ry * 1.05, cx - rx, cy + Math.sin(t) * rx * -s);
    } else g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  };
  shape();
  const sclera = g.createLinearGradient(0, cy - ry, 0, cy + ry);
  sclera.addColorStop(0, '#d8d0d4'); sclera.addColorStop(0.35, '#ffffff'); sclera.addColorStop(1, '#f4f0ee');
  g.fillStyle = sclera; g.fill();
  g.save(); shape(); g.clip();
  const ix = cx - s * rx * 0.05, iy = cy + ry * (st === 'entornados' ? 0.2 : 0.08), ir = (big ? 0.042 : 0.037) * K, iry = ir * (big ? 1.28 : 1.12);
  const iris = g.createRadialGradient(ix, iy + iry * 0.35, ir * 0.1, ix, iy, iry);
  iris.addColorStop(0, mix(L.eyes, '#ffffff', 0.35)); iris.addColorStop(0.55, L.eyes); iris.addColorStop(1, shade(L.eyes, 0.45));
  g.fillStyle = iris; g.beginPath(); g.ellipse(ix, iy, ir, iry, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = shade(L.eyes, 0.35); g.lineWidth = 0.004 * K; g.stroke();
  g.fillStyle = '#100a0a'; g.beginPath(); g.ellipse(ix, iy, ir * 0.48, iry * 0.5, 0, 0, Math.PI * 2); g.fill();
  // La sombra del párpado sobre el ojo
  const lidShadow = g.createLinearGradient(0, cy - ry, 0, cy - ry * 0.3);
  lidShadow.addColorStop(0, 'rgba(60,30,30,0.35)'); lidShadow.addColorStop(1, 'rgba(60,30,30,0)');
  g.fillStyle = lidShadow; g.fillRect(cx - rx, cy - ry, rx * 2, ry * 0.7);
  if (st === 'entornados') { g.fillStyle = shade(L.skin, 0.96); g.fillRect(cx - rx * 1.2, cy - ry * 1.2, rx * 2.4, ry * 0.75); }
  g.restore();
  // Brillos
  g.fillStyle = '#ffffff';
  g.beginPath(); g.ellipse(ix + s * 0 + ir * 0.42, iy - iry * 0.42, ir * 0.36, ir * 0.36, 0, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 0.8; g.beginPath(); g.ellipse(ix - ir * 0.38, iy + iry * 0.45, ir * 0.15, ir * 0.15, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  // Raya de las pestañas (arriba, más gruesa) y, abajo, una más fina
  g.strokeStyle = ink;
  const top = st === 'entornados' ? cy - ry * 0.45 : null;
  g.lineWidth = (st === 'pestanas' ? 0.013 : 0.01) * k;
  g.beginPath();
  if (top !== null) { g.moveTo(cx - rx * 1.02, top + ry * 0.12); g.quadraticCurveTo(cx, top - ry * 0.12, cx + rx * 1.02, top + ry * 0.12); }
  else if (st === 'almendrados') { const t = -s * 0.18; g.moveTo(cx - rx, cy + Math.sin(t) * rx * -s); g.bezierCurveTo(cx - rx * 0.5, cy - ry * 1.25, cx + rx * 0.5, cy - ry * 1.25, cx + rx, cy - Math.sin(t) * rx * -s); }
  else g.ellipse(cx, cy, rx * 1.02, ry * 1.02, 0, Math.PI * 1.08, Math.PI * 1.92);
  g.stroke();
  if (st === 'pestanas' || girl) lashes(g, cx + s * rx * 0.92, cy - ry * 0.55, s, k, ink, st === 'pestanas' ? 1 : 0.6);
  g.lineWidth = 0.004 * k; g.globalAlpha = 0.55;
  g.beginPath(); g.ellipse(cx, cy, rx * 0.98, ry * 1.0, 0, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
  g.globalAlpha = 1;
  g.restore();
}
// Pestañas por el lado de fuera del ojo
function lashes(g, x, y, s, k, ink, size) {
  g.strokeStyle = ink; g.lineWidth = 0.006 * k;
  for (let i = 0; i < 3; i++) {
    const a = -0.9 + i * 0.45, l = (0.022 - i * 0.004) * k * size;
    g.beginPath(); g.moveTo(x - s * i * 0.012 * k, y + i * 0.01 * k); g.lineTo(x - s * i * 0.012 * k + s * Math.cos(a) * l, y + i * 0.01 * k + Math.sin(a) * l); g.stroke();
  }
}
// Cejas: finas, rectas, gruesas, arqueadas o pobladas, del color del pelo algo más oscuro
function brow(g, s, L) {
  const b = L.brows, col = shade(L.hair, 0.78), [x0, y0] = px(s * 0.06, 0.098), [x1, y1] = px(s * 0.135, 0.106), [xm, ym] = px(s * 0.098, 0.118);
  g.strokeStyle = col; g.fillStyle = col;
  if (b === 'pobladas') {
    for (let i = 0; i < 7; i++) {
      const t = i / 6, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * 0.01 * K;
      g.lineWidth = 0.009 * K; g.beginPath(); g.moveTo(x, y + 0.008 * K); g.lineTo(x + s * 0.008 * K, y - 0.01 * K); g.stroke();
    }
    return;
  }
  const w = { finas: 0.0075, rectas: 0.012, gruesas: 0.018, arqueadas: 0.009 }[b] || 0.01;
  g.lineWidth = w * K;
  g.beginPath(); g.moveTo(x0, y0 + (b === 'rectas' || b === 'gruesas' ? -0.004 * K : 0));
  g.quadraticCurveTo(xm, ym - (b === 'arqueadas' ? 0.018 : b === 'finas' ? 0.008 : 0.002) * K, x1, y1);
  g.stroke();
}

// La boca: sonrisa, riendo (abierta, con dientes y lengua), seria, pícara (de medio lado), sorprendida (una o)
// o sacando la lengua. Ellas, con los labios algo más llenos
function mouth(g, st, girl) {
  const [mx, my] = px(0, -0.118), w = 0.034 * K, ink = girl ? '#b8405a' : '#7a3030', dark = '#4a1a20';
  g.strokeStyle = ink; g.lineWidth = 0.009 * K; g.lineCap = 'round';
  const lips = () => { if (girl) { g.fillStyle = '#d86a84'; g.beginPath(); g.ellipse(mx, my + 0.011 * K, w * 0.45, 0.007 * K, 0, 0, Math.PI * 2); g.fill(); } };
  if (st === 'abierta' || st === 'lengua') {
    // Media luna abierta: oscuro dentro, los dientes arriba y la lengua abajo
    const h = (st === 'abierta' ? 0.038 : 0.024) * K, w = (st === 'abierta' ? 0.042 : 0.036) * K;
    g.beginPath(); g.moveTo(mx - w, my - 0.006 * K); g.quadraticCurveTo(mx, my + h * 1.6, mx + w, my - 0.006 * K); g.closePath();
    g.fillStyle = dark; g.fill();
    g.save(); g.clip();
    g.fillStyle = '#fbf6ee'; g.fillRect(mx - w, my - 0.008 * K, w * 2, 0.008 * K);
    g.fillStyle = '#e86a7a'; g.beginPath(); g.ellipse(mx, my + h * 0.95, w * 0.55, h * 0.55, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    g.lineWidth = 0.006 * K; g.beginPath(); g.moveTo(mx - w, my - 0.006 * K); g.quadraticCurveTo(mx, my + h * 1.6, mx + w, my - 0.006 * K); g.closePath(); g.stroke();
    if (st === 'lengua') { g.fillStyle = '#e86a7a'; g.beginPath(); g.ellipse(mx + w * 0.25, my + h * 1.15, w * 0.32, h * 0.85, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#c84a5a'; g.lineWidth = 0.003 * K; g.beginPath(); g.moveTo(mx + w * 0.25, my + h * 0.7); g.lineTo(mx + w * 0.25, my + h * 1.6); g.stroke(); }
    return;
  }
  if (st === 'seria') { g.beginPath(); g.moveTo(mx - w * 0.8, my + 0.002 * K); g.lineTo(mx + w * 0.8, my + 0.002 * K); g.stroke(); lips(); return; }
  if (st === 'picara') { g.beginPath(); g.moveTo(mx - w * 0.9, my + 0.004 * K); g.quadraticCurveTo(mx + w * 0.2, my + 0.014 * K, mx + w, my - 0.014 * K); g.stroke(); lips(); return; }
  if (st === 'sorpresa') { g.fillStyle = dark; g.beginPath(); g.ellipse(mx, my + 0.006 * K, w * 0.36, w * 0.46, 0, 0, Math.PI * 2); g.fill(); g.lineWidth = 0.005 * K; g.stroke(); return; }
  g.beginPath(); g.moveTo(mx - w, my - 0.006 * K); g.quadraticCurveTo(mx, my + 0.018 * K, mx + w, my - 0.006 * K); g.stroke();
  lips();
}
