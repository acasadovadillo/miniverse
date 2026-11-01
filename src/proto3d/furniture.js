// Prototipo 3D: muebles de una casa a partir de su plano (las mismas casillas que en el juego): cama de dos
// casillas con cabecero, colcha y almohada; estanterías con libros y tarros; hogar de piedra con fuego y su
// chimenea atravesando el tejado; mesa con sillas mirándola; lámpara de pie, macetas, alfombra, cofre y un
// candelabro colgado del techo. Cada mueble se arrima a la pared que tenga detrás.
import * as THREE from 'three';
import { Builder, mat } from './geo.js';
import { stone, wood, rug, rng } from './textures.js';

let M;
const mats = () => (M ||= {
  wood: mat({ map: wood('#8a5a34'), roughness: 0.7 }), dark: mat({ map: wood('#5e3b22'), roughness: 0.7 }), light: mat({ map: wood('#b88454'), roughness: 0.7 }),
  stone: mat({ map: stone('#9a948a') }), soot: mat({ color: '#2a2220', roughness: 1 }),
  sheet: mat({ color: '#f4efe6', roughness: 0.95 }), quilt: mat({ color: '#d0574a', roughness: 0.95 }), quiltB: mat({ color: '#f0c25a', roughness: 0.95 }),
  pot: mat({ color: '#b8643c', roughness: 0.8 }), soil: mat({ color: '#4a3020' }), leaf: mat({ color: '#4f9a3a', flatShading: true }),
  rug: mat({ map: rug(), roughness: 1 }), brass: mat({ color: '#c89a48', metalness: 0.7, roughness: 0.35 }), iron: mat({ color: '#3a3634', metalness: 0.5, roughness: 0.5 }),
  shade: mat({ color: '#f4dca0', emissive: '#ffb860', emissiveIntensity: 0.6, roughness: 0.9, side: THREE.DoubleSide }),
  candle: mat({ color: '#fff4dc', roughness: 0.8 }), flame: new THREE.MeshBasicMaterial({ color: '#ffd27a' }),
  fire: new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.9 }), fireCore: new THREE.MeshBasicMaterial({ color: '#ffe08a' }),
  books: ['#a83a32', '#3a5aa0', '#3f8a44', '#d8a83a', '#7a4aa0', '#e0e0d0'].map(c => mat({ color: c, roughness: 0.8 })),
  jar: mat({ color: '#9ad0d8', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7 }),
});

// Pieza local de un mueble: cajas en coordenadas del mueble (x a lo ancho, z hacia delante, y arriba);
// luego se gira y se pone en su sitio. Las cajas de todos los muebles de la casa se juntan por material
// (into) en unas pocas mallas; lo que no son cajas (fuego, pantalla, hojas…) va en el grupo que devuelve.
class Piece {
  constructor() { this.parts = new Map(); }
  box(m, x0, y0, z0, x1, y1, z1, s = 0.5) { let b = this.parts.get(m); if (!b) this.parts.set(m, (b = new Builder())); b.box(x0, y0, z0, x1, y1, z1, { s }); return this; }
  build(group, x, z, yaw, y = 0, into = null) {
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = yaw;
    for (const [m, b] of this.parts) {
      if (!into) { g.add(b.mesh(m)); continue; }
      if (!into.has(m)) into.set(m, new Builder());
      into.get(m).add(b.transformed(x, y, z, yaw));
    }
    group.add(g);
    return g;
  }
}
// Giro para que el frente del mueble (z+) mire hacia (dx, dz)
const yawTo = (dx, dz) => Math.atan2(dx, dz);

export function buildFurniture(bp, { x0, y0, w, h, wallInner: W, roofAt, lights, wallH }) {
  const m = mats(), group = new THREE.Group(), colliders = [], roofParts = [], lit = [], fires = [], merged = new Map(), anchors = {};
  const r = rng(x0 * 31 + y0 * 7);
  // Pared más cercana a una casilla: su lado, la distancia y hacia dónde mira el mueble (hacia dentro)
  const wallOf = (cx, cz) => {
    const c = [['n', cz - W.n, [0, 1]], ['s', W.s - cz, [0, -1]], ['w', cx - W.w, [1, 0]], ['e', W.e - cx, [-1, 0]]];
    return c.sort((a, b) => a[1] - b[1])[0];
  };
  // Pegar a la pared: el centro queda a `back` de la cara interior
  const snap = (cx, cz, back) => {
    const [side, , dir] = wallOf(cx, cz);
    if (side === 'n') cz = W.n + back; else if (side === 's') cz = W.s - back; else if (side === 'w') cx = W.w + back; else cx = W.e - back;
    return [cx, cz, yawTo(...dir)];
  };
  const tables = [];
  for (const [t, raw] of Object.entries(bp.placed)) if (raw.split('@')[0] === 'mesa') { const [tx, ty] = t.split(',').map(Number); tables.push([tx + 0.5, ty + 0.5]); }

  for (const [t, raw] of Object.entries(bp.placed)) {
    const [id, rot] = [raw.split('@')[0], +(raw.split('@')[1] || 0)];
    const [tx, ty] = t.split(',').map(Number), cx = tx + 0.5, cz = ty + 0.5;
    const P = new Piece();
    if (id === 'cama') {
      // Cabecera en su casilla, pies en la siguiente (hacia z+, o hacia x+ si está girada)
      const L = 1.95, Wd = 0.98, yaw = rot ? Math.PI / 2 : 0, bx = rot ? W.w + 0.03 : cx, bz = rot ? cz : W.n + 0.03;
      P.box(m.dark, -Wd / 2, 0, 0, -Wd / 2 + 0.08, 1.0, 0.08).box(m.dark, Wd / 2 - 0.08, 0, 0, Wd / 2, 1.0, 0.08)        // cabecero: postes
        .box(m.wood, -Wd / 2 + 0.08, 0.35, 0.01, Wd / 2 - 0.08, 0.92, 0.07)                                              // y tablero
        .box(m.dark, -Wd / 2, 0, L - 0.08, -Wd / 2 + 0.08, 0.62, L).box(m.dark, Wd / 2 - 0.08, 0, L - 0.08, Wd / 2, 0.62, L)
        .box(m.wood, -Wd / 2 + 0.08, 0.3, L - 0.07, Wd / 2 - 0.08, 0.55, L - 0.01)                                      // piecero
        .box(m.wood, -Wd / 2, 0.22, 0.08, Wd / 2, 0.34, L - 0.08)                                                        // somier
        .box(m.sheet, -Wd / 2 + 0.03, 0.34, 0.09, Wd / 2 - 0.03, 0.5, L - 0.09)                                          // colchón
        .box(m.quilt, -Wd / 2 + 0.01, 0.42, 0.62, Wd / 2 - 0.01, 0.53, L - 0.1)                                          // colcha
        .box(m.quilt, -Wd / 2 - 0.005, 0.2, 0.62, -Wd / 2 + 0.01, 0.53, L - 0.1).box(m.quilt, Wd / 2 - 0.01, 0.2, 0.62, Wd / 2 + 0.005, 0.53, L - 0.1)
        .box(m.quiltB, -Wd / 2 + 0.005, 0.425, 0.62, Wd / 2 - 0.005, 0.535, 0.74)                                         // vuelta de la sábana
        .box(m.sheet, -0.34, 0.5, 0.14, 0.34, 0.64, 0.46);                                                               // almohada
      P.build(group, bx, bz, yaw, 0, merged);
      const fx = bx + Math.sin(yaw) * L, fz = bz + Math.cos(yaw) * L;
      colliders.push(aabb(bx, bz, fx, fz, Wd / 2));
    } else if (id === 'estanteria') {
      const [bx, bz, yaw] = snap(cx, cz, 0.18);
      P.box(m.dark, -0.46, 0, -0.17, -0.42, 1.9, 0.17).box(m.dark, 0.42, 0, -0.17, 0.46, 1.9, 0.17).box(m.wood, -0.46, 1.86, -0.17, 0.46, 1.92, 0.19)
        .box(m.wood, -0.42, 0, -0.17, 0.42, 1.86, -0.14);
      for (const y of [0.06, 0.5, 0.94, 1.38]) {
        P.box(m.wood, -0.42, y, -0.14, 0.42, y + 0.04, 0.17);
        let u = -0.4;
        while (u < 0.36) {
          const bw = 0.04 + r() * 0.04, bh = 0.24 + r() * 0.14;
          if (r() < 0.14) { u += 0.08; continue; }
          if (r() < 0.12 && u < 0.28) { P.box(m.jar, u, y + 0.04, -0.05, u + 0.1, y + 0.18, 0.07); P.box(m.dark, u + 0.01, y + 0.18, -0.04, u + 0.09, y + 0.21, 0.06); u += 0.13; continue; }
          P.box(m.books[Math.floor(r() * m.books.length)], u, y + 0.04, -0.12 + r() * 0.03, u + bw, y + 0.04 + bh, 0.12);
          u += bw + 0.005;
        }
      }
      P.build(group, bx, bz, yaw, 0, merged);
      colliders.push(aabbYaw(bx, bz, 0.46, 0.18, yaw));
    } else if (id === 'chimenea') {
      // Hogar de piedra contra la pared, boca hacia dentro, y su chimenea subiendo por dentro hasta el tejado
      const [bx, bz, yaw] = snap(cx, cz, 0.31);
      P.box(m.stone, -0.72, 0, -0.3, -0.36, 1.3, 0.32, 0.6).box(m.stone, 0.36, 0, -0.3, 0.72, 1.3, 0.32, 0.6)          // jambas
        .box(m.stone, -0.72, 1.0, -0.3, 0.72, 1.3, 0.32, 0.6)                                                           // dintel
        .box(m.dark, -0.82, 1.3, -0.3, 0.82, 1.4, 0.4)                                                                  // repisa
        .box(m.stone, -0.36, 0, -0.3, 0.36, 1.0, -0.22, 0.6).box(m.soot, -0.36, 0.0, -0.22, 0.36, 1.0, -0.2)             // fondo
        .box(m.stone, -0.8, 0, 0.32, 0.8, 0.08, 0.62, 0.6)                                                              // solera
        .box(m.stone, -0.55, 1.4, -0.3, 0.55, wallH + 0.02, 0.2, 0.6);                                                   // campana
      // Leños y fuego
      for (const [a, s] of [[0.5, 1], [-0.5, -1]]) P.box(m.dark, -0.26, 0.04, -0.06 + s * 0.04, 0.26, 0.13, 0.04 + s * 0.04);
      const g = P.build(group, bx, bz, yaw, 0, merged);
      const fire = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const f = new THREE.Mesh(FLAME, i < 2 ? m.fireCore : m.fire);
        f.position.set(-0.16 + i * 0.08, 0.2, 0.02 - (i % 2) * 0.05); f.scale.set(0.09, 0.22 + (i % 3) * 0.06, 0.09);
        fire.add(f);
      }
      g.add(fire);
      fires.push(fire);
      anchors.hearth = new THREE.Vector3(bx + Math.sin(yaw) * 0.5, 0.5, bz + Math.cos(yaw) * 0.5);
      if (lights) {
        const L = new THREE.PointLight('#ff9a4a', 2.2, 6, 1.6);
        L.position.set(0, 0.5, 0.5); g.add(L); lit.push({ light: L, base: 2.2, fire });
      }
      colliders.push(aabbYaw(bx, bz, 0.8, 0.32, yaw));
      // Chimenea por fuera: sale del tejado sobre el hogar (pegada a la pared de detrás)
      const back = [bx - Math.sin(yaw) * 0.1, bz - Math.cos(yaw) * 0.1], top = roofAt(back[0], back[1]);
      // (con sus propios materiales: el tejado se desvanece y el hogar de dentro no)
      const ch = new Piece(), cs = m.stone.clone(), cso = m.soot.clone();
      ch.box(cs, -0.36, wallH, -0.3, 0.36, top + 0.95, 0.3, 0.6).box(cs, -0.42, top + 0.95, -0.36, 0.42, top + 1.08, 0.36, 0.6).box(cso, -0.26, top + 1.08, -0.2, 0.26, top + 1.09, 0.2);
      roofParts.push(ch.build(new THREE.Group(), back[0], back[1], yaw));
    } else if (id === 'mesa') {
      P.box(m.light, -0.5, 0.72, -0.42, 0.5, 0.8, 0.42);
      for (const [a, b] of [[-0.44, -0.36], [0.38, -0.36], [-0.44, 0.3], [0.38, 0.3]]) P.box(m.wood, a, 0, b, a + 0.06, 0.72, b + 0.06);
      P.box(m.wood, -0.42, 0.62, -0.34, 0.42, 0.7, -0.3).box(m.wood, -0.42, 0.62, 0.3, 0.42, 0.7, 0.34);
      P.box(m.sheet, -0.18, 0.8, -0.18, 0.18, 0.81, 0.18);                                  // mantel pequeño
      P.box(m.pot, -0.06, 0.81, -0.06, 0.06, 0.96, 0.06);                                    // jarrón
      const g = P.build(group, cx, cz, 0, 0, merged);
      const fl = new THREE.Mesh(BLOOM, m.books[0]); fl.position.set(0, 1.02, 0); fl.scale.setScalar(0.06); g.add(fl);
      colliders.push({ x0: cx - 0.5, x1: cx + 0.5, z0: cz - 0.42, z1: cz + 0.42 });
    } else if (id === 'silla') {
      // Mirando a la mesa más cercana
      const tb = tables.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz))[0];
      const yaw = tb ? yawTo(tb[0] - cx, tb[1] - cz) : rot * Math.PI / 2;
      P.box(m.wood, -0.22, 0.42, -0.22, 0.22, 0.47, 0.22);
      for (const [a, b] of [[-0.21, -0.21], [0.16, -0.21], [-0.21, 0.16], [0.16, 0.16]]) P.box(m.dark, a, 0, b, a + 0.05, 0.42, b + 0.05);
      P.box(m.dark, -0.21, 0.47, -0.22, -0.16, 1.0, -0.17).box(m.dark, 0.16, 0.47, -0.22, 0.21, 1.0, -0.17)
        .box(m.wood, -0.18, 0.62, -0.215, 0.18, 0.7, -0.175).box(m.wood, -0.18, 0.84, -0.215, 0.18, 0.96, -0.175);
      P.build(group, cx + Math.sin(yaw) * 0.12, cz + Math.cos(yaw) * 0.12, yaw, 0, merged);
      colliders.push({ x: cx, z: cz, r: 0.25 });
    } else if (id === 'lampara') {
      const [bx, bz] = snap(cx, cz, 0.25);
      P.box(m.iron, -0.15, 0, -0.15, 0.15, 0.04, 0.15).box(m.iron, -0.02, 0.04, -0.02, 0.02, 1.4, 0.02);
      const g = P.build(group, bx, bz, 0, 0, merged);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, 0.26, 12, 1, true), m.shade);
      shade.position.y = 1.45; g.add(shade);
      if (lights) { const L = new THREE.PointLight('#ffcf8a', 0.8, 4, 1.8); L.position.y = 1.35; g.add(L); lit.push({ light: L, base: 0.8 }); }
      colliders.push({ x: bx, z: bz, r: 0.2 });
    } else if (id === 'maceta') {
      const [bx, bz] = snap(cx, cz, 0.24);
      const g = new THREE.Group(); g.position.set(bx, 0, bz); group.add(g);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.34, 10), m.pot); pot.position.y = 0.17; pot.castShadow = pot.receiveShadow = true; g.add(pot);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 10), m.pot); rim.position.y = 0.34; g.add(rim);
      for (let i = 0; i < 6; i++) {
        const lf = new THREE.Mesh(LEAFBALL, m.leaf), a = (i / 6) * Math.PI * 2;
        lf.position.set(Math.cos(a) * 0.12, 0.5 + (i % 3) * 0.12, Math.sin(a) * 0.12); lf.scale.setScalar(0.16 + (i % 2) * 0.04); lf.castShadow = true; g.add(lf);
      }
      const top = new THREE.Mesh(LEAFBALL, m.leaf); top.position.y = 0.78; top.scale.setScalar(0.17); g.add(top);
      colliders.push({ x: bx, z: bz, r: 0.24 });
    } else if (id === 'alfombra') {
      const rg = new Builder();
      rg.quad([cx - 1.2, 0.035, cz + 0.8], [cx + 1.2, 0.035, cz + 0.8], [cx + 1.2, 0.035, cz - 0.8], [cx - 1.2, 0.035, cz - 0.8], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      group.add(rg.mesh(m.rug, { cast: false }));
    } else if (id === 'cofre') {
      const [bx, bz, yaw] = snap(cx, cz, 0.28);
      P.box(m.wood, -0.38, 0, -0.26, 0.38, 0.42, 0.26).box(m.dark, -0.4, 0.42, -0.28, 0.4, 0.58, 0.28)
        .box(m.iron, -0.4, 0.05, -0.27, -0.34, 0.58, 0.27).box(m.iron, 0.34, 0.05, -0.27, 0.4, 0.58, 0.27).box(m.brass, -0.06, 0.32, 0.26, 0.06, 0.46, 0.29);
      P.build(group, bx, bz, yaw, 0, merged);
      colliders.push(aabbYaw(bx, bz, 0.4, 0.28, yaw));
    }
  }
  // Candelabro colgado del centro del techo: aro de hierro, seis velas y una luz cálida
  const cx = (W.w + W.e) / 2, cz = (W.n + W.s) / 2 + 0.6, ch = new THREE.Group();
  ch.position.set(cx, wallH - 0.05, cz);
  anchors.room = new THREE.Vector3(cx, wallH - 0.65, cz);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4), m.iron); chain.position.y = -0.35; ch.add(chain);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.025, 6, 24), m.iron); ring.rotation.x = Math.PI / 2; ring.position.y = -0.75; ch.add(ring);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), m.brass); hub.position.y = -0.75; ch.add(hub);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, x = Math.cos(a) * 0.38, z = Math.sin(a) * 0.38;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.38, 4), m.iron); arm.position.set(x / 2, -0.75, z / 2); arm.rotation.set(0, -a, Math.PI / 2); ch.add(arm);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.03, 8), m.brass); cup.position.set(x, -0.73, z); ch.add(cup);
    const cd = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 8), m.candle); cd.position.set(x, -0.64, z); ch.add(cd);
    const fl = new THREE.Mesh(FLAME, m.flame); fl.position.set(x, -0.54, z); fl.scale.set(0.018, 0.04, 0.018); ch.add(fl);
  }
  if (lights) { const L = new THREE.PointLight('#ffd08a', 6, 12, 1.3); L.position.y = -0.6; ch.add(L); lit.push({ light: L, base: 6 }); }
  group.add(ch);
  for (const [mt, b] of merged) group.add(b.mesh(mt));
  return { group, colliders, roofParts, lights: lit, fires, anchors };
}
const FLAME = (() => { const g = new THREE.ConeGeometry(1, 2, 6); g.translate(0, 1, 0); return g; })();
const BLOOM = new THREE.IcosahedronGeometry(1, 0), LEAFBALL = new THREE.IcosahedronGeometry(1, 0);
// Caja de choque de un mueble largo de (ax, az) a (bx, bz) con medio ancho hw
function aabb(ax, az, bx, bz, hw) {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  return Math.abs(bx - ax) > Math.abs(bz - az) ? { x0, x1, z0: z0 - hw, z1: z1 + hw } : { x0: x0 - hw, x1: x1 + hw, z0, z1 };
}
// Caja de choque de medio ancho hw y medio fondo hd, girada yaw (en múltiplos de 90°)
function aabbYaw(x, z, hw, hd, yaw) {
  const q = Math.round(yaw / (Math.PI / 2)) & 1;
  const a = q ? hd : hw, b = q ? hw : hd;
  return { x0: x - a, x1: x + a, z0: z - b, z1: z + b };
}
