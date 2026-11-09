// La comida y la bebida en 3D, a su tamaño de verdad (o casi: un poco más grande, para que se lea en la mano): frutas
// y verduras, tarros, jarras y vasos, cuencos, panes, tartas, carnes crudas y asadas, quesos, huevos y peces. Se ven en
// la mano de quien las lleva (actors.js) y tiradas en el suelo (icons.js, dropModel). Cada una, un grupo con el centro
// de lo que se agarra en el origen; se hace una vez por objeto y se clona.
import * as THREE from 'three';
import { mat } from './geo.js';
import { ITEMS, FISH } from '../items.js';
import { apagado } from '../arte.js';

const MATS = new Map();
const M = (c, o = {}) => { const k = c + JSON.stringify(o); if (!MATS.has(k)) MATS.set(k, mat({ color: apagado(c), roughness: 0.7, ...o })); return MATS.get(k); };
const GLASS = () => M('#d8e4e8', { transparent: true, opacity: 0.45, roughness: 0.08, metalness: 0.1 });
const BALL = new THREE.SphereGeometry(1, 16, 12), CYL = new THREE.CylinderGeometry(1, 1, 1, 18), CONE = new THREE.ConeGeometry(1, 1, 14);
const TORUS = new THREE.TorusGeometry(1, 0.22, 8, 16);
function add(g, geo, m, p = [0, 0, 0], s = 1, r = [0, 0, 0]) {
  const o = new THREE.Mesh(geo, m); o.position.set(...p); o.scale.set(...(typeof s === 'number' ? [s, s, s] : s)); o.rotation.set(...r);
  o.castShadow = true; g.add(o); return o;
}
// Una esfera deformada (manzana, tomate, calabaza acostillada, huevo…)
function blob(f, seg = 20) {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75)), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); f(v); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
const APPLE = blob(v => { const k = 1 - 0.25 * Math.exp(-((1 - Math.abs(v.y)) ** 2) * 30) * (v.y > 0 ? 1 : 0.6); v.x *= k; v.z *= k; v.y *= 0.9; });
const RIBBED = blob(v => { const a = Math.atan2(v.z, v.x), k = 1 + 0.06 * Math.cos(a * 10); v.x *= k; v.z *= k; v.y *= 0.72 - 0.1 * Math.max(0, v.y); }, 28);
const EGG = blob(v => { v.y *= 1.28; if (v.y > 0) { v.x *= 1 - 0.18 * v.y / 1.28; v.z *= 1 - 0.18 * v.y / 1.28; } });
const LUMP = blob(v => { const k = 1 + 0.12 * Math.sin(v.x * 7) * Math.sin(v.y * 6 + 1) * Math.sin(v.z * 5 + 2); v.multiplyScalar(k); });
const SLAB = blob(v => { v.y *= 0.32; v.x *= 1.35; const k = 1 + 0.08 * Math.sin(Math.atan2(v.z, v.x) * 3); v.x *= k; v.z *= k; });
const LOAF = blob(v => { v.x *= 1.6; v.y = v.y > 0 ? v.y * 0.75 : v.y * 0.3; });
const FISHG = blob(v => { v.x *= 0.35; v.y *= 0.55 * (1 - 0.6 * Math.max(0, -v.z) ** 2); v.z *= 1.9; });

// Familias de comida
const fruit = (geo, c, s, { stem = '#5a3a20', leaf = null, calyx = null } = {}) => g => {
  add(g, geo, M(c, { roughness: 0.45 }), [0, 0, 0], s);
  if (stem) add(g, CYL, M(stem), [0, s * 0.95, 0], [0.006, s * 0.4, 0.006], [0.2, 0, 0.1]);
  if (leaf) add(g, BALL, M(leaf, { side: THREE.DoubleSide }), [0.02, s * 1.0, 0], [s * 0.35, 0.004, s * 0.16], [0, 0.5, 0.4]);
  if (calyx) for (let i = 0; i < 5; i++) { const a = i * 1.257; add(g, BALL, M(calyx), [Math.cos(a) * s * 0.25, s * 0.86, Math.sin(a) * s * 0.25], [s * 0.22, 0.006, s * 0.07], [0, -a, 0.25]); }
};
const jar = (fill, lid = '#c8b8a0') => g => {
  add(g, CYL, GLASS(), [0, 0, 0], [0.04, 0.09, 0.04]);
  add(g, CYL, M(fill, { roughness: 0.3 }), [0, -0.008, 0], [0.036, 0.07, 0.036]);
  add(g, CYL, M(lid, { roughness: 0.95 }), [0, 0.05, 0], [0.05, 0.014, 0.05]);
  add(g, TORUS, M('#8a5a34'), [0, 0.042, 0], [0.042, 0.042, 0.03], [Math.PI / 2, 0, 0]);   // (el cordel)
};
const mug = (drink, foam = null) => g => {
  add(g, CYL, M('#8a5a34', { roughness: 0.6 }), [0, 0, 0], [0.045, 0.11, 0.045]);   // (de madera, con aros)
  for (const y of [-0.035, 0.035]) add(g, CYL, M('#4a4440', { metalness: 0.5, roughness: 0.4 }), [0, y, 0], [0.047, 0.008, 0.047]);
  add(g, TORUS, M('#7a4e2c'), [0.055, 0, 0], [0.025, 0.035, 0.03], [0, 0, 0]);
  add(g, CYL, M(drink, { roughness: 0.2 }), [0, 0.05, 0], [0.04, 0.008, 0.04]);
  if (foam) add(g, BALL, M(foam, { roughness: 0.9 }), [0, 0.058, 0], [0.042, 0.014, 0.042]);
};
const glass = drink => g => {
  add(g, CYL, GLASS(), [0, 0, 0], [0.033, 0.1, 0.033]);
  add(g, CYL, M(drink, { roughness: 0.15, transparent: true, opacity: 0.85 }), [0, -0.012, 0], [0.03, 0.07, 0.03]);
};
const bottle = (drink, glassy = true) => g => {
  add(g, CYL, glassy ? GLASS() : M('#e8e2d6', { roughness: 0.4 }), [0, 0, 0], [0.035, 0.12, 0.035]);
  add(g, CONE, glassy ? GLASS() : M('#e8e2d6', { roughness: 0.4 }), [0, 0.085, 0], [0.035, 0.05, 0.035]);
  add(g, CYL, M('#8a6a4a'), [0, 0.12, 0], [0.012, 0.02, 0.012]);
  if (glassy) add(g, CYL, M(drink, { roughness: 0.2 }), [0, -0.01, 0], [0.032, 0.095, 0.032]);
};
const bowl = (soup, bits) => g => {
  const b = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  add(g, b, M('#a87a50', { side: THREE.DoubleSide }), [0, 0.02, 0], [0.07, 0.05, 0.07]);
  add(g, CYL, M(soup, { roughness: 0.3 }), [0, 0.012, 0], [0.062, 0.004, 0.062]);
  for (let i = 0; i < 6; i++) { const a = i * 1.1; add(g, BALL, M(bits[i % bits.length]), [Math.cos(a) * 0.035, 0.016, Math.sin(a) * 0.03], 0.011); }
};
const loaf = (c, round = false) => g => {
  add(g, round ? blob(v => { v.y = v.y > 0 ? v.y * 0.6 : v.y * 0.25; }) : LOAF, M(c, { roughness: 0.9 }), [0, 0, 0], round ? 0.07 : 0.06);
  for (let i = -1; i <= 1; i++) add(g, CYL, M('#e8d0a0', { roughness: 1 }), [round ? 0 : i * 0.03, round ? 0.043 : 0.044, 0], [0.004, 0.003, round ? 0.04 : 0.03], [0, round ? i * 1.05 : 0, Math.PI / 2 * 0]);
};
const pie = (filling, crust = '#c8904a') => g => {
  add(g, CYL, M(crust, { roughness: 0.9 }), [0, 0, 0], [0.09, 0.03, 0.09]);
  add(g, CYL, M(filling, { roughness: 0.6 }), [0, 0.016, 0], [0.08, 0.004, 0.08]);
  add(g, TORUS, M(crust, { roughness: 0.9 }), [0, 0.016, 0], [0.085, 0.085, 0.04], [Math.PI / 2, 0, 0]);
};
const raw = (c, fat = '#f0e0d0') => g => {
  add(g, SLAB, M(c, { roughness: 0.55 }), [0, 0, 0], 0.06);
  add(g, BALL, M(fat, { roughness: 0.6 }), [0.04, 0.004, 0.035], [0.05, 0.016, 0.012], [0, 0.5, 0]);
};
const roast = (c, bone = true) => g => {
  add(g, LUMP, M(c, { roughness: 0.8 }), [0, 0, 0], [0.065, 0.045, 0.05]);
  if (bone) { add(g, CYL, M('#efe6d2'), [0.085, 0, 0], [0.01, 0.06, 0.01], [0, 0, Math.PI / 2]); add(g, BALL, M('#efe6d2'), [0.115, 0, 0], 0.016); }
};
const fishModel = (c, cooked = false) => g => {
  const body = M(cooked ? '#a8703a' : c, { roughness: cooked ? 0.8 : 0.35, metalness: cooked ? 0 : 0.15 });
  add(g, FISHG, body, [0, 0, 0], 0.06);
  add(g, CONE, body, [0, 0, -0.13], [0.04, 0.05, 0.008], [Math.PI / 2, 0, Math.PI / 2]);   // la cola
  for (const s of [-1, 1]) add(g, BALL, M('#101010', { roughness: 0.2 }), [s * 0.015, 0.008, 0.08], 0.006);
};
const pile = (c, n, r, spread) => g => { for (let i = 0; i < n; i++) { const a = i * 2.4, d = spread * Math.sqrt(i / n); add(g, BALL, M(c, { roughness: 0.4 }), [Math.cos(a) * d, (i % 3) * r * 0.6, Math.sin(a) * d], r); } };

const BUILD = {
  manzana: fruit(APPLE, '#b8382a', 0.045, { leaf: '#4a7a32' }),
  manzana_asada: fruit(APPLE, '#7a3a22', 0.045, { stem: '#3a2414' }),
  tomate: fruit(APPLE, '#c83a24', 0.045, { stem: null, calyx: '#3f7a2e' }),
  coco: g => add(g, LUMP, M('#5a4228', { roughness: 1 }), [0, 0, 0], 0.075),
  coco_tostado: g => { const h = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); add(g, h, M('#5a4228', { roughness: 1, side: THREE.DoubleSide }), [0, 0.03, 0], 0.075); add(g, CYL, M('#e8d4b0', { roughness: 0.8 }), [0, 0.028, 0], [0.068, 0.006, 0.068]); },
  calabaza: g => { add(g, RIBBED, M('#d8782a', { roughness: 0.55 }), [0, 0, 0], 0.11); add(g, CYL, M('#5a4a28'), [0, 0.085, 0], [0.012, 0.04, 0.012], [0.2, 0, 0]); },
  nabo: g => { add(g, EGG, M('#ece2e6', { roughness: 0.5 }), [0, 0, 0], [0.04, -0.04, 0.04]); add(g, BALL, M('#9a5a9a'), [0, 0.02, 0], [0.041, 0.022, 0.041]); for (let i = 0; i < 3; i++) add(g, BALL, M('#5a8a3a', { side: THREE.DoubleSide }), [Math.cos(i * 2) * 0.02, 0.09, Math.sin(i * 2) * 0.02], [0.012, 0.06, 0.004], [Math.cos(i * 2) * 0.4, i * 2, Math.sin(i * 2) * 0.4]); },
  zanahoria: g => { add(g, CONE, M('#d8742a', { roughness: 0.6 }), [0, -0.05, 0], [0.025, -0.16, 0.025]); for (let i = 0; i < 3; i++) add(g, BALL, M('#5a8a3a', { side: THREE.DoubleSide }), [0, 0.07, 0], [0.01, 0.06, 0.004], [0.3 * (i - 1), i, 0]); },
  maiz: g => { add(g, blob(v => { v.y *= 3; }), M('#e0c040', { roughness: 0.5 }), [0, 0, 0], 0.03); for (const s of [-1, 1]) add(g, BALL, M('#8aa058', { side: THREE.DoubleSide }), [s * 0.02, -0.02, 0], [0.012, 0.09, 0.03], [0, 0, s * 0.25]); },
  fresa: g => { add(g, blob(v => { if (v.y < 0) { v.x *= 1 + v.y * 0.55; v.z *= 1 + v.y * 0.55; } v.y *= 1.15; }), M('#c8343a', { roughness: 0.4 }), [0, 0, 0], 0.025); for (let i = 0; i < 5; i++) { const a = i * 1.257; add(g, BALL, M('#3f7a2e'), [Math.cos(a) * 0.01, 0.027, Math.sin(a) * 0.01], [0.012, 0.003, 0.005], [0, -a, 0]); } },
  bayas: pile('#3a3a7a', 12, 0.011, 0.035),
  pinones: pile('#d8b888', 14, 0.008, 0.03),
  trufa: g => add(g, LUMP, M('#2a2420', { roughness: 1 }), [0, 0, 0], 0.035),
  pulpa: g => { add(g, blob(v => { v.y *= 0.35; v.x *= 1.3; }), M('#7a9a5a', { roughness: 0.5 }), [0, 0, 0], 0.05); add(g, CYL, M('#c8d8a0'), [0, 0.018, 0], [0.05, 0.002, 0.035]); },
  huevo: g => add(g, EGG, M('#e8dcc8', { roughness: 0.5 }), [0, 0, 0], 0.025),
  huevo_pato: g => add(g, EGG, M('#d8e0d0', { roughness: 0.5 }), [0, 0, 0], 0.03),
  queso: g => { add(g, CYL, M('#e8c860', { roughness: 0.6 }), [0, 0, 0], [0.08, 0.06, 0.08]); add(g, CYL, M('#c8a040'), [0, 0.031, 0], [0.082, 0.004, 0.082]); },
  queso_cabra: g => add(g, CYL, M('#f0ead8', { roughness: 0.7 }), [0, 0, 0], [0.06, 0.05, 0.06]),
  mantequilla: g => { add(g, new THREE.BoxGeometry(1, 1, 1), M('#f0d870', { roughness: 0.5 }), [0, 0.012, 0], [0.08, 0.035, 0.05]); add(g, new THREE.BoxGeometry(1, 1, 1), M('#e8e0d0', { roughness: 1 }), [0, -0.008, 0], [0.1, 0.004, 0.07]); },
  tortilla: g => { add(g, CYL, M('#e8c050', { roughness: 0.7 }), [0, 0, 0], [0.09, 0.035, 0.09]); add(g, CYL, M('#c89a3a'), [0, 0.018, 0], [0.085, 0.003, 0.085]); },
  pan: loaf('#b8783a'), pan_bellota: loaf('#7a4e2c', true),
  tostada_miel: g => { add(g, new THREE.BoxGeometry(1, 1, 1), M('#c8904a', { roughness: 0.9 }), [0, 0, 0], [0.1, 0.018, 0.09]); add(g, new THREE.BoxGeometry(1, 1, 1), M('#e0a030', { roughness: 0.15 }), [0, 0.011, 0], [0.08, 0.004, 0.07]); },
  tarta_calabaza: pie('#d8782a'),
  estofado: bowl('#8a7a3a', ['#6a8a4a', '#c86a3a']), sopa_verduras: bowl('#b89a50', ['#d8742a', '#5a8a3a', '#e0c040']),
  palomitas: g => { add(g, CONE, M('#e8e0d0', { roughness: 1 }), [0, -0.03, 0], [0.045, -0.11, 0.045]); for (let i = 0; i < 9; i++) { const a = i * 2.3; add(g, LUMP, M('#f4ecd0', { roughness: 1 }), [Math.cos(a) * 0.025, 0.03 + (i % 3) * 0.01, Math.sin(a) * 0.025], 0.014); } },
  mermelada: jar('#5a2a4a'), mermelada_fresa: jar('#a8242a'), miel: jar('#d89a28', '#e8dcc0'),
  leche: bottle('#f4f0e8', false), leche_cabra: bottle('#f4f0e8', false), nata: bowl('#f4efe4', ['#f4efe4']),
  sidra: glass('#d8b048'), cerveza: mug('#c88a2a', '#f4eee0'), hidromiel: mug('#d8a030'),
  carne_ave: raw('#e8a898'), carne_conejo: raw('#d88a80'), carne_vaca: raw('#a8303a'), carne_cordero: raw('#b8484a'), carne_cabra: raw('#a83a3a'), carne_cerdo: raw('#e0909a'), carne_venado: raw('#8a2a30'), carne_jabali: raw('#9a3a38'),
  pollo_asado: g => { add(g, EGG, M('#b8783a', { roughness: 0.7 }), [0, 0.02, 0], [0.035, 0.05, 0.035]); add(g, CYL, M('#efe6d2'), [0, -0.05, 0], [0.008, 0.05, 0.008]); add(g, BALL, M('#efe6d2'), [0, -0.078, 0], 0.013); },
  conejo_asado: roast('#a06a34'), cordero_asado: roast('#8a5a2a'), cabra_asada: roast('#7a4e2a'), venado_asado: roast('#6a3e22'), jabali_asado: roast('#6a4228'),
  filete: g => { add(g, SLAB, M('#6a3a22', { roughness: 0.8 }), [0, 0, 0], 0.065); for (let i = -1; i <= 1; i++) add(g, CYL, M('#2a1a10'), [i * 0.025, 0.021, 0], [0.004, 0.002, 0.05], [0, 0.6, 0]); },
  chuleta: roast('#9a6034'),
  pescado_asado: fishModel('#a8703a', true),
};
for (const [id, f] of Object.entries(FISH)) BUILD[id] ||= f.crab ? g => { add(g, blob(v => { v.y *= 0.45; v.x *= 1.3; }), M(f.color, { roughness: 0.5 }), [0, 0, 0], 0.05); for (const s of [-1, 1]) add(g, BALL, M(f.color), [s * 0.075, 0, 0.03], [0.022, 0.016, 0.03]); } : f.round ? g => add(g, LUMP, M(f.color, { roughness: 0.5 }), [0, 0, 0], 0.05) : fishModel(f.color);

const CACHE = new Map();
// El modelo de una comida o bebida (o null si no lo tiene): un grupo nuevo cada vez (comparte geometrías y materiales)
export function foodModel(id) {
  const f = BUILD[id];
  if (!f || !ITEMS[id]) return null;
  if (!CACHE.has(id)) { const g = new THREE.Group(); f(g); CACHE.set(id, g); }
  return CACHE.get(id).clone();
}
export const hasFood = id => !!BUILD[id] && !!ITEMS[id];
