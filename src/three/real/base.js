/* base.js: escenario común de las pruebas de aspecto de Miniverse (copia de docs/pruebas-arte/look/base.js, sin los avisos de
   error en pantalla: el juego solo usa sus ayudas —LOOK.mix, sobrio, canvas, ruido…— para construir las personas realistas). Three.js r160, sin archivos externos.

   CÓMO SE USA (se abre desde file://, así que: scripts clásicos y un solo módulo en línea)

     <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"}}</script>
     <script src="base.js"></script>
     <script src="mi-parte.js"></script>            // mi-parte.js hace: LOOK.parts.vaca = (THREE, opciones) => objeto3D
     <script type="module">
       import * as THREE from 'three';
       LOOK.start(THREE, ctx => {
         ctx.scene.add(LOOK.door(-2, 0));
         return { update(dt, t) { ... } };          // opcional; también puede devolver una promesa
       });
     </script>

   CONSULTA (?vista=7&hora=tarde&once=1...)
     vista  distancia de cámara: 22 (normal), 18, 7 (la más cercana); vale cualquier número
     yaw    giro en radianes (π/4 por defecto)      pitch  inclinación en radianes (0,84 por defecto)
     hora   dia | tarde | noche | lluvia            once=1 pinta una vez y para el bucle (para render.sh)
     hud=0  sin panel ni rótulos (capturas limpias) t      con once, avanza update hasta t segundos antes de pintar
     pr     pixelRatio (1 por defecto; 2 = ×2)      w, h   fija el lienzo en píxeles; para tamaño de teléfono con render.sh hay que
                                                          usarlos, porque Chrome invisible no baja de 500 px de ancho
     tono   agx (por defecto) | agx0 (AgX sin ajuste) | aces      exp, pot, con, sat  ajustes de la curva
     q=low  sombra de 1024

   API
     LOOK.parts                    registro libre: cada script añade aquí sus generadores
     LOOK.q                        la consulta ya leída (LOOK.q.raw es el URLSearchParams, para parámetros propios)
     LOOK.PAL, LOOK.HORAS, LOOK.CURVA   paleta (sección 3), tabla de luz calibrada (sección 4.10) y ajustes de la curva
     LOOK.start(THREE, setup)      crea todo y llama a setup(ctx); ctx = { THREE, scene, camera, renderer, sun, hemi, sky, ground, q }
     LOOK.ctx                      ese mismo ctx, tras arrancar
     LOOK.setHora(h), LOOK.setVista(d), LOOK.mirar(x, y, z), LOOK.setCamara({ yaw, pitch, vista })
                                   cambian la vista; con once hay que llamar después a LOOK.frame()
     LOOK.setGround({ hierba, seca, tierra, camino, barro }, mojado)   recolorea el suelo (estaciones, nieve)
     LOOK.frame()                  pinta un fotograma y refresca el panel
     LOOK.stats()                  escribe y devuelve llamadas, triángulos (principal y sombra) y programas
     LOOK.medir([x,y,z] | {sx,sy}, radio)   color en pantalla de un punto: { hex, h, s, v } con s y v de 0 a 100
     LOOK.canvas(size, paint, o)   CanvasTexture con paint(ctx2d, w, h). size: n o [w, h]. o: { data: true sin sRGB, clamp, aniso }
     LOOK.rawCanvas(size, paint)   lo mismo pero devuelve el <canvas>
     LOOK.pixels(ctx2d, w, h, fn)  pinta píxel a píxel; fn(x, y) devuelve [r, g, b] o [r, g, b, a] de 0 a 255
     LOOK.tile(S, x, y, m, draw)   llama a draw(x, y) y a sus copias envueltas si caen a menos de m del borde de una tesela de S
     LOOK.noise2(x, y, px, py)     ruido de gradiente de 0 a 1; px y py enteros lo hacen periódico
     LOOK.fbm2(x, y, oct, px, py)  varias octavas del anterior, de 0 a 1
     LOOK.hash2(x, y), LOOK.rng(seed)   azar fijo por posición, y generador con semilla (devuelve una función)
     LOOK.sobrio(hex, tipo)        apaga un color guardado: tela y pelo por defecto, 'piel' para la piel. Devuelve '#rrggbb'
     LOOK.hsv(hex), LOOK.mix(a, b, t), LOOK.curva(hex)   [h, s, v] de 0 a 1; mezcla; hex con la curva de tono aplicada
     LOOK.box(w, h, d, x, y, z, hex), LOOK.tint(geo, hex), LOOK.merge([geo...])   cajas con color de vértice y unión en una sola llamada
     LOOK.door(x, z, rotY)         regla: marco de puerta de 2,05 m libres, con marcas cada 0,5 m (1 llamada, rótulo aparte)
     LOOK.mancha(rx, rz, fuerza)   mancha oscura de contacto bajo un actor

   Lo que crea objetos de Three (canvas, curva, box, tint, merge, door, mancha) se usa desde setup o después.
   Con yaw π/4 el camino pasa a unos 5 m hacia la cámara y el centro es hierba: lo que se ponga en el origen queda en mitad de la toma.
   Tono: LOOK.ctx.renderer usa CustomToneMapping con el AgX de r160 más el ajuste de CURVA; con tono=agx0 usa AgXToneMapping tal cual.
   Cielo y suelo cuestan 2 llamadas y 82 triángulos: el panel los lleva descontados en «escena». */
(function () {
  'use strict';
  const LOOK = window.LOOK = { parts: {} };

  // ---------------------------------------------------------------- consulta
  const raw = new URLSearchParams(location.search);
  const num = (k, d) => { const v = parseFloat(raw.get(k)); return Number.isFinite(v) ? v : d; };
  const q = LOOK.q = {
    raw,
    vista: num('vista', 22), yaw: num('yaw', Math.PI / 4), pitch: num('pitch', 0.84),
    hora: raw.get('hora') || 'dia', once: raw.get('once') === '1', hud: raw.get('hud') !== '0',
    t: num('t', 0), pr: num('pr', 1), w: num('w', 0), h: num('h', 0), low: raw.get('q') === 'low',
    tono: raw.get('tono') || 'agx',
  };

  // ---------------------------------------------------------------- paleta (sección 3)
  LOOK.PAL = {
    suelo: { hierba: '#6e7a55', seca: '#8b8562', tierra: '#6b5e4b', camino: '#8d7d65', barro: '#4f4538', roca: '#77746b', arena: '#b1a27f', nieve: '#d9dcd8' },
    muro: { cal: '#cdc4b1', calSucia: '#a99f8b', piedra: '#7f7b71', piedraOscura: '#5e5b54', entramado: '#4f4438', tablaVieja: '#6d5c4c', tablaClara: '#907c64' },
    cubierta: { teja: '#8e6650', tejaOscura: '#6e5040', pizarra: '#4c5053', paja: '#9d8d6e' },
    pintura: { verdin: '#3f7f5a', ocre: '#b08a4e', almagre: '#8f4a38', anil: '#3a5f8f', ciruela: '#7a3a68' },
    detalle: { hierro: '#4f5254', laton: '#8a7440', cristal: '#39444a' },
    follaje: { primavera: '#6f8050', verano: '#59683f', otono: '#94703a', otono2: '#7f4e2e', pino: '#3f5240', tronco: '#4d4236' },
    agua: { profunda: '#2f4a4f', media: '#47666a', orilla: '#7f8f83', espuma: '#c7ccc2' },
  };

  // ---------------------------------------------------------------- luz (sección 4.10)
  // Cenit, horizonte y colores de la hemisférica son los de la tabla, y también el sol salvo el de la tarde (era #ffb877,
  // daba teja y hierba casi naranjas). Las intensidades eran de partida (van entre paréntesis) y se han calibrado sobre los
  // renders: en r160 las dos luces se dividen por π, la sombra solo recibe la hemisférica y AgX aplana, así que con las
  // originales las sombras salían casi negras y la noche no dejaba ver el suelo.
  // azim, en grados, se mide en el mundo desde +z hacia +x; con yaw π/4 la luz entra por la izquierda de la cámara.
  // cielo multiplica cenit y horizonte antes de la curva, para que el color visto se acerque al de la tabla.
  LOOK.HORAS = {
    dia: { cenit: '#7f9fb8', horiz: '#c9d2d0', sol: '#fff0dc', solI: 2.4 /* 2,6 */, hemiC: '#b9c6cf', hemiS: '#6b5f4e', hemiI: 2.1 /* 0,55 */, elev: 48, azim: 14, niebla: [60, 150], cielo: 1.3 },
    tarde: { cenit: '#6f7f9a', horiz: '#d9b08c', sol: '#ffc48f', solI: 3.2 /* 1,4 */, hemiC: '#a9a7ae', hemiS: '#5e4e40', hemiI: 2.2 /* 0,45 */, elev: 22, azim: -52, niebla: [50, 140], cielo: 1.15 },
    noche: { cenit: '#141c2a', horiz: '#27303f', sol: '#8ea4c4', solI: 1.4 /* 0,3 */, hemiC: '#2d3a4e', hemiS: '#1c1a18', hemiI: 7 /* 0,25 */, elev: 42, azim: 34, niebla: [24, 90], cielo: 1 },
    lluvia: { cenit: '#7c858b', horiz: '#a3a9aa', sol: '#d9dedf', solI: 1.2 /* 1,1 */, hemiC: '#9aa3a8', hemiS: '#5a5247', hemiI: 3.4 /* 0,6 */, elev: 62, azim: 6, niebla: [14, 70], cielo: 1.25, mojado: 1, radio: 3 },
  };
  if (!LOOK.HORAS[q.hora]) q.hora = 'dia';

  // Curva: AgX de r160 con contraste, sin posproceso (sección 4.10). AgX aplana mucho: con la curva tal cual, el muro de cal
  // al sol no pasa de V71 con la hierba en V54. Con esta potencia y contraste, la cal llega a V79 y la pintura conserva su S.
  const CURVA = { exp: num('exp', q.tono === 'aces' ? 1 : q.tono === 'agx0' ? 1.4 : 2.2), pot: num('pot', 1.15), con: num('con', 0.4), sat: num('sat', 1.08) };
  LOOK.CURVA = CURVA;

  // ---------------------------------------------------------------- ruido y azar
  LOOK.rng = seed => {
    let a = (seed | 0) + 0x6d2b79f5;
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  LOOK.hash2 = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };

  const P = new Uint8Array(512);
  { const r = LOOK.rng(1234), a = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    for (let i = 0; i < 512; i++) P[i] = a[i & 255]; }
  const GX = [1, -1, 1, -1, 1.414, -1.414, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1.414, -1.414];
  const noise2 = LOOK.noise2 = (x, y, px, py) => {
    const xf = Math.floor(x), yf = Math.floor(y), fx = x - xf, fy = y - yf;
    let x0 = xf, x1 = xf + 1, y0 = yf, y1 = yf + 1;
    if (px) { x0 = ((x0 % px) + px) % px; x1 = ((x1 % px) + px) % px; }
    if (py) { y0 = ((y0 % py) + py) % py; y1 = ((y1 % py) + py) % py; }
    x0 &= 255; x1 &= 255; y0 &= 255; y1 &= 255;
    const aa = P[P[x0] + y0] & 7, ab = P[P[x0] + y1] & 7, ba = P[P[x1] + y0] & 7, bb = P[P[x1] + y1] & 7;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const n00 = GX[aa] * fx + GY[aa] * fy, n10 = GX[ba] * (fx - 1) + GY[ba] * fy;
    const n01 = GX[ab] * fx + GY[ab] * (fy - 1), n11 = GX[bb] * (fx - 1) + GY[bb] * (fy - 1);
    const a = n00 + u * (n10 - n00), b = n01 + u * (n11 - n01), n = 0.5 + (a + v * (b - a)) * 0.72;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  };
  const fbm2 = LOOK.fbm2 = (x, y, oct = 3, px, py) => {
    let s = 0, w = 0.5, t = 0, f = 1;
    for (let i = 0; i < oct; i++) { s += w * noise2(x * f + i * 17.3, y * f + i * 9.1, px ? px * f : 0, py ? py * f : 0); t += w; w *= 0.5; f *= 2; }
    return s / t;
  };
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ---------------------------------------------------------------- color
  const toRGB = hex => { const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (r, g, b) => '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
  const hsv3 = (r, g, b) => {
    const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m;
    let h = 0;
    if (d > 0) { if (M === r) h = ((g - b) / d + 6) % 6; else if (M === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; }
    return [h, M > 0 ? d / M : 0, M / 255];
  };
  LOOK.hsv = hex => { const c = toRGB(hex); return hsv3(c[0], c[1], c[2]); };
  LOOK.mix = (a, b, t) => { const p = toRGB(a), r = toRGB(b); return toHex(p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t, p[2] + (r[2] - p[2]) * t); };
  // Telas y pelo: saturación ×0,85 y valor ×0,92. Piel: saturación ×0,85 y valor ×0,97.
  LOOK.sobrio = (hex, tipo) => {
    const c = toRGB(hex), hs = hsv3(c[0], c[1], c[2]), s = hs[1] * 0.85, v = hs[2] * (tipo === 'piel' ? 0.97 : 0.92), M = v * 255, m = M * (1 - s), h = hs[0] * 6, d = M - m;
    const x = m + d * (1 - Math.abs((h % 2) - 1)), i = Math.floor(h) % 6;
    return toHex(...[[M, x, m], [x, M, m], [m, M, x], [m, x, M], [x, m, M], [M, m, x]][i]);
  };

  // Lo mismo que hace el shader con un color de escena: entra lineal, sale ya codificado en sRGB (de 0 a 1).
  // Hace falta porque r160 mezcla la niebla después del tono, y si no el suelo lejano no casaría con el cielo.
  const col = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const A_IN = [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956];
  const A_OUT = [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187];
  const AGX_I = [0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859];
  const AGX_O = [1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405];
  const ACES_I = [0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
  const ACES_O = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602];
  const srgb = x => { x = Math.max(0, Math.min(1, x)); return x < 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
  const sigmoide = x => { const x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; };
  function curvaLineal(c) {
    const e = CURVA.exp;
    if (q.tono === 'aces') {
      const v = col(ACES_I, c.map(x => x * e / 0.6)).map(x => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
      return col(ACES_O, v);
    }
    let v = col(AGX_I, col(A_IN, c.map(x => x * e))).map(x => Math.max(0, Math.min(1, (Math.log2(Math.max(x, 1e-10)) + 12.47393) / (4.026069 + 12.47393)))).map(sigmoide);
    if (q.tono !== 'agx0') {
      const L = Math.pow(Math.max(0, 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]), CURVA.pot);
      const sat = 0.62 + (CURVA.sat - 0.62) * smooth(0.12, 0.48, L);   // con poca luz el color se apaga: si no, la pintura se satura en la sombra y de noche
      v = v.map(x => { const s = Math.max(0, Math.min(1, L + sat * (Math.pow(Math.max(0, x), CURVA.pot) - L))); return s + (s * s * (3 - 2 * s) - s) * CURVA.con; });
    }
    return col(A_OUT, col(AGX_O, v).map(x => Math.pow(Math.max(0, x), 2.2)));
  }
  const curvaSRGB = c => curvaLineal(c).map(srgb);
  LOOK.curva = hex => { const c = new LOOK.THREE.Color(hex), o = curvaSRGB([c.r, c.g, c.b]); return toHex(o[0] * 255, o[1] * 255, o[2] * 255); };

  // ---------------------------------------------------------------- lienzos
  const rawCanvas = LOOK.rawCanvas = (size, paint) => {
    const w = Array.isArray(size) ? size[0] : size, h = Array.isArray(size) ? size[1] : size, c = document.createElement('canvas');
    c.width = w; c.height = h;
    if (paint) paint(c.getContext('2d'), w, h);
    return c;
  };
  const aTextura = (c, o = {}) => {
    const T = LOOK.THREE, t = new T.CanvasTexture(c);
    t.colorSpace = o.data ? T.NoColorSpace : T.SRGBColorSpace;
    t.wrapS = t.wrapT = o.clamp ? T.ClampToEdgeWrapping : T.RepeatWrapping;
    t.anisotropy = o.aniso || 8;   // three lo recorta al máximo de la GPU
    return t;
  };
  LOOK.canvas = (size, paint, o) => aTextura(rawCanvas(size, paint), o);
  LOOK.pixels = (g, w, h, fn) => {
    const im = g.createImageData(w, h), d = im.data;
    for (let y = 0, k = 0; y < h; y++) for (let x = 0; x < w; x++, k += 4) { const c = fn(x, y); d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = c.length > 3 ? c[3] : 255; }
    g.putImageData(im, 0, 0);
  };
  LOOK.tile = (S, x, y, m, draw) => {
    const xs = [x]; if (x < m) xs.push(x + S); if (x > S - m) xs.push(x - S);
    const ys = [y]; if (y < m) ys.push(y + S); if (y > S - m) ys.push(y - S);
    for (const a of xs) for (const b of ys) draw(a, b);
  };

  // ---------------------------------------------------------------- suelo
  // Tesela de 4 m a 256 téxeles/m, gris y centrada en 128: se multiplica por el color de la paleta en el shader.
  function medias(c) {
    const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; let r = 0, v = 0, a = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; v += d[i + 1]; a += d[i + 2]; }
    const n = d.length / 4 * 255; return [r / n, v / n, a / n];
  }
  function teselaHierba(S) {
    const r = LOOK.rng(11), lo = rawCanvas(256, (g, w, h) => LOOK.pixels(g, w, h, (x, y) => {
      const u = x / w, v = y / h, a = fbm2(u * 7, v * 7, 3, 7, 7), b = fbm2(u * 26 + 3, v * 26 + 8, 2, 26, 26), L = 124 + (a - 0.5) * 78 + (b - 0.5) * 38;
      return [L * (1 + (a - 0.5) * 0.28), L, L * (0.97 - (a - 0.5) * 0.25)];
    }));
    // Matas: abanicos de hojas curvas que salen de una base corta, no estrellas. Se pintan una vez como sellos y luego se
    // estampan, porque dibujarlas línea a línea en una tesela de 1024² costaba más de 20 s en este Mac.
    const sello = (seca, sem) => rawCanvas(64, g => {
      const t = LOOK.rng(sem); g.lineCap = 'round';
      const capa = (color, w, n) => {
        g.strokeStyle = color; g.lineWidth = w; g.beginPath();
        for (let k = 0; k < n; k++) {
          const a = -1.57 + (t() - 0.5) * 2.1, l = 20 + t() * 28, x = 32 + (t() - 0.5) * 16, y = 50 + (t() - 0.5) * 8, d = (t() - 0.5) * 0.9;
          g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.6, y + Math.sin(a) * l * 0.6, x + Math.cos(a + d) * l, y + Math.sin(a + d) * l);
        }
        g.stroke();
      };
      capa('rgba(74,82,68,0.55)', 2.8, 8); capa('rgba(104,112,90,0.7)', 2.2, 8); capa('rgba(136,142,110,0.75)', 1.8, 7);
      capa(seca ? 'rgba(186,170,122,0.8)' : 'rgba(164,168,126,0.75)', 1.4, 5);
    });
    const sellos = [sello(false, 1), sello(false, 2), sello(false, 3), sello(false, 4), sello(false, 5), sello(true, 6)];
    return rawCanvas(S, g => {
      g.imageSmoothingQuality = 'high'; g.drawImage(lo, 0, 0, S, S);
      const k = S / 1024, matas = Math.round(9000 * k * k);
      for (let i = 0; i < matas; i++) {
        const cx = r() * S, cy = r() * S;
        if (fbm2(cx / S * 11, cy / S * 11, 2, 11, 11) + r() * 0.6 < 0.52) continue;
        const R = (8 + r() * r() * 17) * k, im = sellos[r() < 0.08 ? 5 : Math.floor(r() * 5)], a = r() * 6.28, ca = Math.cos(a) * R / 32, sa = Math.sin(a) * R / 32;
        LOOK.tile(S, cx, cy, R + 2, (x, y) => { g.setTransform(ca, sa, -sa, ca, x, y); g.drawImage(im, -32, -32); });
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      // Los sellos tapan el fondo: se vuelve a poner encima su variación de tono, que es lo que se ve a distancia 22
      g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.55; g.drawImage(lo, 0, 0, S, S);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    });
  }
  function teselaTierra(S) {
    const r = LOOK.rng(23), lo = rawCanvas(512, (g, w, h) => LOOK.pixels(g, w, h, (x, y) => {
      const u = x / w, v = y / h, a = fbm2(u * 10, v * 10, 2, 10, 10), b = fbm2(u * 42 + 5, v * 42 + 1, 2, 42, 42), c = noise2(u * 140, v * 140, 140, 140), L = 128 + (a - 0.5) * 46 + (b - 0.5) * 44 + (c - 0.5) * 26;
      return [L * 1.01, L, L * 0.98];
    }));
    return rawCanvas(S, g => {
      g.imageSmoothingQuality = 'high'; g.drawImage(lo, 0, 0, S, S);
      // Marcas de pisadas y grietas finas, muy poco contraste
      g.lineCap = 'round'; g.strokeStyle = 'rgba(60,54,46,0.22)'; g.lineWidth = 1.4; g.beginPath();
      for (let i = 0; i < 140; i++) {
        let x = r() * S, y = r() * S, a = r() * 6.28; g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { a += (r() - 0.5) * 1.3; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y); }
      }
      g.stroke();
      // Chinos: sombra al lado contrario del sol y cuerpo claro
      const n = Math.round(1700 * (S / 1024) * (S / 1024));
      for (let i = 0; i < n; i++) {
        const R = 1.2 + r() * r() * 6.5, L = 120 + r() * 80, e = 0.6 + r() * 0.4, a = r() * 3.14;
        LOOK.tile(S, r() * S, r() * S, R + 2, (x, y) => {
          g.fillStyle = 'rgba(40,36,30,0.4)'; g.beginPath(); g.ellipse(x + 0.8, y - 1.2, R * 1.05, R * e, a, 0, 6.29); g.fill();
          g.fillStyle = `rgb(${L},${L * 0.98},${L * 0.93})`; g.beginPath(); g.ellipse(x, y, R, R * e, a, 0, 6.29); g.fill();
        });
      }
    });
  }
  // Mapa grande de datos (no color): r sequedad, g vigor, b desgaste de la tierra (0 barro, 0,5 tierra, 1 camino), a hierba frente a tierra
  const MAPA_M = 96;
  // Evalúa fn en una rejilla gruesa y devuelve un lector bilineal: el ruido de baja frecuencia no necesita cada píxel
  function campo(N, paso, fn) {
    const M = Math.ceil(N / paso) + 2, a = new Float32Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) a[j * M + i] = fn(i * paso, j * paso);
    return (i, j) => { const x = i / paso, y = j / paso, xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, o = yi * M + xi; return (a[o] * (1 - fx) + a[o + 1] * fx) * (1 - fy) + (a[o + M] * (1 - fx) + a[o + M + 1] * fx) * fy; };
  }
  function mapaSuelo(T, N) {
    const d = new Uint8Array(N * N * 4), k = MAPA_M / N, X = i => (i + 0.5) * k - MAPA_M / 2;
    const F1 = campo(N, 4, (i, j) => fbm2(X(i) / 19 + 3.1, X(j) / 19 + 7.7, 3)), F2 = campo(N, 2, (i, j) => fbm2(X(i) / 5.3, X(j) / 5.3, 3)), FC = campo(N, 4, (i, j) => fbm2(X(i) / 5.3 + 11, X(j) / 5.3 + 5, 3));
    for (let j = 0, o = 0; j < N; j++) for (let i = 0; i < N; i++, o += 4) {
      const x = X(i), z = X(j), u = (x - z) * 0.7071, v = (x + z) * 0.7071;
      const n1 = F1(i, j), n2 = F2(i, j), n3 = fbm2(x / 1.3 + 9, z / 1.3 + 2, 2);
      // Calvas: hierba seca y rala, sin tierra limpia, para que no parezcan manchas recortadas
      const calva = smooth(0.6, 0.74, FC(i, j));
      const seco = Math.min(1, smooth(0.44, 0.72, n1 * 0.72 + n2 * 0.28) * 0.72 + calva * 0.55), vigor = (n2 * 0.65 + n3 * 0.35) * (1 - calva * 0.25);
      // Camino de dos rodadas; cruza la parte baja de la pantalla con yaw π/4. Entre las rodadas crece algo de hierba a golpes
      const cv = 5.1 + 1.5 * Math.sin(u / 8.3) + 0.45 * Math.sin(u / 2.9 + 1.2) - 0.1 * u, dist = Math.abs(v - cv), anc = 0.86 + 0.14 * Math.sin(u / 4.7 + 0.5);
      const trocha = 1 - smooth(anc - 0.3, anc + 0.34, dist + (n3 - 0.5) * 0.62 + (n2 - 0.5) * 0.42);
      const rodada = Math.exp(-Math.pow((dist - 0.42) / 0.16, 2));
      const lomo = dist < 0.4 ? Math.exp(-Math.pow(dist / 0.17, 2)) * smooth(0.45, 0.7, noise2(x / 0.42, z / 0.42)) * 0.53 : 0;
      const tierra = trocha * (1 - lomo);
      const desgaste = 0.86 - rodada * 0.2 - smooth(anc - 0.45, anc + 0.1, dist) * 0.2 + (n3 - 0.5) * 0.24;
      d[o] = seco * 255; d[o + 1] = vigor * 255; d[o + 2] = Math.max(0, Math.min(1, desgaste)) * 255; d[o + 3] = (1 - tierra) * 255;
    }
    const t = new T.DataTexture(d, N, N, T.RGBAFormat);
    t.colorSpace = T.NoColorSpace; t.wrapS = t.wrapT = T.MirroredRepeatWrapping;
    t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
    return t;
  }
  function creaSuelo(T) {
    const ti = performance.now();
    const cH = teselaHierba(1024), t1 = performance.now(), cT = teselaTierra(1024), t2 = performance.now(), mapa = mapaSuelo(T, 1024), t3 = performance.now();
    const u = {
      uMapa: { value: mapa }, uHierba: { value: aTextura(cH, { data: true }) }, uTierra: { value: aTextura(cT, { data: true }) },
      uMH: { value: new T.Vector3(...medias(cH)) }, uMT: { value: new T.Vector3(...medias(cT)) }, uMojado: { value: 0 },
      cHierba: { value: new T.Color(LOOK.PAL.suelo.hierba) }, cSeca: { value: new T.Color(LOOK.PAL.suelo.seca) },
      cTierra: { value: new T.Color(LOOK.PAL.suelo.tierra) }, cCamino: { value: new T.Color(LOOK.PAL.suelo.camino) }, cBarro: { value: new T.Color(LOOK.PAL.suelo.barro) },
    };
    const mat = new T.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = s => {
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vMundo;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMundo = (modelMatrix * vec4(position, 1.0)).xz;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 vMundo;
        uniform sampler2D uMapa, uHierba, uTierra; uniform vec3 uMH, uMT, cHierba, cSeca, cTierra, cCamino, cBarro; uniform float uMojado;`)
        .replace('#include <map_fragment>', `
        vec4 mp = texture2D(uMapa, vMundo / ${MAPA_M.toFixed(1)} + 0.5);
        vec2 p1 = vMundo / 4.0, p2 = mat2(0.8, -0.6, 0.6, 0.8) * vMundo / 10.7;
        vec3 h1 = texture2D(uHierba, p1).rgb / uMH, h2 = texture2D(uHierba, p2, 4.5).rgb / uMH, tt = texture2D(uTierra, p1 * 0.83 + 0.37).rgb / uMT;
        float alto = (h1.g - 1.0) * 0.55 + (h2.g - 1.0) * 0.3;
        float g = smoothstep(0.42, 0.58, mp.a + alto * 0.55);
        vec3 hierba = mix(cHierba, cSeca, mp.r) * mix(0.8, 1.18, mp.g) * h1 * mix(vec3(1.0), h2, 0.4) * vec3(0.765, 0.79, 0.86);   // la mata se hace sombra a sí misma
        vec3 tierra = (mp.b < 0.5 ? mix(cBarro, cTierra, mp.b * 2.0) : mix(cTierra, cCamino, mp.b * 2.0 - 1.0)) * tt;
        tierra *= 0.92 * mix(0.88, 1.0, smoothstep(0.1, 0.45, 1.0 - mp.a));   // la tierra se oscurece pegada a la hierba
        diffuseColor.rgb = mix(tierra, hierba, g) * mix(1.0, 0.85, uMojado);`);
    };
    const m = new T.Mesh(new T.PlaneGeometry(800, 800), mat);
    m.rotation.x = -Math.PI / 2; m.receiveShadow = true; m.name = 'suelo';
    m.userData.uniforms = u;
    console.log(`SUELO hierba ${Math.round(t1 - ti)} ms, tierra ${Math.round(t2 - t1)} ms, mapa ${Math.round(t3 - t2)} ms`);
    return m;
  }

  // ---------------------------------------------------------------- cielo
  function creaCielo(T) {
    const mat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { uCenit: { value: new T.Color() }, uHoriz: { value: new T.Color() }, uSolC: { value: new T.Color() }, uSolD: { value: new T.Vector3(0, 1, 0) } },
      vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vD; uniform vec3 uCenit, uHoriz, uSolC, uSolD;
        void main(){ vec3 d = normalize(vD); float t = pow(max(d.y, 0.0), 0.55);
          vec3 c = mix(uHoriz, uCenit, t) + uSolC * pow(max(dot(d, uSolD), 0.0), 18.0) * 0.28;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new T.Mesh(new T.IcosahedronGeometry(320, 1), mat);
    m.frustumCulled = false; m.renderOrder = 1000; m.name = 'cielo';   // se pinta el último de los opacos: el suelo lo tapa casi entero
    m.onBeforeRender = (r, s, cam) => m.position.copy(cam.position);
    return m;
  }

  // ---------------------------------------------------------------- instalar en el shader: curva y borde de sombra
  function instalaCurva(T) {
    if (q.tono === 'aces') return T.ACESFilmicToneMapping;
    if (q.tono === 'agx0') return T.AgXToneMapping;
    const chunk = T.ShaderChunk.tonemapping_pars_fragment, m = chunk.match(/vec3 AgXToneMapping\( vec3 color \) \{[\s\S]*?\n\}/), hueco = /vec3 CustomToneMapping\( vec3 color \) \{ return color; \}/;
    const sigmoide = 'color = agxDefaultContrastApprox( color );';
    if (!m || !hueco.test(chunk) || !m[0].includes(sigmoide)) { console.warn('CURVA no se pudo instalar: se usa AgX tal cual'); q.tono = 'agx0'; return T.AgXToneMapping; }
    const f = n => n.toFixed(4);
    const ajuste = `${sigmoide}
      float lkL = pow(max(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.0), ${f(CURVA.pot)});
      color = clamp(lkL + mix(0.62, ${f(CURVA.sat)}, smoothstep(0.12, 0.48, lkL)) * (pow(max(color, vec3(0.0)), vec3(${f(CURVA.pot)})) - lkL), 0.0, 1.0);
      color = mix(color, color * color * (3.0 - 2.0 * color), ${f(CURVA.con)});`;
    T.ShaderChunk.tonemapping_pars_fragment = chunk.replace(hueco, '') + '\n' + m[0].replace('AgXToneMapping', 'CustomToneMapping').replace(sigmoide, ajuste);
    return T.CustomToneMapping;
  }
  // La sombra se desvanece antes del borde de su cámara, para que en cámara baja no se vea el corte
  function instalaBordeSombra(T) {
    T.ShaderChunk.shadowmap_pars_fragment = T.ShaderChunk.shadowmap_pars_fragment.replace('return shadow;',
      'vec2 lkB = abs(shadowCoord.xy * 2.0 - 1.0); return mix(shadow, 1.0, smoothstep(0.82, 1.0, max(lkB.x, lkB.y)));');
  }

  // ---------------------------------------------------------------- piezas sueltas
  LOOK.tint = (geo, hex) => {
    const T = LOOK.THREE, c = new T.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new T.BufferAttribute(a, 3));
    return geo;
  };
  LOOK.box = (w, h, d, x = 0, y = 0, z = 0, hex) => { const g = new LOOK.THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return hex === undefined ? g : LOOK.tint(g, hex); };
  LOOK.merge = list => {
    const T = LOOK.THREE, gs = list.map(g => (g.index ? g.toNonIndexed() : g)), n = gs.reduce((s, g) => s + g.attributes.position.count, 0), out = new T.BufferGeometry();
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
      if (!gs.some(g => g.attributes[name])) continue;
      const a = new Float32Array(n * size); let o = 0;
      for (const g of gs) {
        const b = g.attributes[name], c = g.attributes.position.count;
        if (b) a.set(b.array.length === c * size ? b.array : Array.from(b.array).slice(0, c * size), o); else if (name === 'color') a.fill(1, o, o + c * size);
        o += c * size;
      }
      out.setAttribute(name, new T.BufferAttribute(a, size));
    }
    return out;
  };
  LOOK.door = (x = 0, z = 0, rotY = 0) => {
    const T = LOOK.THREE, H = 2.05, A = 0.95, P = 0.11, m = LOOK.PAL.muro, partes = [
      LOOK.box(P, H, P, -A / 2 - P / 2, H / 2, 0, m.tablaVieja), LOOK.box(P, H, P, A / 2 + P / 2, H / 2, 0, m.tablaVieja),
      LOOK.box(A + 2 * P, 0.13, P, 0, H + 0.065, 0, m.entramado), LOOK.box(A + 2 * P + 0.1, 0.05, 0.26, 0, 0.025, 0, m.piedra),
    ];
    for (const y of [0.5, 1, 1.5, 2]) partes.push(LOOK.box(0.05, 0.035, P + 0.02, -A / 2 - P - 0.02, y, 0, LOOK.PAL.suelo.nieve));
    const g = new T.Group(), hoja = new T.Mesh(LOOK.merge(partes), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }));
    hoja.castShadow = hoja.receiveShadow = true; g.add(hoja);
    if (q.hud) {
      const tex = LOOK.canvas([256, 64], (c, w, h) => { c.fillStyle = 'rgba(30,28,24,0.72)'; c.fillRect(0, 0, w, h); c.fillStyle = '#e6e0d2'; c.font = '600 40px ui-monospace,Menlo,monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('2,05 m', w / 2, h / 2 + 2); }, { clamp: true });
      const s = new T.Sprite(new T.SpriteMaterial({ map: tex, toneMapped: false, fog: false }));
      s.scale.set(0.8, 0.2, 1); s.position.set(0, H + 0.34, 0); g.add(s);
    }
    g.position.set(x, 0, z); g.rotation.y = rotY; g.userData.alto = H;
    return g;
  };
  let texMancha = null;
  LOOK.mancha = (rx = 0.35, rz = rx, fuerza = 0.42) => {
    const T = LOOK.THREE;
    texMancha = texMancha || LOOK.canvas(64, (c, w) => { const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.45, 'rgba(0,0,0,0.62)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, w, w); }, { clamp: true, data: true });
    const m = new T.Mesh(new T.PlaneGeometry(rx * 2, rz * 2), new T.MeshBasicMaterial({ map: texMancha, transparent: true, opacity: fuerza, depthWrite: false, toneMapped: false, fog: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.012; m.renderOrder = 1;
    return m;
  };

  // ---------------------------------------------------------------- estado y arranque
  const CIELO_SUELO = { calls: 2, tris: 82 };
  let C = null, hudTexto = null, sombra = { calls: 0, tris: 0 }, api = {}, lluviaObj = null;
  const est = { yaw: q.yaw, pitch: q.pitch, vista: q.vista, hora: q.hora, target: [0, 0, 0], pr: q.pr };

  function colocaCamara() {
    const T = C.THREE, cam = C.camera, low = 1 - Math.max(0, Math.min(1, (est.pitch - 0.07) / 0.75));   // igual que engine.js
    const fov = 30 + low * low * 12; if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const tx = est.target[0], ty = est.target[1] + 0.9 + low * 0.5, tz = est.target[2], cp = Math.cos(est.pitch);
    cam.position.set(tx + Math.sin(est.yaw) * cp * est.vista, ty + Math.sin(est.pitch) * est.vista, tz + Math.cos(est.yaw) * cp * est.vista);
    cam.position.y = Math.max(cam.position.y, 0.35);
    cam.lookAt(tx, ty, tz);
    // Sol a 50 m, como en el juego; la cámara de sombra se ajusta a la distancia y el borde se desvanece
    const h = LOOK.HORAS[est.hora], el = h.elev * Math.PI / 180, az = h.azim * Math.PI / 180, half = Math.max(8, Math.min(24, est.vista * 1.1)) + 6 * low, sc = C.sun.shadow.camera;
    const dir = new T.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    C.sun.target.position.set(tx, 0, tz); C.sun.position.set(tx, 0, tz).addScaledVector(dir, 50); C.sun.target.updateMatrixWorld();
    sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.updateProjectionMatrix();
    const texel = 2 * half / C.sun.shadow.mapSize.x;
    C.sun.shadow.radius = h.radio || Math.min(3, 0.05 / texel);
    C.sun.shadow.normalBias = (C.sun.shadow.radius + 1) * texel;   // sin esto, rayas verticales en las caras que el sol roza
    C.sky.material.uniforms.uSolD.value.copy(dir);
    if (lluviaObj) lluviaObj.position.x = tx, lluviaObj.position.z = tz;
  }
  function aplicaHora(nombre) {
    const T = C.THREE, h = LOOK.HORAS[nombre]; if (!h) return; est.hora = nombre;
    C.sun.color.set(h.sol); C.sun.intensity = h.solI;
    C.hemi.color.set(h.hemiC); C.hemi.groundColor.set(h.hemiS); C.hemi.intensity = h.hemiI;
    const u = C.sky.material.uniforms, gan = h.cielo || 1;
    u.uCenit.value.set(h.cenit).multiplyScalar(gan); u.uHoriz.value.set(h.horiz).multiplyScalar(gan);
    u.uSolC.value.set(h.sol).multiplyScalar(nombre === 'lluvia' || nombre === 'noche' ? 0 : 1);
    const c = u.uHoriz.value, f = curvaSRGB([c.r, c.g, c.b]);
    C.scene.fog.color.setRGB(f[0], f[1], f[2], T.SRGBColorSpace); C.scene.fog.near = h.niebla[0]; C.scene.fog.far = h.niebla[1];
    C.ground.userData.uniforms.uMojado.value = h.mojado || 0;
    ponLluvia(nombre === 'lluvia');
    colocaCamara();
  }
  // Lluvia: un solo volumen de trazos que cae entero y se repite; no reescribe vértices
  function ponLluvia(on) {
    const T = C.THREE;
    if (on && !lluviaObj) {
      const r = LOOK.rng(5), N = 900, H = 16, a = new Float32Array(N * 6 * 2);
      for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) {
        const o = (c * N + i) * 6, x = (r() - 0.5) * 44, z = (r() - 0.5) * 44, y = r() * H + c * H;
        a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = x + 0.03; a[o + 4] = y - 0.55; a[o + 5] = z + 0.02;
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(a, 3));
      lluviaObj = new T.LineSegments(g, new T.LineBasicMaterial({ color: '#cdd6da', transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, fog: false }));
      lluviaObj.frustumCulled = false; lluviaObj.userData.H = H; C.scene.add(lluviaObj);
    }
    if (lluviaObj) lluviaObj.visible = on;
  }

  function creaHud() {
    if (!q.hud) return;
    const d = document.createElement('div'); d.id = 'look-hud';
    const boton = (txt, fn) => { const b = document.createElement('button'); b.textContent = txt; b.onclick = () => { fn(); LOOK.frame(); }; return b; };
    const fila = document.createElement('div');
    [22, 18, 7].forEach(v => fila.append(boton(String(v), () => LOOK.setVista(v))));
    Object.keys(LOOK.HORAS).forEach(h => fila.append(boton(h, () => LOOK.setHora(h))));
    [1, 2].forEach(p => fila.append(boton('×' + p, () => { est.pr = p; C.renderer.setPixelRatio(p); })));
    hudTexto = document.createElement('pre'); d.append(hudTexto, fila); document.body.append(d);
  }
  function refrescaHud(s) {
    if (!hudTexto) return;
    const n = v => v.toLocaleString('es-ES');
    hudTexto.textContent = `escena ${s.calls - CIELO_SUELO.calls} llamadas, ${n(s.tris - CIELO_SUELO.tris)} triángulos · sombra ${s.callsSombra}, ${n(s.trisSombra)} · ${s.programas} programas\n` +
      `vista ${est.vista} · ${est.hora} · ${C.renderer.domElement.width}×${C.renderer.domElement.height} · ×${est.pr}` + (s.fps ? ` · ${s.fps} fps` : '');
  }
  function leeStats(fps) {
    const i = C.renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles, callsSombra: sombra.calls, trisSombra: sombra.tris, programas: i.programs.length, geometrias: i.memory.geometries, texturas: i.memory.textures, fps };
  }
  LOOK.stats = () => {
    const s = leeStats();
    console.log(`STATS principal ${s.calls} llamadas, ${s.tris} triángulos (cielo y suelo: ${CIELO_SUELO.calls}, ${CIELO_SUELO.tris}) · sombra ${s.callsSombra} llamadas, ${s.trisSombra} triángulos · ${s.programas} programas · ${s.geometrias} geometrías · ${s.texturas} texturas`);
    refrescaHud(s);
    return s;
  };
  LOOK.frame = () => { if (!C) return; C.renderer.render(C.scene, C.camera); refrescaHud(leeStats()); };
  LOOK.setHora = aplicaHora;
  LOOK.setVista = d => { est.vista = d; colocaCamara(); };
  LOOK.setCamara = o => { Object.assign(est, o); colocaCamara(); };
  LOOK.mirar = (x, y, z) => { est.target = [x, y, z]; colocaCamara(); };
  LOOK.setGround = (colores, mojado) => {
    const u = C.ground.userData.uniforms, nombres = { hierba: 'cHierba', seca: 'cSeca', tierra: 'cTierra', camino: 'cCamino', barro: 'cBarro' };
    for (const k in colores) if (nombres[k]) u[nombres[k]].value.set(colores[k]);
    if (mojado !== undefined) u.uMojado.value = mojado;
  };
  LOOK.medir = (p, rad = 3) => {
    const r = C.renderer, gl = r.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight; let sx, sy;
    if (Array.isArray(p)) { const v = new C.THREE.Vector3(p[0], p[1], p[2]).project(C.camera); sx = (v.x * 0.5 + 0.5) * W; sy = (0.5 - v.y * 0.5) * H; } else { sx = p.sx * est.pr; sy = p.sy * est.pr; }
    const n = 2 * rad + 1, b = new Uint8Array(n * n * 4); gl.readPixels(Math.round(sx) - rad, H - Math.round(sy) - rad - 1, n, n, gl.RGBA, gl.UNSIGNED_BYTE, b);
    let R = 0, G = 0, B = 0; for (let i = 0; i < b.length; i += 4) { R += b[i]; G += b[i + 1]; B += b[i + 2]; }
    const c = n * n, hs = hsv3(R / c, G / c, B / c);
    return { hex: toHex(R / c, G / c, B / c), h: Math.round(hs[0] * 360), s: Math.round(hs[1] * 100), v: Math.round(hs[2] * 100), px: [Math.round(sx), Math.round(sy)] };
  };

  function arranca(T, setup) {
    const estilo = document.createElement('style');
    estilo.textContent = `html,body{margin:0;height:100%;overflow:hidden;background:#27303f}canvas{display:block;position:fixed;left:0;top:0}
      #look-hud{position:fixed;left:8px;top:8px;max-width:calc(100vw - 32px);box-sizing:border-box;font:11px/1.45 ui-monospace,Menlo,monospace;color:#e6e0d2;background:rgba(27,27,31,.62);padding:5px 8px;border-radius:4px}
      #look-hud pre{margin:0 0 4px;font:inherit;white-space:pre-wrap}#look-hud button{font:inherit;color:inherit;background:rgba(230,224,210,.14);border:0;border-radius:3px;margin:0 3px 0 0;padding:3px 7px;cursor:pointer}`;
    document.head.append(estilo);
    const tono = instalaCurva(T); instalaBordeSombra(T);

    // En Chrome invisible el área útil crece justo antes de la captura: con once se usa desde el principio el alto de la ventana
    const usaVentana = q.once && outerHeight > innerHeight;
    const W = q.w || (usaVentana ? outerWidth : innerWidth), H = q.h || (usaVentana ? outerHeight : innerHeight);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: q.once });
    renderer.setPixelRatio(est.pr); renderer.setSize(W, H);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
    renderer.toneMapping = tono; renderer.toneMappingExposure = CURVA.exp;
    document.body.append(renderer.domElement);
    // r160 pone a cero las cuentas después de la pasada de sombra: se anota aquí lo que cuesta esa pasada
    const sm = renderer.shadowMap, smRender = sm.render;
    sm.render = function () { const i = renderer.info.render, c = i.calls, t = i.triangles; smRender.apply(sm, arguments); sombra = { calls: i.calls - c, tris: i.triangles - t }; };

    const scene = new T.Scene(), camera = new T.PerspectiveCamera(30, W / H, 0.3, 420);
    scene.fog = new T.Fog('#ffffff', 60, 150);
    const hemi = new T.HemisphereLight('#ffffff', '#000000', 1), sun = new T.DirectionalLight('#ffffff', 1);
    sun.castShadow = true; sun.shadow.mapSize.set(q.low ? 1024 : 2048, q.low ? 1024 : 2048);
    sun.shadow.camera.near = 18; sun.shadow.camera.far = 84; sun.shadow.bias = -0.0004;
    scene.add(hemi, sun, sun.target);
    const sky = creaCielo(T), ground = creaSuelo(T);
    scene.add(sky, ground);
    C = LOOK.ctx = { THREE: T, scene, camera, renderer, sun, hemi, sky, ground, q };
    aplicaHora(est.hora);
    creaHud();

    addEventListener('resize', () => {
      if (q.once || q.w) return;
      camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
    });

    const tick = (dt, t) => {
      if (api.update) api.update(dt, t);
      if (lluviaObj && lluviaObj.visible) lluviaObj.position.y = -((t * 17) % lluviaObj.userData.H);
    };
    return Promise.resolve(setup(C)).then(r => {
      api = r || {};
      if (q.once) {
        const pasos = Math.min(900, Math.ceil(q.t * 30));
        for (let i = 0; i < pasos; i++) tick(1 / 30, i / 30);
        tick(0, q.t);
        renderer.render(scene, camera);
        LOOK.stats();
        window.LOOK_LISTO = true;
        return C;
      }
      let last = performance.now(), T0 = 0, cuenta = 0, marca = last, fps = 0;
      const bucle = now => {
        requestAnimationFrame(bucle);
        const dt = Math.min(0.1, (now - last) / 1000); last = now; T0 += dt;
        tick(dt, T0);
        renderer.render(scene, camera);
        cuenta++;
        if (now - marca > 500) { fps = Math.round(cuenta * 1000 / (now - marca)); cuenta = 0; marca = now; refrescaHud(leeStats(fps)); }
      };
      tick(0, 0); renderer.render(scene, camera); LOOK.stats();
      if (raw.get('bench')) {   // bench=N: N fotogramas seguidos, esperando a la gráfica en cada uno; escribe BENCH en la consola
        const gl = renderer.getContext(), px = new Uint8Array(4), ext = gl.getExtension('WEBGL_debug_renderer_info');
        const uno = () => { const t = performance.now(); tick(1 / 60, 0); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return performance.now() - t; };
        for (let i = 0; i < 5; i++) uno();
        const ts = []; for (let i = 0, n = +raw.get('bench') || 30; i < n; i++) ts.push(uno()); ts.sort((a, b) => a - b);
        console.log(`BENCH gpu=${ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)} lienzo=${renderer.domElement.width}x${renderer.domElement.height} min=${ts[0].toFixed(1)} mediana=${ts[ts.length >> 1].toFixed(1)} p90=${ts[Math.floor(ts.length * 0.9)].toFixed(1)} ms arranque=${(performance.now() / 1000).toFixed(1)} s`);
      }
      requestAnimationFrame(bucle);
      return C;
    });
  }

  LOOK.start = (T, setup) => new Promise(ok => {
    LOOK.THREE = T;
    const go = () => ok(arranca(T, setup));
    if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
  });

})();
