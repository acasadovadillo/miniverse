// Entidades: cualquier cosa con posición que se mueve o se dibuja por sí misma (jugador, vecinos…).
import { lerp, clamp } from './util.js';
import { fromView, toView } from './iso.js';
import { screenToWorld, viewFor, screenDirOf } from './camera.js';
import { collide } from './physics.js';
import { Audio } from './audio.js';

export class Person {
  constructor({ x, y, look, view = 'front', flip = false }) {
    Object.assign(this, { x, y, look, view, flip, vx: 0, vy: 0, step: 0 });
  }
  get moving() { return Math.hypot(this.vx, this.vy) > 0.3; }
  // Hacia dónde mira en el mundo (su vista depende de la cámara; al girarla, sigue mirando hacia el mismo sitio).
  // dir: la dirección de verdad, si se sabe (andando o al mirar a alguien); si no, la de su vista
  worldDir() {
    if (this.dir) return this.dir;
    const [sx, sy] = screenDirOf(this.view, this.flip);   // en pantalla, una casilla es el doble de ancha que de alta
    return fromView((sx / 2 + sy) / 2, (sy - sx / 2) / 2);
  }
  faceTo(dx, dy) { const [x, y] = toView(dx, dy); this.dir = [dx, dy]; [this.view, this.flip] = viewFor((x - y) * 2, x + y); }
}

const RADIUS = 0.28;

export class Player extends Person {
  constructor(data) {
    super({ ...data, view: data.view || 'back' });
    this.name = data.name;
    this.inside = !!data.inside;
    this.boat = !!data.boat;
    this.mount = !!data.mount;
    this.face = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };   // dirección a la que mira, en la rejilla
  }
  // Movimiento con las teclas, que siguen la pantalla: arriba es hacia donde mira la cámara
  update(dt, keys, scene) {
    const sx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), sy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    const l = Math.hypot(sx, sy);
    const speed = (keys.run ? 5.3 : 3.2) / (l || 1) * (this.wading ? 0.55 : 1) * (this.speedMul || 1) * (this.boat ? 1.4 : 1);
    const k = 1 - Math.exp(-dt * 14);
    const [dx, dy] = screenToWorld(sx, sy), wx = dx * speed, wy = dy * speed;
    this.vx = lerp(this.vx, wx, k);
    this.vy = lerp(this.vy, wy, k);
    const p = { x: this.x + this.vx * dt, y: this.y + this.vy * dt };
    if (!this.boat) collide(p, scene.collidersNear(p.x, p.y), RADIUS);
    // No entrar en agua profunda (o, en barca, no salir a tierra): si se puede, deslizarse por la orilla
    const blocked = this.boat ? (x, y) => !scene.water?.(x, y) : scene.blocked?.bind(scene);
    if (blocked) {
      const wet = (x, y) => blocked(x, y) || blocked(x + RADIUS, y) || blocked(x - RADIUS, y) || blocked(x, y + RADIUS) || blocked(x, y - RADIUS);
      if (wet(p.x, p.y)) {
        if (!wet(p.x, this.y)) p.y = this.y;
        else if (!wet(this.x, p.y)) p.x = this.x;
        else { p.x = this.x; p.y = this.y; }
      }
    }
    if (scene.bounds) { p.x = clamp(p.x, scene.bounds.x0, scene.bounds.x1); p.y = clamp(p.y, scene.bounds.y0, scene.bounds.y1); }
    const moved = Math.hypot(p.x - this.x, p.y - this.y);
    this.x = p.x; this.y = p.y;
    this.wading = !this.boat && scene.water?.(this.x, this.y) === 'shallow';
    if (sx || sy) { const fl = Math.hypot(wx, wy); this.face = { x: wx / fl, y: wy / fl }; this.dir = [wx, wy]; }
    // Arriba o abajo: de espaldas o de frente; solo a los lados: de perfil
    // Mira hacia donde anda: 8 direcciones (de frente, de espaldas, los dos perfiles y las cuatro diagonales)
    if (sx || sy) [this.view, this.flip] = viewFor(sx, sy);
    const before = Math.floor(this.step);
    this.step = moved < 0.002 ? 0 : this.step + moved * 3.2;
    if (Math.floor(this.step) !== before && Math.floor(this.step) % 2 === 1) Audio.step(this.inside || this.underRoof);
  }
  stop() { this.vx = this.vy = 0; }
  toSave() {
    return { name: this.name, look: this.look, x: +this.x.toFixed(2), y: +this.y.toFixed(2), inside: this.inside, view: this.view === 'side' ? 'front' : this.view, boat: !!this.boat, mount: !!this.mount };
  }
}
