// Entidades: cualquier cosa con posición que se mueve o se dibuja por sí misma (jugador, vecinos…).
import { lerp, clamp } from './util.js';
import { fromView, toView } from './iso.js';
import { CAM, screenToWorld, viewFor, screenDirOf } from './camera.js';
import { collide } from './physics.js';
import { Audio } from './audio.js';
import { towerFloor } from './world/tower.js';
import { WATER_Y } from './world/planet.js';
import { BARROW, WHEEL_AHEAD, pushedAhead } from './carry-items.js';
import { apagada } from './opciones.js';
import { gaitOf } from './input.js';

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
// The three speeds (input.js gaitOf: 0 walk, 1 jog, 2 sprint), in m/s before speedMul (the load, the bow, a potion and,
// riding, the horse's rideSpeed). Only the sprint spends stamina (needs.js). Riding: walk, trot, gallop (the gallop is
// the run of before); rowing: the fast row of before from the jog up. Swimming: the jog is a steady crawl that spends
// nothing; the sprint is the fast swim (it spends stamina and air). Crouching is always CROUCH_SPEED
export const GAIT = { foot: [3.2, 4.8, 5.8], ride: [3.2, 4.4, 5.3], row: [3.2, 5.3, 5.3], swim: [SWIM_SPEED, 1.85, SWIM_RUN] };
const CROUCH_SPEED = 1.4, BOAT_MUL = 1.4, STOP_SWIM = 8;
// Hunger from running, per metre (combat.exert): the sprint as the run of before, the jog less than half
const EXERT = [0, 0.02, 0.05];
// Diving (docs/planes/gta/PLAN-D-barras-buceo.md §4.4; ?buceo=0 turns it off: crouching sinks a little, as before).
// While swimming, Shift held (keys.dive) goes down and Space held comes up; with neither the diver drifts up slowly, so
// they can look around at the bottom. dive: metres of extra depth below sink (which keeps its meaning: up to SINK, and
// -0.12 with Space at the surface), never closer to the bed than DIVE_BED. Going down, sink fills first and then dive;
// coming up, dive empties first. In first person, W also follows the look pitch (looking down goes down).
// HEAD_UNDER: the head is under water past this much of sink + dive (the water line just above the eyes)
export const HEAD_UNDER = 0.42;
const DIVE_DOWN = 1.5, DIVE_UP = 1.8, DIVE_DRIFT = 0.15, DIVE_SPEED = 1.3, DIVE_BED = 1.0, DIVE_PITCH = 0.25;
const diving = !apagada('buceo');
// En el agua de lo cavado (un canal: ver scenes.js, reflood), nadando se pasa por encima de todo lo que queda bajo el agua y
// solo frena lo que asoma (sus paredes por encima del agua). Para salir, la orilla de tierra de un canal es una pared: el
// salto desde el agua (nadando, o de pie con el agua por encima de WADE_CLIMB: se toma impulso en el fondo) llega hasta
// CLIMB más de lo que hace falta para subirla, si no asoma más de CLIMB_MAX del agua. En seco, un hoyo de dos bloques no
// deja salir (hay que cavar escalones); con agua, sí
const CLIMB = 0.12, CLIMB_MAX = 0.8, WADE_CLIMB = 0.5;
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

// ---------- pushing the wheelbarrow (barrow.js) ----------
// Its footprint, pushed by someone at (x, y) facing (fx, fy): the wheel and the four corners of its box, as circles
// [ahead, side, radius]. How deep they are in what is around (pen) decides whether a step or a turn is taken: nothing that
// puts the box further into a wall, a fence, a rock, the water or a hole; anything that takes it out (so it never gets stuck)
// (lifted, as it is drawn: the corners of the tray's bottom, model z 0.275 and −0.525 at y 0.24, come to ~1.25 and ~0.49)
const BOX_FRONT = pushedAhead(0.275, 0.24), BOX_BACK = pushedAhead(-0.525, 0.24);
const BARROW_RING = [[WHEEL_AHEAD, 0, BARROW.WHEEL_R], [BOX_FRONT, 0.27, 0.06], [BOX_FRONT, -0.27, 0.06], [BOX_BACK, 0.27, 0.06], [BOX_BACK, -0.27, 0.06]];
// (a step or a turn is taken if it leaves the box no deeper than it was, or no deeper than PEN_SLACK at all: grazing a
// wall is sliding along it. Never "a bit deeper than before": steps of a bit would add up and go through)
const PEN_SLACK = 0.005, PUSH_NEAR = 2.6;
const penOk = (now, was) => now <= Math.max(was + 1e-6, PEN_SLACK);
// What the box bumps into, from the colliders already asked for around the player (no other collidersNear: it copies the
// village's): the rocks and the tower stairs too, not the dug tiles (their heights go apart)
export function barrowColliders(near, x, y, skip = null) {
  const out = [];
  for (const c of near || []) {
    if (c.dig || (skip && c.obb === skip)) continue;
    if (c.x0 !== undefined ? x < c.x0 - PUSH_NEAR || x > c.x1 + PUSH_NEAR || y < c.y0 - PUSH_NEAR || y > c.y1 + PUSH_NEAR : Math.hypot(c.x - x, c.y - y) > PUSH_NEAR + (c.r ?? Math.max(c.rx || 0, c.ry || 0))) continue;
    out.push(c);
  }
  return out;
}
// How much of it is inside something: what collide (physics.js) would move each circle, plus 1 for the wheel in water of
// BARROW.DEEP and for each circle (and the pusher's feet) more than STEP_UP above or below the feet where there is digging
// (feet: their height there, or null without digging)
export function barrowPen(scene, list, x, y, fx, fy, feet = null) {
  let pen = 0;
  const q = { x: 0, y: 0 };
  for (let i = 0; i < BARROW_RING.length; i++) {
    const [a, s, r] = BARROW_RING[i], cx = x + fx * a + fy * s, cy = y + fy * a - fx * s;
    q.x = cx; q.y = cy;
    collide(q, list, r);
    pen += Math.hypot(q.x - cx, q.y - cy);
    if (i === 0 && scene.waterDepth && scene.waterDepth(cx, cy) >= BARROW.DEEP) pen += 1;
    if (feet !== null && Math.abs(scene.surfaceAt(cx, cy) - feet) > STEP_UP) pen += 1;
  }
  if (feet !== null && scene.surfaceAt(x, y) < feet - STEP_UP) pen += 1;
  return pen;
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
    this.dive = 0;                     // diving: metres of extra depth below sink (Shift held; see DIVE_*); never saved
    this.forceRise = false;            // (set by needs.js out of air: up at DIVE_UP until the head is out, then cleared here)
    this.sprinting = false; this.fastSwim = false;   // (for needs.js stamina: sprinting on foot, swimming fast; see update)
    this.jogging = false;              // (jogging on foot: needs.js refills stamina more slowly meanwhile)
    this.gait = 0;                     // the gait it moves with (0 walk, 1 jog or trot, 2 sprint or gallop): the drawing and the network
    this.noSprint = false; this.noJog = false;   // (set by game.js each step: a load, the arms, exhaustion; the wheelbarrow)
    this.sleeping = false;             // (asleep in a bed: needs.js sleep sets it, rest.js stand clears it; st.zz)
    this.depth = 0;                    // lo hondo del agua donde está (0 en tierra)
    this.bank = null;                  // en el agua junto a la pared de un canal, la altura de su borde (para salir de un salto)
    this.pushing = null;               // the wheelbarrow pushed (its model key: barrow.js); not saved
    this.pushPen = 0;                  // (how far its box is inside something: Barrow.update parks it by force with Q after a while)
  }
  get airborne() { return this.z > this.floor + 0.01; }
  // The head under water (needs.js drains air; the view goes under): only swimming, and never with ?buceo=0
  get headUnder() { return diving && this.swim && this.sink + this.dive > HEAD_UNDER; }
  // Saltar (desde el suelo; en barca no)
  jump() {
    if (this.boat || this.aboard || this.airborne || this.pushing) return;   // (pushing the wheelbarrow, no jumping)
    // Nadando, el espacio sube (lo mira update); junto a la orilla, salta a ella: sale del agua desde donde flota
    if (this.swim) {
      if (!this.shore || this.dive >= 0.05) return;   // (diving, Space only comes up: the jump out is at the surface)
      this.swim = false; this.sink = 0; this.dive = 0;
      this.z = Math.max(0, this.depth - SWIM_ROOT); this.vz = JUMP * 1.15;
      // (a la pared de un canal: hasta su borde, con lo que suba el salto de más; ver inWater, bank)
      const need = this.bank === null ? 0 : this.bank + CLIMB - (WATER_Y - this.depth + this.z);
      if (need > this.vz * this.vz / (2 * GRAVITY)) this.vz = Math.sqrt(2 * GRAVITY * need);
      this.onExert?.(0.05); this.onSplash?.(this.x, this.y, 10); this.onJump?.();
      return;
    }
    if (this.canJump && !this.canJump()) return;   // (riding a winded horse: no jump, horse.js; game.js sets it)
    this.vz = JUMP * (this.mount ? 1.1 : 1) * (this.jumpMul ?? 1);   // (jumpMul: loaded or carrying something, carry.js; never too low to leave a hole)
    // (con el agua por la cintura junto a la pared de un canal: hasta su borde, ver CLIMB)
    if (this.bank !== null && !this.mount && this.depth >= WADE_CLIMB) { const need = this.bank + CLIMB - (WATER_Y - this.depth + this.floor); if (need > this.vz * this.vz / (2 * GRAVITY)) this.vz = Math.sqrt(2 * GRAVITY * need); }
    this.z = this.floor + 0.001;
    this.onExert?.(0.05); this.onJump?.();   // (onJump: the stamina of a jump, needs.js)
    Audio.swish();
  }
  // Movimiento con las teclas, que siguen la pantalla: arriba es hacia donde mira la cámara
  update(dt, keys, scene) {
    if (this.mount || this.boat || this.pushing) this.crouch = false;   // (agachado no se monta ni se rema; nor pushing the wheelbarrow)
    const sx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), sy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    const l = Math.hypot(sx, sy);
    if (this.mount || this.boat || this.aboard || this.ghost || this.pose) { this.swim = false; this.dive = 0; }
    // (en el agua: nadando, más despacio y agachado no frena, que es para hundirse; andando, cuanto más hondo más cuesta)
    const wade = this.wading ? 1 - 0.45 * clamp(this.depth / SWIM_OUT, 0, 1) : 1;
    // The tier the keys ask for, as far as it can be: noJog (the wheelbarrow, overloaded: carry.js) walks; noSprint (loaded,
    // something in the arms, out of breath: carry.js, needs.js) jogs at most
    const asked = gaitOf(keys), tier = this.noJog ? 0 : this.noSprint ? Math.min(1, asked) : asked;
    // (swimming under water, the walk and the jog both dive at DIVE_SPEED; the sprint is the fast swim, also under water)
    const base = this.swim ? (tier < 2 && this.dive > 0.3 ? DIVE_SPEED : GAIT.swim[tier])
      : this.crouch ? CROUCH_SPEED : (this.boat ? GAIT.row : this.mount ? GAIT.ride : GAIT.foot)[tier];
    const speed = base * (this.swim ? 1 : wade) / (l || 1) * (this.speedMul || 1) * (this.boat ? BOAT_MUL : 1);
    // (nadando, cada brazada lleva; letting go of the keys always stops, at any speed and on anything: on foot, riding,
    // rowing and pushing in a fifth of a second or so, swimming in under half a second: STOP_SWIM)
    const k = 1 - Math.exp(-dt * (this.swim ? (l ? 3 : STOP_SWIM) : 14));
    const [dx, dy] = screenToWorld(sx, sy);
    let wx = dx * speed, wy = dy * speed;
    // (pushing the wheelbarrow, only along it: forwards, or back at half the speed; the keys to a side turn it, see below)
    const push = this.pushing && !this.ghost;
    if (push) { const f = this.face, s = Math.max(wx * f.x + wy * f.y, -speed * 0.5); wx = f.x * s; wy = f.y * s; }
    this.vx = lerp(this.vx, wx, k);
    this.vy = lerp(this.vy, wy, k);
    const p = { x: this.x + this.vx * dt, y: this.y + this.vy * dt };
    let near = null;
    // (cerca de lo cavado: dónde están los pies, de verdad, para las paredes de los hoyos y los montones de tierra)
    // (nadando, los pies van flotando: solo frena lo que asoma del agua, ver CLIMB)
    const dug = !this.boat && !this.ghost && !!scene.digNear?.(this.x, this.y), feet = !dug ? 0 : this.swim ? WATER_Y - STEP_UP - 0.02 : scene.surfaceAt(this.x, this.y) + this.z;
    if (!this.boat && !this.ghost) {
      // (las rocas no frenan: se sube uno encima; y saltando, a pie o a caballo, se pasa por encima de las vallas)
      near = scene.collidersNear(p.x, p.y);
      const high = this.z - this.floor > (this.mount ? 0.2 : HOP);
      // (with something in the arms no fence is hopped: through the gate; riding, the big thing goes behind the saddle and the
      // horse jumps as always. Pushing the wheelbarrow the rocks and the tower stairs are walls: you would climb them and it not)
      collide(p, near.filter(c => (c.top === undefined || this.pushing) && !c.dig && !c.pond && !(high && c.low && !(this.carrying && !this.mount)) && !(c.zmax !== undefined && this.z > c.zmax)), RADIUS);   // (zmax: lo que solo frena abajo)
      if (dug) collide(p, scene.digWalls(p.x, p.y, feet, this.airborne ? 0.05 : STEP_UP), RADIUS);   // (en el aire, sin el escalón: se sube lo que da el salto)
    }
    // En barca, no salir a tierra; a caballo, no entrar en lo que cubre al caballo; a pie se nada (en el mundo: en las
    // cuevas, blocked son sus paredes). Si se puede, deslizarse por la orilla
    const world = !!scene.waterDepth;
    // (and with something in the arms, on foot, into nothing that would have to be swum: carry.js)
    // (and pushing the wheelbarrow, into nothing deeper than BARROW.DEEP)
    const blocked = this.ghost ? null : this.boat ? (x, y) => !scene.water?.(x, y) : world ? (this.mount ? (x, y) => scene.waterDepth(x, y) >= HORSE_DEEP : push && !this.swim ? (x, y) => scene.waterDepth(x, y) >= BARROW.DEEP : this.carrying && !this.swim ? (x, y) => scene.waterDepth(x, y) >= SWIM_IN : null) : scene.blocked?.bind(scene);
    if (blocked) {
      const wet = (x, y) => blocked(x, y) || blocked(x + RADIUS, y) || blocked(x - RADIUS, y) || blocked(x, y + RADIUS) || blocked(x, y - RADIUS);
      // (a caballo ya en lo hondo, llevado allí de otra forma: que pueda salir hacia lo menos hondo, y no se quede quieto
      // para siempre; hacia lo más hondo, no, o se cabalgaría por el fondo del mar. También deslizándose: el fondo no
      // siempre sube derecho hacia la orilla)
      const out = (this.mount || this.carrying || push) && world && wet(this.x, this.y), here = out ? scene.waterDepth(this.x, this.y) : 0;
      // (en barca, por un canal cavado solo si cabe el casco: ver scenes.js, boatFits. Si ya está donde no cabe, amarrada ahí
      // antes de que se estrechara, se rema como siempre, para poder salir)
      const fits = this.boat && scene.boatFits && scene.boatFits(this.x, this.y) ? (x, y) => scene.boatFits(x, y) : null;
      const ok = (x, y) => (!wet(x, y) || (out && scene.waterDepth(x, y) <= here)) && (!fits || fits(x, y));
      if (!ok(p.x, p.y)) {
        if (ok(p.x, this.y)) p.y = this.y;
        else if (ok(this.x, p.y)) p.x = this.x;
        else { p.x = this.x; p.y = this.y; }
      }
    }
    if (scene.bounds) { p.x = clamp(p.x, scene.bounds.x0, scene.bounds.x1); p.y = clamp(p.y, scene.bounds.y0, scene.bounds.y1); }
    // The wheelbarrow's box: a step that puts it further into something is not taken (sliding along x or y, if one does not)
    const B = push && near ? barrowColliders(near, this.x, this.y) : null, bfeet = dug && !this.swim ? feet : null;
    if (B) {
      const f = this.face, pen = (x, y) => barrowPen(scene, B, x, y, f.x, f.y, bfeet), was = pen(this.x, this.y);
      if (!penOk(pen(p.x, p.y), was)) {
        if (penOk(pen(p.x, this.y), was)) p.y = this.y;
        else if (penOk(pen(this.x, p.y), was)) p.x = this.x;
        else { p.x = this.x; p.y = this.y; }
      }
    }
    const moved = Math.hypot(p.x - this.x, p.y - this.y);
    if (tier && !this.crouch && !this.mount && !this.boat) this.onExert?.(moved * EXERT[tier]);   // (correr da hambre)
    // (al pasar de una casilla a otra junto a lo cavado, los pies se quedan a su altura: a una más baja se cae; a una algo más
    // alta, z queda por debajo de 0 y sube suave, como un escalón)
    // (en lo cavado y al entrar o salir de ello, los pies ya van así a su altura: en el agua de un canal, el agua no los vuelve
    // a mover, ver inWater)
    const pit = dug && (scene.digH(Math.floor(this.x), Math.floor(this.y)) !== null || scene.digH(Math.floor(p.x), Math.floor(p.y)) !== null);
    if (pit && (Math.floor(p.x) !== Math.floor(this.x) || Math.floor(p.y) !== Math.floor(this.y))) this.z = feet - scene.surfaceAt(p.x, p.y);
    this.x = p.x; this.y = p.y;
    this.inWater(dt, keys, scene, world, pit, l ? speed * l : 0);
    // (for needs.js stamina, from the gated tier: sprinting or jogging on foot; swimming fast, not while going down)
    const going = this.moving, afoot = going && !this.swim && !this.crouch && !this.mount && !this.boat && !this.aboard && !this.pushing;
    this.sprinting = afoot && tier === 2;
    this.jogging = afoot && tier === 1;
    this.fastSwim = tier === 2 && going && this.swim && !keys.dive;
    this.gait = going && !this.crouch && !this.aboard ? tier : 0;
    // (pushing, where the keys point, not where it goes: it goes only along the wheelbarrow)
    const kx = push ? dx : wx, ky = push ? dy : wy;
    let want = null;
    if (sx || sy) { const fl = Math.hypot(kx, ky); if (fl > 1e-9) { want = { x: kx / fl, y: ky / fl }; this.dir = [kx, ky]; } }
    // Arriba o abajo: de espaldas o de frente; solo a los lados: de perfil
    // Mira hacia donde anda: 8 direcciones (de frente, de espaldas, los dos perfiles y las cuatro diagonales)
    if (sx || sy) [this.view, this.flip] = viewFor(sx, sy);
    // En primera persona se mira hacia donde mira la cámara (y lo de delante es lo que se ve)
    if (CAM.first) { const [fx, fy] = screenToWorld(0, -1); want = { x: fx, y: fy }; this.dir = [fx, fy]; [this.view, this.flip] = viewFor(0, -1); }
    if (!push) { if (want) this.face = want; this.pushPen = 0; }
    else { this.turnPushed(want, dt, scene, B, bfeet); this.dir = [this.face.x, this.face.y]; }   // (the body faces as the wheelbarrow does: the drawing turns it by dir)
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
    if (!this.airborne && !this.mount && Math.floor(this.step) !== before && Math.floor(this.step) % 2 === 1) { if (this.wading && this.depth > 0.12) Audio.wade(); else Audio.step(this.inside || this.underRoof); }   // (en el agua, chapoteando)
  }
  // El agua donde se está: lo hondo (depth), si se vadea (wading) o se nada (swim), lo que se hunde (sink) y si hay orilla
  // delante a la que saltar (shore)
  // pit: se está en lo cavado o se acaba de salir de ello (ahí el fondo es llano y los pies ya los ha puesto update)
  // ahead: the swimming speed the keys ask for (first person: W follows the look pitch while diving)
  inWater(dt, keys, scene, world, pit = false, ahead = 0) {
    const d = world && !this.boat && !this.aboard && !this.ghost ? scene.waterDepth(this.x, this.y) : 0;
    // (en el aire, z va sobre el fondo de donde se está: al pasar sobre otro más alto o más bajo, se sigue a la misma altura
    // de verdad. Así se cae al agua desde la orilla y se sale de un salto, en vez de subir y bajar con el fondo)
    if (world && !this.swim && !pit && (this.vz !== 0 || this.z > this.floor + 0.01) && d !== this.depth) {
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
    // La pared de un canal delante (a 0,9 m), si se está en el agua con lo cavado cerca: lo alto que está su borde (ver CLIMB;
    // la orilla de verdad, que sube poco a poco, no hace falta)
    const f = this.face, ax = this.x + f.x * 0.9, ay = this.y + f.y * 0.9, deepish = this.swim || (d >= WADE_CLIMB && !this.mount);
    // (solo desde el agua de lo cavado: desde un río, a un montón de tierra de la orilla, no hay salto de más)
    const wall = deepish && scene.digNear?.(this.x, this.y, 1) && scene.floodAt?.(Math.floor(this.x), Math.floor(this.y)) !== undefined && scene.waterDepth(ax, ay) < SWIM_OUT;
    const top = wall ? scene.surfaceAt(ax, ay) : null;
    this.bank = top !== null && top - WATER_Y <= CLIMB_MAX ? top : null;
    if (!this.swim) { this.sink = 0; this.dive = 0; this.forceRise = false; this.shore = false; return; }
    if (diving) this.diveStep(dt, keys, d, ahead);
    else {
      // Con espacio, se asoma más; agachado, se hunde (sin tocar el fondo)
      const want = keys.space ? -0.12 : this.crouch ? Math.min(SINK, Math.max(0, d - 0.55)) : 0;
      this.sink += (want - this.sink) * Math.min(1, dt * 3);
    }
    // La orilla: delante se hace pie
    this.shore = scene.waterDepth(ax, ay) < SWIM_OUT;
    this.onExert?.(Math.hypot(this.vx, this.vy) * dt * 0.04);   // (nadar cansa algo más que andar)
  }
  // Diving, one step (see DIVE_*): d is the water's depth here, ahead the swimming speed asked for
  diveStep(dt, keys, d, ahead) {
    const room = Math.max(0, d - DIVE_BED - SINK);   // (dive's limit here: the bed, which pushes a diver up as it rises)
    let v = 0;                                       // metres down (+) or up (-) this step
    const up = this.forceRise || keys.space;
    if (up) v = -DIVE_UP * dt;
    else if (keys.dive) v = DIVE_DOWN * dt;
    // (first person, swimming forwards: looking down goes down, looking up comes up)
    if (!this.forceRise && CAM.first && keys.up && ahead > 0 && Math.abs(CAM.look) > DIVE_PITCH) v -= Math.sin(CAM.look) * ahead * dt;
    if (v > 0) {
      const s = Math.min(v, Math.max(0, Math.min(SINK, d - 0.55) - this.sink));   // (sink fills first, as it did crouching)
      this.sink += s; this.dive += v - s;
    } else if (v < 0) {
      const u = Math.min(-v, this.dive);   // (dive empties first; then sink, up to -0.12 with Space)
      this.dive -= u;
      const rest = -v - u;
      if (rest > 0) this.sink = Math.max(up ? -0.12 : 0, this.sink - rest);
    } else if (this.dive > 0) this.dive = Math.max(0, this.dive - DIVE_DRIFT * dt);   // (nothing held: a slow drift up)
    else this.sink += (0 - this.sink) * Math.min(1, dt * 3);   // (at the surface, nothing held: floating as always)
    this.dive = Math.min(this.dive, room);
    if (this.dive < 1e-4) this.dive = 0;
    this.sink = Math.min(this.sink, Math.max(0, Math.min(SINK, d - 0.55)));   // (into shallower water, the bed lifts it too)
    if (this.forceRise && this.sink + this.dive <= HEAD_UNDER) this.forceRise = false;   // (the head is out: needs.js breathes)
  }
  // Pushing, the body and the wheelbarrow turn towards want at BARROW.TURN at most, and only as far as the box does not go
  // further into something (half, a quarter, or nothing). face is then the wheelbarrow's heading
  turnPushed(want, dt, scene, B, feet) {
    const f = this.face, pen = g => (B ? barrowPen(scene, B, this.x, this.y, g.x, g.y, feet) : 0), was = pen(f);
    this.pushPen = was;
    if (!want) return;
    const a0 = Math.atan2(f.x, f.y);
    let da = Math.atan2(want.x, want.y) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const max = BARROW.TURN * dt;
    da = clamp(da, -max, max);
    if (Math.abs(da) < 1e-6) return;
    for (const k of [1, 0.5, 0.25]) {
      const a = a0 + da * k, g = { x: Math.sin(a), y: Math.cos(a) };
      if (penOk(pen(g), was)) { this.face = g; return; }
    }
  }
  // (game.update skips update while busy, in a dialogue or in a pose: no stale running or fast swimming for needs.js)
  stop() { this.vx = this.vy = 0; this.sprinting = this.fastSwim = this.jogging = false; this.gait = 0; }
  toSave() {
    return { name: this.name, look: this.look, x: +this.x.toFixed(2), y: +this.y.toFixed(2), inside: this.inside, view: this.view === 'side' ? 'front' : this.view, boat: !!this.boat || !!this.aboard, mount: !!this.mount, horseId: this.horseId, horseCoat: this.horseCoat, horseBags: this.horseBags, spawn: this.spawn };
  }
}
