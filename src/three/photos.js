// Las texturas de fotos: fotos CC0 de ambientCG (ver assets/LICENCIAS.md) reducidas
// y sin su color propio, en assets/tex/ con un nombre que cambia con su contenido. Cada una guarda el dibujo de la foto
// con la media de cada canal en `mean` (de 0 a 255); `m` es lo que mide en el mundo, en metros (ancho, alto); `k`, si
// lo lleva, rebaja su contraste (la pizarra, de lejos, hacía ruido); `detail`, que el suelo la usa también de detalle en gris.
// textures.js da una sola textura de la gráfica por foto y cada material la tiñe con su color (ver photoTex): para
// eso tienen que haber llegado antes de hacer los materiales, y la vista las pide nada más crearse (preloadPhotos),
// mientras se entra con la cuenta. Si alguna no ha llegado, se ve el lienzo pintado por código y la foto encima cuando
// llega, como antes. Sin vista (el mundo del servidor) no se descarga ninguna.

export const PHOTOS = {
  teja: { file: 'teja.eef90e8b.webp', mean: 162, m: [2.9, 2.9] },   // RoofingTiles014B, 512×512
  pizarra: { file: 'pizarra.bbe84806.webp', mean: 135, m: [1.4, 1.4], k: 0.65 },   // RoofingTiles001, 512×512
  piedra: { file: 'piedra.460f689e.webp', mean: 149, m: [2.2, 1.1] },   // Bricks089, 512×256
  tablas: { file: 'tablas.c1ff4ef3.webp', mean: 191, m: [2.2, 2.2] },   // Wood080, 512×512
  entarimado: { file: 'entarimado.699f296d.webp', mean: 167, m: [2.0, 2.0] },   // Planks037A, 512×512
  madera: { file: 'madera.218ae3f9.webp', mean: 191, m: [1.0, 1.0] },   // Wood094, 256×256
  paja: { file: 'paja.3a2d004e.webp', mean: 191, m: [1.5, 1.5] },   // ThatchedRoof001A, 512×512
  grava: { file: 'grava.7b798147.webp', mean: 154, m: [1.6, 1.6] },   // Gravel043, 512×512
  losa: { file: 'losa.a8b61e47.webp', mean: 183, m: [2.3, 1.15] },   // Tiles130, 512×256
  corteza: { file: 'corteza.ad5cdfd8.webp', mean: 145, m: [1.0, 1.0] },   // Bark012, 512×512
  roca: { file: 'roca.c0f05b83.webp', mean: 136, m: [2.0, 2.0], detail: true },   // Rock030, 512×512
  hierba: { file: 'hierba.72d24a93.webp', mean: 183, m: [1.4, 1.4], detail: true },   // Grass004, 512×512
  tierra: { file: 'tierra.a7d15c50.webp', mean: 183, m: [2.0, 2.0], detail: true },   // Ground103, 512×512
  arena: { file: 'arena.9221d77b.webp', mean: 191, m: [2.0, 2.0] },   // Ground080, 512×512 (no la usa nadie: no se precarga)
};
const LOADS = new Map(), READY = new Map();
// La foto de una clave, cuando llegue (o null si falla); null en seguida si no hay a dónde (sin documento). Se descodifica
// fuera del hilo principal (decode): al usarla ya está lista, sin el parón de descodificarla al subirla a la gráfica
export function photo(key) {
  const p = PHOTOS[key];
  if (!p || typeof document === 'undefined') return null;
  if (!LOADS.has(key)) LOADS.set(key, new Promise(res => {
    const img = new Image();
    img.decoding = 'async';
    img.src = new URL(`../../assets/tex/${p.file}`, import.meta.url).href;
    // (si no se puede preparar, se usa como antes: cada variante, su copia teñida)
    const ok = () => { try { READY.set(key, prep(p, img)); } catch (e) { console.warn(`No se ha podido preparar la textura ${p.file}`, e); } res(img); };
    const bad = () => { console.warn(`No ha llegado la textura ${p.file}: se queda la pintada`); res(null); };
    // (decode() puede fallar sin que falle la imagen, por ejemplo con poca memoria: entonces, lo de siempre, al cargar)
    img.decode().then(ok, () => { if (img.complete) (img.naturalWidth ? ok : bad)(); else { img.onload = ok; img.onerror = bad; } });
  }));
  return LOADS.get(key);
}
// Lo que textures.js necesita de cada foto, preparado al llegar (en la pantalla de entrada, sin prisa) y no al hacer los
// materiales: la imagen que va a la gráfica (la pizarra, ya con su contraste rebajado), el histograma de cada canal (para
// sacar el tinte de cada variante) y, en las de detalle del suelo, el canal rojo (para hornearlas en gris)
function prep(p, img) {
  const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
  c.width = img.width; c.height = img.height;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height), d = data.data, hist = [new Float64Array(256), new Float64Array(256), new Float64Array(256)];
  let src = img, red = null;
  if (p.detail) { red = new Uint8Array(d.length / 4); for (let i = 0, j = 0; i < d.length; i += 4, j++) red[j] = d[i]; }
  if (p.k) { const soft = p.k, m = p.mean * (1 - soft); for (let i = 0; i < d.length; i += 4) { d[i] = m + d[i] * soft; d[i + 1] = m + d[i + 1] * soft; d[i + 2] = m + d[i + 2] * soft; } g.putImageData(data, 0, 0); src = c; }
  for (let i = 0; i < d.length; i += 4) { hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++; }
  return { img: src, w: img.width, h: img.height, hist, red };
}
// La foto ya preparada (ver prep), o null si aún no ha llegado (o no llega)
export const photoNow = key => READY.get(key) || null;

// Empieza a bajar todas (las que usa el juego) y dice cuándo han llegado o fallado todas. Una sola vez
let ALL = null, settled = false;
export function preloadPhotos() {
  if (ALL) return ALL;
  const t0 = performance.now(), keys = Object.keys(PHOTOS).filter(k => k !== 'arena');
  ALL = Promise.all(keys.map(k => photo(k))).then(list => {
    settled = true;
    console.info(`[texturas] fotos listas en ${Math.round(performance.now() - t0)} ms (${list.filter(Boolean).length} de ${keys.length})`);
  });
  return ALL;
}
// ¿Han llegado (o fallado) ya todas las que se pidieron?
export const photosSettled = () => settled;
