// Juntar muchas cajas, caras y figuras en una sola malla (menos llamadas de dibujo), con coordenadas de
// textura en metros del mundo, para que las texturas sigan de una pieza a la siguiente sin cortes.
import * as THREE from 'three';

export class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; this.col = null; this.color = null; }
  get empty() { return !this.idx.length; }
  // Color de lo que se añada a partir de ahora (para materiales con color por vértice); null: sin color
  tint(c) { this.color = c ? new THREE.Color(c) : null; if (c && !this.col) this.col = new Array((this.pos.length / 3) * 3).fill(1); return this; }
  pushCol(n) { if (!this.col) return; const c = this.color || WHITE; for (let i = 0; i < n; i++) this.col.push(c.r, c.g, c.b); }
  // Cara de cuatro puntos (en orden antihorario visto desde fuera), con su normal y sus uv
  quad(a, b, c, d, n, uvs) {
    const i = this.pos.length / 3;
    this.pushCol(4);
    for (const p of [a, b, c, d]) this.pos.push(...p);
    for (let k = 0; k < 4; k++) this.nor.push(...n);
    for (const t of uvs) this.uv.push(...t);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  // Igual, pero da la vuelta a los puntos si su orden no mira hacia n (para caras calculadas al vuelo)
  quadN(a, b, c, d, n, uvs) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const k = (u[1] * v[2] - u[2] * v[1]) * n[0] + (u[2] * v[0] - u[0] * v[2]) * n[1] + (u[0] * v[1] - u[1] * v[0]) * n[2];
    if (k >= 0) this.quad(a, b, c, d, n, uvs); else this.quad(a, d, c, b, n, [uvs[0], uvs[3], uvs[2], uvs[1]]);
  }
  tri(a, b, c, n, uvs) {
    const i = this.pos.length / 3;
    this.pushCol(3);
    for (const p of [a, b, c]) this.pos.push(...p);
    for (let k = 0; k < 3; k++) this.nor.push(...n);
    for (const t of uvs) this.uv.push(...t);
    this.idx.push(i, i + 1, i + 2);
  }
  // Caja alineada con los ejes. s: metros por repetición de la textura. skip: caras que no van ('px nx py ny pz nz')
  box(x0, y0, z0, x1, y1, z1, { s = 1, skip = '' } = {}) {
    const U = v => v / s;
    if (!skip.includes('px')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[U(-z1), U(y0)], [U(-z0), U(y0)], [U(-z0), U(y1)], [U(-z1), U(y1)]]);
    if (!skip.includes('nx')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[U(z0), U(y0)], [U(z1), U(y0)], [U(z1), U(y1)], [U(z0), U(y1)]]);
    if (!skip.includes('py')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[U(x0), U(-z1)], [U(x1), U(-z1)], [U(x1), U(-z0)], [U(x0), U(-z0)]]);
    if (!skip.includes('ny')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[U(x0), U(z0)], [U(x1), U(z0)], [U(x1), U(z1)], [U(x0), U(z1)]]);
    if (!skip.includes('pz')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[U(x0), U(y0)], [U(x1), U(y0)], [U(x1), U(y1)], [U(x0), U(y1)]]);
    if (!skip.includes('nz')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[U(-x1), U(y0)], [U(-x0), U(y0)], [U(-x0), U(y1)], [U(-x1), U(y1)]]);
  }
  // Caja con los cantos biselados (r: lo que se come el bisel). Cada cara del bisel lleva en sus vértices las normales
  // de las dos caras que une (y las esquinas, las de las tres), así que la luz pasa suave de una a otra: con r pequeño
  // parece un canto gastado; con r grande, algo blando y redondeado (una manta, un cojín). Sin sitio, una caja normal
  roundBox(x0, y0, z0, x1, y1, z1, r, { s = 1 } = {}) {
    const lo = [x0, y0, z0], hi = [x1, y1, z1];
    r = Math.min(r, ...[0, 1, 2].map(k => (hi[k] - lo[k]) * 0.45));
    if (r < 0.003) return this.box(x0, y0, z0, x1, y1, z1, { s });
    const inLo = lo.map(v => v + r), inHi = hi.map(v => v - r);
    // El punto de la cara del eje a, en el lado sg (signos por eje): en ese eje, por fuera; en los otros, por dentro
    const pt = (a, sg) => [0, 1, 2].map(k => (k === a ? (sg[k] > 0 ? hi[k] : lo[k]) : sg[k] > 0 ? inHi[k] : inLo[k]));
    const nrm = (a, sg) => [0, 1, 2].map(k => (k === a ? sg[k] : 0));
    const uvOf = (p, n) => {
      const a = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2, sg = n[a] >= 0 ? 1 : -1;
      const [u, v] = a === 0 ? [sg > 0 ? -p[2] : p[2], p[1]] : a === 1 ? [p[0], sg > 0 ? -p[2] : p[2]] : [sg > 0 ? p[0] : -p[0], p[1]];
      return [u / s, v / s];
    };
    // Un polígono con una normal por vértice, dado la vuelta si hace falta para que mire hacia fuera
    const poly = (ps, ns) => {
      const c = [0, 1, 2].map(k => ps.reduce((t, p) => t + p[k], 0) / ps.length), m = [0, 1, 2].map(k => ns.reduce((t, n) => t + n[k], 0));
      const e1 = ps[1].map((v, k) => v - ps[0][k]), e2 = ps[2].map((v, k) => v - ps[0][k]);
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cr[0] * m[0] + cr[1] * m[1] + cr[2] * m[2] < 0) { ps = ps.slice().reverse(); ns = ns.slice().reverse(); }
      const i = this.pos.length / 3;
      this.pushCol(ps.length);
      ps.forEach((p, j) => { const n = ns[j], l = Math.hypot(...n) || 1; this.pos.push(...p); this.nor.push(n[0] / l, n[1] / l, n[2] / l); this.uv.push(...uvOf(p, m)); });
      for (let j = 1; j < ps.length - 1; j++) this.idx.push(i, i + j, i + j + 1);
      void c;
    };
    const S = [-1, 1];
    for (let a = 0; a < 3; a++) for (const sa of S) {   // las seis caras
      const b = (a + 1) % 3, c = (a + 2) % 3, sg = (u, v) => { const g = [0, 0, 0]; g[a] = sa; g[b] = u; g[c] = v; return g; };
      const ps = [sg(-1, -1), sg(1, -1), sg(1, 1), sg(-1, 1)].map(g => pt(a, g));
      poly(ps, ps.map(() => nrm(a, sg(0, 0))));
    }
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) for (const sa of S) for (const sb of S) {   // los doce cantos
      const c = 3 - a - b, sg = w => { const g = [0, 0, 0]; g[a] = sa; g[b] = sb; g[c] = w; return g; };
      poly([pt(a, sg(-1)), pt(a, sg(1)), pt(b, sg(1)), pt(b, sg(-1))], [nrm(a, sg(0)), nrm(a, sg(0)), nrm(b, sg(0)), nrm(b, sg(0))]);
    }
    for (const sx of S) for (const sy of S) for (const sz of S) {   // las ocho esquinas
      const g = [sx, sy, sz];
      poly([pt(0, g), pt(1, g), pt(2, g)], [nrm(0, g), nrm(1, g), nrm(2, g)]);
    }
    return this;
  }
  // Caja girada en el plano (yaw, en radianes, alrededor de su centro), para piezas en diagonal
  orientedBox(cx, cz, len, wid, y0, y1, yaw, opts) {
    const b = new Builder();
    b.box(-len / 2, y0, -wid / 2, len / 2, y1, wid / 2, opts);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < b.pos.length; i += 3) { const x = b.pos[i], z = b.pos[i + 2]; b.pos[i] = cx + x * c + z * s; b.pos[i + 2] = cz - x * s + z * c; }
    for (let i = 0; i < b.nor.length; i += 3) { const x = b.nor[i], z = b.nor[i + 2]; b.nor[i] = x * c + z * s; b.nor[i + 2] = -x * s + z * c; }
    this.add(b);
  }
  // Copia girada yaw alrededor del eje vertical (como rotation.y) y movida a (x, y, z)
  transformed(x, y, z, yaw) {
    const b = new Builder(), c = Math.cos(yaw), s = Math.sin(yaw);
    b.uv = this.uv.slice(); b.idx = this.idx.slice(); b.col = this.col && this.col.slice();
    for (let i = 0; i < this.pos.length; i += 3) { const px = this.pos[i], pz = this.pos[i + 2]; b.pos.push(x + px * c + pz * s, y + this.pos[i + 1], z - px * s + pz * c); }
    for (let i = 0; i < this.nor.length; i += 3) { const nx = this.nor[i], nz = this.nor[i + 2]; b.nor.push(nx * c + nz * s, this.nor[i + 1], -nx * s + nz * c); }
    return b;
  }
  // Una geometría de Three (cilindro, esfera, cono…) con su transformación, junto al resto
  addGeometry(geo, m4) {
    const g = geo.index ? geo : geo, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, off = this.pos.length / 3;
    const nm = new THREE.Matrix3().getNormalMatrix(m4), v = new THREE.Vector3();
    this.pushCol(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m4); this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); this.nor.push(v.x, v.y, v.z);
      this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < pos.count; i++) this.idx.push(i + off);
    return this;
  }
  add(b) {
    const off = this.pos.length / 3;
    if (b.col && !this.col) this.col = new Array(off * 3).fill(1);
    if (this.col) { if (b.col && !this.color) this.col.push(...b.col); else this.pushCol(b.pos.length / 3); }
    this.pos.push(...b.pos); this.nor.push(...b.nor); this.uv.push(...b.uv);
    for (const i of b.idx) this.idx.push(i + off);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
  mesh(material, { cast = true, receive = true } = {}) {
    const m = new THREE.Mesh(this.geometry(), material);
    m.castShadow = cast; m.receiveShadow = receive;
    return m;
  }
}

// Material estándar mate (lo normal). Con una textura de foto compartida (textures.js, photoTex), el tinte de su variante
// va en el color: la foto tal cual por el color medio del lienzo pintado, que es lo que antes llevaba horneado cada copia.
// Si la copia de antes recortaba en blanco alguna parte (un tinte claro sobre una foto con zonas claras), el material
// recorta igual, en su color de antes del tinte (PHOTO_CLAMP): sin eso, las piedras claras saldrían más brillantes
export const mat = (opts = {}) => {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, ...opts }), K = opts.map?.userData.photoTint;
  if (K) {
    if (opts.map.userData.photoClamp) m.defines = { ...m.defines, PHOTO_CLAMP: `vec3(${[m.color.r, m.color.g, m.color.b].map(x => x.toFixed(4)).join(', ')})` };
    m.color.setRGB(m.color.r * K[0], m.color.g * K[1], m.color.b * K[2]);
    // (el techo de la cueva usa la misma textura de luz propia: también teñida, o de noche se vería neutro)
    if (opts.emissiveMap === opts.map) m.emissive.setRGB(m.emissive.r * K[0], m.emissive.g * K[1], m.emissive.b * K[2]);
  }
  return m;
};
// El recorte de las fotos teñidas, justo después de multiplicar por la textura (antes del color por vértice, que va
// encima como antes). Solo en los programas con PHOTO_CLAMP; una vez para todo, antes de compilar nada
{
  const C = THREE.ShaderChunk, at = 'diffuseColor *= sampledDiffuseColor;';
  if (C.map_fragment.includes(at)) C.map_fragment = C.map_fragment.replace(at, `${at}\n\t#ifdef PHOTO_CLAMP\n\t\tdiffuseColor.rgb = min( diffuseColor.rgb, PHOTO_CLAMP );\n\t#endif`);
  else console.warn('[texturas] map_fragment ha cambiado: las fotos teñidas no recortan (PHOTO_CLAMP)');
  // (clone() y copy() de MeshStandardMaterial dejan las defines en { STANDARD }: las copias de un material, para el fundido
  // de los muros o de los árboles y para el horneado de los impostores, perderían el recorte)
  const copy = THREE.MeshStandardMaterial.prototype.copy;
  THREE.MeshStandardMaterial.prototype.copy = function (src) {
    copy.call(this, src);
    if (src.defines?.PHOTO_CLAMP) this.defines = { ...this.defines, PHOTO_CLAMP: src.defines.PHOTO_CLAMP };
    return this;
  };
}
const WHITE = new THREE.Color(1, 1, 1);
// Una roca: una bola de caras deformada por un ruido, aplastada y con la base plana, y la textura proyectada por la
// cara (de lado o desde arriba) en metros
export function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, v = new THREE.Vector3();
  const n3 = (x, y, z) => Math.sin(x * 2.1 + seed) * Math.sin(y * 2.7 + seed * 2) * Math.sin(z * 1.9 + seed * 3) + 0.5 * Math.sin(x * 4.3 - seed) * Math.sin(z * 4.1 + y * 3.3);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const r = 1 + 0.22 * n3(v.x * 1.3, v.y * 1.3, v.z * 1.3);
    let y = v.y * r * 0.72; if (y < -0.25) y = -0.25 + (y + 0.25) * 0.15;
    p.setXYZ(i, v.x * r, y, v.z * r);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    nn.subVectors(c, b).cross(b.clone().sub(a)).normalize();
    const ax = Math.abs(nn.x), ay = Math.abs(nn.y), az = Math.abs(nn.z);
    for (let j = 0; j < 3; j++) { const q = [a, b, c][j]; const [u1, v1] = ay > ax && ay > az ? [q.x, q.z] : ax > az ? [q.z, q.y] : [q.x, q.y]; uv.setXY(i + j, u1 * 0.6 + seed * 0.37, v1 * 0.6); }
  }
  return g;
}

// La nieve encima de algo: se pinta una copia algo mayor de su forma con este material, que solo deja ver lo que mira
// hacia arriba (con el borde algo irregular). Así la nieve sigue la forma y no flota en placas
export function snowCap(opts = {}) {
  const m = mat({ color: '#e8eef0', roughness: 0.8, ...opts });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowN;\nvarying vec3 vSnowP;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec3 sn = objectNormal;
        #ifdef USE_INSTANCING
          sn = mat3(instanceMatrix) * sn;
        #endif
        vSnowN = normalize(mat3(modelMatrix) * sn);`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 sp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          sp = instanceMatrix * sp;
        #endif
        vSnowP = (modelMatrix * sp).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowN;\nvarying vec3 vSnowP;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float wob = sin(vSnowP.x * 7.0 + vSnowP.z * 5.0) * sin(vSnowP.z * 6.0 - vSnowP.y * 4.0) * 0.12;
        if (normalize(vSnowN).y < 0.6 + wob) discard;`);
  };
  m.customProgramCacheKey = () => 'nieve-encima';
  return m;
}
