// Lo cavado con la pala, en 3D (ver scenes.js, digH). Cada casilla cavada, o con tierra apilada, es un suelo llano a su
// altura y, hacia cada vecina más alta o más baja, una pared vertical de tierra. Las paredes llegan justo hasta el borde
// de la casilla de al lado tal como lo dibuja la malla del suelo (la línea entre sus dos esquinas), así que no quedan
// rendijas; la malla del suelo (terrain.js) deja un hueco en las casillas cavadas. Entre dos casillas tocadas, la pared la
// pone la más alta. La tierra lleva la foto de tierra del suelo (la del detalle, en gris), en metros, y por vértice su
// color: oscura arriba (la capa con raíces), más clara y arcillosa al bajar y pedregosa en lo hondo, y más oscura en el
// fondo y en los rincones, adonde llega menos cielo; en las paredes, vetas horizontales algo onduladas (en el sombreador, a
// la altura del mundo: casan de una pared a otra). Con la lluvia se moja como el suelo y en invierno lo que mira arriba
// coge algo de nieve. Todo va en coordenadas del mundo, en una malla por bloque de suelo.
import * as THREE from 'three';
import { soilDetail, meanOf } from './textures.js';

const S = 0.55;      // repeticiones de la foto por metro (como el detalle del suelo de terrain.js)
const SKIRT = 0.35, SKIRT_IN = 0.12;   // la lámina de sombra de cada pared: lo que se alarga por cada punta y lo que se mete en la tierra (ver skirt)
const STEP = 0.25;   // los escalones de las alturas de lo cavado (scenes.js, LV_STEP): las paredes llevan un vértice en cada uno
// El color de la tierra según lo que queda por debajo del suelo natural de ahí (metros; lo apilado, por encima, es tierra
// suelta): la capa con raíces, la tierra, la arcilla y la de piedras
const STRATA = [[-0.5, '#957f60'], [0, '#7a664d'], [0.18, '#665340'], [0.45, '#86704f'], [1.4, '#957b57'], [2.6, '#938268'], [5, '#857a6a']]
  .map(([d, c]) => [d, new THREE.Color(c)]);
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const TMP = new THREE.Color();
// El color (lineal) de la tierra a esa profundidad, oscurecido por k
function soil(depth, k, out) {
  let i = 0;
  while (i < STRATA.length - 2 && depth > STRATA[i + 1][0]) i++;
  const [d0, c0] = STRATA[i], [d1, c1] = STRATA[i + 1];
  TMP.copy(c0).lerp(c1, ss(d0, d1, depth));
  // (lo hondo recibe menos cielo: más oscuro, un tercio a 5 m)
  const ao = k * (1 - 0.34 * ss(0.3, 5, depth));
  out.push(TMP.r * ao, TMP.g * ao, TMP.b * ao);
}

// La malla de lo cavado de un bloque. list: [[tx, ty, altura]] (las casillas del bloque); x0, z0: la esquina del bloque y
// n, el número de vértices por lado de sus alturas H (las del suelo natural, ya allanado); digH(tx, ty): la altura de
// cualquier casilla tocada (o null). Devuelve { geo, shadow } (la que se ve y la que solo da sombra), o null si no hay nada
export function digGeometry(list, x0, z0, n, H, digH) {
  const pos = [], nor = [], uv = [], col = [], idx = [], shade = [];
  // La sombra: las paredes de un hoyo son láminas y el suelo de alrededor no da sombra (terrain.js). Con el margen que
  // necesitan las sombras (bias), la de una lámina empieza un poco separada de donde toca a otra: en cada rincón quedaba una
  // raya de luz de arriba abajo, y otra al pie de las paredes. Para la sombra, detrás de cada pared va otra lámina, metida
  // SKIRT_IN en la tierra (ox, oz: hacia la tierra), más larga por las puntas y más honda, y bajo el borde: una malla
  // aparte que solo da sombra y que ya no toca nada de lo que se ve
  const skirt = (ax, az, bx, bz, y0, y1, ox, oz) => {
    if (y1 <= y0) return;
    const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L * SKIRT, dz = (bz - az) / L * SKIRT, mx = ox * SKIRT_IN, mz = oz * SKIRT_IN;
    const a = [ax - dx + mx, az - dz + mz], b = [bx + dx + mx, bz + dz + mz];
    shade.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]);
  };
  const corner = (x, z) => H[(z - z0) * n + (x - x0)];
  const P = new THREE.Vector3(), Q = new THREE.Vector3(), C = new THREE.Vector3();
  // Un cuadrilátero (a, b, c, d en orden alrededor) con su normal; las caras, giradas para que miren hacia ella
  // Un vértice suelto (devuelve su número) y un triángulo, girado para que mire hacia (nx, ny, nz); los que no tienen área, fuera
  const vert = (x, y, z, u, w, d, k, nx, ny, nz) => { pos.push(x, y, z); nor.push(nx, ny, nz); uv.push(u, w); soil(d, k, col); return pos.length / 3 - 1; };
  const tri = (a, b, c, nx, ny, nz) => {
    const p = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], [A, B, Cc] = [p(a), p(b), p(c)];
    P.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]); Q.set(Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]); C.crossVectors(P, Q);
    if (C.lengthSq() < 1e-12) return;
    if (C.x * nx + C.y * ny + C.z * nz >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  const quad = (v, nx, ny, nz) => {
    const o = pos.length / 3;
    for (const [x, y, z, u, w, d, k] of v) { pos.push(x, y, z); nor.push(nx, ny, nz); uv.push(u, w); soil(d, k, col); }
    P.set(v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]); Q.set(v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]);
    C.crossVectors(P, Q);
    // (si es casi plano por un lado, el otro triángulo dice hacia dónde mira)
    if (C.lengthSq() < 1e-10) { P.set(v[3][0] - v[0][0], v[3][1] - v[0][1], v[3][2] - v[0][2]); C.crossVectors(Q, P); }
    if (C.x * nx + C.y * ny + C.z * nz >= 0) idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    else idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  };
  // Una pared vertical a lo largo del borde de A a B (en planta), de la línea de abajo (yA0 en A, yB0 en B) a la de arriba
  // (yA1, yB1), mirando hacia (nx, nz); eA, eB: el suelo natural en cada punta (para el color). Cada punta es una columna de
  // vértices a cada escalón de STEP (las alturas de lo cavado van siempre a esos escalones): así dos paredes que se
  // encuentran en una esquina tienen ahí los mismos vértices y no queda ninguna rendija entre ellas (con franjas distintas
  // a cada lado, por la junta se veía el cielo). Entre las dos columnas, triángulos en zigzag
  const wall = (ax, az, bx, bz, yA0, yA1, yB0, yB1, nx, nz, eA, eB) => {
    if (Math.max(yA1 - yA0, yB1 - yB0) < 0.005) return;
    const along = Math.abs(bx - ax) > Math.abs(bz - az), uA = (along ? ax : az) * S, uB = (along ? bx : bz) * S;
    // (abajo, junto al suelo del hoyo, algo más oscuro: el rincón)
    const column = (x, z, y0, y1, u, e) => {
      const ys = [y0];
      for (let y = (Math.floor(y0 / STEP + 1e-6) + 1) * STEP; y < y1 - 1e-4; y += STEP) ys.push(y);
      if (y1 > y0 + 1e-4) ys.push(y1);
      return ys.map(y => vert(x, y, z, u, y * S, e - y, 1 - 0.28 * (1 - ss(0, 0.55, y - y0)), nx, 0, nz));
    };
    const A = column(ax, az, yA0, yA1, uA, eA), B = column(bx, bz, yB0, yB1, uB, eB), pa = i => pos[A[i] * 3 + 1], pb = j => pos[B[j] * 3 + 1];
    let i = 0, j = 0;
    while (i < A.length - 1 || j < B.length - 1) {
      if (j >= B.length - 1 || (i < A.length - 1 && pa(i + 1) <= pb(j + 1))) { tri(A[i], B[j], A[i + 1], nx, 0, nz); i++; }
      else { tri(A[i], B[j], B[j + 1], nx, 0, nz); j++; }
    }
  };
  for (const [tx, ty] of list) {
    const h = digH(tx, ty);
    if (h === null) continue;
    const c00 = corner(tx, ty), c10 = corner(tx + 1, ty), c01 = corner(tx, ty + 1), c11 = corner(tx + 1, ty + 1);
    // El suelo de la casilla: llano, con los rincones más oscuros donde lo de al lado queda más alto
    const above = (x, z, e) => {
      let m = 0;
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const ax = x + dx, az = z + dz;
        if (ax === tx && az === ty) continue;
        const o = digH(ax, az);
        if ((o ?? e) > h + 0.25) m++;
      }
      return 1 - 0.13 * m;
    };
    const fv = (x, z, e) => [x, h, z, x * S, z * S, e - h, above(x, z, e)];
    quad([fv(tx, ty, c00), fv(tx + 1, ty, c10), fv(tx + 1, ty + 1, c11), fv(tx, ty + 1, c01)], 0, 1, 0);
    // Las cuatro paredes: hacia cada vecina, de su borde (la línea entre dos esquinas, si está como era; su altura, si está
    // tocada) a este suelo. normal: hacia dentro de esta casilla
    for (const [ax, az, bx, bz, nx, nz, ox, oz] of [[tx, ty, tx + 1, ty, 0, 1, 0, -1], [tx, ty + 1, tx + 1, ty + 1, 0, -1, 0, 1], [tx, ty, tx, ty + 1, 1, 0, -1, 0], [tx + 1, ty, tx + 1, ty + 1, -1, 0, 1, 0]]) {
      const eA = corner(ax, az), eB = corner(bx, bz), o = digH(tx + ox, ty + oz);
      if (o !== null) {   // (la vecina también está tocada: la pared la pone la más alta, mirando a la más baja)
        if (h > o + 0.005) { wall(ax, az, bx, bz, o, h, o, h, -nx, -nz, eA, eB); skirt(ax, az, bx, bz, o - 0.3, h - 0.03, nx, nz); }
        continue;
      }
      // (la vecina está como era: su borde es la línea de eA a eB. Por encima de este suelo, la pared del hoyo mira hacia
      // dentro; por debajo, la del montón mira hacia fuera; si la línea cruza el suelo, una parte de cada)
      if (eA >= h && eB >= h) { wall(ax, az, bx, bz, h, eA, h, eB, nx, nz, eA, eB); skirt(ax, az, bx, bz, h - 0.3, Math.min(eA, eB) - 0.03, -nx, -nz); }
      else if (eA <= h && eB <= h) wall(ax, az, bx, bz, eA, h, eB, h, -nx, -nz, eA, eB);
      else {
        const t = (h - eA) / (eB - eA), mx = ax + (bx - ax) * t, mz = az + (bz - az) * t;
        if (eA > h) { wall(ax, az, mx, mz, h, eA, h, h, nx, nz, eA, h); wall(mx, mz, bx, bz, h, h, eB, h, -nx, -nz, h, eB); }
        else { wall(ax, az, mx, mz, eA, h, h, h, -nx, -nz, eA, h); wall(mx, mz, bx, bz, h, h, h, eB, nx, nz, h, eB); }
      }
    }
  }
  if (!idx.length) return null;
  let sg = null;
  if (shade.length) { sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(shade, 3)); sg.computeBoundingSphere(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geo: g, shadow: sg };
}

// El de la malla que solo da sombra (ver skirt): no pinta nada ni tapa nada; en la pasada de sombras cuentan sus dos caras
export const digShadowMaterial = () => new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });

// El material de la tierra cavada (uno para todos los bloques). wet: lo mojado del suelo (terrain.js, WET); snow: cuánta
// nieve coge lo que mira arriba (lo pone terrain.js con la estación). La foto va dividida por su media (en el color), como el
// detalle del suelo: da el grano sin aclarar ni oscurecer
export function digMaterial(wet, snow) {
  const map = soilDetail();
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.97, metalness: 0 });
  // (las paredes van en el mismo plano que la cara del cimiento de lo que se construya al lado: la tierra, delante)
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1;
  m.userData.tone = () => m.color.setScalar(1 / Math.max(0.3, meanOf(map)));
  m.userData.tone();
  m.customProgramCacheKey = () => 'tierra-cavada';
  m.onBeforeCompile = sh => {
    sh.uniforms.uWet = wet; sh.uniforms.uSnow = snow;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUp;\nvarying vec3 vDW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUp = objectNormal.y;\nvDW = transformed;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWet;\nuniform float uSnow;\nvarying float vUp;\nvarying vec3 vDW;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n        roughnessFactor = mix(roughnessFactor, 0.45, uWet * 0.75);   // (mojada: brilla un poco)')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // (las vetas: franjas de un palmo, onduladas, cada una de un tono; solo en las paredes)
        float vy = vDW.y * 4.0 + 0.35 * sin(vDW.x * 2.1 + vDW.z * 1.3) + 0.2 * sin(vDW.x * 5.3 - vDW.z * 4.1);
        float vt = fract(sin(floor(vy) * 12.9898) * 43758.5453);
        diffuseColor.rgb *= mix(1.0, 0.93 + 0.14 * vt, 1.0 - smoothstep(0.3, 0.7, abs(vUp)));
        diffuseColor.rgb *= 1.0 - 0.26 * uWet;   // (y más oscura)
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.75, 0.74) * (0.72 + 0.35 * sampledDiffuseColor.r), uSnow * smoothstep(0.6, 0.95, vUp));   // (algo de nieve en lo llano, con su grano)`);
  };
  return m;
}
