// La memoria de vídeo que piden las texturas y los búferes de dibujo, medida donde se piden: se apuntan las llamadas
// que reservan sitio en la gráfica (texStorage, texImage, renderbufferStorage) y las que lo sueltan (deleteTexture,
// deleteRenderbuffer). Así sale lo que de verdad ocupan, compartidas o no: renderer.info.memory.textures solo cuenta
// objetos, y una de 2048² en coma flotante pesa como cien de 64². Para F3 y el banco; no cambia nada de lo que se pinta.
// (los bytes por texel de cada formato con tamaño; los que no están, 4)
const BPP = {
  0x8229: 1, 0x822B: 2, 0x8051: 4, 0x8058: 4, 0x8C41: 4, 0x8C43: 4, 0x8056: 2, 0x8057: 2, 0x8D62: 2,   // R8, RG8, RGB8, RGBA8, SRGB8, SRGB8_A8, RGBA4, RGB5_A1, RGB565
  0x822D: 2, 0x822E: 4, 0x822F: 4, 0x8230: 8, 0x881A: 8, 0x881B: 8, 0x8814: 16, 0x8815: 16, 0x8C3A: 4,   // R16F, R32F, RG16F, RG32F, RGBA16F, RGB16F, RGBA32F, RGB32F, R11G11B10F
  0x81A5: 2, 0x81A6: 4, 0x8CAC: 4, 0x88F0: 4, 0x8CAD: 8, 0x8D48: 1, 0x84F9: 4, 0x1902: 4,   // profundidad y plantilla
  0x1906: 1, 0x1909: 1, 0x190A: 2,   // ALPHA, LUMINANCE, LUMINANCE_ALPHA
};
const bpp = f => BPP[f] ?? 4;

// Empieza a apuntar en un contexto (una vez; los que ya estaban subidos antes no cuentan). Devuelve la cuenta.
// Solo se envuelven las llamadas que reservan o sueltan, que son pocas (al subir algo): la textura a la que van se le
// pregunta entonces al contexto (getParameter, sin ir a la gráfica: el navegador lleva la cuenta de lo enlazado). Las de
// enlazar (bindTexture, activeTexture), que Three hace cientos de veces por fotograma, quedan tal cual
export function trackVram(gl) {
  if (!gl || gl.__vram) return gl?.__vram || null;
  const V = (gl.__vram = { tex: new Map(), rb: new Map(), uploads: 0 });
  const CUBE = gl.TEXTURE_CUBE_MAP, faceOf = t => (t >= gl.TEXTURE_CUBE_MAP_POSITIVE_X && t <= gl.TEXTURE_CUBE_MAP_NEGATIVE_Z ? CUBE : t);
  const BIND = new Map([[gl.TEXTURE_2D, gl.TEXTURE_BINDING_2D], [CUBE, gl.TEXTURE_BINDING_CUBE_MAP], [gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BINDING_2D_ARRAY], [gl.TEXTURE_3D, gl.TEXTURE_BINDING_3D]].filter(([a, b]) => a !== undefined && b !== undefined));
  const wrap = (name, after) => { const f = gl[name]; if (typeof f !== 'function') return; gl[name] = function (...a) { const r = f.apply(this, a); try { after(a, r); } catch {} return r; }; };
  const cur = target => { const b = BIND.get(faceOf(target)); return b === undefined ? null : gl.getParameter(b); };
  wrap('deleteTexture', ([tex]) => { V.tex.delete(tex); });
  // (texStorage reserva todos los niveles de una vez)
  wrap('texStorage2D', ([t, levels, f, w, h]) => {
    const tex = cur(t); if (!tex) return;
    let b = 0; for (let l = 0; l < levels; l++) b += Math.max(1, w >> l) * Math.max(1, h >> l) * bpp(f);
    V.tex.set(tex, { bytes: b * (t === CUBE ? 6 : 1), w, h, f, levels }); V.uploads++;
  });
  wrap('texStorage3D', ([t, levels, f, w, h, d]) => {
    const tex = cur(t); if (!tex) return;
    let b = 0; for (let l = 0; l < levels; l++) b += Math.max(1, w >> l) * Math.max(1, h >> l) * d * bpp(f);
    V.tex.set(tex, { bytes: b, w, h, f, levels }); V.uploads++;
  });
  // (texImage, nivel a nivel; el 0 manda el tamaño, y generateMipmap le suma un tercio)
  wrap('texImage2D', a => {
    const [t, level, f] = a, tex = cur(t); if (!tex) return;
    let w, h;
    if (a.length >= 8) { w = a[3]; h = a[4]; } else { const s = a[5]; w = s?.videoWidth || s?.naturalWidth || s?.displayWidth || s?.width || 0; h = s?.videoHeight || s?.naturalHeight || s?.displayHeight || s?.height || 0; }
    const e = V.tex.get(tex) || { bytes: 0, lv: new Map(), w, h, f, levels: 0 };
    if (!e.lv) return;   // (subida encima de un texStorage: no reserva)
    e.lv.set(t + ':' + level, w * h * bpp(f));
    if (level === 0) { e.w = w; e.h = h; e.f = f; e.mip = false; }
    e.bytes = [...e.lv.values()].reduce((s, x) => s + x, 0) * (e.mip ? 4 / 3 : 1);
    V.tex.set(tex, e); V.uploads++;
  });
  wrap('generateMipmap', ([t]) => { const e = V.tex.get(cur(t)); if (e?.lv && !e.mip) { e.mip = true; e.bytes *= 4 / 3; } });
  const rbNow = () => gl.getParameter(gl.RENDERBUFFER_BINDING);
  wrap('deleteRenderbuffer', ([rb]) => { V.rb.delete(rb); });
  wrap('renderbufferStorage', ([, f, w, h]) => { const rb = rbNow(); if (rb) V.rb.set(rb, w * h * bpp(f)); });
  wrap('renderbufferStorageMultisample', ([, s, f, w, h]) => { const rb = rbNow(); if (rb) V.rb.set(rb, w * h * bpp(f) * Math.max(1, s)); });
  return V;
}
// Lo que hay ahora: texturas (número y MB) y búferes de dibujo (MB)
export function vramOf(gl) {
  const V = gl?.__vram;
  if (!V) return null;
  let tex = 0, rb = 0;
  for (const e of V.tex.values()) tex += e.bytes;
  for (const b of V.rb.values()) rb += b;
  return { n: V.tex.size, texMB: tex / 1048576, rbMB: rb / 1048576, uploads: V.uploads };
}
// Las mayores, para buscar qué pesa (ancho×alto, formato, MB)
export function vramTop(gl, n = 12) {
  const V = gl?.__vram;
  if (!V) return [];
  return [...V.tex.values()].sort((a, b) => b.bytes - a.bytes).slice(0, n).map(e => `${e.w}×${e.h}:${e.f.toString(16)}:${(e.bytes / 1048576).toFixed(2)}`);
}
