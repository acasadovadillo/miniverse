// Vista previa en 3D del personaje en el creador: el mismo modelo que en el juego, andando en el sitio sobre
// una tarima de madera, girado hacia donde se elija (con un giro suave) y, para ver la cara, con la cámara
// acercándose a la cabeza.
import * as THREE from 'three';
import { mat } from './geo.js';
import { planks } from './textures.js';
import { RealPerson } from './realperson.js';
import { TONE_MAPPING, CURVA } from './look.js';

// Las luces del estudio, de las de antes (pensadas para la curva ACES): con la del juego, al 70 %, el color de la mejilla
// sale como en el juego a mediodía (docs/pruebas-arte/t10/artev2.js)
export const STUDIO = 0.7;

export class CharacterPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // (la curva y la exposición del juego, y las luces del estudio a su medida: la piel y la ropa, como al jugar)
    this.renderer.toneMapping = TONE_MAPPING; this.renderer.toneMappingExposure = CURVA.exp;
    this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 0.8, 0.1, 20);
    // Encuadres: el cuerpo entero o la cabeza (posición de la cámara y punto al que mira)
    this.shots = { body: [[0, 1.25, 4.1], [0, 0.68, 0]], face: [[0, 1.24, 2.05], [0, 1.1, 0]] };
    this.shot = 'body'; this.cam = this.shots.body.map(v => new THREE.Vector3(...v));
    this.camera.position.copy(this.cam[0]);
    this.camera.lookAt(this.cam[1]);
    const sun = new THREE.DirectionalLight('#fff2dc', 2.6 * STUDIO);
    sun.position.set(1.5, 3, 2.5); sun.castShadow = true; sun.shadow.mapSize.set(512, 512);
    Object.assign(sun.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.5, far: 8 });
    this.scene.add(sun, new THREE.HemisphereLight('#e4eeff', '#7a5a3a', 1.1 * STUDIO));
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.12, 32), mat({ map: planks(), roughness: 0.7 }));
    stage.position.y = -0.06; stage.receiveShadow = true;
    this.scene.add(stage);
    this.person = null; this.angle = 0; this.want = 0; this.last = 0;
    this.walk = true;   // andando en el sitio (si no, de pie)
  }
  setLook(look) {
    if (this.person) this.scene.remove(this.person.root);
    this.look = look;
    // (si no se puede hacer, el escenario se queda vacío y el creador sigue: se avisa una vez)
    try { this.person = new RealPerson({ ...look }); }
    catch (err) { this.person = null; if (!this.warned) { this.warned = true; console.warn('Miniverse: no se pudo hacer la persona', err); } }
    // Encuadres a la altura de quien se ve: el cuerpo entero y la cara
    const h = this.person?.height ?? 1.7, face = h - 0.12;
    this.shots = { body: [[0, h * 0.72, 4.9], [0, h * 0.52, 0]], face: [[0, face + 0.02, 1.75], [0, face - 0.1, 0]] };
    if (!this.person) return;
    this.person.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.person.root.rotation.y = this.angle;
    this.scene.add(this.person.root);
  }
  // Ángulo hacia el que mira (0: de frente a la cámara)
  setAngle(a) { this.want = a; }
  // Encuadre: 'body' o 'face'
  focus(shot) { this.shot = shot; }
  resize(w, h) { this.renderer.setSize(w, h, false); this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  render(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000 || 0);
    this.last = t;
    let d = this.want - this.angle;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.angle += d * Math.min(1, dt * 8);
    if (this.person) { this.person.facing = this.angle; this.person.root.rotation.y = this.angle; this.person.update(dt, this.shot === 'face' || !this.walk ? 0 : 1.4); this.person.root.position.y = 0; }
    const [pos, at] = this.shots[this.shot], k = Math.min(1, dt * 7);
    this.cam[0].lerp(new THREE.Vector3(...pos), k); this.cam[1].lerp(new THREE.Vector3(...at), k);
    this.camera.position.copy(this.cam[0]);
    this.camera.lookAt(this.cam[1]);
    this.renderer.render(this.scene, this.camera);
  }
}
