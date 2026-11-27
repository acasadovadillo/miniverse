// The new creator's stage (plan CR, P1, ?creador=nuevo): a MakeHuman person (person.js) on the wooden stage, with three
// lights to judge the skin (day, indoors, evening), a soft studio reflection and the creator's shots (body, face, the face
// from three quarters). Same calls as three/preview.js CharacterPreview, so the creator can use either.
import * as THREE from 'three';
import { mat } from '../geo.js';
import { planks } from '../textures.js';
import { TONE_MAPPING, CURVA } from '../look.js';
import { loadMh } from './data.js';
import { MhPerson, texturesReady } from './person.js';

// The lights: key (colour, strength, where from), fill (sky, ground, strength), rim (colour, strength)
export const LIGHTS = {
  day: { key: ['#fff1de', 1.7, [1.2, 2.6, 2.4]], hemi: ['#dfe9ff', '#6a5440', 0.5], rim: ['#cfe0ff', 0.8], env: 0.4 },
  indoor: { key: ['#ffd2a0', 1.5, [-1.6, 1.9, 1.8]], hemi: ['#f0d8bc', '#3a2c22', 0.45], rim: ['#ffb070', 0.5], env: 0.3 },
  evening: { key: ['#ff9a52', 2.0, [-2.6, 0.9, 1.4]], hemi: ['#7a8ab8', '#4a3424', 0.5], rim: ['#a8b8ff', 0.8], env: 0.35 },
};

// A soft studio round the person, for the reflections on the eyes and the skin: a grey dome, lighter above, and two
// bright panels (our own, made here)
function studioEnv(renderer) {
  const scene = new THREE.Scene(), g = new THREE.SphereGeometry(10, 32, 16), c = [], p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.5 + 0.5 * p.getY(i) / 10; c.push(0.12 + 0.5 * k, 0.12 + 0.52 * k, 0.13 + 0.58 * k); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  for (const [x, y, z, s] of [[4, 5, 6, 3.2], [-6, 2, 3, 2]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.9, 3.7) }));
    panel.position.set(x, y, z); panel.lookAt(0, 1.5, 0);
    scene.add(panel);
  }
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromScene(scene, 0.02).texture;
  pm.dispose();
  return env;
}

export class MhPreview {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = TONE_MAPPING; r.toneMappingExposure = CURVA.exp;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.environment = studioEnv(r);
    this.camera = new THREE.PerspectiveCamera(26, 0.8, 0.05, 20);
    this.key = new THREE.DirectionalLight('#fff', 1);
    this.key.castShadow = true; this.key.shadow.mapSize.set(1024, 1024); this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.012;
    Object.assign(this.key.shadow.camera, { left: -1.1, right: 1.1, top: 1.1, bottom: -1.1, near: 0.5, far: 9 });
    this.key.target.position.set(0, 1, 0);
    this.hemi = new THREE.HemisphereLight('#fff', '#000', 1);
    this.rim = new THREE.DirectionalLight('#fff', 1); this.rim.position.set(-1.8, 2.2, -2.4);
    this.scene.add(this.key, this.key.target, this.hemi, this.rim);
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.12, 32), mat({ map: planks(), roughness: 0.7 }));
    stage.position.y = -0.06; stage.receiveShadow = true;
    this.scene.add(stage);
    this.setLight('day');
    this.person = null; this.angle = 0; this.want = 0; this.last = 0; this.look = null; this.D = null;
    this.shot = 'body'; this.cam = [new THREE.Vector3(0, 1.2, 4.9), new THREE.Vector3(0, 0.9, 0)];
    this.stats = { buildMs: 0, frameMs: 0, tris: 0, download: 0 };
    this.ready = loadMh().then(D => { this.D = D; this.stats.download = D.downloaded; if (this.look) this.setLook(this.look); return D; })
      .catch(err => { console.warn('Miniverse: MakeHuman data did not load', err); throw err; });
    this.ready.catch(() => {});
  }
  setLight(id) {
    const L = LIGHTS[id] || LIGHTS.day;
    this.light = LIGHTS[id] ? id : 'day';
    this.key.color.set(L.key[0]); this.key.intensity = L.key[1]; this.key.position.set(...L.key[2]).multiplyScalar(1.6).add(new THREE.Vector3(0, 0.4, 0));
    this.hemi.color.set(L.hemi[0]); this.hemi.groundColor.set(L.hemi[1]); this.hemi.intensity = L.hemi[2];
    this.rim.color.set(L.rim[0]); this.rim.intensity = L.rim[1];
    this.scene.environmentIntensity = L.env;   // (r160 has no such field: the materials' envMapIntensity below)
    this.envK = L.env;
    if (this.person) this.envOn(this.person.root);
  }
  setLook(look) {
    this.look = look;
    if (!this.D) return;
    const key = MhPerson.shapeKey(look);
    if (this.person && this.person.key === key) { this.person.colour(look); return; }
    try {
      if (!this.person) { this.person = new MhPerson(this.D, look); this.scene.add(this.person.root); } else this.person.build(look);
    } catch (err) { console.warn('Miniverse: could not make the MakeHuman person', err); return; }
    this.envOn(this.person.root);
    this.stats.buildMs = this.person.ms; this.stats.tris = this.person.tris;
    this.frame();
    this.person.root.rotation.y = this.angle;
    this.onBuilt?.(this.person);
  }
  // (how much of the studio each material reflects: the light's, but the cornea keeps its own)
  envOn(root) { root.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) m.envMapIntensity = m.userData.env ?? this.envK; }); }
  // The shots at the height of who is seen: the whole body, the face, and the face from three quarters
  frame() {
    const h = this.person?.height ?? 1.7, eye = this.person?.eyeY ?? h - 0.11;
    this.shots = {
      body: [[0, h * 0.72, 4.9], [0, h * 0.52, 0]],
      face: [[0, eye + 0.02, 1.2], [0, eye - 0.05, 0]],
      close: [[0, eye + 0.01, 0.62], [0, eye - 0.04, 0]],
    };
  }
  setKit() {}
  setAngle(a) { this.want = a; }
  focus(shot) { this.shot = shot; }
  resize(w, h) { this.renderer.setSize(w, h, false); this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  // Straight to a shot and an angle, without easing (for pictures)
  snap(shot, angle = this.want) { this.shot = shot; this.want = this.angle = angle; this.frame(); const [p, a] = this.shots[shot], o = this.faceOff(); this.cam[0].set(...p).add(o); this.cam[1].set(...a).add(o); }
  // (near the head, the camera follows the face as the person turns: the face is a hand in front of the turning axis)
  faceOff() { return this.shot === 'body' ? new THREE.Vector3() : new THREE.Vector3(Math.sin(this.angle) * 0.085, 0, (Math.cos(this.angle) - 1) * 0.085); }
  // A portrait of a look (for the grid of heads): drawn in a corner of this canvas just before a frame, which then paints
  // over it, and copied out at once. done(canvas) gets it; a newer request for the same canvas replaces an older one
  portrait(look, done, w = 84, h = 100) {
    this.portraits = (this.portraits || []).filter(q => q.done !== done);
    this.portraits.push({ look, done, w, h });
  }
  drawPortraits() {
    if (!this.portraits?.length || !this.D || !texturesReady()) return;
    const r = this.renderer, pr = r.getPixelRatio(), cam = this.pcam ||= new THREE.PerspectiveCamera(22, 1, 0.05, 10);
    const main = this.person?.root, P = this.pperson ||= new MhPerson(this.D, this.portraits[0].look);
    if (main) main.visible = false;
    this.scene.add(P.root);
    const out = this.pcanvas ||= document.createElement('canvas');
    for (let n = 0; n < 3 && this.portraits.length; n++) {
      const q = this.portraits.shift();
      if (P.key !== MhPerson.shapeKey(q.look)) P.build(q.look);
      P.colour(q.look);
      this.envOn(P.root);
      P.root.rotation.y = 0.32;
      cam.aspect = q.w / q.h; cam.updateProjectionMatrix();
      cam.position.set(0.16, P.eyeY + 0.03, 0.62); cam.lookAt(0, P.eyeY - 0.045, 0);
      r.setScissorTest(true); r.setViewport(0, 0, q.w, q.h); r.setScissor(0, 0, q.w, q.h);
      r.render(this.scene, cam);
      out.width = Math.round(q.w * pr); out.height = Math.round(q.h * pr);
      out.getContext('2d').drawImage(this.canvas, 0, this.canvas.height - out.height, out.width, out.height, 0, 0, out.width, out.height);
      q.done(out);
    }
    this.scene.remove(P.root);
    if (main) main.visible = true;
    r.setScissorTest(false);
    const s = r.getSize(new THREE.Vector2());
    r.setViewport(0, 0, s.x, s.y);
  }
  render(t) {
    this.drawPortraits();
    const t0 = performance.now(), dt = Math.min(0.05, (t - this.last) / 1000 || 0);
    this.last = t;
    let d = this.want - this.angle;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.angle += d * Math.min(1, dt * 8);
    if (this.person) this.person.root.rotation.y = this.angle;
    if (!this.shots) this.frame();
    const [pos, at] = this.shots[this.shot] || this.shots.body, k = Math.min(1, dt * 7), o = this.faceOff();
    this.cam[0].lerp(new THREE.Vector3(...pos).add(o), k); this.cam[1].lerp(new THREE.Vector3(...at).add(o), k);
    this.camera.position.copy(this.cam[0]);
    this.camera.lookAt(this.cam[1]);
    this.renderer.render(this.scene, this.camera);
    this.stats.frameMs = this.stats.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }
}
