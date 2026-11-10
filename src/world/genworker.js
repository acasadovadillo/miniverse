// El hilo aparte que calcula el suelo (ver ground.js): las alturas de cada bloque de terreno, los biomas de sus
// casillas y los píxeles de la textura de cada trozo. El juego le pide los trabajos (terrain.js) con una prioridad
// (lo más cercano a la cámara, antes) y le avisa de los que ya no hacen falta; él los va haciendo de uno en uno y
// devuelve los números, sin copiarlos (transferidos). Así el hilo del juego no se para al estrenar terreno.
import { WorldGen } from './gen.js';
import { setProjects, setFamilyHouse } from './village.js';
import { blockHeights, blockColors, paintPixels, BLOCK } from './ground.js';

let gen = null;
const queue = [];   // trabajos pendientes: { t: 'block' | 'paint', id, pri, … }
let pumping = false;

onmessage = e => {
  const m = e.data;
  if (m.t === 'init') { gen = new WorldGen(m.seed); setProjects(m.projects); setFamilyHouse(m.family); }
  else if (m.t === 'village') { setProjects(m.projects); setFamilyHouse(m.family); gen?.fields.clear(); }
  else if (m.t === 'block' || m.t === 'paint') { queue.push(m); pump(); }
  else if (m.t === 'drop') { const ids = new Set(m.ids); for (let i = queue.length - 1; i >= 0; i--) if (ids.has(queue[i].id)) queue.splice(i, 1); }
};

// Un trabajo cada vez, dejando entre uno y otro que lleguen mensajes (para quitar trabajos o cambiar prioridades)
function pump() { if (!pumping) { pumping = true; setTimeout(step, 0); } }
function step() {
  if (!queue.length || !gen) { pumping = false; return; }
  queue.sort((a, b) => a.pri - b.pri);
  const m = queue.shift();
  if (m.t === 'block') {
    const { heights, water, corners, centers, n, m: mm } = blockHeights(gen, m.bx, m.bz), colors = blockColors(gen, m.bx, m.bz, m.season);
    postMessage({ t: 'block', id: m.id, bx: m.bx, bz: m.bz, heights, water, corners, m: mm, centers, w: BLOCK, n, colors }, [heights.buffer, corners.buffer, centers.buffer, colors.buffer]);
  } else {
    const pixels = paintPixels(gen, m.cx, m.cy, m.season);
    postMessage({ t: 'paint', id: m.id, bx: m.bx, bz: m.bz, ci: m.ci, cj: m.cj, season: m.season, pixels }, [pixels.buffer]);
  }
  setTimeout(step, 0);
}
