// Entidades: cualquier cosa con posición que se mueve o se dibuja por sí misma (jugador, vecinos…).
import { lerp, clamp, ellipse } from './util.js';
import { HW, HH, fromView, toView } from './iso.js';
import { personSprites, viewFor, screenDirOf, FEET_X, FEET_Y } from './art/people3.js';
import { boatSprite, horseSprite } from './art/explore.js';
import { collide } from './physics.js';
import { Audio } from './audio.js';

export class Person {
  constructor({ x, y, look, view = 'front', flip = false }) {
    Object.assign(this, { x, y, look, view, flip, vx: 0, vy: 0, step: 0 });
    this.sprites = personSprites(look);
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
  frame() { return this.sprites[this.view][this.moving ? 1 + (Math.floor(this.step) % 4) : 0]; }
  // Huella para ordenar el dibujo por profundidad
  footprint() { return { x0: this.x - 0.2, x1: this.x + 0.2, y0: this.y - 0.2, y1: this.y + 0.2, c: this.x + this.y }; }
  draw(ctx, sx, sy, time = 0) {
    // En barca: la barca debajo y el cuerpo cortado por la cintura; a caballo: el caballo debajo y el jinete más alto
    if (this.boat) {
      const b = boatSprite(), bob = Math.round(Math.sin(time * 2.5)), bx = Math.round(sx) - 23, by = Math.round(sy) - 12 + bob;
      ctx.drawImage(b, bx, by);
      const img = this.frame(), h = FEET_Y - 18;
      if (this.flip) { ctx.save(); ctx.translate(Math.round(sx), 0); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, img.width, h, -FEET_X, by + 8 - h, img.width, h); ctx.restore(); }
      else ctx.drawImage(img, 0, 0, img.width, h, Math.round(sx) - FEET_X, by + 8 - h, img.width, h);
      ctx.drawImage(b, 0, 8, b.width, b.height - 8, bx, by + 8, b.width, b.height - 8);   // el borde de delante tapa las piernas
      return;
    }
    if (this.mount) {
      const hs = horseSprite(this.moving ? Math.floor(this.step) % 2 : 0), x = Math.round(sx);
      ellipse(ctx, sx, sy, 14, 4, 'rgba(20,30,15,.3)');
      if (this.flip) { ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1); ctx.drawImage(hs, -19, Math.round(sy) - 31); ctx.restore(); } else ctx.drawImage(hs, x - 19, Math.round(sy) - 31);
      const img = this.sprites.side[0], y = Math.round(sy) - FEET_Y - 8, h = FEET_Y - 8;
      if (this.flip) { ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, img.width, h, -FEET_X, y, img.width, h); ctx.restore(); }
      else ctx.drawImage(img, 0, 0, img.width, h, x - FEET_X, y, img.width, h);
      return;
    }
    const img = this.frame(), x = Math.round(sx), y = Math.round(sy) - FEET_Y;
    // En el agua se cortan los pies y se dibujan ondas alrededor
    const h = this.wading ? FEET_Y - 5 : img.height;
    if (!this.wading) ellipse(ctx, sx, sy, 8, 3, 'rgba(20,30,15,.3)');
    if (this.flip) {
      ctx.save(); ctx.translate(x + FEET_X, 0); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, img.width, h, 0, y, img.width, h); ctx.restore();
    } else ctx.drawImage(img, 0, 0, img.width, h, x - FEET_X, y, img.width, h);
    if (this.wading) {
      const r = 7 + Math.round(Math.sin(time * 6) * 1.5);
      ctx.fillStyle = '#d8f0ff';
      ctx.fillRect(x - r, Math.round(sy) - 5, r * 2, 1);
      ctx.fillStyle = 'rgba(216,240,255,.5)';
      ctx.fillRect(x - r - 3, Math.round(sy) - 3, 3, 1); ctx.fillRect(x + r, Math.round(sy) - 3, 3, 1);
    }
  }
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
  // Movimiento con las teclas, que siguen la pantalla: arriba = -x -y en la rejilla de la vista, derecha = +x -y
  // (con la cámara girada, la vista se lleva al mundo)
  update(dt, keys, scene) {
    const sx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), sy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    const l = Math.hypot(sx, sy);
    const px = (keys.run ? 120 : 72) / (l || 1) * (this.wading ? 0.55 : 1) * (this.speedMul || 1) * (this.boat ? 1.4 : 1);
    const vsx = sx * px, vsy = sy * px * 0.6;   // en vertical, algo más lento (como en el mundo)
    const k = 1 - Math.exp(-dt * 14);
    const [wx, wy] = fromView((vsx / HW + vsy / HH) / 2, (vsy / HH - vsx / HW) / 2);
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
