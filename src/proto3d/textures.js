// Prototipo 3D: texturas pintadas por código en lienzos (yeso, tablas, tejas, piedra, madera, corteza,
// toldo y el detalle del suelo). Se repiten por metro: los modelos usan coordenadas de textura en metros.
import * as THREE from 'three';

// Azar con semilla (siempre igual)
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex = (c, k = 0) => { const n = parseInt(c.slice(1), 16), f = v => Math.max(0, Math.min(255, Math.round(v * (1 + k)))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };

function make(w, h, draw, { color = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Ruido de motas: n puntos de tamaño s con colores alrededor de base
function speckle(g, w, h, r, base, n, s, spread) {
  for (let i = 0; i < n; i++) { g.fillStyle = hex(base, (r() - 0.5) * spread); g.fillRect(r() * w, r() * h, s, s); }
}

// Yeso claro con manchas suaves
export const plaster = () => make(256, 256, (g, w, h) => {
  const r = rng(1);
  g.fillStyle = '#f6efe2'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 50; i++) { const x = r() * w, y = r() * h, s = 14 + r() * 40, gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, `rgba(${r() < 0.5 ? '228,214,190' : '255,252,244'},0.18)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2); }
  speckle(g, w, h, r, '#efe6d6', 1600, 1, 0.05);
});

// Suelo de tablas: el lienzo son 2 × 2 m, con doce hileras de tablas de largo variado, vetas, nudos y juntas
export const planks = () => make(512, 512, (g, w, h) => {
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
export const roofTiles = color => make(256, 256, (g, w, h) => {
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
export const stone = (base = '#a59e92') => make(256, 256, (g, w, h) => {
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

// Madera para vigas, marcos y muebles: vetas a lo largo
export const wood = (base = '#6a4428') => make(128, 128, (g, w, h) => {
  const r = rng(5);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,220,170'},${0.05 + r() * 0.1})`; g.beginPath(); const y = r() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 8, w * 0.7, y + (r() - 0.5) * 8, w, y); g.stroke(); }
});

// Corteza: vetas verticales oscuras
export const bark = () => make(64, 128, (g, w, h) => {
  const r = rng(6);
  g.fillStyle = '#6b4a30'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) { const x = r() * w; g.fillStyle = `rgba(${r() < 0.6 ? '40,25,15' : '150,110,80'},${0.25 + r() * 0.3})`; g.fillRect(x, 0, 1 + r() * 2, h); }
  for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(40,25,15,.35)'; g.fillRect(r() * w, r() * h, 3 + r() * 5, 1); }
});

// Toldo a rayas
export const awning = () => make(128, 64, (g, w, h) => {
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f6f0e4' : '#d23c3c'; g.fillRect((i * w) / 8, 0, w / 8, h); }
  g.fillStyle = 'rgba(0,0,0,.08)'; for (let i = 0; i < 8; i++) g.fillRect((i * w) / 8, 0, 2, h);
});

// Alfombra: borde rojo oscuro, centro rojo y un rombo dorado
export const rug = () => make(128, 128, (g, w, h) => {
  g.fillStyle = '#7e3030'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#b8503e'; g.fillRect(10, 10, w - 20, h - 20);
  g.strokeStyle = '#e8c070'; g.lineWidth = 3; g.strokeRect(18, 18, w - 36, h - 36);
  g.fillStyle = '#e8c070'; g.beginPath(); g.moveTo(w / 2, 34); g.lineTo(w - 34, h / 2); g.lineTo(w / 2, h - 34); g.lineTo(34, h / 2); g.closePath(); g.fill();
  g.fillStyle = '#7e3030'; g.beginPath(); g.moveTo(w / 2, 50); g.lineTo(w - 50, h / 2); g.lineTo(w / 2, h - 50); g.lineTo(50, h / 2); g.closePath(); g.fill();
  for (let x = 4; x < w; x += 8) { g.fillStyle = '#e8d8b0'; g.fillRect(x, 0, 2, 4); g.fillRect(x, h - 4, 2, 4); }
});

// Papeles del tablón
export const notes = () => make(128, 96, (g, w, h) => {
  const r = rng(9);
  g.fillStyle = '#8a5a34'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    const x = 8 + (i % 3) * 40 + r() * 6, y = 8 + Math.floor(i / 3) * 44 + r() * 4;
    g.fillStyle = ['#f4ecd8', '#fff6c8', '#e8f0ff'][i % 3]; g.fillRect(x, y, 30, 34);
    g.fillStyle = 'rgba(60,50,40,.55)'; for (let l = 0; l < 4; l++) g.fillRect(x + 4, y + 8 + l * 6, 18 + r() * 6, 2);
    g.fillStyle = '#d23c3c'; g.fillRect(x + 13, y + 1, 4, 4);
  }
});

// Detalle del suelo (en gris neutro: multiplica el color del terreno). Hierba: briznas y motas; tierra: piedrecitas
export const grassDetail = () => make(256, 256, (g, w, h) => {
  const r = rng(10);
  g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4200; i++) {
    const x = r() * w, y = r() * h, l = 3 + r() * 5, v = 150 + r() * 105;
    g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - l); g.stroke();
  }
  for (let i = 0; i < 900; i++) { const v = 120 + r() * 60; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * w, r() * h, 2, 2); }
}, { color: false });
export const soilDetail = () => make(256, 256, (g, w, h) => {
  const r = rng(11);
  g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++) { const v = 170 + r() * 85; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
  for (let i = 0; i < 260; i++) {
    const x = r() * w, y = r() * h, s = 2 + r() * 4, v = 150 + r() * 100;
    g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.ellipse(x, y, s, s * 0.7, r() * 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(80,80,80,.5)'; g.beginPath(); g.ellipse(x + 1, y + 1, s, s * 0.7, 0, 0, Math.PI); g.fill();
  }
}, { color: false });
