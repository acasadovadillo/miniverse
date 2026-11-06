// El borde amarillo de lo que se apunta con el cursor. Se dibuja después de todo, sobre el canal de plantilla: primero la
// forma de la cosa (solo marca la plantilla) y luego esa misma forma engordada unos píxeles, de amarillo, solo fuera de lo
// marcado. Sale la silueta, del mismo grosor a cualquier distancia. Lo que no tiene modelo propio (una puerta, una
// ventana, lo de la tierra), el borde de su caja.
import * as THREE from 'three';
import { getModel } from './models.js';
import { nearX } from '../world/planet.js';

const WIDTH = 2.5;   // grosor, en píxeles de la pantalla
const MASK = new THREE.MeshBasicMaterial({
  colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
  stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilRef: 1, stencilZPass: THREE.ReplaceStencilOp, stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp,
});
const LINE = new THREE.ShaderMaterial({
  uniforms: { res: { value: new THREE.Vector2(1, 1) }, width: { value: WIDTH }, glow: { value: 1 } },
  vertexShader: `uniform vec2 res; uniform float width;
    void main() {
      vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      vec2 d = (projectionMatrix * vec4(normalMatrix * normal, 0.0)).xy;
      if (dot(d, d) > 1e-8) c.xy += normalize(d) * width * 2.0 / res * c.w;
      gl_Position = c;
    }`,
  fragmentShader: 'uniform float glow; void main() { gl_FragColor = vec4(vec3(1.0, 0.82, 0.2) * glow, 1.0); }',
  depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false,
  stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilRef: 1, stencilZPass: THREE.KeepStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp,
});
const BOX = new THREE.BoxGeometry(1, 1, 1), ME = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3();

export class Outline {
  constructor(view) {
    this.view = view;
    this.scene = new THREE.Scene();
    this.pool = [];      // parejas de mallas [marca, borde] ya hechas
    this.models = new Map();   // (las piezas de cada modelo: [[geometría, matriz]])
  }
  // Una forma más que dibujar: geometría y dónde
  add(geo, matrix, i) {
    let pair = this.pool[i];
    if (!pair) {
      pair = this.pool[i] = [new THREE.Mesh(BOX, MASK), new THREE.Mesh(BOX, LINE)];
      pair[0].renderOrder = 1; pair[1].renderOrder = 2;
      for (const m of pair) { m.matrixAutoUpdate = false; m.frustumCulled = false; this.scene.add(m); }
    }
    for (const m of pair) { m.geometry = geo; m.matrix.copy(matrix); m.visible = true; }
  }
  pieces(name) {
    if (this.models.has(name)) return this.models.get(name);
    const m = getModel(name), out = [];
    if (m) {
      for (const [, B] of m.parts) if (!B.empty) out.push([B.geometry(), new THREE.Matrix4()]);
      for (const e of m.extras) { e.updateMatrixWorld(true); e.traverse(q => { if (q.isMesh) out.push([q.geometry, q.matrixWorld.clone()]); }); }
    }
    this.models.set(name, out);
    return out;
  }
  // Las formas de lo apuntado; devuelve cuántas son
  fill(a, scene, me) {
    const view = this.view;
    let n = 0;
    const actor = a.e && view.actors.models.get(a.e);
    if (actor) { actor.root.updateMatrixWorld(true); actor.root.traverseVisible(q => { if (q.isMesh) this.add(q.geometry, q.matrixWorld, n++); }); return n; }
    const o = a.kind === 'placed' ? a.o : null, list = o && o.layer !== 'rug' ? this.pieces(o.model || o.placed) : null;
    if (list?.length) {
      const yaw = o.yaw ?? a.yaw ?? 0, x = nearX(o.x, me.x);
      ME.makeRotationY(yaw).setPosition(x, view.groundY(scene, o.x, o.y), o.y);
      const m = new THREE.Matrix4();
      for (const [geo, local] of list) this.add(geo, m.multiplyMatrices(ME, local), n++);
      return n;
    }
    const b = a.box, g = view.groundY(scene, b.x, b.y) + b.y0;
    X.set(b.ux * b.hx * 2, 0, b.uy * b.hx * 2); Z.set(b.vx * b.hy * 2, 0, b.vy * b.hy * 2); Y.set(0, b.y1 - b.y0, 0);
    ME.makeBasis(X, Y, Z).setPosition(nearX(b.x, me.x), g + (b.y1 - b.y0) / 2, b.y);
    this.add(BOX, ME, n++);
    return n;
  }
  draw(renderer, camera, a, scene, me, t) {
    if (!a || a.ring || !me) return;
    const n = this.fill(a, scene, me);
    for (let i = n; i < this.pool.length; i++) { this.pool[i][0].visible = this.pool[i][1].visible = false; }
    renderer.getDrawingBufferSize(LINE.uniforms.res.value);
    LINE.uniforms.width.value = WIDTH * renderer.getPixelRatio();
    LINE.uniforms.glow.value = 0.92 + Math.sin(t * 6) * 0.08;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearStencil();
    renderer.render(this.scene, camera);
    renderer.autoClear = auto;
  }
}
