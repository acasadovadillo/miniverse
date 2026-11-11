// Entidades: cualquier cosa con posición que se mueve o se dibuja por sí misma (jugador, vecinos…).
import { lerp, clamp } from './util.js';
import { fromView, toView } from './iso.js';
import { CAM, screenToWorld, viewFor, screenDirOf } from './camera.js';
import { collide } from './physics.js';
import { Audio } from './audio.js';
import { towerFloor } from './world/tower.js';
import { WATER_Y } from './world/planet.js';

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
const JUMP = 5.0, GRAVITY = 15;   // velocidad al saltar (m/s) y gravedad: sube unos 83 cm y está 0,67 s en el aire
const HOP = 0.35;                  // saltando, por encima de esta altura se pasa sobre lo bajo (vallas, puertas de valla)
// Junto a lo cavado con la pala (ver scenes.js, digH): lo que queda más de STEP_UP por encima de los pies frena como un
// muro (medio bloque se sube andando; un bloque, 0,5 m, saltando, que sube 83 cm; dos, no) y al pasar a una casilla más
// baja se cae
const STEP_UP = 0.3;
// Nadar: en el agua que cubre más que la cintura (SWIM_IN de hondo; ver scenes.js, waterDepth) se nada, y se vuelve a
// andar al llegar a menos de SWIM_OUT (entre las dos, se sigue como se iba: así no cambia a cada paso en el borde). A
// caballo no se nada: el caballo vadea hasta HORSE_DEEP (cruza los ríos, con el agua al cuello en lo más hondo; el mar y
// los lagos, no).
// SWIM_ROOT: lo que quedan los pies (la raíz de la persona) bajo el agua nadando, para saltar a la orilla desde ahí. SINK:
// lo que se hunde agachado (la cabeza, bajo el agua)
export const SWIM_IN = 1.0, SWIM_OUT = 0.85;
const HORSE_DEEP = 1.25, SWIM_ROOT = 1.1, SINK = 0.55, SWIM_SPEED = 1.5, SWIM_RUN = 2.2;
// La altura del suelo en (x, y) por las rocas (las que tienen top): una cúpula de su altura y algo más ancha que su
// colisión, para subir andando por el borde
export function floorAt(x, y, list, z = 0) {
  let h = 0;
  for (const c of list) {
    if (c.top === undefined) continue;
    if (c.spiral) { const f = towerFloor(c, x, y, z); if (f !== null) return f; continue; }   // (la escalera de la torre manda)
    const R = c.r + 0.18, d = Math.hypot(x - c.x, y - c.y);
    if (d < R) h = Math.max(h, c.top * Math.sqrt(1 - (d / R) ** 2));
  }
  return h;
}

export class Player extends Person {
  constructor(data) {
    super({ ...data, view: data.view || 'back' });
    this.name = data.name;
    this.inside = !!data.inside;
    this.boat = !!data.boat;
    this.mount = !!data.mount;
    Object.assign(this, { horseId: data.horseId, horseCoat: data.horseCoat, horseBags: !!data.horseBags });   // el caballo que monta
    this.face = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };   // dirección a la que mira, en la rejilla
    this.z = 0; this.vz = 0;   // altura sobre el suelo (saltando o encima de una roca) y su velocidad
    this.floor = 0;            // la altura de lo que pisa (una roca), sobre el suelo
    this.spawn = data.spawn || null;   // dónde reaparece al morir (/spawnpoint); sin él, en casa
    this.ghost = false;                // espectador: atraviesa todo
    this.swim = false; this.sink = 0;  // nadando, y lo que se hunde (agachado) o se asoma (con espacio) bajo la línea de flotar
    this.depth = 0;                    // lo hondo del agua donde está (0 en tierra)
  }
  get airborne() { return this.z > this.floor + 0.01; }
  // Saltar (desde el suelo; en barca no)
  jump() {
    if (this.boat || this.aboard || this.airborne) return;
    // Nadando, el espacio sube (lo mira update); junto a la orilla, salta a ella: sale del agua desde donde flota
    if (this.swim) {
      if (!this.shore) return;
      this.swim = false; this.sink = 0;
      this.z = Math.max(0, this.depth - SWIM_ROOT); this.vz = JUMP * 1.15;
      this.onExert?.(0.05); this.onSplash?.(this.x, this.y, 10);
      return;
    }
    this.vz = JUMP * (this.mount ? 1.1 : 1);
    this.z = this.floor + 0.001;
    this.onExert?.(0.05);
    Audio.swish();
  }
  // Movimiento con las teclas, que siguen la pantalla: arriba es hacia donde mira la cámara
  update(dt, keys, scene) {
    if (this.mount || this.boat) this.crouch = false;   // (agachado no se monta ni se rema)
    const sx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), sy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    const l = Math.hypot(sx, sy);
    if (this.mount || this.boat || this.aboard || this.ghost || this.pose) this.swim = false;
    // (en el agua: nadando, más despacio y agachado no frena, que es para hundirse; andando, cuanto más hondo más cuesta)
    const wade = this.wading ? 1 - 0.45 * clamp(this.depth / SWIM_OUT, 0, 1) : 1;
    const speed = (this.swim ? (keys.run ? SWIM_RUN : SWIM_SPEED) : (this.crouch ? 1.4 : keys.run ? 5.3 : 3.2) * wade) / (l || 1) * (this.speedMul || 1) * (this.boat ? 1.4 : 1);
    const k = 1 - Math.exp(-dt * (this.swim ? 3 : 14));   // (nadando, cada brazada lleva y se para despacio)
    const [dx, dy] = screenToWorld(sx, sy), wx = dx * speed, wy = dy * speed;
    this.vx = lerp(this.vx, wx, k);
    this.vy = lerp(this.vy, wy, k);
    const p = { x: this.x + this.vx * dt, y: this.y + this.vy * dt };
    let near = null;
    // (cerca de lo cavado: dónde están los pies, de verdad, para las paredes de los hoyos y los montones de tierra)
    const dug = !this.boat && !this.ghost && !!scene.digNear?.(this.x, this.y), feet = dug ? scene.surfaceAt(this.x, this.y) + this.z : 0;
    if (!this.boat && !this.ghost) {
      // (las rocas no frenan: se sube uno encima; y saltando, a pie o a caballo, se pasa por encima de las vallas)
      near = scene.collidersNear(p.x, p.y);
      const high = this.z - this.floor > (this.mount ? 0.2 : HOP);
      collide(p, near.filter(c => c.top === undefined && !c.dig && !(high && c.low) && !(c.zmax !== undefined && this.z > c.zmax)), RADIUS);   // (zmax: lo que solo frena abajo)
      if (dug) collide(p, scene.digWalls(p.x, p.y, feet, this.airborne ? 0.05 : STEP_UP), RADIUS);   // (en el aire, sin el escalón: se sube lo que da el salto)
    }
    // En barca, no salir a tierra; a caballo, no entrar en lo que cubre al caballo; a pie se nada (en el mundo: en las
    // cuevas, blocked son sus paredes). Si se puede, deslizarse por la orilla
    const world = !!scene.waterDepth;
    const blocked = this.ghost ? null : this.boat ? (x, y) => !scene.water?.(x, y) : world ? (this.mount ? (x, y) => scene.waterDepth(x, y) >= HORSE_DEEP : null) : scene.blocked?.bind(scene);
    if (blocked) {
      const wet = (x, y) => blocked(x, y) || blocked(x + RADIUS, y) || blocked(x - RADIUS, y) || blocked(x, y + RADIUS) || blocked(x, y - RADIUS);
      // (a caballo ya en lo hondo, llevado allí de otra forma: que pueda salir, y no se quede quieto para siempre)
      if (wet(p.x, p.y) && !(this.mount && world && wet(this.x, this.y))) {
        if (!wet(p.x, this.y)) p.y = this.y;
        else if (!wet(this.x, p.y)) p.x = this.x;
        else { p.x = this.x; p.y = this.y; }
      }
    }
    if (scene.bounds) { p.x = clamp(p.x, scene.bounds.x0, scene.bounds.x1); p.y = clamp(p.y, scene.bounds.y0, scene.bounds.y1); }
    const moved = Math.hypot(p.x - this.x, p.y - this.y);
    if (keys.run && !this.crouch && !this.mount && !this.boat) this.onExert?.(moved * 0.05);   // (correr da hambre)
    // (al pasar de una casilla a otra junto a lo cavado, los pies se quedan a su altura: a una más baja se cae; a una algo más
    // alta, z queda por debajo de 0 y sube suave, como un escalón)
    if (dug && (Math.floor(p.x) !== Math.floor(this.x) || Math.floor(p.y) !== Math.floor(this.y)) && (scene.digH(Math.floor(this.x), Math.floor(this.y)) !== null || scene.digH(Math.floor(p.x), Math.floor(p.y)) !== null)) this.z = feet - scene.surfaceAt(p.x, p.y);
    this.x = p.x; this.y = p.y;
    this.inWater(dt, keys, scene, world);
    if (sx || sy) { const fl = Math.hypot(wx, wy); this.face = { x: wx / fl, y: wy / fl }; this.dir = [wx, wy]; }
    // Arriba o abajo: de espaldas o de frente; solo a los lados: de perfil
    // Mira hacia donde anda: 8 direcciones (de frente, de espaldas, los dos perfiles y las cuatro diagonales)
    if (sx || sy) [this.view, this.flip] = viewFor(sx, sy);
    // En primera persona se mira hacia donde mira la cámara (y lo de delante es lo que se ve)
    if (CAM.first) { const [fx, fy] = screenToWorld(0, -1); this.face = { x: fx, y: fy }; this.dir = [fx, fy]; [this.view, this.flip] = viewFor(0, -1); }
    // Lo que se pisa: subiendo a una roca, se sube con ella (deprisa, sin saltar); bajando poco, se baja con ella; si
    // no, se cae
    this.floor = near && !this.mount && !this.swim ? floorAt(this.x, this.y, near, this.z) : 0;
    if (this.swim) {   // (nadando no se salta ni se cae: flota; lo que se hunde va aparte, en sink)
      this.z = 0; this.vz = 0;
      return;   // (las brazadas, con sus gotas y su sonido, las lleva el dibujo: three/actors.js, swimY)
    }
    if (this.vz === 0 && this.z - this.floor < 0.3) { this.z += (this.floor - this.z) * Math.min(1, dt * 14); if (Math.abs(this.z - this.floor) < 0.005) this.z = this.floor; }
    // El salto: sube y baja con la gravedad (en el aire no suenan los pasos)
    else if (this.z > this.floor || this.vz > 0) {
      this.vz -= GRAVITY * dt;
      this.z += this.vz * dt;
      if (this.z <= this.floor) { const hard = this.vz < -2; this.z = this.floor; this.vz = 0; if (hard) { Audio.step(this.inside || this.underRoof); if (!this.floor) this.onLand?.(); } }
    }
    const before = Math.floor(this.step);
    this.step = moved < 0.002 ? 0 : this.step + moved * 3.2;
    if (!this.airborne && Math.floor(this.step) !== before && Math.floor(this.step) % 2 === 1) { if (this.wading && this.depth > 0.12) Audio.wade(); else Audio.step(this.inside || this.underRoof); }   // (en el agua, chapoteando)
  }
  // El agua donde se está: lo hondo (depth), si se vadea (wading) o se nada (swim), lo que se hunde (sink) y si hay orilla
  // delante a la que saltar (shore)
  inWater(dt, keys, scene, world) {
    const d = world && !this.boat && !this.aboard && !this.ghost ? scene.waterDepth(this.x, this.y) : 0;
    // (en el aire, z va sobre el fondo de donde se está: al pasar sobre otro más alto o más bajo, se sigue a la misma altura
    // de verdad. Así se cae al agua desde la orilla y se sale de un salto, en vez de subir y bajar con el fondo)
    if (world && !this.swim && (this.vz !== 0 || this.z > this.floor + 0.01) && d !== this.depth) {
      const base = h => (h > 0 ? WATER_Y - h : 0);   // (el fondo; en tierra, a ras)
      this.z += base(this.depth) - base(d);
      if (this.z < this.floor) { this.z = this.floor; if (this.vz < 0) this.vz = 0; }
    }
    this.depth = d;
    if (!this.mount && !this.pose && d > 0) {
      // Se empieza a nadar al entrar en lo hondo con los pies abajo (cayendo de un salto, al llegar a donde se flota)
      if (!this.swim && d >= SWIM_IN && this.z - this.floor <= Math.max(0.01, d - SWIM_ROOT) && this.vz <= 0) {
        this.swim = true; this.sink = 0; this.crouch = false;
        if (this.vz < -2 || this.z > 0.2) this.onSplash?.(this.x, this.y, 16);
        this.z = 0; this.vz = 0;
      } else if (this.swim && d < SWIM_OUT) { this.swim = false; this.z = 0; this.vz = 0; this.sink = 0; this.crouch = false; }
    } else this.swim = false;
    this.wading = !this.swim && d > 0;
    if (!this.swim) { this.sink = 0; this.shore = false; return; }
    // Con espacio, se asoma más; agachado, se hunde (sin tocar el fondo)
    const want = keys.space ? -0.12 : this.crouch ? Math.min(SINK, Math.max(0, d - 0.55)) : 0;
    this.sink += (want - this.sink) * Math.min(1, dt * 3);
    // La orilla: delante (a 0,9 m) se hace pie
    const f = this.face, ax = this.x + f.x * 0.9, ay = this.y + f.y * 0.9;
    this.shore = scene.waterDepth(ax, ay) < SWIM_OUT;
    this.onExert?.(Math.hypot(this.vx, this.vy) * dt * 0.04);   // (nadar cansa algo más que andar)
  }
  stop() { this.vx = this.vy = 0; }
  toSave() {
    return { name: this.name, look: this.look, x: +this.x.toFixed(2), y: +this.y.toFixed(2), inside: this.inside, view: this.view === 'side' ? 'front' : this.view, boat: !!this.boat || !!this.aboard, mount: !!this.mount, horseId: this.horseId, horseCoat: this.horseCoat, horseBags: this.horseBags, spawn: this.spawn };
  }
}
