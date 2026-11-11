// Texturas pintadas por código en lienzos (yeso, tablas, tejas, piedra, madera, corteza,
// toldo y el detalle del suelo). Se repiten por metro: los modelos usan coordenadas de textura en metros. Las que llevan
// foto comparten una sola textura por foto (ver photoTex).
import * as THREE from 'three';
import { PHOTOS, photo, photoNow } from './photos.js';

// Azar con semilla (siempre igual)
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex = (c, k = 0) => { const n = parseInt(c.slice(1), 16), f = v => Math.max(0, Math.min(255, Math.round(v * (1 + k)))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };

// scale: el lienzo, a más resolución con el mismo dibujo (lo que se mira de cerca: cuadros, alfombras, el tablón)
function make(w, h, draw, { color = true, scale = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d');
  if (scale !== 1) g.scale(scale, scale);
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Las que no llevan foto y se piden igual más de una vez (el cuadro del valle, los surcos…): una sola textura en la
// gráfica, y a cada uno una copia (clone) que comparte la imagen, para que cambiar su repetición no toque a los demás
const SMALL = new Map();
const once = (id, fn) => { let t = SMALL.get(id); if (!t) SMALL.set(id, (t = fn())); return t.clone(); };

// ---------- fotos ----------
// Una sola textura de la gráfica por foto, para todas sus variantes: la madera de las vigas, la de los postigos y la de
// los muebles son la misma foto con otro tinte, y antes cada una era una copia teñida de 512² (unos 43 MB de fotos para
// 13 distintas). Ahora el tinte va en el color del material (mat(), en geo.js): la textura es la de la foto tal cual, y el
// material la multiplica por el color medio de su lienzo pintado, que es lo que hacía antes la copia.
// (en lineal, como pinta la gráfica: el factor de cada canal es el que deja la media de la foto teñida igual que la de la
// copia de antes, sacado del histograma de la foto; y donde la copia recortaba en 255, el material recorta igual: ver
// PHOTO_CLAMP en geo.js)
const lin = x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const BASES = new Map(), AVG = new Map();
// La base de una foto: la imagen tal cual (la pizarra, con su contraste rebajado: ver photos.js, prep), o el detalle del
// suelo horneado una vez en gris sobre la media de su lienzo
function sharedBase(key, ph, grey) {
  const id = grey ? `${key}|${grey.avg0.toFixed(2)}|${grey.k}|${grey.aniso}` : key;
  let b = BASES.get(id);
  if (b) return b;
  let src = ph.img;
  if (grey) {
    // (como antes: la media de su lienzo y el contraste de la foto por k; la media de lo que queda, para meanOf)
    const p = PHOTOS[key], c = document.createElement('canvas'), data = new ImageData(ph.w, ph.h), d = data.data, R = ph.red;
    c.width = ph.w; c.height = ph.h;
    let sum = 0;
    for (let i = 0, j = 0; j < R.length; i += 4, j++) { sum += (d[i] = d[i + 1] = d[i + 2] = grey.avg0 + (R[j] - p.mean) * grey.k, d[i]); d[i + 3] = 255; }
    c.getContext('2d').putImageData(data, 0, 0); MEANS.set(c, sum / R.length / 255); src = c;
  }
  const t = new THREE.Texture(src);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = grey?.aniso || 8;   // (la de sus copias: con otra, la gráfica la subiría dos veces)
  t.colorSpace = grey ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.needsUpdate = true;
  BASES.set(id, (b = { t, hist: ph.hist, k: new Map() }));
  return b;
}
// El tinte en lineal de una variante (k: lo que multiplicaba cada canal de la foto en la copia de antes, en sRGB) y si
// alguna parte se recortaba en 255
function tintFor(b, k) {
  const id = k.map(x => x.toFixed(4)).join(',');
  let T = b.k.get(id);
  if (T) return T;
  const K = [0, 0, 0];
  let over = false;
  for (let ch = 0; ch < 3; ch++) {
    const h = b.hist[ch];
    let a = 0, z = 0;
    for (let v = 0; v < 256; v++) if (h[v]) { a += h[v] * lin(v * k[ch] / 255); z += h[v] * lin(v / 255); if (v * k[ch] > 255.5) over = true; }
    K[ch] = z ? a / z : k[ch];
  }
  b.k.set(id, (T = { K, over }));
  return T;
}
// La media de cada canal (de 0 a 255) del lienzo pintado de una variante: su color. Se pinta una vez en memoria (no se
// sube a la gráfica). (a su tamaño: pintado a un cuarto cuesta lo mismo, porque lo que pesa son las llamadas, y la media
// se mueve hasta 1,3/255)
function paintAvg(id, w, h, draw) {
  let a = AVG.get(id);
  if (a) return a;
  const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
  c.width = w; c.height = h;
  draw(g, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  a = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) { a[0] += d[i]; a[1] += d[i + 1]; a[2] += d[i + 2]; }
  for (let j = 0; j < 3; j++) a[j] /= d.length / 4;
  AVG.set(id, a);
  return a;
}
// Las texturas de las fotos que hay ya hechas (una por foto), para subirlas a la gráfica antes de jugar (engine.js, idle)
export const photoBases = () => [...BASES.values()].map(b => b.t);
// La textura de una variante: una copia (clone, la misma imagen en la gráfica) de la base de su foto, con su tinte
// apuntado para mat() y del tamaño que mide la foto de verdad (meters: lo que mide el lienzo pintado). Si la foto aún
// no ha llegado, el lienzo pintado con la foto encima cuando llegue (photoOver): lo de antes
function photoTex(id, key, opts, w, h, draw, mk) {
  const ph = photoNow(key);
  if (!ph) return photoOver(make(w, h, draw, mk), key, opts);
  const avg = paintAvg(id, w, h, draw);
  if (opts.grey) return sharedBase(key, ph, { avg0: avg[0], k: opts.grey, aniso: opts.aniso }).t.clone();
  const p = PHOTOS[key], b = sharedBase(key, ph), t = b.t.clone(), T = tintFor(b, avg.map(a => a / p.mean));
  t.userData.photoTint = T.K;
  if (T.over) t.userData.photoClamp = true;
  // (después del repeat que ponga quien la pide, como cuando la foto llegaba más tarde: se multiplica)
  if (opts.meters) { const sx = opts.meters / p.m[0], sy = opts.meters / p.m[1]; queueMicrotask(() => t.repeat.set(t.repeat.x * sx, t.repeat.y * sy)); }
  return t;
}
// Lo de antes, cuando la foto aún no está: la foto de la clave encima del lienzo cuando llegue, su dibujo
// teñido con el color medio de lo que había pintado, y del tamaño que mide de verdad (meters: lo que mide el lienzo
// pintado; sin él, el tamaño no cambia: el suelo la muestrea a su escala). grey: en gris, sobre la media del lienzo y
// con el contraste por k (el suelo la usa de detalle, dividida por su media de siempre). Correcto, pero cada variante
// es su propia copia en la gráfica
function photoOver(t, key, { meters, grey } = {}) {
  const p = PHOTOS[key], wait = photo(key);
  if (wait) wait.then(img => {
    if (!img) return;
    const was = t.image, old = was.getContext('2d').getImageData(0, 0, was.width, was.height).data, avg = [0, 0, 0];
    for (let i = 0; i < old.length; i += 4) { avg[0] += old[i]; avg[1] += old[i + 1]; avg[2] += old[i + 2]; }
    for (let k = 0; k < 3; k++) avg[k] /= old.length / 4;
    const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
    c.width = img.width; c.height = img.height;
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height), d = data.data;
    if (grey) { let sum = 0; for (let i = 0; i < d.length; i += 4) sum += (d[i] = d[i + 1] = d[i + 2] = avg[0] + (d[i] - p.mean) * grey, d[i]); MEANS.set(c, sum / (d.length / 4) / 255); }
    else { const k = avg.map(a => a / p.mean), soft = p.k ?? 1, m = p.mean * (1 - soft); for (let i = 0; i < d.length; i += 4) { d[i] = (m + d[i] * soft) * k[0]; d[i + 1] = (m + d[i + 1] * soft) * k[1]; d[i + 2] = (m + d[i + 2] * soft) * k[2]; } }
    g.putImageData(data, 0, 0);
    if (meters) t.repeat.set(t.repeat.x * meters / p.m[0], t.repeat.y * meters / p.m[1]);
    // (un lienzo nuevo, de otro tamaño: la textura ya subida a la gráfica tiene su sitio reservado al tamaño de antes, y
    // escribir encima uno mayor da error y puede tumbar el contexto; dispose() la libera y se vuelve a subir entera)
    t.dispose(); t.image = c; t.needsUpdate = true;
  });
  return t;
}

// La media (de 0 a 1, del canal rojo) de lo que tiene ahora una textura en gris: el suelo divide su detalle por ella
// (terrain.js). Una vez por lienzo: la de la foto la apuntan sharedBase o photoOver al hornearla, y la del lienzo pintado se
// mide al pedirla
const MEANS = new WeakMap();
export function meanOf(t) {
  const img = t.image;
  let m = MEANS.get(img);
  if (m === undefined) {
    const d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
    let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i];
    MEANS.set(img, m = sum / (d.length / 4) / 255);
  }
  return m;
}

// Ruido de motas: n puntos de tamaño s con colores alrededor de base
function speckle(g, w, h, r, base, n, s, spread) {
  for (let i = 0; i < n; i++) { g.fillStyle = hex(base, (r() - 0.5) * spread); g.fillRect(r() * w, r() * h, s, s); }
}

// Yeso claro con manchas suaves
export const plaster = () => once('plaster', () => make(256, 256, (g, w, h) => {
  const r = rng(1);
  g.fillStyle = '#f6efe2'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 50; i++) { const x = r() * w, y = r() * h, s = 14 + r() * 40, gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, `rgba(${r() < 0.5 ? '228,214,190' : '255,252,244'},0.18)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2); }
  speckle(g, w, h, r, '#efe6d6', 1600, 1, 0.05);
}));

// Suelo de tablas: el lienzo son 2 × 2 m, con doce hileras de tablas de largo variado, vetas, nudos y juntas
export const planks = () => photoTex('planks', 'entarimado', { meters: 2 }, 512, 512, (g, w, h) => {
  const r = rng(2), rows = 12, ph = h / rows, cols = ['#b8875c', '#b08056', '#bc8c62', '#ad7d52', '#b5845a'];
  for (let k = 0; k < rows; k++) {
    const y = k * ph;
    let x = -r() * w * 0.4;
    while (x < w) {
      const len = w * (0.3 + r() * 0.35), x0 = Math.max(0, x), x1 = Math.min(w, x + len), c = cols[Math.floor(r() * cols.length)];
      // (la tabla que se sale por la derecha sigue por la izquierda: el lienzo se repite sin costura)
      const parts = x + len > w ? [[x0, w], [0, x + len - w]] : [[x0, x1]];
      for (const [a, b] of parts) {
        g.fillStyle = c; g.fillRect(a, y, b - a, ph);
        for (let v = 0; v < 6; v++) { g.strokeStyle = `rgba(90,52,28,${0.06 + r() * 0.08})`; g.lineWidth = 1; g.beginPath(); const yy = y + 3 + r() * (ph - 6); g.moveTo(a, yy); g.bezierCurveTo(a + (b - a) * 0.3, yy + (r() - 0.5) * 4, a + (b - a) * 0.6, yy + (r() - 0.5) * 4, b, yy + (r() - 0.5) * 3); g.stroke(); }
        if (r() < 0.3) { const kx = a + r() * (b - a); g.fillStyle = 'rgba(95,55,28,.35)'; g.beginPath(); g.ellipse(kx, y + ph / 2, 4, 2.2, 0, 0, Math.PI * 2); g.fill(); }
      }
      g.fillStyle = 'rgba(70,40,20,.55)'; g.fillRect((x + len) % w - 1, y, 2, ph);
      x += len;
    }
    g.fillStyle = 'rgba(60,34,18,.6)'; g.fillRect(0, y, w, 2);
    g.fillStyle = 'rgba(255,232,196,.10)'; g.fillRect(0, y + 2, w, 2);
  }
});

// Tejas de barro en filas (una fila cada 25 cm), cada una con su borde redondeado y su sombra
export const roofTiles = (color, photoKey = 'teja') => photoTex(`roof|${color}|${photoKey}`, photoKey, { meters: 1 }, 256, 256, (g, w, h) => {
  const r = rng(3), rows = 4, cols = 6;
  g.fillStyle = hex(color, -0.35); g.fillRect(0, 0, w, h);
  for (let j = 0; j < rows; j++) {
    const y0 = (j * h) / rows, rh = h / rows, off = j % 2 ? w / cols / 2 : 0;
    for (let i = -1; i <= cols; i++) {
      const x0 = i * (w / cols) + off, tw = w / cols, k = (r() - 0.5) * 0.18;
      const gr = g.createLinearGradient(0, y0, 0, y0 + rh);
      gr.addColorStop(0, hex(color, k - 0.18)); gr.addColorStop(0.55, hex(color, k + 0.05)); gr.addColorStop(1, hex(color, k + 0.16));
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x0 + 1, y0); g.lineTo(x0 + tw - 1, y0); g.lineTo(x0 + tw - 1, y0 + rh - 6); g.quadraticCurveTo(x0 + tw / 2, y0 + rh + 4, x0 + 1, y0 + rh - 6); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,240,220,.18)'; g.fillRect(x0 + 3, y0 + 2, 2, rh - 10);
    }
    g.fillStyle = 'rgba(40,10,5,.35)'; g.fillRect(0, y0 + rh - 3, w, 3);
  }
  speckle(g, w, h, r, color, 900, 1, 0.3);
});

// Piedra: sillares irregulares con mortero
export const stone = (base = '#a59e92', photoKey = 'piedra') => photoTex(`stone|${base}`, photoKey, { meters: 1 }, 256, 256, (g, w, h) => {
  const r = rng(4);
  g.fillStyle = '#6e685f'; g.fillRect(0, 0, w, h);
  const rowH = 32;
  for (let y = 0; y < h; y += rowH) {
    let x = (y / rowH) % 2 ? -20 : 0;
    while (x < w) {
      const sw = 36 + r() * 40, k = (r() - 0.5) * 0.25, gr = g.createLinearGradient(0, y, 0, y + rowH);
      gr.addColorStop(0, hex(base, k + 0.1)); gr.addColorStop(1, hex(base, k - 0.12));
      g.fillStyle = gr;
      g.beginPath(); g.roundRect(x + 2, y + 2, sw - 4, rowH - 4, 5); g.fill();
      x += sw;
    }
  }
  speckle(g, w, h, r, base, 1800, 1, 0.35);
});

// La cara de una roca suelta (sin sillares): manchas y motas, con la foto de la roca encima cuando llega
export const rockFace = (base = '#d8d4cc') => photoTex(`rock|${base}`, 'roca', { meters: 1 }, 256, 256, (g, w, h) => {
  const r = rng(9);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) { g.fillStyle = hex(base, (r() - 0.5) * 0.14); g.beginPath(); g.ellipse(r() * w, r() * h, 8 + r() * 30, 6 + r() * 20, r() * 3, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = hex(base, -0.35); g.lineWidth = 1.2;
  for (let i = 0; i < 10; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let j = 0; j < 5; j++) { x += (r() - 0.5) * 50; y += (r() - 0.3) * 30; g.lineTo(x, y); } g.stroke(); }
  speckle(g, w, h, r, base, 2500, 1, 0.4);
});

// Madera para vigas, marcos y muebles: vetas a lo largo
export const wood = (base = '#6a4428') => photoTex(`wood|${base}`, 'madera', { meters: 1 }, 128, 128, (g, w, h) => {
  const r = rng(5);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,220,170'},${0.05 + r() * 0.1})`; g.beginPath(); const y = r() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 8, w * 0.7, y + (r() - 0.5) * 8, w, y); g.stroke(); }
});

// Corteza: vetas verticales oscuras
export const bark = () => photoTex('bark', 'corteza', { meters: 1 }, 64, 128, (g, w, h) => {
  const r = rng(6);
  g.fillStyle = '#6b4a30'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) { const x = r() * w; g.fillStyle = `rgba(${r() < 0.6 ? '40,25,15' : '150,110,80'},${0.25 + r() * 0.3})`; g.fillRect(x, 0, 1 + r() * 2, h); }
  for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(40,25,15,.35)'; g.fillRect(r() * w, r() * h, 3 + r() * 5, 1); }
});

// Toldo a rayas
export const awning = (red = '#d23c3c', white = '#f6f0e4') => once(`awning|${red}|${white}`, () => make(128, 64, (g, w, h) => {
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? white : red; g.fillRect((i * w) / 8, 0, w / 8, h); }
  g.fillStyle = 'rgba(0,0,0,.08)'; for (let i = 0; i < 8; i++) g.fillRect((i * w) / 8, 0, 2, h);
}));

// Alfombra: borde rojo oscuro, centro rojo y un rombo dorado
export const rug = () => once('rug', () => make(128, 128, (g, w, h) => {
  g.fillStyle = '#7e3030'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#b8503e'; g.fillRect(10, 10, w - 20, h - 20);
  g.strokeStyle = '#e8c070'; g.lineWidth = 3; g.strokeRect(18, 18, w - 36, h - 36);
  g.fillStyle = '#e8c070'; g.beginPath(); g.moveTo(w / 2, 34); g.lineTo(w - 34, h / 2); g.lineTo(w / 2, h - 34); g.lineTo(34, h / 2); g.closePath(); g.fill();
  g.fillStyle = '#7e3030'; g.beginPath(); g.moveTo(w / 2, 50); g.lineTo(w - 50, h / 2); g.lineTo(w / 2, h - 50); g.lineTo(50, h / 2); g.closePath(); g.fill();
  for (let x = 4; x < w; x += 8) { g.fillStyle = '#e8d8b0'; g.fillRect(x, 0, 2, 4); g.fillRect(x, h - 4, 2, 4); }
}, { scale: 2 }));

// Las otras alfombras (el dibujo, a lo largo: de arriba abajo del lienzo): persa, de rayas, de rombos y trenzada
// (ovalada: fuera del óvalo, transparente)
export const rugDesign = kind => once('rug|' + kind, () => make(128, 128, (g, w, h) => {
  const fringe = c => { for (let x = 4; x < w; x += 8) { g.fillStyle = c; g.fillRect(x, 0, 2, 5); g.fillRect(x, h - 5, 2, 5); } };
  const diamond = (x, y, rx, ry, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(x, y - ry); g.lineTo(x + rx, y); g.lineTo(x, y + ry); g.lineTo(x - rx, y); g.closePath(); g.fill(); };
  if (kind === 'persa') {
    g.fillStyle = '#8a2a2a'; g.fillRect(0, 5, w, h - 10);
    g.fillStyle = '#f0e0b0'; g.fillRect(8, 13, w - 16, h - 26);
    g.fillStyle = '#2a3a6a'; g.fillRect(11, 16, w - 22, h - 32);
    const r = rng(3);
    g.fillStyle = '#5a6aa0'; for (let i = 0; i < 70; i++) g.fillRect(14 + r() * (w - 28), 19 + r() * (h - 38), 2, 2);
    diamond(w / 2, h / 2, 34, 42, '#c84a3a'); diamond(w / 2, h / 2, 24, 30, '#f0e0b0'); diamond(w / 2, h / 2, 16, 20, '#2a3a6a'); diamond(w / 2, h / 2, 7, 9, '#e8b040');
    for (const [x, y] of [[11, 16], [w - 11, 16], [11, h - 16], [w - 11, h - 16]]) diamond(x, y, 10, 12, '#c84a3a');
    for (let x = 12; x < w - 10; x += 10) { g.fillStyle = '#e8b040'; g.fillRect(x, 8, 4, 3); g.fillRect(x, h - 11, 4, 3); }
    fringe('#f0e0b0');
  } else if (kind === 'rayas') {
    const bands = ['#c8643a', '#e8c060', '#3a6a8a', '#f0e8d8', '#6a8a4a', '#a8442a', '#e8c060', '#3a6a8a'];
    let y = 5;
    for (let i = 0; y < h - 5; i++) {
      const bh = [14, 6, 10, 4, 12, 6][i % 6], c = bands[i % bands.length];
      g.fillStyle = c; g.fillRect(0, y, w, Math.min(bh, h - 5 - y));
      if (bh >= 10) { g.fillStyle = bands[(i + 3) % bands.length]; for (let x = 4; x < w; x += 12) diamond(x, y + bh / 2, 4, bh / 2 - 2, g.fillStyle); }
      y += bh;
    }
    fringe('#f0e8d8');
  } else if (kind === 'rombos') {
    g.fillStyle = '#3a2a24'; g.fillRect(0, 5, w, h - 10);
    g.fillStyle = '#e8dcc0'; g.fillRect(7, 12, w - 14, h - 24);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 4; i++) {
      const x = 22 + i * 28, y = 24 + j * 20, c = (i + j) % 2 ? '#a8442a' : '#3a6a3a';
      diamond(x, y, 12, 9, c); diamond(x, y, 7, 5, '#e8dcc0'); diamond(x, y, 3, 2, c);
    }
    g.fillStyle = '#c8b890'; for (let x = 7; x < w - 7; x += 6) { g.fillRect(x, 12, 3, 3); g.fillRect(x + 3, h - 15, 3, 3); }
    fringe('#e8dcc0');
  } else {
    const rings = ['#8a6a4a', '#c8a070', '#6a8a9a', '#a85a4a', '#e8d0a0', '#6a8a4a', '#c8a070', '#8a6a4a'];
    for (let i = 0; i < rings.length; i++) {
      const rx = 62 - i * 7.6, ry = 62 - i * 7.6;
      g.fillStyle = rings[i]; g.beginPath(); g.ellipse(w / 2, h / 2, rx, ry, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(40, 24, 12, 0.25)'; g.lineWidth = 1.5; g.setLineDash([3, 3]); g.beginPath(); g.ellipse(w / 2, h / 2, rx - 3.8, ry - 3.8, 0, 0, Math.PI * 2); g.stroke();
    }
    g.setLineDash([]);
  }
}, { scale: 2 }));

// Papeles del tablón
export const notes = () => once('notes', () => make(128, 96, (g, w, h) => {
  const r = rng(9);
  g.fillStyle = '#8a5a34'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    const x = 8 + (i % 3) * 40 + r() * 6, y = 8 + Math.floor(i / 3) * 44 + r() * 4;
    g.fillStyle = ['#f4ecd8', '#fff6c8', '#e8f0ff'][i % 3]; g.fillRect(x, y, 30, 34);
    g.fillStyle = 'rgba(60,50,40,.55)'; for (let l = 0; l < 4; l++) g.fillRect(x + 4, y + 8 + l * 6, 18 + r() * 6, 2);
    g.fillStyle = '#d23c3c'; g.fillRect(x + 13, y + 1, 4, 4);
  }
}, { scale: 2 }));

// Detalle del suelo (en gris neutro: multiplica el color del terreno). Hierba: briznas y motas; tierra: piedrecitas
export const grassDetail = () => photoTex('grassD', 'hierba', { grey: 0.8 }, 256, 256, (g, w, h) => {
  const r = rng(10);
  g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4200; i++) {
    const x = r() * w, y = r() * h, l = 3 + r() * 5, v = 150 + r() * 105;
    g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - l); g.stroke();
  }
  for (let i = 0; i < 900; i++) { const v = 120 + r() * 60; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * w, r() * h, 2, 2); }
}, { color: false });
export const soilDetail = () => photoTex('soilD', 'tierra', { grey: 0.8 }, 256, 256, (g, w, h) => {
  const r = rng(11);
  g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++) { const v = 170 + r() * 85; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
  for (let i = 0; i < 260; i++) {
    const x = r() * w, y = r() * h, s = 2 + r() * 4, v = 150 + r() * 100;
    g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.ellipse(x, y, s, s * 0.7, r() * 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(80,80,80,.5)'; g.beginPath(); g.ellipse(x + 1, y + 1, s, s * 0.7, 0, 0, Math.PI); g.fill();
  }
}, { color: false });
// Roca de las cuestas del suelo (terrain.js), en gris: manchas y grietas que bajan; encima, la foto de las rocas (la misma
// que ya se descarga para ellas)
// (con menos anisotropía que las demás: se lee en tres planos, y así cuesta menos en las cuestas)
export const rockDetail = () => { const t = photoTex('rockD', 'roca', { grey: 0.9, aniso: 4 }, 256, 256, (g, w, h) => {
  const r = rng(13);
  g.fillStyle = '#c4c4c4'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 80; i++) { const v = 140 + r() * 100; g.fillStyle = `rgba(${v},${v},${v},.4)`; g.beginPath(); g.ellipse(r() * w, r() * h, 10 + r() * 36, 6 + r() * 18, r() * 3, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(60,60,60,.55)';
  for (let i = 0; i < 14; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 40; y += r() * 24; g.lineTo(x, y); } g.stroke(); }
}, { color: false }); t.anisotropy = 4; return t; };

// Tablas horizontales de una pared de madera (cinco por metro), con juntas y vetas
export const siding = () => photoTex('siding', 'tablas', { meters: 1 }, 256, 256, (g, w, h) => {
  const r = rng(12), rows = 5, rh = h / rows;
  for (let k = 0; k < rows; k++) {
    const y = k * rh;
    g.fillStyle = ['#9a6a40', '#8e6038', '#a47246', '#946640'][k % 4]; g.fillRect(0, y, w, rh);
    for (let v = 0; v < 10; v++) { g.strokeStyle = `rgba(70,40,20,${0.06 + r() * 0.1})`; g.beginPath(); const yy = y + 3 + r() * (rh - 6); g.moveTo(0, yy); g.bezierCurveTo(w * 0.3, yy + (r() - 0.5) * 5, w * 0.7, yy + (r() - 0.5) * 5, w, yy); g.stroke(); }
    g.fillStyle = 'rgba(40,22,10,.75)'; g.fillRect(0, y + rh - 4, w, 4);
    g.fillStyle = 'rgba(255,225,180,.14)'; g.fillRect(0, y, w, 2);
    if (r() < 0.6) { g.fillStyle = 'rgba(40,22,10,.6)'; g.fillRect(Math.floor(r() * w), y, 2, rh); }
  }
});

// Losas de piedra para el suelo (cuatro por metro, a tresbolillo)
export const flagstone = () => photoTex('flag', 'losa', { meters: 1 }, 256, 256, (g, w, h) => {
  const r = rng(13), n = 4, s = w / n;
  g.fillStyle = '#5e5850'; g.fillRect(0, 0, w, h);
  for (let j = 0; j < n; j++) for (let i = -1; i < n; i++) {
    const x = i * s + (j % 2 ? s / 2 : 0), y = j * s, k = (r() - 0.5) * 0.18;
    g.fillStyle = hex('#9a958a', k); g.beginPath(); g.roundRect(x + 2, y + 2, s - 4, s - 4, 4); g.fill();
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x + 4, y + 4, s - 10, 3);
  }
  speckle(g, w, h, r, '#9a958a', 1200, 1, 0.3);
});

// Grava del camino: piedrecitas sobre tierra
export const gravel = () => photoTex('gravel', 'grava', { meters: 1 }, 256, 256, (g, w, h) => {
  const r = rng(14);
  g.fillStyle = '#b8a07a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const x = r() * w, y = r() * h, s = 2 + r() * 5;
    g.fillStyle = hex(['#a8a296', '#8e887c', '#c4bcae', '#9a8a70'][Math.floor(r() * 4)], (r() - 0.5) * 0.2);
    g.beginPath(); g.ellipse(x, y, s, s * 0.7, r() * 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(40,30,20,.25)'; g.beginPath(); g.ellipse(x + 1, y + 1.5, s, s * 0.5, 0, 0, Math.PI); g.fill();
  }
});

// Paja de un tejado: manojos en filas, cuesta abajo
export const thatch = () => photoTex('thatch', 'paja', { meters: 1 }, 256, 256, (g, w, h) => {
  const r = rng(15);
  g.fillStyle = '#b8903e'; g.fillRect(0, 0, w, h);
  for (let row = 0; row < 4; row++) {
    const y0 = (row * h) / 4;
    for (let i = 0; i < 500; i++) { const x = r() * w, y = y0 + r() * (h / 4); g.strokeStyle = hex(['#d8b060', '#c49a48', '#e8c878', '#a88438'][Math.floor(r() * 4)], (r() - 0.5) * 0.2); g.lineWidth = 1 + r(); g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y + 10 + r() * 14); g.stroke(); }
    g.fillStyle = 'rgba(60,40,10,.35)'; g.fillRect(0, y0 + h / 4 - 4, w, 4);
  }
});

// Tierra labrada: surcos oscuros y húmedos
export const furrows = () => once('furrows', () => make(128, 128, (g, w, h) => {
  const r = rng(16);
  g.fillStyle = '#6a4a30'; g.fillRect(0, 0, w, h);
  for (let k = 0; k < 4; k++) {
    const y = (k * h) / 4;
    const gr = g.createLinearGradient(0, y, 0, y + h / 4); gr.addColorStop(0, '#5a3c24'); gr.addColorStop(0.5, '#8a6440'); gr.addColorStop(1, '#4a3020');
    g.fillStyle = gr; g.fillRect(0, y, w, h / 4);
  }
  speckle(g, w, h, r, '#6a4a30', 700, 2, 0.4);
}));

// Los cuadros (128 × 96, pintados al doble: se miran de cerca): el valle, el mar al atardecer, un jarrón de flores y el pueblo de noche
export function artwork(kind) {
  return once('art|' + kind, () => make(128, 96, (g, w, h) => {
    const path = pts => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) p.length > 2 ? g.quadraticCurveTo(...p) : g.lineTo(...p); g.fill(); };
    const disc = (x, y, r, c, a0 = 0, a1 = Math.PI * 2) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, a0, a1); g.fill(); };
    if (kind === 'valle') {
      const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#6eb6e4'); sky.addColorStop(1, '#e4f2f8');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      disc(96, 24, 10, '#ffe08a');
      g.fillStyle = '#8fb0c8'; path([[0, 60], [30, 30], [52, 50], [76, 26], [128, 62], [128, 96], [0, 96]]);
      g.fillStyle = '#5aa842'; path([[0, 66], [40, 46, 80, 62], [106, 70, 128, 56], [128, 96], [0, 96]]);
      g.fillStyle = '#3f8030'; path([[0, 80], [64, 64, 128, 82], [128, 96], [0, 96]]);
    } else if (kind === 'mar') {
      const sky = g.createLinearGradient(0, 0, 0, 52); sky.addColorStop(0, '#7a8ac8'); sky.addColorStop(0.55, '#f4a87a'); sky.addColorStop(1, '#ffd89a');
      g.fillStyle = sky; g.fillRect(0, 0, w, 52);
      disc(64, 52, 14, '#ffe9a8', Math.PI, 0);
      const sea = g.createLinearGradient(0, 52, 0, h); sea.addColorStop(0, '#3a7ab8'); sea.addColorStop(1, '#1a3a6a');
      g.fillStyle = sea; g.fillRect(0, 52, w, h - 52);
      g.fillStyle = 'rgba(255, 220, 150, 0.55)';
      for (let i = 0; i < 6; i++) g.fillRect(52 + i * 2, 55 + i * 6, 24 - i * 4, 2);
      g.strokeStyle = 'rgba(200, 230, 255, 0.5)'; g.lineWidth = 1.5;
      for (let i = 0; i < 10; i++) { const y = 60 + (i % 5) * 7, x = (i * 37) % 118; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 5, y - 3, x + 10, y); g.stroke(); }
      g.fillStyle = '#5a3a24'; path([[24, 60], [50, 60], [46, 66], [28, 66]]);
      g.fillStyle = '#3a2a1e'; g.fillRect(36.5, 32, 1.5, 28);
      g.fillStyle = '#f8f2e4'; path([[39, 34], [39, 58], [52, 58]]); path([[35.5, 39], [35.5, 58], [26, 58]]);
      g.strokeStyle = '#3a3a5a'; g.lineWidth = 1.2;
      for (const [x, y] of [[90, 18], [101, 24], [83, 27]]) { g.beginPath(); g.moveTo(x - 4, y); g.quadraticCurveTo(x - 2, y - 3, x, y); g.quadraticCurveTo(x + 2, y - 3, x + 4, y); g.stroke(); }
    } else if (kind === 'flores') {
      const bg = g.createRadialGradient(64, 40, 8, 64, 48, 90); bg.addColorStop(0, '#6a5040'); bg.addColorStop(1, '#2a1e18');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = '#8a5a34'; g.fillRect(0, 76, w, 20); g.fillStyle = '#6a4228'; g.fillRect(0, 76, w, 3);
      const flowers = [[40, 24, '#e83a4a'], [58, 14, '#f0d040'], [78, 17, '#f4f0e8'], [93, 30, '#e88aa8'], [49, 37, '#f08a2a'], [72, 33, '#b48aff'], [86, 46, '#e83a4a'], [36, 45, '#f4f0e8']];
      g.strokeStyle = '#3f7a2e'; g.lineWidth = 2;
      for (const [x, y] of flowers) { g.beginPath(); g.moveTo(64, 54); g.quadraticCurveTo((64 + x) / 2, y + 14, x, y); g.stroke(); }
      g.fillStyle = '#4f9a3a';
      for (const [x, y, a] of [[52, 46, -0.6], [76, 44, 0.6], [60, 30, -0.3], [84, 36, 0.9]]) { g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
      for (const [x, y, c] of flowers) { for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; disc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3.5, c); } disc(x, y, 2.5, '#f0c040'); }
      g.fillStyle = '#4a7ab8'; path([[54, 50], [42, 64, 52, 80], [76, 80], [86, 64, 74, 50]]);
      g.fillStyle = '#6a9ad8'; g.fillRect(55, 56, 3, 18);
      disc(100, 80, 6, '#c83a32'); g.fillStyle = '#5a3a24'; g.fillRect(99.5, 72, 1.5, 3);
    } else {
      const sky = g.createLinearGradient(0, 0, 0, 70); sky.addColorStop(0, '#0e1638'); sky.addColorStop(1, '#2a3a6a');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      const r = rng(7);
      g.fillStyle = '#f8f0c0';
      for (let i = 0; i < 42; i++) { const s = r() < 0.2 ? 2 : 1; g.fillRect(r() * w, r() * 54, s, s); }
      disc(98, 20, 10, '#f8f0c0'); disc(103, 17, 9, '#131c42');
      g.fillStyle = '#1a2a3a'; path([[0, 62], [40, 44, 80, 58], [108, 66, 128, 54], [128, 96], [0, 96]]);
      for (const [x, wd, ht] of [[20, 16, 14], [43, 14, 11], [68, 18, 16], [95, 14, 12]]) {
        const y = 76;
        g.fillStyle = '#2a2a3a'; g.fillRect(x, y - ht, wd, ht);
        g.fillStyle = '#3a2028'; path([[x - 2, y - ht], [x + wd / 2, y - ht - 8], [x + wd + 2, y - ht]]);
        g.fillStyle = '#ffd070'; g.fillRect(x + wd / 2 - 2, y - ht + 4, 4, 4);
      }
      g.fillStyle = '#121c28'; g.fillRect(0, 76, w, 20);
    }
  }, { scale: 2 }));
}
