// Prototipo 3D: juntar muchas cajas y caras en una sola malla (menos llamadas de dibujo), con coordenadas de
// textura en metros del mundo, para que las texturas sigan de una pieza a la siguiente sin cortes.
import * as THREE from 'three';

export class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }
  get empty() { return !this.idx.length; }
  // Cara de cuatro puntos (en orden antihorario visto desde fuera), con su normal y sus uv
  quad(a, b, c, d, n, uvs) {
    const i = this.pos.length / 3;
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
    b.uv = this.uv.slice(); b.idx = this.idx.slice();
    for (let i = 0; i < this.pos.length; i += 3) { const px = this.pos[i], pz = this.pos[i + 2]; b.pos.push(x + px * c + pz * s, y + this.pos[i + 1], z - px * s + pz * c); }
    for (let i = 0; i < this.nor.length; i += 3) { const nx = this.nor[i], nz = this.nor[i + 2]; b.nor.push(nx * c + nz * s, this.nor[i + 1], -nx * s + nz * c); }
    return b;
  }
  add(b) {
    const off = this.pos.length / 3;
    this.pos.push(...b.pos); this.nor.push(...b.nor); this.uv.push(...b.uv);
    for (const i of b.idx) this.idx.push(i + off);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
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

// Material estándar mate (lo normal en el prototipo)
export const mat = (opts = {}) => new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, ...opts });
