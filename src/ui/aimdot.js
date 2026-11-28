// The white dot on what is aimed at (GTA VI): in place of the yellow outline (three/outline.js, still there with ?contorno=0),
// a small white dot in the middle of the thing, and the key and what it does just to its right (ui/prompts.js reads at).
// One element over the canvas, moved by transform; engine.js drawOutline sets it each frame from outline.js point.
import * as THREE from 'three';

const SIZE = 10;   // px across
const STYLE = `
#aim-dot { position: fixed; left: 0; top: 0; width: ${SIZE}px; height: ${SIZE}px; margin: -${SIZE / 2}px 0 0 -${SIZE / 2}px; border-radius: 50%;
  background: #fff; box-shadow: 0 0 0 1.5px rgba(0, 0, 0, .35), 0 0 6px rgba(0, 0, 0, .45); pointer-events: none; z-index: 5;
  opacity: 0; transition: opacity .12s; will-change: transform; }
#aim-dot.on { opacity: .95; }
body:not(.playing) #aim-dot, body.quick-open #aim-dot { display: none !important; }`;

export class AimDot {
  constructor() {
    this.v = new THREE.Vector3();
    this.at = null;   // [x, y] in CSS pixels while shown, else null
    this.x = this.y = NaN;
  }
  get el() {
    if (!this._el) {
      if (!document.getElementById('aim-dot-style')) document.head.append(Object.assign(document.createElement('style'), { id: 'aim-dot-style', textContent: STYLE }));
      this._el = Object.assign(document.createElement('div'), { id: 'aim-dot' });
      document.body.append(this._el);
    }
    return this._el;
  }
  // p: [x, height, y] in the view's units (or null: none), camera: the view's
  show(p, camera) {
    let at = null;
    if (p && camera) {
      const v = this.v.set(p[0], p[1], p[2]).project(camera);
      if (v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05) at = [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
    }
    if (!at) { if (this.at) { this.at = null; this.el.classList.remove('on'); } return; }
    if (!this.at) this.el.classList.add('on');
    this.at = at;
    const x = Math.round(at[0]), y = Math.round(at[1]);
    if (x !== this.x || y !== this.y) { this.x = x; this.y = y; this.el.style.transform = `translate3d(${x}px, ${y}px, 0)`; }
  }
}
