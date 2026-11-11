// La luz y el color del juego (ver src/arte.js y la sección 4.10 de docs/propuesta-arte.md). Sin posproceso: la curva de tono es la AgX de Three con algo más de contraste, y la luz sale de una tabla por momento
// del día (mediodía, atardecer, noche y lluvia) que se mezcla de forma continua según la hora y el tiempo.
// Los valores vienen de las pruebas de aspecto (docs/pruebas-arte/look/base.js), calibrados sobre capturas.
import * as THREE from 'three';
// La curva: exposición, potencia, contraste y saturación (con poca luz el color se apaga: si no, la pintura se
// satura en la sombra y de noche)
export const CURVA = { exp: 2.2, pot: 1.15, con: 0.4, sat: 1.08 };

// Se instala antes de que se compile ningún material (al cargar este archivo): cambia la función de tono vacía de
// Three (CustomToneMapping) por la AgX con el ajuste, y hace que la sombra del sol se desvanezca antes del borde de
// su zona, para que con la cámara baja no se vea el corte. Devuelve el tono que debe usar el renderer.
let TONE = THREE.AgXToneMapping;
{
  const C = THREE.ShaderChunk, chunk = C.tonemapping_pars_fragment, m = chunk.match(/vec3 AgXToneMapping\( vec3 color \) \{[\s\S]*?\n\}/), hueco = /vec3 CustomToneMapping\( vec3 color \) \{ return color; \}/;
  const sig = 'color = agxDefaultContrastApprox( color );', f = n => n.toFixed(4);
  if (m && hueco.test(chunk) && m[0].includes(sig)) {
    const ajuste = `${sig}
      float lkL = pow(max(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.0), ${f(CURVA.pot)});
      color = clamp(lkL + mix(0.62, ${f(CURVA.sat)}, smoothstep(0.12, 0.48, lkL)) * (pow(max(color, vec3(0.0)), vec3(${f(CURVA.pot)})) - lkL), 0.0, 1.0);
      color = mix(color, color * color * (3.0 - 2.0 * color), ${f(CURVA.con)});`;
    C.tonemapping_pars_fragment = chunk.replace(hueco, '') + '\n' + m[0].replace('AgXToneMapping', 'CustomToneMapping').replace(sig, ajuste);
    TONE = THREE.CustomToneMapping;
  } else console.warn('La curva de tono de Three ha cambiado: se usa AgX tal cual');
  if (C.shadowmap_pars_fragment.includes('return shadow;'))
    C.shadowmap_pars_fragment = C.shadowmap_pars_fragment.replace('return shadow;', 'vec2 lkB = abs(shadowCoord.xy * 2.0 - 1.0); return mix(shadow, 1.0, smoothstep(0.82, 1.0, max(lkB.x, lkB.y)));');
}
export const TONE_MAPPING = TONE;

// La luz de cada momento: cenit y horizonte del cielo (por «cielo», antes de la curva, para que el color visto se
// acerque al de la tabla), sol (color e intensidad), hemisférica (cielo, suelo, intensidad), niebla y nubes. Las
// intensidades son las calibradas en las pruebas (en r160 las luces se dividen por π y AgX aplana).
const H = {
  dia: { cenit: '#7f9fb8', horiz: '#c9d2d0', sol: '#fff0dc', solI: 2.4, hemiC: '#b9c6cf', hemiS: '#6b5f4e', hemiI: 2.1, niebla: [60, 150], cielo: 1.3, nube: 0.82 },
  tarde: { cenit: '#6f7f9a', horiz: '#d9b08c', sol: '#ffc48f', solI: 3.2, hemiC: '#a9a7ae', hemiS: '#5e4e40', hemiI: 2.2, niebla: [50, 140], cielo: 1.15, nube: 0.75 },
  noche: { cenit: '#111a2e', horiz: '#263450', sol: '#8aa2cc', solI: 1.4, hemiC: '#2b3a56', hemiS: '#1c1a18', hemiI: 7, niebla: [24, 90], cielo: 1, nube: 0.5 },   // (azulada: con poca luz la curva apaga el color, y con el gris de antes la noche salía sucia)
  lluvia: { cenit: '#7c858b', horiz: '#a3a9aa', sol: '#d9dedf', solI: 0.8, hemiC: '#9aa3a8', hemiS: '#5a5247', hemiI: 2.6, niebla: [40, 120], cielo: 1.1, nube: 0.6 },   // (más gris que en las pruebas: en el juego salía casi como el mediodía)
};
// (cada momento en números ya listos para mezclar: los colores en lineal y multiplicados por su intensidad). En el juego,
// el sol va al 85 % de la tabla y la luz del cielo al 65 %: con el mismo color, el suelo salía más claro que en las
// pruebas (V69 frente a 55) y, con tanto cielo, las sombras casi no se veían a mediodía
const SOL = 0.85, CIELO = 0.65, lin = c => new THREE.Color(c);
const READY = Object.fromEntries(Object.entries(H).map(([k, h]) => [k, {
  top: lin(h.cenit).multiplyScalar(h.cielo), horizon: lin(h.horiz).multiplyScalar(h.cielo), sun: lin(h.sol).multiplyScalar(h.solI * SOL),
  hemiC: lin(h.hemiC).multiplyScalar(h.hemiI * CIELO), hemiS: lin(h.hemiS).multiplyScalar(h.hemiI * CIELO), near: h.niebla[0], far: h.niebla[1], cloud: h.nube,
}]));
// La luz para un momento dado: night y dusk de 0 a 1 (como los calcula engine.js), wet de 0 a 1 (lluvia o niebla)
const OUT = { top: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color(), hemiC: new THREE.Color(), hemiS: new THREE.Color(), near: 0, far: 0, cloud: 0 };
const WEIGHTS = {};
export function lightAt(night, dusk, wet) {
  const d = dusk * (1 - night), w = WEIGHTS;
  w.dia = (1 - night) * (1 - d); w.tarde = (1 - night) * d; w.noche = night;
  // (con lluvia o niebla, todo va al gris de la lluvia, que de noche también se oscurece)
  const k = wet;
  for (const n of ['dia', 'tarde', 'noche']) w[n] *= 1 - k;
  w.lluvia = k * (1 - night); w.noche += k * night;
  for (const key of ['top', 'horizon', 'sun', 'hemiC', 'hemiS']) OUT[key].setRGB(0, 0, 0);
  OUT.near = OUT.far = OUT.cloud = 0;
  for (const n in w) {
    const p = READY[n], x = w[n];
    if (!x) continue;
    for (const key of ['top', 'horizon', 'sun', 'hemiC', 'hemiS']) OUT[key].r += p[key].r * x, OUT[key].g += p[key].g * x, OUT[key].b += p[key].b * x;
    OUT.near += p.near * x; OUT.far += p.far * x; OUT.cloud += p.cloud * x;
  }
  return OUT;
}

// El color con el que sale un color de la escena (lineal) tras la curva, ya en sRGB: hace falta para la niebla, que
// Three mezcla después del tono, y así el suelo lejano casa con el horizonte del cielo
const M3 = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
const A_IN = [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956];
const A_OUT = [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187];
const AGX_I = [0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859];
const AGX_O = [1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405];
const sigmoide = x => { const x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const srgb = x => { x = Math.max(0, Math.min(1, x)); return x < 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
export function toneOut(c, exposure, out) {
  let v = M3(AGX_I, M3(A_IN, [c.r * exposure, c.g * exposure, c.b * exposure])).map(x => sigmoide(Math.max(0, Math.min(1, (Math.log2(Math.max(x, 1e-10)) + 12.47393) / (4.026069 + 12.47393)))));
  if (TONE === THREE.CustomToneMapping) {
    const L = Math.pow(Math.max(0, 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]), CURVA.pot), sat = 0.62 + (CURVA.sat - 0.62) * smooth(0.12, 0.48, L);
    v = v.map(x => { const s = Math.max(0, Math.min(1, L + sat * (Math.pow(Math.max(0, x), CURVA.pot) - L))); return s + (s * s * (3 - 2 * s) - s) * CURVA.con; });
  }
  const o = M3(A_OUT, M3(AGX_O, v).map(x => Math.pow(Math.max(0, x), 2.2))).map(srgb);
  return out.setRGB(o[0], o[1], o[2], THREE.SRGBColorSpace);
}
