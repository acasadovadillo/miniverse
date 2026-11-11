// La luz de noche que se ve en el aire y en el suelo, sin posproceso (ni bloom ni otra pasada de la escena):
// - halos: un resplandor suave alrededor de cada farola, lámpara, cristal y fuego (hogares, velas, antorchas, hogueras),
//   como se ve una luz en el aire de noche, más grande y más fuerte con lluvia o niebla (la luz se esparce en el aire húmedo);
// - ventanas: una tarjeta de luz cálida pegada a la fachada de cada ventana abierta, que se ve de frente y desaparece de
//   canto (y desde dentro de la casa no se ve);
// - charcos de luz: un círculo cálido en el suelo bajo cada farola y delante de cada ventana. Las luces de verdad (las seis
//   PointLight de engine.js) solo alcanzan a las fuentes más cercanas; con esto el pueblo entero se ve encendido.
// Cada cosa es una sola malla instanciada (tres dibujos como mucho), aditiva, sin escribir profundidad y sin textura (la
// forma se calcula en el sombreador). De día, sin nada que brille, no se dibuja nada. La niebla se aplica a mano (la de
// Three le sumaría su color) y de muy cerca el halo se apaga, para no lavar la pantalla en primera persona.
import * as THREE from 'three';

const LOW_Q = typeof location !== 'undefined' && new URLSearchParams(location.search).get('q') === 'low';
const MAX = { halo: 320, card: 192, pool: 128 };
const NEAR = 45;   // (metros alrededor de lo que mira la cámara: más allá la niebla de noche ya lo ha apagado casi todo)
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Lo que comparten los tres: el tiempo (el parpadeo) y la niebla de ahora
const FOG_GLSL = `uniform float time;
uniform float fogNear;
uniform float fogFar;
float glowFog(float d) { return 1.0 - smoothstep(fogNear, fogFar, d); }`;
const OUT_GLSL = `#include <tonemapping_fragment>
  #include <colorspace_fragment>`;

function instanced(attrs, max) {
  const base = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
  g.index = base.index; g.setAttribute('position', base.attributes.position);
  for (const [name, size] of Object.entries(attrs)) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(max * size), size).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  return g;
}
function material(U, vertexShader, fragmentShader, extra = {}) {
  return new THREE.ShaderMaterial({ uniforms: U, vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false, ...extra });
}

export class Glow {
  constructor(view) {
    this.view = view;
    this.U = { time: { value: 0 }, fogNear: { value: 24 }, fogFar: { value: 90 } };
    this.group = new THREE.Group();
    // Halos: un cuadrado de cara a la cámara (en el sombreador), adelantado hacia ella para no cortarse con la farola o la
    // pared de detrás. iCol: el color ya con su fuerza y, en a, una semilla para el parpadeo; iSize: el radio y cuánto parpadea
    this.halo = this.mesh(instanced({ iPos: 3, iCol: 4, iSize: 2 }, MAX.halo), `${FOG_GLSL}
      attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSize;
      varying vec3 vCol; varying vec2 vUv;
      void main() {
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        float d = -mv.z, fl = 1.0 + iSize.y * (sin(time * 13.0 + iCol.a * 7.0) * 0.07 + sin(time * 29.0 + iCol.a * 3.0) * 0.06), r = iSize.x * fl;
        mv.xyz += normalize(-mv.xyz) * min(r * 0.6, d * 0.5);
        mv.xy += position.xy * 2.0 * r;
        gl_Position = projectionMatrix * mv;
        vCol = iCol.rgb * fl * glowFog(d) * smoothstep(0.6, 2.2, d);
        vUv = position.xy;
      }`, `varying vec3 vCol; varying vec2 vUv;
      void main() {
        float q = length(vUv) * 2.0;
        float a = exp(-q * q * 4.0) * (1.0 - smoothstep(0.8, 1.0, q)) + exp(-q * q * 40.0) * 0.6;
        gl_FragColor = vec4(vCol, a);
        ${OUT_GLSL}
      }`, 4);
    // Ventanas: la tarjeta, de 1,5 × 1,7 m en el plano de la fachada (iNrm: hacia fuera); el núcleo del tamaño del cristal y
    // alrededor una caída suave. De canto o por detrás (desde dentro), nada
    this.card = this.mesh(instanced({ iPos: 3, iNrm: 2, iCol: 3 }, MAX.card), `${FOG_GLSL}
      attribute vec3 iPos; attribute vec2 iNrm; attribute vec3 iCol;
      varying vec3 vCol; varying vec2 vP;
      void main() {
        vec3 n = vec3(iNrm.x, 0.0, iNrm.y), t = vec3(-n.z, 0.0, n.x);
        vec3 w = iPos + t * position.x * 1.5 + vec3(0.0, position.y * 1.7, 0.0) + n * 0.02;
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        vCol = iCol * smoothstep(0.0, 0.35, dot(normalize(cameraPosition - w), n)) * glowFog(-mv.z);
        vP = vec2(position.x * 1.5, position.y * 1.7);
      }`, `varying vec3 vCol; varying vec2 vP;
      void main() {
        vec2 q = abs(vP) - vec2(0.3, 0.475);
        float dd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
        float a = (1.0 - smoothstep(-0.03, 0.03, dd)) * 0.3 + exp(-max(dd, 0.0) * 4.5) * 0.6;
        a *= (1.0 - smoothstep(0.55, 0.75, abs(vP.x))) * (1.0 - smoothstep(0.65, 0.85, abs(vP.y)));
        gl_FragColor = vec4(vCol, a);
        ${OUT_GLSL}
      }`, 3, { side: THREE.DoubleSide });
    // Charcos de luz: un cuadrado tumbado en el suelo, con su caída de elipse (iAx: el eje hacia delante y los dos radios;
    // iCol: el color con su fuerza y, en a, cuánto parpadea). Un poco por encima del suelo y adelantado en profundidad
    this.pool = LOW_Q ? null : this.mesh(instanced({ iPos: 3, iAx: 4, iCol: 4 }, MAX.pool), `${FOG_GLSL}
      attribute vec3 iPos; attribute vec4 iAx; attribute vec4 iCol;
      varying vec3 vCol; varying vec2 vQ;
      void main() {
        vec3 f = vec3(iAx.x, 0.0, iAx.y), s = vec3(-f.z, 0.0, f.x);
        vec3 w = iPos + s * position.x * 2.0 * iAx.z + f * position.y * 2.0 * iAx.w;
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        float fl = 1.0 + iCol.a * (sin(time * 11.0 + iPos.x * 3.0) * 0.08 + sin(time * 23.0 + iPos.z * 2.0) * 0.06);
        vCol = iCol.rgb * fl * glowFog(-mv.z);
        vQ = position.xy * 2.0;
      }`, `varying vec3 vCol; varying vec2 vQ;
      void main() {
        float r = length(vQ);
        float a = exp(-r * r * 3.2) * (1.0 - smoothstep(0.5, 1.0, r));
        gl_FragColor = vec4(vCol, a);
        ${OUT_GLSL}
      }`, 0.6, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    view.scene.add(this.group);
    this.floor = new Map();   // (la altura del suelo bajo cada farola, por su sitio: no cambia)
    this.col = new THREE.Color();
  }
  mesh(geo, vs, fs, order, extra) {
    const m = new THREE.Mesh(geo, material(this.U, vs, fs, extra));
    m.frustumCulled = false; m.renderOrder = order; m.visible = false; m.matrixAutoUpdate = false;
    this.group.add(m);
    return m;
  }

  // Cada fotograma, con las fuentes que ya ha juntado engine.js (src: las luces de cerca del mundo o de la cueva; lit: las
  // que tienen ahora una de las seis luces de verdad; flames: los fuegos)
  update(game, scene, src, lit, flames, t) {
    const v = this.view, cave = !!v.cave, night = v.night || 0, target = v.cam.target, fog = v.scene.fog;
    this.U.time.value = t; this.U.fogNear.value = fog.near; this.U.fogFar.value = fog.far;
    const kNight = Math.max(ss(0.25, 0.85, night), cave ? 1 : 0), kIn = game.indoors ? 0.5 : 0;
    // (con lluvia o niebla, la luz se esparce en el aire húmedo: halos más grandes y algo más fuertes)
    const wet = !cave && (v.weather?.rain || v.fogNow) ? 1 : 0, rK = 1 + 0.35 * wet, iK = 1 + 0.2 * wet;
    const near = (x, z) => Math.abs(x - target.x) < NEAR && Math.abs(z - target.z) < NEAR;
    // Halos y charcos de las luces
    const H = this.halo.geometry.attributes, P = this.pool?.geometry.attributes;
    let n = 0, np = 0;
    for (const s of src) {
      if (!near(s.x, s.z)) continue;
      const k = s.always ? 0.35 + 0.65 * night : Math.max(kNight, kIn);
      if (k < 0.01) continue;
      const I = s.intensity ?? 3;
      if (!s.flicker && s.halo !== 0 && n < MAX.halo) {   // (los fuegos llevan su halo con la llama: ver abajo)
        const r = (s.halo ?? Math.max(0.25, Math.min(1.6, 0.15 * Math.sqrt(I * (s.range || 8))))) * rK;
        this.col.set(s.color || '#ffb870').multiplyScalar((0.16 + 0.03 * I) * k * iK);
        H.iPos.setXYZ(n, s.x, s.y, s.z); H.iCol.setXYZW(n, this.col.r, this.col.g, this.col.b, (s.x * 0.37 + s.z * 0.61) % 7); H.iSize.setXY(n, r, 0); n++;
      }
      if (P && s.pool && !cave && np < MAX.pool) {
        const y = this.floorAt(scene, s.x, s.z), half = lit?.has(s) ? 0.5 : 1;
        this.col.set(s.color || '#ffc070').multiplyScalar(0.22 * k * half);
        P.iPos.setXYZ(np, s.x, y + 0.04, s.z); P.iAx.setXYZW(np, 1, 0, s.pool, s.pool); P.iCol.setXYZW(np, this.col.r, this.col.g, this.col.b, s.flicker ? 1 : 0); np++;
      }
    }
    // Los fuegos: un halo naranja algo por encima de la llama, que parpadea con ella
    const kf = Math.max(kNight, kIn);
    if (kf > 0.01) for (const [x, y, z, s] of flames) {
      if (n >= MAX.halo) break;
      if (!near(x, z)) continue;
      this.col.set(s < 0.3 ? '#ffa040' : '#ff8a30').multiplyScalar(0.25 * kf * iK);
      H.iPos.setXYZ(n, x, y + 0.12 * s, z); H.iCol.setXYZW(n, this.col.r, this.col.g, this.col.b, (x * 0.53 + z * 0.29) % 7); H.iSize.setXY(n, (0.28 + 0.5 * s) * rK, 1); n++;
    }
    this.flush(this.halo, n);
    // Las ventanas, solo fuera (las de las cuevas no hay) y de noche: su tarjeta y su charco delante
    const C = this.card.geometry.attributes;
    let nc = 0;
    if (!cave && kNight > 0.01) {
      const w = v.world;
      this.col.set('#ffb050');
      const cr = this.col.r * 0.5 * kNight, cg = this.col.g * 0.5 * kNight, cb = this.col.b * 0.5 * kNight;
      this.col.set('#ffb050').multiplyScalar(0.11 * kNight);
      for (const c of w.chunks.values()) if (c.windows) for (const win of c.windows) {
        if (!near(win.p[0], win.p[2])) continue;
        if (w.faded(win.tile[0], win.tile[1], win.side)) continue;   // (la pared que se oculta con el jugador dentro)
        if (nc < MAX.card) { C.iPos.setXYZ(nc, win.p[0], win.p[1], win.p[2]); C.iNrm.setXY(nc, win.n[0], win.n[1]); C.iCol.setXYZ(nc, cr, cg, cb); nc++; }
        if (P && np < MAX.pool) {
          P.iPos.setXYZ(np, win.p[0] + win.n[0] * 1.0, win.gy + 0.04, win.p[2] + win.n[1] * 1.0); P.iAx.setXYZW(np, win.n[0], win.n[1], 1.3, 1.05);
          P.iCol.setXYZW(np, this.col.r, this.col.g, this.col.b, 0); np++;
        }
      }
    }
    this.flush(this.card, nc);
    if (this.pool) this.flush(this.pool, np);
  }
  flush(mesh, n) {
    mesh.geometry.instanceCount = n;
    mesh.visible = n > 0;
    if (!n) return;
    for (const a of Object.values(mesh.geometry.attributes)) if (a.isInstancedBufferAttribute) { a.clearUpdateRanges?.(); a.addUpdateRange?.(0, n * a.itemSize); a.needsUpdate = true; }
  }
  // La altura del suelo bajo una farola (se guarda por su sitio; si hay muchas, se empieza de nuevo)
  floorAt(scene, x, z) {
    const k = `${Math.round(x * 10)},${Math.round(z * 10)}`;
    let y = this.floor.get(k);
    if (y === undefined) {
      if (this.floor.size > 2000) this.floor.clear();
      this.floor.set(k, (y = this.view.groundY(scene, x, z)));
    }
    return y;
  }
  // Otro mundo (otra partida, el menú): las alturas guardadas ya no valen
  reset() { this.floor.clear(); }
}
