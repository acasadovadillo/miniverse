// Entidades: cualquier cosa con posición que se mueve o se dibuja por sí misma (jugador, vecinos…).
import { lerp, clamp } from './util.js';
import { fromView, toView } from './iso.js';
import { CAM, screenToWorld, viewFor, screenDirOf } from './camera.js';
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
const JUMP = 4.4, GRAVITY = 15;   // velocidad al saltar (m/s) y gravedad: sube unos 65 cm y está 0,6 s en el aire

export class Player extends Person {
  constructor(data) {
    super({ ...data, view: data.view || 'back' });
    this.name = data.name;
    this.inside = !!data.inside;
    this.boat = !!data.boat;
    this.mount = !!data.mount;
    Object.assign(this, { horseId: data.horseId, horseCoat: data.horseCoat, horseBags: !!data.horseBags });   // el caballo que monta
    this.face = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };   // dirección a la que mira, en la rejilla
    this.z = 0; this.vz = 0;   // altura del salto sobre el suelo y su velocidad
    this.spawn = data.spawn || null;   // dónde reaparece al morir (/spawnpoint); sin él, en casa
    this.ghost = false;                // espectador: atraviesa todo
  }
  get airborne() { return this.z > 0; }
  // Saltar (desde el suelo; en barca no)
  jump() {
    if (this.boat || this.z > 0) return;
    this.vz = JUMP * (this.mount ? 1.1 : 1);
    this.z = 0.001;
    this.onExert?.(0.05);
    Audio.swish();
  }
  // Movimiento con las teclas, que siguen la pantalla: arriba es hacia donde mira la cámara
  update(dt, keys, scene) {
    if (this.mount || this.boat) this.crouch = false;   // (agachado no se monta ni se rema)
    const sx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), sy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    const l = Math.hypot(sx, sy);
    const speed = (this.crouch ? 1.4 : keys.run ? 5.3 : 3.2) / (l || 1) * (this.wading ? 0.55 : 1) * (this.speedMul || 1) * (this.boat ? 1.4 : 1);
    const k = 1 - Math.exp(-dt * 14);
    const [dx, dy] = screenToWorld(sx, sy), wx = dx * speed, wy = dy * speed;
    this.vx = lerp(this.vx, wx, k);
    this.vy = lerp(this.vy, wy, k);
    const p = { x: this.x + this.vx * dt, y: this.y + this.vy * dt };
    if (!this.boat && !this.ghost) { const near = scene.collidersNear(p.x, p.y); collide(p, this.mount && this.z > 0.2 ? near.filter(c => !c.low) : near, RADIUS); }   // (a caballo se saltan las vallas)
    // No entrar en agua profunda (o, en barca, no salir a tierra): si se puede, deslizarse por la orilla
    const blocked = this.ghost ? null : this.boat ? (x, y) => !scene.water?.(x, y) : scene.blocked?.bind(scene);
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
    if (keys.run && !this.crouch && !this.mount && !this.boat) this.onExert?.(moved * 0.05);   // (correr da hambre)
    this.x = p.x; this.y = p.y;
    this.wading = !this.boat && scene.water?.(this.x, this.y) === 'shallow';
    if (sx || sy) { const fl = Math.hypot(wx, wy); this.face = { x: wx / fl, y: wy / fl }; this.dir = [wx, wy]; }
    // Arriba o abajo: de espaldas o de frente; solo a los lados: de perfil
    // Mira hacia donde anda: 8 direcciones (de frente, de espaldas, los dos perfiles y las cuatro diagonales)
    if (sx || sy) [this.view, this.flip] = viewFor(sx, sy);
    // En primera persona se mira hacia donde mira la cámara (y lo de delante es lo que se ve)
    if (CAM.first) { const [fx, fy] = screenToWorld(0, -1); this.face = { x: fx, y: fy }; this.dir = [fx, fy]; [this.view, this.flip] = viewFor(0, -1); }
    // El salto: sube y baja con la gravedad (en el aire no suenan los pasos)
    if (this.z > 0) {
      this.vz -= GRAVITY * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) { this.z = 0; this.vz = 0; Audio.step(this.inside || this.underRoof); }
    }
    const before = Math.floor(this.step);
    this.step = moved < 0.002 ? 0 : this.step + moved * 3.2;
    if (this.z === 0 && Math.floor(this.step) !== before && Math.floor(this.step) % 2 === 1) Audio.step(this.inside || this.underRoof);
  }
  stop() { this.vx = this.vy = 0; }
  toSave() {
    return { name: this.name, look: this.look, x: +this.x.toFixed(2), y: +this.y.toFixed(2), inside: this.inside, view: this.view === 'side' ? 'front' : this.view, boat: !!this.boat, mount: !!this.mount, horseId: this.horseId, horseCoat: this.horseCoat, horseBags: this.horseBags, spawn: this.spawn };
  }
}
