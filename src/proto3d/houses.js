// Prototipo 3D: casas a partir de los mismos planos que el juego (blueprints.js). Muros de yeso con huecos de
// verdad para puertas y ventanas; por fuera, zócalo de piedra y entramado de madera (postes, vigas y riostras),
// ventanas con cristal, cruceta, contraventanas y jardinera; tejado a cuatro aguas con tejas, cumbrera y limas;
// chimenea de piedra y hogar encendido; dentro, suelo de tablas, rodapié, muebles y un candelabro. Cada pared
// (norte, sur, este y oeste) va en su grupo y con sus materiales, para poder ocultarla cuando tape la vista;
// el tejado, igual.
import * as THREE from 'three';
import { Builder, mat } from './geo.js';
import { plaster, planks, roofTiles, stone, wood } from './textures.js';
import { buildFurniture } from './furniture.js';

export const WALL_H = 2.8;           // alto de los muros (una persona mide 1,3)
const T = 0.12;                      // medio grueso del muro
const PLINTH = 0.42;                 // zócalo de piedra
const WIN = { half: 0.3, y0: 1.0, y1: 1.95 };
const DOOR = { half: 0.42, y1: 2.05 };
const OVERHANG = 0.5;                // alero
const PITCH = Math.tan((33 * Math.PI) / 180);
const BEAM = { post: 0.04, rail: 0.034, brace: 0.028 };   // cuánto sale cada madera del muro (distinto: así no se pisan)
export const ROOF_COLORS = { tejado_rojo: '#c95a3c', tejado_azul: '#4a6aa8', tejado_gris: '#6a6e78', tejado_verde: '#4a8a5a', tejado_paja: '#d8b060' };

// Texturas compartidas (cada pared clona sus materiales, que son los que se desvanecen)
let TEX;
const tex = () => (TEX ||= { plaster: plaster(), planks: planks(), stone: stone(), timber: wood('#5e3b22'), door: wood('#9a6438'), frame: wood('#4a2e1a'), shutter: wood('#3f7a44'), roofs: {} });
const roofTex = c => (tex().roofs[c] ||= roofTiles(c));

function sideMaterials() {
  const t = tex();
  return {
    plaster: mat({ map: t.plaster }), stone: mat({ map: t.stone }), timber: mat({ map: t.timber, roughness: 0.8 }),
    frame: mat({ map: t.frame, roughness: 0.7 }), shutter: mat({ map: t.shutter }), door: mat({ map: t.door }),
    glass: new THREE.MeshStandardMaterial({ color: '#a8d4f0', roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.4, depthWrite: false, emissive: '#ffb050', emissiveIntensity: 0 }),
    box: mat({ color: '#7a4a2a' }), soil: mat({ color: '#4a3020' }),
    flower: mat({ roughness: 0.6 }), leaves: mat({ color: '#3f8a32', flatShading: true }),
  };
}

// Madera plana sobre una pared, de p0 a p1: w de ancho a lo largo de b, saliendo d hacia n (sin cara de atrás)
function beam(B, p0, p1, b, n, w, d) {
  const V = (p, k1, k2) => [p[0] + b[0] * k1 + n[0] * k2, p[1] + b[1] * k1 + n[1] * k2, p[2] + b[2] * k1 + n[2] * k2];
  const a = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(...a), h = w / 2, an = a.map(v => v / L);
  const A0 = V(p0, -h, d), A1 = V(p0, h, d), B0 = V(p1, -h, d), B1 = V(p1, h, d), C0 = V(p0, -h, 0), C1 = V(p0, h, 0), D0 = V(p1, -h, 0), D1 = V(p1, h, 0);
  B.quadN(A0, B0, B1, A1, n, [[0, 0], [L, 0], [L, w], [0, w]]);                             // cara de fuera
  B.quadN(C1, A1, B1, D1, b, [[0, 0], [0, d], [L, d], [L, 0]]);                              // cantos
  B.quadN(D0, B0, A0, C0, b.map(v => -v), [[L, 0], [L, d], [0, d], [0, 0]]);
  B.quadN(D1, B1, B0, D0, an, [[0, 0], [0, d], [w, d], [w, 0]]);                             // puntas
  B.quadN(C0, A0, A1, C1, an.map(v => -v), [[0, 0], [0, d], [w, d], [w, 0]]);
}

// Una casa. bp: plano (placed, floor, roof); x0, y0: esquina; w, h: tamaño en casillas; roofId: color del tejado
export function buildHouse(bp, { x0, y0, w, h, roofId = 'tejado_rojo', lights = true }) {
  const group = new THREE.Group(), colliders = [], doors = [], glass = [];
  const at = (x, y) => (bp.placed[`${x},${y}`] || '').split('@')[0];
  const X0 = x0 + 0.5, X1 = x0 + w - 0.5, Z0 = y0 + 0.5, Z1 = y0 + h - 0.5;   // líneas de los muros (por su centro)
  // Las cuatro paredes: dónde van, hacia dónde miran por fuera, de dónde a dónde llega el muro (a, b: las de
  // delante y detrás cierran las esquinas) y qué hay en cada casilla
  const SIDES = {
    n: { axis: 'x', c: Z0, out: -1, a: X0 - T, b: X1 + T, tile: i => at(i, y0) },
    s: { axis: 'x', c: Z1, out: 1, a: X0 - T, b: X1 + T, tile: i => at(i, y0 + h - 1) },
    w: { axis: 'z', c: X0, out: -1, a: Z0 + T, b: Z1 - T, tile: i => at(x0, i) },
    e: { axis: 'z', c: X1, out: 1, a: Z0 + T, b: Z1 - T, tile: i => at(x0 + w - 1, i) },
  };
  const sides = {};
  for (const [key, S] of Object.entries(SIDES)) {
    const M = sideMaterials(), g = new THREE.Group(), X = S.axis === 'x';
    const B = { walls: new Builder(), plinth: new Builder(), beams: new Builder(), frames: new Builder(), shutters: new Builder(), boxes: new Builder(), soil: new Builder() };
    // Punto del muro: u a lo largo, y en alto, k hacia fuera (desde el centro del muro)
    const P = (u, y, k = 0) => (X ? [u, y, S.c + S.out * k] : [S.c + S.out * k, y, u]);
    const nOut = X ? [0, 0, S.out] : [S.out, 0, 0], nIn = nOut.map(v => -v), along = X ? [1, 0, 0] : [0, 0, 1], up = [0, 1, 0];
    const box = (b, u0, u1, ya, yb, k0, k1) => {
      const a0 = Math.min(u0, u1), a1 = Math.max(u0, u1), c0 = Math.min(S.c + S.out * k0, S.c + S.out * k1), c1 = Math.max(S.c + S.out * k0, S.c + S.out * k1);
      if (X) b.box(a0, ya, c0, a1, yb, c1); else b.box(c0, ya, a0, c1, yb, a1);
    };
    // Por fuera, la pared llega de esquina a esquina (las de los lados, también por delante de los muros de delante y detrás)
    const ea = X ? S.a : S.a - 2 * T, eb = X ? S.b : S.b + 2 * T;
    // Huecos de esta pared: puertas y ventanas, en el centro de su casilla
    const holes = [], paintings = [], blooms = [], leaves = [];
    for (let i = Math.floor(S.a); i < S.b; i++) {
      const id = S.tile(i);
      if (id === 'puerta') holes.push({ u: i + 0.5, half: DOOR.half, y0: 0, y1: DOOR.y1, door: true });
      else if (id.startsWith('ventana')) holes.push({ u: i + 0.5, half: WIN.half, y0: WIN.y0, y1: WIN.y1, shutters: id === 'ventana_contraventanas' });
      else if (id === 'muro_cuadro') paintings.push(i + 0.5);
    }
    // El muro: tramos enteros entre huecos, y encima y debajo de cada hueco
    let u = S.a;
    for (const hl of holes) {
      const h0 = hl.u - hl.half, h1 = hl.u + hl.half;
      if (h0 > u) { box(B.walls, u, h0, 0, WALL_H, -T, T); colliders.push(colBox(X, u, h0, S.c, T)); }
      if (hl.y0 > 0) { box(B.walls, h0, h1, 0, hl.y0, -T, T); colliders.push(colBox(X, h0, h1, S.c, T)); }
      box(B.walls, h0, h1, hl.y1, WALL_H, -T, T);
      u = h1;
    }
    if (u < S.b) { box(B.walls, u, S.b, 0, WALL_H, -T, T); colliders.push(colBox(X, u, S.b, S.c, T)); }
    // Zócalo de piedra por fuera (cortado en la puerta). Los de delante y detrás doblan la esquina; los de los
    // lados llegan hasta el centro de esos muros, así no se pisan.
    const pa = X ? S.a - 0.05 : S.a - T, pb = X ? S.b + 0.05 : S.b + T;
    let pu = pa;
    for (const hl of holes.filter(q => q.door)) {
      box(B.plinth, pu, hl.u - hl.half, 0, PLINTH, 0, T + 0.05); pu = hl.u + hl.half;
      box(B.plinth, hl.u - hl.half - 0.1, hl.u + hl.half + 0.1, 0, 0.1, T + 0.05, T + 0.5);   // escalón
    }
    box(B.plinth, pu, pb, 0, PLINTH, 0, T + 0.05);
    // Rodapié por dentro
    let bu = X ? S.a + 2 * T : S.a;
    const be = X ? S.b - 2 * T : S.b;
    for (const hl of holes.filter(q => q.door)) { box(B.frames, bu, hl.u - hl.half, 0, 0.12, -T - 0.02, -T); bu = hl.u + hl.half; }
    if (be > bu) box(B.frames, bu, be, 0, 0.12, -T - 0.02, -T);
    // Entramado por fuera: postes en las esquinas y en cada línea de casilla, vigas abajo, en medio y arriba
    // (cortadas por los huecos) y riostras en diagonal en los tramos lisos
    const blocked = (u0, u1, y) => holes.some(hl => u1 > hl.u - hl.half - 0.07 && u0 < hl.u + hl.half + 0.07 && y > hl.y0 - 0.07 && y < hl.y1 + 0.07);
    const corner = X ? 0 : BEAM.post;   // los de los lados tapan también el canto del poste de la esquina
    for (const pu2 of [ea + 0.07 - corner / 2, eb - 0.07 + corner / 2]) beam(B.beams, P(pu2, PLINTH, T), P(pu2, WALL_H, T), along, nOut, 0.14 + corner, BEAM.post);
    for (let k = Math.ceil(ea + 0.3); k < eb - 0.3; k++) if (!blocked(k - 0.07, k + 0.07, 1.2) && !blocked(k - 0.07, k + 0.07, 0.6)) beam(B.beams, P(k, PLINTH, T), P(k, WALL_H, T), along, nOut, 0.14, BEAM.post);
    const step = 0.02, end = eb + corner;
    for (const y of [PLINTH + 0.06, 1.46, WALL_H - 0.07]) {
      let s0 = ea - corner;
      for (let k = s0; k < end; k += step) {
        if (!blocked(k, k + step, y)) continue;
        if (k - s0 > 0.1) beam(B.beams, P(s0, y, T), P(k, y, T), up, nOut, 0.12, BEAM.rail);
        while (k < end && blocked(k, k + step, y)) k += step;
        s0 = k;
      }
      if (end - s0 > 0.1) beam(B.beams, P(s0, y, T), P(end, y, T), up, nOut, 0.12, BEAM.rail);
    }
    for (let k = Math.floor(ea); k < eb; k++) {
      const u0 = Math.max(ea + 0.14, k + 0.07), u1 = Math.min(eb - 0.14, k + 0.93);
      if (u1 - u0 < 0.6 || holes.some(hl => Math.abs(hl.u - (k + 0.5)) < 1.2)) continue;
      const flip = (k + (X ? 0 : 1)) % 2;
      beam(B.beams, P(flip ? u1 : u0, PLINTH + 0.12, T), P(flip ? u0 : u1, 1.40, T), up, nOut, 0.1, BEAM.brace);
      beam(B.beams, P(flip ? u0 : u1, 1.52, T), P(flip ? u1 : u0, WALL_H - 0.13, T), up, nOut, 0.1, BEAM.brace);
    }
    // Ventanas y puerta
    for (const hl of holes) {
      const h0 = hl.u - hl.half, h1 = hl.u + hl.half;
      // Marco por fuera y por dentro
      for (const [k0, k1] of [[T, T + 0.05], [-T, -T - 0.05]]) {
        box(B.frames, h0 - 0.07, h0, hl.y0, hl.y1 + 0.07, k0, k1);
        box(B.frames, h1, h1 + 0.07, hl.y0, hl.y1 + 0.07, k0, k1);
        box(B.frames, h0, h1, hl.y1, hl.y1 + 0.07, k0, k1);
      }
      if (hl.door) {
        // Hoja de tablas, abierta hacia fuera casi del todo, con sus refuerzos y el tirador
        const lw = hl.half * 2 - 0.03, leaf = new Builder(), bars = new Builder();
        leaf.box(0, 0.03, -0.03, lw, DOOR.y1 - 0.04, 0.03);
        for (const y of [0.3, 1.0, 1.7]) bars.box(0.05, y, 0.03, lw - 0.05, y + 0.1, 0.05);
        bars.box(lw - 0.14, 1.0, -0.06, lw - 0.1, 1.1, -0.03);
        const hinge = new THREE.Group(), beta = 1.95;
        hinge.position.set(...P(h0 + 0.02, 0, T + 0.04));
        // a: 0 cerrada (tapando el hueco por fuera), 1 abierta
        const setAngle = a => { const b = beta * a, d = [along[0] * Math.cos(b) + nOut[0] * Math.sin(b), along[2] * Math.cos(b) + nOut[2] * Math.sin(b)]; hinge.rotation.y = Math.atan2(-d[1], d[0]); };
        setAngle(1);
        hinge.add(leaf.mesh(M.door), bars.mesh(M.frame));
        g.add(hinge);
        const c = P(hl.u, 0, T + 0.2);
        doors.push({ x: c[0], z: c[2], open: true, amount: 1, setAngle, col: colBox(X, h0, h1, S.c + S.out * (T + 0.04), 0.05) });
        continue;
      }
      // Cristal con cruceta, en medio del muro, y alféizar que sale por los dos lados
      const gl = new Builder();
      box(gl, h0, h1, hl.y0, hl.y1, -0.008, 0.008);
      g.add(Object.assign(gl.mesh(M.glass, { cast: false, receive: false }), { renderOrder: 2 }));
      box(B.frames, hl.u - 0.022, hl.u + 0.022, hl.y0, hl.y1, -0.03, 0.03);
      box(B.frames, h0, h1, (hl.y0 + hl.y1) / 2 - 0.022, (hl.y0 + hl.y1) / 2 + 0.022, -0.03, 0.03);
      box(B.frames, h0 - 0.1, h1 + 0.1, hl.y0 - 0.06, hl.y0, -T - 0.08, T + 0.1);
      if (hl.shutters) {
        // Contraventanas verdes a los lados (con sus listones) y jardinera con flores debajo
        for (const [a0, a1] of [[h0 - 0.38, h0 - 0.08], [h1 + 0.08, h1 + 0.38]]) {
          box(B.shutters, a0, a1, hl.y0 - 0.02, hl.y1 + 0.04, T + 0.05, T + 0.085);
          for (let y = hl.y0 + 0.1; y < hl.y1; y += 0.19) box(B.frames, a0 + 0.03, a1 - 0.03, y, y + 0.035, T + 0.085, T + 0.1);
        }
        box(B.boxes, h0 - 0.12, h1 + 0.12, hl.y0 - 0.3, hl.y0 - 0.08, T + 0.1, T + 0.3);
        box(B.soil, h0 - 0.09, h1 + 0.09, hl.y0 - 0.1, hl.y0 - 0.075, T + 0.125, T + 0.275);
        const seed = Math.abs(Math.sin(hl.u * 12.9898 + S.c * 78.233) * 43758.5453);
        for (let k = 0; k < 7; k++) {
          const fu = h0 - 0.05 + (k / 6) * (h1 - h0 + 0.1);
          blooms.push({ p: P(fu, hl.y0 - 0.02 + (k % 2) * 0.05, T + 0.2), s: [0.055, 0.055, 0.055], c: BLOOMS[Math.floor(seed + k * 3) % 5] });
          leaves.push({ p: P(fu + 0.04, hl.y0 - 0.06, T + 0.18), s: [0.075, 0.05, 0.075] });
        }
      }
    }
    // Cuadro colgado por dentro: marco y un paisaje mirando hacia dentro, con la derecha de quien lo mira
    // (nOut × arriba) para que no salga del revés
    const R = [-nOut[2], 0, nOut[0]];
    for (const pu2 of paintings) {
      box(B.frames, pu2 - 0.4, pu2 + 0.4, 1.12, 1.78, -T, -T - 0.035);
      const c = P(pu2, 1.45, -T - 0.037), at2 = (s, t) => [c[0] + R[0] * s * 0.33, c[1] + t * 0.26, c[2] + R[2] * s * 0.33];
      const cv = new Builder();
      cv.quadN(at2(-1, -1), at2(1, -1), at2(1, 1), at2(-1, 1), nIn, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      g.add(cv.mesh(mat({ map: paintingTex() }), { cast: false }));
    }
    // Flores y hojas de las jardineras: dos mallas instanciadas por pared
    for (const [list, m] of [[blooms, M.flower], [leaves, M.leaves]]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(FLOWER, m, list.length), o = new THREE.Object3D();
      list.forEach((it, i) => { o.position.set(...it.p); o.scale.set(...it.s); o.rotation.set(i, i * 2, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); if (it.c) im.setColorAt(i, new THREE.Color(it.c)); });
      im.castShadow = true;
      g.add(im);
    }
    for (const [k, m] of [['walls', M.plaster], ['plinth', M.stone], ['beams', M.timber], ['frames', M.frame], ['shutters', M.shutter], ['boxes', M.box], ['soil', M.soil]]) if (!B[k].empty) g.add(B[k].mesh(m));
    g.userData = { normal: nOut };
    glass.push(M.glass);
    sides[key] = g;
    group.add(g);
  }
  // Suelo de tablas por dentro
  const fl = new Builder(), fx0 = X0 + T, fx1 = X1 - T, fz0 = Z0 + T, fz1 = Z1 - T;
  fl.quad([fx0, 0.02, fz1], [fx1, 0.02, fz1], [fx1, 0.02, fz0], [fx0, 0.02, fz0], [0, 1, 0], [[fx0 / 2, -fz1 / 2], [fx1 / 2, -fz1 / 2], [fx1 / 2, -fz0 / 2], [fx0 / 2, -fz0 / 2]]);
  group.add(fl.mesh(mat({ map: tex().planks, roughness: 0.6 }), { cast: false }));
  // Tejado y, con los muebles, la chimenea que sale por él
  const roof = buildRoof({ xa: X0 - T - OVERHANG, xb: X1 + T + OVERHANG, za: Z0 - T - OVERHANG, zb: Z1 + T + OVERHANG, y: WALL_H }, roofId);
  group.add(roof.group);
  const furn = buildFurniture(bp, { x0, y0, w, h, wallInner: { n: Z0 + T, s: Z1 - T, w: X0 + T, e: X1 - T }, roofAt: roof.heightAt, lights, wallH: WALL_H });
  group.add(furn.group);
  colliders.push(...furn.colliders);
  for (const c of furn.roofParts) roof.group.add(c);
  return {
    group, sides, roof: roof.group, colliders, doors, glass, lights: furn.lights, fires: furn.fires, anchors: furn.anchors, interior: furn.group,
    inside: { x0: X0 + T, x1: X1 - T, z0: Z0 + T, z1: Z1 - T },
    top: roof.heightAt,   // altura del tejado en (x, z), dentro de bounds
    bounds: { x0: X0 - T - OVERHANG, x1: X1 + T + OVERHANG, z0: Z0 - T - OVERHANG, z1: Z1 + T + OVERHANG, y1: WALL_H + roof.rise + 1.2 },
  };
}
const FLOWER = new THREE.IcosahedronGeometry(1, 0), BLOOMS = ['#ff6a8a', '#ffe04a', '#ffffff', '#ff9ab8', '#b48aff'];
const colBox = (X, u0, u1, c, t) => (X ? { x0: Math.min(u0, u1), x1: Math.max(u0, u1), z0: c - t, z1: c + t } : { x0: c - t, x1: c + t, z0: Math.min(u0, u1), z1: Math.max(u0, u1) });

// Paisaje para el cuadro
let PAINT;
function paintingTex() {
  if (PAINT) return PAINT;
  const c = document.createElement('canvas'); c.width = 128; c.height = 96;
  const x = c.getContext('2d'), sky = x.createLinearGradient(0, 0, 0, 96);
  sky.addColorStop(0, '#6eb6e4'); sky.addColorStop(1, '#e4f2f8');
  x.fillStyle = sky; x.fillRect(0, 0, 128, 96);
  x.fillStyle = '#ffe08a'; x.beginPath(); x.arc(96, 24, 10, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#8fb0c8'; x.beginPath(); x.moveTo(0, 60); x.lineTo(30, 30); x.lineTo(52, 50); x.lineTo(76, 26); x.lineTo(128, 62); x.lineTo(128, 96); x.lineTo(0, 96); x.fill();
  x.fillStyle = '#5aa842'; x.beginPath(); x.moveTo(0, 66); x.quadraticCurveTo(40, 46, 80, 62); x.quadraticCurveTo(106, 70, 128, 56); x.lineTo(128, 96); x.lineTo(0, 96); x.fill();
  x.fillStyle = '#3f8030'; x.beginPath(); x.moveTo(0, 80); x.quadraticCurveTo(64, 64, 128, 82); x.lineTo(128, 96); x.lineTo(0, 96); x.fill();
  PAINT = new THREE.CanvasTexture(c); PAINT.colorSpace = THREE.SRGBColorSpace;
  return PAINT;
}

// Tejado a cuatro aguas sobre el rectángulo [xa, xb] × [za, zb] con el alero a la altura y: grosor, canto del
// alero, cara de abajo, cumbrera y limas. heightAt(x, z): altura de la superficie (para la chimenea).
function buildRoof({ xa, xb, za, zb, y }, roofId) {
  const g = new THREE.Group(), color = ROOF_COLORS[roofId] || ROOF_COLORS.tejado_rojo;
  const alongX = xb - xa >= zb - za, half = (alongX ? zb - za : xb - xa) / 2, rise = half * PITCH, th = 0.16, y1 = y + th, top = y1 + rise;
  const cx = (xa + xb) / 2, cz = (za + zb) / 2;
  // Cumbrera de r0 a r1 (a lo largo del lado largo) y las cuatro esquinas del alero
  const r0 = alongX ? [xa + half, top, cz] : [cx, top, za + half], r1 = alongX ? [xb - half, top, cz] : [cx, top, zb - half];
  const E = { nw: [xa, y1, za], ne: [xb, y1, za], se: [xb, y1, zb], sw: [xa, y1, zb] };
  const surf = new Builder(), slope = Math.hypot(half, rise);
  // Cada agua: u a lo largo del alero, v cuesta arriba (en metros), para que las filas de tejas sigan el alero
  const face = (pts, eaveA, eaveB) => {
    const ax = [eaveB[0] - eaveA[0], eaveB[2] - eaveA[2]], al = Math.hypot(...ax), ux = [ax[0] / al, ax[1] / al];
    const uv = pts.map(p => [(p[0] - eaveA[0]) * ux[0] + (p[2] - eaveA[2]) * ux[1], ((p[1] - y1) / rise) * slope]);
    const a = pts[1].map((v, i) => v - pts[0][i]), b = pts[2].map((v, i) => v - pts[0][i]);
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nl = Math.hypot(...n);
    if (pts.length === 4) surf.quad(...pts, n.map(v => v / nl), uv); else surf.tri(...pts, n.map(v => v / nl), uv);
  };
  if (alongX) {
    face([E.sw, E.se, r1, r0], E.sw, E.se); face([E.ne, E.nw, r0, r1], E.ne, E.nw);
    face([E.se, E.ne, r1], E.se, E.ne); face([E.nw, E.sw, r0], E.nw, E.sw);
  } else {
    face([E.se, E.ne, r0, r1], E.se, E.ne); face([E.nw, E.sw, r1, r0], E.nw, E.sw);
    face([E.sw, E.se, r1], E.sw, E.se); face([E.ne, E.nw, r0], E.ne, E.nw);
  }
  g.add(surf.mesh(mat({ map: roofTex(color), roughness: 0.75 })));
  // Canto del alero (todo alrededor) y cara de abajo, de tablas
  const band = new Builder();
  band.box(xa, y, za, xb, y1, zb, { skip: 'py ny' });
  const under = new Builder();
  under.quad([xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb], [0, -1, 0], [[xa, za], [xb, za], [xb, zb], [xa, zb]]);
  g.add(band.mesh(mat({ map: tex().frame })));
  // (la sombra del tejado la da su cara de abajo: el mapa de sombras pinta las caras de espaldas al sol)
  g.add(under.mesh(mat({ map: tex().planks, color: '#d8c8b0' })));
  // Cumbrera y limas: rollos de teja más oscuros
  const capMat = mat({ color: new THREE.Color(color).multiplyScalar(0.72), roughness: 0.7 });
  // (las limas empiezan un poco por dentro de la esquina del alero, para que el rollo no asome por fuera)
  const cap = (p, q, inset = 0) => {
    const a = new THREE.Vector3(...p), b = new THREE.Vector3(...q);
    a.addScaledVector(b.clone().sub(a).normalize(), inset);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len + 0.06, 8), capMat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true;
    g.add(m);
  };
  cap(r0, r1);
  const k = 0.16;
  if (alongX) { cap(E.nw, r0, k); cap(E.sw, r0, k); cap(E.ne, r1, k); cap(E.se, r1, k); } else { cap(E.nw, r0, k); cap(E.ne, r0, k); cap(E.sw, r1, k); cap(E.se, r1, k); }
  const heightAt = (x, z) => y1 + Math.min(x - xa, xb - x, z - za, zb - z, half) * PITCH;
  return { group: g, rise, heightAt };
}
